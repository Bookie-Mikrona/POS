import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  artikelDobaviteljTable,
  db,
  posSupplierOrderLinesTable,
  posSupplierOrdersTable,
  prejemnicePostavkeTable,
  prejemniceTable,
} from "@workspace/db";

type ReceiptLineLink = {
  artikelId: number;
  supplierOrderLineId?: number | string | null;
  enotVPaketu?: number | string | null;
  izvKolicina?: number | string | null;
};

export class SupplierOrderReceiptConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierOrderReceiptConflict";
  }
}

export type SupplierOrderPackageFactorChange = {
  supplierOrderLineId: number;
  articleName: string;
  orderPackageName: string | null;
  orderFactor: number | null;
  orderBaseUnit: string | null;
  currentPackageName: string | null;
  currentFactor: number | null;
  currentBaseUnit: string | null;
};

export type SupplierOrderPackageFactorReviewSnapshot = SupplierOrderPackageFactorChange & {
  orderFactorExact: string | null;
  currentFactorExact: string | null;
};

export class SupplierOrderPackageFactorReviewRequired extends Error {
  constructor(readonly changes: SupplierOrderPackageFactorChange[]) {
    super("Podatki o pakiranju so se spremenili. Pred potrditvijo prejemnice preglejte shranjene in trenutne podatke.");
    this.name = "SupplierOrderPackageFactorReviewRequired";
  }
}

export class SupplierOrderBaseUnitMismatch extends Error {
  constructor(readonly changes: SupplierOrderPackageFactorChange[]) {
    super("Osnovna enota artikla se razlikuje od enote, shranjene na naročilu. Prejemnice ni mogoče potrditi, dokler enoti nista usklajeni.");
    this.name = "SupplierOrderBaseUnitMismatch";
  }
}

export async function validateSupplierOrderReceiptLines(
  tx: typeof db | any,
  input: {
    enotaId: number;
    dobaviteljId: string | null | undefined;
    receiptId?: number;
    forConfirmation?: boolean;
    lines: ReceiptLineLink[];
  },
): Promise<number[]> {
  const linked = input.lines.flatMap((line) => {
    if (line.supplierOrderLineId == null || line.supplierOrderLineId === "") return [];
    const id = Number(line.supplierOrderLineId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new SupplierOrderReceiptConflict("Neveljavna povezava s postavko naročila.");
    }
    return [{ id, line }];
  });
  if (linked.length === 0) return [];

  if (!input.dobaviteljId) {
    throw new SupplierOrderReceiptConflict("Prejemnica s povezavo na naročilo mora imeti izbranega dobavitelja.");
  }
  if (new Set(linked.map(({ id }) => id)).size !== linked.length) {
    throw new SupplierOrderReceiptConflict("Ista postavka naročila ne sme biti dvakrat v isti prejemnici.");
  }

  const initialRows = await tx
    .select({
      id: posSupplierOrderLinesTable.id,
      enotaId: posSupplierOrderLinesTable.enotaId,
      artikelId: posSupplierOrderLinesTable.artikelId,
      faktorPakiranja: posSupplierOrderLinesTable.faktorPakiranja,
      dobaviteljId: posSupplierOrdersTable.dobaviteljId,
      status: posSupplierOrdersTable.status,
      narociloId: posSupplierOrderLinesTable.narociloId,
    })
    .from(posSupplierOrderLinesTable)
    .innerJoin(
      posSupplierOrdersTable,
      and(
        eq(posSupplierOrdersTable.id, posSupplierOrderLinesTable.narociloId),
        eq(posSupplierOrdersTable.enotaId, posSupplierOrderLinesTable.enotaId),
      ),
    )
    .where(inArray(posSupplierOrderLinesTable.id, linked.map(({ id }) => id)));
  const orderIds = [...new Set<number>(initialRows.map((row: any) => Number(row.narociloId)))]
    .sort((a, b) => a - b);
  for (const orderId of orderIds) {
    await tx.execute(sql`
      SELECT id
      FROM pos_supplier_orders
      WHERE id = ${orderId} AND enota_id = ${input.enotaId}
      FOR UPDATE
    `);
  }
  const rows = await tx
    .select({
      id: posSupplierOrderLinesTable.id,
      enotaId: posSupplierOrderLinesTable.enotaId,
      artikelId: posSupplierOrderLinesTable.artikelId,
      faktorPakiranja: posSupplierOrderLinesTable.faktorPakiranja,
      dobaviteljId: posSupplierOrdersTable.dobaviteljId,
      status: posSupplierOrdersTable.status,
      narociloId: posSupplierOrderLinesTable.narociloId,
    })
    .from(posSupplierOrderLinesTable)
    .innerJoin(
      posSupplierOrdersTable,
      and(
        eq(posSupplierOrdersTable.id, posSupplierOrderLinesTable.narociloId),
        eq(posSupplierOrdersTable.enotaId, posSupplierOrderLinesTable.enotaId),
      ),
    )
    .where(inArray(posSupplierOrderLinesTable.id, linked.map(({ id }) => id)));
  const byId = new Map(rows.map((row: any) => [row.id, row]));

  for (const { id, line } of linked) {
    const orderLine = byId.get(id) as typeof rows[number] | undefined;
    const articleId = Number(line.artikelId);
    if (!orderLine
      || orderLine.enotaId !== input.enotaId
      || !Number.isInteger(articleId)
      || orderLine.artikelId !== articleId
      || orderLine.dobaviteljId !== input.dobaviteljId) {
      throw new SupplierOrderReceiptConflict("Postavka naročila ne pripada tej enoti, dobavitelju ali artiklu.");
    }
    if (orderLine.status !== "sent" && orderLine.status !== "partially_received") {
      throw new SupplierOrderReceiptConflict("Prevzem je mogoč samo iz naročila, ki je bilo poslano in še ni zaprto.");
    }

    const sourceQuantity = Number(line.izvKolicina);
    const packageFactor = Number(line.enotVPaketu ?? 1);
    if (!Number.isFinite(sourceQuantity) || sourceQuantity <= 0
      || !Number.isFinite(packageFactor) || packageFactor <= 0) {
      throw new SupplierOrderReceiptConflict("Količina ali pakiranje prejemnice ni veljavno.");
    }
  }

  const ids = linked.map(({ id }) => id);
  if (input.forConfirmation) {
    if (input.receiptId === undefined) {
      throw new SupplierOrderReceiptConflict("Potrjevanje zahteva določeno prejemnico.");
    }
    const overReceived = await tx.execute(sql`
      WITH receipt_quantities AS (
        SELECT
          order_line.id AS supplier_order_line_id,
          order_line.kolicina_pakiranj * order_line.faktor_pakiranja AS ordered_quantity,
          COALESCE(confirmed.received_quantity, 0) AS received_quantity,
          COALESCE(incoming.receipt_quantity, 0) AS receipt_quantity
        FROM pos_supplier_order_lines order_line
        LEFT JOIN LATERAL (
          SELECT SUM(receipt_line.kolicina) AS received_quantity
          FROM prejemnice_postavke receipt_line
          JOIN prejemnice receipt
            ON receipt.id = receipt_line.prejemnica_id
           AND receipt.enota_id = ${input.enotaId}
           AND receipt.status = 'confirmed'
          WHERE receipt_line.supplier_order_line_id = order_line.id
        ) confirmed ON TRUE
        LEFT JOIN LATERAL (
          SELECT SUM(receipt_line.kolicina) AS receipt_quantity
          FROM prejemnice_postavke receipt_line
          WHERE receipt_line.prejemnica_id = ${input.receiptId}
            AND receipt_line.supplier_order_line_id = order_line.id
        ) incoming ON TRUE
        WHERE order_line.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
          AND order_line.enota_id = ${input.enotaId}
      )
      SELECT supplier_order_line_id
      FROM receipt_quantities
      WHERE received_quantity + receipt_quantity > ordered_quantity + 0.000001
    `);
    if ((overReceived.rows as Array<{ supplier_order_line_id: number | string }>).length > 0) {
      throw new SupplierOrderReceiptConflict(
        "Količina prejemnice presega še neprejeto količino naročila.",
      );
    }
  } else {
    const duplicateDrafts = await tx
      .select({ lineId: prejemnicePostavkeTable.supplierOrderLineId })
      .from(prejemnicePostavkeTable)
      .innerJoin(prejemniceTable, eq(prejemniceTable.id, prejemnicePostavkeTable.prejemnicaId))
      .where(and(
        inArray(prejemnicePostavkeTable.supplierOrderLineId, ids),
        eq(prejemniceTable.enotaId, input.enotaId),
        eq(prejemniceTable.status, "draft"),
        ...(input.receiptId === undefined ? [] : [ne(prejemniceTable.id, input.receiptId)]),
      ));
    if (duplicateDrafts.length > 0) {
      throw new SupplierOrderReceiptConflict("Za izbrano postavko naročila že obstaja druga odprta prejemnica.");
    }
  }

  return [...new Set<number>(rows.map((row: any) => Number(row.narociloId)))];
}

export async function requireSupplierOrderPackageFactorReview(
  tx: typeof db | any,
  input: {
    enotaId: number;
    supplierOrderLineIds: Array<number | string | null | undefined>;
    reviewedPackageFactorChanges?: SupplierOrderPackageFactorChange[];
  },
): Promise<SupplierOrderPackageFactorReviewSnapshot[]> {
  const ids = [...new Set(input.supplierOrderLineIds
    .map(value => Number(value))
    .filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return [];

  const result = await tx.execute(sql`
    SELECT
      order_line.id AS "supplierOrderLineId",
      article.ime AS "articleName",
      order_line.naziv_pakiranja AS "orderPackageName",
      order_line.faktor_pakiranja::text AS "orderFactor",
      order_line.osnovna_enota AS "orderBaseUnit",
      mapping.naziv_paketa AS "currentPackageName",
      mapping.enot_v_paketu::text AS "currentFactor",
      article.enota_mere AS "currentBaseUnit",
      (
        order_line.faktor_pakiranja IS DISTINCT FROM mapping.enot_v_paketu
        OR order_line.naziv_pakiranja IS DISTINCT FROM mapping.naziv_paketa
        OR order_line.osnovna_enota IS DISTINCT FROM article.enota_mere
      ) AS changed
    FROM pos_supplier_order_lines order_line
    JOIN artikel_dobavitelj mapping
      ON mapping.id = order_line.supplier_mapping_id
     AND mapping.enota_id = ${input.enotaId}
    JOIN artikli article
      ON article.id = order_line.artikel_id
     AND article.enota_id = ${input.enotaId}
    WHERE order_line.id IN (
      ${sql.join(ids.map(id => sql`${id}`), sql`, `)}
    )
      AND order_line.enota_id = ${input.enotaId}
    ORDER BY mapping.id, order_line.id
     FOR UPDATE OF mapping, article, order_line
  `);

  const asNullableFactor = (value: unknown): number | null => {
    if (value == null || value === "") return null;
    const factor = Number(value);
    return Number.isFinite(factor) ? factor : null;
  };
  const reviewSnapshots = (result.rows as Array<{
    supplierOrderLineId: number | string;
    articleName: string;
    orderPackageName: string | null;
    orderFactor: number | string | null;
    orderBaseUnit: string | null;
    currentPackageName: string | null;
    currentFactor: number | string | null;
    currentBaseUnit: string | null;
    changed: boolean;
  }>)
    .filter(row => Boolean(row.changed))
    .map(row => {
      const orderFactorExact = row.orderFactor == null ? null : String(row.orderFactor);
      const currentFactorExact = row.currentFactor == null ? null : String(row.currentFactor);
      return {
        supplierOrderLineId: Number(row.supplierOrderLineId),
        articleName: row.articleName,
        orderPackageName: row.orderPackageName,
        orderFactor: asNullableFactor(row.orderFactor),
        orderFactorExact,
        orderBaseUnit: row.orderBaseUnit,
        currentPackageName: row.currentPackageName,
        currentFactor: asNullableFactor(row.currentFactor),
        currentFactorExact,
        currentBaseUnit: row.currentBaseUnit,
      };
    });
  const changes: SupplierOrderPackageFactorChange[] = reviewSnapshots.map(({
    orderFactorExact: _orderFactorExact,
    currentFactorExact: _currentFactorExact,
    ...change
  }) => change);
  if (changes.length === 0) return [];

  const normalizeBaseUnit = (unit: string | null) =>
    unit?.trim().toLocaleLowerCase("sl-SI") || null;
  const baseUnitMismatches = changes.filter(change =>
    normalizeBaseUnit(change.orderBaseUnit) !== normalizeBaseUnit(change.currentBaseUnit),
  );
  if (baseUnitMismatches.length > 0) {
    throw new SupplierOrderBaseUnitMismatch(baseUnitMismatches);
  }

  const reviewed = input.reviewedPackageFactorChanges ?? [];
  const reviewedByLineId = new Map(reviewed.map(change => [change.supplierOrderLineId, change]));
  const hasReviewedCurrentChanges = reviewedByLineId.size === reviewed.length
    && reviewed.length === changes.length
    && changes.every(change => {
      const acknowledgement = reviewedByLineId.get(change.supplierOrderLineId);
      return acknowledgement !== undefined
        && acknowledgement.articleName === change.articleName
        && acknowledgement.orderPackageName === change.orderPackageName
        && acknowledgement.orderFactor === change.orderFactor
        && acknowledgement.orderBaseUnit === change.orderBaseUnit
        && acknowledgement.currentPackageName === change.currentPackageName
        && acknowledgement.currentFactor === change.currentFactor
        && acknowledgement.currentBaseUnit === change.currentBaseUnit;
    });
  if (!hasReviewedCurrentChanges) {
    throw new SupplierOrderPackageFactorReviewRequired(changes);
  }
  return reviewSnapshots;
}

export async function syncSupplierOrdersForReceipt(
  tx: typeof db | any,
  enotaId: number,
  receiptId: number,
): Promise<void> {
  const linkedLines = await tx
    .select({
      orderId: posSupplierOrderLinesTable.narociloId,
      supplierMappingId: posSupplierOrderLinesTable.supplierMappingId,
    })
    .from(prejemnicePostavkeTable)
    .innerJoin(
      posSupplierOrderLinesTable,
      eq(posSupplierOrderLinesTable.id, prejemnicePostavkeTable.supplierOrderLineId),
    )
    .where(and(
      eq(prejemnicePostavkeTable.prejemnicaId, receiptId),
      eq(posSupplierOrderLinesTable.enotaId, enotaId),
    ));
  const mappingIds = [...new Set<number>(linkedLines
    .map((row: any) => row.supplierMappingId == null ? null : Number(row.supplierMappingId))
    .filter((id: number | null): id is number => id !== null))]
    .sort((a, b) => a - b);
  for (const mappingId of mappingIds) {
    await tx.execute(sql`
      SELECT id
      FROM artikel_dobavitelj
      WHERE id = ${mappingId} AND enota_id = ${enotaId}
      FOR UPDATE
    `);
  }
  await syncSupplierOrders(tx, enotaId, linkedLines.map((row: any) => row.orderId));
  if (mappingIds.length > 0) {
    await tx.execute(sql`
      WITH affected_mappings AS (
        SELECT DISTINCT order_line.supplier_mapping_id
        FROM prejemnice_postavke receipt_line
        JOIN pos_supplier_order_lines order_line
          ON order_line.id = receipt_line.supplier_order_line_id
         AND order_line.enota_id = ${enotaId}
        WHERE receipt_line.prejemnica_id = ${receiptId}
          AND order_line.supplier_mapping_id IS NOT NULL
      ),
      latest_confirmed_price AS (
        -- Keep the cached latest price consistent with the per-receipt history:
        -- use the quantity-weighted net unit price across all linked receipt lines.
        SELECT DISTINCT ON (receipt_prices.supplier_mapping_id)
          receipt_prices.supplier_mapping_id,
          receipt_prices.unit_price
        FROM (
          SELECT
            order_line.supplier_mapping_id,
            receipt.id AS receipt_id,
            receipt.datum AS receipt_date,
            ROUND(
              SUM(receipt_line.kolicina * receipt_line.neto_cena)
                / NULLIF(SUM(receipt_line.kolicina), 0),
              6
            ) AS unit_price
          FROM prejemnice_postavke receipt_line
          JOIN prejemnice receipt
            ON receipt.id = receipt_line.prejemnica_id
           AND receipt.enota_id = ${enotaId}
          JOIN pos_supplier_order_lines order_line
            ON order_line.id = receipt_line.supplier_order_line_id
           AND order_line.enota_id = ${enotaId}
          JOIN affected_mappings affected
            ON affected.supplier_mapping_id = order_line.supplier_mapping_id
          WHERE receipt.status = 'confirmed'
            AND receipt_line.neto_cena IS NOT NULL
            AND receipt_line.kolicina > 0
            AND (
              receipt_line.izv_cena IS NOT NULL
              OR COALESCE(receipt_line.neto_znesek, 0) > 0
              OR COALESCE(receipt_line.cena_kos, 0) > 0
            )
          GROUP BY order_line.supplier_mapping_id, receipt.id, receipt.datum
        ) receipt_prices
        ORDER BY
          receipt_prices.supplier_mapping_id,
          receipt_prices.receipt_date DESC,
          receipt_prices.receipt_id DESC
      )
      UPDATE artikel_dobavitelj mapping
      SET zadnja_cena_enota = latest.unit_price,
          zadnja_cena_paket = latest.unit_price * mapping.enot_v_paketu
      FROM latest_confirmed_price latest
      WHERE mapping.id = latest.supplier_mapping_id
        AND mapping.enota_id = ${enotaId}
    `);
  }
}

export type SupplierPriceReceiptSource = {
  receiptId: number;
  date: string;
  receiptNumber: string;
};

export type SupplierPriceHistoryEntry = SupplierPriceReceiptSource & {
  unitPrice: number;
  unitPriceDecimal: string;
};

export async function getSupplierPriceHistory(
  tx: typeof db | any,
  enotaId: number,
  mappingIds: number[],
  limit: number | null = 5,
): Promise<Map<number, SupplierPriceHistoryEntry[]>> {
  const scopedMappingIds = [...new Set(mappingIds)]
    .filter(id => Number.isInteger(id) && id > 0);
  if (scopedMappingIds.length === 0) return new Map();
  const historyLimit = limit === null
    ? null
    : Math.min(20, Math.max(1, Math.trunc(limit) || 5));
  const historyFilter = historyLimit === null
    ? sql`TRUE`
    : sql`"historyPosition" <= ${historyLimit}`;

  const result = await tx.execute(sql`
    -- A receipt may contain multiple linked lines for the same mapping. Compare
    -- it using the quantity-weighted net unit price, not an arbitrary line ID.
    WITH receipt_prices AS (
      SELECT
        order_line.supplier_mapping_id AS "mappingId",
        receipt.id AS "receiptId",
        TO_CHAR(receipt.datum, 'YYYY-MM-DD') AS "date",
        COALESCE(
          NULLIF(BTRIM(receipt.stevilka), ''),
          'ID-' || receipt.id::text
        ) AS "receiptNumber",
        ROUND(
          SUM(receipt_line.kolicina * receipt_line.neto_cena)
            / NULLIF(SUM(receipt_line.kolicina), 0),
          6
        )::double precision AS "unitPrice",
        ROUND(
          SUM(receipt_line.kolicina * receipt_line.neto_cena)
            / NULLIF(SUM(receipt_line.kolicina), 0),
          6
        )::text AS "unitPriceDecimal"
      FROM prejemnice_postavke receipt_line
      JOIN prejemnice receipt
        ON receipt.id = receipt_line.prejemnica_id
       AND receipt.enota_id = ${enotaId}
      JOIN pos_supplier_order_lines order_line
        ON order_line.id = receipt_line.supplier_order_line_id
       AND order_line.enota_id = ${enotaId}
      JOIN artikel_dobavitelj mapping
        ON mapping.id = order_line.supplier_mapping_id
       AND mapping.enota_id = ${enotaId}
      WHERE order_line.supplier_mapping_id IN (
        ${sql.join(scopedMappingIds.map(id => sql`${id}`), sql`, `)}
      )
        AND receipt.status = 'confirmed'
        AND receipt_line.neto_cena IS NOT NULL
        AND (
          receipt_line.izv_cena IS NOT NULL
          OR COALESCE(receipt_line.neto_znesek, 0) > 0
          OR COALESCE(receipt_line.cena_kos, 0) > 0
        )
        AND receipt_line.kolicina > 0
      GROUP BY
        order_line.supplier_mapping_id,
        receipt.id,
        receipt.datum,
        receipt.stevilka
    ),
    ranked_receipts AS (
      SELECT
        receipt_prices.*,
        ROW_NUMBER() OVER (
          PARTITION BY receipt_prices."mappingId"
          ORDER BY receipt_prices."date" DESC, receipt_prices."receiptId" DESC
        ) AS "historyPosition"
      FROM receipt_prices
    )
    SELECT "mappingId", "receiptId", "date", "receiptNumber", "unitPrice", "unitPriceDecimal"
    FROM ranked_receipts
    WHERE ${historyFilter}
    ORDER BY "mappingId", "date" DESC, "receiptId" DESC
  `);
  const history = new Map<number, SupplierPriceHistoryEntry[]>();
  for (const row of result.rows as Array<{
    mappingId: number | string;
    receiptId: number | string;
    date: string;
    receiptNumber: string;
    unitPrice: number | string;
    unitPriceDecimal: string;
  }>) {
    const mappingId = Number(row.mappingId);
    const entries = history.get(mappingId) ?? [];
    entries.push({
      receiptId: Number(row.receiptId),
      date: row.date,
      receiptNumber: row.receiptNumber,
      unitPrice: Number(row.unitPrice),
      unitPriceDecimal: row.unitPriceDecimal,
    });
    history.set(mappingId, entries);
  }
  return history;
}

export async function getLatestSupplierPriceReceipts(
  tx: typeof db | any,
  enotaId: number,
  mappingIds: number[],
): Promise<Map<number, SupplierPriceReceiptSource>> {
  const history = await getSupplierPriceHistory(tx, enotaId, mappingIds, 1);
  return new Map([...history.entries()].map(([mappingId, [latest]]) => [
    mappingId,
    {
      receiptId: latest.receiptId,
      date: latest.date,
      receiptNumber: latest.receiptNumber,
    },
  ]));
}

export async function syncSupplierOrders(
  tx: typeof db | any,
  enotaId: number,
  orderIds: number[],
): Promise<void> {
  for (const orderId of [...new Set(orderIds)].sort((a, b) => a - b)) {
    await tx.execute(sql`
      SELECT id
      FROM pos_supplier_orders
      WHERE id = ${orderId} AND enota_id = ${enotaId}
      FOR UPDATE
    `);
    const [order] = await tx
      .select({ status: posSupplierOrdersTable.status })
      .from(posSupplierOrdersTable)
      .where(and(
        eq(posSupplierOrdersTable.id, orderId),
        eq(posSupplierOrdersTable.enotaId, enotaId),
      ))
      .limit(1);
    if (!order || ["draft", "closed", "cancelled"].includes(order.status)) continue;

    const totals = await tx.execute(sql`
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
        COALESCE(SUM(line.kolicina_pakiranj * line.faktor_pakiranja), 0)::float8 AS ordered,
        COALESCE(SUM(received.received_base_quantity), 0)::float8 AS received
      FROM pos_supplier_order_lines line
      LEFT JOIN confirmed_received received
        ON received.supplier_order_line_id = line.id
      WHERE line.enota_id = ${enotaId}
        AND line.narocilo_id = ${orderId}
    `);
    const total = (totals.rows as Array<{ ordered: number | string; received: number | string }>)[0];
    if (!total) continue;
    const ordered = Number(total.ordered);
    const received = Number(total.received);
    const nextStatus = received <= 0.000001
      ? "sent"
      : received + 0.000001 >= ordered
        ? "received"
        : "partially_received";
    if (nextStatus === order.status) continue;
    await tx.update(posSupplierOrdersTable)
      .set({ status: nextStatus, posodobljeno: new Date() })
      .where(and(
        eq(posSupplierOrdersTable.id, orderId),
        eq(posSupplierOrdersTable.enotaId, enotaId),
      ));
  }
}

export async function getLinkedSupplierOrderIdsForReceipt(
  tx: typeof db | any,
  enotaId: number,
  receiptId: number,
): Promise<number[]> {
  const linkedLines = await tx
    .select({ orderId: posSupplierOrderLinesTable.narociloId })
    .from(prejemnicePostavkeTable)
    .innerJoin(
      posSupplierOrderLinesTable,
      eq(posSupplierOrderLinesTable.id, prejemnicePostavkeTable.supplierOrderLineId),
    )
    .where(and(
      eq(prejemnicePostavkeTable.prejemnicaId, receiptId),
      eq(posSupplierOrderLinesTable.enotaId, enotaId),
    ));
  return [...new Set<number>(linkedLines.map((row: any) => Number(row.orderId)))];
}
