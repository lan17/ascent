import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slackRouter from "./slack";

const router: IRouter = Router();

router.use(healthRouter);
router.use(slackRouter);

export default router;
