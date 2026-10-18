import { Router, type Request, type Response, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { eq, and, gte, lte, sql, inArray, isNotNull, isNull, or, desc } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingRolesTable,
  costCentersTable,
  projectsTable,
  departmentsTable,
  companiesTable,
  reportExportsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import {
  generateBalanceSheetPdf,
  generateIncomeStatementPdf,
  generateTrialBalancePdf,
} from "../lib/report-pdf";
import { posljiPorociloPdf } from "../lib/erp-email";
import { getSmtpRow } from "../lib/erp-smtp-settings";
import erpSmtpRouter from "./erp-smtp";
import { expectedAccountType } from "../lib/accountTypeWarning";
import { logger } from "../lib/logger";
import { REPORT_EXPORT_RETENTION_DAYS, reportExportCutoff } from "../lib/reportExportRetention";

const router: IRouter = Router();
router.use(erpSmtpRouter);

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Historical Bookie Old 00 vouchers and verified annual OTV vouchers each
 * carry one year's closing balances into the following year. Never add the
 * earlier years on top of a posted opening.
 */
async function historicalOpening(companyId: string, date: string | undefined): Promise<{ start: string; id: string } | null> {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const year = date.slice(0, 4);
  const start = `${year}-01-01`;
  const rows = await db.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
       or(
         sql`${journalEntriesTable.reference} LIKE ${`BOOKIE-OLD/K2/${year}/00/%`}`,
         eq(journalEntriesTable.reference, `OTV-${year}-01`),
       ),
      gte(journalEntriesTable.entryDate, start),
      lte(journalEntriesTable.entryDate, `${year}-12-31`),
      or(eq(journalEntriesTable.status, "posted"), eq(journalEntriesTable.status, "reversed")),
    ))
    .limit(2);
  if (rows.length > 1) throw new Error(`Več zgodovinskih otvoritev za leto ${year}`);
  if (rows.length === 1) return { start, id: rows[0]!.id };
  const [earlier] = await db.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
       or(
         sql`${journalEntriesTable.reference} LIKE 'BOOKIE-OLD/K2/%/00/%'`,
         sql`${journalEntriesTable.reference} LIKE 'OTV-%-01'`,
       ),
       sql`${journalEntriesTable.entryDate} < ${start}`,
       or(eq(journalEntriesTable.status, "posted"), eq(journalEntriesTable.status, "reversed")),
    ))
    .limit(1);
  if (earlier) throw new Error(`Manjka potrjena otvoritev za leto ${year}; zgodovinskega salda ni dovoljeno sešteti čez več let`);
  return null;
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
  /** Raw debit sum — used to recompute balance when effective type overrides stored type */
  debit: number;
  /** Raw credit sum */
  credit: number;
}

/**
 * Aggregate posted journal entry lines for a company within an optional date range.
 * Returns one entry per account with the net balance signed in the account's natural direction,
 * plus raw debit/credit sums for reclassification support.
 */
async function aggregateBalances(
  companyId: string,
  dateTo?: string,
  dateFrom?: string,
): Promise<AccountBalance[]> {
  // Vključimo "posted" in "reversed" vnose: storno knjižba je vedno "posted",
  // original pa dobi status "reversed". Oba skupaj neto znesek dosežeta 0,
  // kar je pravilno računovodsko ravnanje za razveljavitev.
  const conditions = [
    eq(journalEntriesTable.companyId, companyId),
    or(
      eq(journalEntriesTable.status, "posted"),
      eq(journalEntriesTable.status, "reversed"),
    )!,
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

  // Convert to signed balance in the account's natural direction; keep raw sums for reclassification.
  return Array.from(map.entries()).map(([accountId, acct]) => ({
    accountId,
    code: acct.code,
    name: acct.name,
    type: acct.type,
    debit: acct.debit,
    credit: acct.credit,
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
  "1": "Kratkoročna sredstva (brez zalog)",
  "2": "Kratkoročne obveznosti in rezervacije",
  "3": "Proizvodnja, nedokončana proizvodnja in storitve",
  "4": "Stroški po vrstah",
  "5": "Proizvajalni stroški, stroški prodaje in upravljanja",
  "6": "Zaloge materiala, proizvodov in blaga",
  "7": "Prihodki in odhodki",
  "8": "Dolgoročne obveznosti, kapital in rezerve",
  "9": "Obračun poslovnega izida in zunajbilančna evidenca",
};

function classLabel(digit: string): string {
  const desc = CLASS_DESC[digit];
  return desc ? `Razred ${digit} — ${desc}` : `Razred ${digit}`;
}

/**
 * Build report sections from an array of account balances filtered to specific types.
 * Accounts are grouped by the first digit of their code.
 */
function buildSections(accounts: AccountBalance[], historical = false): ReportSection[] {
  const sectionMap = new Map<string, ReportSection>();

  for (const acct of accounts) {
    // Skip accounts with zero balance (nothing posted)
    if (acct.balance === 0) continue;

    const digit = acct.code.charAt(0) || "?";
    if (!sectionMap.has(digit)) {
      sectionMap.set(digit, {
        class: digit,
        label: historical ? `Razred ${digit}` : classLabel(digit),
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
/**
 * The five classification values that the report filter conditions recognise.
 * Any effectiveType outside this set cannot be placed in any report section and
 * MUST go to the explicit "unclassified" bucket — never silently dropped.
 */
const VALID_REPORT_TYPES = new Set<string>([
  "asset", "liability", "equity", "expense", "revenue",
]);

export interface AccountTypeWarning {
  accountId: string;
  code: string;
  name: string;
  /** The type stored in the database */
  storedType: string;
  /** The SRS type derived from the account code digit (what was actually used for placement) */
  effectiveType: string;
}

/**
 * An account whose effective type could not be resolved to any of the five
 * recognised report classification values.  Returned in a dedicated
 * `unclassifiedAccounts` array so the caller can render an explicit
 * "Nerazvrščeno" section — books are NEVER silently dropped from totals.
 */
export interface UnclassifiedAccount {
  accountId: string;
  code: string;
  name: string;
  /** Value stored in the DB (may be null in practice despite the schema type). */
  storedType: string | null;
  /** Human-readable explanation of why classification failed. */
  reason: string;
  debit: number;
  credit: number;
  /** Raw net (debit − credit).  Natural direction is unknown for unclassified accounts. */
  net: number;
}

/** Build a human-readable reason for an unclassifiable account. */
function classifyUnclassifiedReason(acct: AccountBalance): string {
  const srsType = expectedAccountType(acct.code);
  if (!acct.type || acct.type.trim() === "") {
    return srsType
      ? "Manjka tip konta"
      : "Manjka tip konta in koda se ne začne s cifro 0–9";
  }
  if (!srsType) {
    return `Koda konta se ne začne s cifro 0–9 (shranjeni tip: "${acct.type}")`;
  }
  return `Neznan tip konta: "${acct.type}"`;
}

/**
 * Resolve the effective type used for report classification.
 *
 * Priority rules:
 *  1. Numeric code prefix (0–9): if SRS mapping differs from stored type → SRS wins.
 *  2. Stored type is already one of the five recognised values → use as-is.
 *  3. Everything else → return the explicit sentinel "unclassified".
 *     The caller MUST route such accounts to a visible bucket; they must NEVER
 *     be silently dropped from the report.
 *
 * Exported for unit testing.
 */
export function resolveEffectiveType(acct: { code: string; type: string | null }): string {
  const srsType = expectedAccountType(acct.code);

  // Rule 1: numeric code prefix → SRS standard overrides wrong / missing stored type
  if (srsType !== undefined && srsType !== (acct.type ?? "")) return srsType;

  // Rule 2: stored type is already a valid report-filter value
  if (VALID_REPORT_TYPES.has(acct.type ?? "")) return acct.type!;

  // Rule 3: cannot classify — explicit sentinel, never silent loss
  return "unclassified";
}

/**
 * Compute the signed balance using the EFFECTIVE type (not the stored type).
 * For "unclassified" accounts the natural direction is unknown; we return the
 * raw debit − credit so the caller can display both sides explicitly.
 */
function balanceForType(acct: AccountBalance, effectiveType: string): number {
  if (effectiveType === "unclassified") return acct.debit - acct.credit;
  return isDebitNormal(effectiveType)
    ? acct.debit - acct.credit
    : acct.credit - acct.debit;
}

// ── Balance sheet ─────────────────────────────────────────────────────────────

export function buildBalanceSheet(accounts: AccountBalance[], historical = false, periodResult?: number) {
  // Resolve effective classification for every account; recompute balance sign
  // so that SRS-overridden accounts display correctly in their new section.
  const resolved = accounts.map((a) => {
    const effectiveType = historical
      ? (VALID_REPORT_TYPES.has(a.type) ? a.type : "unclassified")
      : resolveEffectiveType(a);
    return { ...a, effectiveType, balance: balanceForType(a, effectiveType) };
  });

  const assets     = resolved.filter((a) => a.effectiveType === "asset");
  const liabEquity = resolved.filter(
    (a) => a.effectiveType === "liability" || a.effectiveType === "equity",
  );
  // Explicitly unclassifiable — collected here, NEVER silently dropped
  const unclassifiedRaw = resolved.filter((a) => a.effectiveType === "unclassified");

  const aktivaSections = buildSections(assets, historical);
  const pasivaSections = buildSections(liabEquity, historical);

  const totalAktiva = aktivaSections.reduce((s, sec) => s + parseFloat(sec.subtotal), 0);
  let totalPasiva = pasivaSections.reduce((s, sec) => s + parseFloat(sec.subtotal), 0);
  if (historical && periodResult !== undefined) {
    if (Math.abs(totalAktiva - totalPasiva - periodResult) > 0.01) {
      throw new Error("Zgodovinska bilanca se ne ujema z rezultatom obdobja");
    }
    if (Math.abs(periodResult) >= 0.005) {
      pasivaSections.push({
        class: "rezultat",
        label: "Rezultat tekočega leta pred zapiranjem",
        items: [{
          accountId: "historical-period-result",
          accountCode: "—",
          accountName: "Rezultat tekočega leta",
          balance: periodResult.toFixed(2),
        }],
        subtotal: periodResult.toFixed(2),
      });
      totalPasiva += periodResult;
    }
  }

  // Warnings: accounts that DID appear in the report but whose stored type
  // was overridden by the SRS code-digit rule.
  const inReport = [...assets, ...liabEquity].filter((a) => a.balance !== 0);
  const typeWarnings: AccountTypeWarning[] = inReport
    .filter((a) => a.effectiveType !== a.type)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      storedType: a.type,
      effectiveType: a.effectiveType,
    }));

  // Unclassified: accounts that could NOT be placed in any section
  const unclassifiedAccounts: UnclassifiedAccount[] = unclassifiedRaw
    .filter((a) => a.debit !== 0 || a.credit !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      storedType: a.type ?? null,
      reason: classifyUnclassifiedReason(a),
      debit: a.debit,
      credit: a.credit,
      net: a.debit - a.credit,
    }));

  return {
    aktiva: { sections: aktivaSections, total: totalAktiva.toFixed(2) },
    pasiva: { sections: pasivaSections, total: totalPasiva.toFixed(2) },
    typeWarnings,
    unclassifiedAccounts,
  };
}

// ── Income statement ──────────────────────────────────────────────────────────

export function buildIncomeStatement(accounts: AccountBalance[], historical = false) {
  // Same SRS-consistent classification as buildBalanceSheet.
  const resolved = accounts.map((a) => {
    const effectiveType = historical
      ? (VALID_REPORT_TYPES.has(a.type) ? a.type : "unclassified")
      : resolveEffectiveType(a);
    return { ...a, effectiveType, balance: balanceForType(a, effectiveType) };
  });

  const revenues = resolved.filter((a) => a.effectiveType === "revenue");
  const expenses = resolved.filter((a) => a.effectiveType === "expense");
  // Explicitly unclassifiable — collected here, NEVER silently dropped
  const unclassifiedRaw = resolved.filter((a) => a.effectiveType === "unclassified");

  const revenueSections = buildSections(revenues, historical);
  const expenseSections = buildSections(expenses, historical);

  const totalRevenue  = revenueSections.reduce((s, sec) => s + parseFloat(sec.subtotal), 0);
  const totalExpenses = expenseSections.reduce((s, sec) => s + parseFloat(sec.subtotal), 0);
  const netResult = totalRevenue - totalExpenses;

  // Warnings scoped to accounts that appear in THIS report.
  const inReport = [...revenues, ...expenses].filter((a) => a.balance !== 0);
  const typeWarnings: AccountTypeWarning[] = inReport
    .filter((a) => a.effectiveType !== a.type)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      storedType: a.type,
      effectiveType: a.effectiveType,
    }));

  // Unclassified: accounts that could NOT be placed in any section
  const unclassifiedAccounts: UnclassifiedAccount[] = unclassifiedRaw
    .filter((a) => a.debit !== 0 || a.credit !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      storedType: a.type ?? null,
      reason: classifyUnclassifiedReason(a),
      debit: a.debit,
      credit: a.credit,
      net: a.debit - a.credit,
    }));

  return {
    revenue:  { sections: revenueSections,  total: totalRevenue.toFixed(2) },
    expenses: { sections: expenseSections, total: totalExpenses.toFixed(2) },
    netResult: netResult.toFixed(2),
    typeWarnings,
    unclassifiedAccounts,
  };
}

async function loadBalanceSheet(companyId: string, asOf: string | undefined) {
  const opening = await historicalOpening(companyId, asOf);
  const accounts = await aggregateBalances(companyId, asOf, opening?.start);
  const periodResult = opening
    ? Number(buildIncomeStatement(accounts, true).netResult)
    : undefined;
  return buildBalanceSheet(accounts, !!opening, periodResult);
}

async function loadIncomeStatement(companyId: string, dateFrom: string | undefined, dateTo: string | undefined) {
  const opening = await historicalOpening(companyId, dateTo);
  return buildIncomeStatement(
    await aggregateBalances(companyId, dateTo, dateFrom),
    !!opening,
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

async function getBalanceSheetReport(req: Request, res: Response): Promise<void> {
  const companyId = extractParam(req.params.companyId);
  if (!await resolveAccess((req as AuthenticatedRequest).clerkUserId, companyId, res)) return;
  const { asOf, compareAsOf } = req.query as Record<string, string | undefined>;
  try {
    const current = await loadBalanceSheet(companyId, asOf);
    const compare = compareAsOf ? await loadBalanceSheet(companyId, compareAsOf) : null;
    res.json({ asOf: asOf ?? null, compareAsOf: compareAsOf ?? null, current, compare });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function getIncomeStatementReport(req: Request, res: Response): Promise<void> {
  const companyId = extractParam(req.params.companyId);
  if (!await resolveAccess((req as AuthenticatedRequest).clerkUserId, companyId, res)) return;
  const { dateFrom, dateTo, compareDateFrom, compareDateTo } =
    req.query as Record<string, string | undefined>;
  try {
    const current = await loadIncomeStatement(companyId, dateFrom, dateTo);
    const compare = compareDateFrom || compareDateTo
      ? await loadIncomeStatement(companyId, compareDateFrom, compareDateTo)
      : null;
    res.json({
      dateFrom: dateFrom ?? null, dateTo: dateTo ?? null,
      compareDateFrom: compareDateFrom ?? null, compareDateTo: compareDateTo ?? null,
      current, compare,
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

router.get("/companies/:companyId/reports/balance-sheet", requireAuth, getBalanceSheetReport);
router.get("/companies/:companyId/reports/income-statement", requireAuth, getIncomeStatementReport);

// ── Dimensions report ─────────────────────────────────────────────────────────

type DimensionType = "costCenter" | "project" | "department";

interface AccountBreakdownRow {
  accountId: string;
  code: string;
  name: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
}

interface DimensionReportRow {
  id: string;
  code: string;
  name: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  accounts?: AccountBreakdownRow[];
}

interface DimensionReportResponse {
  dimensionType: DimensionType;
  dateFrom: string | null;
  dateTo: string | null;
  accountId: string | null;
  rows: DimensionReportRow[];
  grandTotalDebit: string;
  grandTotalCredit: string;
  grandTotalBalance: string;
  /** Total debit of lines that have NO dimension tag (excluded from the report above) */
  untaggedDebit: string;
  /** Total credit of lines that have NO dimension tag (excluded from the report above) */
  untaggedCredit: string;
  /** Net balance (debit - credit) of untagged lines */
  untaggedBalance: string;
  untaggedCount: number;
  untaggedPage: number;
  untaggedPageSize: number;
  untaggedLines: {
    lineId: string;
    entryId: string;
    entryDate: string;
    reference: string | null;
    entryDescription: string;
    description: string | null;
    accountCode: string;
    accountName: string;
    side: "debit" | "credit";
    amount: string;
  }[];
}

// GET /companies/:companyId/reports/dimensions
router.get(
  "/companies/:companyId/reports/dimensions",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const { dimensionType, dateFrom, dateTo, accountId, groupBy } =
      req.query as Record<string, string | undefined>;
    // Bound detail transfers independently of the full-scope aggregates.
    const pageValue = req.query.untaggedPage ?? "1";
    const sizeValue = req.query.untaggedPageSize ?? "20";
    if (typeof pageValue !== "string" || !/^[1-9]\d*$/.test(pageValue)
      || typeof sizeValue !== "string" || !/^[1-9]\d*$/.test(sizeValue)) {
      res.status(400).json({ error: "Neveljavno stranjevanje knjižb brez dimenzije" });
      return;
    }
    const untaggedPage = Number(pageValue);
    const untaggedPageSize = Number(sizeValue);
    const offset = (untaggedPage - 1) * untaggedPageSize;
    if (!Number.isSafeInteger(untaggedPage) || untaggedPageSize > 100
      || !Number.isSafeInteger(offset) || offset > 2147483647) {
      res.status(400).json({ error: "Neveljavno stranjevanje knjižb brez dimenzije" });
      return;
    }

    const dimType = (dimensionType ?? "costCenter") as DimensionType;
    if (!["costCenter", "project", "department"].includes(dimType)) {
      res.status(400).json({ error: "Neveljaven tip dimenzije" });
      return;
    }

    const withAccountBreakdown = groupBy === "account";

    // Build base conditions for journal entries (vključimo reversed za pravilni neto)
    const jeConditions = [
      eq(journalEntriesTable.companyId, companyId),
      or(
        eq(journalEntriesTable.status, "posted"),
        eq(journalEntriesTable.status, "reversed"),
      )!,
    ];
    if (dateFrom) jeConditions.push(gte(journalEntriesTable.entryDate, dateFrom));
    if (dateTo) jeConditions.push(lte(journalEntriesTable.entryDate, dateTo));

    // Line conditions
    const lineConditions: ReturnType<typeof eq>[] = [];
    if (accountId) lineConditions.push(eq(journalEntryLinesTable.accountId, accountId) as any);

    // Choose dimension table and FK column based on type
    const dimTable =
      dimType === "costCenter"
        ? costCentersTable
        : dimType === "project"
        ? projectsTable
        : departmentsTable;

    const dimFkCol =
      dimType === "costCenter"
        ? journalEntryLinesTable.costCenterId
        : dimType === "project"
        ? journalEntryLinesTable.projectId
        : journalEntryLinesTable.departmentId;

    // Only include lines that have the chosen dimension set
    const notNullCondition = isNotNull(dimFkCol);

    const allConditions = [
      ...jeConditions,
      notNullCondition,
      ...lineConditions,
    ];

    // ── Query with optional account breakdown ─────────────────────────────────

    // Aggregate per dimension (always)
    const dimMap = new Map<
      string,
      { code: string; name: string; debit: number; credit: number }
    >();

    // Aggregate per (dimension, account) when groupBy=account
    const accountMap = new Map<
      string, // key = `${dimId}::${accountId}`
      { dimId: string; accountId: string; code: string; name: string; debit: number; credit: number }
    >();

    // A single line-level aggregate supplies both views so their totals agree.
    const dimensionAccountTotals = await db
      .select({
        dimId: dimTable.id,
        dimCode: dimTable.code,
        dimName: dimTable.name,
        accountId: journalEntryLinesTable.accountId,
        accountCode: accountsTable.code,
        accountName: accountsTable.name,
        side: journalEntryLinesTable.side,
        total: sql<string>`SUM(${journalEntryLinesTable.amount}::numeric)`,
      })
      .from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .innerJoin(dimTable, and(eq(dimTable.id, dimFkCol), eq(dimTable.companyId, companyId)))
      .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(and(...allConditions))
      .groupBy(
        dimTable.id, dimTable.code, dimTable.name,
        journalEntryLinesTable.accountId, accountsTable.code, accountsTable.name,
        journalEntryLinesTable.side,
      );

    for (const aggregate of dimensionAccountTotals) {
      const amount = Number(aggregate.total);
      const dim = dimMap.get(aggregate.dimId) ?? {
        code: aggregate.dimCode, name: aggregate.dimName, debit: 0, credit: 0,
      };
      if (aggregate.side === "debit") dim.debit += amount;
      else dim.credit += amount;
      dimMap.set(aggregate.dimId, dim);

      if (withAccountBreakdown) {
        const key = `${aggregate.dimId}::${aggregate.accountId}`;
        const account = accountMap.get(key) ?? {
          dimId: aggregate.dimId, accountId: aggregate.accountId,
          code: aggregate.accountCode, name: aggregate.accountName, debit: 0, credit: 0,
        };
        if (aggregate.side === "debit") account.debit += amount;
        else account.credit += amount;
        accountMap.set(key, account);
      }
    }

    // Untagged details use exactly the report's tenant/date/account/status scope.
    const untaggedConditions = and(...jeConditions, isNull(dimFkCol), ...lineConditions);
    const [untaggedTotals] = await db
      .select({
        count: sql<number>`COUNT(*)::integer`,
        debit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntryLinesTable.side} = 'debit' THEN ${journalEntryLinesTable.amount}::numeric ELSE 0 END), 0)`,
        credit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntryLinesTable.side} = 'credit' THEN ${journalEntryLinesTable.amount}::numeric ELSE 0 END), 0)`,
      })
      .from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(untaggedConditions);
    const untaggedLines = await db
      .select({
        lineId: journalEntryLinesTable.id,
        entryId: journalEntriesTable.id,
        entryDate: journalEntriesTable.entryDate,
        reference: journalEntriesTable.reference,
        entryDescription: journalEntriesTable.description,
        description: journalEntryLinesTable.description,
        accountCode: accountsTable.code,
        accountName: accountsTable.name,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
      })
      .from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(untaggedConditions)
      .orderBy(journalEntriesTable.entryDate, journalEntriesTable.id,
        journalEntryLinesTable.sequence, journalEntryLinesTable.id)
      .limit(untaggedPageSize)
      .offset(offset);
    const untaggedDebit = Number(untaggedTotals.debit);
    const untaggedCredit = Number(untaggedTotals.credit);

    const accountsByDimension = new Map<string, AccountBreakdownRow[]>();
    for (const account of accountMap.values()) {
      const rows = accountsByDimension.get(account.dimId) ?? [];
      rows.push({
        accountId: account.accountId,
        code: account.code,
        name: account.name,
        totalDebit: account.debit.toFixed(2),
        totalCredit: account.credit.toFixed(2),
        balance: (account.debit - account.credit).toFixed(2),
      });
      accountsByDimension.set(account.dimId, rows);
    }
    const reportRows: DimensionReportRow[] = [...dimMap.entries()]
      .map(([id, dimension]) => ({
        id,
        code: dimension.code,
        name: dimension.name,
        totalDebit: dimension.debit.toFixed(2),
        totalCredit: dimension.credit.toFixed(2),
        balance: (dimension.debit - dimension.credit).toFixed(2),
        ...(withAccountBreakdown ? {
          accounts: (accountsByDimension.get(id) ?? [])
            .sort((a, b) => a.code.localeCompare(b.code, "sl")),
        } : {}),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "sl"));
    const grandTotalDebit = reportRows.reduce((s, r) => s + parseFloat(r.totalDebit), 0);
    const grandTotalCredit = reportRows.reduce((s, r) => s + parseFloat(r.totalCredit), 0);

    const response: DimensionReportResponse = {
      dimensionType: dimType,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      accountId: accountId ?? null,
      rows: reportRows,
      grandTotalDebit: grandTotalDebit.toFixed(2),
      grandTotalCredit: grandTotalCredit.toFixed(2),
      grandTotalBalance: (grandTotalDebit - grandTotalCredit).toFixed(2),
      untaggedDebit: untaggedDebit.toFixed(2),
      untaggedCredit: untaggedCredit.toFixed(2),
      untaggedBalance: (untaggedDebit - untaggedCredit).toFixed(2),
      untaggedCount: untaggedTotals.count,
      untaggedPage,
      untaggedPageSize,
      untaggedLines,
    };

    res.json(response);
  },
);

// ── Trial Balance (Bruto bilanca / Preizkusna bilanca) ────────────────────────
// Schema matches generated types: accountCode/Name/Type, turnoverDebit/Credit, balanceDebit/Credit

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalanceDebit: string;
  openingBalanceCredit: string;
  turnoverDebit: string;
  turnoverCredit: string;
  balanceDebit: string;
  balanceCredit: string;
}

interface TrialBalanceResponse {
  dateFrom?: string | null;
  dateTo?: string | null;
  rows: TrialBalanceRow[];
  totalOpeningBalanceDebit: string;
  totalOpeningBalanceCredit: string;
  totalTurnoverDebit: string;
  totalTurnoverCredit: string;
  totalBalanceDebit: string;
  totalBalanceCredit: string;
}

/**
 * Returns the date string for the day before the given ISO date string.
 * Used to compute opening balance (entries strictly before dateFrom).
 */
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate raw debit/credit sums per account for a given date range.
 * Keeps raw debit/credit separate (no sign flip) for trial balance output.
 */
async function aggregateRaw(
  companyId: string,
  dateFrom?: string,
  dateTo?: string,
  openingId?: string,
  excludeOpening = false,
): Promise<Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>> {
  // Vključimo "reversed" vnose za pravilni neto pri storniranih plačilih
  const conditions = [
    eq(journalEntriesTable.companyId, companyId),
    or(
      eq(journalEntriesTable.status, "posted"),
      eq(journalEntriesTable.status, "reversed"),
    )!,
  ];
  if (dateFrom) conditions.push(gte(journalEntriesTable.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(journalEntriesTable.entryDate, dateTo));
  if (openingId) {
    conditions.push(excludeOpening
      ? sql`${journalEntriesTable.id} <> ${openingId}`
      : eq(journalEntriesTable.id, openingId));
  }

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
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .where(and(...conditions))
    .groupBy(
      journalEntryLinesTable.accountId,
      journalEntryLinesTable.side,
      accountsTable.code,
      accountsTable.name,
      accountsTable.type,
    );

  const map = new Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>();
  for (const row of rows) {
    const existing = map.get(row.accountId) ?? {
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      debit: 0,
      credit: 0,
    };
    const amount = parseFloat(row.total ?? "0");
    if (row.side === "debit") existing.debit += amount;
    else existing.credit += amount;
    map.set(row.accountId, existing);
  }
  return map;
}

async function loadTrialBalance(companyId: string, dateFrom?: string, dateTo?: string): Promise<TrialBalanceResponse> {
  const opening = await historicalOpening(companyId, dateTo ?? dateFrom);
  if (opening && (!dateFrom || !dateTo || dateFrom.slice(0, 4) !== dateTo.slice(0, 4))) {
    throw new Error("Za uvožena zgodovinska leta izberite datuma znotraj istega koledarskega leta.");
  }
  const isHistoricalYearStart = Boolean(opening && opening.start === dateFrom);
  const openingDateTo = dateFrom ? dayBefore(dateFrom) : undefined;
  const [openingMap, turnoverMap, balanceMap] = await Promise.all([
    isHistoricalYearStart
      ? aggregateRaw(companyId, opening!.start, dateTo, opening!.id)
      : opening && openingDateTo
        ? aggregateRaw(companyId, opening.start, openingDateTo)
        : openingDateTo
          ? aggregateRaw(companyId, undefined, openingDateTo)
          : Promise.resolve(new Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>()),
    aggregateRaw(companyId, dateFrom, dateTo, isHistoricalYearStart ? opening!.id : undefined, isHistoricalYearStart),
    aggregateRaw(companyId, opening?.start, dateTo),
  ]);

  const allIds = new Set([...openingMap.keys(), ...turnoverMap.keys(), ...balanceMap.keys()]);
  const rows: TrialBalanceRow[] = Array.from(allIds)
    .map((accountId) => {
      const o = openingMap.get(accountId) ?? { accountCode: "", accountName: "", accountType: "", debit: 0, credit: 0 };
      const t = turnoverMap.get(accountId) ?? { accountCode: "", accountName: "", accountType: "", debit: 0, credit: 0 };
      const b = balanceMap.get(accountId) ?? { accountCode: t.accountCode, accountName: t.accountName, accountType: t.accountType, debit: 0, credit: 0 };
      const meta = balanceMap.get(accountId) ?? turnoverMap.get(accountId) ?? openingMap.get(accountId)!;
      return {
        accountId, accountCode: meta.accountCode, accountName: meta.accountName, accountType: meta.accountType,
        openingBalanceDebit: o.debit.toFixed(2), openingBalanceCredit: o.credit.toFixed(2),
        turnoverDebit: t.debit.toFixed(2), turnoverCredit: t.credit.toFixed(2),
        balanceDebit: b.debit.toFixed(2), balanceCredit: b.credit.toFixed(2),
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const sumField = (field: keyof Pick<TrialBalanceRow, "openingBalanceDebit" | "openingBalanceCredit" | "turnoverDebit" | "turnoverCredit" | "balanceDebit" | "balanceCredit">) =>
    rows.reduce((s, r) => s + parseFloat(r[field]), 0).toFixed(2);
  return {
    dateFrom: dateFrom ?? null, dateTo: dateTo ?? null, rows,
    totalOpeningBalanceDebit: sumField("openingBalanceDebit"),
    totalOpeningBalanceCredit: sumField("openingBalanceCredit"),
    totalTurnoverDebit: sumField("turnoverDebit"),
    totalTurnoverCredit: sumField("turnoverCredit"),
    totalBalanceDebit: sumField("balanceDebit"),
    totalBalanceCredit: sumField("balanceCredit"),
  };
}

// GET /companies/:companyId/reports/trial-balance
router.get(
  "/companies/:companyId/reports/trial-balance",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = extractParam(req.params.companyId);
    const authReq = req as AuthenticatedRequest;

    if (!(await resolveAccess(authReq.clerkUserId, companyId, res))) return;

    const { dateFrom: dfRaw, dateTo: dtRaw } = req.query as Record<string, string | undefined>;
    const dateFrom = dfRaw ?? undefined;
    const dateTo = dtRaw ?? undefined;

    try {
      res.json(await loadTrialBalance(companyId, dateFrom, dateTo));
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
);

// ── POST /companies/:companyId/reports/export ─────────────────────────────────
// Generira PDF na strežniku in ga:
//   • vrne kot blob (application/pdf), ali
//   • pošlje po e-pošti, če je podan `email` v telesu zahteve.

router.post(
  "/companies/:companyId/reports/export",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const {
      reportType,
      email,
      // balance-sheet params
      asOf,
      compareAsOf,
      // income-statement params
      dateFrom,
      dateTo,
      compareDateFrom,
      compareDateTo,
      statementView,
      accountClass,
      searchTerm,
    } = req.body as {
      reportType: "balance-sheet" | "income-statement" | "trial-balance";
      email?: string;
      asOf?: string;
      compareAsOf?: string;
      dateFrom?: string;
      dateTo?: string;
      compareDateFrom?: string;
      compareDateTo?: string;
      statementView?: "bilanca" | "zakljucni";
      accountClass?: string;
      searchTerm?: string;
    };

    if (!reportType) {
      res.status(400).json({ error: "reportType je obvezen." });
      return;
    }

    // Pridobi ime podjetja
    const [companyRow] = await db
      .select({ naziv: companiesTable.naziv, email: companiesTable.email })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);
    const companyName = companyRow?.naziv ?? "Podjetje";

    let pdfBuffer: Buffer;
    let filename: string;
    let reportTitle: string;
    let subtitle: string;

    try {
      if (reportType === "balance-sheet") {
        if (!asOf) {
          res.status(400).json({ error: "asOf je obvezen za bilanco stanja." });
          return;
        }
        const balanceSheetPdfCurrent = await loadBalanceSheet(companyId, asOf);
        let balanceSheetPdfCompare = null;
        if (compareAsOf) {
          balanceSheetPdfCompare = await loadBalanceSheet(companyId, compareAsOf);
        }
        reportTitle = "BILANCA STANJA";
        subtitle = compareAsOf
          ? `Stanje na dan: ${asOf}  |  Primerjava: ${compareAsOf}`
          : `Stanje na dan: ${asOf}`;
        filename = `bilanca-stanja-${asOf}.pdf`;
        pdfBuffer = await generateBalanceSheetPdf({
          companyName, asOf, compareAsOf: compareAsOf ?? null,
          current: balanceSheetPdfCurrent, compare: balanceSheetPdfCompare,
        });

      } else if (reportType === "income-statement") {
        const current = await loadIncomeStatement(companyId, dateFrom, dateTo);
        let compare = null;
        if (compareDateFrom || compareDateTo) {
          compare = await loadIncomeStatement(companyId, compareDateFrom, compareDateTo);
        }
        reportTitle = "IZKAZ POSLOVNEGA IZIDA";
        subtitle = compareDateFrom
          ? `Obdobje: ${dateFrom} – ${dateTo}  |  Primerjava: ${compareDateFrom} – ${compareDateTo}`
          : `Obdobje: ${dateFrom} – ${dateTo}`;
        filename = `izkaz-poslovnega-izida-${dateFrom ?? "brez"}-${dateTo ?? "brez"}.pdf`;
        pdfBuffer = await generateIncomeStatementPdf({
          companyName, dateFrom: dateFrom ?? "", dateTo: dateTo ?? "",
          compareDateFrom: compareDateFrom ?? null, compareDateTo: compareDateTo ?? null,
          current, compare,
        });

      } else if (reportType === "trial-balance") {
        if (statementView && statementView !== "bilanca" && statementView !== "zakljucni") {
          res.status(400).json({ error: "Neveljaven prikaz poročila." });
          return;
        }
        if (statementView && (!dateFrom || !dateTo ||
            !/^\d{4}-01-01$/.test(dateFrom) || dateTo !== `${dateFrom.slice(0, 4)}-12-31`)) {
          res.status(400).json({ error: "Bilanca kontov in zaključni račun zahtevata celo koledarsko leto." });
          return;
        }
        if ((accountClass && !/^\d$/.test(accountClass)) || (searchTerm && searchTerm.length > 100)) {
          res.status(400).json({ error: "Neveljaven filter kontov." });
          return;
        }
        const report = await loadTrialBalance(companyId, dateFrom, dateTo);
        const q = (searchTerm ?? "").trim().toLocaleLowerCase("sl-SI");
        const filteredTrialBalanceRows = report.rows.filter((row) =>
          (!accountClass || row.accountCode.startsWith(accountClass)) &&
          (!q || row.accountCode.toLocaleLowerCase("sl-SI").includes(q) ||
            row.accountName.toLocaleLowerCase("sl-SI").includes(q)));
        const sumField = (field: keyof Pick<TrialBalanceRow, "openingBalanceDebit" | "openingBalanceCredit" | "turnoverDebit" | "turnoverCredit" | "balanceDebit" | "balanceCredit">) =>
          filteredTrialBalanceRows.reduce((sum, row) => sum + Number(row[field]), 0).toFixed(2);
        reportTitle = statementView === "bilanca" ? "BILANCA KONTOV"
          : statementView === "zakljucni" ? "ZAKLJUČNI RAČUN" : "BRUTO BILANCA (PREIZKUSNA BILANCA)";
        subtitle = `Obdobje: ${dateFrom ?? ""} – ${dateTo ?? ""}`;
        if (accountClass) subtitle += ` · Razred ${accountClass}`;
        filename = `${statementView ?? "bruto-bilanca"}-${dateFrom ?? "brez"}-${dateTo ?? "brez"}.pdf`;
        pdfBuffer = await generateTrialBalancePdf({
          ...report,
          companyName, dateFrom: dateFrom ?? "", dateTo: dateTo ?? "",
          statementView,
          accountClass,
          rows: filteredTrialBalanceRows,
          totalOpeningBalanceDebit: sumField("openingBalanceDebit"),
          totalOpeningBalanceCredit: sumField("openingBalanceCredit"),
          totalTurnoverDebit: sumField("turnoverDebit"),
          totalTurnoverCredit: sumField("turnoverCredit"),
          totalBalanceDebit: sumField("balanceDebit"),
          totalBalanceCredit: sumField("balanceCredit"),
        });

      } else {
        res.status(400).json({ error: "Neveljaven reportType." });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Napaka pri generiranju PDF: ${msg}` });
      return;
    }

    // Zabeleži izvoz v revizijsko sled
    const exportParams: Record<string, string | undefined> = {};
    if (reportType === "balance-sheet") {
      exportParams.asOf = asOf;
      if (compareAsOf) exportParams.compareAsOf = compareAsOf;
    } else if (reportType === "income-statement") {
      exportParams.dateFrom = dateFrom;
      exportParams.dateTo = dateTo;
      if (compareDateFrom) exportParams.compareDateFrom = compareDateFrom;
      if (compareDateTo) exportParams.compareDateTo = compareDateTo;
    } else {
      exportParams.dateFrom = dateFrom;
      exportParams.dateTo = dateTo;
      if (statementView) exportParams.statementView = statementView;
      if (accountClass) exportParams.accountClass = accountClass;
      if (searchTerm) exportParams.searchTerm = searchTerm;
    }

    // Neuspelega pošiljanja ne beleži kot uspešno poslan izvoz.
    if (email) {
      try {
        const result = await posljiPorociloPdf({
          companyId,
          prejemnik: email,
          companyName,
          reportTitle,
          subtitle,
          filename,
          pdfBuffer,
        }, { companyName: companyRow?.naziv, companyEmail: companyRow?.email });
        if (!result.uspeh) {
          res.status(502).json({ error: result.napaka ?? "Pošiljanje ni uspelo." });
          return;
        }
      } catch (err) {
        logger.error({ err, companyId, reportType }, "Report email sending failed");
        res.status(502).json({ error: "Pošiljanje ni uspelo." });
        return;
      }
    }

    try {
      await db.insert(reportExportsTable).values({
        companyId,
        reportType,
        params: exportParams,
        filename,
        exportedBy: authReq.clerkUserId,
        pdfData: pdfBuffer,
        emailSentTo: email || null,
      });
    } catch (err) {
      logger.error({ err, companyId, reportType }, "Report export history save failed");
      res.status(500).json({
        error: email
          ? "PDF je bil poslan, vendar zapis v zgodovino izvozov ni uspel. Ne pošiljajte ga ponovno."
          : "Zapis v zgodovino izvozov ni uspel. Poskusite znova.",
      });
      return;
    }

    if (email) {
      res.json({ uspeh: true, sporocilo: `PDF poslan na ${email}` });
    } else {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    }
  },
);

// ── GET /companies/:companyId/reports/export/history ─────────────────────────
// Vrne seznam vseh izvozov za podjetje (brez pdfData za hitrost).

router.get(
  "/companies/:companyId/reports/export/history",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const rows = await db
      .select({
        id: reportExportsTable.id,
        reportType: reportExportsTable.reportType,
        params: reportExportsTable.params,
        filename: reportExportsTable.filename,
        exportedBy: reportExportsTable.exportedBy,
        exportedAt: reportExportsTable.exportedAt,
        emailSentTo: reportExportsTable.emailSentTo,
      })
      .from(reportExportsTable)
      .where(and(
        eq(reportExportsTable.companyId, companyId),
        gte(reportExportsTable.exportedAt, reportExportCutoff()),
      ))
      .orderBy(desc(reportExportsTable.exportedAt))
      .limit(200);

    const userIds = [...new Set(rows.map((row) => row.exportedBy).filter(Boolean))];
    const displayNames = new Map<string, string>();
    // Deduplicate and batch only this company's exporters (Clerk's page size is 100).
    try {
      for (let offset = 0; offset < userIds.length; offset += 100) {
        const { data: users } = await clerkClient.users.getUserList({
          userId: userIds.slice(offset, offset + 100),
          limit: 100,
        });
        for (const user of users) {
          const name = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ");
          const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
            ?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
          displayNames.set(user.id, name || email?.trim() || "Neznan uporabnik");
        }
      }
    } catch {
      // A directory outage is not evidence that the exporter was deleted.
      res.status(502).json({ error: "Podatkov o izvoznikih ni mogoče pridobiti. Poskusite znova." });
      return;
    }
    res.json({
      retentionDays: REPORT_EXPORT_RETENTION_DAYS,
      exports: rows.map((row) => ({
        ...row,
        exportedByName: displayNames.get(row.exportedBy) ?? "Neznan uporabnik",
      })),
    });
  },
);

// ── GET /companies/:companyId/reports/export/history/:id/download ─────────────
// Vrne shranjeni PDF brez ponovnega generiranja.

router.get(
  "/companies/:companyId/reports/export/history/:id/download",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const exportId = extractParam(req.params.id);
    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const [row] = await db
      .select({
        filename: reportExportsTable.filename,
        pdfData: reportExportsTable.pdfData,
        companyId: reportExportsTable.companyId,
      })
      .from(reportExportsTable)
      .where(and(
        eq(reportExportsTable.id, exportId),
        gte(reportExportsTable.exportedAt, reportExportCutoff()),
      ))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Izvoz ne obstaja." });
      return;
    }
    if (row.companyId !== companyId) {
      res.status(403).json({ error: "Dostop ni dovoljen." });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    res.send(row.pdfData);
  },
);

// GET /companies/:companyId/reports/export/smtp-status
// Vrne, ali so SMTP nastavitve konfigurirane (brez razkritja poverilnic).
router.get(
  "/companies/:companyId/reports/export/smtp-status",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const ok = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!ok) return;
    res.setHeader("Cache-Control", "no-store");
    const smtp = await getSmtpRow(companyId);
    res.json({ konfigurirano: !!smtp });
  },
);

export default router;
