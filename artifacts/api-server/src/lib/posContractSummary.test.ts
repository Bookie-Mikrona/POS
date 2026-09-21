import { describe, expect, it } from "vitest";
import {
  buildContractSummaryPostingLines,
  resolveContractSummaryDueDate,
} from "./posContractSummary";

describe("mesečni pogodbeni A-račun", () => {
  it("knjiži samo končno terjatev proti prehodnemu kontu", () => {
    const lines = buildContractSummaryPostingLines({
      invoiceNumber: "A-2026-08-001",
      month: "2026-08",
      counterpartyId: "partner-1",
      receivableAccountId: "120",
      transitAccountId: "165",
      grossAmount: "109.50",
    });

    expect(lines).toEqual([
      expect.objectContaining({ accountId: "120", side: "debit", amount: "109.50" }),
      expect.objectContaining({ accountId: "165", side: "credit", amount: "109.50" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, line) => sum + (line.side === "debit" ? 1 : -1) * Number(line.amount), 0)).toBe(0);
    expect(lines.some((line) => /^26|^76|^45/.test(line.accountId))).toBe(false);
  });

  it("rok plačila določi partnerjev pogodbeni rok", () => {
    expect(resolveContractSummaryDueDate("2026-09-03", 30)).toBe("2026-10-03");
    expect(resolveContractSummaryDueDate("2026-01-31", 30)).toBe("2026-03-02");
  });
});