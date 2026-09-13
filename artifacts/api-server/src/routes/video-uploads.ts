import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

import {
  BUNNY_WEBHOOK_SIGNATURE_ALGORITHM_HEADER,
  BUNNY_WEBHOOK_SIGNATURE_HEADER,
  BUNNY_WEBHOOK_SIGNATURE_VERSION_HEADER,
  createBunnyVideo,
  deleteBunnyVideo,
  isBunnyStreamConfigured,
  verifyBunnyWebhookSignature,
} from "../lib/bunny-stream";
import { requireCreator } from "../lib/creator-account";
import { isFeatureEnabled } from "../lib/feature-flags";
import {
  AMBIGUOUS_CREATE_REASONS,
  claimCancellation,
  finalizeCancelDeleted,
  finalizeCancelFailed,
  finalizeCreateAmbiguous,
  finalizeCreateFailure,
  finalizeCreateSuccess,
  getOwnedUpload,
  issueTusUploadAuthorization,
  parseIdempotencyKey,
  reconcileWithBunny,
  reserveUploadIntent,
  serializeVideoUpload,
  validateDeclaredMetadata,
  VIDEO_UPLOAD_IN_PROGRESS_RETRY_AFTER_SECONDS,
} from "../lib/video-upload-lifecycle";
import { reconcileFromWebhook } from "../lib/video-upload-recovery";
import { requireUser } from "./engagement";

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUserMw(req: Request, res: Response, next: NextFunction) {
  const user = requireUser(req, res);
  if (!user) return;
  next();
}

async function videoUploadFlagMw(_req: Request, res: Response, next: NextFunction) {
  if (!(await isFeatureEnabled("video_upload"))) {
    res.status(403).json({ error: "Video upload is not available right now" });
    return;
  }
  next();
}

function statusUrlFor(id: string): string {
  return `/api/video-uploads/${id}`;
}

/**
 * Client-supplied metadata only informs UI/display and the declared-size
 * limit below — never the owner, the Bunny library, or any provider
 * credential, all of which come exclusively from the authenticated
 * session and server-side configuration. See bunny-stream.ts and
 * video-upload-lifecycle.ts for why this route never routes video bytes
 * through this API: the client uploads directly to Bunny over TUS using
 * the one-time credentials this endpoint returns.
 */
router.post("/video-uploads/request-upload", requireUserMw, videoUploadFlagMw, async (req, res) => {
  const authorization = await requireCreator(req.user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const { workspace, userId } = authorization;

  if (!isBunnyStreamConfigured()) {
    res.status(503).json({ error: "Video upload is not available right now" });
    return;
  }

  const idempotencyKey = parseIdempotencyKey(req.get("Idempotency-Key"));
  if (idempotencyKey === undefined) {
    res.status(400).json({ error: "Invalid Idempotency-Key" });
    return;
  }

  const declared = validateDeclaredMetadata(req.body);
  if (!declared) {
    res.status(400).json({ error: "Provide a valid fileName, sizeBytes, and mimeType" });
    return;
  }

  const bunnyLibraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim() ?? "";

  const reservation = await reserveUploadIntent(workspace.creatorId, userId, bunnyLibraryId, declared, idempotencyKey);
  if (reservation.outcome === "rate_limited") { res.status(429).json({ error: "Too many upload attempts. Try again later." }); return; }
  if (reservation.outcome === "concurrency_limited") { res.status(429).json({ error: "Too many uploads in progress. Wait for one to finish first." }); return; }
  if (reservation.outcome === "idempotency_conflict") {
    const error = reservation.reason === "metadata_mismatch"
      ? "This Idempotency-Key was already used with different upload details. Use a new key for a different upload."
      : "This Idempotency-Key was already used and has been resolved. Use a new key to start a new upload.";
    res.status(409).json({ error });
    return;
  }

  if (reservation.outcome === "in_progress") {
    // A genuinely concurrent duplicate call arrived while the winning call
    // for this exact key is still waiting on Bunny — never told to use a
    // new key (that request may well succeed), just to check back shortly.
    res.set("Retry-After", String(VIDEO_UPLOAD_IN_PROGRESS_RETRY_AFTER_SECONDS));
    res.status(202).json({
      id: reservation.row.id,
      state: reservation.row.state,
      statusUrl: statusUrlFor(reservation.row.id),
      retryAfter: VIDEO_UPLOAD_IN_PROGRESS_RETRY_AFTER_SECONDS,
    });
    return;
  }

  if (reservation.outcome === "idempotent_replay") {
    const tusAuthorization = issueTusUploadAuthorization(reservation.row);
    if (!tusAuthorization) { res.status(500).json({ error: "Unable to prepare this upload right now" }); return; }
    res.status(201).json({ id: reservation.row.id, state: reservation.row.state, replayed: true, tus: tusAuthorization });
    return;
  }

  const { row } = reservation;
  // The Bunny video's title is the upload's own stable internal id, never
  // the user's declared filename — this is what would let a future
  // (Phase 2B) reconciliation job locate a possible orphan on Bunny's side
  // by listing videos in this library and matching titles against
  // create_ambiguous rows. The user's actual filename is preserved
  // separately in declared_file_name for the application's own display.
  const created = await createBunnyVideo(row.id, { libraryId: bunnyLibraryId });
  if (created.status !== "ok") {
    if (AMBIGUOUS_CREATE_REASONS.has(created.reason)) {
      await finalizeCreateAmbiguous(row.id, userId, created.reason);
      req.log.warn({ reason: created.reason, uploadId: row.id, userId }, "Bunny video creation outcome unresolved");
      res.status(created.reason === "timeout" ? 504 : 502).json({
        id: row.id,
        state: "create_ambiguous",
        outcome: "unresolved",
        error: "This upload's creation status could not be confirmed. Do not retry with the same key — check its status, or start a new attempt with a new key.",
      });
      return;
    }
    await finalizeCreateFailure(row.id, userId, created.reason);
    req.log.warn({ reason: created.reason, uploadId: row.id, userId }, "Bunny video creation failed");
    // The row itself is the durable record of this attempt (see
    // finalizeCreateFailure) — its id is still returned here so the client
    // can inspect it via GET /:id, even though its state is already
    // terminal ("failed") and it will never be retried automatically.
    res.status(502).json({ id: row.id, error: "Unable to start this upload right now. Try again with a new request." });
    return;
  }

  const updated = await finalizeCreateSuccess(row.id, userId, created.videoId);
  if (!updated) {
    // Unreachable in normal operation: the row was only just inserted in
    // this same request and its id has never been returned to any client
    // yet, so nothing else could have raced to delete or reassign it.
    req.log.error({ uploadId: row.id, userId }, "Video upload row vanished immediately after Bunny video creation");
    res.status(500).json({ error: "Unable to start this upload right now. Try again with a new request." });
    return;
  }

  const tus = issueTusUploadAuthorization(updated);
  if (!tus) { res.status(500).json({ error: "Unable to prepare this upload right now" }); return; }
  res.status(201).json({ id: updated.id, state: updated.state, tus });
});

router.get("/video-uploads/:id", requireUserMw, videoUploadFlagMw, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Upload not found" }); return; }

  const row = await getOwnedUpload(id, user.id);
  if (!row) { res.status(404).json({ error: "Upload not found" }); return; }

  const reconciled = await reconcileWithBunny(row);
  res.json(serializeVideoUpload(reconciled));
});

router.post("/video-uploads/:id/cancel", requireUserMw, videoUploadFlagMw, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Upload not found" }); return; }

  const claimed = await claimCancellation(id, user.id);
  if (!claimed) {
    const current = await getOwnedUpload(id, user.id);
    if (!current) { res.status(404).json({ error: "Upload not found" }); return; }
    if (current.state === "deleted") { res.status(200).json({ id: current.id, state: current.state, physicalDeletion: "completed" }); return; }
    if (current.state === "orphan_cleanup_pending") {
      // Repeated cancel call on an already-ambiguous row — nothing new to
      // do (Phase 2B owns actually resolving it), restate the same honest
      // "unknown" outcome rather than pretending it's settled.
      res.status(202).json({ id: current.id, state: current.state, physicalDeletion: "unknown" });
      return;
    }
    // "deletion_pending": another cancel call for this same row is
    // actively in flight right now — report the in-progress state rather
    // than racing it with a second concurrent Bunny delete call.
    res.status(202).json({ id: current.id, state: current.state, physicalDeletion: "pending" });
    return;
  }

  if (claimed.state === "orphan_cleanup_pending") {
    // This row's create call never got far enough to receive a Bunny
    // video id (see finalizeCreateAmbiguous) — there is nothing to call
    // Bunny's delete endpoint with, and no way to honestly claim the
    // physical asset (if one even exists) has been deleted.
    res.status(202).json({ id: claimed.id, state: claimed.state, physicalDeletion: "unknown" });
    return;
  }

  if (!claimed.bunnyVideoId) {
    // A definite create rejection ("failed") never had a Bunny video at
    // all — physicalDeletion is honestly "completed" because there was
    // never anything on Bunny's side to delete.
    const finalRow = await finalizeCancelDeleted(claimed.id, user.id);
    res.status(200).json({ id: finalRow.id, state: finalRow.state, physicalDeletion: "completed" });
    return;
  }

  const deleted = await deleteBunnyVideo(claimed.bunnyVideoId, { libraryId: claimed.bunnyLibraryId });
  if (deleted.status === "ok") {
    const finalRow = await finalizeCancelDeleted(claimed.id, user.id);
    res.status(200).json({ id: finalRow.id, state: finalRow.state, physicalDeletion: "completed" });
    return;
  }

  req.log.warn({ reason: deleted.reason, uploadId: claimed.id, userId: user.id }, "Bunny video deletion failed");
  const finalRow = await finalizeCancelFailed(claimed.id, user.id, deleted.reason);
  res.status(202).json({ id: finalRow.id, state: finalRow.state, physicalDeletion: "pending" });
});

/**
 * Bunny Stream webhook delivery. Deliberately mounted with no
 * requireUserMw/videoUploadFlagMw ahead of signature verification — Bunny
 * never has a session cookie for this app, and gating on the feature flag
 * before authenticating the request would let an unauthenticated caller
 * probe whether video_upload is enabled. Order matters:
 *
 *   1. Verify the signature over the exact raw body (see app.ts's
 *      express.json({ verify }) callback, which is the only thing that
 *      populates req.rawBody, scoped to exactly this path).
 *   2. Only once authenticated, check the feature flag — if disabled,
 *      acknowledge without processing (a 4xx/5xx here would make Bunny
 *      retry-storm an endpoint we've deliberately turned off).
 *   3. Parse VideoLibraryId/VideoGuid defensively and hand off to
 *      reconcileFromWebhook, which re-fetches ground truth from Bunny's Get
 *      Video endpoint rather than ever trusting this payload's own Status
 *      field for a lifecycle decision (see bunny-stream.ts).
 *
 * Acknowledges 200 only after reconciliation completes — reconcileFromWebhook
 * itself is a single fenced UPDATE (or a no-op), so there is no partial-work
 * state that would need separate durable bookkeeping before ack.
 */
router.post("/video-uploads/webhook", async (req, res) => {
  const rawBody = req.rawBody;
  if (!rawBody) {
    // Only possible if this route is ever reached by a path app.ts's verify
    // callback didn't recognize (e.g. the route path drifts from
    // BUNNY_WEBHOOK_PATH) — never fall back to re-serializing req.body,
    // since that is not guaranteed byte-identical to what was signed.
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const verification = verifyBunnyWebhookSignature({
    rawBody,
    signatureHeader: req.get(BUNNY_WEBHOOK_SIGNATURE_HEADER),
    versionHeader: req.get(BUNNY_WEBHOOK_SIGNATURE_VERSION_HEADER),
    algorithmHeader: req.get(BUNNY_WEBHOOK_SIGNATURE_ALGORITHM_HEADER),
  });
  if (verification.status !== "ok") {
    req.log.warn({ reason: verification.reason }, "Rejected Bunny webhook: invalid signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  if (!(await isFeatureEnabled("video_upload"))) {
    res.status(200).json({ received: true });
    return;
  }

  const body = req.body;
  const libraryId = body && typeof body === "object" && typeof (body as Record<string, unknown>).VideoLibraryId !== "undefined"
    ? String((body as Record<string, unknown>).VideoLibraryId)
    : undefined;
  const videoGuidRaw = body && typeof body === "object" ? (body as Record<string, unknown>).VideoGuid : undefined;
  const videoId = typeof videoGuidRaw === "string" && videoGuidRaw.length > 0 ? videoGuidRaw : undefined;
  // Deliberately never reads body.Status here — see the header comment
  // above and bunny-stream.ts on why a webhook event code and a Get Video
  // resource status are not assumed interchangeable.
  if (!libraryId || !videoId) {
    req.log.warn("Rejected Bunny webhook: missing VideoLibraryId/VideoGuid");
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const outcome = await reconcileFromWebhook(libraryId, videoId);
  if (outcome === "identity_mismatch") {
    req.log.warn({ videoId }, "Bunny webhook library id did not match the stored upload's library id");
  } else if (outcome === "not_found") {
    req.log.info({ videoId }, "Bunny webhook referenced an unknown video id");
  }
  // Always 200 once verification + a bounded lookup attempt have completed
  // — "not_found"/"identity_mismatch" are not delivery failures Bunny
  // should retry, they are facts about this event that a retry cannot fix.
  res.status(200).json({ received: true });
});

export default router;
