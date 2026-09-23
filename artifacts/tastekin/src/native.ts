// Native shell glue for the Capacitor apps (iOS / Android).
//
// Every export here is a no-op in an ordinary browser: `Capacitor.isNativePlatform()`
// is false there, so the web app keeps its existing same-origin behaviour
// (relative `/api/...` calls served by the api-server that also serves the
// built frontend — see artifacts/api-server/src/app.ts).
//
// Inside the native shell the web build is BUNDLED into the app and served
// from `capacitor://localhost` (iOS) / `https://localhost` (Android), so a
// relative `/api/...` URL would hit the local bundle instead of the API.
// `initNativeShell()` therefore rewrites those URLs to the remote production
// API given by `VITE_API_BASE_URL` at build time.
//
// Native authentication (PR-2): the shell never relies on the web's `sid`
// cookie (SameSite=Lax, never sent cross-origin). Instead a separate opaque
// token issued by POST /api/auth/native/{login,signup} is kept ONLY in iOS
// Keychain / Android Keystore via @aparajita/capacitor-secure-storage and sent
// as `Authorization: Bearer` on every API call. See docs/MOBILE.md.
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

export const isNativeApp: boolean = Capacitor.isNativePlatform();
export const nativePlatform: 'ios' | 'android' | 'web' = (() => {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
})();

// Remote API origin, e.g. https://tastekin.app — set at build time via
// VITE_API_BASE_URL (see docs/MOBILE.md). Trailing slashes are dropped so
// `${API_BASE_URL}/api/...` never produces `//api`.
const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
export const API_BASE_URL: string = configuredBaseUrl.replace(/\/+$/, '');

const isApiPath = (path: string): boolean => path === '/api' || path.startsWith('/api/');

/**
 * Absolute URL for an app-relative `/api/...` path when running inside the
 * native shell; anything else (absolute URLs, non-API paths, empty values)
 * is returned untouched. Identity function on the web.
 */
export function apiUrl<T extends string | null | undefined>(path: T): T {
  if (!isNativeApp || !API_BASE_URL || typeof path !== 'string' || !isApiPath(path)) return path;
  return `${API_BASE_URL}${path}` as T;
}

// ---------------------------------------------------------------------------
// Native session token (secure storage)
// ---------------------------------------------------------------------------

// TASTEKIN-specific prefix: every key this app writes through the plugin is
// namespaced, so removing our token can never touch an item owned by another
// plugin or by a future feature. Only `remove(key)` is ever called — never an
// unscoped `clear()`.
const SECURE_STORAGE_PREFIX = 'tastekin_native_auth_';
const SESSION_TOKEN_KEY = 'session_token';
// App-local (WebView localStorage) marker. iOS keeps Keychain items across an
// uninstall while localStorage is wiped with the app, so "no marker" means a
// genuine reinstall: discard the previous install's token (our key only).
const INSTALL_MARKER_KEY = 'tastekin:native-install';

let memoryToken: string | null = null;
let tokenReady: Promise<void> = Promise.resolve();

function readInstallMarker(): boolean {
  try { return window.localStorage.getItem(INSTALL_MARKER_KEY) === '1'; } catch { return true; } // unreadable storage: never treat as reinstall
}
function writeInstallMarker(): void {
  try { window.localStorage.setItem(INSTALL_MARKER_KEY, '1'); } catch { /* best effort */ }
}

async function configureSecureStorage(): Promise<void> {
  await SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
  // Never let the token leave this device: no iCloud Keychain sync and, on
  // iOS, an accessibility class that excludes it from device-to-device
  // backup migration. Both are set explicitly rather than trusting defaults.
  await SecureStorage.setSynchronize(false);
  if (nativePlatform === 'ios') await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
}

async function removeStoredToken(): Promise<void> {
  try { await SecureStorage.remove(SESSION_TOKEN_KEY, false); } catch { /* nothing stored, or storage unavailable */ }
}

async function loadStoredToken(): Promise<void> {
  try {
    await configureSecureStorage();
    if (!readInstallMarker()) {
      // First launch of this install: a Keychain item from a previous install
      // must not silently sign the user in. Remove exactly our key.
      await removeStoredToken();
      writeInstallMarker();
      memoryToken = null;
      return;
    }
    // `get` is the read half of `set` (JSON-encoded value); sync=false is
    // passed explicitly so the local keychain is the only one consulted.
    const stored = await SecureStorage.get(SESSION_TOKEN_KEY, false, false);
    memoryToken = typeof stored === 'string' && stored ? stored : null;
    if (stored !== null && memoryToken === null) await removeStoredToken(); // not a token: self-heal
  } catch (error) {
    console.error('[tastekin-native] secure storage unavailable; continuing signed-out', error);
    memoryToken = null;
  }
}

export function getNativeToken(): string | null {
  return memoryToken;
}

/** Persists a freshly issued token (login/signup) and makes it the active credential. */
export async function storeNativeToken(token: string): Promise<void> {
  memoryToken = token;
  writeInstallMarker();
  try {
    // sync=false and the device-only access class are passed per call as well
    // as globally, so this write can never fall back to a syncing keychain.
    await SecureStorage.set(SESSION_TOKEN_KEY, token, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  } catch (error) {
    // The session still works for this run (memory); it will simply not
    // survive a restart. Surfaced in the console for diagnosis.
    console.error('[tastekin-native] could not persist the session token', error);
  }
}

/** Forgets the token locally (memory + secure storage). Never fails. */
export async function clearNativeToken(): Promise<void> {
  memoryToken = null;
  await removeStoredToken();
}

/**
 * Native sign-out: best-effort server revocation, then ALWAYS clear the local
 * token so the app returns to signed-out even when offline or when the
 * revoke request fails. Callers refresh the session afterwards.
 */
export async function nativeSignOut(): Promise<void> {
  const token = memoryToken;
  try {
    if (token) await window.fetch('/api/auth/native/logout', { method: 'POST' });
  } catch { /* offline or server error: local sign-out still proceeds */ }
  finally {
    await clearNativeToken();
  }
}

/**
 * Called with every /api/me payload. Only an explicit "invalid" verdict from
 * the server's own token resolution discards the stored token; an ordinary
 * 401 from some other action, a network failure, or a server-side lookup
 * error ("error") never does.
 */
export async function reconcileNativeSession(payload: { nativeAuth?: unknown } | null | undefined): Promise<void> {
  if (!isNativeApp || !memoryToken) return;
  if (payload && payload.nativeAuth === 'invalid') await clearNativeToken();
}

/** Body fields the native auth routes require alongside email/password. */
export function nativeClientFields(): { platform: 'ios' | 'android' | 'web' } {
  return { platform: nativePlatform };
}

// ---------------------------------------------------------------------------
// fetch rewrite
// ---------------------------------------------------------------------------

function rewriteFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') return isApiPath(input) ? `${API_BASE_URL}${input}` : input;
  if (input instanceof URL) {
    return input.origin === window.location.origin && isApiPath(input.pathname)
      ? new URL(`${API_BASE_URL}${input.pathname}${input.search}${input.hash}`)
      : input;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const parsed = new URL(input.url);
    return parsed.origin === window.location.origin && isApiPath(parsed.pathname)
      ? new Request(`${API_BASE_URL}${parsed.pathname}${parsed.search}${parsed.hash}`, input)
      : input;
  }
  return input;
}

// The app calls `fetch('/api/...')` directly in many places (App.tsx) as
// well as through the generated client (setBaseUrl/setAuthTokenGetter cover
// that one). Patching window.fetch once, before React mounts, keeps every
// existing call site unchanged for the web while routing native traffic to
// the remote API with the bearer token attached.
function installFetchRewrite(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = rewriteFetchInput(input);
    if (target === input) return originalFetch(input, init);
    // The first API calls fire as React mounts; wait for the stored token to
    // be read (and the reinstall check to run) so they are authenticated.
    await tokenReady;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (memoryToken && !headers.has('authorization')) headers.set('authorization', `Bearer ${memoryToken}`);
    // No cookie jar is involved natively (bearer only), so credentials are
    // omitted: simpler CORS, and no chance of a stray Set-Cookie mattering.
    return originalFetch(target, { ...init, headers, credentials: 'omit' });
  };
}

async function configureNativeChrome(): Promise<void> {
  // Warm Ivory canvas → dark status-bar glyphs (Style.Light = light background).
  try { await StatusBar.setStyle({ style: Style.Light }); } catch { /* plugin unavailable on this platform build */ }
  if (nativePlatform === 'android') {
    // Not supported on Android 15+ (edge-to-edge is enforced there and the
    // bar is transparent over our ivory background anyway); harmless elsewhere.
    try { await StatusBar.setBackgroundColor({ color: '#F5F1E9' }); } catch { /* see above */ }
  }
  // Android hardware/gesture back: walk the WebView history the same way the
  // on-screen arrow does (App.tsx goBack → history.back → popstate), and leave
  // the app only from a root screen, where there is nothing left to pop.
  try {
    await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void CapacitorApp.exitApp();
    });
  } catch { /* iOS has no hardware back button; the plugin may not register there */ }
}

/**
 * Must run before React renders (App.tsx fires `/api/me` on mount).
 * Synchronous parts (fetch rewrite, base URL) take effect immediately; the
 * token load is awaited by the first API request, the plugin calls are
 * fire-and-forget.
 */
export function initNativeShell(): void {
  if (!isNativeApp) return;
  if (!API_BASE_URL) {
    console.error('[tastekin-native] VITE_API_BASE_URL was not set at build time; API calls will fail.');
  }
  tokenReady = loadStoredToken();
  installFetchRewrite();
  setBaseUrl(API_BASE_URL || null);
  setAuthTokenGetter(async () => { await tokenReady; return memoryToken; });
  document.documentElement.classList.add('native-app', `native-${nativePlatform}`);
  void configureNativeChrome();
}

/** Hides the launch splash once the web app has painted its first frame. */
export async function hideNativeSplash(): Promise<void> {
  if (!isNativeApp) return;
  try { await SplashScreen.hide({ fadeOutDuration: 200 }); } catch { /* launchShowDuration is the safety net */ }
}
