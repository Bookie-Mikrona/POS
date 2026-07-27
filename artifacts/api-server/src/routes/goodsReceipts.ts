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
import { and, eq, inArray, desc } from "drizzle-orm";
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
  auditLogTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

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
    const result = await db.transaction(async (tx) => {
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

    // Naloži račun (mora biti prejeti, posted, istega podjetja)
    const [invoice] = await db.select({ id: invoicesTable.id, type: invoicesTable.type, status: invoicesTable.status, arApAccountId: invoicesTable.arApAccountId, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)))
      .limit(1);
    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.type !== "received") { res.status(400).json({ error: "Ujemanje je možno samo s prejetim računom" }); return; }
    if (invoice.status !== "posted") { res.status(400).json({ error: "Račun mora biti poknjižen (status: posted)" }); return; }

    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Temeljnica: DR transitAccountId (221) / CR invoice.arApAccountId (220)
      const [matchEntry] = await tx.insert(journalEntriesTable).values({
        companyId,
        periodId: gr.periodId,
        entryDate: now.toISOString().slice(0, 10),
        documentDate: now.toISOString().slice(0, 10),
        description: `Zapiranje prehod. konta — ${gr.deliveryNoteNo} → ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        status: "posted",
        postedAt: now,
        sourceType: "document",
        approvedBy: auth.clerkUserId,
        createdBy: auth.clerkUserId,
      }).returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values([
        {
          entryId: matchEntry.id,
          accountId: gr.transitAccountId,
          side: "debit",
          amount: gr.totalAmount,
          description: `Zapiranje 221 — ${gr.deliveryNoteNo}`,
          sequence: 0,
          partnerId: gr.counterpartyId,
        },
        {
          entryId: matchEntry.id,
          accountId: invoice.arApAccountId,
          side: "credit",
          amount: gr.totalAmount,
          description: `Obveznosti — ${invoice.invoiceNumber}`,
          sequence: 1,
          partnerId: gr.counterpartyId,
        },
      ]);

      // Posodobi prejemnico
      await tx.update(goodsReceiptsTable)
        .set({ status: "matched", matchedInvoiceId: invoiceId, matchEntryId: matchEntry.id })
        .where(eq(goodsReceiptsTable.id, id));

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

    // Storniraj match temeljnico
    const now = new Date();
    await db.transaction(async (tx) => {
      const [original] = await tx.select()
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, gr.matchEntryId!))
        .limit(1);
      if (!original) throw new Error("Match temeljnica ni najdena");

      const originalLines = await tx.select()
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, gr.matchEntryId!));

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
        reversalOf: gr.matchEntryId,
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

      await tx.update(goodsReceiptsTable)
        .set({ status: "open", matchedInvoiceId: null, matchEntryId: null })
        .where(eq(goodsReceiptsTable.id, id));

      await tx.insert(auditLogTable).values({
        companyId, entityType: "goods_receipt", entityId: id,
        action: "unmatch", changedBy: auth.clerkUserId,
        payload: { reversalId: reversal.id },
      });
    });

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
