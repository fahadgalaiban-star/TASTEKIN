/**
 * TASTEKIN v1 is completely free: there are no subscriptions, no locked or
 * "subscribers only" Edits/collections, and no paywall. Historical workspace
 * documents can still carry the legacy `access: "locked"` value (and the two
 * original demo Edits whose only photo was a blurred preview asset), so every
 * read path normalizes them here instead of rewriting stored data: a legacy
 * locked Edit is simply a public Edit now. Nothing in this module deletes or
 * mutates persisted rows — the next ordinary workspace save by its owner
 * persists the normalized (public) value through the normal save path.
 */
export type WorkspaceEditRecord = Record<string, unknown>;
export type WorkspaceCollectionRecord = Record<string, unknown>;

// Demo seeds from the original single-creator prototype referenced a
// `private-hotel-source.webp` that never shipped as a static asset; the
// preview renditions are the only files that exist, so keep pointing at them
// rather than a broken image.
const LEGACY_DEMO_PREVIEWS: Record<string, string> = {
  "private-hotel": "/tastekin-media/private-hotel-preview.webp",
  "training-week": "/tastekin-media/training-week-preview.webp",
};
const LEGACY_MISSING_SOURCE = "/tastekin-media/private-hotel-source.webp";

export function isLegacyLockedAccess(value: unknown): boolean {
  return value === "locked";
}

/**
 * Returns the Edit as the free product understands it: `access` is always
 * "public"; a legacy locked Edit keeps whichever photo it actually has
 * (`image`, falling back to its former preview when the stored image is the
 * never-shipped demo source). `previewImage` is dropped — nothing serves a
 * blurred rendition any more.
 */
export function normalizeLegacyEdit(edit: WorkspaceEditRecord): WorkspaceEditRecord {
  if (!edit || typeof edit !== "object") return edit;
  const id = typeof edit.id === "string" ? edit.id : "";
  const legacyPreview = LEGACY_DEMO_PREVIEWS[id];
  let image = edit.image;
  if (image === LEGACY_MISSING_SOURCE && legacyPreview) image = legacyPreview;
  if (isLegacyLockedAccess(edit.access) && (typeof image !== "string" || !image) && typeof edit.previewImage === "string") image = edit.previewImage;
  if (!isLegacyLockedAccess(edit.access) && image === edit.image && edit.previewImage === undefined && edit.access === "public") return edit;
  const { previewImage: _previewImage, ...rest } = edit;
  return { ...rest, image, access: "public" };
}

/** Collections are always public in the free product; legacy `locked` is read as public. */
export function normalizeLegacyCollection(collection: WorkspaceCollectionRecord): WorkspaceCollectionRecord {
  if (!collection || typeof collection !== "object") return collection;
  if (collection.access === "public") return collection;
  return { ...collection, access: "public" };
}

/**
 * Write-side coercion for the workspace save route: an old client that still
 * submits `access: "locked"` is accepted (backward-compatible parsing) but the
 * value persisted is always "public". No other field is touched.
 */
export function coerceAccessToPublic<T extends Record<string, unknown>>(record: T): T {
  if (record.access === "public") return record;
  return { ...record, access: "public" };
}
