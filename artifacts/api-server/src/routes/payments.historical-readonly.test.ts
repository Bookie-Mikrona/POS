import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ rows: [] as any[][], write: vi.fn() }));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = "TEST-historical-payment"; next(); },
}));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: {
    select: () => {
      const rows = mocked.rows.shift() ?? [];
      const chain: any = {
        from: () => chain, where: () => chain, limit: () => chain,
        innerJoin: () => chain, leftJoin: () => chain, orderBy: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
    insert: mocked.write, update: mocked.write, delete: mocked.write, transaction: mocked.write,
  } };
});
import express from "express";
import request from "supertest";
import router from "./payments";
const app = express();
app.use(express.json());
app.use(router);
const company = "00000000-0000-4000-a000-000000000001";
const payment = "00000000-0000-4000-a000-000000000002";
const historical = { id: payment, createdBy: "bookie-old-payment-import", status: "draft" };
beforeEach(() => { mocked.rows = [[{ role: "owner" }], [historical]]; mocked.write.mockClear(); });
describe("historical evidence cannot create or reverse financial transactions", () => {
  it("blocks posting a historical draft before transactions or writes", async () => {
    expect((await request(app).post(`/companies/${company}/payments/${payment}/post`).send({})).status).toBe(409);
    expect(mocked.write).not.toHaveBeenCalled();
  });
  it("blocks reversal of a historical payment sharing an existing journal", async () => {
    mocked.rows[1] = [{ ...historical, status: "posted" }];
    expect((await request(app).post(`/companies/${company}/payments/${payment}/void`).send({ reason: "TEST" })).status).toBe(409);
    expect(mocked.write).not.toHaveBeenCalled();
  });
  it("blocks single SEPA export even for a historical draft", async () => {
    expect((await request(app).get(`/companies/${company}/payments/${payment}/sepa.xml`)).status).toBe(409);
    expect(mocked.write).not.toHaveBeenCalled();
  });
  it("blocks historical records in saved bank packages before creating anything", async () => {
    const response = await request(app).post(`/companies/${company}/payment-batches`).send({
      paymentIds: [payment], bankAccountId: "00000000-0000-4000-a000-000000000003",
      idempotencyKey: "TEST-historical-readonly",
    });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(mocked.write).not.toHaveBeenCalled();
  });
});
