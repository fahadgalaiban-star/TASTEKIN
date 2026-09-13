import { db, videoUploads, type VideoUpload } from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Video Foundation, Phase 3B — resolves PLAYBACK information (an HLS
 * manifest URL + a poster/thumbnail URL) for a `video_uploads` row that has
 * already reached "ready". This is deliberately the one and only place in
 * the server that turns a row's own `bunnyVideoId`/`bunnyLibraryId` into a
 * URL a browser can actually fetch — every route that needs to expose
 * playback to a viewer calls `resolvePlaybackInfo`/`batchResolveVideoRows`
 * below rather than constructing a Bunny URL itself, so the scheme can be
 * swapped for signed/token-authenticated playback later by editing only
 * this file.
 *
 * Never trusts anything from a client-submitted Edit: callers pass in the
 * row's own `bunnyVideoId`/`bunnyLibraryId` (read fresh from the database,
 * inside the SAME request), never a copy of those fields that arrived in a
 * workspace's stored `edit.video` JSON — that stored copy exists only to
 * look the row up by `uploadId`, never to derive a playback URL from.
 */

export type ResolvedPlayback = {
  playbackUrl: string;
  posterUrl: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

/**
 * The CDN/pull-zone hostname Bunny Stream serves HLS manifests and
 * thumbnails from for this library (e.g. "vz-xxxxx.b-cdn.net") — distinct
 * from BUNNY_STREAM_BASE_URL (the Video Library *management* API host used
 * by bunny-stream.ts for create/status/delete calls). Read lazily, never at
 * module import time, exactly like bunny-stream.ts's own resolveConfig:
 * this feature must never depend on it being set for anything else in the
 * app to keep working, and its absence is a normal, safe "no playback yet"
 * outcome, not a crash.
 */
function resolveCdnHostname(deps?: { cdnHostname?: string }): string | null {
  const hostname = deps?.cdnHostname ?? process.env.BUNNY_STREAM_CDN_HOSTNAME?.trim();
  return hostname ? hostname.replace(/\/+$/, "") : null;
}

/**
 * Pure and synchronous — no network call, no database read. Returns null
 * whenever playback cannot be safely offered: the row isn't "ready" yet,
 * has no confirmed Bunny video id, or this deployment has no CDN hostname
 * configured (e.g. local/dev/test, or before Bunny is provisioned for this
 * environment) — every one of those is a normal outcome the caller must
 * treat as "no playback available right now", never an error.
 */
export function resolvePlaybackInfo(
  row: Pick<VideoUpload, "state" | "bunnyVideoId" | "durationSeconds" | "width" | "height">,
  deps?: { cdnHostname?: string },
): ResolvedPlayback | null {
  if (row.state !== "ready" || !row.bunnyVideoId) return null;
  const hostname = resolveCdnHostname(deps);
  if (!hostname) return null;
  return {
    playbackUrl: `https://${hostname}/${encodeURIComponent(row.bunnyVideoId)}/playlist.m3u8`,
    posterUrl: `https://${hostname}/${encodeURIComponent(row.bunnyVideoId)}/thumbnail.jpg`,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
  };
}

/**
 * Single batched read for every `video_uploads` row a page of Edits could
 * possibly need — callers collect every `edit.video.uploadId` up front
 * (across every Edit and, for a multi-creator feed, every creator) and
 * call this exactly once, instead of one lookup per card. Read-only: never
 * locks rows (unlike creator-workspace.ts's own `lockVideoUploadsForUpdate`,
 * which is a mutation-path concern this read path has no need for).
 */
export async function batchResolveVideoRows(uploadIds: string[]): Promise<Map<string, VideoUpload>> {
  if (!uploadIds.length) return new Map();
  const uniqueIds = Array.from(new Set(uploadIds));
  const rows = await db.select().from(videoUploads).where(inArray(videoUploads.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, row]));
}

type EditLike = Record<string, unknown>;

/**
 * Attaches resolved playback fields onto every video-bearing Edit in
 * `edits`, in place semantics via a fresh array (never mutates its input).
 * Applies the full safety gate before ever handing back a playable URL:
 * the referenced row must actually exist, belong to this exact
 * creator/owner, be durably attached to this exact Edit (never a
 * different one — see attached_edit_id / attachVideoUploadsToEdit in
 * video-upload-lifecycle.ts), and be "ready". Any edit whose video fails
 * that check is returned with its playback fields simply absent — the
 * client's job is to fall back to a safe placeholder, never to guess a URL
 * of its own.
 *
 * Deliberately does not also gate on `edit.status`/`edit.access` — callers
 * that need only published+public Edits (the public feed/workspace routes)
 * already filter to those before calling this; the owner's own private
 * workspace view calls it too (so the composer's own Preview screen and the
 * creator's own profile can show playback for their still-draft or
 * already-published videos alike), and readiness/ownership/attachment are
 * the only invariants that matter for "is this safe to hand back a URL
 * for", independent of publish state.
 */
export function attachResolvedPlayback<T extends EditLike>(
  edits: T[],
  videoRowsById: Map<string, VideoUpload>,
  ownerUserId: string,
  creatorId: string,
  deps?: { cdnHostname?: string },
): T[] {
  return edits.map((edit) => {
    const video = edit.video as { uploadId?: unknown; bunnyVideoId?: unknown; bunnyLibraryId?: unknown } | undefined;
    if (!video || typeof video !== "object" || typeof video.uploadId !== "string") return edit;
    const row = videoRowsById.get(video.uploadId);
    if (!row || row.ownerUserId !== ownerUserId || row.creatorId !== creatorId || row.attachedEditId !== edit.id) return edit;
    const resolved = resolvePlaybackInfo(row, deps);
    if (!resolved) return edit;
    return {
      ...edit,
      // bunnyVideoId/bunnyLibraryId come from the persisted, validated
      // `row` here — never from `video` (the client-submitted edit.video
      // JSON) — for the same reason playbackUrl/posterUrl already do:
      // nothing in this response should ever echo back provider identity
      // that wasn't independently verified server-side this request.
      video: {
        uploadId: video.uploadId,
        bunnyVideoId: row.bunnyVideoId,
        bunnyLibraryId: row.bunnyLibraryId,
        playbackUrl: resolved.playbackUrl,
        posterUrl: resolved.posterUrl,
        durationSeconds: resolved.durationSeconds,
        width: resolved.width,
        height: resolved.height,
      },
    };
  });
}

/** Collects every uploadId referenced by a video-bearing edit, for a single batchResolveVideoRows call across a whole response (a full feed page's worth of creators' edits, not one call per creator). */
export function collectVideoUploadIds(edits: EditLike[]): string[] {
  return edits
    .map((edit) => (edit.video as { uploadId?: unknown } | undefined)?.uploadId)
    .filter((uploadId): uploadId is string => typeof uploadId === "string");
}
