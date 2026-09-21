import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  db,
  documentsTable,
  invoicesTable,
} from "@workspace/db";

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string;
let invoiceId: string;
let documentId: string;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI69${runId}`,
    naziv: `Linked invoice delete test ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;

  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: "2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  const [account] = await db.insert(accountsTable).values({
    companyId,
    code: `220-${runId}`,
    name: "Obveznosti",
    type: "liability",
  }).returning({ id: accountsTable.id });
  const [counterparty] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "supplier",
    name: "Dobavitelj",
  }).returning({ id: counterpartiesTable.id });
  const [invoice] = await db.insert(invoicesTable).values({
    companyId,
    type: "received",
    counterpartyId: counterparty.id,
    periodId: period.id,
    invoiceNumber: `R-${runId}`,
    invoiceDate: "2026-09-06",
    arApAccountId: account.id,
    createdBy: "linked-document-delete-test",
  }).returning({ id: invoicesTable.id });
  invoiceId = invoice.id;

  const [document] = await db.insert(documentsTable).values({
    companyId,
    fileName: "racun.pdf",
    mimeType: "application/pdf",
    objectPath: `/test/${runId}/racun.pdf`,
    linkedInvoiceId: invoiceId,
  }).returning({ id: documentsTable.id });
  documentId = document.id;
});

afterAll(async () => {
  await db.delete(documentsTable).where(eq(documentsTable.id, documentId));
  await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("linked document invoice deletion", () => {
  it("rejects deletion and preserves both records while a document is linked", async () => {
    await expect(
      db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    const [invoice] = await db.select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    const [document] = await db.select({
      id: documentsTable.id,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, documentId));

    expect(invoice?.id).toBe(invoiceId);
    expect(document).toEqual({ id: documentId, linkedInvoiceId: invoiceId });
  });
});