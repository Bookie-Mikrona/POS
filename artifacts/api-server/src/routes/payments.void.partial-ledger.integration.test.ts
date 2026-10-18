import { afterAll, describe, expect, it, vi } from "vitest";

// Keep HTTP handlers and their nested transactions on the same rollback-only
// transaction, including append-only audit records created by posting/voiding.
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
const USER = "TEST-two-payment-void-ledger";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = USER;
    next();
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, invoicesTable, invoiceLinesTable,
  paymentsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import paymentsRouter from "./payments";
import ledgerRouter from "./ledger";

const app = express();
app.use(express.json(), paymentsRouter, ledgerRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
  res.status(error.statusCode ?? error.status ?? 500).json({ error: error.message });
});
afterAll(() => pool.end());

describe("dve delni plačili istega računa s povezanima temeljnicama", () => {
  it("1000 € = 600 € + 400 €: razveljavitvi odpreta 400 € in nato 1000 € ter stornirata obe temeljnici", async () => {
    const rollback = new Error("rollback two-payment void fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_TWO_VOID_${Date.now()}`,
          naziv: "TEST two partial payment reversals",
        }).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: USER, role: "owner",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId, name: "2026", startDate: "2026-01-01",
          endDate: "2026-12-31", status: "open",
        }).returning();
        const [bank, ar, revenue] = await db.insert(accountsTable).values([
          { companyId, code: "1100", name: "Banka", type: "asset" },
          { companyId, code: "1200", name: "Terjatve", type: "asset" },
          { companyId, code: "7600", name: "Prihodki", type: "revenue" },
        ]).returning();
        const [partner] = await db.insert(counterpartiesTable).values({
          companyId, type: "customer", name: "TEST kupec z dvema plačiloma",
        }).returning();
        const [invoice] = await db.insert(invoicesTable).values({
          companyId, counterpartyId: partner.id, periodId: period.id,
          type: "issued", status: "posted", invoiceNumber: "TWO-VOID-1000",
          invoiceDate: "2026-02-01", dueDate: "2026-03-01",
          arApAccountId: ar.id, createdBy: USER,
        }).returning();
        await db.insert(invoiceLinesTable).values({
          invoiceId: invoice.id, description: "Testna storitev",
          quantity: "1.000", unitPrice: "1000.0000", vatRate: "0.00",
          accountId: revenue.id,
        });
        const base = `/companies/${companyId}`;

        async function postPayment(amount: number, date: string) {
          const created = await request(app).post(`${base}/payments`).send({
            counterpartyId: partner.id, periodId: period.id,
            direction: "inbound", amount, paymentDate: date,
            bankAccountId: bank.id, arApAccountId: ar.id,
            allocations: [{ invoiceId: invoice.id, allocatedAmount: amount }],
          }).expect(201);
          expect(created.body.status).toBe("draft");
          const posted = await request(app)
            .post(`${base}/payments/${created.body.id}/post`).expect(200);
          expect(posted.body.status).toBe("posted");
          expect(posted.body.linkedEntryId).toEqual(expect.any(String));
          const [saved] = await db.select().from(paymentsTable)
            .where(eq(paymentsTable.id, created.body.id));
          expect(saved).toMatchObject({
            status: "posted", linkedEntryId: posted.body.linkedEntryId,
          });
          return { id: saved.id, entryId: saved.linkedEntryId! };
        }

        async function expectInvoice(status: string, allocated?: string, remaining?: string) {
          const [saved] = await db.select().from(invoicesTable)
            .where(eq(invoicesTable.id, invoice.id));
          expect(saved.status).toBe(status);
          const open = await request(app).get(`${base}/open-items`).expect(200);
          const item = open.body.items.find((row: any) => row.invoiceId === invoice.id);
          if (status === "paid") {
            expect(item).toBeUndefined();
          } else {
            expect(item).toMatchObject({ allocatedAmount: allocated, remainingAmount: remaining });
          }
        }

        async function expectBank(credit: number, net: number, lineCount: number) {
          const ledger = await request(app)
            .get(`${base}/ledger?accountId=${bank.id}`).expect(200);
          expect(ledger.body.lines).toHaveLength(lineCount);
          expect(Number(ledger.body.totalDebit)).toBe(1000);
          expect(Number(ledger.body.totalCredit)).toBe(credit);
          expect(Number(ledger.body.totalDebit) - Number(ledger.body.totalCredit)).toBe(net);
          expect(Number(ledger.body.lines.at(-1).runningBalance)).toBe(net);
        }

        async function expectReversed(entryId: string) {
          const [original] = await db.select().from(journalEntriesTable)
            .where(eq(journalEntriesTable.id, entryId));
          expect(original.status).toBe("reversed");
          const reversals = await db.select().from(journalEntriesTable)
            .where(eq(journalEntriesTable.reversalOf, entryId));
          expect(reversals).toHaveLength(1);
          expect(reversals[0]).toMatchObject({
            status: "posted", companyId, periodId: period.id, reversalOf: entryId,
          });
          const originalLines = await db.select().from(journalEntryLinesTable)
            .where(eq(journalEntryLinesTable.entryId, entryId));
          const reversedLines = await db.select().from(journalEntryLinesTable)
            .where(eq(journalEntryLinesTable.entryId, reversals[0].id));
          expect(originalLines).toHaveLength(2);
          expect(reversedLines).toHaveLength(2);
          for (const line of originalLines) {
            expect(reversedLines).toEqual(expect.arrayContaining([expect.objectContaining({
              accountId: line.accountId, amount: line.amount, partnerId: line.partnerId,
              side: line.side === "debit" ? "credit" : "debit",
            })]));
          }
        }

        const paymentA = await postPayment(600, "2026-02-10");
        await expectInvoice("posted", "600.00", "400.00");
        const paymentB = await postPayment(400, "2026-02-20");
        expect(paymentA.entryId).not.toBe(paymentB.entryId);
        await expectInvoice("paid");
        await expectBank(0, 1000, 2);

        const voidB = await request(app).post(`${base}/payments/${paymentB.id}/void`)
          .send({ reason: "TEST razveljavitev 400 EUR" }).expect(200);
        expect(voidB.body.status).toBe("void");
        await expectInvoice("posted", "600.00", "400.00");
        await expectReversed(paymentB.entryId);
        const [activePayment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.id, paymentA.id));
        expect(activePayment.status).toBe("posted");
        const [activeEntry] = await db.select().from(journalEntriesTable)
          .where(eq(journalEntriesTable.id, paymentA.entryId));
        expect(activeEntry.status).toBe("posted");
        await expectBank(400, 600, 3);

        const voidA = await request(app).post(`${base}/payments/${paymentA.id}/void`)
          .send({ reason: "TEST razveljavitev 600 EUR" }).expect(200);
        expect(voidA.body.status).toBe("void");
        await expectInvoice("posted", "0.00", "1000.00");
        await expectReversed(paymentA.entryId);
        await expectReversed(paymentB.entryId);
        const savedPayments = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.companyId, companyId));
        expect(savedPayments).toHaveLength(2);
        expect(savedPayments.every(payment => payment.status === "void")).toBe(true);
        await expectBank(1000, 0, 4);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    // Prove that nested posting/voiding transactions did not commit fixtures.
    expect(companyId).not.toBe("");
    expect(await db.select().from(companiesTable)
      .where(eq(companiesTable.id, companyId))).toHaveLength(0);
  });
});
