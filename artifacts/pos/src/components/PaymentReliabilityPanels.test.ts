import { describe, expect, it } from "vitest";
import { classifyFursReceipt, createRetryGuard } from "./PaymentReliabilityPanels";

describe("FURS receipt classification", () => {
  it("does not turn a receipt without EOR into a failure", () => {
    expect(classifyFursReceipt({})).toBe("unknown");
    expect(classifyFursReceipt({ zoi: "zoi" })).toBe("sending");
    expect(classifyFursReceipt({ status: "napaka" })).toBe("failed");
    expect(classifyFursReceipt({ status: "napaka", eor: "eor" })).toBe("confirmed");
  });
});

describe("bulk FURS retry guard", () => {
  it("rejects a same-tick double click until released", () => {
    const guard = createRetryGuard();
    expect(guard.claim()).toBe(true);
    expect(guard.claim()).toBe(false);
    guard.release();
    expect(guard.claim()).toBe(true);
  });
});