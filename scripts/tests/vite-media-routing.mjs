import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

/** Real Vite dev/preview ingress, using only the caller's synthetic isolated API. */
export async function verifyViteMediaRouting({ apiPort, direct, image, reportId, adminSession, hide, restore }) {
  process.env.PORT = String(apiPort);
  process.env.BASE_PATH = '/';
  process.env.API_DEV_PORT = String(apiPort);
  const requireFrontend = createRequire(resolve('artifacts/tastekin/package.json'));
  const vite = await import(requireFrontend.resolve('vite'));
  const configFile = resolve('artifacts/tastekin/vite.config.ts');
  const servers = [];
  try {
    const dev = await vite.createServer({ configFile, optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await dev.listen(); servers.push({ server: dev.httpServer, close: () => dev.close() });
    const preview = await vite.preview({ configFile, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    servers.push({ server: preview.httpServer, close: () => new Promise((done) => preview.httpServer.close(done)) });
    const source = resolve('artifacts/tastekin/public/tastekin-media');
    const filename = (await readdir(source))[0], original = await readFile(resolve(source, filename));
    for (const frontend of servers) {
      const base = `http://127.0.0.1:${frontend.server.address().port}`;
      const publicImage = await fetch(base + direct);
      assert.equal(publicImage.status, 200); assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), image);
      assert.equal((await fetch(base + direct, { headers: { Origin: 'https://foreign.example.invalid' } })).status, 403);
      await hide();
      for (const method of ['GET', 'HEAD']) {
        const denied = await fetch(base + direct + '?known=1', { method, headers: { range: 'bytes=0-3', 'if-none-match': '*' } });
        assert.equal(denied.status, 404); assert.equal((await denied.arrayBuffer()).byteLength, 0);
      }
      const inspected = await fetch(`${base}/api/admin/reports/${reportId}/inspection/media`, { headers: { cookie: `sid=${adminSession}` } });
      assert.equal(inspected.status, 200); assert.deepEqual(Buffer.from(await inspected.arrayBuffer()), image);
      for (const path of [`/public/tastekin-media/${filename}`, `/@fs${resolve(source, filename)}`]) {
        assert.notDeepEqual(Buffer.from(await (await fetch(base + path)).arrayBuffer()), original, `static bypass: ${path}`);
      }
      assert.equal((await fetch(base + '/favicon.svg')).status, 200, 'unrelated UI asset');
      await restore();
      const restored = await fetch(base + direct);
      assert.equal(restored.status, 200); assert.deepEqual(Buffer.from(await restored.arrayBuffer()), image);
    }
  } finally {
    for (const frontend of servers.reverse()) await frontend.close();
    delete process.env.PORT; delete process.env.BASE_PATH; delete process.env.API_DEV_PORT;
  }
}