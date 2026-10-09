import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db, enoteTable, narocilaTable, izmeneTable, racuniTable, racunIzdajaZahteveTable,
  blagajniskiPremikiTable, preparedFoodDailyLedgersTable, preparedFoodWasteRecordsTable,
  posEventsTable, posEventUnitsTable, rezervacijeMizTable, posStockTransfersTable,
} from "@workspace/db";

export type CapabilityBlocker = { kind: string; description: string };
type BlockerDatabase = Pick<typeof db, "select" | "execute">;

/** Skupna preverba za izklop zmožnosti in izgubo dostopa ob znižanju paketa. */
export async function findCapabilityBlockers(
  enotaId: number, removed: readonly string[], database: BlockerDatabase = db,
): Promise<CapabilityBlocker[]> {
  const blockers: CapabilityBlocker[] = [];
  const removes = (...values: string[]) => values.some(value => removed.includes(value));
  if (removes("tables", "phone_orders", "qr_menu", "delivery", "kitchen", "checkout")) {
    const [row] = await database.select({ id: narocilaTable.id }).from(narocilaTable)
      .where(and(eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto"))).limit(1);
    if (row) blockers.push({ kind: "open_orders", description: "Enota ima odprta naročila." });
  }
  if (removes("shifts", "checkout")) {
    const [row] = await database.select({ id: izmeneTable.id }).from(izmeneTable)
      .where(and(eq(izmeneTable.enotaId, enotaId), isNull(izmeneTable.konec))).limit(1);
    if (row) blockers.push({ kind: "active_shifts", description: "Enota ima aktivne izmene." });
  }
  if (removed.includes("checkout")) {
    const [receipt] = await database.select({ id: racuniTable.id }).from(racuniTable)
      .where(and(eq(racuniTable.enotaId, enotaId), inArray(racuniTable.fursState, ["pending", "sending", "unknown"]))).limit(1);
    if (receipt) blockers.push({ kind: "pending_receipts", description: "Enota ima račune z nedokončanim FURS postopkom." });
    const [issue] = await database.select({ id: racunIzdajaZahteveTable.id }).from(racunIzdajaZahteveTable)
      .where(and(eq(racunIzdajaZahteveTable.enotaId, enotaId), inArray(racunIzdajaZahteveTable.status, ["processing", "unknown"]))).limit(1);
    if (issue) blockers.push({ kind: "pending_issuance", description: "Enota ima nedokončano izdajo računa." });
  }
  if (removed.includes("cash_movements")) {
    const [row] = await database.select({ id: blagajniskiPremikiTable.id }).from(blagajniskiPremikiTable)
      .where(and(eq(blagajniskiPremikiTable.enotaId, enotaId), eq(blagajniskiPremikiTable.status, "OSNUTEK"))).limit(1);
    if (row) blockers.push({ kind: "cash_drafts", description: "Enota ima odprte osnutke blagajniških premikov." });
  }
  if (removed.includes("prepared_food")) {
    const [ledger] = await database.select({ id: preparedFoodDailyLedgersTable.id }).from(preparedFoodDailyLedgersTable)
      .where(and(eq(preparedFoodDailyLedgersTable.enotaId, enotaId), isNull(preparedFoodDailyLedgersTable.closedAt))).limit(1);
    if (ledger) blockers.push({ kind: "prepared_food_open_day", description: "Dnevna evidenca pripravljene hrane še ni zaključena." });
    const [waste] = await database.select({ id: preparedFoodWasteRecordsTable.id }).from(preparedFoodWasteRecordsTable)
      .where(and(eq(preparedFoodWasteRecordsTable.enotaId, enotaId), eq(preparedFoodWasteRecordsTable.status, "osnutek"))).limit(1);
    if (waste) blockers.push({ kind: "prepared_food_waste_drafts", description: "Obstaja nepotrjen zapis odpisa pripravljene hrane." });
  }
  if (removed.includes("events")) {
    const linked = database.select({ eventId: posEventUnitsTable.eventId }).from(posEventUnitsTable)
      .where(eq(posEventUnitsTable.enotaId, enotaId));
    const [row] = await database.select({ id: posEventsTable.id }).from(posEventsTable)
      .where(and(inArray(posEventsTable.status, ["planned", "active"]),
        or(eq(posEventsTable.enotaId, enotaId), inArray(posEventsTable.id, linked)))).limit(1);
    if (row) blockers.push({ kind: "open_events", description: "Enota je povezana z načrtovanim ali aktivnim dogodkom." });
  }
  if (removes("reservations", "tables")) {
    const [row] = await database.select({ id: rezervacijeMizTable.id }).from(rezervacijeMizTable)
      .where(and(eq(rezervacijeMizTable.enotaId, enotaId), eq(rezervacijeMizTable.status, "aktivna"),
        gte(rezervacijeMizTable.zacetek, new Date()))).limit(1);
    if (row) blockers.push({ kind: "future_reservations", description: "Enota ima prihodnje aktivne rezervacije miz." });
  }
  if (removes("stock_transfers", "events")) {
    const [row] = await database.select({ id: posStockTransfersTable.id }).from(posStockTransfersTable)
      .where(and(eq(posStockTransfersTable.status, "draft"),
        or(eq(posStockTransfersTable.sourceUnitId, enotaId), eq(posStockTransfersTable.targetUnitId, enotaId)))).limit(1);
    if (row) blockers.push({ kind: "stock_transfer_drafts", description: "Enota ima osnutke dogodkovnih prenosov zaloge." });
  }
  if (removed.includes("deposits_tokens")) {
    // Individualni boni imajo veljavnost in saldo; starejši boni so skupna obveznost podjetja.
    const result = await database.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM individual_vouchers v
        WHERE v.unit_id = ${enotaId} AND v.status = 'active'
          AND (v.expires_at IS NULL OR v.expires_at > now())
          AND (SELECT COALESCE(SUM(CASE WHEN m.type IN ('issue', 'reverse') THEN m.amount_cents ELSE -m.amount_cents END), 0)
               FROM individual_voucher_movements m WHERE m.voucher_id = v.id) > 0
      ) OR (
        SELECT COALESCE(SUM(CASE WHEN g.tip = 'izdaja' THEN g.znesek ELSE -g.znesek END), 0)
        FROM darilni_bon_gibi g JOIN racuni r ON r.id = g.racun_id
        WHERE g.company_id = (SELECT company_id FROM enote WHERE id = ${enotaId})
          AND r.status <> 'storniran'
      ) > 0 AS blocked
    `);
    if ((result.rows[0] as { blocked?: boolean } | undefined)?.blocked) {
      blockers.push({ kind: "unredeemed_vouchers", description: "Enota ima veljavne neizkoriščene darilne bone ali podjetje odprt skupni saldo darilnih bonov." });
    }
  }
  // plate_waste nima osnutkov ali potrditvenega statusa; potrjenih evidenc ne blokiramo.
  return blockers;
}
