import Decimal from "decimal.js";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  accountsTable,
  counterpartiesTable,
  db,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  paymentBatchItemsTable,
  paymentBatchesTable,
  paymentLedgerAllocationsTable,
  paymentAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import { loadCard } from "./partner-ledger-loader";
import { invoiceClosingTotals } from "./invoice-closing-totals";

type Executor = Pick<typeof db, "select">;

export function naturalPaymentDirection(
  side: "debit" | "credit",
  accountType: string,
): "inbound" | "outbound" | null {
  if (side === "credit" && accountType === "liability") return "outbound";
  if (side === "debit" && accountType === "asset") return "inbound";
  return null;
}

export function ledgerOpenItemType(
  accountType: string,
  side: "debit" | "credit",
): "issued" | "received" {
  if (accountType === "asset") return "issued";
  if (accountType === "liability") return "received";
  return side === "debit" ? "issued" : "received";
}

export function cardBalanceIsUnambiguouslyInvoiceMapped(
  sameEntryAccountPartnerInvoiceCount: number,
): boolean {
  return sameEntryAccountPartnerInvoiceCount === 1;
}

export function openItemAgedBucket(dueDate: string | null, asOfDate: string):
  "current" | "bucket1to30" | "bucket31to60" | "bucket61to90" | "bucketOver90" | "undated" {
  if (!dueDate) return "undated";
  const days = Math.floor((new Date(`${asOfDate}T00:00:00.000Z`).getTime()
    - new Date(`${dueDate}T00:00:00.000Z`).getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "bucket1to30";
  if (days <= 60) return "bucket31to60";
  if (days <= 90) return "bucket61to90";
  return "bucketOver90";
}

export type OpenItemFilters = {
  asOfDate?: string;
  counterpartyId?: string;
  partnerId?: string;
  accountId?: string;
  type?: "issued" | "received";
  invoiceDateFrom?: string;
  invoiceDateTo?: string;
  excludeIds?: string[];
};

export type OpenItem = {
  id: string;
  sourceKind: "invoice" | "ledger";
  sourceId: string;
  invoiceId: string | null;
  journalLineId?: string;
  entryId?: string;
  aliasIds: string[];
  side: "debit" | "credit";
  openDebit: string;
  openCredit: string;
  paymentDirection: "inbound" | "outbound" | null;
  reference: string | null;
  description: string;
  accountId: string;
  arApAccountId: string;
  accountCode: string;
  accountName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  type: "issued" | "received";
  invoiceType: "issued" | "received";
  counterpartyId: string;
  partnerId: string;
  counterpartyName: string;
  totalGross: string;
  allocatedAmount: string;
  remainingAmount: string;
  activePaymentBatchId: string | null;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  type: "issued" | "received";
  counterpartyId: string;
  counterpartyName: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  status: string;
  linkedEntryId: string | null;
  linkedEntryStatus: string | null;
  linkedEntryReference: string | null;
  historicalGross: string | null;
  activePaymentBatchId: string | null;
};

/**
 * Common read model for invoice-backed and native GL open items. Invoice
 * balances with a uniquely mapped subledger line use the partner-card
 * calculation; orphaned or ambiguous invoice mappings retain per-invoice
 * gross/payment-allocation balances rather than duplicating a shared GL line.
 */
export async function loadUnifiedOpenItems(
  companyId: string,
  filters: OpenItemFilters = {},
  executor: Executor = db,
): Promise<{
  items: OpenItem[];
  totalRemaining: string;
  totalOpenDebit: string;
  totalOpenCredit: string;
  asOfDate: string;
}> {
  const asOfDate = filters.asOfDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error("asOfDate mora biti YYYY-MM-DD.");
  }

  const counterpartyId = filters.partnerId ?? filters.counterpartyId;
  const invoiceConditions = [
    eq(invoicesTable.companyId, companyId),
    lte(invoicesTable.invoiceDate, asOfDate),
    sql`${invoicesTable.status} IN ('posted', 'paid')`,
  ];
  if (counterpartyId) invoiceConditions.push(eq(invoicesTable.counterpartyId, counterpartyId));
  if (filters.accountId) invoiceConditions.push(eq(invoicesTable.arApAccountId, filters.accountId));
  if (filters.type) invoiceConditions.push(eq(invoicesTable.type, filters.type));
  if (filters.invoiceDateFrom) invoiceConditions.push(sql`${invoicesTable.invoiceDate} >= ${filters.invoiceDateFrom}`);
  if (filters.invoiceDateTo) invoiceConditions.push(sql`${invoicesTable.invoiceDate} <= ${filters.invoiceDateTo}`);

  const invoices: InvoiceRow[] = await executor.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    invoiceDate: invoicesTable.invoiceDate,
    dueDate: invoicesTable.dueDate,
    type: invoicesTable.type,
    counterpartyId: invoicesTable.counterpartyId,
    counterpartyName: counterpartiesTable.name,
    accountId: invoicesTable.arApAccountId,
    accountCode: accountsTable.code,
    accountName: accountsTable.name,
    status: invoicesTable.status,
    linkedEntryId: invoicesTable.linkedEntryId,
    linkedEntryStatus: journalEntriesTable.status,
    linkedEntryReference: journalEntriesTable.reference,
    historicalGross: invoicesTable.historicalGross,
    activePaymentBatchId: sql<string | null>`(
      SELECT ${sql.raw("payment_batches.id")}
      FROM payment_allocations
      JOIN payment_batch_items ON payment_batch_items.payment_id = payment_allocations.payment_id
      JOIN payment_batches ON payment_batches.id = payment_batch_items.batch_id
      WHERE payment_allocations.invoice_id = ${invoicesTable.id}
        AND payment_batches.company_id = ${companyId}
        AND payment_batch_items.released_at IS NULL
        AND payment_batches.status IN ('ready', 'exported', 'partially_executed')
      LIMIT 1
    )`,
  }).from(invoicesTable)
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
    .innerJoin(accountsTable, eq(accountsTable.id, invoicesTable.arApAccountId))
    .leftJoin(journalEntriesTable, eq(journalEntriesTable.id, invoicesTable.linkedEntryId))
    .where(and(...invoiceConditions))
    .orderBy(asc(invoicesTable.invoiceDate));

  // SSP intentionally remains on the dedicated route path, which validates
  // invoice identity, posted POS reference, and unit ownership independently.
  const eligibleInvoices = invoices;

  const invoiceIds = eligibleInvoices.map((invoice) => invoice.id);
  const grossRows = invoiceIds.length ? await executor.select({
    invoiceId: invoiceLinesTable.invoiceId,
    gross: sql<string>`COALESCE(SUM(COALESCE(
      ${invoiceLinesTable.vatBase}::numeric + ${invoiceLinesTable.vatAmount}::numeric,
      (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric)
        + (${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric
          * ${invoiceLinesTable.vatRate}::numeric / 100)
    )), 0)`,
  }).from(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
    .groupBy(invoiceLinesTable.invoiceId) : [];
  const grossByInvoice = new Map(grossRows.map((row) => [row.invoiceId, new Decimal(row.gross ?? 0)]));
  for (const invoice of eligibleInvoices) {
    if ((grossByInvoice.get(invoice.id) ?? new Decimal(0)).isZero() && invoice.historicalGross !== null) {
      grossByInvoice.set(invoice.id, new Decimal(invoice.historicalGross));
    }
  }

  const postedAllocations = invoiceIds.length ? await executor.select({
    invoiceId: paymentAllocationsTable.invoiceId,
    allocatedAmount: paymentAllocationsTable.allocatedAmount,
  }).from(paymentAllocationsTable)
    .innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
    .where(and(
      inArray(paymentAllocationsTable.invoiceId, invoiceIds),
      eq(paymentsTable.companyId, companyId),
      eq(paymentsTable.status, "posted"),
      lte(paymentsTable.paymentDate, asOfDate),
    )) : [];
  const allocatedByInvoice = new Map<string, Decimal>();
  for (const allocation of postedAllocations) {
    allocatedByInvoice.set(allocation.invoiceId,
      (allocatedByInvoice.get(allocation.invoiceId) ?? new Decimal(0)).plus(allocation.allocatedAmount));
  }
  const closureTotals = invoiceIds.length
    ? await invoiceClosingTotals(companyId, invoiceIds, asOfDate, executor as typeof db)
    : new Map<string, number>();

  const card = await loadCard(companyId, {
    dateTo: asOfDate,
    mode: "posted",
    ...(counterpartyId ? { partnerId: counterpartyId } : {}),
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
  }, executor as typeof db);
  const cardLines = card.lines as Array<{
    lineId: string; partnerId: string; partnerName: string; accountId: string; accountCode: string;
    accountName: string; entryId: string; documentNumber: string | null; reference: string | null;
    description: string; documentDate: string | null; postingDate: string; dueDate: string | null;
    debit: string; credit: string; openDebit: string; openCredit: string;
  }>;
  const invoiceEntryIds = [...new Set(eligibleInvoices.flatMap((invoice) =>
    invoice.linkedEntryId ? [invoice.linkedEntryId] : []))];
  const invoiceMappings = invoiceEntryIds.length ? await executor.select({
    linkedEntryId: invoicesTable.linkedEntryId,
    accountId: invoicesTable.arApAccountId,
    counterpartyId: invoicesTable.counterpartyId,
  }).from(invoicesTable).where(and(
    eq(invoicesTable.companyId, companyId),
    inArray(invoicesTable.linkedEntryId, invoiceEntryIds),
  )) : [];
  const invoiceMappingCounts = new Map<string, number>();
  const invoiceMappingKey = (entryId: string | null, accountId: string, partnerId: string) =>
    `${entryId ?? ""}\u0000${accountId}\u0000${partnerId}`;
  for (const mapping of invoiceMappings) {
    const key = invoiceMappingKey(mapping.linkedEntryId, mapping.accountId, mapping.counterpartyId);
    invoiceMappingCounts.set(key, (invoiceMappingCounts.get(key) ?? 0) + 1);
  }
  const nativeBatchReservations = cardLines.length ? await executor.select({
    journalLineId: paymentLedgerAllocationsTable.journalLineId,
    batchId: paymentBatchesTable.id,
  }).from(paymentLedgerAllocationsTable)
    .innerJoin(paymentsTable, eq(paymentsTable.id, paymentLedgerAllocationsTable.paymentId))
    .innerJoin(paymentBatchItemsTable, eq(paymentBatchItemsTable.paymentId, paymentsTable.id))
    .innerJoin(paymentBatchesTable, eq(paymentBatchesTable.id, paymentBatchItemsTable.batchId))
    .where(and(
      inArray(paymentLedgerAllocationsTable.journalLineId, cardLines.map((line) => line.lineId)),
      eq(paymentsTable.companyId, companyId),
      eq(paymentsTable.status, "draft"),
      eq(paymentBatchesTable.companyId, companyId),
      isNull(paymentBatchItemsTable.releasedAt),
      inArray(paymentBatchItemsTable.lifecycleStatus, ["ready", "partially_executed", "executed"]),
      inArray(paymentBatchesTable.status, ["ready", "exported", "partially_executed", "executed"]),
    ))
    .orderBy(asc(paymentLedgerAllocationsTable.journalLineId), asc(paymentBatchesTable.createdAt),
      asc(paymentBatchesTable.id)) : [];
  const batchByJournalLine = new Map<string, string>();
  for (const reservation of nativeBatchReservations) {
    if (!batchByJournalLine.has(reservation.journalLineId)) {
      batchByJournalLine.set(reservation.journalLineId, reservation.batchId);
    }
  }

  // Any GL line belonging to a real invoice is suppressed from the native
  // ledger set, even when that invoice's balance is already zero.
  const invoiceGlRows = await executor.select({
    id: journalEntryLinesTable.id,
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .innerJoin(invoicesTable, and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.linkedEntryId, journalEntryLinesTable.entryId),
      eq(invoicesTable.arApAccountId, journalEntryLinesTable.accountId),
      eq(invoicesTable.counterpartyId, journalEntryLinesTable.partnerId),
    ))
    .where(eq(journalEntriesTable.companyId, companyId));
  const mappedGlIds = new Set(invoiceGlRows.map((row) => row.id));

  const items: OpenItem[] = [];
  const ambiguousInvoiceFallbacks = new Map<string, {
    entryId: string;
    accountId: string;
    partnerId: string;
    invoiceCount: number;
    openDebit: Decimal;
    openCredit: Decimal;
  }>();
  for (const invoice of eligibleInvoices) {
    const gross = grossByInvoice.get(invoice.id) ?? new Decimal(0);
    const sameEntryAccountPartnerInvoiceCount = invoiceMappingCounts.get(
      invoiceMappingKey(invoice.linkedEntryId, invoice.accountId, invoice.counterpartyId),
    ) ?? 0;
    const matchingCardLines = cardBalanceIsUnambiguouslyInvoiceMapped(sameEntryAccountPartnerInvoiceCount)
      ? cardLines.filter((line) => line.entryId === invoice.linkedEntryId
        && line.accountId === invoice.accountId && line.partnerId === invoice.counterpartyId)
      : [];
    const total = matchingCardLines.length
      ? matchingCardLines.reduce((sum, line) => sum.plus(line.debit).plus(line.credit), new Decimal(0))
      : gross;
    let remaining: Decimal;
    let side: "debit" | "credit";
    let openDebit: Decimal;
    let openCredit: Decimal;
    if (matchingCardLines.length) {
      openDebit = matchingCardLines.reduce((sum, line) => sum.plus(line.openDebit), new Decimal(0));
      openCredit = matchingCardLines.reduce((sum, line) => sum.plus(line.openCredit), new Decimal(0));
      side = openDebit.gte(openCredit) ? "debit" : "credit";
      remaining = Decimal.max(openDebit, openCredit);
    } else {
      side = invoice.type === "issued" ? "debit" : "credit";
      remaining = Decimal.max(0, gross.minus(closureTotals.get(invoice.id)
        ?? allocatedByInvoice.get(invoice.id) ?? 0));
      openDebit = side === "debit" ? remaining : new Decimal(0);
      openCredit = side === "credit" ? remaining : new Decimal(0);
    }
    if (!matchingCardLines.length && invoice.linkedEntryId && sameEntryAccountPartnerInvoiceCount > 1) {
      const key = invoiceMappingKey(invoice.linkedEntryId, invoice.accountId, invoice.counterpartyId);
      const fallback = ambiguousInvoiceFallbacks.get(key) ?? {
        entryId: invoice.linkedEntryId,
        accountId: invoice.accountId,
        partnerId: invoice.counterpartyId,
        invoiceCount: 0,
        openDebit: new Decimal(0),
        openCredit: new Decimal(0),
      };
      fallback.invoiceCount += 1;
      fallback.openDebit = fallback.openDebit.plus(openDebit);
      fallback.openCredit = fallback.openCredit.plus(openCredit);
      ambiguousInvoiceFallbacks.set(key, fallback);
    }
    if (remaining.lt("0.005")) continue;
    const cardLine = matchingCardLines[0];
    const expectedSide = invoice.type === "issued" ? "debit" : "credit";
    const paymentDirection = openDebit.gt(0) && openCredit.isZero()
      ? (expectedSide === "debit" ? "inbound" : null)
      : openCredit.gt(0) && openDebit.isZero()
        ? (expectedSide === "credit" ? "outbound" : null) : null;
    items.push({
      id: invoice.id,
      sourceKind: "invoice",
      sourceId: invoice.id,
      invoiceId: invoice.id,
      ...(invoice.linkedEntryId ? { entryId: invoice.linkedEntryId } : {}),
      ...(cardLine ? { journalLineId: cardLine.lineId, entryId: cardLine.entryId } : {}),
      aliasIds: [...new Set([invoice.id, ...matchingCardLines.map((line) => line.lineId)])],
      side,
      openDebit: openDebit.toFixed(2),
      openCredit: openCredit.toFixed(2),
      paymentDirection,
      reference: invoice.invoiceNumber,
      description: invoice.invoiceNumber,
      accountId: invoice.accountId,
      arApAccountId: invoice.accountId,
      accountCode: invoice.accountCode,
      accountName: invoice.accountName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      type: invoice.type,
      invoiceType: invoice.type,
      counterpartyId: invoice.counterpartyId,
      partnerId: invoice.counterpartyId,
      counterpartyName: invoice.counterpartyName,
      totalGross: total.toFixed(2),
      allocatedAmount: Decimal.max(0, total.minus(remaining)).toFixed(2),
      remainingAmount: remaining.toFixed(2),
      activePaymentBatchId: invoice.activePaymentBatchId,
    });
  }

  // When several invoices claim the same GL entry/account/partner identity,
  // invoice fallback is safe only if its combined open balance agrees with
  // the authoritative card balance. Never guess how a shared GL close should
  // be redistributed between those invoices.
  for (const [key, fallback] of ambiguousInvoiceFallbacks) {
    const mappedInvoiceCount = invoiceMappingCounts.get(key) ?? 0;
    if (fallback.invoiceCount !== mappedInvoiceCount) continue;
    const groupLines = cardLines.filter((line) => line.entryId === fallback.entryId
      && line.accountId === fallback.accountId && line.partnerId === fallback.partnerId);
    const cardOpenDebit = groupLines.reduce((sum, line) => sum.plus(line.openDebit), new Decimal(0));
    const cardOpenCredit = groupLines.reduce((sum, line) => sum.plus(line.openCredit), new Decimal(0));
    if (!fallback.openDebit.eq(cardOpenDebit) || !fallback.openCredit.eq(cardOpenCredit)) {
      throw Object.assign(new Error(
        `Ambiguous invoice mapping for GL entry ${fallback.entryId}, account ${fallback.accountId}, partner ${fallback.partnerId}: invoice fallback open debit/credit ${fallback.openDebit.toFixed(2)}/${fallback.openCredit.toFixed(2)} disagrees with authoritative GL card ${cardOpenDebit.toFixed(2)}/${cardOpenCredit.toFixed(2)}. Verify the invoice linkage and closing evidence; reconcile the source records before using this open-item view.`,
      ), { status: 409, statusCode: 409, code: "AMBIGUOUS_INVOICE_GL_BALANCE_MISMATCH" });
    }
  }

  const openItemAccounts = await executor.select({
    id: accountsTable.id, type: accountsTable.type,
  })
    .from(accountsTable).where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isOpenItem, true)));
  const openAccountById = new Map(openItemAccounts.map((account) => [account.id, account]));
  for (const line of cardLines) {
    const account = openAccountById.get(line.accountId);
    if (!account || mappedGlIds.has(line.lineId)
      || (counterpartyId && line.partnerId !== counterpartyId)
      || (filters.accountId && line.accountId !== filters.accountId)) continue;
    const openDebit = new Decimal(line.openDebit);
    const openCredit = new Decimal(line.openCredit);
    if (openDebit.lt("0.005") && openCredit.lt("0.005")) continue;
    const side = openDebit.gte(openCredit) ? "debit" : "credit";
    const remaining = Decimal.max(openDebit, openCredit);
    const itemType = ledgerOpenItemType(account.type, side);
    const paymentDirection = naturalPaymentDirection(side, account.type);
    const documentLabel = line.documentNumber ?? line.reference ?? line.description ?? line.lineId;
    const displayDate = line.documentDate ?? line.postingDate;
    if ((filters.type && itemType !== filters.type)
      || (filters.invoiceDateFrom && displayDate < filters.invoiceDateFrom)
      || (filters.invoiceDateTo && displayDate > filters.invoiceDateTo)) continue;
    items.push({
      id: `ledger:${line.lineId}`,
      sourceKind: "ledger",
      sourceId: line.lineId,
      invoiceId: null,
      journalLineId: line.lineId,
      entryId: line.entryId,
      aliasIds: [line.lineId, `ledger:${line.lineId}`],
      side,
      openDebit: openDebit.toFixed(2),
      openCredit: openCredit.toFixed(2),
      paymentDirection,
      reference: line.reference,
      description: line.description,
      accountId: line.accountId,
      arApAccountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      invoiceNumber: documentLabel,
      invoiceDate: displayDate,
      dueDate: null,
      type: itemType,
      invoiceType: itemType,
      counterpartyId: line.partnerId,
      partnerId: line.partnerId,
      counterpartyName: line.partnerName,
      totalGross: new Decimal(line.debit).plus(line.credit).toFixed(2),
      allocatedAmount: new Decimal(line.debit).plus(line.credit).minus(remaining).toFixed(2),
      remainingAmount: remaining.toFixed(2),
      activePaymentBatchId: batchByJournalLine.get(line.lineId) ?? null,
    });
  }

  const excluded = new Set(filters.excludeIds ?? []);
  const filteredItems = items.filter((item) => !item.aliasIds.some((alias) => excluded.has(alias)));
  filteredItems.sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate)
    || left.invoiceNumber.localeCompare(right.invoiceNumber) || left.id.localeCompare(right.id));
  const totalRemaining = filteredItems
    .filter((item) => item.paymentDirection !== null)
    .reduce((sum, item) => sum.plus(item.remainingAmount), new Decimal(0)).toFixed(2);
  const totalOpenDebit = filteredItems.reduce((sum, item) => sum.plus(item.openDebit), new Decimal(0)).toFixed(2);
  const totalOpenCredit = filteredItems.reduce((sum, item) => sum.plus(item.openCredit), new Decimal(0)).toFixed(2);
  return { items: filteredItems, totalRemaining, totalOpenDebit, totalOpenCredit, asOfDate };
}