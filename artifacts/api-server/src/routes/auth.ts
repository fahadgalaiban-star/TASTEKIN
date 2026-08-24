import crypto from "crypto";
import { Router, type IRouter } from "express";
import { usersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clearSession, createSession, getSessionId, setSessionCookie, upsertUser } from "../lib/auth";
import { ensureCreatorAccount, founderMappingConfigured } from "../lib/creator-account";

const router: IRouter = Router();
const issuer = "https://replit.com/oidc";
function origin(req: import("express").Request) { return `${req.header("x-forwarded-proto") || "https"}://${req.header("x-forwarded-host") || req.header("host")}`; }
function safeReturnTo(value: unknown) { return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/"; }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function cookie(res: import("express").Response, name: string, value: string) { res.cookie(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600_000 }); }
function noStoreSessionResponse(res: import("express").Response) { res.set("Cache-Control", "private, no-store, max-age=0"); res.vary("Cookie"); }

router.get("/auth/user", (req, res) => { noStoreSessionResponse(res); res.json({ user: req.user ?? null }); });
router.get("/me", async (req, res) => {
  noStoreSessionResponse(res);
  if (!req.user) {
    res.json({ user: null, role: "consumer", creator: null });
    return;
  }
  const authorization = await ensureCreatorAccount(req.user);
  const [account] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  const creator = authorization.ok ? {
    id: authorization.workspace.creatorId,
    handle: authorization.workspace.profile.username,
    displayName: authorization.workspace.profile.displayName,
    verified: authorization.verified,
    ownsWorkspace: true,
  } : null;
  res.json({
    user: { id: req.user.id, email: account?.email ?? req.user.email },
    role: creator ? "creator" : "consumer",
    creator,
    founderMappingConfigured: founderMappingConfigured(),
  });
});
router.get("/login", async (req, res) => {
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((result) => result.json()) as { authorization_endpoint: string };
  const state = crypto.randomBytes(24).toString("base64url"); const verifier = crypto.randomBytes(48).toString("base64url");
  cookie(res, "oidc_state", state); cookie(res, "oidc_verifier", verifier); cookie(res, "oidc_return_to", safeReturnTo(req.query.returnTo));
  const url = new URL(discovery.authorization_endpoint); url.search = new URLSearchParams({ client_id: process.env.REPL_ID!, redirect_uri: `${origin(req)}/api/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: hash(verifier), code_challenge_method: "S256", prompt: "login" }).toString();
  res.redirect(url.href);
});
router.get("/callback", async (req, res) => {
  if (req.query.state !== req.cookies?.oidc_state || typeof req.query.code !== "string") { res.redirect("/api/login"); return; }
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((result) => result.json()) as { token_endpoint: string; userinfo_endpoint: string };
  const token = await fetch(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: req.query.code, redirect_uri: `${origin(req)}/api/callback`, client_id: process.env.REPL_ID!, code_verifier: req.cookies.oidc_verifier }).toString() }).then(async (result) => result.ok ? result.json() as Promise<{ access_token: string; expires_in?: number }> : null);
  if (!token?.access_token) { res.redirect("/api/login"); return; }
  const claims = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${token.access_token}` } }).then((result) => result.ok ? result.json() as Promise<Record<string, unknown>> : null);
  if (!claims?.sub) { res.redirect("/api/login"); return; }
  const user = await upsertUser(claims); const sid = await createSession({ user, accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
  setSessionCookie(res, sid); ["oidc_state", "oidc_verifier", "oidc_return_to"].forEach((name) => res.clearCookie(name, { path: "/" })); res.redirect(safeReturnTo(req.cookies?.oidc_return_to));
});
router.get("/logout", async (req, res) => { await clearSession(res, getSessionId(req)); res.redirect(safeReturnTo(req.query.returnTo)); });
export default router;
