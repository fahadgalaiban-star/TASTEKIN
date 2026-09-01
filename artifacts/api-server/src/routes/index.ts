import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import discoveryRouter from "./discovery";
import creatorWorkspaceRouter from "./creator-workspace";
import engagementRouter from "./engagement";
import storageRouter from "./storage";
import verificationRouter from "./verification";
import settingsRouter from "./settings";
import onboardingRouter from "./onboarding";
import moderationRouter from "./moderation";
import blocksRouter from "./blocks";
import mutesRouter from "./mutes";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(discoveryRouter);
router.use(creatorWorkspaceRouter);
router.use(engagementRouter);
router.use(storageRouter);
router.use(verificationRouter);
router.use(settingsRouter);
router.use(onboardingRouter);
router.use(moderationRouter);
router.use(blocksRouter);
router.use(mutesRouter);

export default router;
