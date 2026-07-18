import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import companiesRouter from "./companies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(companiesRouter);

export default router;
