import { afterEach, describe, expect, it, vi } from "vitest";
import { stornirajVivaTerminal } from "./pos-viva";

describe("stornirajVivaTerminal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pošlje merchant Cloud Terminal refund na :refund z novo sejo in originalnim parentSessionId", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "demo-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    await stornirajVivaTerminal({
      refundSessionId: "refund-session-uuid",
      parentSessionId: "original-sale-session-uuid",
      originalTransactionId: "original-transaction-id",
      originalOrderCode: "original-order-code",
      amountEur: 12.34,
      terminalId: "terminal-1",
      merchantReference: "REFUND:PP001-B001-000001",
      customerTrns: "Vračilo računa PP001-B001-000001",
      context: { model: "merchant", cashRegisterId: "BOOKIE-ENOTA-1" },
    }, "client-id", "client-secret", true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://demo-api.vivapayments.com/ecr/v1/transactions:refund"
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer demo-token" }),
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      sessionId: "refund-session-uuid",
      parentSessionId: "original-sale-session-uuid",
      terminalId: "terminal-1",
      cashRegisterId: "BOOKIE-ENOTA-1",
      amount: 1234,
      currencyCode: 978,
      merchantReference: "REFUND:PP001-B001-000001; ORIG:original-transaction-id; ORDER:original-order-code",
      customerTrns: "Vračilo računa PP001-B001-000001",
      showTransactionResult: true,
      showReceipt: true,
      interappCallback: "finish",
    });
  });
});