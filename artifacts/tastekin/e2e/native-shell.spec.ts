import { test, expect } from '@playwright/test';

// src/native.ts is a no-op in the browser; inside the Capacitor shell it must
// route the app's relative `/api/...` calls to the remote API. Capacitor's
// runtime detects the Android shell by the presence of `window.androidBridge`,
// so an init script is enough to make the web app believe it is native.
//
// Requires the dev server to have been started with
// VITE_API_BASE_URL=https://api.tastekin.test (the base URL is baked in at
// build time); the suite skips itself otherwise.
const API_BASE = process.env.VITE_API_BASE_URL;

test.describe('native shell', () => {
  test.skip(!API_BASE, 'VITE_API_BASE_URL not set for the dev server');

  test('browser (non-native): /api calls stay same-origin and no native class is set', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/me')) seen.push(request.url()); });
    await page.goto('/');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):23385\/api\/me$/);
    await expect(page.locator('html')).not.toHaveClass(/native-app/);
  });

  test('simulated Android shell: /api calls go to VITE_API_BASE_URL with credentials, media too', async ({ page, context }) => {
    const remote: { url: string; method: string; cookie: string | null }[] = [];
    // Pretend to be the Capacitor Android WebView.
    await page.addInitScript(() => { (window as unknown as { androidBridge: unknown }).androidBridge = {}; });
    // A cookie on the API host is only attached to cross-origin fetches made
    // with credentials: 'include' — which is what native.ts must set.
    await context.addCookies([{ name: 'probe', value: '1', domain: new URL(API_BASE!).hostname, path: '/', secure: true, sameSite: 'None' }]);
    await page.route(`${API_BASE}/**`, async (route) => {
      const request = route.request();
      const headers = await request.allHeaders();
      remote.push({ url: request.url(), method: request.method(), cookie: headers.cookie ?? null });
      const path = new URL(request.url()).pathname;
      if (path === '/api/me') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, role: 'consumer', creator: null, isAdmin: false, language: 'en', featureFlags: {} }) });
        return;
      }
      if (path === '/api/public-feed') {
        // Server-relative media paths, exactly as the real API returns them.
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{
          creatorUsername: 'fheed', creatorName: 'Fheed Alaiban', creatorVerified: true, following: false,
          creatorAvatar: '/api/public-profile-media/fheed',
          edit: { id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة', caption: 'A soft-structured look.', captionAr: 'إطلالة مريحة.', image: '/api/public-media/fheed/quiet-tailoring', location: 'Mayfair, London', locationAr: 'مايفير، لندن', altText: 'Tailoring.', access: 'public', status: 'published', collectionIds: [] },
        }] }) });
        return;
      }
      // Everything else behaves like an unreachable API (same as the dev proxy
      // with no api-server running), which the app already tolerates.
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/native-app/);
    await expect(page.locator('html')).toHaveClass(/native-android/);
    await expect.poll(() => remote.some((r) => r.url === `${API_BASE}/api/me`)).toBe(true);
    // Nothing API-shaped may still target the local (bundled) origin.
    const local = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /:23385\/api\//.test(n)));
    expect(local).toEqual([]);
    // Public feed loads through the rewrite as well (signed-out home screen).
    await expect.poll(() => remote.some((r) => r.url === `${API_BASE}/api/public-feed`)).toBe(true);
    // The rewritten calls are credentialed cross-origin requests.
    const me = remote.find((r) => r.url === `${API_BASE}/api/me`);
    expect(me?.cookie).toContain('probe=1');
    // imageSrc()/apiUrl() cover media: the feed card's image and avatar, which
    // the server returns as relative `/api/...` paths, must point at the API.
    await expect(page.locator(`img[src="${API_BASE}/api/public-media/fheed/quiet-tailoring"]`).first()).toBeAttached();
    await expect(page.locator(`img[src="${API_BASE}/api/public-profile-media/fheed"]`).first()).toBeAttached();
    await expect.poll(() => remote.some((r) => r.url === `${API_BASE}/api/public-media/fheed/quiet-tailoring`)).toBe(true);
  });
});
