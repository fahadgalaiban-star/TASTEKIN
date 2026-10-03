import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';
import { emptyVisibility, redactPublic, isConsumerContentPath } from '../../artifacts/api-server/src/lib/moderation-visibility.ts';

// Fail before importing ANY DB-backed application code. Never accept a database URL.
assert.equal(process.env.DATABASE_URL, undefined);
assert.equal(process.env.PROD_DB_URL, undefined);
const socket = process.env.MODERATION_TEST_SOCKET_DIR;
assert.match(socket ?? '', /^\/tmp\/tastekin-moderation-review\.[A-Za-z0-9]+\/socket$/);
assert.equal(await realpath(socket), socket);
const requireDb = createRequire(resolve('lib/db/package.json'));
const { Pool } = requireDb('pg');
const database = process.env.MODERATION_TEST_DB_NAME;
assert.match(database ?? '', /^moderation_review_[a-z0-9]+$/);
const pool = new Pool({ host: socket, port: 55439, database, user: userInfo().username, connectionTimeoutMillis: 3000, max: 4 });
const verified = await pool.query("SELECT inet_server_addr() IS NULL AS local, current_setting('data_directory') AS dir, current_setting('listen_addresses') AS listen");
assert.equal(verified.rows[0].local, true);
assert.equal(verified.rows[0].listen, '');
assert.equal(verified.rows[0].dir, dirname(socket) + '/cluster');
globalThis.__moderationIsolatedPool = pool;
const frontendRequire = createRequire(resolve('artifacts/tastekin/package.json'));
const { build } = createRequire(frontendRequire.resolve('vite/package.json'))('esbuild');
let api;
const REPORT = '00000000-0000-4000-8000-000000000010';
const COMMENT = '00000000-0000-4000-8000-000000000011';
const COMMENT_REPORT = '00000000-0000-4000-8000-000000000012';
const PROFILE_REPORT = '00000000-0000-4000-8000-000000000013';
const SELF_REPORT = '00000000-0000-4000-8000-000000000014';
const ADMIN_REPORT = '00000000-0000-4000-8000-000000000015';

test('approved migration is additive, preserves legacy rows and defaults old/new users to active', async () => {
  await pool.query(`INSERT INTO users(id,is_admin) VALUES ('moderator',true),('author',false),('protected',false),('other-admin',true);
    INSERT INTO creator_workspaces(creator_id,owner_user_id,edits,collections,profile) VALUES
      ('author-creator','author','[{"id":"reported-edit","title":"Original","image":"/objects/uploads/00000000-0000-4000-8000-000000000099","sourceImage":"/tastekin-media/review-fixture-photo.jpg","status":"published"}]','[]','{"username":"author","displayName":"Author"}'),
      ('moderator-creator','moderator','[]','[]','{"username":"mod"}'),
      ('fheed','protected','[]','[]','{"username":"fheed"}'),
      ('admin-creator','other-admin','[]','[]','{"username":"admin"}');
    INSERT INTO edit_comments(id,edit_id,user_id,body) VALUES ('${COMMENT}','reported-edit','author','Original comment');
    INSERT INTO reports(id,reporter_user_id,target_type,target_id,reason) VALUES
      ('${REPORT}','moderator','edit','reported-edit','spam'),
      ('${COMMENT_REPORT}','moderator','comment','${COMMENT}','spam'),
      ('${PROFILE_REPORT}','moderator','profile','fheed','spam'),
      ('${SELF_REPORT}','author','profile','moderator-creator','spam'),
      ('${ADMIN_REPORT}','author','profile','admin-creator','spam');
    INSERT INTO moderation_audit_log(report_id,admin_user_id,from_status,to_status)
      VALUES ('${REPORT}','moderator','pending','under_review');`);
  const sql = await readFile('lib/db/migrations/0023_moderation_actions.sql', 'utf8');
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  await pool.query(sql);
  assert.deepEqual((await pool.query('SELECT DISTINCT is_suspended FROM users')).rows, [{ is_suspended: false }]);
  assert.equal((await pool.query('SELECT action FROM moderation_audit_log')).rows[0].action, null);
  await pool.query("INSERT INTO users(id) VALUES ('new-user')");
  assert.equal((await pool.query("SELECT is_suspended FROM users WHERE id='new-user'")).rows[0].is_suspended, false);
  const generated = await build({
    stdin: {
      contents: `export {applyModeration} from './artifacts/api-server/src/lib/moderation-policy';
        export {moderationRepository,resolveModerationTarget} from './artifacts/api-server/src/lib/moderation-repository';
        export {createSession,getSession} from './artifacts/api-server/src/lib/auth';
        export {createNativeSession,resolveNativeSession} from './artifacts/api-server/src/lib/native-auth';
        export {default as moderationActionsRouter} from './artifacts/api-server/src/routes/moderation-actions';
        export {suspensionMiddleware,moderationVisibilityMiddleware,staticModerationMiddleware} from './artifacts/api-server/src/middlewares/moderation-middleware';`,
      resolveDir: resolve('.'),
    },
    bundle: true, write: false, platform: 'node', format: 'esm',
    banner: { js: `import {createRequire as __makeRequire} from 'node:module'; const require=__makeRequire(${JSON.stringify(resolve('lib/db/package.json'))});` },
    plugins: [{
      name: 'only-isolated-db',
      setup(builder) {
        builder.onResolve({ filter: /private-media-storage$/ }, () => ({ path: 'no-provider-access', namespace: 'provider' }));
        builder.onLoad({ filter: /.*/, namespace: 'provider' }, () => ({
          contents: `export async function getPrivateMediaDownloadURL(){throw new Error('Provider access forbidden in isolated tests');}
            export function isPrivateMediaPath(){return false;}`,
          loader: 'js',
        }));
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: 'isolated-db', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import {drizzle} from 'drizzle-orm/node-postgres';
            import * as schema from '${resolve('lib/db/src/schema/index.ts')}';
            export * from '${resolve('lib/db/src/schema/index.ts')}';
            export const db=drizzle(globalThis.__moderationIsolatedPool,{schema});
            globalThis.__moderationInspectionDb=db;`,
          loader: 'ts', resolveDir: resolve('lib/db'),
        }));
        builder.onResolve({ filter: /^pg$/ }, () => ({ path: requireDb.resolve('pg'), external: true }));
      },
    }],
  });
  const modulePath = dirname(socket) + '/isolated-app.mjs';
  await writeFile(modulePath, generated.outputFiles[0].text);
  api = await import(pathToFileURL(modulePath).href);
});

const action = (report, name, actor = 'moderator') => api.applyModeration(api.moderationRepository, actor, report, { action: name, reason: 'Reviewed report', confirmed: true });
test('migration, journal and current Drizzle schema have matching columns, defaults, constraints and indexes', async () => {
  const journal = JSON.parse(await readFile('lib/db/migrations/meta/_journal.json', 'utf8'));
  assert.equal(journal.entries.at(-1).tag, '0023_moderation_actions');
  assert.equal(journal.entries.at(-1).idx, 23);
  await pool.query('CREATE DATABASE moderation_review_current');
  const expected = new Pool({ host: socket, port: 55439, database: 'moderation_review_current', user: userInfo().username, max: 1 });
  const columns = `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('users','moderation_content_states','moderation_audit_log') ORDER BY table_name,column_name`;
  const constraints = `SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) AS definition
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
    WHERE c.relname IN ('users','moderation_content_states','moderation_audit_log') ORDER BY c.relname,p.conname`;
  const indexes = `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('users','moderation_content_states','moderation_audit_log') ORDER BY tablename,indexname`;
  try {
    await expected.query(await readFile(dirname(socket) + '/current.sql', 'utf8'));
    for (const query of [columns, constraints, indexes]) assert.deepEqual((await pool.query(query)).rows, (await expected.query(query)).rows);
  } finally { await expected.end(); }
});
test('non-admin, missing confirmation and blank reasons are rejected without state or audit', async () => {
  await assert.rejects(action(REPORT, 'hide_edit', 'author'), { status: 403 });
  for (const input of [{ action: 'hide_edit', reason: 'yes' }, { action: 'hide_edit', reason: ' ', confirmed: true }]) {
    await assert.rejects(api.applyModeration(api.moderationRepository, 'moderator', REPORT, input), { status: 400 });
  }
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM moderation_content_states')).rows[0].count, 0);
});
test('self, administrator and owner suspension/unsuspension are prohibited', async () => {
  await assert.rejects(action(SELF_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(ADMIN_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(PROFILE_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(PROFILE_REPORT, 'unsuspend_user'), { status: 403 });
});
test('hide/restore Edits and comments are reversible overlays with complete audits, preserving originals', async () => {
  for (const [report, hide, restore] of [[REPORT, 'hide_edit', 'restore_edit'], [COMMENT_REPORT, 'hide_comment', 'restore_comment']]) {
    const hidden = await action(report, hide);
    assert.equal(hidden.hidden, true);
    assert.equal((await api.resolveModerationTarget(apiIsolatedDb(), report)).hidden, true);
    const restored = await action(report, restore);
    assert.equal(restored.hidden, false);
    for (const result of [hidden, restored]) {
      assert.equal(result.audit.adminUserId, 'moderator');
      assert.equal(result.audit.note, 'Reviewed report');
      assert.ok(result.audit.targetId && result.audit.targetType && result.audit.createdAt);
      assert.equal(result.audit.previousState.creatorId, 'author-creator');
      assert.equal(typeof result.audit.previousState.hidden, 'boolean');
      assert.equal(result.audit.newState.hidden, result.hidden);
    }
  }
  assert.equal((await pool.query("SELECT edits->0->>'title' AS title FROM creator_workspaces WHERE creator_id='author-creator'")).rows[0].title, 'Original');
  assert.equal((await pool.query(`SELECT body FROM edit_comments WHERE id='${COMMENT}'`)).rows[0].body, 'Original comment');
});
// Resolve through a fresh repository transaction so inspection never relies on public visibility.
function apiIsolatedDb() { return globalThis.__moderationInspectionDb; }
test('actual HTTP action/inspection/media routes authorize admins, inspect hidden originals, and reject forged target IDs', async () => {
  const express = createRequire(resolve('artifacts/api-server/package.json'))('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = req.get('x-fixture-actor') ? { id: req.get('x-fixture-actor') } : undefined; next(); });
  app.use(api.suspensionMiddleware, api.moderationVisibilityMiddleware, api.moderationActionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((ready) => server.once('listening', ready));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const suffix of ['/inspection', '/inspection/media', '/actions']) {
      const rejected = await fetch(`${base}/admin/reports/${REPORT}${suffix}`, {
        method: suffix === '/actions' ? 'POST' : 'GET', headers: { 'x-fixture-actor': 'author', 'content-type': 'application/json' },
        ...(suffix === '/actions' ? { body: JSON.stringify({ action: 'hide_edit', reason: 'test', confirmed: true }) } : {}),
      });
      assert.equal(rejected.status, 403);
    }
    const hidden = await fetch(`${base}/admin/reports/${REPORT}/actions`, {
      method: 'POST', headers: { 'x-fixture-actor': 'moderator', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'hide_edit', reason: 'HTTP review', confirmed: true, targetId: 'visible', ownerUserId: 'moderator' }),
    });
    assert.equal(hidden.status, 200);
    assert.equal((await hidden.json()).audit.targetId, 'reported-edit');
    const inspected = await fetch(`${base}/admin/reports/${REPORT}/inspection`, { headers: { 'x-fixture-actor': 'moderator' } });
    assert.equal(inspected.status, 200); assert.match(inspected.headers.get('cache-control'), /no-store/);
    const detail = await inspected.json();
    assert.equal(detail.target.hidden, true); assert.equal(detail.target.data.title, 'Original');
    assert.ok(detail.history.some((row) => row.action === 'hide_edit'));
    await action(REPORT, 'restore_edit');
  } finally { await new Promise((done) => server.close(done)); }
});
test('audit constraints reject incomplete/mismatched actions while preserving legacy entries', async () => {
  await assert.rejects(pool.query(`INSERT INTO moderation_audit_log(report_id,admin_user_id,from_status,to_status,action) VALUES ('${REPORT}','moderator','pending','pending','hide_edit')`));
  await assert.rejects(pool.query(`INSERT INTO moderation_content_states(target_type,creator_id,target_id) VALUES ('profile','author-creator','x')`));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM moderation_audit_log WHERE action IS NULL')).rows[0].count, 1);
});
test('suspension expires web sessions, soft-revokes native sessions, blocks new sessions and mutations', async () => {
  const sid = await api.createSession({ user: { id: 'author' }, accessToken: 'isolated-fixture', expiresAt: Date.now() + 10000 });
  const native = await api.createNativeSession({ userId: 'author', platform: 'ios' });
  assert.ok(await api.getSession(sid));
  assert.ok(await api.resolveNativeSession(native.token));
  await action(REPORT, 'suspend_user');
  assert.equal(await api.getSession(sid), null);
  assert.equal(await api.resolveNativeSession(native.token), null);
  await assert.rejects(api.createSession({ user: { id: 'author' }, accessToken: '', expiresAt: 0 }), { status: 403 });
  await assert.rejects(api.createNativeSession({ userId: 'author', platform: 'ios' }), { status: 403 });
  const res = response();
  let continued = false;
  await api.suspensionMiddleware({ user: { id: 'author' }, method: 'POST' }, res, () => { continued = true; });
  assert.equal(continued, false); assert.equal(res.statusCode, 403);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM native_sessions')).rows[0].count, 1);
  await action(REPORT, 'unsuspend_user');
  assert.equal(await api.getSession(sid), null);
  assert.equal(await api.resolveNativeSession(native.token), null);
  assert.ok(await api.createNativeSession({ userId: 'author', platform: 'android' }));
});
test('conflicting actions serialize, every committed change is audited, failed audit rolls back state', async () => {
  const before = (await pool.query('SELECT count(*)::int AS count FROM moderation_audit_log')).rows[0].count;
  const results = await Promise.all([action(REPORT, 'hide_edit'), action(REPORT, 'restore_edit'), action(REPORT, 'hide_edit')]);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM moderation_audit_log')).rows[0].count, before + 3);
  const ordered = (await pool.query("SELECT previous_state,new_state FROM moderation_audit_log WHERE action IS NOT NULL ORDER BY created_at DESC LIMIT 3")).rows.reverse();
  assert.equal(ordered[1].previous_state.hidden, ordered[0].new_state.hidden);
  assert.equal(ordered[2].previous_state.hidden, ordered[1].new_state.hidden);
  await pool.query(`CREATE FUNCTION reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit failure'; END $$;
    CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_audit_log FOR EACH ROW EXECUTE FUNCTION reject_review_audit();`);
  await assert.rejects(action(REPORT, 'restore_edit'));
  assert.equal((await pool.query("SELECT is_hidden FROM moderation_content_states WHERE target_type='edit'")).rows[0].is_hidden, true);
  const sid = await api.createSession({ user: { id: 'author' }, accessToken: 'isolated-rollback-fixture', expiresAt: Date.now() + 10000 });
  const activeBefore = (await pool.query("SELECT count(*)::int AS count FROM native_sessions WHERE revoked_at IS NULL")).rows[0].count;
  await assert.rejects(action(REPORT, 'suspend_user'));
  assert.equal((await pool.query("SELECT is_suspended FROM users WHERE id='author'")).rows[0].is_suspended, false);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM native_sessions WHERE revoked_at IS NULL")).rows[0].count, activeBefore);
  assert.ok(await api.getSession(sid), 'Failed audit must roll back web-session expiration too');
});
function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; return this; }, end() { this.body = ''; return this; },
  };
}
test('every consumer read family uses the visibility boundary, including static catalog, saved IDs, KIN and media', async () => {
  for (const path of ['/feed', '/public-feed', '/creators/author/workspace', '/creators/author/profile', '/creators', '/explore', '/taste-match/author', '/edits/visible/comments', '/edits/visible/engagement', '/circle/feed', '/me/saved-edits', '/me/saved-lists', '/kin/saved', '/kin/trips', '/public-media/author/reported-edit', '/public-profile-media/author']) {
    assert.equal(isConsumerContentPath(path), true, path);
    const req = { path, body: undefined };
    const res = response();
    let next = false;
    await api.moderationVisibilityMiddleware(req, res, () => { next = true; });
    if (path.includes('reported-edit')) { assert.equal(res.statusCode, 404); continue; }
    assert.equal(next, true);
    res.json({ edits: [{ id: 'reported-edit', caption: 'Original' }, { id: 'visible' }], editIds: ['reported-edit', 'visible'] });
    assert.deepEqual(res.body.edits, [{ id: 'visible' }]);
    assert.deepEqual(res.body.editIds, ['visible']);
    res.json({ items: [{ creatorUsername: 'author', edit: { id: 'reported-edit' } }, { creatorUsername: 'author', edit: { id: 'visible' } }] });
    assert.deepEqual(res.body.items, [{ creatorUsername: 'author', edit: { id: 'visible' } }]);
  }
  assert.equal(isConsumerContentPath('/admin/reports'), false);
  assert.equal(isConsumerContentPath('/creator-workspace'), false);
  const staticRes = response();
  await api.staticModerationMiddleware({ path: '/review-fixture-photo.jpg' }, staticRes, () => { throw new Error('Hidden asset forwarded'); });
  assert.equal(staticRes.statusCode, 404);
  const v = emptyVisibility(); v.editIds.add('reported-edit'); v.commentIds.add(COMMENT);
  assert.deepEqual(redactPublic([{ id: COMMENT, body: 'Hidden' }, { id: 'visible' }], v), [{ id: 'visible' }]);
  assert.deepEqual(redactPublic([{ id: 'snapshot', answer: 'Copied hidden caption', citations: ['/api/public-media/author/reported-edit'] }], v), []);
  const routes = await readFile('artifacts/api-server/src/routes/moderation-actions.ts', 'utf8');
  assert.match(routes, /router\.use\("\/admin\/reports\/:id"/);
  assert.match(routes, /isCurrentUserAdmin\(req\.user\)/);
  assert.match(routes, /resolveModerationTarget\(db, req\.params\.id\)/);
  assert.doesNotMatch(routes, /\.delete\(/);
  const frontend = await readFile('artifacts/tastekin/src/App.tsx', 'utf8');
  assert.doesNotMatch(frontend, /publicFeedEdits\.length\s*\?\s*publicFeedEdits\s*:\s*published/);
  assert.match(frontend, /screen === 'adminReports' && session\.isAdmin/);
});
test('finish: original content, accounts, reports, audits and session rows still exist', async () => {
  for (const table of ['users','creator_workspaces','edit_comments','reports','moderation_audit_log','sessions','native_sessions']) {
    assert.ok((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count > 0, table);
  }
  await pool.end();
});