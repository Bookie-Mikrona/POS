import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFinancialStatementFilters } from "./useFinancialStatementFilters";

const balance = { asOf: "2026-10-18", compareAsOf: "2025-12-31", enableCompare: false };
const income = {
  dateFrom: "2026-01-01", dateTo: "2026-10-18",
  compareDateFrom: "2025-01-01", compareDateTo: "2025-12-31", enableCompare: false,
};
const key = `bookie:balance-sheet-filters:${JSON.stringify(["user-a", "company-a"])}`;

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("financial statement session selections", () => {
  it("preserves existing defaults without writing storage on mount", () => {
    const { result } = renderHook(() => useFinancialStatementFilters("balance-sheet", "user-a", "company-a", balance));
    expect(result.current).toMatchObject(balance);
    expect(sessionStorage.length).toBe(0);
  });

  it("restores balance dates and the compare checkbox, including batched shortcuts", () => {
    const mount = () => renderHook(() => useFinancialStatementFilters("balance-sheet", "user-a", "company-a", balance));
    const first = mount();
    act(() => {
      first.result.current.updateFilters({ asOf: "2024-12-31" });
      first.result.current.updateFilters({ compareAsOf: "2023-12-31" });
      first.result.current.updateFilters({ enableCompare: true });
    });
    first.unmount();
    expect(mount().result.current).toMatchObject({
      asOf: "2024-12-31", compareAsOf: "2023-12-31", enableCompare: true,
    });
  });

  it("keeps the income period and disabled comparison dates, including empty inputs", () => {
    const mount = () => renderHook(() => useFinancialStatementFilters("income-statement", "user-a", "company-a", income));
    const first = mount();
    const changed = {
      dateFrom: "", dateTo: "2024-09-30",
      compareDateFrom: "2023-02-01", compareDateTo: "", enableCompare: true,
    };
    act(() => first.result.current.updateFilters(changed));
    act(() => first.result.current.updateFilters({ enableCompare: false }));
    first.unmount();
    expect(mount().result.current).toMatchObject({ ...changed, enableCompare: false });
  });

  it("separates companies, users and reports, including delayed identity loading", () => {
    const { result, rerender } = renderHook(
      ({ user, company }: { user?: string; company?: string }) =>
        useFinancialStatementFilters("balance-sheet", user, company, balance),
      { initialProps: { user: "user-a", company: "company-a" } },
    );
    act(() => result.current.updateFilters({ asOf: "2020-12-31", enableCompare: true }));
    rerender({ user: "user-a", company: "company-b" });
    expect(result.current).toMatchObject(balance);
    act(() => result.current.updateFilters({ compareAsOf: "2019-12-31" }));
    rerender({ user: "user-b", company: "company-a" });
    expect(result.current).toMatchObject(balance);
    rerender({ user: undefined, company: undefined });
    act(() => result.current.updateFilters({ asOf: "" }));
    rerender({ user: "user-a", company: "company-a" });
    expect(result.current).toMatchObject({ ...balance, asOf: "2020-12-31", enableCompare: true });
    const other = renderHook(() => useFinancialStatementFilters("income-statement", "user-a", "company-a", income));
    expect(other.result.current).toMatchObject(income);
    rerender({ user: "user-a", company: "company-b" });
    expect(result.current).toMatchObject({ ...balance, compareAsOf: "2019-12-31" });
  });

  it("ignores invalid fields and safely handles malformed or unavailable storage", () => {
    const mount = () => renderHook(() => useFinancialStatementFilters("balance-sheet", "user-a", "company-a", balance));
    sessionStorage.setItem(key, JSON.stringify({ asOf: 12, compareAsOf: "bad", enableCompare: "false" }));
    const invalid = mount();
    expect(invalid.result.current).toMatchObject(balance);
    invalid.unmount();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sessionStorage.setItem(key, "{bad");
    const malformed = mount();
    expect(malformed.result.current).toMatchObject(balance);
    malformed.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const unavailable = mount();
    act(() => unavailable.result.current.updateFilters({ asOf: "" }));
    expect(unavailable.result.current.asOf).toBe("");
  });
});
