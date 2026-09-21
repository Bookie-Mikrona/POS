import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import JSZip from "jszip";
import {
  accountingRolesTable, accountsTable, companiesTable, counterpartiesTable, costCentersTable,
  db, journalEntriesTable, journalEntryLinesTable, posUporabnikiTable, vatCodeTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import {
  genericCsvAdapter, genericXmlAdapter, journalBalance, type ExternalJournal, type ExternalJournalLine,
} from "../lib/external-export-adapters";
import { generateJournalExportPdf, generateReceivedInvoicePdf } from "../lib/external-export-pdf";
import { isExternalExportAccessAllowed } from "../lib/external-export-access";
import { buildReceivedInvoicePackage } from "../lib/document-export-package";
import {
  generirajPrejetiEracunXml, validateReceivedInvoiceForEslog,
} from "../lib/received-invoice-eslog";
import { loadReceivedInvoice } from "../lib/received-invoice-loader";

const router: IRouter = Router();

function param(raw: string | string[]): string { return Array.isArray(raw) ? raw[0] : raw; }
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, "_"); }

/** Enak company-scope dostop kot POS nastavitve; GLK modul ni pogoj. */
async function canExport(clerkUserId: string, companyId: string, res: Response): Promise<boolean> {
  const [[accountingRole], [posRole]] = await Promise.all([
    db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId))).limit(1),
    db.select({ role: posUporabnikiTable.vloga }).from(posUporabnikiTable)
      .where(and(eq(posUporabnikiTable.clerkUserId, clerkUserId), eq(posUporabnikiTable.companyId, companyId), eq(posUporabnikiTable.aktiven, true))).limit(1),
  ]);
  if (isExternalExportAccessAllowed(accountingRole?.role, posRole?.role)) return true;
  res.status(403).json({ error: "Za izvoz je potreben POS administrator, lastnik ali računovodja podjetja" });
  return false;
}

async function loadEntry(companyId: string, entryId: string): Promise<ExternalJournal | null> {
  const [header] = await db.select({
    id: journalEntriesTable.id, companyName: companiesTable.naziv, documentDate: journalEntriesTable.documentDate,
    entryDate: journalEntriesTable.entryDate, reference: journalEntriesTable.reference,
    description: journalEntriesTable.description, status: journalEntriesTable.status,
  }).from(journalEntriesTable).innerJoin(companiesTable, eq(companiesTable.id, journalEntriesTable.companyId))
    .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.id, entryId))).limit(1);
  if (!header) return null;
  const rawLines = await db.select({
    accountCode: accountsTable.code, accountName: accountsTable.name, side: journalEntryLinesTable.side,
    amount: journalEntryLinesTable.amount, description: journalEntryLinesTable.description,
    partnerId: counterpartiesTable.id, partner: counterpartiesTable.name,
    partnerTaxId: counterpartiesTable.taxId, partnerVatId: counterpartiesTable.idZaDdv,
    partnerRegistrationNumber: counterpartiesTable.registrationNumber,
    partnerAddress: counterpartiesTable.address, partnerPostCode: counterpartiesTable.postCode,
    partnerCity: counterpartiesTable.city, partnerCountry: counterpartiesTable.country,
    costCenter: costCentersTable.name, vatCode: vatCodeTable.code,
    vatRate: vatCodeTable.rate, vatAmount: journalEntryLinesTable.vatAmount,
  }).from(journalEntryLinesTable).innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, journalEntryLinesTable.partnerId))
    .leftJoin(costCentersTable, eq(costCentersTable.id, journalEntryLinesTable.costCenterId))
    .leftJoin(vatCodeTable, eq(vatCodeTable.id, journalEntryLinesTable.vatCodeId))
    .where(eq(journalEntryLinesTable.entryId, entryId)).orderBy(asc(journalEntryLinesTable.sequence));
  const lines: ExternalJournalLine[] = rawLines.map((line) => ({
    accountCode: line.accountCode, accountName: line.accountName,
    debit: line.side === "debit" ? new Decimal(line.amount).toFixed(2) : "0.00",
    credit: line.side === "credit" ? new Decimal(line.amount).toFixed(2) : "0.00",
    partner: line.partner,
    partnerId: line.partnerId,
    partnerTaxId: line.partnerTaxId,
    partnerVatId: line.partnerVatId,
    partnerRegistrationNumber: line.partnerRegistrationNumber,
    partnerAddress: [line.partnerAddress, [line.partnerPostCode, line.partnerCity].filter(Boolean).join(" "), line.partnerCountry]
      .filter(Boolean).join(", ") || null,
    costCenter: line.costCenter, vatCode: line.vatCode,
    vatRate: line.vatRate === null ? null : new Decimal(line.vatRate).toFixed(2),
    vatAmount: new Decimal(line.vatAmount ?? "0").toFixed(2), date: header.entryDate,
    reference: header.reference, description: line.description ?? header.description,
  }));
  return { ...header, lines };
}

function balanceError(entries: ExternalJournal[]): string | null {
  for (const entry of entries) {
    const totals = journalBalance([entry]);
    if (!totals.balanced) return `Temeljnica ${entry.reference ?? entry.id} ni uravnotežena: debet ${totals.debit} ≠ kredit ${totals.credit}`;
  }
  return null;
}

async function deliver(entries: ExternalJournal[], format: string, baseName: string, res: Response): Promise<void> {
  const invalid = balanceError(entries);
  if (invalid) { res.status(422).json({ error: invalid, code: "ENTRY_NOT_BALANCED" }); return; }
  if (format === "csv") {
    res.type("text/csv; charset=utf-8").attachment(`${safeName(baseName)}.csv`).send(genericCsvAdapter.serialize(entries)); return;
  }
  if (format === "xml") {
    res.type("application/xml; charset=utf-8").attachment(`${safeName(baseName)}.xml`).send(genericXmlAdapter.serialize(entries)); return;
  }
  const pdf = await generateJournalExportPdf(entries);
  if (format === "pdf") {
    res.type("application/pdf").attachment(`${safeName(baseName)}.pdf`).send(pdf); return;
  }
  if (format === "zip") {
    const zip = new JSZip();
    zip.file(`${safeName(baseName)}.csv`, genericCsvAdapter.serialize(entries));
    zip.file(`${safeName(baseName)}.xml`, genericXmlAdapter.serialize(entries));
    zip.file(`${safeName(baseName)}.pdf`, pdf);
    zip.file("README.txt", "BOOKIE izvozni paket. CSV uporablja UTF-8 in podpičje; XML je kanonični BOOKIE XML v1.");
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.type("application/zip").attachment(`${safeName(baseName)}.zip`).send(buffer); return;
  }
  res.status(400).json({ error: "Format mora biti csv, xml, pdf ali zip" });
}

router.get("/companies/:companyId/external-exports/entries/:entryId/:format", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthenticatedRequest;
  const companyId = param(req.params.companyId);
  if (!(await canExport(auth.clerkUserId, companyId, res))) return;
  const entry = await loadEntry(companyId, param(req.params.entryId));
  if (!entry) { res.status(404).json({ error: "Temeljnica ni najdena" }); return; }
  await deliver([entry], param(req.params.format).toLowerCase(), entry.reference ?? `temeljnica-${entry.id}`, res);
});

router.get("/companies/:companyId/external-exports/period/:from/:to/:format", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthenticatedRequest;
  const companyId = param(req.params.companyId);
  const from = param(req.params.from);
  const to = param(req.params.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    res.status(400).json({ error: "Obdobje mora biti v obliki YYYY-MM-DD in od ≤ do" }); return;
  }
  if (!(await canExport(auth.clerkUserId, companyId, res))) return;
  const headers = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.companyId, companyId), gte(journalEntriesTable.entryDate, from), lte(journalEntriesTable.entryDate, to)))
    .orderBy(asc(journalEntriesTable.entryDate), asc(journalEntriesTable.createdAt));
  if (headers.length === 0) { res.status(404).json({ error: "V izbranem obdobju ni temeljnic" }); return; }
  const entries = (await Promise.all(headers.map(({ id }) => loadEntry(companyId, id)))).filter((entry): entry is ExternalJournal => entry !== null);
  await deliver(entries, param(req.params.format).toLowerCase(), `bookie-temeljnice-${from}-${to}`, res);
});

router.get("/companies/:companyId/external-exports/receipts/:receiptId/eracun-paket.zip", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthenticatedRequest;
  const companyId = param(req.params.companyId);
  const receiptId = Number(param(req.params.receiptId));
  if (!Number.isInteger(receiptId) || receiptId <= 0) { res.status(400).json({ error: "Neveljaven ID prejemnice" }); return; }
  if (!(await canExport(auth.clerkUserId, companyId, res))) return;
  const loaded = await loadReceivedInvoice(companyId, receiptId);
  if (!loaded) { res.status(404).json({ error: "Prejemnica ni najdena v podjetju" }); return; }
  const validation = validateReceivedInvoiceForEslog(loaded.data);
  let xml: string | undefined;
  let pdf: Buffer | undefined;
  if (validation.valid) {
    xml = generirajPrejetiEracunXml(loaded.data);
    pdf = await generateReceivedInvoicePdf({
      supplierName: loaded.data.header.supplier.name!,
      customerName: loaded.data.header.customer.name!,
      invoiceNumber: loaded.data.header.documentNumber!,
      invoiceDate: loaded.data.header.documentDate!,
      dueDate: loaded.data.header.dueDate,
      currency: loaded.data.header.currency ?? "EUR",
      netTotal: loaded.data.header.netTotal!,
      vatTotal: loaded.data.header.vatTotal!,
      grossTotal: loaded.data.header.grossTotal!,
      items: loaded.data.lines.map((line) => ({
        name: line.name!, quantity: line.quantity!, unitPrice: line.netUnitPrice!,
        total: line.netAmount!, vatRate: line.vatRate!,
      })),
    });
  }
  const invoiceNumber = loaded.data.header.documentNumber ?? `prejemnica-${receiptId}`;
  const zip = await buildReceivedInvoicePackage({
    invoiceNumber, xml, pdf, original: loaded.source,
    warnings: [...validation.errors, ...validation.warnings],
  });
  res.type("application/zip").attachment(`${safeName(`prejeti-racun-${invoiceNumber}`)}.zip`).send(zip);
});

export default router;