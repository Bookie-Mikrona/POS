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
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, paymentsTable, bankStatementsTable, bankStatementLinesTable,
} from "@workspace/db";
import router from "./payments";
import bankStatementsRouter from "./bankStatements";

const app = express();
app.use(express.json(), router, bankStatementsRouter);
afterAll(() => pool.end());

describe("company-scoped batch payment status contract", () => {
  it("registers statement lines and reads the company-scoped detail without altering payments", async () => {
    const rollback = new Error("ROLLBACK statement registration fixtures");
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, other] = await db.insert(companiesTable).values([
          { naziv: "TEST statement registration", podjetjeDavcna: "TEST-status-register" },
          { naziv: "TEST foreign statement detail", podjetjeDavcna: "TEST-status-detail" },
        ]).returning();
        const user = "TEST-statement-registration";
        await db.insert(accountingRolesTable).values([
          { companyId: company.id, clerkUserId: user, role: "owner" },
          { companyId: other.id, clerkUserId: user, role: "owner" },
        ]);
        const [bank] = await db.insert(accountsTable).values({
          companyId: company.id, code: "1100", name: "TEST Bank", type: "asset",
        }).returning();
        const transactions = [
          { id: "incoming", date: "2026-09-02", amount: 20.25, currency: "EUR",
            reference: "SI00 1", counterpartyName: "TEST Customer", counterpartyIban: null, description: "Incoming" },
          { id: "outgoing", date: "2026-09-03", amount: -5, currency: "EUR",
            reference: null, counterpartyName: "TEST Supplier", counterpartyIban: null, description: "Outgoing" },
        ];
        const result = await request(app).post(`/companies/${company.id}/bank-statements/register`)
          .set("x-test-user", user).send({
            bankAccountId: bank.id, sourceFilename: "TEST-statement.xml", sourceSha256: "a".repeat(64),
            metadata: { statementNumber: "TEST-1", openingBalance: 100, closingBalance: 115.25 },
            transactions,
          }).expect(201);
        expect(Object.keys(result.body.lineIds).sort()).toEqual(["incoming", "outgoing"]);
        const [stored] = await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.id, result.body.statementId));
        expect(stored).toMatchObject({
          companyId: company.id, bankAccountId: bank.id, statementNumber: "TEST-1",
          openingBalance: "100.00", closingBalance: "115.25",
          statementDate: "2026-09-03", periodFrom: "2026-09-02", periodTo: "2026-09-03",
          sourceFilename: "TEST-statement.xml", createdBy: user,
        });
        const storedLines = await db.select().from(bankStatementLinesTable)
          .where(eq(bankStatementLinesTable.statementId, stored.id)).orderBy(bankStatementLinesTable.lineNumber);
        expect(storedLines.map(line => [line.id, line.transactionKey, line.lineNumber, line.amount])).toEqual([
          [result.body.lineIds.incoming, "incoming", 1, "20.25"],
          [result.body.lineIds.outgoing, "outgoing", 2, "-5.00"],
        ]);
        const detailUrl = `/companies/${company.id}/bank-statements/detail/${stored.id}`;
        const detail = await request(app).get(detailUrl).set("x-test-user", user).expect(200);
        expect(detail.body).toMatchObject({
          id: stored.id, statementNumber: "TEST-1", bankAccountCode: "1100", historicalLedger: null,
          lines: [
            { id: storedLines[0].id, lineNumber: 1, bookingDate: "2026-09-02", amount: "20.25" },
            { id: storedLines[1].id, lineNumber: 2, bookingDate: "2026-09-03", amount: "-5.00" },
          ],
        });
        expect(await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, company.id))).toEqual([]);
        await request(app).get(detailUrl).expect(401);
        await request(app).get(detailUrl).set("x-test-user", "TEST-no-role").expect(403);
        await request(app).get(`/companies/${other.id}/bank-statements/detail/${stored.id}`)
          .set("x-test-user", user).expect(404);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
  });

  it("authenticates, isolates tenants, and bounds the ID list using real SQL", async () => {
    const rollback = new Error("ROLLBACK status contract fixtures");
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, other] = await db.insert(companiesTable).values([
          { naziv: "TEST payment statuses", podjetjeDavcna: "TEST-statuses" },
          { naziv: "TEST foreign payment statuses", podjetjeDavcna: "TEST-foreign-statuses" },
        ]).returning();
        const user = "TEST-payment-statuses";
        await db.insert(accountingRolesTable).values({
          companyId: company.id, clerkUserId: user, role: "viewer",
        });
        const payments: { id: string; status: string }[] = [];
        for (const tenant of [company, other]) {
          const [period] = await db.insert(accountingPeriodsTable).values({
            companyId: tenant.id, name: "TEST 2026", startDate: "2026-01-01", endDate: "2026-12-31",
          }).returning();
          const [bank, ar] = await db.insert(accountsTable).values([
            { companyId: tenant.id, code: "1100", name: "Bank", type: "asset" },
            { companyId: tenant.id, code: "1200", name: "AR", type: "asset" },
          ]).returning();
          const [partner] = await db.insert(counterpartiesTable).values({
            companyId: tenant.id, name: "TEST partner", type: "customer",
          }).returning();
          const common = {
            companyId: tenant.id, counterpartyId: partner.id, periodId: period.id,
            direction: "inbound" as const, paymentDate: "2026-01-05", amount: "20.00",
            bankAccountId: bank.id, arApAccountId: ar.id, createdBy: user,
          };
          const rows = await db.insert(paymentsTable).values([
            { ...common, status: "posted" }, { ...common, status: "draft" },
          ]).returning({ id: paymentsTable.id, status: paymentsTable.status });
          payments.push(...rows);
        }
        const url = `/companies/${company.id}/payments/statuses`;
        const ids = payments.map(payment => payment.id);
        await request(app).post(url).send({ paymentIds: ids }).expect(401);
        await request(app).post(url).set("x-test-user", "TEST-no-role").send({ paymentIds: ids }).expect(403);
        await request(app).post(`/companies/${other.id}/payments/statuses`)
          .set("x-test-user", user).send({ paymentIds: ids }).expect(403);

        const result = await request(app).post(url).set("x-test-user", user)
          .send({ paymentIds: [...ids, "00000000-0000-4000-a000-000000000000"] }).expect(200);
        expect(result.headers["cache-control"]).toBe("no-store");
        expect(result.body.payments).toHaveLength(2);
        expect(result.body.payments).toEqual(expect.arrayContaining(payments.slice(0, 2)));
        expect(Object.keys(result.body.payments[0]).sort()).toEqual(["id", "status"]);
        const duplicates = await request(app).post(url).set("x-test-user", user)
          .send({ paymentIds: [ids[0], ids[0]] }).expect(200);
        expect(duplicates.body.payments).toEqual([payments[0]]);
        await request(app).post(url).set("x-test-user", user)
          .send({ paymentIds: [ids[0], ...Array(499).fill(ids[1])] }).expect(200);
        for (const body of [{}, { paymentIds: [] }, { paymentIds: ["not-a-uuid"] },
          { paymentIds: [123] }, { paymentIds: Array(501).fill(ids[0]) }]) {
          await request(app).post(url).set("x-test-user", user).send(body).expect(400);
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
  });
});
