import { useEffect, useState } from "react";

type StatementFilters = {
  "balance-sheet": { asOf: string; compareAsOf: string; enableCompare: boolean };
  "income-statement": {
    dateFrom: string;
    dateTo: string;
    compareDateFrom: string;
    compareDateTo: string;
    enableCompare: boolean;
  };
};

function restore<T extends object>(key: string | undefined, defaults: T): T {
  const filters = { ...defaults };
  if (!key) return filters;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return filters;
    for (const field of Object.keys(defaults) as (keyof T)[]) {
      const value = (saved as Record<keyof T, unknown>)[field];
      if (
        (typeof defaults[field] === "boolean" && typeof value === "boolean") ||
        (typeof defaults[field] === "string" && typeof value === "string" &&
          /^(?:\d{4}-\d{2}-\d{2})?$/.test(value))
      ) {
        filters[field] = value as T[keyof T];
      }
    }
  } catch (error) {
    console.warn("Filtrov poročila ni bilo mogoče obnoviti.", error);
  }
  return filters;
}

/** Draft selections only: restoring filters must never generate a report. */
export function useFinancialStatementFilters<R extends keyof StatementFilters>(
  report: R,
  userId: string | null | undefined,
  companyId: string | undefined,
  defaults: StatementFilters[R],
) {
  const key = userId && companyId
    ? `bookie:${report}-filters:${JSON.stringify([userId, companyId])}`
    : undefined;
  const [selection, setSelection] = useState(() => ({
    key, filters: restore(key, defaults), changed: false,
  }));
  let filters = selection.filters;
  // Restore before rendering inputs when the account/company becomes available or changes.
  if (selection.key !== key) {
    filters = restore(key, defaults);
    setSelection({ key, filters, changed: false });
  }

  useEffect(() => {
    if (!key || selection.key !== key || !selection.changed) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(selection.filters));
    } catch (error) {
      console.warn("Filtrov poročila ni bilo mogoče shraniti.", error);
    }
  }, [key, selection]);

  function updateFilters(patch: Partial<StatementFilters[R]>) {
    setSelection((previous) => ({
      key,
      filters: { ...(previous.key === key ? previous.filters : filters), ...patch },
      changed: true,
    }));
  }

  return { ...filters, updateFilters };
}
