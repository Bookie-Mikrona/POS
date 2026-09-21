import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  artikliTable, db, enoteTable, kategorijeTable, posEventMenuItemsTable,
  posEventsTable, posEventStaffGrantsTable, posEventUnitsTable, posStockTransferLinesTable,
  posStockTransfersTable, posUporabnikiTable, zalogaGibiTable, zalogeTable,
  normativiTable, artModSkupineTable, modSkupineTable, modifikatorjiTable, modNormativiTable,
  POS_EVENT_TYPES,
  POS_STOCK_TRANSFER_DIRECTIONS, POS_STOCK_TRANSFER_STATUSES,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import {
  isEventStatusTransitionAllowed,
  isStockTransferStatusTransitionAllowed,
  POS_EVENT_STATUSES,
  type PosEventStatus,
} from "../../lib/eventPolicy";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { parseStrictDateTime, validateTemporaryPeriod } from "../../lib/temporaryUnitValidation";

const router: IRouter = Router();
const EVENT_TYPES = new Set<string>(POS_EVENT_TYPES);
const EVENT_STATUSES = new Set<string>(POS_EVENT_STATUSES);
const [OUTBOUND_TRANSFER, RETURN_TRANSFER] = POS_STOCK_TRANSFER_DIRECTIONS;
const [DRAFT_TRANSFER, COMPLETED_TRANSFER] = POS_STOCK_TRANSFER_STATUSES;

type EventBody = {
  name?: string;
  type?: string;
  status?: string;
  location?: string;
  customerName?: string | null;
  customerContact?: string | null;
  startsAt?: string;
  endsAt?: string;
  notes?: string | null;
  linkedUnitIds?: number[];
};

function validateBody(body: EventBody, partial = false): string | null {
  if (!partial && !body.name?.trim()) return "Naziv dogodka je obvezen.";
  if (!partial && !body.location?.trim()) return "Lokacija dogodka je obvezna.";
  if (partial && body.name !== undefined && !body.name.trim()) return "Naziv dogodka je obvezen.";
  if (partial && body.location !== undefined && !body.location.trim()) return "Lokacija dogodka je obvezna.";
  if ((!partial || body.type !== undefined) && !EVENT_TYPES.has(body.type ?? "")) return "Vrsta dogodka ni veljavna.";
  if (body.status !== undefined && !EVENT_STATUSES.has(body.status)) return "Status dogodka ni veljaven.";
  if (!partial && (!body.startsAt || !body.endsAt)) return "Začetek in konec dogodka sta obvezna.";
  if (body.startsAt !== undefined || body.endsAt !== undefined) {
    const period = validateTemporaryPeriod(body.startsAt, body.endsAt, true);
    if (period.error) return period.error;
  }
  if (body.linkedUnitIds !== undefined && (
    !Array.isArray(body.linkedUnitIds)
    || body.linkedUnitIds.some(id => !Number.isInteger(id) || id <= 0)
  )) return "Seznam povezanih enot ni veljaven.";
  return null;
}

async function visibleEventIds(enotaId: number): Promise<number[]> {
  const links = await db.select({ eventId: posEventUnitsTable.eventId })
    .from(posEventUnitsTable)
    .where(eq(posEventUnitsTable.enotaId, enotaId));
  return links.map(link => link.eventId);
}

async function getVisibleEvent(eventId: number, enotaId: number) {
  const linkedIds = await visibleEventIds(enotaId);
  const [event] = await db.select().from(posEventsTable).where(and(
    eq(posEventsTable.id, eventId),
    or(eq(posEventsTable.enotaId, enotaId), inArray(posEventsTable.id, linkedIds.length ? linkedIds : [-1])),
  )).limit(1);
  return event;
}

async function getOwnedEvent(eventId: number, enotaId: number) {
  const [event] = await db.select().from(posEventsTable).where(and(
    eq(posEventsTable.id, eventId),
    eq(posEventsTable.enotaId, enotaId),
  )).limit(1);
  return event;
}

function canManage(req: Request): boolean {
  return ["admin", "admin_enote", "superadmin"].includes((req as PosRequest).vloga);
}

async function withLinkedUnits<T extends { id: number }>(events: T[]) {
  if (events.length === 0) return [];
  const links = await db.select({
    eventId: posEventUnitsTable.eventId,
    id: enoteTable.id,
    ime: enoteTable.ime,
    isTemporary: enoteTable.isTemporary,
  }).from(posEventUnitsTable)
    .innerJoin(enoteTable, eq(enoteTable.id, posEventUnitsTable.enotaId))
    .where(inArray(posEventUnitsTable.eventId, events.map(event => event.id)));
  return events.map(event => ({
    ...event,
    linkedUnits: links.filter(link => link.eventId === event.id).map(({ eventId: _, ...unit }) => unit),
  }));
}

async function validateLinkedUnits(ids: number[], companyId: string): Promise<boolean> {
  if (ids.length === 0) return true;
  const unique = [...new Set(ids)];
  const rows = await db.select({ id: enoteTable.id }).from(enoteTable).where(and(
    eq(enoteTable.companyId, companyId),
    inArray(enoteTable.id, unique),
  ));
  return rows.length === unique.length;
}

async function buildPreparationPreview(
  eventId: number,
  sourceUnitId: number,
  targetUnitId: number,
  articleIds: number[],
  quantities: Record<string, number>,
) {
  const sourceArticles = articleIds.length ? await db.select().from(artikliTable).where(and(
    eq(artikliTable.enotaId, sourceUnitId), inArray(artikliTable.id, articleIds),
  )) : [];
  const selected = new Set(sourceArticles.map(article => article.id));
  const categoryIds = new Set(sourceArticles.map(article => article.kategorijaId).filter((id): id is number => id != null));
  const norms = sourceArticles.length ? await db.select().from(normativiTable)
    .where(inArray(normativiTable.artikelId, sourceArticles.map(article => article.id))) : [];
  const bindings = sourceArticles.length ? await db.select().from(artModSkupineTable)
    .where(inArray(artModSkupineTable.artikelId, sourceArticles.map(article => article.id))) : [];
  const groupIds = [...new Set(bindings.map(binding => binding.skupinaId))];
  const modifiers = groupIds.length ? await db.select().from(modifikatorjiTable)
    .where(inArray(modifikatorjiTable.skupinaId, groupIds)) : [];
  const modifierNorms = modifiers.length ? await db.select().from(modNormativiTable)
    .where(inArray(modNormativiTable.modifikatorId, modifiers.map(modifier => modifier.id))) : [];
  const missingIds = [...new Set([
    ...norms.map(norm => norm.vhodniArtikelId),
    ...modifierNorms.map(norm => norm.vhodniArtikelId),
    ...sourceArticles.flatMap(article => [...article.privzetiDodatki, ...article.privzetiModifikatorji, ...article.toGoArtikli]),
  ].filter(id => !selected.has(id)))];
  const missing = missingIds.length ? await db.select({ id: artikliTable.id, name: artikliTable.ime })
    .from(artikliTable).where(and(eq(artikliTable.enotaId, sourceUnitId), inArray(artikliTable.id, missingIds))) : [];
  const stocks = sourceArticles.length ? await db.select().from(zalogeTable)
    .where(inArray(zalogeTable.artikelId, sourceArticles.map(article => article.id))) : [];
  const stockMap = new Map(stocks.map(stock => [stock.artikelId, stock]));
  const allStockLines = sourceArticles.map(article => {
    const quantity = Number(quantities[String(article.id)] ?? 0);
    const available = Number(stockMap.get(article.id)?.kolicina ?? 0);
    const unitCost = Number(stockMap.get(article.id)?.povprecnaCena ?? 0);
    return { articleId: article.id, name: article.ime, quantity, available, unitCost, value: quantity * unitCost };
  });
  const stockLines = allStockLines.filter(line => line.quantity > 0);
  const invalidStock = allStockLines.filter(line => !Number.isFinite(line.quantity) || line.quantity < 0 || line.quantity > line.available);
  const [existing] = await db.select({ id: posStockTransfersTable.id }).from(posStockTransfersTable).where(and(
    eq(posStockTransfersTable.eventId, eventId),
    eq(posStockTransfersTable.targetUnitId, targetUnitId),
    eq(posStockTransfersTable.direction, OUTBOUND_TRANSFER),
  )).limit(1);
  const warnings = [
    ...missing.map(article => `Izberite tudi povezani artikel: ${article.name}.`),
    ...missingIds.filter(id => !missing.some(article => article.id === id)).map(id => `Povezani artikel #${id} ni na voljo v izvorni enoti.`),
    ...invalidStock.map(line => line.quantity < 0 || !Number.isFinite(line.quantity)
      ? `Količina za ${line.name} ni veljavna.`
      : `Za ${line.name} je na voljo samo ${line.available}.`),
    ...(sourceArticles.length !== articleIds.length ? ["Izbor vsebuje neveljaven artikel."] : []),
  ];
  return {
    canPrepare: warnings.length === 0 && articleIds.length > 0 && !existing,
    alreadyPrepared: Boolean(existing),
    counts: {
      categories: categoryIds.size,
      articles: sourceArticles.length,
      norms: norms.length,
      modifierGroups: groupIds.length,
      modifiers: modifiers.length,
      modifierNorms: modifierNorms.length,
      staff: 0,
    },
    stockLines,
    stockTotalQuantity: stockLines.reduce((sum, line) => sum + line.quantity, 0),
    stockTotalValue: stockLines.reduce((sum, line) => sum + line.value, 0),
    missingArticleIds: missingIds,
    warnings,
  };
}

async function ensureReturnTransfers(event: typeof posEventsTable.$inferSelect, actor: string): Promise<void> {
  const outbound = await db.select().from(posStockTransfersTable).where(and(
    eq(posStockTransfersTable.eventId, event.id),
    eq(posStockTransfersTable.direction, OUTBOUND_TRANSFER),
    eq(posStockTransfersTable.status, "completed"),
  ));
  for (const original of outbound) {
    await db.transaction(async tx => {
      const [existing] = await tx.select({ id: posStockTransfersTable.id }).from(posStockTransfersTable).where(and(
        eq(posStockTransfersTable.eventId, event.id),
        eq(posStockTransfersTable.sourceUnitId, original.targetUnitId),
        eq(posStockTransfersTable.targetUnitId, original.sourceUnitId),
        eq(posStockTransfersTable.direction, RETURN_TRANSFER),
      )).limit(1);
      if (existing) return;
      const originalLines = await tx.select().from(posStockTransferLinesTable)
        .where(eq(posStockTransferLinesTable.transferId, original.id));
      const targetIds = originalLines.map(line => line.targetArticleId);
      const balances = targetIds.length
        ? await tx.select().from(zalogeTable).where(inArray(zalogeTable.artikelId, targetIds)) : [];
      const balanceMap = new Map(balances.map(row => [row.artikelId, Number(row.kolicina)]));
      const [returned] = await tx.insert(posStockTransfersTable).values({
        companyId: original.companyId, eventId: event.id,
        sourceUnitId: original.targetUnitId, targetUnitId: original.sourceUnitId,
        direction: RETURN_TRANSFER, status: DRAFT_TRANSFER, returnOfId: original.id, createdBy: actor,
      }).returning();
      const lines = originalLines.map(line => ({
        companyId: returned.companyId,
        transferId: returned.id,
        sourceUnitId: returned.sourceUnitId,
        targetUnitId: returned.targetUnitId,
        sourceArticleId: line.targetArticleId,
        targetArticleId: line.sourceArticleId,
        quantity: String(Math.max(0, Math.min(Number(line.quantity), balanceMap.get(line.targetArticleId) ?? 0))),
        unitCost: line.unitCost,
      })).filter(line => Number(line.quantity) > 0);
      if (lines.length) await tx.insert(posStockTransferLinesTable).values(lines);
    });
  }
}

router.get("/pos-events/:id/preparation-options", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, companyId } = req as PosRequest;
  const id = Number(req.params.id);
  const event = await getOwnedEvent(id, enotaId);
  if (!event || !canManage(req)) { res.status(404).json({ napaka: "Dogodek ni najden." }); return; }
  const [articles, users, units, transfers] = await Promise.all([
    db.select({
      id: artikliTable.id, name: artikliTable.ime, categoryId: artikliTable.kategorijaId,
      categoryName: kategorijeTable.ime, stock: zalogeTable.kolicina,
    }).from(artikliTable)
      .leftJoin(kategorijeTable, eq(kategorijeTable.id, artikliTable.kategorijaId))
      .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
      .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.aktiven, true))),
    db.select({ id: posUporabnikiTable.id, name: sql<string>`${posUporabnikiTable.ime} || ' ' || ${posUporabnikiTable.priimek}` })
      .from(posUporabnikiTable).where(and(eq(posUporabnikiTable.companyId, companyId), eq(posUporabnikiTable.aktiven, true), eq(posUporabnikiTable.vloga, "uporabnik"))),
    db.select({ id: enoteTable.id, name: enoteTable.ime }).from(posEventUnitsTable)
      .innerJoin(enoteTable, eq(enoteTable.id, posEventUnitsTable.enotaId))
      .where(and(eq(posEventUnitsTable.eventId, id), eq(enoteTable.isTemporary, true))),
    db.select().from(posStockTransfersTable).where(eq(posStockTransfersTable.eventId, id)),
  ]);
  res.json({ event, articles, users, units, transfers });
});

router.post("/pos-events/:id/preparation-preview", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, companyId } = req as PosRequest;
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const eventId = Number(req.params.id);
  const targetUnitId = Number(req.body?.targetUnitId);
  const articleIds = [...new Set((req.body?.articleIds ?? []).map(Number))] as number[];
  const staffUserIds = [...new Set((req.body?.staffUserIds ?? []).map(Number))] as number[];
  const quantities = (req.body?.quantities ?? {}) as Record<string, number>;
  const event = await getOwnedEvent(eventId, enotaId);
  const [target] = await db.select({ id: enoteTable.id }).from(posEventUnitsTable)
    .innerJoin(enoteTable, eq(enoteTable.id, posEventUnitsTable.enotaId))
    .where(and(eq(posEventUnitsTable.eventId, eventId), eq(enoteTable.id, targetUnitId),
      eq(enoteTable.companyId, companyId), eq(enoteTable.isTemporary, true))).limit(1);
  if (!event || !target) { res.status(404).json({ napaka: "Dogodek ali povezana začasna enota ni najdena." }); return; }
  const preview = await buildPreparationPreview(eventId, enotaId, targetUnitId, articleIds, quantities);
  const validStaff = staffUserIds.length ? await db.select({ id: posUporabnikiTable.id }).from(posUporabnikiTable).where(and(
    eq(posUporabnikiTable.companyId, companyId), eq(posUporabnikiTable.vloga, "uporabnik"),
    eq(posUporabnikiTable.aktiven, true), inArray(posUporabnikiTable.id, staffUserIds),
  )) : [];
  const staffWarning = validStaff.length === staffUserIds.length ? [] : ["Izbor osebja vsebuje neveljavnega uporabnika."];
  res.json({
    ...preview,
    canPrepare: preview.canPrepare && staffWarning.length === 0 && ["planned", "active"].includes(event.status),
    counts: { ...preview.counts, staff: validStaff.length },
    warnings: [
      ...preview.warnings,
      ...staffWarning,
      ...(!["planned", "active"].includes(event.status) ? ["Zaključenega ali preklicanega dogodka ni mogoče pripravljati."] : []),
    ],
  });
});

router.get("/pos-events/:id/transfer-history", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, companyId } = req as PosRequest;
  const eventId = Number(req.params.id);
  const event = await getOwnedEvent(eventId, enotaId);
  if (!event || !canManage(req)) { res.status(404).json({ napaka: "Dogodek ni najden." }); return; }
  const transfers = await db.select().from(posStockTransfersTable)
    .where(and(eq(posStockTransfersTable.eventId, eventId), eq(posStockTransfersTable.companyId, companyId)))
    .orderBy(posStockTransfersTable.createdAt);
  const transferIds = transfers.map(transfer => transfer.id);
  const lines = transferIds.length ? await db.select({
    id: posStockTransferLinesTable.id,
    transferId: posStockTransferLinesTable.transferId,
    sourceArticleId: posStockTransferLinesTable.sourceArticleId,
    targetArticleId: posStockTransferLinesTable.targetArticleId,
    quantity: posStockTransferLinesTable.quantity,
    unitCost: posStockTransferLinesTable.unitCost,
    sourceName: artikliTable.ime,
  }).from(posStockTransferLinesTable)
    .innerJoin(artikliTable, eq(artikliTable.id, posStockTransferLinesTable.sourceArticleId))
    .where(inArray(posStockTransferLinesTable.transferId, transferIds)) : [];
  const unitIds = [...new Set(transfers.flatMap(transfer => [transfer.sourceUnitId, transfer.targetUnitId]))];
  const units = unitIds.length ? await db.select({ id: enoteTable.id, name: enoteTable.ime })
    .from(enoteTable).where(and(eq(enoteTable.companyId, companyId), inArray(enoteTable.id, unitIds))) : [];
  const actors = [...new Set(transfers.map(transfer => transfer.createdBy))];
  const users = actors.length ? await db.select({
    clerkUserId: posUporabnikiTable.clerkUserId,
    name: sql<string>`${posUporabnikiTable.ime} || ' ' || ${posUporabnikiTable.priimek}`,
  }).from(posUporabnikiTable).where(and(eq(posUporabnikiTable.companyId, companyId), inArray(posUporabnikiTable.clerkUserId, actors))) : [];
  const outboundTargetIds = lines.filter(line => transfers.find(transfer => transfer.id === line.transferId)?.direction === OUTBOUND_TRANSFER)
    .map(line => line.targetArticleId);
  const balances = outboundTargetIds.length ? await db.select({ articleId: zalogeTable.artikelId, quantity: zalogeTable.kolicina })
    .from(zalogeTable).where(inArray(zalogeTable.artikelId, outboundTargetIds)) : [];
  const balanceByArticle = new Map(balances.map(balance => [balance.articleId, Number(balance.quantity)]));
  const returnByOriginal = new Map(transfers.filter(t => t.direction === RETURN_TRANSFER && t.returnOfId)
    .map(transfer => [transfer.returnOfId!, transfer]));
  const response = transfers.map(transfer => {
    const ownLines = lines.filter(line => line.transferId === transfer.id);
    const returned = transfer.direction === OUTBOUND_TRANSFER ? returnByOriginal.get(transfer.id) : undefined;
    const returnedLines = returned ? lines.filter(line => line.transferId === returned.id) : [];
    const completedReturnedByTarget = new Map(returned?.status === COMPLETED_TRANSFER
      ? returnedLines.map(line => [line.targetArticleId, Number(line.quantity)]) : []);
    const plannedReturnedByTarget = new Map(returned?.status === DRAFT_TRANSFER
      ? returnedLines.map(line => [line.targetArticleId, Number(line.quantity)]) : []);
    return {
      ...transfer,
      sourceUnitName: units.find(unit => unit.id === transfer.sourceUnitId)?.name ?? `#${transfer.sourceUnitId}`,
      targetUnitName: units.find(unit => unit.id === transfer.targetUnitId)?.name ?? `#${transfer.targetUnitId}`,
      createdByName: users.find(user => user.clerkUserId === transfer.createdBy)?.name ?? transfer.createdBy,
      totalQuantity: ownLines.reduce((sum, line) => sum + Number(line.quantity), 0),
      totalValue: ownLines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0),
      lines: ownLines.map(line => ({
        ...line,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        value: Number(line.quantity) * Number(line.unitCost),
        plannedReturnQuantity: transfer.direction === OUTBOUND_TRANSFER ? (plannedReturnedByTarget.get(line.sourceArticleId) ?? 0) : undefined,
        ...(transfer.direction === OUTBOUND_TRANSFER ? (() => {
          const sent = Number(line.quantity);
          const returnedQuantity = Math.min(sent, completedReturnedByTarget.get(line.sourceArticleId) ?? 0);
          const remainingQuantity = Math.min(
            Math.max(0, sent - returnedQuantity),
            Math.max(0, balanceByArticle.get(line.targetArticleId) ?? 0),
          );
          return {
            returnedQuantity,
            remainingQuantity,
            consumedQuantity: Math.max(0, sent - returnedQuantity - remainingQuantity),
          };
        })() : {}),
      })),
    };
  });
  res.json(response);
});

router.post("/pos-events/:id/prepare", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, companyId, clerkUserId } = req as PosRequest;
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const eventId = Number(req.params.id);
  const targetUnitId = Number(req.body?.targetUnitId);
  const articleIds = [...new Set((req.body?.articleIds ?? []).map(Number))] as number[];
  const staffUserIds = [...new Set((req.body?.staffUserIds ?? []).map(Number))] as number[];
  const quantities = (req.body?.quantities ?? {}) as Record<string, number>;
  const event = await getOwnedEvent(eventId, enotaId);
  if (!event || !Number.isInteger(targetUnitId) || articleIds.length === 0) {
    res.status(400).json({ napaka: "Dogodek, ciljna enota in artikli so obvezni." }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM pos_events WHERE id=${eventId} FOR UPDATE`);
      const [lockedEvent] = await tx.select({ status: posEventsTable.status }).from(posEventsTable)
        .where(and(eq(posEventsTable.id, eventId), eq(posEventsTable.enotaId, enotaId))).limit(1);
      if (!lockedEvent || !["planned", "active"].includes(lockedEvent.status)) {
        throw new Error("Zaključenega ali preklicanega dogodka ni mogoče pripravljati.");
      }
      const [linked] = await tx.select({ id: enoteTable.id }).from(posEventUnitsTable)
        .innerJoin(enoteTable, eq(enoteTable.id, posEventUnitsTable.enotaId))
        .where(and(eq(posEventUnitsTable.eventId, eventId), eq(enoteTable.id, targetUnitId),
          eq(enoteTable.companyId, companyId), eq(enoteTable.isTemporary, true))).limit(1);
      if (!linked) throw new Error("Ciljna enota ni povezana začasna enota dogodka.");
      const [existingTransfer] = await tx.select().from(posStockTransfersTable).where(and(
        eq(posStockTransfersTable.eventId, eventId), eq(posStockTransfersTable.targetUnitId, targetUnitId),
        eq(posStockTransfersTable.direction, OUTBOUND_TRANSFER),
      )).limit(1);
      if (existingTransfer) return { transferId: existingTransfer.id, reused: true };

      const sourceArticles = await tx.select().from(artikliTable).where(and(
        eq(artikliTable.enotaId, enotaId), inArray(artikliTable.id, articleIds),
      ));
      if (sourceArticles.length !== articleIds.length) throw new Error("Izbor vsebuje artikel iz druge enote.");
      const categoryIds = [...new Set(sourceArticles.map(a => a.kategorijaId).filter((id): id is number => id != null))];
      const sourceCategories = categoryIds.length
        ? await tx.select().from(kategorijeTable).where(inArray(kategorijeTable.id, categoryIds)) : [];
      const categoryMap = new Map<number, number>();
      for (const category of sourceCategories) {
        let [target] = await tx.select().from(kategorijeTable).where(and(
          eq(kategorijeTable.enotaId, targetUnitId), eq(kategorijeTable.ime, category.ime),
        )).limit(1);
        if (!target) [target] = await tx.insert(kategorijeTable).values({
          enotaId: targetUnitId, ime: category.ime, barva: category.barva,
          vrstniRed: category.vrstniRed, tip: category.tip, dnevnoFiltriranje: category.dnevnoFiltriranje,
        }).returning();
        categoryMap.set(category.id, target.id);
      }
      const articleMap = new Map<number, number>();
      const selectedSet = new Set(articleIds);
      for (const source of sourceArticles) {
        const references = [...source.privzetiDodatki, ...source.privzetiModifikatorji, ...source.toGoArtikli];
        if (references.some(reference => !selectedSet.has(reference))) {
          throw new Error(`Artikel ${source.ime} uporablja povezan artikel, ki ni izbran za prenos.`);
        }
        const { id: _id, enotaId: _unit, kategorijaId, privzetiDodatki: _a,
          privzetiModifikatorji: _m, toGoArtikli: _t, ...copy } = source;
        const [target] = await tx.insert(artikliTable).values({
          ...copy, enotaId: targetUnitId, kategorijaId: kategorijaId ? categoryMap.get(kategorijaId) : null,
          privzetiDodatki: [], privzetiModifikatorji: [], toGoArtikli: [],
        }).returning();
        articleMap.set(source.id, target.id);
        await tx.insert(posEventMenuItemsTable).values({
          companyId, eventId, sourceUnitId: enotaId, targetUnitId,
          sourceArticleId: source.id, targetArticleId: target.id,
        });
      }
      for (const source of sourceArticles) {
        await tx.update(artikliTable).set({
          privzetiDodatki: source.privzetiDodatki.map(id => articleMap.get(id)!),
          privzetiModifikatorji: source.privzetiModifikatorji.map(id => articleMap.get(id)!),
          toGoArtikli: source.toGoArtikli.map(id => articleMap.get(id)!),
        }).where(eq(artikliTable.id, articleMap.get(source.id)!));
      }

      const sourceNorms = await tx.select().from(normativiTable)
        .where(inArray(normativiTable.artikelId, articleIds));
      const missingNormArticle = sourceNorms.find(norm => !selectedSet.has(norm.vhodniArtikelId));
      if (missingNormArticle) {
        const ingredient = sourceArticles.find(article => article.id === missingNormArticle.vhodniArtikelId);
        throw new Error(`Normativ uporablja artikel ${ingredient?.ime ?? `#${missingNormArticle.vhodniArtikelId}`}, ki ni izbran za prenos.`);
      }
      if (sourceNorms.length) {
        const normativeParents = [...new Set(sourceNorms.map(norm => articleMap.get(norm.artikelId)!))].sort((a, b) => a - b);
        await tx.execute(sql`SELECT id FROM artikli WHERE id IN (${sql.join(normativeParents.map(id => sql`${id}`), sql`, `)}) FOR UPDATE`);
        await tx.insert(normativiTable).values(sourceNorms.map(norm => ({
          artikelId: articleMap.get(norm.artikelId)!,
          vhodniArtikelId: articleMap.get(norm.vhodniArtikelId)!,
          kolicina: norm.kolicina,
          vrstniRed: norm.vrstniRed,
        })));
        await tx.update(artikliTable).set({ normativRevision: sql`${artikliTable.normativRevision} + 1` })
          .where(inArray(artikliTable.id, normativeParents));
      }

      const sourceBindings = await tx.select().from(artModSkupineTable)
        .where(inArray(artModSkupineTable.artikelId, articleIds));
      const sourceGroupIds = [...new Set(sourceBindings.map(binding => binding.skupinaId))];
      if (sourceGroupIds.length) {
        const sourceGroups = await tx.select().from(modSkupineTable).where(and(
          eq(modSkupineTable.enotaId, enotaId),
          inArray(modSkupineTable.id, sourceGroupIds),
        ));
        if (sourceGroups.length !== sourceGroupIds.length) throw new Error("Izbor vsebuje skupino modifikatorjev iz druge enote.");
        const groupMap = new Map<number, number>();
        for (const group of sourceGroups) {
          const [target] = await tx.insert(modSkupineTable).values({
            enotaId: targetUnitId,
            ime: group.ime,
            obvezna: group.obvezna,
            minIzbir: group.minIzbir,
            maxIzbir: group.maxIzbir,
            vrstniRed: group.vrstniRed,
          }).returning();
          groupMap.set(group.id, target.id);
        }
        await tx.insert(artModSkupineTable).values(sourceBindings.map(binding => ({
          artikelId: articleMap.get(binding.artikelId)!,
          skupinaId: groupMap.get(binding.skupinaId)!,
          vrstniRed: binding.vrstniRed,
        })));

        const sourceModifiers = await tx.select().from(modifikatorjiTable)
          .where(inArray(modifikatorjiTable.skupinaId, sourceGroupIds));
        const modifierMap = new Map<number, number>();
        for (const modifier of sourceModifiers) {
          const [target] = await tx.insert(modifikatorjiTable).values({
            skupinaId: groupMap.get(modifier.skupinaId)!,
            ime: modifier.ime,
            cenaDodatek: modifier.cenaDodatek,
            aktiven: modifier.aktiven,
            vrstniRed: modifier.vrstniRed,
            addedSugar: modifier.addedSugar,
          }).returning();
          modifierMap.set(modifier.id, target.id);
        }
        if (sourceModifiers.length) {
          const sourceModNorms = await tx.select().from(modNormativiTable)
            .where(inArray(modNormativiTable.modifikatorId, sourceModifiers.map(modifier => modifier.id)));
          const missingModIngredient = sourceModNorms.find(norm => !selectedSet.has(norm.vhodniArtikelId));
          if (missingModIngredient) {
            throw new Error(`Modifikator uporablja artikel #${missingModIngredient.vhodniArtikelId}, ki ni izbran za prenos.`);
          }
          if (sourceModNorms.length) {
            await tx.insert(modNormativiTable).values(sourceModNorms.map(norm => ({
              modifikatorId: modifierMap.get(norm.modifikatorId)!,
              vhodniArtikelId: articleMap.get(norm.vhodniArtikelId)!,
              kolicina: norm.kolicina,
              vrstniRed: norm.vrstniRed,
            })));
          }
        }
      }
      if (staffUserIds.length) {
        const validUsers = await tx.select({ id: posUporabnikiTable.id }).from(posUporabnikiTable).where(and(
          eq(posUporabnikiTable.companyId, companyId), eq(posUporabnikiTable.vloga, "uporabnik"),
          eq(posUporabnikiTable.aktiven, true), inArray(posUporabnikiTable.id, staffUserIds),
        ));
        if (validUsers.length !== staffUserIds.length) throw new Error("Izbor osebja vsebuje uporabnika drugega podjetja.");
        await tx.insert(posEventStaffGrantsTable).values(validUsers.map(user => ({
          companyId, eventId, posUserId: user.id, unitId: targetUnitId,
          validFrom: event.startsAt, validTo: event.endsAt,
        }))).onConflictDoNothing();
      }
      const orderedIds = [...articleIds].sort((a, b) => a - b);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(918273)`);
      await tx.execute(sql`SELECT artikel_id FROM zaloge WHERE artikel_id IN (${sql.join(orderedIds.map(id => sql`${id}`), sql`, `)}) ORDER BY artikel_id FOR UPDATE`);
      const stockRows = await tx.select().from(zalogeTable).where(inArray(zalogeTable.artikelId, orderedIds));
      const stockById = new Map(stockRows.map(row => [row.artikelId, row]));
      const transferLines = sourceArticles.map(source => {
        const quantity = Number(quantities[String(source.id)] ?? 0);
        const stock = stockById.get(source.id);
        if (!Number.isFinite(quantity) || quantity < 0 || quantity > Number(stock?.kolicina ?? 0)) {
          throw new Error(`Neveljavna zaloga za artikel ${source.ime}.`);
        }
        return { sourceArticleId: source.id, targetArticleId: articleMap.get(source.id)!, quantity, unitCost: Number(stock?.povprecnaCena ?? 0) };
      }).filter(line => line.quantity > 0);
      const [transfer] = await tx.insert(posStockTransfersTable).values({
        companyId, eventId, sourceUnitId: enotaId, targetUnitId, direction: OUTBOUND_TRANSFER,
        status: DRAFT_TRANSFER, createdBy: clerkUserId,
      }).returning();
      if (transferLines.length) {
        await tx.insert(posStockTransferLinesTable).values(transferLines.map(line => ({
          companyId, transferId: transfer.id, sourceUnitId: enotaId, targetUnitId,
          sourceArticleId: line.sourceArticleId, targetArticleId: line.targetArticleId,
          quantity: String(line.quantity), unitCost: String(line.unitCost),
        })));
        await tx.insert(zalogaGibiTable).values(transferLines.flatMap(line => [
          { artikelId: line.sourceArticleId, tip: "event_transfer_out", kolicina: String(-line.quantity), cenaKos: String(line.unitCost), vrednost: String(-line.quantity * line.unitCost), opomba: `Prenos na dogodek #${eventId}`, referencaId: transfer.id, eventTransferId: transfer.id, actorSnapshot: clerkUserId, effectiveAtSnapshot: transfer.createdAt, sourceSnapshot: "pos_event_transfer" },
          { artikelId: line.targetArticleId, tip: "event_transfer_in", kolicina: String(line.quantity), cenaKos: String(line.unitCost), vrednost: String(line.quantity * line.unitCost), opomba: `Prenos na dogodek #${eventId}`, referencaId: transfer.id, eventTransferId: transfer.id, actorSnapshot: clerkUserId, effectiveAtSnapshot: transfer.createdAt, sourceSnapshot: "pos_event_transfer" },
        ]));
        await recomputeZaloge(transferLines.flatMap(line => [line.sourceArticleId, line.targetArticleId]), tx);
      }
      await tx.update(posStockTransfersTable).set({
        status: COMPLETED_TRANSFER,
        completedAt: new Date(),
      }).where(eq(posStockTransfersTable.id, transfer.id));
      return { transferId: transfer.id, reused: false, copiedArticles: sourceArticles.length, grantedStaff: staffUserIds.length };
    });
    res.json(result);
  } catch (error) {
    res.status(409).json({ napaka: error instanceof Error ? error.message : "Priprava enote ni uspela." });
  }
});

router.get("/pos-events", async (req: Request, res: Response): Promise<void> => {
  const { enotaId } = req as PosRequest;
  const linkedIds = await visibleEventIds(enotaId);
  const events = await db.select().from(posEventsTable)
    .where(or(eq(posEventsTable.enotaId, enotaId), inArray(posEventsTable.id, linkedIds.length ? linkedIds : [-1])))
    .orderBy(posEventsTable.startsAt);
  res.json(await withLinkedUnits(events));
});

router.post("/pos-events", async (req: Request, res: Response): Promise<void> => {
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const { enotaId, companyId } = req as PosRequest;
  const body = req.body as EventBody;
  const error = validateBody(body);
  if (error) { res.status(400).json({ napaka: error }); return; }
  const linkedUnitIds = [...new Set([enotaId, ...(body.linkedUnitIds ?? [])])];
  if (!await validateLinkedUnits(linkedUnitIds, companyId)) {
    res.status(400).json({ napaka: "Ena od povezanih enot ne pripada izbranemu podjetju." });
    return;
  }
  const created = await db.transaction(async tx => {
    const [event] = await tx.insert(posEventsTable).values({
      companyId,
      enotaId,
      name: body.name!.trim(),
      type: body.type as any,
      status: (body.status as any) ?? "planned",
      location: body.location!.trim(),
      customerName: body.customerName?.trim() || null,
      customerContact: body.customerContact?.trim() || null,
      startsAt: parseStrictDateTime(body.startsAt!)!,
      endsAt: parseStrictDateTime(body.endsAt!)!,
      notes: body.notes?.trim() || null,
    }).returning();
    await tx.insert(posEventUnitsTable).values(linkedUnitIds.map(unitId => ({
      companyId,
      eventId: event.id,
      enotaId: unitId,
    })));
    const temporaryUnitIds = linkedUnitIds.filter(unitId => unitId !== enotaId);
    if (temporaryUnitIds.length > 0) {
      await tx.update(enoteTable).set({
        parentUnitId: enotaId,
        activeFrom: new Date(body.startsAt!),
        activeTo: new Date(body.endsAt!),
        temporaryLocation: body.location!.trim(),
      }).where(and(
        inArray(enoteTable.id, temporaryUnitIds),
        eq(enoteTable.companyId, companyId),
        eq(enoteTable.isTemporary, true),
      ));
    }
    return event;
  });
  res.status(201).json((await withLinkedUnits([created]))[0]);
});

router.patch("/pos-events/:id", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, companyId } = req as PosRequest;
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const id = Number(req.params.id);
  const body = req.body as EventBody;
  const current = Number.isInteger(id) ? await getOwnedEvent(id, enotaId) : null;
  if (!current) { res.status(404).json({ napaka: "Dogodek ni najden." }); return; }
  const error = validateBody({
    ...body,
    startsAt: body.startsAt ?? current.startsAt.toISOString(),
    endsAt: body.endsAt ?? current.endsAt.toISOString(),
  }, true);
  if (error) { res.status(400).json({ napaka: error }); return; }
  const nextStatus = body.status ?? current.status;
  if (!isEventStatusTransitionAllowed(current.status as PosEventStatus, nextStatus as PosEventStatus)) {
    res.status(409).json({ napaka: `Prehod statusa ${current.status} → ${nextStatus} ni dovoljen.` });
    return;
  }
  if (current.status === "closed" && Object.keys(body).some(key => key !== "status")) {
    res.status(409).json({ napaka: "Zaključenega dogodka ni več mogoče spreminjati." });
    return;
  }
  const linkedUnitIds = body.linkedUnitIds
    ? [...new Set([current.enotaId, ...body.linkedUnitIds])]
    : null;
  if (linkedUnitIds && !await validateLinkedUnits(linkedUnitIds, companyId)) {
    res.status(400).json({ napaka: "Ena od povezanih enot ne pripada izbranemu podjetju." });
    return;
  }
  const currentLinks = await db.select({ enotaId: posEventUnitsTable.enotaId })
    .from(posEventUnitsTable).where(eq(posEventUnitsTable.eventId, id));
  const finalLinkedUnitIds = linkedUnitIds ?? currentLinks.map(link => link.enotaId);
  const finalStartsAt = parseStrictDateTime(body.startsAt ?? current.startsAt)!;
  const finalEndsAt = parseStrictDateTime(body.endsAt ?? current.endsAt)!;
  const finalLocation = body.location?.trim() || current.location;
  const updated = await db.transaction(async tx => {
    const [event] = await tx.update(posEventsTable).set({
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.type !== undefined ? { type: body.type as any } : {}),
      ...(body.status !== undefined ? { status: body.status as any } : {}),
      ...(body.location !== undefined ? { location: body.location.trim() } : {}),
      ...(body.customerName !== undefined ? { customerName: body.customerName?.trim() || null } : {}),
      ...(body.customerContact !== undefined ? { customerContact: body.customerContact?.trim() || null } : {}),
      ...(body.startsAt !== undefined ? { startsAt: finalStartsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt: finalEndsAt } : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      updatedAt: new Date(),
    }).where(eq(posEventsTable.id, id)).returning();
    if (linkedUnitIds) {
      await tx.delete(posEventUnitsTable).where(eq(posEventUnitsTable.eventId, id));
      await tx.insert(posEventUnitsTable).values(linkedUnitIds.map(unitId => ({
        companyId,
        eventId: id,
        enotaId: unitId,
      })));
    }
    const temporaryUnitIds = finalLinkedUnitIds.filter(unitId => unitId !== current.enotaId);
    if (temporaryUnitIds.length > 0) {
      await tx.update(enoteTable).set({
        parentUnitId: current.enotaId,
        activeFrom: finalStartsAt,
        activeTo: finalEndsAt,
        temporaryLocation: finalLocation,
      }).where(and(
        inArray(enoteTable.id, temporaryUnitIds),
        eq(enoteTable.companyId, companyId),
        eq(enoteTable.isTemporary, true),
      ));
    }
    const removedUnitIds = currentLinks
      .map(link => link.enotaId)
      .filter(unitId => unitId !== current.enotaId && !finalLinkedUnitIds.includes(unitId));
    if (removedUnitIds.length > 0) {
      await tx.update(enoteTable).set({
        isTemporary: false,
        parentUnitId: null,
        activeFrom: null,
        activeTo: null,
        temporaryLocation: null,
      }).where(and(
        inArray(enoteTable.id, removedUnitIds),
        eq(enoteTable.companyId, companyId),
        eq(enoteTable.isTemporary, true),
        eq(enoteTable.parentUnitId, current.enotaId),
      ));
    }
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      await tx.update(posEventStaffGrantsTable).set({
        validFrom: finalStartsAt,
        validTo: finalEndsAt,
      }).where(eq(posEventStaffGrantsTable.eventId, id));
    }
    if (event.status === "closed" || event.status === "cancelled") {
      await tx.update(posEventStaffGrantsTable).set({ revoked: true }).where(and(
        eq(posEventStaffGrantsTable.eventId, id),
        eq(posEventStaffGrantsTable.revoked, false),
      ));
    }
    return event;
  });
  if (updated.status === "closed") await ensureReturnTransfers(updated, (req as PosRequest).clerkUserId);
  res.json((await withLinkedUnits([updated]))[0]);
});

router.post("/pos-events/:id/returns/:transferId/confirm", async (req: Request, res: Response): Promise<void> => {
  const { enotaId, clerkUserId } = req as PosRequest;
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const event = await getOwnedEvent(Number(req.params.id), enotaId);
  if (!event) { res.status(404).json({ napaka: "Dogodek ni najden." }); return; }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM pos_stock_transfers WHERE id=${Number(req.params.transferId)} FOR UPDATE`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(918273)`);
      const [transfer] = await tx.select().from(posStockTransfersTable).where(and(
        eq(posStockTransfersTable.id, Number(req.params.transferId)),
        eq(posStockTransfersTable.eventId, event.id),
        eq(posStockTransfersTable.direction, RETURN_TRANSFER),
      )).limit(1);
      if (!transfer) throw new Error("Povratni prenos ni najden.");
      if (transfer.status === COMPLETED_TRANSFER) return { transferId: transfer.id, reused: true };
      if (!isStockTransferStatusTransitionAllowed(transfer.status, COMPLETED_TRANSFER)) {
        throw new Error("Povratnega prenosa ni mogoče potrditi.");
      }
      const lines = await tx.select().from(posStockTransferLinesTable)
        .where(eq(posStockTransferLinesTable.transferId, transfer.id));
      if (lines.length) {
        const balances = await tx.select().from(zalogeTable).where(inArray(
          zalogeTable.artikelId, lines.map(line => line.sourceArticleId),
        ));
        const stock = new Map(balances.map(row => [row.artikelId, Number(row.kolicina)]));
        const insufficient = lines.find(line => Number(line.quantity) > (stock.get(line.sourceArticleId) ?? 0));
        if (insufficient) throw new Error("V začasni enoti ni več dovolj zaloge za pripravljen povratni prenos.");
        // The return becomes effective only on this confirmation; no earlier stable
        // business timestamp exists, so effectiveAtSnapshot uses the DB now() default.
        await tx.insert(zalogaGibiTable).values(lines.flatMap(line => [
          { artikelId: line.sourceArticleId, tip: "event_return_out", kolicina: String(-Number(line.quantity)), cenaKos: line.unitCost, vrednost: String(-Number(line.quantity) * Number(line.unitCost)), opomba: `Vračilo z dogodka #${event.id}`, referencaId: transfer.id, eventTransferId: transfer.id, actorSnapshot: clerkUserId, sourceSnapshot: "pos_event_return" },
          { artikelId: line.targetArticleId, tip: "event_return_in", kolicina: line.quantity, cenaKos: line.unitCost, vrednost: String(Number(line.quantity) * Number(line.unitCost)), opomba: `Vračilo z dogodka #${event.id}`, referencaId: transfer.id, eventTransferId: transfer.id, actorSnapshot: clerkUserId, sourceSnapshot: "pos_event_return" },
        ]));
        await recomputeZaloge(lines.flatMap(line => [line.sourceArticleId, line.targetArticleId]), tx);
      }
      await tx.update(posStockTransfersTable).set({ status: COMPLETED_TRANSFER, completedAt: new Date() })
        .where(eq(posStockTransfersTable.id, transfer.id));
      await tx.update(posEventStaffGrantsTable).set({ revoked: true })
        .where(eq(posEventStaffGrantsTable.eventId, event.id));
      return { transferId: transfer.id, reused: false, lines: lines.length };
    });
    res.json(result);
  } catch (error) {
    res.status(409).json({ napaka: error instanceof Error ? error.message : "Vračilo ni uspelo." });
  }
});

router.delete("/pos-events/:id", async (req: Request, res: Response): Promise<void> => {
  const { enotaId } = req as PosRequest;
  if (!canManage(req)) { res.status(403).json({ napaka: "Upravljanje dogodkov zahteva skrbniško vlogo." }); return; }
  const id = Number(req.params.id);
  const event = Number.isInteger(id) ? await getOwnedEvent(id, enotaId) : null;
  if (!event) { res.status(404).json({ napaka: "Dogodek ni najden." }); return; }
  if (event.status !== "planned") {
    res.status(409).json({ napaka: "Izbrisati je mogoče samo še nezačet načrtovan dogodek. Preklicani in zaključeni dogodki ostanejo v zgodovini." });
    return;
  }
  await db.transaction(async tx => {
    const links = await tx.select({ enotaId: posEventUnitsTable.enotaId })
      .from(posEventUnitsTable).where(eq(posEventUnitsTable.eventId, id));
    await tx.delete(posEventsTable).where(eq(posEventsTable.id, id));
    const temporaryUnitIds = links.map(link => link.enotaId).filter(unitId => unitId !== event.enotaId);
    if (temporaryUnitIds.length > 0) {
      await tx.update(enoteTable).set({
        isTemporary: false,
        parentUnitId: null,
        activeFrom: null,
        activeTo: null,
        temporaryLocation: null,
      }).where(and(
        inArray(enoteTable.id, temporaryUnitIds),
        eq(enoteTable.isTemporary, true),
        eq(enoteTable.parentUnitId, event.enotaId),
      ));
    }
  });
  res.status(204).send();
});

export default router;