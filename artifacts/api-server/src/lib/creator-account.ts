import crypto from "node:crypto";

import { creatorMediaUploads, creatorWorkspaces, db, usersTable, type CreatorProfileRecord } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

import { FHEED_CREATOR_ID, fheedWorkspaceSeed } from "./creator-workspace-seed";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

function configuredFounderMatches(user: AuthenticatedUser) {
  const founderId = process.env.FOUNDER_AUTH_USER_ID?.trim();
  const founderEmail = process.env.FOUNDER_EMAIL?.trim().toLowerCase();
  if (founderId) return user.id === founderId;
  return Boolean(founderEmail && user.email?.trim().toLowerCase() === founderEmail);
}

export function isTastekinAdmin(user: AuthenticatedUser | undefined) {
  if (!user) return false;
  const additionalIds = (process.env.ADMIN_AUTH_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return configuredFounderMatches(user) || additionalIds.includes(user.id);
}

export function founderMappingConfigured() {
  return Boolean(process.env.FOUNDER_AUTH_USER_ID?.trim() || process.env.FOUNDER_EMAIL?.trim());
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
}

function displayNameFor(user: AuthenticatedUser) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email?.split("@")[0] || "TASTEKIN member";
}

function initialProfile(user: AuthenticatedUser, username: string): CreatorProfileRecord {
  return {
    displayName: displayNameFor(user),
    username,
    bio: "",
    city: "",
    country: "",
    interests: [],
    dateOfBirth: null,
    showAge: false,
    avatar: user.profileImageUrl || "",
  };
}

export async function creatorForUser(userId: string) {
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, userId)).limit(1);
  return workspace ?? null;
}

export async function creatorByUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  const [workspace] = await db.select().from(creatorWorkspaces)
    .where(sql`lower(${creatorWorkspaces.profile}->>'username') = ${normalized}`)
    .limit(1);
  return workspace ?? null;
}

/**
 * Every authenticated member receives an isolated creator workspace. The
 * founder alone inherits the seeded Fheed workspace and verification state.
 */
export async function ensureCreatorAccount(user: AuthenticatedUser) {
  const [account] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  if (!account) return { ok: false as const, status: 403, error: "Authenticated account is not available" };

  const existing = await creatorForUser(user.id);
  if (existing) {
    if (account.role !== "creator") {
      await db.update(usersTable).set({ role: "creator", updatedAt: new Date() }).where(eq(usersTable.id, user.id));
    }
    return { ok: true as const, workspace: existing, userId: user.id, verified: account.isVerified };
  }

  if (configuredFounderMatches(account)) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tastekin-founder-workspace'))`);
      let [workspace] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
      if (!workspace) {
        [workspace] = await tx.insert(creatorWorkspaces).values({
          creatorId: FHEED_CREATOR_ID,
          ownerUserId: user.id,
          edits: Array.from(fheedWorkspaceSeed.edits) as unknown[],
          collections: Array.from(fheedWorkspaceSeed.collections) as unknown[],
          profile: { ...fheedWorkspaceSeed.profile, interests: [...fheedWorkspaceSeed.profile.interests] },
        }).returning();
      } else if (workspace.ownerUserId !== user.id) {
        const oldOwner = workspace.ownerUserId;
        [workspace] = await tx.update(creatorWorkspaces).set({ ownerUserId: user.id, updatedAt: new Date() })
          .where(and(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID), oldOwner ? eq(creatorWorkspaces.ownerUserId, oldOwner) : sql`${creatorWorkspaces.ownerUserId} is null`))
          .returning();
        if (oldOwner && workspace) {
          await tx.update(creatorMediaUploads).set({ ownerUserId: user.id, updatedAt: new Date() })
            .where(and(eq(creatorMediaUploads.creatorId, FHEED_CREATOR_ID), eq(creatorMediaUploads.ownerUserId, oldOwner), sql`${creatorMediaUploads.state} <> 'deleted'`));
        }
      }
      await tx.update(usersTable).set({ role: "creator", isVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      return workspace;
    });
    if (!result) return { ok: false as const, status: 409, error: "Founder workspace ownership changed. Reload and retry." };
    return { ok: true as const, workspace: result, userId: user.id, verified: true };
  }

  const workspace = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tastekin-account:${user.id}`}))`);
    const [alreadyCreated] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, user.id)).limit(1);
    if (alreadyCreated) return alreadyCreated;

    const base = slug(account.email?.split("@")[0] || displayNameFor(account)) || "member";
    let username = base;
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const [taken] = await tx.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces)
        .where(sql`lower(${creatorWorkspaces.profile}->>'username') = ${username}`).limit(1);
      if (!taken) break;
      username = `${base.slice(0, 20)}_${suffix + 2}`;
    }
    const creatorId = `creator_${crypto.createHash("sha256").update(user.id).digest("hex").slice(0, 20)}`;
    const [created] = await tx.insert(creatorWorkspaces).values({
      creatorId,
      ownerUserId: user.id,
      edits: [],
      collections: [],
      profile: initialProfile(account, username),
    }).returning();
    await tx.update(usersTable).set({ role: "creator", updatedAt: new Date() }).where(eq(usersTable.id, user.id));
    return created;
  });

  return { ok: true as const, workspace, userId: user.id, verified: false };
}

export async function requireCreator(user: AuthenticatedUser | undefined) {
  if (!user) return { ok: false as const, status: 401, error: "Sign in to access creator tools" };
  return ensureCreatorAccount(user);
}
