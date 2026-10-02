import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';

/**
 * Native blob loads stay on our authorized API origin. Browser <img> loads
 * retain their existing redirects; public routes never call this helper.
 * The signed provider URL and native bearer are never forwarded to the DOM.
 */
export async function streamPrivateImage(
  res: Response,
  signedURL: string,
  fetchImage: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await fetchImage(signedURL, {
      signal: AbortSignal.timeout(30_000),
      // Deliberately no incoming request headers or bearer credentials.
    });
    if (!response.ok || !response.body) throw new Error('Private image unavailable');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    // Sanitize body-stream errors before pipeline can emit them on res, where
    // HTTP logging might otherwise observe a provider URL or signature.
    const safeBody = new PassThrough();
    source.on('error', () => safeBody.destroy(new Error('Private image unavailable')));
    safeBody.on('close', () => source.destroy());
    source.pipe(safeBody);
    await pipeline(safeBody, res);
  } catch {
    // Provider exceptions can contain a signed URL: never forward or log them.
    throw new Error('Private image unavailable');
  }
}