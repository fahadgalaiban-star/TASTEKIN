import type { CapacitorConfig } from '@capacitor/cli';

// Native shell configuration (iOS + Android).
//
// Architecture (approved): the web build in `dist/public` is BUNDLED into the
// native app; every `/api/...` call is rewritten at runtime to the remote
// production API (see src/native.ts and VITE_API_BASE_URL). `server.url` is
// deliberately NOT used — the app must not be a thin wrapper around a remote
// web page.
const config: CapacitorConfig = {
  appId: 'app.tastekin',
  appName: 'TASTEKIN',
  webDir: 'dist/public',
  server: {
    // Serve the bundled assets from https://localhost on Android (matches
    // iOS' capacitor://localhost secure context; required for Secure cookies,
    // camera access and other secure-context web APIs).
    androidScheme: 'https',
  },
  ios: {
    // The web app draws its own bars and already pads with
    // env(safe-area-inset-*), so let the WebView extend under the status bar.
    contentInset: 'never',
    backgroundColor: '#F5F1E9',
  },
  android: {
    backgroundColor: '#F5F1E9',
    // Screenshots / screen recording stay allowed (no FLAG_SECURE).
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      // The web app hides the splash itself once React has mounted
      // (src/native.ts); the timeout is only a safety net.
      launchAutoHide: false,
      launchShowDuration: 3000,
      backgroundColor: '#F5F1E9',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false,
      showSpinner: false,
    },
    StatusBar: {
      // Warm Ivory canvas → dark status-bar glyphs.
      style: 'LIGHT',
      backgroundColor: '#F5F1E9',
      overlaysWebView: true,
    },
    Keyboard: {
      // Resize the document body so fixed bottom UI (composer, sheets)
      // rides above the keyboard instead of being covered by it.
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
