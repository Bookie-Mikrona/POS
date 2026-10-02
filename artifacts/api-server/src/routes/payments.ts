import { Router, type Request, type Response, type IRouter } from "express";
import { createHash } from "node:crypto";
import { eq, and, gte, gt, lte, asc, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  paymentsTable,
  paymentAllocationsTable,
  counterpartiesTable,
  accountingPeriodsTable,
  accountsTable,
  accountingRolesTable,
  auditLogTable,
  journalEntriesTable,
  journalEntryLinesTable,
  invoicesTable,
  invoiceLinesTable,
  bookieOldArSettlementsTable,
  bookieOldApSettlementsTable,
  enoteTable,
  posBookingSettingsTable,
  companiesTable,
  bankStatementLinesTable,
  bankStatementsTable,
  bankAccountMetadataTable,
  paymentBatchesTable,
  paymentBatchItemsTable,
} from "@workspace/db";
import {
  CreatePaymentBody,
  VoidPaymentBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getLatestBankStatementBalance } from "../lib/bankStatementBalances";
import { buildSepaBatchXml, type SepaTransactionInstruction } from "./payments.sepa";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeIban(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function isValidIban(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function isRealIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidRfReference(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(normalized)) return false;
  let remainder = 0;
  for (const char of normalized.slice(4) + normalized.slice(0, 4)) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function sepaAgentXml(bic: string | null | undefined): string {
  const normalized = String(bic ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(normalized)
    ? `<FinInstnId><BIC>${xml(normalized)}</BIC></FinInstnId>`
    : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
}

/**
 * SŠP invoices are deliberately identified only by the POS sync's canonical
 * number.  Never derive an enota from a free-text description or reference.
 * Both daily and monthly POS bookings exist, hence the two date variants.
 */
function sspInvoiceIdentity(invoiceNumber: string): { unitId: number; dateToken: string } | null {
  const match = /^POS-SSP-(\d{4}-\d{2}(?:-\d{2})?)-E([1-9]\d*)$/.exec(invoiceNumber);
  if (!match) return null;
  const unitId = Number(match[2]);
  return Number.isSafeInteger(unitId) ? { unitId, dateToken: match[1] } : null;
}

function hasMatchingPosSalesReference(
  reference: string | null,
  identity: { unitId: number; dateToken: string },
): boolean {
  return reference === `POS:PRODAJA:${identity.dateToken}:E${identity.unitId}`;
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

/** Izračunaj vsoto poravnav za plačila */
async function calcAllocated(paymentIds: string[]): Promise<Map<string, number>> {
  if (paymentIds.length === 0) return new Map();
  const rows = await db
    .select({
      paymentId: paymentAllocationsTable.paymentId,
      total: sql<string>`SUM(${paymentAllocationsTable.allocatedAmount})`,
    })
    .from(paymentAllocationsTable)
    .where(inArray(paymentAllocationsTable.paymentId, paymentIds))
    .groupBy(paymentAllocationsTable.paymentId);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.paymentId, parseFloat(r.total ?? "0"));
  return map;
}

/** Pridobi polni zapis plačila z poravnavami */
async function fetchPaymentWithAllocations(paymentId: string) {
  const [pay] = await db
    .select({
      id: paymentsTable.id,
      companyId: paymentsTable.companyId,
      counterpartyId: paymentsTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      periodId: paymentsTable.periodId,
      periodName: accountingPeriodsTable.name,
      direction: paymentsTable.direction,
      paymentDate: paymentsTable.paymentDate,
      amount: paymentsTable.amount,
      reference: paymentsTable.reference,
      bankAccountId: paymentsTable.bankAccountId,
      bankAccountCode: accountsTable.code,
      bankAccountName: accountsTable.name,
      arApAccountId: paymentsTable.arApAccountId,
      status: paymentsTable.status,
      linkedEntryId: paymentsTable.linkedEntryId,
      notes: paymentsTable.notes,
      createdBy: paymentsTable.createdBy,
      createdAt: paymentsTable.createdAt,
      updatedAt: paymentsTable.updatedAt,
    })
    .from(paymentsTable)
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, paymentsTable.counterpartyId))
    .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, paymentsTable.periodId))
    .innerJoin(accountsTable, eq(accountsTable.id, paymentsTable.bankAccountId))
    .where(eq(paymentsTable.id, paymentId))
    .limit(1);

  if (!pay) return null;

  const allocRows = await db
    .select({
      id: paymentAllocationsTable.id,
      paymentId: paymentAllocationsTable.paymentId,
      invoiceId: paymentAllocationsTable.invoiceId,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      allocatedAmount: paymentAllocationsTable.allocatedAmount,
    })
    .from(paymentAllocationsTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, paymentAllocationsTable.invoiceId))
    .where(eq(paymentAllocationsTable.paymentId, paymentId))
    .orderBy(asc(invoicesTable.invoiceDate));

  const allocatedTotal = allocRows.reduce((s, r) => s + parseFloat(r.allocatedAmount), 0);
  const payAmount = parseFloat(pay.amount);

  return {
    ...pay,
    allocatedAmount: allocatedTotal.toFixed(2),
    unallocatedAmount: (payAmount - allocatedTotal).toFixed(2),
    allocations: allocRows,
  };
}

/** Posodobi statuse računov po poravnavi */
async function refreshInvoiceStatuses(
  tx: typeof db,
  invoiceIds: string[],
  asOfDate: string,
) {
  if (invoiceIds.length === 0) return;

  // Za vsak račun izračunaj skupaj poravnano in primerjaj z bruto zneskom
  for (const invoiceId of invoiceIds) {
    const [inv] = await (tx as typeof db)
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        companyId: invoicesTable.companyId,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);

    if (!inv || (inv.status !== "posted" && inv.status !== "paid")) continue;

    // Vsota vrstice računa (bruto)
    const [totRow] = await (tx as typeof db)
      .select({
        total: sql<string>`
          SUM(
            (${invoicesTable.id}::text = ${invoiceId}::text)::int *
            0
          )
        `,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);

    // Pridobi bruto iz vrstic računa
    const [grossRow] = await (tx as typeof db)
      .select({
        gross: sql<string>`
          COALESCE(SUM(
            COALESCE(
              ${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric,
              (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) +
              (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100)
            )
          ), 0)
        `,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoiceId));

    const gross = parseFloat(grossRow?.gross ?? "0");
    const closed = (await invoiceClosingTotals(inv.companyId, [invoiceId], asOfDate, tx as typeof db)).get(invoiceId) ?? 0;

    let newStatus: "posted" | "paid" = "posted";
    if (gross > 0 && closed >= gross - 0.005) {
      newStatus = "paid";
    }

    if (newStatus !== inv.status) {
      await (tx as typeof db)
        .update(invoicesTable)
        .set({ status: newStatus })
        .where(eq(invoicesTable.id, invoiceId));
    }
  }
}

// ─── GET /companies/:companyId/payments ───────────────────────────────────────
router.get(
  "/companies/:companyId/payments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { direction, status, counterpartyId, periodId, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [eq(paymentsTable.companyId, companyId)];
    if (direction) conditions.push(eq(paymentsTable.direction, direction as any));
    if (status) conditions.push(eq(paymentsTable.status, status as any));
    if (counterpartyId) conditions.push(eq(paymentsTable.counterpartyId, counterpartyId));
    if (periodId) conditions.push(eq(paymentsTable.periodId, periodId));
    if (dateFrom) conditions.push(gte(paymentsTable.paymentDate, dateFrom));
    if (dateTo) conditions.push(lte(paymentsTable.paymentDate, dateTo));

    const rows = await db
      .select({
        id: paymentsTable.id,
        companyId: paymentsTable.companyId,
        counterpartyId: paymentsTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        periodId: paymentsTable.periodId,
        periodName: accountingPeriodsTable.name,
        direction: paymentsTable.direction,
        paymentDate: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
        reference: paymentsTable.reference,
        bankAccountId: paymentsTable.bankAccountId,
        bankAccountCode: accountsTable.code,
        bankAccountName: accountsTable.name,
        arApAccountId: paymentsTable.arApAccountId,
        status: paymentsTable.status,
        linkedEntryId: paymentsTable.linkedEntryId,
        notes: paymentsTable.notes,
        createdBy: paymentsTable.createdBy,
        createdAt: paymentsTable.createdAt,
        updatedAt: paymentsTable.updatedAt,
      })
      .from(paymentsTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, paymentsTable.counterpartyId))
      .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, paymentsTable.periodId))
      .innerJoin(accountsTable, eq(accountsTable.id, paymentsTable.bankAccountId))
      .where(and(...conditions))
      .orderBy(asc(paymentsTable.paymentDate));

    const paymentIds = rows.map((r) => r.id);
    const allocMap = await calcAllocated(paymentIds);

    const payments = rows.map((p) => {
      const allocated = allocMap.get(p.id) ?? 0;
      const total = parseFloat(p.amount);
      return {
        ...p,
        allocatedAmount: allocated.toFixed(2),
        unallocatedAmount: (total - allocated).toFixed(2),
      };
    });

    res.json({ payments });
  },
);

// ─── POST /companies/:companyId/payments ──────────────────────────────────────
router.post(
  "/companies/:companyId/payments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje plačil potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreatePaymentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { counterpartyId, periodId, direction, amount, bankAccountId, arApAccountId, reference, notes, allocations } = parsed.data;
    const paymentDate = (parsed.data.paymentDate as unknown as Date).toISOString().slice(0, 10);
    // `force` is not in the Zod schema intentionally — it's an override flag for duplicate detection
    const force = (req.body as any).force === true;
    const bankStatementLineId = typeof (req.body as any).bankStatementLineId === "string"
      ? (req.body as any).bankStatementLineId
      : null;

    // ── Duplicate detection (server-side enforcement) ──────────────────────────
    // Reject if a draft or posted payment with the same company, direction,
    // date, and amount (within 1 cent) already exists — unless force=true.
    if (!force) {
      const normRef = (r: string | null | undefined): string | null => {
        if (!r) return null;
        const n = r.replace(/[\s-]/g, "").toUpperCase();
        return n || null;
      };
      const incomingRef = normRef(reference);

      // Pull candidate payments: same company, direction, date — narrow in SQL, final filter in JS
      const candidates = await db
        .select({
          id: paymentsTable.id,
          amount: paymentsTable.amount,
          reference: paymentsTable.reference,
        })
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.companyId, companyId),
            eq(paymentsTable.direction, direction),
            eq(paymentsTable.paymentDate, paymentDate),
            sql`${paymentsTable.status} IN ('draft', 'posted')`,
          ),
        );

      for (const cand of candidates) {
        const candAmt = parseFloat(cand.amount ?? "0");
        if (Math.abs(candAmt - amount) > 0.005) continue;
        const candRef = normRef(cand.reference);
        // If both sides have a reference and they differ → not a duplicate
        if (incomingRef && candRef && incomingRef !== candRef) continue;
        // Duplicate found
        res.status(409).json({
          error: `Plačilo z istim datumom (${paymentDate}), zneskom (${amount.toFixed(2)}) in sklicem že obstaja v sistemu. Za prisilni uvoz dodajte polje force: true.`,
          duplicateOf: { paymentId: cand.id },
        });
        return;
      }
    }

    // Validacije — company-scoped FK
    const [period] = await db.select({ id: accountingPeriodsTable.id })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (!period) { res.status(404).json({ error: "Obdobje ni najdeno" }); return; }

    const [counterparty] = await db.select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!counterparty) { res.status(404).json({ error: "Partner ni najden" }); return; }

    const [bankAcc] = await db.select({ id: accountsTable.id, code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, bankAccountId), eq(accountsTable.companyId, companyId)))
      .limit(1);
    if (!bankAcc) { res.status(400).json({ error: "Bančni konto ni najden ali ne pripada temu podjetju" }); return; }
    if (!bankAcc.isActive || bankAcc.allowsPosting === false) {
      res.status(400).json({ error: "Izbrani bančni konto ni aktiven ali ne dovoljuje knjiženja" });
      return;
    }
    if (bankStatementLineId) {
      const [statementLine] = await db.select({ id: bankStatementLinesTable.id })
        .from(bankStatementLinesTable)
        .innerJoin(bankStatementsTable, eq(bankStatementsTable.id, bankStatementLinesTable.statementId))
        .where(and(
          eq(bankStatementLinesTable.id, bankStatementLineId),
          eq(bankStatementsTable.companyId, companyId),
          eq(bankStatementsTable.bankAccountId, bankAccountId),
        ))
        .limit(1);
      if (!statementLine) {
        res.status(400).json({ error: "Vrstica bančnega izpiska ne pripada izbranemu podjetju ali bančnemu kontu" });
        return;
      }
    }
    if (direction === "outbound" && !bankStatementLineId) {
      if (!bankAcc.code.startsWith("110")) {
        res.status(400).json({ error: "Za izplačilo dobavitelju izberite bančni konto skupine 110" });
        return;
      }
      const balanceEvidence = await getLatestBankStatementBalance(companyId, bankAccountId);
      if (!balanceEvidence) {
        res.status(400).json({
          error: "Za izbrani TRR ni evidentiranega končnega stanja bančnega izpiska. Najprej evidentirajte izpisek s končnim stanjem.",
        });
        return;
      }
      const availableBalance = parseFloat(balanceEvidence.balance);
      if (amount > availableBalance + 0.005) {
        res.status(400).json({
          error: `Skupni znesek plačila (${amount.toFixed(2)}) presega zadnje evidentirano stanje izbranega TRR (${availableBalance.toFixed(2)}) na dan ${balanceEvidence.evidenceDate}`,
        });
        return;
      }
    }

    const [arApAcc] = await db.select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, arApAccountId), eq(accountsTable.companyId, companyId)))
      .limit(1);
    if (!arApAcc) { res.status(400).json({ error: "Konto terjatev/obveznosti ni najden ali ne pripada temu podjetju" }); return; }

    // Validacija poravnav
    if (allocations && allocations.length > 0) {
      if (new Set(allocations.map((allocation) => allocation.invoiceId)).size !== allocations.length) {
        res.status(400).json({ error: "Isti račun je lahko v posameznem plačilu izbran samo enkrat" });
        return;
      }
      const totalAllocated = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
      if (totalAllocated > amount + 0.005) {
        res.status(400).json({ error: `Vsota poravnav (${totalAllocated.toFixed(2)}) presega znesek plačila (${amount.toFixed(2)})` });
        return;
      }

      // Smer plačila določa tip računa: inbound→issued, outbound→received
      const expectedInvoiceType = direction === "inbound" ? "issued" : "received";

      // Pridobi vse račune z companyId, status, counterpartyId in type
      const invoiceIds = allocations.map((a) => a.invoiceId);
      const validInvoices = await db
        .select({
          id: invoicesTable.id,
          status: invoicesTable.status,
          counterpartyId: invoicesTable.counterpartyId,
          type: invoicesTable.type,
          invoiceNumber: invoicesTable.invoiceNumber,
          arApAccountId: invoicesTable.arApAccountId,
          linkedEntryId: invoicesTable.linkedEntryId,
        })
        .from(invoicesTable)
        .where(and(inArray(invoicesTable.id, invoiceIds), eq(invoicesTable.companyId, companyId)));

      // 1. Vsi morajo obstajati v tem podjetju
      if (validInvoices.length !== invoiceIds.length) {
        res.status(400).json({ error: "Eden ali več računov ne pripada temu podjetju" });
        return;
      }
      // 2. Vsi morajo biti knjiženi (posted ali paid)
      const nonPostable = validInvoices.filter((i) => i.status !== "posted" && i.status !== "paid");
      if (nonPostable.length > 0) {
        res.status(400).json({ error: "Poravnave je mogoče vnesti samo za knjižene račune" });
        return;
      }
      // 3. Vsi morajo biti istega partnerja kot plačilo
      const wrongCounterparty = validInvoices.filter((i) => i.counterpartyId !== counterpartyId);
      if (wrongCounterparty.length > 0) {
        res.status(400).json({ error: "Vsi poravnani računi morajo pripadati istemu partnerju kot plačilo" });
        return;
      }
      // 4. Tip računa mora ustrezati smeri plačila
      const wrongType = validInvoices.filter((i) => i.type !== expectedInvoiceType);
      if (wrongType.length > 0) {
        res.status(400).json({
          error: `Prejeto plačilo (inbound) je mogoče poravnati samo z izdanimi računi, izplačilo (outbound) samo s prejetimi`,
        });
        return;
      }
      // SŠP is a receivable to the configured public payer, never a discount.
      // Enforce the configured partner and receivable account even when callers
      // use the generic payment endpoint directly.
      const sspInvoices = validInvoices.filter((invoice) => sspInvoiceIdentity(invoice.invoiceNumber));
      if (sspInvoices.length > 0) {
        if (direction !== "inbound") {
          res.status(400).json({ error: "SŠP terjatve je mogoče poravnati samo s prejetim plačilom" });
          return;
        }
        const [settings] = await db
          .select({
            subsidyCounterpartyId: posBookingSettingsTable.subsidyCounterpartyId,
            subsidyReceivableAccountId: posBookingSettingsTable.subsidyReceivableAccountId,
          })
          .from(posBookingSettingsTable)
          .where(eq(posBookingSettingsTable.companyId, companyId))
          .limit(1);
        if (!settings?.subsidyCounterpartyId || !settings.subsidyReceivableAccountId) {
          res.status(400).json({ error: "SŠP nastavitve partnerja ali konta terjatev niso konfigurirane" });
          return;
        }
        const linkedEntryIds = sspInvoices.flatMap((invoice) => invoice.linkedEntryId ? [invoice.linkedEntryId] : []);
        const linkedEntries = linkedEntryIds.length === 0 ? [] : await db
          .select({
            id: journalEntriesTable.id,
            status: journalEntriesTable.status,
            reference: journalEntriesTable.reference,
          })
          .from(journalEntriesTable)
          .where(and(
            eq(journalEntriesTable.companyId, companyId),
            inArray(journalEntriesTable.id, linkedEntryIds),
          ));
        const linkedEntryMap = new Map(linkedEntries.map((entry) => [entry.id, entry]));
        const invalidSsp = sspInvoices.some((invoice) =>
          invoice.counterpartyId !== settings.subsidyCounterpartyId ||
          invoice.arApAccountId !== settings.subsidyReceivableAccountId ||
          invoice.linkedEntryId === null ||
          linkedEntryMap.get(invoice.linkedEntryId)?.status !== "posted" ||
          !hasMatchingPosSalesReference(
            linkedEntryMap.get(invoice.linkedEntryId)?.reference ?? null,
            sspInvoiceIdentity(invoice.invoiceNumber)!,
          ),
        );
        const validSspBankAccount = bankAcc.code.startsWith("11") || bankAcc.code.startsWith("22");
        if (
          invalidSsp ||
          !validSspBankAccount ||
          counterpartyId !== settings.subsidyCounterpartyId ||
          arApAccountId !== settings.subsidyReceivableAccountId
        ) {
          res.status(400).json({ error: "SŠP plačilo mora uporabiti konfiguriranega partnerja, konto terjatev in bančni ali blagajniški konto" });
          return;
        }
      }
      // 5. Poravnava po posameznem računu ne sme preseči preostalega odprtega zneska
      // Pridobi trenutno že poravnane zneske iz posted plačil
      // Pridobi bruto znesek za vsak račun
      const grossRows = await db
        .select({
          invoiceId: invoiceLinesTable.invoiceId,
          gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
        })
        .from(invoiceLinesTable)
        .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
        .groupBy(invoiceLinesTable.invoiceId);
      const grossMap = new Map(grossRows.map((r) => [r.invoiceId, parseFloat(r.gross ?? "0")]));
      const closures = await invoiceClosingTotals(companyId, invoiceIds, paymentDate);

      for (const alloc of allocations) {
        const gross = grossMap.get(alloc.invoiceId) ?? 0;
        const remaining = gross - (closures.get(alloc.invoiceId) ?? 0);
        if (alloc.allocatedAmount > remaining + 0.005) {
          res.status(400).json({
            error: `Poravnava (${alloc.allocatedAmount.toFixed(2)}) presega preostali odprti znesek računa (${remaining.toFixed(2)})`,
          });
          return;
        }
      }
    }

    const paymentId = await db.transaction(async (tx) => {
      const [newPay] = await tx.insert(paymentsTable).values({
        companyId,
        counterpartyId,
        periodId,
        direction,
        paymentDate,
        amount: amount.toFixed(2),
        reference: reference ?? null,
        bankAccountId,
        arApAccountId,
        notes: notes ?? null,
        bankStatementLineId,
        createdBy: authReq.clerkUserId,
      }).returning({ id: paymentsTable.id });

      if (allocations && allocations.length > 0) {
        await tx.insert(paymentAllocationsTable).values(
          allocations.map((a) => ({
            paymentId: newPay.id,
            invoiceId: a.invoiceId,
            allocatedAmount: a.allocatedAmount.toFixed(2),
          })),
        );
      }

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "payment",
        entityId: newPay.id,
        action: "create",
        changedBy: authReq.clerkUserId,
        payload: { direction, amount, allocationCount: allocations?.length ?? 0 },
      });

      return newPay.id;
    });

    const result = await fetchPaymentWithAllocations(paymentId);
    res.status(201).json(result);
  },
);

// ─── GET /companies/:companyId/payments/:id ───────────────────────────────────
router.get(
  "/companies/:companyId/payments/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [check] = await db.select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, companyId)))
      .limit(1);
    if (!check) { res.status(404).json({ error: "Plačilo ni najdeno" }); return; }

    const result = await fetchPaymentWithAllocations(id);
    res.json(result);
  },
);

// ─── GET /companies/:companyId/payments/:id/sepa.xml ──────────────────────────
router.get(
  "/companies/:companyId/payments/:id/sepa.xml",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za izvoz plačil potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [row] = await db
      .select({
        status: paymentsTable.status,
        bankAccountId: paymentsTable.bankAccountId,
        direction: paymentsTable.direction,
        paymentDate: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
        reference: paymentsTable.reference,
        notes: paymentsTable.notes,
        companyName: companiesTable.naziv,
        creditorName: counterpartiesTable.name,
        creditorIban: counterpartiesTable.iban,
        creditorTrr: counterpartiesTable.trr,
        creditorBic: counterpartiesTable.eRacunBic,
      })
      .from(paymentsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, paymentsTable.companyId))
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, paymentsTable.counterpartyId))
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, companyId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Plačilo ni najdeno" }); return; }
    if (row.direction !== "outbound") { res.status(400).json({ error: "SEPA nalog je mogoče izvoziti samo za izplačilo" }); return; }
    if (row.status !== "draft") { res.status(400).json({ error: "SEPA nalog je mogoče izvoziti samo iz osnutka plačila" }); return; }

    const invoiceInstructions = await db
      .select({
        invoiceNumber: invoicesTable.invoiceNumber,
        destinationIban: invoicesTable.destinationIban,
        destinationBic: invoicesTable.destinationBic,
        paymentModel: invoicesTable.paymentModel,
        paymentReference: invoicesTable.paymentReference,
        paymentPurpose: invoicesTable.paymentPurpose,
      })
      .from(paymentAllocationsTable)
      .innerJoin(invoicesTable, and(
        eq(invoicesTable.id, paymentAllocationsTable.invoiceId),
        eq(invoicesTable.companyId, companyId),
      ))
      .where(eq(paymentAllocationsTable.paymentId, id));
    const invoiceIbans = [...new Set(
      invoiceInstructions.map((item) => normalizeIban(item.destinationIban)).filter(Boolean),
    )];
    if (invoiceIbans.length > 1) {
      res.status(400).json({
        error: "Povezani računi imajo različne TRR-je za plačilo. Ustvarite ločeno plačilo za vsak ciljni TRR.",
      });
      return;
    }

    const [debtor] = await db.select({
      iban: bankAccountMetadataTable.iban,
      bic: bankAccountMetadataTable.bic,
      sepaProfile: bankAccountMetadataTable.sepaProfile,
    }).from(bankAccountMetadataTable).where(and(
      eq(bankAccountMetadataTable.companyId, companyId),
      eq(bankAccountMetadataTable.bankAccountId, row.bankAccountId),
    )).limit(1);
    const creditor = row.creditorTrr?.[0];
    const debtorIban = normalizeIban(debtor?.iban);
    if (debtor?.sepaProfile !== "pain.001.001.03") { res.status(400).json({ error: "Nepodprt SEPA profil za izbrani bančni konto" }); return; }
    const creditorIban = invoiceIbans[0] || normalizeIban(row.creditorIban || creditor?.iban);
    const invoiceBic = invoiceInstructions.find((item) => normalizeIban(item.destinationIban) === creditorIban)?.destinationBic;
    if (!isValidIban(debtorIban)) { res.status(400).json({ error: "Za izbrani bančni konto ni nastavljen veljaven IBAN" }); return; }
    if (!isValidIban(creditorIban)) { res.status(400).json({ error: "Dobavitelj nima veljavnega IBAN-a" }); return; }

    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "Znesek plačila ni veljaven" }); return; }
    const amountText = amount.toFixed(2);
    const messageId = `BOOKIE-${id.replaceAll("-", "").slice(0, 28)}`;
    const invoiceReferences = [...new Set(invoiceInstructions.map((item) => {
      const reference = item.paymentReference || item.invoiceNumber;
      return [item.paymentModel, reference].filter(Boolean).join(" ");
    }).filter(Boolean))].join("; ");
    const invoicePurposes = [...new Set(invoiceInstructions.map((item) => item.paymentPurpose).filter(Boolean))].join("; ");
    const purpose = ([invoiceReferences, invoicePurposes, row.notes, row.reference].filter(Boolean).join("; ") || `Plačilo ${row.creditorName}`).slice(0, 140);
    const rfReference = invoiceInstructions.map(item => item.paymentReference).find(reference =>
      Boolean(reference && isValidRfReference(reference)),
    );
    const remittanceXml = rfReference
      ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${xml(rfReference.replace(/\s+/g, "").toUpperCase())}</Ref></CdtrRefInf>${invoicePurposes ? `<AddtlRmtInf>${xml(invoicePurposes.slice(0, 140))}</AddtlRmtInf>` : ""}</Strd>`
      : `<Ustrd>${xml(purpose)}</Ustrd>`;
    const document = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr><MsgId>${xml(messageId)}</MsgId><CreDtTm>${xml(new Date().toISOString())}</CreDtTm><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum><InitgPty><Nm>${xml(row.companyName)}</Nm></InitgPty></GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(messageId)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${xml(row.paymentDate)}</ReqdExctnDt>
      <Dbtr><Nm>${xml(row.companyName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct><DbtrAgt>${sepaAgentXml(debtor?.bic)}</DbtrAgt><ChrgBr>SLEV</ChrgBr>
      <CdtTrfTxInf><PmtId><EndToEndId>NOTPROVIDED</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amountText}</InstdAmt></Amt><CdtrAgt>${sepaAgentXml(invoiceBic || row.creditorBic || creditor?.bic)}</CdtrAgt><Cdtr><Nm>${xml(row.creditorName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${creditorIban}</IBAN></Id></CdtrAcct><RmtInf>${remittanceXml}</RmtInf></CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="SEPA-${id.slice(0, 8)}.xml"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(document);
  },
);

// ─── POST /companies/:companyId/payments/:id/post ─────────────────────────────
router.post(
  "/companies/:companyId/payments/:id/post",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za knjiženje plačil potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [payment] = await db
      .select({
        id: paymentsTable.id,
        status: paymentsTable.status,
        direction: paymentsTable.direction,
        periodId: paymentsTable.periodId,
        paymentDate: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
        bankAccountId: paymentsTable.bankAccountId,
        arApAccountId: paymentsTable.arApAccountId,
        reference: paymentsTable.reference,
        counterpartyId: paymentsTable.counterpartyId,
      })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, companyId)))
      .limit(1);

    if (!payment) { res.status(404).json({ error: "Plačilo ni najdeno" }); return; }
    if (payment.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke plačil je mogoče knjižiti" });
      return;
    }

    const [period] = await db.select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.id, payment.periodId))
      .limit(1);
    if (period?.status === "locked") {
      res.status(400).json({ error: "Obdobje je zaklenjeno" });
      return;
    }

    const [counterparty] = await db.select({ name: counterpartiesTable.name })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, payment.counterpartyId))
      .limit(1);

    const amount = parseFloat(payment.amount);
    const description = `${payment.direction === "inbound" ? "Prejeto plačilo" : "Izplačilo"} — ${counterparty?.name ?? ""}${payment.reference ? ` (${payment.reference})` : ""}`;

    // Temeljnica:
    // inbound:  DEBIT banka ← amount, CREDIT terjatve ← amount
    // outbound: DEBIT obveznosti ← amount, CREDIT banka ← amount
    const journalLines =
      payment.direction === "inbound"
        ? [
            { accountId: payment.bankAccountId, side: "debit" as const, amount: amount.toFixed(2), description },
            { accountId: payment.arApAccountId, side: "credit" as const, amount: amount.toFixed(2), description, partnerId: payment.counterpartyId },
          ]
        : [
            { accountId: payment.arApAccountId, side: "debit" as const, amount: amount.toFixed(2), description, partnerId: payment.counterpartyId },
            { accountId: payment.bankAccountId, side: "credit" as const, amount: amount.toFixed(2), description },
          ];

    // Vse v eni transakciji:
    // 1. Zakleni plačilo + račune z FOR UPDATE (prepreči race condition)
    // 2. Revalidira poravnave (partner, tip, odprti zneski) znotraj transakcije
    // 3. Ustvari temeljnico, posodobi statuse računov in plačila atomično
    let allocatedInvoiceIds: string[] = [];

    try {
    await db.transaction(async (tx) => {
      // Zakleni to plačilo
      const [lockedPayment] = await tx
        .select({ id: paymentsTable.id, status: paymentsTable.status })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, companyId)))
        .for("update")
        .limit(1);

      if (!lockedPayment || lockedPayment.status !== "draft") {
        throw Object.assign(new Error("Samo osnutke plačil je mogoče knjižiti"), { statusCode: 400 });
      }

      // Pridobi poravnave tega plačila
      const allocsToPost = await tx
        .select({
          invoiceId: paymentAllocationsTable.invoiceId,
          allocatedAmount: paymentAllocationsTable.allocatedAmount,
        })
        .from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.paymentId, id));

      if (allocsToPost.length > 0) {
        const invoiceIds = allocsToPost.map((a) => a.invoiceId);
        allocatedInvoiceIds = invoiceIds;
        const expectedInvoiceType = payment.direction === "inbound" ? "issued" : "received";

        // Zakleni vse račune, ki jih poravnavamo (FOR UPDATE prepreči konkurenčne spremembe)
        const lockedInvoices = await tx
          .select({
            id: invoicesTable.id,
            counterpartyId: invoicesTable.counterpartyId,
            type: invoicesTable.type,
            status: invoicesTable.status,
            invoiceNumber: invoicesTable.invoiceNumber,
            arApAccountId: invoicesTable.arApAccountId,
            linkedEntryId: invoicesTable.linkedEntryId,
          })
          .from(invoicesTable)
          .where(and(inArray(invoicesTable.id, invoiceIds), eq(invoicesTable.companyId, companyId)))
          .for("update");

        if (lockedInvoices.length !== invoiceIds.length) {
          throw Object.assign(new Error("Poravnani račun(i) ne obstajajo v tem podjetju"), { statusCode: 400 });
        }
        for (const inv of lockedInvoices) {
          if (inv.counterpartyId !== payment.counterpartyId) {
            throw Object.assign(new Error("Poravnava vsebuje račun drugega partnerja"), { statusCode: 400 });
          }
          if (inv.type !== expectedInvoiceType) {
            throw Object.assign(new Error("Tip računa ne ustreza smeri plačila"), { statusCode: 400 });
          }
          if (inv.status !== "posted" && inv.status !== "paid") {
            throw Object.assign(new Error("Poravnava vsebuje neknjiženi račun"), { statusCode: 400 });
          }
        }
        const sspInvoices = lockedInvoices.filter((invoice) => sspInvoiceIdentity(invoice.invoiceNumber));
        if (sspInvoices.length > 0) {
          const [settings] = await tx
            .select({
              subsidyCounterpartyId: posBookingSettingsTable.subsidyCounterpartyId,
              subsidyReceivableAccountId: posBookingSettingsTable.subsidyReceivableAccountId,
            })
            .from(posBookingSettingsTable)
            .where(eq(posBookingSettingsTable.companyId, companyId))
            .limit(1);
          const linkedEntryIds = sspInvoices.flatMap((invoice) => invoice.linkedEntryId ? [invoice.linkedEntryId] : []);
          const linkedEntries = linkedEntryIds.length === 0 ? [] : await tx
            .select({
              id: journalEntriesTable.id,
              status: journalEntriesTable.status,
              reference: journalEntriesTable.reference,
            })
            .from(journalEntriesTable)
            .where(and(
              eq(journalEntriesTable.companyId, companyId),
              inArray(journalEntriesTable.id, linkedEntryIds),
            ))
            .for("update");
          const linkedEntryMap = new Map(linkedEntries.map((entry) => [entry.id, entry]));
          const [bankAccount] = await tx
            .select({ code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
            .from(accountsTable)
            .where(and(eq(accountsTable.id, payment.bankAccountId), eq(accountsTable.companyId, companyId)))
            .limit(1);
          const validSspBankAccount = Boolean(bankAccount?.isActive) &&
            bankAccount?.allowsPosting !== false &&
            (bankAccount.code.startsWith("11") || bankAccount.code.startsWith("22"));
          if (
            payment.direction !== "inbound" ||
            !settings?.subsidyCounterpartyId ||
            !settings.subsidyReceivableAccountId ||
            !validSspBankAccount ||
            payment.counterpartyId !== settings.subsidyCounterpartyId ||
            payment.arApAccountId !== settings.subsidyReceivableAccountId ||
            sspInvoices.some((invoice) =>
              invoice.counterpartyId !== settings.subsidyCounterpartyId ||
              invoice.arApAccountId !== settings.subsidyReceivableAccountId ||
              invoice.linkedEntryId === null ||
              linkedEntryMap.get(invoice.linkedEntryId)?.status !== "posted" ||
              !hasMatchingPosSalesReference(
                linkedEntryMap.get(invoice.linkedEntryId)?.reference ?? null,
                sspInvoiceIdentity(invoice.invoiceNumber)!,
              ),
            )
          ) {
            throw Object.assign(new Error("SŠP plačilo mora knjižiti v dobro konfiguriranega konta terjatev"), { statusCode: 400 });
          }
        }

        // Reizračunaj preostale odprte zneske znotraj transakcije (na zaklenjenih vrsticah)
        // Bruto zneski računov
        const grossRows = await tx
          .select({
            invoiceId: invoiceLinesTable.invoiceId,
            gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
          })
          .from(invoiceLinesTable)
          .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
          .groupBy(invoiceLinesTable.invoiceId);
        const grossMap = new Map(grossRows.map((r) => [r.invoiceId, parseFloat(r.gross ?? "0")]));
        const closures = await invoiceClosingTotals(companyId, invoiceIds, payment.paymentDate, tx as unknown as typeof db);

        for (const alloc of allocsToPost) {
          const gross = grossMap.get(alloc.invoiceId) ?? 0;
          const alreadyAllocated = closures.get(alloc.invoiceId) ?? 0;
          const remaining = gross - alreadyAllocated;
          const thisAlloc = parseFloat(alloc.allocatedAmount);
          if (thisAlloc > remaining + 0.005) {
            throw Object.assign(
              new Error(`Poravnava (${thisAlloc.toFixed(2)}) presega preostali odprti znesek računa (${remaining.toFixed(2)}). Račun je bil medtem poravnan z drugim plačilom.`),
              { statusCode: 400 },
            );
          }
        }

        // Posodobi statuse računov znotraj iste transakcije
        for (const inv of lockedInvoices) {
          const gross = grossMap.get(inv.id) ?? 0;
          const alreadyAllocated = closures.get(inv.id) ?? 0;
          const thisAlloc = parseFloat(allocsToPost.find((a) => a.invoiceId === inv.id)?.allocatedAmount ?? "0");
          const totalAllocated = alreadyAllocated + thisAlloc;
          const newStatus: "posted" | "paid" = gross > 0 && totalAllocated >= gross - 0.005 ? "paid" : "posted";
          if (newStatus !== inv.status) {
            await tx.update(invoicesTable).set({ status: newStatus }).where(eq(invoicesTable.id, inv.id));
          }
        }
      }

      // Ustvari temeljnico
      const [entry] = await tx.insert(journalEntriesTable).values({
        companyId,
        periodId: payment.periodId,
        entryDate: payment.paymentDate,
        description,
        reference: payment.reference ?? null,
        status: "posted",
        createdBy: authReq.clerkUserId,
      }).returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values(
        journalLines.map((l, i) => ({
          entryId: entry.id,
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          description: l.description,
          sequence: i,
          partnerId: l.partnerId ?? null,
        })),
      );

      await tx.update(paymentsTable)
        .set({ status: "posted", linkedEntryId: entry.id })
        .where(eq(paymentsTable.id, id));

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "payment",
        entityId: id,
        action: "post",
        changedBy: authReq.clerkUserId,
        payload: { linkedEntryId: entry.id },
      });
    });
    } catch (err: any) {
      // Poslovne napake iz transakcije (z lastnostjo statusCode) → 400
      if (err?.statusCode === 400) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err; // nepričakovane napake → 500
    }

    const result = await fetchPaymentWithAllocations(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/payments/:id/void ─────────────────────────────
router.post(
  "/companies/:companyId/payments/:id/void",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za razveljavitev plačil potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = VoidPaymentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [payment] = await db
      .select({
        id: paymentsTable.id,
        status: paymentsTable.status,
        periodId: paymentsTable.periodId,
        paymentDate: paymentsTable.paymentDate,
        linkedEntryId: paymentsTable.linkedEntryId,
        reference: paymentsTable.reference,
      })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.companyId, companyId)))
      .limit(1);

    if (!payment) { res.status(404).json({ error: "Plačilo ni najdeno" }); return; }
    if (payment.status !== "posted") {
      res.status(400).json({ error: "Samo knjižena plačila je mogoče razveljaviti" });
      return;
    }

    const targetPeriodId = parsed.data.periodId ?? payment.periodId;
    const [targetPeriod] = await db.select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, targetPeriodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (targetPeriod?.status === "locked") {
      res.status(400).json({ error: "Ciljno obdobje je zaklenjeno" });
      return;
    }

    const allocs = await db
      .select({ invoiceId: paymentAllocationsTable.invoiceId })
      .from(paymentAllocationsTable)
      .where(eq(paymentAllocationsTable.paymentId, id));

    if (payment.linkedEntryId) {
      const origLines = await db
        .select({
          accountId: journalEntryLinesTable.accountId,
          side: journalEntryLinesTable.side,
          amount: journalEntryLinesTable.amount,
          description: journalEntryLinesTable.description,
          sequence: journalEntryLinesTable.sequence,
          partnerId: journalEntryLinesTable.partnerId,
        })
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, payment.linkedEntryId))
        .orderBy(asc(journalEntryLinesTable.sequence));

      await db.transaction(async (tx) => {
        const [reversalEntry] = await tx.insert(journalEntriesTable).values({
          companyId,
          periodId: targetPeriodId,
          entryDate: new Date().toISOString().slice(0, 10),
          description: `STORNO plačila${payment.reference ? ` (${payment.reference})` : ""}`,
          reference: payment.reference ?? null,
          status: "posted",
          reversalOf: payment.linkedEntryId!,
          createdBy: authReq.clerkUserId,
        }).returning({ id: journalEntriesTable.id });

        await tx.insert(journalEntryLinesTable).values(
          origLines.map((l) => ({
            entryId: reversalEntry.id,
            accountId: l.accountId,
            side: l.side === "debit" ? ("credit" as const) : ("debit" as const),
            amount: l.amount,
            description: l.description,
            sequence: l.sequence,
            partnerId: l.partnerId,
          })),
        );

        await tx.update(journalEntriesTable)
          .set({ status: "reversed" })
          .where(eq(journalEntriesTable.id, payment.linkedEntryId!));

        await tx.update(paymentsTable)
          .set({ status: "void" })
          .where(eq(paymentsTable.id, id));

        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "payment",
          entityId: id,
          action: "void",
          changedBy: authReq.clerkUserId,
          payload: { reason: parsed.data.reason },
        });
      });
    } else {
      await db.transaction(async (tx) => {
        await tx.update(paymentsTable).set({ status: "void" }).where(eq(paymentsTable.id, id));
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "payment",
          entityId: id,
          action: "void",
          changedBy: authReq.clerkUserId,
          payload: { reason: parsed.data.reason },
        });
      });
    }

    // Povrni statuse računov na "posted" (poravnave ostanejo, a plačilo je razveljavljen)
    if (allocs.length > 0) {
      const invoiceIds = allocs.map((a) => a.invoiceId);
      // Računi z dovolj poravnavami iz ДРУГИХ plačil ostanejo paid, ostali se vrnejo na posted
      await db.transaction(async (tx) => {
        await refreshInvoiceStatuses(tx as any, invoiceIds, payment.paymentDate);
      });
    }

    const result = await fetchPaymentWithAllocations(id);
    res.json(result);
  },
);

// ─── Payment batches: safe packaging from saved drafts ───────────────────────
router.get("/companies/:companyId/payment-batches", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = extractParam(req.params.companyId);
  const access = await resolveAccess(authReq.clerkUserId, companyId, res);
  if (!access) return;
  const batches = await db.select({
    id: paymentBatchesTable.id,
    bankAccountId: paymentBatchesTable.bankAccountId,
    executionDate: paymentBatchesTable.executionDate,
    status: paymentBatchesTable.status,
    transactionCount: paymentBatchesTable.transactionCount,
    controlSum: paymentBatchesTable.controlSum,
    exportedAt: paymentBatchesTable.exportedAt,
    createdAt: paymentBatchesTable.createdAt,
  }).from(paymentBatchesTable).where(eq(paymentBatchesTable.companyId, companyId));
  res.json({ batches });
});

router.get("/companies/:companyId/payment-batches/:batchId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = extractParam(req.params.companyId);
  const batchId = extractParam(req.params.batchId);
  const access = await resolveAccess(authReq.clerkUserId, companyId, res);
  if (!access) return;
  const [batch] = await db.select().from(paymentBatchesTable).where(and(
    eq(paymentBatchesTable.id, batchId), eq(paymentBatchesTable.companyId, companyId),
  )).limit(1);
  if (!batch) { res.status(404).json({ error: "Plačilni paket ni najden" }); return; }
  const items = await db.select({
    paymentId: paymentBatchItemsTable.paymentId,
    instruction: paymentBatchItemsTable.instruction,
    lifecycleStatus: paymentBatchItemsTable.lifecycleStatus,
    resolutionReason: paymentBatchItemsTable.resolutionReason,
    resolvedBy: paymentBatchItemsTable.resolvedBy,
    resolvedAt: paymentBatchItemsTable.resolvedAt,
    releasedAt: paymentBatchItemsTable.releasedAt,
  }).from(paymentBatchItemsTable).where(eq(paymentBatchItemsTable.batchId, batchId));
  res.json({ ...batch, items });
});

router.post("/companies/:companyId/payment-batches/:batchId/lifecycle", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = extractParam(req.params.companyId);
  const batchId = extractParam(req.params.batchId);
  const access = await resolveAccess(authReq.clerkUserId, companyId, res);
  if (!access) return;
  if (access.role === "viewer") { res.status(403).json({ error: "Za spremembo življenjskega cikla potrebujete računovodsko vlogo" }); return; }
  const action = req.body?.action;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const suppliedIds: string[] | undefined = Array.isArray(req.body?.paymentIds) ? req.body.paymentIds : undefined;
  const confirmExportedRisk = req.body?.confirmExportedRisk === true;
  if ((action !== "cancel" && action !== "reject") || !reason || reason.length > 1000) {
    res.status(400).json({ error: "action mora biti cancel/reject, razlog pa 1–1000 znakov" }); return;
  }
  if (suppliedIds && (suppliedIds.some(id => typeof id !== "string") || new Set(suppliedIds).size !== suppliedIds.length)) {
    res.status(400).json({ error: "paymentIds mora vsebovati samo enolične identifikatorje plačil" }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      const [batch] = await tx.select().from(paymentBatchesTable).where(and(
        eq(paymentBatchesTable.id, batchId), eq(paymentBatchesTable.companyId, companyId),
      )).for("update").limit(1);
      if (!batch) throw Object.assign(new Error("Plačilni paket ni najden"), { status: 404 });
      const wasExported = Boolean(batch.exportedAt || batch.xmlSnapshot);
      if (wasExported && !confirmExportedRisk) {
        throw Object.assign(new Error("Paket je bil izvožen; banka je morda že prejela nalog. Pred preklicem/zavrnitvijo izrecno potrdite tveganje dvojne izvedbe."), {
          status: 409,
          confirmationRequired: true,
          warning: "Lokalni preklic ne prekliče že uvoženega bančnega naloga; preverite ali ga prekličite tudi pri banki.",
        });
      }
      const isPartiallyExecuted = batch.status === "partially_executed";
      if (!isPartiallyExecuted && batch.status !== "ready" && batch.status !== "exported") {
        throw Object.assign(new Error("Paket ni več v stanju, ki ga je mogoče preklicati ali zavrniti"), { status: 409 });
      }
      if (isPartiallyExecuted && (!suppliedIds || suppliedIds.length === 0)) {
        throw Object.assign(new Error("Pri delno izvedenem paketu navedite samo še neizvedene paymentIds; izvedeni del ostane nespremenjen"), { status: 400 });
      }
      const rows = await tx.select({
        itemId: paymentBatchItemsTable.id,
        paymentId: paymentBatchItemsTable.paymentId,
        lifecycleStatus: paymentBatchItemsTable.lifecycleStatus,
        releasedAt: paymentBatchItemsTable.releasedAt,
        paymentCompanyId: paymentsTable.companyId,
        paymentStatus: paymentsTable.status,
        bankStatementLineId: paymentsTable.bankStatementLineId,
      }).from(paymentBatchItemsTable).innerJoin(paymentsTable, eq(paymentsTable.id, paymentBatchItemsTable.paymentId))
        .where(and(
          eq(paymentBatchItemsTable.batchId, batchId),
          isNull(paymentBatchItemsTable.releasedAt),
          ...(isPartiallyExecuted ? [inArray(paymentBatchItemsTable.paymentId, suppliedIds!)] : []),
        )).for("update");
      if (!rows.length) throw Object.assign(new Error("Paket nima več navodil, ki jih je mogoče razrešiti"), { status: 409 });
      if (isPartiallyExecuted && rows.length !== suppliedIds!.length) {
        throw Object.assign(new Error("Ena ali več izbranih navodil ne pripada več aktivnemu delu paketa"), { status: 409 });
      }
      if (rows.some(row => row.paymentCompanyId !== companyId
        || row.lifecycleStatus !== "ready" || row.paymentStatus !== "draft" || row.bankStatementLineId !== null)) {
        throw Object.assign(new Error("Izvesti je mogoče samo neizvedena navodila z osnutkom brez povezane bančne vrstice"), { status: 409 });
      }
      if (!isPartiallyExecuted && suppliedIds
        && (suppliedIds.length !== rows.length || rows.some(row => !suppliedIds.includes(row.paymentId)))) {
        throw Object.assign(new Error("Pri neizvedenem paketu je mogoče preklicati/zavrniti samo celoten paket"), { status: 400 });
      }
      const resolvedAt = new Date();
      const itemIds = rows.map(row => row.itemId);
      await tx.update(paymentBatchItemsTable).set({
        lifecycleStatus: action === "cancel" ? "cancelled" : "rejected",
        resolutionReason: reason,
        resolvedBy: authReq.clerkUserId,
        resolvedAt,
        releasedAt: resolvedAt,
      }).where(inArray(paymentBatchItemsTable.id, itemIds));
      const batchStatus = isPartiallyExecuted ? "partially_executed" : action === "cancel" ? "cancelled" : "rejected";
      if (!isPartiallyExecuted) {
        await tx.update(paymentBatchesTable).set({ status: batchStatus }).where(eq(paymentBatchesTable.id, batchId));
      }
      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "payment_batch",
        entityId: batchId,
        action,
        changedBy: authReq.clerkUserId,
        payload: {
          reason,
          paymentIds: rows.map(row => row.paymentId),
          exported: wasExported,
          exportedRiskConfirmed: confirmExportedRisk,
          monetaryReversal: false,
        },
      });
      return {
        batchId,
        status: batchStatus,
        paymentIds: rows.map(row => row.paymentId),
        releasedForRepackaging: rows.map(row => row.paymentId),
        reason,
        exportedWarning: wasExported
          ? "Lokalni preklic ne prekliče že uvoženega bančnega naloga; preverite ali ga prekličite tudi pri banki."
          : null,
        monetaryReversal: false,
      };
    });
    res.json(result);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({
        error: error.message,
        ...(error.confirmationRequired ? { confirmationRequired: true, warning: error.warning } : {}),
      });
      return;
    }
    throw error;
  }
});

router.post("/companies/:companyId/payment-batches", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = extractParam(req.params.companyId);
  const access = await resolveAccess(authReq.clerkUserId, companyId, res);
  if (!access) return;
  if (access.role === "viewer") { res.status(403).json({ error: "Za pripravo paketov potrebujete računovodsko vlogo" }); return; }
  const bankAccountId = req.body?.bankAccountId;
  const paymentIds: string[] | undefined = Array.isArray(req.body?.paymentIds) ? req.body.paymentIds : undefined;
  const proposedPayments: Array<{
    counterpartyId: string;
    arApAccountId: string;
    allocations: Array<{ invoiceId: string; amount: number }>;
  }> | undefined = Array.isArray(req.body?.proposedPayments) ? req.body.proposedPayments : undefined;
  const periodId: string | undefined = req.body?.periodId;
  const paymentDate: string | undefined = req.body?.paymentDate;
  const cutoffDate: string | undefined = req.body?.cutoffDate;
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  const savedMode = Boolean(paymentIds);
  const directMode = Boolean(proposedPayments);
  if (typeof bankAccountId !== "string" || savedMode === directMode || !idempotencyKey || idempotencyKey.length > 128) {
    res.status(400).json({ error: "Izberite natanko en način: paymentIds za osnutke ali proposedPayments za atomsko pripravo; bankAccountId in idempotencyKey sta obvezna" }); return;
  }
  let canonicalRequest: string;
  if (savedMode) {
    if (paymentIds!.length < 1 || paymentIds!.length > 500 || paymentIds!.some(id => typeof id !== "string")
      || new Set(paymentIds!).size !== paymentIds!.length) {
      res.status(400).json({ error: "paymentIds mora vsebovati 1–500 različnih osnutkov" }); return;
    }
    canonicalRequest = JSON.stringify({ mode: "saved", bankAccountId, paymentIds: [...paymentIds!].sort() });
  } else {
    if (proposedPayments!.length < 1 || proposedPayments!.length > 500
      || !periodId || !isRealIsoDate(paymentDate)
      || (cutoffDate != null && (typeof cutoffDate !== "string" || !isRealIsoDate(cutoffDate)))) {
      res.status(400).json({ error: "Nepopoln datum, obdobje ali seznam predlaganih plačil" }); return;
    }
    const canonicalGroups = proposedPayments!.map(group => ({
      counterpartyId: group?.counterpartyId,
      arApAccountId: group?.arApAccountId,
      allocations: Array.isArray(group?.allocations)
        ? group.allocations.map(allocation => ({ invoiceId: allocation?.invoiceId, amount: allocation?.amount })).sort((a, b) => String(a.invoiceId).localeCompare(String(b.invoiceId)))
        : group?.allocations,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    canonicalRequest = JSON.stringify({ mode: "direct", bankAccountId, periodId, paymentDate, cutoffDate: cutoffDate ?? null, proposedPayments: canonicalGroups });
  }
  const requestFingerprint = createHash("sha256").update(canonicalRequest).digest("hex");
  const [existing] = await db.select().from(paymentBatchesTable).where(and(
    eq(paymentBatchesTable.companyId, companyId),
    eq(paymentBatchesTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing) {
    const rows = await db.select({ paymentId: paymentBatchItemsTable.paymentId }).from(paymentBatchItemsTable)
      .where(eq(paymentBatchItemsTable.batchId, existing.id));
    if (existing.bankAccountId !== bankAccountId || (existing.requestFingerprint
      ? existing.requestFingerprint !== requestFingerprint
      : !savedMode || rows.map(row => row.paymentId).sort().join(",") !== [...paymentIds!].sort().join(","))) {
      res.status(409).json({ error: "Idempotency key je že uporabljen za drug nabor plačil" }); return;
    }
    const payments = await Promise.all([...new Set(rows.map(row => row.paymentId))].map(fetchPaymentWithAllocations));
    res.status(200).json({ batchId: existing.id, batch: existing, payments, replayed: true });
    return;
  }
  try {
    const result = await db.transaction(async tx => {
      let effectivePaymentIds = paymentIds ?? [];
      const [account] = await tx.select({
        code: accountsTable.code, name: accountsTable.name, allowsPosting: accountsTable.allowsPosting,
      }).from(accountsTable).where(and(
        eq(accountsTable.id, bankAccountId), eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true),
      )).for("update").limit(1);
      if (!account || !account.code.startsWith("11") || account.allowsPosting === false) {
        throw Object.assign(new Error("Izbrani TRR ni aktiven/knjižljiv bančni konto podjetja"), { status: 400 });
      }
      const [lockedExisting] = await tx.select().from(paymentBatchesTable).where(and(
        eq(paymentBatchesTable.companyId, companyId),
        eq(paymentBatchesTable.idempotencyKey, idempotencyKey),
      )).for("update").limit(1);
      if (lockedExisting) {
        const rows = await tx.select({ paymentId: paymentBatchItemsTable.paymentId }).from(paymentBatchItemsTable)
          .where(eq(paymentBatchItemsTable.batchId, lockedExisting.id));
        const sameRequest = lockedExisting.bankAccountId === bankAccountId && (lockedExisting.requestFingerprint
          ? lockedExisting.requestFingerprint === requestFingerprint
          : savedMode && rows.map(row => row.paymentId).sort().join(",") === [...paymentIds!].sort().join(","));
        if (!sameRequest) throw Object.assign(new Error("Idempotency key je že uporabljen za drug nabor plačil"), { status: 409 });
        return { batchId: lockedExisting.id, paymentIds: rows.map(row => row.paymentId), replayed: true };
      }
      const [source] = await tx.select({
        iban: bankAccountMetadataTable.iban, bic: bankAccountMetadataTable.bic,
        profile: bankAccountMetadataTable.sepaProfile,
      }).from(bankAccountMetadataTable).where(and(
        eq(bankAccountMetadataTable.companyId, companyId), eq(bankAccountMetadataTable.bankAccountId, bankAccountId),
      )).limit(1);
      if (!source || !isValidIban(normalizeIban(source.iban))) throw Object.assign(new Error("Za izbrani bančni konto ni nastavljen veljaven IBAN"), { status: 400 });
      if (source.profile !== "pain.001.001.03") throw Object.assign(new Error("Izbrani bančni konto nima podprtega SEPA profila"), { status: 400 });
      if (directMode) {
        const [period] = await tx.select({
          id: accountingPeriodsTable.id,
          startDate: accountingPeriodsTable.startDate,
          endDate: accountingPeriodsTable.endDate,
          status: accountingPeriodsTable.status,
        }).from(accountingPeriodsTable).where(and(
          eq(accountingPeriodsTable.id, periodId!),
          eq(accountingPeriodsTable.companyId, companyId),
        )).for("update").limit(1);
        if (!period || period.status === "locked" || paymentDate! < period.startDate || paymentDate! > period.endDate) {
          throw Object.assign(new Error("Obdobje ni najdeno/odprto ali ne vsebuje datuma izvedbe"), { status: 400 });
        }

        type ProposedGroup = NonNullable<typeof proposedPayments>[number];
        const supplied: Array<{ group: ProposedGroup; invoiceId: string; cents: number }> = [];
        const suppliedIds = new Set<string>();
        for (const group of proposedPayments!) {
          if (!group || typeof group.counterpartyId !== "string" || typeof group.arApAccountId !== "string"
            || !Array.isArray(group.allocations) || !group.allocations.length) {
            throw Object.assign(new Error("Vsaka predlagana skupina potrebuje dobavitelja, konto obveznosti in dodelitve"), { status: 400 });
          }
          const [apAccount] = await tx.select({
            code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting,
          }).from(accountsTable).where(and(
            eq(accountsTable.id, group.arApAccountId), eq(accountsTable.companyId, companyId),
          )).limit(1);
          if (!apAccount || !apAccount.isActive || apAccount.allowsPosting === false
            || (!apAccount.code.startsWith("22") && !apAccount.code.startsWith("43"))) {
            throw Object.assign(new Error("Konto obveznosti ni aktiven/knjižljiv ali ni konto dobaviteljev"), { status: 400 });
          }
          for (const allocation of group.allocations) {
            if (typeof allocation?.invoiceId !== "string" || typeof allocation.amount !== "number"
              || !Number.isFinite(allocation.amount) || allocation.amount <= 0
              || Math.abs(allocation.amount * 100 - Math.round(allocation.amount * 100)) > 0.00001) {
              throw Object.assign(new Error("Vsaka dodelitev mora vsebovati račun in pozitiven znesek z največ dvema decimalkama"), { status: 400 });
            }
            if (suppliedIds.has(allocation.invoiceId)) {
              throw Object.assign(new Error("Isti račun je mogoče vključiti samo enkrat v neposredno pripravo paketa"), { status: 409 });
            }
            suppliedIds.add(allocation.invoiceId);
            supplied.push({ group, invoiceId: allocation.invoiceId, cents: Math.round(allocation.amount * 100) });
          }
        }

        const invoiceIds = [...suppliedIds].sort();
        const invoiceRows = await tx.select({
          id: invoicesTable.id,
          counterpartyId: invoicesTable.counterpartyId,
          counterpartyName: counterpartiesTable.name,
          counterpartyType: counterpartiesTable.type,
          counterpartyActive: counterpartiesTable.isActive,
          counterpartyIban: counterpartiesTable.iban,
          counterpartyTrr: counterpartiesTable.trr,
          counterpartyBic: counterpartiesTable.eRacunBic,
          invoiceNumber: invoicesTable.invoiceNumber,
          invoiceType: invoicesTable.type,
          status: invoicesTable.status,
          dueDate: invoicesTable.dueDate,
          arApAccountId: invoicesTable.arApAccountId,
          destinationIban: invoicesTable.destinationIban,
          destinationBic: invoicesTable.destinationBic,
          paymentModel: invoicesTable.paymentModel,
          paymentReference: invoicesTable.paymentReference,
          paymentPurpose: invoicesTable.paymentPurpose,
        }).from(invoicesTable).innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
          .where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, invoiceIds)))
          .orderBy(asc(invoicesTable.id))
          .for("update");
        if (invoiceRows.length !== invoiceIds.length) throw Object.assign(new Error("Ena ali več izbranih računov ni najdenih v tem podjetju"), { status: 404 });
        const invoiceById = new Map(invoiceRows.map(row => [row.id, row]));
        for (const selection of supplied) {
          const invoice = invoiceById.get(selection.invoiceId)!;
          if (invoice.invoiceType !== "received" || !["posted", "paid"].includes(invoice.status)
            || !invoice.counterpartyActive || (invoice.counterpartyType !== "supplier" && invoice.counterpartyType !== "both")
            || invoice.counterpartyId !== selection.group.counterpartyId
            || invoice.arApAccountId !== selection.group.arApAccountId) {
            throw Object.assign(new Error(`Račun ${invoice.invoiceNumber} ni knjižena odprta obveznost izbrane skupine dobavitelja/konta`), { status: 409 });
          }
          if (cutoffDate && invoice.dueDate && invoice.dueDate > cutoffDate) {
            throw Object.assign(new Error(`Račun ${invoice.invoiceNumber} zapade po izbranem datumu omejitve`), { status: 400 });
          }
        }
        const [grossRows, sourceTotals] = await Promise.all([
          tx.select({
            invoiceId: invoiceLinesTable.invoiceId,
            gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
          }).from(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds)).groupBy(invoiceLinesTable.invoiceId),
          tx.select({ id: invoicesTable.id, gross: invoicesTable.historicalGross }).from(invoicesTable)
            .where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, invoiceIds))),
        ]);
        const grossCents = new Map(grossRows.map(row => [row.invoiceId, Math.round(Number(row.gross) * 100)]));
        for (const invoice of sourceTotals) {
          if ((grossCents.get(invoice.id) ?? 0) <= 0 && invoice.gross) grossCents.set(invoice.id, Math.round(Number(invoice.gross) * 100));
        }
        const closureTotals = await invoiceClosingTotals(companyId, invoiceIds, paymentDate!, tx as unknown as typeof db);
        const closedCents = new Map([...closureTotals].map(([id, amount]) => [id, Math.round(amount * 100)]));
        const selectedCents = new Map<string, number>();
        for (const selection of supplied) selectedCents.set(selection.invoiceId, (selectedCents.get(selection.invoiceId) ?? 0) + selection.cents);
        for (const invoiceId of invoiceIds) {
          const remaining = (grossCents.get(invoiceId) ?? 0) - (closedCents.get(invoiceId) ?? 0);
          if ((selectedCents.get(invoiceId) ?? 0) > remaining) {
            throw Object.assign(new Error(`Izbrani znesek za račun ${invoiceById.get(invoiceId)!.invoiceNumber} presega odprti ostanek`), { status: 409 });
          }
        }
        const activeInvoiceBatch = await tx.select({ invoiceId: paymentAllocationsTable.invoiceId })
          .from(paymentAllocationsTable)
          .innerJoin(paymentBatchItemsTable, eq(paymentBatchItemsTable.paymentId, paymentAllocationsTable.paymentId))
          .innerJoin(paymentBatchesTable, eq(paymentBatchesTable.id, paymentBatchItemsTable.batchId))
          .where(and(
            inArray(paymentAllocationsTable.invoiceId, invoiceIds),
            isNull(paymentBatchItemsTable.releasedAt),
            eq(paymentBatchItemsTable.lifecycleStatus, "ready"),
            inArray(paymentBatchesTable.status, ["ready", "exported", "partially_executed"]),
          )).limit(1);
        if (activeInvoiceBatch.length) throw Object.assign(new Error("Ena ali več postavk je že vključena v aktiven paket"), { status: 409 });

        const paymentGroups = new Map<string, { proposed: ProposedGroup; items: typeof supplied; amountCents: number }>();
        for (const selection of supplied) {
          const invoice = invoiceById.get(selection.invoiceId)!;
          const beneficiaryIban = normalizeIban(invoice.destinationIban || invoice.counterpartyIban || invoice.counterpartyTrr?.[0]?.iban);
          const beneficiaryBic = String(invoice.destinationBic || invoice.counterpartyBic
            || invoice.counterpartyTrr?.find(item => normalizeIban(item.iban) === beneficiaryIban)?.bic || "").replace(/\s+/g, "").toUpperCase();
          if (!isValidIban(beneficiaryIban)) throw Object.assign(new Error(`Račun ${invoice.invoiceNumber} nima veljavnega prejemnikovega IBAN-a`), { status: 400 });
          const reference = invoice.paymentReference || invoice.invoiceNumber;
          const key = JSON.stringify([
            selection.group.counterpartyId, selection.group.arApAccountId, beneficiaryIban, beneficiaryBic,
            invoice.paymentModel || null, reference, invoice.paymentPurpose || null,
          ]);
          const group = paymentGroups.get(key) ?? { proposed: selection.group, items: [], amountCents: 0 };
          group.items.push(selection);
          group.amountCents += selection.cents;
          paymentGroups.set(key, group);
        }
        for (const group of paymentGroups.values()) {
          const firstInvoice = invoiceById.get(group.items[0]!.invoiceId)!;
          const [payment] = await tx.insert(paymentsTable).values({
            companyId,
            counterpartyId: group.proposed.counterpartyId,
            periodId: periodId!,
            direction: "outbound",
            paymentDate: paymentDate!,
            amount: (group.amountCents / 100).toFixed(2),
            reference: firstInvoice.paymentReference || firstInvoice.invoiceNumber,
            bankAccountId,
            arApAccountId: group.proposed.arApAccountId,
            status: "draft",
            notes: firstInvoice.paymentPurpose,
            createdBy: authReq.clerkUserId,
          }).returning({ id: paymentsTable.id });
          await tx.insert(paymentAllocationsTable).values(group.items.map(item => ({
            paymentId: payment.id,
            invoiceId: item.invoiceId,
            allocatedAmount: (item.cents / 100).toFixed(2),
          })));
          effectivePaymentIds.push(payment.id);
        }
      }
      const payments = await tx.select({
        id: paymentsTable.id, counterpartyId: paymentsTable.counterpartyId, periodId: paymentsTable.periodId,
        paymentDate: paymentsTable.paymentDate, amount: paymentsTable.amount, reference: paymentsTable.reference,
        direction: paymentsTable.direction,
        bankAccountId: paymentsTable.bankAccountId, arApAccountId: paymentsTable.arApAccountId,
        status: paymentsTable.status, notes: paymentsTable.notes,
        bankStatementLineId: paymentsTable.bankStatementLineId,
        counterpartyName: counterpartiesTable.name, counterpartyIban: counterpartiesTable.iban,
        counterpartyTrr: counterpartiesTable.trr, counterpartyBic: counterpartiesTable.eRacunBic,
      }).from(paymentsTable).innerJoin(counterpartiesTable, eq(counterpartiesTable.id, paymentsTable.counterpartyId))
        .where(and(eq(paymentsTable.companyId, companyId), inArray(paymentsTable.id, effectivePaymentIds)))
        .for("update");
      if (!effectivePaymentIds.length || payments.length !== effectivePaymentIds.length) throw Object.assign(new Error("Eno ali več plačil ne pripada aktivnemu podjetju"), { status: 400 });
      if (payments.some(payment => payment.status !== "draft" || payment.direction !== "outbound"
        || payment.bankAccountId !== bankAccountId || payment.bankStatementLineId !== null)) {
        throw Object.assign(new Error("Paket sprejema samo osnutke z izbranim izvornim bančnim kontom"), { status: 409 });
      }
      const activeBatch = await tx.select({ paymentId: paymentBatchItemsTable.paymentId })
        .from(paymentBatchItemsTable).innerJoin(paymentBatchesTable, eq(paymentBatchesTable.id, paymentBatchItemsTable.batchId))
        .where(and(
          inArray(paymentBatchItemsTable.paymentId, effectivePaymentIds),
          isNull(paymentBatchItemsTable.releasedAt),
          eq(paymentBatchItemsTable.lifecycleStatus, "ready"),
          inArray(paymentBatchesTable.status, ["ready", "exported", "partially_executed"]),
        ));
      if (activeBatch.length) throw Object.assign(new Error("Plačilo je že vključeno v aktiven paket"), { status: 409 });
      const dates = [...new Set(payments.map(p => p.paymentDate))];
      if (dates.length !== 1) throw Object.assign(new Error("V enem paketu morajo imeti vsa plačila isti datum izvedbe"), { status: 400 });
      const instructions: Array<{ paymentId: string; instruction: SepaTransactionInstruction }> = [];
      const sourceAllocations = await tx.select({ invoiceId: paymentAllocationsTable.invoiceId })
        .from(paymentAllocationsTable).where(inArray(paymentAllocationsTable.paymentId, effectivePaymentIds));
      const invoiceIds = new Set(sourceAllocations.map(row => row.invoiceId));
      if (invoiceIds.size) {
        await tx.select({ id: invoicesTable.id }).from(invoicesTable)
          .where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, [...invoiceIds])))
          .orderBy(asc(invoicesTable.id))
          .for("update");
      }
      const requestedByInvoice = new Map<string, number>();
      let cents = 0;
      for (const payment of payments) {
        const allocated = await tx.select({
          invoiceId: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
          counterpartyId: invoicesTable.counterpartyId, invoiceType: invoicesTable.type,
          invoiceStatus: invoicesTable.status, allocatedAmount: paymentAllocationsTable.allocatedAmount,
          destinationIban: invoicesTable.destinationIban, destinationBic: invoicesTable.destinationBic,
          paymentModel: invoicesTable.paymentModel, paymentReference: invoicesTable.paymentReference,
          paymentPurpose: invoicesTable.paymentPurpose,
        }).from(paymentAllocationsTable).innerJoin(invoicesTable, and(
          eq(invoicesTable.id, paymentAllocationsTable.invoiceId), eq(invoicesTable.companyId, companyId),
        )).where(eq(paymentAllocationsTable.paymentId, payment.id));
        if (!allocated.length) throw Object.assign(new Error(`Plačilo ${payment.id} nima dodeljenih računov`), { status: 400 });
        const allocatedCents = allocated.reduce((sum, item) => sum + Math.round(Number(item.allocatedAmount) * 100), 0);
        if (allocatedCents !== Math.round(Number(payment.amount) * 100)) {
          throw Object.assign(new Error(`Znesek plačila ${payment.id} mora biti v celoti dodeljen računom pred izvozom`), { status: 409 });
        }
        if (new Set(allocated.map(row => row.invoiceId)).size !== allocated.length) {
          throw Object.assign(new Error("Osnutek vsebuje podvojeno dodelitev istega računa"), { status: 409 });
        }
        for (const item of allocated) {
          if (item.counterpartyId !== payment.counterpartyId || item.invoiceType !== "received"
            || (item.invoiceStatus !== "posted" && item.invoiceStatus !== "paid")) {
            throw Object.assign(new Error("Osnutek vključuje račun, ki ni knjižen prejeti račun istega dobavitelja"), { status: 409 });
          }
          invoiceIds.add(item.invoiceId);
          requestedByInvoice.set(item.invoiceId, (requestedByInvoice.get(item.invoiceId) ?? 0) + Math.round(Number(item.allocatedAmount) * 100));
        }
        const destIbans = [...new Set(allocated.map(row => normalizeIban(row.destinationIban || payment.counterpartyIban || payment.counterpartyTrr?.[0]?.iban)).filter(Boolean))];
        if (destIbans.length !== 1 || !isValidIban(destIbans[0]!)) {
          throw Object.assign(new Error(`Za plačilo ${payment.id} manjka veljaven enoličen ciljni IBAN`), { status: 400 });
        }
        const instructionsForIban = allocated.filter(row => normalizeIban(row.destinationIban || payment.counterpartyIban || payment.counterpartyTrr?.[0]?.iban) === destIbans[0]);
        const refs = [...new Set(instructionsForIban.map(item => item.paymentReference || item.invoiceNumber))];
        const models = [...new Set(instructionsForIban.map(item => item.paymentModel).filter(Boolean))];
        const purposes = [...new Set(instructionsForIban.map(item => item.paymentPurpose).filter(Boolean))];
        const bicValues = [...new Set(instructionsForIban.map(item =>
          String(item.destinationBic || payment.counterpartyBic || payment.counterpartyTrr?.find(entry => normalizeIban(entry.iban) === destIbans[0])?.bic || "")
            .replace(/\s+/g, "").toUpperCase(),
        ).filter(Boolean))];
        if (refs.length > 1 || models.length > 1 || purposes.length > 1 || bicValues.length > 1) {
          throw Object.assign(new Error(`Navodila računov za plačilo ${payment.id} niso združljiva; pripravite ločene naloge`), { status: 400 });
        }
        const value = Number(payment.amount);
        if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error("Znesek plačila ni veljaven"), { status: 400 });
        cents += Math.round(value * 100);
        const bic = instructionsForIban.find(item => normalizeIban(item.destinationIban) === destIbans[0])?.destinationBic
          || payment.counterpartyBic || payment.counterpartyTrr?.find(item => normalizeIban(item.iban) === destIbans[0])?.bic;
        const instruction: SepaTransactionInstruction = {
          paymentId: payment.id, amount: value.toFixed(2), executionDate: payment.paymentDate,
          creditorName: payment.counterpartyName, creditorIban: destIbans[0]!, creditorBic: bic,
          reference: refs[0] ?? null,
          model: models.length === 1 ? models[0] : null,
          purpose: purposes.join("; ") || payment.notes || payment.reference,
        };
        instructions.push({ paymentId: payment.id, instruction });
      }
      if (invoiceIds.size) {
        const ids = [...invoiceIds];
        const [grossRows, sourceTotals] = await Promise.all([
          tx.select({
            invoiceId: invoiceLinesTable.invoiceId,
            gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
          }).from(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, ids)).groupBy(invoiceLinesTable.invoiceId),
          tx.select({ id: invoicesTable.id, gross: invoicesTable.historicalGross })
            .from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, ids))),
        ]);
        const gross = new Map(grossRows.map(row => [row.invoiceId, Math.round(Number(row.gross) * 100)]));
        for (const invoice of sourceTotals) {
          if ((gross.get(invoice.id) ?? 0) <= 0 && invoice.gross) gross.set(invoice.id, Math.round(Number(invoice.gross) * 100));
        }
        const closureTotals = await invoiceClosingTotals(companyId, ids, payments[0]!.paymentDate, tx as unknown as typeof db);
        const closed = new Map([...closureTotals].map(([id, amount]) => [id, Math.round(amount * 100)]));
        for (const invoiceId of ids) {
          const available = (gross.get(invoiceId) ?? 0) - (closed.get(invoiceId) ?? 0);
          if ((requestedByInvoice.get(invoiceId) ?? 0) > available) {
            throw Object.assign(new Error("Paket presega trenutno odprti znesek ene ali več dodeljenih postavk"), { status: 409 });
          }
        }
        const conflictingInvoice = await tx.select({ invoiceId: paymentAllocationsTable.invoiceId })
          .from(paymentAllocationsTable)
          .innerJoin(paymentBatchItemsTable, eq(paymentBatchItemsTable.paymentId, paymentAllocationsTable.paymentId))
          .innerJoin(paymentBatchesTable, eq(paymentBatchesTable.id, paymentBatchItemsTable.batchId))
          .where(and(
            inArray(paymentAllocationsTable.invoiceId, [...invoiceIds]),
            isNull(paymentBatchItemsTable.releasedAt),
            eq(paymentBatchItemsTable.lifecycleStatus, "ready"),
            inArray(paymentBatchesTable.status, ["ready", "exported", "partially_executed"]),
          )).limit(1);
        if (conflictingInvoice.length) throw Object.assign(new Error("Ena ali več odprtih postavk je že v drugem aktivnem paketu"), { status: 409 });
      }
      const balance = await getLatestBankStatementBalance(companyId, bankAccountId);
      if (!balance) {
        throw Object.assign(new Error("Izbrani TRR nima zadostnega zanesljivega evidentiranega kritja"), { status: 400 });
      }
      if (balance.currency !== "EUR") throw Object.assign(new Error("Kritje bančnega izpiska mora biti v EUR za SEPA plačila"), { status: 400 });
      if (balance.sourceIban && normalizeIban(balance.sourceIban) !== normalizeIban(source.iban)) {
        throw Object.assign(new Error("IBAN bančnega izpiska se ne ujema z nastavitvijo izbranega konta"), { status: 409 });
      }
      const [reservedRow] = await tx.select({
        total: sql<string>`COALESCE(SUM(${paymentsTable.amount}::numeric), 0)`,
      }).from(paymentBatchItemsTable)
        .innerJoin(paymentBatchesTable, eq(paymentBatchesTable.id, paymentBatchItemsTable.batchId))
        .innerJoin(paymentsTable, eq(paymentsTable.id, paymentBatchItemsTable.paymentId))
        .where(and(
          eq(paymentBatchesTable.companyId, companyId),
          eq(paymentBatchesTable.bankAccountId, bankAccountId),
          isNull(paymentBatchItemsTable.releasedAt),
          eq(paymentBatchItemsTable.lifecycleStatus, "ready"),
          inArray(paymentBatchesTable.status, ["ready", "exported", "partially_executed"]),
          eq(paymentsTable.status, "draft"),
          sql`${paymentsTable.bankStatementLineId} IS NULL`,
        ));
      const [unreconciledPostedRow] = await tx.select({
        total: sql<string>`COALESCE(SUM(${paymentsTable.amount}::numeric), 0)`,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.companyId, companyId),
        eq(paymentsTable.bankAccountId, bankAccountId),
        eq(paymentsTable.direction, "outbound"),
        eq(paymentsTable.status, "posted"),
        gt(paymentsTable.paymentDate, balance.evidenceDate),
        sql`${paymentsTable.bankStatementLineId} IS NULL`,
      ));
      const [reconciledOutflowRow] = await tx.select({
        total: sql<string>`COALESCE(SUM(${paymentsTable.amount}::numeric), 0)`,
      }).from(paymentsTable)
        .innerJoin(bankStatementLinesTable, eq(bankStatementLinesTable.id, paymentsTable.bankStatementLineId))
        .innerJoin(bankStatementsTable, eq(bankStatementsTable.id, bankStatementLinesTable.statementId))
        .where(and(
          eq(paymentsTable.companyId, companyId),
          eq(paymentsTable.bankAccountId, bankAccountId),
          eq(paymentsTable.direction, "outbound"),
          inArray(paymentsTable.status, ["draft", "posted"]),
          eq(bankStatementsTable.companyId, companyId),
          eq(bankStatementsTable.bankAccountId, bankAccountId),
          gt(bankStatementLinesTable.bookingDate, balance.evidenceDate),
        ));
      const availableCents = Math.round((Number(balance.balance)
        - Number(reservedRow?.total ?? 0)
        - Number(unreconciledPostedRow?.total ?? 0)
        - Number(reconciledOutflowRow?.total ?? 0)) * 100);
      if (cents > availableCents) {
        throw Object.assign(new Error("Paket presega zadnje evidentirano kritje po že rezerviranih in naknjiženih izplačilih"), { status: 400 });
      }
      const [batch] = await tx.insert(paymentBatchesTable).values({
        companyId, bankAccountId, executionDate: dates[0]!, idempotencyKey,
        requestFingerprint,
        transactionCount: String(instructions.length), controlSum: (cents / 100).toFixed(2),
        createdBy: authReq.clerkUserId,
      }).returning({ id: paymentBatchesTable.id });
      await tx.insert(paymentBatchItemsTable).values(instructions.map(item => ({
        batchId: batch.id, paymentId: item.paymentId, instruction: item.instruction as unknown as Record<string, unknown>,
      })));
      await tx.insert(auditLogTable).values({
        companyId, entityType: "payment_batch", entityId: batch.id, action: "create",
        changedBy: authReq.clerkUserId, payload: { paymentIds: effectivePaymentIds, bankAccountId, controlSum: (cents / 100).toFixed(2), mode: directMode ? "direct" : "saved" },
      });
      return { batchId: batch.id, paymentIds: effectivePaymentIds, replayed: false };
    });
    const [batch] = await db.select().from(paymentBatchesTable)
      .where(and(eq(paymentBatchesTable.id, result.batchId), eq(paymentBatchesTable.companyId, companyId))).limit(1);
    const payments = await Promise.all(result.paymentIds.map(fetchPaymentWithAllocations));
    res.status(result.replayed ? 200 : 201).json({
      batchId: batch.id, batch, payments,
      ...(result.replayed ? { replayed: true } : {}),
    });
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.code === "23505") {
      const [racedBatch] = await db.select().from(paymentBatchesTable).where(and(
        eq(paymentBatchesTable.companyId, companyId),
        eq(paymentBatchesTable.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (racedBatch?.requestFingerprint === requestFingerprint) {
        const rows = await db.select({ paymentId: paymentBatchItemsTable.paymentId }).from(paymentBatchItemsTable)
          .where(eq(paymentBatchItemsTable.batchId, racedBatch.id));
        const payments = await Promise.all([...new Set(rows.map(row => row.paymentId))].map(fetchPaymentWithAllocations));
        res.status(200).json({ batchId: racedBatch.id, batch: racedBatch, payments, replayed: true });
        return;
      }
      res.status(409).json({ error: "Paket ali plačilo je že ustvarjeno z enako idempotency key / drugim aktivnim paketom" });
      return;
    }
    throw error;
  }
});

router.get("/companies/:companyId/payment-batches/:batchId/sepa.xml", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = extractParam(req.params.companyId);
  const batchId = extractParam(req.params.batchId);
  const access = await resolveAccess(authReq.clerkUserId, companyId, res);
  if (!access) return;
  if (access.role === "viewer") { res.status(403).json({ error: "Za izvoz paketov potrebujete računovodsko vlogo" }); return; }
  try {
    const xmlContent = await db.transaction(async tx => {
      const [batch] = await tx.select().from(paymentBatchesTable).where(and(
        eq(paymentBatchesTable.id, batchId), eq(paymentBatchesTable.companyId, companyId),
      )).for("update").limit(1);
      if (!batch) throw Object.assign(new Error("Plačilni paket ni najden"), { status: 404 });
      if (batch.xmlSnapshot) {
        await tx.insert(auditLogTable).values({
          companyId, entityType: "payment_batch", entityId: batchId, action: "export",
          changedBy: authReq.clerkUserId, payload: { replay: true, transactionCount: batch.transactionCount, controlSum: batch.controlSum },
        });
        return batch.xmlSnapshot;
      }
      if (batch.status === "cancelled" || batch.status === "rejected") {
        throw Object.assign(new Error("Preklicanega ali zavrnjenega paketa ni mogoče izvoziti"), { status: 409 });
      }
      if (batch.status === "partially_executed" || batch.status === "executed") {
        throw Object.assign(new Error("Paket z že evidentirano izvedbo brez predhodnega XML izvoza ni mogoče izvoziti"), { status: 409 });
      }
      const [company] = await tx.select({ name: companiesTable.naziv }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      const [source] = await tx.select({
        iban: bankAccountMetadataTable.iban, bic: bankAccountMetadataTable.bic, profile: bankAccountMetadataTable.sepaProfile,
      }).from(bankAccountMetadataTable).where(and(
        eq(bankAccountMetadataTable.companyId, companyId), eq(bankAccountMetadataTable.bankAccountId, batch.bankAccountId),
      )).limit(1);
      if (!company || !source || !isValidIban(normalizeIban(source.iban))) throw Object.assign(new Error("Manjkajoči podatki izbranega TRR"), { status: 400 });
      const items = await tx.select({ instruction: paymentBatchItemsTable.instruction })
        .from(paymentBatchItemsTable).where(and(
          eq(paymentBatchItemsTable.batchId, batchId),
          isNull(paymentBatchItemsTable.releasedAt),
          eq(paymentBatchItemsTable.lifecycleStatus, "ready"),
        ));
      const xmlContent = buildSepaBatchXml({
        messageId: `BOOKIE-${batchId.replaceAll("-", "").slice(0, 28)}`,
        companyName: company.name, debtorIban: normalizeIban(source.iban), debtorBic: source.bic,
        profile: source.profile, transactions: items.map(item => item.instruction as unknown as SepaTransactionInstruction),
      });
      await tx.update(paymentBatchesTable).set({ xmlSnapshot: xmlContent, exportedAt: new Date(), status: "exported" })
        .where(eq(paymentBatchesTable.id, batchId));
      await tx.insert(auditLogTable).values({
        companyId, entityType: "payment_batch", entityId: batchId, action: "export",
        changedBy: authReq.clerkUserId, payload: { transactionCount: batch.transactionCount, controlSum: batch.controlSum },
      });
      return xmlContent;
    });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="SEPA-${batchId.slice(0, 8)}.xml"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(xmlContent);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

// ─── GET /companies/:companyId/open-items ─────────────────────────────────────
// Legacy AR evidence uses M/D/YYYY; validated AP snapshots use ISO dates. The
// sourceAsOf value is snapshot provenance only, not the closing's effective date.
function validOldRecordedDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return validOldRecordedDate(`${iso[2]}/${iso[3]}/${iso[1]}`);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]); const day = Number(match[2]); const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function invoiceClosingTotals(
  companyId: string,
  invoiceIds: string[],
  asOfDate: string,
  executor: typeof db = db,
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const {
    activeSettlementAmounts,
  } = await import("../lib/partner-ledger-calculator");
  const {
    partnerSettlementEventsTable, bookieOldBankApClosingsTable, bankStatementLinesTable,
    bankStatementsTable, bookieOldNativeLedgerEvidenceTable,
  } = await import("@workspace/db");
  type Evidence = import("../lib/partner-ledger-calculator").SettlementMovement;
  const events: Evidence[] = [];
  const invoiceById = new Map<string, { entryId: string | null; accountId: string; partnerId: string }>();
  const invoiceRows = await executor.select({
    id: invoicesTable.id, entryId: invoicesTable.linkedEntryId,
    accountId: invoicesTable.arApAccountId, partnerId: invoicesTable.counterpartyId,
    type: invoicesTable.type, sourceType: invoicesTable.sourceType,
    historicalGross: invoicesTable.historicalGross, status: invoicesTable.status,
  }).from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, invoiceIds)));
  for (const row of invoiceRows) invoiceById.set(row.id, { entryId: row.entryId, accountId: row.accountId, partnerId: row.partnerId });
  const entryIds = [...new Set(invoiceRows.flatMap((row) => row.entryId ? [row.entryId] : []))];
  const invoiceLine = new Map<string, string>();
  const lineToInvoice = new Map<string, string>();
  const invoiceNativeLineIds = new Map<string, string[]>();
  const importedGlLines = new Map<string, { id: string; entryId: string; partnerId: string | null }>();
  if (entryIds.length) {
    const glRows = await executor.select({
      id: journalEntryLinesTable.id, entryId: journalEntryLinesTable.entryId,
      accountId: journalEntryLinesTable.accountId, partnerId: journalEntryLinesTable.partnerId,
      description: journalEntryLinesTable.description,
    }).from(journalEntryLinesTable).innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .where(and(eq(journalEntriesTable.companyId, companyId), inArray(journalEntryLinesTable.entryId, entryIds)));
    for (const line of glRows) {
      const sourceId = line.description?.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1];
      if (sourceId) importedGlLines.set(sourceId, line);
    }
    for (const invoice of invoiceRows) {
      const lines = glRows.filter((row) => row.entryId === invoice.entryId && row.accountId === invoice.accountId && row.partnerId === invoice.partnerId);
      const line = lines[0];
      if (line) {
        invoiceLine.set(invoice.id, line.id);
        invoiceNativeLineIds.set(invoice.id, lines.map((item) => item.id));
        for (const item of lines) lineToInvoice.set(item.id, invoice.id);
      }
    }
  }
  const allocations = await executor.select({
    id: paymentAllocationsTable.id, invoiceId: paymentAllocationsTable.invoiceId, paymentId: paymentsTable.id,
    allocatedAmount: paymentAllocationsTable.allocatedAmount, paymentDate: paymentsTable.paymentDate,
  }).from(paymentAllocationsTable).innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
    .where(and(inArray(paymentAllocationsTable.invoiceId, invoiceIds), eq(paymentsTable.companyId, companyId),
      eq(paymentsTable.status, "posted"), lte(paymentsTable.paymentDate, asOfDate)));
  const allocationByInvoice = new Map<string, typeof allocations>();
  for (const allocation of allocations) allocationByInvoice.set(allocation.invoiceId, [...(allocationByInvoice.get(allocation.invoiceId) ?? []), allocation]);
  for (const allocation of allocations) {
    events.push({ id: `payment-allocation:${allocation.id}`, sourceLineId: allocation.invoiceId, amount: allocation.allocatedAmount,
      effectiveDate: allocation.paymentDate, eventType: "close" });
  }
  const arRows = await executor.select({ invoiceId: bookieOldArSettlementsTable.invoiceId, sourceLineId: bookieOldArSettlementsTable.sourceLineId, evidence: bookieOldArSettlementsTable.evidence })
    .from(bookieOldArSettlementsTable).where(and(eq(bookieOldArSettlementsTable.companyId, companyId),
      inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds)));
  const legacyArIds: string[] = [];
  const legacySourceIds = new Set<string>();
  for (const row of arRows) for (const closing of row.evidence ?? []) {
    const date = validOldRecordedDate(closing.recordedDate);
    if (!date || date > asOfDate || !(Number(closing.amount) > 0)) continue;
    const duplicate = allocationByInvoice.get(row.invoiceId)?.some((allocation) =>
      allocation.paymentDate === date && Number(allocation.allocatedAmount) === Number(closing.amount));
    const id = `bookie-old-ar:${companyId}:${closing.closingId}`;
    if (legacySourceIds.has(id)) continue;
    legacySourceIds.add(id);
    legacyArIds.push(id);
    if (!duplicate) events.push({ id, sourceLineId: row.invoiceId, amount: closing.amount, effectiveDate: date, eventType: "close" });
  }
  const apRows = await executor.select({
    invoiceId: bookieOldBankApClosingsTable.invoiceId, closingId: bookieOldBankApClosingsTable.closingId,
    statementId: bookieOldBankApClosingsTable.statementId, sourceBankLineId: bookieOldBankApClosingsTable.sourceBankLineId,
    amount: bookieOldBankApClosingsTable.amount, recordedDate: bookieOldBankApClosingsTable.recordedDate,
  }).from(bookieOldBankApClosingsTable).where(and(eq(bookieOldBankApClosingsTable.companyId, companyId),
    inArray(bookieOldBankApClosingsTable.invoiceId, invoiceIds), lte(bookieOldBankApClosingsTable.recordedDate, asOfDate)));
  const sourceIds = [...new Set(apRows.map((row) => row.sourceBankLineId))];
  const statementIds = [...new Set(apRows.map((row) => row.statementId))];
  const bankLines = sourceIds.length ? await executor.select({
    id: bankStatementLinesTable.id, statementId: bankStatementLinesTable.statementId,
    transactionKey: bankStatementLinesTable.transactionKey,
  }).from(bankStatementLinesTable).innerJoin(bankStatementsTable, eq(bankStatementsTable.id, bankStatementLinesTable.statementId))
    .where(and(eq(bankStatementsTable.companyId, companyId), inArray(bankStatementLinesTable.statementId, statementIds),
      inArray(bankStatementLinesTable.transactionKey, sourceIds))) : [];
  const bankLineToSource = new Map(bankLines.map((row) => [`${row.statementId}:${row.transactionKey}`, row.id]));
  const sourceBankIds = [...new Set(bankLines.map((row) => row.id))];
  const linkedPaymentRows = sourceBankIds.length ? await executor.select({
    id: paymentsTable.id, bankLineId: paymentsTable.bankStatementLineId,
  }).from(paymentsTable).where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.status, "posted"),
    inArray(paymentsTable.bankStatementLineId, sourceBankIds))) : [];
  for (const row of apRows) {
    const bankLineId = bankLineToSource.get(`${row.statementId}:${row.sourceBankLineId}`);
    const paymentId = linkedPaymentRows.find((payment) => payment.bankLineId === bankLineId)?.id;
    const duplicate = paymentId && allocationByInvoice.get(row.invoiceId)?.some((allocation) =>
      allocation.paymentId === paymentId && Number(allocation.allocatedAmount) === Number(row.amount));
    const id = `bookie-old-ap:${companyId}:${row.closingId}`;
    if (legacySourceIds.has(id)) continue;
    legacySourceIds.add(id);
    if (!duplicate) events.push({ id, sourceLineId: row.invoiceId, amount: row.amount, effectiveDate: row.recordedDate, eventType: "close" });
  }
  // Supplier snapshots include old bank, cash and offsetting links. They are
  // evidence of existing postings, not new payments. Reuse the bank-evidence
  // identity so the overlapping 2026 statement links are counted only once.
  const historicalAp = await executor.select({
    invoiceId: bookieOldApSettlementsTable.invoiceId,
    sourceLineId: bookieOldApSettlementsTable.sourceLineId,
    evidence: bookieOldApSettlementsTable.evidence,
  }).from(bookieOldApSettlementsTable).where(and(
    eq(bookieOldApSettlementsTable.companyId, companyId),
    inArray(bookieOldApSettlementsTable.invoiceId, invoiceIds),
  ));
  const coveredApInvoices = new Set(historicalAp.map(row => row.invoiceId));
  const missingApEvidence = invoiceRows.filter(row =>
    row.type === "received" && row.sourceType === "bookie-old" && Number(row.historicalGross) > 0
    && (row.status === "posted" || row.status === "paid") && !coveredApInvoices.has(row.id));
  if (missingApEvidence.length) {
    throw Object.assign(new Error(
      `Za ${missingApEvidence.length} zgodovinskih prejetih računov manjkajo preverjena dokazila zapiranj. Odprte obveznosti niso potrjene.`,
    ), { status: 409, statusCode: 409 });
  }
  for (const row of historicalAp) {
    const original = importedGlLines.get(row.sourceLineId);
    const invoice = invoiceById.get(row.invoiceId);
    if (original && original.entryId === invoice?.entryId && original.partnerId === invoice.partnerId) {
      const previous = invoiceLine.get(row.invoiceId);
      if (previous && previous !== original.id) lineToInvoice.delete(previous);
      invoiceLine.set(row.invoiceId, original.id);
      lineToInvoice.set(original.id, row.invoiceId);
      invoiceNativeLineIds.set(row.invoiceId, [
        ...new Set([...(invoiceNativeLineIds.get(row.invoiceId) ?? []), original.id]),
      ]);
    }
    for (const closing of row.evidence ?? []) {
      const date = validOldRecordedDate(closing.recordedDate);
      const id = `bookie-old-ap:${companyId}:${closing.closingId}`;
      if (!date || date > asOfDate || !(Number(closing.amount) > 0) || legacySourceIds.has(id)) continue;
      legacySourceIds.add(id);
      events.push({ id, sourceLineId: row.invoiceId, amount: closing.amount,
        effectiveDate: date, eventType: "close" });
    }
  }
  const nativeInvoiceLineIds = [...new Set([...invoiceNativeLineIds.values()].flat())];
  if (nativeInvoiceLineIds.length) {
    const nativeEvidenceRows = await executor.select({
      nativeLineId: bookieOldNativeLedgerEvidenceTable.nativeLineId,
      originalClosings: bookieOldNativeLedgerEvidenceTable.originalClosings,
    }).from(bookieOldNativeLedgerEvidenceTable).where(and(
      eq(bookieOldNativeLedgerEvidenceTable.companyId, companyId),
      inArray(bookieOldNativeLedgerEvidenceTable.nativeLineId, nativeInvoiceLineIds),
    ));
    type NativeClosing = (typeof nativeEvidenceRows)[number]["originalClosings"][number];
    type NativeClosingGroup = { closing: NativeClosing; invoiceIds: Set<string> };
    const invoiceByNativeLine = new Map<string, string>();
    for (const [invoiceId, nativeIds] of invoiceNativeLineIds) {
      for (const nativeId of nativeIds) invoiceByNativeLine.set(nativeId, invoiceId);
    }
    const nativeClosings = new Map<string, NativeClosingGroup>();
    for (const row of nativeEvidenceRows) {
      const invoiceId = invoiceByNativeLine.get(row.nativeLineId);
      if (!invoiceId) continue;
      for (const closing of row.originalClosings ?? []) {
        if (!(Number(closing.amount) > 0)) continue;
        const prior = nativeClosings.get(closing.closingId);
        if (prior) {
          if (prior.closing.sourceLineId !== closing.sourceLineId ||
              prior.closing.otherSourceLineId !== closing.otherSourceLineId ||
              Number(prior.closing.amount) !== Number(closing.amount)) {
            throw new Error(`Izvorni ZAPIRANJE ID ${closing.closingId} ima nasprotujoče invoice dokaze.`);
          }
          prior.invoiceIds.add(invoiceId);
        } else nativeClosings.set(closing.closingId, { closing, invoiceIds: new Set([invoiceId]) });
      }
    }
    const pairKey = (left: string, right: string, amount: string | number) =>
      `${[left, right].sort().join(":")}:${Number(amount).toFixed(2)}`;
    const coveredPairs = new Map<string, Set<string>>();
    for (const row of arRows) {
      for (const closing of row.evidence ?? []) {
        const key = pairKey(row.sourceLineId, closing.otherLineId, closing.amount);
        coveredPairs.set(key, new Set([...(coveredPairs.get(key) ?? []), row.invoiceId]));
      }
    }
    for (const row of historicalAp) {
      for (const closing of row.evidence ?? []) {
        const key = pairKey(row.sourceLineId, closing.otherLineId, closing.amount);
        coveredPairs.set(key, new Set([...(coveredPairs.get(key) ?? []), row.invoiceId]));
      }
    }
    const groups = new Map<string, NativeClosingGroup[]>();
    for (const item of nativeClosings.values()) {
      const closing = item.closing;
      const key = pairKey(closing.sourceLineId, closing.otherSourceLineId, closing.amount);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, group] of groups) {
      const remaining = new Set(group);
      const ordered = [...group].sort((left, right) =>
        left.closing.closingId.localeCompare(right.closing.closingId, undefined, { numeric: true }));
      for (const item of ordered) {
        if (!remaining.has(item)) continue;
        remaining.delete(item);
        const reciprocal = [...remaining].find((candidate) =>
          candidate.closing.sourceLineId === item.closing.otherSourceLineId &&
          candidate.closing.otherSourceLineId === item.closing.sourceLineId &&
          Number(candidate.closing.amount) === Number(item.closing.amount));
        if (reciprocal) remaining.delete(reciprocal);
        const canonical = reciprocal && reciprocal.closing.closingId.localeCompare(
          item.closing.closingId, undefined, { numeric: true },
        ) < 0 ? reciprocal : item;
        const dateA = validOldRecordedDate(item.closing.recordedDate);
        const dateB = reciprocal ? validOldRecordedDate(reciprocal.closing.recordedDate) : null;
        const recordedDate = dateA && dateB ? (dateA > dateB ? dateA : dateB) : dateA ?? dateB;
        if (!recordedDate || recordedDate > asOfDate) continue;
        const relatedInvoices = new Set([...item.invoiceIds, ...(reciprocal?.invoiceIds ?? [])]);
        const covered = coveredPairs.get(key) ?? new Set<string>();
        for (const invoiceId of relatedInvoices) {
          if (covered.has(invoiceId)) continue;
          const duplicateAllocation = allocationByInvoice.get(invoiceId)?.some((allocation) =>
            allocation.paymentDate === recordedDate &&
            Number(allocation.allocatedAmount) === Number(item.closing.amount));
          if (duplicateAllocation) continue;
          const id = `bookie-old-native:${companyId}:${canonical.closing.closingId}:invoice:${invoiceId}`;
          if (legacySourceIds.has(id)) continue;
          legacySourceIds.add(id);
          events.push({
            id, sourceLineId: invoiceId, amount: item.closing.amount,
            effectiveDate: recordedDate, eventType: "close",
          });
        }
      }
    }
  }
  const relevantLines = [...invoiceLine.values()];
  const manualRows = relevantLines.length ? await executor.select().from(partnerSettlementEventsTable).where(and(
    eq(partnerSettlementEventsTable.companyId, companyId),
    or(inArray(partnerSettlementEventsTable.sourceLineId, relevantLines), inArray(partnerSettlementEventsTable.targetLineId, relevantLines)),
    lte(partnerSettlementEventsTable.effectiveDate, asOfDate),
  )) : [];
  for (const event of manualRows) {
    const sourceInvoiceId = lineToInvoice.get(event.sourceLineId);
    const targetInvoiceId = lineToInvoice.get(event.targetLineId ?? "");
    const invoiceId = sourceInvoiceId ?? targetInvoiceId;
    if (!invoiceId) continue;
    events.push({ id: event.id,
      sourceLineId: sourceInvoiceId ?? targetInvoiceId!, targetLineId: sourceInvoiceId && targetInvoiceId && sourceInvoiceId !== targetInvoiceId ? targetInvoiceId : null,
      amount: event.amount, effectiveDate: event.effectiveDate,
      eventType: event.eventType, closeEventId: event.closeEventId, externalClosingId: event.externalClosingId });
  }
  const manualAndExternalRefs = [...new Set([
    ...legacyArIds,
    ...events.flatMap((event) => [event.id, event.closeEventId, event.externalClosingId].filter((v): v is string => Boolean(v))),
  ])];
  const externalReopens = manualAndExternalRefs.length ? await executor.select().from(partnerSettlementEventsTable).where(and(
    eq(partnerSettlementEventsTable.companyId, companyId), eq(partnerSettlementEventsTable.eventType, "reopen"),
    inArray(partnerSettlementEventsTable.externalClosingId, manualAndExternalRefs),
    lte(partnerSettlementEventsTable.effectiveDate, asOfDate),
  )) : [];
  for (const reopen of externalReopens) {
    if (events.some((event) => event.id === reopen.id)) continue;
    const invoiceId = lineToInvoice.get(reopen.sourceLineId);
    if (!invoiceId) continue;
    events.push({ id: reopen.id, sourceLineId: invoiceId, amount: reopen.amount, effectiveDate: reopen.effectiveDate,
      eventType: "reopen", closeEventId: reopen.closeEventId, externalClosingId: reopen.externalClosingId });
  }
  const active = activeSettlementAmounts(events, asOfDate);
  const totals = new Map<string, number>();
  for (const [id, amount] of active) {
    const source = events.find((event) => event.id === id);
    if (source) {
      totals.set(source.sourceLineId, (totals.get(source.sourceLineId) ?? 0) + Number(amount.toFixed(2)));
      if (source.targetLineId) totals.set(source.targetLineId, (totals.get(source.targetLineId) ?? 0) + Number(amount.toFixed(2)));
    }
  }
  return totals;
}

router.get(
  "/companies/:companyId/open-items",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { counterpartyId, type, asOfDate, sspOnly, unitId, invoiceDateFrom, invoiceDateTo } =
      req.query as Record<string, string | undefined>;
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);

    // Odprte postavke = knjiženi računi (posted ali paid) z preostalim zneskom > 0
    const conditions: any[] = [
      eq(invoicesTable.companyId, companyId),
      // posted or paid (paid can still have remaining if partially void was applied)
      lte(invoicesTable.invoiceDate, refDate),
    ];
    if (counterpartyId) conditions.push(eq(invoicesTable.counterpartyId, counterpartyId));
    if (type) conditions.push(eq(invoicesTable.type, type as any));
    if (invoiceDateFrom) conditions.push(gte(invoicesTable.invoiceDate, invoiceDateFrom));
    if (invoiceDateTo) conditions.push(lte(invoicesTable.invoiceDate, invoiceDateTo));
    // Preserve the historic generic endpoint behaviour; the dedicated SŠP
    // view, however, treats "stanje na dan" as an accounting cut-off.
    if (sspOnly === "true") conditions.push(lte(invoicesTable.invoiceDate, refDate));

    // Pridobi vse knjižene/plačane račune
    const invoices = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        dueDate: invoicesTable.dueDate,
        type: invoicesTable.type,
        counterpartyId: invoicesTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        arApAccountId: invoicesTable.arApAccountId,
        status: invoicesTable.status,
        linkedEntryId: invoicesTable.linkedEntryId,
        linkedEntryStatus: journalEntriesTable.status,
        linkedEntryReference: journalEntriesTable.reference,
        historicalGross: invoicesTable.historicalGross,
        activePaymentBatchId: sql<string | null>`(
          SELECT ${paymentBatchesTable.id}
          FROM ${paymentAllocationsTable}
          JOIN ${paymentBatchItemsTable} ON ${paymentBatchItemsTable.paymentId} = ${paymentAllocationsTable.paymentId}
          JOIN ${paymentBatchesTable} ON ${paymentBatchesTable.id} = ${paymentBatchItemsTable.batchId}
          WHERE ${paymentAllocationsTable.invoiceId} = ${invoicesTable.id}
            AND ${paymentBatchesTable.companyId} = ${companyId}
            AND ${paymentBatchItemsTable.releasedAt} IS NULL
            AND ${paymentBatchesTable.status} IN ('ready', 'exported', 'partially_executed')
          LIMIT 1
        )`,
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .leftJoin(journalEntriesTable, eq(journalEntriesTable.id, invoicesTable.linkedEntryId))
      .where(and(...conditions, sql`${invoicesTable.status} IN ('posted', 'paid')`))
      .orderBy(asc(sql`COALESCE(${invoicesTable.dueDate}, ${invoicesTable.invoiceDate})`), asc(invoicesTable.invoiceDate));

    // The SŠP view is intentionally stricter than generic open items: it only
    // exposes POS-sync receivables whose linked POS sales entry is posted.
    // The invoice number is the sole identity source; a canonical POS
    // reference, if present, must merely corroborate that identity.
    const requestedUnitId = unitId == null || unitId === "" ? undefined : Number(unitId);
    if (requestedUnitId !== undefined && (!Number.isSafeInteger(requestedUnitId) || requestedUnitId < 1)) {
      res.status(400).json({ error: "Enota ni veljavna" });
      return;
    }
    const sspOnlyRequested = sspOnly === "true";
    const sspIdentities = new Map<string, { unitId: number; dateToken: string }>();
    for (const invoice of invoices) {
      const identity = sspInvoiceIdentity(invoice.invoiceNumber);
      if (identity) sspIdentities.set(invoice.id, identity);
    }
    const sspUnitIds = [...new Set([...sspIdentities.values()].map((identity) => identity.unitId))];
    const unitRows = sspUnitIds.length === 0 ? [] : await db
      .select({ id: enoteTable.id, name: enoteTable.ime })
      .from(enoteTable)
      .where(and(eq(enoteTable.companyId, companyId), inArray(enoteTable.id, sspUnitIds)));
    const units = new Map(unitRows.map((unit) => [unit.id, unit]));
    const eligibleInvoices = invoices.filter((invoice) => {
      if (!sspOnlyRequested) return true;
      const identity = sspIdentities.get(invoice.id);
      if (!identity || !units.has(identity.unitId) || invoice.linkedEntryStatus !== "posted") return false;
      if (!hasMatchingPosSalesReference(invoice.linkedEntryReference, identity)) return false;
      return requestedUnitId === undefined || identity.unitId === requestedUnitId;
    });

    if (eligibleInvoices.length === 0) {
      res.json({ items: [], totalRemaining: "0.00" });
      return;
    }

    const invoiceIds = eligibleInvoices.map((i) => i.id);

    // Bruto vrstic je primarni vir. Stare uvožene fakture brez vrstic imajo
    // preverjen historicalGross; prazna tabela vrstic ne pomeni ničelnega računa.
    const grossRows = await db
      .select({
        invoiceId: invoiceLinesTable.invoiceId,
        gross: sql<string>`
          COALESCE(SUM(
            COALESCE(
              ${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric,
              (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) +
              (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100)
            )
          ), 0)
        `,
      })
      .from(invoiceLinesTable)
      .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
      .groupBy(invoiceLinesTable.invoiceId);

    const grossMap = new Map<string, number>();
    for (const r of grossRows) grossMap.set(r.invoiceId, parseFloat(r.gross ?? "0"));
    for (const invoice of eligibleInvoices) {
      if ((grossMap.get(invoice.id) ?? 0) === 0 && invoice.historicalGross !== null) {
        grossMap.set(invoice.id, Number(invoice.historicalGross));
      }
    }

    const closureTotals = await invoiceClosingTotals(companyId, invoiceIds, refDate);

    // Izračunaj preostalo
    let totalRemaining = 0;
    const items = [];

    for (const inv of eligibleInvoices) {
      const gross = grossMap.get(inv.id) ?? 0;
      const allocated = closureTotals.get(inv.id) ?? 0;
      const remaining = gross - allocated;

      if (remaining < 0.005) continue; // Popolnoma poravnano

      const dueDate = inv.dueDate ?? inv.invoiceDate;
      const refMs = new Date(refDate).getTime();
      const dueMs = new Date(dueDate).getTime();
      const daysOverdue = Math.max(0, Math.floor((refMs - dueMs) / 86400000));

      totalRemaining += remaining;
      items.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        counterpartyId: inv.counterpartyId,
        counterpartyName: inv.counterpartyName,
        arApAccountId: inv.arApAccountId,
        invoiceType: inv.type,
        totalGross: gross.toFixed(2),
        allocatedAmount: allocated.toFixed(2),
        remainingAmount: remaining.toFixed(2),
        daysOverdue,
        activePaymentBatchId: inv.activePaymentBatchId,
        ...(sspOnlyRequested ? {
          unitId: sspIdentities.get(inv.id)!.unitId,
          unitName: units.get(sspIdentities.get(inv.id)!.unitId)!.name,
        } : {}),
      });
    }

    res.json({ items, totalRemaining: totalRemaining.toFixed(2) });
  },
);

// ─── GET /companies/:companyId/aged-analysis ──────────────────────────────────
router.get(
  "/companies/:companyId/aged-analysis",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { type, asOfDate } = req.query as Record<string, string | undefined>;
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    const invoiceType = type ?? "issued";

    const invoices = await db
      .select({
        id: invoicesTable.id,
        invoiceDate: invoicesTable.invoiceDate,
        dueDate: invoicesTable.dueDate,
        counterpartyId: invoicesTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        status: invoicesTable.status,
        historicalGross: invoicesTable.historicalGross,
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.type, invoiceType as any),
          lte(invoicesTable.invoiceDate, refDate),
          sql`${invoicesTable.status} IN ('posted', 'paid')`,
        ),
      );

    if (invoices.length === 0) {
      const empty = { counterpartyId: "", counterpartyName: "", current: "0.00", bucket1to30: "0.00", bucket31to60: "0.00", bucket61to90: "0.00", bucketOver90: "0.00", total: "0.00" };
      res.json({ asOfDate: refDate, type: invoiceType, rows: [], totals: empty });
      return;
    }

    const invoiceIds = invoices.map((i) => i.id);

    // Bruto po računu
    const grossRows = await db
      .select({
        invoiceId: invoiceLinesTable.invoiceId,
        gross: sql<string>`COALESCE(SUM(COALESCE(${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric, (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric) + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100))), 0)`,
      })
      .from(invoiceLinesTable)
      .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
      .groupBy(invoiceLinesTable.invoiceId);
    const grossMap = new Map(grossRows.map((r) => [r.invoiceId, parseFloat(r.gross ?? "0")]));
    for (const invoice of invoices) {
      if ((grossMap.get(invoice.id) ?? 0) === 0 && invoice.historicalGross !== null) {
        grossMap.set(invoice.id, Number(invoice.historicalGross));
      }
    }

    const closureTotals = await invoiceClosingTotals(companyId, invoiceIds, refDate);

    // Grupiraj po partnerju
    type Buckets = { current: number; b1: number; b31: number; b61: number; b90: number };
    const byPartner = new Map<string, { name: string; buckets: Buckets }>();
    const refMs = new Date(refDate).getTime();

    for (const inv of invoices) {
      const gross = grossMap.get(inv.id) ?? 0;
      const remaining = gross - (closureTotals.get(inv.id) ?? 0);
      if (remaining < 0.005) continue;

      const dueDate = inv.dueDate ?? inv.invoiceDate;
      const dueMs = new Date(dueDate).getTime();
      const daysOverdue = Math.floor((refMs - dueMs) / 86400000);

      const existing = byPartner.get(inv.counterpartyId) ?? {
        name: inv.counterpartyName,
        buckets: { current: 0, b1: 0, b31: 0, b61: 0, b90: 0 },
      };

      if (daysOverdue <= 0) existing.buckets.current += remaining;
      else if (daysOverdue <= 30) existing.buckets.b1 += remaining;
      else if (daysOverdue <= 60) existing.buckets.b31 += remaining;
      else if (daysOverdue <= 90) existing.buckets.b61 += remaining;
      else existing.buckets.b90 += remaining;

      byPartner.set(inv.counterpartyId, existing);
    }

    const fmt = (n: number) => n.toFixed(2);
    const rows = [...byPartner.entries()].map(([cpId, data]) => {
      const { current, b1, b31, b61, b90 } = data.buckets;
      return {
        counterpartyId: cpId,
        counterpartyName: data.name,
        current: fmt(current),
        bucket1to30: fmt(b1),
        bucket31to60: fmt(b31),
        bucket61to90: fmt(b61),
        bucketOver90: fmt(b90),
        total: fmt(current + b1 + b31 + b61 + b90),
      };
    });

    const totBuckets = rows.reduce(
      (acc, r) => ({
        current: acc.current + parseFloat(r.current),
        b1: acc.b1 + parseFloat(r.bucket1to30),
        b31: acc.b31 + parseFloat(r.bucket31to60),
        b61: acc.b61 + parseFloat(r.bucket61to90),
        b90: acc.b90 + parseFloat(r.bucketOver90),
      }),
      { current: 0, b1: 0, b31: 0, b61: 0, b90: 0 },
    );

    const totals = {
      counterpartyId: "",
      counterpartyName: "SKUPAJ",
      current: fmt(totBuckets.current),
      bucket1to30: fmt(totBuckets.b1),
      bucket31to60: fmt(totBuckets.b31),
      bucket61to90: fmt(totBuckets.b61),
      bucketOver90: fmt(totBuckets.b90),
      total: fmt(totBuckets.current + totBuckets.b1 + totBuckets.b31 + totBuckets.b61 + totBuckets.b90),
    };

    res.json({ asOfDate: refDate, type: invoiceType, rows, totals });
  },
);

export default router;
