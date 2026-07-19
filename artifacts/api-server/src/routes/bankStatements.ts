import { Router, type Request, type Response, type IRouter } from "express";
import multer from "multer";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  counterpartiesTable,
  invoicesTable,
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

export interface TransactionWithSuggestions {
  transaction: BankTransaction;
  suggestions: MatchSuggestion[];
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parse MT940 SWIFT format into BankTransaction array.
 * Handles the common `:61:` and `:86:` tag structure.
 */
function parseMT940(content: string): BankTransaction[] {
  const transactions: BankTransaction[] = [];
  // Normalise line endings
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into tag blocks
  const tagRe = /^:(\w+):(.*?)(?=\n:\w+:|$)/gms;
  const tags: { tag: string; value: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    tags.push({ tag: m[1], value: m[2].trim() });
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
    const { tag, value } = tags[i];
    if (tag !== "61") continue;

    // :61: YYMMDD[MMDD][C/D][S]AmountFRef
    // E.g. 2412231224C123,45NTRFNONREF
    const txRe = /^(\d{2})(\d{2})(\d{2})(?:\d{4})?([CD]R?)(\d+,\d+)\w{0,4}(.*)$/s;
    const txm = txRe.exec(value.replace(/\n/g, ""));
    if (!txm) continue;

    const [, yy, mm, dd, cdFlag, amountRaw, rest] = txm;
    const date = `20${yy}-${mm}-${dd}`;
    const absAmount = parseFloat(amountRaw.replace(",", "."));
    const amount = cdFlag.startsWith("D") ? -absAmount : absAmount;

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

  return transactions;
}

/**
 * Parse CSV bank export (NLB, SKB, Addiko and generic SI bank formats).
 * Accepts semicolon or comma delimiters. Auto-detects columns from headers.
 */
function parseCSV(content: string): BankTransaction[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

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

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.every(c => !c)) continue;

    const get = (ci: number): string => (ci >= 0 && ci < cols.length ? cols[ci] : "").trim();

    const rawDate = get(dateCol);
    if (!rawDate) continue;

    // Parse date (DD.MM.YYYY or YYYY-MM-DD or DD/MM/YYYY)
    let date = rawDate;
    const dmY = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(rawDate);
    if (dmY) {
      const [, d, mo, y] = dmY;
      const year = y.length === 2 ? `20${y}` : y;
      date = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
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

    if (amount === 0) continue;

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

  return transactions;
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

async function buildMatchSuggestions(
  companyId: string,
  transactions: BankTransaction[],
): Promise<TransactionWithSuggestions[]> {
  if (transactions.length === 0) return [];

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
      invoiceId: sql<string>`il.invoice_id`,
      gross: sql<string>`COALESCE(SUM((il.quantity::numeric * il.unit_price::numeric) + (il.quantity::numeric * il.unit_price::numeric * il.vat_rate::numeric / 100)), 0)`,
    })
    .from(sql`invoice_lines il`)
    .where(sql`il.invoice_id = ANY(${invoiceIds})`)
    .groupBy(sql`il.invoice_id`);
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

    results.push({ transaction: tx, suggestions });
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

    let transactions: BankTransaction[];
    try {
      if (filename.endsWith(".mt940") || filename.endsWith(".sta") || filename.endsWith(".940") || content.includes(":61:")) {
        transactions = parseMT940(content);
        if (transactions.length === 0) {
          // Fallback to CSV if MT940 parsing yields nothing
          transactions = parseCSV(content);
        }
      } else {
        transactions = parseCSV(content);
      }
    } catch (err) {
      res.status(400).json({ error: "Napaka pri razčlenjevanju datoteke. Preverite format (CSV ali MT940)." });
      return;
    }

    if (transactions.length === 0) {
      res.status(422).json({ error: "V datoteki ni bilo najdenih transakcij. Preverite format." });
      return;
    }

    res.json({ transactions, count: transactions.length });
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
