import { afterEach, describe, expect, it, vi } from "vitest";
import { preveriVivaTransakcijo } from "./pos-viva";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("preveriVivaTransakcijo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("potrdi samo uspešno transakcijo z enakim ID-jem in zneskom", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-token" }))
      .mockResolvedValueOnce(jsonResponse({ transactionId: "tx-1", amount: 3, statusId: "F", merchantTrns: "attempt-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(preveriVivaTransakcijo("tx-1", 300, "attempt-1", "client-paid", "secret", true)).resolves.toEqual({
      status: "PAID",
      transactionId: "tx-1",
      amountCents: 300,
    });
  });

  it("zavrne transakcijo z napačnim zneskom", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-token" }))
      .mockResolvedValueOnce(jsonResponse({ transactionId: "tx-1", amount: 12, statusId: "F", merchantTrns: "attempt-1" })));

    const result = await preveriVivaTransakcijo("tx-1", 1250, "attempt-1", "client-amount", "secret", true);
    expect(result.status).toBe("FAILED");
  });

  it("nedosegljiv status ohrani kot UNKNOWN in ne kot zavrnitev", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-token" }))
      .mockRejectedValueOnce(new Error("timeout")));

    const result = await preveriVivaTransakcijo("tx-1", 1250, "attempt-1", "client-timeout", "secret", true);
    expect(result.status).toBe("UNKNOWN");
  });

  it("neznan ali manjkajoč status ohrani kot UNKNOWN", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-token" }))
      .mockResolvedValueOnce(jsonResponse({ transactionId: "tx-1", amount: 12.5, merchantTrns: "attempt-1" })));

    const result = await preveriVivaTransakcijo("tx-1", 1250, "attempt-1", "client-unknown", "secret", true);
    expect(result.status).toBe("UNKNOWN");
  });

  it("ponovno uporabi veljaven OAuth žeton pri naslednjem preverjanju", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "cached-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ transactionId: "tx-1", amount: 3, statusId: "F", merchantTrns: "attempt-1" }))
      .mockResolvedValueOnce(jsonResponse({ transactionId: "tx-2", amount: 4, statusId: "F", merchantTrns: "attempt-2" }));
    vi.stubGlobal("fetch", fetchMock);

    await preveriVivaTransakcijo("tx-1", 300, "attempt-1", "client-cache", "secret", true);
    await preveriVivaTransakcijo("tx-2", 400, "attempt-2", "client-cache", "secret", true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/connect/token");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/checkout/v2/transactions/tx-2");
  });
});