import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The agent seeds exclusively through executeSql(environment: "development").
// This runner cannot accept a remote API/database URL or call a provider.
const f = JSON.parse(await readFile('.local/premerge96-fixture.json', 'utf8'));
assert.match(f.prefix, /^pr96gate-[a-f0-9]{14}$/);
for (const id of Object.values(f.users)) assert.ok(id.startsWith(f.prefix));
const base = 'http://127.0.0.1:8080';
const admin = { cookie: `sid=${f.sessions.admin}` };
const author = { cookie: `sid=${f.sessions.author}` };
const native = { authorization: `Bearer ${f.nativeToken}` };
let assertions = 0;
function equal(actual, expected, label) {
  assert.equal(actual, expected, label); assertions++;
}
async function request(path, headers = {}, options = {}) {
  assert.ok(path.startsWith('/api/') || path === f.media);
  return fetch(base + path, { redirect: 'manual', ...options, headers: { ...headers, ...options.headers } });
}
async function action(report, name, headers = admin, input = {}) {
  assert.ok(Object.values(f.reports).includes(report));
  return request(`/api/admin/reports/${report}/actions`, headers, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: name, confirmed: true, reason: 'PR96 synthetic Development gate', ...input }),
  });
}
async function inspect(report = f.reports.edit) {
  const res = await request(`/api/admin/reports/${report}/inspection`, admin);
  equal(res.status, 200, 'authenticated inspection');
  return res.json();
}
async function media(expected) {
  for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-3', 'If-None-Match': '*' } }]) {
    const res = await request(f.media, {}, options);
    equal(res.status, expected === 200 && options.headers ? 206 : expected, 'public direct-media state');
    assert.match(res.headers.get('cache-control') ?? '', /no-store/); assertions++;
    if (expected === 404) equal((await res.arrayBuffer()).byteLength, 0, 'hidden media contains no bytes');
  }
}
async function comments(expected = 200) {
  const res = await request(`/api/edits/${f.edit}/comments`);
  equal(res.status, expected, 'comments endpoint');
  if (expected === 404) return {};
  return res.json();
}
const hasComment = payload => JSON.stringify(payload).includes(f.comment);

try {
  const me = await request('/api/me', admin);
  equal(me.status, 200, 'web session');
  equal((await me.json()).user.id, f.users.admin, 'synthetic identity');
  const nativeMe = await request('/api/me', native);
  const nativeState = await nativeMe.json();
  equal(nativeMe.status, 200, 'native bearer');
  equal(nativeState.user.id, f.users.author, 'native synthetic identity');
  equal(nativeState.nativeAuth, 'valid', 'native bearer resolved');
  await media(200);
  equal((await request(f.media, { Origin: 'https://foreign.invalid' })).status, 403, 'foreign origin');
  equal((await request(`/api/admin/reports/${f.reports.edit}/inspection`)).status, 403, 'anonymous inspection');
  equal((await action(f.reports.edit, 'hide_edit', author)).status, 403, 'non-admin moderation');
  equal((await action(f.reports.edit, 'hide_edit', admin, { confirmed: false })).status, 400, 'confirmation required');
  const original = (await inspect()).target.data;
  equal((await action(f.reports.edit, 'hide_edit')).status, 200, 'hide Edit');
  equal((await inspect()).target.hidden, true, 'Edit overlay hidden');
  await media(404);
  const inspectedMedia = await request(`/api/admin/reports/${f.reports.edit}/inspection/media`, admin);
  equal(inspectedMedia.status, 200, 'admin sees hidden synthetic original');
  assert.deepEqual((await inspect()).target.data, original); assertions++;
  equal((await action(f.reports.edit, 'restore_edit')).status, 200, 'restore Edit');
  equal((await inspect()).target.hidden, false, 'Edit restored');
  await media(200);
  equal(hasComment(await comments()), true, 'public comment before hide');
  equal((await action(f.reports.comment, 'hide_comment')).status, 200, 'hide comment');
  equal(hasComment(await comments()), false, 'hidden comment excluded');
  equal((await inspect(f.reports.comment)).target.data.body, 'PR96 synthetic fixture comment', 'original comment retained');
  equal((await action(f.reports.comment, 'restore_comment')).status, 200, 'restore comment');
  equal(hasComment(await comments()), true, 'comment restored');
  for (const protectedReport of [f.reports.owner, f.reports.admin, f.reports.self, f.reports.roleAdmin]) {
    const before = await inspect(protectedReport);
    equal((await action(protectedReport, 'suspend_user')).status, 403, 'owner/admin/self protection');
    equal((await inspect(protectedReport)).history.length, before.history.length, 'rejected action has no audit');
  }
  equal((await action(f.reports.edit, 'suspend_user')).status, 200, 'suspend author');
  await media(404);
  equal(hasComment(await comments(404)), false, 'suspended-author Edit and comments withheld');
  for (const credential of [author, native]) {
    const state = await (await request('/api/me', credential)).json();
    equal(state.user.id, f.users.author, 'restricted identity proof');
    equal(state.accountSuspended, true, 'suspended state');
    equal(state.creator, null, 'creator privileges withheld');
    const deniedWrite = await request('/api/edits/' + f.edit + '/comments', credential, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Must not be inserted' }),
    });
    // Visibility can withhold the parent Edit before the authentication guard.
    assert.ok([401, 403, 404].includes(deniedWrite.status), 'ordinary write rejected'); assertions++;
  }
  equal((await action(f.reports.edit, 'unsuspend_user')).status, 200, 'unsuspend author');
  await media(200);
  equal(hasComment(await comments()), true, 'suspended-author comment restored');
  for (const credential of [author, native]) {
    const state = await (await request('/api/me', credential)).json();
    equal(state.user, null, 'old sessions not resurrected');
  }
  const history = (await inspect()).history.filter(row => row.note === 'PR96 synthetic Development gate');
  for (const name of ['hide_edit', 'restore_edit', 'suspend_user', 'unsuspend_user']) {
    const audit = history.find(row => row.action === name);
    assert.ok(audit, name + ' audit'); assertions++;
    equal(audit.adminUserId, f.users.admin, 'audit actor');
    equal(audit.reportId, f.reports.edit, 'audit report');
    assert.ok(audit.previousState && audit.newState && audit.createdAt); assertions++;
  }
  const commentHistory = (await inspect(f.reports.comment)).history;
  assert.ok(commentHistory.some(row => row.action === 'hide_comment')); assertions++;
  assert.ok(commentHistory.some(row => row.action === 'restore_comment')); assertions++;
  console.log(JSON.stringify({ result: 'pass', assertions, environment: 'existing Development', providers: 'none' }));
} finally {
  // Restore ONLY these two synthetic targets even if an assertion fails.
  await action(f.reports.edit, 'unsuspend_user');
  await action(f.reports.edit, 'restore_edit');
  await action(f.reports.comment, 'restore_comment');
}