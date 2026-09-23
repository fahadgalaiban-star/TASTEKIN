# TASTEKIN native apps (iOS / Android)

The native apps are Capacitor shells around the existing web app in
`artifacts/tastekin`. The web build is **bundled** into each app and talks to
the **remote production API**. `server.url` (loading a remote web page) is not
used, and the app is not rewritten in React Native / Expo.

| Setting | Value |
| --- | --- |
| App name | `TASTEKIN` |
| iOS bundle ID / Android application ID | `app.tastekin` |
| Web assets | `artifacts/tastekin/dist/public` |
| Capacitor | 8.x (`@capacitor/core`, `cli`, `ios`, `android`, `app`, `browser`, `status-bar`, `keyboard`, `splash-screen`) |
| iOS | deployment target iOS 15, Swift Package Manager (no CocoaPods) |
| Android | minSdk 24, target/compile SDK 36, AGP 8.13, Gradle 8.14, JDK 21 |

Everything lives in `artifacts/tastekin`:

```
capacitor.config.ts        appId / appName / webDir / plugin config
src/native.ts              native-only glue (no-op in the browser)
ios/                       generated Xcode project (committed)
android/                   generated Gradle project (committed)
native/generate-assets.py  icon + splash derivation from the approved master
native/preview/            review renders of the generated assets
```

## How the web app behaves inside the shell

`src/native.ts` runs before React mounts (`src/main.tsx`) and does nothing
unless `Capacitor.isNativePlatform()` is true:

- **API base URL.** The bundle is served from `capacitor://localhost` (iOS) /
  `https://localhost` (Android), so a relative `/api/...` would hit the bundle.
  `window.fetch` is wrapped to send `/api/...` to `VITE_API_BASE_URL`, and the
  generated client gets the same base via `setBaseUrl`. Media paths the server
  returns relatively (`/api/public-media/...`, `/api/storage/objects/...`,
  `/api/closet-items/:id/image`) go through `apiUrl()` in `App.tsx`.
- **Status bar.** Dark glyphs over the Warm Ivory canvas; the WebView extends
  under the bar and `approved.css` pads `.approved-shell` with
  `env(safe-area-inset-*)` under the `html.native-app` class only. `index.html`
  now declares `viewport-fit=cover` so those insets are populated.
- **Keyboard.** `resize: 'body'` so fixed bottom UI moves above the keyboard.
- **Splash.** Native splash stays up until the first painted frame, then hides
  (`launchShowDuration` is a 3 s safety net).
- **Android back button.** Walks the WebView history exactly like the on-screen
  back arrow (`history.back()` → the app's `popstate` handler); on a root screen
  with nothing left to pop it exits the app.

Build-time variable:

| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Vite build env (`.env.production.local` locally, repository variable `TASTEKIN_API_BASE_URL` in CI) | Origin of the production API, e.g. `https://<production-host>`; no trailing slash. |

Server-side prerequisite: the API's `ALLOWED_ORIGINS` must include
`capacitor://localhost` and `https://localhost` (the shell's origins) so CORS
allows the app. This is a deployment configuration change, not code.

## What is deliberately *not* in the shell yet

- **Authentication.** The web app relies on the `sid` cookie
  (`SameSite=Lax`), which browsers do not send on cross-origin requests from
  the shell. Signed-in flows therefore do not work natively until the native
  session work lands (separate PR: bearer token in iOS Keychain / Android
  Keystore, OAuth via the system browser, no Replit login in the app).
  `window.location.assign('/api/logout' | '/api/login' | '/api/auth/google')`
  in `App.tsx` are part of that change.
- Deep links / universal links, push notifications, in-app purchases (the
  first release is free; no store products).
- Brand token / font alignment (Noto fonts, Warm Ivory `#F5F1E9` etc.) — the web
  app still uses its current tokens.

## Building

```bash
# from the repo root
pnpm install
pnpm run typecheck:libs
VITE_API_BASE_URL=https://<production-host> pnpm --filter @workspace/tastekin run build

cd artifacts/tastekin
npx cap sync                       # copies dist/public + plugin config into ios/ and android/
npx cap open ios                   # Xcode (macOS only)
npx cap open android               # Android Studio
```

CI (`.github/workflows/mobile-build.yml`) validates every PR touching the web
app: the web bundle, a debug APK + unsigned release AAB on Ubuntu, and unsigned
simulator + device builds on macOS. **No signing, no upload, no store
credentials** — those are a later step once developer accounts are set up.

## Icons and splash

The single source of truth is the approved master
`artifacts/mockup-sandbox/public/images/tastekin/TASTEKIN_app_icon_v2_1024.png`.
`native/generate-assets.py` (Pillow + numpy) derives every platform asset
mechanically — nothing is redrawn, simplified or recoloured:

- **iOS AppIcon** — 1024×1024 opaque square; the master's transparent rounded
  corners are filled by extending the tile's own gradient (iOS masks the
  corners itself).
- **Android adaptive icon** — background = the gradient tile, foreground = the
  white disc + KIN Link mark scaled into the 66 % safe zone; **monochrome**
  layer = silhouette of the frames + dot for themed icons; legacy
  `ic_launcher` / `ic_launcher_round` PNGs for API < 26.
- **Splash / launch** — Warm Ivory `#F5F1E9` with the KIN Link mark centred
  (iOS 2732×2732 universal image, Android portrait/landscape drawables).

Regenerate after any change to the master:

```bash
cd artifacts/tastekin && python3 native/generate-assets.py
```

## Before public store submission (tracked separately)

Free app, no In-App Purchase / Play Billing / Stripe / product IDs / paywall.
Still required: native auth, removal of paid-content remnants in the web app,
account deletion, Privacy Policy and Terms URLs, reviewer demo access, and
Apple sign-in alongside Google sign-in if Google ships on iOS.
