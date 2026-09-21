import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, RefreshCw, Truck, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDostavaStatusHistoryQueryKey,
  getGetNarociloQueryKey,
  getListAktivnaNarocilaQueryKey,
  useGetDostavaStatusHistory,
  useListDostavniKurirji,
  useUpdateDostavaStatus,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export const DOSTAVA_STATUSI = [
  "prejeto",
  "potrjeno",
  "v_pripravi",
  "pripravljeno",
  "prevzel_kurir",
  "dostavljeno",
  "preklicano",
] as const;

type DostavaStatus = typeof DOSTAVA_STATUSI[number];

type DostavaStatusPanelProps = {
  narociloId: number;
  status: string | null | undefined;
  kurirId: number | null | undefined;
};

const STATUS_LABELS: Record<DostavaStatus, string> = {
  prejeto: "Prejeto",
  potrjeno: "Potrjeno",
  v_pripravi: "V pripravi",
  pripravljeno: "Pripravljeno",
  prevzel_kurir: "Prevzel kurir",
  dostavljeno: "Dostavljeno",
  preklicano: "Preklicano",
};

const NEXT_STATUS: Record<DostavaStatus, readonly DostavaStatus[]> = {
  prejeto: ["potrjeno", "preklicano"],
  potrjeno: ["v_pripravi", "preklicano"],
  v_pripravi: ["pripravljeno", "preklicano"],
  pripravljeno: ["prevzel_kurir", "preklicano"],
  prevzel_kurir: ["dostavljeno"],
  dostavljeno: [],
  preklicano: [],
};

function isDostavaStatus(value: string | null | undefined): value is DostavaStatus {
  return typeof value === "string" && (DOSTAVA_STATUSI as readonly string[]).includes(value);
}

function getDostavaStatusLabel(value: string | null | undefined): string {
  return isDostavaStatus(value) ? STATUS_LABELS[value] : "Neznan status";
}

function formatZgodovinaCas(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function DostavaStatusPanel({
  narociloId,
  status: rawStatus,
  kurirId,
}: DostavaStatusPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [izbraniKurirId, setIzbraniKurirId] = useState("");
  const status = isDostavaStatus(rawStatus) ? rawStatus : null;

  const kurirji = useListDostavniKurirji();
  const zgodovina = useGetDostavaStatusHistory(narociloId);

  const naslednjiStatusi = useMemo(
    () => (status ? NEXT_STATUS[status] : []),
    [status],
  );
  const requiresCourier = naslednjiStatusi.includes("prevzel_kurir");

  const spremeniStatus = useUpdateDostavaStatus({
    mutation: {
      onSuccess: async () => {
        setIzbraniKurirId("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetDostavaStatusHistoryQueryKey(narociloId) }),
          queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(narociloId) }),
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }),
        ]);
        toast({ title: "Status dostave posodobljen" });
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : "Statusa dostave ni bilo mogoče posodobiti.";
        toast({ title: "Napaka pri dostavi", description: message, variant: "destructive" });
      },
    },
  });

  if (!status) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-testid="dostava-status-manjka">
        Dostavno naročilo nima veljavnega statusa. Nadaljevanje dostave je blokirano.
      </div>
    );
  }

  const currentCourierIsActive = kurirId != null
    && (kurirji.data ?? []).some((kurir) => kurir.id === kurirId && kurir.aktiven);
  const selectedCourier = izbraniKurirId ? Number(izbraniKurirId) : (currentCourierIsActive ? kurirId : null);
  const canSubmitPickup = !requiresCourier || selectedCourier !== null;

  return (
    <section className="rounded-lg border bg-card p-3 space-y-3" data-testid="dostava-status-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Status dostave</h2>
        <Badge variant="outline" className="ml-auto">{getDostavaStatusLabel(status)}</Badge>
      </div>

      {naslednjiStatusi.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Naslednji operativni korak</p>
          <div className="flex flex-wrap gap-2">
            {naslednjiStatusi.map((next) => (
              <Button
                key={next}
                type="button"
                size="sm"
                variant={next === "preklicano" ? "outline" : "default"}
                className={next === "preklicano" ? "text-destructive border-destructive/30 hover:bg-destructive/10" : ""}
                disabled={spremeniStatus.isPending || (next === "prevzel_kurir" && !canSubmitPickup)}
                onClick={() => {
                    const izbrani = izbraniKurirId ? Number(izbraniKurirId) : null;
                    const kurirZaStatus = next === "prevzel_kurir"
                      ? (izbrani ?? (currentCourierIsActive ? kurirId : null))
                      : null;
                    if (next === "prevzel_kurir" && kurirZaStatus === null) {
                    toast({ title: "Napaka pri dostavi", description: kurirId != null
                      ? "Trenutni kurir ni več aktiven. Pred prevzemom izberite aktivnega kurirja."
                      : "Pred prevzemom določite aktivnega kurirja.", variant: "destructive" });
                    return;
                  }
                  spremeniStatus.mutate({
                    id: narociloId,
                    data: {
                      status: next,
                      kurirId: kurirZaStatus,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  });
                }}
                data-testid={`dostava-status-${next}`}
              >
                {next === "preklicano" ? <XCircle className="mr-1.5 h-4 w-4" /> : <ChevronRight className="mr-1.5 h-4 w-4" />}
                {STATUS_LABELS[next]}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {status === "dostavljeno" ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
          Ta dostava je zaključena.
        </p>
      )}

      {requiresCourier && (
        <label className="block space-y-1 text-xs font-medium">
          <span>Kurir za prevzem</span>
          <select
            value={izbraniKurirId || (currentCourierIsActive ? String(kurirId) : "")}
            onChange={(event) => setIzbraniKurirId(event.currentTarget.value)}
            disabled={spremeniStatus.isPending}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
            data-testid="dostava-kurir-select"
          >
            <option value="">Izberite aktivnega kurirja</option>
            {(kurirji.data ?? []).filter((kurir) => kurir.aktiven).map((kurir) => (
              <option key={kurir.id} value={kurir.id}>{kurir.ime}</option>
            ))}
          </select>
          {!kurirji.isLoading && kurirId != null && !currentCourierIsActive && !izbraniKurirId && (
            <span className="text-destructive" data-testid="dostava-neaktiven-kurir">
              Trenutni kurir ni več aktiven. Izberite aktivnega kurirja.
            </span>
          )}
          {kurirji.isError && <span className="text-destructive">Kurirjev ni bilo mogoče naložiti.</span>}
        </label>
      )}

      <div className="border-t pt-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Zgodovina</p>
          {zgodovina.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Osvežujem zgodovino" />}
        </div>
        {zgodovina.isError ? (
          <p className="text-xs text-destructive">Zgodovine dostave ni bilo mogoče naložiti.</p>
        ) : zgodovina.data && zgodovina.data.length > 0 ? (
          <ul className="space-y-1">
            {zgodovina.data.slice().reverse().map((dogodek) => (
              <li key={dogodek.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {getDostavaStatusLabel(dogodek.status)}
                  {dogodek.kurirIme && <span className="font-normal text-muted-foreground"> · {dogodek.kurirIme}</span>}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock3 className="h-3 w-3" />
                  {formatZgodovinaCas(dogodek.ustvarjeno)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Dogodkov še ni.</p>
        )}
      </div>
    </section>
  );
}