import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), findFirst: vi.fn(), insert: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
  readAll: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...v: unknown[]) => v), eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  count: vi.fn(), desc: vi.fn(), inArray: vi.fn(), isNull: vi.fn(), ne: vi.fn(), or: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));
vi.mock("../../middlewares/pos", () => ({ requireSpecificUnitCapability: () => (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("./nastavitve", () => ({
  readAll: mocks.readAll,
  toResponse: (value: unknown) => value,
}));
vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select, insert: mocks.insert, transaction: mocks.transaction, execute: mocks.execute,
    query: { posKarticnaPlacilaAttemptTable: { findFirst: mocks.findFirst } },
  },
  enoteTable: { id: "unit.id", companyId: "unit.company", capabilities: "unit.capabilities" },
  narocilaTable: { id: "order.id", enotaId: "order.unit", status: "order.status", skupaj: "order.total", znesekNapitnina: "order.tip" },
  posKarticnaPlacilaAttemptTable: {
    id: "attempt.id", companyId: "attempt.company", enotaId: "attempt.unit", idempotencyKey: "attempt.key",
    provider: "attempt.provider", purpose: "attempt.purpose", narociloId: "attempt.order", znesek: "attempt.amount",
    status: "attempt.status", providerReferenca: "attempt.ref", posodobljeno: "attempt.updated",
  },
  darilniBonIzdajeTable: { cardPaymentAttemptId: "gift.attempt" },
  racunIzdajaZahteveTable: { cardPaymentAttemptId: "request.attempt" },
  racuniTable: { cardPaymentAttemptId: "receipt.attempt", enotaId: "receipt.unit" },
  napraveTable: { enotaId: "device.unit", napravaKljuc: "device.key", nastavitveJson: "device.settings" },
  vivaVracilaTable: { racunId: "refund.receipt", enotaId: "refund.unit" },
}));
vi.mock("../../lib/pos-payten", () => ({ posljiNaTerminal: vi.fn(), testTerminalPovezave: vi.fn() }));
vi.mock("../../lib/pos-sumup", () => ({ ustvariCheckout: vi.fn(), posredujNaTerminal: vi.fn(), preveriCheckout: vi.fn() }));
vi.mock("../../lib/pos-viva", () => ({
  ustvariNarocilo: vi.fn(), preveriStatus: vi.fn(), smartCheckoutUrl: vi.fn(), posljiNaTerminal: vi.fn(),
  preveriVivaTerminalSessionStatus: vi.fn(), preveriVivaTransakcijo: vi.fn(), pripraviVivaPovezavo: vi.fn(), stornirajVivaTerminal: vi.fn(),
}));

import terminalRouter from "./terminal";

const key = "simulation-attempt-0001";
function app() {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { Object.assign(req, { enotaId: 1, companyId: "company-1", clerkUserId: "clerk-1", vloga: "superadmin" }); next(); });
  a.use(terminalRouter); return a;
}
const chain = (rows: unknown[]) => ({
  from: () => ({
    orderBy: () => ({ limit: async () => rows, then: (resolve: (value: unknown[]) => unknown) => resolve(rows) }),
    where: () => ({ limit: async () => rows }),
    innerJoin: () => ({ where: () => ({ limit: async () => rows }) }),
  }),
});

describe("POST /terminal/simulation/pay", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.insert.mockReset();
    mocks.transaction.mockReset();
    mocks.findFirst.mockReset();
    mocks.readAll.mockResolvedValue({ fursNacin: "simulacija" });
    mocks.select.mockReset()
      .mockReturnValueOnce(chain([{ capabilities: ["simulation"] }]))
      .mockReturnValueOnce(chain([{ id: 9, skupaj: "10.00", znesekNapitnina: "1.25" }]));
    mocks.findFirst.mockResolvedValue(undefined);
    const attempt = { id: "attempt-1", provider: "simulacija", narociloId: 9, znesek: "11.25", providerReferenca: `simulation:company-1:1:${key}` };
    mocks.insert.mockReturnValue({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [attempt] }) }) });
    mocks.transaction.mockImplementation(async (fn: (tx: any) => unknown) => fn({
      query: { posKarticnaPlacilaAttemptTable: { findFirst: mocks.findFirst } }, insert: mocks.insert,
    }));
  });

  it("creates a completed attempt for the server-calculated order total plus QR tip", async () => {
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "completed", attemptId: "attempt-1", paymentAttemptId: key });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("rejects a client amount that differs from the order plus QR tip", async () => {
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 10, paymentAttemptId: key });
    expect(response.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["closed", "wrong", "cross-unit"])("rejects a %s or unavailable order without reserving a payment", async () => {
    mocks.select.mockReset()
      .mockReturnValueOnce(chain([{ capabilities: ["simulation"] }]))
      .mockReturnValueOnce(chain([]));
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(response.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("denies a unit outside FURS simulation mode", async () => {
    mocks.readAll.mockResolvedValueOnce({ fursNacin: "testno" });
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("replays the identical durable attempt and rejects changed payment binding", async () => {
    const existing = { id: "attempt-1", provider: "simulacija", narociloId: 9, znesek: "11.25", providerReferenca: "simulation:company-1:1:key" };
    mocks.select.mockReset()
      .mockReturnValueOnce(chain([{ capabilities: ["simulation"] }]))
      .mockReturnValueOnce(chain([{ id: 9, skupaj: "10.00", znesekNapitnina: "1.25" }]))
      .mockReturnValueOnce(chain([{ capabilities: ["simulation"] }]))
      .mockReturnValueOnce(chain([{ id: 9, skupaj: "10.00", znesekNapitnina: "1.25" }]));
    mocks.findFirst.mockResolvedValueOnce(existing);
    const replay = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(replay.status).toBe(200);
    expect(replay.body.attemptId).toBe("attempt-1");
    expect(mocks.insert).not.toHaveBeenCalled();

    mocks.findFirst.mockResolvedValueOnce({ ...existing, narociloId: 99 });
    const conflict = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(conflict.status).toBe(409);
  });

  it("fails closed for a unit without simulation, including a superadmin request", async () => {
    mocks.select.mockReset().mockReturnValueOnce(chain([{ capabilities: ["checkout"] }]));
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(response.status).toBe(403);
  });

  it("fails closed in production before looking up the order", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await supertest(app()).post("/terminal/simulation/pay")
      .send({ narociloId: 9, znesek: 11.25, paymentAttemptId: key });
    expect(response.status).toBe(404);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("GET /terminal/card-payment-attempts/:paymentAttemptId/recovery", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.select.mockReset();
  });

  it("offers recovery only for a completed, unconsumed attempt with the same order and amount", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "attempt-1",
      idempotencyKey: key,
      provider: "simulacija",
      purpose: "receipt",
      narociloId: 9,
      znesek: "11.25",
      status: "completed",
    });
    mocks.select.mockReturnValue(chain([{ id: "attempt-1" }]));

    const response = await supertest(app())
      .get(`/terminal/card-payment-attempts/${key}/recovery?narociloId=9&znesek=11.25`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      paymentAttemptId: key,
      attemptId: "attempt-1",
      status: "completed",
      recoverable: true,
    });
  });

  it("does not offer recovery once the attempt is already consumed", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "attempt-1",
      idempotencyKey: key,
      provider: "simulacija",
      purpose: "receipt",
      narociloId: 9,
      znesek: "11.25",
      status: "completed",
    });
    mocks.select.mockReturnValue(chain([]));

    const response = await supertest(app())
      .get(`/terminal/card-payment-attempts/${key}/recovery?narociloId=9&znesek=11.25`);

    expect(response.status).toBe(200);
    expect(response.body.recoverable).toBe(false);
  });
});

describe("recovery attempt selection", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.execute.mockReset().mockResolvedValue({});
  });

  it("lists only server-filtered completed, unconsumed candidates for the exact binding", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: async () => [{
            attemptId: "attempt-1", paymentAttemptId: key, provider: "sumup",
            znesek: "11.25", ustvarjeno: "2026-01-01T00:00:00.000Z",
          }],
        }),
      }),
    });
    const response = await supertest(app()).get("/terminal/card-payment-attempts/recovery?narociloId=9&znesek=11.25");
    expect(response.status).toBe(200);
    expect(response.body.attempts).toEqual([expect.objectContaining({
      attemptId: "attempt-1", paymentAttemptId: key, znesek: 11.25,
    })]);
  });

  it("records an audit event only after selecting a currently recoverable attempt", async () => {
    mocks.select.mockReturnValue(chain([{ id: "durable-attempt-0001", idempotencyKey: key, provider: "sumup" }]));
    const response = await supertest(app())
      .post("/terminal/card-payment-attempts/durable-attempt-0001/recovery/select")
      .send({ narociloId: 9, znesek: 11.25 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ attemptId: "durable-attempt-0001", paymentAttemptId: key });
    expect(response.body.selectionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});