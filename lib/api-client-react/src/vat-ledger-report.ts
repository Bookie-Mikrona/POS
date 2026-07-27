/**
 * Custom hook for KIR/KPR evidence report (§134).
 * Supplements the orval-generated hooks.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface KirRow {
  zapst: number;
  journalEntryId: string | null;
  documentNo: string;
  p2: string;
  p3: string;
  p4: string;
  p5: string | null;
  p6: string | null;
  p6ds: string | null;
  p7: string; p8: string; p9: string; p10: string; p11: string; p12: string; p13: string;
  p14: string; p15: string; p16: string; p17: string; p18: string; p19: string; p20: string;
  p21: string; p22: string; p23: string; p24: string; p25: string; p26: string; p27: string;
  p28: string | null;
  treatment: number;
  reported: boolean;
}

export interface KprRow {
  zapst: number;
  journalEntryId: string | null;
  documentNo: string;
  p2: string;
  p3: string;
  p4: string;
  p5: string;
  p6: string | null;
  p7: string | null;
  p7ds: string | null;
  p8: string; p9: string; p10: string; p11: string; p12: string; p13: string;
  p14: string; p15: string; p16: string; p17: string; p18: string; p19: string; p20: string;
  p21: string; p22: string;
  treatment: number;
  reported: boolean;
}

export interface ReconRow {
  dvoField: string;
  label: string;
  kirField?: string;
  kprField?: string;
  value: string;
}

export interface VatWarning {
  id: string;
  severity: "ERROR" | "WARNING";
  rule: string;
  message: string;
  documentNo: string | null;
  journalEntryId: string | null;
}

export interface VatLedgerReportResponse {
  year: number;
  period: string;
  periodFrom: string;
  periodTo: string;
  kirCount: number;
  kprCount: number;
  kirRows: KirRow[];
  kirTotals: Record<string, string>;
  kprRows: KprRow[];
  kprTotals: Record<string, string>;
  recon: ReconRow[];
  reconSummary: {
    totalObracunan: string;
    totalOdbitni: string;
    netoDdv: string;
  };
  warnings: VatWarning[];
  errorCount: number;
  warningCount: number;
  hasErrors: boolean;
}

export interface GetVatLedgerReportParams {
  year: number;
  period: string; // MMMM format, e.g. '0707'
}

export function getVatLedgerReportQueryKey(
  companyId: string,
  params: GetVatLedgerReportParams,
) {
  return ["companies", companyId, "vat-ledger-report", params] as const;
}

export function useGetVatLedgerReport(
  companyId: string,
  params: GetVatLedgerReportParams,
  options?: { query?: Partial<UseQueryOptions<VatLedgerReportResponse>> },
): UseQueryResult<VatLedgerReportResponse> {
  return useQuery({
    queryKey: getVatLedgerReportQueryKey(companyId, params),
    queryFn: async () => {
      const qs = new URLSearchParams({
        year: String(params.year),
        period: params.period,
      });
      return customFetch<VatLedgerReportResponse>(
        `/api/companies/${companyId}/vat-ledger-report?${qs.toString()}`,
      );
    },
    enabled: !!companyId && !!params.year && !!params.period,
    ...options?.query,
  });
}
