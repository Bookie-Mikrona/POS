import { describe, expect, it } from "vitest";
import {
  clearGiftCardPaymentState,
  buildCardGiftIssuancePayment,
  buildGiftSumupPayBody,
  giftCardPaymentStorageKey,
  readGiftCardPaymentState,
  writeGiftCardPaymentState,
} from "./giftCardPaymentState";

describe("gift card payment session state", () => {
  it("restores the exact key, cents and canonical attempt in the same scope", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const state = {
      idempotencyKey: "gift-stable-key-0001",
      amountCents: 1250,
      attemptId: "1a2b3c4d-1111-4111-8111-123456789abc",
      status: "completed" as const,
    };
    writeGiftCardPaymentState(storage, "7", "device-a", state);
    expect(readGiftCardPaymentState(storage, "7", "device-a")).toEqual(state);
    expect(buildGiftSumupPayBody(state)).toEqual({
      purpose: "gift_voucher",
      znesek: 12.5,
      paymentAttemptId: "gift-stable-key-0001",
    });
    expect(buildGiftSumupPayBody(state)).not.toHaveProperty("narociloId");
    expect(buildCardGiftIssuancePayment(state)).toEqual({
      znesek: 12.5,
      idempotencyKey: "gift-stable-key-0001",
      paymentAttemptId: "1a2b3c4d-1111-4111-8111-123456789abc",
    });
    expect(readGiftCardPaymentState(storage, "8", "device-a")).toBeNull();
    clearGiftCardPaymentState(storage, "7", "device-a");
    expect(values.has(giftCardPaymentStorageKey("7", "device-a"))).toBe(false);
  });
});