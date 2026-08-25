import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import discoveryRouter from "./discovery";
import creatorWorkspaceRouter from "./creator-workspace";
import engagementRouter from "./engagement";
import storageRouter from "./storage";
import verificationRouter from "./verification";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(discoveryRouter);
router.use(creatorWorkspaceRouter);
router.use(engagementRouter);
router.use(storageRouter);
router.use(verificationRouter);

export default router;
