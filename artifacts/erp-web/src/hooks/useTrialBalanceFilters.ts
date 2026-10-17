import { useEffect, useState } from "react";

type TrialBalanceFilters = {
  dateFrom: string;
  dateTo: string;
  classFilter: string;
  search: string;
};

function restore(key: string | undefined, defaults: TrialBalanceFilters): TrialBalanceFilters {
  if (!key) return { ...defaults };
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
    const values = saved as Record<string, unknown>;
    const filters = { ...defaults };
    for (const field of ["dateFrom", "dateTo"] as const) {
      if (typeof values[field] === "string" && /^(?:\d{4}-\d{2}-\d{2})?$/.test(values[field])) {
        filters[field] = values[field];
      }
    }
    if (typeof values.classFilter === "string" && /^(?:all|[0-9])$/.test(values.classFilter)) {
      filters.classFilter = values.classFilter;
    }
    if (typeof values.search === "string") filters.search = values.search.slice(0, 100);
    return filters;
  } catch (error) {
    console.warn("Filtrov bruto bilance ni bilo mogoče obnoviti.", error);
    return { ...defaults };
  }
}

export function useTrialBalanceFilters(
  userId: string | undefined | null,
  companyId: string | undefined,
  dates: Pick<TrialBalanceFilters, "dateFrom" | "dateTo">,
) {
  const key = userId && companyId
    ? `bookie:trial-balance-filters:${JSON.stringify([userId, companyId])}`
    : undefined;
  const defaults = { ...dates, classFilter: "all", search: "" };
  const [selection, setSelection] = useState(() => ({ key, filters: restore(key, defaults), changed: false }));
  let filters = selection.filters;
  // Restore synchronously so a company/account change never uses the previous filters.
  if (selection.key !== key) {
    filters = restore(key, defaults);
    setSelection({ key, filters, changed: false });
  }

  useEffect(() => {
    if (!key || selection.key !== key || !selection.changed) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(selection.filters));
    } catch (error) {
      console.warn("Filtrov bruto bilance ni bilo mogoče shraniti.", error);
    }
  }, [key, selection]);

  function updateFilters(patch: Partial<TrialBalanceFilters>) {
    setSelection((previous) => ({
      key,
      filters: { ...(previous.key === key ? previous.filters : filters), ...patch },
      changed: true,
    }));
  }

  return { ...filters, updateFilters };
}
