/** Only these owned-image routes need native bearer authentication. */
export function privateImagePath(src: string | undefined, apiBase: string): string | null {
  if (!src) return null;
  let path = src;
  if (/^https?:\/\//i.test(src)) {
    if (!apiBase) return null;
    try {
      const base = new URL(apiBase);
      const url = new URL(src);
      const prefix = base.pathname.replace(/\/$/, '');
      if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(`${prefix}/`)) return null;
      path = `${url.pathname.slice(prefix.length)}${url.search}`;
    } catch { return null; }
  }
  // Raw creator object paths can also appear in workspace/profile previews.
  if (path.startsWith('/objects/uploads/')) path = `/api/storage${path}`;
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname.startsWith('/api/storage/objects/')
    || /^\/api\/closet-items\/[^/]+\/image$/.test(pathname) ? path : null;
}

export type PrivateImageState =
  | { status: 'loading'; src?: never }
  | { status: 'ready'; src: string }
  | { status: 'unauthorized' | 'error'; src?: never };

export type ImageTransport = {
  fetch: typeof fetch;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

/**
 * One mounted image/source owns one request and one temporary URL.
 * No credentials are read or copied here: the existing native fetch wrapper
 * authenticates the relative API path and omits cookies.
 */
export function loadPrivateImage(
  path: string,
  update: (state: PrivateImageState) => void,
  transport: ImageTransport,
): () => void {
  const controller = new AbortController();
  let active = true;
  let objectURL: string | undefined;
  update({ status: 'loading' });
  void (async () => {
    try {
      const response = await transport.fetch(path, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'X-Tastekin-Private-Image': '1' },
      });
      if (!active) return;
      if (!response.ok) {
        update({ status: response.status === 401 || response.status === 403 ? 'unauthorized' : 'error' });
        return; // Never read or display server error bodies/URLs.
      }
      const blob = await response.blob();
      if (!active) return;
      if (!blob.size) { update({ status: 'error' }); return; }
      objectURL = transport.createObjectURL(blob);
      update({ status: 'ready', src: objectURL });
    } catch {
      if (active) update({ status: 'error' }); // Never expose thrown messages.
    }
  })();
  return () => {
    active = false;
    controller.abort();
    if (objectURL) transport.revokeObjectURL(objectURL);
    objectURL = undefined;
  };
}