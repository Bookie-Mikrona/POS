import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, like, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  counterpartiesTable,
  accountingPeriodsTable,
  accountsTable,
  accountingRolesTable,
  auditLogTable,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { CreateInvoiceBody, UpdateInvoiceBody, VoidInvoiceBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

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

/** Vrne DDV konto za podjetje — 450 za izdane, 160 za prejete račune */
async function resolveVatAccount(
  companyId: string,
  invoiceType: "issued" | "received",
  vatAccountId: string | null | undefined,
  vatRate: number,
): Promise<string | null> {
  if (vatRate === 0) return null;
  if (vatAccountId) return vatAccountId;

  // Poišči privzeti DDV konto po kodi
  const codePrefix = invoiceType === "issued" ? "450" : "160";
  const [vatAcc] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.companyId, companyId),
        like(accountsTable.code, `${codePrefix}%`),
        eq(accountsTable.isActive, true),
      ),
    )
    .orderBy(asc(accountsTable.code))
    .limit(1);

  return vatAcc?.id ?? null;
}

/** Izračunaj seštevke vrstic */
function calcLineTotals(lines: { quantity: string; unitPrice: string; vatRate: string }[]) {
  let totalNet = 0;
  let totalVat = 0;
  for (const l of lines) {
    const qty = parseFloat(l.quantity);
    const price = parseFloat(l.unitPrice);
    const vatR = parseFloat(l.vatRate);
    const lineTotal = qty * price;
    const vatAmt = lineTotal * vatR / 100;
    totalNet += lineTotal;
    totalVat += vatAmt;
  }
  return {
    totalNet: totalNet.toFixed(2),
    totalVat: totalVat.toFixed(2),
    totalGross: (totalNet + totalVat).toFixed(2),
  };
}

/** Pridobi polni zapis računa (header + vrstice) */
async function fetchInvoiceWithLines(invoiceId: string) {
  const [inv] = await db
    .select({
      id: invoicesTable.id,
      companyId: invoicesTable.companyId,
      type: invoicesTable.type,
      counterpartyId: invoicesTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      periodId: invoicesTable.periodId,
      periodName: accountingPeriodsTable.name,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      dueDate: invoicesTable.dueDate,
      status: invoicesTable.status,
      arApAccountId: invoicesTable.arApAccountId,
      vatAccountId: invoicesTable.vatAccountId,
      linkedEntryId: invoicesTable.linkedEntryId,
      notes: invoicesTable.notes,
      createdBy: invoicesTable.createdBy,
      createdAt: invoicesTable.createdAt,
      updatedAt: invoicesTable.updatedAt,
    })
    .from(invoicesTable)
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
    .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, invoicesTable.periodId))
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);

  if (!inv) return null;

  const rawLines = await db
    .select({
      id: invoiceLinesTable.id,
      invoiceId: invoiceLinesTable.invoiceId,
      description: invoiceLinesTable.description,
      quantity: invoiceLinesTable.quantity,
      unitPrice: invoiceLinesTable.unitPrice,
      vatRate: invoiceLinesTable.vatRate,
      accountId: invoiceLinesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      sequence: invoiceLinesTable.sequence,
    })
    .from(invoiceLinesTable)
    .innerJoin(accountsTable, eq(accountsTable.id, invoiceLinesTable.accountId))
    .where(eq(invoiceLinesTable.invoiceId, invoiceId))
    .orderBy(asc(invoiceLinesTable.sequence));

  // Izračunaj seštevke
  let totalNet = 0;
  let totalVat = 0;
  const lines = rawLines.map((l) => {
    const qty = parseFloat(l.quantity);
    const price = parseFloat(l.unitPrice);
    const vatR = parseFloat(l.vatRate);
    const lineTotal = qty * price;
    const vatAmt = lineTotal * vatR / 100;
    totalNet += lineTotal;
    totalVat += vatAmt;
    return {
      ...l,
      lineTotal: lineTotal.toFixed(2),
      vatAmount: vatAmt.toFixed(2),
      grossTotal: (lineTotal + vatAmt).toFixed(2),
    };
  });

  return {
    ...inv,
    totalNet: totalNet.toFixed(2),
    totalVat: totalVat.toFixed(2),
    totalGross: (totalNet + totalVat).toFixed(2),
    lines,
  };
}

// ─── GET /companies/:companyId/invoices ───────────────────────────────────────
router.get(
  "/companies/:companyId/invoices",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { type, status, counterpartyId, periodId, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [
      eq(invoicesTable.companyId, companyId),
    ];
    if (type) conditions.push(eq(invoicesTable.type, type as any));
    if (status) conditions.push(eq(invoicesTable.status, status as any));
    if (counterpartyId) conditions.push(eq(invoicesTable.counterpartyId, counterpartyId));
    if (periodId) conditions.push(eq(invoicesTable.periodId, periodId));
    if (dateFrom) conditions.push(gte(invoicesTable.invoiceDate, dateFrom));
    if (dateTo) conditions.push(lte(invoicesTable.invoiceDate, dateTo));

    const rows = await db
      .select({
        id: invoicesTable.id,
        companyId: invoicesTable.companyId,
        type: invoicesTable.type,
        counterpartyId: invoicesTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        periodId: invoicesTable.periodId,
        periodName: accountingPeriodsTable.name,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        dueDate: invoicesTable.dueDate,
        status: invoicesTable.status,
        arApAccountId: invoicesTable.arApAccountId,
        vatAccountId: invoicesTable.vatAccountId,
        linkedEntryId: invoicesTable.linkedEntryId,
        notes: invoicesTable.notes,
        createdBy: invoicesTable.createdBy,
        createdAt: invoicesTable.createdAt,
        updatedAt: invoicesTable.updatedAt,
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, invoicesTable.periodId))
      .where(and(...conditions))
      .orderBy(asc(invoicesTable.invoiceDate), asc(invoicesTable.invoiceNumber));

    // Pridobi seštevke vrstic za vsak račun
    const invoiceIds = rows.map((r) => r.id);
    const allLines = invoiceIds.length > 0
      ? await db
          .select({
            invoiceId: invoiceLinesTable.invoiceId,
            quantity: invoiceLinesTable.quantity,
            unitPrice: invoiceLinesTable.unitPrice,
            vatRate: invoiceLinesTable.vatRate,
          })
          .from(invoiceLinesTable)
          .where(eq(invoiceLinesTable.invoiceId, invoiceIds[0]))
      : [];

    // Preračunaj seštevke (simplified — for list view)
    const invoices = rows.map((inv) => {
      // Seštevek bo prikazan ko se bo klicalo fetchInvoiceWithLines za posamezen račun
      // Za list view vrnemo z=0 totali - boljše je narediti agregatno query
      return { ...inv, totalNet: "0.00", totalVat: "0.00", totalGross: "0.00" };
    });

    // Popravi seštevke z agregatno poizvedbo
    const linesByInvoice = await db
      .select({
        invoiceId: invoiceLinesTable.invoiceId,
        quantity: invoiceLinesTable.quantity,
        unitPrice: invoiceLinesTable.unitPrice,
        vatRate: invoiceLinesTable.vatRate,
      })
      .from(invoiceLinesTable)
      .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
      .where(eq(invoicesTable.companyId, companyId));

    const totalsMap = new Map<string, { net: number; vat: number }>();
    for (const l of linesByInvoice) {
      const qty = parseFloat(l.quantity);
      const price = parseFloat(l.unitPrice);
      const vatR = parseFloat(l.vatRate);
      const lineTotal = qty * price;
      const vatAmt = lineTotal * vatR / 100;
      const prev = totalsMap.get(l.invoiceId) ?? { net: 0, vat: 0 };
      totalsMap.set(l.invoiceId, { net: prev.net + lineTotal, vat: prev.vat + vatAmt });
    }

    const invoicesWithTotals = invoices.map((inv) => {
      const t = totalsMap.get(inv.id) ?? { net: 0, vat: 0 };
      return {
        ...inv,
        totalNet: t.net.toFixed(2),
        totalVat: t.vat.toFixed(2),
        totalGross: (t.net + t.vat).toFixed(2),
      };
    });

    res.json({ invoices: invoicesWithTotals });
  },
);

// ─── POST /companies/:companyId/invoices ──────────────────────────────────────
router.post(
  "/companies/:companyId/invoices",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { type, counterpartyId, periodId, invoiceNumber, arApAccountId, vatAccountId, notes, lines } = parsed.data;

    // Validacije
    const [period] = await db
      .select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (!period) { res.status(404).json({ error: "Račuonovodsko obdobje ni najdeno" }); return; }

    const [counterparty] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!counterparty) { res.status(404).json({ error: "Partner ni najden" }); return; }

    const [arApAccount] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, arApAccountId), eq(accountsTable.companyId, companyId)))
      .limit(1);
    if (!arApAccount) { res.status(400).json({ error: "Konto terjatev/obveznosti ni najden" }); return; }

    // Preveri vatAccountId (če je podan)
    if (vatAccountId) {
      const [vatAcc] = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(eq(accountsTable.id, vatAccountId), eq(accountsTable.companyId, companyId)))
        .limit(1);
      if (!vatAcc) { res.status(400).json({ error: "DDV konto ni najden ali ne pripada temu podjetju" }); return; }
    }

    // Preveri vse kontne oznake vrstic — morajo pripadati istemu podjetju
    const lineAccountIds = [...new Set(lines.map((l) => l.accountId))];
    const validLineAccounts = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(inArray(accountsTable.id, lineAccountIds), eq(accountsTable.companyId, companyId)));
    if (validLineAccounts.length !== lineAccountIds.length) {
      res.status(400).json({ error: "Eden ali več kontov vrstic ne pripada temu podjetju" });
      return;
    }

    // Datumi
    const invoiceDate = (parsed.data.invoiceDate as unknown as Date).toISOString().slice(0, 10);
    const dueDate = parsed.data.dueDate
      ? (parsed.data.dueDate as unknown as Date).toISOString().slice(0, 10)
      : null;

    const invoiceId = await db.transaction(async (tx) => {
      const [newInv] = await tx
        .insert(invoicesTable)
        .values({
          companyId,
          type,
          counterpartyId,
          periodId,
          invoiceNumber,
          invoiceDate,
          dueDate,
          arApAccountId,
          vatAccountId: vatAccountId ?? null,
          notes: notes ?? null,
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: invoicesTable.id });

      await tx.insert(invoiceLinesTable).values(
        lines.map((l, i) => ({
          invoiceId: newInv.id,
          description: l.description,
          quantity: l.quantity.toFixed(3),
          unitPrice: l.unitPrice.toFixed(4),
          vatRate: l.vatRate.toFixed(2),
          accountId: l.accountId,
          sequence: i,
        })),
      );

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: newInv.id,
        action: "create",
        changedBy: authReq.clerkUserId,
        payload: { type, invoiceNumber, lineCount: lines.length },
      });

      return newInv.id;
    });

    const result = await fetchInvoiceWithLines(invoiceId);
    res.status(201).json(result);
  },
);

// ─── GET /companies/:companyId/invoices/:id ───────────────────────────────────
router.get(
  "/companies/:companyId/invoices/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [check] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!check) { res.status(404).json({ error: "Račun ni najden" }); return; }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── PATCH /companies/:companyId/invoices/:id ─────────────────────────────────
router.patch(
  "/companies/:companyId/invoices/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdateInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: invoicesTable.id, status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (existing.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke je mogoče urejati" });
      return;
    }

    const { lines, invoiceDate, dueDate, ...headerFields } = parsed.data;

    // Validacija vseh FK polj, ki se morda menjajo
    if (parsed.data.counterpartyId) {
      const [cp] = await db.select({ id: counterpartiesTable.id }).from(counterpartiesTable)
        .where(and(eq(counterpartiesTable.id, parsed.data.counterpartyId), eq(counterpartiesTable.companyId, companyId))).limit(1);
      if (!cp) { res.status(400).json({ error: "Partner ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.periodId) {
      const [p] = await db.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable)
        .where(and(eq(accountingPeriodsTable.id, parsed.data.periodId), eq(accountingPeriodsTable.companyId, companyId))).limit(1);
      if (!p) { res.status(400).json({ error: "Obdobje ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.arApAccountId) {
      const [a] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, parsed.data.arApAccountId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!a) { res.status(400).json({ error: "Konto terjatev/obveznosti ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.vatAccountId) {
      const [v] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, parsed.data.vatAccountId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!v) { res.status(400).json({ error: "DDV konto ne pripada temu podjetju" }); return; }
    }
    if (lines && lines.length > 0) {
      const updateLineAccountIds = [...new Set(lines.map((l) => l.accountId))];
      const validAccounts = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(inArray(accountsTable.id, updateLineAccountIds), eq(accountsTable.companyId, companyId)));
      if (validAccounts.length !== updateLineAccountIds.length) {
        res.status(400).json({ error: "Eden ali več kontov vrstic ne pripada temu podjetju" });
        return;
      }
    }

    await db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = { ...headerFields };
      if (invoiceDate) updateData.invoiceDate = (invoiceDate as unknown as Date).toISOString().slice(0, 10);
      if (dueDate !== undefined) updateData.dueDate = dueDate ? (dueDate as unknown as Date).toISOString().slice(0, 10) : null;

      await tx.update(invoicesTable).set(updateData as any).where(eq(invoicesTable.id, id));

      if (lines && lines.length > 0) {
        // Zamenjaj vrstice
        await tx.delete(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, id));
        await tx.insert(invoiceLinesTable).values(
          lines.map((l, i) => ({
            invoiceId: id,
            description: l.description,
            quantity: l.quantity.toFixed(3),
            unitPrice: l.unitPrice.toFixed(4),
            vatRate: l.vatRate.toFixed(2),
            accountId: l.accountId,
            sequence: i,
          })),
        );
      }

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: id,
        action: "update",
        changedBy: authReq.clerkUserId,
        payload: null,
      });
    });

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/invoices/:id/post ─────────────────────────────
router.post(
  "/companies/:companyId/invoices/:id/post",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za knjiženje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        type: invoicesTable.type,
        periodId: invoicesTable.periodId,
        arApAccountId: invoicesTable.arApAccountId,
        vatAccountId: invoicesTable.vatAccountId,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        counterpartyId: invoicesTable.counterpartyId,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke je mogoče knjižiti" });
      return;
    }

    const [period] = await db
      .select({ status: accountingPeriodsTable.status, name: accountingPeriodsTable.name })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.id, invoice.periodId))
      .limit(1);

    if (period?.status === "locked") {
      res.status(400).json({ error: "Obdobje je zaklenjeno" });
      return;
    }

    const lines = await db
      .select({
        accountId: invoiceLinesTable.accountId,
        quantity: invoiceLinesTable.quantity,
        unitPrice: invoiceLinesTable.unitPrice,
        vatRate: invoiceLinesTable.vatRate,
        description: invoiceLinesTable.description,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, id))
      .orderBy(asc(invoiceLinesTable.sequence));

    if (lines.length === 0) {
      res.status(400).json({ error: "Račun nima vrstic" });
      return;
    }

    // Izračunaj zneske
    const lineCalcs = lines.map((l) => {
      const qty = parseFloat(l.quantity);
      const price = parseFloat(l.unitPrice);
      const vatR = parseFloat(l.vatRate);
      const lineTotal = qty * price;
      const vatAmt = lineTotal * vatR / 100;
      return { ...l, lineTotal, vatAmt, grossTotal: lineTotal + vatAmt, vatR };
    });

    const totalGross = lineCalcs.reduce((s, l) => s + l.grossTotal, 0);

    // Poišči DDV konto za vrstice z vatRate > 0
    const vatLines = lineCalcs.filter((l) => l.vatR > 0 && l.vatAmt > 0);
    let vatAccountIdResolved: string | null = null;
    if (vatLines.length > 0) {
      vatAccountIdResolved = await resolveVatAccount(
        companyId,
        invoice.type,
        invoice.vatAccountId,
        vatLines[0].vatR,
      );
    }

    const [counterparty] = await db
      .select({ name: counterpartiesTable.name })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, invoice.counterpartyId))
      .limit(1);

    const entryDescription = `${invoice.type === "issued" ? "Izdani" : "Prejeti"} račun ${invoice.invoiceNumber} — ${counterparty?.name ?? ""}`;

    // Sestavi temeljnico
    // Issued: DEBIT AR (total gross), CREDIT revenue (per line), CREDIT VAT (per line)
    // Received: DEBIT expense (per line), DEBIT VAT (per line), CREDIT AP (total gross)
    const journalLines: {
      accountId: string;
      side: "debit" | "credit";
      amount: string;
      description: string | null;
    }[] = [];

    if (invoice.type === "issued") {
      // Debet: terjatve (skupni znesek z DDV)
      journalLines.push({
        accountId: invoice.arApAccountId,
        side: "debit",
        amount: totalGross.toFixed(2),
        description: entryDescription,
      });
      // Kredit: prihodki po vrsticah
      for (const l of lineCalcs) {
        journalLines.push({
          accountId: l.accountId,
          side: "credit",
          amount: l.lineTotal.toFixed(2),
          description: l.description ?? null,
        });
      }
      // Kredit: DDV
      if (vatAccountIdResolved) {
        const totalVat = vatLines.reduce((s, l) => s + l.vatAmt, 0);
        journalLines.push({
          accountId: vatAccountIdResolved,
          side: "credit",
          amount: totalVat.toFixed(2),
          description: "DDV na izhodni račun",
        });
      }
    } else {
      // Debet: stroški po vrsticah
      for (const l of lineCalcs) {
        journalLines.push({
          accountId: l.accountId,
          side: "debit",
          amount: l.lineTotal.toFixed(2),
          description: l.description ?? null,
        });
      }
      // Debet: vstopni DDV
      if (vatAccountIdResolved) {
        const totalVat = vatLines.reduce((s, l) => s + l.vatAmt, 0);
        journalLines.push({
          accountId: vatAccountIdResolved,
          side: "debit",
          amount: totalVat.toFixed(2),
          description: "Vstopni DDV",
        });
      }
      // Kredit: obveznosti (skupni znesek z DDV)
      journalLines.push({
        accountId: invoice.arApAccountId,
        side: "credit",
        amount: totalGross.toFixed(2),
        description: entryDescription,
      });
    }

    // Vstavi v DB (transakcija)
    await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId: invoice.periodId,
          entryDate: invoice.invoiceDate,
          description: entryDescription,
          reference: invoice.invoiceNumber,
          status: "posted",
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values(
        journalLines.map((l, i) => ({
          entryId: entry.id,
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          description: l.description,
          sequence: i,
        })),
      );

      await tx
        .update(invoicesTable)
        .set({ status: "posted", linkedEntryId: entry.id })
        .where(eq(invoicesTable.id, id));

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: id,
        action: "post",
        changedBy: authReq.clerkUserId,
        payload: { linkedEntryId: entry.id },
      });
    });

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/invoices/:id/void ─────────────────────────────
router.post(
  "/companies/:companyId/invoices/:id/void",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za razveljavitev računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = VoidInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        periodId: invoicesTable.periodId,
        linkedEntryId: invoicesTable.linkedEntryId,
        invoiceNumber: invoicesTable.invoiceNumber,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.status !== "posted") {
      res.status(400).json({ error: "Samo knjižene račune je mogoče razveljaviti" });
      return;
    }

    const targetPeriodId = parsed.data.periodId ?? invoice.periodId;
    const [targetPeriod] = await db
      .select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, targetPeriodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);

    if (targetPeriod?.status === "locked") {
      res.status(400).json({ error: "Ciljno obdobje je zaklenjeno" });
      return;
    }

    // Storniraj temeljnico (če obstaja)
    if (invoice.linkedEntryId) {
      const [origEntry] = await db
        .select({ id: journalEntriesTable.id, status: journalEntriesTable.status })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, invoice.linkedEntryId))
        .limit(1);

      if (origEntry && origEntry.status === "posted") {
        const origLines = await db
          .select({
            accountId: journalEntryLinesTable.accountId,
            side: journalEntryLinesTable.side,
            amount: journalEntryLinesTable.amount,
            description: journalEntryLinesTable.description,
            sequence: journalEntryLinesTable.sequence,
          })
          .from(journalEntryLinesTable)
          .where(eq(journalEntryLinesTable.entryId, invoice.linkedEntryId))
          .orderBy(asc(journalEntryLinesTable.sequence));

        await db.transaction(async (tx) => {
          const [reversalEntry] = await tx
            .insert(journalEntriesTable)
            .values({
              companyId,
              periodId: targetPeriodId,
              entryDate: new Date().toISOString().slice(0, 10),
              description: `STORNO računa ${invoice.invoiceNumber}`,
              reference: invoice.invoiceNumber,
              status: "posted",
              reversalOf: invoice.linkedEntryId!,
              createdBy: authReq.clerkUserId,
            })
            .returning({ id: journalEntriesTable.id });

          await tx.insert(journalEntryLinesTable).values(
            origLines.map((l) => ({
              entryId: reversalEntry.id,
              accountId: l.accountId,
              side: l.side === "debit" ? ("credit" as const) : ("debit" as const),
              amount: l.amount,
              description: l.description,
              sequence: l.sequence,
            })),
          );

          await tx
            .update(journalEntriesTable)
            .set({ status: "reversed" })
            .where(eq(journalEntriesTable.id, invoice.linkedEntryId!));

          await tx.update(invoicesTable).set({ status: "void" }).where(eq(invoicesTable.id, id));

          await tx.insert(auditLogTable).values({
            companyId,
            entityType: "invoice",
            entityId: id,
            action: "void",
            changedBy: authReq.clerkUserId,
            payload: { reversalEntryId: reversalEntry.id, reason: parsed.data.reason },
          });
        });
      }
    } else {
      // Brez temeljnice — samo razveljavimo račun
      await db.transaction(async (tx) => {
        await tx.update(invoicesTable).set({ status: "void" }).where(eq(invoicesTable.id, id));
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "invoice",
          entityId: id,
          action: "void",
          changedBy: authReq.clerkUserId,
          payload: { reason: parsed.data.reason },
        });
      });
    }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

export default router;
