import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { customFetch, type KdsPostaja } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";
import { gatewayPosService } from "@/lib/gatewayClient";

export type KdsNalog = {
  id: number;
  enotaId: number;
  postajaId: number;
  narociloId: number;
  postavkaId: number | null;
  stanje: "zadrzano" | "aktivno" | "bumped" | "ack" | "preklicano";
  /** Immutable QR multicourse serving metadata, absent for ordinary POS lines. */
  courseNumber?: number | null;
  courseSequence?: number | null;
  pairingGroupId?: string | null;
  uporabljenFallback: boolean;
  ustvarjeno: string;
  /** Fire timestamp. For the first course this is its materialization time. */
  aktiviranoAt?: string | null;
  bumpedAt?: string | null;
  ackAt?: string | null;
};

export type KdsDogodek = {
  id: number;
  nalogId: number;
  zaporedje: number;
  tip: "materializiran" | "bump" | "ack" | "sproscen" | "preklic";
  idempotencyKey: string;
  ustvarjeno: string;
};

export type QrWaiterRequest = {
  id: number;
  enotaId: number;
  mizaId: number;
  qrNapravaId: string;
  stanje: "caka" | "potrjeno" | "zakljuceno";
  ustvarjeno: string;
  potrjeno: string | null;
  zakljuceno: string | null;
  actorClerkUserId: string | null;
};

export function mapGatewayKdsState(state: unknown): KdsNalog["stanje"] {
  switch (String(state ?? "").toUpperCase()) {
    case "QUEUED": return "zadrzano";
    case "CLAIMED":
    case "STARTED": return "aktivno";
    case "READY": return "bumped";
    case "COMPLETED": return "ack";
    case "CANCELLED": return "preklicano";
    default: throw new Error(`Neznano stanje KDS gateway naloga: ${String(state)}`);
  }
}

export function isLiveGatewayKdsJob(job: Record<string, unknown>): boolean {
  const line = (job.payload as any)?.line;
  return line?.kdsIzkljucen !== true
    && !["COMPLETED", "CANCELLED"].includes(String(job.state).toUpperCase());
}

export function gatewayJob(job: Record<string, unknown>): KdsNalog {
  const payload = (job.payload ?? {}) as Record<string, any>;
  const line = payload.line ?? {};
  return {
    // Gateway job IDs are opaque UUIDs. Keep the legacy numeric type at the
    // cloud boundary without parsing or truncating the gateway identifier.
    id: String(job.jobId ?? job.job_id) as unknown as number,
    enotaId: job.enotaId as number,
    postajaId: line.postajaId as number,
    narociloId: String(payload.orderId ?? "") as unknown as number,
    postavkaId: String(line.lineId ?? line.id ?? "") as unknown as number,
    stanje: mapGatewayKdsState(job.state),
    uporabljenFallback: false,
    ustvarjeno: String(job.createdAt ?? new Date().toISOString()),
    courseNumber: (line.courseNumber ?? job.courseNumber) == null ? null : Number(line.courseNumber ?? job.courseNumber),
    courseSequence: (line.courseSequence ?? job.courseSequence) == null ? null : Number(line.courseSequence ?? job.courseSequence),
    pairingGroupId: (line.pairingGroupId ?? job.pairingGroupId) == null ? null : String(line.pairingGroupId ?? job.pairingGroupId),
    aktiviranoAt: String(job.activatedAt ?? line.activatedAt ?? "") || null,
    bumpedAt: String(job.readyAt ?? line.readyAt ?? "") || null,
    ackAt: String(job.completedAt ?? line.completedAt ?? "") || null,
  };
}

export function useKdsPostaje() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["kds", "postaje", user?.enotaId],
    queryFn: () => customFetch<KdsPostaja[]>("/api/kds/postaje"),
    enabled: !!user?.enotaId,
  });
}

export function useKdsNalogi(postajaId?: number) {
  const { user } = useAuth();
  const gateway = useGatewayOfflineContext();
  return useQuery({
    queryKey: ["kds", "postaje", postajaId, "nalogi", user?.enotaId],
    queryFn: async () => gateway.effectiveAuthority === "GATEWAY" && gateway.scope
      ? (await gatewayPosService(gateway.scope).kds()).jobs
        .filter(isLiveGatewayKdsJob)
        .filter(job => postajaId == null || Number((job.payload as any)?.line?.postajaId) === Number(postajaId))
        .map(job => gatewayJob(job))
      : customFetch<KdsNalog[]>(`/api/kds/postaje/${postajaId}/nalogi`),
    enabled: !!postajaId && !!user?.enotaId,
    refetchInterval: gateway.effectiveAuthority === "GATEWAY" ? 3000 : false,
  });
}

export function useKdsNalogiVecPostaj(postajaIds: number[]) {
  const { user } = useAuth();
  const gateway = useGatewayOfflineContext();
  return useQueries({
    queries: [...new Set(postajaIds)].map((id) => ({
      queryKey: ["kds", "postaje", id, "nalogi", user?.enotaId],
      queryFn: async () => gateway.effectiveAuthority === "GATEWAY" && gateway.scope
        ? (await gatewayPosService(gateway.scope).kds()).jobs
          .filter(isLiveGatewayKdsJob)
          .filter(job => Number((job.payload as any)?.line?.postajaId) === Number(id))
          .map(job => gatewayJob(job))
        : customFetch<KdsNalog[]>(`/api/kds/postaje/${id}/nalogi`),
      enabled: !!user?.enotaId,
      refetchInterval: gateway.effectiveAuthority === "GATEWAY" ? 3000 : false,
    })),
  });
}

export function useBumpNalog() {
  const gateway = useGatewayOfflineContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, idempotencyKey }: { id: number | string; idempotencyKey: string }) =>
      gateway.effectiveAuthority === "GATEWAY" && gateway.scope
        ? gatewayPosService(gateway.scope).kds().then(async ({ jobs }) => {
          const job = jobs.find(item => String(item.jobId ?? item.job_id) === String(id));
          if (!job) throw new Error("KDS nalog ni najden.");
          const state = String(job.state).toUpperCase();
          if (state === "QUEUED") throw new Error("KDS nalog najprej začni.");
          if (state === "READY") return job;
          if (state === "CLAIMED") {
            const started = await gatewayPosService(gateway.scope!).transitionKds(String(id), "start", Number(job.version));
            return gatewayPosService(gateway.scope!).transitionKds(String(id), "ready", Number((started as any).version ?? Number(job.version) + 1));
          }
          if (state !== "STARTED") throw new Error(`KDS naloga v stanju ${state} ni mogoče odbiti.`);
          return gatewayPosService(gateway.scope!).transitionKds(String(id), "ready", Number(job.version));
        })
        : customFetch(`/api/kds/nalogi/${id}/bump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey })
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["kds"] }); }
  });
}

export function useAckNalog() {
  const gateway = useGatewayOfflineContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, idempotencyKey }: { id: number | string; idempotencyKey: string }) =>
      gateway.effectiveAuthority === "GATEWAY" && gateway.scope
        ? gatewayPosService(gateway.scope).kds().then(async ({ jobs }) => {
          const job = jobs.find(item => String(item.jobId ?? item.job_id) === String(id));
          if (!job) throw new Error("KDS nalog ni najden.");
          if (String(job.state).toUpperCase() !== "READY") {
            throw new Error("KDS nalog je mogoče potrditi samo iz stanja READY.");
          }
          return gatewayPosService(gateway.scope!).transitionKds(String(id), "complete", Number(job.version));
        })
        : customFetch(`/api/kds/nalogi/${id}/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey })
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["kds"] }); },
  });
}

/** Explicitly releases one held multicourse menu course to its KDS stations. */
export function useFireKdsCourse() {
  const gateway = useGatewayOfflineContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ narociloId, courseNumber, pairingGroupId, idempotencyKey }: {
      narociloId: number | string; courseNumber: number; pairingGroupId: string; idempotencyKey: string;
    }) => gateway.effectiveAuthority === "GATEWAY" && gateway.scope
      ? gatewayPosService(gateway.scope).kds().then(async ({ jobs }) => {
        const matches = jobs.filter(job => {
          const line = (job.payload as any)?.line ?? {};
          return String((job.payload as any)?.orderId) === String(narociloId) &&
            Number(line.courseNumber ?? (job as any).courseNumber) === Number(courseNumber) &&
            String(line.pairingGroupId ?? (job as any).pairingGroupId ?? "") === String(pairingGroupId);
        });
        if (!matches.length) throw new Error("KDS tečaj ni najden.");
        const results = [];
        for (const job of matches) {
          const state = String(job.state).toUpperCase();
          if (state === "QUEUED" || state === "CLAIMED") {
            results.push(await gatewayPosService(gateway.scope!).transitionKds(
              String(job.jobId ?? job.job_id), "start", Number(job.version)));
          }
        }
        return results;
      })
      : customFetch(`/api/kds/narocila/${narociloId}/tecaji/${courseNumber}/fire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey, pairingGroupId }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kds"] }),
  });
}

/** Authenticated unit-scoped service requests made from a guest QR menu. */
export function useQrWaiterRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["qr-waiter-requests", user?.enotaId],
    queryFn: () => customFetch<QrWaiterRequest[]>("/api/qr-waiter-requests"),
    enabled: !!user?.enotaId,
    refetchInterval: 15_000,
  });
}

export function useUpdateQrWaiterRequest() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stanje }: { id: number; stanje: "potrjeno" | "zakljuceno" }) =>
      customFetch<QrWaiterRequest>(`/api/qr-waiter-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stanje }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qr-waiter-requests", user?.enotaId] }),
  });
}

export function useNalogZgodovina(nalogId?: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["kds", "nalogi", nalogId, "zgodovina", user?.enotaId],
    queryFn: () => customFetch<KdsDogodek[]>(`/api/kds/nalogi/${nalogId}/zgodovina`),
    enabled: !!nalogId && !!user?.enotaId,
  });
}
