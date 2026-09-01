import { usersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { isFeatureEnabled } from "../lib/feature-flags";

const router: IRouter = Router();
const SUPPORTED_LANGUAGES = new Set(["en", "ar"]);

function noStoreSessionResponse(res: import("express").Response) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie");
}

/**
 * Language and notification preferences are per-account, server-authorized
 * state — never client-only. Every request here is scoped to req.user.id,
 * so one account can never read or change another's settings.
 */
router.put("/settings", async (req, res) => {
  noStoreSessionResponse(res);
  if (!req.user) {
    res.status(401).json({ error: "Sign in to update your settings" });
    return;
  }

  const updates: Partial<{ language: string; notifyPush: boolean; notifyEmail: boolean }> = {};

  if (req.body?.language !== undefined) {
    if (typeof req.body.language !== "string" || !SUPPORTED_LANGUAGES.has(req.body.language)) {
      res.status(400).json({ error: "language must be 'en' or 'ar'" });
      return;
    }
    updates.language = req.body.language;
  }
  if (req.body?.notifyPush !== undefined || req.body?.notifyEmail !== undefined) {
    if (!(await isFeatureEnabled("notification_preferences"))) {
      res.status(403).json({ error: "Notification preferences cannot be changed right now" });
      return;
    }
  }
  if (req.body?.notifyPush !== undefined) {
    if (typeof req.body.notifyPush !== "boolean") { res.status(400).json({ error: "notifyPush must be a boolean" }); return; }
    updates.notifyPush = req.body.notifyPush;
  }
  if (req.body?.notifyEmail !== undefined) {
    if (typeof req.body.notifyEmail !== "boolean") { res.status(400).json({ error: "notifyEmail must be a boolean" }); return; }
    updates.notifyEmail = req.body.notifyEmail;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one of language, notifyPush, notifyEmail" });
    return;
  }

  try {
    const [updated] = await db.update(usersTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user.id))
      .returning({ language: usersTable.language, notifyPush: usersTable.notifyPush, notifyEmail: usersTable.notifyEmail });

    if (!updated) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    req.log.error({ err: error, userId: req.user.id }, "Unable to update settings");
    res.status(500).json({ error: "Unable to update settings" });
  }
});

export default router;
