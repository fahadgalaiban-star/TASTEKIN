// Video Foundation, Phase 3A — pure, framework-free helpers for the
// client-side half of a Bunny Stream upload: validating a picked file
// before ever contacting the server, and speaking just enough of the TUS
// resumable-upload protocol to hand bytes directly to Bunny. Nothing here
// ever imports React — this module has no knowledge of the composer's UI
// or the request-upload/status/cancel API calls (see App.tsx's
// useVideoUpload hook for that orchestration).
//
// Video bytes never pass through this app's own API server: the browser
// PATCHes them straight to `auth.endpoint` (Bunny's TUS endpoint, or a
// fake one substituted in tests) using the one-time credentials the
// request-upload endpoint returned.

export const VIDEO_MAX_SIZE_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 10 * 60;
export const VIDEO_ALLOWED_MIME_TYPES = new Set(['video/mp4', 'video/quicktime']);

export type VideoFileIssue = 'invalid-type' | 'too-large';

/** Cheap, synchronous checks only — duration requires decoding metadata (see readVideoDuration) and is checked separately so a huge/wrong-type file never even starts that work. */
export function validateVideoFileBasics(file: File): VideoFileIssue | null {
  if (!VIDEO_ALLOWED_MIME_TYPES.has(file.type)) return 'invalid-type';
  if (file.size > VIDEO_MAX_SIZE_BYTES) return 'too-large';
  return null;
}

/** Decodes just enough of the file to read its duration — never uploads or fully decodes the video. Rejects if the browser can't read it at all (corrupt file, unsupported container). */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      Number.isFinite(videoEl.duration) ? resolve(videoEl.duration) : reject(new Error('unreadable duration'));
    };
    videoEl.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable video')); };
    videoEl.src = url;
  });
}

export type TusUploadAuthorization = { endpoint: string; libraryId: string; videoId: string; expirationTime: number; signature: string };
export type TusUploadProgress = { bytesUploaded: number; bytesTotal: number };

/** Thrown specifically for a 401 from any TUS call (create/HEAD/PATCH) — an expired AuthorizationSignature/AuthorizationExpire pair, per Bunny's documented TUS error semantics. Distinguished from a generic network/interruption failure so the caller can surface "your session expired, retry" rather than a generic error — retrying (via the app's own request-upload replay mechanism, which reissues a fresh, non-expired signature for the SAME Bunny video) is exactly the right recovery either way. */
export class TusAuthorizationExpiredError extends Error {
  constructor() {
    super('tus-authorization-expired');
    this.name = 'TusAuthorizationExpiredError';
  }
}

const TUS_RESUMABLE_VERSION = '1.0.0';
const TUS_CHUNK_SIZE = 8 * 1024 * 1024;

function tusAuthorizationHeaders(auth: TusUploadAuthorization): Record<string, string> {
  return {
    AuthorizationSignature: auth.signature,
    AuthorizationExpire: String(auth.expirationTime),
    VideoId: auth.videoId,
    LibraryId: auth.libraryId,
  };
}

function base64(value: string): string {
  return typeof btoa === 'function' ? btoa(value) : Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Resumable-upload resource cache, keyed by Bunny's own video id — stable
 * for the entire lifetime of one upload attempt (a replayed
 * Idempotency-Key always yields the same video id from request-upload).
 * Caching the TUS resource URL here means an upload interrupted mid-chunk
 * (a network blip, the tab losing focus) resumes from Bunny's own
 * confirmed offset instead of starting a second TUS resource for the same
 * video. This does not survive a full page reload (in-memory only) — a
 * File object itself cannot be persisted across a reload, so a reload
 * always requires re-selecting the file; the request-upload endpoint's own
 * idempotency is what prevents that from ever creating a duplicate video.
 */
const resumeUrlCache = new Map<string, string>();

export function clearTusResumeCache(videoId: string): void {
  resumeUrlCache.delete(videoId);
}

async function createOrReuseTusUpload(file: File, auth: TusUploadAuthorization): Promise<string> {
  const cached = resumeUrlCache.get(auth.videoId);
  if (cached) return cached;
  const response = await fetch(auth.endpoint, {
    method: 'POST',
    headers: {
      'Tus-Resumable': TUS_RESUMABLE_VERSION,
      'Upload-Length': String(file.size),
      'Upload-Metadata': `filetype ${base64(file.type || 'application/octet-stream')}`,
      ...tusAuthorizationHeaders(auth),
    },
  });
  if (response.status === 401) throw new TusAuthorizationExpiredError();
  if (!response.ok) throw new Error(`create-${response.status}`);
  const location = response.headers.get('Location');
  if (!location) throw new Error('create-no-location');
  const resolved = new URL(location, auth.endpoint).toString();
  resumeUrlCache.set(auth.videoId, resolved);
  return resolved;
}

async function confirmedOffset(uploadUrl: string, auth: TusUploadAuthorization): Promise<number> {
  const response = await fetch(uploadUrl, {
    method: 'HEAD',
    headers: { 'Tus-Resumable': TUS_RESUMABLE_VERSION, ...tusAuthorizationHeaders(auth) },
  });
  if (response.status === 401) throw new TusAuthorizationExpiredError();
  if (!response.ok) throw new Error(`head-${response.status}`);
  const offset = Number(response.headers.get('Upload-Offset'));
  return Number.isFinite(offset) ? offset : 0;
}

/**
 * Uploads `file` to Bunny over TUS: create-or-resume, then PATCH fixed-size
 * chunks from the server's own confirmed offset (never assumed) until the
 * whole file is sent. Safe to call again for the same `auth.videoId` after
 * a thrown error — it resumes from wherever Bunny last confirmed, it never
 * restarts from zero or creates a second upload resource.
 */
export async function uploadVideoViaTus(
  file: File,
  auth: TusUploadAuthorization,
  options: { onProgress?: (progress: TusUploadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  try {
    const uploadUrl = await createOrReuseTusUpload(file, auth);
    let offset = await confirmedOffset(uploadUrl, auth);
    options.onProgress?.({ bytesUploaded: offset, bytesTotal: file.size });
    while (offset < file.size) {
      if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      const chunk = file.slice(offset, Math.min(offset + TUS_CHUNK_SIZE, file.size));
      const response = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': TUS_RESUMABLE_VERSION,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
          ...tusAuthorizationHeaders(auth),
        },
        body: chunk,
        signal: options.signal,
      });
      if (response.status === 401) throw new TusAuthorizationExpiredError();
      if (!response.ok) throw new Error(`patch-${response.status}`);
      const nextOffset = Number(response.headers.get('Upload-Offset'));
      offset = Number.isFinite(nextOffset) ? nextOffset : offset + chunk.size;
      options.onProgress?.({ bytesUploaded: offset, bytesTotal: file.size });
    }
    resumeUrlCache.delete(auth.videoId);
  } catch (error) {
    // Every failure above collapses into one of two user-facing messages
    // (App.tsx's startTus), which is deliberately vague to a viewer — but
    // that must never mean the real cause is lost. A CORS block (Bunny's
    // TUS server rejecting this origin, or a required response header not
    // exposed cross-origin) surfaces to fetch() as a bare
    // "TypeError: Failed to fetch" with no status at all, identical to a
    // genuine dropped connection — this log line is what lets the browser's
    // own Network tab (which does show the real CORS/HTTP reason) be found
    // at all. Never logs AuthorizationSignature/AuthorizationExpire — only
    // the public endpoint, the non-secret Bunny video id, and the
    // browser's own error name/message.
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.error('[video-upload] direct-to-Bunny TUS request failed', {
        endpoint: auth.endpoint,
        videoId: auth.videoId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
