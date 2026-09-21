import { afterAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-payment-balance-user";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = USER_ID;
    next();
  },
}));

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
  paymentsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  bankStatementsTable,
  bankStatementLinesTable,
} from "@workspace/db";
import paymentsRouter from "./payments";

describe("supplier payment bank balance control", () => {
  const ids: { companyId?: string; entryId?: string } = {};

  afterAll(async () => {
    if (ids.entryId) {
      await db.delete(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, ids.entryId));
      await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, ids.entryId));
    }
    if (ids.companyId) {
      await db.delete(companiesTable).where(eq(companiesTable.id, ids.companyId));
    }
    await pool.end();
  });

  it("uses the latest bank-statement closing balance instead of the 110 ledger balance", async () => {
    const run = Math.random().toString(36).slice(2, 10);
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `BAL-${run}`,
      naziv: "Test stanje TRR",
    }).returning({ id: companiesTable.id });
    ids.companyId = company.id;
    await db.insert(accountingRolesTable).values({ companyId: company.id, clerkUserId: USER_ID, role: "owner" });
    const [period] = await db.insert(accountingPeriodsTable).values({
      companyId: company.id,
      name: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "open",
    }).returning({ id: accountingPeriodsTable.id });
    const [bank] = await db.insert(accountsTable).values({
      companyId: company.id, code: "1100000", name: "TRR", type: "asset",
    }).returning({ id: accountsTable.id });
    const [payable] = await db.insert(accountsTable).values({
      companyId: company.id, code: "2200000", name: "Dobavitelji", type: "liability",
    }).returning({ id: accountsTable.id });
    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId: company.id, type: "supplier", name: "Dobavitelj",
    }).returning({ id: counterpartiesTable.id });
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId: company.id,
      periodId: period.id,
      entryDate: "2026-09-11",
      description: "Začetno stanje TRR",
      status: "posted",
      sourceType: "manual",
      createdBy: USER_ID,
    }).returning({ id: journalEntriesTable.id });
    ids.entryId = entry.id;
    await db.insert(journalEntryLinesTable).values({
      entryId: entry.id,
      accountId: bank.id,
      side: "debit",
      amount: "100.00",
    });

    const app = express();
    app.use(express.json());
    app.use(paymentsRouter);
    const missingEvidenceResponse = await supertest(app)
      .post(`/companies/${company.id}/payments`)
      .send({
        counterpartyId: supplier.id,
        periodId: period.id,
        direction: "outbound",
        paymentDate: "2026-09-11",
        amount: 10,
        bankAccountId: bank.id,
        arApAccountId: payable.id,
      });

    expect(missingEvidenceResponse.status).toBe(400);
    expect(missingEvidenceResponse.body.error).toContain("ni evidentiranega končnega stanja");

    const [statement] = await db.insert(bankStatementsTable).values({
      companyId: company.id,
      bankAccountId: bank.id,
      sourceIban: "SI56191000000123456",
      statementNumber: "2026-09",
      statementDate: "2026-09-11",
      periodTo: "2026-09-11",
      closingBalance: "50.00",
      currency: "EUR",
      sourceFilename: "camt053.xml",
      sourceSha256: "a".repeat(64),
      createdBy: USER_ID,
    }).returning({ id: bankStatementsTable.id });

    const response = await supertest(app)
      .post(`/companies/${company.id}/payments`)
      .send({
        counterpartyId: supplier.id,
        periodId: period.id,
        direction: "outbound",
        paymentDate: "2026-09-11",
        amount: 60,
        bankAccountId: bank.id,
        arApAccountId: payable.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("presega zadnje evidentirano stanje");
    expect(response.body.error).toContain("50.00");
    expect(await db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.companyId, company.id))).toHaveLength(0);

    const [statementLine] = await db.insert(bankStatementLinesTable).values({
      statementId: statement.id,
      transactionKey: "executed-outbound-payment",
      lineNumber: 1,
      bookingDate: "2026-09-11",
      amount: "-60.00",
      currency: "EUR",
    }).returning({ id: bankStatementLinesTable.id });

    const importedTransactionResponse = await supertest(app)
      .post(`/companies/${company.id}/payments`)
      .send({
        counterpartyId: supplier.id,
        periodId: period.id,
        direction: "outbound",
        paymentDate: "2026-09-11",
        amount: 60,
        bankAccountId: bank.id,
        bankStatementLineId: statementLine.id,
        arApAccountId: payable.id,
      });

    expect(importedTransactionResponse.status).toBe(201);
  });
});