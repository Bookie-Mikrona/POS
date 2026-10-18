import { afterAll, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = "TEST-bank-register"; next(); },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountsTable,
  bankStatementsTable, bankStatementLinesTable,
} from "@workspace/db";
import bankRouter from "./bankStatements";

const app = express().use(express.json(), bankRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));
afterAll(() => pool.end());

describe("bank statement registration with real persistence", () => {
  it("inserts the statement and its lines and returns their actual IDs", async () => {
    const rollback = new Error("rollback bank registration fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_REGISTER_${crypto.randomUUID()}`, naziv: "TEST statement registration",
        }).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-bank-register", role: "owner",
        });
        const [bank] = await db.insert(accountsTable).values({
          companyId, code: "1100", name: "Bank", type: "asset",
        }).returning();
        const transactions = [
          { id: "transaction-a", date: "2026-01-05", amount: -20.25, currency: "EUR",
            reference: "SI001", counterpartyName: "TEST supplier", counterpartyIban: "SI56000000000000000", description: "Payment" },
          { id: "transaction-b", date: "2026-01-06", amount: 30, currency: "EUR",
            reference: "SI002", counterpartyName: "TEST customer", counterpartyIban: null, description: "Receipt" },
        ];
        const response = await request(app)
          .post(`/companies/${companyId}/bank-statements/register`)
          .send({
            bankAccountId: bank.id, sourceFilename: "test-statement.csv",
            sourceSha256: "b".repeat(64),
            metadata: { statementNumber: "TEST-1", openingBalance: 100, closingBalance: 109.75, currency: "EUR" },
            transactions,
          }).expect(201);
        expect(response.body.statementId).toEqual(expect.any(String));
        expect(response.body.lineIds).toEqual({
          "transaction-a": expect.any(String), "transaction-b": expect.any(String),
        });
        const [statement] = await db.select().from(bankStatementsTable)
          .where(eq(bankStatementsTable.id, response.body.statementId));
        expect(statement).toMatchObject({
          companyId, bankAccountId: bank.id, statementNumber: "TEST-1",
          openingBalance: "100.00", closingBalance: "109.75",
          periodFrom: "2026-01-05", periodTo: "2026-01-06",
        });
        const lines = await db.select().from(bankStatementLinesTable)
          .where(eq(bankStatementLinesTable.statementId, statement.id));
        expect(lines).toHaveLength(2);
        for (const item of transactions) {
          expect(lines.find(line => line.id === response.body.lineIds[item.id])).toMatchObject({
            transactionKey: item.id, bookingDate: item.date,
            amount: item.amount.toFixed(2), reference: item.reference, description: item.description,
          });
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
  });
});
