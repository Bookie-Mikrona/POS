import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
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

/**
 * Account type → normal balance side:
 *   asset, expense  → debit (net = debit_sum - credit_sum; positive = debit balance)
 *   liability, equity, revenue → credit (net = credit_sum - debit_sum; positive = credit balance)
 */
function isDebitNormal(type: string): boolean {
  return type === "asset" || type === "expense";
}

interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: string;
  /** Signed balance in the account's natural direction (positive = normal side) */
  balance: number;
}

/**
 * Aggregate posted journal entry lines for a company within an optional date range.
 * Returns one entry per account with the net balance signed in the account's natural direction.
 */
async function aggregateBalances(
  companyId: string,
  dateTo?: string,
  dateFrom?: string,
): Promise<AccountBalance[]> {
  const conditions = [
    eq(journalEntriesTable.companyId, companyId),
    eq(journalEntriesTable.status, "posted"),
  ];
  if (dateTo) conditions.push(lte(journalEntriesTable.entryDate, dateTo));
  if (dateFrom) conditions.push(gte(journalEntriesTable.entryDate, dateFrom));

  // Aggregate debit and credit sums per account separately, then compute net.
  const rows = await db
    .select({
      accountId: journalEntryLinesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      accountType: accountsTable.type,
      side: journalEntryLinesTable.side,
      total: sql<string>`SUM(${journalEntryLinesTable.amount}::numeric)`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .where(and(...conditions))
    .groupBy(
      journalEntryLinesTable.accountId,
      journalEntryLinesTable.side,
      accountsTable.code,
      accountsTable.name,
      accountsTable.type,
    );

  // Merge debit / credit rows per account
  const map = new Map<
    string,
    { code: string; name: string; type: string; debit: number; credit: number }
  >();

  for (const row of rows) {
    const existing = map.get(row.accountId) ?? {
      code: row.accountCode,
      name: row.accountName,
      type: row.accountType,
      debit: 0,
      credit: 0,
    };
    const amount = parseFloat(row.total ?? "0");
    if (row.side === "debit") existing.debit += amount;
    else existing.credit += amount;
    map.set(row.accountId, existing);
  }

  // Convert to signed balance in the account's natural direction
  return Array.from(map.entries()).map(([accountId, acct]) => ({
    accountId,
    code: acct.code,
    name: acct.name,
    type: acct.type,
    balance: isDebitNormal(acct.type)
      ? acct.debit - acct.credit   // assets/expenses: positive = debit balance (normal)
      : acct.credit - acct.debit,  // liab/equity/revenue: positive = credit balance (normal)
  }));
}

// ── Section building helpers ──────────────────────────────────────────────────

interface ReportLineItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: string;
}

interface ReportSection {
  class: string;
  label: string;
  items: ReportLineItem[];
  subtotal: string;
}

/**
 * Generic class labels for the first digit of the account code.
 * These are only used for display grouping — the type field drives classification.
 */
const CLASS_LABELS: Record<string, string> = {
  "0": "Razred 0",
  "1": "Razred 1",
  "2": "Razred 2",
  "3": "Razred 3",
  "4": "Razred 4",
  "5": "Razred 5",
  "6": "Razred 6",
  "7": "Razred 7",
  "8": "Razred 8",
  "9": "Razred 9",
};

// Friendly descriptors appended after the class number when known
const CLASS_DESC: Record<string, string> = {
  "0": "Dolgoročna sredstva",
  "1": "Zaloge",
  "2": "Kratkoročne terjatve, naložbe in denar",
  "3": "Kratkoročne obveznosti in PČR",
  "4": "Stroški po vrstah",
  "5": "Stroški blaga, materiala, storitev in dela",
  "6": "Odhodki",
  "7": "Prihodki",
  "8": "Dolgoročne obveznosti in rezervacije",
  "9": "Kapital",
};

function classLabel(digit: string): string {
  const desc = CLASS_DESC[digit];
  return desc ? `Razred ${digit} — ${desc}` : `Razred ${digit}`;
}

/**
 * Build report sections from an array of account balances filtered to specific types.
 * Accounts are grouped by the first digit of their code.
 */
function buildSections(accounts: AccountBalance[]): ReportSection[] {
  const sectionMap = new Map<string, ReportSection>();

  for (const acct of accounts) {
    // Skip accounts with zero balance (nothing posted)
    if (acct.balance === 0) continue;

    const digit = acct.code.charAt(0) || "?";
    if (!sectionMap.has(digit)) {
      sectionMap.set(digit, {
        class: digit,
        label: classLabel(digit),
        items: [],
        subtotal: "0.00",
      });
    }
    const section = sectionMap.get(digit)!;
    section.items.push({
      accountId: acct.accountId,
      accountCode: acct.code,
      accountName: acct.name,
      balance: acct.balance.toFixed(2),
    });
    section.subtotal = (parseFloat(section.subtotal) + acct.balance).toFixed(2);
  }

  // Sort items within each section by account code, sections by digit
  for (const section of sectionMap.values()) {
    section.items.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  return Array.from(sectionMap.values()).sort((a, b) => a.class.localeCompare(b.class));
}

// ── Balance sheet ─────────────────────────────────────────────────────────────

function buildBalanceSheet(accounts: AccountBalance[]) {
  const assets = accounts.filter((a) => a.type === "asset");
  const liabEquity = accounts.filter(
    (a) => a.type === "liability" || a.type === "equity",
  );

  const aktivaSections = buildSections(assets);
  const pasivaSections = buildSections(liabEquity);

  const totalAktiva = aktivaSections.reduce(
    (s, sec) => s + parseFloat(sec.subtotal),
    0,
  );
  const totalPasiva = pasivaSections.reduce(
    (s, sec) => s + parseFloat(sec.subtotal),
    0,
  );

  return {
    aktiva: { sections: aktivaSections, total: totalAktiva.toFixed(2) },
    pasiva: { sections: pasivaSections, total: totalPasiva.toFixed(2) },
  };
}

// ── Income statement ──────────────────────────────────────────────────────────

function buildIncomeStatement(accounts: AccountBalance[]) {
  const revenues = accounts.filter((a) => a.type === "revenue");
  const expenses = accounts.filter((a) => a.type === "expense");

  const revenueSections = buildSections(revenues);
  const expenseSections = buildSections(expenses);

  const totalRevenue = revenueSections.reduce(
    (s, sec) => s + parseFloat(sec.subtotal),
    0,
  );
  const totalExpenses = expenseSections.reduce(
    (s, sec) => s + parseFloat(sec.subtotal),
    0,
  );
  const netResult = totalRevenue - totalExpenses;

  return {
    revenue: { sections: revenueSections, total: totalRevenue.toFixed(2) },
    expenses: { sections: expenseSections, total: totalExpenses.toFixed(2) },
    netResult: netResult.toFixed(2),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /companies/:companyId/reports/balance-sheet
router.get(
  "/companies/:companyId/reports/balance-sheet",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const { asOf, compareAsOf } = req.query as Record<string, string | undefined>;

    // Balance sheet is cumulative — all posted entries up to asOf date.
    // No dateFrom so the balance captures the full history.
    const currentAccounts = await aggregateBalances(companyId, asOf, undefined);
    const current = buildBalanceSheet(currentAccounts);

    let compare = null;
    if (compareAsOf) {
      const compareAccounts = await aggregateBalances(
        companyId,
        compareAsOf,
        undefined,
      );
      compare = buildBalanceSheet(compareAccounts);
    }

    res.json({
      asOf: asOf ?? null,
      compareAsOf: compareAsOf ?? null,
      current,
      compare,
    });
  },
);

// GET /companies/:companyId/reports/income-statement
router.get(
  "/companies/:companyId/reports/income-statement",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const { dateFrom, dateTo, compareDateFrom, compareDateTo } =
      req.query as Record<string, string | undefined>;

    // Income statement is period-based — only entries within [dateFrom, dateTo].
    const currentAccounts = await aggregateBalances(companyId, dateTo, dateFrom);
    const current = buildIncomeStatement(currentAccounts);

    let compare = null;
    if (compareDateFrom || compareDateTo) {
      const compareAccounts = await aggregateBalances(
        companyId,
        compareDateTo,
        compareDateFrom,
      );
      compare = buildIncomeStatement(compareAccounts);
    }

    res.json({
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      compareDateFrom: compareDateFrom ?? null,
      compareDateTo: compareDateTo ?? null,
      current,
      compare,
    });
  },
);

export default router;
