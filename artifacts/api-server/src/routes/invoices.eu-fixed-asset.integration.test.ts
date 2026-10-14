import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER = "invoice-eu-fixed-asset-test-user";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_USER;
    next();
  },
}));

import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  counterpartyAccountTemplatesTable,
  db,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  purchaseSourceDocumentsTable,
  vatCodeTable,
  vatCodesTable,
  vatLedgerTable,
} from "@workspace/db";
import invoicesRouter from "./invoices";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(invoicesRouter);
  instance.use((error: Error, _req: any, res: any, _next: any) => {
    const dbError = error as Error & { code?: string; constraint?: string; detail?: string };
    res.status(500).json({
      error: dbError.message,
      code: dbError.code,
      constraint: dbError.constraint,
      detail: dbError.detail,
    });
  });
  return instance;
}

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string;
let periodId: string;
let supplierId: string;
let payableAccountId: string;
let assetAccountId: string;
let inputVatAccountId: string;
let outputVatAccountId: string;
let euVatCodeId: string;
let companyEuVatCodeId: string;
let globalS22Id: string;
let companyS22Id: string;
let globalP22Id: string;
let companyP22Id: string;

async function createInvoice(options: {
  suffix: string;
  supplierId?: string;
  assetType?: "NONE" | "OTHER_FA";
  vatCodeId?: string | null;
  vatRate?: string;
}) {
  const number = `EU-FA-${runId}-${options.suffix}`;
  const [source] = await db.insert(purchaseSourceDocumentsTable).values({
    companyId,
    counterpartyId: options.supplierId ?? supplierId,
    kind: "invoice",
    normalizedNumber: number.replaceAll("-", ""),
    displayNumber: number,
    documentDate: "2026-02-10",
  }).returning({ id: purchaseSourceDocumentsTable.id });
  const [invoice] = await db.insert(invoicesTable).values({
    companyId,
    type: "received",
    counterpartyId: options.supplierId ?? supplierId,
    periodId,
    invoiceNumber: number,
    invoiceDate: "2026-02-10",
    status: "draft",
    arApAccountId: payableAccountId,
    sourceDocumentId: source.id,
    createdBy: TEST_USER,
  }).returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invoice.id,
    description: "EU fixed asset",
    quantity: "1.000",
    unitPrice: "100.0000",
    vatRate: options.vatRate ?? "22.00",
    vatCodeId: options.vatCodeId === undefined ? companyEuVatCodeId : options.vatCodeId,
    assetType: options.assetType ?? "OTHER_FA",
    accountId: assetAccountId,
  });
  return { invoiceId: invoice.id, number };
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI286${runId}`,
    naziv: `EU fixed asset invoice test ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(accountingRolesTable).values({
    companyId,
    clerkUserId: TEST_USER,
    role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: `2026 EU-FA ${runId}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;
  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "supplier",
    name: `German supplier ${runId}`,
    country: "DE",
    kodaDrzave: "DE",
    idZaDdv: "DE123456789",
  }).returning({ id: counterpartiesTable.id });
  supplierId = supplier.id;

  const [payable] = await db.insert(accountsTable).values({
    companyId,
    code: "2210000",
    name: "EU supplier payable",
    type: "liability",
  }).returning({ id: accountsTable.id });
  payableAccountId = payable.id;
  const [asset] = await db.insert(accountsTable).values({
    companyId,
    code: "0400000",
    name: "Other fixed assets",
    type: "asset",
  }).returning({ id: accountsTable.id });
  assetAccountId = asset.id;
  const [inputVat] = await db.insert(accountsTable).values({
    companyId,
    code: "1604000",
    name: "EU acquisition input VAT",
    type: "asset",
  }).returning({ id: accountsTable.id });
  inputVatAccountId = inputVat.id;
  const [outputVat] = await db.insert(accountsTable).values({
    companyId,
    code: "2604000",
    name: "EU acquisition output VAT",
    type: "liability",
  }).returning({ id: accountsTable.id });
  outputVatAccountId = outputVat.id;

  const [vatCode] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "EUB22"), eq(vatCodeTable.direction, "IN")))
    .limit(1);
  if (!vatCode) throw new Error("EUB22 IN VAT code is missing from the test database");
  euVatCodeId = vatCode.id;
  const [companyVatCode] = await db.insert(vatCodesTable).values({
    companyId,
    code: "EUB22",
    name: "EU goods acquisition 22%",
    rate: "22.00",
    behavior: "reverse_charge",
    accountInputId: inputVatAccountId,
    accountOutputId: outputVatAccountId,
    fursCodeId: euVatCodeId,
    validFrom: "2025-07-01",
  }).returning({ id: vatCodesTable.id });
  companyEuVatCodeId = companyVatCode.id;
  if (companyEuVatCodeId === euVatCodeId) {
    throw new Error("Company VAT fixture must use a distinct ID from its global FURS code");
  }

  const [s22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S22"), eq(vatCodeTable.direction, "OUT")))
    .limit(1);
  const [p22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "P22"), eq(vatCodeTable.direction, "IN")))
    .limit(1);
  if (!s22 || !p22) throw new Error("S22 OUT and P22 IN FURS test codes are missing");
  globalS22Id = s22.id;
  globalP22Id = p22.id;
  const [companyS22] = await db.insert(vatCodesTable).values({
    companyId,
    code: "S22",
    name: "Domestic sale 22%",
    rate: "22.00",
    behavior: "standard",
    fursCodeId: globalS22Id,
    validFrom: "2025-07-01",
  }).returning({ id: vatCodesTable.id });
  companyS22Id = companyS22.id;
  const [companyP22] = await db.insert(vatCodesTable).values({
    companyId,
    code: "P22",
    name: "Domestic purchase 22%",
    rate: "22.00",
    behavior: "standard",
    accountInputId: inputVatAccountId,
    fursCodeId: globalP22Id,
    validFrom: "2025-07-01",
  }).returning({ id: vatCodesTable.id });
  companyP22Id = companyP22.id;
});

afterAll(async () => {
  if (!companyId) return;
  await db.update(invoicesTable)
    .set({ linkedEntryId: null })
    .where(eq(invoicesTable.companyId, companyId));
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map((entry) => entry.id);
  if (entryIds.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, entryIds));
  }
  if (entryIds.length > 0) {
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entryIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db.delete(purchaseSourceDocumentsTable).where(eq(purchaseSourceDocumentsTable.companyId, companyId));
  await db.delete(counterpartyAccountTemplatesTable)
    .where(eq(counterpartyAccountTemplatesTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(vatCodesTable).where(eq(vatCodesTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  const [deletedCompany] = await db.delete(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .returning({ id: companiesTable.id });
  if (!deletedCompany) throw new Error(`Test company cleanup did not delete ${companyId}`);
});

describe.sequential("received EU fixed-asset invoice posting", () => {
  it("posts the balanced 04/1604000/2604000/221 entry and paired KPR/KIR VAT", async () => {
    const { invoiceId, number } = await createInvoice({ suffix: "POST" });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const posted = response.body;

    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      vatCodeId: journalEntryLinesTable.vatCodeId,
      companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
    }).from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, posted.linkedEntryId));
    expect(lines).toHaveLength(4);
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: assetAccountId, side: "debit", amount: "100.00" }),
      expect.objectContaining({ accountId: inputVatAccountId, side: "debit", amount: "22.00" }),
      expect.objectContaining({ accountId: outputVatAccountId, side: "credit", amount: "22.00" }),
      expect.objectContaining({ accountId: payableAccountId, side: "credit", amount: "100.00" }),
    ]));
    expect(lines.find((line) => line.accountId === assetAccountId)).toMatchObject({
      vatCodeId: euVatCodeId,
      companyVatCodeId: companyEuVatCodeId,
    });
    const vatRows = await db.select({
      id: vatLedgerTable.id,
      direction: vatLedgerTable.direction,
      pairId: vatLedgerTable.pairId,
      assetType: vatLedgerTable.assetType,
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
      documentNo: vatLedgerTable.documentNo,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, posted.linkedEntryId));
    expect(vatRows).toHaveLength(2);
    const inputRow = vatRows.find((row) => row.direction === "IN");
    const outputRow = vatRows.find((row) => row.direction === "OUT");
    expect(inputRow).toMatchObject({
      assetType: "OTHER_FA",
      baseAmount: "100.00",
      vatAmount: "22.00",
      documentNo: number,
    });
    expect(outputRow).toMatchObject({
      assetType: "NONE",
      baseAmount: "100.00",
      vatAmount: "22.00",
      documentNo: number,
    });
    expect(inputRow?.pairId).toBe(outputRow?.id);
    expect(outputRow?.pairId).toBe(inputRow?.id);
  });

  it("uses the linked FURS rate when the reverse-charge supplier line itself is 0%", async () => {
    const { invoiceId } = await createInvoice({ suffix: "SUPPLIER-ZERO-RATE", vatRate: "0.00" });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const posted = response.body;
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, posted.linkedEntryId));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: inputVatAccountId, side: "debit", amount: "22.00" }),
      expect.objectContaining({ accountId: outputVatAccountId, side: "credit", amount: "22.00" }),
    ]));
  });

  it("rejects a received invoice linked to an OUT code before posting", async () => {
    const { invoiceId } = await createInvoice({
      suffix: "WRONG-IN-DIRECTION",
      vatCodeId: companyS22Id,
      assetType: "NONE",
    });
    const entriesBefore = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));

    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("S22");
    expect(response.body.error).toContain("OUT");
    expect(response.body.error).toContain("Nastavitve > DDV kode");
    const [invoice] = await db.select({
      status: invoicesTable.status,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    const entriesAfter = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    expect(invoice).toEqual({ status: "draft", linkedEntryId: null });
    expect(entriesAfter.map((entry) => entry.id)).toEqual(entriesBefore.map((entry) => entry.id));
  });

  it("propagates an explicit standard IN selection as global FURS ID and preserves tenant provenance", async () => {
    const { invoiceId } = await createInvoice({
      suffix: "STANDARD-IN-CODE",
      vatCodeId: companyP22Id,
      assetType: "NONE",
    });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const [invoiceLine] = await db.select({
      vatCodeId: invoiceLinesTable.vatCodeId,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId)).limit(1);
    expect(invoiceLine.vatCodeId).toBe(companyP22Id);

    const postedLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      vatCodeId: journalEntryLinesTable.vatCodeId,
      companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
      vatAmount: journalEntryLinesTable.vatAmount,
    }).from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, response.body.linkedEntryId));
    const expenseLine = postedLines.find((line) => line.accountId === assetAccountId);
    expect(expenseLine).toMatchObject({
      vatCodeId: globalP22Id,
      companyVatCodeId: companyP22Id,
      vatAmount: "22.00",
    });

    const [vatRow] = await db.select({
      direction: vatLedgerTable.direction,
      vatCodeId: vatLedgerTable.vatCodeId,
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
    }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, response.body.linkedEntryId))
      .limit(1);
    expect(vatRow).toEqual({
      direction: "IN",
      vatCodeId: globalP22Id,
      baseAmount: "100.00",
      vatAmount: "22.00",
    });
  });

  it("rejects an EU asset without an explicit asset classification", async () => {
    const { invoiceId } = await createInvoice({ suffix: "NO-ASSET-TYPE", assetType: "NONE" });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(400);
    expect(response.body.error).toContain("vrsto osnovnega sredstva");
    const [invoice] = await db.select({ status: invoicesTable.status })
      .from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(invoice.status).toBe("draft");
  });

  it("rejects an EU asset when supplier country and VAT ID do not agree", async () => {
    const [badSupplier] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Bad EU supplier ${runId}`,
      country: "DE",
      kodaDrzave: "DE",
      idZaDdv: "FR123456789",
    }).returning({ id: counterpartiesTable.id });
    const { invoiceId } = await createInvoice({ suffix: "BAD-SUPPLIER", supplierId: badSupplier.id });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(400);
    expect(response.body.error).toContain("usklajeno državo EU");
  });

  it("rejects a classified fixed asset without an EUB VAT code", async () => {
    const { invoiceId } = await createInvoice({ suffix: "NO-VAT-CODE", vatCodeId: null });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(400);
    expect(response.body.error).toContain("nima potrjene DDV-kode");
  });
});

describe.sequential("received third-country service invoice posting", () => {
  it("self-assesses 22% VAT for a service from India and rejects an EU supplier", async () => {
    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId, type: "supplier", name: `Indian supplier ${runId}`, country: "IN", kodaDrzave: "IN",
    }).returning({ id: counterpartiesTable.id });
    const [expense] = await db.insert(accountsTable).values({
      companyId, code: "4130000", name: "Software services", type: "expense",
    }).returning({ id: accountsTable.id });
    const [ts22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
      .where(and(eq(vatCodeTable.code, "TS22"), eq(vatCodeTable.direction, "IN"))).limit(1);
    if (!ts22) throw new Error("TS22 IN VAT code is missing from the test database");
    const [companyTs22] = await db.insert(vatCodesTable).values({
      companyId, code: "TS22", name: "Third-country service 22%", rate: "22.00", behavior: "reverse_charge",
      accountInputId: inputVatAccountId, accountOutputId: outputVatAccountId, fursCodeId: ts22.id, validFrom: "2025-07-01",
    }).returning({ id: vatCodesTable.id });
    const prepare = async (suffix: string, supplierId: string) => {
      const { invoiceId } = await createInvoice({ suffix, supplierId, assetType: "NONE", vatCodeId: companyTs22.id, vatRate: "0.00" });
      await db.update(invoiceLinesTable).set({ accountId: expense.id }).where(eq(invoiceLinesTable.invoiceId, invoiceId));
      return invoiceId;
    };
    const okId = await prepare("TS-OK", supplier.id);
    const ok = await request(app()).post(`/companies/${companyId}/invoices/${okId}/post`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const lines = await db.select({ accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, ok.body.linkedEntryId));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: expense.id, side: "debit", amount: "100.00" }),
      expect.objectContaining({ accountId: inputVatAccountId, side: "debit", amount: "22.00" }),
      expect.objectContaining({ accountId: outputVatAccountId, side: "credit", amount: "22.00" }),
      expect.objectContaining({ accountId: payableAccountId, side: "credit", amount: "100.00" }),
    ]));

    const badId = await prepare("TS-EU", supplierId);
    const bad = await request(app()).post(`/companies/${companyId}/invoices/${badId}/post`).expect(400);
    expect(bad.body.error).toContain("tretje države");
  });
});
