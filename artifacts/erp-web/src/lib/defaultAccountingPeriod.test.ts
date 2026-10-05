import { describe, expect, it } from "vitest";
import { defaultAccountingPeriod } from "./defaultAccountingPeriod";

const periods = [
  { id: "old", startDate: "2020-01-01", endDate: "2020-12-31" },
  { id: "current", startDate: "2026-01-01", endDate: "2026-12-31" },
  { id: "future", startDate: "2027-01-01", endDate: "2027-12-31" },
];

describe("default accounting period", () => {
  it("prefers the current period over a future period", () => {
    expect(defaultAccountingPeriod(periods, "2026-10-05")).toBe("current");
  });
  it("uses the newest period when none contains today", () => {
    expect(defaultAccountingPeriod(periods, "2028-10-05")).toBe("future");
  });
  it("includes the first and last day of the period", () => {
    expect(defaultAccountingPeriod(periods, "2026-01-01")).toBe("current");
    expect(defaultAccountingPeriod(periods, "2026-12-31")).toBe("current");
  });
  it("does not mutate the API data", () => {
    const input = Object.freeze([...periods]);
    defaultAccountingPeriod(input, "2026-10-05");
    expect(input.map(period => period.id)).toEqual(["old", "current", "future"]);
  });
  it("shows all when there are no periods", () => {
    expect(defaultAccountingPeriod([], "2026-10-05")).toBe("all");
  });
});
