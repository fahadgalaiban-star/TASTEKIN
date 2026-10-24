import { creatorFollows, creatorWorkspaces, db, editSaves } from "@workspace/db";
import { creatorPlacesForDestination, type CreatorPlace, type CreatorPlaceSource } from "@workspace/taste-catalog";
import { eq } from "drizzle-orm";

import { blockedCounterpartIds } from "./blocks";

/**
 * Taste in KIN Travel (feature flag taste_everywhere): the real places this
 * member already trusts, for one destination.
 *
 * Sources are the member's OWN relationships only: Edits they saved and
 * creators they follow. Only published Edits that carry a place name count.
 * Creators the member has a mutual block with are skipped, as everywhere
 * else. No count of any kind is read; the selection itself is the pure
 * creatorPlacesForDestination in @workspace/taste-catalog.
 */
export async function creatorPlacesForViewer(userId: string, destination: string): Promise<CreatorPlace[]> {
  const [saved, followed, blocked, workspaces] = await Promise.all([
    db.select({ editId: editSaves.editId }).from(editSaves).where(eq(editSaves.userId, userId)),
    db.select({ creatorId: creatorFollows.creatorId }).from(creatorFollows).where(eq(creatorFollows.followerUserId, userId)),
    blockedCounterpartIds(userId),
    db.select({ creatorId: creatorWorkspaces.creatorId, ownerUserId: creatorWorkspaces.ownerUserId, profile: creatorWorkspaces.profile, edits: creatorWorkspaces.edits, updatedAt: creatorWorkspaces.updatedAt }).from(creatorWorkspaces),
  ]);
  const savedIds = new Set(saved.map((row) => row.editId));
  const followedIds = new Set(followed.map((row) => row.creatorId));
  if (!savedIds.size && !followedIds.size) return [];

  const sources: CreatorPlaceSource[] = [];
  for (const workspace of workspaces) {
    // The member's own Edits are not "a creator they follow"; skip them and anyone blocked.
    if (workspace.ownerUserId === userId || (workspace.ownerUserId && blocked.has(workspace.ownerUserId))) continue;
    const profile = (workspace.profile ?? {}) as { username?: unknown; displayName?: unknown };
    const username = typeof profile.username === "string" ? profile.username : "";
    const displayName = typeof profile.displayName === "string" ? profile.displayName : username;
    if (!username) continue;
    const follows = followedIds.has(workspace.creatorId);
    const edits = Array.isArray(workspace.edits) ? workspace.edits : [];
    for (const value of edits) {
      if (!value || typeof value !== "object") continue;
      const edit = value as Record<string, unknown>;
      if (edit.status !== "published" || typeof edit.id !== "string") continue;
      const placeName = typeof edit.placeName === "string" ? edit.placeName.trim() : "";
      if (!placeName) continue;
      const via = savedIds.has(edit.id) ? "saved" : follows ? "followed" : null;
      if (!via) continue;
      sources.push({
        editId: edit.id,
        creatorUsername: username,
        creatorDisplayName: displayName,
        placeName,
        locationLabel: typeof edit.locationLabel === "string" ? edit.locationLabel : null,
        location: typeof edit.location === "string" ? edit.location : null,
        locationAr: typeof edit.locationAr === "string" ? edit.locationAr : null,
        mapsUrl: typeof edit.mapsUrl === "string" ? edit.mapsUrl : null,
        via,
        updatedAt: workspace.updatedAt,
      });
    }
  }
  return creatorPlacesForDestination(sources, destination);
}
