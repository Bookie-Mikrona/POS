import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

const isolation = vi.hoisted(() => ({ root: null as any, tx: null as any }));
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");
  isolation.root = actual.db;
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, key) {
        const executor = isolation.tx ?? actual.db;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "bank-registration-test";
    next();
  },
}));

import {
  db, pool, companiesTable, accountingRolesTable, accountsTable,
  bankStatementsTable, bankStatementLinesTable, paymentsTable, journalEntriesTable,
} from "@workspace/db";
import router from "./bankStatements";

const app = express();
app.use(express.json(), router);
app.use((error: any, _req: any, res: any, _next: any) => {
  res.status(error.status ?? 500).json({ error: error.message });
});
afterAll(() => pool.end());

it("registers and reads the complete statement without touching payments; denies duplicate and foreign imports", async () => {
  const companyId = randomUUID();
  const foreignCompanyId = randomUUID();
  const rollback = new Error("rollback isolated bank registration test");
  try {
    await isolation.root.transaction(async (tx: any) => {
      isolation.tx = tx;
      await db.insert(companiesTable).values([
        { id: companyId, naziv: "TEST bank registration", podjetjeDavcna: `TEST_${randomUUID()}` },
        { id: foreignCompanyId, naziv: "TEST foreign bank", podjetjeDavcna: `TEST_${randomUUID()}` },
      ]);
      await db.insert(accountingRolesTable).values({
        companyId, clerkUserId: "bank-registration-test", role: "owner",
      });
      const [bank] = await db.insert(accountsTable).values({
        companyId, code: "1100000", name: "Test bank", type: "asset",
      }).returning();
      const body = {
        bankAccountId: bank.id, sourceFilename: "test-statement.csv", sourceSha256: "a".repeat(64),
        metadata: { statementNumber: "001", openingBalance: "100.00", closingBalance: "115.00" },
        transactions: [
          { id: "debit", date: "2026-10-02", amount: -10, currency: "EUR", reference: "REF-1", counterpartyName: "Test supplier", counterpartyIban: null, description: "Test debit" },
          { id: "credit", date: "2026-10-01", amount: 25, currency: "EUR", reference: null, counterpartyName: "Test buyer", counterpartyIban: null, description: "Test credit" },
        ],
      };
      const registerUrl = `/companies/${companyId}/bank-statements/register`;
      const registered = await request(app).post(registerUrl).send(body);
      expect(registered.status).toBe(201);
      expect(Object.keys(registered.body.lineIds).sort()).toEqual(["credit", "debit"]);
      const [stored] = await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.companyId, companyId));
      expect(stored).toMatchObject({
        id: registered.body.statementId, createdBy: "bank-registration-test", sourceSha256: body.sourceSha256,
        periodFrom: "2026-10-01", periodTo: "2026-10-02", statementDate: "2026-10-02",
        openingBalance: "100.00", closingBalance: "115.00",
      });
      const lines = await db.select().from(bankStatementLinesTable).where(eq(bankStatementLinesTable.statementId, stored.id));
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: registered.body.lineIds.debit, transactionKey: "debit", amount: "-10.00", lineNumber: 1 }),
        expect.objectContaining({ id: registered.body.lineIds.credit, transactionKey: "credit", amount: "25.00", lineNumber: 2 }),
      ]));
      const detail = await request(app).get(`/companies/${companyId}/bank-statements/detail/${stored.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(stored.id);
      expect(detail.body.lines.map((line: any) => line.id)).toEqual([
        registered.body.lineIds.debit, registered.body.lineIds.credit,
      ]);
      expect((await request(app).get(`/companies/${foreignCompanyId}/bank-statements/detail/${stored.id}`)).status).toBe(403);
      expect((await request(app).post(`/companies/${foreignCompanyId}/bank-statements/register`).send(body)).status).toBe(403);
      expect((await request(app).post(registerUrl).send(body)).status).toBe(409);
      expect(await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.companyId, companyId))).toHaveLength(1);
      expect(await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId))).toHaveLength(0);
      expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).toHaveLength(0);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    isolation.tx = null;
  }
  expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toHaveLength(0);
});
