import express from "express";

declare const __COMMIT_HASH__: string;

const router = express.Router();

router.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

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
