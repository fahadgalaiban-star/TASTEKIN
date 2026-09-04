import { closetItems, closetMediaUploads, db } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import express, { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

import { isFeatureEnabled } from "../lib/feature-flags";
import {
  isClosetConfirmationStatus,
  validateClosetItemFields,
} from "../lib/closet-items";
import {
  analyzeClosetImage,
  publicClosetSuggestions,
} from "../lib/closet-image-analysis";
import {
  MAX_UPLOAD_BYTES,
  decodeAndReencodeClosetImage,
  reserveAnalysisAttempt,
  reserveUploadAttempt,
  sanitizeErrorReason,
  transitionMediaUpload,
} from "../lib/closet-media-upload";
import {
  createClosetMediaUpload,
  deleteClosetMedia,
  getClosetMediaDownloadURL,
  putClosetMediaBuffer,
} from "../lib/private-media-storage";
import { requireUser } from "./engagement";

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUserMw(req: Request, res: Response, next: NextFunction) {
  const user = requireUser(req, res);
  if (!user) return;
  next();
}

async function myThingsFlagMw(_req: Request, res: Response, next: NextFunction) {
  if (!(await isFeatureEnabled("my_things"))) {
    res.status(403).json({ error: "My Things is not available right now" });
    return;
  }
  next();
}

async function closetAnalysisFlagMw(_req: Request, res: Response, next: NextFunction) {
  if (!(await isFeatureEnabled("closet_item_analysis"))) {
    res.status(403).json({ error: "Closet item analysis is not available right now" });
    return;
  }
  next();
}

async function reservationMw(req: Request, res: Response, next: NextFunction) {
  const result = await reserveUploadAttempt(req.user!.id);
  if ("rateLimited" in result) {
    res.status(429).json({ error: "Too many upload attempts. Try again later." });
    return;
  }
  res.locals.closetReservationId = result.id;
  next();
}

/**
 * Route-scoped Express error handler (4 declared params — Express dispatches
 * to this by arity when express.raw() below calls next(err), e.g. an
 * oversized or malformed body). The reservation was already created by
 * reservationMw before the body was ever read, so it must not be left
 * dangling — it's transitioned to 'rejected' here, scoped by both the
 * reservation id (from res.locals, never client-controlled) and the
 * authenticated owner id.
 */
async function parserRejectionHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const reservationId = res.locals.closetReservationId as string | undefined;
  const ownerUserId = req.user?.id;
  const httpError = err as { status?: number; type?: string } | undefined;
  const status = httpError?.status === 413 || httpError?.type === "entity.too.large" ? 413 : 400;
  if (reservationId && ownerUserId) {
    await transitionMediaUpload(reservationId, ownerUserId, {
      state: "rejected",
      lastError: sanitizeErrorReason("upload rejected", err),
      lastAttemptAt: new Date(),
    });
  }
  res.status(status).json({ error: status === 413 ? "Image is too large" : "Could not read the uploaded image" });
}

async function uploadHandler(req: Request, res: Response) {
  const reservationId = res.locals.closetReservationId as string;
  const ownerUserId = req.user!.id;
  const body = req.body as unknown;

  if (!Buffer.isBuffer(body) || body.length === 0) {
    await transitionMediaUpload(reservationId, ownerUserId, {
      state: "rejected", lastError: "upload rejected: empty body", lastAttemptAt: new Date(),
    });
    res.status(422).json({ error: "Could not process this image" });
    return;
  }

  const decoded = await decodeAndReencodeClosetImage(body);
  if (!decoded) {
    await transitionMediaUpload(reservationId, ownerUserId, {
      state: "rejected", lastError: "upload rejected: invalid image", lastAttemptAt: new Date(),
    });
    res.status(422).json({ error: "Could not process this image" });
    return;
  }

  let uploadURL: string;
  let objectPath: string;
  try {
    ({ uploadURL, objectPath } = await createClosetMediaUpload());
  } catch (error) {
    req.log.error({ err: error, userId: ownerUserId }, "Unable to allocate closet media object key");
    await transitionMediaUpload(reservationId, ownerUserId, {
      state: "upload_failed", lastError: sanitizeErrorReason("upload failed", error), lastAttemptAt: new Date(), retryCountIncrement: true,
    });
    res.status(502).json({ error: "Unable to store this image right now" });
    return;
  }

  await transitionMediaUpload(reservationId, ownerUserId, { state: "uploading", imageObjectKey: objectPath });

  try {
    await putClosetMediaBuffer(uploadURL, decoded.buffer);
  } catch (error) {
    req.log.error({ err: error, userId: ownerUserId }, "Unable to upload closet media");
    await transitionMediaUpload(reservationId, ownerUserId, {
      state: "upload_failed", lastError: sanitizeErrorReason("upload failed", error), lastAttemptAt: new Date(), retryCountIncrement: true,
    });
    res.status(502).json({ error: "Unable to store this image right now" });
    return;
  }

  await transitionMediaUpload(reservationId, ownerUserId, { state: "uploaded", lastAttemptAt: new Date() });
  res.status(201).json({ uploadId: reservationId });
}

router.post(
  "/closet-items/media",
  requireUserMw,
  myThingsFlagMw,
  reservationMw,
  express.raw({ type: "image/*", limit: MAX_UPLOAD_BYTES }),
  parserRejectionHandler,
  uploadHandler,
);

/**
 * Suggests (never creates or updates) closet item fields from an
 * already-uploaded, not-yet-attached photo. Always responds 200 with
 * `{ suggestions: ... | null }` for any well-scoped request — provider
 * failure, timeout, missing API key, a malformed model response, and every
 * field falling below the confidence threshold all collapse to the same
 * "no suggestions" shape so the client has exactly one case to handle
 * beyond the existing manual flow it already falls back to.
 *
 * At most one analysis attempt is ever allowed per upload — reserved
 * durably and atomically (reserveAnalysisAttempt) before this touches
 * storage or the provider, so a second request for the same upload always
 * gets 429 without ever reaching Anthropic, and a provider failure or
 * timeout still permanently consumes the one allowed attempt.
 */
router.post("/closet-items/media/:uploadId/analyze", requireUserMw, myThingsFlagMw, closetAnalysisFlagMw, async (req, res) => {
  const user = req.user!;
  const uploadId = String(req.params.uploadId);
  if (!UUID_RE.test(uploadId)) { res.status(404).json({ error: "Upload not found" }); return; }

  const reservation = await reserveAnalysisAttempt(uploadId, user.id);
  if (reservation.status === "already_attempted") {
    res.status(429).json({ error: "This photo has already been analyzed." });
    return;
  }
  if (reservation.status === "not_found") {
    res.status(404).json({ error: "Upload not found" });
    return;
  }

  let imageBuffer: Buffer;
  try {
    const signedUrl = await getClosetMediaDownloadURL(reservation.imageObjectKey);
    const stored = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!stored.ok) throw new Error(`HTTP ${stored.status}`);
    imageBuffer = Buffer.from(await stored.arrayBuffer());
  } catch (error) {
    req.log.warn({ reason: sanitizeErrorReason("analysis fetch failed", error), userId: user.id }, "Unable to fetch closet image for analysis");
    res.json({ suggestions: null });
    return;
  }

  const result = await analyzeClosetImage(imageBuffer);
  if (result.status !== "ok") {
    if (result.reason !== "not configured") {
      req.log.warn({ reason: result.reason, userId: user.id }, "Closet item analysis unavailable");
    }
    res.json({ suggestions: null });
    return;
  }
  res.json({ suggestions: publicClosetSuggestions(result.suggestions) });
});

type SerializableClosetItem = typeof closetItems.$inferSelect;
function serializeClosetItem(item: SerializableClosetItem) {
  return {
    id: item.id,
    itemType: item.itemType,
    primaryColor: item.primaryColor,
    style: item.style,
    occasion: item.occasion,
    season: item.season,
    brand: item.brand,
    confirmationStatus: item.confirmationStatus,
    createdAt: item.createdAt,
  };
}

router.post("/closet-items", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
  if (!UUID_RE.test(uploadId)) { res.status(400).json({ error: "uploadId is required" }); return; }
  const fields = validateClosetItemFields(req.body);
  if (!fields) { res.status(400).json({ error: "Invalid item fields" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const [upload] = await tx
        .select({ id: closetMediaUploads.id, imageObjectKey: closetMediaUploads.imageObjectKey, state: closetMediaUploads.state })
        .from(closetMediaUploads)
        .where(and(eq(closetMediaUploads.id, uploadId), eq(closetMediaUploads.ownerUserId, user.id)))
        .for("update");
      if (!upload) return { outcome: "not_found" as const };
      if (upload.state !== "uploaded" || !upload.imageObjectKey) return { outcome: "conflict" as const };

      const [item] = await tx.insert(closetItems).values({
        ownerUserId: user.id,
        imageObjectKey: upload.imageObjectKey,
        itemType: fields.itemType,
        primaryColor: fields.primaryColor,
        style: fields.style,
        occasion: fields.occasion,
        season: fields.season,
        brand: fields.brand,
      }).returning();

      await tx.update(closetMediaUploads)
        .set({ state: "attached", closetItemId: item.id, attachedAt: new Date(), updatedAt: new Date() })
        .where(eq(closetMediaUploads.id, uploadId));

      return { outcome: "created" as const, item };
    });

    if (result.outcome === "not_found") { res.status(404).json({ error: "Upload not found" }); return; }
    if (result.outcome === "conflict") { res.status(409).json({ error: "This upload has already been used or is not ready" }); return; }
    res.status(201).json(serializeClosetItem(result.item));
  } catch (error) {
    req.log.error({ err: error, userId: user.id }, "Unable to create closet item");
    res.status(500).json({ error: "Unable to create this item" });
  }
});

router.get("/closet-items", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const rows = await db.select().from(closetItems)
    .where(eq(closetItems.ownerUserId, user.id))
    .orderBy(desc(closetItems.createdAt));
  res.json({ items: rows.map(serializeClosetItem) });
});

router.get("/closet-items/:id", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const itemId = String(req.params.id);
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: "Item not found" }); return; }
  const [item] = await db.select().from(closetItems)
    .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, user.id)));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(serializeClosetItem(item));
});

router.put("/closet-items/:id", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const itemId = String(req.params.id);
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: "Item not found" }); return; }
  const fields = validateClosetItemFields(req.body);
  if (!fields) { res.status(400).json({ error: "Invalid item fields" }); return; }
  let confirmationStatus: string | undefined;
  if (req.body?.confirmationStatus !== undefined) {
    if (!isClosetConfirmationStatus(req.body.confirmationStatus)) { res.status(400).json({ error: "Invalid confirmation status" }); return; }
    confirmationStatus = req.body.confirmationStatus;
  }

  const [updated] = await db.update(closetItems)
    .set({
      itemType: fields.itemType, primaryColor: fields.primaryColor, style: fields.style,
      occasion: fields.occasion, season: fields.season, brand: fields.brand,
      ...(confirmationStatus ? { confirmationStatus } : {}),
    })
    .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, user.id)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(serializeClosetItem(updated));
});

router.get("/closet-items/:id/image", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const itemId = String(req.params.id);
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: "Item not found" }); return; }
  const [item] = await db.select({ imageObjectKey: closetItems.imageObjectKey }).from(closetItems)
    .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, user.id)));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  try {
    const url = await getClosetMediaDownloadURL(item.imageObjectKey);
    res.redirect(302, url);
  } catch (error) {
    req.log.warn({ err: error, userId: user.id }, "Unable to serve closet media");
    res.status(404).json({ error: "Item not found" });
  }
});

/**
 * The final ledger transition after a physical delete attempt is fenced by
 * `state = 'deletion_pending'` — if reconciliation already claimed or
 * resolved this row concurrently, this affects zero rows and the durable
 * ledger state (read immediately after) is treated as authoritative rather
 * than being overwritten.
 */
async function finalizeSyncDelete(ledgerId: string, ownerUserId: string, outcome: "deleted" | "delete_failed", errorReason?: string) {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (outcome === "deleted") {
    setClause.state = "deleted";
    setClause.deletedAt = new Date();
  } else {
    setClause.state = "delete_failed";
    setClause.retryCount = sql`${closetMediaUploads.retryCount} + 1`;
    setClause.lastError = errorReason;
    setClause.lastAttemptAt = new Date();
  }
  const [row] = await db.update(closetMediaUploads)
    .set(setClause)
    .where(and(
      eq(closetMediaUploads.id, ledgerId),
      eq(closetMediaUploads.ownerUserId, ownerUserId),
      eq(closetMediaUploads.state, "deletion_pending"),
    ))
    .returning({ state: closetMediaUploads.state });
  if (row) return row.state;
  const [current] = await db.select({ state: closetMediaUploads.state }).from(closetMediaUploads)
    .where(eq(closetMediaUploads.id, ledgerId));
  return current?.state ?? outcome;
}

router.delete("/closet-items/:id", requireUserMw, myThingsFlagMw, async (req, res) => {
  const user = req.user!;
  const itemId = String(req.params.id);
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: "Item not found" }); return; }

  const claim = await db.transaction(async (tx) => {
    const [ledgerRow] = await tx.update(closetMediaUploads)
      .set({ state: "deletion_pending", updatedAt: new Date() })
      .where(and(
        eq(closetMediaUploads.closetItemId, itemId),
        eq(closetMediaUploads.ownerUserId, user.id),
        eq(closetMediaUploads.state, "attached"),
      ))
      .returning({ id: closetMediaUploads.id, imageObjectKey: closetMediaUploads.imageObjectKey });
    if (!ledgerRow) return null;
    const [deletedItem] = await tx.delete(closetItems)
      .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, user.id)))
      .returning({ id: closetItems.id });
    if (!deletedItem) return null;
    return ledgerRow;
  });

  if (!claim) { res.status(404).json({ error: "Item not found" }); return; }

  let finalState: string;
  try {
    if (claim.imageObjectKey) await deleteClosetMedia(claim.imageObjectKey);
    finalState = await finalizeSyncDelete(claim.id, user.id, "deleted");
  } catch (error) {
    req.log.error({ err: error, userId: user.id }, "Physical deletion of closet media failed");
    finalState = await finalizeSyncDelete(claim.id, user.id, "delete_failed", sanitizeErrorReason("delete failed", error));
  }

  const completed = finalState === "deleted";
  res.status(completed ? 200 : 202).json({ status: "removed", physicalDeletion: completed ? "completed" : "pending" });
});

export default router;
