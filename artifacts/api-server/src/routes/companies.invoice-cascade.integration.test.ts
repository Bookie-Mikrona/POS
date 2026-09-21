import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  db,
  invoiceLinesTable,
  invoicesTable,
} from "@workspace/db";

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string;
let fixtureCompanyId: string;
let invoiceId: string;
let invoiceLineId: string;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `70${runId}`,
    naziv: `Company invoice cascade ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;

  const [fixtureCompany] = await db.insert(companiesTable).values({
    podjetjeDavcna: `71${runId}`,
    naziv: `Company invoice cascade fixtures ${runId}`,
  }).returning({ id: companiesTable.id });
  fixtureCompanyId = fixtureCompany.id;

  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId: fixtureCompanyId,
    name: "2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  const [account] = await db.insert(accountsTable).values({
    companyId: fixtureCompanyId,
    code: `70-${runId}`,
    name: "Testni konto",
    type: "expense",
  }).returning({ id: accountsTable.id });
  const [counterparty] = await db.insert(counterpartiesTable).values({
    companyId: fixtureCompanyId,
    type: "supplier",
    name: "Testni dobavitelj",
  }).returning({ id: counterpartiesTable.id });
  const [invoice] = await db.insert(invoicesTable).values({
    companyId,
    type: "received",
    counterpartyId: counterparty.id,
    periodId: period.id,
    invoiceNumber: `70-${runId}`,
    invoiceDate: "2026-09-08",
    arApAccountId: account.id,
    createdBy: "company-invoice-cascade-test",
  }).returning({ id: invoicesTable.id });
  invoiceId = invoice.id;

  const [line] = await db.insert(invoiceLinesTable).values({
    invoiceId,
    description: "Testna vrstica",
    quantity: "1",
    unitPrice: "10",
    vatRate: "22",
    accountId: account.id,
  }).returning({ id: invoiceLinesTable.id });
  invoiceLineId = line.id;
});

afterAll(async () => {
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, fixtureCompanyId)).catch(() => {});
});

describe("company invoice cascade", () => {
  it("deleting a company cascades to its invoices and invoice lines", async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));

    const [invoice] = await db.select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    const [line] = await db.select({ id: invoiceLinesTable.id })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.id, invoiceLineId));

    expect(invoice).toBeUndefined();
    expect(line).toBeUndefined();
  });
});