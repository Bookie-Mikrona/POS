import { useState } from "react";

type JournalFilters = {
  periodFilter: string | null;
  statusFilter: string;
  costCenterFilter: string;
  projectFilter: string;
  departmentFilter: string;
  entryKindFilter: string;
};

const defaults: JournalFilters = {
  periodFilter: null,
  statusFilter: "all",
  costCenterFilter: "all",
  projectFilter: "all",
  departmentFilter: "all",
  entryKindFilter: "all",
};

const storageKey = (companyId: string) => `bookie:journal-filters:${companyId}`;

function restore(companyId?: string): JournalFilters {
  if (!companyId) return { ...defaults };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(companyId)) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof JournalFilters)[]) {
      const value = (saved as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) result[key] = value;
    }
    if (!["all", "draft", "posted", "reversed"].includes(result.statusFilter)) result.statusFilter = "all";
    if (!["all", "monthly-pos"].includes(result.entryKindFilter)) result.entryKindFilter = "all";
    return result;
  } catch (error) {
    console.warn("Filtrov temeljnic ni bilo mogoče obnoviti.", error);
    return { ...defaults };
  }
}

export function useJournalFilters(companyId: string | undefined, defaultPeriod: string) {
  const [selection, setSelection] = useState(() => ({ companyId, filters: restore(companyId) }));
  // Restore before rendering queries for a different company, not in a later effect.
  let filters = selection.filters;
  if (selection.companyId !== companyId) {
    filters = restore(companyId);
    setSelection({ companyId, filters });
  }
  const resolved = { ...filters, periodFilter: filters.periodFilter ?? defaultPeriod };

  const updateFilters = (patch: Partial<JournalFilters>) => {
    if (!companyId) return;
    const next = { ...resolved, ...patch };
    setSelection({ companyId, filters: next });
    try {
      localStorage.setItem(storageKey(companyId), JSON.stringify(next));
    } catch (error) {
      console.warn("Filtrov temeljnic ni bilo mogoče shraniti.", error);
    }
  };

  const clearFilters = () => {
    if (!companyId) return;
    setSelection({ companyId, filters: { ...defaults, periodFilter: "all" } });
    try {
      localStorage.removeItem(storageKey(companyId));
    } catch (error) {
      console.warn("Shranjenih filtrov temeljnic ni bilo mogoče odstraniti.", error);
    }
  };

  return { ...resolved, updateFilters, clearFilters };
}
