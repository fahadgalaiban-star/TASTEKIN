import express from "express";

declare const __COMMIT_HASH__: string;

const router = express.Router();

router.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// Liveness probe for the deployment platform: unauthenticated, dependency-free
// (no DB, no session lookup), and always 200 as long as the process can serve
// a request at all. Deliberately returns nothing beyond a fixed status — no
// secrets, no user data, no environment details.
router.get("/healthz", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

router.get("/version", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ commit: __COMMIT_HASH__ });
});

// Ready endpoint: if DATABASE_URL present, respond with configured; otherwise indicate unconfigured.
router.get("/ready", async (_req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ ready: true, db: 'unconfigured' });
  try {
    // Keep the check lightweight; a real DB probe can be added later when credentials are provided.
    return res.json({ ready: true, db: 'configured' });
  } catch (err) {
    return res.status(503).json({ ready: false, error: String(err) });
  }
});

export default router;
