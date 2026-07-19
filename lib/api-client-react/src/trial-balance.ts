/**
 * Hook for the trial balance report (Bruto bilanca / Preizkusna bilanca).
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceResponse {
  dateFrom: string | null;
  dateTo: string | null;
  rows: TrialBalanceRow[];
  totalOpeningDebit: string;
  totalOpeningCredit: string;
  totalPeriodDebit: string;
  totalPeriodCredit: string;
  totalClosingDebit: string;
  totalClosingCredit: string;
}

export interface GetTrialBalanceParams {
  dateFrom?: string;
  dateTo?: string;
}

export function getTrialBalanceQueryKey(companyId: string, params: GetTrialBalanceParams = {}) {
  return ["companies", companyId, "reports", "trial-balance", params] as const;
}

export function useGetTrialBalance(
  companyId: string,
  params: GetTrialBalanceParams = {},
  options?: { query?: Partial<UseQueryOptions<TrialBalanceResponse>> },
): UseQueryResult<TrialBalanceResponse> {
  return useQuery({
    queryKey: getTrialBalanceQueryKey(companyId, params),
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
      if (params.dateTo) qs.set("dateTo", params.dateTo);
      return customFetch<TrialBalanceResponse>(
        `/api/companies/${companyId}/reports/trial-balance?${qs.toString()}`,
      );
    },
    enabled: !!companyId,
    ...options?.query,
  });
}
