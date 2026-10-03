import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, desc, like, inArray, isNull, or, sql, notInArray } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  counterpartiesTable,
  accountingPeriodsTable,
  accountsTable,
  accountingRolesTable,
  auditLogTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posInvoiceLinksTable,
  prejemniceTable,
  prejemnicePostavkeTable,
  enoteTable,
  posBookingSettingsTable,
  posReceiptBookingSourcesTable,
  vatCodeTable,
  vatCodesTable,
  goodsReceiptsTable,
  documentsTable,
  racuniTable,
  postavkeTable,
  partnerCenikiTable,
  posContractInvoiceReceiptsTable,
} from "@workspace/db";
import {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  VoidInvoiceBody,
  LinkInvoicePosReceiptBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { pos109PostingReasons } from "../lib/posInvoice109";
import {
  lockPosReceiptForReconciliation,
  ReceiptEditConflict,
} from "../lib/posReceiptBooking";
import { createVatLedgerEntries, type EntryMeta, type VatLine } from "../lib/vatLedger";
import { documentVatBehavior } from "../lib/documentVatCodeMapping";
import {
  claimPurchaseSourceDocument,
  normalizePurchaseDocumentNumber,
} from "../lib/purchaseSourceDocuments";
import {
  buildContractSummaryPostingLines,
  resolveContractSummaryDueDate,
} from "../lib/posContractSummary";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

type PosMatchHistoryStatus = "confirmed" | "closed109" | "unlinked";

function asAuditPayload(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function auditInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function auditEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function timestampOf(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return null;
  }
  return { role: row.role };
}

/** Vrne aktiven knjižni DDV konto za podjetje — 450 za izdane, 160 za prejete račune. */
async function resolveVatAccount(
  companyId: string,
  invoiceType: "issued" | "received",
  vatAccountId: string | null | undefined,
  vatRate: number,
): Promise<string | null> {
  if (vatRate === 0) return null;
  if (vatAccountId) {
    const [explicitAccount] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(
        eq(accountsTable.id, vatAccountId),
        eq(accountsTable.companyId, companyId),
        eq(accountsTable.isActive, true),
        eq(accountsTable.allowsPosting, true),
      ))
      .limit(1);
    return explicitAccount?.id ?? null;
  }

  if (invoiceType === "received") {
    const [settings] = await db
      .select({
        vat22: posBookingSettingsTable.inputVat22AccountId,
        vat95: posBookingSettingsTable.inputVat95AccountId,
        vat5: posBookingSettingsTable.inputVat5AccountId,
      })
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);
    const configuredId = vatRate === 22
      ? settings?.vat22
      : vatRate === 9.5
        ? settings?.vat95
        : vatRate === 5
          ? settings?.vat5
          : null;
    if (configuredId) {
      const [configuredAccount] = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.id, configuredId),
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
        ))
        .limit(1);
      if (configuredAccount) return configuredAccount.id;
    }
  }

  // Poišči privzeti DDV konto po kodi
  const codePrefix = invoiceType === "issued" ? "450" : "160";
  const [vatAcc] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.companyId, companyId),
        like(accountsTable.code, `${codePrefix}%`),
        eq(accountsTable.isActive, true),
        eq(accountsTable.allowsPosting, true),
      ),
    )
    .orderBy(asc(accountsTable.code))
    .limit(1);

  return vatAcc?.id ?? null;
}

/** Izračunaj seštevke vrstic */
function calcLineTotals(lines: { quantity: string; unitPrice: string; vatRate: string }[]) {
  let totalNet = 0;
  let totalVat = 0;
  for (const l of lines) {
    const qty = parseFloat(l.quantity);
    const price = parseFloat(l.unitPrice);
    const vatR = parseFloat(l.vatRate);
    const lineTotal = qty * price;
    const vatAmt = lineTotal * vatR / 100;
    totalNet += lineTotal;
    totalVat += vatAmt;
  }
  return {
    totalNet: totalNet.toFixed(2),
    totalVat: totalVat.toFixed(2),
    totalGross: (totalNet + totalVat).toFixed(2),
  };
}

const AI_DOCUMENT_GROSS_EXPENSE_SOURCE = "ai-document-gross-expense";
const AI_DOCUMENT_AMOUNT_SOURCE_TYPES = new Set([
  "ai-document-fx",
  AI_DOCUMENT_GROSS_EXPENSE_SOURCE,
]);

function usesAiDocumentApprovedAmounts(sourceType: string): boolean {
  return AI_DOCUMENT_AMOUNT_SOURCE_TYPES.has(sourceType);
}

function isAiDocumentGrossExpense(sourceType: string): boolean {
  return sourceType === AI_DOCUMENT_GROSS_EXPENSE_SOURCE;
}

class InvalidDocumentInvoiceAmountsError extends Error {
  constructor() {
    super("Račun iz dokumenta vsebuje manjkajočo ali neveljavno shranjeno davčno osnovo/DDV.");
    this.name = "InvalidDocumentInvoiceAmountsError";
  }
}

function storedDocumentAmount(value: string | number | null | undefined): number {
  if (
    value == null
    || (typeof value === "string" && value.trim() === "")
    || !Number.isFinite(Number(value))
  ) {
    throw new InvalidDocumentInvoiceAmountsError();
  }
  return Number(value);
}

function invoiceLineAmounts(
  sourceType: string,
  line: {
    quantity: string;
    unitPrice: string;
    vatRate: string;
    vatBase: string | null;
    storedVatAmount: string | null;
    reverseCharge?: boolean | null;
  },
): { lineTotal: number; vatAmt: number } {
  if (usesAiDocumentApprovedAmounts(sourceType)) {
    return {
      lineTotal: storedDocumentAmount(line.vatBase),
      vatAmt: storedDocumentAmount(line.storedVatAmount),
    };
  }
  const qty = parseFloat(line.quantity);
  const price = parseFloat(line.unitPrice);
  const vatRate = parseFloat(line.vatRate);
  const lineTotal = sourceType === "bookie-old" && line.vatBase !== null
    ? parseFloat(line.vatBase)
    : qty * price;
  const vatAmt = sourceType === "bookie-old" && line.storedVatAmount !== null
    ? parseFloat(line.storedVatAmount)
    : line.reverseCharge ? 0 : lineTotal * vatRate / 100;
  return { lineTotal, vatAmt };
}

function calculateStoredLineAmounts(line: {
  quantity: number;
  unitPrice: number;
  vatRate: number;
}) {
  const base = new Decimal(line.quantity.toFixed(3))
    .mul(line.unitPrice.toFixed(4))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vat = base
    .mul(line.vatRate)
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { vatBase: base.toFixed(2), vatAmount: vat.toFixed(2) };
}

function sameInvoiceLineMoneyInputs(
  storedLine: { quantity: string; unitPrice: string; vatRate: string },
  requestedLine: { quantity: number; unitPrice: number; vatRate: number },
): boolean {
  return new Decimal(storedLine.quantity).eq(requestedLine.quantity.toFixed(3))
    && new Decimal(storedLine.unitPrice).eq(requestedLine.unitPrice.toFixed(4))
    && new Decimal(storedLine.vatRate).eq(requestedLine.vatRate.toFixed(2));
}

/** Pridobi polni zapis računa (header + vrstice) */
async function fetchInvoiceWithLines(invoiceId: string) {
  const [inv] = await db
    .select({
      id: invoicesTable.id,
      companyId: invoicesTable.companyId,
      type: invoicesTable.type,
      sourceType: invoicesTable.sourceType,
      counterpartyId: invoicesTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      periodId: invoicesTable.periodId,
      periodName: accountingPeriodsTable.name,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      dueDate: invoicesTable.dueDate,
      destinationIban: invoicesTable.destinationIban,
      destinationBic: invoicesTable.destinationBic,
      paymentModel: invoicesTable.paymentModel,
      paymentReference: invoicesTable.paymentReference,
      paymentPurpose: invoicesTable.paymentPurpose,
      status: invoicesTable.status,
      arApAccountId: invoicesTable.arApAccountId,
      vatAccountId: invoicesTable.vatAccountId,
      linkedEntryId: invoicesTable.linkedEntryId,
      sourceDocumentId: invoicesTable.sourceDocumentId,
      notes: invoicesTable.notes,
      historicalNet: invoicesTable.historicalNet,
      historicalVat: invoicesTable.historicalVat,
      historicalGross: invoicesTable.historicalGross,
      historicalReference: invoicesTable.historicalReference,
      createdBy: invoicesTable.createdBy,
      createdAt: invoicesTable.createdAt,
      updatedAt: invoicesTable.updatedAt,
    })
    .from(invoicesTable)
    .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
    .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, invoicesTable.periodId))
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);

  if (!inv) return null;

  const rawLines = await db
    .select({
      id: invoiceLinesTable.id,
      invoiceId: invoiceLinesTable.invoiceId,
      description: invoiceLinesTable.description,
      quantity: invoiceLinesTable.quantity,
      unitPrice: invoiceLinesTable.unitPrice,
      vatRate: invoiceLinesTable.vatRate,
      vatBase: invoiceLinesTable.vatBase,
      storedVatAmount: invoiceLinesTable.vatAmount,
      vatCodeId: invoiceLinesTable.vatCodeId,
      assetType: invoiceLinesTable.assetType,
      reverseCharge: vatCodeTable.isReverseCharge,
      accountId: invoiceLinesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      sequence: invoiceLinesTable.sequence,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .innerJoin(accountsTable, eq(accountsTable.id, invoiceLinesTable.accountId))
    .leftJoin(vatCodesTable, and(
      eq(vatCodesTable.id, invoiceLinesTable.vatCodeId),
      eq(vatCodesTable.companyId, invoicesTable.companyId),
    ))
    .leftJoin(vatCodeTable, eq(vatCodeTable.id, vatCodesTable.fursCodeId))
    .where(eq(invoiceLinesTable.invoiceId, invoiceId))
    .orderBy(asc(invoiceLinesTable.sequence));

  // Izračunaj seštevke
  let totalNet = 0;
  let totalVat = 0;
  const lines = rawLines.map((l) => {
    const { lineTotal, vatAmt } = invoiceLineAmounts(inv.sourceType, l);
    totalNet += lineTotal;
    totalVat += vatAmt;
    return {
      ...l,
      lineTotal: lineTotal.toFixed(2),
      vatAmount: vatAmt.toFixed(2),
      grossTotal: (lineTotal + vatAmt).toFixed(2),
    };
  });

  return {
    ...inv,
    totalNet: inv.historicalNet ?? totalNet.toFixed(2),
    totalVat: inv.historicalVat ?? totalVat.toFixed(2),
    totalGross: inv.historicalGross ?? (totalNet + totalVat).toFixed(2),
    lines,
  };
}

const contractBusinessDateSql = sql<string>`DATE(
  (${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')
  - (${enoteTable.zacetekDnevaUra}::time - TIME '00:00')
)::text`;

async function loadUnbilledContractReceipts(
  companyId: string,
  counterpartyId: string,
  month: string,
) {
  const start = `${month}-01`;
  return db
    .select({
      id: racuniTable.id,
      invoiceNumber: racuniTable.stevilkaRacuna,
      grossAmount: racuniTable.skupaj,
      businessDate: contractBusinessDateSql,
      unitId: racuniTable.enotaId,
      unitName: enoteTable.ime,
      paymentTermsDays: racuniTable.dniOdloga,
    })
    .from(racuniTable)
    .innerJoin(enoteTable, eq(enoteTable.id, racuniTable.enotaId))
    .leftJoin(
      posContractInvoiceReceiptsTable,
      eq(posContractInvoiceReceiptsTable.receiptId, racuniTable.id),
    )
    .where(and(
      eq(enoteTable.companyId, companyId),
      eq(racuniTable.kupecCpId, counterpartyId),
      eq(racuniTable.placilnaNacin, "negotovinsko"),
      notInArray(racuniTable.status, ["storniran"]),
      gte(contractBusinessDateSql, start),
      lte(contractBusinessDateSql, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)),
      isNull(posContractInvoiceReceiptsTable.id),
      sql`NOT EXISTS (SELECT 1 FROM pos_monthly_invoice_receipts m WHERE m.receipt_id = ${racuniTable.id})`,
      sql`EXISTS (
        SELECT 1 FROM ${partnerCenikiTable}
        WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
          AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
      )`,
    ))
    .orderBy(asc(contractBusinessDateSql), asc(racuniTable.id));
}

async function loadContractVatBuckets(receiptIds: number[]) {
  if (receiptIds.length === 0) return [];
  const rows = await db
    .select({
      vatRate: postavkeTable.davek,
      grossAmount: sql<string>`SUM(CAST(${postavkeTable.skupaj} AS numeric))`,
    })
    .from(postavkeTable)
    .where(and(
      inArray(postavkeTable.racunId, receiptIds),
      isNull(postavkeTable.parentPostavkaId),
    ))
    .groupBy(postavkeTable.davek)
    .orderBy(asc(postavkeTable.davek));
  return rows.map((row) => {
    const vatRate = new Decimal(row.vatRate ?? "0");
    const gross = new Decimal(row.grossAmount ?? "0").toDecimalPlaces(2);
    const net = vatRate.gt(0)
      ? gross.mul(100).div(vatRate.add(100)).toDecimalPlaces(2)
      : gross;
    return { vatRate, gross, net, vat: gross.minus(net) };
  });
}

function receiptBookingReferences(receiptDate: Date, enotaId: number) {
  const date = receiptDate.toISOString().slice(0, 10);
  return {
    aggregate: `POS:PREJEMNICA:${date}`,
    // Prehodna oblika brez šifre stroškovnega mesta.
    stable: `POS:PREJEMNICA:${date}:E${enotaId}`,
    // Sedanja oblika: POS:PREJEMNICA:YYYY-MM-DD:<šifra-SM>:E<enota>.
    withCostCenterPattern: `POS:PREJEMNICA:${date}:%:E${enotaId}`,
  };
}

export async function isReceiptBookedTo109(
  companyId: string,
  prejemnicaId: number,
  receiptDate: Date,
  enotaId: number,
  expected109AccountId?: string | null,
  expectedNetAmount?: string | null,
): Promise<boolean> {
  const refs = receiptBookingReferences(receiptDate, enotaId);
  const [entry] = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .innerJoin(
      posReceiptBookingSourcesTable,
      and(
        eq(posReceiptBookingSourcesTable.journalEntryId, journalEntriesTable.id),
        eq(posReceiptBookingSourcesTable.prejemnicaId, prejemnicaId),
        expectedNetAmount ? eq(posReceiptBookingSourcesTable.netAmount, expectedNetAmount) : undefined,
      ),
    )
    .innerJoin(
      journalEntryLinesTable,
      and(
        eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
        eq(journalEntryLinesTable.side, "credit"),
        expected109AccountId ? eq(journalEntryLinesTable.accountId, expected109AccountId) : undefined,
      ),
    )
    .innerJoin(
      accountsTable,
      and(
        eq(accountsTable.id, journalEntryLinesTable.accountId),
        eq(accountsTable.companyId, companyId),
        like(accountsTable.code, "109%"),
        eq(accountsTable.isActive, true),
        eq(accountsTable.allowsPosting, true),
      ),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        or(
          and(
            eq(journalEntriesTable.reference, `POS:NABAVA:${prejemnicaId}`),
            eq(journalEntriesTable.createdBy, "pos-receipt-booking"),
          ),
          and(
            eq(journalEntriesTable.createdBy, "pos-sync"),
            or(
              eq(journalEntriesTable.reference, refs.aggregate),
              eq(journalEntriesTable.reference, refs.stable),
              like(journalEntriesTable.reference, refs.withCostCenterPattern),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(entry);
}

type PostedReceiptVatBucket = {
  vatCodeId: string | null;
  rate: string;
  net: string;
  vat: string;
};

type PostedReceiptBookingFacts = {
  sourceEntryId: string;
  booked109Gross: string;
  bookedNet: string;
  bookedVat: string;
  buckets: PostedReceiptVatBucket[];
};

function money(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

async function loadPostedReceiptBookingFacts(
  executor: any,
  companyId: string,
  receiptId: number,
  configured109AccountId: string,
): Promise<PostedReceiptBookingFacts | null> {
  const sources = await executor
    .select({
      sourceEntryId: journalEntriesTable.id,
      bookedNet: posReceiptBookingSourcesTable.netAmount,
      reference: journalEntriesTable.reference,
      createdBy: journalEntriesTable.createdBy,
      sourceCount: sql<number>`(
        SELECT count(*)::int FROM pos_receipt_booking_sources ownership
        WHERE ownership.journal_entry_id = ${journalEntriesTable.id}
      )`,
    })
    .from(posReceiptBookingSourcesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, posReceiptBookingSourcesTable.journalEntryId))
    .where(and(
      eq(posReceiptBookingSourcesTable.prejemnicaId, receiptId),
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.status, "posted"),
    ));
  const owned = sources.filter((row: any) =>
    row.reference === `POS:NABAVA:${receiptId}`
    && row.createdBy === "pos-receipt-booking"
    && Number(row.sourceCount) === 1);
  if (owned.length !== 1) return null;
  const source = owned[0];
  const lines = await executor
    .select({
      accountId: journalEntryLinesTable.accountId,
      accountCode: accountsTable.code,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      vatCodeId: journalEntryLinesTable.vatCodeId,
      vatAmount: journalEntryLinesTable.vatAmount,
      vatRate: vatCodeTable.rate,
    })
    .from(journalEntryLinesTable)
    .innerJoin(accountsTable, and(
      eq(accountsTable.id, journalEntryLinesTable.accountId),
      eq(accountsTable.companyId, companyId),
      eq(accountsTable.isActive, true),
      eq(accountsTable.allowsPosting, true),
    ))
    .leftJoin(vatCodeTable, eq(vatCodeTable.id, journalEntryLinesTable.vatCodeId))
    .where(eq(journalEntryLinesTable.entryId, source.sourceEntryId));
  const credits109 = lines.filter((line: any) =>
    line.accountId === configured109AccountId && line.side === "credit");
  if (credits109.length !== 1 || !credits109[0].accountCode.startsWith("109")) return null;
  const bookedGross = new Decimal(credits109[0].amount).toDecimalPlaces(2);
  const bookedNet = new Decimal(source.bookedNet).toDecimalPlaces(2);
  const bookedVat = bookedGross.minus(bookedNet).toDecimalPlaces(2);
  if (bookedGross.lte(0) || bookedNet.lte(0) || bookedVat.lt(0)) return null;
  const vatDebit = lines
    .filter((line: any) => line.side === "debit" && line.accountCode.startsWith("160"))
    .reduce((sum: Decimal, line: any) => sum.plus(line.amount), new Decimal(0))
    .toDecimalPlaces(2);
  if (!vatDebit.eq(bookedVat)) return null;

  const bucketMap = new Map<string, { vatCodeId: string | null; rate: string; net: Decimal; vat: Decimal }>();
  for (const line of lines as any[]) {
    if (line.side !== "debit" || line.accountCode.startsWith("160")) continue;
    const vat = new Decimal(line.vatAmount ?? 0).toDecimalPlaces(2);
    if (vat.gt(0) && (!line.vatCodeId || line.vatRate == null)) return null;
    const rate = line.vatRate == null ? "0" : new Decimal(line.vatRate).toString();
    const key = `${line.vatCodeId ?? "none"}:${rate}`;
    const bucket = bucketMap.get(key) ?? {
      vatCodeId: line.vatCodeId,
      rate,
      net: new Decimal(0),
      vat: new Decimal(0),
    };
    bucket.net = bucket.net.plus(line.amount);
    bucket.vat = bucket.vat.plus(vat);
    bucketMap.set(key, bucket);
  }
  const bucketNet = [...bucketMap.values()].reduce((sum, bucket) => sum.plus(bucket.net), new Decimal(0));
  const bucketVat = [...bucketMap.values()].reduce((sum, bucket) => sum.plus(bucket.vat), new Decimal(0));
  if (!bucketNet.toDecimalPlaces(2).eq(bookedNet) || !bucketVat.toDecimalPlaces(2).eq(bookedVat)) return null;
  return {
    sourceEntryId: source.sourceEntryId,
    booked109Gross: money(bookedGross),
    bookedNet: money(bookedNet),
    bookedVat: money(bookedVat),
    buckets: [...bucketMap.values()]
      .map(bucket => ({
        vatCodeId: bucket.vatCodeId,
        rate: bucket.rate,
        net: money(bucket.net),
        vat: money(bucket.vat),
      }))
      .sort((a, b) => new Decimal(a.rate).cmp(b.rate) || (a.vatCodeId ?? "").localeCompare(b.vatCodeId ?? "")),
  };
}

async function lockInvoiceForPosLinks(tx: any, invoiceId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`);
}

async function getInvoicePosReceiptLinksResponse(companyId: string, invoiceId: string) {
  const [invoice] = await db
    .select({
      id: invoicesTable.id,
      type: invoicesTable.type,
      status: invoicesTable.status,
      counterpartyId: invoicesTable.counterpartyId,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return null;

  const fullInvoice = await fetchInvoiceWithLines(invoiceId);
  const invoiceNet = new Decimal(fullInvoice?.totalNet ?? "0");

  const linkedRows = await db
    .select({
      id: posInvoiceLinksTable.id,
      prejemnicaId: prejemniceTable.id,
      enotaId: enoteTable.id,
      enotaName: enoteTable.ime,
      receiptNumber: prejemniceTable.stevilka,
      documentNumber: prejemniceTable.stDokumenta,
      receiptDate: prejemniceTable.datum,
      documentDate: prejemniceTable.datumDokumenta,
      netAmount: prejemniceTable.skupajVrednost,
      vatBase: prejemniceTable.ddvOsnova,
      vatAmount: prejemniceTable.ddvZnesek,
      grossAmount: prejemniceTable.brutoSkupaj,
      currency: prejemniceTable.valuta,
      mode: posInvoiceLinksTable.mode,
      matchMethod: posInvoiceLinksTable.matchMethod,
      matchedBy: posInvoiceLinksTable.matchedBy,
      matchedAt: posInvoiceLinksTable.matchedAt,
    })
    .from(posInvoiceLinksTable)
    .innerJoin(prejemniceTable, eq(prejemniceTable.id, posInvoiceLinksTable.prejemnicaId))
    .innerJoin(enoteTable, eq(enoteTable.id, posInvoiceLinksTable.enotaId))
    .where(and(eq(posInvoiceLinksTable.companyId, companyId), eq(posInvoiceLinksTable.invoiceId, invoiceId)));

  const links = await Promise.all(
    linkedRows.map(async (row) => ({
      ...row,
      status: (invoice.status === "posted" ? "closed109" : "confirmed") as "closed109" | "confirmed",
      bookedTo109: await isReceiptBookedTo109(
        companyId,
        row.prejemnicaId,
        row.receiptDate,
        row.enotaId,
        null,
        row.netAmount,
      ),
    })),
  );
  const linkedNet = links.reduce((total, row) => total.plus(new Decimal(row.netAmount)), new Decimal(0));
  const isDirectDeliveryNoteInvoice = links.length > 0
    && links.every((row) => row.mode === "delivery_note_invoice");
  const allReceiptsBooked = links.every((row) => row.bookedTo109);
  const reasons = isDirectDeliveryNoteInvoice
    ? []
    : pos109PostingReasons({
        linkedReceiptNet: linkedNet,
        invoiceNet,
        allReceiptsBooked,
        hasLinks: links.length > 0,
      });

  const candidateRows = await db
    .select({
      prejemnicaId: prejemniceTable.id,
      enotaId: enoteTable.id,
      enotaName: enoteTable.ime,
      receiptNumber: prejemniceTable.stevilka,
      documentNumber: prejemniceTable.stDokumenta,
      receiptDate: prejemniceTable.datum,
      documentDate: prejemniceTable.datumDokumenta,
      netAmount: prejemniceTable.skupajVrednost,
      currency: prejemniceTable.valuta,
      vatBase: prejemniceTable.ddvOsnova,
      vatAmount: prejemniceTable.ddvZnesek,
    })
    .from(prejemniceTable)
    .innerJoin(enoteTable, eq(enoteTable.id, prejemniceTable.enotaId))
    .leftJoin(posInvoiceLinksTable, eq(posInvoiceLinksTable.prejemnicaId, prejemniceTable.id))
    .where(
      and(
        eq(enoteTable.companyId, companyId),
        eq(prejemniceTable.dobaviteljId, invoice.counterpartyId),
        isNull(posInvoiceLinksTable.id),
      ),
    )
    .orderBy(asc(prejemniceTable.datum));

  const candidates = await Promise.all(
    candidateRows.map(async (row) => {
      const exactDocument = Boolean(
        normalizePurchaseDocumentNumber(row.documentNumber)
        && normalizePurchaseDocumentNumber(row.documentNumber) === normalizePurchaseDocumentNumber(invoice.invoiceNumber),
      );
      const exactAmount = new Decimal(row.netAmount).eq(invoiceNet);
      const financeComplete = Boolean(
        row.documentNumber && row.documentDate && row.vatBase != null && row.vatAmount != null && new Decimal(row.netAmount).gt(0),
      );
      const matchMethod = exactDocument && exactAmount ? "exact" : "suggested";
      return {
        ...row,
        matchMethod,
        confidence: exactDocument && exactAmount ? 1 : exactDocument ? 0.85 : exactAmount ? 0.7 : 0.35,
        reason: exactDocument && exactAmount
          ? "Ista številka dokumenta in enak neto znesek."
          : exactDocument
            ? "Enaka številka dokumenta pri istem dobavitelju."
            : exactAmount
              ? "Enak neto znesek pri istem dobavitelju."
              : "Isti dobavitelj; preverite dokument in znesek.",
        financeComplete,
        bookedTo109: await isReceiptBookedTo109(
          companyId,
          row.prejemnicaId,
          row.receiptDate,
          row.enotaId,
          null,
          row.netAmount,
        ),
      };
    }),
  );
  candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    const invoiceTimestamp = timestampOf(invoice.invoiceDate);
    const leftTimestamp = timestampOf(left.receiptDate);
    const rightTimestamp = timestampOf(right.receiptDate);
    const leftDistance = Math.abs(leftTimestamp - invoiceTimestamp);
    const rightDistance = Math.abs(rightTimestamp - invoiceTimestamp);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const dateOrder = rightTimestamp - leftTimestamp;
    return dateOrder !== 0 ? dateOrder : left.prejemnicaId - right.prejemnicaId;
  });

  const auditRows = await db
    .select({
      action: auditLogTable.action,
      changedBy: auditLogTable.changedBy,
      changedAt: auditLogTable.changedAt,
      payload: auditLogTable.payload,
    })
    .from(auditLogTable)
    .where(and(
      eq(auditLogTable.companyId, companyId),
      eq(auditLogTable.entityType, "invoice"),
      eq(auditLogTable.entityId, invoiceId),
      inArray(auditLogTable.action, ["link_pos_prejemnica", "unlink_pos_prejemnica", "close_pos_109"]),
    ))
    .orderBy(desc(auditLogTable.changedAt), desc(auditLogTable.id));
  const matchHistory = auditRows.flatMap((row) => {
    const payload = asAuditPayload(row.payload);
    const prejemnicaId = auditInteger(payload.prejemnicaId);
    if (prejemnicaId == null) return [];
    const isLink = row.action === "link_pos_prejemnica";
    const isClose = row.action === "close_pos_109";
    const historicalStatus = auditEnum(payload.status, ["confirmed", "closed109", "unlinked"] as const);
    return [{
      action: isClose ? "closed109" as const : isLink ? "linked" as const : "unlinked" as const,
      status: (historicalStatus ?? (isClose ? "closed109" : isLink ? "confirmed" : "unlinked")) as PosMatchHistoryStatus,
      prejemnicaId,
      changedBy: row.changedBy,
      changedAt: row.changedAt,
      mode: auditEnum(payload.mode, ["delivery_note_invoice", "invoice_with_delivery_notes"] as const),
      matchMethod: auditEnum(payload.matchMethod, ["manual", "suggested", "exact"] as const),
    }];
  });

  return {
    invoice,
    body: {
      links,
      candidates,
      matchHistory,
      preview: {
        isDirectDeliveryNoteInvoice,
        linkedNet: linkedNet.toFixed(2),
        invoiceNet: invoiceNet.toFixed(2),
        unclosed109: Decimal.max(new Decimal(0), linkedNet.minus(invoiceNet)).toFixed(2),
        allReceiptsBooked: isDirectDeliveryNoteInvoice || allReceiptsBooked,
        canPost: reasons.length === 0,
        reasons,
      },
    },
  };
}

// ─── GET /companies/:companyId/invoices ───────────────────────────────────────
router.get(
  "/companies/:companyId/invoices",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { type, status, counterpartyId, periodId, dateFrom, dateTo } =
      req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [
      eq(invoicesTable.companyId, companyId),
    ];
    if (type) conditions.push(eq(invoicesTable.type, type as any));
    if (status) conditions.push(eq(invoicesTable.status, status as any));
    if (counterpartyId) conditions.push(eq(invoicesTable.counterpartyId, counterpartyId));
    if (periodId) conditions.push(eq(invoicesTable.periodId, periodId));
    if (dateFrom) conditions.push(gte(invoicesTable.invoiceDate, dateFrom));
    if (dateTo) conditions.push(lte(invoicesTable.invoiceDate, dateTo));

    const rows = await db
      .select({
        id: invoicesTable.id,
        companyId: invoicesTable.companyId,
        type: invoicesTable.type,
        sourceType: invoicesTable.sourceType,
        counterpartyId: invoicesTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        periodId: invoicesTable.periodId,
        periodName: accountingPeriodsTable.name,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        dueDate: invoicesTable.dueDate,
        destinationIban: invoicesTable.destinationIban,
        destinationBic: invoicesTable.destinationBic,
        paymentModel: invoicesTable.paymentModel,
        paymentReference: invoicesTable.paymentReference,
        paymentPurpose: invoicesTable.paymentPurpose,
        status: invoicesTable.status,
        arApAccountId: invoicesTable.arApAccountId,
        vatAccountId: invoicesTable.vatAccountId,
        linkedEntryId: invoicesTable.linkedEntryId,
        notes: invoicesTable.notes,
        historicalNet: invoicesTable.historicalNet,
        historicalVat: invoicesTable.historicalVat,
        historicalGross: invoicesTable.historicalGross,
        historicalReference: invoicesTable.historicalReference,
        createdBy: invoicesTable.createdBy,
        createdAt: invoicesTable.createdAt,
        updatedAt: invoicesTable.updatedAt,
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .innerJoin(accountingPeriodsTable, eq(accountingPeriodsTable.id, invoicesTable.periodId))
      .where(and(...conditions))
      .orderBy(asc(invoicesTable.invoiceDate), asc(invoicesTable.invoiceNumber));

    // Pridobi seštevke vrstic za vsak račun
    const invoiceIds = rows.map((r) => r.id);
    const allLines = invoiceIds.length > 0
      ? await db
          .select({
            invoiceId: invoiceLinesTable.invoiceId,
            quantity: invoiceLinesTable.quantity,
            unitPrice: invoiceLinesTable.unitPrice,
            vatRate: invoiceLinesTable.vatRate,
          })
          .from(invoiceLinesTable)
          .where(eq(invoiceLinesTable.invoiceId, invoiceIds[0]))
      : [];

    // Preračunaj seštevke (simplified — for list view)
    const invoices = rows.map((inv) => {
      // Seštevek bo prikazan ko se bo klicalo fetchInvoiceWithLines za posamezen račun
      // Za list view vrnemo z=0 totali - boljše je narediti agregatno query
      return { ...inv, totalNet: "0.00", totalVat: "0.00", totalGross: "0.00" };
    });

    // Popravi seštevke z agregatno poizvedbo
    const linesByInvoice = await db
      .select({
        invoiceId: invoiceLinesTable.invoiceId,
        quantity: invoiceLinesTable.quantity,
        unitPrice: invoiceLinesTable.unitPrice,
        vatRate: invoiceLinesTable.vatRate,
        vatBase: invoiceLinesTable.vatBase,
        storedVatAmount: invoiceLinesTable.vatAmount,
        sourceType: invoicesTable.sourceType,
        reverseCharge: vatCodeTable.isReverseCharge,
      })
      .from(invoiceLinesTable)
      .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
      .leftJoin(vatCodesTable, and(
        eq(vatCodesTable.id, invoiceLinesTable.vatCodeId),
        eq(vatCodesTable.companyId, invoicesTable.companyId),
      ))
      .leftJoin(vatCodeTable, eq(vatCodeTable.id, vatCodesTable.fursCodeId))
      .where(eq(invoicesTable.companyId, companyId));

    const totalsMap = new Map<string, { net: number; vat: number }>();
    for (const l of linesByInvoice) {
      const { lineTotal, vatAmt } = invoiceLineAmounts(l.sourceType, l);
      const prev = totalsMap.get(l.invoiceId) ?? { net: 0, vat: 0 };
      totalsMap.set(l.invoiceId, { net: prev.net + lineTotal, vat: prev.vat + vatAmt });
    }

    const invoicesWithTotals = invoices.map((inv) => {
      const t = totalsMap.get(inv.id) ?? { net: 0, vat: 0 };
      return {
        ...inv,
        totalNet: inv.historicalNet ?? t.net.toFixed(2),
        totalVat: inv.historicalVat ?? t.vat.toFixed(2),
        totalGross: inv.historicalGross ?? (t.net + t.vat).toFixed(2),
      };
    });

    res.json({ invoices: invoicesWithTotals });
  },
);

// ─── POST /companies/:companyId/invoices ──────────────────────────────────────
router.post(
  "/companies/:companyId/invoices",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const {
      type, counterpartyId, periodId, invoiceNumber, arApAccountId, vatAccountId, notes, lines,
      destinationIban, destinationBic, paymentModel, paymentReference, paymentPurpose,
    } = parsed.data;

    // Validacije
    const [period] = await db
      .select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (!period) { res.status(404).json({ error: "Račuonovodsko obdobje ni najdeno" }); return; }

    const [counterparty] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!counterparty) { res.status(404).json({ error: "Partner ni najden" }); return; }

    const [arApAccount] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, arApAccountId), eq(accountsTable.companyId, companyId)))
      .limit(1);
    if (!arApAccount) { res.status(400).json({ error: "Konto terjatev/obveznosti ni najden" }); return; }

    // Preveri vatAccountId (če je podan)
    if (vatAccountId) {
      const [vatAcc] = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.id, vatAccountId),
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
        ))
        .limit(1);
      if (!vatAcc) { res.status(400).json({ error: "DDV konto ni aktiven analitični konto, ki dovoljuje knjiženje" }); return; }
    }

    // Preveri vse kontne oznake vrstic — morajo pripadati istemu podjetju
    const lineAccountIds = [...new Set(lines.map((l) => l.accountId))];
    const validLineAccounts = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(inArray(accountsTable.id, lineAccountIds), eq(accountsTable.companyId, companyId)));
    if (validLineAccounts.length !== lineAccountIds.length) {
      res.status(400).json({ error: "Eden ali več kontov vrstic ne pripada temu podjetju" });
      return;
    }

    // Datumi
    const invoiceDate = (parsed.data.invoiceDate as unknown as Date).toISOString().slice(0, 10);
    const dueDate = parsed.data.dueDate
      ? (parsed.data.dueDate as unknown as Date).toISOString().slice(0, 10)
      : null;

    let invoiceId: string;
    try {
      invoiceId = await db.transaction(async (tx) => {
      const sourceDocumentId = type === "received"
        ? await claimPurchaseSourceDocument(tx, {
            companyId,
            counterpartyId,
            kind: "invoice",
            documentNumber: invoiceNumber,
            documentDate: invoiceDate,
          })
        : null;
      const [newInv] = await tx
        .insert(invoicesTable)
        .values({
          companyId,
          type,
          counterpartyId,
          periodId,
          invoiceNumber,
          invoiceDate,
          dueDate,
          destinationIban: type === "received" ? destinationIban?.replace(/\s+/g, "").toUpperCase() || null : null,
          destinationBic: type === "received" ? destinationBic?.replace(/\s+/g, "").toUpperCase() || null : null,
          paymentModel: type === "received" ? paymentModel?.trim() || null : null,
          paymentReference: type === "received" ? paymentReference?.trim() || null : null,
          paymentPurpose: type === "received" ? paymentPurpose?.trim() || null : null,
          arApAccountId,
          vatAccountId: vatAccountId ?? null,
          notes: notes ?? null,
          createdBy: authReq.clerkUserId,
          sourceDocumentId,
        })
        .returning({ id: invoicesTable.id });

      await tx.insert(invoiceLinesTable).values(
        lines.map((l, i) => ({
          invoiceId: newInv.id,
          description: l.description,
          quantity: l.quantity.toFixed(3),
          unitPrice: l.unitPrice.toFixed(4),
          vatRate: l.vatRate.toFixed(2),
          vatCodeId: l.vatCodeId ?? null,
          assetType: l.assetType ?? "NONE",
          accountId: l.accountId,
          sequence: i,
        })),
      );

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: newInv.id,
        action: "create",
        changedBy: authReq.clerkUserId,
        payload: { type, invoiceNumber, lineCount: lines.length },
      });

      return newInv.id;
      });
    } catch (error: any) {
      if (
        error?.cause?.code === "23505"
        || error?.code === "23505"
        || error?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
      ) {
        res.status(409).json({
          error: "Prejeti račun s to dobaviteljevo številko je že zajet",
        });
        return;
      }
      throw error;
    }

    const result = await fetchInvoiceWithLines(invoiceId);
    res.status(201).json(result);
  },
);

// ─── POS pogodbene malice: mesečni zbirni A-račun ────────────────────────────
router.get(
  "/companies/:companyId/invoices/pos-contract-summary/preview",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const counterpartyId = typeof req.query.counterpartyId === "string" ? req.query.counterpartyId : "";
    if (!await resolveAccess(authReq.clerkUserId, companyId, res)) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !counterpartyId) {
      res.status(400).json({ error: "Izberite veljaven mesec in pogodbenega partnerja." });
      return;
    }
    const [[counterparty], receipts] = await Promise.all([
      db
        .select({ paymentTermsDays: counterpartiesTable.paymentTermsDays })
        .from(counterpartiesTable)
        .where(and(
          eq(counterpartiesTable.id, counterpartyId),
          eq(counterpartiesTable.companyId, companyId),
          eq(counterpartiesTable.isActive, true),
        ))
        .limit(1),
      loadUnbilledContractReceipts(companyId, counterpartyId, month),
    ]);
    if (!counterparty) {
      res.status(404).json({ error: "Pogodbeni partner ni najden." });
      return;
    }
    const buckets = await loadContractVatBuckets(receipts.map((receipt) => receipt.id));
    const gross = receipts.reduce((sum, receipt) => sum.plus(receipt.grossAmount), new Decimal(0));
    const paymentTermsDays = Math.max(0, Number(counterparty.paymentTermsDays ?? 0));
    res.json({
      month,
      receiptCount: receipts.length,
      grossAmount: gross.toFixed(2),
      paymentTermsDays,
      receipts,
      vatBuckets: buckets.map((bucket) => ({
        vatRate: bucket.vatRate.toFixed(2),
        netAmount: bucket.net.toFixed(2),
        vatAmount: bucket.vat.toFixed(2),
        grossAmount: bucket.gross.toFixed(2),
      })),
    });
  },
);

router.post(
  "/companies/:companyId/invoices/pos-contract-summary",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za izdelavo A-računa potrebujete vlogo računovodja ali lastnik." });
      return;
    }
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    const counterpartyId = typeof req.body?.counterpartyId === "string" ? req.body.counterpartyId : "";
    const invoiceNumber = typeof req.body?.invoiceNumber === "string" ? req.body.invoiceNumber.trim() : "";
    const invoiceDate = typeof req.body?.invoiceDate === "string" ? req.body.invoiceDate : "";
    const requestedDueDate = typeof req.body?.dueDate === "string" && req.body.dueDate ? req.body.dueDate : null;
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
      || (requestedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDueDate))
      || !counterpartyId
      || !invoiceNumber
    ) {
      res.status(400).json({ error: "Manjkajo veljaven mesec, partner, številka ali datum A-računa." });
      return;
    }
    const currentMonthParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Ljubljana",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const currentMonth = `${currentMonthParts.find((part) => part.type === "year")?.value}-${currentMonthParts.find((part) => part.type === "month")?.value}`;
    if (month >= currentMonth) {
      res.status(409).json({ error: "Zbirni A-račun je dovoljeno izdelati šele po koncu poslovnega meseca." });
      return;
    }
    const [counterparty] = await db
      .select({
        id: counterpartiesTable.id,
        paymentTermsDays: counterpartiesTable.paymentTermsDays,
      })
      .from(counterpartiesTable)
      .where(and(
        eq(counterpartiesTable.id, counterpartyId),
        eq(counterpartiesTable.companyId, companyId),
        eq(counterpartiesTable.isActive, true),
      ))
      .limit(1);
    if (!counterparty) {
      res.status(404).json({ error: "Pogodbeni partner ni najden." });
      return;
    }
    const [settings] = await db
      .select({
        arAccountId: posBookingSettingsTable.kirArAccountId,
        transitAccountId: posBookingSettingsTable.contractReceivableTransitAccountId,
      })
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);
    if (!settings?.arAccountId || !settings.transitAccountId) {
      res.status(409).json({
        error: "V POS → ERP nastavitvah nastavite konto terjatev KIR/AR in prehodni konto pogodbenih malic.",
      });
      return;
    }
    const [period] = await db
      .select({ id: accountingPeriodsTable.id })
      .from(accountingPeriodsTable)
      .where(and(
        eq(accountingPeriodsTable.companyId, companyId),
        lte(accountingPeriodsTable.startDate, invoiceDate),
        gte(accountingPeriodsTable.endDate, invoiceDate),
        notInArray(accountingPeriodsTable.status, ["locked"]),
      ))
      .limit(1);
    if (!period) {
      res.status(409).json({ error: "Za datum A-računa ni odprtega računovodskega obdobja." });
      return;
    }
    const receipts = await loadUnbilledContractReceipts(companyId, counterpartyId, month);
    if (receipts.length === 0) {
      res.status(409).json({ error: "Za izbrani mesec ni neobračunanih pogodbenih POS računov." });
      return;
    }
    const receiptGross = receipts.reduce((sum, receipt) => sum.plus(receipt.grossAmount), new Decimal(0));
    const buckets = await loadContractVatBuckets(receipts.map((receipt) => receipt.id));
    const bucketGross = buckets.reduce((sum, bucket) => sum.plus(bucket.gross), new Decimal(0));
    if (receiptGross.minus(bucketGross).abs().gt("0.02")) {
      res.status(409).json({ error: "Vsota POS postavk se ne ujema z vsoto dnevnih računov; A-račun ni ustvarjen." });
      return;
    }
    const refs = [...new Set(receipts.map((receipt) => `POS:PRODAJA:${receipt.businessDate}:E${receipt.unitId}`))];
    const dailyEntries = await db
      .select({ id: journalEntriesTable.id, reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        inArray(journalEntriesTable.reference, refs),
      ));
    const entryByRef = new Map(dailyEntries.map((entry) => [entry.reference, entry.id]));
    if (refs.some((ref) => !entryByRef.has(ref))) {
      res.status(409).json({
        error: "Vsak dnevni POS račun mora biti zajet v potrjeni dnevni prodajni temeljnici na prehodnem kontu.",
      });
      return;
    }
    const transitLines = await db
      .select({ entryId: journalEntryLinesTable.entryId })
      .from(journalEntryLinesTable)
      .where(and(
        inArray(journalEntryLinesTable.entryId, dailyEntries.map((entry) => entry.id)),
        eq(journalEntryLinesTable.accountId, settings.transitAccountId),
        eq(journalEntryLinesTable.side, "debit"),
      ));
    const transitEntryIds = new Set(transitLines.map((line) => line.entryId));
    if (dailyEntries.some((entry) => !transitEntryIds.has(entry.id))) {
      res.status(409).json({
        error: "Potrjena dnevna temeljnica pogodbenih malic ne uporablja nastavljenega prehodnega konta.",
      });
      return;
    }
    const paymentTermsDays = Math.max(0, Number(counterparty.paymentTermsDays ?? 0));
    const dueDate = requestedDueDate ?? resolveContractSummaryDueDate(invoiceDate, paymentTermsDays);

    let invoiceId: string;
    try {
      invoiceId = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${counterpartyId}:${month}:contract-summary`}))`);
        const posOnlyClaims = await tx.execute(sql`SELECT receipt_id FROM pos_monthly_invoice_receipts
          WHERE receipt_id IN (${sql.join(receipts.map(receipt => sql`${receipt.id}`), sql`,`)}) LIMIT 1`);
        if (posOnlyClaims.rows.length) throw new Error("CONTRACT_SUMMARY_EXISTS");
        const [existing] = await tx
          .select({ id: invoicesTable.id })
          .from(invoicesTable)
          .where(and(
            eq(invoicesTable.companyId, companyId),
            eq(invoicesTable.sourceType, "pos-contract-summary"),
            eq(invoicesTable.sourcePeriod, month),
            eq(invoicesTable.counterpartyId, counterpartyId),
          ))
          .limit(1);
        if (existing) throw new Error("CONTRACT_SUMMARY_EXISTS");
        const [invoice] = await tx
          .insert(invoicesTable)
          .values({
            companyId,
            type: "issued",
            sourceType: "pos-contract-summary",
            sourcePeriod: month,
            counterpartyId,
            periodId: period.id,
            invoiceNumber,
            invoiceDate,
            dueDate,
            status: "draft",
            arApAccountId: settings.arAccountId!,
            vatAccountId: null,
            notes: `Mesečni zbirni A-račun pogodbenih malic za ${month}; prihodki in DDV so knjiženi na dnevnih POS računih.`,
            createdBy: authReq.clerkUserId,
          })
          .returning({ id: invoicesTable.id });
        await tx.insert(invoiceLinesTable).values(
          buckets.map((bucket, sequence) => ({
            invoiceId: invoice.id,
            description: `Pogodbene malice ${month} · DDV ${bucket.vatRate.toFixed(2)} %`,
            quantity: "1.000",
            unitPrice: bucket.net.toFixed(4),
            vatRate: bucket.vatRate.toFixed(2),
            vatBase: bucket.net.toFixed(2),
            vatAmount: bucket.vat.toFixed(2),
            accountId: settings.transitAccountId!,
            sequence,
          })),
        );
        await tx.insert(posContractInvoiceReceiptsTable).values(
          receipts.map((receipt) => ({
            companyId,
            invoiceId: invoice.id,
            receiptId: receipt.id,
            dailyEntryId: entryByRef.get(`POS:PRODAJA:${receipt.businessDate}:E${receipt.unitId}`)!,
            grossAmount: new Decimal(receipt.grossAmount).toFixed(2),
          })),
        );
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "invoice",
          entityId: invoice.id,
          action: "create_pos_contract_summary",
          changedBy: authReq.clerkUserId,
          payload: { month, receiptCount: receipts.length, grossAmount: receiptGross.toFixed(2) },
        });
        return invoice.id;
      });
    } catch (error: any) {
      if (error?.message === "CONTRACT_SUMMARY_EXISTS" || error?.code === "23505" || error?.cause?.code === "23505") {
        res.status(409).json({ error: "Za tega partnerja in mesec zbirni A-račun že obstaja ali pa je bil dnevni račun že vključen." });
        return;
      }
      throw error;
    }
    res.status(201).json(await fetchInvoiceWithLines(invoiceId));
  },
);

// ─── GET /companies/:companyId/invoices/:id ───────────────────────────────────
router.get(
  "/companies/:companyId/invoices/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [check] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!check) { res.status(404).json({ error: "Račun ni najden" }); return; }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── POS prejemnice / konto 109 ───────────────────────────────────────────────
router.get(
  "/companies/:companyId/invoices/:id/pos-prejemnice",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const result = await getInvoicePosReceiptLinksResponse(companyId, id);
    if (!result) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (result.invoice.type !== "received") {
      res.status(400).json({ error: "POS prejemnice lahko povežete samo s prejetim računom" });
      return;
    }
    res.json(result.body);
  },
);

router.put(
  "/companies/:companyId/invoices/:id/pos-prejemnice",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za povezovanje prejemnic potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = LinkInvoicePosReceiptBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        type: invoicesTable.type,
        status: invoicesTable.status,
        counterpartyId: invoicesTable.counterpartyId,
        invoiceNumber: invoicesTable.invoiceNumber,
        sourceDocumentId: invoicesTable.sourceDocumentId,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);
    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.type !== "received") {
      res.status(400).json({ error: "POS prejemnice lahko povežete samo s prejetim računom" });
      return;
    }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: "Prejemnice lahko spreminjate samo na osnutku računa" });
      return;
    }

    const [receipt] = await db
      .select({
        id: prejemniceTable.id,
        enotaId: prejemniceTable.enotaId,
        dobaviteljId: prejemniceTable.dobaviteljId,
        documentNumber: prejemniceTable.stDokumenta,
        documentDate: prejemniceTable.datumDokumenta,
        vatBase: prejemniceTable.ddvOsnova,
        vatAmount: prejemniceTable.ddvZnesek,
        amount: prejemniceTable.skupajVrednost,
        companyId: enoteTable.companyId,
        sourceDocumentId: prejemniceTable.sourceDocumentId,
      })
      .from(prejemniceTable)
      .innerJoin(enoteTable, eq(enoteTable.id, prejemniceTable.enotaId))
      .where(eq(prejemniceTable.id, parsed.data.prejemnicaId))
      .limit(1);
    if (!receipt || receipt.companyId !== companyId) {
      res.status(404).json({ error: "Prejemnica ni najdena v aktivnem podjetju" });
      return;
    }
    if (receipt.dobaviteljId !== invoice.counterpartyId) {
      res.status(400).json({ error: "Prejemnica in račun morata imeti istega dobavitelja" });
      return;
    }
    if (new Decimal(receipt.amount).lte(0)) {
      res.status(400).json({ error: "Prejemnica brez pozitivne finančne vrednosti ne more zapirati konta 109" });
      return;
    }
    if (
      parsed.data.mode === "delivery_note_invoice" &&
      (!receipt.documentNumber || !receipt.documentDate || receipt.vatBase == null || receipt.vatAmount == null)
    ) {
      res.status(400).json({
        error: "Način »Dobavnica je račun« zahteva številko in datum dokumenta ter popolne DDV podatke na prejemnici.",
      });
      return;
    }
    if (
      parsed.data.mode === "delivery_note_invoice"
      && invoice.sourceDocumentId
      && receipt.sourceDocumentId
      && invoice.sourceDocumentId !== receipt.sourceDocumentId
    ) {
      res.status(409).json({
        error: "Prejemnica in račun imata različni izvorni listini; načina »Dobavnica je račun« ni mogoče uporabiti",
      });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        await lockPosReceiptForReconciliation(tx, companyId, receipt.enotaId, receipt.id);
        await lockInvoiceForPosLinks(tx, id);
        const [lockedInvoice] = await tx
          .select({
            status: invoicesTable.status,
            invoiceNumber: invoicesTable.invoiceNumber,
            sourceDocumentId: invoicesTable.sourceDocumentId,
            dueDate: invoicesTable.dueDate,
            destinationIban: invoicesTable.destinationIban,
            destinationBic: invoicesTable.destinationBic,
            paymentModel: invoicesTable.paymentModel,
            paymentReference: invoicesTable.paymentReference,
            paymentPurpose: invoicesTable.paymentPurpose,
          })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
          .limit(1);
        if (!lockedInvoice || lockedInvoice.status !== "draft") {
          throw new Error("INVOICE_POS_LINKS_LOCKED");
        }
        const [lockedReceipt] = await tx
          .select({
            documentNumber: prejemniceTable.stDokumenta,
            amount: prejemniceTable.skupajVrednost,
            vatBase: prejemniceTable.ddvOsnova,
            vatAmount: prejemniceTable.ddvZnesek,
            grossAmount: prejemniceTable.brutoSkupaj,
            currency: prejemniceTable.valuta,
            sourceDocumentId: prejemniceTable.sourceDocumentId,
            dueDate: prejemniceTable.datumZapadlosti,
            destinationIban: prejemniceTable.dobaviteljIban,
            destinationBic: prejemniceTable.dobaviteljBic,
            paymentModel: prejemniceTable.placilniModel,
            paymentReference: prejemniceTable.placilniSklic,
            paymentPurpose: prejemniceTable.placilniNamen,
          })
          .from(prejemniceTable)
          .innerJoin(enoteTable, and(
            eq(enoteTable.id, prejemniceTable.enotaId),
            eq(enoteTable.companyId, companyId),
          ))
          .where(and(
            eq(prejemniceTable.id, receipt.id),
            eq(prejemniceTable.enotaId, receipt.enotaId),
          ))
          .limit(1);
        if (!lockedReceipt) {
          throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Prejemnica ni najdena.");
        }
        const invoiceLineAmounts = await tx
          .select({
            quantity: invoiceLinesTable.quantity,
            unitPrice: invoiceLinesTable.unitPrice,
            vatRate: invoiceLinesTable.vatRate,
          })
          .from(invoiceLinesTable)
          .where(eq(invoiceLinesTable.invoiceId, id));
        const invoiceNet = invoiceLineAmounts.reduce(
          (sum, line) => sum.plus(new Decimal(line.quantity).mul(line.unitPrice)),
          new Decimal(0),
        ).toDecimalPlaces(2);
        const receiptNet = new Decimal(lockedReceipt.amount);
        const invoiceVat = invoiceLineAmounts.reduce((sum, line) => {
          const net = new Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          return sum.plus(net.mul(line.vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
        }, new Decimal(0)).toDecimalPlaces(2);
        const invoiceGross = invoiceNet.plus(invoiceVat);
        const invoiceCanonicalNumber = normalizePurchaseDocumentNumber(lockedInvoice.invoiceNumber);
        const receiptCanonicalNumber = normalizePurchaseDocumentNumber(lockedReceipt.documentNumber);
        const canonicalNumberEqual = Boolean(
          invoiceCanonicalNumber
          && receiptCanonicalNumber
          && invoiceCanonicalNumber === receiptCanonicalNumber,
        );
        const netAmountEqual = invoiceNet.eq(receiptNet);
        const effectiveMatchMethod = parsed.data.matchMethod === "manual"
          ? "manual"
          : canonicalNumberEqual && netAmountEqual
            ? "exact"
            : "suggested";
        const existingLinkModes = await tx.select({ mode: posInvoiceLinksTable.mode })
          .from(posInvoiceLinksTable)
          .where(and(
            eq(posInvoiceLinksTable.companyId, companyId),
            eq(posInvoiceLinksTable.invoiceId, id),
          ));
        if (
          (parsed.data.mode === "delivery_note_invoice" && existingLinkModes.length > 0)
          || existingLinkModes.some(link => link.mode === "delivery_note_invoice")
        ) {
          throw new Error("MODE_A_REQUIRES_SINGLE_RECEIPT");
        }
        if (parsed.data.mode === "delivery_note_invoice") {
          const receiptVat = lockedReceipt.vatAmount == null ? null : new Decimal(lockedReceipt.vatAmount);
          const receiptGross = lockedReceipt.grossAmount == null
            ? receiptVat == null ? null : receiptNet.plus(receiptVat)
            : new Decimal(lockedReceipt.grossAmount);
          if (
            lockedReceipt.currency !== "EUR"
            || !canonicalNumberEqual
            || !netAmountEqual
            || receiptVat == null
            || !receiptVat.eq(invoiceVat)
            || receiptGross == null
            || !receiptGross.eq(invoiceGross)
            || (lockedReceipt.vatBase != null && !new Decimal(lockedReceipt.vatBase).eq(invoiceNet))
          ) {
            throw new Error("MODE_A_IDENTITY_MISMATCH");
          }
          const receiptVatLines = await tx.select({
            rate: prejemnicePostavkeTable.ddvStopnja,
            preferredNet: prejemnicePostavkeTable.ddvOsnova,
            net: prejemnicePostavkeTable.netoZnesek,
            fallbackNet: prejemnicePostavkeTable.skupaj,
            vat: prejemnicePostavkeTable.ddvZnesek,
          }).from(prejemnicePostavkeTable)
            .where(eq(prejemnicePostavkeTable.prejemnicaId, receipt.id));
          if (receiptVatLines.length === 0 || receiptVatLines.some(line => line.rate == null || line.vat == null)) {
            throw new Error("MODE_A_IDENTITY_MISMATCH");
          }
          const receiptBuckets = new Map<string, { net: Decimal; vat: Decimal }>();
          for (const line of receiptVatLines) {
            const rate = new Decimal(line.rate!).toString();
            const bucket = receiptBuckets.get(rate) ?? { net: new Decimal(0), vat: new Decimal(0) };
            bucket.net = bucket.net.plus(line.preferredNet ?? line.net ?? line.fallbackNet);
            bucket.vat = bucket.vat.plus(line.vat!);
            receiptBuckets.set(rate, bucket);
          }
          const invoiceBuckets = new Map<string, { net: Decimal; vat: Decimal }>();
          for (const line of invoiceLineAmounts) {
            const rate = new Decimal(line.vatRate).toString();
            const net = new Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            const bucket = invoiceBuckets.get(rate) ?? { net: new Decimal(0), vat: new Decimal(0) };
            bucket.net = bucket.net.plus(net);
            bucket.vat = bucket.vat.plus(net.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
            invoiceBuckets.set(rate, bucket);
          }
          if (
            receiptBuckets.size !== invoiceBuckets.size
            || [...receiptBuckets].some(([rate, bucket]) => {
              const invoiceBucket = invoiceBuckets.get(rate);
              return !invoiceBucket
                || !bucket.net.toDecimalPlaces(2).eq(invoiceBucket.net.toDecimalPlaces(2))
                || !bucket.vat.toDecimalPlaces(2).eq(invoiceBucket.vat.toDecimalPlaces(2));
            })
          ) {
            throw new Error("MODE_A_IDENTITY_MISMATCH");
          }
        }
        let resultingInvoiceSourceDocumentId = lockedInvoice.sourceDocumentId;
        let resultingReceiptSourceDocumentId = lockedReceipt.sourceDocumentId;
        if (parsed.data.mode === "delivery_note_invoice") {
          if (
            lockedInvoice.sourceDocumentId
            && lockedReceipt.sourceDocumentId
            && lockedInvoice.sourceDocumentId !== lockedReceipt.sourceDocumentId
          ) {
            throw new Error("MODE_A_SOURCE_MISMATCH");
          }
          const [postedReceiptBooking] = await tx
            .select({ journalEntryId: posReceiptBookingSourcesTable.journalEntryId })
            .from(posReceiptBookingSourcesTable)
            .innerJoin(
              journalEntriesTable,
              and(
                eq(journalEntriesTable.id, posReceiptBookingSourcesTable.journalEntryId),
                eq(journalEntriesTable.companyId, companyId),
                eq(journalEntriesTable.status, "posted"),
              ),
            )
            .where(eq(posReceiptBookingSourcesTable.prejemnicaId, receipt.id))
            .limit(1);
          if (!lockedReceipt.sourceDocumentId && postedReceiptBooking) {
            throw new Error("MODE_A_POSTED_RECEIPT_MISSING_SOURCE");
          }
          let sharedSourceId = lockedInvoice.sourceDocumentId ?? lockedReceipt.sourceDocumentId;
          if (!sharedSourceId) {
            sharedSourceId = await claimPurchaseSourceDocument(tx, {
              companyId,
              counterpartyId: invoice.counterpartyId,
              kind: "invoice",
              documentNumber: receipt.documentNumber,
              documentDate: receipt.documentDate,
              excludeInvoiceId: id,
              excludePosReceiptId: receipt.id,
            });
          } else {
            await tx.execute(sql`
              SELECT pg_advisory_xact_lock(hashtext(${sharedSourceId}))
            `);
          }
          resultingInvoiceSourceDocumentId = sharedSourceId;
          resultingReceiptSourceDocumentId = sharedSourceId;
          await tx.update(invoicesTable)
            .set({
              sourceDocumentId: sharedSourceId,
              dueDate: lockedReceipt.dueDate ?? lockedInvoice.dueDate,
              destinationIban: lockedReceipt.destinationIban?.replace(/\s+/g, "").toUpperCase()
                ?? lockedInvoice.destinationIban,
              destinationBic: lockedReceipt.destinationBic?.replace(/\s+/g, "").toUpperCase()
                ?? lockedInvoice.destinationBic,
              paymentModel: lockedReceipt.paymentModel ?? lockedInvoice.paymentModel,
              paymentReference: lockedReceipt.paymentReference ?? lockedInvoice.paymentReference,
              paymentPurpose: lockedReceipt.paymentPurpose ?? lockedInvoice.paymentPurpose,
            })
            .where(eq(invoicesTable.id, id));
          if (!lockedReceipt.sourceDocumentId) {
            await tx.update(prejemniceTable)
              .set({ sourceDocumentId: sharedSourceId })
              .where(eq(prejemniceTable.id, receipt.id));
          }
        }
        await tx.insert(posInvoiceLinksTable).values({
          companyId,
          invoiceId: id,
          prejemnicaId: receipt.id,
          enotaId: receipt.enotaId,
          mode: parsed.data.mode,
          matchMethod: effectiveMatchMethod,
          matchedBy: authReq.clerkUserId,
        });
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "invoice",
          entityId: id,
          action: "link_pos_prejemnica",
          changedBy: authReq.clerkUserId,
          payload: {
            prejemnicaId: receipt.id,
            enotaId: receipt.enotaId,
            status: "confirmed",
            mode: parsed.data.mode,
            matchMethod: effectiveMatchMethod,
            requestedMatchMethod: parsed.data.matchMethod ?? null,
            canonicalNumberEqual,
            netAmountEqual,
            invoiceCanonicalNumber,
            receiptCanonicalNumber,
            invoiceNetAmount: invoiceNet.toFixed(2),
            receiptNetAmount: receiptNet.toFixed(2),
            invoiceSourceDocumentId: resultingInvoiceSourceDocumentId,
            receiptSourceDocumentId: resultingReceiptSourceDocumentId,
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof ReceiptEditConflict) {
        res.status(error.code === "RECEIPT_BOOKING_POSTED" ? 409 : 404)
          .json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_POS_LINKS_LOCKED") {
        res.status(400).json({ error: "Prejemnic ni mogoče spreminjati, ker je račun medtem poknjižen." });
        return;
      }
      if (error instanceof Error && error.message === "MODE_A_REQUIRES_SINGLE_RECEIPT") {
        res.status(409).json({ error: "Način »Dobavnica je račun« dovoljuje natanko eno povezano prejemnico." });
        return;
      }
      if (error instanceof Error && error.message === "MODE_A_IDENTITY_MISMATCH") {
        res.status(409).json({ error: "Dobavnica in račun nimata popolnoma enake identitete, neto, DDV in bruto vrednosti." });
        return;
      }
      if (error instanceof Error && error.message === "MODE_A_POSTED_RECEIPT_MISSING_SOURCE") {
        res.status(409).json({
          error: "Poknjižena prejemnica nima izvorne listine. Potrebna je računovodska razrešitev ali uporaba načina »Račun z dobavnicami«; izvora prejemnice ni dovoljeno naknadno spreminjati.",
        });
        return;
      }
      if (error instanceof Error && error.message === "MODE_A_SOURCE_MISMATCH") {
        res.status(409).json({
          error: "Prejemnica in račun imata različni izvorni listini; načina »Dobavnica je račun« ni mogoče uporabiti",
        });
        return;
      }
      const code = (error as { code?: string; cause?: { code?: string } }).code
        ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23505" || code === "LEGACY_PURCHASE_SOURCE_CONFLICT") {
        res.status(409).json({ error: "Ta prejemnica je že povezana z drugim računom in je ni mogoče dvakrat zapreti." });
        return;
      }
      throw error;
    }

    const result = await getInvoicePosReceiptLinksResponse(companyId, id);
    res.json(result!.body);
  },
);

router.delete(
  "/companies/:companyId/invoices/:id/pos-prejemnice/:prejemnicaId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const prejemnicaId = Number(extractParam(req.params.prejemnicaId));
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za razvezovanje prejemnic potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    if (!Number.isInteger(prejemnicaId)) {
      res.status(400).json({ error: "Neveljaven ID prejemnice" });
      return;
    }

    const [invoice] = await db
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);
    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: "Prejemnice lahko razvežete samo na osnutku računa" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const [linkedReceipt] = await tx
          .select({ enotaId: prejemniceTable.enotaId })
          .from(posInvoiceLinksTable)
          .innerJoin(prejemniceTable, eq(prejemniceTable.id, posInvoiceLinksTable.prejemnicaId))
          .innerJoin(enoteTable, and(
            eq(enoteTable.id, prejemniceTable.enotaId),
            eq(enoteTable.companyId, companyId),
          ))
          .where(and(
            eq(posInvoiceLinksTable.companyId, companyId),
            eq(posInvoiceLinksTable.invoiceId, id),
            eq(posInvoiceLinksTable.prejemnicaId, prejemnicaId),
          ))
          .limit(1);
        if (!linkedReceipt) throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Povezana prejemnica ni najdena.");

        // Enak vrstni red kot pri povezovanju: najprej prejemnica, nato račun.
        await lockPosReceiptForReconciliation(tx, companyId, linkedReceipt.enotaId, prejemnicaId);
        await lockInvoiceForPosLinks(tx, id);
        const [lockedInvoice] = await tx
          .select({ status: invoicesTable.status })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
          .limit(1);
        if (!lockedInvoice || lockedInvoice.status !== "draft") {
          throw new Error("INVOICE_POS_LINKS_LOCKED");
        }
        const [linkMetadata] = await tx
          .select({
            id: posInvoiceLinksTable.id,
            enotaId: posInvoiceLinksTable.enotaId,
            mode: posInvoiceLinksTable.mode,
            matchMethod: posInvoiceLinksTable.matchMethod,
            matchedBy: posInvoiceLinksTable.matchedBy,
            matchedAt: posInvoiceLinksTable.matchedAt,
            invoiceSourceDocumentId: invoicesTable.sourceDocumentId,
            receiptSourceDocumentId: prejemniceTable.sourceDocumentId,
          })
          .from(posInvoiceLinksTable)
          .innerJoin(invoicesTable, and(
            eq(invoicesTable.id, posInvoiceLinksTable.invoiceId),
            eq(invoicesTable.companyId, companyId),
          ))
          .innerJoin(prejemniceTable, eq(prejemniceTable.id, posInvoiceLinksTable.prejemnicaId))
          .where(and(
            eq(posInvoiceLinksTable.companyId, companyId),
            eq(posInvoiceLinksTable.invoiceId, id),
            eq(posInvoiceLinksTable.prejemnicaId, prejemnicaId),
          ))
          .limit(1);
        if (!linkMetadata) {
          throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Povezana prejemnica ni najdena.");
        }
        const deleted = await tx
          .delete(posInvoiceLinksTable)
          .where(and(
            eq(posInvoiceLinksTable.companyId, companyId),
            eq(posInvoiceLinksTable.invoiceId, id),
            eq(posInvoiceLinksTable.prejemnicaId, prejemnicaId),
          ))
          .returning({ id: posInvoiceLinksTable.id });
        if (deleted.length > 0) {
          await tx.insert(auditLogTable).values({
            companyId,
            entityType: "invoice",
            entityId: id,
            action: "unlink_pos_prejemnica",
            changedBy: authReq.clerkUserId,
            payload: {
              prejemnicaId,
              enotaId: linkMetadata.enotaId,
              status: "unlinked",
              linkId: linkMetadata.id,
              mode: linkMetadata.mode,
              matchMethod: linkMetadata.matchMethod,
              matchedBy: linkMetadata.matchedBy,
              matchedAt: linkMetadata.matchedAt.toISOString(),
              invoiceSourceDocumentId: linkMetadata.invoiceSourceDocumentId,
              receiptSourceDocumentId: linkMetadata.receiptSourceDocumentId,
            },
          });
        }
      });
    } catch (error: unknown) {
      if (error instanceof ReceiptEditConflict) {
        res.status(error.code === "RECEIPT_BOOKING_POSTED" ? 409 : 404)
          .json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_POS_LINKS_LOCKED") {
        res.status(409).json({ error: "Prejemnic ni mogoče spreminjati, ker je račun medtem poknjižen." });
        return;
      }
      throw error;
    }
    const result = await getInvoicePosReceiptLinksResponse(companyId, id);
    res.json(result!.body);
  },
);

// ─── PATCH /companies/:companyId/invoices/:id ─────────────────────────────────
router.patch(
  "/companies/:companyId/invoices/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdateInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        type: invoicesTable.type,
        sourceType: invoicesTable.sourceType,
        sourcePeriod: invoicesTable.sourcePeriod,
        counterpartyId: invoicesTable.counterpartyId,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        sourceDocumentId: invoicesTable.sourceDocumentId,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (existing.sourceType === "bookie-old") {
      res.status(409).json({ error: "Zgodovinskega računa ni mogoče urejati kot novega; vir in povezano GK temeljnico je treba uskladiti ločeno." });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke je mogoče urejati" });
      return;
    }
    if (
      existing.sourceType === "pos-contract-summary"
      && (
        parsed.data.counterpartyId !== undefined
        || parsed.data.periodId !== undefined
        || parsed.data.arApAccountId !== undefined
        || parsed.data.vatAccountId !== undefined
        || parsed.data.lines !== undefined
      )
    ) {
      res.status(409).json({
        error: "Pri zbirnem A-računu lahko spremenite le številko, datum, rok plačila in opombo; partner, konti ter specifikacija so zaklenjeni.",
      });
      return;
    }

    const { lines, invoiceDate, dueDate, ...headerFields } = parsed.data;

    // Validacija vseh FK polj, ki se morda menjajo
    if (parsed.data.counterpartyId) {
      const [cp] = await db.select({ id: counterpartiesTable.id }).from(counterpartiesTable)
        .where(and(eq(counterpartiesTable.id, parsed.data.counterpartyId), eq(counterpartiesTable.companyId, companyId))).limit(1);
      if (!cp) { res.status(400).json({ error: "Partner ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.periodId) {
      const [p] = await db.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable)
        .where(and(eq(accountingPeriodsTable.id, parsed.data.periodId), eq(accountingPeriodsTable.companyId, companyId))).limit(1);
      if (!p) { res.status(400).json({ error: "Obdobje ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.arApAccountId) {
      const [a] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, parsed.data.arApAccountId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!a) { res.status(400).json({ error: "Konto terjatev/obveznosti ne pripada temu podjetju" }); return; }
    }
    if (parsed.data.vatAccountId) {
      const [v] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(
          eq(accountsTable.id, parsed.data.vatAccountId),
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
        )).limit(1);
      if (!v) { res.status(400).json({ error: "DDV konto ni aktiven analitični konto, ki dovoljuje knjiženje" }); return; }
    }
    if (lines && lines.length > 0) {
      if (isAiDocumentGrossExpense(existing.sourceType)) {
        const invalidGrossExpenseLine = lines.some(line =>
          line.vatRate !== 0 || line.vatCodeId != null);
        if (invalidGrossExpenseLine) {
          res.status(400).json({
            error: "Bruto strošek iz dokumenta mora ostati brez DDV kode in z 0% DDV.",
          });
          return;
        }
      }
      const updateLineAccountIds = [...new Set(lines.map((l) => l.accountId))];
      const validAccounts = await db.select({
        id: accountsTable.id,
        type: accountsTable.type,
        isActive: accountsTable.isActive,
        allowsPosting: accountsTable.allowsPosting,
      }).from(accountsTable)
        .where(and(inArray(accountsTable.id, updateLineAccountIds), eq(accountsTable.companyId, companyId)));
      if (validAccounts.length !== updateLineAccountIds.length) {
        res.status(400).json({ error: "Eden ali več kontov vrstic ne pripada temu podjetju" });
        return;
      }
      if (isAiDocumentGrossExpense(existing.sourceType)
        && validAccounts.some(account =>
          account.type !== "expense" || !account.isActive || !account.allowsPosting,
        )) {
        res.status(400).json({
          error: "Bruto strošek iz dokumenta zahteva aktiven knjižljiv odhodkovni konto.",
        });
        return;
      }
    }

    try {
      await db.transaction(async (tx) => {
        await lockInvoiceForPosLinks(tx, id);
        const [lockedInvoice] = await tx
          .select({
            status: invoicesTable.status,
            type: invoicesTable.type,
            counterpartyId: invoicesTable.counterpartyId,
            invoiceNumber: invoicesTable.invoiceNumber,
            invoiceDate: invoicesTable.invoiceDate,
            sourceDocumentId: invoicesTable.sourceDocumentId,
          })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
          .limit(1);
        if (!lockedInvoice || lockedInvoice.status !== "draft") {
          throw new Error("INVOICE_UPDATE_LOCKED");
        }
      const updateData: Record<string, unknown> = { ...headerFields };
      if (parsed.data.destinationIban !== undefined) {
        updateData.destinationIban = parsed.data.destinationIban?.replace(/\s+/g, "").toUpperCase() || null;
      }
      if (parsed.data.destinationBic !== undefined) {
        updateData.destinationBic = parsed.data.destinationBic?.replace(/\s+/g, "").toUpperCase() || null;
      }
      if (parsed.data.paymentModel !== undefined) updateData.paymentModel = parsed.data.paymentModel?.trim() || null;
      if (parsed.data.paymentReference !== undefined) updateData.paymentReference = parsed.data.paymentReference?.trim() || null;
      if (parsed.data.paymentPurpose !== undefined) updateData.paymentPurpose = parsed.data.paymentPurpose?.trim() || null;
      if (invoiceDate) updateData.invoiceDate = (invoiceDate as unknown as Date).toISOString().slice(0, 10);
      if (dueDate !== undefined) updateData.dueDate = dueDate ? (dueDate as unknown as Date).toISOString().slice(0, 10) : null;
        let replacementSourceDocumentId: string | null = null;
        if (lockedInvoice.type === "received") {
          const effectiveCounterpartyId = parsed.data.counterpartyId ?? lockedInvoice.counterpartyId;
          const effectiveInvoiceNumber = parsed.data.invoiceNumber ?? lockedInvoice.invoiceNumber;
          const effectiveInvoiceDate = invoiceDate
            ? (invoiceDate as unknown as Date).toISOString().slice(0, 10)
            : lockedInvoice.invoiceDate;
          const identityChanged = effectiveCounterpartyId !== lockedInvoice.counterpartyId
            || normalizePurchaseDocumentNumber(effectiveInvoiceNumber)
              !== normalizePurchaseDocumentNumber(lockedInvoice.invoiceNumber);
          if (identityChanged) {
            const existingLinks = await tx.select({ id: posInvoiceLinksTable.id })
              .from(posInvoiceLinksTable)
              .where(and(
                eq(posInvoiceLinksTable.companyId, companyId),
                eq(posInvoiceLinksTable.invoiceId, id),
              ))
              .limit(1);
            if (existingLinks.length > 0) {
              throw new Error("INVOICE_IDENTITY_HAS_POS_LINKS");
            }
            replacementSourceDocumentId = await claimPurchaseSourceDocument(tx, {
              companyId,
              counterpartyId: effectiveCounterpartyId,
              kind: "invoice",
              documentNumber: effectiveInvoiceNumber,
              documentDate: effectiveInvoiceDate,
              excludeInvoiceId: id,
            });
            updateData.sourceDocumentId = replacementSourceDocumentId;
          }
        }

        if (Object.keys(updateData).length > 0) {
          const updated = await tx
            .update(invoicesTable)
            .set(updateData as any)
            .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "draft")))
            .returning({ id: invoicesTable.id });
          if (updated.length === 0) throw new Error("INVOICE_UPDATE_LOCKED");
        }
        if (replacementSourceDocumentId) {
          await tx.update(documentsTable)
            .set({ sourceDocumentId: replacementSourceDocumentId })
            .where(eq(documentsTable.linkedInvoiceId, id));
        }

        if (lines && lines.length > 0) {
        const storedFxAmountsBySequence = new Map<number, {
          vatBase: string | null;
          vatAmount: string | null;
        }>();
        if (usesAiDocumentApprovedAmounts(existing.sourceType)) {
          const existingLines = await tx
            .select({
              sequence: invoiceLinesTable.sequence,
              quantity: invoiceLinesTable.quantity,
              unitPrice: invoiceLinesTable.unitPrice,
              vatRate: invoiceLinesTable.vatRate,
              vatBase: invoiceLinesTable.vatBase,
              vatAmount: invoiceLinesTable.vatAmount,
            })
            .from(invoiceLinesTable)
            .where(eq(invoiceLinesTable.invoiceId, id));
          const existingBySequence = new Map(existingLines.map(line => [line.sequence, line]));
          lines.forEach((line, sequence) => {
            const previous = existingBySequence.get(sequence);
            storedFxAmountsBySequence.set(
              sequence,
              previous && sameInvoiceLineMoneyInputs(previous, line)
                ? { vatBase: previous.vatBase, vatAmount: previous.vatAmount }
                : calculateStoredLineAmounts(line),
            );
          });
        }
        // Zamenjaj vrstice
        await tx.delete(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, id));
        await tx.insert(invoiceLinesTable).values(
          lines.map((l, i) => ({
            invoiceId: id,
            description: l.description,
            quantity: l.quantity.toFixed(3),
            unitPrice: l.unitPrice.toFixed(4),
            vatRate: l.vatRate.toFixed(2),
            vatCodeId: l.vatCodeId ?? null,
            assetType: l.assetType ?? "NONE",
            ...(usesAiDocumentApprovedAmounts(existing.sourceType) ? storedFxAmountsBySequence.get(i) : {}),
            accountId: l.accountId,
            sequence: i,
          })),
        );
      }

        await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: id,
        action: "update",
        changedBy: authReq.clerkUserId,
        payload: null,
        });
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "INVOICE_UPDATE_LOCKED") {
        res.status(400).json({ error: "Račun je medtem poknjižen in ga ni več mogoče urejati." });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_IDENTITY_HAS_POS_LINKS") {
        res.status(409).json({
          error: "Dobavitelja ali številke računa ni mogoče spremeniti, dokler je račun povezan s POS prejemnico",
        });
        return;
      }
      if (
        (error as any)?.code === "23505"
        || (error as any)?.cause?.code === "23505"
        || (error as any)?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
      ) {
        res.status(409).json({
          error: "Prejeti račun s to dobaviteljevo številko je že zajet ali zahteva razrešitev stare identitete",
        });
        return;
      }
      throw error;
    }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/invoices/:id/post ─────────────────────────────
router.post(
  "/companies/:companyId/invoices/:id/post",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za knjiženje računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        type: invoicesTable.type,
        sourceType: invoicesTable.sourceType,
        sourcePeriod: invoicesTable.sourcePeriod,
        periodId: invoicesTable.periodId,
        arApAccountId: invoicesTable.arApAccountId,
        vatAccountId: invoicesTable.vatAccountId,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        counterpartyId: invoicesTable.counterpartyId,
        updatedAt: invoicesTable.updatedAt,
        sourceDocumentId: invoicesTable.sourceDocumentId,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.sourceType === "bookie-old") {
      res.status(409).json({ error: "Zgodovinskega računa ni mogoče ponovno knjižiti; to bi podvojilo promet v GK. Preverite povezano izvorno temeljnico." });
      return;
    }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke je mogoče knjižiti" });
      return;
    }
    if (invoice.type === "received" && !invoice.sourceDocumentId) {
      res.status(409).json({
        error: "Prejeti račun nima razrešene identitete izvorne listine",
      });
      return;
    }

    const [period] = await db
      .select({ status: accountingPeriodsTable.status, name: accountingPeriodsTable.name })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.id, invoice.periodId))
      .limit(1);

    if (period?.status === "locked") {
      res.status(400).json({ error: "Obdobje je zaklenjeno" });
      return;
    }

    const lines = await db
      .select({
        id: invoiceLinesTable.id,
        accountId: invoiceLinesTable.accountId,
        quantity: invoiceLinesTable.quantity,
        unitPrice: invoiceLinesTable.unitPrice,
        vatRate: invoiceLinesTable.vatRate,
        vatBase: invoiceLinesTable.vatBase,
        storedVatAmount: invoiceLinesTable.vatAmount,
        vatCodeId: invoiceLinesTable.vatCodeId,
        assetType: invoiceLinesTable.assetType,
        description: invoiceLinesTable.description,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, id))
      .orderBy(asc(invoiceLinesTable.sequence));

    if (lines.length === 0) {
      res.status(400).json({ error: "Račun nima vrstic" });
      return;
    }

    if (isAiDocumentGrossExpense(invoice.sourceType)) {
      const validGrossExpenseAmounts = invoice.type === "received" && lines.every(line =>
        new Decimal(line.vatRate).isZero()
        && line.vatCodeId == null
        && line.storedVatAmount != null
        && new Decimal(line.storedVatAmount).isZero(),
      );
      if (!validGrossExpenseAmounts) {
        res.status(400).json({
          error: "Bruto strošek iz dokumenta mora biti prejeti račun z ničelno stopnjo/DDV in brez DDV kode.",
        });
        return;
      }
      const grossExpenseAccounts = await db.select({
        id: accountsTable.id,
        type: accountsTable.type,
        isActive: accountsTable.isActive,
        allowsPosting: accountsTable.allowsPosting,
      })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.companyId, companyId),
          inArray(accountsTable.id, [...new Set(lines.map(line => line.accountId))]),
        ));
      const grossExpenseAccountsById = new Map(grossExpenseAccounts.map(account => [account.id, account]));
      if (lines.some(line => {
        const account = grossExpenseAccountsById.get(line.accountId);
        return !account
          || account.type !== "expense"
          || !account.isActive
          || !account.allowsPosting;
      })) {
        res.status(400).json({
          error: "Bruto strošek iz dokumenta zahteva aktiven knjižljiv odhodkovni konto.",
        });
        return;
      }
    }

    const selectedVatCodeIds = [...new Set(lines.map((line) => line.vatCodeId).filter((id): id is string => !!id))];
    const selectedVatCodes = selectedVatCodeIds.length > 0
      ? await db.select({
          companyVatCodeId: vatCodesTable.id,
          companyVatRate: vatCodesTable.rate,
          companyVatBehavior: vatCodesTable.behavior,
          id: vatCodeTable.id,
          code: vatCodeTable.code,
          description: vatCodeTable.description,
          direction: vatCodeTable.direction,
          rate: vatCodeTable.rate,
          validFrom: vatCodeTable.validFrom,
          validTo: vatCodeTable.validTo,
          isReverseCharge: vatCodeTable.isReverseCharge,
          isImport: vatCodeTable.isImport,
          kirBaseField: vatCodeTable.kirBaseField,
          kprBaseField: vatCodeTable.kprBaseField,
          kirVatField: vatCodeTable.kirVatField,
          kprVatField: vatCodeTable.kprVatField,
          triggersRpO: vatCodeTable.triggersRpO,
          rpOColumn: vatCodeTable.rpOColumn,
          triggersPdO: vatCodeTable.triggersPdO,
        })
          .from(vatCodesTable)
          .innerJoin(vatCodeTable, eq(vatCodeTable.id, vatCodesTable.fursCodeId))
          .where(and(
            eq(vatCodesTable.companyId, companyId),
            inArray(vatCodesTable.id, selectedVatCodeIds),
          ))
      : [];
    const selectedVatCodeById = new Map(selectedVatCodes.map((code) => [code.companyVatCodeId, code]));
    if (selectedVatCodeById.size !== selectedVatCodeIds.length) {
      res.status(400).json({ error: "Izbrana DDV koda ne obstaja." });
      return;
    }
    const expectedVatDirection = invoice.type === "issued" ? "OUT" : "IN";
    const wrongDirectionCode = selectedVatCodes.find(code => code.direction !== expectedVatDirection);
    if (wrongDirectionCode) {
      res.status(400).json({
        error: `DDV-koda ${wrongDirectionCode.code} (${wrongDirectionCode.id}) ima smer ${wrongDirectionCode.direction}, za ${invoice.type === "issued" ? "izdani" : "prejeti"} račun pa mora biti ${expectedVatDirection}. Preverite povezavo v Nastavitve > DDV kode.`,
      });
      return;
    }
    const euAcquisitionLines = lines.filter((line) =>
      line.vatCodeId && selectedVatCodeById.get(line.vatCodeId)?.code.startsWith("EUB"));
    if (lines.some((line) => line.assetType !== "NONE" && !line.vatCodeId)) {
      res.status(400).json({ error: "Postavka osnovnega sredstva nima potrjene DDV-kode; račun ostane osnutek." });
      return;
    }
    if (lines.some((line) => line.assetType !== "NONE" && line.vatCodeId
      && !selectedVatCodeById.get(line.vatCodeId)?.code.startsWith("EUB"))) {
      res.status(400).json({ error: "Za osnovno sredstvo iz EU izberite kodo pridobitve blaga EUB; drugih nabav OS ta tok še ne knjiži." });
      return;
    }
    if (lines.some((line) => line.vatCodeId && selectedVatCodeById.get(line.vatCodeId)?.isReverseCharge
        && !selectedVatCodeById.get(line.vatCodeId)?.code.startsWith("EUB"))) {
      res.status(400).json({ error: "Ta način knjiženja prejetega računa podpira samo pridobitev blaga iz EU; druge samoobdavčitve zahtevajo ločeno obravnavo." });
      return;
    }
    if (euAcquisitionLines.length > 0) {
      if (invoice.type !== "received" || euAcquisitionLines.length !== lines.length) {
        res.status(400).json({ error: "Pridobitve blaga iz EU in drugih vrst postavk na tem računu ni mogoče varno knjižiti skupaj." });
        return;
      }
      const [supplier] = await db.select({
        country: counterpartiesTable.country,
        countryCode: counterpartiesTable.kodaDrzave,
        vatId: counterpartiesTable.idZaDdv,
      }).from(counterpartiesTable)
        .where(and(eq(counterpartiesTable.id, invoice.counterpartyId), eq(counterpartiesTable.companyId, companyId)))
        .limit(1);
      const country = (supplier?.countryCode || supplier?.country || "").trim().toUpperCase();
      const euCountries = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "ES", "SE"]);
      if (!euCountries.has(country) || !supplier?.vatId?.trim().toUpperCase().startsWith(country)) {
        res.status(400).json({ error: "Za pridobitev OS iz EU mora imeti dobavitelj usklajeno državo EU in ID za DDV z oznako te države." });
        return;
      }
      const [payableAccount] = await db.select({ code: accountsTable.code, active: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
        .from(accountsTable).where(and(eq(accountsTable.id, invoice.arApAccountId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!payableAccount?.code.startsWith("221") || !payableAccount.active || !payableAccount.allowsPosting) {
        res.status(400).json({ error: "Za prejeti račun iz EU izberite knjižljivi konto obveznosti do dobaviteljev EU (221)." });
        return;
      }
      const assetAccounts = await db.select({ id: accountsTable.id, code: accountsTable.code, active: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
        .from(accountsTable).where(and(eq(accountsTable.companyId, companyId), inArray(accountsTable.id, lines.map((line) => line.accountId))));
      const assetAccountMap = new Map(assetAccounts.map((account) => [account.id, account]));
      for (const line of lines) {
        const code = selectedVatCodeById.get(line.vatCodeId!)!;
        const account = assetAccountMap.get(line.accountId);
        const assetPrefix = line.assetType === "REALESTATE" ? /^(02|03)/ : /^04/;
        if (line.assetType === "NONE" || !account?.active || !account.allowsPosting || !assetPrefix.test(account.code)) {
          res.status(400).json({ error: "Vsaka postavka pridobitve OS iz EU potrebuje potrjeno vrsto osnovnega sredstva in knjižljivi konto 02/03 oziroma 04." });
          return;
        }
        const companyCode = selectedVatCodeById.get(line.vatCodeId!)!;
        if (code.direction !== "IN" || !code.isReverseCharge
          || Number(code.rate) !== Number(companyCode.companyVatRate)
          || companyCode.companyVatBehavior !== documentVatBehavior(code)
          || code.validFrom > invoice.invoiceDate || (code.validTo && code.validTo < invoice.invoiceDate)) {
          res.status(400).json({ error: `DDV koda ${code.code} ni veljavna za datum ali stopnjo tega računa.` });
          return;
        }
      }
    }

    // Izračunaj zneske
    let lineCalcs: Array<(typeof lines)[number] & {
      lineTotal: number;
      vatAmt: number;
      grossTotal: number;
      vatR: number;
      isEuAcquisition: boolean;
    }> = [];
    try {
      lineCalcs = lines.map((l) => {
        const selectedVatCode = l.vatCodeId ? selectedVatCodeById.get(l.vatCodeId) : undefined;
        const isEuAcquisition = Boolean(selectedVatCode?.code.startsWith("EUB"));
        // Reverse-charge supplier documents may show 0% VAT even though the
        // FURS acquisition code specifies the domestic accounting rate.
        const vatR = isEuAcquisition && selectedVatCode
          ? Number(selectedVatCode.rate)
          : parseFloat(l.vatRate);
        const { lineTotal, vatAmt: approvedVatAmount } = invoiceLineAmounts(invoice.sourceType, l);
        // EU acquisition VAT is self-assessed at the selected FURS rate. Other
        // Approved document lines use their accountant-reviewed stored tax value.
        const vatAmt = isEuAcquisition
          ? lineTotal * vatR / 100
          : usesAiDocumentApprovedAmounts(invoice.sourceType)
            ? approvedVatAmount
            : lineTotal * vatR / 100;
        return {
          ...l,
          lineTotal,
          vatAmt,
          grossTotal: lineTotal + (isEuAcquisition ? 0 : vatAmt),
          vatR,
          isEuAcquisition,
        };
      });
    } catch (error) {
      if (!(error instanceof InvalidDocumentInvoiceAmountsError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }

    const totalGross = lineCalcs.reduce((s, l) => s + l.grossTotal, 0);
    const totalNet = lineCalcs.reduce((s, l) => s + l.lineTotal, 0);
    const isContractSummary = invoice.sourceType === "pos-contract-summary";
    let contractTransitAccountId: string | null = null;
    let contractReceiptLinks: Array<{
      id: string;
      receiptId: number;
      dailyEntryId: string;
      grossAmount: string;
    }> = [];
    if (isContractSummary) {
      const [settings] = await db
        .select({ transitAccountId: posBookingSettingsTable.contractReceivableTransitAccountId })
        .from(posBookingSettingsTable)
        .where(eq(posBookingSettingsTable.companyId, companyId))
        .limit(1);
      contractTransitAccountId = settings?.transitAccountId ?? null;
      if (!contractTransitAccountId) {
        res.status(409).json({ error: "Prehodni konto pogodbenih malic ni nastavljen." });
        return;
      }
      contractReceiptLinks = await db
        .select({
          id: posContractInvoiceReceiptsTable.id,
          receiptId: posContractInvoiceReceiptsTable.receiptId,
          dailyEntryId: posContractInvoiceReceiptsTable.dailyEntryId,
          grossAmount: posContractInvoiceReceiptsTable.grossAmount,
        })
        .from(posContractInvoiceReceiptsTable)
        .where(and(
          eq(posContractInvoiceReceiptsTable.companyId, companyId),
          eq(posContractInvoiceReceiptsTable.invoiceId, id),
        ));
      if (contractReceiptLinks.length === 0) {
        res.status(409).json({ error: "Zbirni A-račun nima povezane specifikacije dnevnih POS računov." });
        return;
      }
      const linkedGross = contractReceiptLinks.reduce(
        (sum, link) => sum.plus(link.grossAmount),
        new Decimal(0),
      );
      if (linkedGross.minus(totalGross).abs().gt("0.02")) {
        res.status(409).json({ error: "Vsota specifikacije dnevnih POS računov se ne ujema z A-računom." });
        return;
      }
      const validDailyEntries = await db
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .innerJoin(
          journalEntryLinesTable,
          eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
        )
        .where(and(
          inArray(journalEntriesTable.id, contractReceiptLinks.map((link) => link.dailyEntryId)),
          eq(journalEntriesTable.companyId, companyId),
          eq(journalEntriesTable.status, "posted"),
          eq(journalEntryLinesTable.accountId, contractTransitAccountId),
          eq(journalEntryLinesTable.side, "debit"),
        ));
      const validIds = new Set(validDailyEntries.map((entry) => entry.id));
      if (contractReceiptLinks.some((link) => !validIds.has(link.dailyEntryId))) {
        res.status(409).json({
          error: "Ena od dnevnih temeljnic ni več potrjena ali ne knjiži na prehodni konto pogodbenih malic.",
        });
        return;
      }
    }

    // Pri ločeni dobavnici je zalogovni del že knjižen na prehodni konto.
    // Pri načinu delivery_note_invoice je ista listina hkrati dobavnica in račun,
    // zato jo knjižimo neposredno kot prejeti račun brez prehodnega konta.
    const posLinks = invoice.type === "received"
      ? await getInvoicePosReceiptLinksResponse(companyId, id)
      : null;
    const hasPosLinks = Boolean(posLinks && posLinks.body.links.length > 0);
    if (isAiDocumentGrossExpense(invoice.sourceType) && hasPosLinks) {
      res.status(409).json({
        error: "Bruto strošek brez DDV trenutno ni mogoče knjižiti skupaj s POS prejemnicami.",
      });
      return;
    }
    if (hasPosLinks && euAcquisitionLines.length > 0) {
      res.status(409).json({ error: "Računa za pridobitev osnovnega sredstva iz EU ni dovoljeno povezati z zalogovno POS prejemnico." });
      return;
    }
    const isDirectDeliveryNoteInvoice = Boolean(
      hasPosLinks
      && posLinks!.body.links.every((link) => link.mode === "delivery_note_invoice"),
    );
    const linkedReceiptDate = isDirectDeliveryNoteInvoice
      ? posLinks!.body.links[0]!.receiptDate
      : null;
    const inputVatRecognitionDate = linkedReceiptDate instanceof Date
      ? linkedReceiptDate.toISOString().slice(0, 10)
      : linkedReceiptDate
        ? String(linkedReceiptDate).slice(0, 10)
        : invoice.invoiceDate;
    if (invoice.type === "received" && invoice.sourceDocumentId) {
      const sameSourcePosReceipts = await db.select({ id: prejemniceTable.id })
        .from(prejemniceTable)
        .innerJoin(enoteTable, eq(prejemniceTable.enotaId, enoteTable.id))
        .where(and(
          eq(enoteTable.companyId, companyId),
          eq(prejemniceTable.sourceDocumentId, invoice.sourceDocumentId),
        ));
      const linkedReceiptIds = new Set(posLinks?.body.links.map((link) => link.prejemnicaId) ?? []);
      const unlinkedSameSource = sameSourcePosReceipts.filter((receipt) => !linkedReceiptIds.has(receipt.id));
      if (unlinkedSameSource.length > 0) {
        res.status(409).json({
          error: "Račun ima POS prejemnico istega vira; pred knjiženjem jo eksplicitno povežite z računom",
        });
        return;
      }
    }
    let pos109AccountId: string | null = null;
    const postedReceiptFacts = new Map<number, PostedReceiptBookingFacts>();
    let posSettings: {
      inputVatAccountId: string | null;
      inputVat22AccountId: string | null;
      inputVat95AccountId: string | null;
      inputVat5AccountId: string | null;
    } | null = null;
    if (hasPosLinks && !isDirectDeliveryNoteInvoice) {
      const reasons = posLinks!.body.preview.reasons;
      if (reasons.length > 0) {
        res.status(400).json({ error: `Račun ostane osnutek: ${reasons.join(" ")}` });
        return;
      }
      const [settings] = await db
        .select({
          nabavaObracunAccountId: posBookingSettingsTable.nabavaObracunAccountId,
          inputVatAccountId: posBookingSettingsTable.inputVatAccountId,
          inputVat22AccountId: posBookingSettingsTable.inputVat22AccountId,
          inputVat95AccountId: posBookingSettingsTable.inputVat95AccountId,
          inputVat5AccountId: posBookingSettingsTable.inputVat5AccountId,
        })
        .from(posBookingSettingsTable)
        .where(eq(posBookingSettingsTable.companyId, companyId))
        .limit(1);
      if (!settings?.nabavaObracunAccountId) {
        res.status(400).json({ error: "Konto obračuna nabave 109 ni nastavljen v POS → ERP nastavitvah." });
        return;
      }
      pos109AccountId = settings.nabavaObracunAccountId;
      posSettings = settings;
      for (const link of [...posLinks!.body.links].sort((a, b) => a.prejemnicaId - b.prejemnicaId)) {
        const facts = await loadPostedReceiptBookingFacts(db, companyId, link.prejemnicaId, pos109AccountId);
        if (
          !facts
          || !new Decimal(facts.bookedNet).eq(link.netAmount)
          || (link.vatAmount != null && !new Decimal(facts.bookedVat).eq(link.vatAmount))
          || (link.grossAmount != null && !new Decimal(facts.booked109Gross).eq(link.grossAmount))
        ) {
          res.status(409).json({
            error: "Račun ostane osnutek: potrjena POS temeljnica se ne ujema več z avtoritativnimi podatki prejemnice.",
          });
          return;
        }
        postedReceiptFacts.set(link.prejemnicaId, facts);
      }
      if (postedReceiptFacts.size !== posLinks!.body.links.length) {
        res.status(400).json({
          error: "Račun ostane osnutek: vsaka povezana prejemnica mora izhajati iz potrjene POS temeljnice, ki dejansko knjiži v dobro konto 109.",
        });
        return;
      }
    }

    // Poišči DDV konto za vrstice z vatRate > 0
    const vatLines = isContractSummary
      ? []
      : lineCalcs.filter((l) => !l.isEuAcquisition && l.vatR > 0 && l.vatAmt > 0);
    const vatRates = [...new Set(vatLines.map((line) => line.vatR))];
    const vatAccountByRate = new Map<number, string>();
    for (const rate of vatRates) {
      const posAccount = rate === 22
        ? posSettings?.inputVat22AccountId
        : rate === 9.5
          ? posSettings?.inputVat95AccountId
          : rate === 5
            ? posSettings?.inputVat5AccountId
            : null;
      const resolved = posAccount
        ?? posSettings?.inputVatAccountId
        ?? await resolveVatAccount(companyId, invoice.type, invoice.vatAccountId, rate);
      if (!resolved) {
        if (hasPosLinks && !isDirectDeliveryNoteInvoice) {
          res.status(400).json({ error: `Vstopni DDV konto za stopnjo ${rate}% ni nastavljen.` });
          return;
        }
      } else {
        vatAccountByRate.set(rate, resolved);
      }
    }

    const fursVatCodeByRate = new Map<number, string>();
    if (hasPosLinks && vatRates.length > 0) {
      // vat_code je globalni, verzioniran FURS šifrant (namenoma brez company_id);
      // per-company nastavitve kontov so razrešene zgoraj prek vat_codes/POS nastavitev.
      const vatCodes = await db
        .select({ id: vatCodeTable.id, rate: vatCodeTable.rate })
        .from(vatCodeTable)
        .where(
          and(
            eq(vatCodeTable.direction, "IN"),
            lte(vatCodeTable.validFrom, inputVatRecognitionDate),
            or(isNull(vatCodeTable.validTo), gte(vatCodeTable.validTo, inputVatRecognitionDate)),
          ),
        )
        .orderBy(desc(vatCodeTable.validFrom));
      for (const code of vatCodes) {
        const rate = Number(code.rate);
        if (!fursVatCodeByRate.has(rate)) fursVatCodeByRate.set(rate, code.id);
      }
      const missingRates = vatRates.filter((rate) => !fursVatCodeByRate.has(rate));
      if (missingRates.length > 0) {
        res.status(400).json({
          error: `Za vstopni DDV manjkajo FURS DDV kode za stopnje: ${missingRates.join(", ")}%.`,
        });
        return;
      }
    }

    const [counterparty] = await db
      .select({ name: counterpartiesTable.name })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, invoice.counterpartyId))
      .limit(1);

    const entryDescription = `${invoice.type === "issued" ? "Izdani" : "Prejeti"} račun ${invoice.invoiceNumber} — ${counterparty?.name ?? ""}`;

    // Sestavi temeljnico
    // Issued: DEBIT AR (total gross), CREDIT revenue (per line), CREDIT VAT (per line)
    // Received: DEBIT expense (per line), DEBIT VAT (per line), CREDIT AP (total gross)
    const journalLines: {
      accountId: string;
      side: "debit" | "credit";
      amount: string;
      description: string | null;
      partnerId?: string | null;
      vatCodeId?: string | null;
      companyVatCodeId?: string | null;
      vatAmount?: string | null;
      assetType?: "NONE" | "OTHER_FA" | "REALESTATE";
    }[] = [];
    let posVatLedgerLines: VatLine[] | null = hasPosLinks ? [] : null;
    let posClosureSummary: {
      matchedGross: string;
      matchedNet: string;
      matchedVat: string;
      invoiceNetRemainder: string;
      invoiceVatRemainder: string;
      roundingAdjustment: string;
    } | null = null;

    if (isContractSummary) {
      journalLines.push(...buildContractSummaryPostingLines({
        invoiceNumber: invoice.invoiceNumber,
        month: invoice.sourcePeriod,
        counterpartyId: invoice.counterpartyId,
        receivableAccountId: invoice.arApAccountId,
        transitAccountId: contractTransitAccountId!,
        grossAmount: totalGross,
      }));
    } else if (invoice.type === "issued") {
      // Debet: terjatve (skupni znesek z DDV)
      journalLines.push({
        accountId: invoice.arApAccountId,
        side: "debit",
        amount: totalGross.toFixed(2),
        description: entryDescription,
      });
      // Kredit: prihodki po vrsticah
      for (const l of lineCalcs) {
        const selectedVatCode = l.vatCodeId
          ? selectedVatCodeById.get(l.vatCodeId)
          : undefined;
        journalLines.push({
          accountId: l.accountId,
          side: "credit",
          amount: l.lineTotal.toFixed(2),
          description: l.description ?? null,
          ...(usesAiDocumentApprovedAmounts(invoice.sourceType) ? {
            vatCodeId: selectedVatCode?.id ?? null,
            companyVatCodeId: selectedVatCode?.companyVatCodeId ?? null,
            vatAmount: money(l.vatAmt),
          } : {}),
        });
      }
      // Kredit: DDV po stopnjah
      for (const rate of vatRates) {
        const vatAccountId = vatAccountByRate.get(rate);
        if (!vatAccountId) continue;
        const totalVatAtRate = vatLines.filter((line) => line.vatR === rate).reduce((sum, line) => sum + line.vatAmt, 0);
        journalLines.push({
          accountId: vatAccountId,
          side: "credit",
          amount: totalVatAtRate.toFixed(2),
          description: `DDV na izhodni račun ${rate}%`,
        });
      }
    } else if (euAcquisitionLines.length > 0) {
      const reverseAccounts = await db.select({
        id: accountsTable.id, code: accountsTable.code,
      }).from(accountsTable).where(and(
        eq(accountsTable.companyId, companyId),
        eq(accountsTable.isActive, true),
        eq(accountsTable.allowsPosting, true),
        inArray(accountsTable.code, ["1604000", "2604000"]),
      ));
      const accountByCode = new Map(reverseAccounts.map((account) => [account.code, account.id]));
      const inputAccount = accountByCode.get("1604000");
      const outputAccount = accountByCode.get("2604000");
      if (!inputAccount || !outputAccount) {
        res.status(400).json({ error: "Za samoobdavčitev EU nastavite aktivna knjižljiva konta 1604000 in 2604000." });
        return;
      }
      let totalBase = new Decimal(0);
      let totalTax = new Decimal(0);
      for (const line of lineCalcs) {
        const base = new Decimal(line.lineTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const tax = base.mul(line.vatR).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        totalBase = totalBase.plus(base);
        totalTax = totalTax.plus(tax);
        journalLines.push({
          accountId: line.accountId,
          side: "debit",
          amount: money(base),
          description: line.description,
          partnerId: invoice.counterpartyId,
          vatCodeId: selectedVatCodeById.get(line.vatCodeId!)?.id,
          companyVatCodeId: line.vatCodeId,
          vatAmount: money(tax),
          assetType: line.assetType,
        });
      }
      journalLines.push(
        { accountId: inputAccount, side: "debit", amount: money(totalTax), description: "Vstopni DDV od pridobitve OS iz EU" },
        { accountId: outputAccount, side: "credit", amount: money(totalTax), description: "Obračunani DDV od pridobitve OS iz EU" },
        { accountId: invoice.arApAccountId, side: "credit", amount: money(totalBase), description: entryDescription, partnerId: invoice.counterpartyId },
      );
    } else if (isAiDocumentGrossExpense(invoice.sourceType)) {
      const grossExpenseTotal = lineCalcs.reduce(
        (sum, line) => sum.plus(new Decimal(line.lineTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
        new Decimal(0),
      ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (grossExpenseTotal.isZero()) {
        res.status(400).json({ error: "Bruto strošek brez DDV ne more imeti ničelnega skupnega zneska." });
        return;
      }
      for (const line of lineCalcs) {
        const amount = new Decimal(line.lineTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        if (amount.isZero()) continue;
        journalLines.push({
          accountId: line.accountId,
          side: amount.gt(0) ? "debit" : "credit",
          amount: money(amount.abs()),
          description: line.description ?? null,
          partnerId: invoice.counterpartyId,
        });
      }
      journalLines.push({
        accountId: invoice.arApAccountId,
        side: grossExpenseTotal.gt(0) ? "credit" : "debit",
        amount: money(grossExpenseTotal.abs()),
        description: entryDescription,
        partnerId: invoice.counterpartyId,
      });
    } else {
      const matchedBuckets = new Map<string, { net: Decimal; vat: Decimal; gross: Decimal }>();
      let matchedGross = new Decimal(0);
      for (const facts of postedReceiptFacts.values()) {
        matchedGross = matchedGross.plus(facts.booked109Gross);
        for (const bucket of facts.buckets) {
          const key = `${bucket.vatCodeId ?? "none"}:${new Decimal(bucket.rate).toString()}`;
          const current = matchedBuckets.get(key) ?? { net: new Decimal(0), vat: new Decimal(0), gross: new Decimal(0) };
          current.net = current.net.plus(bucket.net);
          current.vat = current.vat.plus(bucket.vat);
          current.gross = current.gross.plus(bucket.net).plus(bucket.vat);
          matchedBuckets.set(key, current);
        }
      }
      const invoiceBucketTotals = new Map<string, { net: Decimal; vat: Decimal }>();
      const exactInvoiceLines = lineCalcs.map(line => {
        const rate = new Decimal(line.vatRate).toString();
        const net = new Decimal(line.lineTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const vat = usesAiDocumentApprovedAmounts(invoice.sourceType)
          ? new Decimal(line.vatAmt).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : net.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const selectedVatCode = line.vatCodeId
          ? selectedVatCodeById.get(line.vatCodeId)
          : undefined;
        const vatCodeId = selectedVatCode?.id
          ?? (new Decimal(rate).eq(0) ? null : fursVatCodeByRate.get(Number(rate)) ?? null);
        const companyVatCodeId = selectedVatCode?.companyVatCodeId ?? null;
        const key = `${vatCodeId ?? "none"}:${rate}`;
        const total = invoiceBucketTotals.get(key) ?? { net: new Decimal(0), vat: new Decimal(0) };
        total.net = total.net.plus(net);
        total.vat = total.vat.plus(vat);
        invoiceBucketTotals.set(key, total);
        return { ...line, rate, net, vat, vatCodeId, companyVatCodeId, key };
      });
      for (const [key, matched] of matchedBuckets) {
        const invoiceBucket = invoiceBucketTotals.get(key);
        if (!invoiceBucket || matched.net.gt(invoiceBucket.net) || matched.vat.gt(invoiceBucket.vat)) {
          res.status(409).json({ error: "POS prejemnice se po DDV stopnji/kodi ne ujemajo z računom." });
          return;
        }
      }
      const matchedNetTotal = [...matchedBuckets.values()].reduce((sum, bucket) => sum.plus(bucket.net), new Decimal(0));
      const matchedVatTotal = [...matchedBuckets.values()].reduce((sum, bucket) => sum.plus(bucket.vat), new Decimal(0));
      if (!matchedGross.eq(matchedNetTotal.plus(matchedVatTotal))) {
        res.status(409).json({ error: "Avtoritativna POS knjižba ne uskladi bruto, neto in DDV zneskov." });
        return;
      }
      const exactInvoiceNetTotal = [...invoiceBucketTotals.values()]
        .reduce((sum, bucket) => sum.plus(bucket.net), new Decimal(0));
      const exactInvoiceVatTotal = [...invoiceBucketTotals.values()]
        .reduce((sum, bucket) => sum.plus(bucket.vat), new Decimal(0));
      posClosureSummary = {
        matchedGross: money(matchedGross),
        matchedNet: money(matchedNetTotal),
        matchedVat: money(matchedVatTotal),
        invoiceNetRemainder: money(exactInvoiceNetTotal.minus(matchedNetTotal)),
        invoiceVatRemainder: money(exactInvoiceVatTotal.minus(matchedVatTotal)),
        roundingAdjustment: "0.00",
      };
      if (matchedGross.gt(0)) {
        journalLines.push({
          accountId: pos109AccountId!,
          side: "debit",
          amount: money(matchedGross),
          description: `Zaprtje obračuna nabave 109 — ${invoice.invoiceNumber}`,
          partnerId: invoice.counterpartyId,
        });
      }
      const remainingMatchedNet = new Map(
        [...matchedBuckets].map(([key, bucket]) => [key, bucket.net]),
      );
      for (const line of exactInvoiceLines) {
        const bucketRemaining = remainingMatchedNet.get(line.key) ?? new Decimal(0);
        const transferred = Decimal.min(line.net, bucketRemaining);
        remainingMatchedNet.set(line.key, bucketRemaining.minus(transferred));
        const remainder = line.net.minus(transferred);
        if (remainder.gt(0)) {
          journalLines.push({
            accountId: line.accountId,
            side: "debit",
            amount: money(remainder),
            description: line.description ?? null,
            vatCodeId: line.vatCodeId,
            companyVatCodeId: line.companyVatCodeId,
            vatAmount: usesAiDocumentApprovedAmounts(invoice.sourceType) && !hasPosLinks
              ? money(line.vat)
              : null,
          });
        }
      }
      for (const [key, invoiceBucket] of invoiceBucketTotals) {
        const matchedBucket = matchedBuckets.get(key);
        const matchedVat = matchedBucket?.vat ?? new Decimal(0);
        const remainderVat = invoiceBucket.vat.minus(matchedVat);
        if (remainderVat.lte(0)) continue;
        const rate = key.slice(key.lastIndexOf(":") + 1);
        const vatCodeId = key.split(":")[0] === "none" ? null : key.split(":")[0];
        const vatAccountId = vatAccountByRate.get(Number(rate));
        if (!vatAccountId) continue;
        journalLines.push({
          accountId: vatAccountId,
          side: "debit",
          amount: money(remainderVat),
          description: `Vstopni DDV ${rate}%`,
        });
        if (posVatLedgerLines && vatCodeId) {
          posVatLedgerLines.push({
            lineId: `invoice-${id}-vat-bucket-${posVatLedgerLines.length}`,
            vatCodeId,
            amount: money(invoiceBucket.net.minus(matchedBucket?.net ?? 0)),
            vatAmount: money(remainderVat),
            vatDeductionPercent: "100.00",
            partnerId: invoice.counterpartyId,
            description: `Vstopni DDV ${rate}%`,
          });
        } else if (!posVatLedgerLines && !usesAiDocumentApprovedAmounts(invoice.sourceType)) {
          const expenseLine = journalLines.find(line =>
            line.side === "debit" && line.vatCodeId === vatCodeId);
          if (expenseLine) expenseLine.vatAmount = money(remainderVat);
        }
      }
      // Kredit: obveznosti (skupni znesek z DDV)
      journalLines.push({
        accountId: invoice.arApAccountId,
        side: "credit",
        amount: exactInvoiceLines
          .reduce((sum, line) => sum.plus(line.net).plus(line.vat), new Decimal(0))
          .toFixed(2),
        description: entryDescription,
        partnerId: invoice.counterpartyId,
      });
    }

    if (isAiDocumentGrossExpense(invoice.sourceType)) {
      const journalTotals = journalLines.reduce((totals, line) => {
        totals[line.side] = totals[line.side].plus(line.amount);
        return totals;
      }, { debit: new Decimal(0), credit: new Decimal(0) });
      if (!journalTotals.debit.eq(journalTotals.credit)) {
        res.status(409).json({
          error: "Bruto strošek brez DDV ni uravnotežen; račun ostane osnutek.",
        });
        return;
      }
    }

    // Vstavi v DB (transakcija). Status prevzamemo atomarno, zato dve sočasni
    // zahtevi ne moreta ustvariti dveh temeljnic ali dveh KPR vpisov.
    try {
      await db.transaction(async (tx) => {
        for (const link of [...(posLinks?.body.links ?? [])].sort((a, b) => a.prejemnicaId - b.prejemnicaId)) {
          await lockPosReceiptForReconciliation(tx, companyId, link.enotaId, link.prejemnicaId);
        }
        await lockInvoiceForPosLinks(tx, id);
        if (invoice.sourceDocumentId) {
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(hashtext(${invoice.sourceDocumentId}))
          `);
        }
        const [currentInvoice] = await tx
          .select({ status: invoicesTable.status, updatedAt: invoicesTable.updatedAt })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
          .limit(1);
        if (!currentInvoice || currentInvoice.status !== "draft" || currentInvoice.updatedAt.getTime() !== invoice.updatedAt.getTime()) {
          throw new Error("INVOICE_CHANGED_DURING_POST");
        }
        const currentLinks = await tx
          .select({
            id: posInvoiceLinksTable.id,
            prejemnicaId: posInvoiceLinksTable.prejemnicaId,
            enotaId: posInvoiceLinksTable.enotaId,
            receiptNet: prejemniceTable.skupajVrednost,
            receiptVat: prejemniceTable.ddvZnesek,
            receiptGross: prejemniceTable.brutoSkupaj,
          })
          .from(posInvoiceLinksTable)
          .innerJoin(prejemniceTable, eq(prejemniceTable.id, posInvoiceLinksTable.prejemnicaId))
          .where(and(eq(posInvoiceLinksTable.companyId, companyId), eq(posInvoiceLinksTable.invoiceId, id)));
        const currentLinkIds = currentLinks.map((link) => link.id).sort().join(",");
        const previewLinkIds = posLinks?.body.links.map((link) => link.id).sort().join(",") ?? "";
        if (currentLinkIds !== previewLinkIds) throw new Error("INVOICE_POS_LINKS_CHANGED");
        if (!isDirectDeliveryNoteInvoice) {
          for (const link of [...currentLinks].sort((a, b) => a.prejemnicaId - b.prejemnicaId)) {
            const currentFacts = await loadPostedReceiptBookingFacts(tx, companyId, link.prejemnicaId, pos109AccountId!);
            const previewFacts = postedReceiptFacts.get(link.prejemnicaId);
            if (
              !currentFacts
              || !previewFacts
              || JSON.stringify(currentFacts) !== JSON.stringify(previewFacts)
              || !new Decimal(currentFacts.bookedNet).eq(link.receiptNet)
              || (link.receiptVat != null && !new Decimal(currentFacts.bookedVat).eq(link.receiptVat))
              || (link.receiptGross != null && !new Decimal(currentFacts.booked109Gross).eq(link.receiptGross))
            ) {
              throw new Error("INVOICE_POS_FACTS_CHANGED");
            }
          }
        }
        if (invoice.sourceDocumentId) {
          const sameSourcePosReceipts = await tx.select({ id: prejemniceTable.id })
            .from(prejemniceTable)
            .innerJoin(enoteTable, eq(prejemniceTable.enotaId, enoteTable.id))
            .where(and(
              eq(enoteTable.companyId, companyId),
              eq(prejemniceTable.sourceDocumentId, invoice.sourceDocumentId),
            ));
          const linkedReceiptIds = new Set(currentLinks.map((link) => link.prejemnicaId));
          if (sameSourcePosReceipts.some((receipt) => !linkedReceiptIds.has(receipt.id))) {
            throw new Error("INVOICE_SOURCE_POS_RECEIPT_UNLINKED");
          }
          const sameSourceGoodsReceipt = await tx.select({ id: goodsReceiptsTable.id })
            .from(goodsReceiptsTable)
            .where(eq(goodsReceiptsTable.sourceDocumentId, invoice.sourceDocumentId))
            .limit(1);
          if (sameSourceGoodsReceipt.length > 0) {
            throw new Error("INVOICE_SOURCE_GOODS_RECEIPT_UNMATCHED");
          }
        }
        const [claimedInvoice] = await tx
          .update(invoicesTable)
          .set({ status: "posted" })
          .where(
            and(
              eq(invoicesTable.id, id),
              eq(invoicesTable.companyId, companyId),
              eq(invoicesTable.status, "draft"),
            ),
          )
          .returning({ id: invoicesTable.id });
        if (!claimedInvoice) throw new Error("INVOICE_POST_ALREADY_CLAIMED");

        const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId: invoice.periodId,
          documentDate: invoice.invoiceDate,
          entryDate: invoice.invoiceDate,
          taxDate: invoice.invoiceDate,
          receiptDate: inputVatRecognitionDate,
          description: entryDescription,
          reference: invoice.invoiceNumber,
          status: "posted",
          postedAt: new Date(),
          sourceType: "document",
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: journalEntriesTable.id });

        await tx.insert(journalEntryLinesTable).values(
        journalLines.map((l, i) => ({
          entryId: entry.id,
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          description: l.description,
          sequence: i,
          partnerId: l.partnerId ?? null,
          vatCodeId: l.vatCodeId ?? null,
          companyVatCodeId: l.companyVatCodeId ?? null,
          vatAmount: l.vatAmount ?? null,
        })),
      );

        const vatLedgerLines: VatLine[] = posVatLedgerLines ?? journalLines
          .filter((line) => line.vatCodeId != null)
          .map((line, index) => ({
            lineId: `invoice-${id}-line-${index}`,
            vatCodeId: line.vatCodeId!,
            amount: line.amount,
            vatAmount: line.vatAmount ?? null,
            vatDeductionPercent: "100.00",
            partnerId: invoice.counterpartyId,
            description: line.description,
             assetType: line.assetType,
          }));
        if (vatLedgerLines.length > 0) {
        const entryMeta: EntryMeta = {
          id: entry.id,
          companyId,
          documentDate: invoice.invoiceDate,
          entryDate: invoice.invoiceDate,
          taxDate: invoice.invoiceDate,
          receiptDate: inputVatRecognitionDate,
          reference: invoice.invoiceNumber,
          sourceType: "document",
        };
           await createVatLedgerEntries(tx, entryMeta, vatLedgerLines, authReq.clerkUserId, id);
        }

        await tx
          .update(invoicesTable)
          .set({ linkedEntryId: entry.id })
          .where(eq(invoicesTable.id, id));

        await tx.insert(auditLogTable).values({
        companyId,
        entityType: "invoice",
        entityId: id,
        action: "post",
        changedBy: authReq.clerkUserId,
        payload: { linkedEntryId: entry.id },
        });
        if (hasPosLinks && !isDirectDeliveryNoteInvoice) {
          await tx.insert(auditLogTable).values(
            currentLinks.map(link => {
              const facts = postedReceiptFacts.get(link.prejemnicaId)!;
              const linkMeta = posLinks!.body.links.find(item => item.prejemnicaId === link.prejemnicaId)!;
              return {
                companyId,
                entityType: "invoice",
                entityId: id,
                action: "close_pos_109",
                changedBy: authReq.clerkUserId,
                payload: {
                  status: "closed109",
                  linkId: link.id,
                  prejemnicaId: link.prejemnicaId,
                  enotaId: link.enotaId,
                  mode: linkMeta.mode,
                  matchMethod: linkMeta.matchMethod,
                  sourceEntryId: facts.sourceEntryId,
                  booked109Gross: facts.booked109Gross,
                  bookedNet: facts.bookedNet,
                  bookedVat: facts.bookedVat,
                  buckets: facts.buckets,
                  invoiceEntryId: entry.id,
                  invoiceNetAmount: money(totalNet),
                  invoiceGrossAmount: money(totalGross),
                  invoiceRemainder: posClosureSummary,
                  actor: authReq.clerkUserId,
                },
              };
            }),
          );
        }
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "INVOICE_CHANGED_DURING_POST") {
        res.status(409).json({ error: "Račun se je med pripravo spremenil; osvežite ga in ponovno potrdite knjiženje." });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_POS_LINKS_CHANGED") {
        res.status(409).json({ error: "Povezane prejemnice so se med pripravo spremenile; osvežite račun in ponovno potrdite knjiženje." });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_POS_FACTS_CHANGED") {
        res.status(409).json({ error: "POS knjižbe so se med pripravo spremenile; osvežite račun in poskusite znova." });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_SOURCE_POS_RECEIPT_UNLINKED") {
        res.status(409).json({
          error: "Račun ima POS prejemnico istega vira; pred knjiženjem jo eksplicitno povežite z računom",
        });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_SOURCE_GOODS_RECEIPT_UNMATCHED") {
        res.status(409).json({
          error: "Račun ima ERP prejemnico istega vira; poknjižite ga prek ujemanja prejemnice",
        });
        return;
      }
      if (error instanceof Error && error.message === "INVOICE_POST_ALREADY_CLAIMED") {
        res.status(400).json({ error: "Račun je bil medtem že poknjižen; osvežite seznam računov." });
        return;
      }
      throw error;
    }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/invoices/:id/void ─────────────────────────────
router.post(
  "/companies/:companyId/invoices/:id/void",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za razveljavitev računov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = VoidInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        status: invoicesTable.status,
        periodId: invoicesTable.periodId,
        linkedEntryId: invoicesTable.linkedEntryId,
        invoiceNumber: invoicesTable.invoiceNumber,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .limit(1);

    if (!invoice) { res.status(404).json({ error: "Račun ni najden" }); return; }
    if (invoice.status !== "posted") {
      res.status(400).json({ error: "Samo knjižene račune je mogoče razveljaviti" });
      return;
    }
    const [matchedGoodsReceipt] = await db.select({ id: goodsReceiptsTable.id })
      .from(goodsReceiptsTable)
      .where(and(
        eq(goodsReceiptsTable.companyId, companyId),
        eq(goodsReceiptsTable.matchedInvoiceId, id),
        eq(goodsReceiptsTable.status, "matched"),
      ))
      .limit(1);
    if (matchedGoodsReceipt) {
      res.status(409).json({
        error: "Račun je povezan z ERP prejemnico; pred razveljavitvijo najprej razvežite ujemanje",
      });
      return;
    }

    const targetPeriodId = parsed.data.periodId ?? invoice.periodId;
    const [targetPeriod] = await db
      .select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, targetPeriodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);

    if (targetPeriod?.status === "locked") {
      res.status(400).json({ error: "Ciljno obdobje je zaklenjeno" });
      return;
    }

    // Storniraj temeljnico (če obstaja)
    if (invoice.linkedEntryId) {
      const [origEntry] = await db
        .select({ id: journalEntriesTable.id, status: journalEntriesTable.status })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, invoice.linkedEntryId))
        .limit(1);

      if (origEntry && origEntry.status === "posted") {
        const origLines = await db
          .select({
            accountId: journalEntryLinesTable.accountId,
            side: journalEntryLinesTable.side,
            amount: journalEntryLinesTable.amount,
            description: journalEntryLinesTable.description,
            sequence: journalEntryLinesTable.sequence,
          })
          .from(journalEntryLinesTable)
          .where(eq(journalEntryLinesTable.entryId, invoice.linkedEntryId))
          .orderBy(asc(journalEntryLinesTable.sequence));

        try {
          await db.transaction(async (tx) => {
          await lockInvoiceForPosLinks(tx, id);
          const linkedReceipt = await tx.execute(sql`
            SELECT id FROM goods_receipts
             WHERE company_id = ${companyId}
               AND matched_invoice_id = ${id}
               AND status = 'matched'
             FOR UPDATE
          `);
          if (linkedReceipt.rows.length > 0) {
            throw new Error("INVOICE_HAS_MATCHED_GOODS_RECEIPT");
          }
          const [reversalEntry] = await tx
            .insert(journalEntriesTable)
            .values({
              companyId,
              periodId: targetPeriodId,
              entryDate: new Date().toISOString().slice(0, 10),
              description: `STORNO računa ${invoice.invoiceNumber}`,
              reference: invoice.invoiceNumber,
              status: "posted",
              reversalOf: invoice.linkedEntryId!,
              createdBy: authReq.clerkUserId,
            })
            .returning({ id: journalEntriesTable.id });

          await tx.insert(journalEntryLinesTable).values(
            origLines.map((l) => ({
              entryId: reversalEntry.id,
              accountId: l.accountId,
              side: l.side === "debit" ? ("credit" as const) : ("debit" as const),
              amount: l.amount,
              description: l.description,
              sequence: l.sequence,
            })),
          );

          await tx
            .update(journalEntriesTable)
            .set({ status: "reversed" })
            .where(eq(journalEntriesTable.id, invoice.linkedEntryId!));

          await tx.update(invoicesTable).set({ status: "void" }).where(eq(invoicesTable.id, id));

          await tx.insert(auditLogTable).values({
            companyId,
            entityType: "invoice",
            entityId: id,
            action: "void",
            changedBy: authReq.clerkUserId,
            payload: { reversalEntryId: reversalEntry.id, reason: parsed.data.reason },
          });
          });
        } catch (error) {
          if (error instanceof Error && error.message === "INVOICE_HAS_MATCHED_GOODS_RECEIPT") {
            res.status(409).json({
              error: "Račun je povezan z ERP prejemnico; pred razveljavitvijo najprej razvežite ujemanje",
            });
            return;
          }
          throw error;
        }
      }
    } else {
      // Brez temeljnice — samo razveljavimo račun
      await db.transaction(async (tx) => {
        await tx.update(invoicesTable).set({ status: "void" }).where(eq(invoicesTable.id, id));
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "invoice",
          entityId: id,
          action: "void",
          changedBy: authReq.clerkUserId,
          payload: { reason: parsed.data.reason },
        });
      });
    }

    const result = await fetchInvoiceWithLines(id);
    res.json(result);
  },
);

export default router;
