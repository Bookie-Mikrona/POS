import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { slovenianCollated } from "../../lib/slovenian-collation";
import {
  artikliTable, companiesTable, db, enoteTable, normativiTable, postavkeTable,
  preparedFoodDailyLedgersTable, preparedFoodStocksTable, preparedFoodWasteRecordLinesTable,
  preparedFoodWasteRecordsTable, zalogaGibiTable, zalogeTable,
} from "@workspace/db";
import {
  ClosePreparedFoodDailyParams, ClosePreparedFoodDailyResponse,
  ConfirmPreparedFoodWasteRecordParams, ConfirmPreparedFoodWasteRecordResponse,
  CreatePreparedFoodWasteRecordBody, CreatePreparedFoodWasteRecordResponse,
  GetPreparedFoodConsumptionParams, GetPreparedFoodConsumptionQueryParams, GetPreparedFoodConsumptionResponse,
  GetPreparedFoodWasteRecordParams, GetPreparedFoodWasteRecordResponse,
  ListPreparedFoodDailyHistoryParams, ListPreparedFoodDailyHistoryResponse,
  ListPreparedFoodDailyParams, ListPreparedFoodDailyResponse,
  ListPreparedFoodWasteRecordsQueryParams, ListPreparedFoodWasteRecordsResponse,
  ListPreparedFoodStocksParams, ListPreparedFoodStocksResponse,
  PreviewPreparedFoodWasteRecordQueryParams, PreviewPreparedFoodWasteRecordResponse,
  SavePreparedFoodDailyBody, SavePreparedFoodDailyParams, SavePreparedFoodDailyResponse,
  UpdatePreparedFoodWasteRecordBody, UpdatePreparedFoodWasteRecordParams, UpdatePreparedFoodWasteRecordResponse,
  UpdatePreparedFoodStocksBody, UpdatePreparedFoodStocksParams, UpdatePreparedFoodStocksResponse,
  UpdatePreparedFoodStockBody, UpdatePreparedFoodStockParams, UpdatePreparedFoodStockResponse,
} from "@workspace/api-zod";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import {
  allocatePreparedFood,
  preparedMaterialQuantityForProduction,
  preparedMaterialUnitCost,
} from "../../lib/prepared-food-costing";
import {
  currentBusinessDate,
  loadPreparedFoodAvailability,
  loadModifierAvailabilitySnapshots,
  resolveModifierPortions,
} from "../../lib/prepared-food-availability";
import { getEnotaBusinessDayStart } from "../../lib/pos-business-day";
import { buildPreparedFoodWasteRecordPdf } from "../../lib/prepared-food-waste-pdf";
import { isPosBusinessDayClosed, lockPosBusinessDay } from "../../lib/pos-z-helpers";
import type { PosRequest } from "../../middlewares/pos";
import { preparedFoodUnitLabel } from "../../lib/prepared-food-units";
import { productionTotals } from "../../lib/preparation-batches";

const router: IRouter = Router();
const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const mapLedger = (
  row: typeof preparedFoodDailyLedgersTable.$inferSelect,
  options: { articleName?: string; unitOfMeasure?: string; editable?: boolean } = {},
) => ({
  id: row.id, enotaId: row.enotaId, businessDate: row.businessDate, artikelId: row.artikelId,
  thawedQuantity: Number(row.thawedQuantity), preparedQuantity: Number(row.preparedQuantity),
  preparationBatches: row.preparationBatches ?? null,
  normativeBatchPieces: row.normativeBatchPieces ?? null,
  correctionQuantity: Number(row.correctionQuantity),
  soldQuantity: Number(row.soldQuantity), frozenAtEndQuantity: Number(row.frozenAtEndQuantity),
  wasteQuantity: Number(row.wasteQuantity), wasteValue: row.wasteValue == null ? null : Number(row.wasteValue),
  wasteDeliveredQuantity: Number(row.wasteDeliveredQuantity),
  closedAt: row.closedAt?.toISOString() ?? null,
  articleName: options.articleName,
  unitOfMeasure: options.unitOfMeasure,
  editable: options.editable ?? false,
});
const mapStock = (row: typeof preparedFoodStocksTable.$inferSelect, articleName: string, unitOfMeasure: string | null) => ({
  id: row.id, enotaId: row.enotaId, artikelId: row.artikelId, articleName, year: row.year,
  unitOfMeasure: preparedFoodUnitLabel(unitOfMeasure),
  openingQuantity: Number(row.openingQuantity), openingCostPerPortion: Number(row.openingCostPerPortion),
  frozenQuantity: Number(row.frozenQuantity), frozenCostPerPortion: Number(row.frozenCostPerPortion),
});

async function latestLedgerDate(executor: Pick<typeof db, "execute">, enotaId: number) {
  const result = await executor.execute(sql`
    SELECT MAX(business_date)::text AS business_date
    FROM prepared_food_daily_ledgers
    WHERE enota_id = ${enotaId}`);
  return (result.rows[0] as { business_date?: string | null } | undefined)?.business_date ?? null;
}

async function ensureLatestOpenLedgerDate(
  executor: Pick<typeof db, "execute">,
  enotaId: number,
  businessDate: string,
) {
  const latest = await latestLedgerDate(executor, enotaId);
  if (latest && latest > businessDate) {
    throw new Error("Urejati je mogoče samo zadnjo odprto dnevno evidenco.");
  }
}

async function lockPreparedFoodEnota(tx: Pick<typeof db, "execute">, enotaId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(376, ${enotaId})`);
}

function wasteRecordTextIsValid(body: {
  disposalReason: string;
  signaturePerson: string;
  signatureManager: string;
}) {
  return body.disposalReason.trim().length > 0
    && body.signaturePerson.trim().length > 0
    && body.signatureManager.trim().length > 0;
}

type WasteLine = {
  businessDate: string;
  articleId: number;
  articleName: string;
  unitOfMeasure: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
};

function summarizeWasteLines(dailyLines: WasteLine[]) {
  const summary = new Map<number, Omit<WasteLine, "businessDate">>();
  for (const line of dailyLines) {
    const current = summary.get(line.articleId);
    if (current) {
      current.quantity += line.quantity;
      current.totalValue += line.totalValue;
      current.unitCost = current.quantity > 0 ? current.totalValue / current.quantity : 0;
    }
    else summary.set(line.articleId, {
      articleId: line.articleId,
      articleName: line.articleName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: line.quantity,
      unitCost: line.unitCost,
      totalValue: line.totalValue,
    });
  }
  return [...summary.values()];
}

async function buildWastePreview(
  executor: typeof db,
  enotaId: number,
  periodFrom: string,
  periodTo: string,
) {
  const rows = await executor.select({
    businessDate: preparedFoodDailyLedgersTable.businessDate,
    articleId: preparedFoodDailyLedgersTable.artikelId,
    articleName: artikliTable.ime,
    unitOfMeasure: artikliTable.enotaMere,
    wasteQuantity: preparedFoodDailyLedgersTable.wasteQuantity,
    wasteDeliveredQuantity: preparedFoodDailyLedgersTable.wasteDeliveredQuantity,
    wasteValue: preparedFoodDailyLedgersTable.wasteValue,
  }).from(preparedFoodDailyLedgersTable)
    .innerJoin(artikliTable, eq(artikliTable.id, preparedFoodDailyLedgersTable.artikelId))
    .where(and(
      eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
      gte(preparedFoodDailyLedgersTable.businessDate, periodFrom),
      lte(preparedFoodDailyLedgersTable.businessDate, periodTo),
      isNotNull(preparedFoodDailyLedgersTable.closedAt),
      sql`${preparedFoodDailyLedgersTable.wasteQuantity} > ${preparedFoodDailyLedgersTable.wasteDeliveredQuantity}`,
    ))
    .orderBy(preparedFoodDailyLedgersTable.businessDate, slovenianCollated(artikliTable.ime));
  const dailyLines = rows.map((row) => ({
    businessDate: row.businessDate,
    articleId: row.articleId,
    articleName: row.articleName,
    unitOfMeasure: preparedFoodUnitLabel(row.unitOfMeasure),
    quantity: Number(row.wasteQuantity) - Number(row.wasteDeliveredQuantity),
    unitCost: Number(row.wasteQuantity) > 0
      ? Number(row.wasteValue ?? 0) / Number(row.wasteQuantity)
      : 0,
    totalValue: (Number(row.wasteQuantity) - Number(row.wasteDeliveredQuantity))
      * (Number(row.wasteQuantity) > 0 ? Number(row.wasteValue ?? 0) / Number(row.wasteQuantity) : 0),
  }));
  return {
    dailyLines,
    summaryLines: summarizeWasteLines(dailyLines),
    totalQuantity: dailyLines.reduce((total, line) => total + line.quantity, 0),
  };
}

async function loadWasteRecord(executor: typeof db, enotaId: number, id: number) {
  const [record] = await executor.select().from(preparedFoodWasteRecordsTable).where(and(
    eq(preparedFoodWasteRecordsTable.id, id),
    eq(preparedFoodWasteRecordsTable.enotaId, enotaId),
  ));
  if (!record) return null;
  const lines = await executor.select().from(preparedFoodWasteRecordLinesTable)
    .where(eq(preparedFoodWasteRecordLinesTable.recordId, id))
    .orderBy(preparedFoodWasteRecordLinesTable.businessDate, slovenianCollated(preparedFoodWasteRecordLinesTable.articleName));
  const dailyLines = lines.map((line) => ({
    businessDate: line.businessDate,
    articleId: line.artikelId,
    articleName: line.articleName,
    unitOfMeasure: preparedFoodUnitLabel(line.unitOfMeasure),
    quantity: Number(line.quantity),
    unitCost: Number(line.costPerUnit),
    totalValue: Number(line.totalValue),
  }));
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    enotaId: record.enotaId,
    companyName: record.companyName,
    businessUnitName: record.businessUnitName,
    recordDate: record.recordDate,
    periodFrom: record.periodFrom,
    periodTo: record.periodTo,
    wasteObservedAt: record.wasteObservedAt.toISOString(),
    disposalReason: record.disposalReason,
    signaturePerson: record.signaturePerson,
    signatureManager: record.signatureManager,
    status: record.status,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    dailyLines,
    summaryLines: summarizeWasteLines(dailyLines),
    totalQuantity: dailyLines.reduce((total, line) => total + line.quantity, 0),
  };
}

async function unitIdentity(executor: any, enotaId: number) {
  const [identity] = await executor.select({
    companyName: companiesTable.naziv,
    businessUnitName: enoteTable.ime,
  }).from(enoteTable)
    .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
    .where(eq(enoteTable.id, enotaId));
  if (!identity) throw new Error("Poslovna enota ne obstaja.");
  return identity;
}

async function replaceWasteRecordLines(
  tx: any,
  recordId: number,
  enotaId: number,
  periodFrom: string,
  periodTo: string,
) {
  const preview = await buildWastePreview(tx, enotaId, periodFrom, periodTo);
  if (preview.dailyLines.length === 0) {
    throw new Error("V izbranem obdobju ni neoddanega kala iz zaključenih evidenc.");
  }
  await tx.delete(preparedFoodWasteRecordLinesTable)
    .where(eq(preparedFoodWasteRecordLinesTable.recordId, recordId));
  await tx.insert(preparedFoodWasteRecordLinesTable).values(preview.dailyLines.map((line) => ({
    recordId,
    businessDate: line.businessDate,
    artikelId: line.articleId,
    articleName: line.articleName,
    unitOfMeasure: line.unitOfMeasure,
    quantity: String(line.quantity),
    costPerUnit: String(line.unitCost),
    totalValue: String(line.totalValue),
  })));
}

router.get("/prepared-food/availability", async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const businessDate = await currentBusinessDate(enotaId);
  const state = await loadPreparedFoodAvailability(db, enotaId, businessDate);
  const modifierResult = await db.execute(sql`
    SELECT m.id
    FROM modifikatorji m
    JOIN modifikatorske_skupine s ON s.id = m.skupina_id
    WHERE s.enota_id = ${enotaId} AND m.aktiven = true
      AND EXISTS (SELECT 1 FROM modifikator_normativi mn WHERE mn.modifikator_id = m.id)
  `);
  const modifierIds = modifierResult.rows.map(row => Number(row.id));
  const snapshots = await loadModifierAvailabilitySnapshots(db, modifierIds);
  res.json({
    businessDate,
    items: state.items,
    modifierItems: resolveModifierPortions(state, snapshots),
  });
});

async function stockForYear(tx: any, enotaId: number, artikelId: number, year: number) {
  let [stock] = await tx.select().from(preparedFoodStocksTable).where(and(
    eq(preparedFoodStocksTable.enotaId, enotaId), eq(preparedFoodStocksTable.artikelId, artikelId),
    eq(preparedFoodStocksTable.year, year),
  ));
  if (!stock) {
    const [prior] = await tx.select().from(preparedFoodStocksTable).where(and(
      eq(preparedFoodStocksTable.enotaId, enotaId), eq(preparedFoodStocksTable.artikelId, artikelId),
      eq(preparedFoodStocksTable.year, year - 1),
    ));
    [stock] = await tx.insert(preparedFoodStocksTable).values({
      enotaId, artikelId, year,
      openingQuantity: prior?.frozenQuantity ?? "0",
      openingCostPerPortion: prior?.frozenCostPerPortion ?? "0",
      frozenQuantity: prior?.frozenQuantity ?? "0",
      frozenCostPerPortion: prior?.frozenCostPerPortion ?? "0",
    }).returning();
  }
  return stock!;
}

async function soldQuantity(
  enotaId: number,
  date: string,
  artikelId: number,
  executor: Pick<typeof db, "execute"> = db,
) {
  const startTime = await getEnotaBusinessDayStart(enotaId, executor);
  const startInterval = `${startTime}:00`;
  const result = await executor.execute(sql`
    WITH RECURSIVE sold_tree(article_id, quantity, meal_type, path, pizza_dough_article_id) AS (
      SELECT p.artikel_id, p.kolicina::numeric * COALESCE(p.normativ_faktor, 1)::numeric,
             p.meal_type, ARRAY[p.artikel_id],
             p.pizza_dough_article_id
      FROM postavke p JOIN narocila n ON n.id = p.narocilo_id
      WHERE n.enota_id = ${enotaId} AND p.artikel_id IS NOT NULL
        AND p.parent_postavka_id IS NULL
        AND p.kolicina::numeric * COALESCE(p.normativ_faktor, 1)::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date = ${date}::date
      UNION ALL
      SELECT norm.vhodni_artikel_id, tree.quantity * norm.kolicina,
             COALESCE(child_article.meal_type, 'ala_carte'),
             tree.path || norm.vhodni_artikel_id, tree.pizza_dough_article_id
      FROM sold_tree tree
      JOIN artikli parent_article ON parent_article.id = tree.article_id
      JOIN normativi norm ON norm.artikel_id = tree.article_id
      JOIN artikli child_article ON child_article.id = norm.vhodni_artikel_id
      WHERE parent_article.meal_type = 'composite'
        AND norm.vhodni_artikel_id IS DISTINCT FROM tree.pizza_dough_article_id
        AND NOT norm.vhodni_artikel_id = ANY(tree.path)
    ),
    sold_usage(article_id, quantity, meal_type) AS (
      SELECT article_id, quantity, meal_type FROM sold_tree
      UNION ALL
      SELECT p.pizza_dough_article_id, p.kolicina::numeric, 'prepared'
      FROM postavke p
      JOIN narocila n ON n.id = p.narocilo_id
      WHERE n.enota_id = ${enotaId}
        AND p.parent_postavka_id IS NULL
        AND p.pizza_dough_article_id IS NOT NULL
        AND p.kolicina::numeric * COALESCE(p.normativ_faktor, 1)::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date = ${date}::date
      UNION ALL
      -- Izbire pripravljenih prilog niso samostojne prodajne postavke.
      -- Uporabi posnetek vhodov ob naročilu; za stare postavke brez posnetka normativ.
      SELECT (snapshot.value->>'articleId')::integer,
             child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric
               * (snapshot.value->>'quantity')::numeric,
             COALESCE(snapshot.value->>'mealType', 'ala_carte')
      FROM postavke child
      JOIN narocila n ON n.id = child.narocilo_id
      CROSS JOIN LATERAL jsonb_array_elements(child.availability_requirements) snapshot(value)
      WHERE n.enota_id = ${enotaId}
        AND child.parent_postavka_id IS NOT NULL
        AND child.modifikator_id IS NOT NULL
        AND child.availability_requirements IS NOT NULL
        AND child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric > 0
        AND (snapshot.value->>'quantity')::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date = ${date}::date
      UNION ALL
      SELECT mn.vhodni_artikel_id,
             child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric * mn.kolicina::numeric,
             COALESCE(a.meal_type, 'ala_carte')
      FROM postavke child
      JOIN narocila n ON n.id = child.narocilo_id
      JOIN modifikator_normativi mn ON mn.modifikator_id = child.modifikator_id
      JOIN artikli a ON a.id = mn.vhodni_artikel_id
      WHERE n.enota_id = ${enotaId}
        AND child.parent_postavka_id IS NOT NULL
        AND child.availability_requirements IS NULL
        AND child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric * mn.kolicina::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date = ${date}::date
    )
    SELECT COALESCE(SUM(su.quantity), 0)::float8 AS sold
    FROM sold_usage su
    WHERE su.article_id = ${artikelId} AND su.meal_type = 'prepared'`);
  return Number((result.rows[0] as { sold?: number })?.sold ?? 0);
}

router.get("/prepared-food/stocks/:year", async (req: Request, res: Response): Promise<void> => {
  const params = ListPreparedFoodStocksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljavno leto." }); return; }
  const enotaId = (req as any).enotaId as number;
  const rows = await db.transaction(async (tx) => {
    const articles = await tx.select({
      id: artikliTable.id,
      name: artikliTable.ime,
      unitOfMeasure: artikliTable.enotaMere,
    }).from(artikliTable)
      .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.mealType, "prepared")));
    return Promise.all(articles.map(async (article) =>
      mapStock(await stockForYear(tx, enotaId, article.id, params.data.year), article.name, article.unitOfMeasure)));
  });
  res.json(ListPreparedFoodStocksResponse.parse(rows));
});

router.put("/prepared-food/stocks/:year", async (req: Request, res: Response): Promise<void> => {
  const params = UpdatePreparedFoodStocksParams.safeParse(req.params);
  const body = UpdatePreparedFoodStocksBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Neveljavni podatki zaloge." }); return; }

  const itemIds = body.data.items.map((item) => item.articleId);
  if (new Set(itemIds).size !== itemIds.length) {
    res.status(400).json({ error: "Artikel je v paketu naveden več kot enkrat." });
    return;
  }

  const enotaId = (req as any).enotaId as number;
  const result = await db.transaction(async (tx) => {
    await lockPreparedFoodEnota(tx, enotaId);
    const articles = [];
    for (const item of body.data.items) {
      const [article] = await tx.select({
        id: artikliTable.id,
        name: artikliTable.ime,
        mealType: artikliTable.mealType,
        unitOfMeasure: artikliTable.enotaMere,
      }).from(artikliTable).where(and(
        eq(artikliTable.id, item.articleId),
        eq(artikliTable.enotaId, enotaId),
      ));
      if (!article || article.mealType !== "prepared") {
        return { error: "Zaloga je dovoljena samo za pripravljeno jed." as const };
      }

      const start = `${params.data.year}-01-01`;
      const end = `${params.data.year + 1}-01-01`;
      const [closed] = await tx.select({ id: preparedFoodDailyLedgersTable.id })
        .from(preparedFoodDailyLedgersTable)
        .where(and(
          eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
          eq(preparedFoodDailyLedgersTable.artikelId, article.id),
          isNotNull(preparedFoodDailyLedgersTable.closedAt),
          sql`${preparedFoodDailyLedgersTable.businessDate} >= ${start}::date AND ${preparedFoodDailyLedgersTable.businessDate} < ${end}::date`,
        ))
        .limit(1);
      if (closed) {
        return { error: "Otvoritvene zaloge po prvem zaključenem dnevu leta ni več mogoče spreminjati." as const };
      }
      articles.push(article);
    }

    const updated = [];
    for (const [index, item] of body.data.items.entries()) {
      const article = articles[index];
      const stock = await stockForYear(tx, enotaId, article.id, params.data.year);
      const [row] = await tx.update(preparedFoodStocksTable).set({
        openingQuantity: String(item.openingQuantity),
        openingCostPerPortion: String(item.openingCostPerPortion),
        frozenQuantity: String(item.openingQuantity),
        frozenCostPerPortion: String(item.openingCostPerPortion),
        updatedAt: new Date(),
      }).where(eq(preparedFoodStocksTable.id, stock.id)).returning();
      updated.push(mapStock(row, article.name, article.unitOfMeasure));
    }
    return { updated };
  });

  if ("error" in result) { res.status(422).json({ error: result.error }); return; }
  res.json(UpdatePreparedFoodStocksResponse.parse(result.updated));
});

router.put("/prepared-food/stocks/:year/:articleId", async (req: Request, res: Response): Promise<void> => {
  const params = UpdatePreparedFoodStockParams.safeParse(req.params);
  const body = UpdatePreparedFoodStockBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Neveljavni podatki zaloge." }); return; }
  const enotaId = (req as any).enotaId as number;
   const result = await db.transaction(async tx => {
    await lockPreparedFoodEnota(tx, enotaId);
    const [article] = await tx.select({
      id: artikliTable.id,
      name: artikliTable.ime,
      mealType: artikliTable.mealType,
      unitOfMeasure: artikliTable.enotaMere,
    }).from(artikliTable).where(and(
      eq(artikliTable.id, params.data.articleId),
      eq(artikliTable.enotaId, enotaId),
    ));
    if (!article || article.mealType !== "prepared") {
       return { ok: false as const, error: "Zaloga je dovoljena samo za pripravljeno jed.", status: 422 as const };
    }
    const start = `${params.data.year}-01-01`;
    const end = `${params.data.year + 1}-01-01`;
    const [closed] = await tx.select({ id: preparedFoodDailyLedgersTable.id }).from(preparedFoodDailyLedgersTable)
      .where(and(eq(preparedFoodDailyLedgersTable.enotaId, enotaId), eq(preparedFoodDailyLedgersTable.artikelId, article.id),
        isNotNull(preparedFoodDailyLedgersTable.closedAt),
        sql`${preparedFoodDailyLedgersTable.businessDate} >= ${start}::date AND ${preparedFoodDailyLedgersTable.businessDate} < ${end}::date`)).limit(1);
    if (closed) {
       return {
         ok: false as const,
         error: "Otvoritvene zaloge po prvem zaključenem dnevu leta ni več mogoče spreminjati.",
         status: 409 as const,
       };
    }
    const stock = await stockForYear(tx, enotaId, article.id, params.data.year);
    const [updated] = await tx.update(preparedFoodStocksTable).set({
      openingQuantity: String(body.data.openingQuantity), openingCostPerPortion: String(body.data.openingCostPerPortion),
      frozenQuantity: String(body.data.openingQuantity), frozenCostPerPortion: String(body.data.openingCostPerPortion), updatedAt: new Date(),
    }).where(eq(preparedFoodStocksTable.id, stock.id)).returning();
     return { ok: true as const, row: mapStock(updated, article.name, article.unitOfMeasure) };
  });
   if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(UpdatePreparedFoodStockResponse.parse(result.row));
});

router.get("/prepared-food/daily/history/:year", async (req: Request, res: Response): Promise<void> => {
  const params = ListPreparedFoodDailyHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljavno leto." }); return; }
  const enotaId = (req as any).enotaId as number;
  const start = `${params.data.year}-01-01`;
  const end = `${params.data.year + 1}-01-01`;
  const [rows, latest] = await Promise.all([
    db.select({
      ledger: preparedFoodDailyLedgersTable,
      articleName: artikliTable.ime,
      unitOfMeasure: artikliTable.enotaMere,
    }).from(preparedFoodDailyLedgersTable)
      .innerJoin(artikliTable, eq(artikliTable.id, preparedFoodDailyLedgersTable.artikelId))
      .where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        gte(preparedFoodDailyLedgersTable.businessDate, start),
        lt(preparedFoodDailyLedgersTable.businessDate, end),
      ))
      .orderBy(desc(preparedFoodDailyLedgersTable.businessDate), slovenianCollated(artikliTable.ime)),
    latestLedgerDate(db, enotaId),
  ]);
  res.json(ListPreparedFoodDailyHistoryResponse.parse(rows.map((row) => mapLedger(row.ledger, {
    articleName: row.articleName,
    unitOfMeasure: preparedFoodUnitLabel(row.unitOfMeasure),
    editable: !row.ledger.closedAt && row.ledger.businessDate === latest,
  }))));
});

router.get("/prepared-food/daily/:date/:articleId/consumption", async (req: Request, res: Response): Promise<void> => {
  const businessDate = String(req.params.date);
  const parsedDate = new Date(`${businessDate}T00:00:00.000Z`);
  if (!dateOk(businessDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== businessDate) {
    res.status(400).json({ error: "Neveljaven datum." });
    return;
  }
  const params = GetPreparedFoodConsumptionParams.safeParse({
    ...req.params,
    date: parsedDate,
  });
  const rawQuantity = req.query.quantity;
  const rawBatchCount = req.query.batchCount;
  const query = GetPreparedFoodConsumptionQueryParams.safeParse(
    { ...(rawQuantity === undefined ? {} : { quantity: rawQuantity }),
      ...(rawBatchCount === undefined ? {} : { batchCount: rawBatchCount }) },
  );
  if (!params.success || !query.success || (rawQuantity !== undefined && typeof rawQuantity !== "string")
    || (typeof rawQuantity === "string" && rawQuantity.trim() === "")
    || (rawBatchCount !== undefined && (typeof rawBatchCount !== "string" || rawBatchCount.trim() === "" || !Number.isFinite(Number(rawBatchCount))))
    || (query.success && query.data.quantity !== undefined && !Number.isFinite(query.data.quantity))) {
    res.status(400).json({ error: "Neveljavna količina predogleda porabe." });
    return;
  }

  const enotaId = (req as any).enotaId as number;
  const [article] = await db.select({
    id: artikliTable.id,
    name: artikliTable.ime,
    mealType: artikliTable.mealType,
    unitOfMeasure: artikliTable.enotaMere,
    recipeBatchPieces: artikliTable.recipeBatchPieces,
  }).from(artikliTable).where(and(
    eq(artikliTable.id, params.data.articleId),
    eq(artikliTable.enotaId, enotaId),
  ));
  if (!article || article.mealType !== "prepared") {
    res.status(404).json({ error: "Pripravljena jed ni najdena." });
    return;
  }

  const [ledger] = await db.select().from(preparedFoodDailyLedgersTable).where(and(
    eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
    eq(preparedFoodDailyLedgersTable.businessDate, businessDate),
    eq(preparedFoodDailyLedgersTable.artikelId, article.id),
  ));

  if (ledger?.closedAt) {
    const movements = await db.select({
      ingredientId: zalogaGibiTable.artikelId,
      movementQuantity: zalogaGibiTable.kolicina,
      ingredientName: artikliTable.ime,
      ingredientUnitOfMeasure: artikliTable.enotaMere,
    }).from(zalogaGibiTable)
      .leftJoin(artikliTable, and(
        eq(artikliTable.id, zalogaGibiTable.artikelId),
        eq(artikliTable.enotaId, enotaId),
      ))
      .where(and(
        eq(zalogaGibiTable.tip, "poraba"),
        eq(zalogaGibiTable.sourceSnapshot, "prepared_food_daily_close"),
        eq(zalogaGibiTable.referencaId, ledger.id),
        sql`${zalogaGibiTable.kolicina}::numeric < 0`,
      ));
    const byIngredient = new Map<number, {
      ingredientId: number;
      ingredientName: string;
      unitOfMeasure: string | null;
      quantity: number;
      quantityPerUnit: null;
    }>();
    let hasUnavailableIngredient = false;
    for (const movement of movements) {
      const current = byIngredient.get(movement.ingredientId);
      if (current) {
        current.quantity += -Number(movement.movementQuantity);
        continue;
      }
      if (movement.ingredientName == null) hasUnavailableIngredient = true;
      byIngredient.set(movement.ingredientId, {
        ingredientId: movement.ingredientId,
        ingredientName: movement.ingredientName ?? "Sestavina ni na voljo v tej poslovni enoti",
        unitOfMeasure: movement.ingredientUnitOfMeasure,
        quantity: -Number(movement.movementQuantity),
        quantityPerUnit: null,
      });
    }
    const message = movements.length === 0
      ? "Za zaključeno evidenco ni bilo najdenih dokaznih premikov porabe."
      : hasUnavailableIngredient
        ? "Nekaterih sestavin ni mogoče razpoznati v tej poslovni enoti."
        : undefined;
    res.json(GetPreparedFoodConsumptionResponse.parse({
      articleId: article.id,
      articleName: article.name,
      preparedQuantity: Number(ledger.preparedQuantity),
      unitOfMeasure: preparedFoodUnitLabel(article.unitOfMeasure),
      source: "actual",
      items: [...byIngredient.values()],
      ...(message === undefined ? {} : { message }),
    }));
    return;
  }

  const preparedQuantity = query.data.quantity
    ?? (ledger ? Number(ledger.preparedQuantity) : 0);
  const recipeQuantity = query.data.batchCount !== undefined
    ? query.data.batchCount * (ledger?.normativeBatchPieces ?? article.recipeBatchPieces ?? 1)
    : query.data.quantity !== undefined ? preparedQuantity
      : productionTotals(ledger?.preparationBatches, ledger?.normativeBatchPieces, preparedQuantity).recipeQuantity;
  const currentRecipe = await db.select({
    ingredientId: normativiTable.vhodniArtikelId,
    quantityPerUnit: normativiTable.kolicina,
    ingredientName: artikliTable.ime,
    ingredientUnitOfMeasure: artikliTable.enotaMere,
  }).from(normativiTable)
    .leftJoin(artikliTable, and(
      eq(artikliTable.id, normativiTable.vhodniArtikelId),
      eq(artikliTable.enotaId, enotaId),
    ))
    .where(eq(normativiTable.artikelId, article.id));
  const snapshot = (query.data.batchCount !== undefined || (query.data.quantity === undefined && ledger?.preparationBatches != null))
    ? ledger?.preparationRecipeSnapshot : null;
  const recipe = snapshot == null ? currentRecipe : await Promise.all(snapshot.map(async n => {
    const [ingredient] = await db.select({ ingredientName: artikliTable.ime, ingredientUnitOfMeasure: artikliTable.enotaMere })
      .from(artikliTable).where(and(eq(artikliTable.id, n.ingredientId), eq(artikliTable.enotaId, enotaId)));
    return { ingredientId: n.ingredientId, quantityPerUnit: n.quantity,
      ingredientName: ingredient?.ingredientName ?? null, ingredientUnitOfMeasure: ingredient?.ingredientUnitOfMeasure ?? null };
  }));
  const hasUnavailableIngredient = recipe.some((row) => row.ingredientName == null);
  const items = recipe.map((row) => {
    const quantityPerUnit = Number(row.quantityPerUnit);
    return {
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName ?? "Sestavina ni na voljo v tej poslovni enoti",
      unitOfMeasure: row.ingredientUnitOfMeasure,
      quantityPerUnit,
      quantity: quantityPerUnit * recipeQuantity,
    };
  });
  const message = recipe.length === 0
    ? "Za jed ni določenih sestavin v normativu."
    : hasUnavailableIngredient
      ? "Nekaterih sestavin ni mogoče razpoznati v tej poslovni enoti."
      : undefined;
  res.json(GetPreparedFoodConsumptionResponse.parse({
    articleId: article.id,
    articleName: article.name,
    preparedQuantity,
    unitOfMeasure: preparedFoodUnitLabel(article.unitOfMeasure),
    source: "normative",
    items,
    ...(message === undefined ? {} : { message }),
  }));
});

router.get("/prepared-food/daily/:date", async (req: Request, res: Response): Promise<void> => {
  const businessDate = String(req.params.date);
  if (!dateOk(businessDate)) { res.status(400).json({ error: "Neveljaven datum." }); return; }
  const parsed = ListPreparedFoodDailyParams.safeParse({
    ...req.params,
    date: new Date(`${businessDate}T00:00:00.000Z`),
  });
  if (!parsed.success) { res.status(400).json({ error: "Neveljaven datum." }); return; }
  const enotaId = (req as any).enotaId as number;
  const output = await db.transaction(async (tx) => {
    const [articles, ledgers, latest] = await Promise.all([
      tx.select({
        id: artikliTable.id,
        name: artikliTable.ime,
        unitOfMeasure: artikliTable.enotaMere,
        defaultRecipeBatchPieces: artikliTable.recipeBatchPieces,
      }).from(artikliTable).where(and(
        eq(artikliTable.enotaId, enotaId),
        eq(artikliTable.mealType, "prepared"),
      )),
      tx.select().from(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, businessDate),
      )),
      latestLedgerDate(tx, enotaId),
    ]);
    const byArticle = new Map(ledgers.map((ledger) => [ledger.artikelId, ledger]));
    const canCreateRows = !latest
      || businessDate > latest
      || (businessDate === latest && ledgers.some((ledger) => !ledger.closedAt));
    const visibleArticles = canCreateRows
      ? articles
      : articles.filter((article) => byArticle.has(article.id));
    return Promise.all(visibleArticles.map(async (article) => {
      const ledger = byArticle.get(article.id);
      const sold = ledger?.closedAt
        ? Number(ledger.soldQuantity)
        : await soldQuantity(enotaId, businessDate, article.id, tx);
      if (ledger) {
        return { ...mapLedger({ ...ledger, soldQuantity: String(sold) }, {
          articleName: article.name,
          unitOfMeasure: preparedFoodUnitLabel(article.unitOfMeasure),
          editable: !ledger.closedAt && (!latest || businessDate >= latest),
        }), defaultRecipeBatchPieces: article.defaultRecipeBatchPieces };
      }
      return {
        id: -article.id,
        enotaId,
        businessDate,
        artikelId: article.id,
        thawedQuantity: 0,
        preparedQuantity: 0,
        preparationBatches: null,
        normativeBatchPieces: null,
        defaultRecipeBatchPieces: article.defaultRecipeBatchPieces,
        correctionQuantity: 0,
        soldQuantity: sold,
        frozenAtEndQuantity: 0,
        wasteQuantity: 0,
        wasteDeliveredQuantity: 0,
        wasteValue: null,
        closedAt: null,
        articleName: article.name,
        unitOfMeasure: preparedFoodUnitLabel(article.unitOfMeasure),
        editable: !latest || businessDate >= latest,
      };
    }));
  });
  res.json(ListPreparedFoodDailyResponse.parse(output));
});

router.put("/prepared-food/daily/:date/:articleId", async (req: Request, res: Response): Promise<void> => {
  const businessDate = String(req.params.date);
  if (!dateOk(businessDate)) { res.status(400).json({ error: "Neveljavni podatki evidence." }); return; }
  const params = SavePreparedFoodDailyParams.safeParse({
    ...req.params,
    date: new Date(`${businessDate}T00:00:00.000Z`),
  });
  const body = SavePreparedFoodDailyBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Neveljavni podatki evidence." }); return; }
  const enotaId = (req as any).enotaId as number;
  try {
    const row = await db.transaction(async (tx) => {
      await lockPosBusinessDay(tx, enotaId);
      if (await isPosBusinessDayClosed(tx, enotaId, businessDate)) {
        throw new Error("Poslovni dan je že zaključen z Z-poročilom.");
      }
      await lockPreparedFoodEnota(tx, enotaId);
      await ensureLatestOpenLedgerDate(tx, enotaId, businessDate);
      const [article] = await tx.select({
        id: artikliTable.id,
        mealType: artikliTable.mealType,
        recipeBatchPieces: artikliTable.recipeBatchPieces,
        unitOfMeasure: artikliTable.enotaMere,
      })
        .from(artikliTable)
        .where(and(eq(artikliTable.id, params.data.articleId), eq(artikliTable.enotaId, enotaId)));
      if (!article || article.mealType !== "prepared") {
        throw new Error("Evidenca je dovoljena samo za pripravljeno jed.");
      }
      const sold = await soldQuantity(enotaId, businessDate, params.data.articleId, tx);
      const year = Number(businessDate.slice(0, 4));
      const stock = await stockForYear(tx, enotaId, article.id, year);
      if (body.data.thawedQuantity > Number(stock.frozenQuantity)) {
        throw new Error("Odtajanje presega razpoložljivo zamrznjeno zalogo.");
      }
     const allocation = allocatePreparedFood({
        ...body.data,
        soldQuantity: sold,
        thawedCostPerPortion: Number(stock.frozenCostPerPortion),
        preparedCostPerPortion: 0,
      });
      const [existing] = await tx.select().from(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, businessDate),
        eq(preparedFoodDailyLedgersTable.artikelId, article.id),
      )).for("update");
      if (existing?.closedAt) throw new Error("Dnevna evidenca je že zaključena.");
      const batches = body.data.preparationBatches === undefined
        ? existing?.preparationBatches ?? null : body.data.preparationBatches;
      const referencePieces = batches == null ? null
        : existing?.normativeBatchPieces ?? article.recipeBatchPieces;
      if (batches != null && preparedFoodUnitLabel(article.unitOfMeasure) !== "porcija") {
        throw new Error("Razrez na kose je dovoljen samo pri pripravi v porcijah.");
      }
      const production = productionTotals(batches, referencePieces, body.data.preparedQuantity);
      if (Math.abs(production.pieces - body.data.preparedQuantity) > 0.00005) {
        throw new Error("Pripravljena količina se ne ujema s številom kosov posameznih priprav.");
      }
      const recipeSnapshot = batches == null ? null : existing?.preparationRecipeSnapshot
        ?? await tx.select({ ingredientId: normativiTable.vhodniArtikelId, quantity: normativiTable.kolicina })
          .from(normativiTable).where(eq(normativiTable.artikelId, article.id));
      const values = {
        thawedQuantity: String(body.data.thawedQuantity),
        preparedQuantity: String(body.data.preparedQuantity),
        preparationBatches: batches,
        normativeBatchPieces: referencePieces,
        preparationRecipeSnapshot: recipeSnapshot,
         correctionQuantity: String(body.data.correctionQuantity),
        soldQuantity: String(sold),
        frozenAtEndQuantity: String(body.data.frozenAtEndQuantity),
        wasteQuantity: String(allocation.wasteQuantity),
        updatedAt: new Date(),
      };
      if (!existing) {
        const [inserted] = await tx.insert(preparedFoodDailyLedgersTable)
          .values({ enotaId, businessDate, artikelId: article.id, ...values })
          .returning();
        return inserted;
      }
      const [updated] = await tx.update(preparedFoodDailyLedgersTable).set(values).where(and(
        eq(preparedFoodDailyLedgersTable.id, existing.id),
        isNull(preparedFoodDailyLedgersTable.closedAt),
      )).returning();
      if (!updated) throw new Error("Dnevna evidenca je bila med shranjevanjem zaključena.");
      return updated;
    });
    const [article] = await db.select({ unitOfMeasure: artikliTable.enotaMere })
      .from(artikliTable).where(and(
        eq(artikliTable.id, params.data.articleId),
        eq(artikliTable.enotaId, enotaId),
      ));
    res.json(SavePreparedFoodDailyResponse.parse(mapLedger(row, {
      unitOfMeasure: preparedFoodUnitLabel(article?.unitOfMeasure),
      editable: true,
    })));
  } catch (error) {
    const message = (error as Error).message;
    const conflict = message.includes("zaključen") || message.includes("zadnjo odprto") || message.includes("Z-poročilom");
    res.status(conflict ? 409 : 422).json({ error: message });
  }
});

router.post("/prepared-food/daily/:date/:articleId/close", async (req: Request, res: Response): Promise<void> => {
  const businessDate = String(req.params.date);
  if (!dateOk(businessDate)) { res.status(400).json({ error: "Neveljaven datum." }); return; }
  const params = ClosePreparedFoodDailyParams.safeParse({
    ...req.params,
    date: new Date(`${businessDate}T00:00:00.000Z`),
  });
  if (!params.success) { res.status(400).json({ error: "Neveljaven datum." }); return; }
  const { enotaId, clerkUserId } = req as PosRequest;
  const output = await db.transaction(async (tx) => {
    await lockPreparedFoodEnota(tx, enotaId);
    await ensureLatestOpenLedgerDate(tx, enotaId, businessDate);
    const [ledger] = await tx.select().from(preparedFoodDailyLedgersTable).where(and(eq(preparedFoodDailyLedgersTable.enotaId, enotaId), eq(preparedFoodDailyLedgersTable.businessDate, businessDate), eq(preparedFoodDailyLedgersTable.artikelId, params.data.articleId))).for("update");
    if (!ledger) throw new Error("Dnevna evidenca ne obstaja.");
    if (ledger.closedAt) return ledger;
    const [article] = await tx.select({ mealType: artikliTable.mealType }).from(artikliTable).where(and(eq(artikliTable.id, ledger.artikelId), eq(artikliTable.enotaId, enotaId)));
    if (article?.mealType !== "prepared") throw new Error("Artikel ni pripravljena jed.");
    const seededStock = await stockForYear(tx, enotaId, ledger.artikelId, Number(businessDate.slice(0, 4)));
    const [stock] = await tx.select().from(preparedFoodStocksTable)
      .where(eq(preparedFoodStocksTable.id, seededStock.id))
      .for("update");
    if (!stock) throw new Error("Zaloga pripravljene hrane ne obstaja.");
    const currentSold = await soldQuantity(enotaId, businessDate, ledger.artikelId, tx);
    const currentRecipe = await tx.select({
      quantity: normativiTable.kolicina,
      ingredientId: normativiTable.vhodniArtikelId,
    }).from(normativiTable).where(eq(normativiTable.artikelId, ledger.artikelId));
    const recipe = ledger.preparationBatches == null ? currentRecipe
      : ledger.preparationRecipeSnapshot ?? currentRecipe;
    const ingredientIds = [...new Set(recipe.map((norm) => norm.ingredientId))].sort((a, b) => a - b);
    // Recompute first to lock each stock row and snapshot the transactionally current WAC.
    await recomputeZaloge(ingredientIds, tx);
    const ingredientStocks = ingredientIds.length === 0
      ? []
      : await tx.select({
        ingredientId: zalogeTable.artikelId,
        wac: zalogeTable.povprecnaCena,
      }).from(zalogeTable).where(inArray(zalogeTable.artikelId, ingredientIds));
    const wacByIngredient = new Map(ingredientStocks.map((row) => [
      row.ingredientId,
      Number(row.wac ?? 0),
    ]));
    const norms = recipe.map((norm) => ({
      ...norm,
      wac: wacByIngredient.get(norm.ingredientId) ?? 0,
    }));
    const production = productionTotals(ledger.preparationBatches, ledger.normativeBatchPieces, Number(ledger.preparedQuantity));
    const preparedCost = preparedMaterialUnitCost(norms.map((n) => ({ quantity: Number(n.quantity), wac: Number(n.wac ?? 0) })))
      * (production.pieces > 0 ? production.recipeQuantity / production.pieces : 1);
     const allocation = allocatePreparedFood({ thawedQuantity: Number(ledger.thawedQuantity), preparedQuantity: Number(ledger.preparedQuantity), correctionQuantity: Number(ledger.correctionQuantity), soldQuantity: currentSold, frozenAtEndQuantity: Number(ledger.frozenAtEndQuantity), thawedCostPerPortion: Number(stock.frozenCostPerPortion), preparedCostPerPortion: preparedCost });
    for (const norm of norms) {
      const quantity = -preparedMaterialQuantityForProduction(
        Number(norm.quantity),
        production.recipeQuantity,
      );
      const unitCost = Number(norm.wac ?? 0);
      await tx.insert(zalogaGibiTable).values({
        artikelId: norm.ingredientId,
        tip: "poraba",
        kolicina: String(quantity),
        cenaKos: String(unitCost),
        vrednost: String(quantity * unitCost),
        opomba: `Priprava ${businessDate}`,
        referencaId: ledger.id,
        actorSnapshot: clerkUserId,
        effectiveAtSnapshot: params.data.date,
        sourceSnapshot: "prepared_food_daily_close",
      });
    }
    await recomputeZaloge(ingredientIds, tx);
    const remainingOldQuantity = Number(stock.frozenQuantity) - Number(ledger.thawedQuantity);
    if (remainingOldQuantity < -1e-9) throw new Error("Odtajanje presega razpoložljivo zamrznjeno zalogo.");
    const newlyFrozenQuantity = Number(ledger.frozenAtEndQuantity);
    const nextFrozenQuantity = Math.max(0, remainingOldQuantity) + newlyFrozenQuantity;
    const nextFrozenValue =
      Math.max(0, remainingOldQuantity) * Number(stock.frozenCostPerPortion)
      + newlyFrozenQuantity * allocation.frozenCostPerPortion;
    const nextFrozenCost = nextFrozenQuantity > 0 ? nextFrozenValue / nextFrozenQuantity : 0;
    await tx.update(preparedFoodStocksTable).set({
      frozenQuantity: String(nextFrozenQuantity),
      frozenCostPerPortion: String(nextFrozenCost),
      updatedAt: new Date(),
    }).where(eq(preparedFoodStocksTable.id, stock.id));
    const [closed] = await tx.update(preparedFoodDailyLedgersTable).set({
      soldQuantity: String(currentSold),
      wasteQuantity: String(allocation.wasteQuantity),
      thawedCostPerPortion: String(stock.frozenCostPerPortion),
      preparedCostPerPortion: String(preparedCost),
      wasteValue: String(allocation.wasteValue),
      closedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(preparedFoodDailyLedgersTable.id, ledger.id)).returning();
    return closed;
  }).catch((error: Error) => {
    res.status(409).json({ error: error.message });
    return null;
  });
  if (!output) return;
  res.json(ClosePreparedFoodDailyResponse.parse(mapLedger(output)));
});

router.get("/prepared-food/waste-records/preview", async (req: Request, res: Response): Promise<void> => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!dateOk(from) || !dateOk(to) || from > to) {
    res.status(400).json({ error: "Neveljavno obdobje." });
    return;
  }
  const query = PreviewPreparedFoodWasteRecordQueryParams.safeParse({
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T00:00:00.000Z`),
  });
  if (!query.success) { res.status(400).json({ error: "Neveljavno obdobje." }); return; }
  const preview = await buildWastePreview(db, (req as any).enotaId as number, from, to);
  res.json(PreviewPreparedFoodWasteRecordResponse.parse(preview));
});

router.get("/prepared-food/waste-records", async (req: Request, res: Response): Promise<void> => {
  const query = ListPreparedFoodWasteRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Neveljavno leto." }); return; }
  const enotaId = (req as any).enotaId as number;
  const start = `${query.data.year}-01-01`;
  const end = `${query.data.year + 1}-01-01`;
  const rows = await db.select({ id: preparedFoodWasteRecordsTable.id })
    .from(preparedFoodWasteRecordsTable)
    .where(and(
      eq(preparedFoodWasteRecordsTable.enotaId, enotaId),
      gte(preparedFoodWasteRecordsTable.recordDate, start),
      lt(preparedFoodWasteRecordsTable.recordDate, end),
    ))
    .orderBy(desc(preparedFoodWasteRecordsTable.recordDate), desc(preparedFoodWasteRecordsTable.id));
  const records = await Promise.all(rows.map((row) => loadWasteRecord(db, enotaId, row.id)));
  res.json(ListPreparedFoodWasteRecordsResponse.parse(records.filter(Boolean).map((record) => ({
    id: record!.id,
    recordNumber: record!.recordNumber,
    enotaId: record!.enotaId,
    companyName: record!.companyName,
    businessUnitName: record!.businessUnitName,
    recordDate: record!.recordDate,
    periodFrom: record!.periodFrom,
    periodTo: record!.periodTo,
    wasteObservedAt: record!.wasteObservedAt,
    disposalReason: record!.disposalReason,
    status: record!.status,
    totalQuantity: record!.totalQuantity,
  }))));
});

router.post("/prepared-food/waste-records", async (req: Request, res: Response): Promise<void> => {
  const body = CreatePreparedFoodWasteRecordBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Neveljavni podatki zapisnika." }); return; }
  if (!wasteRecordTextIsValid(body.data)) {
    res.status(400).json({ error: "Razlog odpisa in oba podpisa so obvezni." });
    return;
  }
  const periodFrom = dateString(body.data.periodFrom);
  const periodTo = dateString(body.data.periodTo);
  if (periodFrom > periodTo) { res.status(400).json({ error: "Začetek obdobja mora biti pred koncem." }); return; }
  const enotaId = (req as any).enotaId as number;
  try {
    const id = await db.transaction(async (tx) => {
      await lockPreparedFoodEnota(tx, enotaId);
      const identity = await unitIdentity(tx, enotaId);
      const numberResult = await tx.execute(sql`
        SELECT COALESCE(MAX(record_number), 0)::integer + 1 AS record_number
        FROM prepared_food_waste_records
        WHERE enota_id = ${enotaId}
      `);
      const recordNumber = Number((numberResult.rows[0] as { record_number: number }).record_number);
      const [record] = await tx.insert(preparedFoodWasteRecordsTable).values({
        enotaId,
        recordNumber,
        companyName: identity.companyName,
        businessUnitName: identity.businessUnitName,
        recordDate: dateString(body.data.recordDate),
        periodFrom,
        periodTo,
        wasteObservedAt: body.data.wasteObservedAt,
        disposalReason: body.data.disposalReason.trim(),
        signaturePerson: body.data.signaturePerson.trim(),
        signatureManager: body.data.signatureManager.trim(),
      }).returning({ id: preparedFoodWasteRecordsTable.id });
      await replaceWasteRecordLines(tx, record.id, enotaId, periodFrom, periodTo);
      return record.id;
    });
    const record = await loadWasteRecord(db, enotaId, id);
    res.status(201).json(CreatePreparedFoodWasteRecordResponse.parse(record));
  } catch (error) {
    res.status(422).json({ error: (error as Error).message });
  }
});

router.get("/prepared-food/waste-records/:id", async (req: Request, res: Response): Promise<void> => {
  const params = GetPreparedFoodWasteRecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljaven zapisnik." }); return; }
  const record = await loadWasteRecord(db, (req as any).enotaId as number, params.data.id);
  if (!record) { res.status(404).json({ error: "Zapisnik ne obstaja." }); return; }
  res.json(GetPreparedFoodWasteRecordResponse.parse(record));
});

router.get("/prepared-food/waste-records/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const params = GetPreparedFoodWasteRecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljaven zapisnik." }); return; }
  const record = await loadWasteRecord(db, (req as any).enotaId as number, params.data.id);
  if (!record) { res.status(404).json({ error: "Zapisnik ne obstaja." }); return; }
  const pdf = await buildPreparedFoodWasteRecordPdf(record);
  const filename = `zapisnik-kala-${record.recordNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
});

router.put("/prepared-food/waste-records/:id", async (req: Request, res: Response): Promise<void> => {
  const params = UpdatePreparedFoodWasteRecordParams.safeParse(req.params);
  const body = UpdatePreparedFoodWasteRecordBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Neveljavni podatki zapisnika." }); return; }
  if (!wasteRecordTextIsValid(body.data)) {
    res.status(400).json({ error: "Razlog odpisa in oba podpisa so obvezni." });
    return;
  }
  const enotaId = (req as any).enotaId as number;
  const periodFrom = dateString(body.data.periodFrom);
  const periodTo = dateString(body.data.periodTo);
  if (periodFrom > periodTo) { res.status(400).json({ error: "Začetek obdobja mora biti pred koncem." }); return; }
  try {
    const updated = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(preparedFoodWasteRecordsTable).where(and(
        eq(preparedFoodWasteRecordsTable.id, params.data.id),
        eq(preparedFoodWasteRecordsTable.enotaId, enotaId),
      )).for("update");
      if (!record) throw new Error("Zapisnik ne obstaja.");
      if (record.status === "potrjen") throw new Error("Potrjenega zapisnika ni mogoče spreminjati.");
      await tx.update(preparedFoodWasteRecordsTable).set({
        recordDate: dateString(body.data.recordDate),
        periodFrom,
        periodTo,
        wasteObservedAt: body.data.wasteObservedAt,
        disposalReason: body.data.disposalReason.trim(),
        signaturePerson: body.data.signaturePerson.trim(),
        signatureManager: body.data.signatureManager.trim(),
        updatedAt: new Date(),
      }).where(eq(preparedFoodWasteRecordsTable.id, record.id));
      await replaceWasteRecordLines(tx, record.id, enotaId, periodFrom, periodTo);
      return record.id;
    });
    const record = await loadWasteRecord(db, enotaId, updated);
    res.json(UpdatePreparedFoodWasteRecordResponse.parse(record));
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === "Zapisnik ne obstaja." ? 404 : 409).json({ error: message });
  }
});

router.post("/prepared-food/waste-records/:id/confirm", async (req: Request, res: Response): Promise<void> => {
  const params = ConfirmPreparedFoodWasteRecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljaven zapisnik." }); return; }
  const enotaId = (req as any).enotaId as number;
  try {
    const id = await db.transaction(async (tx) => {
      await lockPreparedFoodEnota(tx, enotaId);
      const [record] = await tx.select().from(preparedFoodWasteRecordsTable).where(and(
        eq(preparedFoodWasteRecordsTable.id, params.data.id),
        eq(preparedFoodWasteRecordsTable.enotaId, enotaId),
      )).for("update");
      if (!record) throw new Error("Zapisnik ne obstaja.");
      if (record.status === "potrjen") return record.id;

      const recordLines = await tx.select().from(preparedFoodWasteRecordLinesTable)
        .where(eq(preparedFoodWasteRecordLinesTable.recordId, record.id));
      if (recordLines.length === 0) throw new Error("Prazen zapisnik ni mogoče potrditi.");

      const ledgers = await tx.select().from(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        gte(preparedFoodDailyLedgersTable.businessDate, record.periodFrom),
        lte(preparedFoodDailyLedgersTable.businessDate, record.periodTo),
        isNotNull(preparedFoodDailyLedgersTable.closedAt),
      )).for("update");
      const available = new Map(ledgers.map((ledger) => [
        `${ledger.businessDate}:${ledger.artikelId}`,
        Math.max(0, Number(ledger.wasteQuantity) - Number(ledger.wasteDeliveredQuantity)),
      ]));
      const expected = new Map(recordLines.map((line) => [
        `${line.businessDate}:${line.artikelId}`,
        Number(line.quantity),
      ]));
      const allKeys = new Set([...available.keys(), ...expected.keys()]);
      for (const key of allKeys) {
        if (Math.abs((available.get(key) ?? 0) - (expected.get(key) ?? 0)) > 1e-7) {
          throw new Error("Količine kala so se po pripravi osnutka spremenile. Osnutek najprej osvežite.");
        }
      }
      for (const ledger of ledgers) {
        const remaining = available.get(`${ledger.businessDate}:${ledger.artikelId}`) ?? 0;
        if (remaining <= 0) continue;
        await tx.update(preparedFoodDailyLedgersTable).set({
          wasteDeliveredQuantity: ledger.wasteQuantity,
          updatedAt: new Date(),
        }).where(eq(preparedFoodDailyLedgersTable.id, ledger.id));
      }
      await tx.update(preparedFoodWasteRecordsTable).set({
        status: "potrjen",
        confirmedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(preparedFoodWasteRecordsTable.id, record.id));
      return record.id;
    });
    const record = await loadWasteRecord(db, enotaId, id);
    res.json(ConfirmPreparedFoodWasteRecordResponse.parse(record));
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === "Zapisnik ne obstaja." ? 404 : 409).json({ error: message });
  }
});

export default router;