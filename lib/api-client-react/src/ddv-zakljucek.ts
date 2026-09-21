/**
 * Hooks za DDV zaključne temeljnice (§134 DDV zaključek).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  UseQueryOptions,
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface DdvZakljucekSettings {
  id: string;
  companyId: string;
  netoObveznostAccountId: string | null;
  netoTerjatevAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DdvZakljucekClosingLine {
  accountId: string;
  code: string;
  name: string;
  side: "debit" | "credit";
  amount: string;
  description: string;
}

export interface DdvZakljucekOsnutekBody {
  year: number;
  period: string;
  vraciloChoice: "vracilo" | "prenos" | null;
  dryRun?: boolean;
}

export interface DdvZakljucekOsnutekResponse {
  dryRun?: boolean;
  entryId?: string;
  reference: string;
  periodFrom: string;
  periodTo: string;
  period: string;
  lines: DdvZakljucekClosingLine[];
  debitTotal: string;
  creditTotal: string;
  netAmount: string;
  netType: "obveznost" | "presežek" | "nič";
  vraciloChoice: "vracilo" | "prenos" | null;
  existingEntry?: { id: string; status: string } | null;
}

// ─── Query keys ────────────────────────────────────────────────────────────

export function ddvZakljucekSettingsQueryKey(companyId: string) {
  return ["companies", companyId, "ddv-zakljucek-settings"] as const;
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export function useGetDdvZakljucekSettings(
  companyId: string,
  options?: { query?: Partial<UseQueryOptions<DdvZakljucekSettings | null>> },
): UseQueryResult<DdvZakljucekSettings | null> {
  return useQuery({
    queryKey: ddvZakljucekSettingsQueryKey(companyId),
    queryFn: () =>
      customFetch<DdvZakljucekSettings | null>(
        `/api/companies/${companyId}/ddv-zakljucek-settings`,
      ),
    enabled: !!companyId,
    staleTime: 30_000,
    ...options?.query,
  });
}

export function useUpdateDdvZakljucekSettings(
  companyId: string,
): UseMutationResult<
  DdvZakljucekSettings,
  Error,
  { netoObveznostAccountId: string | null; netoTerjatevAccountId: string | null }
> {
  return useMutation({
    mutationFn: (body) =>
      customFetch<DdvZakljucekSettings>(
        `/api/companies/${companyId}/ddv-zakljucek-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
  });
}

export function useDdvZakljucekOsnutek(
  companyId: string,
): UseMutationResult<DdvZakljucekOsnutekResponse, Error, DdvZakljucekOsnutekBody> {
  return useMutation({
    mutationFn: (body) =>
      customFetch<DdvZakljucekOsnutekResponse>(
        `/api/companies/${companyId}/ddv-zakljucek-osnutek`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
  });
}
