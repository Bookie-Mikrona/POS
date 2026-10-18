/**
 * Custom hook for the dimensions (analytic accounting) report.
 * This supplements the orval-generated hooks for the dimensions report endpoint.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export type DimensionType = "costCenter" | "project" | "department";

export interface AccountBreakdownRow {
  accountId: string;
  code: string;
  name: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
}

export interface DimensionReportRow {
  id: string;
  code: string;
  name: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  /** Present when groupBy=account was requested */
  accounts?: AccountBreakdownRow[];
}

export interface UntaggedDimensionLine {
  lineId: string;
  entryId: string;
  entryDate: string;
  reference: string | null;
  entryDescription: string;
  description: string | null;
  accountCode: string;
  accountName: string;
  side: "debit" | "credit";
  amount: string;
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
  /** Total debit of lines that have NO dimension tag (excluded from the report) */
  untaggedDebit: string;
  /** Total credit of lines that have NO dimension tag (excluded from the report) */
  untaggedCredit: string;
  /** Net balance (debit - credit) of untagged lines */
  untaggedBalance: string;
  /** Full-scope count, not just the number of lines in this page. */
  untaggedCount: number;
  untaggedPage: number;
  untaggedPageSize: number;
  /** Individual lines missing the selected dimension, in date/entry/line order. */
  untaggedLines: UntaggedDimensionLine[];
}

export interface GetDimensionReportParams {
  dimensionType?: DimensionType;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  groupBy?: "account";
  /** 1-based page of untagged lines (default 1). */
  untaggedPage?: number;
  /** Default 20, maximum 100. Does not affect report aggregates. */
  untaggedPageSize?: number;
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
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams();
      if (params.dimensionType) qs.set("dimensionType", params.dimensionType);
      if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
      if (params.dateTo) qs.set("dateTo", params.dateTo);
      if (params.accountId) qs.set("accountId", params.accountId);
      if (params.groupBy) qs.set("groupBy", params.groupBy);
      if (params.untaggedPage !== undefined) qs.set("untaggedPage", String(params.untaggedPage));
      if (params.untaggedPageSize !== undefined) qs.set("untaggedPageSize", String(params.untaggedPageSize));
      return customFetch<DimensionReportResponse>(
        `/api/companies/${companyId}/reports/dimensions?${qs.toString()}`,
        { signal, headers: { "X-Company-Id": companyId } },
      );
    },
    enabled: !!companyId,
    ...options?.query,
  });
}
