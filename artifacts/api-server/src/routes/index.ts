import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import companiesRouter from "./companies";
import accountsRouter from "./accounts";
import periodsRouter from "./periods";
import journalEntriesRouter from "./journalEntries";
import ledgerRouter from "./ledger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(companiesRouter);
router.use(accountsRouter);
router.use(periodsRouter);
router.use(journalEntriesRouter);
router.use(ledgerRouter);

export default router;
