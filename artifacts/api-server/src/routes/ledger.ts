import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, desc, sql, like, or, isNotNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
  accountingRolesTable,
  osRolesTable,
  bankStatementsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getLatestBankStatementBalances } from "../lib/bankStatementBalances";
import { buildBankBalanceHistory } from "../lib/bankBalanceHistory";

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
    const rawLimit = req.query.recentLimit;
    if (rawLimit !== undefined && (typeof rawLimit !== "string" || !/^[1-9]\d*$/.test(rawLimit)
      || Number(rawLimit) > 100)) {
      res.status(400).json({ error: "recentLimit mora biti celo število med 1 in 100." });
      return;
    }
    const recentLimit = rawLimit === undefined ? undefined : Number(rawLimit);

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
    // Scalar lookup does not multiply ledger lines or inherit period/date/account filters.
    const reversalEntry = alias(journalEntriesTable, "ledger_reversal");
    const reversedBy = db.select({ id: reversalEntry.id }).from(reversalEntry).where(and(
      eq(reversalEntry.companyId, companyId),
      eq(reversalEntry.reversalOf, journalEntriesTable.id),
      or(eq(reversalEntry.status, "posted"), eq(reversalEntry.status, "reversed")),
    )).orderBy(asc(reversalEntry.createdAt), asc(reversalEntry.id)).limit(1);
    const query = db
      .select({
        lineId: sql<string>`${journalEntryLinesTable.id}`.as("line_id"),
        createdAt: journalEntriesTable.createdAt,
        entryId: journalEntriesTable.id,
        entryStatus: journalEntriesTable.status,
        reversedBy: sql<string | null>`(${reversedBy})`.as("reversed_by"),
        reversalOf: journalEntriesTable.reversalOf,
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
      );

    if (recentLimit !== undefined) {
      const filtered = query.as("filtered_ledger");
      const debit = sql`case when ${filtered.side} = 'debit' then ${filtered.amount} else 0 end`;
      const credit = sql`case when ${filtered.side} = 'credit' then ${filtered.amount} else 0 end`;
      // Windows see the complete filtered history BEFORE the outer LIMIT.
      // Only the small tail reaches Node/the client; balances do not restart at zero.
      const balanced = db.select({
        lineId: filtered.lineId, createdAt: filtered.createdAt,
        entryId: filtered.entryId, entryDate: filtered.entryDate,
        reversalOf: filtered.reversalOf,
        entryStatus: filtered.entryStatus,
        reversedBy: filtered.reversedBy,
        description: filtered.description, reference: filtered.reference,
        accountId: filtered.accountId, accountCode: filtered.accountCode,
        accountName: filtered.accountName, sequence: filtered.sequence,
        debit: sql<string>`${debit}`.as("debit"),
        credit: sql<string>`${credit}`.as("credit"),
        runningBalance: sql<string>`sum(${debit} - ${credit}) over (
          order by ${filtered.entryDate}, ${filtered.createdAt}, ${filtered.sequence}, ${filtered.lineId}
          rows between unbounded preceding and current row
        )`.as("running_balance"),
        totalDebit: sql<string>`sum(${debit}) over ()`.as("total_debit"),
        totalCredit: sql<string>`sum(${credit}) over ()`.as("total_credit"),
      }).from(filtered).as("balanced_ledger");
      const recent = await db.select().from(balanced).orderBy(
        desc(balanced.entryDate), desc(balanced.createdAt),
        desc(balanced.sequence), desc(balanced.lineId),
      ).limit(recentLimit);
      const money = (value: string) => new Decimal(value).toFixed(2);
      res.json({
        lines: recent.reverse().map(row => ({
          entryId: row.entryId, entryDate: row.entryDate,
          isReversal: row.reversalOf !== null, reversalOf: row.reversalOf,
          isReversed: row.entryStatus === "reversed", reversedBy: row.reversedBy,
          description: row.description, reference: row.reference,
          accountId: row.accountId, accountCode: row.accountCode, accountName: row.accountName,
          debit: money(row.debit), credit: money(row.credit), runningBalance: money(row.runningBalance),
        })),
        totalDebit: money(recent[0]?.totalDebit ?? "0"),
        totalCredit: money(recent[0]?.totalCredit ?? "0"),
      });
      return;
    }

    const rows = await query.orderBy(
        asc(journalEntriesTable.entryDate),
        asc(journalEntriesTable.createdAt),
        asc(journalEntryLinesTable.sequence),
        asc(journalEntryLinesTable.id),
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
        isReversal: row.reversalOf !== null,
        isReversed: row.entryStatus === "reversed",
        reversedBy: row.reversedBy,
        reversalOf: row.reversalOf,
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

// GET /companies/:companyId/bank-balance-history
router.get(
  "/companies/:companyId/bank-balance-history",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = extractParam(req.params.companyId);
    const ok = await resolveAccess((req as AuthenticatedRequest).clerkUserId, companyId, res);
    if (!ok) return;

    const { dateFrom, dateTo } = req.query;
    const validDate = (value: unknown): value is string =>
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!validDate(dateFrom) || !validDate(dateTo) ||
        dateFrom > dateTo ||
        (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000 > 365) {
      res.status(400).json({ error: "Izberite veljavno obdobje do 366 dni." });
      return;
    }

    const bankAccounts = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), like(accountsTable.code, "110%")));
    if (!bankAccounts.length) {
      res.json({ points: [] });
      return;
    }

    const evidenceDate = sql<string>`COALESCE(${bankStatementsTable.periodTo}, ${bankStatementsTable.statementDate})`;
    const evidence = await db
      .select({
        bankAccountId: bankStatementsTable.bankAccountId,
        evidenceDate,
        balance: bankStatementsTable.closingBalance,
      })
      .from(bankStatementsTable)
      .innerJoin(accountsTable, eq(accountsTable.id, bankStatementsTable.bankAccountId))
      .where(and(
        eq(bankStatementsTable.companyId, companyId),
        eq(accountsTable.companyId, companyId),
        like(accountsTable.code, "110%"),
        isNotNull(bankStatementsTable.closingBalance),
        lte(evidenceDate, dateTo),
      ))
      .orderBy(
        asc(evidenceDate),
        asc(bankStatementsTable.statementDate),
        asc(bankStatementsTable.createdAt),
        asc(bankStatementsTable.id),
      );
    res.json({
      points: buildBankBalanceHistory(
        bankAccounts.map(account => account.id),
        evidence.filter((row): row is typeof row & { balance: string } => row.balance !== null),
        dateFrom,
        dateTo,
      ),
    });
  },
);

export default router;
