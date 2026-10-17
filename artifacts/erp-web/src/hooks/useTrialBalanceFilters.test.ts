import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrialBalanceFilters } from "./useTrialBalanceFilters";

const dates = { dateFrom: "2026-01-01", dateTo: "2026-10-17" };
const selected = { dateFrom: "2025-02-01", dateTo: "2025-09-30", classFilter: "4", search: "Stroški" };
const key = `bookie:trial-balance-filters:${JSON.stringify(["user-a", "company-a"])}`;
const mount = () => renderHook(() => useTrialBalanceFilters("user-a", "company-a", dates));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("trial balance session filters", () => {
  it("uses existing date defaults for a new session", () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ ...dates, classFilter: "all", search: "" });
    expect(sessionStorage.length).toBe(0);
  });

  it("restores all four filters after leaving and remounting the tab", () => {
    const first = mount();
    act(() => first.result.current.updateFilters(selected));
    first.unmount();
    const second = mount();
    expect(second.result.current).toMatchObject(selected);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(selected);
  });

  it("preserves cleared dates, class and search instead of reapplying defaults", () => {
    const first = mount();
    act(() => first.result.current.updateFilters(selected));
    act(() => first.result.current.updateFilters({ dateFrom: "", dateTo: "", classFilter: "all", search: "" }));
    first.unmount();
    expect(mount().result.current).toMatchObject({ dateFrom: "", dateTo: "", classFilter: "all", search: "" });
  });

  it("composes both date changes in a single shortcut click and persists the complete period", () => {
    const first = mount();
    act(() => {
      first.result.current.updateFilters({ dateFrom: "2025-01-01" });
      first.result.current.updateFilters({ dateTo: "2025-12-31" });
    });
    const expected = { dateFrom: "2025-01-01", dateTo: "2025-12-31", classFilter: "all", search: "" };
    expect(first.result.current).toMatchObject(expected);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(expected);
    first.unmount();
    expect(mount().result.current).toMatchObject(expected);
  });

  it("keeps companies and signed-in users separate, including delayed identity loading", () => {
    const { result, rerender } = renderHook(
      ({ user, company }: { user?: string; company?: string }) => useTrialBalanceFilters(user, company, dates),
      { initialProps: { user: "user-a", company: "company-a" } },
    );
    act(() => result.current.updateFilters(selected));
    rerender({ user: "user-a", company: "company-b" });
    expect(result.current).toMatchObject({ ...dates, search: "", classFilter: "all" });
    rerender({ user: "user-b", company: "company-a" });
    expect(result.current.search).toBe("");
    rerender({ user: undefined, company: undefined });
    expect(result.current.search).toBe("");
    rerender({ user: "user-a", company: "company-a" });
    expect(result.current).toMatchObject(selected);
  });

  it("ignores invalid saved field types and classes", () => {
    sessionStorage.setItem(key, JSON.stringify({ dateFrom: 5, dateTo: {}, classFilter: "99", search: null }));
    expect(mount().result.current).toMatchObject({ ...dates, classFilter: "all", search: "" });
  });

  it("handles malformed or unavailable storage without breaking the form", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sessionStorage.setItem(key, "{broken");
    const first = mount();
    expect(first.result.current.dateFrom).toBe(dates.dateFrom);
    first.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const second = mount();
    act(() => second.result.current.updateFilters(selected));
    expect(second.result.current).toMatchObject(selected);
  });
});
