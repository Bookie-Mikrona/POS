import { and, eq, inArray, lte, or } from "drizzle-orm";
import {
  bankStatementLinesTable,
  bankStatementsTable,
  bookieOldApSettlementsTable,
  bookieOldArSettlementsTable,
  bookieOldBankApClosingsTable,
  bookieOldNativeLedgerEvidenceTable,
  db,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  partnerSettlementEventsTable,
  paymentAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import { activeSettlementAmounts, type SettlementMovement } from "./partner-ledger-calculator";

function validOldRecordedDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return validOldRecordedDate(`${iso[2]}/${iso[3]}/${iso[1]}`);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]); const day = Number(match[2]); const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function invoiceClosingTotals(
  companyId: string,
  invoiceIds: string[],
  asOfDate: string,
  executor: typeof db = db,
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const events: SettlementMovement[] = [];
  const invoiceById = new Map<string, { entryId: string | null; accountId: string; partnerId: string }>();
  const invoiceRows = await executor.select({
    id: invoicesTable.id, entryId: invoicesTable.linkedEntryId,
    accountId: invoicesTable.arApAccountId, partnerId: invoicesTable.counterpartyId,
    type: invoicesTable.type, sourceType: invoicesTable.sourceType,
    historicalGross: invoicesTable.historicalGross, status: invoicesTable.status,
  }).from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, invoiceIds)));
  for (const row of invoiceRows) invoiceById.set(row.id, { entryId: row.entryId, accountId: row.accountId, partnerId: row.partnerId });
  const entryIds = [...new Set(invoiceRows.flatMap((row) => row.entryId ? [row.entryId] : []))];
  const invoiceLine = new Map<string, string>();
  const lineToInvoice = new Map<string, string>();
  const invoiceNativeLineIds = new Map<string, string[]>();
  const importedGlLines = new Map<string, { id: string; entryId: string; partnerId: string | null }>();
  if (entryIds.length) {
    const glRows = await executor.select({
      id: journalEntryLinesTable.id, entryId: journalEntryLinesTable.entryId,
      accountId: journalEntryLinesTable.accountId, partnerId: journalEntryLinesTable.partnerId,
      description: journalEntryLinesTable.description,
    }).from(journalEntryLinesTable).innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .where(and(eq(journalEntriesTable.companyId, companyId), inArray(journalEntryLinesTable.entryId, entryIds)));
    for (const line of glRows) {
      const sourceId = line.description?.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1];
      if (sourceId) importedGlLines.set(sourceId, line);
    }
    for (const invoice of invoiceRows) {
      const lines = glRows.filter((row) => row.entryId === invoice.entryId && row.accountId === invoice.accountId && row.partnerId === invoice.partnerId);
      const line = lines[0];
      if (line) {
        invoiceLine.set(invoice.id, line.id);
        invoiceNativeLineIds.set(invoice.id, lines.map((item) => item.id));
        for (const item of lines) lineToInvoice.set(item.id, invoice.id);
      }
    }
  }
  const allocations = await executor.select({
    id: paymentAllocationsTable.id, invoiceId: paymentAllocationsTable.invoiceId, paymentId: paymentsTable.id,
    allocatedAmount: paymentAllocationsTable.allocatedAmount, paymentDate: paymentsTable.paymentDate,
  }).from(paymentAllocationsTable).innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
    .where(and(inArray(paymentAllocationsTable.invoiceId, invoiceIds), eq(paymentsTable.companyId, companyId),
      eq(paymentsTable.status, "posted"), lte(paymentsTable.paymentDate, asOfDate)));
  const allocationByInvoice = new Map<string, typeof allocations>();
  for (const allocation of allocations) allocationByInvoice.set(allocation.invoiceId, [...(allocationByInvoice.get(allocation.invoiceId) ?? []), allocation]);
  for (const allocation of allocations) {
    events.push({ id: `payment-allocation:${allocation.id}`, sourceLineId: allocation.invoiceId, amount: allocation.allocatedAmount,
      effectiveDate: allocation.paymentDate, eventType: "close" });
  }
  const arRows = await executor.select({ invoiceId: bookieOldArSettlementsTable.invoiceId, sourceLineId: bookieOldArSettlementsTable.sourceLineId, evidence: bookieOldArSettlementsTable.evidence })
    .from(bookieOldArSettlementsTable).where(and(eq(bookieOldArSettlementsTable.companyId, companyId),
      inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds)));
  const legacyArIds: string[] = [];
  const legacySourceIds = new Set<string>();
  for (const row of arRows) for (const closing of row.evidence ?? []) {
    const date = validOldRecordedDate(closing.recordedDate);
    if (!date || date > asOfDate || !(Number(closing.amount) > 0)) continue;
    const duplicate = allocationByInvoice.get(row.invoiceId)?.some((allocation) =>
      allocation.paymentDate === date && Number(allocation.allocatedAmount) === Number(closing.amount));
    const id = `bookie-old-ar:${companyId}:${closing.closingId}`;
    if (legacySourceIds.has(id)) continue;
    legacySourceIds.add(id);
    legacyArIds.push(id);
    if (!duplicate) events.push({ id, sourceLineId: row.invoiceId, amount: closing.amount, effectiveDate: date, eventType: "close" });
  }
  const apRows = await executor.select({
    invoiceId: bookieOldBankApClosingsTable.invoiceId, closingId: bookieOldBankApClosingsTable.closingId,
    statementId: bookieOldBankApClosingsTable.statementId, sourceBankLineId: bookieOldBankApClosingsTable.sourceBankLineId,
    amount: bookieOldBankApClosingsTable.amount, recordedDate: bookieOldBankApClosingsTable.recordedDate,
  }).from(bookieOldBankApClosingsTable).where(and(eq(bookieOldBankApClosingsTable.companyId, companyId),
    inArray(bookieOldBankApClosingsTable.invoiceId, invoiceIds), lte(bookieOldBankApClosingsTable.recordedDate, asOfDate)));
  const sourceIds = [...new Set(apRows.map((row) => row.sourceBankLineId))];
  const statementIds = [...new Set(apRows.map((row) => row.statementId))];
  const bankLines = sourceIds.length ? await executor.select({
    id: bankStatementLinesTable.id, statementId: bankStatementLinesTable.statementId,
    transactionKey: bankStatementLinesTable.transactionKey,
  }).from(bankStatementLinesTable).innerJoin(bankStatementsTable, eq(bankStatementsTable.id, bankStatementLinesTable.statementId))
    .where(and(eq(bankStatementsTable.companyId, companyId), inArray(bankStatementLinesTable.statementId, statementIds),
      inArray(bankStatementLinesTable.transactionKey, sourceIds))) : [];
  const bankLineToSource = new Map(bankLines.map((row) => [`${row.statementId}:${row.transactionKey}`, row.id]));
  const sourceBankIds = [...new Set(bankLines.map((row) => row.id))];
  const linkedPaymentRows = sourceBankIds.length ? await executor.select({
    id: paymentsTable.id, bankLineId: paymentsTable.bankStatementLineId,
  }).from(paymentsTable).where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.status, "posted"),
    inArray(paymentsTable.bankStatementLineId, sourceBankIds))) : [];
  for (const row of apRows) {
    const bankLineId = bankLineToSource.get(`${row.statementId}:${row.sourceBankLineId}`);
    const paymentId = linkedPaymentRows.find((payment) => payment.bankLineId === bankLineId)?.id;
    const duplicate = paymentId && allocationByInvoice.get(row.invoiceId)?.some((allocation) =>
      allocation.paymentId === paymentId && Number(allocation.allocatedAmount) === Number(row.amount));
    const id = `bookie-old-ap:${companyId}:${row.closingId}`;
    if (legacySourceIds.has(id)) continue;
    legacySourceIds.add(id);
    if (!duplicate) events.push({ id, sourceLineId: row.invoiceId, amount: row.amount, effectiveDate: row.recordedDate, eventType: "close" });
  }
  // Supplier snapshots include old bank, cash and offsetting links. They are
  // evidence of existing postings, not new payments. Reuse the bank-evidence
  // identity so overlapping statement links are counted only once.
  const historicalAp = await executor.select({
    invoiceId: bookieOldApSettlementsTable.invoiceId,
    sourceLineId: bookieOldApSettlementsTable.sourceLineId,
    evidence: bookieOldApSettlementsTable.evidence,
  }).from(bookieOldApSettlementsTable).where(and(
    eq(bookieOldApSettlementsTable.companyId, companyId),
    inArray(bookieOldApSettlementsTable.invoiceId, invoiceIds),
  ));
  const coveredApInvoices = new Set(historicalAp.map(row => row.invoiceId));
  const missingApEvidence = invoiceRows.filter(row =>
    row.type === "received" && row.sourceType === "bookie-old" && Number(row.historicalGross) > 0
    && (row.status === "posted" || row.status === "paid") && !coveredApInvoices.has(row.id));
  if (missingApEvidence.length) {
    throw Object.assign(new Error(
      `Za ${missingApEvidence.length} zgodovinskih prejetih računov manjkajo preverjena dokazila zapiranj. Odprte obveznosti niso potrjene.`,
    ), { status: 409, statusCode: 409 });
  }
  for (const row of historicalAp) {
    const original = importedGlLines.get(row.sourceLineId);
    const invoice = invoiceById.get(row.invoiceId);
    if (original && original.entryId === invoice?.entryId && original.partnerId === invoice.partnerId) {
      const previous = invoiceLine.get(row.invoiceId);
      if (previous && previous !== original.id) lineToInvoice.delete(previous);
      invoiceLine.set(row.invoiceId, original.id);
      lineToInvoice.set(original.id, row.invoiceId);
      invoiceNativeLineIds.set(row.invoiceId, [
        ...new Set([...(invoiceNativeLineIds.get(row.invoiceId) ?? []), original.id]),
      ]);
    }
    for (const closing of row.evidence ?? []) {
      const date = validOldRecordedDate(closing.recordedDate);
      const id = `bookie-old-ap:${companyId}:${closing.closingId}`;
      if (!date || date > asOfDate || !(Number(closing.amount) > 0) || legacySourceIds.has(id)) continue;
      legacySourceIds.add(id);
      events.push({ id, sourceLineId: row.invoiceId, amount: closing.amount,
        effectiveDate: date, eventType: "close" });
    }
  }
  const nativeInvoiceLineIds = [...new Set([...invoiceNativeLineIds.values()].flat())];
  if (nativeInvoiceLineIds.length) {
    const nativeEvidenceRows = await executor.select({
      nativeLineId: bookieOldNativeLedgerEvidenceTable.nativeLineId,
      originalClosings: bookieOldNativeLedgerEvidenceTable.originalClosings,
    }).from(bookieOldNativeLedgerEvidenceTable).where(and(
      eq(bookieOldNativeLedgerEvidenceTable.companyId, companyId),
      inArray(bookieOldNativeLedgerEvidenceTable.nativeLineId, nativeInvoiceLineIds),
    ));
    type NativeClosing = (typeof nativeEvidenceRows)[number]["originalClosings"][number];
    type NativeClosingGroup = { closing: NativeClosing; invoiceIds: Set<string> };
    const invoiceByNativeLine = new Map<string, string>();
    for (const [invoiceId, nativeIds] of invoiceNativeLineIds) {
      for (const nativeId of nativeIds) invoiceByNativeLine.set(nativeId, invoiceId);
    }
    const nativeClosings = new Map<string, NativeClosingGroup>();
    for (const row of nativeEvidenceRows) {
      const invoiceId = invoiceByNativeLine.get(row.nativeLineId);
      if (!invoiceId) continue;
      for (const closing of row.originalClosings ?? []) {
        if (!(Number(closing.amount) > 0)) continue;
        const prior = nativeClosings.get(closing.closingId);
        if (prior) {
          if (prior.closing.sourceLineId !== closing.sourceLineId ||
              prior.closing.otherSourceLineId !== closing.otherSourceLineId ||
              Number(prior.closing.amount) !== Number(closing.amount)) {
            throw new Error(`Izvorni ZAPIRANJE ID ${closing.closingId} ima nasprotujoče invoice dokaze.`);
          }
          prior.invoiceIds.add(invoiceId);
        } else nativeClosings.set(closing.closingId, { closing, invoiceIds: new Set([invoiceId]) });
      }
    }
    const pairKey = (left: string, right: string, amount: string | number) =>
      `${[left, right].sort().join(":")}:${Number(amount).toFixed(2)}`;
    const coveredPairs = new Map<string, Set<string>>();
    for (const row of arRows) for (const closing of row.evidence ?? []) {
      const key = pairKey(row.sourceLineId, closing.otherLineId, closing.amount);
      coveredPairs.set(key, new Set([...(coveredPairs.get(key) ?? []), row.invoiceId]));
    }
    for (const row of historicalAp) for (const closing of row.evidence ?? []) {
      const key = pairKey(row.sourceLineId, closing.otherLineId, closing.amount);
      coveredPairs.set(key, new Set([...(coveredPairs.get(key) ?? []), row.invoiceId]));
    }
    const groups = new Map<string, NativeClosingGroup[]>();
    for (const item of nativeClosings.values()) {
      const closing = item.closing;
      const key = pairKey(closing.sourceLineId, closing.otherSourceLineId, closing.amount);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, group] of groups) {
      const remaining = new Set(group);
      const ordered = [...group].sort((left, right) =>
        left.closing.closingId.localeCompare(right.closing.closingId, undefined, { numeric: true }));
      for (const item of ordered) {
        if (!remaining.has(item)) continue;
        remaining.delete(item);
        const reciprocal = [...remaining].find((candidate) =>
          candidate.closing.sourceLineId === item.closing.otherSourceLineId &&
          candidate.closing.otherSourceLineId === item.closing.sourceLineId &&
          Number(candidate.closing.amount) === Number(item.closing.amount));
        if (reciprocal) remaining.delete(reciprocal);
        const canonical = reciprocal && reciprocal.closing.closingId.localeCompare(
          item.closing.closingId, undefined, { numeric: true },
        ) < 0 ? reciprocal : item;
        const dateA = validOldRecordedDate(item.closing.recordedDate);
        const dateB = reciprocal ? validOldRecordedDate(reciprocal.closing.recordedDate) : null;
        const recordedDate = dateA && dateB ? (dateA > dateB ? dateA : dateB) : dateA ?? dateB;
        if (!recordedDate || recordedDate > asOfDate) continue;
        const relatedInvoices = new Set([...item.invoiceIds, ...(reciprocal?.invoiceIds ?? [])]);
        const covered = coveredPairs.get(key) ?? new Set<string>();
        for (const invoiceId of relatedInvoices) {
          if (covered.has(invoiceId)) continue;
          const duplicateAllocation = allocationByInvoice.get(invoiceId)?.some((allocation) =>
            allocation.paymentDate === recordedDate &&
            Number(allocation.allocatedAmount) === Number(item.closing.amount));
          if (duplicateAllocation) continue;
          const id = `bookie-old-native:${companyId}:${canonical.closing.closingId}:invoice:${invoiceId}`;
          if (legacySourceIds.has(id)) continue;
          legacySourceIds.add(id);
          events.push({
            id, sourceLineId: invoiceId, amount: item.closing.amount,
            effectiveDate: recordedDate, eventType: "close",
          });
        }
      }
    }
  }
  const relevantLines = [...invoiceLine.values()];
  const manualRows = relevantLines.length ? await executor.select().from(partnerSettlementEventsTable).where(and(
    eq(partnerSettlementEventsTable.companyId, companyId),
    or(inArray(partnerSettlementEventsTable.sourceLineId, relevantLines), inArray(partnerSettlementEventsTable.targetLineId, relevantLines)),
    lte(partnerSettlementEventsTable.effectiveDate, asOfDate),
  )) : [];
  for (const event of manualRows) {
    const sourceInvoiceId = lineToInvoice.get(event.sourceLineId);
    const targetInvoiceId = lineToInvoice.get(event.targetLineId ?? "");
    const invoiceId = sourceInvoiceId ?? targetInvoiceId;
    if (!invoiceId) continue;
    events.push({ id: event.id,
      sourceLineId: sourceInvoiceId ?? targetInvoiceId!, targetLineId: sourceInvoiceId && targetInvoiceId && sourceInvoiceId !== targetInvoiceId ? targetInvoiceId : null,
      amount: event.amount, effectiveDate: event.effectiveDate,
      eventType: event.eventType, closeEventId: event.closeEventId, externalClosingId: event.externalClosingId });
  }
  const manualAndExternalRefs = [...new Set([
    ...legacyArIds,
    ...events.flatMap((event) => [event.id, event.closeEventId, event.externalClosingId].filter((v): v is string => Boolean(v))),
  ])];
  const externalReopens = manualAndExternalRefs.length ? await executor.select().from(partnerSettlementEventsTable).where(and(
    eq(partnerSettlementEventsTable.companyId, companyId), eq(partnerSettlementEventsTable.eventType, "reopen"),
    inArray(partnerSettlementEventsTable.externalClosingId, manualAndExternalRefs),
    lte(partnerSettlementEventsTable.effectiveDate, asOfDate),
  )) : [];
  for (const reopen of externalReopens) {
    if (events.some((event) => event.id === reopen.id)) continue;
    const invoiceId = lineToInvoice.get(reopen.sourceLineId);
    if (!invoiceId) continue;
    events.push({ id: reopen.id, sourceLineId: invoiceId, amount: reopen.amount, effectiveDate: reopen.effectiveDate,
      eventType: "reopen", closeEventId: reopen.closeEventId, externalClosingId: reopen.externalClosingId });
  }
  const active = activeSettlementAmounts(events, asOfDate);
  const totals = new Map<string, number>();
  for (const [id, amount] of active) {
    const source = events.find((event) => event.id === id);
    if (source) {
      totals.set(source.sourceLineId, (totals.get(source.sourceLineId) ?? 0) + Number(amount.toFixed(2)));
      if (source.targetLineId) totals.set(source.targetLineId, (totals.get(source.targetLineId) ?? 0) + Number(amount.toFixed(2)));
    }
  }
  return totals;
}