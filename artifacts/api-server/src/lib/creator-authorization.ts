import { creatorWorkspaces, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  if (!configuredFounderMatches(user)) return { ok: false as const, status: 403, error: "Only the verified Fheed creator can access this workspace" };

  const [account] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!account) return { ok: false as const, status: 403, error: "Authenticated account is not available" };
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
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
  if (workspace?.ownerUserId && workspace.ownerUserId !== userId) return false;
  if (!workspace?.ownerUserId) {
    const [claimed] = await db.update(creatorWorkspaces)
      .set({ ownerUserId: userId, updatedAt: new Date() })
      .where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID))
      .returning();
    return Boolean(claimed);
  }
  return true;
}