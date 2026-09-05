import type { NextFunction, Request, Response } from "express";
import { isReady } from "../lib/startup-state";

/**
 * Mounted at "/api", before authMiddleware and the real router, so none of
 * this ever touches the database or session store — that matters
 * specifically during startup, when migrations may be running (or the
 * schema may not match the app yet) and every other query is a potential
 * failure or a wait behind the migration's advisory lock.
 *
 * While not ready:
 *  - GET /api and GET /api/healthz (req.path "/" and "/healthz" relative to
 *    this mount point) answer immediately with 200 { status: "starting" }.
 *    This is the fix for the Replit Autoscale port-open timeout: the HTTP
 *    listener opens (see index.ts) before migrations ever run, and these
 *    two paths — whichever one the platform's port/health probe hits —
 *    always get an immediate response, never waiting on a migration that
 *    can take up to its full timeout budget.
 *  - Every other /api/* route answers 503, so nothing serves a real
 *    request (or touches the database) against a schema that hasn't been
 *    validated yet.
 *
 * Once ready, this simply calls next() unconditionally — every route,
 * including the real GET /api/healthz handler in routes/health.ts (which
 * then takes over and answers { status: "ok" }) and the bare GET /api 404,
 * behaves exactly as it did before this middleware existed.
 */
export function readinessMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isReady()) {
    next();
    return;
  }
  res.set("Cache-Control", "no-store");
  if (req.method === "GET" && (req.path === "/" || req.path === "/healthz")) {
    res.status(200).json({ status: "starting" });
    return;
  }
  res.set("Retry-After", "1");
  res.status(503).json({ status: "starting", error: "Service is starting up" });
}
