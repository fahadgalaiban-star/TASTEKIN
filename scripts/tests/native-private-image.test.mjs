import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setImmediate as nextTick } from 'node:timers/promises';
import { privateImagePath, loadPrivateImage } from '../../artifacts/tastekin/src/lib/private-image.ts';
import { streamPrivateImage } from '../../artifacts/api-server/src/lib/private-image-response.ts';

const API = 'https://api.example.test';
const PATH = '/api/closet-items/item/image';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');

function harness(fetchImpl = async () => new Response(PNG)) {
  const states = [], revoked = [], created = [], calls = [];
  const transport = {
    fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
    createObjectURL: (blob) => { const url = `blob:test-${created.length}`; created.push({ url, blob }); return url; },
    revokeObjectURL: (url) => revoked.push(url),
  };
  return { states, revoked, created, calls, start: (path = PATH) => loadPrivateImage(path, (state) => states.push(state), transport) };
}

test('private route classification accepts relative, configured-origin and raw creator paths', () => {
  assert.equal(privateImagePath(PATH, API), PATH);
  assert.equal(privateImagePath(API + PATH, API), PATH);
  assert.equal(privateImagePath('/api/storage/objects/uploads/file', API), '/api/storage/objects/uploads/file');
  assert.equal(privateImagePath('/objects/uploads/file', API), '/api/storage/objects/uploads/file');
  assert.equal(privateImagePath('https://api.example.test/base' + PATH, API + '/base'), PATH);
});

test('public images and untrusted absolute origins are never private fetch targets', () => {
  for (const src of [
    '/api/public-profile-media/person', '/api/public-profile-media/person/cover',
    '/api/public-media/person/edit', '/api/public-media/person/edit/preview',
    '/tastekin-media/photo.webp', 'blob:local-preview', 'data:image/png;base64,AA==',
    'https://cdn.example.test/photo.png', '//elsewhere.test' + PATH,
    'https://elsewhere.test' + PATH, 'https://api.example.test.evil.test' + PATH,
    'https://user:password@api.example.test' + PATH, '', undefined,
  ]) assert.equal(privateImagePath(src, API), null);
  assert.equal(privateImagePath(API + PATH, ''), null);
});

test('loader uses the relative authenticated-fetch path, never copies bearer credentials', async () => {
  const h = harness(), dispose = h.start();
  await nextTick();
  assert.equal(h.calls[0][0], PATH);
  assert.equal(h.calls[0][1].cache, 'no-store');
  assert.equal(h.calls[0][1].redirect, 'error');
  assert.deepEqual(h.calls[0][1].headers, { 'X-Tastekin-Private-Image': '1' });
  assert.equal(h.states.at(-1).status, 'ready');
  assert.ok(h.created[0].blob instanceof Blob);
  dispose();
  assert.equal(h.calls[0][1].signal.aborted, true);
  assert.deepEqual(h.revoked, ['blob:test-0']);
});

for (const status of [401, 403, 404, 500]) {
  test(`HTTP ${status} never reads/displays the credential-containing error body`, async () => {
    const h = harness(async () => ({
      ok: false, status,
      blob() { throw new Error('Error bodies must not be read'); },
    }));
    const dispose = h.start();
    await nextTick();
    assert.deepEqual(h.states.at(-1), { status: status === 401 || status === 403 ? 'unauthorized' : 'error' });
    assert.deepEqual(h.created, []);
    dispose();
  });
}

test('network exceptions and empty responses produce only a generic failure state', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('Bearer test-secret https://provider.test/?signature=test-secret'); },
    async () => new Response(''),
  ]) {
    const h = harness(fetchImpl), dispose = h.start();
    await nextTick();
    assert.deepEqual(h.states.at(-1), { status: 'error' });
    assert.equal(JSON.stringify(h.states).includes('test-secret'), false);
    dispose();
  }
});

test('source replacement aborts/revokes; late fetch and late blob results cannot replace the newest source', async () => {
  let oldResponse, middleBlob;
  const h = harness((path) => path.endsWith('/old')
    ? new Promise((resolve) => { oldResponse = resolve; })
    : path.endsWith('/middle')
      ? Promise.resolve({ ok: true, blob: () => new Promise((resolve) => { middleBlob = resolve; }) })
      : Promise.resolve(new Response(PNG)));
  const oldDispose = h.start(PATH + '/old');
  oldDispose();
  const middleDispose = h.start(PATH + '/middle');
  await nextTick();
  middleDispose();
  const latestDispose = h.start(PATH);
  await nextTick();
  oldResponse(new Response(PNG));
  middleBlob(new Blob([PNG]));
  await nextTick();
  assert.equal(h.created.length, 1);
  assert.deepEqual(h.states.at(-1), { status: 'ready', src: 'blob:test-0' });
  latestDispose();
  latestDispose(); // StrictMode/cleanup must be idempotent.
  assert.deepEqual(h.revoked, ['blob:test-0']);
});

test('unmount before completion never creates a URL or emits a later state', async () => {
  let complete;
  const h = harness(() => new Promise((resolve) => { complete = resolve; }));
  const dispose = h.start();
  dispose();
  complete(new Response(PNG));
  await nextTick();
  assert.deepEqual(h.states, [{ status: 'loading' }]);
  assert.equal(h.created.length, 0);
});

test('API streams bytes without exposing provider URLs or forwarding bearer headers', async () => {
  const output = new PassThrough();
  const headers = {}, chunks = [];
  output.setHeader = (key, value) => { headers[key] = value; };
  output.on('data', (chunk) => chunks.push(chunk));
  await streamPrivateImage(output, 'https://provider.test/?signature=private', async (_url, init) => {
    assert.equal(init.headers, undefined);
    assert.equal(init.credentials, undefined);
    return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  });
  assert.deepEqual(Buffer.concat(chunks), PNG);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['Content-Type'], 'image/png');
  assert.equal(headers.Location, undefined);
});

test('provider HTTP and network failures are sanitized before route logging/responses', async () => {
  for (const fetchImpl of [
    async () => new Response('provider-secret', { status: 403 }),
    async () => { throw new Error('https://provider.test/?signature=provider-secret'); },
  ]) {
    await assert.rejects(streamPrivateImage(new PassThrough(), 'https://provider.test', fetchImpl),
      { message: 'Private image unavailable' });
  }
});

test('provider body-stream errors are sanitized on both the response stream and the rejected promise', async () => {
  const output = new PassThrough(), errors = [];
  output.setHeader = () => {};
  output.on('error', (error) => errors.push(error.message));
  await assert.rejects(streamPrivateImage(output, 'https://provider.test/?signature=private', async () =>
    new Response(new ReadableStream({
      start(controller) { controller.error(new Error('https://provider.test/?signature=provider-secret')); },
    }))), { message: 'Private image unavailable' });
  assert.deepEqual(errors, ['Private image unavailable']);
});

test('all authenticated image call sites use MediaImage; local crop sources stay local', async () => {
  const source = await readFile(resolve('artifacts/tastekin/src/App.tsx'), 'utf8');
  assert.equal(/<img\b[^>]*src=\{(?:apiUrl|imageSrc)\(/.test(source), false);
  assert.ok(source.includes('<MediaImage src={apiUrl(`/api/closet-items/'));
  assert.ok(source.includes('const image = await loadImage(source.url)'));
});

// Real React mount/unmount, actual native.ts fetch wrapping, and actual browser
// image decode. All API/storage/plugin responses below are isolated fixtures.
// No app server, shared database, storage bucket or production token is used.
test('browser integration: native bearer/blob lifecycle, web cookies/direct URLs, public URLs and decode failures', async (t) => {
  const frontendRequire = createRequire(resolve('artifacts/tastekin/package.json'));
  const { chromium } = frontendRequire('@playwright/test');
  const { build } = createRequire(frontendRequire.resolve('vite/package.json'))('esbuild');
  const bundles = {}, requests = [], preflights = [];
  let nativeFixtureOrigin;
  const redirectedRequests = [];
  const redirectTarget = createServer((req, res) => {
    redirectedRequests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
    res.end(PNG);
  });
  await new Promise((resolve) => redirectTarget.listen(0, '127.0.0.1', resolve));
  const differentOrigin = `http://127.0.0.1:${redirectTarget.address().port}`;
  t.after(() => { redirectTarget.closeAllConnections(); redirectTarget.close(); });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.test');
    if (nativeFixtureOrigin) res.setHeader('Access-Control-Allow-Origin', nativeFixtureOrigin);
    if (req.method === 'OPTIONS') {
      preflights.push({ path: url.pathname, headers: req.headers['access-control-request-headers'] });
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Authorization, X-Tastekin-Private-Image',
      });
      res.end();
      return;
    }
    if (url.pathname.endsWith('.js')) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundles[url.pathname]);
      return;
    }
    if (url.pathname === '/native' || url.pathname === '/web') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Set-Cookie', 'fixture-session=web-cookie; Path=/; SameSite=Lax');
      res.end(`<div id="root"></div><script src="${url.pathname}.js"></script>`);
      return;
    }
    requests.push({ path: url.pathname, url: req.url, authorization: req.headers.authorization, inline: req.headers['x-tastekin-private-image'], cookie: req.headers.cookie });
    if (url.pathname.includes('/redirect/')) {
      res.writeHead(302, { Location: `${differentOrigin}/provider-image` });
      res.end();
    } else if (url.pathname.includes('/same-origin-redirect/')) {
      res.writeHead(302, { Location: '/api/closet-items/redirect-followed/image' });
      res.end();
    } else if (url.pathname.includes('/denied/') || url.pathname.includes('/unauthenticated/')) {
      res.writeHead(url.pathname.includes('/unauthenticated/') ? 401 : 403, { 'Content-Type': 'application/json' });
      res.end('{"error":"Bearer fixture-bearer-secret"}');
    } else if (url.pathname.includes('/bad-image/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end('not an image');
    } else {
      const send = () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); };
      if (url.pathname.includes('/slow/')) setTimeout(send, 100);
      else send();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  nativeFixtureOrigin = `http://localhost:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const native of [true, false]) {
    const bundle = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { MediaImage } from './src/components/MediaImage';
          import { initNativeShell } from './src/native';
          localStorage.setItem('tastekin:native-install', '1');
          initNativeShell();
          window.revoked = [];
          const originalRevoke = URL.revokeObjectURL.bind(URL);
          URL.revokeObjectURL = (url) => { window.revoked.push(url); originalRevoke(url); };
          const root = createRoot(document.getElementById('root'));
          window.setImage = (src) => root.render(React.createElement(MediaImage, {
            src, alt: 'fixture image', id: 'image', className: 'preserved-class',
            style: { width: 40, height: 40 },
          }));
          window.removeImage = () => root.render(null);
        `,
        resolveDir: resolve('artifacts/tastekin'),
      },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(base), 'process.env.NODE_ENV': '"production"' },
      plugins: [{
        name: 'native-plugin-fixtures',
        setup(build) {
          build.onResolve({ filter: /^(@capacitor\/|@aparajita\/|@workspace\/api-client-react$)/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path === '@capacitor/core'
              ? `export const Capacitor = { isNativePlatform: () => ${native}, getPlatform: () => '${native ? 'ios' : 'web'}' };`
              : path === '@aparajita/capacitor-secure-storage'
                ? `export const KeychainAccess = { whenUnlockedThisDeviceOnly: 1 };
                   export const SecureStorage = { setKeyPrefix: async()=>{}, setSynchronize: async()=>{},
                   setDefaultKeychainAccess: async()=>{}, get: async()=> 'fixture-bearer-secret', remove: async()=>{} };`
                : `export const App = { addListener: async()=>{} };
                   export const SplashScreen = { hide: async()=>{} };
                   export const Style = { Light: 1 };
                   export const StatusBar = { setStyle: async()=>{}, setBackgroundColor: async()=>{} };
                   export const setBaseUrl = ()=>{}; export const setAuthTokenGetter = ()=>{};`,
            loader: 'js',
          }));
        },
      }],
    });
    bundles[native ? '/native.js' : '/web.js'] = bundle.outputFiles[0].text;
  }
  // Replit supplies Chromium separately from Playwright's revisioned download.
  const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (message) => errors.push(message.text()));
  // Seed the API origin's cookie jar, then exercise native fetch from a
  // different origin. Native authenticated requests must still omit cookies.
  await page.goto(base + '/web');
  await page.goto(nativeFixtureOrigin + '/native');
  await page.evaluate((src) => window.setImage(src), base + PATH);
  await page.waitForFunction(() => document.querySelector('#image')?.getAttribute('src')?.startsWith('blob:') && document.querySelector('#image').naturalWidth > 0);
  const original = await page.locator('#image').getAttribute('src');
  assert.equal(requests.find((r) => r.path === PATH).authorization, 'Bearer fixture-bearer-secret');
  assert.equal(requests.find((r) => r.path === PATH).inline, '1');
  assert.equal(requests.find((r) => r.path === PATH).cookie, undefined);
  assert.ok(preflights.some((r) => r.path === PATH
    && r.headers.includes('authorization') && r.headers.includes('x-tastekin-private-image')));
  assert.equal(await page.locator('#image').getAttribute('class'), 'preserved-class');

  await page.evaluate(() => { window.setImage('/api/closet-items/slow/image'); });
  await page.waitForFunction(() => window.revoked.length === 1);
  await page.evaluate(() => { window.setImage('/api/closet-items/new/image'); });
  await page.waitForFunction(() => document.querySelector('#image')?.getAttribute('data-private-image-state') === 'ready');
  const newest = await page.locator('#image').getAttribute('src');
  assert.notEqual(newest, original);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#image').getAttribute('src'), newest);
  assert.ok((await page.evaluate(() => window.revoked)).includes(original));
  await page.evaluate(() => window.removeImage());
  await page.waitForFunction(() => window.revoked.length === 2);
  assert.ok((await page.evaluate(() => window.revoked)).includes(newest));

  for (const name of ['denied', 'unauthenticated']) {
    await page.evaluate((src) => window.setImage(src), `/api/closet-items/${name}/image`);
    await page.waitForFunction(() => document.querySelector('#image')?.dataset.privateImageState === 'unauthorized');
    assert.equal(await page.locator('#image').getAttribute('src'), null);
    assert.equal((await page.content()).includes('fixture-bearer-secret'), false);
  }
  for (const name of ['redirect', 'same-origin-redirect']) {
    await page.evaluate((src) => window.setImage(src), `/api/closet-items/${name}/image`);
    await page.waitForFunction(() => document.querySelector('#image')?.dataset.privateImageState === 'error');
    assert.equal(await page.locator('#image').getAttribute('src'), null);
  }
  assert.equal(redirectedRequests.length, 0);
  assert.equal(requests.some((r) => r.path === '/api/closet-items/redirect-followed/image'), false);
  assert.equal(requests.filter((r) => r.authorization).every((r) =>
    /^\/api\/(?:closet-items\/[^/]+\/image|storage\/objects\/)/.test(r.path)
    && !r.url.includes('fixture-bearer-secret')), true);
  await page.evaluate(() => window.setImage('/api/closet-items/bad-image/image'));
  await page.waitForFunction(() => document.querySelector('#image')?.dataset.privateImageState === 'error');
  assert.equal(await page.locator('#image').getAttribute('src'), null);
  assert.equal(errors.some((message) => message.includes('fixture-bearer-secret')), false);

  const publicPath = '/api/public-profile-media/person';
  await page.evaluate((src) => window.setImage(src), publicPath);
  await page.waitForFunction(() => document.querySelector('#image')?.naturalWidth > 0);
  assert.equal(await page.locator('#image').getAttribute('src'), publicPath);
  assert.equal(requests.find((r) => r.path === publicPath).authorization, undefined);
  assert.equal(requests.find((r) => r.path === publicPath).inline, undefined);

  const creatorPath = '/api/storage/objects/uploads/native-fixture';
  await page.evaluate((src) => window.setImage(src), base + creatorPath);
  await page.waitForFunction(() => document.querySelector('#image')?.getAttribute('src')?.startsWith('blob:') && document.querySelector('#image').naturalWidth > 0);
  assert.equal(requests.find((r) => r.path === creatorPath).authorization, 'Bearer fixture-bearer-secret');
  assert.equal(requests.find((r) => r.path === creatorPath).inline, '1');
  assert.equal(requests.find((r) => r.path === creatorPath).cookie, undefined);
  const creatorURL = await page.locator('#image').getAttribute('src');
  await page.evaluate(() => window.removeImage());
  await page.waitForFunction((url) => window.revoked.includes(url), creatorURL);

  await page.goto(base + '/web');
  const webPath = '/api/storage/objects/uploads/web-fixture';
  await page.evaluate((src) => window.setImage(src), webPath);
  await page.waitForFunction(() => document.querySelector('#image')?.naturalWidth > 0);
  assert.equal(await page.locator('#image').getAttribute('src'), webPath);
  assert.equal(await page.locator('#image').getAttribute('data-private-image-state'), null);
  assert.equal(requests.find((r) => r.path === webPath).authorization, undefined);
  assert.equal(requests.find((r) => r.path === webPath).inline, undefined);
  assert.equal(requests.find((r) => r.path === webPath).cookie, 'fixture-session=web-cookie');
  assert.deepEqual(await page.evaluate(() => window.revoked), []);
});