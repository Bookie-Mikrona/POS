import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  accountsTable, bankStatementLinesTable, bankStatementsTable,
  bookieOldArSettlementsTable, bookieOldApSettlementsTable, bookieOldBankApClosingsTable,
  bookieOldNativeLedgerEvidenceTable, companiesTable, counterpartiesTable, db, invoicesTable,
  journalEntriesTable, journalEntryLinesTable, partnerSettlementEventsTable,
  paymentAllocationsTable, paymentsTable,
} from "@workspace/db";
import { calculatePartnerLedger, parseLegacyRecordedDate, type LedgerMovement, type SettlementMovement } from "./partner-ledger-calculator";
import { effectivePartnerLedgerRows, importedPartnerCode, isPartnerLedgerOpening } from "./partner-ledger-provenance";

const isoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

type RawLine = {
  id: string; partnerId: string; partnerName: string; partnerCity: string | null;
  accountId: string; accountCode: string; accountName: string; side: "debit" | "credit";
  amount: string; entryId: string; cardDate: string; documentDate: string | null; postingDate: string; dueDate: string | null;
  taxDate: string | null; description: string; reference: string | null; entryStatus: string;
  sourceType: string; sequence: number; documentNumber: string | null; documentType: string;
};

export async function loadCard(
  companyId: string,
  params: Record<string, string | undefined>,
  executor: Pick<typeof db, "select"> = db,
) {
  const asOfDate = params.dateTo ?? new Date().toISOString().slice(0, 10);
  const dateFrom = params.dateFrom;
  if (!isoDate(asOfDate) || (dateFrom && !isoDate(dateFrom)) || (dateFrom && dateFrom > asOfDate)) {
    throw new Error("Datum mora biti YYYY-MM-DD, datum od pa ne sme biti za datum do.");
  }
  if (params.mode && params.mode !== "posted" && params.mode !== "drafts") throw new Error("mode mora biti posted ali drafts");
  const status = params.mode === "drafts" ? "draft" : undefined;
  const conditions = [
    eq(journalEntriesTable.companyId, companyId),
    status ? eq(journalEntriesTable.status, "draft") : or(eq(journalEntriesTable.status, "posted"), eq(journalEntriesTable.status, "reversed"))!,
    lte(sql`COALESCE(${journalEntriesTable.documentDate}, ${journalEntriesTable.entryDate})`, asOfDate),
    ...(params.partnerId ? [eq(journalEntryLinesTable.partnerId, params.partnerId)] : []),
    ...(params.accountId ? [eq(journalEntryLinesTable.accountId, params.accountId)] : []),
  ];
  const rows = await executor.select({
    id: journalEntryLinesTable.id, partnerId: journalEntryLinesTable.partnerId,
    partnerName: counterpartiesTable.name, partnerCity: counterpartiesTable.city,
    accountId: journalEntryLinesTable.accountId, accountCode: accountsTable.code, accountName: accountsTable.name,
    side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount, entryId: journalEntriesTable.id,
    documentDate: journalEntriesTable.documentDate, postingDate: journalEntriesTable.entryDate,
    taxDate: journalEntriesTable.taxDate, dueDate: sql<string | null>`NULL`,
    description: sql<string>`COALESCE(${journalEntryLinesTable.description}, ${journalEntriesTable.description})`,
    reference: journalEntriesTable.reference, entryStatus: journalEntriesTable.status,
    sourceType: journalEntriesTable.sourceType, sequence: journalEntryLinesTable.sequence,
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, journalEntryLinesTable.partnerId))
    .where(and(...conditions))
    .orderBy(asc(sql`COALESCE(${journalEntriesTable.documentDate}, ${journalEntriesTable.entryDate})`), asc(journalEntriesTable.createdAt), asc(journalEntryLinesTable.sequence));
  const lines: RawLine[] = effectivePartnerLedgerRows([...new Map(rows.map((row) => [row.id, {
    ...row,
    partnerId: row.partnerId!,
    cardDate: row.documentDate ?? row.postingDate,
    dueDate: null,
    documentNumber: row.reference,
    documentType: row.reference?.match(/^BOOKIE-OLD\/K2\/\d{4}\/([^/]+)\//)?.[1] ?? row.sourceType,
  }])).values()]);
  const nativeSourceRows = params.mode !== "drafts" ? await executor.select({
    id: journalEntryLinesTable.id, partnerId: journalEntryLinesTable.partnerId,
    accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side,
    amount: journalEntryLinesTable.amount,
    entryId: journalEntriesTable.id,
    reference: journalEntriesTable.reference,
    description: sql<string>`COALESCE(${journalEntryLinesTable.description}, ${journalEntriesTable.description})`,
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      or(eq(journalEntriesTable.status, "posted"), eq(journalEntriesTable.status, "reversed"))!,
      lte(sql`COALESCE(${journalEntriesTable.documentDate}, ${journalEntriesTable.entryDate})`, asOfDate),
    )) : [];
  const nativeLineBySource = new Map<string, typeof nativeSourceRows>();
  for (const nativeLine of nativeSourceRows) {
    const sourceId = nativeLine.description?.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1];
    if (sourceId) nativeLineBySource.set(sourceId, [...(nativeLineBySource.get(sourceId) ?? []), nativeLine]);
  }
  const ids = lines.map((line) => line.id);
  const nativeEvidenceRows = ids.length && params.mode !== "drafts"
    ? await executor.select().from(bookieOldNativeLedgerEvidenceTable).where(and(
      eq(bookieOldNativeLedgerEvidenceTable.companyId, companyId),
      inArray(bookieOldNativeLedgerEvidenceTable.nativeLineId, ids),
    )) : [];
  const nativeEvidenceByLine = new Map(nativeEvidenceRows.map((row) => [row.nativeLineId, row]));
  const manualRows = ids.length && params.mode !== "drafts" ? await executor.select().from(partnerSettlementEventsTable).where(and(
    eq(partnerSettlementEventsTable.companyId, companyId),
    or(inArray(partnerSettlementEventsTable.sourceLineId, ids), inArray(partnerSettlementEventsTable.targetLineId, ids)),
    lte(partnerSettlementEventsTable.effectiveDate, asOfDate),
  )) : [];
  const settlementRows: SettlementMovement[] = manualRows.map((event) => ({
    id: event.id, sourceLineId: event.sourceLineId, targetLineId: event.targetLineId,
    amount: event.amount, effectiveDate: event.effectiveDate,
    eventType: event.eventType, closeEventId: event.closeEventId, externalClosingId: event.externalClosingId,
  }));
  const evidenceClosings = new Map<string, Array<Record<string, unknown>>>();
  const sourceEvidencePairKey = (left: string, right: string, value: string | number) =>
    `${[left, right].sort().join(":")}:${new Decimal(value).toFixed(2)}`;
  const sourceEvidencePairs = new Set<string>();
  const recordEvidence = (lineId: string, evidence: Record<string, unknown>) => {
    const current = evidenceClosings.get(lineId) ?? [];
    current.push({ type: "close", ...evidence });
    evidenceClosings.set(lineId, current);
  };

  const linkedInvoiceEntries = [...new Set(lines.map(line => line.entryId))];
  const invoiceRefs = linkedInvoiceEntries.length ? await executor.select({
    id: invoicesTable.id, linkedEntryId: invoicesTable.linkedEntryId,
    invoiceAccountId: invoicesTable.arApAccountId, invoicePartnerId: invoicesTable.counterpartyId,
    dueDate: invoicesTable.dueDate, invoiceNumber: invoicesTable.invoiceNumber, type: invoicesTable.type,
  }).from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId),
    inArray(invoicesTable.linkedEntryId, linkedInvoiceEntries))) : [];
  for (const line of lines) {
    const invoice = invoiceRefs.find(item => item.linkedEntryId === line.entryId && item.invoicePartnerId === line.partnerId);
    if (!invoice) continue;
    line.documentNumber = invoice.invoiceNumber;
    line.documentType = invoice.type;
    if (line.accountId === invoice.invoiceAccountId) line.dueDate = invoice.dueDate;
  }

  if (params.mode !== "drafts" && lines.length) {
    const invoiceLine = new Map<string, string>();
    for (const line of lines) {
      const invoice = invoiceRefs.find((i) => i.linkedEntryId === line.entryId &&
        line.accountId === i.invoiceAccountId && line.partnerId === i.invoicePartnerId);
      if (invoice && line.accountId === invoice.invoiceAccountId && line.partnerId === invoice.invoicePartnerId) {
        if (!invoiceLine.has(invoice.id)) invoiceLine.set(invoice.id, line.id);
        line.dueDate = invoice.dueDate;
      }
    }
    const invoiceIds = [...invoiceLine.keys()];
    if (invoiceIds.length) {
      const allocations = await executor.select({
        id: paymentAllocationsTable.id,
        invoiceId: paymentAllocationsTable.invoiceId,
        paymentEntryId: paymentsTable.linkedEntryId,
        amount: paymentAllocationsTable.allocatedAmount,
        paymentDate: paymentsTable.paymentDate,
      }).from(paymentAllocationsTable)
        .innerJoin(paymentsTable, eq(paymentsTable.id, paymentAllocationsTable.paymentId))
        .where(and(inArray(paymentAllocationsTable.invoiceId, invoiceIds), eq(paymentsTable.companyId, companyId),
          eq(paymentsTable.status, "posted"), lte(paymentsTable.paymentDate, asOfDate)));
      for (const allocation of allocations) {
        const invoiceLineId = invoiceLine.get(allocation.invoiceId);
        const invoiceLineRow = lines.find((line) => line.id === invoiceLineId);
        const paymentLine = lines.find((line) => line.entryId === allocation.paymentEntryId &&
          line.partnerId === invoiceLineRow?.partnerId && line.accountId === invoiceLineRow?.accountId);
        const amount = Number(allocation.amount);
        if (!invoiceLineId || !(amount > 0)) continue;
        const closingId = `payment-allocation:${allocation.id}`;
        settlementRows.push({ id: closingId, sourceLineId: invoiceLineId, targetLineId: paymentLine?.id ?? null,
          amount: allocation.amount, effectiveDate: allocation.paymentDate, eventType: "close" });
        recordEvidence(invoiceLineId, { id: closingId, source: "posted_payment_allocation", oppositeLineId: paymentLine?.id ?? null,
          amount: new Decimal(amount).toFixed(2), effectiveDate: allocation.paymentDate,
          warning: paymentLine ? null : "POSTED_PAYMENT_GL_COUNTERPART_NOT_IN_IMPORTED_SCOPE" });
        if (paymentLine) recordEvidence(paymentLine.id, { id: closingId, source: "posted_payment_allocation", oppositeLineId: invoiceLineId,
          amount: new Decimal(amount).toFixed(2), effectiveDate: allocation.paymentDate });
      }
      const arEvidence = await executor.select({
        invoiceId: bookieOldArSettlementsTable.invoiceId, sourceLineId: bookieOldArSettlementsTable.sourceLineId,
        evidence: bookieOldArSettlementsTable.evidence,
      }).from(bookieOldArSettlementsTable).where(and(eq(bookieOldArSettlementsTable.companyId, companyId), inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds)));
      const otherArLineIds = [...new Set(arEvidence.flatMap((row) => (row.evidence ?? []).map((item) => item.otherLineId)))];
      const oppositeArRefs = otherArLineIds.length ? await executor.select({
        sourceLineId: bookieOldArSettlementsTable.sourceLineId, invoiceId: bookieOldArSettlementsTable.invoiceId,
      }).from(bookieOldArSettlementsTable).where(and(eq(bookieOldArSettlementsTable.companyId, companyId),
        inArray(bookieOldArSettlementsTable.sourceLineId, otherArLineIds))) : [];
      const oppositeInvoiceIds = [...new Set(oppositeArRefs.map((row) => row.invoiceId))];
      const oppositeInvoices = oppositeInvoiceIds.length ? await executor.select({
        id: invoicesTable.id, linkedEntryId: invoicesTable.linkedEntryId,
        invoiceAccountId: invoicesTable.arApAccountId, invoicePartnerId: invoicesTable.counterpartyId,
      }).from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), inArray(invoicesTable.id, oppositeInvoiceIds))) : [];
      const oppositeLineBySource = new Map<string, string>();
      for (const ref of oppositeArRefs) {
        const invoice = oppositeInvoices.find((candidate) => candidate.id === ref.invoiceId);
        const invoiceSource = nativeLineBySource.get(ref.sourceLineId)
          ?.find((candidate) => candidate.entryId === invoice?.linkedEntryId
            && candidate.accountId === invoice.invoiceAccountId && candidate.partnerId === invoice.invoicePartnerId);
        const target = lines.find((candidate) => candidate.entryId === invoice?.linkedEntryId
          && candidate.accountId === invoice.invoiceAccountId && candidate.partnerId === invoice.invoicePartnerId
          && (!invoiceSource || candidate.id === invoiceSource.id));
        if (target) oppositeLineBySource.set(ref.sourceLineId, target.id);
      }
      const handledLegacyClosings = new Set<string>();
      for (const evidenceRow of arEvidence) {
        const invoice = invoiceRefs.find((candidate) => candidate.id === evidenceRow.invoiceId);
        const invoiceSource = nativeLineBySource.get(evidenceRow.sourceLineId)?.find((candidate) =>
          candidate.entryId === invoice?.linkedEntryId && candidate.accountId === invoice.invoiceAccountId
          && candidate.partnerId === invoice.invoicePartnerId);
        const lineId = invoiceSource && lines.some((candidate) => candidate.id === invoiceSource.id)
          ? invoiceSource.id : invoiceLine.get(evidenceRow.invoiceId);
        if (!lineId) continue;
        for (const evidence of evidenceRow.evidence ?? []) {
          const date = parseLegacyRecordedDate(evidence.recordedDate);
          const amount = Number(evidence.amount);
          if (date && date <= asOfDate && amount > 0) {
            sourceEvidencePairs.add(sourceEvidencePairKey(evidenceRow.sourceLineId, evidence.otherLineId, evidence.amount));
          }
          const closingId = `bookie-old-ar:${companyId}:${evidence.closingId}`;
          if (date && date <= asOfDate && amount > 0 && !handledLegacyClosings.has(closingId)) {
            handledLegacyClosings.add(closingId);
            const invoiceRaw = lines.find((candidate) => candidate.id === lineId);
            const nativeTarget = nativeLineBySource.get(evidence.otherLineId)?.find((candidate) =>
              candidate.partnerId === invoiceRaw?.partnerId && candidate.accountId === invoiceRaw?.accountId
              && candidate.side !== invoiceRaw?.side);
            const scopedNativeTarget = nativeTarget && lines.find((candidate) => candidate.id === nativeTarget.id);
            const fallbackTargetId = oppositeLineBySource.get(evidence.otherLineId);
            const fallbackTarget = lines.find((candidate) => candidate.id === fallbackTargetId
              && candidate.partnerId === invoiceRaw?.partnerId && candidate.accountId === invoiceRaw?.accountId
              && candidate.side !== invoiceRaw?.side);
            const targetLineId = scopedNativeTarget?.id ?? fallbackTarget?.id ?? null;
            settlementRows.push({ id: closingId, sourceLineId: lineId, targetLineId, amount: evidence.amount,
              effectiveDate: date, eventType: "close" });
            recordEvidence(lineId, { id: closingId, source: "bookie_old_ar", closingId: evidence.closingId,
              oppositeLineId: targetLineId, oppositeSourceLineReference: evidence.otherLineId, amount: new Decimal(amount).toFixed(2),
              effectiveDate: date,
              warning: targetLineId ? null : "HISTORICAL_COUNTERPART_NOT_IMPORTED_SCOPE" });
            if (targetLineId) recordEvidence(targetLineId, { id: closingId, source: "bookie_old_ar",
              oppositeLineId: lineId, oppositeSourceLineReference: evidenceRow.sourceLineId,
              amount: new Decimal(amount).toFixed(2), effectiveDate: date });
          }
        }
      }
      const apEvidence = await executor.select({
        invoiceId: bookieOldBankApClosingsTable.invoiceId,
        closingId: bookieOldBankApClosingsTable.closingId,
        statementId: bookieOldBankApClosingsTable.statementId,
        sourceBankLineId: bookieOldBankApClosingsTable.sourceBankLineId,
        recordedDate: bookieOldBankApClosingsTable.recordedDate,
        amount: bookieOldBankApClosingsTable.amount,
      }).from(bookieOldBankApClosingsTable).where(and(eq(bookieOldBankApClosingsTable.companyId, companyId),
        inArray(bookieOldBankApClosingsTable.invoiceId, invoiceIds), lte(bookieOldBankApClosingsTable.recordedDate, asOfDate)));
      const bankLineIds = [...new Set(apEvidence.map((row) => row.sourceBankLineId))];
      const statementIds = [...new Set(apEvidence.map((row) => row.statementId))];
      const sourceBankLines = bankLineIds.length ? await executor.select({
        id: bankStatementLinesTable.id, statementId: bankStatementLinesTable.statementId,
        transactionKey: bankStatementLinesTable.transactionKey,
      }).from(bankStatementLinesTable).innerJoin(bankStatementsTable, eq(bankStatementsTable.id, bankStatementLinesTable.statementId))
        .where(and(eq(bankStatementsTable.companyId, companyId), inArray(bankStatementLinesTable.statementId, statementIds),
          inArray(bankStatementLinesTable.transactionKey, bankLineIds))) : [];
      const linkedPayments = sourceBankLines.length ? await executor.select({
        bankStatementLineId: paymentsTable.bankStatementLineId, linkedEntryId: paymentsTable.linkedEntryId,
      }).from(paymentsTable).where(and(eq(paymentsTable.companyId, companyId),
        eq(paymentsTable.status, "posted"), inArray(paymentsTable.bankStatementLineId, sourceBankLines.map((row) => row.id)))) : [];
      const handledApClosings = new Set<string>();
      for (const evidence of apEvidence) {
        const lineId = invoiceLine.get(evidence.invoiceId);
        const stableId = `bookie-old-ap:${companyId}:${evidence.closingId}`;
        if (!lineId || handledApClosings.has(stableId)) continue;
        handledApClosings.add(stableId);
        const bankLine = sourceBankLines.find((row) => row.statementId === evidence.statementId && row.transactionKey === evidence.sourceBankLineId);
        const payment = linkedPayments.find((row) => row.bankStatementLineId === bankLine?.id);
        const invoiceLineRow = lines.find((line) => line.id === lineId);
        const targetLine = lines.find((line) => line.entryId === payment?.linkedEntryId &&
          line.partnerId === invoiceLineRow?.partnerId && line.accountId === invoiceLineRow?.accountId);
        const duplicateModernAllocation = allocations.some((allocation) => allocation.invoiceId === evidence.invoiceId
          && allocation.paymentEntryId === payment?.linkedEntryId
          && new Decimal(allocation.amount).eq(evidence.amount));
        if (duplicateModernAllocation) {
          recordEvidence(lineId, { id: stableId, source: "bookie_old_bank_ap", closingId: evidence.closingId,
            oppositeSourceLineReference: evidence.sourceBankLineId, amount: evidence.amount,
            effectiveDate: evidence.recordedDate, deduplicatedWith: "posted_payment_allocation" });
          continue;
        }
        settlementRows.push({ id: stableId, sourceLineId: lineId, targetLineId: targetLine?.id ?? null,
          amount: evidence.amount, effectiveDate: evidence.recordedDate, eventType: "close" });
        recordEvidence(lineId, { id: stableId, source: "bookie_old_bank_ap", closingId: evidence.closingId,
          oppositeSourceLineReference: evidence.sourceBankLineId, oppositeLineId: targetLine?.id ?? null,
          amount: evidence.amount, effectiveDate: evidence.recordedDate,
          warning: targetLine ? null : "HISTORICAL_BANK_COUNTERPART_NOT_IMPORTED_SCOPE" });
        if (targetLine) recordEvidence(targetLine.id, { id: stableId, source: "bookie_old_bank_ap",
          oppositeSourceLineReference: evidence.invoiceId, oppositeLineId: lineId, amount: evidence.amount,
          effectiveDate: evidence.recordedDate });
      }
    }
  }
  if (params.mode !== "drafts" && invoiceRefs.length && lines.length) {
    const historicalAp = await executor.select().from(bookieOldApSettlementsTable).where(and(
      eq(bookieOldApSettlementsTable.companyId, companyId),
      inArray(bookieOldApSettlementsTable.invoiceId, invoiceRefs.map(invoice => invoice.id)),
    ));
    const bySource = new Map(lines.flatMap(line => {
      const sourceId = line.description.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1];
      return sourceId ? [[sourceId, line] as const] : [];
    }));
    const handled = new Set([...evidenceClosings.values()].flatMap(items => items.map(item => String(item.id))));
    for (const row of historicalAp) {
      const source = bySource.get(row.sourceLineId);
      if (!source || source.side !== "credit") continue;
      const invoice = invoiceRefs.find(candidate => candidate.id === row.invoiceId);
      if (!invoice || source.entryId !== invoice.linkedEntryId || source.partnerId !== invoice.invoicePartnerId) continue;
      source.dueDate = invoice.dueDate;
      for (const closing of row.evidence) {
        const date = isoDate(closing.recordedDate) ? closing.recordedDate : parseLegacyRecordedDate(closing.recordedDate);
        const id = `bookie-old-ap:${companyId}:${closing.closingId}`;
        if (!date || date > asOfDate || !new Decimal(closing.amount).gt(0)) continue;
        sourceEvidencePairs.add(sourceEvidencePairKey(row.sourceLineId, closing.otherLineId, closing.amount));
        if (handled.has(id)) continue;
        handled.add(id);
        const counterpart = bySource.get(closing.otherLineId);
        const target = counterpart?.side === "debit" && counterpart.partnerId === source.partnerId ? counterpart : undefined;
        settlementRows.push({ id, sourceLineId: source.id, targetLineId: target?.id ?? null,
          amount: closing.amount, effectiveDate: date, eventType: "close" });
        recordEvidence(source.id, { id, source: "bookie_old_ap", closingId: closing.closingId,
          oppositeSourceLineReference: closing.otherLineId, oppositeLineId: target?.id ?? null,
          amount: closing.amount, effectiveDate: date,
          warning: target ? null : "HISTORICAL_COUNTERPART_NOT_IMPORTED_SCOPE" });
        if (target) recordEvidence(target.id, { id, source: "bookie_old_ap", closingId: closing.closingId,
          oppositeSourceLineReference: row.sourceLineId, oppositeLineId: source.id,
          amount: closing.amount, effectiveDate: date });
      }
    }
  }
  if (params.mode !== "drafts" && lines.length && nativeEvidenceRows.length) {
    type SourceProof = (typeof nativeEvidenceRows)[number]["originalClosings"][number]["sourceProof"];
    type ClosingProof = (typeof nativeEvidenceRows)[number]["originalClosings"][number];
    const nativeLineSourceId = (line: { description: string | null }) =>
      line.description?.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1] ?? null;
    const sourceAccount = (line: { description: string | null }) =>
      line.description?.match(/konto ([^,\]]+)/)?.[1]?.trim() ?? null;
    const matchesOriginalProof = (line: typeof nativeSourceRows[number], proof: SourceProof) =>
      nativeLineSourceId(line) === proof.sourceLineId &&
      sourceAccount(line) === proof.accountCode &&
      importedPartnerCode(line.reference, line.description ?? "") === proof.partnerCode &&
      proof.sides.some((side) => side.side === line.side && new Decimal(side.amount).eq(line.amount));
    const matchingNativeProofLines = (sourceId: string, proof: SourceProof) =>
      (nativeLineBySource.get(sourceId) ?? []).filter((candidate) => matchesOriginalProof(candidate, proof));
    const inCard = (line: typeof nativeSourceRows[number]) => lines.find((candidate) => candidate.id === line.id);
    const genericProofs = new Map<string, ClosingProof>();
    for (const row of nativeEvidenceRows) {
      for (const closing of row.originalClosings ?? []) {
        if (new Decimal(closing.amount).lte(0)) continue;
        const anchorProof = closing.anchorSide === "source" ? closing.sourceProof : closing.counterpartProof;
        const anchorId = closing.anchorSide === "source" ? closing.sourceLineId : closing.otherSourceLineId;
        const anchorLine = nativeLineBySource.get(anchorId)?.find((candidate) =>
          candidate.id === row.nativeLineId && matchesOriginalProof(candidate, anchorProof));
        if (!anchorLine) continue;
        const previous = genericProofs.get(closing.closingId);
        if (previous && (previous.amount !== closing.amount ||
            previous.sourceLineId !== closing.sourceLineId || previous.otherSourceLineId !== closing.otherSourceLineId)) {
          throw new Error(`Izvorni ZAPIRANJE ID ${closing.closingId} ima nasprotujoče dokaze.`);
        }
        genericProofs.set(closing.closingId, closing);
      }
    }

    const sourceIdForLine = (lineId: string | null | undefined) => {
      if (!lineId) return null;
      const native = nativeSourceRows.find((candidate) => candidate.id === lineId);
      return native ? nativeLineSourceId(native) : null;
    };
    const pairKey = (left: string, right: string, value: string | number) =>
      sourceEvidencePairKey(left, right, value);
    const alreadyHandledPairs = new Set<string>();
    for (const event of settlementRows) {
      if (event.eventType !== "close" || !event.targetLineId) continue;
      const left = sourceIdForLine(event.sourceLineId);
      const right = sourceIdForLine(event.targetLineId);
      if (left && right) alreadyHandledPairs.add(pairKey(left, right, event.amount));
    }
    const proofGroups = new Map<string, ClosingProof[]>();
    for (const closing of genericProofs.values()) {
      const key = pairKey(closing.sourceLineId, closing.otherSourceLineId, closing.amount);
      proofGroups.set(key, [...(proofGroups.get(key) ?? []), closing]);
    }
    const emitOriginalProof = (closingIds: string[], closing: ClosingProof, recordedDate: string) => {
      const date = isoDate(recordedDate) ? recordedDate : parseLegacyRecordedDate(recordedDate);
      if (!date || date > asOfDate) return;
      const sourceCandidates = matchingNativeProofLines(closing.sourceLineId, closing.sourceProof);
      const targetCandidates = matchingNativeProofLines(closing.otherSourceLineId, closing.counterpartProof);
      const sourceLine = sourceCandidates.find((candidate) => inCard(candidate));
      const targetLine = sourceLine && targetCandidates.find((candidate) =>
        candidate.partnerId === sourceLine.partnerId && candidate.accountId === sourceLine.accountId
        && candidate.side !== sourceLine.side && inCard(candidate));
      const counterpartLine = !sourceLine
        ? targetCandidates.find((candidate) => inCard(candidate))
        : undefined;
      const fromLine = sourceLine ?? counterpartLine;
      if (!fromLine) return;
      const linkedTarget = sourceLine ? targetLine : undefined;
      const id = `bookie-old-native:${companyId}:${closingIds[0]}`;
      if (settlementRows.some((event) => event.id === id)) return;
      settlementRows.push({
        id, sourceLineId: fromLine.id, targetLineId: linkedTarget?.id ?? null,
        amount: closing.amount, effectiveDate: date, eventType: "close",
      });
      const common = {
        id, source: "bookie_old_native_gl_zap",
        closingId: closingIds[0], originalClosingIds: closingIds,
        originalSourceLineReference: closing.sourceLineId,
        oppositeSourceLineReference: closing.otherSourceLineId,
        amount: closing.amount, effectiveDate: date,
        sourceProof: closing.sourceProof, counterpartProof: closing.counterpartProof,
        warning: linkedTarget ? null : "ORIGINAL_COUNTERPART_NOT_IN_CARD_SCOPE",
      };
      const anchorIsSource = fromLine.id === sourceLine?.id;
      recordEvidence(fromLine.id, { ...common, oppositeLineId: linkedTarget?.id ?? null,
        originalSourceLineReference: anchorIsSource ? closing.sourceLineId : closing.otherSourceLineId,
        oppositeSourceLineReference: anchorIsSource ? closing.otherSourceLineId : closing.sourceLineId,
        sourceProof: anchorIsSource ? closing.sourceProof : closing.counterpartProof,
        counterpartProof: anchorIsSource ? closing.counterpartProof : closing.sourceProof,
      });
      if (linkedTarget) recordEvidence(linkedTarget.id, {
        ...common, oppositeLineId: fromLine.id,
        originalSourceLineReference: closing.otherSourceLineId,
        oppositeSourceLineReference: closing.sourceLineId,
        sourceProof: closing.counterpartProof, counterpartProof: closing.sourceProof,
      });
    };

    for (const [key, group] of proofGroups) {
      if (alreadyHandledPairs.has(key) || sourceEvidencePairs.has(key)) continue;
      const remaining = new Set(group);
      const ordered = [...group].sort((left, right) => left.closingId.localeCompare(right.closingId, undefined, { numeric: true }));
      for (const closing of ordered) {
        if (!remaining.has(closing)) continue;
        remaining.delete(closing);
        const reciprocal = [...remaining].find((candidate) =>
          candidate.sourceLineId === closing.otherSourceLineId &&
          candidate.otherSourceLineId === closing.sourceLineId &&
          new Decimal(candidate.amount).eq(closing.amount));
        if (!reciprocal) {
          emitOriginalProof([closing.closingId], closing, closing.recordedDate);
          continue;
        }
        remaining.delete(reciprocal);
        const canonicalId = [closing.closingId, reciprocal.closingId]
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]!;
        const latestDate = closing.recordedDate > reciprocal.recordedDate
          ? closing.recordedDate : reciprocal.recordedDate;
        emitOriginalProof([canonicalId, ...[closing.closingId, reciprocal.closingId].filter((id) => id !== canonicalId)],
          closing.closingId === canonicalId ? closing : reciprocal, latestDate);
      }
    }
  }
  const baselineByAccount = new Map<string, string>([...new Set(lines.map(line => line.accountId))].map(accountId => [accountId, "0.00"]));
  for (const line of lines.filter(item => isPartnerLedgerOpening(item.reference))) {
    baselineByAccount.set(line.accountId, new Decimal(baselineByAccount.get(line.accountId) ?? 0)
      .plus(line.side === "debit" ? line.amount : new Decimal(line.amount).negated()).toFixed(2));
  }
  const movements: LedgerMovement[] = lines.filter(line => !isPartnerLedgerOpening(line.reference)).map((line, index) => ({
    id: line.id, date: line.cardDate, debit: line.side === "debit" ? line.amount : "0",
    credit: line.side === "credit" ? line.amount : "0", sourceOrder: index, balanceGroup: line.accountId,
  }));
  const calculated = calculatePartnerLedger(movements, settlementRows, asOfDate, baselineByAccount);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const cardLines = calculated.filter((line) => (!dateFrom || line.date >= dateFrom)
    && !isPartnerLedgerOpening(byId.get(line.id)!.reference)).map((line) => {
    const raw = byId.get(line.id)!;
    const matching = manualRows.filter((e) => e.sourceLineId === line.id || e.targetLineId === line.id);
    return {
      lineId: raw.id, partnerId: raw.partnerId, partnerCode: importedPartnerCode(raw.reference, raw.description), partnerName: raw.partnerName, partnerCity: raw.partnerCity,
      accountId: raw.accountId, accountCode: raw.accountCode, accountName: raw.accountName,
      entryId: raw.entryId, entryStatus: raw.entryStatus, documentType: raw.documentType,
      documentNumber: raw.documentNumber, reference: raw.reference, description: raw.description,
      documentDate: raw.documentDate, postingDate: raw.postingDate, taxDate: raw.taxDate, dueDate: raw.dueDate,
      durDate: nativeEvidenceByLine.get(raw.id)?.durDate ?? null,
      originalDocumentNumber: nativeEvidenceByLine.get(raw.id)?.originalDocumentNumber ?? null,
      debit: new Decimal(line.debit).toFixed(2), credit: new Decimal(line.credit).toFixed(2),
      runningBalance: line.runningBalance,
      openDebit: line.openDebit, openCredit: line.openCredit,
      closings: [...matching.map((e) => ({ id: e.id, oppositeLineId: e.sourceLineId === raw.id ? e.targetLineId : e.sourceLineId,
        type: e.eventType, amount: e.amount, effectiveDate: e.effectiveDate, source: "manual",
        closeEventId: e.closeEventId, externalClosingId: e.externalClosingId,
        reason: e.reason, actorId: e.actorId, createdAt: e.createdAt })), ...(evidenceClosings.get(line.id) ?? [])]
        .map((closing) => {
          const opposite = byId.get(String(closing.oppositeLineId ?? ""));
          return { ...closing, oppositeEntryId: opposite?.entryId ?? null,
            oppositeDocumentNumber: opposite?.documentNumber ?? null, oppositeDocumentType: opposite?.documentType ?? null,
            oppositeJournalReference: opposite?.reference ?? null,
            oppositeDocumentDate: opposite?.documentDate ?? opposite?.postingDate ?? null };
        }),
    };
  }).filter((line) => params.openOnly !== "true" || Number(line.openDebit) > 0 || Number(line.openCredit) > 0);
  const openingByAccount = new Map(baselineByAccount);
  if (dateFrom) {
    for (const line of calculated.filter((item) => item.date < dateFrom)) openingByAccount.set(line.balanceGroup!, line.runningBalance);
  }
  const openingBalances = [...openingByAccount.entries()].map(([accountId, balance]) => {
    const account = lines.find((line) => line.accountId === accountId)!;
    return { accountId, accountCode: account.accountCode, accountName: account.accountName, balance: new Decimal(balance).toFixed(2) };
  });
  const [company] = await executor.select({ companyName: companiesTable.naziv }).from(companiesTable)
    .where(eq(companiesTable.id, companyId)).limit(1);
  return { companyName: company?.companyName ?? companyId, asOfDate, dateFrom: dateFrom ?? null, mode: params.mode ?? "posted",
    closingBalance: calculated.reduce((balance, movement) => balance.plus(movement.debit).minus(movement.credit),
      [...baselineByAccount.values()].reduce((sum, amount) => sum.plus(amount), new Decimal(0))).toFixed(2),
    openingBalance: params.accountId ? openingByAccount.get(params.accountId) ?? "0.00" : null,
    openingBalances, lines: cardLines };
}