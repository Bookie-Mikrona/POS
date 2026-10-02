import { describe, expect, it } from "vitest";
import { activeSettlementAmounts, calculateOpenRemainder, calculatePartnerLedger, parseLegacyRecordedDate } from "./partner-ledger-calculator";

describe("partner ledger calculator", () => {
  it("keeps debit and credit open amounts separate and honors as-of closures", () => {
    const result = calculatePartnerLedger([
      { id: "d", date: "2026-01-01", debit: "100.00", credit: "0.00", sourceOrder: 1 },
      { id: "c", date: "2026-01-02", debit: "0.00", credit: "100.00", sourceOrder: 2 },
    ], [{ id: "later-close", sourceLineId: "d", targetLineId: "c", amount: "40.00", effectiveDate: "2026-02-01", eventType: "close" }], "2026-01-31");
    expect(result.map(({ openDebit, openCredit }) => [openDebit, openCredit])).toEqual([["100.00", "0.00"], ["0.00", "100.00"]]);
    expect(result.at(-1)?.runningBalance).toBe("0.00");
  });

  it("supports effective-date reopen and strict historical M/D/YYYY parsing", () => {
    expect(parseLegacyRecordedDate("9/10/2026")).toBe("2026-09-10");
    expect(parseLegacyRecordedDate("13/10/2026")).toBeNull();
    const result = calculatePartnerLedger([
      { id: "d", date: "2026-01-01", debit: "100.00", credit: "0.00", sourceOrder: 1 },
      { id: "c", date: "2026-01-02", debit: "0.00", credit: "100.00", sourceOrder: 2 },
    ], [
      { id: "close-1", sourceLineId: "d", targetLineId: "c", amount: 100, effectiveDate: "2026-02-01", eventType: "close" },
      { id: "reopen-1", sourceLineId: "d", targetLineId: "c", amount: 25, effectiveDate: "2026-03-01", eventType: "reopen", closeEventId: "close-1" },
    ], "2026-03-02");
    expect(result.map(({ openDebit, openCredit }) => [openDebit, openCredit])).toEqual([["25.00", "0.00"], ["0.00", "25.00"]]);
  });

  it("uses decimal arithmetic and deduplicates reverse evidence by stable closing identity", () => {
    const close = { id: "legacy:42", sourceLineId: "debit", targetLineId: "credit", amount: "0.30", effectiveDate: "2026-01-02", eventType: "close" as const };
    const evidence = [close, { ...close, sourceLineId: "debit", targetLineId: "credit" }];
    expect(activeSettlementAmounts(evidence, "2026-01-02").get("legacy:42")?.toFixed(2)).toBe("0.30");
    expect(calculateOpenRemainder("0.50", evidence, "2026-01-02", "debit")).toBe("0.20");
    const ledger = calculatePartnerLedger([
      { id: "debit", date: "2026-01-01", debit: "0.30", credit: "0", sourceOrder: 1 },
      { id: "credit", date: "2026-01-01", debit: "0", credit: "0.30", sourceOrder: 2 },
    ], evidence, "2026-01-02");
    expect(ledger.at(-1)?.runningBalance).toBe("0.00");
    expect(ledger.map((line) => [line.openDebit, line.openCredit])).toEqual([["0.00", "0.00"], ["0.00", "0.00"]]);
  });

  it("preserves signed negative postings as the opposite open side and keeps both sides open at zero net", () => {
    const result = calculatePartnerLedger([
      { id: "normal-debit", date: "2026-01-01", debit: "0.30", credit: "0", sourceOrder: 1, balanceGroup: "a" },
      { id: "normal-credit", date: "2026-01-01", debit: "0", credit: "0.30", sourceOrder: 2, balanceGroup: "a" },
      { id: "negative-debit", date: "2026-01-02", debit: "-0.20", credit: "0", sourceOrder: 3, balanceGroup: "a" },
      { id: "negative-credit", date: "2026-01-03", debit: "0", credit: "-0.10", sourceOrder: 4, balanceGroup: "a" },
    ], [], "2026-01-03");
    expect(result[2]).toMatchObject({ debit: "-0.20", openDebit: "0.00", openCredit: "0.20" });
    expect(result[3]).toMatchObject({ credit: "-0.10", openDebit: "0.10", openCredit: "0.00" });
    expect(result[0]).toMatchObject({ openDebit: "0.30", openCredit: "0.00" });
    expect(result[1]).toMatchObject({ openDebit: "0.00", openCredit: "0.30", runningBalance: "0.00" });
    expect(result[1]?.runningBalance).toBe("0.00");
  });

  it("does not apply later close or reopen evidence to an earlier balance", () => {
    const close = { id: "legacy-close", sourceLineId: "invoice", amount: "0.30", effectiveDate: "2026-04-01", eventType: "close" as const };
    const reopen = { id: "reopen", sourceLineId: "invoice", amount: "0.10", effectiveDate: "2026-05-01", eventType: "reopen" as const, externalClosingId: "legacy-close" };
    expect(calculateOpenRemainder("0.50", [close, reopen], "2026-03-31", "invoice")).toBe("0.50");
    expect(calculateOpenRemainder("0.50", [close, reopen], "2026-04-30", "invoice")).toBe("0.20");
    expect(calculateOpenRemainder("0.50", [close, reopen], "2026-05-01", "invoice")).toBe("0.30");
  });
});