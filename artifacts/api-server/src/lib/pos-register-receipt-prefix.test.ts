import { describe, expect, it } from "vitest";
import { getPosReceiptPrefixPattern } from "./pos-register-receipt-prefix";

describe("getPosReceiptPrefixPattern", () => {
  it("escapes literal LIKE metacharacters but preserves the final wildcard", () => {
    expect(getPosReceiptPrefixPattern("PP!%_", "B_%!"))
      .toBe("PP!!!%!_-B!_!%!!-%");
  });
});