import crypto from "crypto";
import { Router, type IRouter } from "express";
import { usersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession, createLocalUser, createPasswordResetToken, createSession, consumePasswordResetToken,
  findUserByEmail, getSessionId, hashPassword, MIN_PASSWORD_LENGTH, setSessionCookie, upsertGoogleUser,
  upsertUser, validatePassword, verifyPassword,
} from "../lib/auth";
import { logger } from "../lib/logger";
import { ensureCreatorAccount, founderMappingConfigured, isCurrentUserAdmin } from "../lib/creator-account";
import { resolveOnboardingStatus } from "../lib/onboarding";

const router: IRouter = Router();
const issuer = "https://replit.com/oidc";
const googleIssuer = "https://accounts.google.com";
// req.protocol/req.hostname are trust-proxy-aware (see app.set("trust proxy", 1)
// in app.ts): Express only honors X-Forwarded-Proto/X-Forwarded-Host from the
// single configured trusted hop (Replit's own edge), rather than a route
// handler reading those headers raw off any client that happens to reach the
// process. This is what actually determines the OIDC redirect_uri, so it must
// reflect whatever domain the browser used for *this* request (dev, the
// production domain, or — see the /callback comment below — a preview
// deployment's own domain) rather than any hardcoded value.
function origin(req: import("express").Request) { return `${req.protocol}://${req.get("host")}`; }
function safeReturnTo(value: unknown) { return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/"; }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function cookie(res: import("express").Response, name: string, value: string) { res.cookie(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600_000 }); }
function noStoreSessionResponse(res: import("express").Response) { res.set("Cache-Control", "private, no-store, max-age=0"); res.vary("Cookie"); }

/**
 * Contact support is only ever a real, configured destination — never a
 * hardcoded address baked into the client. Returns null (no button shown)
 * until an operator sets this.
 */
export function configuredSupportEmail(): string | null {
  return process.env.SUPPORT_EMAIL?.trim() || null;
}

/**
 * The sign-in screen must never offer "Continue with Google" unless Google
 * OAuth is actually configured — showing it otherwise sends the user into a
 * dead end (GET /auth/google already redirects back with an error in that
 * case, but the button shouldn't appear in the first place).
 */
export function googleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
}

router.get("/auth/user", (req, res) => { noStoreSessionResponse(res); res.json({ user: req.user ?? null }); });
router.get("/me", async (req, res) => {
  noStoreSessionResponse(res);
  if (!req.user) {
    res.json({ user: null, role: "consumer", creator: null, subscribed: false, supportEmail: configuredSupportEmail(), needsOnboarding: false, onboardingStep: "done", googleAuthConfigured: googleAuthConfigured() });
    return;
  }
  try {
    // ensureCreatorAccount must run before resolveOnboardingStatus: it's what
    // guarantees a creator_workspaces row already exists for this user by the
    // time onboarding status is computed.
    const authorization = await ensureCreatorAccount(req.user);
    const [account] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
    const onboarding = await resolveOnboardingStatus(req.user.id);
    res.json({
      user: { id: req.user.id, email: account?.email ?? req.user.email },
      role: authorization.ok ? "creator" : "consumer",
      creator: authorization.ok ? {
        id: authorization.workspace.creatorId,
        handle: authorization.workspace.profile.username,
        displayName: authorization.workspace.profile.displayName,
        verified: authorization.verified,
        ownsWorkspace: true,
      } : null,
      isAdmin: await isCurrentUserAdmin(req.user),
      founderMappingConfigured: founderMappingConfigured(),
      language: account?.language ?? "en",
      notifyPush: account?.notifyPush ?? true,
      notifyEmail: account?.notifyEmail ?? true,
      // No subscriptions table exists yet — this is the real, honest server
      // answer (everyone is unsubscribed) rather than a client-side guess,
      // and becomes a real entitlement check once Stripe is connected.
      subscribed: false,
      supportEmail: configuredSupportEmail(),
      needsOnboarding: onboarding.needsOnboarding,
      onboardingStep: onboarding.step,
      googleAuthConfigured: googleAuthConfigured(),
    });
  } catch (error) {
    logger.error({ err: error, userId: req.user.id }, "GET /me failed");
    res.status(500).json({ user: null, role: "consumer", creator: null });
  }
});
router.get("/login", async (req, res) => {
  try {
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((result) => result.json()) as { authorization_endpoint: string };
    const state = crypto.randomBytes(24).toString("base64url"); const verifier = crypto.randomBytes(48).toString("base64url");
    cookie(res, "oidc_state", state); cookie(res, "oidc_verifier", verifier); cookie(res, "oidc_return_to", safeReturnTo(req.query.returnTo));
    const url = new URL(discovery.authorization_endpoint); url.search = new URLSearchParams({ client_id: process.env.REPL_ID!, redirect_uri: `${origin(req)}/api/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: hash(verifier), code_challenge_method: "S256", prompt: "login" }).toString();
    res.redirect(url.href);
  } catch (error) {
    logger.error({ err: error, host: req.get("host") }, "Replit OIDC login initiation failed");
    res.redirect(`/?authError=${encodeURIComponent("Sign-in with Replit failed. Please try again.")}`);
  }
});
router.get("/callback", async (req, res) => {
  // Replit's OIDC authorization server validates redirect_uri against the
  // callback URLs actually registered for this app's client_id (REPL_ID) —
  // there is no dynamic/wildcard allowance for arbitrary hosts. On an
  // ephemeral deployment-preview domain (a different host per preview,
  // unregistered and unregisterable in advance), it can reject the
  // authorization request outright and return here with an `error` query
  // parameter instead of a `code` — this is a platform-level limitation of
  // Replit Auth on temporary preview domains, not something this app can
  // route around by hardcoding a URL. Surface it clearly rather than
  // silently looping back into /api/login (which would retry the same
  // request forever and, to the user, look like a blank/broken page).
  if (typeof req.query.error === "string") {
    logger.error({ error: req.query.error, description: req.query.error_description, host: req.get("host") }, "Replit OIDC authorization rejected (redirect_uri likely not registered for this host)");
    res.redirect(`/?authError=${encodeURIComponent("Sign-in with Replit is not available on this domain yet.")}`);
    return;
  }
  if (req.query.state !== req.cookies?.oidc_state || typeof req.query.code !== "string") { res.redirect("/api/login"); return; }
  try {
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((result) => result.json()) as { token_endpoint: string; userinfo_endpoint: string };
    const token = await fetch(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: req.query.code, redirect_uri: `${origin(req)}/api/callback`, client_id: process.env.REPL_ID!, code_verifier: req.cookies.oidc_verifier }).toString() }).then(async (result) => result.ok ? result.json() as Promise<{ access_token: string; expires_in?: number }> : null);
    if (!token?.access_token) { res.redirect("/api/login"); return; }
    const claims = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${token.access_token}` } }).then((result) => result.ok ? result.json() as Promise<Record<string, unknown>> : null);
    if (!claims?.sub) { res.redirect("/api/login"); return; }
    const user = await upsertUser(claims); const sid = await createSession({ user, accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
    setSessionCookie(res, sid); ["oidc_state", "oidc_verifier", "oidc_return_to"].forEach((name) => res.clearCookie(name, { path: "/" })); res.redirect(safeReturnTo(req.cookies?.oidc_return_to));
  } catch (error) {
    logger.error({ err: error, host: req.get("host") }, "Replit OIDC callback failed");
    res.redirect(`/?authError=${encodeURIComponent("Sign-in with Replit failed. Please try again.")}`);
  }
});
router.get("/logout", async (req, res) => { await clearSession(res, getSessionId(req)); res.redirect(safeReturnTo(req.query.returnTo)); });

function authErrorResponse(res: import("express").Response, error: unknown, action: string) {
  logger.error({ err: error }, `${action} failed`);
  res.status(500).json({ error: "Something went wrong on our end. Please try again in a moment." });
}

router.post("/auth/signup", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !email.includes("@")) { res.status(400).json({ error: "A valid email is required." }); return; }
  if (!validatePassword(password)) { res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }); return; }
  try {
    const existing = await findUserByEmail(email);
    if (existing) { res.status(409).json({ error: "An account with this email already exists." }); return; }
    const passwordHash = await hashPassword(password);
    const user = await createLocalUser(email, passwordHash);
    const sid = await createSession({ user, accessToken: "", expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    setSessionCookie(res, sid);
    res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    authErrorResponse(res, error, "Signup");
  }
});

router.post("/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) { res.status(400).json({ error: "Email and password are required." }); return; }
  try {
    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: user ? `This email signed up with ${user.authProvider === "google" ? "Google" : "Replit"} sign-in. Use that instead.` : "Incorrect email or password." });
      return;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Incorrect email or password." }); return; }
    const sid = await createSession({ user, accessToken: "", expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    setSessionCookie(res, sid);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    authErrorResponse(res, error, "Login");
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) { res.status(400).json({ error: "Email is required." }); return; }
  try {
    const user = await findUserByEmail(email);
    // Always respond the same way whether or not the account exists, so this endpoint can't be used to enumerate emails.
    if (user?.passwordHash) {
      const token = await createPasswordResetToken(user.id);
      const resetLink = `${origin(req)}/reset-password?token=${token}`;
      // No transactional email provider is configured yet — log the link so it can be delivered manually until one is wired up.
      logger.info({ email, resetLink }, "Password reset requested");
    }
    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (error) {
    authErrorResponse(res, error, "Forgot password");
  }
});

router.post("/auth/reset-password", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!token) { res.status(400).json({ error: "Reset token is required." }); return; }
  if (!validatePassword(password)) { res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }); return; }
  try {
    const userId = await consumePasswordResetToken(token);
    if (!userId) { res.status(400).json({ error: "This reset link is invalid or has expired." }); return; }
    const passwordHash = await hashPassword(password);
    await db.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    res.json({ message: "Your password has been reset. You can now sign in." });
  } catch (error) {
    authErrorResponse(res, error, "Reset password");
  }
});

router.get("/auth/google", async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) { res.redirect(`/?authError=${encodeURIComponent("Google sign-in is not configured yet.")}`); return; }
  const discovery = await fetch(`${googleIssuer}/.well-known/openid-configuration`).then((result) => result.json()) as { authorization_endpoint: string };
  const state = crypto.randomBytes(24).toString("base64url");
  cookie(res, "google_state", state); cookie(res, "google_return_to", safeReturnTo(req.query.returnTo));
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${origin(req)}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", state, access_type: "online", prompt: "select_account" }).toString();
  res.redirect(url.href);
});
router.get("/auth/google/callback", async (req, res) => {
  if (req.query.state !== req.cookies?.google_state || typeof req.query.code !== "string") { res.redirect("/api/auth/google"); return; }
  const discovery = await fetch(`${googleIssuer}/.well-known/openid-configuration`).then((result) => result.json()) as { token_endpoint: string; userinfo_endpoint: string };
  const token = await fetch(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: req.query.code, redirect_uri: `${origin(req)}/api/auth/google/callback`, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }).toString() }).then(async (result) => result.ok ? result.json() as Promise<{ access_token: string }> : null);
  if (!token?.access_token) { res.redirect("/api/auth/google"); return; }
  const claims = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${token.access_token}` } }).then((result) => result.ok ? result.json() as Promise<Record<string, unknown>> : null);
  if (!claims?.sub) { res.redirect("/api/auth/google"); return; }
  const returnTo = safeReturnTo(req.cookies?.google_return_to);
  ["google_state", "google_return_to"].forEach((name) => res.clearCookie(name, { path: "/" }));
  try {
    const user = await upsertGoogleUser(claims);
    const sid = await createSession({ user, accessToken: token.access_token, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    setSessionCookie(res, sid);
    res.redirect(returnTo);
  } catch (error) {
    const message = error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED" ? "An account with this email already exists using a different sign-in method." : "Google sign-in failed.";
    res.redirect(`/?authError=${encodeURIComponent(message)}`);
  }
});

export default router;
