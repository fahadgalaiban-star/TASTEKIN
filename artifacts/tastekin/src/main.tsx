import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { hideNativeSplash, initNativeShell } from './native';

import './index.css';

// No-op in the browser; inside the iOS/Android shell this must run before
// the first render so the app's `/api/...` calls reach the remote API.
initNativeShell();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Two frames in: React has committed and the browser has painted, so the
// native splash can give way to real content instead of a white flash.
requestAnimationFrame(() => requestAnimationFrame(() => { void hideNativeSplash(); }));
