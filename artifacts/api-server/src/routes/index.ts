import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import companiesRouter from "./companies";
import accountsRouter from "./accounts";
import periodsRouter from "./periods";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(companiesRouter);
router.use(accountsRouter);
router.use(periodsRouter);

export default router;
