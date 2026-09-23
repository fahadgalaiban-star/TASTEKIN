import { Router, type IRouter } from "express";

import { ACCOUNT_DELETION_CONFIRMATION, deleteAccount } from "../lib/account-deletion";
import { clearSession, getSessionId } from "../lib/auth";

const router: IRouter = Router();

function noStore(res: import("express").Response) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie");
}

/**
 * Permanent deletion of the signed-in account. Authenticated by the caller's
 * own credential only (web cookie or native bearer) — there is no way to name
 * another account, so the response never says anything about any account
 * other than the caller's own. The body must carry the typed confirmation the
 * two-step UI collects; a bare request is rejected before anything runs.
 */
router.post("/me/delete-account", async (req, res): Promise<void> => {
  noStore(res);
  if (!req.user) { res.status(401).json({ error: "Sign in to delete your account." }); return; }
  if (req.body?.confirm !== ACCOUNT_DELETION_CONFIRMATION) {
    res.status(400).json({ error: `Send { "confirm": "${ACCOUNT_DELETION_CONFIRMATION}" } to confirm permanent deletion.` });
    return;
  }
  try {
    const result = await deleteAccount(req.user.id, req.log);
    if (!result.ok) {
      if (result.reason === "not_found") { res.status(401).json({ error: "Sign in to delete your account." }); return; }
      if (result.reason === "admin") {
        res.status(409).json({ error: "Administrator accounts cannot delete themselves. Ask another administrator to remove the admin role first.", code: "admin_account" });
        return;
      }
      res.status(409).json({ error: "This account authored administrative audit records and must be handed over by an operator before it can be deleted.", code: "audit_trail" });
      return;
    }
    // Web: the cookie session row is already gone; clear the cookie too.
    // Native: the bearer token is already revoked; the app clears its own
    // secure-storage copy after this response.
    if (!req.nativeSession) await clearSession(res, getSessionId(req));
    res.json({ deleted: true, mediaCleanup: result.mediaCleanup });
  } catch (error) {
    req.log.error({ err: error, userId: req.user.id }, "Account deletion failed");
    res.status(500).json({ error: "Your account could not be deleted right now. Nothing was changed. Please try again." });
  }
});

export default router;
