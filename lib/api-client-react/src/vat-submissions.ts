/**
 * Custom hooks za KIR/KPR XML oddaje (§135).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  UseQueryOptions,
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface VatSubmission {
  id: string;
  companyId: string;
  periodYear: number;
  period: string;
  kind: "KIR" | "KPR" | "BOTH";
  status: "draft" | "submitted" | "accepted" | "rejected";
  schemaVersion: string;
  kirCount: number;
  kprCount: number;
  createdAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  rejectionReason: string | null;
  createdBy: string;
}

export interface CreateVatSubmissionBody {
  year: number;
  period: string;
  /** Neobvezna polja glave */
  odbdelez?: boolean;
  vracilo?: boolean;
}

export interface CreateVatSubmissionResponse extends VatSubmission {
  downloadUrl: string;
}

export interface ListVatSubmissionsResponse {
  submissions: VatSubmission[];
}

// ─── Query key ─────────────────────────────────────────────────────────────

export function vatSubmissionsQueryKey(companyId: string) {
  return ["companies", companyId, "vat-submissions"] as const;
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export function useListVatSubmissions(
  companyId: string,
  options?: { query?: Partial<UseQueryOptions<ListVatSubmissionsResponse>> },
): UseQueryResult<ListVatSubmissionsResponse> {
  return useQuery({
    queryKey: vatSubmissionsQueryKey(companyId),
    queryFn: () =>
      customFetch<ListVatSubmissionsResponse>(
        `/api/companies/${companyId}/vat-submissions`,
      ),
    enabled: !!companyId,
    ...options?.query,
  });
}

export function useCreateVatSubmission(
  companyId: string,
): UseMutationResult<CreateVatSubmissionResponse, Error, CreateVatSubmissionBody> {
  return useMutation({
    mutationFn: (body: CreateVatSubmissionBody) =>
      customFetch<CreateVatSubmissionResponse>(
        `/api/companies/${companyId}/vat-submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
  });
}
