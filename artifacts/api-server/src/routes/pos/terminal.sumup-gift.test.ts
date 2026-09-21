import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  napraveTable,
  pool,
  posKarticnaPlacilaAttemptTable,
} from "@workspace/db";

const sumup = vi.hoisted(() => ({
  ustvariCheckout: vi.fn(),
  posredujNaTerminal: vi.fn(),
  preveriCheckout: vi.fn(),
}));

vi.mock("../../lib/pos-sumup", () => sumup);

import terminalRouter from "./terminal";

const RUN_ID = Math.random().toString(36).slice(2, 10);
let companyId: string;
let enotaId: number;
const deviceKey = `sumup-gift-${RUN_ID}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    (req as any).napravaKljuc = deviceKey;
    (req as any).log = { error: vi.fn() };
    next();
  });
  app.use(terminalRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_SUMUP_GIFT_${RUN_ID}`,
    naziv: `SumUp gift ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId,
    ime: `SumUp gift unit ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = unit!.id;
  await db.insert(napraveTable).values({
    enotaId,
    ime: "SumUp gift test",
    napravaKljuc: deviceKey,
    nastavitveJson: JSON.stringify({ sumupAktiven: true, sumupApiKey: "test-key" }),
  });
});

beforeEach(() => {
  sumup.ustvariCheckout.mockReset();
  sumup.posredujNaTerminal.mockReset();
  sumup.preveriCheckout.mockReset();
});

afterAll(async () => {
  await db.delete(posKarticnaPlacilaAttemptTable)
    .where(and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
    ));
  await db.delete(napraveTable).where(eq(napraveTable.enotaId, enotaId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("POST /terminal/sumup/pay gift voucher intent", () => {
  it("creates once, replays the exact key, and never inherits another completed gift", async () => {
    const app = buildApp();
    sumup.ustvariCheckout
      .mockResolvedValueOnce(`checkout-a-${RUN_ID}`)
      .mockResolvedValueOnce(`checkout-b-${RUN_ID}`);
    const firstKey = `gift-sumup-a-${RUN_ID}`;
    const first = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 12.5, paymentAttemptId: firstKey,
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      checkoutId: `checkout-a-${RUN_ID}`,
      paymentAttemptId: firstKey,
      status: "pending",
    });
    expect(first.body.attemptId).toMatch(/^[0-9a-f-]{36}$/);

    const replay = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 12.5, paymentAttemptId: firstKey,
    });
    expect(replay.body.attemptId).toBe(first.body.attemptId);
    expect(replay.body.checkoutId).toBe(first.body.checkoutId);
    expect(sumup.ustvariCheckout).toHaveBeenCalledTimes(1);

    await db.update(posKarticnaPlacilaAttemptTable).set({ status: "completed" })
      .where(eq(posKarticnaPlacilaAttemptTable.id, first.body.attemptId));
    const secondKey = `gift-sumup-b-${RUN_ID}`;
    const second = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 12.5, paymentAttemptId: secondKey,
    });
    expect(second.body.attemptId).not.toBe(first.body.attemptId);
    expect(second.body.checkoutId).toBe(`checkout-b-${RUN_ID}`);
    expect(sumup.ustvariCheckout).toHaveBeenCalledTimes(2);
  });

  it("does not recharge an unknown exact key and rejects fractional cents before persistence", async () => {
    const app = buildApp();
    const unknownKey = `gift-sumup-unknown-${RUN_ID}`;
    sumup.ustvariCheckout.mockRejectedValueOnce(new Error("transport unknown"));
    const first = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 8, paymentAttemptId: unknownKey,
    });
    expect(first.status).toBe(502);
    const replay = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 8, paymentAttemptId: unknownKey,
    });
    expect(replay.status).toBe(202);
    expect(replay.body.attemptId).toBe(first.body.attemptId);
    expect(sumup.ustvariCheckout).toHaveBeenCalledTimes(1);

    const fractionalKey = `gift-sumup-fraction-${RUN_ID}`;
    const fractional = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 10.001, paymentAttemptId: fractionalKey,
    });
    expect(fractional.status).toBe(400);
    const rows = await db.select().from(posKarticnaPlacilaAttemptTable).where(and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.idempotencyKey, fractionalKey),
    ));
    expect(rows).toHaveLength(0);
    expect(sumup.ustvariCheckout).toHaveBeenCalledTimes(1);

    const overLimitKey = `gift-sumup-over-limit-${RUN_ID}`;
    const overLimit = await supertest(app).post("/terminal/sumup/pay").send({
      purpose: "gift_voucher", znesek: 10_000.01, paymentAttemptId: overLimitKey,
    });
    expect(overLimit.status).toBe(400);
    const overLimitRows = await db.select().from(posKarticnaPlacilaAttemptTable).where(and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.idempotencyKey, overLimitKey),
    ));
    expect(overLimitRows).toHaveLength(0);
    expect(sumup.ustvariCheckout).toHaveBeenCalledTimes(1);
  });
});