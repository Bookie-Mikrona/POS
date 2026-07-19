import { Router, type Request, type Response, type IRouter } from "express";
import multer from "multer";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  counterpartiesTable,
  invoicesTable,
  invoiceLinesTable,
  paymentAllocationsTable,
  paymentsTable,
  accountingRolesTable,
  accountsTable,
  accountingPeriodsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

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

  return { transactions, skippedRows };
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

async function buildMatchSuggestions(
  companyId: string,
  transactions: BankTransaction[],
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
    return transactions.map(t => ({ transaction: t, suggestions: [] }));
  }

  const invoiceIds = invoices.map(i => i.id);

  // Gross amounts from invoice lines
  const grossRows = await db
    .select({
      invoiceId: invoiceLinesTable.invoiceId,
      gross: sql<string>`COALESCE(SUM((${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100)), 0)`,
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

  // Build open items with remaining amounts
  const openItems = invoices
    .map(inv => {
      const gross = grossMap.get(inv.id) ?? 0;
      const allocated = allocMap.get(inv.id) ?? 0;
      const remaining = gross - allocated;
      return { ...inv, gross, remaining };
    })
    .filter(i => i.remaining >= 0.005);

  // Score each transaction against open items
  const results: TransactionWithSuggestions[] = [];

  for (const tx of transactions) {
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
    results.push({ transaction: tx, suggestions, duplicateOf });
  }

  return results;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /companies/:companyId/bank-statements/parse
 * Accepts multipart/form-data with field "file" (CSV or MT940).
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
      if (filename.endsWith(".mt940") || filename.endsWith(".sta") || filename.endsWith(".940") || content.includes(":61:")) {
        parseResult = parseMT940(content);
        if (parseResult.transactions.length === 0) {
          // Fallback to CSV if MT940 parsing yields nothing
          parseResult = parseCSV(content);
        }
      } else {
        parseResult = parseCSV(content);
      }
    } catch (err) {
      res.status(400).json({ error: "Napaka pri razčlenjevanju datoteke. Preverite format (CSV ali MT940)." });
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

    res.json({ transactions, count: transactions.length, skippedRows });
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
