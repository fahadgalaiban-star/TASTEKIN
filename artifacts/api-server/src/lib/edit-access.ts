/**
 * TASTEKIN v1 is completely free: there are no subscriptions, no locked or
 * "subscribers only" Edits/collections, no paywall, and no blurred "preview"
 * renditions. Historical workspace documents can still carry the legacy
 * `access: "locked"` value, a `previewImage` (the blurred rendition the old
 * paywall showed to non-subscribers), or an `image` that itself points at a
 * blurred preview asset (the two original demo Edits whose ONLY photo was a
 * blurred preview file). Every read path normalizes them here instead of
 * rewriting stored data: a legacy locked Edit is simply a public Edit, and a
 * blurred rendition is never served as anybody's photo — an Edit whose only
 * photo was blurred is a photo-less Edit until its owner adds a real one.
 * Nothing in this module deletes or mutates persisted rows — the next
 * ordinary workspace save by its owner persists the normalized values
 * through the normal save path.
 */
export type WorkspaceEditRecord = Record<string, unknown>;
export type WorkspaceCollectionRecord = Record<string, unknown>;

// The original single-creator demo seeded two paywall Edits with these
// blurred static files as their only image, plus a `private-hotel-source.webp`
// that never shipped. None of them is a photo anyone should see.
const BLURRED_STATIC_ASSET = /^\/tastekin-media\/[^/?#]*-preview\.webp$/i;
const LEGACY_MISSING_SOURCE = "/tastekin-media/private-hotel-source.webp";

export function isLegacyLockedAccess(value: unknown): boolean {
  return value === "locked";
}

/**
 * True for any path that is a blurred paywall rendition rather than a real
 * photo: a legacy `*-preview.webp` static asset, the never-shipped demo
 * source, or the object the Edit itself recorded as its blurred preview.
 */
export function isBlurredRendition(path: unknown, edit?: WorkspaceEditRecord): path is string {
  if (typeof path !== "string" || !path) return false;
  if (BLURRED_STATIC_ASSET.test(path) || path === LEGACY_MISSING_SOURCE) return true;
  return typeof edit?.previewImage === "string" && edit.previewImage.length > 0 && path === edit.previewImage;
}

/** The Edit's real photo, or undefined when it has none or only ever had a blurred rendition. */
export function clearPhotoOf(edit: WorkspaceEditRecord): string | undefined {
  const image = edit.image;
  if (typeof image !== "string" || !image) return undefined;
  return isBlurredRendition(image, edit) ? undefined : image;
}

/**
 * Returns the Edit as the free product understands it: `access` is always
 * "public", `image` is the Edit's clear photo or absent, and `previewImage`
 * is dropped — a blurred rendition is never substituted for a missing photo
 * and never served.
 */
export function normalizeLegacyEdit(edit: WorkspaceEditRecord): WorkspaceEditRecord {
  if (!edit || typeof edit !== "object") return edit;
  const image = clearPhotoOf(edit);
  if (edit.access === "public" && edit.previewImage === undefined && image === edit.image) return edit;
  const { previewImage: _previewImage, image: _image, ...rest } = edit;
  return { ...rest, ...(image === undefined ? {} : { image }), access: "public" };
}

/**
 * Collections are always public in the free product; legacy `locked` is read
 * as public, and a cover that was a blurred preview asset is dropped so the
 * cover falls back to the collection's first real photo.
 */
export function normalizeLegacyCollection(collection: WorkspaceCollectionRecord): WorkspaceCollectionRecord {
  if (!collection || typeof collection !== "object") return collection;
  const blurredCover = isBlurredRendition(collection.coverImage);
  if (collection.access === "public" && !blurredCover) return collection;
  const { coverImage, ...rest } = collection;
  return { ...rest, ...(blurredCover ? {} : coverImage === undefined ? {} : { coverImage }), access: "public" };
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
