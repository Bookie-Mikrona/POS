import { afterEach, describe, expect, it, vi } from "vitest";
import { preveriCheckout } from "./pos-sumup";

const response = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

describe("SumUp checkout status contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ohrani providerjev celotni kartični znesek in valuto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "checkout-1",
      checkout_reference: "pos-attempt-attempt-1",
      amount: 13.4,
      currency: "EUR",
      status: "PAID",
    })));

    await expect(preveriCheckout("checkout-1", "test-key")).resolves.toEqual({
      status: "PAID",
      amount: 13.4,
      currency: "EUR",
    });
  });

  it("ne izmisli zneska, če ga callback nima", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "checkout-2",
      checkout_reference: "pos-attempt-attempt-2",
      currency: "EUR",
      status: "PAID",
    })));

    await expect(preveriCheckout("checkout-2", "test-key")).resolves.toEqual({
      status: "PAID",
      amount: undefined,
      currency: "EUR",
    });
  });
});