import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  findFirst: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  ustvariNarocilo: vi.fn(),
  smartCheckoutUrl: vi.fn(),
  preveriStatus: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  count: vi.fn(() => "count"),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
  ne: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  or: vi.fn((...conditions: unknown[]) => conditions),
  sql: vi.fn(() => "sql"),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    execute: mocks.execute,
    transaction: mocks.transaction,
    query: {
      racuniTable: { findFirst: vi.fn() },
      posKarticnaPlacilaAttemptTable: { findFirst: mocks.findFirst },
    },
  },
  posKarticnaPlacilaAttemptTable: {
    id: "attempt.id",
    companyId: "attempt.company_id",
    enotaId: "attempt.enota_id",
    idempotencyKey: "attempt.idempotency_key",
    provider: "attempt.provider",
    purpose: "attempt.purpose",
    narociloId: "attempt.narocilo_id",
    znesek: "attempt.znesek",
    status: "attempt.status",
    providerReferenca: "attempt.provider_referenca",
    posodobljeno: "attempt.posodobljeno",
  },
  racunIzdajaZahteveTable: {
    cardPaymentAttemptId: "request.card_payment_attempt_id",
  },
  darilniBonIzdajeTable: {
    cardPaymentAttemptId: "gift_issue.card_payment_attempt_id",
  },
  napraveTable: {
    enotaId: "naprave.enota_id",
    napravaKljuc: "naprave.naprava_kljuc",
    nastavitveJson: "naprave.nastavitve_json",
  },
  racuniTable: {
    cardPaymentAttemptId: "racuni.card_payment_attempt_id",
    enotaId: "racuni.enota_id",
    vivaTerminalSessionId: "racuni.viva_terminal_session_id",
  },
  vivaVracilaTable: {
    racunId: "viva_vracila.racun_id",
    enotaId: "viva_vracila.enota_id",
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
  ustvariNarocilo: mocks.ustvariNarocilo,
  preveriStatus: mocks.preveriStatus,
  smartCheckoutUrl: mocks.smartCheckoutUrl,
  posljiNaTerminal: vi.fn(),
  preveriVivaTerminalSessionStatus: vi.fn(),
  stornirajVivaTerminal: vi.fn(),
}));

import terminalRouter from "./terminal";

const activeVivaConfig = JSON.stringify({
  vivaAktiven: true,
  vivaClientId: "test-client-id",
  vivaClientSecret: "test-client-secret",
  vivaSourceCode: "test-source-code",
  vivaDemoNacin: true,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = 1;
    (req as any).companyId = "company-test";
    (req as any).log = { error: vi.fn() };
    next();
  });
  app.use(terminalRouter);
  return app;
}

describe("POST /terminal/viva/pay — identiteta naprave", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.ustvariNarocilo.mockReset().mockResolvedValue("order-code");
    mocks.smartCheckoutUrl.mockReset().mockReturnValue("https://checkout.example/order-code");
    mocks.preveriStatus.mockReset();
    mocks.findFirst.mockReset().mockResolvedValue(undefined);
    mocks.execute.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (callback: (tx: any) => unknown) => callback({
      query: { posKarticnaPlacilaAttemptTable: { findFirst: mocks.findFirst } },
      insert: mocks.insert,
      execute: mocks.execute,
    }));
    mocks.insert.mockReset().mockReturnValue({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{
            id: "attempt-row-id",
            provider: "viva_smart",
            purpose: "receipt",
            narociloId: 42,
            znesek: "12.50",
            status: "reserved",
          }],
        }),
      }),
    });
    mocks.update.mockReset().mockReturnValue({
      set: () => ({ where: async () => undefined }),
    });
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ nastavitveJson: activeVivaConfig }],
      }),
    });
  });

  it("iz X-Naprava-Id prebere aktivno per-naprava Viva konfiguracijo", async () => {
    const odgovor = await supertest(buildApp())
      .post("/terminal/viva/pay")
      .set("X-Naprava-Id", "viva-naprava")
      .send({ narociloId: 42, znesek: 12.5, paymentAttemptId: "viva-attempt-1234" });

    expect(odgovor.status).toBe(200);
    expect(odgovor.body).toEqual({
      orderCode: "order-code",
      checkoutUrl: "https://checkout.example/order-code",
      paymentAttemptId: "viva-attempt-1234",
      status: "pending",
    });
    expect(mocks.ustvariNarocilo).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("ponovi obstoječi receipt poskus z istim ključem brez novega Viva naročila", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "existing-attempt-row",
      provider: "viva_smart",
      purpose: "receipt",
      narociloId: 42,
      znesek: "12.50",
      status: "pending",
      providerReferenca: "existing-order-code",
    });
    mocks.smartCheckoutUrl.mockReturnValue("https://checkout.example/existing-order-code");

    const odgovor = await supertest(buildApp())
      .post("/terminal/viva/pay")
      .set("X-Naprava-Id", "viva-naprava")
      .send({ narociloId: 42, znesek: 12.5, paymentAttemptId: "viva-attempt-device-0001" });

    expect(odgovor.status).toBe(200);
    expect(odgovor.body).toEqual({
      orderCode: "existing-order-code",
      checkoutUrl: "https://checkout.example/existing-order-code",
      paymentAttemptId: "viva-attempt-device-0001",
      status: "pending",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.ustvariNarocilo).not.toHaveBeenCalled();
  });

  it("ne začne Viva bremenitve, če je isto naročilo že plačano pri drugem ponudniku", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: "completed-sumup-attempt",
        provider: "sumup",
        purpose: "receipt",
        narociloId: 42,
        znesek: "12.50",
        status: "completed",
        providerReferenca: "sumup-checkout-existing",
      });

    const odgovor = await supertest(buildApp())
      .post("/terminal/viva/pay")
      .set("X-Naprava-Id", "viva-naprava")
      .send({ narociloId: 42, znesek: 12.5, paymentAttemptId: "viva-new-device-attempt" });

    expect(odgovor.status).toBe(409);
    expect(odgovor.body.error).toContain("potrjeno neporabljeno kartično plačilo");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.ustvariNarocilo).not.toHaveBeenCalled();
  });

  it("brez X-Naprava-Id zavrne zahtevo z jasno napako", async () => {
    const odgovor = await supertest(buildApp())
      .post("/terminal/viva/pay")
      .send({ narociloId: 42, znesek: 12.5 });

    expect(odgovor.status).toBe(400);
    expect(odgovor.body).toEqual({
      error: "Manjka identifikator naprave (X-Naprava-Id). Osvežite stran in poskusite znova.",
    });
    expect(mocks.ustvariNarocilo).not.toHaveBeenCalled();
  });

  it("statusu posreduje Viva diagnostiko brez skrivnosti", async () => {
    mocks.preveriStatus.mockResolvedValue({
      status: "PENDING",
      orderCode: "order-code",
      transactionId: null,
      vivaStateId: 3,
      vivaHttpStatus: 404,
      napaka: "Viva status HTTP 404; preverjanje se bo ponovilo.",
    });

    const odgovor = await supertest(buildApp())
      .get("/terminal/viva/status/order-code")
      .set("X-Naprava-Id", "viva-naprava");

    expect(odgovor.status).toBe(200);
    expect(odgovor.body).toEqual({
      status: "PENDING",
      napaka: "Viva status HTTP 404; preverjanje se bo ponovilo.",
      transactionId: null,
      orderCode: "order-code",
      vivaStateId: 3,
      vivaHttpStatus: 404,
    });
  });
});