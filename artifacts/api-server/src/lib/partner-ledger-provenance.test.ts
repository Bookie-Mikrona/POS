import { describe, expect, it } from "vitest";
import { importedPartnerCode } from "./partner-ledger-provenance";

describe("explicit Bookie Old partner-code provenance", () => {
  it("preserves leading zeroes in the exact import suffix", () => {
    expect(importedPartnerCode("BOOKIE-OLD/K2/2025/10/000001",
      "Račun [Bookie Old GLAVNA #123, konto 1200, partner 00012 ČŠŽ d.o.o.]")).toBe("00012");
  });
  it("does not invent codes from general descriptions or unresolved partners", () => {
    expect(importedPartnerCode("MANUAL-1", "[Bookie Old GLAVNA #123, konto 1200, partner 12 X]")).toBeNull();
    expect(importedPartnerCode("BOOKIE-OLD/K2/2025/10/1", "Račun partner 12")).toBeNull();
    expect(importedPartnerCode("BOOKIE-OLD/K2/2025/10/1", "[Bookie Old GLAVNA #123, konto 1200, nerazrešen partner 12]")).toBeNull();
  });
});