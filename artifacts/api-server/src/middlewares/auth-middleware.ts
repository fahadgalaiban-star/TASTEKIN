import type { NextFunction, Request, Response } from "express";
import { getSession, getSessionId } from "../lib/auth";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
      isAuthenticated(): boolean;
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.isAuthenticated = () => Boolean(req.user);
  const sid = getSessionId(req);
  if (sid) {
    // This middleware runs on every single request. A database hiccup while
    // resolving the session (a connectivity blip, a misconfigured/unreachable
    // DATABASE_URL in a given environment, a transient pool error) must never
    // take down the entire request pipeline — that previously surfaced as a
    // 500 "Internal Server Error" on literally any route, for any request
    // carrying a session cookie, including the OIDC callback and every
    // health/API endpoint. Fail closed on identity (treat as signed-out)
    // rather than failing the whole request; the underlying error is still
    // logged so it's diagnosable, never silently swallowed.
    try {
      const session = await getSession(sid);
      if (session) req.user = session.user;
    } catch (error) {
      (req.log ?? logger).error({ err: error }, "Session lookup failed; continuing as signed-out");
    }
  }
  next();
}