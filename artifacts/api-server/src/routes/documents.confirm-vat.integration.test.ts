import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER = "documents-confirm-vat-test-user";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_USER;
    next();
  },
}));

import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  counterpartyAccountTemplatesTable,
  db,
  documentsTable,
  invoiceLinesTable,
  invoicesTable,
  pool,
  purchaseSourceDocumentsTable,
  vatCodeTable,
  vatCodesTable,
} from "@workspace/db";
import { GetDocumentResponse } from "@workspace/api-zod";
import documentsRouter from "./documents";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(documentsRouter);
  instance.use((error: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: error.message });
  });
  return instance;
}

const runId = Math.random().toString(36).slice(2, 9);
let companyId: string;
let periodId: string;
let counterpartyId: string;
let supplierCounterpartyId: string;
let revenueAccountId: string;
let receivableAccountId: string;
let expenseAccountId: string;
let payableAccountId: string;
let globalS22Id: string;
let globalS95Id: string;
let globalS5Id: string;
let companyS22Id: string;
let companyS95Id: string;

async function createDocument(fileName: string, globalVatCodeId: string, vatRate: number) {
  const [document] = await db.insert(documentsTable).values({
    companyId,
    fileName,
    mimeType: "application/pdf",
    objectPath: `/objects/tests/${runId}/${fileName}`,
    status: "done",
    documentType: "invoice_issued",
    ocrResult: {
      rawText: "",
      confidence: 1,
      invoiceNumber: `OCR-${runId}-${fileName}`,
      invoiceDate: "2026-01-10",
      currency: "EUR",
      suggestedDocumentType: "invoice_issued",
      lines: [{
        description: "Issued service",
        quantity: 1,
        unitPrice: 10,
        vatRate,
        vatBase: 10,
        vatAmount: 10 * vatRate / 100,
        accountId: revenueAccountId,
        vatCodeId: globalVatCodeId,
        confidence: 1,
      }],
    },
  }).returning({ id: documentsTable.id });
  return document.id;
}

const currentInvoiceDate = () => new Date().toISOString().slice(0, 10);

async function createUsdDocument(fileName: string) {
  const invoiceDate = currentInvoiceDate();
  const [document] = await db.insert(documentsTable).values({
    companyId,
    fileName,
    mimeType: "application/pdf",
    objectPath: `/objects/tests/${runId}/${fileName}`,
    status: "done",
    documentType: "invoice_issued",
    ocrResult: {
      rawText: "source OCR must stay USD",
      confidence: 1,
      invoiceNumber: `OCR-${runId}-${fileName}`,
      invoiceDate,
      totalNet: 125,
      totalVat: 27.5,
      totalGross: 152.5,
      currency: "USD",
      suggestedDocumentType: "invoice_issued",
      lines: [{
        description: "USD service",
        quantity: 1,
        unitPrice: 125,
        vatRate: 22,
        vatBase: 125,
        vatAmount: 27.5,
        accountId: revenueAccountId,
        vatCodeId: globalS22Id,
        confidence: 1,
      }],
    },
  }).returning({ id: documentsTable.id });
  return { id: document.id, invoiceDate };
}

async function createGrossSourceDocument(
  fileName: string,
  currency: "EUR" | "USD",
  amounts = { net: 20, vat: 4.4, gross: 24.4 },
  sourceLines?: Array<{
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatBase: number;
    vatAmount: number;
  }>,
) {
  const invoiceDate = currentInvoiceDate();
  const [document] = await db.insert(documentsTable).values({
    companyId,
    fileName,
    mimeType: "application/pdf",
    objectPath: `/objects/tests/${runId}/${fileName}`,
    status: "done",
    documentType: "invoice_received",
    ocrResult: {
      rawText: "Reviewed supplier invoice source values must remain immutable",
      confidence: 1,
      invoiceNumber: `OCR-${runId}-${fileName}`,
      invoiceDate,
      totalNet: amounts.net,
      totalVat: amounts.vat,
      totalGross: amounts.gross,
      currency,
      suggestedDocumentType: "invoice_received",
      lines: (sourceLines ?? [{
        quantity: 1,
        unitPrice: amounts.net,
        vatRate: 22,
        vatBase: amounts.net,
        vatAmount: amounts.vat,
      }]).map((line, index) => ({
        description: line.vatBase < 0 ? "Supplier credit" : `Third-country service cost ${index + 1}`,
        ...line,
        accountId: expenseAccountId,
        // Gross treatment must not book this OCR tax proposal as input VAT.
        vatCodeId: globalS22Id,
        confidence: 1,
      })),
    },
  }).returning({ id: documentsTable.id });
  return { id: document.id, invoiceDate };
}

function confirmDraft(
  documentId: string,
  vatRate: number,
  selection?: { vatCodeId: string | null },
) {
  const line: Record<string, unknown> = {
    description: "Issued service",
    quantity: 1,
    unitPrice: 10,
    vatRate,
    vatBase: 10,
    vatAmount: 10 * vatRate / 100,
    accountId: revenueAccountId,
      confidence: 1,
  };
  if (selection) line.vatCodeId = selection.vatCodeId;
  return request(app())
    .post(`/companies/${companyId}/documents/${documentId}/confirm`)
    .send({
      documentType: "invoice_issued",
      counterpartyId,
      periodId,
      invoiceNumber: `ISSUED-${runId}-${documentId}`,
      invoiceDate: "2026-01-10",
      createInvoice: true,
      arApAccountId: receivableAccountId,
      lines: [line],
    });
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI-DOC-VAT-${runId}`,
    naziv: `Document VAT mapping test ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(accountingRolesTable).values({
    companyId,
    clerkUserId: TEST_USER,
    role: "owner",
  });

  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: `VAT mapping ${runId}`,
    startDate: "2000-01-01",
    endDate: "2099-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  const [counterparty] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "customer",
    name: `VAT mapping customer ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  counterpartyId = counterparty.id;
  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "supplier",
    name: `Gross expense supplier ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  supplierCounterpartyId = supplier.id;

  const [revenue] = await db.insert(accountsTable).values({
    companyId,
    code: "7600000",
    name: "Test revenue",
    type: "revenue",
    isActive: true,
    allowsPosting: true,
  }).returning({ id: accountsTable.id });
  revenueAccountId = revenue.id;
  const [receivable] = await db.insert(accountsTable).values({
    companyId,
    code: "1200000",
    name: "Test receivable",
    type: "asset",
    isActive: true,
    allowsPosting: true,
  }).returning({ id: accountsTable.id });
  receivableAccountId = receivable.id;
  const [expense] = await db.insert(accountsTable).values({
    companyId,
    code: "4000000",
    name: "Test expense",
    type: "expense",
    isActive: true,
    allowsPosting: true,
  }).returning({ id: accountsTable.id });
  expenseAccountId = expense.id;
  const [payable] = await db.insert(accountsTable).values({
    companyId,
    code: "2200000",
    name: "Test payable",
    type: "liability",
    isActive: true,
    allowsPosting: true,
  }).returning({ id: accountsTable.id });
  payableAccountId = payable.id;

  const [s22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S22"), eq(vatCodeTable.direction, "OUT")))
    .limit(1);
  const [s95] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S95"), eq(vatCodeTable.direction, "OUT")))
    .limit(1);
  const [s5] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S5"), eq(vatCodeTable.direction, "OUT")))
    .limit(1);
  if (!s22 || !s95 || !s5) throw new Error("Required seeded FURS S22/S95/S5 codes are missing");
  globalS22Id = s22.id;
  globalS95Id = s95.id;
  globalS5Id = s5.id;

  const [companyS22] = await db.insert(vatCodesTable).values({
    companyId,
    code: `TENANT-S22-${runId}`,
    name: "Test tenant S22",
    rate: "22.00",
    behavior: "standard",
    fursCodeId: globalS22Id,
    validFrom: "2025-07-01",
    isActive: true,
  }).returning({ id: vatCodesTable.id });
  companyS22Id = companyS22.id;
  if (companyS22Id === globalS22Id) {
    throw new Error("Company VAT fixture must have an ID distinct from its FURS code");
  }
  const [companyS95] = await db.insert(vatCodesTable).values({
    companyId,
    code: `TENANT-S95-${runId}`,
    name: "Test tenant S95",
    rate: "9.50",
    behavior: "standard",
    fursCodeId: globalS95Id,
    validFrom: "2025-07-01",
    isActive: true,
  }).returning({ id: vatCodesTable.id });
  companyS95Id = companyS95.id;
});

afterAll(async () => {
  if (!companyId) return;
  await db.delete(documentsTable).where(eq(documentsTable.companyId, companyId));
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db.delete(purchaseSourceDocumentsTable)
    .where(eq(purchaseSourceDocumentsTable.companyId, companyId));
  await db.delete(counterpartyAccountTemplatesTable).where(eq(counterpartyAccountTemplatesTable.companyId, companyId));
  await db.delete(vatCodesTable).where(eq(vatCodesTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe.sequential("document confirmation FURS VAT ID mapping", () => {
  it("persists the tenant VAT ID in the draft while retaining the global proposal for audit", async () => {
    const documentId = await createDocument("mapped.pdf", globalS22Id, 22);
    const response = await confirmDraft(documentId, 22).expect(200);
    const [line] = await db.select({
      vatCodeId: invoiceLinesTable.vatCodeId,
    }).from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, response.body.linkedInvoiceId))
      .limit(1);

    expect(line.vatCodeId).toBe(companyS22Id);
    expect(line.vatCodeId).not.toBe(globalS22Id);
    expect(response.body.confirmedData.lines[0]).toMatchObject({
      vatCodeId: companyS22Id,
      vatCodeFursId: globalS22Id,
      proposedFursVatCodeId: globalS22Id,
    });
  });

  it("keeps an explicit accountant VAT choice instead of replacing it with the OCR proposal", async () => {
    const documentId = await createDocument("accountant-choice.pdf", globalS22Id, 22);
    const response = await confirmDraft(documentId, 9.5, { vatCodeId: globalS95Id }).expect(200);
    const [line] = await db.select({
      vatCodeId: invoiceLinesTable.vatCodeId,
    }).from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, response.body.linkedInvoiceId))
      .limit(1);

    expect(line.vatCodeId).toBe(companyS95Id);
    expect(response.body.confirmedData.lines[0]).toMatchObject({
      vatCodeId: companyS95Id,
      vatCodeFursId: globalS95Id,
      proposedFursVatCodeId: globalS22Id,
    });
  });

  it("rolls back nothing and leaves the document done/unlinked when a matching tenant code is absent", async () => {
    const documentId = await createDocument("unmapped.pdf", globalS5Id, 5);
    const invoicesBefore = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    const response = await confirmDraft(documentId, 5);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("S5");
    expect(response.body.error).toContain("Nastavitve > DDV kode");

    const [storedDocument] = await db.select({
      status: documentsTable.status,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
    const remainingInvoices = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    expect(storedDocument).toEqual({ status: "done", linkedInvoiceId: null });
    expect(remainingInvoices).toHaveLength(invoicesBefore.length);
  });
});

describe.sequential("USD document exchange rate confirmation", () => {
  function confirmUsd(documentId: string, invoiceDate: string, options: {
    exchangeRate?: Record<string, unknown>;
    line?: Record<string, unknown>;
    vatTreatment?: "standard" | "gross-expense-no-input-vat";
    vatTreatmentReviewed?: boolean;
  } = {}) {
    return request(app())
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({
        documentType: "invoice_issued",
        counterpartyId,
        periodId,
        invoiceNumber: `USD-${runId}-${documentId}`,
        invoiceDate,
        createInvoice: true,
        arApAccountId: receivableAccountId,
        ...(options.vatTreatment ? { vatTreatment: options.vatTreatment } : {}),
        ...(options.vatTreatmentReviewed !== undefined
          ? { vatTreatmentReviewed: options.vatTreatmentReviewed }
          : {}),
        lines: [{
          description: "USD service",
          quantity: 1,
          unitPrice: 125,
          vatRate: 22,
          vatBase: 125,
          vatAmount: 27.5,
          accountId: revenueAccountId,
          vatCodeId: globalS22Id,
          confidence: 1,
          ...options.line,
        }],
        ...(options.exchangeRate ? { exchangeRate: options.exchangeRate } : {}),
      });
  }

  function confirmGross(documentId: string, invoiceDate: string, options: {
    documentType?: string;
    accountId?: string;
    vatTreatmentReviewed?: boolean;
    exchangeRate?: Record<string, unknown>;
    lines?: Record<string, unknown>[];
  } = {}) {
    return request(app())
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({
        documentType: options.documentType ?? "invoice_received",
        counterpartyId: supplierCounterpartyId,
        periodId,
        invoiceNumber: `GROSS-${runId}-${documentId}`,
        invoiceDate,
        createInvoice: true,
        arApAccountId: payableAccountId,
        vatTreatment: "gross-expense-no-input-vat",
        vatTreatmentReviewed: options.vatTreatmentReviewed ?? true,
        lines: options.lines ?? [{
          description: "Third-country service cost",
          quantity: 1,
          unitPrice: 20,
          vatRate: 22,
          vatBase: 20,
          vatAmount: 4.4,
          accountId: options.accountId ?? expenseAccountId,
          vatCodeId: globalS22Id,
          confidence: 1,
        }],
        exchangeRate: options.exchangeRate
          ?? reviewedManualRate(invoiceDate, "gross-expense-no-input-vat", 1.2),
      });
  }

  const reviewedManualRate = (
    invoiceDate: string,
    vatTreatment: "standard" | "gross-expense-no-input-vat" = "standard",
    unitsPerEur = 1.25,
  ) => ({
    mode: "manual",
    vatTreatment,
    requestedDate: invoiceDate,
    rateDate: invoiceDate,
    unitsPerEur,
    reviewed: true,
    manualReason: "Supplier rate reviewed",
  });

  it("previews and confirms a reviewed USD gross expense using one whole-gross conversion", async () => {
    const document = await createGrossSourceDocument("usd-gross-expense.pdf", "USD");
    const preview = await request(app())
      .get(`/companies/${companyId}/documents/${document.id}/exchange-rate`)
      .query({
        date: document.invoiceDate,
        mode: "manual",
        unitsPerEur: "1.2",
        rateDate: document.invoiceDate,
        vatTreatment: "gross-expense-no-input-vat",
      })
      .expect(200);
    expect(preview.body).toMatchObject({
      mode: "manual",
      vatTreatment: "gross-expense-no-input-vat",
      sourceTotals: { net: 20, vat: 4.4, gross: 24.4 },
      eurTotals: { net: 20.33, vat: 0, gross: 20.33 },
      convertedLines: [{
        unitPrice: 20.33,
        vatRate: 0,
        vatBase: 20.33,
        vatAmount: 0,
      }],
    });

    const staleTreatment = await confirmGross(document.id, document.invoiceDate, {
      exchangeRate: {
        ...preview.body,
        reviewed: true,
        vatTreatment: "standard",
        manualReason: "Supplier rate reviewed",
      },
    }).expect(400);
    expect(staleTreatment.body.code).toBe("STALE_VAT_TREATMENT_QUOTE");

    const response = await confirmGross(document.id, document.invoiceDate, {
      exchangeRate: {
        ...preview.body,
        reviewed: true,
        manualReason: "Supplier rate reviewed",
      },
    }).expect(200);
    expect(response.body.confirmedData).toMatchObject({
      currency: "EUR",
      sourceCurrency: "USD",
      vatTreatment: "gross-expense-no-input-vat",
      vatTreatmentReviewed: true,
      totalNet: 20.33,
      totalVat: 0,
      totalGross: 20.33,
      exchangeRate: {
        vatTreatment: "gross-expense-no-input-vat",
        sourceTotals: { net: 20, vat: 4.4, gross: 24.4 },
        eurTotals: { net: 20.33, vat: 0, gross: 20.33 },
      },
      lines: [{
        unitPrice: 20.33,
        vatRate: 0,
        vatBase: 20.33,
        vatAmount: 0,
        vatCodeId: null,
        proposedFursVatCodeId: globalS22Id,
        assetType: "NONE",
      }],
    });
    const [invoiceLine] = await db.select({
      unitPrice: invoiceLinesTable.unitPrice,
      vatRate: invoiceLinesTable.vatRate,
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
      vatCodeId: invoiceLinesTable.vatCodeId,
      assetType: invoiceLinesTable.assetType,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, response.body.linkedInvoiceId)).limit(1);
    expect(invoiceLine).toEqual({
      unitPrice: "20.3300",
      vatRate: "0.00",
      vatBase: "20.33",
      vatAmount: "0.00",
      vatCodeId: null,
      assetType: "NONE",
    });
    const [invoiceHeader] = await db.select({ sourceType: invoicesTable.sourceType })
      .from(invoicesTable).where(eq(invoicesTable.id, response.body.linkedInvoiceId)).limit(1);
    expect(invoiceHeader.sourceType).toBe("ai-document-gross-expense");
    const [storedDocument] = await db.select({
      ocrResult: documentsTable.ocrResult,
      confirmedData: documentsTable.confirmedData,
    }).from(documentsTable).where(eq(documentsTable.id, document.id)).limit(1);
    expect(storedDocument.ocrResult).toMatchObject({
      currency: "USD",
      totalNet: 20,
      totalVat: 4.4,
      totalGross: 24.4,
      lines: [{ vatBase: 20, vatAmount: 4.4, vatRate: 22 }],
    });
    expect(storedDocument.confirmedData).toMatchObject({
      sourceCurrency: "USD",
      currency: "EUR",
      vatTreatment: "gross-expense-no-input-vat",
    });
  });

  it("discloses and books a bounded source-header cent adjustment without changing the USD OCR", async () => {
    const positiveGrossCents = [
      1495, 1463, 4902, 1464, 1484, 1485, 1451, 1453, 1464, 1461,
      1404, 1454, 1492, 1482, 1430, 1464, 1460, 1467, 1468, 1453,
    ];
    const sourceLines = [
      ...positiveGrossCents.map((grossCents, lineIndex) => {
        const vatAmount = lineIndex === 2 ? 8.8 : 2.64;
        const vatBase = grossCents / 100 - vatAmount;
        return { quantity: 1, unitPrice: vatBase, vatRate: 22, vatBase, vatAmount };
      }),
      { quantity: -1, unitPrice: 17.21, vatRate: 22, vatBase: -17.21, vatAmount: -3.79 },
    ];
    const document = await createGrossSourceDocument(
      "usd-gross-header-rounding.pdf",
      "USD",
      { net: 250.8, vat: 55.18, gross: 305.98 },
      sourceLines,
    );
    const preview = await request(app())
      .get(`/companies/${companyId}/documents/${document.id}/exchange-rate`)
      .query({
        date: document.invoiceDate,
        mode: "manual",
        unitsPerEur: "1.1476",
        rateDate: document.invoiceDate,
        vatTreatment: "gross-expense-no-input-vat",
      })
      .expect(200);
    expect(preview.body).toMatchObject({
      sourceRoundingAdjustment: {
        sourceCurrency: "USD",
        sourceGross: 305.98,
        lineGross: 305.96,
        amount: 0.02,
        lineIndex: 2,
      },
      expenseEurRoundingAdjustment: { amount: 0.02, lineIndex: 2 },
      sourceTotals: { gross: 305.98 },
      eurTotals: { net: 266.63, vat: 0, gross: 266.63 },
    });

    const [ocrDocument] = await db.select({ ocrResult: documentsTable.ocrResult })
      .from(documentsTable).where(eq(documentsTable.id, document.id)).limit(1);
    const originalLines = (ocrDocument.ocrResult as any).lines as Record<string, unknown>[];
    const staleAdjustment = await confirmGross(document.id, document.invoiceDate, {
      lines: originalLines,
      exchangeRate: {
        ...preview.body,
        reviewed: true,
        manualReason: "Supplier rate reviewed",
        sourceRoundingAdjustment: {
          ...preview.body.sourceRoundingAdjustment,
          amount: 0.01,
        },
      },
    }).expect(400);
    expect(staleAdjustment.body.code).toBe("STALE_SOURCE_ROUNDING_ADJUSTMENT");
    const staleEurAdjustment = await confirmGross(document.id, document.invoiceDate, {
      lines: originalLines,
      exchangeRate: {
        ...preview.body,
        reviewed: true,
        manualReason: "Supplier rate reviewed",
        expenseEurRoundingAdjustment: {
          ...preview.body.expenseEurRoundingAdjustment,
          amount: 0.01,
        },
      },
    }).expect(400);
    expect(staleEurAdjustment.body.code).toBe("STALE_EUR_GROSS_ROUNDING_ADJUSTMENT");

    const response = await confirmGross(document.id, document.invoiceDate, {
      lines: originalLines,
      exchangeRate: {
        ...preview.body,
        reviewed: true,
        manualReason: "Supplier rate reviewed",
      },
    }).expect(200);
    expect(response.body.confirmedData).toMatchObject({
      totalNet: 266.63,
      totalVat: 0,
      totalGross: 266.63,
      sourceRoundingAdjustment: {
        sourceCurrency: "USD",
        sourceGross: 305.98,
        lineGross: 305.96,
        amount: 0.02,
        lineIndex: 2,
      },
      expenseEurRoundingAdjustment: {
        amount: 0.02,
        lineIndex: 2,
      },
      exchangeRate: {
        sourceTotals: { net: 250.8, vat: 55.18, gross: 305.98 },
        eurTotals: { net: 266.63, vat: 0, gross: 266.63 },
        sourceRoundingAdjustment: {
          sourceCurrency: "USD",
          sourceGross: 305.98,
          lineGross: 305.96,
          amount: 0.02,
          lineIndex: 2,
        },
        expenseEurRoundingAdjustment: { amount: 0.02, lineIndex: 2 },
      },
    });
    const postedLines = await db.select({
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, response.body.linkedInvoiceId));
    expect(postedLines).toHaveLength(21);
    expect(postedLines.reduce((sum, line) => sum + Number(line.vatBase), 0)).toBeCloseTo(266.63, 6);
    expect(postedLines.every(line => Number(line.vatAmount) === 0)).toBe(true);
    const [storedDocument] = await db.select({ ocrResult: documentsTable.ocrResult })
      .from(documentsTable).where(eq(documentsTable.id, document.id)).limit(1);
    expect(storedDocument.ocrResult).toMatchObject({
      totalNet: 250.8,
      totalVat: 55.18,
      totalGross: 305.98,
      lines: sourceLines.map(({ vatBase, vatAmount }) => ({ vatBase, vatAmount })),
    });
    const reloaded = await request(app())
      .get(`/companies/${companyId}/documents/${document.id}`)
      .expect(200);
    expect(typeof reloaded.body.confirmedData.invoiceDate).toBe("string");
    expect(reloaded.body.confirmedData.sourceCurrency).toBe("USD");
    const validatedReload = GetDocumentResponse.parse(reloaded.body);
    expect(validatedReload.confirmedData).toMatchObject({
      currency: "EUR",
      vatTreatment: "gross-expense-no-input-vat",
      vatTreatmentReviewed: true,
      sourceRoundingAdjustment: {
        sourceCurrency: "USD",
        sourceGross: 305.98,
        lineGross: 305.96,
        amount: 0.02,
        lineIndex: 2,
      },
      expenseEurRoundingAdjustment: { amount: 0.02, lineIndex: 2 },
      exchangeRate: {
        sourceRoundingAdjustment: {
          sourceCurrency: "USD",
          sourceGross: 305.98,
          lineGross: 305.96,
          amount: 0.02,
          lineIndex: 2,
        },
        expenseEurRoundingAdjustment: { amount: 0.02, lineIndex: 2 },
      },
    });
  });

  it("supports EUR gross expenses and rejects unreviewed, issued, and revenue-account gross treatment", async () => {
    const eurDocument = await createGrossSourceDocument("eur-gross-expense.pdf", "EUR");
    const eurResponse = await confirmGross(eurDocument.id, eurDocument.invoiceDate).expect(200);
    expect(eurResponse.body.confirmedData).toMatchObject({
      currency: "EUR",
      sourceCurrency: "EUR",
      vatTreatment: "gross-expense-no-input-vat",
      totalNet: 24.4,
      totalVat: 0,
      totalGross: 24.4,
      lines: [{ unitPrice: 24.4, vatRate: 0, vatBase: 24.4, vatAmount: 0, vatCodeId: null }],
    });
    const [eurInvoice] = await db.select({ sourceType: invoicesTable.sourceType })
      .from(invoicesTable).where(eq(invoicesTable.id, eurResponse.body.linkedInvoiceId)).limit(1);
    expect(eurInvoice.sourceType).toBe("ai-document-gross-expense");

    const unreviewed = await createGrossSourceDocument("unreviewed-gross-expense.pdf", "USD");
    const unreviewedResponse = await confirmGross(unreviewed.id, unreviewed.invoiceDate, {
      vatTreatmentReviewed: false,
    }).expect(400);
    expect(unreviewedResponse.body.code).toBe("VAT_TREATMENT_REVIEW_REQUIRED");

    const issued = await createUsdDocument("issued-gross-expense.pdf");
    const issuedResponse = await confirmGross(issued.id, issued.invoiceDate, {
      documentType: "invoice_issued",
    }).expect(400);
    expect(issuedResponse.body.code).toBe("VAT_TREATMENT_RECEIVED_ONLY");

    const revenueAccount = await createGrossSourceDocument("revenue-gross-expense.pdf", "USD");
    const revenueResponse = await confirmGross(revenueAccount.id, revenueAccount.invoiceDate, {
      accountId: revenueAccountId,
    }).expect(400);
    expect(revenueResponse.body.code).toBe("GROSS_EXPENSE_ACCOUNT_REQUIRED");
    const rejectedDocuments = await db.select({
      id: documentsTable.id,
      status: documentsTable.status,
    }).from(documentsTable).where(and(
      eq(documentsTable.companyId, companyId),
      eq(documentsTable.status, "done"),
    ));
    expect(rejectedDocuments.map(row => row.id)).toEqual(expect.arrayContaining([
      unreviewed.id,
      issued.id,
      revenueAccount.id,
    ]));
  });

  it("returns reviewed manual previews without depending on ECB availability and reports ECB failure explicitly", async () => {
    const document = await createUsdDocument("usd-preview.pdf");
    vi.stubGlobal("fetch", async () => new Response("temporarily unavailable", { status: 503 }));
    try {
      const ecbFailure = await request(app())
        .get(`/companies/${companyId}/documents/${document.id}/exchange-rate`)
        .query({ date: document.invoiceDate })
        .expect(503);
      expect(ecbFailure.body.error).toMatchObject({ code: "ECB_HTTP_ERROR" });

      const manualPreview = await request(app())
        .get(`/companies/${companyId}/documents/${document.id}/exchange-rate`)
        .query({
          date: document.invoiceDate,
          mode: "manual",
          unitsPerEur: "1.25",
          rateDate: document.invoiceDate,
        })
        .expect(200);
      expect(manualPreview.body).toMatchObject({
        mode: "manual",
        currency: "USD",
        targetCurrency: "EUR",
        requestedDate: document.invoiceDate,
        rateDate: document.invoiceDate,
        unitsPerEur: 1.25,
        source: "manual",
        sourceUrl: null,
        sourceTotals: { net: 125, vat: 27.5, gross: 152.5 },
        eurTotals: { net: 100, vat: 22, gross: 122 },
      });
    } finally {
      vi.unstubAllGlobals();
    }

    await request(app())
      .get(`/companies/${companyId}/documents/${document.id}/exchange-rate`)
      .expect(400);
  });

  it("requires reviewed FX input and rejects edited source money before any invoice writes", async () => {
    const missingReview = await createUsdDocument("usd-review-required.pdf");
    const invoicesBefore = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    const reviewResponse = await confirmUsd(missingReview.id, missingReview.invoiceDate).expect(400);
    expect(reviewResponse.body.code).toBe("EXCHANGE_RATE_REVIEW_REQUIRED");

    const tampered = await createUsdDocument("usd-tampered-source.pdf");
    const tamperResponse = await confirmUsd(tampered.id, tampered.invoiceDate, {
      exchangeRate: reviewedManualRate(tampered.invoiceDate),
      line: { unitPrice: 250 },
    }).expect(400);
    expect(tamperResponse.body.code).toBe("SOURCE_LINE_AMOUNT_CHANGED");

    const invoicesAfter = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    expect(invoicesAfter).toHaveLength(invoicesBefore.length);
    const docs = await db.select({ id: documentsTable.id, status: documentsTable.status })
      .from(documentsTable)
      .where(eq(documentsTable.companyId, companyId));
    expect(docs.filter(row => row.id === missingReview.id || row.id === tampered.id)
      .sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([{ id: missingReview.id, status: "done" }, { id: tampered.id, status: "done" }]
        .sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("persists only EUR invoice values while preserving the immutable USD OCR and FX audit snapshot", async () => {
    const document = await createUsdDocument("usd-manual-conversion.pdf");
    const response = await confirmUsd(document.id, document.invoiceDate, {
      exchangeRate: reviewedManualRate(document.invoiceDate),
    }).expect(200);

    expect(response.body.confirmedData).toMatchObject({
      currency: "EUR",
      sourceCurrency: "USD",
      totalNet: 100,
      totalVat: 22,
      totalGross: 122,
      exchangeRate: {
        mode: "manual",
        sourceCurrency: "USD",
        source: "manual",
        unitsPerEur: 1.25,
        sourceTotals: { net: 125, vat: 27.5, gross: 152.5 },
        eurTotals: { net: 100, vat: 22, gross: 122 },
      },
      lines: [{ unitPrice: 100, vatBase: 100, vatAmount: 22 }],
    });
    expect(response.body.confirmedData.exchangeRate).not.toHaveProperty("currency");
    const [storedDocument] = await db.select({
      ocrResult: documentsTable.ocrResult,
      confirmedData: documentsTable.confirmedData,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, document.id)).limit(1);
    expect(storedDocument.ocrResult).toMatchObject({
      currency: "USD",
      totalNet: 125,
      lines: [{ unitPrice: 125, vatBase: 125, vatAmount: 27.5 }],
    });
    expect(storedDocument.confirmedData).toMatchObject({ currency: "EUR", sourceCurrency: "USD" });

    const [invoiceLine] = await db.select({
      unitPrice: invoiceLinesTable.unitPrice,
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, storedDocument.linkedInvoiceId!)).limit(1);
    expect(invoiceLine).toEqual({ unitPrice: "100.0000", vatBase: "100.00", vatAmount: "22.00" });
    const [invoiceHeader] = await db.select({ sourceType: invoicesTable.sourceType })
      .from(invoicesTable).where(eq(invoicesTable.id, storedDocument.linkedInvoiceId!)).limit(1);
    expect(invoiceHeader.sourceType).toBe("ai-document-fx");

    const reloaded = await request(app())
      .get(`/companies/${companyId}/documents/${document.id}`)
      .expect(200);
    expect(typeof reloaded.body.confirmedData.invoiceDate).toBe("string");
    expect(reloaded.body.confirmedData).toMatchObject({
      currency: "EUR",
      sourceCurrency: "USD",
      exchangeRate: {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
        requestedDate: document.invoiceDate,
        rateDate: document.invoiceDate,
      },
    });
    expect(reloaded.body.confirmedData.exchangeRate).not.toHaveProperty("currency");
    const validatedReload = GetDocumentResponse.parse(reloaded.body);
    expect(validatedReload.confirmedData).toMatchObject({
      currency: "EUR",
      exchangeRate: {
        sourceCurrency: "USD",
        targetCurrency: "EUR",
      },
    });

    const duplicate = await confirmUsd(document.id, document.invoiceDate, {
      exchangeRate: reviewedManualRate(document.invoiceDate),
    }).expect(400);
    expect(duplicate.body.error).toContain("ni v stanju");
  });

  it("keeps the normal EUR invoice header free of the FX source marker", async () => {
    const documentId = await createDocument("ordinary-eur-invoice.pdf", globalS22Id, 22);
    const response = await confirmDraft(documentId, 22).expect(200);
    const [invoiceHeader] = await db.select({ sourceType: invoicesTable.sourceType })
      .from(invoicesTable).where(eq(invoicesTable.id, response.body.linkedInvoiceId)).limit(1);
    expect(invoiceHeader.sourceType).toBe("manual");
    expect(invoiceHeader.sourceType).not.toBe("ai-document-fx");
  });

  it("rejects stale invoice dates and stale authoritative ECB values without writing", async () => {
    const invoicesBefore = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    const staleManual = await createUsdDocument("usd-stale-manual.pdf");
    const staleDate = staleManual.invoiceDate === "2026-01-01" ? "2026-01-02" : "2026-01-01";
    const staleManualResponse = await confirmUsd(staleManual.id, staleManual.invoiceDate, {
      exchangeRate: {
        ...reviewedManualRate(staleManual.invoiceDate),
        requestedDate: staleDate,
      },
    }).expect(400);
    expect(staleManualResponse.body.code).toBe("STALE_EXCHANGE_RATE_DATE");

    const staleEcb = await createUsdDocument("usd-stale-ecb.pdf");
    vi.stubGlobal("fetch", async () => new Response(
      `KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,${staleEcb.invoiceDate},1.1000\n`,
      { status: 200, headers: { "content-type": "text/csv" } },
    ));
    try {
      const ecbResponse = await confirmUsd(staleEcb.id, staleEcb.invoiceDate, {
        exchangeRate: {
          mode: "ecb",
          requestedDate: staleEcb.invoiceDate,
          rateDate: staleEcb.invoiceDate,
          unitsPerEur: 1.2,
          reviewed: true,
        },
      }).expect(400);
      expect(ecbResponse.body.code).toBe("STALE_ECB_QUOTE");
    } finally {
      vi.unstubAllGlobals();
    }

    const [storedManual] = await db.select({ status: documentsTable.status })
      .from(documentsTable).where(eq(documentsTable.id, staleManual.id)).limit(1);
    const [storedEcb] = await db.select({ status: documentsTable.status })
      .from(documentsTable).where(eq(documentsTable.id, staleEcb.id)).limit(1);
    expect(storedManual.status).toBe("done");
    expect(storedEcb.status).toBe("done");
    const [manualAudit] = await db.select({
      confirmedData: documentsTable.confirmedData,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, staleManual.id)).limit(1);
    const [ecbAudit] = await db.select({
      confirmedData: documentsTable.confirmedData,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, staleEcb.id)).limit(1);
    expect(manualAudit).toEqual({ confirmedData: null, linkedInvoiceId: null });
    expect(ecbAudit).toEqual({ confirmedData: null, linkedInvoiceId: null });
    const invoicesAfter = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    expect(invoicesAfter).toHaveLength(invoicesBefore.length);
  });
});