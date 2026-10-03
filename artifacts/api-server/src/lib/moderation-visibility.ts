/** Endpoint-specific projections: IDs are interpreted only in their declared namespace. */
export type Visibility = {
  editIds: Set<string>; commentIds: Set<string>; userIds: Set<string>;
  creatorIds: Set<string>; usernames: Set<string>; media: Set<string>;
  editTargets: Map<string, Set<string>>; creatorByUsername: Map<string, string>;
  trustedOrigins: Set<string>;
};
export function emptyVisibility(): Visibility {
  return { editIds: new Set(), commentIds: new Set(), userIds: new Set(), creatorIds: new Set(),
    usernames: new Set(), media: new Set(), editTargets: new Map(), creatorByUsername: new Map(), trustedOrigins: new Set() };
}
type Row = Record<string, unknown>;
const record = (x: unknown): Row => x && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const strings = (x: unknown): string[] => Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
const list = (x: unknown, f: (row: Row) => unknown): unknown[] =>
  Array.isArray(x) ? x.map((r) => f(record(r))).filter((r) => r !== undefined) : [];
const pathParts = (path: string) => path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
export function hiddenEdit(id: unknown, v: Visibility, creator?: unknown): boolean {
  if (typeof id !== "string") return false;
  if (typeof creator === "string") {
    if (v.usernames.has(creator) || v.creatorIds.has(creator)) return true;
    const creatorId = v.creatorByUsername.get(creator) ?? creator;
    if (v.editTargets.size) return Boolean(v.editTargets.get(creatorId)?.has(id));
  }
  return v.editIds.has(id);
}
function suspendedCreator(row: Row, v: Visibility): boolean {
  return [row.username, row.creatorUsername].some((s) => typeof s === "string" && v.usernames.has(s))
    || typeof row.creatorId === "string" && v.creatorIds.has(row.creatorId);
}
/** Used only for declared media/citation URLs, never for arbitrary string fields. */
export function blockedReference(value: unknown, v: Visibility): boolean {
  if (typeof value !== "string") return false;
  if (v.media.has(value)) return true;
  let parts: string[];
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" && !v.trustedOrigins.has(url.origin)) return false;
    parts = pathParts(url.pathname);
  }
  catch { return false; }
  if (parts[0] === "api") parts.shift();
  if (parts[0] === "public-media") return v.usernames.has(parts[1]) || hiddenEdit(parts[2], v, parts[1]);
  if (parts[0] === "public-profile-media") return v.usernames.has(parts[1]);
  if (parts[0] === "edits") return hiddenEdit(parts[1], v);
  if (parts[0] === "creators") return v.usernames.has(parts[1]);
  return false;
}
function edit(row: Row, v: Visibility, creator?: unknown): unknown {
  if (hiddenEdit(row.id, v, row.creatorUsername ?? creator)) return undefined;
  return row;
}
function collection(row: Row, v: Visibility, creator?: unknown): unknown {
  if (suspendedCreator(row, v)) return undefined;
  const out = { ...row };
  if (Array.isArray(row.editIds)) out.editIds = strings(row.editIds).filter((id) => !hiddenEdit(id, v, row.creatorUsername ?? creator));
  if (Array.isArray(row.edits)) out.edits = list(row.edits, (r) => edit(r, v, row.creatorUsername ?? creator));
  if (Array.isArray(row.items)) out.items = list(row.items, (r) =>
    typeof r.editId === "string" && hiddenEdit(r.editId, v, row.creatorUsername ?? creator) ? undefined : r);
  if (hiddenEdit(row.coverEditId, v, row.creatorUsername ?? creator)) out.coverEditId = "";
  if (Array.isArray(row.uploads)) out.uploads = list(row.uploads, (r) =>
    blockedReference(r.image, v) || blockedReference(r.imageObjectPath, v) ? undefined : r);
  if (Array.isArray(row.itemOrder)) {
    const uploadIds = new Set(list(out.uploads, (r) => r).map((r) => record(r).id));
    out.itemOrder = strings(row.itemOrder).filter((id) => uploadIds.has(id) || !hiddenEdit(id, v, row.creatorUsername ?? creator));
  }
  // These fields are actual content references, unlike a Collection's own id/name.
  for (const key of ["coverImage", "image"]) if (blockedReference(row[key], v)) out[key] = "";
  if (blockedReference(row.coverImageObjectPath, v)) out.coverImageObjectPath = null;
  if (Array.isArray(row.photos)) out.photos = row.photos.filter((url) => !blockedReference(url, v));
  return out;
}
function creator(row: Row, v: Visibility, scope?: unknown): unknown {
  if (suspendedCreator(row, v) || typeof row.id === "string" && v.creatorIds.has(row.id)) return undefined;
  const out = { ...row };
  if (Array.isArray(row.edits)) { out.edits = list(row.edits, (r) => edit(r, v, row.username ?? scope)); out.editCount = (out.edits as unknown[]).length; }
  if (Array.isArray(row.collections)) out.collections = list(row.collections, (r) => collection(r, v, row.username ?? scope));
  for (const key of ["avatar", "coverImage"]) if (blockedReference(row[key], v)) out[key] = "";
  return out;
}
function feedItem(row: Row, v: Visibility): unknown {
  if (suspendedCreator(row, v) || edit(record(row.edit), v, row.creatorUsername) === undefined) return undefined;
  return row;
}
/** Only provenance fields of KIN's actual citation/result/snapshot structures. */
function kinBlocked(row: Row, v: Visibility): boolean {
  if (typeof row.sourceEditId === "string" && hiddenEdit(row.sourceEditId, v, row.sourceCreatorId)) return true;
  if (typeof row.sourceUserId === "string" && v.userIds.has(row.sourceUserId)) return true;
  for (const key of ["citations", "results"]) {
    if (Array.isArray(row[key]) && row[key].some((item) => {
      const r = record(item);
      return blockedReference(r.url, v) || blockedReference(r.imageUrl, v)
        || typeof r.sourceEditId === "string" && hiddenEdit(r.sourceEditId, v, r.sourceCreatorId);
    })) return true;
  }
  return false;
}
export function consumerSurface(path: string): string | null {
  if (path === "/creator-workspace") return "workspace";
  if (path === "/creator-profile") return "creator";
  if (path === "/creator-featured-collections") return "featured";
  if (path === "/feed") return "feed";
  if (path === "/public-feed" || path === "/circle/feed") return "wrapped-feed";
  if (path === "/explore") return "explore";
  if (path === "/creators" || path === "/circle/members") return "creators";
  if (/^\/creators\/[^/]+(?:\/profile)?$/.test(path)) return "creator";
  if (/^\/creators\/[^/]+\/workspace$/.test(path)) return "workspace";
  if (/^\/creators\/[^/]+\/featured-collections$/.test(path)) return "featured";
  if (/^\/taste-match\/[^/]+$/.test(path)) return "taste-match";
  if (/^\/edits\/[^/]+\/comments(?:\/[^/]+)?$/.test(path)) return "comments";
  if (/^\/edits\/[^/]+(?:\/(?:engagement|like|save))?$/.test(path)) return "edit";
  if (path === "/me/saved-edits") return "saved-edits";
  if (/^\/me\/saved-lists(?:\/[^/]+(?:\/edits\/[^/]+)?)?$/.test(path)) return "saved-lists";
  if (/^\/(?:public-media|public-profile-media)\//.test(path)) return "media";
  if (/^\/(?:circle\/members|relationships\/follow)\/[^/]+$/.test(path) || path === "/relationships"
      || /^\/creators\/[^/]+\/views$/.test(path)) return "relationship";
  if (/^\/kin\/saved(?:\/[^/]+)?$/.test(path)) return "kin-saved";
  if (/^\/kin\/(?:search|looks\/generate|looks|travel\/(?:plan|swap-place|stays))$/.test(path)) return "kin-result";
  // Trips contain provider place IDs and user text, NOT Edit/comment IDs.
  if (/^\/kin\/trips(?:\/[^/]+(?:\/items(?:\/[^/]+)?)?)?$/.test(path)) return "kin-trips";
  return null;
}
export const isConsumerContentPath = (path: string) => consumerSurface(path) !== null;
export function blockedConsumerRequest(path: string, body: unknown, v: Visibility): boolean {
  const surface = consumerSurface(path), parts = pathParts(path), row = record(body);
  if (parts[0] === "edits") return hiddenEdit(parts[1], v) || parts[2] === "comments" && v.commentIds.has(parts[3]);
  if (parts[0] === "creators") return v.usernames.has(parts[1]);
  if (parts[0] === "taste-match") return v.usernames.has(parts[1]);
  if (surface === "media") return blockedReference(path, v);
  if (surface === "saved-lists" && parts[3] === "edits") return hiddenEdit(parts[4], v);
  if (surface === "relationship") return [parts[2], row.targetId].some((s) =>
    typeof s === "string" && (v.usernames.has(s) || v.creatorIds.has(s)));
  if (surface === "kin-saved" || surface === "kin-result") return kinBlocked(row, v);
  return false;
}
export function projectConsumerResponse(path: string, body: unknown, v: Visibility): unknown {
  const surface = consumerSurface(path), row = record(body), username = pathParts(path)[1] ?? record(row.profile).username ?? row.creatorId;
  if (surface === "feed") return list(body, (r) => edit(r, v));
  if (surface === "wrapped-feed") return Array.isArray(body) ? list(body, (r) => feedItem(r, v))
    : { ...row, items: list(row.items, (r) => feedItem(r, v)) };
  if (surface === "creators") return list(body, (r) => creator(r, v));
  if (surface === "creator") return creator(row, v, username);
  if (surface === "workspace") return suspendedCreator(record(row.profile), v) ? undefined :
    { ...row, edits: list(row.edits, (r) => edit(r, v, username)),
      collections: list(row.collections, (r) => collection(r, v, username)) };
  if (surface === "explore") return { ...row, creators: list(row.creators, (r) => creator(r, v)),
    edits: list(row.edits, (r) => edit(r, v)), collections: list(row.collections, (r) => collection(r, v)) };
  if (surface === "taste-match") return creator(record(row.creator), v) === undefined ? undefined : body;
  if (surface === "comments") {
    const project = (r: Row) => typeof r.id === "string" && v.commentIds.has(r.id) ? undefined : r;
    return Array.isArray(body) ? list(body, project) : project(row);
  }
  if (surface === "edit") return path.split("/").length === 3 ? edit(row, v) : body;
  if (surface === "saved-edits") return strings(body).filter((id) => !hiddenEdit(id, v));
  if (surface === "saved-lists") {
    const project = (r: Row) => collection(r, v);
    return Array.isArray(body) ? list(body, project) : project(row);
  }
  if (surface === "kin-saved" || surface === "kin-result") {
    if (surface === "kin-saved" && Array.isArray(row.items)) return { ...row, items: list(row.items, (r) => kinBlocked(r, v) ? undefined : r) };
    return kinBlocked(row, v) ? undefined : body;
  }
  // Featured collection IDs, provider place IDs, counts, flags, arbitrary nested
  // metadata and private/admin responses are not recursively interpreted.
  return body;
}