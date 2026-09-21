import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, like, or } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
  accountingRolesTable,
  osRolesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getLatestBankStatementBalances } from "../lib/bankStatementBalances";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// Glavna knjiga je skupna — dostop dovolimo tudi OS vlogam (branje)
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
  if (row) return true;

  const [osRow] = await db
    .select({ role: osRolesTable.role })
    .from(osRolesTable)
    .where(
      and(
        eq(osRolesTable.clerkUserId, clerkUserId),
        eq(osRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (osRow) return true;

  res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
  return false;
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
    // Vključimo tako "posted" kot "reversed" vnose, da se storno in original
    // oba pojavita v ledgerju in neto saldo pravilno znaša 0.
    const entryConditions: ReturnType<typeof eq>[] = [
      eq(journalEntriesTable.companyId, companyId),
      or(
        eq(journalEntriesTable.status, "posted"),
        eq(journalEntriesTable.status, "reversed"),
      )!,
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

// GET /companies/:companyId/bank-balance
// Vrne zadnje dokazljivo stanje bančnih kontov (kode 110x) iz izpiskov
router.get(
  "/companies/:companyId/bank-balance",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    // Najdi vse bančne konte (110x)
    const bankAccounts = await db
      .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), like(accountsTable.code, "110%")));

    if (bankAccounts.length === 0) {
      res.json({
        totalBalance: "0.00",
        allAccountsHaveStatementBalance: true,
        accounts: [],
      });
      return;
    }

    const evidenceByAccount = await getLatestBankStatementBalances(
      companyId,
      bankAccounts.map(account => account.id),
    );
    let knownTotalBalance = 0;
    const accounts = bankAccounts.map((a) => {
      const evidence = evidenceByAccount.get(a.id);
      if (evidence) knownTotalBalance += parseFloat(evidence.balance);
      return {
        accountId: a.id,
        accountCode: a.code,
        accountName: a.name,
        balance: evidence?.balance ?? null,
        hasStatementBalance: !!evidence,
        evidenceDate: evidence?.evidenceDate ?? null,
        statementId: evidence?.statementId ?? null,
        statementNumber: evidence?.statementNumber ?? null,
        sourceIban: evidence?.sourceIban ?? null,
        currency: evidence?.currency ?? null,
      };
    });
    const allAccountsHaveStatementBalance = accounts.every(account => account.hasStatementBalance);

    res.json({
      totalBalance: allAccountsHaveStatementBalance ? knownTotalBalance.toFixed(2) : null,
      allAccountsHaveStatementBalance,
      accounts,
    });
  },
);

export default router;
