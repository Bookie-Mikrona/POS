import { afterEach, describe, expect, it } from "vitest";
import { classifyFursDeliveryOutcome, isFursBatchRetryable, sanitizeFursTransportError } from "./pos-furs";

describe("FURS delivery outcome", () => {
  afterEach(() => { delete process.env.FURS_PROXY_SECRET; });
  it("keeps accepted responses confirmed and transport timeouts unknown", () => {
    expect(classifyFursDeliveryOutcome({ uspeh: true, eor: "EOR-1" })).toBe("confirmed");
    expect(classifyFursDeliveryOutcome({ uspeh: false, eor: "", deliveryUnknown: true })).toBe("unknown");
  });

  it("only permits a definite business rejection to become batch-retryable failed", () => {
    expect(classifyFursDeliveryOutcome({ uspeh: false, eor: "" })).toBe("failed");
    expect(isFursBatchRetryable("failed")).toBe(true);
    expect(isFursBatchRetryable("unknown")).toBe(false);
    expect(isFursBatchRetryable("sending")).toBe(false);
  });

  it("redacts proxy credentials from transport evidence", () => {
    process.env.FURS_PROXY_SECRET = "do-not-leak";
    expect(sanitizeFursTransportError(new Error("socket do-not-leak failed"))).toBe("socket [REDACTED] failed");
  });
});