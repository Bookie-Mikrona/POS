import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER = "invoice-fx-posting-test-user";

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
    res.status(500).json({ error: error.message });
  });
  return instance;
}

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string;
let periodId: string;
let customerId: string;
let supplierId: string;
let arAccountId: string;
let apAccountId: string;
let salesAccountId: string;
let expenseAccountId: string;
let alternateExpenseAccountId: string;
let outputVatAccountId: string;
let inputVatAccountId: string;
let salesVatCodeId: string;
let purchaseVatCodeId: string;
let globalSalesVatCodeId: string;
let globalPurchaseVatCodeId: string;

async function createInvoice(options: {
  suffix: string;
  type: "issued" | "received";
  sourceType?: string;
  currency?: string;
  quantity?: string;
  unitPrice?: string;
  vatRate?: string;
  vatBase?: string | null;
  vatAmount?: string | null;
  vatCodeId?: string | null;
  accountId?: string;
}) {
  const number = `FX-${runId}-${options.suffix}`;
  const sourceDocument = options.type === "received"
    ? (await db.insert(purchaseSourceDocumentsTable).values({
        companyId,
        counterpartyId: supplierId,
        kind: "invoice",
        normalizedNumber: number.replaceAll("-", ""),
        displayNumber: number,
        documentDate: "2026-02-10",
        currency: options.currency ?? "USD",
      }).returning({ id: purchaseSourceDocumentsTable.id }))[0]
    : null;
  const [invoice] = await db.insert(invoicesTable).values({
    companyId,
    type: options.type,
    sourceType: options.sourceType ?? "manual",
    counterpartyId: options.type === "issued" ? customerId : supplierId,
    periodId,
    invoiceNumber: number,
    invoiceDate: "2026-02-10",
    status: "draft",
    arApAccountId: options.type === "issued" ? arAccountId : apAccountId,
    vatAccountId: options.type === "issued" ? outputVatAccountId : inputVatAccountId,
    sourceDocumentId: sourceDocument?.id ?? null,
    createdBy: TEST_USER,
  } as any).returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invoice.id,
    description: "Reviewed document invoice line",
    quantity: options.quantity ?? "1.000",
    // Stored source amount deliberately differs from the reviewed base/tax.
    unitPrice: options.unitPrice ?? "0.9700",
    vatRate: options.vatRate ?? "22.00",
    vatBase: options.vatBase === undefined ? "0.97" : options.vatBase,
    vatAmount: options.vatAmount === undefined ? "0.22" : options.vatAmount,
    vatCodeId: options.vatCodeId === undefined
      ? options.type === "issued" ? salesVatCodeId : purchaseVatCodeId
      : options.vatCodeId,
    accountId: options.accountId ?? (options.type === "issued" ? salesAccountId : expenseAccountId),
    sequence: 0,
  });
  return invoice.id;
}

async function expectBalanced(entryId: string) {
  const postedLines = await db.select({
    accountId: journalEntryLinesTable.accountId,
    side: journalEntryLinesTable.side,
    amount: journalEntryLinesTable.amount,
    vatAmount: journalEntryLinesTable.vatAmount,
  }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entryId));
  const debit = postedLines
    .filter(line => line.side === "debit")
    .reduce((sum, line) => sum + Number(line.amount), 0);
  const credit = postedLines
    .filter(line => line.side === "credit")
    .reduce((sum, line) => sum + Number(line.amount), 0);
  expect(debit.toFixed(2)).toBe(credit.toFixed(2));
  return postedLines;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI286${runId}`,
    naziv: `FX invoice posting test ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(accountingRolesTable).values({
    companyId,
    clerkUserId: TEST_USER,
    role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: `2026 FX invoices ${runId}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  const [customer] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "customer",
    name: `FX customer ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  customerId = customer.id;
  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "supplier",
    name: `FX supplier ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  supplierId = supplier.id;

  const addAccount = async (code: string, name: string, type: "asset" | "liability" | "revenue" | "expense") => {
    const [account] = await db.insert(accountsTable).values({
      companyId,
      code,
      name,
      type,
    }).returning({ id: accountsTable.id });
    return account.id;
  };
  arAccountId = await addAccount("1200000", "FX customer receivable", "asset");
  apAccountId = await addAccount("2200000", "FX supplier payable", "liability");
  salesAccountId = await addAccount("7600000", "FX sales", "revenue");
  expenseAccountId = await addAccount("4000000", "FX expense", "expense");
  alternateExpenseAccountId = await addAccount("4001000", "FX alternate expense", "expense");
  outputVatAccountId = await addAccount("2600000", "FX output VAT", "liability");
  inputVatAccountId = await addAccount("1600000", "FX input VAT", "asset");

  const [globalSales] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S22"), eq(vatCodeTable.direction, "OUT"))).limit(1);
  const [globalPurchase] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "P22"), eq(vatCodeTable.direction, "IN"))).limit(1);
  if (!globalSales || !globalPurchase) throw new Error("Global S22/P22 VAT fixture is missing");
  globalSalesVatCodeId = globalSales.id;
  globalPurchaseVatCodeId = globalPurchase.id;
  const [salesVat] = await db.insert(vatCodesTable).values({
    companyId,
    code: "S22",
    name: "FX output standard VAT",
    rate: "22.00",
    behavior: "standard",
    accountOutputId: outputVatAccountId,
    fursCodeId: globalSalesVatCodeId,
    validFrom: "2025-07-01",
  }).returning({ id: vatCodesTable.id });
  salesVatCodeId = salesVat.id;
  const [purchaseVat] = await db.insert(vatCodesTable).values({
    companyId,
    code: "P22",
    name: "FX input standard VAT",
    rate: "22.00",
    behavior: "standard",
    accountInputId: inputVatAccountId,
    fursCodeId: globalPurchaseVatCodeId,
    validFrom: "2025-07-01",
  }).returning({ id: vatCodesTable.id });
  purchaseVatCodeId = purchaseVat.id;
});

afterAll(async () => {
  if (!companyId) return;
  await db.update(invoicesTable)
    .set({ linkedEntryId: null })
    .where(eq(invoicesTable.companyId, companyId));
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map(entry => entry.id);
  if (entryIds.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, entryIds));
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entryIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db.delete(purchaseSourceDocumentsTable).where(eq(purchaseSourceDocumentsTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(vatCodesTable).where(eq(vatCodesTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe.sequential("AI document invoice amounts", () => {
  it("uses the approved EUR base and VAT for received and issued details and balanced postings", async () => {
    for (const type of ["received", "issued"] as const) {
      const invoiceId = await createInvoice({
        suffix: type,
        type,
        sourceType: "ai-document-fx",
        unitPrice: "0.9727",
      });
      const detailResponse = await request(app())
        .get(`/companies/${companyId}/invoices/${invoiceId}`)
        .expect(200);
      expect(detailResponse.body).toMatchObject({
        totalNet: "0.97",
        totalVat: "0.22",
        totalGross: "1.19",
        lines: [expect.objectContaining({
          lineTotal: "0.97",
          vatAmount: "0.22",
          grossTotal: "1.19",
        })],
      });
      const listResponse = await request(app())
        .get(`/companies/${companyId}/invoices?type=${type}`)
        .expect(200);
      expect(listResponse.body.invoices.find((row: any) => row.id === invoiceId)).toMatchObject({
        totalNet: "0.97",
        totalVat: "0.22",
        totalGross: "1.19",
      });

      const postedResponse = await request(app())
        .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
        .expect(200);
      const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
      expect(postedLines).toEqual(expect.arrayContaining(type === "issued" ? [
        expect.objectContaining({ accountId: arAccountId, side: "debit", amount: "1.19" }),
        expect.objectContaining({ accountId: salesAccountId, side: "credit", amount: "0.97", vatAmount: "0.22" }),
        expect.objectContaining({ accountId: outputVatAccountId, side: "credit", amount: "0.22" }),
      ] : [
        expect.objectContaining({ accountId: expenseAccountId, side: "debit", amount: "0.97", vatAmount: "0.22" }),
        expect.objectContaining({ accountId: inputVatAccountId, side: "debit", amount: "0.22" }),
        expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "1.19" }),
      ]));

      const vatRows = await db.select({
        direction: vatLedgerTable.direction,
        baseAmount: vatLedgerTable.baseAmount,
        vatAmount: vatLedgerTable.vatAmount,
      }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, postedResponse.body.linkedEntryId));
      expect(vatRows).toContainEqual({
        direction: type === "issued" ? "OUT" : "IN",
        baseAmount: "0.97",
        vatAmount: "0.22",
      });
    }
  });

  it("continues to calculate ordinary EUR invoices from quantity and unit price", async () => {
    const invoiceId = await createInvoice({ suffix: "ordinary-eur", type: "received", sourceType: "manual" });
    await db.update(invoiceLinesTable)
      .set({ vatBase: null, vatAmount: null })
      .where(eq(invoiceLinesTable.invoiceId, invoiceId));
    const detailResponse = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}`)
      .expect(200);
    expect(detailResponse.body).toMatchObject({
      totalNet: "0.97",
      totalVat: "0.21",
      totalGross: "1.18",
      lines: [expect.objectContaining({ vatAmount: "0.21", grossTotal: "1.18" })],
    });
  });

  it("blocks FX posting if either approved stored amount is missing", async () => {
    for (const missingField of ["vatBase", "vatAmount"] as const) {
      const invoiceId = await createInvoice({
        suffix: `missing-${missingField}`,
        type: "received",
        sourceType: "ai-document-fx",
        [missingField]: null,
      });
      const response = await request(app())
        .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
        .expect(400);
      expect(response.body.error).toContain("manjkajočo ali neveljavno shranjeno");
      const [invoice] = await db.select({ status: invoicesTable.status })
        .from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      expect(invoice.status).toBe("draft");
      await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    }
  });

  it("posts reviewed gross-only EUR expense base without creating VAT or reverse-charge entries", async () => {
    const invoiceId = await createInvoice({
      suffix: "gross-only-eur",
      type: "received",
      sourceType: "ai-document-gross-expense",
      currency: "EUR",
      quantity: "1001.000",
      // Quantity × four-decimal unit price rounds to 20.32; the reviewed
      // document base is authoritative at 20.33.
      unitPrice: "0.0203",
      vatRate: "0.00",
      vatBase: "20.33",
      vatAmount: "0.00",
      vatCodeId: null,
    });
    const detailResponse = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}`)
      .expect(200);
    expect(detailResponse.body).toMatchObject({
      totalNet: "20.33",
      totalVat: "0.00",
      totalGross: "20.33",
      lines: [expect.objectContaining({
        lineTotal: "20.33",
        vatAmount: "0.00",
        grossTotal: "20.33",
      })],
    });
    const listResponse = await request(app())
      .get(`/companies/${companyId}/invoices?type=received`);
    expect(listResponse.status, JSON.stringify(listResponse.body)).toBe(200);
    expect(listResponse.body.invoices.find((row: any) => row.id === invoiceId)).toMatchObject({
      totalNet: "20.33",
      totalVat: "0.00",
      totalGross: "20.33",
    });

    const forbiddenEdits = [
      { vatRate: 22, vatCodeId: null, accountId: expenseAccountId },
      { vatRate: 0, vatCodeId: purchaseVatCodeId, accountId: expenseAccountId },
      { vatRate: 0, vatCodeId: null, accountId: salesAccountId },
    ];
    for (const [index, edit] of forbiddenEdits.entries()) {
      const rejectedEdit = await request(app())
        .patch(`/companies/${companyId}/invoices/${invoiceId}`)
        .send({
          lines: [{
            description: `Forbidden gross-only edit ${index}`,
            quantity: 1001,
            unitPrice: 0.0203,
            ...edit,
          }],
        });
      expect(rejectedEdit.status, JSON.stringify(rejectedEdit.body)).toBe(400);
    }
    const [unchangedLine] = await db.select({
      vatRate: invoiceLinesTable.vatRate,
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
      vatCodeId: invoiceLinesTable.vatCodeId,
      accountId: invoiceLinesTable.accountId,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(unchangedLine).toEqual({
      vatRate: "0.00",
      vatBase: "20.33",
      vatAmount: "0.00",
      vatCodeId: null,
      accountId: expenseAccountId,
    });

    const updateResponse = await request(app())
      .patch(`/companies/${companyId}/invoices/${invoiceId}`)
      .send({
        sourceType: "manual",
        lines: [{
          description: "Reviewed gross expense, renamed",
          quantity: 1001,
          unitPrice: 0.0203,
          vatRate: 0,
          vatCodeId: null,
          accountId: alternateExpenseAccountId,
        }],
      });
    expect(updateResponse.status, JSON.stringify(updateResponse.body)).toBe(200);
    expect(updateResponse.body).toMatchObject({
      sourceType: "ai-document-gross-expense",
      totalNet: "20.33",
      totalVat: "0.00",
      totalGross: "20.33",
    });
    const [storedLine] = await db.select({
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(storedLine).toEqual({ vatBase: "20.33", vatAmount: "0.00" });

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: alternateExpenseAccountId, side: "debit", amount: "20.33" }),
      expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "20.33" }),
    ]));
    expect(postedLines.some(line =>
      line.accountId === inputVatAccountId || line.accountId === outputVatAccountId,
    )).toBe(false);
    const vatRows = await db.select({ id: vatLedgerTable.id })
      .from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, postedResponse.body.linkedEntryId));
    expect(vatRows).toEqual([]);
  });

  it("posts all 21 signed gross expense lines with a balanced net AP amount", async () => {
    const invoiceId = await createInvoice({
      suffix: "gross-only-mixed-21",
      type: "received",
      sourceType: "ai-document-gross-expense",
      currency: "EUR",
      quantity: "1.000",
      unitPrice: "14.0000",
      vatRate: "0.00",
      vatBase: "14.00",
      vatAmount: "0.00",
      vatCodeId: null,
    });
    await db.delete(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    const amounts = [
      ...Array.from({ length: 19 }, () => "14.00"),
      "18.93",
      "-18.30",
    ];
    await db.insert(invoiceLinesTable).values(amounts.map((amount, sequence) => ({
      invoiceId,
      description: `Signed gross expense line ${sequence + 1}`,
      quantity: "1.000",
      unitPrice: amount === "-18.30" ? "-18.3000" : `${amount}00`,
      vatRate: "0.00",
      vatBase: amount,
      vatAmount: "0.00",
      vatCodeId: null,
      accountId: expenseAccountId,
      sequence,
    })));

    const detailResponse = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}`)
      .expect(200);
    expect(detailResponse.body).toMatchObject({
      totalNet: "266.63",
      totalVat: "0.00",
      totalGross: "266.63",
    });
    expect(detailResponse.body.lines).toHaveLength(21);

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    const expenseDebits = postedLines
      .filter(line => line.accountId === expenseAccountId && line.side === "debit")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    const expenseCredits = postedLines
      .filter(line => line.accountId === expenseAccountId && line.side === "credit")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    expect(expenseDebits.toFixed(2)).toBe("284.93");
    expect(expenseCredits.toFixed(2)).toBe("18.30");
    expect((expenseDebits - expenseCredits).toFixed(2)).toBe("266.63");
    expect(postedLines).toContainEqual(
      expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "266.63" }),
    );
    expect(postedLines.some(line =>
      line.accountId === inputVatAccountId || line.accountId === outputVatAccountId,
    )).toBe(false);
    expect(await db.select({ id: vatLedgerTable.id })
      .from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, postedResponse.body.linkedEntryId))).toEqual([]);
  });

  it("posts a wholly negative gross credit invoice with expense credit and AP debit", async () => {
    const invoiceId = await createInvoice({
      suffix: "gross-only-credit",
      type: "received",
      sourceType: "ai-document-gross-expense",
      currency: "EUR",
      unitPrice: "-20.3300",
      vatRate: "0.00",
      vatBase: "-20.33",
      vatAmount: "0.00",
      vatCodeId: null,
    });
    const detailResponse = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}`)
      .expect(200);
    expect(detailResponse.body).toMatchObject({
      totalNet: "-20.33",
      totalVat: "0.00",
      totalGross: "-20.33",
    });

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: expenseAccountId, side: "credit", amount: "20.33" }),
      expect.objectContaining({ accountId: apAccountId, side: "debit", amount: "20.33" }),
    ]));
    expect(await db.select({ id: vatLedgerTable.id })
      .from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, postedResponse.body.linkedEntryId))).toEqual([]);
  });

  it("fails closed when a gross-only invoice has stored VAT corruption", async () => {
    const invoiceId = await createInvoice({
      suffix: "gross-only-corrupt-tax",
      type: "received",
      sourceType: "ai-document-gross-expense",
      currency: "EUR",
      quantity: "1001.000",
      unitPrice: "0.0203",
      vatRate: "0.00",
      vatBase: "20.33",
      vatAmount: "0.01",
      vatCodeId: null,
    });
    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Bruto strošek iz dokumenta");
    const [invoice] = await db.select({ status: invoicesTable.status })
      .from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(invoice.status).toBe("draft");
  });

  it("recalculates a gross-only line edit from the new price with zero VAT", async () => {
    const invoiceId = await createInvoice({
      suffix: "gross-only-price-edit",
      type: "received",
      sourceType: "ai-document-gross-expense",
      currency: "EUR",
      quantity: "1001.000",
      unitPrice: "0.0203",
      vatRate: "0.00",
      vatBase: "20.33",
      vatAmount: "0.00",
      vatCodeId: null,
    });
    const updateResponse = await request(app())
      .patch(`/companies/${companyId}/invoices/${invoiceId}`)
      .send({
        lines: [{
          description: "Repriced gross expense",
          quantity: 1001,
          unitPrice: 0.025,
          vatRate: 0,
          vatCodeId: null,
          accountId: expenseAccountId,
        }],
      });
    expect(updateResponse.status, JSON.stringify(updateResponse.body)).toBe(200);
    expect(updateResponse.body).toMatchObject({
      totalNet: "25.03",
      totalVat: "0.00",
      totalGross: "25.03",
    });
    const [storedLine] = await db.select({
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(storedLine).toEqual({ vatBase: "25.03", vatAmount: "0.00" });

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: expenseAccountId, side: "debit", amount: "25.03" }),
      expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "25.03" }),
    ]));
    expect(await db.select({ id: vatLedgerTable.id })
      .from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, postedResponse.body.linkedEntryId))).toEqual([]);
  });

  it("preserves converted declared VAT for account/description-only edits and ignores a client source marker", async () => {
    const invoiceId = await createInvoice({
      suffix: "account-only-edit",
      type: "received",
      sourceType: "ai-document-fx",
      unitPrice: "0.9727",
    });
    const updateResponse = await request(app())
      .patch(`/companies/${companyId}/invoices/${invoiceId}`)
      .send({
        sourceType: "manual",
        lines: [{
          description: "Renamed account-only FX line",
          quantity: 1,
          unitPrice: 0.9727,
          vatRate: 22,
          vatCodeId: purchaseVatCodeId,
          accountId: alternateExpenseAccountId,
        }],
      });
    expect(updateResponse.status, JSON.stringify(updateResponse.body)).toBe(200);
    expect(updateResponse.body).toMatchObject({
      sourceType: "ai-document-fx",
      totalNet: "0.97",
      totalVat: "0.22",
      totalGross: "1.19",
    });
    const [storedLine] = await db.select({
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(storedLine).toEqual({ vatBase: "0.97", vatAmount: "0.22" });

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: alternateExpenseAccountId, side: "debit", amount: "0.97", vatAmount: "0.22" }),
      expect.objectContaining({ accountId: inputVatAccountId, side: "debit", amount: "0.22" }),
      expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "1.19" }),
    ]));
  });

  it("recalculates stored FX amounts after an intentional draft line edit", async () => {
    const invoiceId = await createInvoice({
      suffix: "edited-fx-line",
      type: "received",
      sourceType: "ai-document-fx",
    });
    const updateResponse = await request(app())
      .patch(`/companies/${companyId}/invoices/${invoiceId}`)
      .send({
        lines: [{
          description: "Manually edited FX line",
          quantity: 1,
          unitPrice: 1,
          vatRate: 22,
          vatCodeId: purchaseVatCodeId,
          accountId: expenseAccountId,
        }],
      });
    expect(updateResponse.status, JSON.stringify(updateResponse.body)).toBe(200);
    expect(updateResponse.body).toMatchObject({
      totalNet: "1.00",
      totalVat: "0.22",
      totalGross: "1.22",
    });
    const [storedLine] = await db.select({
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(storedLine).toEqual({ vatBase: "1.00", vatAmount: "0.22" });

    const postedResponse = await request(app())
      .post(`/companies/${companyId}/invoices/${invoiceId}/post`)
      .expect(200);
    const postedLines = await expectBalanced(postedResponse.body.linkedEntryId);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: expenseAccountId, side: "debit", amount: "1.00", vatAmount: "0.22" }),
      expect.objectContaining({ accountId: apAccountId, side: "credit", amount: "1.22" }),
    ]));
  });
});