import { normalizeLegacyEdit } from "./edit-access";

export type CircleCandidate = {
  ownerUserId: string | null;
  verified: boolean;
};

export function circleAddDecision(viewerId: string, candidate: CircleCandidate | null, blocked: boolean) {
  if (!candidate) return "not_found" as const;
  if (blocked) return "not_found" as const;
  if (candidate.ownerUserId === viewerId) return "self" as const;
  if (!candidate.verified) return "unverified" as const;
  return "allowed" as const;
}

export function circleFeedVisible(ownerUserId: string | null, viewerUserId: string, verified: boolean, member: boolean, blockedOwners: Set<string>) {
  return member && verified && ownerUserId !== viewerUserId && (!ownerUserId || !blockedOwners.has(ownerUserId));
}

/**
 * Public shape of a Circle Edit: every Edit is public (legacy `locked` values
 * are normalized), private object paths are rewritten to the public-media
 * route, and the source/preview renditions are never exposed.
 */
export function sanitizeCircleEdit(edit: Record<string, unknown>, username: string) {
  const normalized = normalizeLegacyEdit(edit);
  const image = typeof normalized.image === "string" && normalized.image.startsWith("/objects/")
    ? `/api/public-media/${encodeURIComponent(username)}/${normalized.id}`
    : normalized.image;
  return { ...normalized, image, sourceImage: undefined, previewImage: undefined };
}
