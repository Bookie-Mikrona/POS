import { describe, expect, it } from "vitest";
import { CreateTipAllocationBody, CreateTipSettlementBody } from "@workspace/api-zod";
import { formatPayrollDocumentDate, mayUseEmployerControlledTips, sanitizeSpreadsheetCell, validateTipProfileShares } from "./tips";

describe("tip operational ledger API contract", () => {
  it("accepts an explicitly selected independent pool allocation", () => {
    expect(CreateTipAllocationBody.parse({
      racunId: 12, tipPolicyId: "f660bdff-8385-4a9e-bb50-1b611a5f0d3c",
      tipPoolId: "99c2f5a7-2c7e-4091-86de-0ad29a7045fa", recipientNatakarId: null,
      grossAmount: 10, feeAmount: 0, netAmount: 10,
    }).tipPoolId).toBe("99c2f5a7-2c7e-4091-86de-0ad29a7045fa");
  });

  it("accepts a waiter-linked allocation without trusting a client name snapshot", () => {
    const parsed = CreateTipAllocationBody.parse({
      racunId: 12, tipPolicyId: "f660bdff-8385-4a9e-bb50-1b611a5f0d3c",
      recipientNatakarId: 42, grossAmount: 10, feeAmount: 0, netAmount: 10,
    });
    expect(parsed.recipientNatakarId).toBe(42);
    expect(parsed.recipientSnapshot).toBeUndefined();
  });

  it("requires evidence for every formal settlement", () => {
    expect(() => CreateTipSettlementBody.parse({
      allocationId: "f660bdff-8385-4a9e-bb50-1b611a5f0d3c", settlementMethod: "bank",
      settlementReference: "TRR-42", settledAt: "2026-01-02T12:00:00Z",
    })).toThrow();
  });

  it("neutralizes spreadsheet formulas in exported evidence", () => {
    expect(sanitizeSpreadsheetCell("=HYPERLINK(\"https://example.test\")")).toBe("'=HYPERLINK(\"https://example.test\")");
    expect(sanitizeSpreadsheetCell("  +cmd|' /C calc'!A0")).toBe("'  +cmd|' /C calc'!A0");
    expect(sanitizeSpreadsheetCell("ordinary evidence")).toBe("ordinary evidence");
  });

  it("requires distribution profiles to total exactly 100 percent", () => {
    expect(validateTipProfileShares([{ sharePercent: 60 }, { sharePercent: 40 }])).toBe(true);
    expect(validateTipProfileShares([{ sharePercent: 60 }, { sharePercent: 39.99 }])).toBe(false);
    expect(validateTipProfileShares([])).toBe(false);
  });

  it("blocks only new employer-controlled use after opt-out", () => {
    expect(mayUseEmployerControlledTips("employer_controlled", false)).toBe(false);
    expect(mayUseEmployerControlledTips("direct_employee", false)).toBe(true);
    expect(mayUseEmployerControlledTips("employer_controlled", true)).toBe(true);
  });

  it("formats payroll dates in the Slovenian document-date format", () => {
    expect(formatPayrollDocumentDate("2026-03-01T23:30:00.000Z")).toBe("02.03.2026");
  });
});