/**
 * ERP Prejemnice brez računa
 *
 * Tok:
 *   POST   /companies/:id/goods-receipts            — ustvari + poknjiži (DR zaloga / CR 221)
 *   GET    /companies/:id/goods-receipts             — seznam (filtri: status, counterpartyId)
 *   GET    /companies/:id/goods-receipts/:id         — podrobnosti
 *   POST   /companies/:id/goods-receipts/:id/match  — poveži z računom (DR 221 / CR 220)
 *   DELETE /companies/:id/goods-receipts/:id/match  — razveži (storniraj match temeljnico)
 *   POST   /companies/:id/goods-receipts/:id/void   — prekliči prejemnico
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { and, eq, inArray, desc, gte, isNull, lte, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  db,
  accountingRolesTable,
  accountingPeriodsTable,
  accountsTable,
  counterpartiesTable,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  invoicesTable,
  invoiceLinesTable,
  vatCodeTable,
  auditLogTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { claimPurchaseSourceDocument } from "../lib/purchaseSourceDocuments";
import {
  calculateGoodsReceiptInvoiceMatch,
  resolveGoodsReceiptInvoiceSource,
} from "../lib/goodsReceiptInvoiceMatch";
import {
  createVatLedgerEntries,
  reverseVatLedgerEntries,
  type EntryMeta,
  type VatLine,
} from "../lib/vatLedger";

const router: IRouter = Router();

// ─── Pomočniki ────────────────────────────────────────────────────────────────

function ep(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
  minRole: "accountant" | "viewer" = "accountant",
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return null; }
  if (minRole === "accountant" && row.role === "viewer") {
    res.status(403).json({ error: "Za to dejanje potrebujete vlogo računovodje" }); return null;
  }
  return { role: row.role };
}

/** Pridobi polni zapis prejemnice z vrsticami */
async function fetchReceipt(id: string, companyId: string) {
  const [receipt] = await db
    .select({
      id: goodsReceiptsTable.id,
      companyId: goodsReceiptsTable.companyId,
      counterpartyId: goodsReceiptsTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      periodId: goodsReceiptsTable.periodId,
      periodName: accountingPeriodsTable.name,
      receiptDate: goodsReceiptsTable.receiptDate,
      deliveryNoteNo: goodsReceiptsTable.deliveryNoteNo,
      description: goodsReceiptsTable.description,
      status: goodsReceiptsTable.status,
      transitAccountId: goodsReceiptsTable.transitAccountId,
      inventoryAccountId: goodsReceiptsTable.inventoryAccountId,
      totalAmount: goodsReceiptsTable.totalAmount,
      linkedEntryId: goodsReceiptsTable.linkedEntryId,
      matchedInvoiceId: goodsReceiptsTable.matchedInvoiceId,
      matchEntryId: goodsReceiptsTable.matchEntryId,
      sourceDocumentId: goodsReceiptsTable.sourceDocumentId,
      notes: goodsReceiptsTable.notes,
      createdBy: goodsReceiptsTable.createdBy,
      createdAt: goodsReceiptsTable.createdAt,
    })
    .from(goodsReceiptsTable)
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, goodsReceiptsTable.counterpartyId))
    .leftJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, goodsReceiptsTable.periodId))
    .where(and(eq(goodsReceiptsTable.id, id), eq(goodsReceiptsTable.companyId, companyId)))
    .limit(1);
  if (!receipt) return null;

  const lines = await db
    .select({
      id: goodsReceiptLinesTable.id,
      description: goodsReceiptLinesTable.description,
      accountId: goodsReceiptLinesTable.accountId,
      quantity: goodsReceiptLinesTable.quantity,
      unitPrice: goodsReceiptLinesTable.unitPrice,
      amount: goodsReceiptLinesTable.amount,
      notes: goodsReceiptLinesTable.notes,
    })
    .from(goodsReceiptLinesTable)
    .where(eq(goodsReceiptLinesTable.goodsReceiptId, id));

  return { ...receipt, lines };
}

// ─── POST /companies/:companyId/goods-receipts ────────────────────────────────

router.post(
  "/companies/:companyId/goods-receipts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "accountant");
    if (!access) return;

    const {
      counterpartyId, periodId, receiptDate, deliveryNoteNo,
      description, transitAccountId, inventoryAccountId, lines, notes,
    } = req.body as {
      counterpartyId: string; periodId: string; receiptDate: string;
      deliveryNoteNo: string; description?: string;
      transitAccountId: string; inventoryAccountId: string;
      lines: { description: string; quantity?: number; unitPrice: number; accountId?: string; notes?: string }[];
      notes?: string;
    };

    // ── Validacija ──────────────────────────────────────────────────────────
    if (!counterpartyId || !periodId || !receiptDate || !deliveryNoteNo || !transitAccountId || !inventoryAccountId) {
      res.status(400).json({ error: "Manjkajo obvezna polja: counterpartyId, periodId, receiptDate, deliveryNoteNo, transitAccountId, inventoryAccountId" });
      return;
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "Prejemnica mora imeti vsaj eno vrstico" });
      return;
    }

    // Preveri period
    const [period] = await db.select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (!period) { res.status(404).json({ error: "Obdobje ni najdeno" }); return; }
    if (period.status === "locked") { res.status(400).json({ error: "Obdobje je zaklenjeno" }); return; }

    // Preveri partnerja
    const [cp] = await db.select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!cp) { res.status(404).json({ error: "Partner ni najden" }); return; }

    // Preveri konte
    const accountIds = [transitAccountId, inventoryAccountId,
      ...lines.filter(l => l.accountId).map(l => l.accountId!)];
    const uniqueIds = [...new Set(accountIds)];
    const foundAccounts = await db.select({ id: accountsTable.id, code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
      .from(accountsTable)
      .where(and(inArray(accountsTable.id, uniqueIds), eq(accountsTable.companyId, companyId)));
    const accountMap = new Map(foundAccounts.map(a => [a.id, a]));

    for (const aid of [transitAccountId, inventoryAccountId]) {
      const a = accountMap.get(aid);
      if (!a) { res.status(400).json({ error: "Konto ni najden ali ne pripada temu podjetju" }); return; }
      if (!a.isActive) { res.status(400).json({ error: `Konto ${a.code} ni aktiven` }); return; }
      if (!a.allowsPosting) { res.status(400).json({ error: `Na konto ${a.code} ni dovoljeno neposredno knjižiti` }); return; }
    }

    // Preveri tudi opcijske konte na vrsticah — tuj ali neobstoječ konto zavrni
    for (const l of lines) {
      if (!l.accountId) continue;
      const a = accountMap.get(l.accountId);
      if (!a) { res.status(400).json({ error: "Konto na vrstici ni najden ali ne pripada temu podjetju" }); return; }
      if (!a.isActive) { res.status(400).json({ error: `Konto ${a.code} na vrstici ni aktiven` }); return; }
    }

    // Izračunaj skupni znesek
    const now = new Date();
    let totalAmount = new Decimal(0);
    const processedLines = lines.map(l => {
      const qty = new Decimal(l.quantity ?? 1);
      const price = new Decimal(l.unitPrice);
      const amt = qty.mul(price).toDecimalPlaces(2);
      totalAmount = totalAmount.plus(amt);
      return { ...l, qty, price, amt };
    });

    if (totalAmount.lte(0)) {
      res.status(400).json({ error: "Skupni znesek mora biti pozitiven" });
      return;
    }

    // ── Transakcija: ustvari prejemnico + temeljnico ────────────────────────
    let result: string;
    try {
      result = await db.transaction(async (tx) => {
      const sourceDocumentId = await claimPurchaseSourceDocument(tx, {
        companyId,
        counterpartyId,
        kind: "delivery_note",
        documentNumber: deliveryNoteNo,
        documentDate: receiptDate,
      });
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sourceDocumentId}))`);
      const existingPosReceipt = await tx.execute(sql`
        SELECT id FROM prejemnice
         WHERE source_document_id = ${sourceDocumentId}
         LIMIT 1
      `);
      if (existingPosReceipt.rows[0]) {
        throw new Error("PURCHASE_SOURCE_ALREADY_IN_POS");
      }
      const existingFinalInvoice = await tx.execute(sql`
        SELECT id FROM invoices
         WHERE source_document_id = ${sourceDocumentId}
           AND status <> 'draft'
         LIMIT 1
      `);
      if (existingFinalInvoice.rows[0]) {
        throw new Error("PURCHASE_SOURCE_ALREADY_IN_INVOICE");
      }
      // 1. Ustvari goods_receipt zapis
      const [gr] = await tx.insert(goodsReceiptsTable).values({
        companyId,
        counterpartyId,
        periodId,
        receiptDate,
        deliveryNoteNo: deliveryNoteNo.trim(),
        description: description?.trim() ?? null,
        status: "open",
        transitAccountId,
        inventoryAccountId,
        totalAmount: totalAmount.toFixed(2),
        notes: notes?.trim() ?? null,
        createdBy: auth.clerkUserId,
        sourceDocumentId,
      }).returning({ id: goodsReceiptsTable.id });

      // 2. Vrstice
      await tx.insert(goodsReceiptLinesTable).values(
        processedLines.map(l => ({
          goodsReceiptId: gr.id,
          description: l.description,
          accountId: l.accountId ?? null,
          quantity: l.qty.toFixed(4),
          unitPrice: l.price.toFixed(4),
          amount: l.amt.toFixed(2),
          notes: l.notes ?? null,
        }))
      );

      // 3. Temeljnica: DR inventoryAccountId / CR transitAccountId
      const [entry] = await tx.insert(journalEntriesTable).values({
        companyId,
        periodId,
        entryDate: receiptDate,
        documentDate: receiptDate,
        description: `Prejemnica ${deliveryNoteNo.trim()}`,
        reference: deliveryNoteNo.trim(),
        status: "posted",
        postedAt: now,
        sourceType: "document",
        approvedBy: auth.clerkUserId,
        createdBy: auth.clerkUserId,
      }).returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values([
        {
          entryId: entry.id,
          accountId: inventoryAccountId,
          side: "debit",
          amount: totalAmount.toFixed(2),
          description: `Prejemnica ${deliveryNoteNo.trim()} — zaloga`,
          sequence: 0,
          partnerId: counterpartyId,
        },
        {
          entryId: entry.id,
          accountId: transitAccountId,
          side: "credit",
          amount: totalAmount.toFixed(2),
          description: `Prejemnica ${deliveryNoteNo.trim()} — prehodni konto`,
          sequence: 1,
          partnerId: counterpartyId,
        },
      ]);

      // 4. Poveži temeljnico z goods_receipt
      await tx.update(goodsReceiptsTable)
        .set({ linkedEntryId: entry.id })
        .where(eq(goodsReceiptsTable.id, gr.id));

      // 5. Revizijsko beleženje
      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "goods_receipt",
        entityId: gr.id,
        action: "create",
        changedBy: auth.clerkUserId,
        payload: { deliveryNoteNo, totalAmount: totalAmount.toFixed(2), linkedEntryId: entry.id },
      });

      return gr.id;
      });
    } catch (error: any) {
      if (error?.message === "PURCHASE_SOURCE_ALREADY_IN_POS") {
        res.status(409).json({
          error: "Ta dobavnica je že zajeta kot POS prejemnica in je ni dovoljeno ponovno finančno zajeti",
        });
        return;
      }
      if (error?.message === "PURCHASE_SOURCE_ALREADY_IN_INVOICE") {
        res.status(409).json({
          error: "Ta listina je že finančno zajeta kot prejeti račun",
        });
        return;
      }
      if (
        error?.cause?.code === "23505"
        || error?.code === "23505"
        || error?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
      ) {
        res.status(409).json({ error: "Ta dobavnica je že zajeta v ERP prejemnicah" });
        return;
      }
      throw error;
    }

    const full = await fetchReceipt(result, companyId);
    res.status(201).json(full);
  },
);

// ─── GET /companies/:companyId/goods-receipts ─────────────────────────────────

router.get(
  "/companies/:companyId/goods-receipts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "viewer");
    if (!access) return;

    const statusFilter = req.query.status as string | undefined;

    const conditions = [eq(goodsReceiptsTable.companyId, companyId)];
    if (statusFilter && ["open", "matched", "voided"].includes(statusFilter)) {
      conditions.push(eq(goodsReceiptsTable.status, statusFilter as "open" | "matched" | "voided"));
    }

    const receipts = await db
      .select({
        id: goodsReceiptsTable.id,
        counterpartyId: goodsReceiptsTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        periodId: goodsReceiptsTable.periodId,
        receiptDate: goodsReceiptsTable.receiptDate,
        deliveryNoteNo: goodsReceiptsTable.deliveryNoteNo,
        description: goodsReceiptsTable.description,
        status: goodsReceiptsTable.status,
        totalAmount: goodsReceiptsTable.totalAmount,
        linkedEntryId: goodsReceiptsTable.linkedEntryId,
        matchedInvoiceId: goodsReceiptsTable.matchedInvoiceId,
        matchEntryId: goodsReceiptsTable.matchEntryId,
        createdAt: goodsReceiptsTable.createdAt,
      })
      .from(goodsReceiptsTable)
      .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, goodsReceiptsTable.counterpartyId))
      .where(and(...conditions))
      .orderBy(desc(goodsReceiptsTable.receiptDate), desc(goodsReceiptsTable.createdAt));

    res.json({ receipts });
  },
);

// ─── GET /companies/:companyId/goods-receipts/:id ────────────────────────────

router.get(
  "/companies/:companyId/goods-receipts/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "viewer");
    if (!access) return;

    const receipt = await fetchReceipt(id, companyId);
    if (!receipt) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
    res.json(receipt);
  },
);

// ─── POST /companies/:companyId/goods-receipts/:id/match ─────────────────────

router.post(
  "/companies/:companyId/goods-receipts/:id/match",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "accountant");
    if (!access) return;

    const { invoiceId } = req.body as { invoiceId: string };
    if (!invoiceId) { res.status(400).json({ error: "invoiceId je obvezen" }); return; }

    // Naloži prejemnico
    const [gr] = await db.select()
      .from(goodsReceiptsTable)
      .where(and(eq(goodsReceiptsTable.id, id), eq(goodsReceiptsTable.companyId, companyId)))
      .limit(1);
    if (!gr) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
    if (gr.status !== "open") { res.status(400).json({ error: "Samo odprte prejemnice se lahko ujamejo z računom" }); return; }

    // Naloži račun (mora biti prejeti osnutek istega podjetja).
    // Match je edini lastnik finančnega knjiženja tega toka.
    const [invoice] = await db.select({
      id: invoicesTable.id,
      type: invoicesTable.type,
      status: invoicesTable.status,
      arApAccountId: invoicesTable.arApAccountId,
      vatAccountId: invoicesTable.vatAccountId,
      linkedEntryId: invoicesTable.linkedEntryId,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      updatedAt: invoicesTable.updatedAt,
      sourceDocumentId: invoicesTable.sourceDocumentId,
    })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)))
      .limit(1);
    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.type !== "received") { res.status(400).json({ error: "Ujemanje je možno samo s prejetim računom" }); return; }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: "Z ERP prejemnico je mogoče ujeti samo osnutek prejetega računa" });
      return;
    }
    if (invoice.linkedEntryId) {
      res.status(409).json({
        error: "Račun že ima finančno temeljnico; ponovno knjiženje obveznosti na K 220 ni dovoljeno",
      });
      return;
    }
    let sharedSourceDocumentId: string | null;
    try {
      sharedSourceDocumentId = resolveGoodsReceiptInvoiceSource(
        gr.sourceDocumentId,
        invoice.sourceDocumentId,
      );
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === "MATCH_SOURCE_MISMATCH"
          || error.message === "MATCH_SOURCE_IDENTITY_MISSING"
        )
      ) {
        res.status(409).json({
          error: "ERP prejemnica in račun ne predstavljata iste identificirane izvorne listine",
        });
        return;
      }
      throw error;
    }

    const invoiceAmountRows = await db
      .select({
        quantity: invoiceLinesTable.quantity,
        unitPrice: invoiceLinesTable.unitPrice,
        vatRate: invoiceLinesTable.vatRate,
        vatAmount: invoiceLinesTable.vatAmount,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoiceId));
    const { net: invoiceNet, vat: vatAmount, gross: invoiceGross } =
      calculateGoodsReceiptInvoiceMatch(invoiceAmountRows);
    if (!invoiceNet.eq(new Decimal(gr.totalAmount))) {
      res.status(409).json({
        error: "Neto znesek računa se ne ujema z odprto ERP prejemnico; samodejno knjiženje K 220 je zavrnjeno",
      });
      return;
    }
    const [validatedInputVatAccount] = vatAmount.gt(0)
      ? await db.select({ id: accountsTable.id })
          .from(accountsTable)
          .where(and(
            eq(accountsTable.companyId, companyId),
            eq(accountsTable.isActive, true),
            eq(accountsTable.allowsPosting, true),
            sql`${accountsTable.code} LIKE '160%'`,
            ...(invoice.vatAccountId ? [eq(accountsTable.id, invoice.vatAccountId)] : []),
          ))
          .orderBy(accountsTable.code)
          .limit(1)
      : [];
    const inputVatAccountId = validatedInputVatAccount?.id ?? null;
    if (vatAmount.gt(0) && !inputVatAccountId) {
      res.status(400).json({ error: "Račun vsebuje DDV, vendar nima nastavljenega konta vhodnega DDV (160)" });
      return;
    }
    const positiveVatRates = [
      ...new Set(
        invoiceAmountRows
          .map((row) => Number(row.vatRate))
          .filter((rate) => rate > 0),
      ),
    ];
    const fursVatCodeByRate = new Map<number, string>();
    if (positiveVatRates.length > 0) {
      const fursVatCodes = await db.select({
        id: vatCodeTable.id,
        rate: vatCodeTable.rate,
      })
        .from(vatCodeTable)
        .where(and(
          eq(vatCodeTable.direction, "IN"),
          lte(vatCodeTable.validFrom, invoice.invoiceDate),
          or(isNull(vatCodeTable.validTo), gte(vatCodeTable.validTo, invoice.invoiceDate)),
        ))
        .orderBy(desc(vatCodeTable.validFrom));
      for (const code of fursVatCodes) {
        const rate = Number(code.rate);
        if (!fursVatCodeByRate.has(rate)) fursVatCodeByRate.set(rate, code.id);
      }
      const missingRates = positiveVatRates.filter((rate) => !fursVatCodeByRate.has(rate));
      if (missingRates.length > 0) {
        res.status(400).json({
          error: `Za vstopni DDV manjkajo FURS DDV kode za stopnje: ${missingRates.join(", ")}%.`,
        });
        return;
      }
    }

    const now = new Date();

    let result: string;
    try {
      result = await db.transaction(async (tx) => {
      if (sharedSourceDocumentId) {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtext(${sharedSourceDocumentId}))
        `);
      }
      // Isti advisory lock kot invoice PATCH/post. Če se je osnutek med
      // predogledom in prevzemom zaklepa spremenil, knjiženje zavrnemo.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`);
      const locked = await tx.execute(sql`
        SELECT status, source_document_id FROM goods_receipts
         WHERE id = ${id} AND company_id = ${companyId}
         FOR UPDATE
      `);
      const currentReceipt = locked.rows[0] as {
        status?: string;
        source_document_id?: string | null;
      } | undefined;
      if (currentReceipt?.status !== "open") {
        throw new Error("GOODS_RECEIPT_ALREADY_MATCHED");
      }
      const lockedInvoice = await tx.execute(sql`
        SELECT status, linked_entry_id, updated_at, source_document_id
          FROM invoices
         WHERE id = ${invoiceId} AND company_id = ${companyId}
         FOR UPDATE
      `);
      const currentInvoice = lockedInvoice.rows[0] as {
        status?: string;
        linked_entry_id?: string | null;
        updated_at?: Date | string;
        source_document_id?: string | null;
      } | undefined;
      if (
        currentInvoice?.status !== "draft"
        || currentInvoice.linked_entry_id
        || !currentInvoice.updated_at
        || new Date(currentInvoice.updated_at).getTime() !== invoice.updatedAt.getTime()
      ) {
        throw new Error("INVOICE_ALREADY_FINANCIALLY_CAPTURED");
      }
      let currentSharedSourceId: string | null;
      try {
        currentSharedSourceId = resolveGoodsReceiptInvoiceSource(
          currentReceipt.source_document_id ?? null,
          currentInvoice.source_document_id ?? null,
        );
      } catch {
        throw new Error("MATCH_SOURCE_CHANGED");
      }
      if (currentSharedSourceId !== sharedSourceDocumentId) {
        throw new Error("MATCH_SOURCE_CHANGED");
      }
      if (currentSharedSourceId) {
        const existingPosReceipt = await tx.execute(sql`
          SELECT p.id
            FROM prejemnice p
            JOIN enote e ON e.id = p.enota_id
           WHERE e.company_id = ${companyId}
             AND p.source_document_id = ${currentSharedSourceId}
           LIMIT 1
        `);
        if (existingPosReceipt.rows.length > 0) {
          throw new Error("MATCH_SOURCE_ALREADY_IN_POS");
        }
      }

      // Temeljnica: DR 221 (neto) + DR 160 (DDV) / CR 220 (bruto).
      const [matchEntry] = await tx.insert(journalEntriesTable).values({
        companyId,
        periodId: gr.periodId,
        entryDate: invoice.invoiceDate,
        documentDate: invoice.invoiceDate,
        taxDate: invoice.invoiceDate,
        receiptDate: invoice.invoiceDate,
        description: `Zapiranje prehod. konta — ${gr.deliveryNoteNo} → ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        status: "posted",
        postedAt: now,
        sourceType: "document",
        approvedBy: auth.clerkUserId,
        createdBy: auth.clerkUserId,
      }).returning({ id: journalEntriesTable.id });

      const matchLines: (typeof journalEntryLinesTable.$inferInsert)[] = [
        ...invoiceAmountRows.map((row, index) => {
          const baseAmount = new Decimal(row.quantity).mul(row.unitPrice).toDecimalPlaces(2);
          const rate = Number(row.vatRate);
          const calculatedVat = baseAmount.mul(row.vatRate).div(100).toDecimalPlaces(2);
          return {
          entryId: matchEntry.id,
          accountId: gr.transitAccountId,
          side: "debit",
          amount: baseAmount.toFixed(2),
          description: `Zapiranje 221 — ${gr.deliveryNoteNo}`,
          sequence: index,
          partnerId: gr.counterpartyId,
          vatCodeId: rate > 0 ? fursVatCodeByRate.get(rate)! : null,
          vatAmount: rate > 0 ? new Decimal(row.vatAmount ?? calculatedVat).toFixed(2) : null,
          } as const;
        }),
      ];
      if (vatAmount.gt(0)) {
        matchLines.push({
            entryId: matchEntry.id,
            accountId: inputVatAccountId!,
            side: "debit",
            amount: vatAmount.toFixed(2),
            description: `Vstopni DDV — ${invoice.invoiceNumber}`,
            sequence: invoiceAmountRows.length,
            partnerId: gr.counterpartyId,
        });
      }
      matchLines.push({
          entryId: matchEntry.id,
          accountId: invoice.arApAccountId,
          side: "credit",
          amount: invoiceGross.toFixed(2),
          description: `Obveznosti — ${invoice.invoiceNumber}`,
          sequence: invoiceAmountRows.length + (vatAmount.gt(0) ? 1 : 0),
          partnerId: gr.counterpartyId,
      });
      await tx.insert(journalEntryLinesTable).values(matchLines);
      const vatLedgerLines: VatLine[] = invoiceAmountRows
        .flatMap((row, index): VatLine[] => {
          const rate = Number(row.vatRate);
          const vatCodeId = rate > 0 ? fursVatCodeByRate.get(rate) : null;
          if (!vatCodeId) return [];
          const baseAmount = new Decimal(row.quantity).mul(row.unitPrice).toDecimalPlaces(2);
          const calculatedVat = baseAmount.mul(row.vatRate).div(100).toDecimalPlaces(2);
          return [{
            lineId: `goods-receipt-match-${id}-${index}`,
            vatCodeId,
            amount: baseAmount.toFixed(2),
            vatAmount: new Decimal(row.vatAmount ?? calculatedVat).toFixed(2),
            vatDeductionPercent: "100.00",
            partnerId: gr.counterpartyId,
            description: `Prejeti račun ${invoice.invoiceNumber}`,
          }];
        });
      if (vatLedgerLines.length > 0) {
        const entryMeta: EntryMeta = {
          id: matchEntry.id,
          companyId,
          documentDate: invoice.invoiceDate,
          entryDate: invoice.invoiceDate,
          taxDate: invoice.invoiceDate,
          receiptDate: invoice.invoiceDate,
          reference: invoice.invoiceNumber,
          sourceType: "document",
        };
        await createVatLedgerEntries(
          tx,
          entryMeta,
          vatLedgerLines,
          auth.clerkUserId,
          invoiceId,
        );
      }

      // Posodobi prejemnico
      await tx.update(goodsReceiptsTable)
        .set({ status: "matched", matchedInvoiceId: invoiceId, matchEntryId: matchEntry.id })
        .where(eq(goodsReceiptsTable.id, id));
      await tx.update(invoicesTable)
        .set({ status: "posted", linkedEntryId: matchEntry.id })
        .where(and(
          eq(invoicesTable.id, invoiceId),
          eq(invoicesTable.companyId, companyId),
        ));

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "goods_receipt",
        entityId: id,
        action: "match",
        changedBy: auth.clerkUserId,
        payload: { invoiceId, matchEntryId: matchEntry.id },
      });

      return matchEntry.id;
      });
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === "GOODS_RECEIPT_ALREADY_MATCHED"
          || error.message === "INVOICE_ALREADY_FINANCIALLY_CAPTURED"
          || error.message === "MATCH_SOURCE_CHANGED"
          || error.message === "MATCH_SOURCE_ALREADY_IN_POS"
        )
      ) {
        res.status(409).json({
          error: "Prejemnica ali račun je bil medtem že finančno zajet; dvojni K 220 ni dovoljen",
        });
        return;
      }
      throw error;
    }

    const full = await fetchReceipt(id, companyId);
    res.json({ ...full, matchEntryId: result });
  },
);

// ─── DELETE /companies/:companyId/goods-receipts/:id/match ───────────────────

router.delete(
  "/companies/:companyId/goods-receipts/:id/match",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "accountant");
    if (!access) return;

    const [gr] = await db.select()
      .from(goodsReceiptsTable)
      .where(and(eq(goodsReceiptsTable.id, id), eq(goodsReceiptsTable.companyId, companyId)))
      .limit(1);
    if (!gr) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
    if (gr.status !== "matched") { res.status(400).json({ error: "Samo ujete prejemnice se lahko razveže" }); return; }
    if (!gr.matchEntryId) { res.status(400).json({ error: "Ni najdene match temeljnice za storniranje" }); return; }
    if (!gr.matchedInvoiceId) { res.status(400).json({ error: "Ni najdenega povezanega računa za razvezavo" }); return; }
    const matchEntryId = gr.matchEntryId;
    const matchedInvoiceId = gr.matchedInvoiceId;

    // Storniraj match temeljnico
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${matchedInvoiceId}))`);
      const lockedReceipt = await tx.execute(sql`
        SELECT status, matched_invoice_id, match_entry_id
          FROM goods_receipts
         WHERE id = ${id} AND company_id = ${companyId}
         FOR UPDATE
      `);
      const currentReceipt = lockedReceipt.rows[0] as {
        status?: string;
        matched_invoice_id?: string | null;
        match_entry_id?: string | null;
      } | undefined;
      if (
        currentReceipt?.status !== "matched"
        || currentReceipt.matched_invoice_id !== matchedInvoiceId
        || currentReceipt.match_entry_id !== matchEntryId
      ) {
        throw new Error("GOODS_RECEIPT_UNMATCH_CHANGED");
      }
      const lockedInvoice = await tx.execute(sql`
        SELECT linked_entry_id
          FROM invoices
         WHERE id = ${matchedInvoiceId} AND company_id = ${companyId}
         FOR UPDATE
      `);
      if (
        (lockedInvoice.rows[0] as { linked_entry_id?: string | null } | undefined)?.linked_entry_id
        !== matchEntryId
      ) {
        throw new Error("INVOICE_UNMATCH_LINK_CHANGED");
      }
      const [original] = await tx.select()
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, matchEntryId))
        .limit(1);
      if (!original) throw new Error("Match temeljnica ni najdena");

      const originalLines = await tx.select()
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, matchEntryId));

      // Ustvari storno temeljnico (obrnjene strani)
      const [reversal] = await tx.insert(journalEntriesTable).values({
        companyId,
        periodId: original.periodId,
        entryDate: now.toISOString().slice(0, 10),
        documentDate: now.toISOString().slice(0, 10),
        description: `Storno ujemanja — ${gr.deliveryNoteNo}`,
        reference: original.reference,
        status: "posted",
        postedAt: now,
        sourceType: "document",
        reversalOf: matchEntryId,
        approvedBy: auth.clerkUserId,
        createdBy: auth.clerkUserId,
      }).returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values(
        originalLines.map((l, i) => ({
          entryId: reversal.id,
          accountId: l.accountId,
          side: l.side === "debit" ? "credit" as const : "debit" as const,
          amount: l.amount,
          description: l.description,
          sequence: i,
          partnerId: l.partnerId,
        }))
      );
      await reverseVatLedgerEntries(
        tx,
        matchEntryId,
        reversal.id,
        auth.clerkUserId,
        now.toISOString().slice(0, 10),
      );

      await tx.update(goodsReceiptsTable)
        .set({ status: "open", matchedInvoiceId: null, matchEntryId: null })
        .where(eq(goodsReceiptsTable.id, id));
      await tx.update(invoicesTable)
        .set({ status: "draft", linkedEntryId: null })
        .where(and(
          eq(invoicesTable.id, matchedInvoiceId),
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.linkedEntryId, matchEntryId),
        ));

      await tx.insert(auditLogTable).values({
        companyId, entityType: "goods_receipt", entityId: id,
        action: "unmatch", changedBy: auth.clerkUserId,
        payload: { reversalId: reversal.id },
      });
      });
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === "GOODS_RECEIPT_UNMATCH_CHANGED"
          || error.message === "INVOICE_UNMATCH_LINK_CHANGED"
        )
      ) {
        res.status(409).json({
          error: "Povezava prejemnice in računa se je medtem spremenila; razvezava ni bila izvedena",
        });
        return;
      }
      throw error;
    }

    const full = await fetchReceipt(id, companyId);
    res.json(full);
  },
);

// ─── POST /companies/:companyId/goods-receipts/:id/void ──────────────────────

router.post(
  "/companies/:companyId/goods-receipts/:id/void",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "accountant");
    if (!access) return;

    const [gr] = await db.select()
      .from(goodsReceiptsTable)
      .where(and(eq(goodsReceiptsTable.id, id), eq(goodsReceiptsTable.companyId, companyId)))
      .limit(1);
    if (!gr) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
    if (gr.status === "voided") { res.status(400).json({ error: "Prejemnica je že preklicana" }); return; }
    if (gr.status === "matched") { res.status(400).json({ error: "Ujeta prejemnica se ne more preklicati. Najprej razveži ujemanje." }); return; }

    const now = new Date();
    await db.transaction(async (tx) => {
      // Storniraj linked_entry_id
      if (gr.linkedEntryId) {
        const originalLines = await tx.select()
          .from(journalEntryLinesTable)
          .where(eq(journalEntryLinesTable.entryId, gr.linkedEntryId));

        const [reversal] = await tx.insert(journalEntriesTable).values({
          companyId,
          periodId: gr.periodId,
          entryDate: now.toISOString().slice(0, 10),
          documentDate: now.toISOString().slice(0, 10),
          description: `Storno prejemnice ${gr.deliveryNoteNo}`,
          reference: gr.deliveryNoteNo,
          status: "posted",
          postedAt: now,
          sourceType: "document",
          reversalOf: gr.linkedEntryId,
          approvedBy: auth.clerkUserId,
          createdBy: auth.clerkUserId,
        }).returning({ id: journalEntriesTable.id });

        await tx.insert(journalEntryLinesTable).values(
          originalLines.map((l, i) => ({
            entryId: reversal.id,
            accountId: l.accountId,
            side: l.side === "debit" ? "credit" as const : "debit" as const,
            amount: l.amount,
            description: l.description,
            sequence: i,
            partnerId: l.partnerId,
          }))
        );
      }

      await tx.update(goodsReceiptsTable)
        .set({ status: "voided" })
        .where(eq(goodsReceiptsTable.id, id));

      await tx.insert(auditLogTable).values({
        companyId, entityType: "goods_receipt", entityId: id,
        action: "void", changedBy: auth.clerkUserId, payload: {},
      });
    });

    const full = await fetchReceipt(id, companyId);
    res.json(full);
  },
);

export default router;
