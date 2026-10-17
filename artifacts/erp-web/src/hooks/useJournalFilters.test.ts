import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJournalFilters } from "./useJournalFilters";

const key = (company: string) => `bookie:journal-filters:${company}`;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("saved journal filters", () => {
  it("keeps the automatic period until periods finish loading, without saving defaults", () => {
    const { result, rerender } = renderHook(({ period }) => useJournalFilters("a", period), {
      initialProps: { period: "all" },
    });
    rerender({ period: "current" });
    expect(result.current.periodFilter).toBe("current");
    expect(localStorage.getItem(key("a"))).toBeNull();
  });

  it("saves each filter change immediately and restores every filter on remount", () => {
    const { result, unmount } = renderHook(() => useJournalFilters("a", "current"));
    const changes = {
      periodFilter: "old",
      statusFilter: "posted",
      costCenterFilter: "cc",
      projectFilter: "project",
      departmentFilter: "department",
      entryKindFilter: "monthly-pos",
    };
    for (const [field, value] of Object.entries(changes)) {
      act(() => result.current.updateFilters({ [field]: value }));
      expect(JSON.parse(localStorage.getItem(key("a"))!)[field]).toBe(value);
    }
    unmount();
    const restored = renderHook(() => useJournalFilters("a", "current"));
    expect(restored.result.current).toMatchObject(changes);
  });

  it("does not leak or overwrite filters when changing company or loading the company later", () => {
    const { result, rerender } = renderHook(
      ({ company }: { company: string | undefined }) => useJournalFilters(company, "current"),
      { initialProps: { company: undefined as string | undefined } },
    );
    rerender({ company: "a" });
    act(() => result.current.updateFilters({ costCenterFilter: "a-cc" }));
    rerender({ company: "b" });
    expect(result.current.costCenterFilter).toBe("all");
    act(() => result.current.updateFilters({ statusFilter: "draft" }));
    rerender({ company: "a" });
    expect(result.current.costCenterFilter).toBe("a-cc");
    expect(result.current.statusFilter).toBe("all");
    expect(JSON.parse(localStorage.getItem(key("b"))!).statusFilter).toBe("draft");
  });

  it("clears visible and stored filters without rewriting the removed key", () => {
    const { result, unmount } = renderHook(() => useJournalFilters("a", "current"));
    act(() => result.current.updateFilters({ projectFilter: "project", statusFilter: "draft" }));
    act(() => result.current.clearFilters());
    expect(result.current).toMatchObject({
      periodFilter: "all", statusFilter: "all", costCenterFilter: "all",
      projectFilter: "all", departmentFilter: "all", entryKindFilter: "all",
    });
    expect(localStorage.getItem(key("a"))).toBeNull();
    unmount();
    const restored = renderHook(() => useJournalFilters("a", "current"));
    expect(restored.result.current.projectFilter).toBe("all");
    expect(restored.result.current.periodFilter).toBe("current");
  });

  it("restores explicit all periods even while periods are loading", () => {
    localStorage.setItem(key("a"), JSON.stringify({ periodFilter: "all" }));
    const { result, rerender } = renderHook(({ period }) => useJournalFilters("a", period), {
      initialProps: { period: "all" },
    });
    rerender({ period: "current" });
    expect(result.current.periodFilter).toBe("all");
  });

  it("ignores invalid field types and unknown enum values", () => {
    localStorage.setItem(key("a"), JSON.stringify({
      periodFilter: {}, statusFilter: "bad", projectFilter: 3,
      costCenterFilter: "", departmentFilter: "valid", entryKindFilter: "bad",
    }));
    const { result } = renderHook(() => useJournalFilters("a", "current"));
    expect(result.current).toMatchObject({
      periodFilter: "current", statusFilter: "all", projectFilter: "all",
      costCenterFilter: "all", departmentFilter: "valid", entryKindFilter: "all",
    });
  });

  it("survives corrupt JSON and unavailable browser storage", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(key("a"), "{");
    const corrupt = renderHook(() => useJournalFilters("a", "current"));
    expect(corrupt.result.current.statusFilter).toBe("all");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useJournalFilters("b", "current"));
    act(() => result.current.updateFilters({ statusFilter: "posted" }));
    expect(result.current.statusFilter).toBe("posted");
    act(() => result.current.clearFilters());
    expect(result.current.statusFilter).toBe("all");
  });
});
