import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER = "test-user-ssp-settlement";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = TEST_USER; next(); },
}));

import express from "express";
import supertest from "supertest";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, invoicesTable, invoiceLinesTable,
  journalEntriesTable, paymentsTable, paymentAllocationsTable,
  posBookingSettingsTable, enoteTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import paymentsRouter from "./payments";

const app = express();
app.use(express.json());
app.use(paymentsRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).json({ error: err.message }));
const run = Math.random().toString(36).slice(2, 8);
let companyId = "", foreignCompanyId = "", periodId = "", bankId = "", sspAccountId = "", revenueId = "", payerId = "", unitId = 0;

async function account(code: string, type: "asset" | "revenue" = "asset") {
  const [row] = await db.insert(accountsTable).values({ companyId, code, name: code, type }).returning({ id: accountsTable.id });
  return row.id;
}
async function entry(status: "draft" | "posted" | "reversed", unit = unitId, reference: string | null = `POS:PRODAJA:2026-03-01:E${unit}`) {
  const [row] = await db.insert(journalEntriesTable).values({
    companyId, periodId, entryDate: "2026-03-01", documentDate: "2026-03-01",
    description: "POS prodaja", reference, status, createdBy: "pos-sync",
  }).returning({ id: journalEntriesTable.id });
  return row.id;
}
async function invoice(number: string, linkedEntryId: string | null, amount = 100) {
  const [row] = await db.insert(invoicesTable).values({
    companyId, type: "issued", counterpartyId: payerId, periodId, invoiceNumber: number,
    invoiceDate: "2026-03-01", dueDate: "2026-03-01", status: "posted",
    arApAccountId: sspAccountId, linkedEntryId, createdBy: "pos-sync",
  }).returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: row.id, description: "SŠP", quantity: "1", unitPrice: String(amount),
    vatRate: "0", vatBase: String(amount), vatAmount: "0", accountId: revenueId,
  });
  return row.id;
}
function paymentPayload(invoiceId: string, amount: number, overrides: Record<string, unknown> = {}) {
  return {
    counterpartyId: payerId, periodId, direction: "inbound", paymentDate: "2026-04-01",
    amount, bankAccountId: bankId, arApAccountId: sspAccountId,
    allocations: [{ invoiceId, allocatedAmount: amount }], ...overrides,
  };
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: `SI-SSP-${run}`, naziv: "SŠP test" }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(accountingRolesTable).values({ companyId, clerkUserId: TEST_USER, role: "owner" });
  const [period] = await db.insert(accountingPeriodsTable).values({ companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id; bankId = await account("1100"); sspAccountId = await account("1650"); revenueId = await account("7600", "revenue");
  const [payer] = await db.insert(counterpartiesTable).values({ companyId, type: "customer", name: "MDDSZ/ŠOS" }).returning({ id: counterpartiesTable.id });
  payerId = payer.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: "Enota SŠP" }).returning({ id: enoteTable.id });
  unitId = unit.id;
  await db.insert(posBookingSettingsTable).values({ companyId, subsidyCounterpartyId: payerId, subsidyReceivableAccountId: sspAccountId });
});

afterAll(async () => {
  const payments = await db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  if (payments.length) await db.delete(paymentAllocationsTable).where(inArray(paymentAllocationsTable.paymentId, payments.map(p => p.id)));
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  const invoices = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  if (invoices.length) await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoices.map(i => i.id)));
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await db.delete(enoteTable).where(eq(enoteTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  if (foreignCompanyId) await db.delete(companiesTable).where(eq(companiesTable.id, foreignCompanyId));
  await pool.end();
});

describe("SŠP poravnave", () => {
  it("strogo prepozna kanonično identiteto, izolira enoto in zahteva knjiženo povezano temeljnico", async () => {
    const valid = await invoice(`POS-SSP-2026-03-01-E${unitId}`, await entry("posted"));
    await invoice(`POS-SSP-2026-03-01-E${unitId}-X`, await entry("posted"));
    const draft = await invoice(`POS-SSP-2026-03-E${unitId}`, await entry("draft"));
    await invoice(`POS-SSP-2026-03-01-E${unitId}`, await entry("posted", unitId, null));
    await invoice(`POS-SSP-2026-03-01-E${unitId}`, await entry("posted", unitId, "ročen sklic"));
    await invoice(`POS-SSP-2026-03-01-E${unitId}`, await entry("posted", unitId, `POS:PRODAJA:2026-03-01:E${unitId + 1}`));
    const listed = await supertest(app).get(`/companies/${companyId}/open-items`).query({ sspOnly: true, unitId });
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((i: any) => i.invoiceId)).toEqual([valid]);
    expect(listed.body.items[0]).toMatchObject({ unitId, totalGross: "100.00", remainingAmount: "100.00" });
    const [foreignCompany] = await db.insert(companiesTable).values({ podjetjeDavcna: `SI-SSP-F-${run}`, naziv: "Tuja enota" }).returning({ id: companiesTable.id });
    foreignCompanyId = foreignCompany.id;
    const [foreignUnit] = await db.insert(enoteTable).values({ companyId: foreignCompanyId, ime: "Tuja enota" }).returning({ id: enoteTable.id });
    const otherUnit = await supertest(app).get(`/companies/${companyId}/open-items`).query({ sspOnly: true, unitId: foreignUnit.id });
    expect(otherUnit.body.items).toEqual([]);
    const rejected = await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(draft, 10));
    expect(rejected.status).toBe(400);
  });

  it("enforces configured konto and supports partial/full as-of settlement", async () => {
    const target = await invoice(`POS-SSP-2026-03-01-E${unitId}`, await entry("posted"), 100);
    const wrongAccount = await account("1651");
    expect((await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 20, { arApAccountId: wrongAccount }))).status).toBe(400);
    const invalidBank = await account("7601", "revenue");
    expect((await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 20, { bankAccountId: invalidBank }))).status).toBe(400);
    const [wrongPayer] = await db.insert(counterpartiesTable).values({ companyId, type: "customer", name: "Napačen plačnik" }).returning({ id: counterpartiesTable.id });
    expect((await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 20, { counterpartyId: wrongPayer.id }))).status).toBe(400);
    const partial = await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 40));
    expect(partial.status).toBe(201);
    expect((await supertest(app).post(`/companies/${companyId}/payments/${partial.body.id}/post`)).status).toBe(200);
    expect((await supertest(app).get(`/companies/${companyId}/open-items`).query({ sspOnly: true, asOfDate: "2026-03-31" })).body.items.find((i: any) => i.invoiceId === target).remainingAmount).toBe("100.00");
    expect((await supertest(app).get(`/companies/${companyId}/open-items`).query({ sspOnly: true, asOfDate: "2026-04-01" })).body.items.find((i: any) => i.invoiceId === target).remainingAmount).toBe("60.00");
    const full = await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 60, { paymentDate: "2026-04-02" }));
    expect(full.status).toBe(201);
    expect((await supertest(app).post(`/companies/${companyId}/payments/${full.body.id}/post`)).status).toBe(200);
  });

  it("ob knjiženju ponovno preveri povezano temeljnico in prepreči prekomerno poravnavo", async () => {
    const linked = await entry("posted");
    const target = await invoice(`POS-SSP-2026-03-01-E${unitId}`, linked, 50);
    const draft = await supertest(app).post(`/companies/${companyId}/payments`).send(paymentPayload(target, 50));
    expect(draft.status).toBe(201);
    await db.update(journalEntriesTable).set({ status: "draft" }).where(eq(journalEntriesTable.id, linked));
    expect((await supertest(app).post(`/companies/${companyId}/payments/${draft.body.id}/post`)).status).toBe(400);
    await db.update(journalEntriesTable).set({ status: "posted" }).where(eq(journalEntriesTable.id, linked));
    const invalidBank = await account("7602", "revenue");
    await db.update(paymentsTable).set({ bankAccountId: invalidBank }).where(eq(paymentsTable.id, draft.body.id));
    expect((await supertest(app).post(`/companies/${companyId}/payments/${draft.body.id}/post`)).status).toBe(400);
    await db.update(paymentsTable).set({ bankAccountId: bankId }).where(eq(paymentsTable.id, draft.body.id));
    const [alreadyPaid] = await db.insert(paymentsTable).values({
      companyId, counterpartyId: payerId, periodId, direction: "inbound", paymentDate: "2026-04-01",
      amount: "20.00", bankAccountId: bankId, arApAccountId: sspAccountId, status: "posted", createdBy: TEST_USER,
    }).returning({ id: paymentsTable.id });
    await db.insert(paymentAllocationsTable).values({ paymentId: alreadyPaid.id, invoiceId: target, allocatedAmount: "20.00" });
    expect((await supertest(app).post(`/companies/${companyId}/payments/${draft.body.id}/post`)).status).toBe(400);
  });
});