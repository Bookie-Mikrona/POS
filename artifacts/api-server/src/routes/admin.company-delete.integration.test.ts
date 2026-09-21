import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  db,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
} from "@workspace/db";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: express.Request & { clerkUserId?: string },
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.clerkUserId = "company-delete-test-admin";
    next();
  },
}));

vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

import adminRouter from "./admin";

const runId = Math.random().toString(36).slice(2, 10);
let fixtureCompanyId: string;
let invoiceCompanyId: string;
let journalCompanyId: string;
let emptyCompanyId: string;
let invoiceId: string;
let invoiceLineId: string;
let journalEntryId: string;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

beforeAll(async () => {
  const createdCompanies = await db.insert(companiesTable).values([
    { podjetjeDavcna: `70F${runId}`, naziv: `Delete fixtures ${runId}` },
    { podjetjeDavcna: `70I${runId}`, naziv: `Delete invoice ${runId}` },
    { podjetjeDavcna: `70J${runId}`, naziv: `Delete journal ${runId}` },
    { podjetjeDavcna: `70E${runId}`, naziv: `Delete empty ${runId}` },
  ]).returning({ id: companiesTable.id, davcna: companiesTable.podjetjeDavcna });
  fixtureCompanyId = createdCompanies.find((row) => row.davcna.startsWith("70F"))!.id;
  invoiceCompanyId = createdCompanies.find((row) => row.davcna.startsWith("70I"))!.id;
  journalCompanyId = createdCompanies.find((row) => row.davcna.startsWith("70J"))!.id;
  emptyCompanyId = createdCompanies.find((row) => row.davcna.startsWith("70E"))!.id;

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
    companyId: invoiceCompanyId,
    type: "received",
    counterpartyId: counterparty.id,
    periodId: period.id,
    invoiceNumber: `70-${runId}`,
    invoiceDate: "2026-09-08",
    arApAccountId: account.id,
    createdBy: "company-delete-test",
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

  const [entry] = await db.insert(journalEntriesTable).values({
    companyId: journalCompanyId,
    periodId: period.id,
    entryDate: "2026-09-08",
    description: "Samostojna temeljnica",
    createdBy: "company-delete-test",
  }).returning({ id: journalEntriesTable.id });
  journalEntryId = entry.id;
});

afterAll(async () => {
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, journalEntryId)).catch(() => {});
  await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId)).catch(() => {});
  await db.delete(companiesTable).where(
    inArray(companiesTable.id, [invoiceCompanyId, journalCompanyId, emptyCompanyId, fixtureCompanyId]),
  ).catch(() => {});
});

describe("DELETE /api/admin/companies/:id", () => {
  it("blocks deletion and preserves an invoice with its lines", async () => {
    const response = await request(makeApp())
      .delete(`/api/admin/companies/${invoiceCompanyId}?confirm=true`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "COMPANY_HAS_ACCOUNTING_RECORDS",
      invoiceCount: 1,
      journalEntryCount: 0,
      deletionBlocked: true,
    });

    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, invoiceCompanyId));
    const [invoice] = await db.select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    const [line] = await db.select({ id: invoiceLinesTable.id })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.id, invoiceLineId));
    expect(company?.id).toBe(invoiceCompanyId);
    expect(invoice?.id).toBe(invoiceId);
    expect(line?.id).toBe(invoiceLineId);
  });

  it("blocks deletion when a company has a standalone journal entry", async () => {
    const response = await request(makeApp())
      .delete(`/api/admin/companies/${journalCompanyId}`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "COMPANY_HAS_ACCOUNTING_RECORDS",
      invoiceCount: 0,
      journalEntryCount: 1,
      deletionBlocked: true,
    });

    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, journalCompanyId));
    const [entry] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, journalEntryId));
    expect(company?.id).toBe(journalCompanyId);
    expect(entry?.id).toBe(journalEntryId);
  });

  it("deletes a company that has no financial records", async () => {
    const response = await request(makeApp())
      .delete(`/api/admin/companies/${emptyCompanyId}`);

    expect(response.status).toBe(204);
    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, emptyCompanyId));
    expect(company).toBeUndefined();
  });
});