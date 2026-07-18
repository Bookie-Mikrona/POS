import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
  accountingRolesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return false;
  }
  return true;
}

// GET /companies/:companyId/ledger
router.get(
  "/companies/:companyId/ledger",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const { accountId, periodId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    // Gradi filter pogoje
    const entryConditions: ReturnType<typeof eq>[] = [
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.status, "posted"),
    ];
    if (periodId) entryConditions.push(eq(journalEntriesTable.periodId, periodId));
    if (dateFrom) entryConditions.push(gte(journalEntriesTable.entryDate, dateFrom));
    if (dateTo) entryConditions.push(lte(journalEntriesTable.entryDate, dateTo));

    const lineConditions: ReturnType<typeof eq>[] = [];
    if (accountId) lineConditions.push(eq(journalEntryLinesTable.accountId, accountId));

    // En JOIN query za vse
    const rows = await db
      .select({
        entryId: journalEntriesTable.id,
        entryDate: journalEntriesTable.entryDate,
        description: journalEntriesTable.description,
        reference: journalEntriesTable.reference,
        accountId: journalEntryLinesTable.accountId,
        accountCode: accountsTable.code,
        accountName: accountsTable.name,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        sequence: journalEntryLinesTable.sequence,
      })
      .from(journalEntryLinesTable)
      .innerJoin(
        journalEntriesTable,
        eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
      )
      .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(
        and(
          and(...entryConditions),
          lineConditions.length > 0 ? and(...lineConditions) : undefined,
        ),
      )
      .orderBy(
        asc(journalEntriesTable.entryDate),
        asc(journalEntriesTable.createdAt),
        asc(journalEntryLinesTable.sequence),
      );

    // Izračunaj tekoče stanje (running balance: debit - credit)
    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    const lines = rows.map((row) => {
      const amt = parseFloat(row.amount);
      const debit = row.side === "debit" ? amt : 0;
      const credit = row.side === "credit" ? amt : 0;
      runningBalance += debit - credit;
      totalDebit += debit;
      totalCredit += credit;
      return {
        entryId: row.entryId,
        entryDate: row.entryDate,
        description: row.description,
        reference: row.reference,
        accountId: row.accountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        runningBalance: runningBalance.toFixed(2),
      };
    });

    res.json({
      lines,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
    });
  },
);

export default router;
