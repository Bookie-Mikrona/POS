import { describe, expect, it } from "vitest";
import { effectivePartnerLedgerRows, importedPartnerCode, isPartnerLedgerOpening } from "./partner-ledger-provenance";

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

describe("partner ledger opening carryforwards", () => {
  const row = (reference: string | null, postingDate: string, partnerId = "partner-a", accountId = "account-a") => ({
    reference, postingDate, partnerId, accountId,
  });
  it("recognizes only the explicit imported opening voucher class", () => {
    expect(isPartnerLedgerOpening("BOOKIE-OLD/K2/2020/00/000001")).toBe(true);
    expect(isPartnerLedgerOpening("OTV-2026-01")).toBe(true);
    expect(isPartnerLedgerOpening("OTV-2026-02")).toBe(false);
    expect(isPartnerLedgerOpening("BOOKIE-OLD/K2/2025/10/000001")).toBe(false);
    expect(isPartnerLedgerOpening("OTVORITEV - običajen opis")).toBe(false);
    expect(isPartnerLedgerOpening(null)).toBe(false);
  });
  it("keeps the first-year baseline once, excluding later annual carryforwards", () => {
    const opening = row("BOOKIE-OLD/K2/2020/00/000001", "2020-01-01");
    const invoice = row("BOOKIE-OLD/K2/2020/10/000001", "2020-06-01");
    const laterOpening = row("BOOKIE-OLD/K2/2021/00/000001", "2021-01-01");
    const payment = row("BOOKIE-OLD/K2/2021/60/000001", "2021-02-01");
    const source = Object.freeze([laterOpening, opening, invoice, payment]);
    expect(effectivePartnerLedgerRows(source)).toEqual([opening, invoice, payment]);
    expect(source).toHaveLength(4);
  });
  it("does not add a later opening to an already older movement history", () => {
    const invoice = row("MANUAL-OLD", "2019-06-01");
    expect(effectivePartnerLedgerRows([invoice, row("BOOKIE-OLD/K2/2020/00/000001", "2020-01-01")])).toEqual([invoice]);
  });
  it("keeps first-year baselines independently for each partner and account", () => {
    const a = row("BOOKIE-OLD/K2/2020/00/000001", "2020-01-01");
    const b = row("BOOKIE-OLD/K2/2023/00/000001", "2023-01-01", "partner-b");
    const c = row("BOOKIE-OLD/K2/2024/00/000001", "2024-01-01", "partner-a", "account-b");
    expect(effectivePartnerLedgerRows([a, b, c])).toEqual([a, b, c]);
  });
});