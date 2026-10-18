import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  companiesTable,
  accountingRolesTable,
  accountingPeriodsTable,
  accountsTable,
  counterpartiesTable,
  invoicesTable,
  invoiceLinesTable,
  paymentsTable,
  paymentAllocationsTable,
  bankStatementsTable,
} from "@workspace/db";

// Only authentication is mocked: matching queries run against PostgreSQL.
const TEST_USER_ID = "bank-matching-integration-user";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_USER_ID;
    next();
  },
}));

import bankStatementsRouter from "./bankStatements";

const app = express();
app.use(express.json());
app.use(bankStatementsRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status ?? 500).json({ error: err.message });
});

let companyId: string | undefined;
let firstInvoiceId: string;
let secondInvoiceId: string;
let bankAccountId: string;
const partnerName = "Kupec integracijskega testa banke";

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_BANK_MATCH_${randomUUID()}`,
    naziv: "Test predlogov bančnih ujemanj",
  }).returning();
  companyId = company.id;

  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: TEST_USER_ID, role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "Test 2026", startDate: "2026-01-01",
    endDate: "2026-12-31", status: "open",
  }).returning();
  const [bank, receivables, revenue] = await db.insert(accountsTable).values([
    { companyId, code: "1100000", name: "Banka", type: "asset" },
    { companyId, code: "1200000", name: "Terjatve", type: "asset" },
    { companyId, code: "7600000", name: "Prihodki", type: "revenue" },
  ]).returning();
  bankAccountId = bank.id;
  const [partner] = await db.insert(counterpartiesTable).values({
    companyId, type: "customer", name: partnerName,
  }).returning();

  const [first, second] = await db.insert(invoicesTable).values(
    ["BANK-MATCH-001", "BANK-MATCH-002"].map(invoiceNumber => ({
      companyId: company.id,
      type: "issued" as const,
      counterpartyId: partner.id,
      periodId: period.id,
      invoiceNumber,
      invoiceDate: "2026-09-01",
      dueDate: "2026-09-30",
      status: "posted" as const,
      arApAccountId: receivables.id,
      createdBy: TEST_USER_ID,
    })),
  ).returning();
  firstInvoiceId = first.id;
  secondInvoiceId = second.id;

  // Gross totals: first = 122 + 122 = 244, second = 150 + 33 VAT = 183.
  await db.insert(invoiceLinesTable).values([
    { invoiceId: first.id, description: "Storitev A", quantity: "1.000",
      unitPrice: "100.0000", vatRate: "22.00", accountId: revenue.id },
    { invoiceId: first.id, description: "Storitev B", quantity: "2.000",
      unitPrice: "50.0000", vatRate: "22.00", accountId: revenue.id },
    { invoiceId: second.id, description: "Storitev C", quantity: "1.000",
      unitPrice: "150.0000", vatRate: "22.00", accountId: revenue.id },
  ]);

  const [paymentOne, paymentTwo] = await db.insert(paymentsTable).values(
    [{ amount: "40.00", paymentDate: "2026-09-05" },
      { amount: "60.00", paymentDate: "2026-09-10" }].map(payment => ({
      companyId: company.id,
      counterpartyId: partner.id,
      periodId: period.id,
      direction: "inbound" as const,
      bankAccountId: bank.id,
      arApAccountId: receivables.id,
      status: "posted" as const,
      createdBy: TEST_USER_ID,
      ...payment,
    })),
  ).returning();
  await db.insert(paymentAllocationsTable).values([
    { paymentId: paymentOne.id, invoiceId: first.id, allocatedAmount: "40.00" },
    { paymentId: paymentTwo.id, invoiceId: first.id, allocatedAmount: "35.00" },
    { paymentId: paymentTwo.id, invoiceId: second.id, allocatedAmount: "25.00" },
  ]);
});

afterAll(async () => {
  try {
    if (companyId) {
      const id = companyId;
      await db.transaction(async tx => {
        // Payments cascade to allocations; invoices cascade to invoice lines.
        await tx.delete(paymentsTable).where(eq(paymentsTable.companyId, id));
        await tx.delete(invoicesTable).where(eq(invoicesTable.companyId, id));
        await tx.delete(bankStatementsTable).where(eq(bankStatementsTable.companyId, id));
        await tx.delete(accountsTable).where(eq(accountsTable.companyId, id));
        await tx.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, id));
        await tx.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, id));
        await tx.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, id));
        await tx.delete(companiesTable).where(eq(companiesTable.id, id));
      });
    }
  } finally {
    await pool.end();
  }
});

describe("bank statement registration and detail", () => {
  it("registers the statement and every source line, then returns its tenant-scoped detail", async () => {
    const sourceSha256 = randomUUID().replaceAll("-", "").repeat(2);
    const payload = {
      bankAccountId, sourceFilename: "registration-test.csv", sourceSha256,
      metadata: { statementNumber: "TEST-REG", currency: "EUR" },
      transactions: [
        { id: "register-in", amount: 50 },
        { id: "register-out", amount: -20 },
      ].map(transaction => ({
        ...transaction, date: "2026-09-20", currency: "EUR", reference: null,
        counterpartyName: "Test", counterpartyIban: null, description: "Registration test",
      })),
    };
    const registered = await supertest(app)
      .post(`/companies/${companyId}/bank-statements/register`).send(payload);
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    expect(Object.keys(registered.body.lineIds).sort()).toEqual(["register-in", "register-out"]);
    const detail = await supertest(app)
      .get(`/companies/${companyId}/bank-statements/detail/${registered.body.statementId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.id).toBe(registered.body.statementId);
    expect(detail.body.sourceFilename).toBe(payload.sourceFilename);
    expect(detail.body.lines.map((line: { id: string }) => line.id).sort())
      .toEqual(Object.values(registered.body.lineIds).sort());
    const duplicate = await supertest(app)
      .post(`/companies/${companyId}/bank-statements/register`).send(payload);
    expect(duplicate.status).toBe(409);
  });
});

describe("POST bank-statements/match — več računov in delna plačila", () => {
  it("vrne bruto minus vsoto alokacij za vsak račun, ne vsote celotnih plačil", async () => {
    const response = await supertest(app)
      .post(`/companies/${companyId}/bank-statements/match`)
      .set("Accept", "application/json")
      .send({
        transactions: [
          { id: "tx-first", amount: 169, reference: "BANK-MATCH-001" },
          { id: "tx-second", amount: 158, reference: "BANK-MATCH-002" },
        ].map(transaction => ({
          ...transaction,
          date: "2026-09-20",
          counterpartyName: partnerName,
          counterpartyIban: null,
          description: null,
          currency: "EUR",
        })),
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.suggestions).toHaveLength(2);
    for (const [index, expected] of [
      { invoiceId: firstInvoiceId, invoiceNumber: "BANK-MATCH-001", remainingAmount: "169.00" },
      { invoiceId: secondInvoiceId, invoiceNumber: "BANK-MATCH-002", remainingAmount: "158.00" },
    ].entries()) {
      const result = response.body.suggestions[index];
      expect(result.duplicateOf).toBeUndefined();
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({ invoiceId: firstInvoiceId, remainingAmount: "169.00" }),
        expect.objectContaining({ invoiceId: secondInvoiceId, remainingAmount: "158.00" }),
      ]));
      expect(result.suggestions[0]).toMatchObject({
        ...expected,
        matchReasons: expect.arrayContaining([
          `Znesek se ujema (${expected.remainingAmount})`,
        ]),
      });
    }
  });
});