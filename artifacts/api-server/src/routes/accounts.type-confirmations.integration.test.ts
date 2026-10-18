import { afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tx: null as any, actor: "test-account-confirmer", failAudit: false }));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  const wrap = (executor: any): any => new Proxy(executor, {
    get(_target, key) {
      if (key === "transaction") return (run: (tx: any) => unknown) => executor.transaction((tx: any) => run(wrap(tx)));
      if (key === "insert" && state.failAudit) return (table: unknown) => {
        const builder = executor.insert(table);
        if (table !== actual.accountTypeConfirmationsTable) return builder;
        return { values: (values: any) => builder.values(
          Array.isArray(values) ? values.map(v => ({ ...v, actorId: null })) : { ...values, actorId: null },
        ) };
      };
      const value = executor[key];
      return typeof value === "function" ? value.bind(executor) : value;
    },
  });
  return { ...actual, db: new Proxy(actual.db, {
    get(target, key) { return wrap(state.tx ?? target)[key]; },
  }) };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = state.actor; next(); },
}));
vi.mock("../lib/companyChartOfAccounts", () => ({
  COMPANY_CHART_OF_ACCOUNTS: [
    { code: "400", name: "Potrjena uvozna izjema", type: "asset", allowsPosting: false },
    { code: "4000000", name: "Usklajen konto", type: "expense", allowsPosting: true },
    { code: "7600000", name: "Druga uvozna izjema", type: "equity", allowsPosting: true },
  ],
  getCompanyParentCodeMap: () => new Map([["4000000", "400"]]),
}));
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool, companiesTable, accountingRolesTable, accountsTable, accountTypeConfirmationsTable } from "@workspace/db";
import router from "./accounts";

const app = express();
app.use(express.json(), router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "Save failed" });
});
afterAll(() => pool.end());

describe("durable tenant-scoped account exception confirmations", () => {
  it("stores create/edit/import snapshots atomically, isolates tenants and never reuses consent", async () => {
    const rollback = new Error("rollback confirmation fixtures");
    const tax = `TEST-CONFIRM-${crypto.randomUUID()}`;
    try {
      await db.transaction(async tx => {
        state.tx = tx;
        const [company, other, imported] = await tx.insert(companiesTable).values(
          ["manual", "other", "import"].map(suffix => ({ naziv: suffix, podjetjeDavcna: `${tax}-${suffix}` })),
        ).returning();
        await tx.insert(accountingRolesTable).values([company, other, imported].map(c => ({
          companyId: c.id, clerkUserId: state.actor!, role: "accountant" as const,
        })));
        const url = `/companies/${company.id}/accounts`;
        const input = { code: "4000000", name: "Izjema", type: "asset" };
        const confirmations = () => tx.select().from(accountTypeConfirmationsTable)
          .where(eq(accountTypeConfirmationsTable.companyId, company.id));
        await request(app).post(url).send(input).expect(422);
        expect(await confirmations()).toHaveLength(0);
        const account = (await request(app).post(url).send({ ...input, confirmTypeException: true }).expect(201)).body;
        let history = (await request(app).get(`${url}/${account.id}/type-confirmations`).expect(200)).body;
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          companyId: company.id, accountId: account.id, actorId: state.actor,
          code: input.code, selectedType: "asset", expectedType: "expense", source: "create",
        });
        expect(Number.isNaN(Date.parse(history[0].confirmedAt))).toBe(false);
        await request(app).patch(`${url}/${account.id}`).send({ type: "revenue" }).expect(422);
        await request(app).patch(`${url}/${account.id}`).send({ type: "revenue", confirmTypeException: true }).expect(200);
        await request(app).patch(`${url}/${account.id}`).send({ name: "Nov naziv" }).expect(422);
        await request(app).patch(`${url}/${account.id}`).send({ type: "expense" }).expect(200);
        history = (await request(app).get(`${url}/${account.id}/type-confirmations`).expect(200)).body;
        expect(history).toHaveLength(2);
        expect(history).toContainEqual(expect.objectContaining({ selectedType: "revenue", expectedType: "expense", source: "update" }));
        expect(history).toContainEqual(expect.objectContaining({ selectedType: "asset", source: "create" }));
        await request(app).get(`/companies/${other.id}/accounts/${account.id}/type-confirmations`).expect(404);
        await request(app).patch(`/companies/${other.id}/accounts/${account.id}`).send({ type: "asset", confirmTypeException: true }).expect(404);
        state.actor = "unauthorized";
        await request(app).get(`${url}/${account.id}/type-confirmations`).expect(403);
        state.actor = "test-account-confirmer";
        await tx.update(accountingRolesTable).set({ role: "viewer" }).where(eq(accountingRolesTable.companyId, company.id));
        await request(app).get(`${url}/${account.id}/type-confirmations`).expect(200);
        await request(app).patch(`${url}/${account.id}`).send({ type: "asset", confirmTypeException: true }).expect(403);
        await tx.update(accountingRolesTable).set({ role: "accountant" }).where(eq(accountingRolesTable.companyId, company.id));

        // Fail only the audit insert, using a real DB NOT NULL violation.
        state.failAudit = true;
        await request(app).patch(`${url}/${account.id}`).send({ name: "Must roll back", type: "asset", confirmTypeException: true }).expect(500);
        await request(app).post(url).send({ ...input, code: "4010000", confirmTypeException: true }).expect(500);
        state.failAudit = false;
        expect((await tx.select().from(accountsTable).where(eq(accountsTable.id, account.id)))[0].name).toBe("Izjema");
        expect((await tx.select().from(accountsTable).where(eq(accountsTable.companyId, company.id))).map(a => a.code)).toEqual([input.code]);
        expect(await confirmations()).toHaveLength(2);
        await expect(tx.transaction(async s => {
          await s.update(accountTypeConfirmationsTable).set({ actorId: "overwrite" }).where(eq(accountTypeConfirmationsTable.accountId, account.id));
        })).rejects.toThrow();
        await expect(tx.transaction(async s => {
          await s.delete(accountTypeConfirmationsTable).where(eq(accountTypeConfirmationsTable.accountId, account.id));
        })).rejects.toThrow();
        await expect(tx.transaction(async s => {
          await s.insert(accountTypeConfirmationsTable).values({
            companyId: other.id, accountId: account.id, actorId: state.actor!,
            code: input.code, selectedType: "asset", expectedType: "expense", source: "create",
          });
        })).rejects.toThrow();

        const seedUrl = `/companies/${imported.id}/accounts/seed`;
        await request(app).post(seedUrl).send({}).expect(422);
        expect(await tx.select().from(accountsTable).where(eq(accountsTable.companyId, imported.id))).toHaveLength(0);
        state.failAudit = true;
        await request(app).post(seedUrl).send({ confirmTypeException: true }).expect(500);
        state.failAudit = false;
        expect(await tx.select().from(accountsTable).where(eq(accountsTable.companyId, imported.id))).toHaveLength(0);
        await request(app).post(seedUrl).send({ confirmTypeException: true }).expect(201);
        const seedHistory = await tx.select().from(accountTypeConfirmationsTable).where(eq(accountTypeConfirmationsTable.companyId, imported.id));
        expect(seedHistory).toHaveLength(2);
        expect(seedHistory.map(h => h.code).sort()).toEqual(["400", "7600000"]);
        expect(seedHistory.every(h => h.source === "import" && h.actorId === state.actor)).toBe(true);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      state.tx = null;
      state.failAudit = false;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.podjetjeDavcna, `${tax}-manual`))).toHaveLength(0);
  });
});
