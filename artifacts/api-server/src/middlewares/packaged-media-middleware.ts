import express, { type Request, type Response, type NextFunction } from "express";
import { mediaRequestOriginAllowed, packagedMediaDirectory, packagedMediaReference } from "../lib/packaged-media";
import { staticModerationMiddleware } from "./moderation-middleware";

const files = express.static(packagedMediaDirectory, {
  fallthrough: false, redirect: false, dotfiles: "deny",
  cacheControl: false, etag: false, lastModified: false,
});

/** Mounted at /tastekin-media, with no SPA or other static fallback. */
export function packagedMediaMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.vary("Origin");
  if (!mediaRequestOriginAllowed(req)) { res.status(403).end(); return; }
  if (!["GET", "HEAD"].includes(req.method)) { res.status(405).end(); return; }
  // Decode before checking moderation, but leave Express to handle file serving.
  const reference = packagedMediaReference(`/tastekin-media${req.path}`);
  if (!reference) {
    res.status(404).end(); return;
  }
  void staticModerationMiddleware(req, res, () => {
    files(req, res, (error?: unknown) => {
      if (error && (error as { status?: number }).status === 404) { res.status(404).end(); return; }
      if (error) next(error);
    });
  });
}