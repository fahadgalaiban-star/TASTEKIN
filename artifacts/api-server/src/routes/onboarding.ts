import { Router, type IRouter } from "express";

import { advanceOnboardingStep } from "../lib/onboarding";

const router: IRouter = Router();

function noStoreSessionResponse(res: import("express").Response) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie");
}

/**
 * Moves the caller's own onboarding forward by exactly one step. Takes no
 * body: the step is always read from server state, never from the client,
 * and each step's precondition (see lib/onboarding.ts) is re-checked here —
 * a client can never fabricate progress or skip a required step by lying
 * about which step it thinks it's on.
 */
router.post("/onboarding/advance", async (req, res) => {
  noStoreSessionResponse(res);
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue onboarding" });
    return;
  }
  try {
    const result = await advanceOnboardingStep(req.user.id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ step: result.step, completed: result.completed });
  } catch (error) {
    req.log.error({ err: error, userId: req.user.id }, "Unable to advance onboarding");
    res.status(500).json({ error: "Unable to save onboarding progress" });
  }
});

export default router;
