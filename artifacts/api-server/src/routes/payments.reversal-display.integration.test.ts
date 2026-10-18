import { afterAll, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => ({ tx: null as any, getUserList: vi.fn(), warn: vi.fn() }));
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUserList: isolation.getUserList } } }));
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
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = "TEST-payment-reversal-display"; next(); },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable, accountsTable,
  counterpartiesTable, paymentsTable, journalEntriesTable, journalEntryLinesTable, auditLogTable,
} from "@workspace/db";
import router from "./payments";

const app = express();
app.use(express.json(), router);
app.request.log = { warn: isolation.warn } as any;
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));
afterAll(() => pool.end());

describe("payment list and detail reversal evidence", () => {
  it("returns actual void timestamps and same-company reversal links, without changing history", async () => {
    isolation.getUserList.mockResolvedValue({ data: [{
      id: "TEST-payment-reversal-display", firstName: "Testni", lastName: "Računovodja",
      emailAddresses: [],
    }] });
    const rollback = new Error("rollback payment display fixtures");
    let testCompanyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, otherCompany] = await db.insert(companiesTable).values([
          { podjetjeDavcna: `TEST_DISPLAY_${Date.now()}`, naziv: "TEST payment display" },
          { podjetjeDavcna: `TEST_DISPLAY_OTHER_${Date.now()}`, naziv: "TEST other company" },
        ]).returning();
        testCompanyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId: company.id, clerkUserId: "TEST-payment-reversal-display", role: "viewer",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId: company.id, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
        }).returning();
        const [bank, ar] = await db.insert(accountsTable).values([
          { companyId: company.id, code: "1100", name: "Bank", type: "asset" },
          { companyId: company.id, code: "1200", name: "AR", type: "asset" },
        ]).returning();
        const [partner] = await db.insert(counterpartiesTable).values({
          companyId: company.id, name: "TEST partner", type: "customer",
        }).returning();
        const entryValues = {
          companyId: company.id, periodId: period.id, entryDate: "2026-01-05",
          description: "TEST payment journal", createdBy: "TEST-payment-reversal-display",
        };
        const [original] = await db.insert(journalEntriesTable).values({ ...entryValues, status: "posted" }).returning();
        await db.insert(journalEntryLinesTable).values([
          { entryId: original.id, accountId: bank.id, side: "debit", amount: "20.00", sequence: 1 },
          { entryId: original.id, accountId: ar.id, side: "credit", amount: "20.00", sequence: 2 },
        ]);
        const paymentValues = {
          companyId: company.id, counterpartyId: partner.id, periodId: period.id,
          direction: "inbound" as const, paymentDate: "2026-01-05", amount: "20.00",
          bankAccountId: bank.id, arApAccountId: ar.id, createdBy: "TEST-payment-reversal-display",
        };
        const [payment, legacyVoid] = await db.insert(paymentsTable).values([
          { ...paymentValues, status: "posted", linkedEntryId: original.id },
          { ...paymentValues, status: "void" },
        ]).returning();
        const detailUrl = `/companies/${company.id}/payments/${payment.id}`;
        const listUrl = `/companies/${company.id}/payments`;
        const posted = await request(app).get(detailUrl).expect(200);
        expect(posted.body).toMatchObject({ status: "posted", voidedAt: null, reversalEntryId: null,
          voidReason: null, voidedBy: null, voidedByName: null });
        const unknown = await request(app).get(`${listUrl}/${legacyVoid.id}`).expect(200);
        expect(unknown.body).toMatchObject({ status: "void", voidedAt: null, reversalEntryId: null,
          voidReason: null, voidedBy: null, voidedByName: null });
        expect(isolation.getUserList).not.toHaveBeenCalled();

        // A viewer can inspect both endpoints, but cannot void a payment.
        await request(app).post(`${detailUrl}/void`).send({}).expect(403);
        await db.update(accountingRolesTable).set({ role: "owner" }).where(eq(accountingRolesTable.companyId, company.id));
        const voided = await request(app).post(`${detailUrl}/void`).send({ reason: "TEST incorrect payment" }).expect(200);
        expect(voided.body.status).toBe("void");
        expect(voided.body.reversalEntryId).toBeTruthy();
        const [audit] = await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, payment.id));
        expect(new Date(voided.body.voidedAt).toISOString()).toBe(audit.changedAt.toISOString());
        const [reversal] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, voided.body.reversalEntryId));
        expect(reversal.reversalOf).toBe(original.id);
        await db.insert(auditLogTable).values([
          { companyId: otherCompany.id, entityType: "payment", entityId: payment.id,
            action: "void", changedBy: "PRIVATE-actor", payload: { reason: "PRIVATE reason" },
            changedAt: new Date("2020-01-01T00:00:00Z") },
          { companyId: company.id, entityType: "invoice", entityId: payment.id,
            action: "void", changedBy: "wrong-entity", payload: { reason: "Wrong entity" },
            changedAt: new Date("2020-01-01T00:00:00Z") },
          { companyId: company.id, entityType: "payment", entityId: payment.id,
            action: "post", changedBy: "wrong-action", payload: { reason: "Wrong action" },
            changedAt: new Date("2020-01-01T00:00:00Z") },
          { companyId: company.id, entityType: "payment", entityId: payment.id,
            action: "void", changedBy: "later-actor", payload: { reason: "Later audit" },
            changedAt: new Date("2099-01-01T00:00:00Z") },
        ]);
        const detail = await request(app).get(detailUrl).expect(200);
        expect(detail.body).toMatchObject({
          voidReason: "TEST incorrect payment", voidedBy: "TEST-payment-reversal-display",
          voidedByName: "Testni Računovodja",
        });
        expect(isolation.getUserList).toHaveBeenLastCalledWith({
          userId: ["TEST-payment-reversal-display"], limit: 1,
        });
        // Lookup failures or deleted users must not hide the payment or invent an actor.
        isolation.getUserList.mockRejectedValueOnce(new Error("directory unavailable"));
        const unavailable = await request(app).get(detailUrl).expect(200);
        expect(unavailable.body).toMatchObject({ voidReason: "TEST incorrect payment",
          voidedBy: "TEST-payment-reversal-display", voidedByName: null });
        expect(isolation.warn).toHaveBeenCalled();
        isolation.getUserList.mockResolvedValueOnce({ data: [] });
        expect((await request(app).get(detailUrl).expect(200)).body.voidedByName).toBeNull();
        isolation.getUserList.mockResolvedValueOnce({ data: [{
          id: "TEST-payment-reversal-display", firstName: null, lastName: " ",
          primaryEmailAddressId: "primary",
          emailAddresses: [{ id: "primary", emailAddress: "accountant@example.test" }],
        }] });
        expect((await request(app).get(detailUrl).expect(200)).body.voidedByName).toBe("accountant@example.test");
        const list = await request(app).get(`${listUrl}?status=void`).expect(200);
        expect(list.body.payments.find((row: any) => row.id === payment.id)).toMatchObject({
          status: "void", voidedAt: detail.body.voidedAt, reversalEntryId: reversal.id,
        });
        expect(new Set(list.body.payments.map((row: any) => row.id)).size).toBe(list.body.payments.length);

        // Imported history derives status from the source journal, and uses
        // reversal creation when there was no payment-level void operation.
        const [historical] = await db.insert(paymentsTable).values({
          ...paymentValues, status: "posted", linkedEntryId: original.id, createdBy: "bookie-old-payment-import",
        }).returning();
        // Neither audit nor reversal evidence from a different tenant may leak.
        await db.insert(auditLogTable).values({
          companyId: otherCompany.id, entityType: "payment", entityId: historical.id,
          action: "void", changedBy: "TEST", changedAt: new Date("2020-01-01T00:00:00Z"),
          payload: { reason: "PRIVATE other tenant reason" },
        });
        await db.insert(journalEntriesTable).values({
          ...entryValues, companyId: otherCompany.id, status: "posted", reversalOf: original.id,
          createdAt: new Date("2020-01-01T00:00:00Z"),
        });
        const history = await request(app).get(`${listUrl}/${historical.id}`).expect(200);
        expect(history.body).toMatchObject({ status: "void", reversalEntryId: reversal.id,
          voidReason: null, voidedBy: null, voidedByName: null });
        expect(isolation.getUserList.mock.calls.every(([args]) =>
          args.userId.length === 1 && args.userId[0] === "TEST-payment-reversal-display")).toBe(true);
        expect(new Date(history.body.voidedAt).toISOString()).toBe(reversal.createdAt.toISOString());
        const historyList = await request(app).get(`${listUrl}?status=void`).expect(200);
        expect(historyList.body.payments.find((row: any) => row.id === historical.id)).toMatchObject({
          voidedAt: history.body.voidedAt, reversalEntryId: reversal.id,
        });
        await request(app).get(`/companies/${otherCompany.id}/payments/${payment.id}`).expect(403);
        await db.insert(accountingRolesTable).values({
          companyId: otherCompany.id, clerkUserId: "TEST-payment-reversal-display", role: "viewer",
        });
        isolation.getUserList.mockClear();
        await request(app).get(`/companies/${otherCompany.id}/payments/${payment.id}`).expect(404);
        expect(isolation.getUserList).not.toHaveBeenCalled();
        await db.update(accountingRolesTable).set({ role: "viewer" })
          .where(eq(accountingRolesTable.companyId, company.id));
        expect((await request(app).get(detailUrl).expect(200)).body.voidedByName).toBe("Testni Računovodja");
        await db.update(accountingRolesTable).set({ role: "owner" })
          .where(eq(accountingRolesTable.companyId, company.id));
        const [withoutJournal] = await db.insert(paymentsTable).values({ ...paymentValues, status: "posted" }).returning();
        const noJournalVoid = await request(app).post(`${listUrl}/${withoutJournal.id}/void`).send({}).expect(200);
        expect(noJournalVoid.body).toMatchObject({ status: "void", reversalEntryId: null });
        expect(Number.isNaN(new Date(noJournalVoid.body.voidedAt).getTime())).toBe(false);
        expect((await request(app).get(`${listUrl}/${withoutJournal.id}`).expect(200)).body).toMatchObject({
          voidReason: null, voidedBy: "TEST-payment-reversal-display", voidedByName: "Testni Računovodja",
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    // All writes, including nested void transactions and audit rows, roll back.
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, testCompanyId))).toHaveLength(0);
  });
});
