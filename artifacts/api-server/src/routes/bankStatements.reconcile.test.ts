import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  selectResults: [] as any[],
  inserts: [] as Array<{ table: string; values: any }>,
  updates: [] as Array<{ table: string; values: any }>,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "bank-reconcile-test-user";
    next();
  },
}));

vi.mock("@workspace/db", () => {
  const tables = new Map<string, any>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Proxy({}, { get: (_target, property) => `${name}.${String(property)}` }));
    return tables.get(name);
  };
  const query = (result: any) => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      for: () => chain,
      limit: async () => result,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  const tx: any = {
    select: () => query(dbState.selectResults.shift() ?? []),
    insert: (target: any) => ({
      values: (values: any) => {
        dbState.inserts.push({ table: String(target.id ?? target), values });
        return {
          returning: async () => [{ id: "remainder-payment-id" }],
          then: (resolve: any, reject: any) => Promise.resolve().then(resolve, reject),
        };
      },
    }),
    update: (target: any) => ({
      set: (values: any) => {
        dbState.updates.push({ table: String(target.id ?? target), values });
        return {
          where: async () => undefined,
          then: (resolve: any, reject: any) => Promise.resolve().then(resolve, reject),
        };
      },
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return {
    db: {
      select: () => query(dbState.selectResults.shift() ?? []),
      transaction: (callback: (executor: any) => Promise<any>) => callback(tx),
    },
    counterpartiesTable: table("counterparties"),
    invoicesTable: table("invoices"),
    bookieOldArSettlementsTable: table("bookieOldArSettlements"),
    bookieOldBankApClosingsTable: table("bookieOldBankApClosings"),
    invoiceLinesTable: table("invoiceLines"),
    paymentAllocationsTable: table("paymentAllocations"),
    paymentsTable: table("payments"),
    accountingRolesTable: table("accountingRoles"),
    accountsTable: table("accounts"),
    accountingPeriodsTable: table("accountingPeriods"),
    bankStatementsTable: table("bankStatements"),
    bankStatementLinesTable: table("bankStatementLines"),
    bankAccountMetadataTable: table("bankAccountMetadata"),
    paymentBatchesTable: table("paymentBatches"),
    paymentBatchItemsTable: table("paymentBatchItems"),
    journalEntriesTable: table("journalEntries"),
    journalEntryLinesTable: table("journalEntryLines"),
    auditLogTable: table("auditLog"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

import express from "express";
import supertest from "supertest";
import router from "./bankStatements";
import { auditLogTable, journalEntriesTable, journalEntryLinesTable, paymentBatchItemsTable, paymentsTable } from "@workspace/db";

const app = express();
app.use(express.json());
app.use(router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));

const companyId = "11111111-1111-4111-8111-111111111111";
const lineId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const bankAccountId = "44444444-4444-4444-8444-444444444444";
const statementLine = { amount: "-60.00", currency: "EUR", bookingDate: "2026-11-01", reference: "INV-1", bankAccountId };

beforeEach(() => {
  dbState.selectResults = [];
  dbState.inserts = [];
  dbState.updates = [];
});

describe("bank statement reconciliation transaction", () => {
  it("retries an existing posted attachment without creating another payment or journal entry", async () => {
    dbState.selectResults = [
      [{ role: "accountant" }],
      [statementLine],
      [{
        id: paymentId, status: "posted", direction: "outbound", amount: "60.00",
        paymentDate: statementLine.bookingDate, bankAccountId, reference: "INV-1",
        bankStatementLineId: lineId, counterpartyId: "partner", periodId: "period",
        arApAccountId: "ap", notes: null, createdBy: "user",
      }],
      [],
      [],
    ];

    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/lines/${lineId}/reconcile`)
      .send({ paymentId });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("posted");
    expect(response.body.requiresExplicitPosting).toBe(false);
    expect(dbState.inserts.map(item => item.table)).toEqual([String(auditLogTable.id ?? auditLogTable)]);
    expect(dbState.inserts.some(item =>
      item.table === String(paymentsTable.id ?? paymentsTable)
      || item.table === String(journalEntriesTable.id ?? journalEntriesTable)
      || item.table === String(journalEntryLinesTable.id ?? journalEntryLinesTable),
    )).toBe(false);
    expect(dbState.updates.some(item =>
      item.table === String(paymentsTable.id ?? paymentsTable) && item.values.bankStatementLineId === lineId,
    )).toBe(true);
  });

  it("requires explicit confirmation for an execution-date difference and reports the warning", async () => {
    dbState.selectResults = [
      [{ role: "accountant" }],
      [statementLine],
      [{
        id: paymentId, status: "posted", direction: "outbound", amount: "60.00",
        paymentDate: "2026-10-31", bankAccountId, reference: "INV-1",
        bankStatementLineId: null, counterpartyId: "partner", periodId: "period",
        arApAccountId: "ap", notes: null, createdBy: "user",
      }],
    ];
    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/lines/${lineId}/reconcile`)
      .send({ paymentId });
    expect(response.status).toBe(409);
    expect(response.body.confirmationRequired).toBe(true);
    expect(response.body.requiredConfirmations).toContain("confirmDateMismatch");
    expect(dbState.updates).toEqual([]);
  });

  it("accepts a posted payment date difference only after confirmation and returns the warning", async () => {
    dbState.selectResults = [
      [{ role: "accountant" }],
      [statementLine],
      [{
        id: paymentId, status: "posted", direction: "outbound", amount: "60.00",
        paymentDate: "2026-10-31", bankAccountId, reference: "INV-1",
        bankStatementLineId: null, counterpartyId: "partner", periodId: "period",
        arApAccountId: "ap", notes: null, createdBy: "user",
      }],
      [],
      [],
    ];
    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/lines/${lineId}/reconcile`)
      .send({ paymentId, confirmDateMismatch: true });
    expect(response.status).toBe(200);
    expect(response.body.warnings).toHaveLength(1);
    expect(response.body.warnings[0]).toContain("2026-10-31");
  });

  it("reduces a draft to actual execution and creates an unposted remainder with batch lineage", async () => {
    dbState.selectResults = [
      [{ role: "accountant" }],
      [statementLine],
      [{
        id: paymentId, status: "draft", direction: "outbound", amount: "100.00",
        paymentDate: statementLine.bookingDate, bankAccountId, reference: "INV-1",
        bankStatementLineId: null, counterpartyId: "partner", periodId: "period",
        arApAccountId: "ap", notes: null, createdBy: "user",
      }],
      [{ id: "allocation-1", amount: "100.00", invoiceId: "invoice-1" }],
      [{ id: "invoice-1" }],
      [{ id: "item-1", batchId: "batch-1", instruction: { paymentId, amount: "100.00" } }],
      [{ lifecycleStatus: "partially_executed" }, { lifecycleStatus: "ready" }],
    ];

    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/lines/${lineId}/reconcile`)
      .send({ paymentId });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.actualAmount).toBe("60.00");
    expect(response.body.status).toBe("draft");
    expect(response.body.requiresExplicitPosting).toBe(true);
    expect(dbState.updates.some(item =>
      item.table === String(paymentsTable.id ?? paymentsTable) && item.values.amount === "60.00",
    )).toBe(true);
    expect(dbState.inserts.some(item =>
      item.table === String(paymentsTable.id ?? paymentsTable)
      && item.values.amount === "40.00"
      && item.values.status === "draft",
    )).toBe(true);
    expect(dbState.inserts.some(item =>
      item.table === String(paymentBatchItemsTable.id ?? paymentBatchItemsTable)
      && item.values.paymentId === "remainder-payment-id"
      && item.values.batchId === "batch-1",
    )).toBe(true);
    expect(dbState.inserts.some(item =>
      item.table === String(journalEntriesTable.id ?? journalEntriesTable)
      || item.table === String(journalEntryLinesTable.id ?? journalEntryLinesTable),
    )).toBe(false);
  });
});