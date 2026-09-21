/**
 * furs-vat-codes.ts — Hook za FURS globalne DDV kode
 *
 * Vrne kode iz globalne vat_code tabele (ne company-specifičnih).
 * Ključno polje: isNonDeductible — true za kode kot PN22/PN5/PN95,
 * pri katerih sistem privzeto postavi vatDeductionPercent=0.
 */

import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface FursVatCode {
  id: string;
  code: string;
  description: string;
  direction: "IN" | "OUT";
  rate: string;
  kprBaseField: string | null;
  kprVatField: string | null;
  kirBaseField: string | null;
  kirVatField: string | null;
  isReverseCharge: boolean;
  isImport: boolean;
  validFrom: string | null;
  validTo: string | null;
  /**
   * true = neodbitna koda (PN22, PN5, PN95):
   *   direction=IN, rate>0, kprVatField=NULL
   * Ko je ta koda izbrana, sistem privzeto nastavi vatDeductionPercent=0.
   * Računovodja ga lahko ročno dvigne (npr. na 50 za delni odbitek).
   */
  isNonDeductible: boolean;
}

export interface FursVatCodesResponse {
  codes: FursVatCode[];
}

export function useCompanyFursVatCodes(
  companyId: string,
  direction?: "IN" | "OUT",
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  return useQuery<FursVatCodesResponse>({
    queryKey: ["furs-vat-codes", companyId, direction],
    queryFn: async () => {
      const qs = direction ? `?direction=${direction}` : "";
      return customFetch<FursVatCodesResponse>(
        `/companies/${companyId}/furs-vat-codes${qs}`,
      );
    },
    enabled: !!companyId && enabled,
    staleTime: 10 * 60 * 1000, // 10 min — FURS kode se redko spremenijo
  });
}
