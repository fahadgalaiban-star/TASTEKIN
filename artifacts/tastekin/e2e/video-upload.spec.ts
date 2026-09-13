import { expect, test, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Phase 3A — creator video-upload composer flow, gated behind the
// video_upload feature flag. Everything here is fully mocked (no real
// Bunny, no real TUS server): /api/video-uploads/* and a fake
// `bunny.tastekin.test` host stand in for the API server and Bunny Stream
// respectively, exactly like private-crops.spec.ts fakes the object-storage
// upload host for photos. Cross-user rejection, bunnyVideoId/bunnyLibraryId
// mismatch, and ready-gating on the SERVER side are covered separately by
// scripts/src/verify-creator-workspace-video.ts, which drives the real
// api-server + a disposable Postgres database — those checks can't be
// exercised meaningfully against a page.route() fake of the same server.

type Access = 'public' | 'locked';
type Edit = {
  id: string;
  category: string;
  title: string; titleAr: string; caption: string; captionAr: string;
  image?: string; sourceImage?: string; previewImage?: string;
  video?: { uploadId: string; bunnyVideoId: string; bunnyLibraryId: string };
  location: string; locationAr: string; altText: string;
  access: Access; status: 'draft' | 'published' | 'archived'; collectionIds: string[];
};
type Workspace = { creatorId: string; revision: number; updatedAt: string; edits: Edit[]; collections: unknown[] };

const ownerSession = 'tastekin-e2e-video-owner';

/** Installs a fake `<video>` element before any app script runs: sets `src`
 * fires `loadedmetadata` on a macrotask regardless of the blob's actual
 * bytes, and `.duration` reads back whatever `__setNextVideoDuration` last
 * set (default a short, valid 12s clip). This lets tests use arbitrary
 * in-memory buffers as "video" files without needing a real, decodable
 * video fixture — readVideoDuration() in video-upload.ts is the only thing
 * that ever touches real video decoding, and it is intentionally the one
 * piece of browser behavior this suite fakes, not app code. */
async function fakeVideoDecoding(page: Page) {
  await page.addInitScript(() => {
    let duration = 12;
    (window as unknown as { __setNextVideoDuration: (value: number) => void }).__setNextVideoDuration = (value: number) => { duration = value; };
    Object.defineProperty(HTMLVideoElement.prototype, 'duration', { configurable: true, get() { return duration; } });
    // Deliberately never sets the real "src" content attribute — doing so
    // would still invoke the browser's native media resource-selection
    // algorithm (which the spec ties to the attribute itself, not just the
    // property setter), and this file's bytes are not a real decodable
    // video. Storing the value privately and firing a synthetic
    // loadedmetadata event is what lets readVideoDuration() resolve without
    // ever touching a real decoder.
    const fakeSrc = new WeakMap<HTMLMediaElement, string>();
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      set(value: string) {
        fakeSrc.set(this, value);
        setTimeout(() => { const handler = (this as unknown as { onloadedmetadata?: (event: Event) => void }).onloadedmetadata; handler?.(new Event('loadedmetadata')); }, 0);
      },
      get() { return fakeSrc.get(this) || ''; },
    });
  });
}

function sparseFile(sizeBytes: number): string {
  const filePath = path.join(os.tmpdir(), `tastekin-e2e-oversize-${Date.now()}.mp4`);
  const fd = fs.openSync(filePath, 'w');
  fs.ftruncateSync(fd, sizeBytes);
  fs.closeSync(fd);
  return filePath;
}

class VideoUploadApi {
  workspace: Workspace = { creatorId: 'fheed', revision: 1, updatedAt: new Date().toISOString(), edits: [], collections: [] };
  profile = {
    displayName: 'Fheed Alaiban', username: 'fheed', bio: '', city: 'Kuwait City', country: 'Kuwait',
    interests: ['Fashion'], avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null,
    age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
  };
  videoUploadFlag = true;

  private uploadCounter = 0;
  private videoCounter = 0;
  readonly uploads = new Map<string, { id: string; state: string; declaredFileName: string; declaredSizeBytes: number; declaredMimeType: string; durationSeconds: number | null; width: number | null; height: number | null; posterUrl: string | null; errorReason: string | null; bunnyVideoId: string; bunnyLibraryId: string }>();
  readonly requestUploadCalls: Array<{ idempotencyKey: string | null; body: Record<string, unknown> }> = [];
  readonly cancelledIds: string[] = [];
  private pendingCreatingResponses = 0;
  private objectPaths: string[] = [];
  private uploadedObjectPaths = new Set<string>();
  private uploadNumber = 0;

  private tusOffsets = new Map<string, number>();
  private patchCallCounts = new Map<string, number>();
  private patchGates = new Map<string, { atCall: number; release: () => void; promise: Promise<void> }>();

  /** Makes the first `times` request-upload calls answer 202 "still
   * creating" before the next one finally answers 201. Since the client
   * always retries one single in-flight attempt with its own stable key
   * (never starts a second attempt while the first is pending), this is
   * enough to assert every one of those calls carried the exact same
   * Idempotency-Key — see the test that reads requestUploadCalls back. */
  scriptCreatingRetries(times: number) {
    this.pendingCreatingResponses = times;
  }

  /** Defers the Nth PATCH (1-indexed) for `videoId` until releasePatch() is
   * called — used to catch a stable mid-upload progress percentage. */
  armPatchGate(videoId: string, atCall: number) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.patchGates.set(videoId, { atCall, release, promise });
  }

  releasePatch(videoId: string) {
    this.patchGates.get(videoId)?.release();
  }

  markReady(uploadId: string, metadata: { durationSeconds?: number; width?: number; height?: number; posterUrl?: string } = {}) {
    const row = this.uploads.get(uploadId);
    if (!row) throw new Error(`unknown upload ${uploadId}`);
    row.state = 'ready';
    row.durationSeconds = metadata.durationSeconds ?? 42;
    row.width = metadata.width ?? 1080;
    row.height = metadata.height ?? 1920;
    row.posterUrl = metadata.posterUrl ?? null;
  }

  markFailed(uploadId: string, errorReason = 'encoding failed') {
    const row = this.uploads.get(uploadId);
    if (!row) throw new Error(`unknown upload ${uploadId}`);
    row.state = 'failed';
    row.errorReason = errorReason;
  }

  async attach(page: Page) {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.hostname === 'uploads.tastekin.test') {
        if (request.method() === 'PUT') { this.uploadedObjectPaths.add(url.pathname.replace('/upload/', '')); await route.fulfill({ status: 204 }); return; }
        await route.fulfill({ status: 405 });
        return;
      }

      if (url.hostname === 'bunny.tastekin.test') {
        await this.handleTusRoute(route, url);
        return;
      }

      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      await this.handleApiRoute(route, url);
    });
  }

  private isOwner(route: Route) {
    return route.request().headers().cookie?.includes(`sid=${ownerSession}`) ?? false;
  }

  private requestBody(route: Route): Record<string, unknown> {
    const body = route.request().postData();
    return body ? JSON.parse(body) as Record<string, unknown> : {};
  }

  // `bunny.tastekin.test` is a different origin from the app itself, so
  // every response needs CORS headers for the browser's fetch() to accept
  // it at all — and, since Location/Upload-Offset are not on the small
  // safelist of response headers exposed to JS by default cross-origin,
  // Access-Control-Expose-Headers is what lets uploadVideoViaTus() actually
  // read them back. Without this, fetch() itself throws before the app code
  // ever sees a status code, which looks like the request silently vanished.
  private corsHeaders(extra: Record<string, string> = {}) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Location, Upload-Offset, Tus-Resumable',
      ...extra,
    };
  }

  private async handleTusRoute(route: Route, url: URL) {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: this.corsHeaders({ 'Access-Control-Allow-Methods': 'POST, HEAD, PATCH, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '86400' }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/tus') {
      const videoId = request.headers().videoid;
      this.tusOffsets.set(videoId, 0);
      await route.fulfill({ status: 200, headers: this.corsHeaders({ Location: `/tus/${videoId}` }) });
      return;
    }
    const itemMatch = url.pathname.match(/^\/tus\/([^/]+)$/);
    if (request.method() === 'HEAD' && itemMatch) {
      const offset = this.tusOffsets.get(itemMatch[1]) ?? 0;
      await route.fulfill({ status: 200, headers: this.corsHeaders({ 'Upload-Offset': String(offset) }) });
      return;
    }
    if (request.method() === 'PATCH' && itemMatch) {
      const videoId = itemMatch[1];
      const count = (this.patchCallCounts.get(videoId) ?? 0) + 1;
      this.patchCallCounts.set(videoId, count);
      const gate = this.patchGates.get(videoId);
      if (gate && gate.atCall === count) await gate.promise;
      const chunk = request.postDataBuffer();
      const currentOffset = this.tusOffsets.get(videoId) ?? 0;
      const nextOffset = currentOffset + (chunk?.byteLength ?? 0);
      this.tusOffsets.set(videoId, nextOffset);
      // Once every declared byte has been PATCHed, this upload has finished
      // uploading and is now "processing" server-side — mirrors the real
      // api-server, which only learns an upload is complete once Bunny (or
      // here, this fake) has actually received it all.
      const row = Array.from(this.uploads.values()).find((item) => item.bunnyVideoId === videoId);
      if (row && row.state === 'uploading' && nextOffset >= row.declaredSizeBytes) row.state = 'processing';
      await route.fulfill({ status: 200, headers: this.corsHeaders({ 'Upload-Offset': String(nextOffset) }) });
      return;
    }
    await route.fulfill({ status: 404, headers: this.corsHeaders() });
  }

  private async handleApiRoute(route: Route, url: URL) {
    const request = route.request();
    const owner = this.isOwner(route);

    if (url.pathname === '/api/me') {
      await route.fulfill({
        json: owner
          ? { user: { id: 'fheed-owner', email: 'founder@tastekin.test' }, role: 'creator', creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true }, featureFlags: { video_upload: this.videoUploadFlag } }
          : { user: null, role: 'consumer', creator: null, featureFlags: { video_upload: this.videoUploadFlag } },
      });
      return;
    }

    if (url.pathname === '/api/creator-profile' && request.method() === 'GET') {
      await route.fulfill({ json: { ...this.profile, revision: this.workspace.revision } });
      return;
    }

    if (url.pathname === '/api/creator-workspace') {
      if (request.method() === 'GET') { await route.fulfill({ json: owner ? this.workspace : { ...this.workspace, edits: [] } }); return; }
      if (request.method() === 'PUT') {
        if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in to update the creator workspace' } }); return; }
        const payload = this.requestBody(route);
        this.workspace = { ...this.workspace, edits: payload.edits as Edit[], collections: payload.collections as unknown[], revision: this.workspace.revision + 1, updatedAt: new Date().toISOString() };
        await route.fulfill({ json: this.workspace });
        return;
      }
    }

    if (url.pathname === '/api/storage/uploads/request-url') {
      if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in to upload media' } }); return; }
      const metadata = this.requestBody(route);
      const objectPath = `/objects/uploads/video-suite-photo-${++this.uploadNumber}`;
      this.objectPaths.push(objectPath);
      await route.fulfill({ json: { uploadURL: `https://uploads.tastekin.test/upload/${objectPath}`, objectPath, metadata } });
      return;
    }

    if (url.pathname.startsWith('/api/storage/objects/')) {
      const objectPath = url.pathname.replace('/api/storage', '');
      const onePixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==', 'base64');
      await route.fulfill({ status: owner && this.uploadedObjectPaths.has(objectPath) ? 200 : 404, contentType: 'image/png', body: onePixel });
      return;
    }

    if (url.pathname === '/api/video-uploads/request-upload' && request.method() === 'POST') {
      if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in' } }); return; }
      const idempotencyKey = request.headers()['idempotency-key'] ?? null;
      const body = this.requestBody(route);
      this.requestUploadCalls.push({ idempotencyKey, body });
      if (this.pendingCreatingResponses > 0) {
        this.pendingCreatingResponses -= 1;
        await route.fulfill({ status: 202, json: { id: 'pending', state: 'creating', statusUrl: '/api/video-uploads/pending', retryAfter: 0 } });
        return;
      }
      this.uploadCounter += 1;
      this.videoCounter += 1;
      const id = `video-upload-${this.uploadCounter}`;
      const bunnyVideoId = `fake-bunny-video-${this.videoCounter}`;
      const bunnyLibraryId = 'fake-library';
      this.uploads.set(id, {
        id, state: 'uploading', declaredFileName: String(body.fileName ?? ''), declaredSizeBytes: Number(body.sizeBytes ?? 0), declaredMimeType: String(body.mimeType ?? ''),
        durationSeconds: null, width: null, height: null, posterUrl: null, errorReason: null, bunnyVideoId, bunnyLibraryId,
      });
      await route.fulfill({
        status: 201,
        json: { id, state: 'uploading', tus: { endpoint: 'https://bunny.tastekin.test/tus', libraryId: bunnyLibraryId, videoId: bunnyVideoId, expirationTime: Math.floor(Date.now() / 1000) + 3600, signature: 'fake-signature' } },
      });
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/video-uploads\/([^/]+)$/);
    if (statusMatch && request.method() === 'GET') {
      if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in' } }); return; }
      const row = this.uploads.get(statusMatch[1]);
      if (!row) { await route.fulfill({ status: 404, json: { error: 'Upload not found' } }); return; }
      const { bunnyVideoId: _bunnyVideoId, bunnyLibraryId: _bunnyLibraryId, ...safe } = row;
      await route.fulfill({ json: safe });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/video-uploads\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method() === 'POST') {
      if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in' } }); return; }
      this.cancelledIds.push(cancelMatch[1]);
      const row = this.uploads.get(cancelMatch[1]);
      if (row) row.state = 'deleted';
      await route.fulfill({ json: { id: cancelMatch[1], state: 'deleted', physicalDeletion: 'completed' } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: 'Not found' } });
  }
}

async function creatorPage(page: Page, api: VideoUploadApi) {
  await page.context().addCookies([{ name: 'sid', value: ownerSession, url: 'http://127.0.0.1:23385' }]);
  await fakeVideoDecoding(page);
  await api.attach(page);
  await page.goto('/');
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();
}

async function openComposer(page: Page) {
  await page.getByRole('button', { name: 'New Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
}

function videoFile(name: string, sizeBytes: number, mimeType = 'video/mp4') {
  return { name, mimeType, buffer: Buffer.alloc(sizeBytes) };
}

test('when video_upload is disabled, no Photo/Video toggle appears and the photo uploader behaves exactly as before', async ({ page }) => {
  const api = new VideoUploadApi();
  api.videoUploadFlag = false;
  await creatorPage(page, api);
  await openComposer(page);
  await expect(page.getByRole('tab', { name: 'Video' })).toHaveCount(0);
  await expect(page.getByLabel('Add photo')).toBeVisible();
});

test('an unsupported file type is rejected before any request-upload call', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('clip.avi', 1024, 'video/x-msvideo'));
  await expect(page.getByText('Choose an MP4 or MOV video file.')).toBeVisible();
  expect(api.requestUploadCalls).toHaveLength(0);
});

test('a file over the 500MB limit is rejected before any request-upload call', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  const oversizePath = sparseFile(500 * 1024 * 1024 + 1024);
  try {
    await page.getByLabel('Add video').setInputFiles(oversizePath);
    await expect(page.getByText('The maximum video size is 500 MB.')).toBeVisible();
    expect(api.requestUploadCalls).toHaveLength(0);
  } finally {
    fs.rmSync(oversizePath, { force: true });
  }
});

test('a video longer than 10 minutes is rejected before any request-upload call', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.evaluate(() => (window as unknown as { __setNextVideoDuration: (value: number) => void }).__setNextVideoDuration(700));
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('long-clip.mp4', 1024));
  await expect(page.getByText('The maximum video length is 10 minutes.')).toBeVisible();
  expect(api.requestUploadCalls).toHaveLength(0);
});

test('a 202 "still creating" response is retried with the exact same Idempotency-Key until it resolves, never minting a new one', async ({ page }) => {
  test.setTimeout(60000);
  const api = new VideoUploadApi();
  api.scriptCreatingRetries(2);
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('clip.mp4', 1024));
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 40000 }).toBeGreaterThanOrEqual(3);
  const keysUsed = new Set(api.requestUploadCalls.map((call) => call.idempotencyKey));
  expect(keysUsed.size).toBe(1);
  expect(Array.from(keysUsed)[0]).toBeTruthy();
  await expect(page.getByText(/Uploading…|Processing…/)).toBeVisible({ timeout: 8000 });
});

test('upload progress is rendered mid-upload, then the video reaches ready and unblocks Publish', async ({ page }) => {
  // This headless environment throttles a background page's setTimeout
  // well beyond its nominal delay (confirmed empirically), and reaching
  // "ready" here needs a second scheduled status-poll tick (the first
  // fires synchronously and only ever sees "processing") — give it room.
  test.setTimeout(60000);
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();

  // 12MB forces exactly two 8MB/4MB TUS chunks — gate the second so the UI
  // has time to settle on the exact percentage after the first chunk lands.
  const fileSize = 12 * 1024 * 1024;
  await page.getByLabel('Add video').setInputFiles(videoFile('clip.mp4', fileSize));
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 4000 }).toBe(1);
  const uploadId = 'video-upload-1';
  const bunnyVideoId = api.uploads.get(uploadId)?.bunnyVideoId;
  expect(bunnyVideoId).toBeTruthy();
  api.armPatchGate(bunnyVideoId!, 2);

  await expect(page.getByText('Uploading… 67%')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/processing/);

  api.releasePatch(bunnyVideoId!);
  await expect(page.getByText('Processing…')).toBeVisible({ timeout: 8000 });
  api.markReady(uploadId);
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 45000 });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();
  const saved = api.workspace.edits.find((edit) => edit.video);
  expect(saved?.video).toMatchObject({ uploadId, bunnyVideoId });
  expect(saved?.status).toBe('published');
});

test('replacing a selected video cancels the previous upload and publishes with the new one', async ({ page }) => {
  test.setTimeout(60000);
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('first.mp4', 1024));
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 4000 }).toBe(1);
  const firstId = 'video-upload-1';
  await expect(page.getByText(/Uploading…|Processing…/)).toBeVisible({ timeout: 8000 });

  await page.getByLabel('Replace video').setInputFiles(videoFile('second.mp4', 1024));
  await expect.poll(() => api.cancelledIds, { timeout: 4000 }).toContain(firstId);
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 4000 }).toBe(2);
  const secondId = 'video-upload-2';

  api.markReady(secondId);
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();
  const saved = api.workspace.edits.find((edit) => edit.video);
  expect(saved?.video?.uploadId).toBe(secondId);
});

test('removing a selected video cancels it and clears the field, leaving Publish blocked on the usual no-media rule', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('clip.mp4', 1024));
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 4000 }).toBe(1);
  const uploadId = 'video-upload-1';

  await page.getByRole('button', { name: 'Remove video' }).click();
  await expect.poll(() => api.cancelledIds, { timeout: 4000 }).toContain(uploadId);
  await expect(page.getByLabel('Add video')).toBeVisible();

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('a failed video keeps Publish blocked with a clear reason', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Add video').setInputFiles(videoFile('clip.mp4', 1024));
  await expect.poll(() => api.requestUploadCalls.length, { timeout: 4000 }).toBe(1);
  const uploadId = 'video-upload-1';
  api.markFailed(uploadId);
  await expect(page.getByText('This video could not be processed.')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('the existing photo crop-and-publish flow is completely unchanged with video_upload enabled', async ({ page }) => {
  const api = new VideoUploadApi();
  await creatorPage(page, api);
  await openComposer(page);
  await expect(page.getByRole('tab', { name: 'Photo', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(path.resolve(import.meta.dirname, '../public/tastekin-media/quiet-tailoring.webp'));
  await expect(page.locator('[aria-label="Crop image"]')).toBeVisible();
  await page.getByRole('button', { name: 'Post Square' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
  await page.getByLabel('Caption (optional)', { exact: true }).fill('Unchanged photo flow');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();

  const saved = api.workspace.edits.find((edit) => edit.title === 'Unchanged photo flow' || edit.caption === 'Unchanged photo flow');
  expect(saved?.image).toMatch(/^\/objects\/uploads\//);
  expect(saved?.video).toBeUndefined();
});
