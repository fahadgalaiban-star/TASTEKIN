import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Evaluate the actual private GET registrations and their authorization helpers,
// without importing the DB-backed app, storage SDK, session store or signer.
// Database operations below are recording in-memory fakes only.
const [storage, closet, engagement] = await Promise.all([
  readFile('artifacts/api-server/src/routes/storage.ts', 'utf8'),
  readFile('artifacts/api-server/src/routes/closet-items.ts', 'utf8'),
  readFile('artifacts/api-server/src/routes/engagement.ts', 'utf8'),
]);
const between = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing route/helper boundary: ${start}`);
  return source.slice(first, last);
};
const getRoute = (source, path) => between(source, `router.get("${path}"`, '\n});') + '\n});';
const routeCode = [
  between(storage, 'function referencedPaths(', 'router.post('),
  between(storage, 'function blurredRenditionPaths(', 'router.get("/storage/objects/'),
  between(closet, 'function requireUserMw(', 'async function closetAnalysisFlagMw('),
  between(engagement, 'export function requireUser(', 'export async function getEditContext(').replace('export ', ''),
  closet.match(/^const UUID_RE = .+$/m)[0],
  getRoute(storage, '/storage/objects/*path'),
  getRoute(closet, '/closet-items/:id/image'),
].join('\n');
const compiled = stripTypeScriptTypes(routeCode);
const ITEM = '00000000-0000-4000-8000-000000000001';
const SIGNED = 'https://provider.test/image?signature=fixture';

function harness() {
  const routes = new Map(), signed = [], streamed = [], logs = [];
  let enabled = true, reads = 0;
  const owned = {
    edits: [{ image: '/objects/uploads/owned', sourceImage: '/objects/uploads/source', previewImage: '/objects/uploads/blurred' }],
    collections: [{ coverImage: '/objects/uploads/collection' }],
    profile: { avatar: '/objects/uploads/avatar' },
  };
  const columns = { id: 'id', ownerUserId: 'ownerUserId' };
  const rows = [{ id: ITEM, ownerUserId: 'owner', imageObjectKey: 'fixture-key' }];
  const bindings = {
    router: { get: (path, ...handlers) => routes.set(path, handlers) },
    creatorForUser: async (id) => id === 'owner' ? owned : null,
    getPrivateMediaDownloadURL: async (path) => { signed.push(path); return SIGNED; },
    getClosetMediaDownloadURL: async (key) => { signed.push(key); return SIGNED; },
    streamPrivateImage: async (res, url) => { streamed.push(url); res.setHeader('Cache-Control', 'private, no-store'); res.body = 'fixture bytes'; },
    isFeatureEnabled: async () => enabled,
    closetItems: columns,
    eq: (column, value) => ({ column, value }),
    and: (...conditions) => conditions,
    db: { select: () => {
      reads += 1;
      return { from: () => ({ where: async (conditions) => rows.filter((row) =>
        conditions.every(({ column, value }) => row[column] === value)) }) };
    } },
  };
  new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  async function request(path, { user, authenticated = Boolean(user), inline = true, object = 'uploads/owned', id = ITEM } = {}) {
    const req = {
      user: user ? { id: user } : undefined,
      isAuthenticated: () => authenticated,
      params: { path: object.split('/'), id },
      get: (header) => header === 'X-Tastekin-Private-Image' && inline ? '1' : undefined,
      log: { warn: (fields) => logs.push(fields) },
    };
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      vary() {},
      redirect(code, location) { this.statusCode = code; this.headers.Location = location; },
      destroy() { this.destroyed = true; },
    };
    async function invoke(index) {
      let continuation;
      await routes.get(path)[index](req, res, () => { continuation = invoke(index + 1); });
      if (continuation) await continuation;
    }
    await invoke(0);
    return res;
  }
  return { request, signed, streamed, logs, setEnabled: (value) => { enabled = value; }, reads: () => reads };
}

test('private creator images reject unauthenticated, wrong-workspace, unreferenced and blurred-rendition requests before signing', async () => {
  const h = harness(), route = '/storage/objects/*path';
  for (const input of [{}, { user: 'other' }, { user: 'owner', object: 'uploads/unreferenced' }, { user: 'owner', object: 'uploads/blurred' }]) {
    const res = await h.request(route, input);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers.Location, undefined);
    assert.equal(res.body.error, 'Media object not found');
  }
  assert.deepEqual(h.signed, []);
  assert.deepEqual(h.streamed, []);
  assert.deepEqual(h.logs, []);
});

test('private closet images retain authentication, feature gate, UUID checks and owner filtering before signing', async () => {
  const h = harness(), route = '/closet-items/:id/image';
  assert.equal((await h.request(route)).statusCode, 401);
  assert.equal((await h.request(route, { user: 'owner', authenticated: false })).statusCode, 401);
  assert.equal((await h.request(route, { user: 'owner', id: 'malformed' })).statusCode, 404);
  assert.equal((await h.request(route, { user: 'other' })).statusCode, 404);
  h.setEnabled(false);
  assert.equal((await h.request(route, { user: 'owner' })).statusCode, 403);
  assert.equal(h.reads(), 1);
  assert.deepEqual(h.signed, []);
  assert.deepEqual(h.streamed, []);
});

for (const [route, expectedSigned] of [
  ['/storage/objects/*path', '/objects/uploads/owned'],
  ['/closet-items/:id/image', 'fixture-key'],
]) {
  test(`${route}: authorized native requests stream bytes; ordinary web requests retain redirects`, async () => {
    const h = harness();
    const native = await h.request(route, { user: 'owner' });
    assert.equal(native.statusCode, 200);
    assert.equal(native.body, 'fixture bytes');
    assert.equal(native.headers['Cache-Control'], 'private, no-store');
    assert.equal(native.headers.Location, undefined);
    const web = await h.request(route, { user: 'owner', inline: false });
    assert.equal(web.statusCode, 302);
    assert.equal(web.headers.Location, SIGNED);
    assert.deepEqual(h.signed, [expectedSigned, expectedSigned]);
    assert.deepEqual(h.streamed, [SIGNED]);
  });
}