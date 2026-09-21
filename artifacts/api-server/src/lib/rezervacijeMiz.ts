import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db, rezervacijeMizTable } from "@workspace/db";
import { narocilaTable } from "@workspace/db";

export const RESERVATION_SPACING_MS = 3 * 60 * 60 * 1000;
export const ORDER_CUTOFF_MS = 2 * 60 * 60 * 1000;
export const DISPLAY_WINDOW_MS = 60 * 60 * 1000;
/** A no-show stops blocking three hours after its booked start. */
export const EXPIRY_WINDOW_MS = 3 * 60 * 60 * 1000;

export function reservationBlockingClause(mizaId: number, now = new Date()) {
  return and(
    eq(rezervacijeMizTable.mizaId, mizaId),
    eq(rezervacijeMizTable.status, "aktivna"),
    lte(rezervacijeMizTable.zacetek, new Date(now.getTime() + ORDER_CUTOFF_MS)),
    gt(rezervacijeMizTable.zacetek, new Date(now.getTime() - EXPIRY_WINDOW_MS)),
  );
}

export async function jeMizaBlokiranaZaNarocilo(mizaId: number, now = new Date()): Promise<boolean> {
  const [row] = await db.select({ id: rezervacijeMizTable.id }).from(rezervacijeMizTable)
    .where(reservationBlockingClause(mizaId, now)).limit(1);
  return Boolean(row);
}

/** Locking the parent row serializes competing booking and consumption writes. */
export async function zakleniMizo(tx: any, mizaId: number, enotaId: number): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT id FROM mize
    WHERE id = ${mizaId} AND enota_id = ${enotaId} AND COALESCE(arhivirana, false) = false
    FOR UPDATE
  `);
  return (result.rows?.length ?? 0) === 1;
}

export class ReservationOrderBlockedError extends Error {
  constructor() { super("REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA"); }
}

/** Must be called from the mutation transaction before changing an open order. */
export async function assertOpenOrderCanChange(tx: any, narociloId: number, enotaId: number): Promise<void> {
  const [snapshot] = await tx.select({ mizaId: narocilaTable.mizaId, status: narocilaTable.status })
    .from(narocilaTable).where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, enotaId)));
  if (!snapshot || snapshot.status !== "odprto" || snapshot.mizaId == null) return;

  // Global lock order for reservation-sensitive writes is table → order.
  if (!await zakleniMizo(tx, snapshot.mizaId, enotaId)) return;
  const [order] = await tx.select({ mizaId: narocilaTable.mizaId, status: narocilaTable.status })
    .from(narocilaTable)
    .where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, enotaId)))
    .for("update");
  if (!order || order.status !== "odprto" || order.mizaId == null) return;
  // A concurrent table transfer changed the target after our snapshot. Reject
  // this stale mutation; the client can retry against the refreshed order.
  if (order.mizaId !== snapshot.mizaId) throw new ReservationOrderBlockedError();
  const [blocking] = await tx.select({ id: rezervacijeMizTable.id })
    .from(rezervacijeMizTable).where(reservationBlockingClause(snapshot.mizaId)).limit(1);
  if (blocking) throw new ReservationOrderBlockedError();
}