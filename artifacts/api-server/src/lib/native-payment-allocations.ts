import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  paymentLedgerAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import { loadUnifiedOpenItems } from "./partner-open-items";
import { isPartnerLedgerOpening } from "./partner-ledger-provenance";
import { lockPartnerOpenItemLines } from "./partner-open-item-lock";

export type NativeAllocationInput = { journalLineId: string; allocatedAmount: number };
type Executor = typeof db;
const conflict = (message: string) => Object.assign(new Error(message), { status: 409, statusCode: 409 });

/**
 * Lock native open-item source rows in deterministic order. Manual closes use
 * the same journal-line row locks, so reservations cannot be invalidated by a
 * concurrent close or another package.
 */
export async function lockNativeSourceLines(
  tx: Executor,
  companyId: string,
  journalLineIds: string[],
): Promise<void> {
  const ids = [...new Set(journalLineIds)].sort();
  if (!ids.length) return;
  const locked = await lockPartnerOpenItemLines(tx, companyId, ids);
  if (locked.length !== ids.length) throw conflict("Ena ali več izbranih knjižbenih vrstic ni v aktivnem podjetju.");
}

/** Sum draft reservations, excluding released/rejected/cancelled batch items. */
export async function nativeReservations(
  tx: Executor,
  companyId: string,
  journalLineIds: string[],
  excludePaymentId?: string,
): Promise<Map<string, Decimal>> {
  const ids = [...new Set(journalLineIds)].sort();
  if (!ids.length) return new Map();
  const rows = await tx.select({
    journalLineId: paymentLedgerAllocationsTable.journalLineId,
    amount: sql<string>`COALESCE(SUM(${paymentLedgerAllocationsTable.allocatedAmount}), 0)`,
  }).from(paymentLedgerAllocationsTable)
    .innerJoin(paymentsTable, eq(paymentsTable.id, paymentLedgerAllocationsTable.paymentId))
    .where(and(
      inArray(paymentLedgerAllocationsTable.journalLineId, ids),
      eq(paymentsTable.companyId, companyId),
      eq(paymentsTable.status, "draft"),
      ...(excludePaymentId ? [sql`${paymentsTable.id} <> ${excludePaymentId}`] : []),
      sql`(
        NOT EXISTS (
          SELECT 1 FROM payment_batch_items pbi
          WHERE pbi.payment_id = ${paymentsTable.id}
        )
        OR EXISTS (
          SELECT 1 FROM payment_batch_items pbi
          JOIN payment_batches pb ON pb.id = pbi.batch_id
          WHERE pbi.payment_id = ${paymentsTable.id}
            AND pb.company_id = ${companyId}
            AND pbi.released_at IS NULL
            AND pbi.lifecycle_status IN ('ready', 'partially_executed', 'executed')
            AND pb.status IN ('ready', 'exported', 'partially_executed', 'executed')
        )
      )`,
    ))
    .groupBy(paymentLedgerAllocationsTable.journalLineId);
  return new Map(rows.map(row => [row.journalLineId, new Decimal(row.amount ?? 0)]));
}

/**
 * Verify allocations against the shared posted/as-of open-item model and
 * account for other draft package reservations. Caller must have acquired the
 * corresponding sorted source-line locks first.
 */
export async function validateNativeAllocations(
  tx: Executor,
  args: {
    companyId: string;
    partnerId: string;
    accountId: string;
    paymentDirection: "inbound" | "outbound";
    allocations: NativeAllocationInput[];
    asOfDate: string;
    excludePaymentId?: string;
  },
) {
  const { companyId, partnerId, accountId, paymentDirection, allocations, asOfDate } = args;
  const ids = allocations.map(allocation => allocation.journalLineId);
  if (new Set(ids).size !== ids.length) throw conflict("Ista knjižbena postavka je lahko v plačilu izbrana samo enkrat.");
  const sourceRows = ids.length ? await tx.select({
    id: journalEntryLinesTable.id,
    reference: journalEntriesTable.reference,
    status: journalEntriesTable.status,
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      inArray(journalEntryLinesTable.id, ids),
    )) : [];
  if (sourceRows.length !== ids.length || sourceRows.some(row => row.status !== "posted" || isPartnerLedgerOpening(row.reference))) {
    throw conflict("GL vir mora biti knjižena postavka in ne sme biti otvoritev.");
  }
  const unified = await loadUnifiedOpenItems(companyId, { asOfDate, partnerId, accountId }, tx);
  const byLine = new Map(unified.items
    .filter(item => item.sourceKind === "ledger" && item.journalLineId)
    .map(item => [item.journalLineId!, item]));
  const reserved = await nativeReservations(tx, companyId, ids, args.excludePaymentId);
  const checked = [];
  for (const allocation of allocations) {
    const item = byLine.get(allocation.journalLineId);
    const amount = new Decimal(allocation.allocatedAmount);
    if (!item || item.counterpartyId !== partnerId || item.accountId !== accountId
      || item.paymentDirection !== paymentDirection || !amount.isFinite() || amount.lte(0)
      || !amount.mul(100).isInteger()) {
      throw conflict("Knjižbena postavka ni odprta, knjižena ali primerna za izbrano smer, partnerja in konto.");
    }
    const available = new Decimal(item.remainingAmount).minus(reserved.get(allocation.journalLineId) ?? 0);
    if (amount.gt(available.plus("0.005"))) {
      throw conflict(`Dodelitev presega razpoložljiv ostanek postavke ${item.reference ?? item.journalLineId}.`);
    }
    checked.push({ allocation, item });
  }
  return checked;
}

/**
 * Manual settlement guard: after applying a proposed manual close, the line
 * must retain enough capacity for all active draft payment reservations.
 */
export async function assertManualClosePreservesNativeReservations(
  tx: Executor,
  companyId: string,
  lineId: string,
  remainingAfterClose: Decimal,
): Promise<void> {
  const reserved = await nativeReservations(tx, companyId, [lineId]);
  if ((reserved.get(lineId) ?? new Decimal(0)).gt(remainingAfterClose.plus("0.005"))) {
    throw new Error("Ročno zapiranje bi porabilo znesek, rezerviran v osnutku plačila ali aktivnem paketu.");
  }
}
