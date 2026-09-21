import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

const mocks = vi.hoisted(() => ({
  findOriginalRacun: vi.fn(),
  findRefund: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  execute: vi.fn(),
  auditInsertValues: vi.fn(),
  refund: vi.fn(),
  preveriRefundStatus: vi.fn(),
  reservations: [] as Array<{ id: number; racunId: number; enotaId: number; refundSessionId: string; znesek: string; status: string; napaka: string | null; ustvarjeno: Date }>,
  lockTail: Promise.resolve() as Promise<void>,
}));

vi.mock("crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("crypto")>()),
  randomUUID: () => "refund-session-uuid",
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  count: vi.fn(() => "count"),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    transaction: mocks.transaction,
    update: mocks.update,
    execute: mocks.execute,
    query: {
      racuniTable: {
        findFirst: mocks.findOriginalRacun,
      },
      vivaVracilaTable: {
        findFirst: mocks.findRefund,
      },
    },
  },
  napraveTable: {
    enotaId: "naprave.enota_id",
    napravaKljuc: "naprave.naprava_kljuc",
    nastavitveJson: "naprave.nastavitve_json",
  },
  racuniTable: {
    enotaId: "racuni.enota_id",
    vivaTerminalSessionId: "racuni.viva_terminal_session_id",
  },
  vivaVracilaTable: {
    racunId: "viva_vracila.racun_id",
    enotaId: "viva_vracila.enota_id",
    refundSessionId: "viva_vracila.refund_session_id",
    znesek: "viva_vracila.znesek",
    status: "viva_vracila.status",
    ustvarjeno: "viva_vracila.ustvarjeno",
  },
  vivaVraciloStatusPrehodiTable: {
    __kind: "viva-refund-audit",
  },
}));

vi.mock("../../lib/pos-payten", () => ({
  posljiNaTerminal: vi.fn(),
  testTerminalPovezave: vi.fn(),
}));

vi.mock("../../lib/pos-sumup", () => ({
  ustvariCheckout: vi.fn(),
  posredujNaTerminal: vi.fn(),
  preveriCheckout: vi.fn(),
}));

vi.mock("../../lib/pos-viva", () => ({
  ustvariNarocilo: vi.fn(),
  preveriStatus: vi.fn(),
  smartCheckoutUrl: vi.fn(),
  posljiNaTerminal: vi.fn(),
  preveriVivaTerminalSessionStatus: mocks.preveriRefundStatus,
  stornirajVivaTerminal: mocks.refund,
}));

import terminalRouter from "./terminal";

const aktivnaVivaNastavitev = JSON.stringify({
  vivaTerminalAktiven: true,
  vivaTerminalId: "terminal-1",
  vivaClientId: "client-id",
  vivaClientSecret: "client-secret",
  vivaDemoNacin: true,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = 1;
    (req as any).napravaKljuc = "naprava-1";
    (req as any).clerkUserId = "clerk-refund-user";
    (req as any).posActorNatakarId = 77;
    (req as any).log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use(terminalRouter);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message, stack: error.stack });
  });
  return app;
}

describe("DELETE /terminal/viva/terminal/refund", () => {
  beforeEach(() => {
    mocks.findOriginalRacun.mockReset();
    mocks.findRefund.mockReset();
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.insertValues.mockReset();
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.transaction.mockReset();
    mocks.update.mockReset();
    mocks.updateSet.mockReset();
    mocks.execute.mockReset().mockImplementation(async (query: { values?: unknown[] }) => {
      const nextStatus = query.values?.find(value => value === "unknown" || value === "paid" || value === "failed");
      if (mocks.reservations[0] && typeof nextStatus === "string") {
        mocks.reservations[0].status = nextStatus;
      }
      return { rows: [] };
    });
    mocks.auditInsertValues.mockReset();
    mocks.reservations.length = 0;
    mocks.lockTail = Promise.resolve();

    mocks.select.mockImplementation((fields: Record<string, unknown>) => {
      if ("nastavitveJson" in fields) {
        return {
          from: () => ({
            where: async () => [{ nastavitveJson: aktivnaVivaNastavitev }],
          }),
        };
      }
      return {
        from: () => ({
          where: async () => [{ value: 0 }],
        }),
      };
    });
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.update.mockReturnValue({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (mocks.reservations[0]) Object.assign(mocks.reservations[0], values);
        },
      }),
    });
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      let release!: () => void;
      const previous = mocks.lockTail;
      mocks.lockTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn((fields?: Record<string, unknown>) => ({
          from: () => ({
            where: fields && "value" in fields
              ? async () => [{ value: mocks.reservations.length }]
              : () => ({
                  orderBy: () => ({
                    limit: async () => mocks.reservations.length ? [mocks.reservations[0]] : [],
                  }),
                }),
          }),
        })),
        insert: vi.fn((table: { __kind?: string }) => ({
          values: (values: Omit<(typeof mocks.reservations)[number], "id" | "napaka" | "ustvarjeno">) => {
            if (table?.__kind === "viva-refund-audit") {
              mocks.auditInsertValues(values);
              return Promise.resolve();
            }
            return {
              returning: async () => {
                const row = { ...values, id: mocks.reservations.length + 1, napaka: null, ustvarjeno: new Date() };
                mocks.reservations.push(row);
                mocks.insertValues(values);
                return [row];
              },
            };
          },
        })),
      };
      try {
        return await callback(tx);
      } finally {
        release();
      }
    });
  });

  it("uporabi shranjeno originalno ECR sejo, nov refund UUID in zapiše pending vračilo", async () => {
    mocks.findOriginalRacun.mockResolvedValue({
      id: 42,
      stevilkaRacuna: "PP001-B001-000001",
      vivaTerminalSessionId: "original-sale-session-uuid",
      vivaTransactionId: "original-transaction-id",
      vivaOrderCode: "original-order-code",
      znesekKartica: "12.34",
    });

    const odgovor = await supertest(buildApp())
      .delete("/terminal/viva/terminal/refund")
      .send({
        znesek: 12.34,
        originalSessionId: "original-sale-session-uuid",
        identifikator: "client-supplied-id-must-be-ignored",
      });

    expect(odgovor.status, JSON.stringify(odgovor.body)).toBe(200);
    expect(odgovor.body).toEqual({ sessionId: "refund-session-uuid", status: "pending", idempotentReplay: false });
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundSessionId: "refund-session-uuid",
        parentSessionId: "original-sale-session-uuid",
        originalTransactionId: "original-transaction-id",
        originalOrderCode: "original-order-code",
        amountEur: 12.34,
        terminalId: "terminal-1",
        context: { model: "merchant", cashRegisterId: "BOOKIE-ENOTA-1" },
      }),
      "client-id",
      "client-secret",
      true,
    );
    expect(mocks.insertValues).toHaveBeenCalledWith({
      racunId: 42,
      enotaId: 1,
      refundSessionId: "refund-session-uuid",
      znesek: "12.34",
      status: "pending",
      actorClerkUserId: "clerk-refund-user",
      actorNatakarId: 77,
      napravaKljuc: "naprava-1",
    });
    expect(mocks.auditInsertValues).toHaveBeenCalledWith({
      vivaVraciloId: 1,
      enotaId: 1,
      prejsnjiStatus: null,
      noviStatus: "pending",
      actorClerkUserId: "clerk-refund-user",
      actorNatakarId: 77,
      napravaKljuc: "naprava-1",
      providerReferenca: "refund-session-uuid",
      vir: "reservation",
    });
  });

  it("dva sočasna zahtevka rezervirata isto vračilo in ponudnika pokličeta samo enkrat", async () => {
    mocks.findOriginalRacun.mockResolvedValue({
      id: 42,
      stevilkaRacuna: "PP001-B001-000001",
      vivaTerminalSessionId: "original-sale-session-uuid",
      vivaTransactionId: "original-transaction-id",
      vivaOrderCode: "original-order-code",
      znesekKartica: "13.40",
    });

    const app = buildApp();
    const [first, second] = await Promise.all([
      supertest(app).delete("/terminal/viva/terminal/refund").send({ znesek: 13.4, originalSessionId: "original-sale-session-uuid" }),
      supertest(app).delete("/terminal/viva/terminal/refund").send({ znesek: 13.4, originalSessionId: "original-sale-session-uuid" }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 202]);
    expect(first.body.sessionId).toBe("refund-session-uuid");
    expect(second.body.sessionId).toBe("refund-session-uuid");
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.reservations).toHaveLength(1);
    expect(mocks.auditInsertValues).toHaveBeenCalledTimes(1);
  });

  it("nejasen provider izid ostane rezerviran in replay ne sproži novega vračila", async () => {
    mocks.findOriginalRacun.mockResolvedValue({
      id: 42,
      stevilkaRacuna: "PP001-B001-000001",
      vivaTerminalSessionId: "original-sale-session-uuid",
      vivaTransactionId: "original-transaction-id",
      vivaOrderCode: "original-order-code",
      znesekKartica: "13.40",
    });
    mocks.refund.mockRejectedValueOnce(new Error("timeout after send"));
    const app = buildApp();

    const first = await supertest(app).delete("/terminal/viva/terminal/refund")
      .send({ znesek: 13.4, originalSessionId: "original-sale-session-uuid" });
    const replay = await supertest(app).delete("/terminal/viva/terminal/refund")
      .send({ znesek: 13.4, originalSessionId: "original-sale-session-uuid" });

    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(first.body).toMatchObject({ sessionId: "refund-session-uuid", status: "unknown" });
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ sessionId: "refund-session-uuid", idempotentReplay: true });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.reservations).toHaveLength(1);
    expect(mocks.reservations[0]!.status).toBe("unknown");
    expect(mocks.auditInsertValues).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]?.[0]?.values).toEqual(expect.arrayContaining([
      "refund-session-uuid",
      "unknown",
      "clerk-refund-user",
      77,
      "naprava-1",
    ]));
  });

  it("zavrne znesek pod centom in ponudnika ne pokliče", async () => {
    mocks.findOriginalRacun.mockResolvedValue({
      id: 42,
      stevilkaRacuna: "PP001-B001-000001",
      vivaTerminalSessionId: "original-sale-session-uuid",
      znesekKartica: "13.40",
    });
    const response = await supertest(buildApp()).delete("/terminal/viva/terminal/refund")
      .send({ znesek: 13.4001, originalSessionId: "original-sale-session-uuid" });
    expect(response.status).toBe(400);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.reservations).toHaveLength(0);
  });

  it("sprejme veljaven centni znesek tudi pri binarnem decimalnem zapisu 0,29", async () => {
    mocks.findOriginalRacun.mockResolvedValue({
      id: 42,
      stevilkaRacuna: "PP001-B001-000001",
      vivaTerminalSessionId: "original-sale-session-uuid",
      vivaTransactionId: "original-transaction-id",
      vivaOrderCode: "original-order-code",
      znesekKartica: "0.29",
    });
    const response = await supertest(buildApp()).delete("/terminal/viva/terminal/refund")
      .send({ znesek: 0.29, originalSessionId: "original-sale-session-uuid" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amountEur: 0.29 }),
      "client-id",
      "client-secret",
      true,
    );
  });

  it("že plačano vračilo ne preverja ponudnika znova in ne more nazadovati v failed", async () => {
    mocks.findRefund.mockResolvedValue({
      refundSessionId: "refund-paid",
      enotaId: 1,
      status: "paid",
      napaka: null,
    });
    const providerStatus = vi.fn().mockResolvedValue({ status: "FAILED", napaka: "late contradiction" });
    mocks.preveriRefundStatus.mockImplementation(providerStatus);

    const response = await supertest(buildApp()).get("/terminal/viva/terminal/refund/status/refund-paid");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "PAID", idempotentReplay: true });
    expect(providerStatus).not.toHaveBeenCalled();
  });

  it("pending preide v paid z enim audit dogodkom, replay pa ne preverja ponudnika znova", async () => {
    mocks.findRefund
      .mockResolvedValueOnce({
        refundSessionId: "refund-pending",
        enotaId: 1,
        status: "pending",
        napaka: null,
      })
      .mockResolvedValue({
        refundSessionId: "refund-pending",
        enotaId: 1,
        status: "paid",
        napaka: null,
      });
    mocks.preveriRefundStatus.mockResolvedValue({ status: "PAID", napaka: null });
    const app = buildApp();

    const first = await supertest(app).get("/terminal/viva/terminal/refund/status/refund-pending");
    const replay = await supertest(app).get("/terminal/viva/terminal/refund/status/refund-pending");

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "PAID" });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: "PAID", idempotentReplay: true });
    expect(mocks.preveriRefundStatus).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]?.[0]?.values).toEqual(expect.arrayContaining([
      "refund-pending",
      "paid",
      "clerk-refund-user",
      77,
      "naprava-1",
    ]));
  });

  it("providerjev UNKNOWN spremeni pending v sledljiv unknown brez novega refund učinka", async () => {
    mocks.findRefund.mockResolvedValue({
      refundSessionId: "refund-provider-unknown",
      enotaId: 1,
      status: "pending",
      napaka: null,
    });
    mocks.preveriRefundStatus.mockResolvedValue({
      status: "UNKNOWN",
      napaka: "Viva status trenutno ni dosegljiv.",
    });

    const response = await supertest(buildApp())
      .get("/terminal/viva/terminal/refund/status/refund-provider-unknown");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "UNKNOWN",
      napaka: "Viva status trenutno ni dosegljiv.",
    });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]?.[0]?.values).toEqual(expect.arrayContaining([
      "refund-provider-unknown",
      "unknown",
      "Viva status trenutno ni dosegljiv.",
      "clerk-refund-user",
      77,
      "naprava-1",
    ]));
  });
});