import { db, featureFlagAuditLog, featureFlags, usersTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { isCurrentUserAdmin } from "../lib/creator-account";
import { FEATURE_FLAG_DEFINITIONS, isKnownFlagKey, PROTECTED_FLAG_KEYS } from "../lib/feature-flags";

const router: IRouter = Router();

/**
 * Global, server-enforced kill switches. Listing and changing a flag is
 * admin-only; every actual on/off decision downstream reads the same
 * feature_flags table (via lib/feature-flags.ts's isFeatureEnabled), never
 * a value cached on the client, so hiding a button in the UI is never the
 * only thing standing between a user and a disabled feature.
 */
router.get("/admin/feature-flags", async (req, res): Promise<void> => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }

  const rows = await db.select({
    key: featureFlags.key,
    description: featureFlags.description,
    enabled: featureFlags.enabled,
    updatedAt: featureFlags.updatedAt,
    updatedByUserId: featureFlags.updatedByUserId,
    updatedByEmail: usersTable.email,
  }).from(featureFlags).leftJoin(usersTable, eq(featureFlags.updatedByUserId, usersTable.id));
  const overrides = new Map(rows.map((row) => [row.key, row]));

  const flags = FEATURE_FLAG_DEFINITIONS.map((definition) => {
    const override = overrides.get(definition.key);
    return {
      key: definition.key,
      description: definition.description,
      enabled: override ? override.enabled : definition.defaultEnabled,
      updatedAt: override?.updatedAt ?? null,
      updatedByUserId: override?.updatedByUserId ?? null,
      updatedByEmail: override?.updatedByEmail ?? null,
    };
  });
  res.set("Cache-Control", "private, no-store");
  res.json({ flags });
});

router.put("/admin/feature-flags/:key", async (req, res): Promise<void> => {
  const admin = req.user;
  if (!(await isCurrentUserAdmin(admin))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const key = req.params.key;
  if (PROTECTED_FLAG_KEYS.has(key)) { res.status(400).json({ error: "This safety feature cannot be disabled" }); return; }
  if (!isKnownFlagKey(key)) { res.status(404).json({ error: "Unknown feature flag" }); return; }
  if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "enabled must be a boolean" }); return; }
  const enabled = req.body.enabled;

  const definition = FEATURE_FLAG_DEFINITIONS.find((entry) => entry.key === key)!;
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tastekin-feature-flag:${key}`}))`);
    const [current] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    const fromEnabled = current ? current.enabled : definition.defaultEnabled;
    const [row] = await tx.insert(featureFlags).values({
      key, description: definition.description, enabled, updatedByUserId: admin!.id, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled, updatedByUserId: admin!.id, updatedAt: new Date() },
    }).returning();
    await tx.insert(featureFlagAuditLog).values({
      flagKey: key, adminUserId: admin!.id, fromEnabled, toEnabled: enabled,
    });
    return row;
  });
  res.json({
    key: updated.key,
    description: updated.description,
    enabled: updated.enabled,
    updatedAt: updated.updatedAt,
    updatedByUserId: updated.updatedByUserId,
  });
});

router.get("/admin/feature-flags/:key/audit-log", async (req, res): Promise<void> => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  const key = req.params.key;
  if (!isKnownFlagKey(key)) { res.status(404).json({ error: "Unknown feature flag" }); return; }
  const rows = await db.select({
    id: featureFlagAuditLog.id,
    adminUserId: featureFlagAuditLog.adminUserId,
    adminEmail: usersTable.email,
    fromEnabled: featureFlagAuditLog.fromEnabled,
    toEnabled: featureFlagAuditLog.toEnabled,
    createdAt: featureFlagAuditLog.createdAt,
  }).from(featureFlagAuditLog)
    .leftJoin(usersTable, eq(featureFlagAuditLog.adminUserId, usersTable.id))
    .where(eq(featureFlagAuditLog.flagKey, key))
    .orderBy(desc(featureFlagAuditLog.createdAt))
    .limit(100);
  res.set("Cache-Control", "private, no-store");
  res.json({ entries: rows });
});

export default router;
