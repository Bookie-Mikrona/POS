import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, inArray, sql } from "drizzle-orm";
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
  enoteTable,
  posBookingSettingsTable,
  companiesTable,
  bankStatementLinesTable,
  bankStatementsTable,
} from "@workspace/db";
import {
  CreatePaymentBody,
  VoidPaymentBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getLatestBankStatementBalance } from "../lib/bankStatementBalances";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// A legacy closing is historical evidence, not a newly posted payment.
async function historicalClosedMap(
  companyId: string,
  invoiceIds: string[],
  executor: typeof db = db,
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await executor.select({
    invoiceId: bookieOldArSettlementsTable.invoiceId,
    closed: bookieOldArSettlementsTable.closedAmount,
  }).from(bookieOldArSettlementsTable).where(and(
    eq(bookieOldArSettlementsTable.companyId, companyId),
    inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds),
  ));
  return new Map(rows.map((row) => [row.invoiceId, Number(row.closed)]));
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

    // Alternativno: query po payment_allocations
    const [allocRow] = await (tx as typeof db)
      .select({
        allocated: sql<string>`COALESCE(SUM(${paymentAllocationsTable.allocatedAmount}), 0)`,
      })
      .from(paymentAllocationsTable)
      .innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
      .where(
        and(
          eq(paymentAllocationsTable.invoiceId, invoiceId),
          eq(paymentsTable.status, "posted"),
        ),
      );

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

    const allocated = parseFloat(allocRow?.allocated ?? "0");
    const gross = parseFloat(grossRow?.gross ?? "0");
    const historicalClosed = (await historicalClosedMap(inv.companyId, [invoiceId], tx as typeof db)).get(invoiceId) ?? 0;

    let newStatus: "posted" | "paid" = "posted";
    if (gross > 0 && allocated + historicalClosed >= gross - 0.005) {
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
    // `force` is not in the Zod schema intentionally — it's an override flag for duplicate detection
    const force = (req.body as any).force === true;
    const bankStatementLineId = typeof (req.body as any).bankStatementLineId === "string"
      ? (req.body as any).bankStatementLineId
      : null;

    // ── Duplicate detection (server-side enforcement) ──────────────────────────
    // Reject if a draft or posted payment with the same company, direction,
    // date, and amount (within 1 cent) already exists — unless force=true.
    if (!force) {
      const paymentDate = (parsed.data.paymentDate as unknown as Date).toISOString().slice(0, 10);

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
      const existingAllocs = await db
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
      const existingAllocMap = new Map(existingAllocs.map((r) => [r.invoiceId, parseFloat(r.allocated ?? "0")]));

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
      const historical = await historicalClosedMap(companyId, invoiceIds);

      for (const alloc of allocations) {
        const gross = grossMap.get(alloc.invoiceId) ?? 0;
        const alreadyAllocated = existingAllocMap.get(alloc.invoiceId) ?? 0;
        const remaining = gross - alreadyAllocated - (historical.get(alloc.invoiceId) ?? 0);
        if (alloc.allocatedAmount > remaining + 0.005) {
          res.status(400).json({
            error: `Poravnava (${alloc.allocatedAmount.toFixed(2)}) presega preostali odprti znesek računa (${remaining.toFixed(2)})`,
          });
          return;
        }
      }
    }

    const paymentDate = (parsed.data.paymentDate as unknown as Date).toISOString().slice(0, 10);

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
        direction: paymentsTable.direction,
        paymentDate: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
        reference: paymentsTable.reference,
        notes: paymentsTable.notes,
        companyName: companiesTable.naziv,
        companyTrr: companiesTable.trr,
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

    const debtor = row.companyTrr?.[0];
    const creditor = row.creditorTrr?.[0];
    const debtorIban = normalizeIban(debtor?.iban);
    const creditorIban = invoiceIbans[0] || normalizeIban(row.creditorIban || creditor?.iban);
    const invoiceBic = invoiceInstructions.find((item) => normalizeIban(item.destinationIban) === creditorIban)?.destinationBic;
    if (!isValidIban(debtorIban)) { res.status(400).json({ error: "Podjetje nima veljavnega privzetega IBAN-a" }); return; }
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
    const purpose = (invoicePurposes || invoiceReferences || row.notes || row.reference || `Plačilo ${row.creditorName}`).slice(0, 140);
    const document = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr><MsgId>${xml(messageId)}</MsgId><CreDtTm>${xml(new Date().toISOString())}</CreDtTm><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum><InitgPty><Nm>${xml(row.companyName)}</Nm></InitgPty></GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(messageId)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>1</NbOfTxs><CtrlSum>${amountText}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${xml(row.paymentDate)}</ReqdExctnDt>
      <Dbtr><Nm>${xml(row.companyName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct><DbtrAgt>${sepaAgentXml(debtor?.bic)}</DbtrAgt><ChrgBr>SLEV</ChrgBr>
      <CdtTrfTxInf><PmtId><EndToEndId>NOTPROVIDED</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amountText}</InstdAmt></Amt><CdtrAgt>${sepaAgentXml(invoiceBic || row.creditorBic || creditor?.bic)}</CdtrAgt><Cdtr><Nm>${xml(row.creditorName)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${creditorIban}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${xml(purpose)}</Ustrd></RmtInf></CdtTrfTxInf>
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
        const existingAllocs = await tx
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
              sql`${paymentsTable.id} != ${id}`,
            ),
          )
          .groupBy(paymentAllocationsTable.invoiceId);
        const existingAllocMap = new Map(existingAllocs.map((r) => [r.invoiceId, parseFloat(r.allocated ?? "0")]));

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
        const historical = await historicalClosedMap(companyId, invoiceIds, tx as unknown as typeof db);

        for (const alloc of allocsToPost) {
          const gross = grossMap.get(alloc.invoiceId) ?? 0;
          const alreadyAllocated = existingAllocMap.get(alloc.invoiceId) ?? 0;
          const remaining = gross - alreadyAllocated - (historical.get(alloc.invoiceId) ?? 0);
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
          const alreadyAllocated = existingAllocMap.get(inv.id) ?? 0;
          const thisAlloc = parseFloat(allocsToPost.find((a) => a.invoiceId === inv.id)?.allocatedAmount ?? "0");
          const totalAllocated = alreadyAllocated + thisAlloc + (historical.get(inv.id) ?? 0);
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
        await refreshInvoiceStatuses(tx as any, invoiceIds);
      });
    }

    const result = await fetchPaymentWithAllocations(id);
    res.json(result);
  },
);

// ─── GET /companies/:companyId/open-items ─────────────────────────────────────
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

    // Pridobi bruto zneske iz vrstic
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

    // Pridobi poravnane zneske (samo iz posted plačil)
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
          ...(sspOnlyRequested ? [lte(paymentsTable.paymentDate, refDate)] : []),
        ),
      )
      .groupBy(paymentAllocationsTable.invoiceId);

    const allocMap = new Map<string, number>();
    for (const r of allocRows) allocMap.set(r.invoiceId, parseFloat(r.allocated ?? "0"));
    const historical = await historicalClosedMap(companyId, invoiceIds);

    // Izračunaj preostalo
    let totalRemaining = 0;
    const items = [];

    for (const inv of eligibleInvoices) {
      const gross = grossMap.get(inv.id) ?? 0;
      const allocated = allocMap.get(inv.id) ?? 0;
      const historicalClosed = historical.get(inv.id) ?? 0;
      const remaining = gross - allocated - historicalClosed;

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
        allocatedAmount: (allocated + historicalClosed).toFixed(2),
        remainingAmount: remaining.toFixed(2),
        daysOverdue,
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
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.type, invoiceType as any),
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

    // Poravnano po računu
    const allocRows = await db
      .select({
        invoiceId: paymentAllocationsTable.invoiceId,
        allocated: sql<string>`COALESCE(SUM(${paymentAllocationsTable.allocatedAmount}), 0)`,
      })
      .from(paymentAllocationsTable)
      .innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
      .where(and(inArray(paymentAllocationsTable.invoiceId, invoiceIds), eq(paymentsTable.status, "posted")))
      .groupBy(paymentAllocationsTable.invoiceId);
    const allocMap = new Map(allocRows.map((r) => [r.invoiceId, parseFloat(r.allocated ?? "0")]));
    const historical = await historicalClosedMap(companyId, invoiceIds);

    // Grupiraj po partnerju
    type Buckets = { current: number; b1: number; b31: number; b61: number; b90: number };
    const byPartner = new Map<string, { name: string; buckets: Buckets }>();
    const refMs = new Date(refDate).getTime();

    for (const inv of invoices) {
      const gross = grossMap.get(inv.id) ?? 0;
      const allocated = allocMap.get(inv.id) ?? 0;
      const remaining = gross - allocated - (historical.get(inv.id) ?? 0);
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
