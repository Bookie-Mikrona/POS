import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  selectResults: [] as any[],
  inserts: [] as Array<{ table: string; values: any }>,
  updates: [] as Array<{ table: string; values: any }>,
  transactionError: null as unknown,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "bank-reconcile-test-user";
    next();
  },
}));

vi.mock("../lib/native-payment-allocations", () => ({
  lockNativeSourceLines: vi.fn(async () => undefined),
  validateNativeAllocations: vi.fn(async () => []),
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
          returning: async () => {
            if (target === table("bankStatements")) return [{ id: "registered-statement-id" }];
            if (target === table("bankStatementLines")) {
              return values.map((row: any, index: number) => ({
                id: `registered-line-${index + 1}`, transactionKey: row.transactionKey,
              }));
            }
            return [{ id: "remainder-payment-id" }];
          },
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
      transaction: (callback: (executor: any) => Promise<any>) =>
        dbState.transactionError ? Promise.reject(dbState.transactionError) : callback(tx),
    },
    counterpartiesTable: table("counterparties"),
    invoicesTable: table("invoices"),
    bookieOldArSettlementsTable: table("bookieOldArSettlements"),
    bookieOldBankApClosingsTable: table("bookieOldBankApClosings"),
    invoiceLinesTable: table("invoiceLines"),
    paymentAllocationsTable: table("paymentAllocations"),
    paymentLedgerAllocationsTable: table("paymentLedgerAllocations"),
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
import {
  auditLogTable,
  bankStatementsTable,
  bankStatementLinesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  paymentBatchItemsTable,
  paymentLedgerAllocationsTable,
  paymentsTable,
} from "@workspace/db";

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
  dbState.transactionError = null;
});

describe("bank statement registration remains separate from payment reconciliation", () => {
  const registration = {
    bankAccountId,
    sourceFilename: "statement.csv",
    sourceSha256: "a".repeat(64),
    transactions: [{
      id: "source-transaction-1", date: "2026-11-01", amount: -60, currency: "EUR",
      reference: "INV-1", counterpartyName: "Supplier", counterpartyIban: null, description: "Payment",
    }],
  };

  it("rejects a viewer before writing statement evidence or reserving the source hash", async () => {
    dbState.selectResults = [[{ role: "viewer" }]];
    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Za evidentiranje bančnega izpiska potrebujete računovodsko vlogo");
    expect(dbState.inserts).toEqual([]);
    expect(dbState.updates).toEqual([]);
  });

  it("registers only statement evidence and returns its durable line IDs", async () => {
    dbState.selectResults = [[{ role: "accountant" }], [{ id: bankAccountId, mappedIban: null }]];
    const response = await supertest(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      statementId: "registered-statement-id",
      lineIds: { "source-transaction-1": "registered-line-1" },
    });
    expect(dbState.inserts.map(item => item.table)).toEqual([
      String(bankStatementsTable.id), String(bankStatementLinesTable.id),
    ]);
    expect(dbState.inserts[0].values).toMatchObject({
      companyId, bankAccountId, sourceSha256: registration.sourceSha256,
      createdBy: "bank-reconcile-test-user",
    });
    expect(dbState.inserts[1].values).toEqual([expect.objectContaining({
      statementId: "registered-statement-id", transactionKey: "source-transaction-1",
      amount: "-60", lineNumber: 1,
    })]);
    expect(dbState.updates).toEqual([]);
  });

  it.each([{ code: "23505" }, { cause: { code: "23505" } }])(
    "keeps the duplicate-import response for %j",
    async (error) => {
      dbState.selectResults = [[{ role: "accountant" }], [{ id: bankAccountId, mappedIban: null }]];
      dbState.transactionError = error;
      const response = await supertest(app).post(`/companies/${companyId}/bank-statements/register`)
        .send(registration);
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("Ta datoteka bančnega izpiska je bila že evidentirana.");
      expect(dbState.inserts).toEqual([]);
    },
  );

  it("resolves the authenticated user before authorizing statement details", async () => {
    dbState.selectResults = [[]];
    const response = await supertest(app)
      .get(`/companies/${companyId}/bank-statements/detail/55555555-5555-4555-8555-555555555555`);
    expect(response.status).toBe(403);
    expect(dbState.inserts).toEqual([]);
  });
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
      [{ id: "allocation-1", amount: "40.00", invoiceId: "invoice-1" }],
      [{ id: "ledger-allocation-1", amount: "60.00", journalLineId: "native-line-1" }],
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
    expect(dbState.updates.some(item =>
      item.table === String(paymentLedgerAllocationsTable.id ?? paymentLedgerAllocationsTable)
      && item.values.allocatedAmount === "20.00",
    )).toBe(true);
    expect(dbState.inserts.some(item =>
      item.table === String(paymentLedgerAllocationsTable.id ?? paymentLedgerAllocationsTable)
      && Array.isArray(item.values)
      && item.values.some((allocation: any) => allocation.paymentId === "remainder-payment-id"
        && allocation.journalLineId === "native-line-1"
        && allocation.allocatedAmount === "40.00"),
    )).toBe(true);
    expect(dbState.inserts.some(item =>
      item.table === String(journalEntriesTable.id ?? journalEntriesTable)
      || item.table === String(journalEntryLinesTable.id ?? journalEntryLinesTable),
    )).toBe(false);
  });
});