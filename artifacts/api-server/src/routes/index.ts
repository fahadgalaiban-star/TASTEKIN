import { Router, type IRouter } from "express";
import healthRouter from "./health";
import discoveryRouter from "./discovery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(discoveryRouter);

export default router;
