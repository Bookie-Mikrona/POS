import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  accountingRolesTable,
  accountsTable,
  bankStatementsTable,
} from "@workspace/db";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "test-bank-history";
    next();
  },
}));

import ledgerRouter from "./ledger";

const app = express();
app.use(ledgerRouter);
let companyId: string;
let otherCompanyId: string;

async function addStatement(company: string, account: string, date: string, balance: string) {
  await db.insert(bankStatementsTable).values({
    companyId: company,
    bankAccountId: account,
    statementDate: date,
    closingBalance: balance,
    sourceFilename: `${date}.csv`,
    sourceSha256: `${company}-${account}-${date}-${balance}`,
    createdBy: "test-bank-history",
  });
}

describe("GET bank-balance-history", () => {
  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2);
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `HISTORY_${suffix}`, naziv: "History",
    }).returning({ id: companiesTable.id });
    const [other] = await db.insert(companiesTable).values({
      podjetjeDavcna: `HISTORY_OTHER_${suffix}`, naziv: "Other history",
    }).returning({ id: companiesTable.id });
    companyId = company.id;
    otherCompanyId = other.id;
    await db.insert(accountingRolesTable).values({
      companyId, clerkUserId: "test-bank-history", role: "owner",
    });
    const [a, b] = await db.insert(accountsTable).values([
      { companyId, code: "1100", name: "A", type: "asset" },
      { companyId, code: "1101", name: "B", type: "asset" },
      { companyId: otherCompanyId, code: "1100", name: "Other", type: "asset" },
    ]).returning({ id: accountsTable.id });
    await addStatement(companyId, a.id, "2026-09-01", "100.00");
    await addStatement(companyId, b.id, "2026-09-02", "40.00");
    await addStatement(companyId, a.id, "2026-09-03", "90.00");
    // This statement must never leak into the requested company's total.
    const [otherAccount] = await db.select({ id: accountsTable.id })
      .from(accountsTable).where(eq(accountsTable.companyId, otherCompanyId));
    await addStatement(otherCompanyId, otherAccount.id, "2026-09-03", "999.00");
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId].filter(Boolean)) {
      await db.delete(bankStatementsTable).where(eq(bankStatementsTable.companyId, id));
      await db.delete(accountsTable).where(eq(accountsTable.companyId, id));
      await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, id));
      await db.delete(companiesTable).where(eq(companiesTable.id, id));
    }
  });

  it("returns daily evidenced balances only when all accounts are covered", async () => {
    const response = await request(app).get(`/companies/${companyId}/bank-balance-history`)
      .query({ dateFrom: "2026-09-01", dateTo: "2026-09-04" });
    expect(response.status).toBe(200);
    expect(response.body.points).toEqual([
      { date: "2026-09-02", balance: "140.00" },
      { date: "2026-09-03", balance: "130.00" },
    ]);
  });

  it("rejects invalid ranges and denies access to another company", async () => {
    const invalid = await request(app).get(`/companies/${companyId}/bank-balance-history`)
      .query({ dateFrom: "2026-09-30", dateTo: "2026-09-01" });
    expect(invalid.status).toBe(400);
    const forbidden = await request(app).get(`/companies/${otherCompanyId}/bank-balance-history`)
      .query({ dateFrom: "2026-09-01", dateTo: "2026-09-04" });
    expect(forbidden.status).toBe(403);
  });
});