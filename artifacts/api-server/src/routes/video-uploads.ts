import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

import { createBunnyVideo, deleteBunnyVideo, isBunnyStreamConfigured } from "../lib/bunny-stream";
import { requireCreator } from "../lib/creator-account";
import { isFeatureEnabled } from "../lib/feature-flags";
import {
  claimCancellation,
  finalizeCancelDeleted,
  finalizeCancelFailed,
  finalizeCreateFailure,
  finalizeCreateSuccess,
  getOwnedUpload,
  issueTusUploadAuthorization,
  parseIdempotencyKey,
  reconcileWithBunny,
  reserveUploadIntent,
  serializeVideoUpload,
  validateDeclaredMetadata,
} from "../lib/video-upload-lifecycle";
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
  if (reservation.outcome === "idempotency_conflict") { res.status(409).json({ error: "This Idempotency-Key was already used. Use a new key to start a new upload." }); return; }

  if (reservation.outcome === "idempotent_replay") {
    const tusAuthorization = issueTusUploadAuthorization(reservation.row);
    if (!tusAuthorization) { res.status(500).json({ error: "Unable to prepare this upload right now" }); return; }
    res.status(201).json({ id: reservation.row.id, state: reservation.row.state, replayed: true, tus: tusAuthorization });
    return;
  }

  const { row } = reservation;
  const created = await createBunnyVideo(declared.fileName, { libraryId: bunnyLibraryId });
  if (created.status !== "ok") {
    await finalizeCreateFailure(row.id, userId, created.reason);
    req.log.warn({ reason: created.reason, uploadId: row.id, userId }, "Bunny video creation failed");
    // The row itself is the durable record of this attempt (see
    // finalizeCreateFailure) — its id is still returned here so the client
    // can inspect it via GET /:id, even though its state is already
    // terminal ("failed") and it will never be retried automatically.
    res.status(created.reason === "timeout" ? 504 : 502).json({ id: row.id, error: "Unable to start this upload right now. Try again with a new request." });
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
    // "deletion_pending": another cancel call for this same row is
    // actively in flight right now — report the in-progress state rather
    // than racing it with a second concurrent Bunny delete call.
    res.status(202).json({ id: current.id, state: current.state, physicalDeletion: "pending" });
    return;
  }

  if (!claimed.bunnyVideoId) {
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

export default router;
