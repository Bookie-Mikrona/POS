/**
 * Custom hook for the dimensions (analytic accounting) report.
 * This supplements the orval-generated hooks for the dimensions report endpoint.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export type DimensionType = "costCenter" | "project" | "department";

export interface DimensionReportRow {
  id: string;
  code: string;
  name: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
}

export interface DimensionReportResponse {
  dimensionType: DimensionType;
  dateFrom: string | null;
  dateTo: string | null;
  accountId: string | null;
  rows: DimensionReportRow[];
  grandTotalDebit: string;
  grandTotalCredit: string;
  grandTotalBalance: string;
}

export interface GetDimensionReportParams {
  dimensionType?: DimensionType;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}

export function getDimensionReportQueryKey(
  companyId: string,
  params: GetDimensionReportParams = {},
) {
  return ["companies", companyId, "reports", "dimensions", params] as const;
}

export function useGetDimensionReport(
  companyId: string,
  params: GetDimensionReportParams = {},
  options?: { query?: Partial<UseQueryOptions<DimensionReportResponse>> },
): UseQueryResult<DimensionReportResponse> {
  return useQuery({
    queryKey: getDimensionReportQueryKey(companyId, params),
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params.dimensionType) qs.set("dimensionType", params.dimensionType);
      if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
      if (params.dateTo) qs.set("dateTo", params.dateTo);
      if (params.accountId) qs.set("accountId", params.accountId);
      return customFetch<DimensionReportResponse>(
        `/api/companies/${companyId}/reports/dimensions?${qs.toString()}`,
      );
    },
    enabled: !!companyId,
    ...options?.query,
  });
}
