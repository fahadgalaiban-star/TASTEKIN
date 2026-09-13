import { expect, test, type Page, type Route } from '@playwright/test';

// Phase 3B — public playback and rendering of ready, public video Edits,
// behind the existing video_upload feature flag. Everything here is fully
// mocked: no real Bunny, no real HLS stream, no api-server. The server-side
// resolution/ownership/batching guarantees (readiness, ownership, attached
// edit, single batched query) are covered separately by
// scripts/src/verify-video-playback.ts, which drives the real api-server
// against a disposable Postgres database — those checks can't be exercised
// meaningfully against a page.route() fake of the same server. This suite is
// about the *rendered* behavior: autoplay/pause coordination, controls,
// poster-only screens, the detail player, safe fallback, and layout.

type Access = 'public' | 'locked';
type VideoRef = {
  uploadId: string; bunnyVideoId: string; bunnyLibraryId: string;
  playbackUrl?: string | null; posterUrl?: string | null;
  durationSeconds?: number | null; width?: number | null; height?: number | null;
};
type Edit = {
  id: string; category: string; title: string; titleAr: string; caption: string; captionAr: string;
  image?: string; video?: VideoRef;
  location: string; locationAr: string; altText: string;
  access: Access; status: 'draft' | 'published' | 'archived'; collectionIds: string[];
};

const viewerSession = 'tastekin-e2e-video-viewer';
const FAKE_CDN = 'https://fake-cdn.example-bunny-cdn.test';

function videoRef(id: string, overrides: Partial<VideoRef> = {}): VideoRef {
  return {
    uploadId: `video-upload-${id}`,
    bunnyVideoId: `fake-bunny-video-${id}`,
    bunnyLibraryId: 'fake-library',
    playbackUrl: `${FAKE_CDN}/${id}/playlist.m3u8`,
    posterUrl: '/tastekin-media/quiet-tailoring.webp',
    durationSeconds: 37,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

function baseEdit(id: string, overrides: Partial<Edit> = {}): Edit {
  return {
    id, category: 'Fashion', title: `Edit ${id}`, titleAr: `تعديل ${id}`,
    caption: `Caption ${id}`, captionAr: `تعليق ${id}`,
    location: '', locationAr: '', altText: `Edit ${id}`,
    access: 'public', status: 'published', collectionIds: [],
    ...overrides,
  };
}

/**
 * Installs, before any app script runs:
 *  - `HTMLVideoElement.canPlayType('application/vnd.apple.mpegurl')` forced
 *    truthy, so `attachHlsSource` always takes the native-HLS branch —
 *    this is what lets the suite avoid faking hls.js's real network/manifest
 *    parsing, which would otherwise be fragile to reproduce headlessly.
 *  - a faked `.src` setter (same trick as video-upload.spec.ts's
 *    fakeVideoDecoding: store the value privately, never touch the real
 *    content attribute) so assigning a fake playback URL never triggers a
 *    real network fetch or a spurious native `error` event.
 *  - synchronous `play()`/`pause()` overrides that dispatch the matching
 *    DOM event immediately, mirroring how a real element resolves once
 *    metadata is available.
 *  - a fake `IntersectionObserver` whose instances are captured on
 *    `window.__observers`, plus `window.__setIntersecting(testId, isIntersecting, ratio?)`
 *    for tests to manually drive visibility transitions.
 *  - a fake, test-controlled `document.hidden` plus
 *    `window.__setDocumentHidden(value)` to fire `visibilitychange`.
 */
async function fakePlaybackEnvironment(page: Page) {
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.canPlayType = function (type: string) {
      return type === 'application/vnd.apple.mpegurl' ? 'probably' : '';
    };
    const fakeSrc = new WeakMap<HTMLMediaElement, string>();
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      set(value: string) { fakeSrc.set(this, value); },
      get() { return fakeSrc.get(this) || ''; },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event('pause'));
    };

    type FakeObserver = { callback: IntersectionObserverCallback; elements: Set<Element> };
    const observers: FakeObserver[] = [];
    (window as unknown as { __observers: FakeObserver[] }).__observers = observers;
    class FakeIntersectionObserver {
      callback: IntersectionObserverCallback;
      elements = new Set<Element>();
      constructor(callback: IntersectionObserverCallback) { this.callback = callback; observers.push(this); }
      observe(el: Element) { this.elements.add(el); }
      unobserve(el: Element) { this.elements.delete(el); }
      disconnect() { this.elements.clear(); }
      takeRecords() { return []; }
    }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
    // React mounts the <video> element and its `useEffect` that registers
    // the IntersectionObserver on separate ticks from the initial commit —
    // by the time a test's `getByTestId(...)` resolves the element, that
    // effect may not have run yet. Retrying briefly (instead of firing once
    // and giving up) is what makes this deterministic rather than a flaky
    // race against React's own effect scheduling.
    (window as unknown as { __setIntersecting: (testId: string, isIntersecting: boolean, ratio?: number) => Promise<boolean> }).__setIntersecting = (testId, isIntersecting, ratio) => {
      const actualRatio = ratio ?? (isIntersecting ? 1 : 0);
      return new Promise<boolean>((resolve) => {
        const tryFire = (attemptsLeft: number) => {
          const el = document.querySelector(`[data-testid="${testId}"]`);
          const observer = el ? observers.find((item) => item.elements.has(el)) : undefined;
          if (observer && el) {
            observer.callback([{ target: el, isIntersecting, intersectionRatio: actualRatio } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
            resolve(true);
            return;
          }
          if (attemptsLeft <= 0) { resolve(false); return; }
          setTimeout(() => tryFire(attemptsLeft - 1), 50);
        };
        tryFire(60);
      });
    };

    let hiddenFlag = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenFlag });
    (window as unknown as { __setDocumentHidden: (value: boolean) => void }).__setDocumentHidden = (value) => {
      hiddenFlag = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
}

async function setIntersecting(page: Page, testId: string, isIntersecting: boolean, ratio?: number) {
  const fired = await page.evaluate(({ testId, isIntersecting, ratio }) => {
    return (window as unknown as { __setIntersecting: (testId: string, isIntersecting: boolean, ratio?: number) => Promise<boolean> }).__setIntersecting(testId, isIntersecting, ratio);
  }, { testId, isIntersecting, ratio });
  if (!fired) throw new Error(`setIntersecting: no IntersectionObserver ever registered [data-testid="${testId}"]`);
}

class PlaybackApi {
  profile = {
    displayName: 'Fheed Alaiban', username: 'fheed', bio: '', city: 'Kuwait City', country: 'Kuwait',
    interests: ['Fashion'], avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null,
    age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
  };
  edits: Edit[] = [];
  saved: string[] = [];
  savedCalls: Array<{ id: string; active: boolean }> = [];
  videoUploadFlag = true;

  async attach(page: Page) {
    await page.route('**/api/**', async (route) => this.handleApiRoute(route, new URL(route.request().url())));
  }

  private isViewer(route: Route) {
    return route.request().headers().cookie?.includes(`sid=${viewerSession}`) ?? false;
  }

  private requestBody(route: Route): Record<string, unknown> {
    const body = route.request().postData();
    return body ? JSON.parse(body) as Record<string, unknown> : {};
  }

  private feedItem(edit: Edit) {
    return {
      creatorUsername: this.profile.username,
      creatorName: this.profile.displayName,
      creatorVerified: this.profile.verified,
      creatorAvatar: this.profile.avatar,
      following: false,
      edit,
    };
  }

  private async handleApiRoute(route: Route, url: URL) {
    const request = route.request();
    const viewer = this.isViewer(route);

    if (url.pathname === '/api/me') {
      await route.fulfill({
        json: viewer
          ? { user: { id: 'viewer-1', email: 'viewer@tastekin.test' }, role: 'consumer', creator: null, featureFlags: { video_upload: this.videoUploadFlag } }
          : { user: null, role: 'consumer', creator: null, featureFlags: { video_upload: this.videoUploadFlag } },
      });
      return;
    }

    if (url.pathname === '/api/creator-profile' && request.method() === 'GET') {
      await route.fulfill({ json: { ...this.profile, avatarObjectPath: null, dateOfBirth: null } });
      return;
    }

    if (url.pathname === '/api/creator-featured-collections') {
      await route.fulfill({ status: 401, json: { error: 'Sign in to manage featured collections' } });
      return;
    }

    if (url.pathname === '/api/public-feed') {
      await route.fulfill({ json: { items: this.edits.filter((edit) => edit.status === 'published').map((edit) => this.feedItem(edit)) } });
      return;
    }

    const creatorProfileMatch = url.pathname.match(/^\/api\/creators\/([^/]+)\/profile$/);
    if (creatorProfileMatch) {
      await route.fulfill({ json: { ...this.profile, avatarObjectPath: null, dateOfBirth: null } });
      return;
    }

    const creatorWorkspaceMatch = url.pathname.match(/^\/api\/creators\/([^/]+)\/workspace$/);
    if (creatorWorkspaceMatch) {
      await route.fulfill({ json: { creatorId: 'fheed', edits: this.edits.filter((edit) => edit.status === 'published'), collections: [], revision: 1, updatedAt: new Date().toISOString() } });
      return;
    }

    const creatorFeaturedMatch = url.pathname.match(/^\/api\/creators\/([^/]+)\/featured-collections$/);
    if (creatorFeaturedMatch) {
      await route.fulfill({ json: { collectionIds: [] } });
      return;
    }

    const viewsMatch = url.pathname.match(/^\/api\/creators\/([^/]+)\/views$/);
    if (viewsMatch && request.method() === 'POST') {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    if (url.pathname === '/api/me/saved-edits') {
      await route.fulfill({ json: viewer ? this.saved : [] });
      return;
    }

    const saveMatch = url.pathname.match(/^\/api\/edits\/([^/]+)\/save$/);
    if (saveMatch && request.method() === 'PUT') {
      if (!viewer) { await route.fulfill({ status: 401, json: { error: 'Sign in' } }); return; }
      const body = this.requestBody(route);
      const active = Boolean(body.active);
      this.savedCalls.push({ id: saveMatch[1], active });
      this.saved = active ? Array.from(new Set([...this.saved, saveMatch[1]])) : this.saved.filter((id) => id !== saveMatch[1]);
      await route.fulfill({ json: { id: saveMatch[1], active } });
      return;
    }

    const engagementMatch = url.pathname.match(/^\/api\/edits\/([^/]+)\/engagement$/);
    if (engagementMatch) {
      await route.fulfill({ json: { editId: engagementMatch[1], likeCount: 0, commentCount: 0, liked: false, saved: this.saved.includes(engagementMatch[1]) } });
      return;
    }

    const commentsMatch = url.pathname.match(/^\/api\/edits\/([^/]+)\/comments$/);
    if (commentsMatch) {
      await route.fulfill({ json: [] });
      return;
    }

    const relationshipMatch = url.pathname.match(/^\/api\/relationships\/follow\/([^/]+)$/);
    if (relationshipMatch) {
      await route.fulfill({ json: { active: false } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: 'Not found' } });
  }
}

async function viewerPage(page: Page, api: PlaybackApi, options: { ar?: boolean } = {}) {
  await page.context().addCookies([{ name: 'sid', value: viewerSession, url: 'http://127.0.0.1:23385' }]);
  await fakePlaybackEnvironment(page);
  await api.attach(page);
  await page.goto(options.ar ? '/?lang=ar' : '/');
  await expect(page.getByTestId('nav-home')).toBeVisible();
}

test('a sufficiently visible Home video autoplays muted and playsInline, and only one Home video plays at a time', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') }), baseEdit('video-2', { video: videoRef('2') })];
  await viewerPage(page, api);

  const card1 = page.getByTestId('home-video-video-1');
  const card2 = page.getByTestId('home-video-video-2');
  await expect(card1).toBeVisible();
  await expect(card2).toBeVisible();
  await expect(card1).toHaveAttribute('data-playing', 'false');

  await setIntersecting(page, 'home-video-video-1', true, 0.8);
  await expect(card1).toHaveAttribute('data-playing', 'true');
  const video1 = card1.locator('video');
  await expect(video1).toHaveJSProperty('muted', true);
  await expect(video1).toHaveJSProperty('playsInline', true);

  // A second card becoming sufficiently visible must claim exclusive
  // playback and pause the first — never two videos playing at once.
  await setIntersecting(page, 'home-video-video-2', true, 0.8);
  await expect(card2).toHaveAttribute('data-playing', 'true');
  await expect(card1).toHaveAttribute('data-playing', 'false');
});

test('a Home video pauses once it scrolls below the visibility threshold', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') })];
  await viewerPage(page, api);

  const card = page.getByTestId('home-video-video-1');
  await setIntersecting(page, 'home-video-video-1', true, 0.8);
  await expect(card).toHaveAttribute('data-playing', 'true');

  await setIntersecting(page, 'home-video-video-1', false, 0);
  await expect(card).toHaveAttribute('data-playing', 'false');
});

test('a playing Home video pauses when the page becomes hidden', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') })];
  await viewerPage(page, api);

  const card = page.getByTestId('home-video-video-1');
  await setIntersecting(page, 'home-video-video-1', true, 0.8);
  await expect(card).toHaveAttribute('data-playing', 'true');

  await page.evaluate(() => (window as unknown as { __setDocumentHidden: (v: boolean) => void }).__setDocumentHidden(true));
  await expect(card).toHaveAttribute('data-playing', 'false');
});

test('mute/unmute and play/pause controls work on a Home video card', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') })];
  await viewerPage(page, api);

  const card = page.getByTestId('home-video-video-1');
  await setIntersecting(page, 'home-video-video-1', true, 0.8);
  await expect(card).toHaveAttribute('data-playing', 'true');

  // Starts muted by default, so the control initially offers "Unmute".
  const unmuteButton = card.getByRole('button', { name: 'Unmute', exact: true });
  await expect(unmuteButton).toBeVisible();
  await unmuteButton.click();
  await expect(card.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await expect(card.locator('video')).toHaveJSProperty('muted', false);

  const pauseButton = card.getByRole('button', { name: 'Pause', exact: true });
  await pauseButton.click();
  await expect(card).toHaveAttribute('data-playing', 'false');
  await expect(card.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(card).toHaveAttribute('data-playing', 'true');
});

test('the Home video card is keyboard-operable and screen-reader labeled, opening Edit Detail', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1'), caption: 'A lovely look' })];
  await viewerPage(page, api);

  const card = page.getByTestId('home-video-video-1');
  await expect(card).toHaveAttribute('aria-label', 'Open Edit');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('A lovely look')).toBeVisible();
});

test('Home never autoplays when prefers-reduced-motion is set, but the manual play control still works', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') })];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await viewerPage(page, api);

  const card = page.getByTestId('home-video-video-1');
  await setIntersecting(page, 'home-video-video-1', true, 0.9);
  await expect(card).toHaveAttribute('data-playing', 'false');

  await card.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(card).toHaveAttribute('data-playing', 'true');
});

test('Profile and Saved show a poster-only video card with a play icon and duration, and never autoplay', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1', { durationSeconds: 95 }), caption: 'Poster video' })];
  await viewerPage(page, api);

  await page.getByTestId('creator-link-fheed').click();
  await expect(page.getByTestId('profile-edits-grid')).toBeVisible();
  await expect(page.getByTestId('profile-edits-grid').locator('video')).toHaveCount(0);
  await expect(page.getByTestId('profile-edits-grid').getByText('1:35')).toBeVisible();
  const profilePosterImg = page.getByTestId('profile-edits-grid').locator('img').first();
  await expect(profilePosterImg).toBeVisible();

  await page.getByTestId('nav-home').click();
  await page.getByTestId('save-video-1').click();
  await page.getByTestId('nav-saved').click();
  await expect(page.locator('.approved-feed video')).toHaveCount(0);
  await expect(page.locator('.approved-feed').getByText('1:35')).toBeVisible();
});

test('Edit Detail renders a large vertical player respecting the video\'s native aspect ratio, with ordinary controls and no autoplay', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1', { width: 1080, height: 1920 }), caption: 'Detail video' })];
  await viewerPage(page, api);

  await page.getByTestId('edit-title-video-1').click();
  const player = page.locator('.video-detail-player');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('style', /1080 \/ 1920/);
  const video = player.locator('video');
  await expect(video).toHaveJSProperty('controls', true);
  await expect(video).toHaveJSProperty('paused', true);
});

test('a video Edit with missing or invalid playback configuration falls back to a safe placeholder without breaking the page', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [
    baseEdit('video-broken', { video: videoRef('broken', { playbackUrl: null, posterUrl: null }), caption: 'Broken video' }),
    baseEdit('video-ok', { video: videoRef('ok'), caption: 'Working video' }),
  ];
  await viewerPage(page, api);

  const brokenCard = page.getByTestId('edit-card-video-broken');
  await expect(brokenCard.locator('.video-card-placeholder')).toBeVisible();
  await expect(brokenCard.locator('video')).toHaveCount(0);
  // The rest of the page must still be perfectly usable.
  await expect(page.getByTestId('home-video-video-ok')).toBeVisible();
  await brokenCard.getByText('Broken video').click();
  await expect(page.getByText('Broken video')).toBeVisible();
});

test('existing photo Edits render exactly as before, unaffected by the video-playback feature', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('photo-1', { image: '/tastekin-media/quiet-tailoring.webp', caption: 'A photo edit' })];
  await viewerPage(page, api);

  const card = page.getByTestId('edit-card-photo-1');
  await expect(card.locator('.approved-art img')).toBeVisible();
  await expect(card.locator('video')).toHaveCount(0);
  await expect(card.locator('.video-card-placeholder')).toHaveCount(0);
  await card.getByRole('button', { name: 'Open A photo edit' }).click();
  await expect(page.locator('.approved-detail-art img')).toBeVisible();
  await expect(page.locator('.video-detail-player')).toHaveCount(0);
});

test('the video UI has no horizontal overflow at 390×844', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1') })];
  await viewerPage(page, api);
  await expect(page.getByTestId('home-video-video-1')).toBeVisible();
  const overflowingHome = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowingHome).toBe(false);

  await page.getByTestId('creator-link-fheed').click();
  await expect(page.getByTestId('profile-edits-grid')).toBeVisible();
  const overflowingProfile = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowingProfile).toBe(false);

  await page.getByTestId('profile-edits-grid').locator('button').first().click();
  await expect(page.locator('.video-detail-player')).toBeVisible();
  const overflowingDetail = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowingDetail).toBe(false);
});

test('Arabic/RTL: Home video controls, Profile poster card, and Edit Detail player all mirror correctly with no overflow', async ({ page }) => {
  const api = new PlaybackApi();
  api.edits = [baseEdit('video-1', { video: videoRef('1', { durationSeconds: 61 }), caption: 'تعديل بالفيديو', captionAr: 'تعديل بالفيديو' })];
  await viewerPage(page, api, { ar: true });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const card = page.getByTestId('home-video-video-1');
  await expect(card).toHaveAttribute('aria-label', 'فتح التعديل');
  await setIntersecting(page, 'home-video-video-1', true, 0.8);
  await expect(card).toHaveAttribute('data-playing', 'true');
  await expect(card.getByRole('button', { name: 'إلغاء كتم الصوت', exact: true })).toBeVisible();
  let overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowing).toBe(false);

  await page.getByTestId('creator-link-fheed').click();
  await expect(page.getByTestId('profile-edits-grid').getByText('1:01')).toBeVisible();
  overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowing).toBe(false);
});
