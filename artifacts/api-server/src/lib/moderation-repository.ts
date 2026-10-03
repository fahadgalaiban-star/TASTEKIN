import { creatorWorkspaces, db, editComments, moderationAuditLog, moderationContentStates, nativeSessionsTable, reports, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ModerationError, type ModerationRepository, type ModerationTarget, type ModerationTransaction } from "./moderation-policy";
type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export async function resolveModerationTarget(tx: Executor, reportId: string): Promise<ModerationTarget | null> {
  const [report] = await tx.select().from(reports).where(eq(reports.id, reportId));
  if (!report || !["edit", "comment", "profile"].includes(report.targetType)) return null;
  let comment: typeof editComments.$inferSelect | undefined;
  let workspace: typeof creatorWorkspaces.$inferSelect | undefined;
  let data: Record<string, unknown> | undefined;
  if (report.targetType === "profile") {
    [workspace] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, report.targetId));
    data = workspace ? { username: workspace.profile.username, displayName: workspace.profile.displayName, bio: workspace.profile.bio } : undefined;
  } else {
    if (report.targetType === "comment") {
      [comment] = await tx.select().from(editComments).where(eq(editComments.id, report.targetId));
      if (!comment) return null;
    }
    const editId = comment?.editId ?? report.targetId;
    const rows = await tx.select().from(creatorWorkspaces);
    workspace = rows.find((row) => row.edits.some((edit: unknown) => !!edit && typeof edit === "object" && (edit as { id?: unknown }).id === editId));
    data = comment ? { ...comment } : workspace?.edits.find((edit: unknown) => !!edit && typeof edit === "object" && (edit as { id?: unknown }).id === editId) as Record<string, unknown> | undefined;
  }
  const ownerUserId = comment?.userId ?? workspace?.ownerUserId;
  if (!workspace || !ownerUserId || !data) return null;
  const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, ownerUserId));
  if (!user) return null;
  const [founderWorkspace] = await tx.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces)
    .where(and(eq(creatorWorkspaces.creatorId, "fheed"), eq(creatorWorkspaces.ownerUserId, ownerUserId)));
  const [state] = await tx.select().from(moderationContentStates).where(and(
    eq(moderationContentStates.targetType, report.targetType), eq(moderationContentStates.creatorId, workspace.creatorId), eq(moderationContentStates.targetId, report.targetId),
  ));
  return {
    targetType: report.targetType as ModerationTarget["targetType"], targetId: report.targetId,
    creatorId: workspace.creatorId, ownerUserId, data, hidden: Boolean(state?.isHidden),
    suspended: user.isSuspended,
    protectedAccount: user.isAdmin || Boolean(founderWorkspace) || user.role === "owner" || user.role === "admin"
      || Boolean(process.env.FOUNDER_AUTH_USER_ID && user.id === process.env.FOUNDER_AUTH_USER_ID)
      || Boolean(process.env.FOUNDER_EMAIL && user.email?.toLowerCase() === process.env.FOUNDER_EMAIL.trim().toLowerCase()),
  };
}

function bindings(tx: Executor): ModerationTransaction {
  return {
    isAdmin: async (id) => {
      const [user] = await tx.select({ admin: usersTable.isAdmin, suspended: usersTable.isSuspended }).from(usersTable).where(eq(usersTable.id, id));
      return Boolean(user?.admin && !user.suspended);
    },
    target: (id) => resolveModerationTarget(tx, id),
    lock: async (key) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`); },
    changeContent: async (target, hidden) => {
      await tx.insert(moderationContentStates).values({
        targetType: target.targetType, creatorId: target.creatorId, targetId: target.targetId, isHidden: hidden,
      }).onConflictDoUpdate({
        target: [moderationContentStates.targetType, moderationContentStates.creatorId, moderationContentStates.targetId],
        set: { isHidden: hidden, updatedAt: new Date() },
      });
    },
    changeAccount: async (id, suspended) => { await tx.update(usersTable).set({ isSuspended: suspended }).where(eq(usersTable.id, id)); },
    expireSessions: async (id) => {
      const now = new Date();
      await tx.update(nativeSessionsTable).set({ revokedAt: now, revokedReason: "moderation_suspension" })
        .where(and(eq(nativeSessionsTable.userId, id), isNull(nativeSessionsTable.revokedAt)));
      await tx.update(sessionsTable).set({ expire: now }).where(sql`${sessionsTable.sess}->'user'->>'id' = ${id}`);
    },
    audit: async (reportId, entry) => {
      const [report] = await tx.select().from(reports).where(eq(reports.id, reportId));
      if (!report) throw new ModerationError(404, "Report unavailable.");
      const [row] = await tx.insert(moderationAuditLog).values({
        ...entry, reportId, fromStatus: report.status, toStatus: report.status, createdAt: sql`clock_timestamp()`,
      }).returning();
      return { ...entry, id: row.id, reportId, createdAt: row.createdAt.toISOString() };
    },
  };
}
export const moderationRepository: ModerationRepository = {
  transaction: (callback) => db.transaction((tx) => callback(bindings(tx))),
};