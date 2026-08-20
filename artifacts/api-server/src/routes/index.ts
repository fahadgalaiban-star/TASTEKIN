import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import discoveryRouter from "./discovery";
import creatorWorkspaceRouter from "./creator-workspace";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(discoveryRouter);
router.use(creatorWorkspaceRouter);
router.use(storageRouter);

export default router;
