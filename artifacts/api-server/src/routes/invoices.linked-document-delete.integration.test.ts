import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "linked-document-delete-test";
    next();
  },
}));
import invoicesRouter from "./invoices";
import { eq } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
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
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: "linked-document-delete-test", role: "owner",
  });

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
  const app = express().use(invoicesRouter);
  it("returns an actionable 409 without PostgreSQL details and preserves the invoice", async () => {
    const response = await request(app).delete(`/companies/${companyId}/invoices/${invoiceId}`);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("Najprej razvežite ali odstranite vezani dokument");
    expect(JSON.stringify(response.body)).not.toMatch(/23503|linked_invoice_id|violates|constraint/i);
    const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(rows).toHaveLength(1);
  });

  it("denies viewers and invoices outside the selected company", async () => {
    await db.update(accountingRolesTable).set({ role: "viewer" })
      .where(eq(accountingRolesTable.companyId, companyId));
    expect((await request(app).delete(`/companies/${companyId}/invoices/${invoiceId}`)).status).toBe(403);
    await db.update(accountingRolesTable).set({ role: "owner" })
      .where(eq(accountingRolesTable.companyId, companyId));
    expect((await request(app).delete(`/companies/00000000-0000-0000-0000-000000000000/invoices/${invoiceId}`)).status).toBe(403);
  });

  it("refuses posted invoices and deletes a draft only after its document is unlinked", async () => {
    await db.update(invoicesTable).set({ status: "posted" }).where(eq(invoicesTable.id, invoiceId));
    expect((await request(app).delete(`/companies/${companyId}/invoices/${invoiceId}`)).status).toBe(409);
    await db.update(invoicesTable).set({ status: "draft" }).where(eq(invoicesTable.id, invoiceId));
    await db.update(documentsTable).set({ linkedInvoiceId: null }).where(eq(documentsTable.id, documentId));
    expect((await request(app).delete(`/companies/${companyId}/invoices/${invoiceId}`)).status).toBe(204);
    expect(await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId))).toHaveLength(0);
    expect((await request(app).delete(`/companies/${companyId}/invoices/${invoiceId}`)).status).toBe(404);
  });
});