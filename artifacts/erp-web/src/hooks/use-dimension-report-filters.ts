import { useSearchParams } from "wouter";
import type { DimensionType } from "@workspace/api-client-react";

type Filters = {
  dimensionType: DimensionType;
  dateFrom: string;
  dateTo: string;
  accountId: string;
};

const filterKeys = ["dimensionType", "dateFrom", "dateTo", "accountId"] as const;

export function useDimensionReportFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension = searchParams.get("dimensionType");
  const filters: Filters = {
    dimensionType: dimension === "project" || dimension === "department" ? dimension : "costCenter",
    dateFrom: searchParams.get("dateFrom") ?? `${new Date().getFullYear()}-01-01`,
    dateTo: searchParams.get("dateTo") ?? new Date().toISOString().slice(0, 10),
    accountId: searchParams.get("accountId") ?? "",
  };

  function updateFilters(patch: Partial<Filters> = {}) {
    const next = { ...filters, ...patch };
    // Include defaults and empty dates so the shared link describes the exact view.
    // Preserve unrelated query parameters and push (rather than replace) history.
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      for (const key of filterKeys) params.set(key, next[key]);
      return params;
    });
  }

  return {
    filters,
    queried: filterKeys.some((key) => searchParams.has(key)),
    updateFilters,
  };
}
