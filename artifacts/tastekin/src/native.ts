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
// Deliberately NOT in this file (separate, reviewed PRs): the native auth
// session (bearer token in Keychain/Keystore), OAuth in the system browser,
// deep links and push.
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { setBaseUrl } from '@workspace/api-client-react';

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
// well as through the generated client (setBaseUrl covers that one). Patching
// window.fetch once, before React mounts, keeps every existing call site
// unchanged for the web while routing native traffic to the remote API.
function installFetchRewrite(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = rewriteFetchInput(input);
    if (target === input) return originalFetch(input, init);
    // Cross-origin now: be explicit that cookies/credentials are wanted.
    return originalFetch(target, { ...init, credentials: 'include' });
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
 * plugin calls are fire-and-forget.
 */
export function initNativeShell(): void {
  if (!isNativeApp) return;
  if (!API_BASE_URL) {
    console.error('[tastekin-native] VITE_API_BASE_URL was not set at build time; API calls will fail.');
  }
  installFetchRewrite();
  setBaseUrl(API_BASE_URL || null);
  document.documentElement.classList.add('native-app', `native-${nativePlatform}`);
  void configureNativeChrome();
}

/** Hides the launch splash once the web app has painted its first frame. */
export async function hideNativeSplash(): Promise<void> {
  if (!isNativeApp) return;
  try { await SplashScreen.hide({ fadeOutDuration: 200 }); } catch { /* launchShowDuration is the safety net */ }
}
