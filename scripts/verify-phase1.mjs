import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [account, workspace, storage, verification, app, migration] = await Promise.all([
  read("artifacts/api-server/src/lib/creator-account.ts"),
  read("artifacts/api-server/src/routes/creator-workspace.ts"),
  read("artifacts/api-server/src/routes/storage.ts"),
  read("artifacts/api-server/src/routes/verification.ts"),
  read("artifacts/tastekin/src/App.tsx"),
  read("lib/db/migrations/0006_multi_creator_foundation.sql"),
]);

assert.match(account, /creatorForUser\(user\.id\)/, "account provisioning must resolve by authenticated user");
assert.match(account, /creator_[^`]*crypto\.createHash/, "new creators need immutable non-username IDs");
assert.match(account, /FOUNDER_AUTH_USER_ID/, "founder workspace claim must use an explicit immutable mapping");
assert.match(migration, /owner_user_id_unique/, "one workspace per account must be enforced by PostgreSQL");
assert.match(migration, /profile_username_unique/, "public usernames must be unique");
assert.match(workspace, /upload\.creatorId !== workspaceId/, "workspace saves must reject another creator's media");
assert.match(workspace, /tastekin-edit-identifiers/, "Edit identifiers must be globally collision-protected");
assert.match(workspace, /parsed\.data\.collections\.some\(\(collection\) => collection\.access === "locked"\)/, "unverified creators must not lock collections");
assert.match(storage, /referencedPaths\(workspace\)\.has\(objectPath\)/, "private object reads must be scoped to the owner workspace");
assert.match(verification, /isCurrentUserAdmin\(req\.user\)/, "verification approval must require a database-backed admin check");
assert.match(account, /db\.select\(\{ isAdmin: usersTable\.isAdmin \}\)/, "admin status must be read from Postgres, not from env or session state");
assert.match(verification, /must submit a Taste Seal application before review/, "verification must require a creator application");
assert.match(app, /Apply for the Taste Seal/, "unverified creators need an application entry point");
assert.match(app, /No payment or access is being simulated/, "Phase 1 must not create fake paid entitlements");
assert.doesNotMatch(app, /localStorage\.setItem\(`tastekin:(saved|following|subscribed)/, "account state must not be stored in localStorage");

console.log("Phase 1 foundation invariants: passed");
