// Decides what the native shell should do with a tapped link.
//
// Inside the Capacitor shell every absolute http(s) link is cross-origin
// (the bundle lives at capacitor://localhost), and Capacitor's default for
// a `target="_blank"` link is UIApplication.open — i.e. the user is thrown
// out of the app into Safari. The shell instead opens ordinary web links in
// the in-app browser (SFSafariViewController / Custom Tabs), while a short
// list of destinations deliberately keeps the system behaviour:
//
// - Maps links (Apple Maps / Google Maps) → the Maps app, which is what the
//   user expects from a "directions" button.
// - Non-web schemes (mailto:, tel:, sms:) → the system handler.
// - Links back to the app's own origins (the bundle, or the API/web origin
//   the bundle talks to) → left to the app.
//
// Pure and side-effect free so it can be unit-tested; the DOM wiring lives
// in src/native.ts.

export type ExternalLinkAction = 'in-app-browser' | 'system' | 'default';

const MAPS_HOSTS = new Set(['maps.apple.com', 'maps.google.com', 'maps.app.goo.gl']);

/** True for the same destinations src/App.tsx accepts as a safe maps link, plus goo.gl/maps short links. */
export function isMapsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (MAPS_HOSTS.has(host)) return true;
  if (host === 'apple.com' || host === 'www.apple.com') return url.pathname.startsWith('/maps');
  if (host === 'google.com' || host === 'www.google.com') return url.pathname.startsWith('/maps');
  if (host === 'goo.gl') return url.pathname.startsWith('/maps');
  return false;
}

/**
 * @param href        the anchor's href attribute (relative or absolute)
 * @param ownOrigins  origins that count as "the app itself" (the bundle origin
 *                    and, in the shell, the remote API/web origin)
 */
export function classifyExternalLink(href: string, ownOrigins: readonly string[]): ExternalLinkAction {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return 'default';
  let url: URL;
  try {
    url = new URL(trimmed, ownOrigins[0] || 'http://localhost');
  } catch {
    return 'default';
  }
  // Own origins first: inside the shell the bundle origin is capacitor://,
  // which is neither http(s) nor something the system should handle. (Also,
  // `URL.origin` is the literal string "null" for such non-special schemes,
  // so origins are compared as scheme + host instead.)
  if (ownOrigins.some((own) => sameOrigin(own, url))) return 'default';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'system';
  if (isMapsUrl(url)) return 'system';
  return 'in-app-browser';
}

function sameOrigin(own: string, url: URL): boolean {
  try {
    const ownUrl = new URL(own);
    return ownUrl.protocol === url.protocol && ownUrl.host.toLowerCase() === url.host.toLowerCase();
  } catch {
    return false;
  }
}
