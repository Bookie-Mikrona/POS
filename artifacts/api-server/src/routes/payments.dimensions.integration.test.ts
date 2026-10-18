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
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-payment-dimensions";
    next();
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, paymentsTable, paymentAllocationsTable,
  paymentLedgerAllocationsTable, invoicesTable, invoiceLinesTable,
  journalEntriesTable, journalEntryLinesTable, auditLogTable,
  partnerSettlementEventsTable, bankStatementsTable, bankStatementLinesTable,
} from "@workspace/db";
import router from "./payments";

const app = express();
app.use(express.json(), router);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode ?? 500).json({ error: err.message });
});
afterAll(() => pool.end());

const cases = (["inbound", "outbound"] as const).flatMap(direction =>
  (["manual", "statement", "invoice", "ledger"] as const).map(mode => ({ direction, mode })));

describe("direct payment posting enforces dimensions atomically", () => {
  it.each(cases)("$direction / $mode: rechecks current rules on both generated lines", async ({ direction, mode }) => {
    const rollback = new Error("ROLLBACK payment dimension fixtures");
    let companyId: string | undefined;
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          naziv: "TEST payment dimensions", podjetjeDavcna: "TEST-payment-dimensions",
        }).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-payment-dimensions", role: "owner",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId, name: "TEST 2026", startDate: "2026-01-01", endDate: "2026-12-31",
        }).returning();
        const [bank, counterpart] = await db.insert(accountsTable).values([
          { companyId, code: "1100000", name: "Bank", type: "asset" as const },
          { companyId, code: direction === "inbound" ? "1200000" : "2200000",
            name: "Counterpart", type: direction === "inbound" ? "asset" as const : "liability" as const,
            requiresPartner: true, isOpenItem: true },
        ]).returning();
        const [partner] = await db.insert(counterpartiesTable).values({
          companyId, name: "TEST partner", type: direction === "inbound" ? "customer" : "supplier",
        }).returning();
        const [statement] = await db.insert(bankStatementsTable).values({
          companyId, bankAccountId: bank.id, statementDate: "2026-10-01",
          sourceFilename: "TEST.xml", sourceSha256: "d".repeat(64),
          closingBalance: "1000.00", createdBy: "TEST-payment-dimensions",
        }).returning();
        let statementLineId: string | undefined;
        if (mode === "statement") {
          const [line] = await db.insert(bankStatementLinesTable).values({
            statementId: statement.id, transactionKey: "TEST", lineNumber: 1,
            bookingDate: "2026-10-02", amount: direction === "inbound" ? "25.00" : "-25.00",
            currency: "EUR",
          }).returning();
          statementLineId = line.id;
        }
        let invoiceId: string | undefined;
        if (mode === "invoice") {
          const [invoice] = await db.insert(invoicesTable).values({
            companyId, periodId: period.id, counterpartyId: partner.id,
            type: direction === "inbound" ? "issued" : "received",
            invoiceNumber: "TEST-dimensions", invoiceDate: "2026-10-01",
            status: "posted", arApAccountId: counterpart.id, createdBy: "TEST-payment-dimensions",
          }).returning();
          invoiceId = invoice.id;
          await db.insert(invoiceLinesTable).values({
            invoiceId, accountId: counterpart.id, description: "TEST", quantity: "1",
            unitPrice: "25.00", vatRate: "0.00", sequence: 0,
          });
        }
        let journalLineId: string | undefined;
        if (mode === "ledger") {
          const [entry] = await db.insert(journalEntriesTable).values({
            companyId, periodId: period.id, entryDate: "2026-10-01", description: "TEST source",
            status: "posted", createdBy: "TEST-payment-dimensions",
          }).returning();
          const [line] = await db.insert(journalEntryLinesTable).values({
            entryId: entry.id, accountId: counterpart.id,
            side: direction === "inbound" ? "debit" : "credit", amount: "25.00",
            partnerId: partner.id, sequence: 0,
          }).returning();
          journalLineId = line.id;
        }
        // Create through HTTP before requirements change, reproducing old drafts.
        const created = await request(app).post(`/companies/${companyId}/payments`).send({
          direction, counterpartyId: partner.id, periodId: period.id,
          paymentDate: "2026-10-02", amount: 25, reference: "TEST dimensions",
          bankAccountId: bank.id, arApAccountId: counterpart.id, bankStatementLineId: statementLineId,
          allocations: invoiceId ? [{ invoiceId, allocatedAmount: 25 }] : [],
          ledgerAllocations: journalLineId ? [{ journalLineId, allocatedAmount: 25 }] : [],
        }).expect(201);
        const paymentId = created.body.id;
        const postUrl = `/companies/${companyId}/payments/${paymentId}/post`;
        const snapshot = async () => ({
          payment: await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)),
          invoices: await db.select().from(invoicesTable).where(eq(invoicesTable.companyId, company.id)),
          entries: await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, company.id)),
          audit: await db.select().from(auditLogTable).where(eq(auditLogTable.companyId, company.id)),
          settlements: await db.select().from(partnerSettlementEventsTable).where(eq(partnerSettlementEventsTable.companyId, company.id)),
          allocations: await db.select().from(paymentAllocationsTable).where(eq(paymentAllocationsTable.paymentId, paymentId)),
          ledgerAllocations: await db.select().from(paymentLedgerAllocationsTable).where(eq(paymentLedgerAllocationsTable.paymentId, paymentId)),
        });
        const before = await snapshot();
        const defaults = {
          requiresPartner: false, requiresCostCenter: false,
          costCenterPolicy: "allowed" as const, requiresProject: false,
        };
        const rules = [
          { change: { costCenterPolicy: "required" as const }, message: "stroškovno mesto" },
          { change: { requiresCostCenter: true }, message: "stroškovno mesto" },
          // Legacy flag must still win even if the newer policy differs.
          { change: { requiresCostCenter: true, costCenterPolicy: "not_allowed" as const }, message: "stroškovno mesto" },
          { change: { requiresProject: true }, message: "projekt" },
        ];
        for (const account of [bank, counterpart]) {
          const accountRules = account.id === bank.id
            ? [...rules, { change: { requiresPartner: true }, message: "poslovni partner" }]
            : rules;
          for (const rule of accountRules) {
            await db.update(accountsTable).set({ ...defaults, ...rule.change }).where(eq(accountsTable.id, account.id));
            const rejected = await request(app).post(postUrl).send({
              // Unrecognized request fields cannot supply missing journal dimensions.
              partnerId: partner.id, costCenterId: partner.id, projectId: partner.id,
            }).expect(400);
            expect(rejected.body.error).toContain(account.code);
            expect(rejected.body.error).toContain(rule.message);
            expect(await snapshot()).toEqual(before);
          }
          await db.update(accountsTable).set({
            ...defaults, requiresPartner: account.id === counterpart.id,
            costCenterPolicy: "not_allowed",
          }).where(eq(accountsTable.id, account.id));
        }
        // No cost centre is valid for not_allowed; counterpart partner is present.
        const posted = await request(app).post(postUrl).expect(200);
        expect(posted.body.status).toBe("posted");
        const lines = await db.select().from(journalEntryLinesTable)
          .where(eq(journalEntryLinesTable.entryId, posted.body.linkedEntryId));
        expect(lines).toHaveLength(2);
        expect(lines.find(line => line.accountId === bank.id)?.partnerId).toBeNull();
        expect(lines.find(line => line.accountId === counterpart.id)?.partnerId).toBe(partner.id);
        if (invoiceId) {
          const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
          expect(invoice.status).toBe("paid");
        }
        if (journalLineId) expect((await snapshot()).settlements).toHaveLength(1);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    // Verify that route savepoints did not commit the fixture transaction.
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId!))).toEqual([]);
  });
});
