import { Router, type Request, type Response, type IRouter } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  counterpartiesTable,
  invoicesTable,
  bookieOldArSettlementsTable,
  bookieOldBankApClosingsTable,
  invoiceLinesTable,
  paymentAllocationsTable,
  paymentsTable,
  accountingRolesTable,
  accountsTable,
  accountingPeriodsTable,
  bankStatementsTable,
  bankStatementLinesTable,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { GetBankStatementDetailParams, GetBankStatementDetailResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// In-memory multer storage (no disk writes)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
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
    return null;
  }
  return { role: row.role };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BankTransaction {
  id: string;
  date: string;              // YYYY-MM-DD
  amount: number;            // positive = credit (inbound), negative = debit (outbound)
  reference: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  description: string | null;
  currency: string;
  raw?: string;
}

export interface MatchSuggestion {
  invoiceId: string;
  invoiceNumber: string;
  counterpartyId: string;
  counterpartyName: string;
  invoiceDate: string;
  dueDate: string | null;
  remainingAmount: string;
  confidence: number;        // 0–1
  matchReasons: string[];
}

export interface DuplicateInfo {
  paymentId: string;
  paymentDate: string;
  amount: string;
  reference: string | null;
  direction: string;
}

export interface TransactionWithSuggestions {
  transaction: BankTransaction;
  suggestions: MatchSuggestion[];
  /** Present when this transaction matches an already-imported payment */
  duplicateOf?: DuplicateInfo;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export interface SkippedRow {
  lineNumber: number;
  reason: string;
}

/** Validate that an ISO date string (YYYY-MM-DD) represents a real calendar date. */
function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, mo, d] = date.split("-").map(Number);
  if (y < 1900 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  // Use Date to catch month/day overflow (e.g. Feb 30)
  const dt = new Date(`${date}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo && dt.getUTCDate() === d;
}

interface ParseResult {
  transactions: BankTransaction[];
  skippedRows: SkippedRow[];
  metadata?: StatementMetadata;
}

interface StatementMetadata {
  statementNumber: string | null;
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceIban: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string;
}

const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function xmlText(value: any): string | null {
  if (value == null) return null;
  const raw = typeof value === "object" ? value["#text"] : value;
  const text = String(raw ?? "").trim();
  return text || null;
}

function camtAmount(value: any): number | null {
  const text = xmlText(value);
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount !== 0 ? Math.abs(amount) : null;
}

function camtDate(value: any): string | null {
  const raw = xmlText(value?.Dt ?? value?.DtTm ?? value);
  const date = raw?.slice(0, 10) ?? null;
  return date && isValidIsoDate(date) ? date : null;
}

function camtReference(tx: any): string | null {
  const structured = asArray(tx?.RmtInf?.Strd)
    .map((item: any) => xmlText(item?.CdtrRefInf?.Ref))
    .find(Boolean);
  const unstructured = asArray(tx?.RmtInf?.Ustrd).map(xmlText).filter(Boolean).join(" ");
  const endToEnd = xmlText(tx?.Refs?.EndToEndId);
  const candidate = structured || unstructured || (endToEnd !== "NOTPROVIDED" ? endToEnd : null);
  return candidate?.slice(0, 140) ?? null;
}

/** Razčleni ISO 20022 bančni izpis CAMT.053, neodvisno od verzije namespace-a. */
export function parseCamt053(content: string): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(content);
  const statements = asArray(parsed?.Document?.BkToCstmrStmt?.Stmt);
  const transactions: BankTransaction[] = [];
  const skippedRows: SkippedRow[] = [];
  let index = 0;
  const firstStatement = statements[0];
  const balances = asArray(firstStatement?.Bal);
  const findBalance = (codes: string[]) => {
    const balance = balances.find((b: any) => codes.includes(xmlText(b?.Tp?.CdOrPrtry?.Cd) ?? ""));
    const amountText = xmlText(balance?.Amt);
    const amount = amountText != null && Number.isFinite(Number(amountText)) ? Math.abs(Number(amountText)) : null;
    return amount == null ? null : (xmlText(balance?.CdtDbtInd) === "DBIT" ? -amount : amount);
  };
  const metadata: StatementMetadata = {
    statementNumber: xmlText(firstStatement?.Id),
    statementDate: camtDate(firstStatement?.CreDtTm) || camtDate(firstStatement?.FrToDt?.ToDtTm),
    periodFrom: camtDate(firstStatement?.FrToDt?.FrDtTm),
    periodTo: camtDate(firstStatement?.FrToDt?.ToDtTm),
    sourceIban: xmlText(firstStatement?.Acct?.Id?.IBAN)?.replace(/\s+/g, "").toUpperCase() ?? null,
    openingBalance: findBalance(["OPBD", "PRCD"]),
    closingBalance: findBalance(["CLBD", "ITBD"]),
    currency: xmlText(firstStatement?.Acct?.Ccy) || "EUR",
  };

  for (const statement of statements) {
    const statementCurrency = xmlText(statement?.Acct?.Ccy) || "EUR";
    for (const entry of asArray(statement?.Ntry)) {
      const date = camtDate(entry?.BookgDt) || camtDate(entry?.ValDt);
      const entryAmount = camtAmount(entry?.Amt);
      const direction = xmlText(entry?.CdtDbtInd);
      const details = asArray(entry?.NtryDtls)
        .flatMap((container: any) => asArray(container?.TxDtls));
      const units = details.length > 0 ? details : [null];

      if (!date || !entryAmount || (direction !== "CRDT" && direction !== "DBIT")) {
        skippedRows.push({ lineNumber: index + 1, reason: "CAMT knjižba nima veljavnega datuma, zneska ali smeri CRDT/DBIT" });
        index++;
        continue;
      }
      if (units.length > 1 && units.some((tx: any) => !camtAmount(tx?.AmtDtls?.TxAmt?.Amt ?? tx?.Amt))) {
        skippedRows.push({ lineNumber: index + 1, reason: "CAMT zbirna knjižba vsebuje več transakcij brez posameznih zneskov" });
        index++;
        continue;
      }

      for (const tx of units) {
        const credit = direction === "CRDT";
        const amount = camtAmount(tx?.AmtDtls?.TxAmt?.Amt ?? tx?.Amt) ?? entryAmount;
        const parties = tx?.RltdPties;
        const counterparty = credit ? parties?.Dbtr : parties?.Cdtr;
        const counterpartyAccount = credit ? parties?.DbtrAcct : parties?.CdtrAcct;
        const currency = xmlText(
          tx?.AmtDtls?.TxAmt?.Amt?.["@Ccy"]
          ?? tx?.Amt?.["@Ccy"]
          ?? entry?.Amt?.["@Ccy"],
        ) || statementCurrency;
        const serviceRef = xmlText(tx?.Refs?.AcctSvcrRef) || xmlText(entry?.AcctSvcrRef) || xmlText(entry?.NtryRef);
        const description = [
          xmlText(tx?.AddtlTxInf),
          xmlText(tx?.BkTxCd?.Prtry?.Cd),
        ].filter(Boolean).join(" — ") || null;
        transactions.push({
          id: `camt-${serviceRef || "tx"}-${index}`,
          date,
          amount: credit ? amount : -amount,
          reference: camtReference(tx),
          counterpartyName: xmlText(counterparty?.Nm),
          counterpartyIban: xmlText(counterpartyAccount?.Id?.IBAN)?.replace(/\s+/g, "").toUpperCase() ?? null,
          description,
          currency,
        });
        index++;
      }
    }
  }
  return { transactions, skippedRows, metadata };
}

/**
 * Parse MT940 SWIFT format into BankTransaction array.
 * Handles the common `:61:` and `:86:` tag structure.
 */
function parseMT940(content: string): ParseResult {
  const transactions: BankTransaction[] = [];
  const skippedRows: SkippedRow[] = [];

  // Normalise line endings
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = text.split("\n");

  // Split into tag blocks
  const tagRe = /^:(\w+):(.*?)(?=\n:\w+:|$)/gms;
  const tags: { tag: string; value: string; lineNumber: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    // Estimate line number by counting newlines before this match
    const lineNumber = text.slice(0, m.index).split("\n").length;
    tags.push({ tag: m[1], value: m[2].trim(), lineNumber });
  }

  let currency = "EUR";
  // Try to get currency from :60F: or :60M:
  const balanceTag = tags.find(t => t.tag === "60F" || t.tag === "60M");
  if (balanceTag) {
    const bc = /^[CD]\d{6}([A-Z]{3})/.exec(balanceTag.value);
    if (bc) currency = bc[1];
  }

  let idx = 0;
  for (let i = 0; i < tags.length; i++) {
    const { tag, value, lineNumber } = tags[i];
    if (tag !== "61") continue;

    // :61: YYMMDD[MMDD][C/D][S]AmountFRef
    // E.g. 2412231224C123,45NTRFNONREF
    const txRe = /^(\d{2})(\d{2})(\d{2})(?:\d{4})?([CD]R?)(\d+,\d+)\w{0,4}(.*)$/s;
    const txm = txRe.exec(value.replace(/\n/g, ""));
    if (!txm) {
      skippedRows.push({ lineNumber, reason: "Vrstica :61: ni v prepoznavnem formatu" });
      continue;
    }

    const [, yy, mm, dd, cdFlag, amountRaw, rest] = txm;
    const date = `20${yy}-${mm}-${dd}`;

    if (!isValidIsoDate(date)) {
      skippedRows.push({ lineNumber, reason: `Neveljaven datum: ${date}` });
      continue;
    }

    const absAmount = parseFloat(amountRaw.replace(",", "."));
    const amount = cdFlag.startsWith("D") ? -absAmount : absAmount;

    if (amount === 0) {
      skippedRows.push({ lineNumber, reason: "Znesek je 0" });
      continue;
    }

    // Reference is after the NTRF/NCHK etc fund code (next line or trailing)
    const refMatch = /\n?(.+)/.exec(rest);
    let reference: string | null = refMatch ? refMatch[1].trim() : null;
    if (reference === "NONREF" || reference === "") reference = null;

    // Look for the :86: tag immediately following
    let description: string | null = null;
    let counterpartyName: string | null = null;
    let counterpartyIban: string | null = null;

    if (i + 1 < tags.length && tags[i + 1].tag === "86") {
      const details = tags[i + 1].value;
      // Try to extract structured reference (/REF/, /NAME/, /IBAN/)
      const refM = /\/REF\/([^/\n]+)/.exec(details);
      if (refM && !reference) reference = refM[1].trim();
      const nameM = /\/NAME\/([^/\n]+)/.exec(details);
      if (nameM) counterpartyName = nameM[1].trim();
      const ibanM = /\/IBAN\/([^/\n]+)/.exec(details);
      if (ibanM) counterpartyIban = ibanM[1].trim();

      // Try SI reference in free text
      const siM = /SI\d{2}\s*[\d\s-]+/.exec(details);
      if (siM && !reference) reference = siM[0].replace(/\s/g, "").trim();

      description = details.replace(/\/[A-Z]+\/[^/\n]*/g, "").replace(/\n/g, " ").trim() || null;
    }

    transactions.push({
      id: `mt940-${idx++}`,
      date,
      amount,
      reference,
      counterpartyName,
      counterpartyIban,
      description,
      currency,
    });
  }

  const statementNumber = tags.find(t => t.tag === "28C")?.value ?? null;
  const sourceIban = tags.find(t => t.tag === "25")?.value.replace(/\s+/g, "").toUpperCase() ?? null;
  const parseBalance = (tagNames: string[]) => {
    const value = tags.find(t => tagNames.includes(t.tag))?.value;
    const match = value?.match(/^([CD])(\d{6})([A-Z]{3})(\d+,\d+)/);
    if (!match) return { date: null, amount: null };
    const amount = Number(match[4].replace(",", "."));
    return {
      date: `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`,
      amount: match[1] === "D" ? -amount : amount,
    };
  };
  const opening = parseBalance(["60F", "60M"]);
  const closing = parseBalance(["62F", "62M"]);
  return {
    transactions,
    skippedRows,
    metadata: {
      statementNumber,
      statementDate: closing.date,
      periodFrom: opening.date,
      periodTo: closing.date,
      sourceIban,
      openingBalance: opening.amount,
      closingBalance: closing.amount,
      currency,
    },
  };
}

/**
 * Parse CSV bank export (NLB, SKB, Addiko and generic SI bank formats).
 * Accepts semicolon or comma delimiters. Auto-detects columns from headers.
 */
function parseCSV(content: string): ParseResult {
  const skippedRows: SkippedRow[] = [];
  const allLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = allLines.filter(l => l.trim());
  if (lines.length < 2) return { transactions: [], skippedRows };

  // Detect delimiter
  const firstLine = lines[0];
  const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let inQuote = false;
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === delim && !inQuote) { cols.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"));

  // Map header names to column indices
  const colIdx = (candidates: string[]): number => {
    for (const c of candidates) {
      const i = headers.findIndex(h => h.includes(c));
      if (i !== -1) return i;
    }
    return -1;
  };

  // Common Slovenian bank column names
  const dateCol   = colIdx(["datum", "date", "valuta_datum", "booking_date"]);
  const amtCol    = colIdx(["znesek", "amount", "kredit", "credit_amount", "promet"]);
  const creditCol = colIdx(["kredit", "credit", "prihodek", "dobropis"]);
  const debitCol  = colIdx(["debit", "breme", "odhodek", "bremenitev"]);
  const refCol    = colIdx(["sklic", "reference", "ref", "namen_placila", "payment_reference"]);
  const nameCol   = colIdx(["naziv", "name", "stranka", "partner", "counterparty", "prejemnik", "payer"]);
  const ibanCol   = colIdx(["iban", "racun", "account"]);
  const descCol   = colIdx(["opis", "description", "namen", "purpose", "komentar"]);
  const curCol    = colIdx(["valuta", "currency"]);

  const transactions: BankTransaction[] = [];
  let idx = 0;

  // Track file line numbers (1-based, accounting for blank lines in the original)
  // lines[] is already filtered, so we reconstruct positions from allLines
  const lineNumberOf = (filteredIndex: number): number => {
    let count = 0;
    for (let n = 0; n < allLines.length; n++) {
      if (allLines[n].trim()) {
        if (count === filteredIndex) return n + 1;
        count++;
      }
    }
    return filteredIndex + 1;
  };

  for (let i = 1; i < lines.length; i++) {
    const fileLineNum = lineNumberOf(i);
    const cols = parseLine(lines[i]);
    if (cols.every(c => !c)) continue;

    const get = (ci: number): string => (ci >= 0 && ci < cols.length ? cols[ci] : "").trim();

    const rawDate = get(dateCol);
    if (!rawDate) {
      skippedRows.push({ lineNumber: fileLineNum, reason: "Manjkajoč datum" });
      continue;
    }

    // Parse date (DD.MM.YYYY or YYYY-MM-DD or DD/MM/YYYY)
    let date = rawDate;
    const dmY = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(rawDate);
    if (dmY) {
      const [, d, mo, y] = dmY;
      const year = y.length === 2 ? `20${y}` : y;
      date = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    if (!isValidIsoDate(date)) {
      skippedRows.push({ lineNumber: fileLineNum, reason: `Neveljaven datum: "${rawDate}"` });
      continue;
    }

    // Parse amount
    let amount = 0;
    if (amtCol >= 0) {
      // Single column — positive = credit, negative = debit
      const raw = get(amtCol).replace(/\./g, "").replace(",", ".");
      amount = parseFloat(raw) || 0;
    } else if (creditCol >= 0 || debitCol >= 0) {
      const cr = parseFloat(get(creditCol).replace(/\./g, "").replace(",", ".") || "0") || 0;
      const db2 = parseFloat(get(debitCol).replace(/\./g, "").replace(",", ".") || "0") || 0;
      amount = cr - db2;
    }

    if (amount === 0) {
      skippedRows.push({ lineNumber: fileLineNum, reason: "Znesek je 0" });
      continue;
    }

    const reference = get(refCol) || null;
    const counterpartyName = get(nameCol) || null;
    const counterpartyIban = get(ibanCol) || null;
    const description = get(descCol) || null;
    const currency = get(curCol) || "EUR";

    transactions.push({
      id: `csv-${idx++}`,
      date,
      amount,
      reference,
      counterpartyName,
      counterpartyIban,
      description,
      currency,
      raw: lines[i],
    });
  }

  return { transactions, skippedRows };
}

// ─── Matching engine ──────────────────────────────────────────────────────────

/** Slovenian SI reference normalise: remove spaces, dashes */
function normRef(ref: string | null | undefined): string {
  return (ref ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/** Simplified name similarity: normalise and check containment */
function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const na = a.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nb = b.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = na.length < nb.length ? na : nb;
  const longer  = na.length < nb.length ? nb : na;
  return longer.includes(shorter) ? 0.7 : 0;
}

/** Normalise reference for duplicate comparison */
function normRefForDup(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const n = ref.replace(/[\s-]/g, "").toUpperCase();
  return n || null;
}

export async function buildMatchSuggestions(
  companyId: string,
  transactions: BankTransaction[],
  onSuggestion?: (
    suggestion: TransactionWithSuggestions,
    current: number,
    total: number,
  ) => void | Promise<void>,
): Promise<TransactionWithSuggestions[]> {
  if (transactions.length === 0) return [];

  // ── Duplicate detection ───────────────────────────────────────────────────
  // Fetch existing posted/draft payments for this company to detect re-imports.
  const existingPayments = await db
    .select({
      id: paymentsTable.id,
      paymentDate: paymentsTable.paymentDate,
      amount: paymentsTable.amount,
      reference: paymentsTable.reference,
      direction: paymentsTable.direction,
    })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.companyId, companyId),
        sql`${paymentsTable.status} IN ('draft', 'posted')`,
      ),
    );

  // Build a lookup: "date|amount|normRef" -> payment (direction-aware)
  type PaymentRow = typeof existingPayments[number];
  const paymentByKey = new Map<string, PaymentRow>();
  for (const p of existingPayments) {
    const amt = parseFloat(p.amount ?? "0");
    const ref = normRefForDup(p.reference);
    // Key includes direction so inbound/outbound don't collide
    const key = `${p.direction}|${p.paymentDate}|${amt.toFixed(2)}|${ref ?? ""}`;
    paymentByKey.set(key, p);
  }

  /**
   * Determine if a bank transaction is a duplicate of an existing payment.
   * Match criteria (all must hold):
   *   1. Same direction (inbound/outbound)
   *   2. Same date
   *   3. Same absolute amount (within 1 cent)
   *   4. If both have a reference: normalised references match
   *      If neither has a reference (or only one does): amount+date is sufficient
   */
  function findDuplicate(tx: BankTransaction): DuplicateInfo | undefined {
    const direction = tx.amount > 0 ? "inbound" : "outbound";
    const absAmt = Math.abs(tx.amount);
    const txRef = normRefForDup(tx.reference);

    // First try exact key match (fast path)
    const exactKey = `${direction}|${tx.date}|${absAmt.toFixed(2)}|${txRef ?? ""}`;
    const exact = paymentByKey.get(exactKey);
    if (exact) {
      return {
        paymentId: exact.id,
        paymentDate: exact.paymentDate,
        amount: exact.amount,
        reference: exact.reference,
        direction: exact.direction,
      };
    }

    // Fallback: iterate to handle 1-cent tolerance and ref-less matches
    for (const p of existingPayments) {
      if (p.direction !== direction) continue;
      if (p.paymentDate !== tx.date) continue;
      const pAmt = parseFloat(p.amount ?? "0");
      if (Math.abs(pAmt - absAmt) > 0.005) continue;
      const pRef = normRefForDup(p.reference);
      // If both have refs they must match; if neither has a ref match on date+amount
      if (txRef && pRef && txRef !== pRef) continue;
      return {
        paymentId: p.id,
        paymentDate: p.paymentDate,
        amount: p.amount,
        reference: p.reference,
        direction: p.direction,
      };
    }
    return undefined;
  }

  // Fetch all open items (posted invoices with remaining balance)
  const invoices = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      dueDate: invoicesTable.dueDate,
      type: invoicesTable.type,
      counterpartyId: invoicesTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      counterpartyIban: counterpartiesTable.iban,
    })
    .from(invoicesTable)
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
    .where(
      and(
        eq(invoicesTable.companyId, companyId),
        sql`${invoicesTable.status} IN ('posted', 'paid')`,
      ),
    );

  if (invoices.length === 0) {
    const results: TransactionWithSuggestions[] = [];
    for (const [index, transaction] of transactions.entries()) {
      const result = { transaction, suggestions: [] };
      results.push(result);
      await onSuggestion?.(result, index + 1, transactions.length);
    }
    return results;
  }

  const invoiceIds = invoices.map(i => i.id);

  // Gross amounts from invoice lines
  const grossRows = await db
    .select({
      invoiceId: invoiceLinesTable.invoiceId,
      gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
    })
    .from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
    .groupBy(invoiceLinesTable.invoiceId);
  const grossMap = new Map(grossRows.map(r => [r.invoiceId, parseFloat(r.gross ?? "0")]));

  // Already allocated amounts (from posted payments)
  const allocRows = await db
    .select({
      invoiceId: paymentAllocationsTable.invoiceId,
      allocated: sql<string>`COALESCE(SUM(${paymentAllocationsTable.allocatedAmount}), 0)`,
    })
    .from(paymentAllocationsTable)
    .innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
    .where(
      and(
        inArray(paymentAllocationsTable.invoiceId, invoiceIds),
        eq(paymentsTable.status, "posted"),
      ),
    )
    .groupBy(paymentAllocationsTable.invoiceId);
  const allocMap = new Map(allocRows.map(r => [r.invoiceId, parseFloat(r.allocated ?? "0")]));
  const historicalRows = await db.select({
    invoiceId: bookieOldArSettlementsTable.invoiceId,
    closed: bookieOldArSettlementsTable.closedAmount,
  }).from(bookieOldArSettlementsTable).where(and(
    eq(bookieOldArSettlementsTable.companyId, companyId),
    inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds),
  ));
  const historicalMap = new Map(historicalRows.map(r => [r.invoiceId, Number(r.closed)]));

  // Build open items with remaining amounts
  const openItems = invoices
    .map(inv => {
      const gross = grossMap.get(inv.id) ?? 0;
      const allocated = allocMap.get(inv.id) ?? 0;
      const remaining = gross - allocated - (historicalMap.get(inv.id) ?? 0);
      return { ...inv, gross, remaining };
    })
    .filter(i => i.remaining >= 0.005);

  // Score each transaction against open items
  const results: TransactionWithSuggestions[] = [];

  for (const [index, tx] of transactions.entries()) {
    const absAmount = Math.abs(tx.amount);
    // inbound payments match against issued invoices (receivables)
    // outbound payments match against received invoices (payables)
    const expectedType = tx.amount > 0 ? "issued" : "received";

    const scored: (MatchSuggestion & { score: number })[] = [];

    for (const item of openItems) {
      if (item.type !== expectedType) continue;

      let score = 0;
      const reasons: string[] = [];

      // Amount match (within 1 cent)
      const amountDiff = Math.abs(absAmount - item.remaining);
      if (amountDiff < 0.005) {
        score += 50;
        reasons.push(`Znesek se ujema (${item.remaining.toFixed(2)})`);
      } else if (amountDiff / item.remaining < 0.02) {
        // within 2%
        score += 30;
        reasons.push(`Znesek se skoraj ujema (${item.remaining.toFixed(2)}, razlika ${amountDiff.toFixed(2)})`);
      } else if (amountDiff / item.remaining < 0.10) {
        score += 10;
      } else {
        // Amounts don't match well — low base score only
        score += 2;
      }

      // Reference match — compare bank transaction reference against invoice number
      const txRef = normRef(tx.reference);
      if (txRef && item.invoiceNumber && txRef.includes(normRef(item.invoiceNumber))) {
        score += 30;
        reasons.push(`Sklic vsebuje številko računa`);
      }

      // IBAN match
      if (tx.counterpartyIban && item.counterpartyIban) {
        const normIban = (s: string) => s.replace(/\s/g, "").toUpperCase();
        if (normIban(tx.counterpartyIban) === normIban(item.counterpartyIban)) {
          score += 30;
          reasons.push(`IBAN se ujema`);
        }
      }

      // Counterparty name similarity
      const nameSim = nameSimilarity(tx.counterpartyName, item.counterpartyName);
      if (nameSim >= 0.9) {
        score += 20;
        reasons.push(`Naziv partnerja se ujema`);
      } else if (nameSim >= 0.5) {
        score += 10;
        reasons.push(`Naziv partnerja se delno ujema`);
      }

      if (score < 5) continue; // Skip very low-confidence suggestions

      scored.push({
        invoiceId: item.id,
        invoiceNumber: item.invoiceNumber,
        counterpartyId: item.counterpartyId,
        counterpartyName: item.counterpartyName,
        invoiceDate: item.invoiceDate,
        dueDate: item.dueDate,
        remainingAmount: item.remaining.toFixed(2),
        confidence: Math.min(score / 100, 1),
        matchReasons: reasons,
        score,
      });
    }

    // Sort by score descending, take top 5
    scored.sort((a, b) => b.score - a.score);
    const suggestions: MatchSuggestion[] = scored.slice(0, 5).map(({ score: _s, ...rest }) => rest);

    const duplicateOf = findDuplicate(tx);
    const result = { transaction: tx, suggestions, duplicateOf };
    results.push(result);
    await onSuggestion?.(result, index + 1, transactions.length);
  }

  return results;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /companies/:companyId/bank-statements/parse
 * Accepts multipart/form-data with field "file" (CSV, MT940 or CAMT.053 XML).
 * Returns parsed transactions.
 */
router.post(
  "/companies/:companyId/bank-statements/parse",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    if (!req.file) {
      res.status(400).json({ error: "Datoteka ni priložena" });
      return;
    }

    const content = req.file.buffer.toString("utf-8");
    const filename = req.file.originalname.toLowerCase();

    let parseResult: ParseResult;
    try {
      if (filename.endsWith(".xml") || content.includes("BkToCstmrStmt")) {
        parseResult = parseCamt053(content);
      } else if (filename.endsWith(".mt940") || filename.endsWith(".sta") || filename.endsWith(".940") || content.includes(":61:")) {
        parseResult = parseMT940(content);
        if (parseResult.transactions.length === 0) {
          // Fallback to CSV if MT940 parsing yields nothing
          parseResult = parseCSV(content);
        }
      } else {
        parseResult = parseCSV(content);
      }
    } catch (err) {
      res.status(400).json({ error: "Napaka pri razčlenjevanju datoteke. Preverite format (CAMT.053 XML, CSV ali MT940)." });
      return;
    }

    const { transactions, skippedRows } = parseResult;

    if (transactions.length === 0 && skippedRows.length === 0) {
      res.status(422).json({ error: "V datoteki ni bilo najdenih transakcij. Preverite format." });
      return;
    }

    if (transactions.length === 0) {
      res.status(422).json({
        error: "Vse vrstice so bile preskočene. Preverite format datoteke.",
        skippedRows,
      });
      return;
    }

    const dates = transactions.map(tx => tx.date).sort();
    const metadata = {
      statementNumber: null,
      statementDate: dates.at(-1) ?? null,
      periodFrom: dates[0] ?? null,
      periodTo: dates.at(-1) ?? null,
      sourceIban: null,
      openingBalance: null,
      closingBalance: null,
      currency: transactions[0]?.currency ?? "EUR",
      ...parseResult.metadata,
    };
    res.json({
      transactions,
      count: transactions.length,
      skippedRows,
      metadata,
      sourceFilename: req.file.originalname,
      sourceSha256: createHash("sha256").update(req.file.buffer).digest("hex"),
    });
  },
);

router.get(
  "/companies/:companyId/bank-statements",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    const statements = await db.select({
      id: bankStatementsTable.id,
      bankAccountId: bankStatementsTable.bankAccountId,
      bankAccountCode: accountsTable.code,
      bankAccountName: accountsTable.name,
      sourceIban: bankStatementsTable.sourceIban,
      statementNumber: bankStatementsTable.statementNumber,
      statementDate: bankStatementsTable.statementDate,
      periodFrom: bankStatementsTable.periodFrom,
      periodTo: bankStatementsTable.periodTo,
      openingBalance: bankStatementsTable.openingBalance,
      closingBalance: bankStatementsTable.closingBalance,
      currency: bankStatementsTable.currency,
      sourceFilename: bankStatementsTable.sourceFilename,
      lineCount: sql<number>`count(${bankStatementLinesTable.id})::int`,
      createdAt: bankStatementsTable.createdAt,
    })
      .from(bankStatementsTable)
      .innerJoin(accountsTable, eq(accountsTable.id, bankStatementsTable.bankAccountId))
      .leftJoin(bankStatementLinesTable, eq(bankStatementLinesTable.statementId, bankStatementsTable.id))
      .where(eq(bankStatementsTable.companyId, companyId))
      .groupBy(bankStatementsTable.id, accountsTable.id)
      .orderBy(desc(bankStatementsTable.statementDate), desc(bankStatementsTable.createdAt));
    res.json({ statements });
  },
);

router.get(
  "/companies/:companyId/bank-statements/detail/:statementId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GetBankStatementDetailParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Neveljaven ID bančnega izpiska" });
      return;
    }
    const { companyId, statementId } = parsed.data;
    const access = await resolveAccess((req as AuthenticatedRequest).clerkUserId, companyId, res);
    if (!access) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(statementId)) {
      res.status(400).json({ error: "Neveljaven ID bančnega izpiska" });
      return;
    }
    const [statement] = await db.select({
      id: bankStatementsTable.id,
      bankAccountCode: accountsTable.code,
      bankAccountName: accountsTable.name,
      statementNumber: bankStatementsTable.statementNumber,
      statementDate: bankStatementsTable.statementDate,
      periodFrom: bankStatementsTable.periodFrom,
      periodTo: bankStatementsTable.periodTo,
      sourceIban: bankStatementsTable.sourceIban,
      openingBalance: bankStatementsTable.openingBalance,
      closingBalance: bankStatementsTable.closingBalance,
      currency: bankStatementsTable.currency,
      sourceFilename: bankStatementsTable.sourceFilename,
    }).from(bankStatementsTable)
      .innerJoin(accountsTable, and(
        eq(accountsTable.id, bankStatementsTable.bankAccountId),
        eq(accountsTable.companyId, companyId),
      ))
      .where(and(eq(bankStatementsTable.id, statementId), eq(bankStatementsTable.companyId, companyId)))
      .limit(1);
    if (!statement) {
      res.status(404).json({ error: "Bančni izpisek ni bil najden" });
      return;
    }
    const lines = await db.select({
      id: bankStatementLinesTable.id,
      lineNumber: bankStatementLinesTable.lineNumber,
      bookingDate: bankStatementLinesTable.bookingDate,
      amount: bankStatementLinesTable.amount,
      currency: bankStatementLinesTable.currency,
      reference: bankStatementLinesTable.reference,
      counterpartyName: bankStatementLinesTable.counterpartyName,
      counterpartyIban: bankStatementLinesTable.counterpartyIban,
      description: bankStatementLinesTable.description,
    }).from(bankStatementLinesTable)
      .where(eq(bankStatementLinesTable.statementId, statementId))
      .orderBy(bankStatementLinesTable.lineNumber, bankStatementLinesTable.id);

    let historicalLedger = null;
    // Only the explicitly marked Bookie Old reconstruction has a trustworthy
    // voucher key. A net 110 movement is not a list of individual payments.
    const source = /^Bookie Old Promet (\d{4})\/(\d{6}) – rekonstrukcija iz GK(?: –.*)?$/.exec(statement.sourceFilename);
    if (source) {
      const reference = `BOOKIE-OLD/K2/${source[1]}/10/${source[2]}`;
      const [entry] = await db.select({
        id: journalEntriesTable.id,
        reference: journalEntriesTable.reference,
        documentDate: journalEntriesTable.documentDate,
        bookingDate: journalEntriesTable.entryDate,
        status: journalEntriesTable.status,
      }).from(journalEntriesTable)
        .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, reference)))
        .limit(1);

      if (entry) {
        const ledgerLines = await db.select({
          id: journalEntryLinesTable.id,
          accountCode: accountsTable.code,
          accountName: accountsTable.name,
          side: journalEntryLinesTable.side,
          amount: journalEntryLinesTable.amount,
          description: journalEntryLinesTable.description,
          partnerName: counterpartiesTable.name,
        }).from(journalEntryLinesTable)
          .innerJoin(accountsTable, and(
            eq(accountsTable.id, journalEntryLinesTable.accountId),
            eq(accountsTable.companyId, companyId),
          ))
          .leftJoin(counterpartiesTable, and(
            eq(counterpartiesTable.id, journalEntryLinesTable.partnerId),
            eq(counterpartiesTable.companyId, companyId),
          ))
          .where(eq(journalEntryLinesTable.entryId, entry.id))
          .orderBy(journalEntryLinesTable.sequence, journalEntryLinesTable.id);

        const sourceLineIds = ledgerLines
          .map(line => line.description?.match(/GLAVNA #(\d+)/)?.[1])
          .filter((id): id is string => !!id);
        const settlements = sourceLineIds.length ? await db.select({
          invoiceNumber: invoicesTable.invoiceNumber,
          invoiceType: invoicesTable.type,
          evidence: bookieOldArSettlementsTable.evidence,
        }).from(bookieOldArSettlementsTable)
          .innerJoin(invoicesTable, and(
            eq(invoicesTable.id, bookieOldArSettlementsTable.invoiceId),
            eq(invoicesTable.companyId, companyId),
          ))
          .where(and(
            eq(bookieOldArSettlementsTable.companyId, companyId),
            sql`EXISTS (
              SELECT 1 FROM jsonb_array_elements(${bookieOldArSettlementsTable.evidence}) AS item
              WHERE ${inArray(sql<string>`item->>'otherLineId'`, sourceLineIds)}
            )`,
          )) : [];
        const closingsBySourceLine = new Map<string, Array<{
          closingId: string; invoiceNumber: string; invoiceType: string; amount: string; recordedDate: string;
        }>>();
        for (const settlement of settlements) {
          for (const evidence of settlement.evidence) {
            if (!sourceLineIds.includes(evidence.otherLineId)) continue;
            const closings = closingsBySourceLine.get(evidence.otherLineId) ?? [];
            closings.push({
              closingId: evidence.closingId,
              invoiceNumber: settlement.invoiceNumber,
              invoiceType: settlement.invoiceType,
              amount: evidence.amount,
              recordedDate: evidence.recordedDate,
            });
            closingsBySourceLine.set(evidence.otherLineId, closings);
          }
        }
        if (source[1] === "2026") {
          const supplierClosings = await db.select({
            sourceBankLineId: bookieOldBankApClosingsTable.sourceBankLineId,
            closingId: bookieOldBankApClosingsTable.closingId,
            invoiceNumber: invoicesTable.invoiceNumber,
            invoiceType: invoicesTable.type,
            amount: bookieOldBankApClosingsTable.amount,
            recordedDate: bookieOldBankApClosingsTable.recordedDate,
          }).from(bookieOldBankApClosingsTable)
            .innerJoin(invoicesTable, and(
              eq(invoicesTable.id, bookieOldBankApClosingsTable.invoiceId),
              eq(invoicesTable.companyId, companyId),
            ))
            .where(and(
              eq(bookieOldBankApClosingsTable.companyId, companyId),
              eq(bookieOldBankApClosingsTable.statementId, statementId),
            ));
          for (const closing of supplierClosings) {
            if (!sourceLineIds.includes(closing.sourceBankLineId)) continue;
            const list = closingsBySourceLine.get(closing.sourceBankLineId) ?? [];
            list.push({
              closingId: closing.closingId,
              invoiceNumber: closing.invoiceNumber,
              invoiceType: closing.invoiceType,
              amount: closing.amount,
              recordedDate: closing.recordedDate,
            });
            closingsBySourceLine.set(closing.sourceBankLineId, list);
          }
        }
        historicalLedger = {
          reference,
          documentDate: entry.documentDate,
          bookingDate: entry.bookingDate,
          status: entry.status,
          lines: ledgerLines.map(line => {
            const sourceLineId = line.description?.match(/GLAVNA #(\d+)/)?.[1] ?? null;
            return { ...line, sourceLineId, historicalClosings: sourceLineId ? closingsBySourceLine.get(sourceLineId) ?? [] : [] };
          }),
        };
      }
    }
    res.json(GetBankStatementDetailResponse.parse({ ...statement, lines, historicalLedger }));
  },
);

router.post(
  "/companies/:companyId/bank-statements/register",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    const { bankAccountId, metadata, sourceFilename, sourceSha256, transactions } = req.body ?? {};
    if (!bankAccountId || !sourceFilename || !/^[a-f0-9]{64}$/.test(sourceSha256 ?? "") || !Array.isArray(transactions) || transactions.length === 0) {
      res.status(400).json({ error: "Manjkajo podatki bančnega izpiska" });
      return;
    }
    const [bankAccount] = await db.select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, bankAccountId), eq(accountsTable.companyId, companyId)))
      .limit(1);
    if (!bankAccount) { res.status(400).json({ error: "Izbrani bančni konto ne pripada podjetju" }); return; }
    const dates = transactions.map((tx: BankTransaction) => tx.date).sort();
    try {
      const result = await db.transaction(async tx => {
        const [statement] = await tx.insert(bankStatementsTable).values({
          companyId,
          bankAccountId,
          sourceIban: metadata?.sourceIban ?? null,
          statementNumber: metadata?.statementNumber ?? null,
          statementDate: metadata?.statementDate ?? dates.at(-1),
          periodFrom: metadata?.periodFrom ?? dates[0],
          periodTo: metadata?.periodTo ?? dates.at(-1),
          openingBalance: metadata?.openingBalance == null ? null : String(metadata.openingBalance),
          closingBalance: metadata?.closingBalance == null ? null : String(metadata.closingBalance),
          currency: metadata?.currency ?? transactions[0]?.currency ?? "EUR",
          sourceFilename,
          sourceSha256,
          createdBy: authReq.clerkUserId,
        }).returning({ id: bankStatementsTable.id });
        const lines = await tx.insert(bankStatementLinesTable).values(
          transactions.map((item: BankTransaction, index: number) => ({
            statementId: statement.id,
            transactionKey: item.id,
            lineNumber: index + 1,
            bookingDate: item.date,
            amount: String(item.amount),
            currency: item.currency,
            reference: item.reference,
            counterpartyName: item.counterpartyName,
            counterpartyIban: item.counterpartyIban,
            description: item.description,
          })),
        ).returning({ id: bankStatementLinesTable.id, transactionKey: bankStatementLinesTable.transactionKey });
        return { statementId: statement.id, lineIds: Object.fromEntries(lines.map(line => [line.transactionKey, line.id])) };
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error?.code === "23505") {
        res.status(409).json({ error: "Ta datoteka bančnega izpiska je bila že evidentirana." });
        return;
      }
      throw error;
    }
  },
);

/**
 * POST /companies/:companyId/bank-statements/match
 * Body: { transactions: BankTransaction[] }
 * Returns match suggestions for each transaction.
 */
router.post(
  "/companies/:companyId/bank-statements/match",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { transactions } = req.body as { transactions?: BankTransaction[] };
    if (!Array.isArray(transactions) || transactions.length === 0) {
      res.status(400).json({ error: "Manjka seznam transakcij" });
      return;
    }

    if (transactions.length > 500) {
      res.status(400).json({ error: "Največ 500 transakcij na enkrat" });
      return;
    }

    if (req.accepts(["application/x-ndjson", "json"]) === "application/x-ndjson") {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders();

      await buildMatchSuggestions(companyId, transactions, async (suggestion, current, total) => {
        res.write(`${JSON.stringify({ type: "suggestion", suggestion, current, total })}\n`);
        await new Promise<void>(resolve => setImmediate(resolve));
      });
      res.end(`${JSON.stringify({ type: "complete", total: transactions.length })}\n`);
      return;
    }

    const results = await buildMatchSuggestions(companyId, transactions);
    res.json({ suggestions: results });
  },
);

/**
 * GET /companies/:companyId/bank-statements/accounts
 * Returns available bank accounts and AR/AP accounts for the company.
 * Convenience endpoint for the import wizard.
 */
router.get(
  "/companies/:companyId/bank-statements/accounts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const allAccounts = await db
      .select({
        id: accountsTable.id,
        code: accountsTable.code,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true)));

    // Bank accounts: class 11x
    const bankAccounts = allAccounts.filter(a => a.code.startsWith("11"));
    // AR accounts: class 12x (terjatve do kupcev)
    const arAccounts = allAccounts.filter(a => a.code.startsWith("12") || a.code.startsWith("14"));
    // AP accounts: class 22x (obveznosti do dobaviteljev)
    const apAccounts = allAccounts.filter(a => a.code.startsWith("22") || a.code.startsWith("43"));

    // Periods
    const periods = await db
      .select({
        id: accountingPeriodsTable.id,
        name: accountingPeriodsTable.name,
        status: accountingPeriodsTable.status,
      })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.companyId, companyId));

    res.json({ bankAccounts, arAccounts, apAccounts, periods });
  },
);

export default router;
