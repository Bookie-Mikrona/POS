import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import companiesRouter from "./companies";
import accountsRouter from "./accounts";
import periodsRouter from "./periods";
import journalEntriesRouter from "./journalEntries";
import ledgerRouter from "./ledger";
import counterpartiesRouter from "./counterparties";
import invoicesRouter from "./invoices";
import paymentsRouter from "./payments";
import vatCodesRouter from "./vatCodes";
import vatRegisterRouter from "./vatRegister";
import documentsRouter from "./documents";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(companiesRouter);
router.use(accountsRouter);
router.use(periodsRouter);
router.use(journalEntriesRouter);
router.use(ledgerRouter);
router.use(counterpartiesRouter);
router.use(invoicesRouter);
router.use(paymentsRouter);
router.use(vatCodesRouter);
router.use(vatRegisterRouter);
router.use(documentsRouter);
router.use(storageRouter);

export default router;
