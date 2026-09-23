import type { NextFunction, Request, Response } from "express";
import { getSession, getSessionId } from "../lib/auth";
import { getBearerToken, resolveNativeSession } from "../lib/native-auth";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
      isAuthenticated(): boolean;
      /** Set when this request was authenticated by a native bearer token (never for cookie sessions). */
      nativeSession?: { id: string; userId: string; platform: string };
      /**
       * Outcome of native bearer resolution, reported on /me so the app can
       * tell a genuinely dead token ("invalid": unknown, revoked or expired —
       * safe to discard) from a transient server problem ("error": keep the
       * token, try again). Absent when no bearer token was presented.
       */
      nativeAuth?: "valid" | "invalid" | "error";
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.isAuthenticated = () => Boolean(req.user);
  const bearer = getBearerToken(req);
  if (bearer) {
    // Native app path. A bearer token, when present, is the credential for
    // this request; the cookie is not consulted (the shell never has one).
    try {
      const resolved = await resolveNativeSession(bearer);
      if (resolved) {
        req.user = resolved.user;
        req.nativeSession = resolved.session;
        req.nativeAuth = "valid";
      } else {
        req.nativeAuth = "invalid";
      }
    } catch (error) {
      req.nativeAuth = "error";
      (req.log ?? logger).error({ err: error }, "Native session lookup failed; continuing as signed-out");
    }
    next();
    return;
  }
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
