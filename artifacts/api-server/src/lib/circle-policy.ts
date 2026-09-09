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

export function sanitizeCircleEdit(edit: Record<string, unknown>, username: string) {
  if (edit.access === "locked" && typeof edit.previewImage !== "string") return null;
  const locked = edit.access === "locked";
  const preview = edit.previewImage;
  const image = locked
    ? (preview as string).startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(username)}/${edit.id}/preview` : preview
    : typeof edit.image === "string" && edit.image.startsWith("/objects/")
      ? `/api/public-media/${encodeURIComponent(username)}/${edit.id}` : edit.image;
  return { ...edit, image, sourceImage: undefined, previewImage: undefined };
}