import { creatorWorkspaces, db, usersTable, verificationApplications } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { ensureCreatorAccount, isCurrentUserAdmin } from "../lib/creator-account";

const router: IRouter = Router();
const allowedStatuses = new Set(["pending", "approved", "rejected", "needs_improvement"]);
const reviewStatuses = new Set(["approved", "rejected", "needs_improvement"]);
const NEEDS_IMPROVEMENT_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;

function evidenceLinks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter((item) => /^https:\/\//i.test(item)).slice(0, 5);
}

function countPublishedEdits(edits: unknown) {
  if (!Array.isArray(edits)) return 0;
  return edits.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).status === "published").length;
}

router.get("/verification-application", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Sign in to view a verification application" }); return; }
  const [application] = await db.select().from(verificationApplications)
    .where(eq(verificationApplications.userId, req.user.id)).limit(1);
  res.json({ application: application ?? null });
});

router.post("/verification-application", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Sign in to apply for verification" }); return; }
  const creator = await ensureCreatorAccount(req.user);
  if (!creator.ok) { res.status(creator.status).json({ error: creator.error }); return; }
  if (creator.verified) { res.status(409).json({ error: "This creator is already verified" }); return; }
  const [existing] = await db.select().from(verificationApplications).where(eq(verificationApplications.userId, req.user.id)).limit(1);
  if (existing?.status === "needs_improvement" && existing.reEligibleAt && existing.reEligibleAt > new Date()) {
    res.status(403).json({ error: `You can reapply after ${existing.reEligibleAt.toISOString().slice(0, 10)}`, reEligibleAt: existing.reEligibleAt });
    return;
  }
  const statement = typeof req.body?.statement === "string" ? req.body.statement.trim() : "";
  if (statement.length < 40 || statement.length > 1500) {
    res.status(400).json({ error: "Tell TASTEKIN about your identity and original taste in 40–1500 characters" });
    return;
  }
  const links = evidenceLinks(req.body?.evidenceLinks);
  const [application] = await db.insert(verificationApplications).values({
    userId: req.user.id,
    statement,
    evidenceLinks: links,
    status: "pending",
    reviewNote: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reEligibleAt: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: verificationApplications.userId,
    set: { statement, evidenceLinks: links, status: "pending", reviewNote: null, reviewedByUserId: null, reviewedAt: null, reEligibleAt: null, updatedAt: new Date() },
  }).returning();
  res.status(201).json({ application });
});

router.get("/admin/creators", async (req, res) => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const statusFilter = statusParam && allowedStatuses.has(statusParam) ? statusParam : undefined;
  const query = db.select({
    creatorId: creatorWorkspaces.creatorId,
    profile: creatorWorkspaces.profile,
    ownerUserId: creatorWorkspaces.ownerUserId,
    edits: creatorWorkspaces.edits,
    email: usersTable.email,
    verified: usersTable.isVerified,
    applicationStatus: verificationApplications.status,
    applicationStatement: verificationApplications.statement,
    applicationLinks: verificationApplications.evidenceLinks,
    applicationCreatedAt: verificationApplications.createdAt,
    applicationReviewNote: verificationApplications.reviewNote,
    applicationReEligibleAt: verificationApplications.reEligibleAt,
  }).from(creatorWorkspaces)
    .leftJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .leftJoin(verificationApplications, eq(creatorWorkspaces.ownerUserId, verificationApplications.userId));
  const rows = statusFilter ? await query.where(eq(verificationApplications.status, statusFilter)) : await query;
  const creators = rows.map(({ edits, ...row }) => ({ ...row, publishedEditsCount: countPublishedEdits(edits) }));
  res.json({ creators });
});

router.put("/admin/creators/:creatorId/verification", async (req, res) => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const status = typeof req.body?.status === "string" ? req.body.status : "";
  if (!reviewStatuses.has(status)) { res.status(400).json({ error: "Status must be approved, needs_improvement, or rejected" }); return; }
  const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote.trim().slice(0, 1000) : "";
  const bypassEditRequirement = Boolean(req.body?.bypassEditRequirement);
  if ((status === "needs_improvement" || status === "rejected") && !reviewNote) {
    res.status(400).json({ error: "Write a note explaining this decision to the applicant" });
    return;
  }
  const [workspace] = await db.select().from(creatorWorkspaces)
    .where(eq(creatorWorkspaces.creatorId, req.params.creatorId)).limit(1);
  if (!workspace?.ownerUserId) { res.status(404).json({ error: "Creator account not found" }); return; }
  if (status === "approved" && !bypassEditRequirement && countPublishedEdits(workspace.edits) === 0) {
    res.status(409).json({ error: "This creator has no published Edits yet. Use \"Bypass Edit requirement & Approve\" for outreach/invited creators." });
    return;
  }

  const reEligibleAt = status === "needs_improvement" ? new Date(Date.now() + NEEDS_IMPROVEMENT_COOLDOWN_MS) : null;
  const reviewed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tastekin-verification:${workspace.ownerUserId}`}))`);
    const [application] = await tx.select({ userId: verificationApplications.userId }).from(verificationApplications)
      .where(eq(verificationApplications.userId, workspace.ownerUserId!)).limit(1);
    if (!application) return false;
    await tx.update(usersTable).set({ isVerified: status === "approved", updatedAt: new Date() })
      .where(eq(usersTable.id, workspace.ownerUserId!));
    await tx.update(verificationApplications).set({
      status,
      reviewNote: reviewNote || null,
      reviewedByUserId: req.user!.id,
      reviewedAt: new Date(),
      reEligibleAt,
      updatedAt: new Date(),
    }).where(eq(verificationApplications.userId, workspace.ownerUserId!));
    return true;
  });
  if (!reviewed) { res.status(409).json({ error: "This creator must submit a Taste Seal application before review" }); return; }
  res.json({ creatorId: workspace.creatorId, verified: status === "approved", status });
});

export default router;
