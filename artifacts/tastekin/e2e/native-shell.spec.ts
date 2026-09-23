import { test, expect, type Page } from '@playwright/test';

// src/native.ts is a no-op in the browser; inside the Capacitor shell it must
// route the app's relative `/api/...` calls to the remote API and, since PR-2,
// authenticate them with the native bearer token kept in secure storage.
//
// Simulation: `window.CapacitorCustomPlatform = { name: 'tastekin-sim' }`
// makes Capacitor report a native platform, and every plugin (including
// @aparajita/capacitor-secure-storage) falls back to its *web* implementation,
// which for secure storage is a prefix-scoped localStorage store. That lets
// these tests exercise the real plugin JS paths (prefix, remove-only-our-key,
// persistence across reload) without a device. Keychain/Keystore specifics
// (whenUnlockedThisDeviceOnly, no iCloud sync) are configured in native.ts and
// can only be observed on a device; the server side is covered by
// scripts/src/verify-native-auth.ts.
//
// Requires the dev server to have been started with
// VITE_API_BASE_URL=https://api.tastekin.test (the base URL is baked in at
// build time); the suite skips itself otherwise.
const API_BASE = process.env.VITE_API_BASE_URL;
const TOKEN_STORAGE_KEY = 'tastekin_native_auth_session_token';
const INSTALL_MARKER_KEY = 'tastekin:native-install';
const OTHER_PLUGIN_KEY = 'capacitor-storage_other_plugin_value';
const ISSUED_TOKEN = 'a'.repeat(43);
// The plugin JSON-encodes values written with set(); this is the exact
// representation that ends up in the (localStorage-backed) web store.
const STORED_TOKEN = JSON.stringify(ISSUED_TOKEN);

type Seen = { url: string; method: string; authorization: string | null; cookie: string | null; body: string | null };

function signedOutMe(nativeAuth: string | null) {
  return { user: null, role: 'consumer', creator: null, isAdmin: false, language: 'en', featureFlags: {}, nativeAuth };
}
function signedInMe() {
  return { user: { id: 'u1', email: 'member@example.com' }, role: 'consumer', creator: null, isAdmin: false, language: 'en', featureFlags: {}, nativeAuth: 'valid' };
}

// Fake remote API. `/api/me` answers from the Authorization header exactly the
// way the real middleware does: a known token → signed in; an unknown token →
// signed out with nativeAuth 'invalid'; no token → signed out, nativeAuth null.
async function installFakeApi(page: Page, seen: Seen[], options: { validTokens: Set<string>; meOverride?: () => unknown }) {
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    seen.push({ url: request.url(), method: request.method(), authorization: headers.authorization ?? null, cookie: headers.cookie ?? null, body: request.postData() });
    const path = new URL(request.url()).pathname;
    const token = headers.authorization?.replace(/^Bearer\s+/i, '') ?? null;
    if (path === '/api/me') {
      if (options.meOverride) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(options.meOverride()) }); return; }
      const payload = token ? (options.validTokens.has(token) ? signedInMe() : signedOutMe('invalid')) : signedOutMe(null);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      return;
    }
    if (path === '/api/auth/native/login' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { email?: string; password?: string; platform?: string };
      if (body.password !== 'correct-horse-1') { await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Incorrect email or password.' }) }); return; }
      options.validTokens.add(ISSUED_TOKEN);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: ISSUED_TOKEN, expiresAt: new Date(Date.now() + 180 * 864e5).toISOString(), user: { id: 'u1', email: body.email } }) });
      return;
    }
    if (path === '/api/auth/native/logout' && request.method() === 'POST') {
      if (token) options.validTokens.delete(token);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === '/api/public-feed') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{
        creatorUsername: 'fheed', creatorName: 'Fheed Alaiban', creatorVerified: true, following: false,
        creatorAvatar: '/api/public-profile-media/fheed',
        edit: { id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة', caption: 'A soft-structured look.', captionAr: 'إطلالة مريحة.', image: '/api/public-media/fheed/quiet-tailoring', location: 'Mayfair, London', locationAr: 'مايفير، لندن', altText: 'Tailoring.', access: 'public', status: 'published', collectionIds: [] },
      }] }) });
      return;
    }
    if (path === '/api/me/saved-lists' || path === '/api/closet-items') {
      // A protected action answering 401 must NOT make the app discard its token.
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in to do that.' }) });
      return;
    }
    // Everything else behaves like an unreachable API (same as the dev proxy
    // with no api-server running), which the app already tolerates.
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
  });
}

async function simulateShell(page: Page) {
  await page.addInitScript(() => { (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'tastekin-sim' }; });
}

async function signInNatively(page: Page) {
  await page.goto('/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByLabel('Email').fill('member@example.com');
  await page.getByLabel('Password').fill('correct-horse-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  // Login lands on Home; the sign-out control lives on Settings.
  await expect(page.getByTestId('open-settings-topbar')).toBeVisible();
  await page.getByTestId('open-settings-topbar').click();
}

// The newest /api/me after a fresh load. (Route handlers for the previous
// document's in-flight requests can still land after `seen` is reset, so the
// first entry is not reliable; the last one after network idle is.)
async function lastMeAfterLoad(page: Page, seen: Seen[]) {
  await page.waitForLoadState('networkidle');
  await expect.poll(() => seen.filter((r) => r.url === `${API_BASE}/api/me`).length).toBeGreaterThan(0);
  const calls = seen.filter((r) => r.url === `${API_BASE}/api/me`);
  return calls[calls.length - 1];
}

test.describe('native shell', () => {
  test.skip(!API_BASE, 'VITE_API_BASE_URL not set for the dev server');

  test('browser (non-native): /api calls stay same-origin, no native class, provider buttons visible', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/me')) seen.push(request.url()); });
    await page.goto('/');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):23385\/api\/me$/);
    await expect(page.locator('html')).not.toHaveClass(/native-app/);
    await page.getByTestId('open-settings-topbar').click();
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await expect(page.getByRole('button', { name: 'Continue with Replit' })).toBeVisible();
  });

  test('simulated shell: /api and media go to VITE_API_BASE_URL, no cookies, provider buttons hidden', async ({ page, context }) => {
    const seen: Seen[] = [];
    await simulateShell(page);
    // A cookie on the API host must NOT travel: native requests are bearer-only.
    await context.addCookies([{ name: 'probe', value: '1', domain: new URL(API_BASE!).hostname, path: '/', secure: true, sameSite: 'None' }]);
    await installFakeApi(page, seen, { validTokens: new Set() });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/native-app/);
    await expect.poll(() => seen.some((r) => r.url === `${API_BASE}/api/me`)).toBe(true);
    const local = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /:23385\/api\//.test(n)));
    expect(local).toEqual([]);
    const me = seen.find((r) => r.url === `${API_BASE}/api/me`)!;
    expect(me.cookie).toBeNull();
    expect(me.authorization).toBeNull();
    await expect(page.locator(`img[src="${API_BASE}/api/public-media/fheed/quiet-tailoring"]`).first()).toBeAttached();
    await page.getByTestId('open-settings-topbar').click();
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Replit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  });

  test('simulated shell: email/password login stores the token under the TASTEKIN prefix and authenticates every later call', async ({ page }) => {
    const seen: Seen[] = [];
    await simulateShell(page);
    await installFakeApi(page, seen, { validTokens: new Set() });
    await page.addInitScript(([key]) => { window.localStorage.setItem(key, 'keep-me'); }, [OTHER_PLUGIN_KEY]);
    await signInNatively(page);
    const login = await expect.poll(() => seen.find((r) => r.url === `${API_BASE}/api/auth/native/login`)).not.toBeUndefined().then(() => seen.find((r) => r.url === `${API_BASE}/api/auth/native/login`)!);
    expect(JSON.parse(login.body!)).toMatchObject({ email: 'member@example.com', platform: expect.any(String) });
    await expect(page.getByTestId('settings-sign-out')).toBeVisible();
    // Stored via the plugin with our prefix; the decoy key of "another plugin" is untouched.
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBe(STORED_TOKEN);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), OTHER_PLUGIN_KEY)).toBe('keep-me');
    // Subsequent calls carry the bearer token.
    const authed = seen.filter((r) => r.url === `${API_BASE}/api/me` && r.authorization === `Bearer ${ISSUED_TOKEN}`);
    expect(authed.length).toBeGreaterThan(0);
    // Reload = app relaunch: the token is read back from storage BEFORE the first /api/me.
    seen.length = 0;
    await page.reload();
    expect((await lastMeAfterLoad(page, seen)).authorization).toBe(`Bearer ${ISSUED_TOKEN}`);
    expect(seen.filter((r) => r.url === `${API_BASE}/api/me`).every((r) => r.authorization === `Bearer ${ISSUED_TOKEN}`)).toBe(true);
    await expect(page.getByTestId('open-settings-topbar')).toBeVisible();
    // A 401 from an unrelated protected action must not discard the token.
    await page.evaluate(() => fetch('/api/me/saved-lists').then((r) => r.status));
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBe(STORED_TOKEN);
  });

  test('simulated shell: sign out revokes server-side, clears only our key, and returns to signed-out', async ({ page }) => {
    const seen: Seen[] = [];
    const validTokens = new Set<string>();
    await simulateShell(page);
    await installFakeApi(page, seen, { validTokens });
    await page.addInitScript(([key]) => { window.localStorage.setItem(key, 'keep-me'); }, [OTHER_PLUGIN_KEY]);
    await signInNatively(page);
    await expect(page.getByTestId('settings-sign-out')).toBeVisible();
    await page.getByTestId('settings-sign-out').click();
    await expect.poll(() => seen.some((r) => r.url === `${API_BASE}/api/auth/native/logout` && r.authorization === `Bearer ${ISSUED_TOKEN}`)).toBe(true);
    await expect(page.getByTestId('settings-sign-out')).toHaveCount(0);
    expect(validTokens.has(ISSUED_TOKEN)).toBe(false);
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBeNull();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), OTHER_PLUGIN_KEY)).toBe('keep-me');
    // Still signed out after a relaunch, and no bearer header is sent.
    seen.length = 0;
    await page.reload();
    expect((await lastMeAfterLoad(page, seen)).authorization).toBeNull();
  });

  test('simulated shell: sign out still clears the local token when the revoke request fails (offline)', async ({ page }) => {
    const seen: Seen[] = [];
    await simulateShell(page);
    await installFakeApi(page, seen, { validTokens: new Set() });
    await signInNatively(page);
    await expect(page.getByTestId('settings-sign-out')).toBeVisible();
    await page.route(`${API_BASE}/api/auth/native/logout`, (route) => route.abort('connectionfailed'));
    await page.getByTestId('settings-sign-out').click();
    await expect(page.getByTestId('settings-sign-out')).toHaveCount(0);
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('simulated shell: a token the server reports invalid/revoked is discarded; a server-side lookup error is not', async ({ page }) => {
    const seen: Seen[] = [];
    await simulateShell(page);
    // Pre-seed a stored token (as if issued on a previous run) plus the install marker.
    await page.addInitScript(([tokenKey, markerKey, stored]) => { window.localStorage.setItem(tokenKey, stored); window.localStorage.setItem(markerKey, '1'); }, [TOKEN_STORAGE_KEY, INSTALL_MARKER_KEY, STORED_TOKEN]);
    let me: () => unknown = () => signedOutMe('error');
    await installFakeApi(page, seen, { validTokens: new Set(), meOverride: () => me() });
    await page.goto('/');
    await expect.poll(() => seen.some((r) => r.url === `${API_BASE}/api/me` && r.authorization === `Bearer ${ISSUED_TOKEN}`)).toBe(true);
    // "error" (transient server problem): keep the token.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBe(STORED_TOKEN);
    // "invalid" (unknown / revoked / expired, confirmed by the server): discard it.
    me = () => signedOutMe('invalid');
    await page.reload();
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBeNull();
    seen.length = 0;
    await page.reload();
    expect((await lastMeAfterLoad(page, seen)).authorization).toBeNull();
  });

  test('simulated shell: a genuine reinstall (no install marker) removes only the leftover TASTEKIN token', async ({ page }) => {
    const seen: Seen[] = [];
    await simulateShell(page);
    // Keychain item survived the uninstall, app-local marker did not, a foreign key exists too.
    await page.addInitScript(([tokenKey, otherKey, stored]) => { window.localStorage.setItem(tokenKey, stored); window.localStorage.setItem(otherKey, 'keep-me'); }, [TOKEN_STORAGE_KEY, OTHER_PLUGIN_KEY, STORED_TOKEN]);
    await installFakeApi(page, seen, { validTokens: new Set([ISSUED_TOKEN]) });
    await page.goto('/');
    expect((await lastMeAfterLoad(page, seen)).authorization).toBeNull();
    expect(seen.filter((r) => r.url === `${API_BASE}/api/me`).every((r) => r.authorization === null)).toBe(true);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_STORAGE_KEY)).toBeNull();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), OTHER_PLUGIN_KEY)).toBe('keep-me');
    expect(await page.evaluate((k) => window.localStorage.getItem(k), INSTALL_MARKER_KEY)).toBe('1');
  });
});
