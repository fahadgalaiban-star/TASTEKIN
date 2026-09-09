import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.join(tmpdir(), "circle-"));
try {
  const output = path.join(tempDir, "circle-policy.mjs");
  await build({ entryPoints: [path.resolve("src/lib/circle-policy.ts")], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const serviceOutput = path.join(tempDir, "circle-service.mjs");
  await build({ entryPoints: [path.resolve("src/lib/circle-service.ts")], outfile: serviceOutput, bundle: true, format: "esm", platform: "node", target: "node22" });
  const { circleAddDecision, circleFeedVisible, sanitizeCircleEdit } = await import(pathToFileURL(output).href);
  const { addCircleMember, createDrizzleCircleRepository, removeCircleMember } = await import(pathToFileURL(serviceOutput).href);
  const candidate = { ownerUserId: "creator-owner", verified: true };
  assert.equal(circleAddDecision("viewer", candidate, false), "allowed");
  assert.equal(circleAddDecision("viewer", { ...candidate, verified: false }, false), "unverified");
  assert.equal(circleAddDecision("creator-owner", candidate, false), "self");
  assert.equal(circleAddDecision("viewer", candidate, true), "not_found");
  assert.equal(circleAddDecision("viewer", null, false), "not_found");
  assert.equal(circleFeedVisible("creator-owner", "viewer", true, true, new Set()), true);
  assert.equal(circleFeedVisible("creator-owner", "other-viewer", true, false, new Set()), false);
  assert.equal(circleFeedVisible("creator-owner", "viewer", false, true, new Set()), false);
  assert.equal(circleFeedVisible("creator-owner", "viewer", true, true, new Set(["creator-owner"])), false);
  assert.equal(circleFeedVisible("viewer", "viewer", true, true, new Set()), false);
  const publicEdit = sanitizeCircleEdit({ id: "one", access: "public", image: "/objects/uploads/x", sourceImage: "/private/source" }, "noura");
  assert.equal(publicEdit.sourceImage, undefined);
  const locked = sanitizeCircleEdit({ id: "two", access: "locked", previewImage: "/objects/uploads/y", sourceImage: "/private/source" }, "noura");
  assert.equal(locked.image, "/api/public-media/noura/two/preview");
  assert.equal(locked.sourceImage, undefined);
  assert.equal(sanitizeCircleEdit({ id: "three", access: "locked", sourceImage: "/private/source" }, "noura"), null);
  const memberships = new Set(), follows = new Set();
  const fake = {
    insertMembership: async (owner, creator) => memberships.add(`${owner}:${creator}`),
    insertFollow: async (owner, creator) => follows.add(`${owner}:${creator}`),
    deleteMembership: async (owner, creator) => memberships.delete(`${owner}:${creator}`),
  };
  await addCircleMember(fake, "owner-a", "creator-a");
  await addCircleMember(fake, "owner-a", "creator-a");
  assert.deepEqual([...memberships], ["owner-a:creator-a"]);
  assert.deepEqual([...follows], ["owner-a:creator-a"]);
  await removeCircleMember(fake, "owner-a", "creator-a");
  assert.equal(memberships.size, 0);
  assert.equal(follows.has("owner-a:creator-a"), true);
  const calls = [];
  const tableNames = new Map();
  const recordingDb = {
    insert: (table) => ({
      values: (value) => ({
      onConflictDoNothing: async () => { calls.push({ op: "insert", table: tableNames.get(table), value, conflictSafe: true }); },
      }),
    }),
    delete: (table) => ({ where: async () => { calls.push({ op: "delete", table: tableNames.get(table) }); } }),
    transaction: async (work) => { calls.push({ op: "transaction" }); return work(recordingDb); },
  };
  const membershipsTable = { ownerUserId: Symbol("owner"), creatorId: Symbol("creator") };
  const followsTable = Symbol("creator_follows");
  tableNames.set(membershipsTable, "my_circle_memberships");
  tableNames.set(followsTable, "creator_follows");
  const drizzleRepo = createDrizzleCircleRepository(recordingDb, { memberships: membershipsTable, follows: followsTable });
  await addCircleMember(drizzleRepo, "owner-b", "creator-b");
  await addCircleMember(drizzleRepo, "owner-b", "creator-b");
  await removeCircleMember(drizzleRepo, "owner-b", "creator-b");
  assert.equal(calls.filter((call) => call.op === "transaction").length, 2);
  assert.equal(calls.filter((call) => call.op === "insert" && call.conflictSafe).length, 4);
  assert.deepEqual(calls.filter((call) => call.op === "insert").map((call) => call.value), [
    { ownerUserId: "owner-b", creatorId: "creator-b" },
    { followerUserId: "owner-b", creatorId: "creator-b" },
    { ownerUserId: "owner-b", creatorId: "creator-b" },
    { followerUserId: "owner-b", creatorId: "creator-b" },
  ]);
  assert.equal(calls.filter((call) => call.op === "delete").length, 1);
  assert.equal(calls.find((call) => call.op === "delete").table, "my_circle_memberships");
  console.log("Circle authorization and locked-media policy tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}