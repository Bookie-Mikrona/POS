import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  accountingRolesTable, accountingPeriodsTable, accountsTable, bankStatementLinesTable, bankStatementsTable,
  bookieOldArSettlementsTable, bookieOldApSettlementsTable, bookieOldBankApClosingsTable,
  bookieOldNativeLedgerEvidenceTable,
  companiesTable, counterpartiesTable, db, invoicesTable, journalEntriesTable,
  journalEntryLinesTable, partnerSettlementEventsTable, paymentAllocationsTable, paymentsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { activeSettlementAmounts, calculatePartnerLedger, parseLegacyRecordedDate, type LedgerMovement, type SettlementMovement } from "../lib/partner-ledger-calculator";
import { effectivePartnerLedgerRows, importedPartnerCode, isPartnerLedgerOpening } from "../lib/partner-ledger-provenance";
import { nativeReservations } from "../lib/native-payment-allocations";
import { lockPartnerOpenItemLines } from "../lib/partner-open-item-lock";
import { loadCard } from "../lib/partner-ledger-loader";

export { loadCard };

const router: IRouter = Router();
const isoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const param = (v: string | string[]) => Array.isArray(v) ? v[0]! : v;
type Role = "owner" | "accountant" | "viewer";

async function requireOpenSettlementDate(tx: Pick<typeof db, "select">, companyId: string, date: string) {
  const periods = await tx.select({ status: accountingPeriodsTable.status }).from(accountingPeriodsTable)
    .where(and(eq(accountingPeriodsTable.companyId, companyId),
      lte(accountingPeriodsTable.startDate, date), gte(accountingPeriodsTable.endDate, date))).for("share");
  if (!periods.length || periods.some(period => period.status !== "open")) {
    throw new Error("Datum učinka zapiranja mora biti v odprtem računovodskem obdobju.");
  }
}

async function access(userId: string, companyId: string, res: Response): Promise<Role | null> {
  const [row] = await db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, userId), eq(accountingRolesTable.companyId, companyId))).limit(1);
  if (!row) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return null; }
  return row.role;
}

type RawLine = {
  id: string; partnerId: string; partnerName: string; partnerCity: string | null;
  accountId: string; accountCode: string; accountName: string; side: "debit" | "credit";
  amount: string; entryId: string; cardDate: string; documentDate: string | null; postingDate: string; dueDate: string | null;
  taxDate: string | null; description: string; reference: string | null; entryStatus: string;
  sourceType: string; sequence: number; documentNumber: string | null; documentType: string;
};

async function legacyLoadCard(
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

  // Legacy imported evidence is filtered by the individual closing's recordedDate,
  // never by sourceAsOf (which records the snapshot date).
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
      })
        .from(bookieOldArSettlementsTable).where(and(eq(bookieOldArSettlementsTable.companyId, companyId), inArray(bookieOldArSettlementsTable.invoiceId, invoiceIds)));
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
  // Resolve imported supplier evidence by its original GLAVNA identity, not
  // the invoice's default AP account or the first line of a cash-paid voucher.
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
  // Seed the balance before ordering documents: a document may predate the
  // posting of the carryforward, but the carryforward is never a new document.
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

function partnerCardFilters(query: Request["query"]): Record<string, string | undefined> {
  if (typeof query.partnerId !== "string" || !uuidPattern.test(query.partnerId)
    || typeof query.accountId !== "string" || !uuidPattern.test(query.accountId)) {
    throw new Error("Pred prikazom kartice morate izbrati poslovnega partnerja in konto.");
  }
  return query as Record<string, string | undefined>;
}

function pdfBuffer(title: string, headings: string[], data: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
    const bundledFonts = path.join(import.meta.dirname, "assets", "fonts");
    const sourceFonts = path.join(import.meta.dirname, "..", "assets", "fonts");
    const fontDir = existsSync(path.join(bundledFonts, "DejaVuSans.ttf")) ? bundledFonts : sourceFonts;
    doc.registerFont("DejaVu", path.join(fontDir, "DejaVuSans.ttf"));
    doc.registerFont("DejaVu-Bold", path.join(fontDir, "DejaVuSans-Bold.ttf"));
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const margin = 32;
    const usableWidth = 842 - margin * 2;
    const widths = headings.map((heading) => {
      if (/Opis|Partner|Konto/.test(heading)) return heading === "Opis" ? 2.3 : 1.5;
      if (/Debet|Kredit|Saldo|Odprti/.test(heading)) return 0.9;
      return 1.1;
    });
    const totalWeight = widths.reduce((sum, width) => sum + width, 0);
    const columnWidths = widths.map((width) => usableWidth * width / totalWeight);
    const drawHeader = () => {
      doc.font("DejaVu-Bold").fontSize(12).fillColor("#172033").text(title, margin, margin, { width: usableWidth });
      const headerY = Math.max(margin + 25, doc.y + 8);
      let x = margin;
      let maxHeight = 0;
      doc.font("DejaVu-Bold").fontSize(7);
      headings.forEach((heading, index) => {
        const h = doc.heightOfString(heading, { width: columnWidths[index]! - 4 });
        maxHeight = Math.max(maxHeight, h);
        doc.font("DejaVu-Bold").fontSize(7).fillColor("#172033")
          .text(heading, x + 2, headerY, { width: columnWidths[index]! - 4 });
        x += columnWidths[index]!;
      });
      doc.moveTo(margin, headerY + 2 + maxHeight).lineTo(margin + usableWidth, headerY + 2 + maxHeight)
        .strokeColor("#94a3b8").stroke();
      return headerY + 6 + maxHeight;
    };
    let y = drawHeader();
    doc.on("pageAdded", () => { y = drawHeader(); });
    for (const row of data) {
      const cells = headings.map((_, index) => String(row[index] ?? ""));
      let height = 0;
      doc.font("DejaVu").fontSize(7);
      cells.forEach((cell, index) => {
        height = Math.max(height, doc.heightOfString(cell, { width: columnWidths[index]! - 5 }));
      });
      height = Math.max(10, height) + 4;
      if (y + height > doc.page.height - margin) doc.addPage();
      let x = margin;
      cells.forEach((cell, index) => {
        doc.font("DejaVu").fontSize(7).fillColor("#111827")
          .text(cell, x + 2, y + 2, { width: columnWidths[index]! - 5, height });
        x += columnWidths[index]!;
      });
      y += height;
    }
    doc.end();
  });
}

router.get("/companies/:companyId/partner-ledger", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId);
  if (!(await access((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  try {
    const filters = partnerCardFilters(req.query);
    res.json(await loadCard(companyId, filters));
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Neveljaven filter" }); }
});

router.get("/companies/:companyId/partner-ledger/pdf", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId);
  if (!(await access((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  try {
    const card = await loadCard(companyId, partnerCardFilters(req.query));
    const { renderPartnerCardPdf } = await import("../lib/partner-ledger-pdf");
    const pdf = await renderPartnerCardPdf(card, req.query.openOnly === "true");
    res.type("application/pdf").attachment("kartica-partnerja.pdf").send(pdf);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Neveljaven filter" }); }
});

router.get("/companies/:companyId/partner-turnover", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId);
  if (!(await access((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  const query = req.query as Record<string, string | undefined>;
  if (!query.dateFrom || !query.dateTo || !isoDate(query.dateFrom) || !isoDate(query.dateTo) || query.dateFrom > query.dateTo) {
    res.status(400).json({ error: "dateFrom in dateTo sta obvezna datuma YYYY-MM-DD." }); return;
  }
  try {
    const card = await loadCard(companyId, { ...query, dateFrom: undefined, dateTo: query.dateTo, openOnly: undefined });
    const grouped = new Map<string, { partnerId: string; partnerCode: string | null; partnerName: string; partnerCity: string | null; accountId: string; accountCode: string; accountName: string; debit: Decimal; credit: Decimal; openDebit: Decimal; openCredit: Decimal }>();
    for (const line of card.lines) {
      const key = `${line.accountId}/${line.partnerId}`;
      const row = grouped.get(key) ?? { partnerId: line.partnerId, partnerCode: line.partnerCode, partnerName: line.partnerName, partnerCity: line.partnerCity,
        accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName,
        debit: new Decimal(0), credit: new Decimal(0), openDebit: new Decimal(0), openCredit: new Decimal(0) };
      if ((line.documentDate ?? line.postingDate) >= query.dateFrom && (line.documentDate ?? line.postingDate) <= query.dateTo) {
        row.debit = row.debit.plus(line.debit); row.credit = row.credit.plus(line.credit);
      }
      if (line.partnerCode) row.partnerCode = [...new Set([...(row.partnerCode?.split(" / ") ?? []), line.partnerCode])].sort().join(" / ");
      row.openDebit = row.openDebit.plus(line.openDebit); row.openCredit = row.openCredit.plus(line.openCredit);
      grouped.set(key, row);
    }
    const rows = [...grouped.values()].filter((r) => query.openOnly !== "true" || r.openDebit.gt(0) || r.openCredit.gt(0)).map((r) => ({ ...r, periodBalance: r.debit.minus(r.credit).toFixed(2),
      debit: r.debit.toFixed(2), credit: r.credit.toFixed(2), openDebit: r.openDebit.toFixed(2), openCredit: r.openCredit.toFixed(2) }));
    const byAccount = new Map<string, typeof rows>();
    for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
    const accountTotals = [...byAccount.entries()].map(([accountId, accountRows]) => ({
      accountId, accountCode: accountRows[0]!.accountCode, accountName: accountRows[0]!.accountName,
      debit: accountRows.reduce((a, r) => a.plus(r.debit), new Decimal(0)).toFixed(2),
      credit: accountRows.reduce((a, r) => a.plus(r.credit), new Decimal(0)).toFixed(2),
      periodBalance: accountRows.reduce((a, r) => a.plus(r.periodBalance), new Decimal(0)).toFixed(2),
      openDebit: accountRows.reduce((a, r) => a.plus(r.openDebit), new Decimal(0)).toFixed(2),
      openCredit: accountRows.reduce((a, r) => a.plus(r.openCredit), new Decimal(0)).toFixed(2),
    }));
    res.json({ dateFrom: query.dateFrom, dateTo: query.dateTo, rows, accountTotals, totals: {
      debit: rows.reduce((a, r) => a.plus(r.debit), new Decimal(0)).toFixed(2),
      credit: rows.reduce((a, r) => a.plus(r.credit), new Decimal(0)).toFixed(2),
      periodBalance: rows.reduce((a, r) => a.plus(r.periodBalance), new Decimal(0)).toFixed(2),
      openDebit: rows.reduce((a, r) => a.plus(r.openDebit), new Decimal(0)).toFixed(2),
      openCredit: rows.reduce((a, r) => a.plus(r.openCredit), new Decimal(0)).toFixed(2),
    }, remainderSemantics: "Debit and credit open amounts are shown separately; no netting or inferred legacy remainder." });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Neveljaven filter" }); }
});

router.get("/companies/:companyId/partner-turnover/pdf", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId);
  if (!(await access((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  const query = req.query as Record<string, string | undefined>;
  if (!query.dateFrom || !query.dateTo || !isoDate(query.dateFrom) || !isoDate(query.dateTo) || query.dateFrom > query.dateTo) {
    res.status(400).json({ error: "dateFrom in dateTo sta obvezna datuma YYYY-MM-DD." }); return;
  }
  try {
    const card = await loadCard(companyId, { ...query, dateFrom: undefined, dateTo: query.dateTo, openOnly: undefined });
    const grouped = new Map<string, { partner: string; account: string; codes: Set<string>; debit: Decimal; credit: Decimal; od: Decimal; oc: Decimal }>();
    for (const line of card.lines) {
      const key = `${line.accountId}/${line.partnerId}`;
      const r = grouped.get(key) ?? { partner: `${line.partnerName}${line.partnerCity ? `\n${line.partnerCity}` : ""}`, account: `${line.accountCode} ${line.accountName}`, codes: new Set<string>(),
        debit: new Decimal(0), credit: new Decimal(0), od: new Decimal(0), oc: new Decimal(0) };
      if ((line.documentDate ?? line.postingDate) >= query.dateFrom && (line.documentDate ?? line.postingDate) <= query.dateTo) {
        r.debit = r.debit.plus(line.debit); r.credit = r.credit.plus(line.credit);
      }
      if (line.partnerCode) r.codes.add(line.partnerCode);
      r.od = r.od.plus(line.openDebit); r.oc = r.oc.plus(line.openCredit); grouped.set(key, r);
    }
    const pdfRows: string[][] = [];
    const allGroups = [...grouped.entries()].filter(([, row]) => query.openOnly !== "true" || row.od.gt(0) || row.oc.gt(0));
    const accountIds = [...new Set(allGroups.map(([key]) => key.split("/")[0]!))];
    for (const accountId of accountIds) {
      const accountGroups = allGroups.filter(([key]) => key.startsWith(`${accountId}/`)).map(([, value]) => value);
      for (const r of accountGroups) pdfRows.push([`${[...r.codes].sort().join(" / ")} ${r.partner}`, r.account, r.debit.toFixed(2), r.credit.toFixed(2),
        r.debit.minus(r.credit).toFixed(2), r.od.toFixed(2), r.oc.toFixed(2)]);
      const subtotal = accountGroups.reduce((a, r) => ({
        debit: a.debit.plus(r.debit), credit: a.credit.plus(r.credit), od: a.od.plus(r.od), oc: a.oc.plus(r.oc),
      }), { debit: new Decimal(0), credit: new Decimal(0), od: new Decimal(0), oc: new Decimal(0) });
      pdfRows.push([`SKUPAJ KONTO ${accountGroups[0]?.account ?? accountId}`, "", subtotal.debit.toFixed(2), subtotal.credit.toFixed(2),
        subtotal.debit.minus(subtotal.credit).toFixed(2), subtotal.od.toFixed(2), subtotal.oc.toFixed(2)]);
    }
    const totals = [...grouped.values()].reduce((a, r) => ({
      debit: a.debit.plus(r.debit), credit: a.credit.plus(r.credit), od: a.od.plus(r.od), oc: a.oc.plus(r.oc),
    }), { debit: new Decimal(0), credit: new Decimal(0), od: new Decimal(0), oc: new Decimal(0) });
    pdfRows.push(["SKUPAJ", "", totals.debit.toFixed(2), totals.credit.toFixed(2), totals.debit.minus(totals.credit).toFixed(2), totals.od.toFixed(2), totals.oc.toFixed(2)]);
    const pdf = await pdfBuffer(`${card.companyName} - Promet partnerjev ${query.dateFrom} - ${query.dateTo}`,
      ["Partner", "Konto", "Debet obdobja", "Kredit obdobja", "Saldo obdobja", "Odprti debet", "Odprti kredit"],
      pdfRows);
    res.type("application/pdf").attachment("promet-partnerjev.pdf").send(pdf);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Neveljaven filter" }); }
});

router.post("/companies/:companyId/partner-settlements", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId);
  const auth = req as AuthenticatedRequest;
  const role = await access(auth.clerkUserId, companyId, res);
  if (!role) return;
  if (role === "viewer") { res.status(403).json({ error: "Bralna vloga ne more zapirati postavk." }); return; }
  const { allocations, effectiveDate, idempotencyKey, reason } = req.body ?? {};
  if (!Array.isArray(allocations) || !allocations.length || !isoDate(effectiveDate ?? "") ||
      typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 160) {
    res.status(400).json({ error: "Zahtevani so allocations, effectiveDate YYYY-MM-DD in idempotencyKey." }); return;
  }
  try {
    const evidenceCard = await loadCard(companyId, { dateTo: "9999-12-31" });
    const externalClosings = new Map<string, SettlementMovement>();
    for (const line of evidenceCard.lines) for (const closing of line.closings as any[]) {
      if (closing.type !== "close" || closing.source === "manual" || externalClosings.has(closing.id)) continue;
      externalClosings.set(closing.id, {
        id: closing.id, sourceLineId: line.lineId, targetLineId: closing.oppositeLineId ?? null,
        amount: closing.amount, effectiveDate: closing.effectiveDate, eventType: "close",
      });
    }
    const created = await db.transaction(async (tx) => {
      await requireOpenSettlementDate(tx, companyId, effectiveDate);
      const replayKeys = allocations.map((_: any, index: number) => `${idempotencyKey}:${index}`);
      const replay = await tx.select().from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        inArray(partnerSettlementEventsTable.idempotencyKey, replayKeys),
      ));
      if (replay.length) {
        if (replay.length !== allocations.length) throw new Error("Idempotency key je že uporabljen za drugačen zahtevek.");
        for (const [index, allocation] of allocations.entries()) {
          const event = replay.find((row) => row.idempotencyKey === replayKeys[index]);
          if (!event || event.eventType !== "close" || event.sourceLineId !== allocation.sourceLineId
              || event.targetLineId !== allocation.targetLineId || event.effectiveDate !== effectiveDate
              || !new Decimal(event.amount).eq(allocation.amount) || (event.reason ?? null) !== (reason ?? null)) {
            throw new Error("Idempotency key je že uporabljen za drugačen zahtevek.");
          }
        }
        return replay.sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
      }
      const ids = [...new Set(allocations.flatMap((a: any) => [a.sourceLineId, a.targetLineId]))].sort();
      if (ids.some((id: string) => !uuidPattern.test(id))) throw new Error("Postavka ni veljaven UUID.");
      const records = await lockPartnerOpenItemLines(tx, companyId, ids);
      if (records.length !== ids.length || records.some((r) => !["posted", "reversed"].includes(r.status))) throw new Error("Postavke morajo obstajati v podjetju in biti knjižene.");
      const byId = new Map(records.map((r) => [r.id, r]));
      for (const a of allocations) {
        const amount = new Decimal(a.amount);
        const source = byId.get(a.sourceLineId); const target = byId.get(a.targetLineId);
        if (!source || !target || !source.partner_id || !target.partner_id || source.id === target.id || source.partner_id !== target.partner_id ||
            source.account_id !== target.account_id || source.side === target.side || !amount.isFinite() || amount.lte(0)) {
          throw new Error("Zapiranje mora povezati različno usmerjeni knjižbi istega partnerja in konta s pozitivnim zneskom.");
        }
      }
      const sums = await tx.select().from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        or(inArray(partnerSettlementEventsTable.sourceLineId, ids), inArray(partnerSettlementEventsTable.targetLineId, ids)),
      ));
      const nativeReservationByLine = await nativeReservations(tx as unknown as typeof db, companyId, ids);
      const candidates: SettlementMovement[] = allocations.map((allocation, index) => ({
        id: `candidate:${idempotencyKey}:${index}`, sourceLineId: allocation.sourceLineId,
        targetLineId: allocation.targetLineId, amount: allocation.amount, effectiveDate, eventType: "close",
      }));
      const movements: SettlementMovement[] = [...externalClosings.values(), ...sums.map((event) => ({
        id: event.id, sourceLineId: event.sourceLineId, targetLineId: event.targetLineId,
        amount: event.amount, effectiveDate: event.effectiveDate, eventType: event.eventType,
        closeEventId: event.closeEventId, externalClosingId: event.externalClosingId,
      })), ...candidates];
      const affectedLineIds = new Set(candidates.flatMap((event) => [event.sourceLineId, event.targetLineId!]));
      const timeline = [...new Set([effectiveDate,
        ...[...sums.map((event) => event.effectiveDate), ...[...externalClosings.values()].map((event) => event.effectiveDate)]
          .filter((date) => date >= effectiveDate)])].sort();
      for (const lineId of affectedLineIds) {
        const line = byId.get(lineId)!;
        const absoluteCapacity = new Decimal(line.amount).abs();
        for (const date of timeline) {
          const active = activeSettlementAmounts(movements, date);
          const used = [...active.entries()].reduce((sum, [closingId, remaining]) => {
            const close = movements.find((event) => event.eventType === "close" && event.id === closingId);
            return close && (close.sourceLineId === lineId || close.targetLineId === lineId) ? sum.plus(remaining) : sum;
          }, new Decimal(0));
          if (used.gt(absoluteCapacity)) throw new Error(`Znesek presega ostanek postavke ${line.id} na datum ${date}.`);
           const reserved = nativeReservationByLine.get(lineId) ?? new Decimal(0);
           if (reserved.gt(absoluteCapacity.minus(used).plus("0.005"))) {
             throw new Error(`Ročno zapiranje bi porabilo znesek, rezerviran v osnutku plačila za postavko ${line.id}.`);
           }
        }
      }
      const result = [];
      for (const [index, a] of allocations.entries()) {
        const source = byId.get(a.sourceLineId)!;
        if (!source.partner_id) throw new Error("Knjižbena postavka mora imeti partnerja.");
        const [event] = await tx.insert(partnerSettlementEventsTable).values({
          companyId, partnerId: source.partner_id, accountId: source.account_id,
          sourceLineId: a.sourceLineId, targetLineId: a.targetLineId, eventType: "close",
          amount: new Decimal(a.amount).toFixed(2), effectiveDate, idempotencyKey: `${idempotencyKey}:${index}`,
          reason: reason ?? null, actorId: auth.clerkUserId,
        }).returning();
        result.push(event);
      }
      return result;
    });
    res.status(201).json({ events: created });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Zapiranje ni uspelo." });
  }
});

router.post("/companies/:companyId/partner-settlements/:id/reopen", requireAuth, async (req: Request, res: Response) => {
  const companyId = param(req.params.companyId); const auth = req as AuthenticatedRequest;
  const role = await access(auth.clerkUserId, companyId, res);
  if (!role) return;
  if (role === "viewer") { res.status(403).json({ error: "Bralna vloga ne more ponovno odpreti postavk." }); return; }
  const closeId = param(req.params.id);
  const { amount, effectiveDate, idempotencyKey, reason } = req.body ?? {};
  if (!closeId || !isoDate(effectiveDate ?? "") || typeof idempotencyKey !== "string" || !idempotencyKey.trim() ||
      typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "Zahtevani so veljaven id, amount, effectiveDate in idempotencyKey." }); return;
  }
  if (!uuidPattern.test(closeId)) {
    try {
      const card = await loadCard(companyId, { dateTo: "9999-12-31" });
      const found = card.lines.flatMap((line) => line.closings.map((closing: any) => ({
        lineId: line.lineId, partnerId: line.partnerId, accountId: line.accountId, closing,
      })))
        .find(({ closing }: any) => closing.id === closeId && closing.type === "close" && closing.source !== "manual");
      if (!found) { res.status(404).json({ error: "Izvorno zapiranje ni najdeno." }); return; }
      const closing = found.closing;
      const amount = new Decimal(closing.amount);
      if (effectiveDate < closing.effectiveDate) {
        res.status(409).json({ error: "Zapiranja ni mogoče odpreti pred njegovim datumom učinka." }); return;
      }
      const targetId = closing.oppositeLineId ?? null;
      const [event] = await db.transaction(async (tx) => {
        await requireOpenSettlementDate(tx, companyId, effectiveDate);
        const [replay] = await tx.select().from(partnerSettlementEventsTable).where(and(
          eq(partnerSettlementEventsTable.companyId, companyId),
          eq(partnerSettlementEventsTable.idempotencyKey, idempotencyKey),
        )).limit(1);
        if (replay) {
          if (replay.eventType !== "reopen" || replay.externalClosingId !== closeId
              || replay.effectiveDate !== effectiveDate || !new Decimal(replay.amount).eq(req.body.amount)
              || replay.reason !== reason) throw new Error("Idempotency key je že uporabljen za drugačen zahtevek.");
          return [replay];
        }
        const lockIds = targetId ? [found.lineId, targetId] : [found.lineId];
        const locked = await lockPartnerOpenItemLines(tx, companyId, lockIds);
        if (locked.length !== lockIds.length || locked.some((line) => !["posted", "reversed"].includes(line.status))) {
          throw new Error("Postavke zapiranja niso na voljo.");
        }
        const previous = await tx.select().from(partnerSettlementEventsTable).where(and(
          eq(partnerSettlementEventsTable.companyId, companyId),
          eq(partnerSettlementEventsTable.externalClosingId, closeId),
          eq(partnerSettlementEventsTable.eventType, "reopen"),
        ));
        const priorAtDate = previous.filter((row) => row.effectiveDate <= effectiveDate)
          .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
        const reopenAmount = new Decimal(req.body.amount);
        if (!reopenAmount.isFinite() || reopenAmount.lte(0) || reopenAmount.gt(amount.minus(priorAtDate))) {
          throw new Error("Znesek ponovnega odprtja presega še aktivno zapiranje.");
        }
        const futureDates = [...new Set(previous.map((row) => row.effectiveDate).filter((date) => date >= effectiveDate))].sort();
        for (const futureDate of futureDates) {
          const already = previous.filter((row) => row.effectiveDate <= futureDate)
            .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
          if (already.plus(reopenAmount).gt(amount)) throw new Error("Ponovno odprtje bi preseglo izvorni znesek ob poznejšem učinku.");
        }
        return tx.insert(partnerSettlementEventsTable).values({
          companyId, partnerId: found.partnerId, accountId: found.accountId,
          sourceLineId: found.lineId, targetLineId: targetId, eventType: "reopen", amount: reopenAmount.toFixed(2),
          effectiveDate, closeEventId: null, externalClosingId: closeId, idempotencyKey, reason, actorId: auth.clerkUserId,
        }).returning();
      });
      res.status(201).json({ event });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Ponovno odprtje ni uspelo." });
    }
    return;
  }
  try {
    const [event] = await db.transaction(async (tx) => {
      await requireOpenSettlementDate(tx, companyId, effectiveDate);
      const [replay] = await tx.select().from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        eq(partnerSettlementEventsTable.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (replay) {
        if (replay.eventType !== "reopen" || replay.closeEventId !== closeId
            || replay.effectiveDate !== effectiveDate || !new Decimal(replay.amount).eq(amount)
            || replay.reason !== reason) throw new Error("Idempotency key je že uporabljen za drugačen zahtevek.");
        return [replay];
      }
      const [closing] = await tx.select().from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId), eq(partnerSettlementEventsTable.id, closeId),
        eq(partnerSettlementEventsTable.eventType, "close"),
      )).for("update").limit(1);
      if (!closing) throw new Error("Zapiranje ni najdeno.");
      if (effectiveDate < closing.effectiveDate) throw new Error("Zapiranja ni mogoče odpreti pred njegovim datumom učinka.");
      const locked = await lockPartnerOpenItemLines(tx, companyId,
        [closing.sourceLineId, closing.targetLineId].filter((id): id is string => id !== null));
      if (locked.length !== (closing.targetLineId ? 2 : 1)) throw new Error("Postavke zapiranja niso na voljo.");
      const reopenRows = await tx.select().from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId), eq(partnerSettlementEventsTable.closeEventId, closeId),
      ));
      const reopenAmount = new Decimal(amount);
      const closeAmount = new Decimal(closing.amount);
      const activeAtDate = reopenRows.filter((row) => row.effectiveDate <= effectiveDate)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      if (!reopenAmount.isFinite() || reopenAmount.lte(0) || reopenAmount.gt(closeAmount.minus(activeAtDate))) {
        throw new Error("Znesek ponovnega odprtja presega še aktivno zapiranje.");
      }
      for (const futureDate of [...new Set(reopenRows.map((row) => row.effectiveDate).filter((date) => date >= effectiveDate))]) {
        const already = reopenRows.filter((row) => row.effectiveDate <= futureDate)
          .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
        if (already.plus(reopenAmount).gt(closeAmount)) throw new Error("Ponovno odprtje bi preseglo izvorni znesek ob poznejšem učinku.");
      }
      return tx.insert(partnerSettlementEventsTable).values({
        companyId, partnerId: closing.partnerId, accountId: closing.accountId, sourceLineId: closing.sourceLineId,
        targetLineId: closing.targetLineId, eventType: "reopen", amount: reopenAmount.toFixed(2),
        effectiveDate, closeEventId: closeId, idempotencyKey, reason: reason ?? null, actorId: auth.clerkUserId,
      }).returning();
    });
    res.status(201).json({ event });
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Ponovno odprtje ni uspelo." }); }
});

export default router;