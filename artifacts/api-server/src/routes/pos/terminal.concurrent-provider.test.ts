import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

type Attempt = {
  id: string;
  companyId: string;
  enotaId: number;
  idempotencyKey: string;
  provider: string;
  purpose: string;
  narociloId: number;
  znesek: string;
  status: string;
  providerReferenca: string | null;
  rezultatJson: string | null;
};

const mocks = vi.hoisted(() => ({
  paytenSdk: vi.fn(),
  sumupSdk: vi.fn(),
  attempts: [] as Attempt[],
  advisoryCalls: 0,
  lockTail: Promise.resolve() as Promise<void>,
  columns: {
    id: "attempt.id", companyId: "attempt.company", enotaId: "attempt.unit", idempotencyKey: "attempt.key",
    provider: "attempt.provider", purpose: "attempt.purpose", narociloId: "attempt.order", znesek: "attempt.amount",
    status: "attempt.status", providerReferenca: "attempt.ref", posodobljeno: "attempt.updated",
    ustvarjeno: "attempt.created",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  or: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
  ne: vi.fn((column: unknown, value: unknown) => ({ op: "ne", column, value })),
  inArray: vi.fn((column: unknown, value: unknown) => ({ op: "in", column, value })),
  isNull: vi.fn((column: unknown) => ({ op: "null", column })),
  count: vi.fn(), desc: vi.fn(),
  sql: Object.assign(vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })), { raw: vi.fn() }),
}));

function predicates(where: unknown): Array<{ op: string; column: unknown; value?: unknown }> {
  if (Array.isArray(where)) return where.flatMap(predicates);
  return where && typeof where === "object" && "op" in where
    ? [where as { op: string; column: unknown; value?: unknown }]
    : [];
}

function findAttempt(args: { where?: unknown }): Attempt | undefined {
  const terms = predicates(args.where);
  const value = (column: string, op = "eq") => terms.find(term => term.column === column && term.op === op)?.value;
  const key = value(mocks.columns.idempotencyKey);
  if (typeof key === "string") return mocks.attempts.find(attempt => attempt.idempotencyKey === key);
  const excludedProvider = value(mocks.columns.provider, "ne");
  if (typeof excludedProvider === "string") {
    return mocks.attempts.find(attempt =>
      attempt.companyId === value(mocks.columns.companyId)
      && attempt.enotaId === value(mocks.columns.enotaId)
      && attempt.purpose === value(mocks.columns.purpose)
      && attempt.narociloId === value(mocks.columns.narociloId)
      && attempt.znesek === value(mocks.columns.znesek)
      && attempt.provider !== excludedProvider
      && ["reserved", "pending", "unknown", "completed"].includes(attempt.status),
    );
  }
  return undefined;
}

vi.mock("@workspace/db", () => {
  const terminalSettings = JSON.stringify({
    terminalAktiven: true, terminalIp: "127.0.0.1", terminalPort: 9000, terminalTimeoutMs: 1000,
    sumupAktiven: true, sumupApiKey: "test-api-key", sumupTerminalSerial: "",
  });
  return {
    db: {
      // This is deliberately never connected to the transaction's committed
      // state. Moving a conflict lookup back to db.query makes this test charge twice.
      query: { posKarticnaPlacilaAttemptTable: { findFirst: vi.fn().mockResolvedValue(undefined) } },
      select: vi.fn(() => ({
        from: () => ({
          where: async () => [{ nastavitveJson: terminalSettings }],
          innerJoin: () => ({ where: async () => [{ nastavitveJson: terminalSettings }] }),
        }),
      })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
      execute: vi.fn(),
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        let release: (() => void) | undefined;
        const tx = {
          execute: vi.fn(async () => {
            mocks.advisoryCalls += 1;
            const previous = mocks.lockTail;
            mocks.lockTail = new Promise<void>(resolve => { release = resolve; });
            await previous;
          }),
          query: { posKarticnaPlacilaAttemptTable: { findFirst: vi.fn(findAttempt) } },
          insert: vi.fn(() => ({
            values: (values: Omit<Attempt, "id" | "status" | "providerReferenca" | "rezultatJson">) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  // Widen the pre-insert race. Without awaiting the advisory lock,
                  // both requests pass all reads before either durable row exists.
                  await new Promise(resolve => setTimeout(resolve, 15));
                  if (mocks.attempts.some(attempt =>
                    attempt.companyId === values.companyId
                    && attempt.enotaId === values.enotaId
                    && attempt.idempotencyKey === values.idempotencyKey
                  )) return [];
                  const attempt: Attempt = {
                    ...values, id: `attempt-${mocks.attempts.length + 1}`, status: "reserved",
                    providerReferenca: null, rezultatJson: null,
                  };
                  mocks.attempts.push(attempt);
                  return [attempt];
                },
              }),
            }),
          })),
        };
        try {
          return await callback(tx);
        } finally {
          release?.();
        }
      }),
    },
    posKarticnaPlacilaAttemptTable: mocks.columns,
    napraveTable: { enotaId: "device.unit", napravaKljuc: "device.key", nastavitveJson: "device.settings" },
    enoteTable: { id: "unit.id", companyId: "unit.company", capabilities: "unit.capabilities" },
    narocilaTable: { id: "order.id", enotaId: "order.unit", status: "order.status", skupaj: "order.total", znesekNapitnina: "order.tip" },
    darilniBonIzdajeTable: { cardPaymentAttemptId: "gift.attempt" },
    racunIzdajaZahteveTable: { cardPaymentAttemptId: "request.attempt" },
    racuniTable: { cardPaymentAttemptId: "receipt.attempt", enotaId: "receipt.unit" },
    vivaVracilaTable: { racunId: "refund.receipt", enotaId: "refund.unit" },
  };
});

vi.mock("../../middlewares/pos", () => ({ requireSpecificUnitCapability: () => (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("./nastavitve", () => ({ readAll: vi.fn(), toResponse: (value: unknown) => value }));
vi.mock("../../lib/pos-payten", () => ({ posljiNaTerminal: mocks.paytenSdk, testTerminalPovezave: vi.fn() }));
vi.mock("../../lib/pos-sumup", () => ({
  ustvariCheckout: mocks.sumupSdk, posredujNaTerminal: vi.fn(), preveriCheckout: vi.fn(),
}));
vi.mock("../../lib/pos-viva", () => ({
  ustvariNarocilo: vi.fn(), preveriStatus: vi.fn(), smartCheckoutUrl: vi.fn(), posljiNaTerminal: vi.fn(),
  preveriVivaTerminalSessionStatus: vi.fn(), preveriVivaTransakcijo: vi.fn(), pripraviVivaPovezavo: vi.fn(), stornirajVivaTerminal: vi.fn(),
}));

import terminalRouter from "./terminal";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    Object.assign(req, {
      enotaId: 7, companyId: "company-1", clerkUserId: "clerk-1", napravaKljuc: "device-1",
      log: { error: vi.fn() },
    });
    next();
  });
  instance.use(terminalRouter);
  instance.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message, stack: error.stack });
  });
  return instance;
}

describe("cross-provider card reservation concurrency", () => {
  beforeEach(() => {
    mocks.attempts.length = 0;
    mocks.advisoryCalls = 0;
    mocks.paytenSdk.mockReset().mockImplementation(async () => ({
      status: "odobren", referenca: "payten-ref", znesek: 1234, surovOdgovor: "approved",
    }));
    mocks.sumupSdk.mockReset().mockResolvedValue("sumup-checkout");
    mocks.lockTail = Promise.resolve();
  });

  it("serializes simultaneous Payten and SumUp starts before either provider SDK is called", async () => {
    const server = app();
    const [payten, sumup] = await Promise.all([
      supertest(server).post("/terminal/pay")
        .send({ narociloId: 99, znesek: 12.34, paymentAttemptId: "payten-concurrent-0001" }),
      supertest(server).post("/terminal/sumup/pay")
        .send({ narociloId: 99, znesek: 12.34, paymentAttemptId: "sumup-concurrent-0001" }),
    ]);

    expect([payten.status, sumup.status].sort(), JSON.stringify([payten.body, sumup.body])).toEqual([200, 409]);
    expect(mocks.paytenSdk.mock.calls.length + mocks.sumupSdk.mock.calls.length).toBe(1);
    expect(mocks.attempts).toHaveLength(1);
    expect(mocks.advisoryCalls).toBe(2);
    expect([payten.body.error, sumup.body.error].filter(Boolean).join(" ")).toMatch(/drugem ponudniku|ne bremenite/i);
  });
});