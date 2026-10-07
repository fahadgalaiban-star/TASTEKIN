import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { pool } from "@workspace/db";
import { commitAccountDeletion, deleteAccount } from "../src/lib/account-deletion";
import { runAccountMediaCleanup } from "../src/lib/account-media-cleanup";
import type { AccountMediaProviders } from "../src/lib/account-media-providers";
import { accountMediaProviders } from "../src/lib/account-media-providers";
import { finalizeCancelFailed } from "../src/lib/video-upload-lifecycle";
import { reclaimStaleCreatingRows } from "../src/lib/video-upload-recovery";

const root = process.env.ACCOUNT_MEDIA_TEST_ROOT;
assert.match(root ?? "", /^\/tmp\/tastekin-account-media\.[A-Za-z0-9]+$/);
const safety = await pool.query("SELECT inet_server_addr() IS NULL AS local, current_setting('data_directory') AS dir, current_setting('listen_addresses') AS listens");
assert.deepEqual(safety.rows[0], { local: true, dir: `${root}/cluster`, listens: "" });
// No network request is allowed, even if an injected provider is accidentally
// bypassed. Every test below uses in-memory provider mocks.
globalThis.fetch = async () => { throw new Error("Unexpected network access in account-media test"); };
const log = { error() {} };
const ok: AccountMediaProviders = {
  deleteCreatorPhoto: async () => {},
  deleteClosetPhoto: async () => {},
  deleteVideo: async () => ({ status: "ok" }),
  findVideo: async () => ({ status: "found", videoId: randomUUID() }),
};
const failed: AccountMediaProviders = {
  deleteCreatorPhoto: async () => { throw new Error("mock photo provider failed"); },
  deleteClosetPhoto: async () => { throw new Error("mock closet provider failed"); },
  deleteVideo: async () => ({ status: "unavailable", reason: "mock failure" }),
  findVideo: async () => ({ status: "unavailable", reason: "mock lookup failed" }),
};
beforeEach(async () => {
  await pool.query("TRUNCATE users, creator_workspaces, creator_media_uploads, closet_media_uploads, video_uploads CASCADE");
});
after(async () => { await pool.end(); });

async function fixture(options: { legacy?: boolean; videoState?: string; videoId?: boolean; closetState?: string } = {}) {
  const owner = randomUUID(), creator = randomUUID(), photo = `/objects/uploads/${randomUUID()}`;
  const closet = randomUUID(), closetKey = `/objects/closet/${randomUUID()}`, video = randomUUID();
  await pool.query("INSERT INTO users(id) VALUES($1)", [owner]);
  await pool.query("INSERT INTO creator_workspaces(creator_id,owner_user_id,edits,collections,profile) VALUES($1,$2,$3,'[]',$4)", [
    creator, owner, JSON.stringify([{ id: randomUUID(), sourceImage: photo, image: photo }]),
    JSON.stringify({ username: `fixture-${owner}`, avatar: photo, coverImage: photo }),
  ]);
  if (!options.legacy) await pool.query("INSERT INTO creator_media_uploads(object_path,creator_id,owner_user_id,state) VALUES($1,$2,$3,'committed')", [photo, creator, owner]);
  await pool.query("INSERT INTO closet_media_uploads(id,owner_user_id,image_object_key,state) VALUES($1,$2,$3,$4)", [closet, owner, closetKey, options.closetState ?? "attached"]);
  await pool.query("INSERT INTO video_uploads(id,creator_id,owner_user_id,bunny_library_id,bunny_video_id,state) VALUES($1,$2,$3,'mock-library',$4,$5)", [
    video, creator, owner, options.videoId === false ? null : randomUUID(), options.videoState ?? "ready",
  ]);
  return { owner, creator, photo, closet, video };
}
async function age() {
  await pool.query("UPDATE creator_media_uploads SET updated_at=now()-interval '1 day'");
  await pool.query("UPDATE closet_media_uploads SET updated_at=now()-interval '1 day',last_attempt_at=now()-interval '1 day',cleanup_lease_until=now()-interval '1 day'");
  await pool.query("UPDATE video_uploads SET updated_at=now()-interval '1 day',last_attempt_at=now()-interval '1 day',recovery_lease_until=now()-interval '1 day'");
}
async function states() {
  return {
    photos: (await pool.query("SELECT state FROM creator_media_uploads")).rows.map(r => r.state),
    closet: (await pool.query("SELECT state FROM closet_media_uploads")).rows.map(r => r.state),
    videos: (await pool.query("SELECT state FROM video_uploads")).rows.map(r => r.state),
  };
}
test("provider failures commit account deletion and all media remains retryable", async () => {
  const f = await fixture();
  const result = await deleteAccount(f.owner, log, failed);
  assert.ok(result.ok);
  assert.equal(result.mediaCleanup, "pending");
  assert.equal((await pool.query("SELECT * FROM users")).rowCount, 0);
  assert.deepEqual(await states(), { photos: ["delete_failed"], closet: ["delete_failed"], videos: ["delete_failed"] });
  await age();
  const recovered = await runAccountMediaCleanup({ apply: true }, ok);
  assert.equal(recovered.deleted, 3);
  assert.deepEqual(await states(), { photos: ["deleted"], closet: ["deleted"], videos: ["deleted"] });
});
test("legacy photo is durable across a crash immediately after commit", async () => {
  const f = await fixture({ legacy: true });
  const committed = await commitAccountDeletion(f.owner);
  assert.ok(committed.ok);
  assert.deepEqual(await states(), { photos: ["deleting"], closet: ["deletion_pending"], videos: ["deletion_pending"] });
  await age();
  assert.equal((await runAccountMediaCleanup({ apply: true }, ok)).deleted, 3);
});
test("already-pending media does not produce none or completed", async () => {
  const f = await fixture({ closetState: "cleanup_in_progress", videoState: "deletion_pending" });
  const result = await deleteAccount(f.owner, log, ok);
  assert.ok(result.ok);
  assert.equal(result.mediaCleanup, "pending");
});
test("successful immediate cleanup reports completed", async () => {
  const f = await fixture();
  const result = await deleteAccount(f.owner, log, ok);
  assert.ok(result.ok);
  assert.equal(result.mediaCleanup, "completed");
});
test("an account without media reports none", async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id) VALUES($1)", [id]);
  const result = await deleteAccount(id, log, ok);
  assert.ok(result.ok);
  assert.equal(result.mediaCleanup, "none");
});
test("dry run makes no provider calls or ledger changes", async () => {
  const f = await fixture();
  await commitAccountDeletion(f.owner); await age();
  const before = await states();
  const never = new Proxy(ok, { get() { return () => { throw new Error("dry run called provider"); }; } });
  const result = await runAccountMediaCleanup({}, never);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.eligible, { creator: 1, closet: 1, video: 1 });
  assert.deepEqual(await states(), before);
});
test("live account and surviving creator workspace media are never claimed", async () => {
  const f = await fixture();
  await pool.query("UPDATE creator_media_uploads SET state='delete_failed'");
  await pool.query("UPDATE closet_media_uploads SET state='delete_failed'");
  await pool.query("UPDATE video_uploads SET state='delete_failed'");
  await age();
  assert.equal((await runAccountMediaCleanup({ apply: true }, ok)).deleted, 0);
  await pool.query("DELETE FROM users WHERE id=$1", [f.owner]);
  // Workspace still exists: creator photos remain protected.
  const result = await runAccountMediaCleanup({ apply: true }, ok);
  assert.equal(result.eligible.creator, 0);
  assert.deepEqual((await states()).photos, ["delete_failed"]);
});
test("ownerless closet and video failures respect backoff, without abandoning high retry counts", async () => {
  const f = await fixture();
  await deleteAccount(f.owner, log, failed);
  let result = await runAccountMediaCleanup({ apply: true }, ok);
  assert.equal(result.deleted, 0);
  await pool.query("UPDATE closet_media_uploads SET retry_count=20");
  await pool.query("UPDATE video_uploads SET retry_count=20");
  await age();
  result = await runAccountMediaCleanup({ apply: true }, ok);
  assert.equal(result.deleted, 3);
});
test("in-flight and ambiguous videos are recovered only for deletion, never adopted", async () => {
  for (const state of ["creating", "create_ambiguous"]) {
    const f = await fixture({ videoState: state, videoId: false });
    const result = await deleteAccount(f.owner, log, ok);
    assert.ok(result.ok);
    assert.equal(result.mediaCleanup, "pending");
    assert.equal((await pool.query("SELECT state FROM video_uploads WHERE id=$1", [f.video])).rows[0].state, "orphan_cleanup_pending");
    await age();
    assert.equal((await runAccountMediaCleanup({ apply: true }, ok)).deleted, 1);
  }
});
test("inconclusive video lookup remains durably pending", async () => {
  const f = await fixture({ videoState: "creating", videoId: false });
  await commitAccountDeletion(f.owner); await age();
  await runAccountMediaCleanup({ apply: true }, failed);
  const row = (await pool.query("SELECT state,retry_count,bunny_video_id FROM video_uploads WHERE id=$1", [f.video])).rows[0];
  assert.equal(row.state, "orphan_cleanup_pending"); assert.equal(row.retry_count, 1); assert.equal(row.bunny_video_id, null);
});
test("generic stale-create recovery does not adopt a deleted account's video", async () => {
  const f = await fixture({ videoState: "creating", videoId: false });
  await pool.query("DELETE FROM users WHERE id=$1", [f.owner]);
  await pool.query("UPDATE video_uploads SET created_at=now()-interval '1 day'");
  await reclaimStaleCreatingRows();
  assert.equal((await pool.query("SELECT state FROM video_uploads WHERE id=$1", [f.video])).rows[0].state, "orphan_cleanup_pending");
});
test("parallel workers do not claim the same provider deletion", async () => {
  const f = await fixture(); await commitAccountDeletion(f.owner); await age();
  const calls: string[] = [];
  const counting: AccountMediaProviders = {
    ...ok,
    deleteCreatorPhoto: async key => { calls.push(key); await new Promise(resolve => setTimeout(resolve, 30)); },
    deleteClosetPhoto: async key => { calls.push(key); },
    deleteVideo: async id => { calls.push(id); return { status: "ok" }; },
  };
  await Promise.all([runAccountMediaCleanup({ apply: true }, counting), runAccountMediaCleanup({ apply: true }, counting)]);
  assert.equal(calls.length, 3); assert.equal(new Set(calls).size, 3);
});
test("expired claims are recovered, stale results cannot overwrite a newer claim", async () => {
  const f = await fixture(); await commitAccountDeletion(f.owner); await age();
  const stale: AccountMediaProviders = {
    ...ok,
    deleteCreatorPhoto: async () => {
      await pool.query("UPDATE creator_media_uploads SET updated_at=now()-interval '1 day'");
      await runAccountMediaCleanup({ apply: true }, ok);
      throw new Error("stale provider failure");
    },
  };
  await runAccountMediaCleanup({ apply: true }, stale);
  assert.deepEqual(await states(), { photos: ["deleted"], closet: ["deleted"], videos: ["deleted"] });
});
test("late request-time video failure cannot overwrite a worker's lease", async () => {
  const f = await fixture(); await commitAccountDeletion(f.owner); await age();
  const providers: AccountMediaProviders = {
    ...ok, deleteVideo: async () => {
      await finalizeCancelFailed(f.video, f.owner, "late request failure");
      const row = (await pool.query("SELECT state FROM video_uploads WHERE id=$1", [f.video])).rows[0];
      assert.equal(row.state, "deletion_pending");
      return { status: "ok" };
    },
  };
  await runAccountMediaCleanup({ apply: true }, providers);
  assert.deepEqual((await states()).videos, ["deleted"]);
});
test("provider success followed by lost finalization is safely repeatable", async () => {
  const f = await fixture(); await commitAccountDeletion(f.owner); await age();
  // Simulate process death after provider success: leave all claims persisted.
  await pool.query("UPDATE creator_media_uploads SET state='cleanup_in_progress'");
  await pool.query("UPDATE closet_media_uploads SET state='cleanup_in_progress',cleanup_claim_token=$1", [randomUUID()]);
  await pool.query("UPDATE video_uploads SET recovery_lease_token=$1", [randomUUID()]);
  // Mocks return success for already-absent objects, matching provider 404.
  assert.equal((await runAccountMediaCleanup({ apply: true }, ok)).deleted, 3);
});
test("actual provider helpers treat mocked 404s as confirmed deletion", async () => {
  const f = await fixture(); await commitAccountDeletion(f.owner); await age();
  const blockedFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); methods.push(init?.method ?? "GET");
    if (url === "http://127.0.0.1:1106/object-storage/signed-object-url") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ signed_url: "https://mock-provider.invalid/object" }), { status: 200 });
    }
    assert.ok(url.startsWith("https://mock-provider.invalid/"));
    assert.equal(init?.method, "DELETE");
    return new Response(null, { status: 404 });
  };
  try {
    const providers: AccountMediaProviders = {
      ...accountMediaProviders,
      deleteVideo: (id, options) => accountMediaProviders.deleteVideo(id, {
        ...options, apiKey: "mock-only", baseUrl: "https://mock-provider.invalid",
      }),
    };
    assert.equal((await runAccountMediaCleanup({ apply: true }, providers)).deleted, 3);
    assert.equal(methods.filter(method => method === "DELETE").length, 3);
  } finally { globalThis.fetch = blockedFetch; }
});
test("a failed post-provider ledger write keeps deletion successful and cleanup pending", async () => {
  const f = await fixture();
  await pool.query(`CREATE FUNCTION reject_creator_finalize() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.state='deleted' THEN RAISE EXCEPTION 'mock finalization failure'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER reject_creator_finalize BEFORE UPDATE ON creator_media_uploads FOR EACH ROW EXECUTE FUNCTION reject_creator_finalize()");
  try {
    const result = await deleteAccount(f.owner, log, ok);
    assert.ok(result.ok); assert.equal(result.mediaCleanup, "pending");
    assert.deepEqual((await states()).photos, ["delete_failed"]);
    assert.equal((await pool.query("SELECT * FROM users")).rowCount, 0);
  } finally {
    await pool.query("DROP TRIGGER reject_creator_finalize ON creator_media_uploads");
    await pool.query("DROP FUNCTION reject_creator_finalize()");
  }
  await age();
  assert.equal((await runAccountMediaCleanup({ apply: true }, ok)).deleted, 1);
});
test("stale closet and video workers cannot overwrite newer completed claims", async () => {
  for (const kind of ["closet", "video"]) {
    const f = await fixture(); await commitAccountDeletion(f.owner); await age();
    const providers: AccountMediaProviders = {
      ...ok,
      deleteClosetPhoto: async () => {
        if (kind === "closet") {
          await pool.query("UPDATE closet_media_uploads SET cleanup_lease_until=now()-interval '1 day'");
          await runAccountMediaCleanup({ apply: true }, ok);
          throw new Error("stale closet failure");
        }
      },
      deleteVideo: async () => {
        if (kind === "video") {
          await pool.query("UPDATE video_uploads SET recovery_lease_until=now()-interval '1 day',updated_at=now()-interval '1 day'");
          await runAccountMediaCleanup({ apply: true }, ok);
          return { status: "unavailable", reason: "stale video failure" };
        }
        return { status: "ok" };
      },
    };
    await runAccountMediaCleanup({ apply: true }, providers);
    const final = await states();
    assert.ok([...final.photos, ...final.closet, ...final.videos].every(state => state === "deleted"));
  }
});
