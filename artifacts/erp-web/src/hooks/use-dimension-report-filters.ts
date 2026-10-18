import { useSearchParams } from "wouter";
import type { DimensionType } from "@workspace/api-client-react";
import { parseDatum } from "@/lib/utils";

type Filters = {
  dimensionType: string;
  dateFrom: string;
  dateTo: string;
  accountId: string;
};

const filterKeys = ["dimensionType", "dateFrom", "dateTo", "accountId"] as const;

function isDimensionType(value: string): value is DimensionType {
  return value === "costCenter" || value === "project" || value === "department";
}

function dateError(value: string, label: string): string | undefined {
  if (!value) return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return `${label}: vrednost »${value}« ni v obliki LLLL-MM-DD (npr. 2025-01-31). Popravite datum ali polje izpraznite.`;
  if (!parseDatum(`${match[3]}.${match[2]}.${match[1]}`)) {
    return `${label}: datum »${value}« ne obstaja. Izberite veljaven datum ali polje izpraznite.`;
  }
  return undefined;
}

export function useDimensionReportFilters(activeCompanyId?: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: Filters = {
    dimensionType: searchParams.get("dimensionType") ?? "costCenter",
    dateFrom: searchParams.get("dateFrom") ?? `${new Date().getFullYear()}-01-01`,
    dateTo: searchParams.get("dateTo") ?? new Date().toISOString().slice(0, 10),
    accountId: searchParams.get("accountId") ?? "",
  };
  const errors = {
    dimensionType: isDimensionType(filters.dimensionType)
      ? undefined
      : `Neznana vrsta dimenzije »${filters.dimensionType}«. Izberite stroškovna mesta, projekte ali oddelke.`,
    dateFrom: dateError(filters.dateFrom, "Obdobje od"),
    dateTo: dateError(filters.dateTo, "Obdobje do"),
    period: undefined as string | undefined,
  };
  if (!errors.dateFrom && !errors.dateTo && filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.period = "Datum »Obdobje od« je po datumu »Obdobje do«. Popravite začetek ali konec obdobja.";
  }
  const isValid = !Object.values(errors).some(Boolean);
  // Invalid URL values remain available for correction, but never become API inputs.
  const reportParams = isValid && isDimensionType(filters.dimensionType) ? {
    dimensionType: filters.dimensionType,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    accountId: filters.accountId || undefined,
  } : undefined;

  function updateFilters(patch: Partial<Filters> = {}) {
    // Never repoint a shared report by editing its filters in another company.
    if (searchParams.has("companyId") && searchParams.get("companyId") !== activeCompanyId) return;
    const next = { ...filters, ...patch };
    // Include defaults and empty dates so the shared link describes the exact view.
    // Preserve unrelated query parameters and push (rather than replace) history.
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      for (const key of filterKeys) params.set(key, next[key]);
      if (activeCompanyId) params.set("companyId", activeCompanyId);
      return params;
    });
  }

  return {
    filters,
    sharedCompanyId: searchParams.get("companyId"),
    errors,
    isValid,
    reportParams,
    queried: filterKeys.some((key) => searchParams.has(key)),
    updateFilters,
  };
}
