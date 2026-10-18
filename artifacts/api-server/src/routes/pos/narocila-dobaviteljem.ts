import { randomUUID } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  GetSupplierPriceHistoryPageParams,
  GetSupplierPriceHistoryPageResponse,
} from "@workspace/api-zod";
import {
  artikelDobaviteljTable,
  artikliTable,
  counterpartiesTable,
  db,
  posSupplierOrderLinesTable,
  posSupplierOrdersTable,
  posSupplierReorderSettingsTable,
  prejemnicePostavkeTable,
  prejemniceTable,
  zalogeTable,
} from "@workspace/db";
import { requireEnota, type PosRequest } from "../../middlewares/pos";
import {
  getSupplierPriceHistory,
  SupplierOrderReceiptConflict,
} from "../../lib/pos-supplier-orders";

const router: IRouter = Router();

const orderStatus = z.enum([
  "draft",
  "sent",
  "partially_received",
  "received",
  "closed",
  "cancelled",
]);

const orderNoteInput = z.string().trim().max(2000).nullable().optional();

const orderInput = z.object({
  supplierId: z.string().uuid(),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  internalNotes: orderNoteInput,
  supplierNotes: orderNoteInput,
  // Older POS clients send `notes`; keep accepting it as internal-only text.
  notes: orderNoteInput,
  lines: z.array(z.object({
    supplierMappingId: z.number().int().positive(),
    packageQuantity: z.number().finite().positive(),
    unitPrice: z.number().finite().nonnegative().nullable().optional(),
  })).min(1).max(500),
}).superRefine((value, ctx) => {
  if (value.notes !== undefined && value.internalNotes !== undefined && value.notes !== value.internalNotes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["internalNotes"],
      message: "Uporabite samo eno vrednost za interno opombo.",
    });
  }
});

function getInternalNotes(input: z.infer<typeof orderInput>): string | null | undefined {
  return input.internalNotes !== undefined ? input.internalNotes : input.notes;
}

function normalizeOrderNote(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

const reorderSettingsInput = z.object({
  reorderPoint: z.number().finite().nonnegative(),
  targetStock: z.number().finite().positive(),
  preferredMappingId: z.number().int().positive().nullable(),
}).refine(value => value.targetStock > value.reorderPoint, {
  message: "Ciljna zaloga mora biti višja od praga ponovnega naročila.",
});

const supplierPriceHistoryPageQuery = z.object({
  beforeDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
  beforeReceiptId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

function requirePurchasingManager(req: Request, res: Response, next: NextFunction): void {
  const role = (req as PosRequest).vloga;
  if (role === "admin" || role === "admin_enote" || role === "superadmin") {
    next();
    return;
  }
  res.status(403).json({
    code: "POS_NABAVA_ADMIN_OBVEZEN",
    error: "Upravljanje naročil dobaviteljem zahteva administratorsko vlogo enote.",
  });
}

router.use(requireEnota, requirePurchasingManager);

function requestScope(req: Request) {
  const posReq = req as PosRequest;
  return {
    enotaId: posReq.enotaId,
    companyId: posReq.companyId,
    actor: posReq.clerkUserId,
  };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function csvCell(value: string): string {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function comparableLastUnitPrice(
  packagePriceValue: unknown,
  packageFactorValue: unknown,
  lastUnitPriceValue: unknown,
): number | null {
  const packagePrice = nullableNumber(packagePriceValue);
  const packageFactor = nullableNumber(packageFactorValue);
  const lastUnitPrice = nullableNumber(lastUnitPriceValue);
  if (
    packagePrice === null
    || packagePrice < 0
    || packageFactor === null
    || packageFactor <= 0
    || lastUnitPrice === null
    || lastUnitPrice < 0
  ) {
    return null;
  }
  return lastUnitPrice;
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function assertSupplierInCompany(
  executor: typeof db | any,
  supplierId: string,
  companyId: string,
) {
  const [supplier] = await executor.select({
    id: counterpartiesTable.id,
    name: counterpartiesTable.name,
  })
    .from(counterpartiesTable)
    .where(and(
      eq(counterpartiesTable.id, supplierId),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .limit(1);
  return supplier ?? null;
}

async function getSupplierOrderSummaries(
  enotaId: number,
  status?: string,
  limit = 200,
  missingSupplierInstructionsOnly = false,
  offset = 0,
  paginateMissingInstructions = false,
  search?: string | null,
) {
  const limitClause = missingSupplierInstructionsOnly && !paginateMissingInstructions
    ? sql``
    : sql`LIMIT ${limit} OFFSET ${offset}`;
  const result = await db.execute(sql`
    WITH confirmed_received AS (
      SELECT pp.supplier_order_line_id,
        SUM(pp.kolicina) AS received_base_quantity
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE p.enota_id = ${enotaId}
        AND p.status = 'confirmed'
        AND pp.supplier_order_line_id IS NOT NULL
      GROUP BY pp.supplier_order_line_id
    )
    SELECT
      o.id,
      o.stevilka AS "number",
      o.dobavitelj_id AS "supplierId",
      o.dobavitelj_naziv AS "supplierName",
      o.status,
      o.ustvarjeno AS "createdAt",
      o.datum_dobave AS "expectedDeliveryDate",
      o.opomba AS "internalNotes",
      o.navodilo_dobavitelju AS "supplierNotes",
      COUNT(line.id)::integer AS "lineCount",
      COALESCE(SUM(
        GREATEST(line.kolicina_pakiranj * line.faktor_pakiranja
          - COALESCE(received.received_base_quantity, 0), 0)
      ), 0)::float8 AS "openQuantity"
    FROM pos_supplier_orders o
    LEFT JOIN pos_supplier_order_lines line
      ON line.narocilo_id = o.id AND line.enota_id = o.enota_id
    LEFT JOIN confirmed_received received
      ON received.supplier_order_line_id = line.id
    WHERE o.enota_id = ${enotaId}
      AND (${status ?? null}::text IS NULL OR o.status = ${status ?? null})
      AND (
        NOT ${missingSupplierInstructionsOnly}
        OR (
          NULLIF(regexp_replace(COALESCE(o.opomba, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NOT NULL
          AND NULLIF(regexp_replace(COALESCE(o.navodilo_dobavitelju, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NULL
        )
      )
      AND (
        ${search ?? null}::text IS NULL
        OR position(lower(${search ?? null}) in lower(o.stevilka)) > 0
        OR position(lower(${search ?? null}) in lower(o.dobavitelj_naziv)) > 0
      )
    GROUP BY o.id
    ORDER BY o.ustvarjeno DESC, o.id DESC
    ${limitClause}
  `);
  return (result.rows as Array<Record<string, unknown>>).map(row => ({
    id: Number(row.id),
    number: String(row.number),
    supplierId: String(row.supplierId),
    supplierName: String(row.supplierName),
    status: String(row.status),
    createdAt: row.createdAt,
    expectedDeliveryDate: dateOnly(row.expectedDeliveryDate),
    lineCount: Number(row.lineCount),
    openQuantity: Number(row.openQuantity),
    internalNotes: row.internalNotes == null ? null : String(row.internalNotes),
    supplierNotes: row.supplierNotes == null ? null : String(row.supplierNotes),
  }));
}

async function getMissingSupplierInstructionsPage(
  enotaId: number,
  status: string | undefined,
  page: number,
  pageSize: number,
  search: string | null,
) {
  const offset = (page - 1) * pageSize;
  const [orders, countResult] = await Promise.all([
    getSupplierOrderSummaries(
      enotaId,
      status,
      pageSize,
      true,
      offset,
      true,
      search,
    ),
    db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM pos_supplier_orders o
      WHERE o.enota_id = ${enotaId}
        AND (${status ?? null}::text IS NULL OR o.status = ${status ?? null})
        AND NULLIF(regexp_replace(COALESCE(o.opomba, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(COALESCE(o.navodilo_dobavitelju, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NULL
        AND (
          ${search}::text IS NULL
          OR position(lower(${search}) in lower(o.stevilka)) > 0
          OR position(lower(${search}) in lower(o.dobavitelj_naziv)) > 0
        )
    `),
  ]);

  return {
    orders,
    total: Number((countResult.rows[0] as { total: number | string }).total),
    page,
    pageSize,
  };
}

async function getSupplierOrderDetail(enotaId: number, id: number) {
  const [header] = await db.select({
    id: posSupplierOrdersTable.id,
    number: posSupplierOrdersTable.stevilka,
    supplierId: posSupplierOrdersTable.dobaviteljId,
    supplierName: posSupplierOrdersTable.dobaviteljNaziv,
    status: posSupplierOrdersTable.status,
    createdAt: posSupplierOrdersTable.ustvarjeno,
    expectedDeliveryDate: posSupplierOrdersTable.datumDobave,
    sentAt: posSupplierOrdersTable.poslanoDne,
    internalNotes: posSupplierOrdersTable.opomba,
    supplierNotes: posSupplierOrdersTable.navodiloDobavitelju,
    closedReason: posSupplierOrdersTable.razlogZaprtja,
  })
    .from(posSupplierOrdersTable)
    .where(and(
      eq(posSupplierOrdersTable.id, id),
      eq(posSupplierOrdersTable.enotaId, enotaId),
    ))
    .limit(1);
  if (!header) return null;

  const result = await db.execute(sql`
    WITH confirmed_receipts AS (
      SELECT
        receipt_line.supplier_order_line_id,
        receipt.id AS receipt_id,
        receipt.stevilka AS receipt_number,
        receipt.st_dokumenta AS supplier_document_number,
        TO_CHAR(receipt.datum, 'YYYY-MM-DD') AS receipt_date,
        SUM(receipt_line.kolicina) AS received_base_quantity
      FROM pos_supplier_order_lines order_line
      JOIN prejemnice_postavke receipt_line
        ON receipt_line.supplier_order_line_id = order_line.id
      JOIN prejemnice receipt
        ON receipt.id = receipt_line.prejemnica_id
       AND receipt.enota_id = ${enotaId}
       AND receipt.status = 'confirmed'
      WHERE order_line.enota_id = ${enotaId}
        AND order_line.narocilo_id = ${id}
      GROUP BY
        receipt_line.supplier_order_line_id,
        receipt.id,
        receipt.stevilka,
        receipt.st_dokumenta,
        receipt.datum
    ),
    received_by_line AS (
      SELECT
        supplier_order_line_id,
        SUM(received_base_quantity) AS received_base_quantity,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'receiptId', receipt_id,
            'receiptNumber', receipt_number,
            'supplierDocumentNumber', supplier_document_number,
            'receiptDate', receipt_date,
            'receivedBaseQuantity', received_base_quantity
          )
          ORDER BY receipt_date, receipt_id
        ) AS receipts
      FROM confirmed_receipts
      GROUP BY supplier_order_line_id
    )
    SELECT
      line.id,
      line.supplier_mapping_id AS "supplierMappingId",
      line.artikel_id AS "articleId",
      line.artikel_naziv AS "articleName",
      line.dobaviteljev_naziv AS "supplierItemName",
      line.dobaviteljeva_sifra AS "supplierCode",
      line.kolicina_pakiranj::float8 AS "packageQuantity",
      line.faktor_pakiranja::float8 AS "packageFactor",
      current_mapping.enot_v_paketu::float8 AS "currentPackageFactor",
      line.naziv_pakiranja AS "packageName",
      line.osnovna_enota AS "baseUnit",
      (line.kolicina_pakiranj * line.faktor_pakiranja)::float8 AS "orderedBaseQuantity",
      COALESCE(received.received_base_quantity, 0)::float8 AS "receivedBaseQuantity",
      GREATEST(
        line.kolicina_pakiranj * line.faktor_pakiranja
          - COALESCE(received.received_base_quantity, 0), 0
      )::float8 AS "openBaseQuantity",
      line.cena_pakiranja::float8 AS "unitPrice",
      COALESCE(received.receipts, '[]'::jsonb) AS receipts
    FROM pos_supplier_order_lines line
    LEFT JOIN received_by_line received
      ON received.supplier_order_line_id = line.id
    LEFT JOIN artikel_dobavitelj current_mapping
      ON current_mapping.id = line.supplier_mapping_id
     AND current_mapping.enota_id = line.enota_id
    WHERE line.enota_id = ${enotaId} AND line.narocilo_id = ${id}
    ORDER BY line.id
  `);
  const lines = result.rows as Array<Record<string, unknown>>;
  return {
    ...header,
    expectedDeliveryDate: dateOnly(header.expectedDeliveryDate),
    lineCount: lines.length,
    openQuantity: lines.reduce((sum, line) => sum + Number(line.openBaseQuantity), 0),
    lines: lines.map(line => ({
      id: Number(line.id),
      supplierMappingId: Number(line.supplierMappingId),
      articleId: Number(line.articleId),
      articleName: String(line.articleName),
      supplierItemName: line.supplierItemName == null ? null : String(line.supplierItemName),
      supplierCode: line.supplierCode == null ? null : String(line.supplierCode),
      packageQuantity: Number(line.packageQuantity),
      packageFactor: Number(line.packageFactor),
      currentPackageFactor: nullableNumber(line.currentPackageFactor),
      packageName: line.packageName == null ? null : String(line.packageName),
      baseUnit: line.baseUnit == null ? null : String(line.baseUnit),
      orderedBaseQuantity: Number(line.orderedBaseQuantity),
      receivedBaseQuantity: Number(line.receivedBaseQuantity),
      openBaseQuantity: Number(line.openBaseQuantity),
      unitPrice: nullableNumber(line.unitPrice),
      receipts: (Array.isArray(line.receipts) ? line.receipts : []).map((receipt: any) => ({
        receiptId: Number(receipt.receiptId),
        receiptNumber: receipt.receiptNumber == null ? null : String(receipt.receiptNumber),
        supplierDocumentNumber: receipt.supplierDocumentNumber == null
          ? null
          : String(receipt.supplierDocumentNumber),
        receiptDate: String(receipt.receiptDate),
        receivedBaseQuantity: Number(receipt.receivedBaseQuantity),
      })),
    })),
  };
}

async function readOrderMappings(
  executor: typeof db | any,
  enotaId: number,
  companyId: string,
  supplierId: string,
  inputLines: Array<{ supplierMappingId: number }>,
) {
  const mappingIds = inputLines.map(line => line.supplierMappingId);
  if (new Set(mappingIds).size !== mappingIds.length) {
    throw new Error("Ista dobaviteljeva postavka je lahko v naročilu samo enkrat.");
  }
  const rows = await executor.select({
    id: artikelDobaviteljTable.id,
    articleId: artikelDobaviteljTable.artikelId,
    supplierId: artikelDobaviteljTable.dobaviteljId,
    supplierItemName: artikelDobaviteljTable.nazivDobavitelja,
    supplierCode: artikelDobaviteljTable.sifraDobavitelja,
    packageFactor: artikelDobaviteljTable.enotVPaketu,
    packageName: artikelDobaviteljTable.nazivPaketa,
    active: artikelDobaviteljTable.aktivno,
    articleName: artikliTable.ime,
    purchaseName: artikliTable.imeZaNabavo,
    baseUnit: artikliTable.enotaMere,
  })
    .from(artikelDobaviteljTable)
    .innerJoin(artikliTable, eq(artikliTable.id, artikelDobaviteljTable.artikelId))
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, artikelDobaviteljTable.dobaviteljId))
    .where(and(
      inArray(artikelDobaviteljTable.id, mappingIds),
      eq(artikelDobaviteljTable.enotaId, enotaId),
      eq(artikelDobaviteljTable.dobaviteljId, supplierId),
      eq(artikelDobaviteljTable.aktivno, true),
      eq(artikliTable.enotaId, enotaId),
      eq(artikliTable.nabavniArtikel, true),
      eq(counterpartiesTable.companyId, companyId),
    ));
  if (rows.length !== inputLines.length) {
    throw new Error("Nekatere dobaviteljske postavke niso aktivne ali ne pripadajo izbranemu dobavitelju in enoti.");
  }
  if (rows.some((row: any) => !Number.isFinite(Number(row.packageFactor)) || Number(row.packageFactor) <= 0)) {
    throw new Error("Dobaviteljska postavka ima neveljaven faktor pakiranja.");
  }
  const byId = new Map(rows.map((row: any) => [row.id, row]));
  return inputLines.map(line => {
    const mapping = byId.get(line.supplierMappingId) as typeof rows[number] | undefined;
    if (!mapping) throw new Error("Dobaviteljska postavka ni več na voljo.");
    return mapping;
  });
}

async function getOpenQuantitiesByArticle(enotaId: number): Promise<Map<number, number>> {
  const result = await db.execute(sql`
    WITH confirmed_received AS (
      SELECT pp.supplier_order_line_id,
        SUM(pp.kolicina) AS received_base_quantity
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE p.enota_id = ${enotaId}
        AND p.status = 'confirmed'
        AND pp.supplier_order_line_id IS NOT NULL
      GROUP BY pp.supplier_order_line_id
    )
    SELECT line.artikel_id AS "articleId",
      SUM(GREATEST(
        line.kolicina_pakiranj * line.faktor_pakiranja
          - COALESCE(received.received_base_quantity, 0), 0
      ))::float8 AS quantity
    FROM pos_supplier_order_lines line
    JOIN pos_supplier_orders o
      ON o.id = line.narocilo_id AND o.enota_id = line.enota_id
    LEFT JOIN confirmed_received received
      ON received.supplier_order_line_id = line.id
    WHERE line.enota_id = ${enotaId}
      AND o.status IN ('sent', 'partially_received')
    GROUP BY line.artikel_id
  `);
  return new Map((result.rows as Array<{ articleId: number | string; quantity: number | string }>)
    .map(row => [Number(row.articleId), Number(row.quantity)]));
}

router.get("/narocila-dobaviteljem/pregled", async (req, res): Promise<void> => {
  const { enotaId, companyId } = requestScope(req);
  const [articleRows, openQuantities, recentOrders] = await Promise.all([
    db.select({
      articleId: artikliTable.id,
      articleName: artikliTable.ime,
      purchaseName: artikliTable.imeZaNabavo,
      baseUnit: artikliTable.enotaMere,
      onHand: sql<string>`COALESCE(${zalogeTable.kolicina}, '0')`,
      reorderPoint: posSupplierReorderSettingsTable.reorderPoint,
      targetStock: posSupplierReorderSettingsTable.targetStock,
      preferredMappingId: posSupplierReorderSettingsTable.preferredMappingId,
    })
      .from(artikliTable)
      .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
      .leftJoin(
        posSupplierReorderSettingsTable,
        and(
          eq(posSupplierReorderSettingsTable.enotaId, artikliTable.enotaId),
          eq(posSupplierReorderSettingsTable.artikelId, artikliTable.id),
        ),
      )
      .where(and(
        eq(artikliTable.enotaId, enotaId),
        eq(artikliTable.nabavniArtikel, true),
        eq(artikliTable.aktiven, true),
        eq(artikliTable.povratnaEmbalaza, false),
      ))
      .orderBy(artikliTable.ime),
    getOpenQuantitiesByArticle(enotaId),
    getSupplierOrderSummaries(enotaId, undefined, 20),
  ]);
  const articleIds = articleRows.map(row => row.articleId);
  const mappingRows = articleIds.length > 0
    ? await db.select({
      id: artikelDobaviteljTable.id,
      articleId: artikelDobaviteljTable.artikelId,
      supplierId: artikelDobaviteljTable.dobaviteljId,
      supplierName: counterpartiesTable.name,
      supplierItemName: artikelDobaviteljTable.nazivDobavitelja,
      supplierCode: artikelDobaviteljTable.sifraDobavitelja,
      packageName: artikelDobaviteljTable.nazivPaketa,
      packageFactor: artikelDobaviteljTable.enotVPaketu,
      lastPackagePrice: artikelDobaviteljTable.zadnjaCenaPaket,
      lastUnitPrice: artikelDobaviteljTable.zadnjaCenaEnota,
      active: artikelDobaviteljTable.aktivno,
    })
      .from(artikelDobaviteljTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, artikelDobaviteljTable.dobaviteljId))
      .where(and(
        inArray(artikelDobaviteljTable.artikelId, articleIds),
        eq(artikelDobaviteljTable.enotaId, enotaId),
        eq(artikelDobaviteljTable.aktivno, true),
        eq(counterpartiesTable.companyId, companyId),
      ))
    : [];
  const priceHistories = await getSupplierPriceHistory(
    db,
    enotaId,
    mappingRows.map(mapping => mapping.id),
    6,
  );
  const mappingsByArticle = new Map<number, typeof mappingRows>();
  for (const mapping of mappingRows) {
    const items = mappingsByArticle.get(mapping.articleId) ?? [];
    items.push(mapping);
    mappingsByArticle.set(mapping.articleId, items);
  }

  const articles = articleRows.map(row => {
    const stock = Number(row.onHand);
    const openOrderQuantity = openQuantities.get(row.articleId) ?? 0;
    const point = nullableNumber(row.reorderPoint);
    const target = nullableNumber(row.targetStock);
    const preferredMappingId = row.preferredMappingId ?? null;
    const mappings = mappingsByArticle.get(row.articleId) ?? [];
    const preferred = mappings.find(mapping => mapping.id === preferredMappingId);
    const needsOrder = point !== null && target !== null && stock + openOrderQuantity <= point;
    const suggestedBaseQuantity = needsOrder ? Math.max(0, target! - stock - openOrderQuantity) : null;
    const factor = preferred ? Number(preferred.packageFactor) : null;
    const suggestedPackageQuantity = suggestedBaseQuantity !== null
      && factor !== null
      && factor > 0
      ? Math.ceil(suggestedBaseQuantity / factor)
      : null;
    return {
      articleId: row.articleId,
      articleName: row.articleName,
      purchaseName: row.purchaseName,
      baseUnit: row.baseUnit,
      onHand: stock,
      reorderPoint: point,
      targetStock: target,
      openOrderQuantity,
      suggestedBaseQuantity,
      suggestedPackageQuantity,
      preferredMappingId,
      hasSuggestion: needsOrder,
      mappings: mappings.map(mapping => {
        const availablePrices = priceHistories.get(mapping.id) ?? [];
        const priceHistory = availablePrices.slice(0, 5);
        const latestPriceReceipt = priceHistory[0];
        return {
          id: mapping.id,
          supplierId: mapping.supplierId,
          supplierName: mapping.supplierName,
          supplierItemName: mapping.supplierItemName,
          supplierCode: mapping.supplierCode,
          packageName: mapping.packageName,
          packageFactor: nullableNumber(mapping.packageFactor) ?? 0,
          lastPackagePrice: nullableNumber(mapping.lastPackagePrice),
          lastUnitPrice: comparableLastUnitPrice(
            mapping.lastPackagePrice,
            mapping.packageFactor,
            mapping.lastUnitPrice,
          ),
          lastPriceReceipt: latestPriceReceipt
            ? {
                receiptId: latestPriceReceipt.receiptId,
                date: latestPriceReceipt.date,
                receiptNumber: latestPriceReceipt.receiptNumber,
              }
            : null,
          priceHistory: priceHistory.map(({ unitPriceDecimal: _unitPriceDecimal, ...entry }) => entry),
          hasOlderPriceHistory: availablePrices.length > 5,
          active: mapping.active,
        };
      }),
    };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ articles, orders: recentOrders });
});

router.get("/narocila-dobaviteljem/preslikave/:mappingId/zgodovina.csv", async (req, res): Promise<void> => {
  const { enotaId, companyId } = requestScope(req);
  const mappingId = parseId(req.params.mappingId);
  if (!mappingId) {
    res.status(400).json({ error: "Neveljaven ID dobaviteljske povezave." });
    return;
  }

  const [mapping] = await db.select({
    id: artikelDobaviteljTable.id,
    baseUnit: artikliTable.enotaMere,
  })
    .from(artikelDobaviteljTable)
    .innerJoin(
      artikliTable,
      and(
        eq(artikliTable.id, artikelDobaviteljTable.artikelId),
        eq(artikliTable.enotaId, artikelDobaviteljTable.enotaId),
      ),
    )
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, artikelDobaviteljTable.dobaviteljId))
    .where(and(
      eq(artikelDobaviteljTable.id, mappingId),
      eq(artikelDobaviteljTable.enotaId, enotaId),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .limit(1);
  if (!mapping) {
    res.status(404).json({ error: "Dobaviteljska povezava ni najdena." });
    return;
  }

  const history = (await getSupplierPriceHistory(db, enotaId, [mappingId], null))
    .get(mappingId) ?? [];
  const unitLabel = mapping.baseUnit?.trim() || "enota";
  const rows = [
    ["Številka prejemnice", "Datum", `Cena na osnovno enoto (${unitLabel})`],
    ...history.map(entry => [
      entry.receiptNumber,
      entry.date,
      entry.unitPriceDecimal.replace(".", ","),
    ]),
  ];

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="dobaviteljske-cene-${mappingId}.csv"`,
  );
  res.send(`\uFEFF${rows.map(row => row.map(csvCell).join(";")).join("\r\n")}\r\n`);
});

router.get("/narocila-dobaviteljem/povezave/:mappingId/cene", async (req, res): Promise<void> => {
  const { enotaId, companyId } = requestScope(req);
  const parsedParams = GetSupplierPriceHistoryPageParams.safeParse(req.params);
  const parsedQuery = supplierPriceHistoryPageQuery.safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    res.status(400).json({ error: "Neveljaven kazalec zgodovine cen." });
    return;
  }

  const mappingId = parsedParams.data.mappingId;
  const [mapping] = await db.select({ id: artikelDobaviteljTable.id })
    .from(artikelDobaviteljTable)
    .innerJoin(artikliTable, eq(artikliTable.id, artikelDobaviteljTable.artikelId))
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, artikelDobaviteljTable.dobaviteljId))
    .where(and(
      eq(artikelDobaviteljTable.id, mappingId),
      eq(artikelDobaviteljTable.enotaId, enotaId),
      eq(artikelDobaviteljTable.aktivno, true),
      eq(artikliTable.enotaId, enotaId),
      eq(artikliTable.nabavniArtikel, true),
      eq(artikliTable.aktiven, true),
      eq(artikliTable.povratnaEmbalaza, false),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .limit(1);
  if (!mapping) {
    res.status(404).json({ error: "Dobaviteljska povezava ni najdena." });
    return;
  }

  const { beforeDate, beforeReceiptId, limit } = parsedQuery.data;
  const history = await getSupplierPriceHistory(
    db,
    enotaId,
    [mappingId],
    limit + 1,
    { date: beforeDate, receiptId: beforeReceiptId },
  );
  const availableEntries = history.get(mappingId) ?? [];
  const entries = availableEntries.slice(0, limit);
  const hasMore = availableEntries.length > limit;
  const nextCursor = hasMore && entries.length > 0
    ? { date: entries[entries.length - 1]!.date, receiptId: entries[entries.length - 1]!.receiptId }
    : null;
  const parsedResponse = GetSupplierPriceHistoryPageResponse.parse({
    entries,
    hasMore,
    nextCursor,
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...parsedResponse,
    entries: parsedResponse.entries.map(entry => ({
      ...entry,
      date: entry.date.toISOString().slice(0, 10),
    })),
    nextCursor: parsedResponse.nextCursor
      ? {
          ...parsedResponse.nextCursor,
          date: parsedResponse.nextCursor.date.toISOString().slice(0, 10),
        }
      : null,
  });
});

router.put("/narocila-dobaviteljem/artikli/:artikelId/nastavitve", async (req, res): Promise<void> => {
  const { enotaId, companyId, actor } = requestScope(req);
  const artikelId = parseId(req.params.artikelId);
  if (!artikelId) { res.status(400).json({ error: "Neveljaven ID artikla." }); return; }
  const parsed = reorderSettingsInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Neveljavne nastavitve." }); return; }

  const [article] = await db.select({ id: artikliTable.id, purchase: artikliTable.nabavniArtikel })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)))
    .limit(1);
  if (!article || !article.purchase) { res.status(404).json({ error: "Nabavni artikel ni najden." }); return; }

  const { preferredMappingId, reorderPoint, targetStock } = parsed.data;
  if (preferredMappingId !== null) {
    const [mapping] = await db.select({ id: artikelDobaviteljTable.id })
      .from(artikelDobaviteljTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, artikelDobaviteljTable.dobaviteljId))
      .where(and(
        eq(artikelDobaviteljTable.id, preferredMappingId),
        eq(artikelDobaviteljTable.enotaId, enotaId),
        eq(artikelDobaviteljTable.artikelId, artikelId),
        eq(artikelDobaviteljTable.aktivno, true),
        eq(counterpartiesTable.companyId, companyId),
      ))
      .limit(1);
    if (!mapping) { res.status(400).json({ error: "Izbrana dobaviteljska postavka ne pripada temu artiklu, enoti in podjetju." }); return; }
  }

  const [saved] = await db.insert(posSupplierReorderSettingsTable)
    .values({
      enotaId,
      artikelId,
      reorderPoint: String(reorderPoint),
      targetStock: String(targetStock),
      preferredMappingId,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [posSupplierReorderSettingsTable.enotaId, posSupplierReorderSettingsTable.artikelId],
      set: {
        reorderPoint: String(reorderPoint),
        targetStock: String(targetStock),
        preferredMappingId,
        updatedBy: actor,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({
    articleId: saved.artikelId,
    reorderPoint: Number(saved.reorderPoint),
    targetStock: Number(saved.targetStock),
    preferredMappingId: saved.preferredMappingId,
  });
});

router.get("/narocila-dobaviteljem", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const parsed = z.object({
    status: orderStatus.optional(),
    missingSupplierInstructionsOnly: z.enum(["true", "false"]).optional().transform(value => value === "true"),
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Neveljaven filter seznama naročil." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(await getSupplierOrderSummaries(
    enotaId,
    parsed.data.status,
    200,
    parsed.data.missingSupplierInstructionsOnly,
  ));
});

router.get("/narocila-dobaviteljem/brez-navodil", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const parsed = z.object({
    status: orderStatus.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().max(200).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Neveljaven filter pregleda naročil brez navodil." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await getMissingSupplierInstructionsPage(
    enotaId,
    parsed.data.status,
    parsed.data.page,
    parsed.data.pageSize,
    parsed.data.search || null,
  ));
});

router.post("/narocila-dobaviteljem", async (req, res): Promise<void> => {
  const { enotaId, companyId, actor } = requestScope(req);
  const parsed = orderInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Neveljaven osnutek naročila." }); return; }
  const supplier = await assertSupplierInCompany(db, parsed.data.supplierId, companyId);
  if (!supplier) { res.status(404).json({ error: "Dobavitelj ni najden v aktivnem podjetju." }); return; }

  try {
    const createdId = await db.transaction(async tx => {
      const mappings = await readOrderMappings(
        tx,
        enotaId,
        companyId,
        parsed.data.supplierId,
        parsed.data.lines,
      );
      const year = new Date().getFullYear();
      const [header] = await tx.insert(posSupplierOrdersTable).values({
        enotaId,
        dobaviteljId: parsed.data.supplierId,
        dobaviteljNaziv: supplier.name,
        stevilka: `TMP-${randomUUID()}`,
        status: "draft",
        datumDobave: parsed.data.expectedDeliveryDate ?? null,
        opomba: normalizeOrderNote(getInternalNotes(parsed.data)),
        navodiloDobavitelju: normalizeOrderNote(parsed.data.supplierNotes),
        ustvaril: actor,
      }).returning({ id: posSupplierOrdersTable.id });
      const number = `NAB-${year}-${String(header.id).padStart(6, "0")}`;
      await tx.update(posSupplierOrdersTable)
        .set({ stevilka: number })
        .where(eq(posSupplierOrdersTable.id, header.id));
      for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index]!;
        const inputLine = parsed.data.lines[index]!;
        await tx.insert(posSupplierOrderLinesTable).values({
          enotaId,
          narociloId: header.id,
          supplierMappingId: mapping.id,
          artikelId: mapping.articleId,
          artikelNaziv: mapping.purchaseName?.trim() || mapping.articleName,
          dobaviteljevNaziv: mapping.supplierItemName,
          dobaviteljevaSifra: mapping.supplierCode,
          kolicinaPakiranj: String(inputLine.packageQuantity),
          faktorPakiranja: String(mapping.packageFactor),
          nazivPakiranja: mapping.packageName,
          osnovnaEnota: mapping.baseUnit,
          cenaPakiranja: inputLine.unitPrice == null ? null : String(inputLine.unitPrice),
        });
      }
      return header.id;
    });
    res.status(201).json(await getSupplierOrderDetail(enotaId, createdId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Naročila ni bilo mogoče ustvariti." });
  }
});

router.get("/narocila-dobaviteljem/:id", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const detail = await getSupplierOrderDetail(enotaId, id);
  if (!detail) { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(detail);
});

router.put("/narocila-dobaviteljem/:id", async (req, res): Promise<void> => {
  const { enotaId, companyId } = requestScope(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const parsed = orderInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Neveljaven osnutek naročila." }); return; }
  const supplier = await assertSupplierInCompany(db, parsed.data.supplierId, companyId);
  if (!supplier) { res.status(404).json({ error: "Dobavitelj ni najden v aktivnem podjetju." }); return; }

  try {
    const outcome = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM pos_supplier_orders WHERE id = ${id} AND enota_id = ${enotaId} FOR UPDATE`);
      const [header] = await tx.select({
        id: posSupplierOrdersTable.id,
        status: posSupplierOrdersTable.status,
      }).from(posSupplierOrdersTable)
        .where(and(eq(posSupplierOrdersTable.id, id), eq(posSupplierOrdersTable.enotaId, enotaId)))
        .limit(1);
      if (!header) return "missing" as const;
      if (header.status !== "draft") return "locked" as const;
      const mappings = await readOrderMappings(
        tx,
        enotaId,
        companyId,
        parsed.data.supplierId,
        parsed.data.lines,
      );
      const internalNotes = getInternalNotes(parsed.data);
      await tx.update(posSupplierOrdersTable)
        .set({
          dobaviteljId: parsed.data.supplierId,
          dobaviteljNaziv: supplier.name,
          datumDobave: parsed.data.expectedDeliveryDate ?? null,
          ...(internalNotes !== undefined ? { opomba: normalizeOrderNote(internalNotes) } : {}),
          ...(parsed.data.supplierNotes !== undefined
            ? { navodiloDobavitelju: normalizeOrderNote(parsed.data.supplierNotes) }
            : {}),
          posodobljeno: new Date(),
        })
        .where(eq(posSupplierOrdersTable.id, id));
      await tx.delete(posSupplierOrderLinesTable)
        .where(and(
          eq(posSupplierOrderLinesTable.narociloId, id),
          eq(posSupplierOrderLinesTable.enotaId, enotaId),
        ));
      for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index]!;
        const inputLine = parsed.data.lines[index]!;
        await tx.insert(posSupplierOrderLinesTable).values({
          enotaId,
          narociloId: id,
          supplierMappingId: mapping.id,
          artikelId: mapping.articleId,
          artikelNaziv: mapping.purchaseName?.trim() || mapping.articleName,
          dobaviteljevNaziv: mapping.supplierItemName,
          dobaviteljevaSifra: mapping.supplierCode,
          kolicinaPakiranj: String(inputLine.packageQuantity),
          faktorPakiranja: String(mapping.packageFactor),
          nazivPakiranja: mapping.packageName,
          osnovnaEnota: mapping.baseUnit,
          cenaPakiranja: inputLine.unitPrice == null ? null : String(inputLine.unitPrice),
        });
      }
      return "updated" as const;
    });
    if (outcome === "missing") { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
    if (outcome === "locked") { res.status(409).json({ error: "Urejati je mogoče samo osnutek naročila." }); return; }
    res.json(await getSupplierOrderDetail(enotaId, id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Naročila ni bilo mogoče posodobiti." });
  }
});

router.post("/narocila-dobaviteljem/:id/send", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const result = await db.execute(sql`
    UPDATE pos_supplier_orders
    SET status = 'sent', poslano_dne = now(), posodobljeno = now()
    WHERE id = ${id} AND enota_id = ${enotaId} AND status = 'draft'
    RETURNING id
  `);
  if (result.rows.length === 0) {
    const detail = await getSupplierOrderDetail(enotaId, id);
    res.status(detail ? 409 : 404).json({ error: detail ? "Naročilo ni več osnutek." : "Naročilo ni najdeno." });
    return;
  }
  res.json(await getSupplierOrderDetail(enotaId, id));
});

router.post("/narocila-dobaviteljem/:id/close", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Vnesite razlog za zaprtje naročila." }); return; }

  const outcome = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM pos_supplier_orders WHERE id = ${id} AND enota_id = ${enotaId} FOR UPDATE`);
    const [header] = await tx.select({ status: posSupplierOrdersTable.status })
      .from(posSupplierOrdersTable)
      .where(and(eq(posSupplierOrdersTable.id, id), eq(posSupplierOrdersTable.enotaId, enotaId)))
      .limit(1);
    if (!header) return "missing" as const;
    if (header.status !== "sent" && header.status !== "partially_received") return "locked" as const;

    const result = await tx.execute(sql`
      WITH confirmed_received AS (
        SELECT pp.supplier_order_line_id,
          SUM(pp.kolicina) AS received_base_quantity
        FROM prejemnice_postavke pp
        JOIN prejemnice p ON p.id = pp.prejemnica_id
        WHERE p.enota_id = ${enotaId} AND p.status = 'confirmed'
          AND pp.supplier_order_line_id IS NOT NULL
        GROUP BY pp.supplier_order_line_id
      )
      SELECT COALESCE(SUM(GREATEST(
        line.kolicina_pakiranj * line.faktor_pakiranja
          - COALESCE(received.received_base_quantity, 0), 0
      )), 0)::float8 AS open_quantity
      FROM pos_supplier_order_lines line
      LEFT JOIN confirmed_received received ON received.supplier_order_line_id = line.id
      WHERE line.enota_id = ${enotaId} AND line.narocilo_id = ${id}
    `);
    const openQty = Number((result.rows[0] as { open_quantity?: number | string } | undefined)?.open_quantity ?? 0);
    if (openQty <= 0.000001) return "nothing_open" as const;

    const drafts = await tx.execute(sql`
      SELECT 1
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      JOIN pos_supplier_order_lines line ON line.id = pp.supplier_order_line_id
      WHERE line.narocilo_id = ${id} AND line.enota_id = ${enotaId}
        AND p.enota_id = ${enotaId} AND p.status = 'draft'
      LIMIT 1
    `);
    if (drafts.rows.length > 0) return "open_receipt" as const;

    await tx.update(posSupplierOrdersTable)
      .set({
        status: "closed",
        razlogZaprtja: parsed.data.reason,
        zaprtoDne: new Date(),
        posodobljeno: new Date(),
      })
      .where(and(eq(posSupplierOrdersTable.id, id), eq(posSupplierOrdersTable.enotaId, enotaId)));
    return "closed" as const;
  });
  if (outcome === "missing") { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  if (outcome === "locked") { res.status(409).json({ error: "Naročila v tem stanju ni mogoče zapreti." }); return; }
  if (outcome === "nothing_open") { res.status(409).json({ error: "Naročilo nima več odprte količine; prevzemi so že zaključeni." }); return; }
  if (outcome === "open_receipt") { res.status(409).json({ error: "Najprej uredite ali odstranite odprto prejemnico za to naročilo." }); return; }
  res.json(await getSupplierOrderDetail(enotaId, id));
});

router.post("/narocila-dobaviteljem/:id/cancel", async (req, res): Promise<void> => {
  const { enotaId } = requestScope(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const outcome = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM pos_supplier_orders WHERE id = ${id} AND enota_id = ${enotaId} FOR UPDATE`);
    const [header] = await tx.select({ status: posSupplierOrdersTable.status })
      .from(posSupplierOrdersTable)
      .where(and(eq(posSupplierOrdersTable.id, id), eq(posSupplierOrdersTable.enotaId, enotaId)))
      .limit(1);
    if (!header) return "missing" as const;
    if (header.status !== "draft" && header.status !== "sent") return "locked" as const;
    const linked = await tx.execute(sql`
      SELECT 1
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      JOIN pos_supplier_order_lines line ON line.id = pp.supplier_order_line_id
      WHERE line.narocilo_id = ${id} AND line.enota_id = ${enotaId}
        AND p.enota_id = ${enotaId}
      LIMIT 1
    `);
    if (linked.rows.length > 0) return "has_receipts" as const;
    await tx.update(posSupplierOrdersTable)
      .set({ status: "cancelled", posodobljeno: new Date() })
      .where(and(eq(posSupplierOrdersTable.id, id), eq(posSupplierOrdersTable.enotaId, enotaId)));
    return "cancelled" as const;
  });
  if (outcome === "missing") { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  if (outcome === "locked") { res.status(409).json({ error: "Naročila v tem stanju ni mogoče preklicati." }); return; }
  if (outcome === "has_receipts") { res.status(409).json({ error: "Naročila s povezano prejemnico ni mogoče preklicati." }); return; }
  res.json(await getSupplierOrderDetail(enotaId, id));
});

export default router;
