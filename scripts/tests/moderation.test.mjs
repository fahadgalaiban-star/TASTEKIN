import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';
import { emptyVisibility, projectConsumerResponse, isConsumerContentPath } from '../../artifacts/api-server/src/lib/moderation-visibility.ts';

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
const queryLog = [];
const instrumented = new WeakSet();
pool.on('acquire', (client) => {
  if (instrumented.has(client)) return;
  instrumented.add(client);
  const original = client.query.bind(client);
  client.query = (...args) => {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (text) queryLog.push(text);
    if (globalThis.__fixtureVisibilityUnavailable && text?.includes('"moderation_content_states"'))
      throw new Error('Synthetic visibility failure');
    return original(...args);
  };
});
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
  await pool.query("UPDATE users SET role='owner' WHERE id='protected'");
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
        export {createSession,getSession,getSuspendedAccountSession} from './artifacts/api-server/src/lib/auth';
        export {createNativeSession,resolveNativeSession,resolveSuspendedNativeAccount} from './artifacts/api-server/src/lib/native-auth';
        export {authMiddleware} from './artifacts/api-server/src/middlewares/auth-middleware';
        export {default as authRouter} from './artifacts/api-server/src/routes/auth';
        export {default as accountRouter} from './artifacts/api-server/src/routes/account';
        export {getEditContext} from './artifacts/api-server/src/routes/engagement';
        export {configuredFounderMatches,ensureCreatorAccount} from './artifacts/api-server/src/lib/creator-account';
        export {default as moderationActionsRouter} from './artifacts/api-server/src/routes/moderation-actions';
        export {packagedMediaMiddleware} from './artifacts/api-server/src/middlewares/packaged-media-middleware';
        export {suspensionMiddleware,moderationVisibilityMiddleware,staticModerationMiddleware,loadModerationVisibility} from './artifacts/api-server/src/middlewares/moderation-middleware';`,
      resolveDir: resolve('.'),
    },
    bundle: true, write: false, platform: 'node', format: 'esm',
    define: { __dirname: JSON.stringify(dirname(socket)) },
    banner: { js: `import {createRequire as __makeRequire} from 'node:module'; const require=__makeRequire(${JSON.stringify(resolve('lib/db/package.json'))});` },
    plugins: [{
      name: 'only-isolated-db',
      setup(builder) {
        builder.onResolve({ filter: /\/logger$/ }, () => ({ path: 'fixture-logger', namespace: 'fixture-logger' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-logger' }, () => ({
          contents: `export const logger={error(){},warn(){},info(){},debug(){},child(){return this;}};`, loader: 'js',
        }));
        builder.onResolve({ filter: /\/account-deletion$/ }, () => ({ path: 'mock-deletion-only', namespace: 'account-safety' }));
        builder.onLoad({ filter: /.*/, namespace: 'account-safety' }, () => ({
          contents: `export const ACCOUNT_DELETION_CONFIRMATION='DELETE';
            export async function deleteAccount(id){globalThis.__fixtureDeletionUser=id;return {ok:true,mediaCleanup:'complete'};}`,
          loader: 'js',
        }));
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
    WHERE table_schema='public' AND table_name IN ('users','moderation_content_states','moderation_audit_log','creator_workspaces','edit_comments') ORDER BY table_name,column_name`;
  const constraints = `SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) AS definition
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
    WHERE c.relname IN ('users','moderation_content_states','moderation_audit_log','creator_workspaces','edit_comments') ORDER BY c.relname,p.conname`;
  const indexes = `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('users','moderation_content_states','moderation_audit_log','creator_workspaces','edit_comments') ORDER BY tablename,indexname`;
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
  assert.equal((await api.ensureCreatorAccount({ id: 'protected' })).ok, true);
  assert.equal((await pool.query("SELECT role FROM users WHERE id='protected'")).rows[0].role, 'owner');
  await assert.rejects(action(SELF_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(ADMIN_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(PROFILE_REPORT, 'suspend_user'), { status: 403 });
  await assert.rejects(action(PROFILE_REPORT, 'unsuspend_user'), { status: 403 });
  await assert.rejects(action(SELF_REPORT, 'unsuspend_user'), { status: 403 });
  await assert.rejects(action(ADMIN_REPORT, 'unsuspend_user'), { status: 403 });
  assert.equal(api.configuredFounderMatches({ id: 'server-owner', email: null }, { userId: 'server-owner' }), true);
  assert.equal(api.configuredFounderMatches({ id: 'spoofed', email: 'owner@example.invalid' }, { userId: 'server-owner', email: 'owner@example.invalid' }), false);
  assert.equal(api.configuredFounderMatches({ id: 'email-owner', email: 'OWNER@example.invalid' }, { email: 'owner@example.invalid' }), true);
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
  await api.suspensionMiddleware({ user: { id: 'author' }, method: 'POST', path: '/ordinary-write' }, res, () => { continued = true; });
  assert.equal(continued, false); assert.equal(res.statusCode, 403);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM native_sessions')).rows[0].count, 1);
  await action(REPORT, 'unsuspend_user');
  assert.equal(await api.getSession(sid), null);
  assert.equal(await api.resolveNativeSession(native.token), null);
  assert.ok(await api.createNativeSession({ userId: 'author', platform: 'android' }));
});
test('suspension-expired credentials allow only real account-safety routes, with deletion service mocked and no provider access', async () => {
  const express = createRequire(resolve('artifacts/api-server/package.json'))('express');
  const sid = await api.createSession({ user: { id: 'author' }, accessToken: '', expiresAt: Date.now() + 10000 });
  const logoutSid = await api.createSession({ user: { id: 'author' }, accessToken: '', expiresAt: Date.now() + 10000 });
  const native = await api.createNativeSession({ userId: 'author', platform: 'ios' });
  await action(REPORT, 'suspend_user');
  assert.equal(await api.getSession(sid), null);
  assert.equal(await api.resolveNativeSession(native.token), null);
  const app = express();
  app.use(express.json(), (req, _res, next) => { req.cookies = { sid: req.get('x-fixture-cookie') }; req.log = { error() {} }; next(); });
  app.use(api.authMiddleware, api.suspensionMiddleware, api.authRouter, api.accountRouter);
  app.post('/ordinary-write', (req, res) => res.status(req.user ? 200 : 401).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((ready) => server.once('listening', ready));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, headers, body) => fetch(base + path, { headers: { ...headers, 'content-type': 'application/json' },
    method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    for (const credential of [{ 'x-fixture-cookie': sid }, { authorization: `Bearer ${native.token}` }]) {
      const state = await call('/me', credential);
      assert.equal(state.status, 200);
      const payload = await state.json();
      assert.equal(payload.accountSuspended, true); assert.equal(payload.user.id, 'author');
      assert.equal(payload.creator, null); assert.deepEqual(payload.featureFlags, {});
      assert.equal((await call('/ordinary-write', credential, {})).status, 401);
      const missing = await call('/me/delete-account', credential, {});
      assert.equal(missing.status, 400);
      const deleted = await call('/me/delete-account', credential, { confirm: 'DELETE', userId: 'moderator' });
      assert.equal(deleted.status, 200); assert.equal((await deleted.json()).deleted, true);
      assert.equal(globalThis.__fixtureDeletionUser, 'author');
    }
    // Deletion's cookie clearing is real even though physical deletion is mocked.
    assert.equal(await api.getSuspendedAccountSession(sid), null);
    const logout = await call('/auth/native/logout', { authorization: `Bearer ${native.token}` }, {});
    assert.equal(logout.status, 204);
    assert.equal(await api.resolveSuspendedNativeAccount(native.token), null);
    assert.ok(await api.getSuspendedAccountSession(logoutSid));
    const webLogout = await fetch(base + '/logout', { headers: { 'x-fixture-cookie': logoutSid }, redirect: 'manual' });
    assert.equal(webLogout.status, 302);
    assert.ok(webLogout.headers.get('set-cookie')?.includes('sid='));
    assert.equal(await api.getSuspendedAccountSession(logoutSid), null);
    await assert.rejects(api.createSession({ user: { id: 'author' }, accessToken: '', expiresAt: 0 }), { status: 403 });
    await assert.rejects(api.createNativeSession({ userId: 'author', platform: 'ios' }), { status: 403 });
    await action(REPORT, 'unsuspend_user');
    assert.equal(await api.getSession(sid), null); assert.equal(await api.resolveNativeSession(native.token), null);
    assert.equal(await api.resolveSuspendedNativeAccount(native.token), null);
  } finally { await new Promise((done) => server.close(done)); }
});
test('visibility/admin target queries are bounded; partial/B-tree/JSONB indexes are eligible', async () => {
  await action(REPORT, 'suspend_user');
  queryLog.length = 0;
  await api.loadModerationVisibility();
  await api.resolveModerationTarget(apiIsolatedDb(), REPORT);
  await api.resolveModerationTarget(apiIsolatedDb(), COMMENT_REPORT);
  await api.getEditContext('reported-edit');
  const contentQueries = queryLog.filter((q) => /from "(creator_workspaces|edit_comments)"/i.test(q));
  assert.ok(contentQueries.length >= 3);
  for (const q of contentQueries) assert.match(q, /\bwhere\b/i);
  assert.ok(contentQueries.some((q) => /"edits" @> .*::jsonb.*limit/i.test(q)));
  assert.ok(contentQueries.some((q) => /from "edit_comments".*where "edit_comments"."user_id" in/i.test(q)));
  await action(REPORT, 'unsuspend_user');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan=off');
    for (const [query, index] of [
      [`SELECT id FROM users WHERE is_suspended = true`, 'users_suspended_idx'],
      [`SELECT creator_id,target_type,target_id FROM moderation_content_states WHERE is_hidden = true`, 'moderation_content_hidden_idx'],
      [`SELECT creator_id FROM creator_workspaces WHERE edits @> '[{"id":"reported-edit"}]'::jsonb LIMIT 2`, 'creator_workspaces_edits_gin_idx'],
      [`SELECT id FROM edit_comments WHERE user_id='author'`, 'edit_comments_user_idx'],
      [`SELECT * FROM moderation_audit_log WHERE action IS NOT NULL AND target_type='edit' AND target_id='reported-edit' ORDER BY created_at DESC`, 'moderation_audit_target_time_idx'],
    ]) {
      const plan = (await client.query('EXPLAIN ' + query)).rows.map((r) => r['QUERY PLAN']).join('\n');
      assert.ok(plan.includes(index), plan);
    }
  } finally { await client.query('ROLLBACK'); client.release(); }
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
  await pool.query('DROP TRIGGER fail_audit ON moderation_audit_log; DROP FUNCTION reject_review_audit()');
});
function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; return this; }, end() { this.body = ''; return this; },
  };
}
test('consumer routing/guest defaults are projected; private ownership and inspection remain separate', async () => {
  for (const path of ['/feed', '/public-feed', '/creators/author/workspace', '/creators/author/profile', '/creators', '/explore', '/taste-match/author', '/edits/visible/comments', '/edits/visible/engagement', '/circle/feed', '/me/saved-edits', '/me/saved-lists', '/kin/saved', '/kin/trips', '/public-media/author/reported-edit', '/public-profile-media/author']) {
    assert.equal(isConsumerContentPath(path), true, path);
    const req = { path, body: undefined, get: () => 'fixture.invalid', protocol: 'https' };
    const res = response();
    let next = false;
    await api.moderationVisibilityMiddleware(req, res, () => { next = true; });
    if (path.includes('reported-edit')) { assert.equal(res.statusCode, 404); continue; }
    assert.equal(next, true);
  }
  assert.equal(isConsumerContentPath('/admin/reports'), false);
  let privateNext = false;
  await api.moderationVisibilityMiddleware({ path: '/creator-workspace', user: { id: 'author' } }, response(), () => { privateNext = true; });
  assert.equal(privateNext, true);
  const staticRes = response();
  await api.staticModerationMiddleware({ path: '/review-fixture-photo.jpg', protocol: 'https', get: () => 'fixture.invalid' }, staticRes, () => { throw new Error('Hidden asset forwarded'); });
  assert.equal(staticRes.statusCode, 404);
  const v = emptyVisibility(); v.editIds.add('reported-edit'); v.commentIds.add(COMMENT);
  assert.deepEqual(projectConsumerResponse('/edits/visible/comments', [{ id: COMMENT, body: 'Hidden' }, { id: 'visible' }], v), [{ id: 'visible' }]);
  assert.deepEqual(projectConsumerResponse('/kin/saved', { items: [{ id: 'snapshot', answer: 'Copied hidden caption', citations: [{ url: '/api/public-media/author/reported-edit' }] }] }, v), { items: [] });
  const routes = await readFile('artifacts/api-server/src/routes/moderation-actions.ts', 'utf8');
  assert.match(routes, /router\.use\("\/admin\/reports\/:id"/);
  assert.match(routes, /isCurrentUserAdmin\(req\.user\)/);
  assert.match(routes, /resolveModerationTarget\(db, req\.params\.id\)/);
  assert.doesNotMatch(routes, /\.delete\(/);
  const frontend = await readFile('artifacts/tastekin/src/App.tsx', 'utf8');
  assert.doesNotMatch(frontend, /publicFeedEdits\.length\s*\?\s*publicFeedEdits\s*:\s*published/);
  assert.match(frontend, /screen === 'adminReports' && session\.isAdmin/);
});
test('real direct media HTTP: hide/restore, comments, aliases, caches, suspension and admin-only inspection', async () => {
  const express = createRequire(resolve('artifacts/api-server/package.json'))('express');
  const media = dirname(socket) + '/media';
  await mkdir(media);
  const image = Buffer.from('synthetic packaged image bytes');
  for (const name of ['review-fixture-photo.jpg', 'comment-fixture.webp', 'unrelated.webp'])
    await writeFile(media + '/' + name, image);
  const originalWorkspace = (await pool.query("SELECT edits FROM creator_workspaces WHERE creator_id='author-creator'")).rows[0].edits;
  const directWorkspace = originalWorkspace.map((edit) => ({ ...edit, image: '/tastekin-media/review-fixture-photo.jpg' }));
  await pool.query("UPDATE creator_workspaces SET edits=$1 WHERE creator_id='author-creator'", [JSON.stringify(directWorkspace)]);
  const originalComment = (await pool.query('SELECT body FROM edit_comments WHERE id=$1', [COMMENT])).rows[0].body;
  await action(REPORT, 'restore_edit'); await action(COMMENT_REPORT, 'restore_comment');
  await action(REPORT, 'unsuspend_user');
  const app = express();
  app.use((req, _res, next) => {
    // Only synthetic test identities; actual inspection still resolves admin from DB.
    const user = req.get('x-fixture-user');
    if (user) req.user = { id: user };
    next();
  });
  app.use('/tastekin-media', api.packagedMediaMiddleware);
  app.use('/api', api.suspensionMiddleware, api.moderationActionsRouter);
  app.use((_req, res) => res.status(404).end());
  app.use((_err, _req, res, _next) => res.status(500).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((ready) => server.once('listening', ready));
  const base = `http://127.0.0.1:${server.address().port}`;
  const direct = '/tastekin-media/review-fixture-photo.jpg';
  process.env.ALLOWED_ORIGINS = `${base},https://frontend.example.invalid,https://alias.example.invalid`;
  const call = (path, options = {}) => fetch(base + path, options);
  try {
    const before = await call(direct);
    assert.equal(before.status, 200); assert.deepEqual(Buffer.from(await before.arrayBuffer()), image);
    assert.match(before.headers.get('cache-control'), /no-store/);
    assert.equal(before.headers.get('etag'), null); assert.equal(before.headers.get('last-modified'), null);
    assert.equal((await call('/tastekin-media/review%2Dfixture%2Dphoto.jpg')).status, 200);
    await action(REPORT, 'hide_edit');
    for (const url of [direct, direct + '?known=1', '/tastekin-media/review%2Dfixture%2Dphoto.jpg',
      '/TaStEkIn-MeDiA/review-fixture-photo.jpg']) {
      for (const method of ['GET', 'HEAD']) {
        const denied = await call(url, { method, headers: { range: 'bytes=0-3', 'if-none-match': '*', 'if-modified-since': new Date().toUTCString() } });
        assert.equal(denied.status, 404); assert.equal((await denied.arrayBuffer()).byteLength, 0);
        assert.match(denied.headers.get('cache-control'), /no-store/);
      }
    }
    // Being the owner or an administrator never bypasses the public URL.
    for (const user of ['author', 'moderator'])
      assert.equal((await call(direct, { headers: { 'x-fixture-user': user } })).status, 404);
    assert.equal((await call('/tastekin-media/unrelated.webp')).status, 200);
    const inspection = `/api/admin/reports/${REPORT}/inspection/media`;
    for (const user of [undefined, 'author'])
      assert.equal((await call(inspection, { headers: user ? { 'x-fixture-user': user } : {} })).status, 403);
    const inspected = await call(inspection, { headers: { 'x-fixture-user': 'moderator' } });
    assert.equal(inspected.status, 200); assert.deepEqual(Buffer.from(await inspected.arrayBuffer()), image);
    assert.match(inspected.headers.get('cache-control'), /no-store/);
    await action(REPORT, 'restore_edit');
    assert.equal((await call(direct)).status, 200);
    assert.equal((await call(direct, { headers: { range: 'bytes=0-3' } })).status, 206);
    // Comment media is an explicit text link; hiding it must not hide the parent Edit.
    const linkedBody = `Local /tastekin-media/comment-fixture.webp; remote https://external.invalid/tastekin-media/unrelated.webp`;
    await pool.query('UPDATE edit_comments SET body=$1 WHERE id=$2', [linkedBody, COMMENT]);
    await action(COMMENT_REPORT, 'hide_comment');
    assert.equal((await call('/tastekin-media/comment-fixture.webp?known=1')).status, 404);
    assert.equal((await call(direct)).status, 200);
    assert.equal((await call('/tastekin-media/unrelated.webp')).status, 200);
    assert.equal((await pool.query('SELECT body FROM edit_comments WHERE id=$1', [COMMENT])).rows[0].body, linkedBody);
    await action(COMMENT_REPORT, 'restore_comment');
    assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 200);
    await pool.query('UPDATE edit_comments SET body=$1 WHERE id=$2', [base + '/tastekin-media/comment-fixture.webp', COMMENT]);
    await action(COMMENT_REPORT, 'hide_comment');
    assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 404);
    await action(COMMENT_REPORT, 'restore_comment');
    for (const body of ['/tastekin-media/comment-fixture%2Ewebp', '/TASTEKIN-MEDIA/comment-fixture.webp',
      'See /tastekin-media/comment-fixture.webp.',
      'https://frontend.example.invalid/tastekin-media/comment-fixture.webp.']) {
      await pool.query('UPDATE edit_comments SET body=$1 WHERE id=$2', [body, COMMENT]);
      await action(COMMENT_REPORT, 'hide_comment');
      assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 404, body);
      assert.equal((await call('/tastekin-media/comment-fixture.webp', { headers: { host: 'alias.example.invalid' } })).status, 404, body);
      await action(COMMENT_REPORT, 'restore_comment');
      assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 200);
    }
    const absoluteWorkspace = directWorkspace.map((edit) => ({ ...edit, image: 'https://frontend.example.invalid' + direct }));
    await pool.query("UPDATE creator_workspaces SET edits=$1 WHERE creator_id='author-creator'", [JSON.stringify(absoluteWorkspace)]);
    await action(REPORT, 'hide_edit');
    assert.equal((await call(direct)).status, 404, 'backend/proxy origin differs from stored frontend origin');
    assert.equal((await call(direct, { headers: { host: 'alias.example.invalid' } })).status, 404);
    await action(REPORT, 'restore_edit');
    assert.equal((await call(direct)).status, 200);
    await pool.query("UPDATE creator_workspaces SET edits=$1 WHERE creator_id='author-creator'", [JSON.stringify(directWorkspace)]);
    await action(REPORT, 'suspend_user');
    assert.equal((await call(direct)).status, 404);
    assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 404);
    assert.equal((await call('/tastekin-media/unrelated.webp', { headers: { 'x-fixture-user': 'author' } })).status, 200);
    assert.equal((await call(inspection, { headers: { 'x-fixture-user': 'moderator' } })).status, 200);
    await action(REPORT, 'unsuspend_user');
    assert.equal((await call(direct)).status, 200);
    assert.equal((await call('/tastekin-media/comment-fixture.webp')).status, 200);
    for (const path of ['/tastekin-media/missing.webp', '/tastekin-media/%2e%2e%2ffavicon.svg', '/tastekin-media/%ZZ.webp'])
      assert.equal((await call(path)).status, 404);
    assert.equal((await call(direct, { method: 'POST' })).status, 405);
    assert.deepEqual((await pool.query("SELECT edits FROM creator_workspaces WHERE creator_id='author-creator'")).rows[0].edits, directWorkspace);
    // Database visibility failures fail closed even for otherwise-public assets.
    globalThis.__fixtureVisibilityUnavailable = true;
    try {
      const unavailable = await call('/tastekin-media/unrelated.webp');
      assert.equal(unavailable.status, 503); assert.match(unavailable.headers.get('cache-control'), /no-store/);
    } finally { globalThis.__fixtureVisibilityUnavailable = false; }
    assert.deepEqual(await readFile(media + '/review-fixture-photo.jpg'), image);
  } finally {
    delete process.env.ALLOWED_ORIGINS;
    await pool.query("UPDATE creator_workspaces SET edits=$1 WHERE creator_id='author-creator'", [JSON.stringify(originalWorkspace)]);
    await pool.query('UPDATE edit_comments SET body=$1 WHERE id=$2', [originalComment, COMMENT]);
    await new Promise((done) => server.close(done));
  }
});
test('finish: original content, accounts, reports, audits and session rows still exist', async () => {
  for (const table of ['users','creator_workspaces','edit_comments','reports','moderation_audit_log','sessions','native_sessions']) {
    assert.ok((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count > 0, table);
  }
  await pool.end();
});