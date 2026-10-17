import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
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

export async function validateSupplierOrderReceiptLines(
  tx: typeof db | any,
  input: {
    enotaId: number;
    dobaviteljId: string | null | undefined;
    receiptId?: number;
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

  return [...new Set<number>(rows.map((row: any) => Number(row.narociloId)))];
}

export async function syncSupplierOrdersForReceipt(
  tx: typeof db | any,
  enotaId: number,
  receiptId: number,
): Promise<void> {
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
  await syncSupplierOrders(tx, enotaId, linkedLines.map((row: any) => row.orderId));
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
