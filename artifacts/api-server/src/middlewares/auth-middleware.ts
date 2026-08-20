import type { NextFunction, Request, Response } from "express";
import { getSession, getSessionId } from "../lib/auth";

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
    const session = await getSession(sid);
    if (session) req.user = session.user;
  }
  next();
}