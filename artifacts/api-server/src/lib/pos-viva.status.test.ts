import { afterEach, describe, expect, it, vi } from "vitest";
import { posljiNaTerminal, preveriStatus } from "./pos-viva";

const clientId = "test-client-id";
const clientSecret = "test-client-secret";

function mockFetchForOrder(orderResponse: object) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/connect/token")) return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "test-token" }),
    };
    return orderResponse;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("preveriStatus — Viva Smart Checkout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([404, 500])("HTTP %i obravnava kot UNKNOWN, ne kot neuspešno plačilo", async (httpStatus) => {
    mockFetchForOrder({ ok: false, status: httpStatus });

    await expect(preveriStatus("order-pending-http", clientId, clientSecret, true)).resolves.toMatchObject({
      status: "UNKNOWN",
      orderCode: "order-pending-http",
      vivaHttpStatus: httpStatus,
      vivaStateId: null,
    });
  });

  it("stateId 5 vrne PAID skupaj z diagnostičnimi polji", async () => {
    mockFetchForOrder({
      ok: true,
      status: 200,
      json: async () => ({ StateId: 5, TransactionId: "transaction-5", OrderCode: "order-paid" }),
    });

    await expect(preveriStatus("order-paid", clientId, clientSecret, true)).resolves.toEqual({
      status: "PAID",
      orderCode: "order-paid",
      transactionId: "transaction-5",
      vivaStateId: 5,
      vivaHttpStatus: 200,
    });
  });

  it("neznani stateId ohrani kot PENDING", async () => {
    mockFetchForOrder({
      ok: true,
      status: 200,
      json: async () => ({ StateId: 3, OrderCode: "order-pending" }),
    });

    await expect(preveriStatus("order-pending", clientId, clientSecret, true)).resolves.toMatchObject({
      status: "PENDING",
      orderCode: "order-pending",
      vivaStateId: 3,
      vivaHttpStatus: 200,
    });
  });

  it("eksplicitno preklicano naročilo vrne FAILED", async () => {
    mockFetchForOrder({
      ok: true,
      status: 200,
      json: async () => ({ StateId: 3, IsCanceled: true, OrderCode: "order-cancelled" }),
    });

    await expect(preveriStatus("order-cancelled", clientId, clientSecret, true)).resolves.toMatchObject({
      status: "FAILED",
      orderCode: "order-cancelled",
      vivaStateId: 3,
      vivaHttpStatus: 200,
    });
  });
});

describe("posljiNaTerminal — Viva ECR contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pošlje isti stabilni attempt ključ kot merchantReference in customerTrns", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("/connect/token")
      ? new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 })
      : new Response(JSON.stringify({ sessionId: "session-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(posljiNaTerminal(
      13.4,
      "session-1",
      "terminal-1",
      "payment-attempt-1",
      clientId,
      clientSecret,
      true,
    )).resolves.toBeUndefined();

    const ecrCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/ecr/v1/transactions"));
    expect(ecrCall).toBeDefined();
    const request = ecrCall![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      amount: 1340,
      sessionId: "session-1",
      terminalId: "terminal-1",
      merchantReference: "payment-attempt-1",
      customerTrns: "payment-attempt-1",
    });
  });
});