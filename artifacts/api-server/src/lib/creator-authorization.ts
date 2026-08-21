import { creatorMediaUploads, creatorWorkspaces, db, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export const FHEED_CREATOR_ID = "fheed";
export const FHEED_HANDLE = "fheed";
export const FHEED_DISPLAY_NAME = "Fheed Alaiban";

type AuthenticatedUser = { id: string; email: string | null };

function configuredFounderMatches(user: AuthenticatedUser) {
  const founderId = process.env.FOUNDER_AUTH_USER_ID?.trim();
  const founderEmail = process.env.FOUNDER_EMAIL?.trim().toLowerCase();
  if (founderId) return user.id === founderId;
  return Boolean(founderEmail && user.email?.trim().toLowerCase() === founderEmail);
}

export function founderMappingConfigured() {
  return Boolean(process.env.FOUNDER_AUTH_USER_ID?.trim() || process.env.FOUNDER_EMAIL?.trim());
}

export async function authorizeFheedCreator(user: AuthenticatedUser | undefined) {
  if (!user) return { ok: false as const, status: 401, error: "Sign in to access creator tools" };
  if (!founderMappingConfigured()) return { ok: false as const, status: 503, error: "Founder creator ownership is not configured" };

  const [account] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!account) return { ok: false as const, status: 403, error: "Authenticated account is not available" };
  if (!configuredFounderMatches({ id: account.id, email: account.email })) return { ok: false as const, status: 403, error: "Only the verified Fheed creator can access this workspace" };
  if (account.role !== "creator" || !account.isVerified) {
    await db.update(usersTable).set({ role: "creator", isVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
  }

  return {
    ok: true as const,
    userId: user.id,
    email: account.email,
    role: "creator" as const,
    verified: true as const,
  };
}

export async function claimFheedWorkspace(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(842611)`);
    const [workspace] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
    if (!workspace) return { ok: false as const, transferred: false };
    if (workspace.ownerUserId === userId) return { ok: true as const, transferred: false };

    const [claimed] = await tx.update(creatorWorkspaces)
      .set({ ownerUserId: userId, updatedAt: new Date() })
      .where(and(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID), workspace.ownerUserId ? eq(creatorWorkspaces.ownerUserId, workspace.ownerUserId) : sql`${creatorWorkspaces.ownerUserId} is null`))
      .returning();
    if (!claimed) return { ok: false as const, transferred: false };

    if (workspace.ownerUserId) {
      await tx.update(creatorMediaUploads)
        .set({ ownerUserId: userId, updatedAt: new Date() })
        .where(and(eq(creatorMediaUploads.creatorId, FHEED_CREATOR_ID), eq(creatorMediaUploads.ownerUserId, workspace.ownerUserId), sql`${creatorMediaUploads.state} <> 'deleted'`));
    }
    return { ok: true as const, transferred: Boolean(workspace.ownerUserId) };
  });
}