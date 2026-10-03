/** Pure visibility boundary shared by all consumer read paths; no database/provider imports. */
export type Visibility = {
  editIds: Set<string>; commentIds: Set<string>; userIds: Set<string>;
  creatorIds: Set<string>; usernames: Set<string>; media: Set<string>;
};
export function emptyVisibility(): Visibility {
  return { editIds: new Set(), commentIds: new Set(), userIds: new Set(), creatorIds: new Set(), usernames: new Set(), media: new Set() };
}
export function blockedReference(value: unknown, v: Visibility): boolean {
  if (typeof value !== "string") return false;
  if (v.editIds.has(value) || v.commentIds.has(value) || v.userIds.has(value) || v.creatorIds.has(value) || v.media.has(value)) return true;
  let path = value;
  try { path = decodeURIComponent(new URL(value, "https://local.invalid").pathname); } catch { return false; }
  const parts = path.split("/").filter(Boolean);
  if (path.includes("/public-media/") || path.includes("/edits/")) return parts.some((id) => v.editIds.has(id));
  if (path.includes("/public-profile-media/") || path.includes("/creators/")) return parts.some((name) => v.usernames.has(name));
  return false;
}
export function redactPublic(value: unknown, v: Visibility, field = ""): unknown {
  if (typeof value === "string") return blockedReference(value, v) ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => redactPublic(item, v, field)).filter((item) => item !== undefined);
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  for (const key of ["id", "editId", "commentId", "userId", "ownerUserId", "creatorId", "targetId", "sourceEditId", "referenceId",
    "sourceId", "edit_id", "comment_id", "user_id", "owner_user_id", "creator_id", "target_id", "source_edit_id"]) {
    if (blockedReference(row[key], v)) return undefined;
  }
  if (typeof row.username === "string" && v.usernames.has(row.username)) return undefined;
  const out: Record<string, unknown> = {};
  let redacted = false;
  for (const [key, item] of Object.entries(row)) {
    const result = redactPublic(item, v, key);
    if (result !== undefined) out[key] = result;
    if (result === undefined || (Array.isArray(item) && Array.isArray(result) && item.length !== result.length)) redacted = true;
  }
  // Public-feed/Circle/Saved wrap their required Edit. Drop the whole wrapper
  // instead of returning an invalid item with its required `edit` missing.
  if ("edit" in row && out.edit === undefined) return undefined;
  if ("comment" in row && out.comment === undefined) return undefined;
  // Saved KIN answers/snapshots can contain copied text from a removed citation:
  // discard the entire snapshot, rather than just concealing its source link.
  if (redacted && ("answer" in row || "citations" in row || "sourceEditId" in row)) return undefined;
  if (typeof row.image === "string" && blockedReference(row.image, v)) return undefined;
  if (redacted) for (const key of ["caption", "captionAr", "summary", "previewText", "coverImage"]) delete out[key];
  return out;
}
/** Administrative inspection and private workspace editing deliberately do not use this public projection. */
export function isConsumerContentPath(path: string): boolean {
  return /^\/(?:public(?:-|\/)|feed(?:\/|$)|explore(?:\/|$)|taste-match(?:\/|$)|creators(?:\/|$)|edits(?:\/|$)|circle(?:\/|$)|kin(?:\/|$)|me\/saved|relationships\/follow)/.test(path);
}