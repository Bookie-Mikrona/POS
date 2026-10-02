import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  globalSelectResults: [] as any[],
  txSelectResults: [] as any[],
  updates: [] as Array<{ table: string; values: any }>,
  inserts: [] as Array<{ table: string; values: any }>,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "batch-lifecycle-user";
    next();
  },
}));

vi.mock("@workspace/api-zod", () => ({
  CreatePaymentBody: { safeParse: () => ({ success: false, error: { message: "unused" } }) },
  VoidPaymentBody: { safeParse: () => ({ success: false, error: { message: "unused" } }) },
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
      where: () => chain,
      for: () => chain,
      limit: async () => result,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  const tx: any = {
    select: () => query(state.txSelectResults.shift() ?? []),
    update: (target: any) => ({
      set: (values: any) => {
        state.updates.push({ table: String(target.id ?? target), values });
        return { where: async () => undefined };
      },
    }),
    insert: (target: any) => ({
      values: (values: any) => {
        state.inserts.push({ table: String(target.id ?? target), values });
        return { then: (resolve: any, reject: any) => Promise.resolve().then(resolve, reject) };
      },
    }),
  };
  return {
    db: {
      select: () => query(state.globalSelectResults.shift() ?? []),
      transaction: (callback: (executor: any) => Promise<any>) => callback(tx),
    },
    accountingRolesTable: table("accountingRoles"),
    paymentBatchesTable: table("paymentBatches"),
    paymentBatchItemsTable: table("paymentBatchItems"),
    paymentsTable: table("payments"),
    auditLogTable: table("auditLog"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

import express from "express";
import supertest from "supertest";
import router from "./payments";

const app = express();
app.use(express.json());
app.use(router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));

const companyId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  state.globalSelectResults = [[{ role: "accountant" }]];
  state.txSelectResults = [];
  state.updates = [];
  state.inserts = [];
});

describe("payment batch instruction lifecycle", () => {
  it("requires explicit bank-risk confirmation after XML export", async () => {
    state.txSelectResults = [[{
      id: batchId, companyId, status: "exported", xmlSnapshot: "<xml/>", exportedAt: new Date(),
    }]];

    const response = await supertest(app)
      .post(`/companies/${companyId}/payment-batches/${batchId}/lifecycle`)
      .send({ action: "cancel", reason: "Duplicate import" });

    expect(response.status).toBe(409);
    expect(response.body.confirmationRequired).toBe(true);
    expect(response.body.warning).toContain("bank");
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("audits exported cancellation, releases only the unexecuted link, and does not reverse money", async () => {
    state.txSelectResults = [
      [{ id: batchId, companyId, status: "exported", xmlSnapshot: "<xml/>", exportedAt: new Date() }],
      [{
        itemId: "item-1", paymentId, paymentCompanyId: companyId, lifecycleStatus: "ready", releasedAt: null,
        paymentStatus: "draft", bankStatementLineId: null,
      }],
    ];

    const response = await supertest(app)
      .post(`/companies/${companyId}/payment-batches/${batchId}/lifecycle`)
      .send({ action: "cancel", reason: "Bank rejected duplicate", confirmExportedRisk: true });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("cancelled");
    expect(response.body.releasedForRepackaging).toEqual([paymentId]);
    expect(response.body.monetaryReversal).toBe(false);
    expect(response.body.exportedWarning).toContain("bank");
    expect(state.updates.map(update => update.values.lifecycleStatus)).toContain("cancelled");
    expect(state.updates.map(update => update.values.status)).toContain("cancelled");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values.payload).toMatchObject({
      reason: "Bank rejected duplicate",
      exported: true,
      exportedRiskConfirmed: true,
      monetaryReversal: false,
    });
  });

  it("resolves only selected unexecuted instructions on a partially executed batch", async () => {
    state.txSelectResults = [
      [{ id: batchId, companyId, status: "partially_executed", xmlSnapshot: null, exportedAt: null }],
      [{
        itemId: "remainder-item", paymentId, paymentCompanyId: companyId, lifecycleStatus: "ready", releasedAt: null,
        paymentStatus: "draft", bankStatementLineId: null,
      }],
    ];

    const response = await supertest(app)
      .post(`/companies/${companyId}/payment-batches/${batchId}/lifecycle`)
      .send({ action: "reject", reason: "Supplier rejected the remaining balance", paymentIds: [paymentId] });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("partially_executed");
    expect(response.body.paymentIds).toEqual([paymentId]);
    expect(state.updates.some(update => update.values.lifecycleStatus === "rejected")).toBe(true);
    expect(state.updates.some(update => update.values.status !== undefined)).toBe(false);
    expect(state.inserts[0]!.values.payload.paymentIds).toEqual([paymentId]);
  });
});