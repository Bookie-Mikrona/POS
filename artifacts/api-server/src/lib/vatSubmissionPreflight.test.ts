import { describe, expect, it } from "vitest";
import { vatSubmissionPeriodBounds } from "./vatSubmissionPreflight";

describe("vatSubmissionPeriodBounds", () => {
  it("keeps monthly March separate from the first quarter", () => {
    expect(vatSubmissionPeriodBounds(2026, "0703", "mesecno")).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("returns all three months for a quarterly filing", () => {
    expect(vatSubmissionPeriodBounds(2026, "0703", "trimesecno")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("rejects a quarterly period that does not end a quarter", () => {
    expect(vatSubmissionPeriodBounds(2026, "0702", "trimesecno")).toBeNull();
  });

  it("uses the actual last day of leap-year February", () => {
    expect(vatSubmissionPeriodBounds(2028, "0702", "mesecno")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});
