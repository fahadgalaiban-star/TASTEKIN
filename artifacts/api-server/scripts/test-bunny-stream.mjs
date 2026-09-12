// Video Foundation, Phase 1 — focused, DB-free verification for the Bunny
// Stream wrapper (src/lib/bunny-stream.ts) and the video_upload feature
// flag's default-off registration (src/lib/feature-flags.ts).
//
// Follows this directory's existing test-circle.mjs convention: esbuild
// each lib file to a temp .mjs, import it directly, and assert against it
// with node:assert/strict — no Postgres, no Express, no live Bunny
// request. A local fake-Bunny HTTP server stands in for the real API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Written under lib/db's own tmp/ (gitignored at the repo root), not this
// package's, because feature-flags.ts's bundle leaves "pg" external (see
// below) — pg is only a direct dependency of @workspace/db under pnpm's
// strict node_modules, so only a location inside lib/db's own directory
// tree resolves it via Node's normal upward node_modules lookup.
const tempDir = path.join(path.resolve("../../lib/db"), "tmp", "bunny-stream-verify");
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
let fakeServer;
try {
  const bunnyOutput = path.join(tempDir, "bunny-stream.mjs");
  await build({ entryPoints: [path.resolve("src/lib/bunny-stream.ts")], outfile: bunnyOutput, bundle: true, format: "esm", platform: "node", target: "node22" });
  const {
    createBunnyVideo,
    getBunnyVideoStatus,
    deleteBunnyVideo,
    computeBunnyTusSignature,
    createBunnyTusUploadAuthorization,
    isBunnyStreamConfigured,
  } = await import(pathToFileURL(bunnyOutput).href);

  // feature-flags.ts imports @workspace/db, which throws at import time if
  // DATABASE_URL is entirely unset — a dummy, never-connected-to value
  // satisfies that guard without this test ever touching a database. Only
  // the plain FEATURE_FLAG_DEFINITIONS array is read below, never
  // isFeatureEnabled/currentFlagStates (which would attempt a real query).
  process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
  const flagsOutput = path.join(tempDir, "feature-flags.mjs");
  // @workspace/db (and drizzle-orm) must be bundled, since Node cannot import
  // their TypeScript source directly; only "pg" is left external — esbuild's
  // CJS interop can't handle its dynamic requires of Node builtins — and it
  // resolves fine via Node's normal upward node_modules lookup from tempDir,
  // which sits inside this package's own directory tree.
  await build({ entryPoints: [path.resolve("src/lib/feature-flags.ts")], outfile: flagsOutput, bundle: true, format: "esm", platform: "node", target: "node22", external: ["pg"] });
  const { FEATURE_FLAG_DEFINITIONS } = await import(pathToFileURL(flagsOutput).href);

  // --- feature flag: registered, disabled by default ------------------
  const videoFlag = FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === "video_upload");
  assert.ok(videoFlag, "video_upload must be a registered feature flag");
  assert.equal(videoFlag.defaultEnabled, false, "video_upload must default to disabled");

  // --- fake Bunny HTTP provider -----------------------------------------
  let mode = "ok";
  let lastRequestHeaders = null;
  fakeServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      lastRequestHeaders = req.headers;
      if (mode === "hang") return; // never responds — exercises the timeout path
      if (mode === "http_error") { res.writeHead(500); res.end(); return; }
      if (mode === "malformed_json") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url?.endsWith("/videos")) {
        if (mode === "malformed_create") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ title: parsed.title })); return; }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ guid: "fake-video-guid", title: parsed.title }));
        return;
      }
      if (req.method === "GET" && req.url?.includes("/videos/")) {
        const videoId = req.url.split("/videos/")[1];
        if (videoId === "missing-video") { res.writeHead(404); res.end(); return; }
        if (mode === "malformed_status") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ guid: videoId })); return; }
        if (mode === "processing") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ guid: videoId, status: 2, title: "Sample", length: null, width: null, height: null, thumbnailFileName: null }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ guid: videoId, status: 4, title: "Sample", length: 42, width: 1080, height: 1920, thumbnailFileName: "thumb.jpg" }));
        return;
      }
      if (req.method === "DELETE" && req.url?.includes("/videos/")) {
        const videoId = req.url.split("/videos/")[1];
        if (videoId === "missing-video") { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  const baseUrl = await new Promise((resolve, reject) => {
    fakeServer.on("error", reject);
    fakeServer.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${fakeServer.address().port}`));
  });
  const deps = { baseUrl, apiKey: "fake-api-key", libraryId: "fake-library-id", timeoutMs: 2_000 };

  // --- missing configuration: fails closed, never touches the network ---
  mode = "ok";
  assert.equal(isBunnyStreamConfigured(), false, "must be unconfigured with no env vars and no injected deps");
  assert.deepEqual(await createBunnyVideo("Untitled"), { status: "unavailable", reason: "not configured" });
  assert.deepEqual(await getBunnyVideoStatus("any-id"), { status: "unavailable", reason: "not configured" });
  assert.deepEqual(await deleteBunnyVideo("any-id"), { status: "unavailable", reason: "not configured" });
  assert.deepEqual(createBunnyTusUploadAuthorization("any-id"), { status: "unavailable", reason: "not configured" });
  assert.equal(isBunnyStreamConfigured(deps), true, "must be configured once deps are injected");

  // --- create video object ------------------------------------------------
  mode = "ok";
  const created = await createBunnyVideo("My first Open Edit video", deps);
  assert.deepEqual(created, { status: "ok", videoId: "fake-video-guid" });
  assert.equal(lastRequestHeaders.accesskey, "fake-api-key", "the API key must reach Bunny as the AccessKey header");

  // --- fetch processing metadata -------------------------------------------
  mode = "processing";
  const processing = await getBunnyVideoStatus("fake-video-guid", deps);
  assert.deepEqual(processing, {
    status: "ok",
    video: { videoId: "fake-video-guid", bunnyStatus: 2, title: "Sample", durationSeconds: null, width: null, height: null, thumbnailFileName: null },
  });

  // --- fetch ready metadata -------------------------------------------------
  mode = "ready";
  const ready = await getBunnyVideoStatus("fake-video-guid", deps);
  assert.deepEqual(ready, {
    status: "ok",
    video: { videoId: "fake-video-guid", bunnyStatus: 4, title: "Sample", durationSeconds: 42, width: 1080, height: 1920, thumbnailFileName: "thumb.jpg" },
  });

  // --- delete video (real, and idempotent on an already-gone one) ----------
  mode = "ok";
  assert.deepEqual(await deleteBunnyVideo("fake-video-guid", deps), { status: "ok" });
  assert.deepEqual(await deleteBunnyVideo("missing-video", deps), { status: "ok" }, "a 404 on delete must be treated as already-deleted success");
  assert.deepEqual(await getBunnyVideoStatus("missing-video", deps), { status: "unavailable", reason: "not found" });

  // --- malformed provider responses are rejected, never trusted -----------
  mode = "malformed_create";
  assert.deepEqual(await createBunnyVideo("x", deps), { status: "unavailable", reason: "malformed response" });
  mode = "malformed_status";
  assert.deepEqual(await getBunnyVideoStatus("fake-video-guid", deps), { status: "unavailable", reason: "malformed response" });
  mode = "malformed_json";
  assert.deepEqual(await createBunnyVideo("x", deps), { status: "unavailable", reason: "malformed response" });

  // --- provider HTTP failure -------------------------------------------------
  mode = "http_error";
  assert.deepEqual(await getBunnyVideoStatus("fake-video-guid", deps), { status: "unavailable", reason: "HTTP 500" });

  // --- provider timeout --------------------------------------------------
  mode = "hang";
  const timeoutDeps = { ...deps, timeoutMs: 150 };
  const startedAt = Date.now();
  const timedOut = await getBunnyVideoStatus("fake-video-guid", timeoutDeps);
  assert.deepEqual(timedOut, { status: "unavailable", reason: "timeout" });
  assert.ok(Date.now() - startedAt < 5_000, "a timeout must be bounded, never an unbounded hang");

  // --- network failure (nothing listening) --------------------------------
  mode = "ok";
  const unreachableDeps = { ...deps, baseUrl: "http://127.0.0.1:1" };
  const unreachable = await createBunnyVideo("x", unreachableDeps);
  assert.equal(unreachable.status, "unavailable");
  assert.equal(unreachable.reason, "network error");

  // --- deterministic TUS signature, exact formula ---------------------------
  const expirationTime = 1_700_000_000;
  const expectedSignature = createHash("sha256").update(`${deps.libraryId}${deps.apiKey}${expirationTime}fake-video-guid`).digest("hex");
  const signatureA = computeBunnyTusSignature({ libraryId: deps.libraryId, apiKey: deps.apiKey, expirationTime, videoId: "fake-video-guid" });
  const signatureB = computeBunnyTusSignature({ libraryId: deps.libraryId, apiKey: deps.apiKey, expirationTime, videoId: "fake-video-guid" });
  assert.equal(signatureA, expectedSignature, "the signature must be exactly SHA256(libraryId + apiKey + expirationTime + videoId)");
  assert.equal(signatureA, signatureB, "the signature must be deterministic for identical inputs");
  assert.notEqual(
    computeBunnyTusSignature({ libraryId: deps.libraryId, apiKey: deps.apiKey, expirationTime, videoId: "a-different-video-guid" }),
    signatureA,
    "a different videoId must never produce the same signature",
  );

  const authorization = createBunnyTusUploadAuthorization("fake-video-guid", 3_600, deps);
  assert.equal(authorization.status, "ok");
  assert.equal(authorization.authorization.libraryId, deps.libraryId);
  assert.equal(authorization.authorization.videoId, "fake-video-guid");
  assert.equal(
    authorization.authorization.signature,
    computeBunnyTusSignature({ libraryId: deps.libraryId, apiKey: deps.apiKey, expirationTime: authorization.authorization.expirationTime, videoId: "fake-video-guid" }),
  );

  console.log("Bunny Stream wrapper and video_upload feature-flag tests passed.");
} finally {
  if (fakeServer) await new Promise((resolve) => fakeServer.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
