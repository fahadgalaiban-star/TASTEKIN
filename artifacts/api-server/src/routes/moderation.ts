import {
  creatorWorkspaces,
  db,
  editComments,
  moderationAuditLog,
  reports,
  usersTable,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  type ReportStatus,
  type ReportTargetType,
} from "@workspace/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { creatorByUsername, isCurrentUserAdmin } from "../lib/creator-account";
import { getEditContext, requireUser } from "./engagement";

const router: IRouter = Router();

const REASON_SET = new Set<string>(REPORT_REASONS);
const TARGET_TYPE_SET = new Set<string>(REPORT_TARGET_TYPES);
const STATUS_SET = new Set<string>(REPORT_STATUSES);
const REVIEW_STATUSES = new Set<ReportStatus>(["under_review", "resolved", "dismissed"]);
const NOTE_REQUIRED_STATUSES = new Set<ReportStatus>(["resolved", "dismissed"]);

// Coarse abuse guard: real duplicate prevention is the database-enforced
// partial unique index below, this only caps overall report volume per user.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REPORTS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown) {
  // node-postgres errors surface a "23505" code, but drizzle-orm wraps the
  // driver error in a DrizzleQueryError and puts the original on `.cause` —
  // check both so the wrapped shape is still recognized.
  const hasCode = (value: unknown): boolean => Boolean(value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === "23505");
  return hasCode(error) || (error instanceof Error && hasCode(error.cause));
}

type ResolvedTarget = { ownerUserId: string | null; storageId: string };

/**
 * Resolves a client-supplied target into the stable id we persist, and the
 * account (if any) that owns it. Every failure path — missing id, unreadable
 * edit, malformed uuid — collapses to `null` so the caller always answers
 * with the same generic 404. This keeps `/reports` from being usable as an
 * existence oracle for content the reporter isn't allowed to see.
 */
async function resolveReportTarget(targetType: ReportTargetType, rawTargetId: string, userId: string): Promise<ResolvedTarget | null> {
  const targetId = rawTargetId.trim();
  if (!targetId) return null;

  if (targetType === "edit") {
    const context = await getEditContext(targetId, userId);
    if (!context || !context.canRead) return null;
    return { ownerUserId: context.workspace.ownerUserId, storageId: targetId };
  }

  if (targetType === "comment") {
    if (!UUID_RE.test(targetId)) return null;
    const [comment] = await db.select().from(editComments).where(eq(editComments.id, targetId));
    if (!comment) return null;
    const context = await getEditContext(comment.editId, userId);
    if (!context || !context.canRead) return null;
    return { ownerUserId: comment.userId, storageId: comment.id };
  }

  // profile: the client only ever knows a creator by username, so it is
  // resolved here into the stable, immutable creatorId for storage.
  const workspace = await creatorByUsername(targetId);
  if (!workspace || !workspace.ownerUserId) return null;
  return { ownerUserId: workspace.ownerUserId, storageId: workspace.creatorId };
}

router.post("/reports", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const targetType = typeof req.body?.targetType === "string" ? req.body.targetType : "";
  const targetIdInput = typeof req.body?.targetId === "string" ? req.body.targetId : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  const details = typeof req.body?.details === "string" ? req.body.details.trim().slice(0, 1000) : "";

  if (!TARGET_TYPE_SET.has(targetType)) { res.status(400).json({ error: "targetType must be edit, comment, or profile" }); return; }
  if (!REASON_SET.has(reason)) { res.status(400).json({ error: "Choose a valid report reason" }); return; }
  if (reason === "other" && !details) { res.status(400).json({ error: "Add details when reason is \"other\"" }); return; }
  if (!targetIdInput.trim()) { res.status(400).json({ error: "A report target is required" }); return; }

  const resolved = await resolveReportTarget(targetType as ReportTargetType, targetIdInput, user.id);
  if (!resolved) { res.status(404).json({ error: "This content is not available to report" }); return; }
  if (resolved.ownerUserId && resolved.ownerUserId === user.id) { res.status(400).json({ error: "You cannot report your own content or account" }); return; }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [{ count: recentCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(reports)
    .where(and(eq(reports.reporterUserId, user.id), gt(reports.createdAt, since)));
  if (Number(recentCount ?? 0) >= RATE_LIMIT_MAX_REPORTS) {
    res.status(429).json({ error: "You have submitted too many reports recently. Try again later." });
    return;
  }

  try {
    const [created] = await db.insert(reports).values({
      reporterUserId: user.id,
      targetType,
      targetId: resolved.storageId,
      reason,
      details: reason === "other" ? details : null,
    }).returning();
    res.status(201).json({
      id: created.id, targetType: created.targetType, targetId: created.targetId,
      reason: created.reason, details: created.details, status: created.status, createdAt: created.createdAt,
    });
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "You already have an active report for this" }); return; }
    req.log.error({ err: error, userId: user.id }, "Unable to create report");
    res.status(500).json({ error: "Unable to submit this report" });
  }
});

type EditRecord = { id?: unknown; title?: unknown; titleAr?: unknown; caption?: unknown; captionAr?: unknown; status?: unknown; access?: unknown };

async function reportContext(targetType: string, targetId: string) {
  if (targetType === "edit") {
    const context = await getEditContext(targetId);
    if (!context) return { available: false as const };
    const edit = context.edit as EditRecord;
    return {
      available: true as const,
      creatorUsername: context.workspace.profile.username,
      title: (edit.title as string) || (edit.titleAr as string) || "",
      caption: (edit.caption as string) || (edit.captionAr as string) || "",
      status: (edit.status as string) || "",
      access: (edit.access as string) || "",
    };
  }
  if (targetType === "comment") {
    if (!UUID_RE.test(targetId)) return { available: false as const };
    const [comment] = await db.select().from(editComments).where(eq(editComments.id, targetId));
    if (!comment) return { available: false as const };
    const context = await getEditContext(comment.editId);
    return {
      available: true as const,
      creatorUsername: context?.workspace.profile.username ?? "",
      editId: comment.editId,
      body: comment.body,
    };
  }
  // profile
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, targetId));
  if (!workspace) return { available: false as const };
  return { available: true as const, creatorUsername: workspace.profile.username, displayName: workspace.profile.displayName };
}

router.get("/admin/reports", async (req, res): Promise<void> => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const targetTypeParam = typeof req.query.targetType === "string" ? req.query.targetType : undefined;
  const statusFilter = statusParam && STATUS_SET.has(statusParam) ? statusParam : undefined;
  const targetTypeFilter = targetTypeParam && TARGET_TYPE_SET.has(targetTypeParam) ? targetTypeParam : undefined;

  const conditions = [
    statusFilter ? eq(reports.status, statusFilter) : undefined,
    targetTypeFilter ? eq(reports.targetType, targetTypeFilter) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  const query = db.select({
    id: reports.id, targetType: reports.targetType, targetId: reports.targetId, reason: reports.reason,
    details: reports.details, status: reports.status, adminNote: reports.adminNote,
    reviewedByUserId: reports.reviewedByUserId, reviewedAt: reports.reviewedAt,
    createdAt: reports.createdAt, updatedAt: reports.updatedAt,
    reporterUserId: reports.reporterUserId, reporterEmail: usersTable.email,
  }).from(reports).leftJoin(usersTable, eq(reports.reporterUserId, usersTable.id))
    .orderBy(desc(reports.createdAt));
  const rows = conditions.length ? await query.where(and(...conditions)) : await query;

  const withContext = await Promise.all(rows.map(async (row) => ({ ...row, context: await reportContext(row.targetType, row.targetId) })));
  res.json({ reports: withContext });
});

router.put("/admin/reports/:id", async (req, res): Promise<void> => {
  const admin = req.user;
  if (!(await isCurrentUserAdmin(admin))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const reportId = req.params.id;
  if (!UUID_RE.test(reportId)) { res.status(404).json({ error: "Report not found" }); return; }
  const status = typeof req.body?.status === "string" ? req.body.status : "";
  if (!REVIEW_STATUSES.has(status as ReportStatus)) { res.status(400).json({ error: "Status must be under_review, resolved, or dismissed" }); return; }
  const adminNote = typeof req.body?.adminNote === "string" ? req.body.adminNote.trim().slice(0, 1000) : "";
  if (NOTE_REQUIRED_STATUSES.has(status as ReportStatus) && !adminNote) {
    res.status(400).json({ error: "Write an internal note explaining this decision" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tastekin-report:${reportId}`}))`);
    const [current] = await tx.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!current) return null;
    const [row] = await tx.update(reports).set({
      status,
      adminNote: adminNote || current.adminNote,
      reviewedByUserId: admin!.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(reports.id, reportId)).returning();
    await tx.insert(moderationAuditLog).values({
      reportId, adminUserId: admin!.id, fromStatus: current.status, toStatus: status, note: adminNote || null,
    });
    return row;
  });
  if (!updated) { res.status(404).json({ error: "Report not found" }); return; }
  res.json(updated);
});

export default router;
