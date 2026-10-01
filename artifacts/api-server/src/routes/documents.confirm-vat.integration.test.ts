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
  vatCodeTable,
  vatCodesTable,
} from "@workspace/db";
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
let revenueAccountId: string;
let receivableAccountId: string;
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
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  const [counterparty] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "customer",
    name: `VAT mapping customer ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  counterpartyId = counterparty.id;

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