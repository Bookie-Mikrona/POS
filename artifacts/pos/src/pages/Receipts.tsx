import { useState, useEffect, useRef } from "react";
import { useListRacuni, usePonoviPosiljanjeRacuna, useStornirajRacun, getListRacuniQueryKey, useUpdateRacunPlacilnaNacin, useVivaTerminalRefund, useListVivaVracila, getListVivaVracilaQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PrintReceiptButton } from "@/components/PrintReceiptButton";
import { ChevronDown, ChevronRight, AlertCircle, RefreshCw, X, Printer, Banknote, CreditCard, Gift, Undo2, Building2, Search, Smartphone, Landmark } from "lucide-react";
import { ShranjeniKupciSelector } from "@/components/ShranjeniKupciSelector";
import { useToast } from "@/hooks/use-toast";

function parseFursError(fursOdgovor: string | null | undefined): { koda: string; sporocilo: string } | null {
  if (!fursOdgovor) return null;
  const kodaMatch = fursOdgovor.match(/<(?:\w+:)?ErrorCode[^>]*>(.*?)<\/(?:\w+:)?ErrorCode>/s);
  const sporoMatch = fursOdgovor.match(/<(?:\w+:)?ErrorMessage[^>]*>(.*?)<\/(?:\w+:)?ErrorMessage>/s);
  if (kodaMatch || sporoMatch) {
    return {
      koda: kodaMatch?.[1]?.trim() ?? "",
      sporocilo: sporoMatch?.[1]?.trim() ?? "",
    };
  }
  return null;
}

function formatRawResponse(fursOdgovor: string): string {
  try {
    return JSON.stringify(JSON.parse(fursOdgovor), null, 2);
  } catch {
    return fursOdgovor;
  }
}

function FursErrorDetail({ fursOdgovor }: { fursOdgovor: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const napaka = parseFursError(fursOdgovor);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {napaka ? (
            <>
              <p className="text-sm font-semibold text-red-700">
                Koda napake: <span className="font-mono">{napaka.koda || "—"}</span>
              </p>
              {napaka.sporocilo && (
                <p className="text-sm text-red-700">{napaka.sporocilo}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-red-700">FURS ni vrnil kode napake.</p>
          )}
        </div>
      </div>

      {fursOdgovor && (
        <div>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {open ? "Skrij" : "Prikaži"} surov odgovor FURS
          </button>
          {open && (
            <pre className="mt-1 max-h-64 overflow-auto rounded border bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {formatRawResponse(fursOdgovor)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function FursSuccessDetail({ zoi, eor }: { zoi?: string | null; eor?: string | null }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
      {zoi && (
        <span>
          <span className="font-medium">ZOI:</span>{" "}
          <span className="font-mono">{zoi}</span>
        </span>
      )}
      {eor && (
        <span>
          <span className="font-medium">EOR:</span>{" "}
          <span className="font-mono">{eor}</span>
        </span>
      )}
    </div>
  );
}

type StatusFilter = "vsi" | "napake";

function jeNapaka(r: { status?: string | null; zoi?: string | null; eor?: string | null }): boolean {
  if (r.status === "storniran") return false;
  if (r.status === "testni") return false;
  return r.status === "napaka" || !r.eor;
}

function RetryFursButton({ racunId }: { racunId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { nastavitve } = useNastavitve();
  const ponovi = usePonoviPosiljanjeRacuna();

  const fursNacin = ((nastavitve as (typeof nastavitve & { fursNacin?: string }) | undefined)?.fursNacin ?? "simulacija") as "simulacija" | "testno" | "produkcija";

  function handleRetry() {
    ponovi.mutate(
      { id: racunId, data: { fursNacin } },
      {
        onSuccess: (updated) => {
          queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
          if (updated.eor) {
            toast({ title: "FURS potrjen", description: `EOR: ${updated.eor}` });
          } else if (updated.zoi) {
            toast({ title: "FURS potrjen", description: `ZOI: ${updated.zoi}` });
          } else {
            toast({
              title: "Pošiljanje ni uspelo",
              description: (updated as { fursNapaka?: string | null }).fursNapaka ?? "FURS je zavrnil račun.",
              variant: "destructive",
            });
          }
        },
        onError: () => {
          toast({ title: "Napaka", description: "Pošiljanje na FURS ni uspelo.", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={ponovi.isPending}
        className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${ponovi.isPending ? "animate-spin" : ""}`} />
        {ponovi.isPending ? "Pošiljanje…" : "Ponovi pošiljanje FURS"}
      </Button>
      <span className="text-xs text-muted-foreground">
        ({fursNacin === "produkcija" ? "produkcija" : fursNacin === "testno" ? "testni strežnik" : "simulacija"})
      </span>
    </div>
  );
}

function StornoButton({ racun }: { racun: { id: number; stevilkaRacuna: string; skupaj: number } }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [potrditev, setPotrditev] = useState(false);
  const storniraj = useStornirajRacun();

  function handleStorno() {
    storniraj.mutate(
      { id: racun.id },
      {
        onSuccess: (stornoRacun) => {
          queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
          toast({
            title: "Storno izdan",
            description: `Storno račun ${(stornoRacun as { stevilkaRacuna?: string }).stevilkaRacuna ?? ""} uspešno poslan na FURS.`,
          });
          setPotrditev(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Storno ni uspel";
          toast({ title: "Napaka", description: msg, variant: "destructive" });
          setPotrditev(false);
        },
      }
    );
  }

  if (!potrditev) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setPotrditev(true)}
        className="gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Storniraj
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
      <p className="text-sm text-orange-800 flex-1">
        Storno računa <span className="font-mono font-semibold">{racun.stevilkaRacuna}</span> ({racun.skupaj.toFixed(2)} €) — izda se nov negativni račun pri FURS.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPotrditev(false)}
          disabled={storniraj.isPending}
          className="h-8"
        >
          Prekliči
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleStorno}
          disabled={storniraj.isPending}
          className="h-8 gap-1.5 bg-orange-600 text-white hover:bg-orange-700"
        >
          {storniraj.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Undo2 className="h-3.5 w-3.5" />
          )}
          {storniraj.isPending ? "Pošiljanje…" : "Potrdi storno"}
        </Button>
      </div>
    </div>
  );
}

function statusVivaVracilaBadge(status: string) {
  if (status === "paid") return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Potrjeno</span>;
  if (status === "failed") return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">Zavrnjeno</span>;
  return <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">V teku</span>;
}

function VivaVracilaHistory({ racunId, skupaj, vivaTerminalSessionId }: { racunId: number; skupaj: number; vivaTerminalSessionId?: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: vracila, isLoading, isFetching } = useListVivaVracila(racunId, {
    query: {
      queryKey: getListVivaVracilaQueryKey(racunId),
      refetchInterval: (query) => {
        const data = query.state.data as { status: string }[] | undefined;
        const imaPending = Array.isArray(data) && data.some(v => v.status === "pending");
        return imaPending ? 3000 : false;
      },
    },
  });
  const refund = useVivaTerminalRefund();
  const [ponavlja, setPonavlja] = useState<number | null>(null);

  if (isLoading) return null;
  if (!vracila || vracila.length === 0) return null;

  const imaPending = vracila.some(v => v.status === "pending");

  function handlePonoviIzZgodovine(vId: number, znesek: number) {
    if (!vivaTerminalSessionId) return;
    setPonavlja(vId);
    refund.mutate(
      { data: { znesek, originalSessionId: vivaTerminalSessionId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(racunId) });
          toast({ title: "Vračilo poslano", description: "Nov poskus vračila je bil poslan na terminal." });
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Vračilo ni uspelo";
          toast({ title: "Napaka", description: msg, variant: "destructive" });
        },
        onSettled: () => setPonavlja(null),
      }
    );
  }

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2 space-y-1.5">
      <p className="text-[11px] font-semibold text-violet-800 flex items-center gap-1.5">
        <Smartphone className="h-3 w-3" />
        Zgodovina vračil na terminalu
        {imaPending && (
          <span className="ml-auto" aria-label="Samodejno osveževanje…">
            <RefreshCw className={`h-3 w-3 text-violet-500 ${isFetching ? "animate-spin" : ""}`} />
          </span>
        )}
      </p>
      <div className="space-y-1.5">
        {vracila.map(v => {
          const znesek = Number(v.znesek);
          const jeDelno = znesek < skupaj - 0.005;
          const jePonavljanje = ponavlja === v.id;
          return (
            <div key={v.id} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="text-violet-900 font-mono font-semibold">{znesek.toFixed(2)} €</span>
                  {jeDelno && (
                    <span className="rounded px-1 py-0.5 bg-violet-100 text-violet-600 text-[10px] font-medium leading-none">
                      kartični del
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-violet-700">{new Date(v.ustvarjeno).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {statusVivaVracilaBadge(v.status)}
                </span>
              </div>
              {v.status === "failed" && (
                <div className="flex items-center gap-2 pl-0.5">
                  {v.napaka && (
                    <p className="text-[10px] italic text-muted-foreground flex-1">{v.napaka}</p>
                  )}
                  {vivaTerminalSessionId && vracila.length < 3 && (
                    <button
                      type="button"
                      onClick={() => handlePonoviIzZgodovine(v.id, znesek)}
                      disabled={jePonavljanje || refund.isPending}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 transition-colors shrink-0"
                    >
                      <RefreshCw className={`h-2.5 w-2.5 ${jePonavljanje ? "animate-spin" : ""}`} />
                      Ponovi vračilo
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {vracila.length > 1 && (() => {
          const skupajVrnjeno = vracila
            .filter(v => v.status === "paid")
            .reduce((acc, v) => acc + Number(v.znesek), 0);
          return (
            <>
              <div className="border-t border-violet-200 mt-1.5" />
              <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
                <span className="text-violet-800 font-semibold">Skupaj vrnjeno:</span>
                <span className="text-violet-900 font-mono font-semibold">{skupajVrnjeno.toFixed(2)} €</span>
              </div>
            </>
          );
        })()}
        {vracila.length >= 3 && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 mt-1">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
            <p className="text-[10px] text-amber-800">Doseženo je največje število poskusov vračila (3). Nadaljnjih vračil ni mogoče izvesti.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SkupajVracilaPanel({
  racunId,
  imaVivaTerminal,
  stornoRacuni,
}: {
  racunId: number;
  imaVivaTerminal: boolean;
  stornoRacuni: Array<{ skupaj: number; stevilkaRacuna: string }>;
}) {
  const { data: vracila } = useListVivaVracila(racunId);

  const placanaVivaVracila = imaVivaTerminal
    ? (vracila ?? []).filter(v => v.status === "paid")
    : [];

  const skupajVivaVrnjeno = placanaVivaVracila.reduce((acc, v) => acc + Number(v.znesek), 0);
  const skupajStornoVrnjeno = stornoRacuni.reduce((acc, s) => acc + Math.abs(Number(s.skupaj)), 0);

  if (stornoRacuni.length === 0) return null;
  if (placanaVivaVracila.length === 0) return null;

  const skupajVrnjeno = skupajVivaVrnjeno + skupajStornoVrnjeno;
  if (skupajVrnjeno <= 0) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
        <Undo2 className="h-3 w-3" />
        Skupaj vračila
      </p>
      <div className="space-y-1">
        {placanaVivaVracila.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-600 flex items-center gap-1">
              <Smartphone className="h-3 w-3" />
              Terminal ({placanaVivaVracila.length}×)
            </span>
            <span className="font-mono text-slate-700">{skupajVivaVrnjeno.toFixed(2)} €</span>
          </div>
        )}
        {stornoRacuni.map(s => (
          <div key={s.stevilkaRacuna} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-600 flex items-center gap-1">
              <Undo2 className="h-3 w-3" />
              Storno {s.stevilkaRacuna}
            </span>
            <span className="font-mono text-slate-700">{Math.abs(Number(s.skupaj)).toFixed(2)} €</span>
          </div>
        ))}
        <div className="border-t border-slate-200 mt-1" />
        <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
          <span className="text-slate-800 font-semibold">Skupaj vrnjeno:</span>
          <span className="font-mono font-semibold text-slate-900">{skupajVrnjeno.toFixed(2)} €</span>
        </div>
      </div>
    </div>
  );
}

type VivaRefundFaza = "idle" | "potrditev" | "cakanje" | "uspeh" | "napaka";

function VivaTerminalRefundButton({
  racun,
}: {
  racun: { id: number; stevilkaRacuna: string; skupaj: number; znesekKartica?: number | null; vivaTerminalSessionId: string };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [faza, setFaza] = useState<VivaRefundFaza>("idle");
  const [refundSessionId, setRefundSessionId] = useState<string | null>(null);
  const [napakaSporocilo, setNapakaSporocilo] = useState<string | null>(null);
  const [limitDosezen, setLimitDosezen] = useState(false);
  const refund = useVivaTerminalRefund();

  const znesekVracila = (racun.znesekKartica != null && racun.znesekKartica > 0)
    ? racun.znesekKartica
    : racun.skupaj;
  const jeDeljenoPlacilo = racun.znesekKartica != null && racun.znesekKartica > 0 && racun.znesekKartica < racun.skupaj;

  useEffect(() => {
    if (faza !== "cakanje" || !refundSessionId) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/terminal/viva/terminal/refund/status/${encodeURIComponent(refundSessionId)}`);
        if (!res.ok) return;
        const data = await res.json() as { status: string; napaka?: string | null };
        if (!active) return;
        if (data.status === "PAID") {
          setFaza("uspeh");
          queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(racun.id) });
          toast({ title: "Vračilo uspešno", description: `Vračilo za račun ${racun.stevilkaRacuna} je bilo potrjeno na terminalu.` });
          clearInterval(interval);
        } else if (data.status === "FAILED") {
          setFaza("napaka");
          setNapakaSporocilo(data.napaka ?? "Terminal je zavrnil vračilo.");
          queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(racun.id) });
          clearInterval(interval);
        }
      } catch {
        // network error, keep polling
      }
    }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [faza, refundSessionId, racun.id, racun.stevilkaRacuna, toast, queryClient]);

  function handleZacniVracilo() {
    setFaza("potrditev");
  }

  function handlePotrdi() {
    setFaza("cakanje");
    refund.mutate(
      { data: { znesek: znesekVracila, originalSessionId: racun.vivaTerminalSessionId } },
      {
        onSuccess: (data) => {
          setRefundSessionId(data.sessionId);
        },
        onError: (err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status;
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Vračilo ni uspelo";
          if (status === 409) setLimitDosezen(true);
          setFaza("napaka");
          setNapakaSporocilo(msg);
        },
      }
    );
  }

  function handlePreklic() {
    setFaza("idle");
    setNapakaSporocilo(null);
    setRefundSessionId(null);
    setLimitDosezen(false);
  }

  function handlePonoviVracilo() {
    setNapakaSporocilo(null);
    setRefundSessionId(null);
    setLimitDosezen(false);
    setFaza("potrditev");
  }

  if (faza === "idle") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleZacniVracilo}
        className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
      >
        <Smartphone className="h-3.5 w-3.5" />
        Vračilo na terminal ({znesekVracila.toFixed(2)} €)
      </Button>
    );
  }

  if (faza === "potrditev") {
    return (
      <div className="flex flex-wrap items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
        <div className="flex-1 space-y-1.5">
          <p className="text-sm text-violet-800">
            Vračilo <span className="font-mono font-semibold">{znesekVracila.toFixed(2)} €</span> na Viva Terminal — stranka mora priložiti kartico.
          </p>
          {jeDeljenoPlacilo && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                Račun je bil plačan delno z gotovino. Vračilo zajema samo kartični del ({znesekVracila.toFixed(2)} € od {racun.skupaj.toFixed(2)} €).
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={handlePreklic} className="h-8">
            Prekliči
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handlePotrdi}
            className="h-8 gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
          >
            <Smartphone className="h-3.5 w-3.5" />
            Potrdi vračilo
          </Button>
        </div>
      </div>
    );
  }

  if (faza === "cakanje") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
        <RefreshCw className="h-4 w-4 animate-spin text-violet-600 shrink-0" />
        <p className="text-sm text-violet-800">Čakanje na vračilo na terminalu… Stranka naj priloži kartico.</p>
        <Button type="button" variant="ghost" size="sm" onClick={handlePreklic} className="ml-auto h-7 text-xs text-muted-foreground">
          Prekliči
        </Button>
      </div>
    );
  }

  if (faza === "uspeh") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
        <Smartphone className="h-4 w-4 text-green-600 shrink-0" />
        <p className="text-sm text-green-800 font-medium">Vračilo potrjeno na terminalu.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
      <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-medium text-red-800">
          {limitDosezen ? "Vračilo ni mogoče." : "Terminal je zavrnil vračilo."}
        </p>
        {napakaSporocilo && (
          <p className="text-xs text-red-700" data-testid="refund-napaka-sporocilo">
            <span className="font-medium">Razlog:</span> {napakaSporocilo}
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {!limitDosezen && (
          <Button
            type="button"
            size="sm"
            onClick={handlePonoviVracilo}
            disabled={refund.isPending}
            className="h-8 gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Poskusi znova
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handlePreklic} className="h-8">
          Zapri
        </Button>
      </div>
    </div>
  );
}

const NACINI_PLACILA = [
  { value: "gotovina" as const, label: "Gotovina", Icon: Banknote },
  { value: "kartica" as const,  label: "Kartica",  Icon: CreditCard },
  { value: "bon" as const,      label: "Bon",      Icon: Gift },
  { value: "negotovinsko" as const, label: "TRR", Icon: Landmark },
];

function todayString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
}

type PrintDialog = {
  id: number;
  stevilkaRacuna: string;
  placilnaNacin: string;
  skupaj: number;
  znesekGotovina: number | null;
  znesekKartica: number | null;
  znesekBon: number | null;
  steviloBonov: number | null;
  znesekBonPica: number | null;
  kupecDavcnaStevilka: string | null;
  kupecNaziv: string | null;
  kupecNaslov: string | null;
};

export default function Receipts() {
  const search = useSearch();
  const poudarjenaStevilka = new URLSearchParams(search).get("stevilka") ?? null;
  const poudarjenRef = useRef<HTMLDivElement | null>(null);
  const { data: racuni, isLoading } = useListRacuni();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("vsi");
  const [datumOd, setDatumOd] = useState<string>("");
  const [datumDo, setDatumDo] = useState<string>("");
  const [kupecFilter, setKupecFilter] = useState<string>("");
  const [printDialog, setPrintDialog] = useState<PrintDialog | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (poudarjenaStevilka && poudarjenRef.current) {
      poudarjenRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [poudarjenaStevilka, racuni]);

  useEffect(() => {
    if (poudarjenaStevilka && racuni) {
      const r = racuni.find(x => x.stevilkaRacuna === poudarjenaStevilka);
      if (r) setExpandedId(r.id);
    }
  }, [poudarjenaStevilka, racuni]);
  const [dialogPlacilnaNacin, setDialogPlacilnaNacin] = useState<"gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba">("gotovina");
  const [dialogGotovina, setDialogGotovina] = useState<string>("");
  const [dialogKartica, setDialogKartica] = useState<string>("");
  const [dialogBon, setDialogBon] = useState<string>("");
  const [dialogBonPica, setDialogBonPica] = useState<string>("");
  const [dialogSteviloBonov, setDialogSteviloBonov] = useState<string>("");
  const [dialogKupecDavcna, setDialogKupecDavcna] = useState<string>("");
  const [dialogKupecNaziv, setDialogKupecNaziv] = useState<string | null>(null);
  const [dialogKupecNaslov, setDialogKupecNaslov] = useState<string | null>(null);
  const updatePlacilnaNacin = useUpdateRacunPlacilnaNacin();

  if (isLoading) return <div className="p-4 sm:p-8"><Skeleton className="h-[500px]" /></div>;

  const imaDateFilter = datumOd !== "" || datumDo !== "";
  const imaKupecFilter = kupecFilter.trim() !== "";

  function resetDateFilter() {
    setDatumOd("");
    setDatumDo("");
  }

  const steviloNapak = racuni?.filter(jeNapaka).length ?? 0;

  const kupecFilterNorm = kupecFilter.trim().toLowerCase();

  const prikazaniRacuni = (racuni ?? []).filter(r => {
    if (statusFilter === "napake" && !jeNapaka(r)) return false;
    if (datumOd !== "") {
      const odStart = new Date(datumOd);
      odStart.setHours(0, 0, 0, 0);
      if (new Date(r.ustvarjeno) < odStart) return false;
    }
    if (datumDo !== "") {
      const doEnd = new Date(datumDo);
      doEnd.setHours(23, 59, 59, 999);
      if (new Date(r.ustvarjeno) > doEnd) return false;
    }
    if (imaKupecFilter) {
      const naziv = (r.kupecNaziv ?? "").toLowerCase();
      const davcna = (r.kupecDavcnaStevilka ?? "").toLowerCase();
      if (!naziv.includes(kupecFilterNorm) && !davcna.includes(kupecFilterNorm)) return false;
    }
    return true;
  });

  function emptyStateMessage(): string {
    if (statusFilter === "napake" && imaDateFilter && imaKupecFilter) return "Ni računov z napako FURS za izbranega kupca v izbranem obdobju.";
    if (statusFilter === "napake" && imaKupecFilter) return "Ni računov z napako FURS za izbranega kupca.";
    if (statusFilter === "napake" && imaDateFilter) return "Ni računov z napako FURS v izbranem obdobju.";
    if (statusFilter === "napake") return "Ni računov z napako FURS.";
    if (imaDateFilter && imaKupecFilter) return "Ni računov za izbranega kupca v izbranem obdobju.";
    if (imaKupecFilter) return "Ni računov za izbranega kupca.";
    if (imaDateFilter) return "Ni računov v izbranem obdobju.";
    return "Ni izdanih računov.";
  }

  function odpriPrintDialog(r: { id: number; stevilkaRacuna: string; placilnaNacin: string; skupaj: number; znesekGotovina?: number | null; znesekKartica?: number | null; znesekBon?: number | null; steviloBonov?: number | null; znesekBonPica?: number | null; kupecDavcnaStevilka?: string | null; kupecNaziv?: string | null; kupecNaslov?: string | null }) {
    const nacin = (["gotovina", "kartica", "bon", "bon_pica", "negotovinsko", "reprezentanca", "lastna_poraba"].includes(r.placilnaNacin)
      ? r.placilnaNacin
      : "gotovina") as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba";
    setPrintDialog({
      id: r.id,
      stevilkaRacuna: r.stevilkaRacuna,
      placilnaNacin: r.placilnaNacin,
      skupaj: r.skupaj,
      znesekGotovina: r.znesekGotovina ?? null,
      znesekKartica: r.znesekKartica ?? null,
      znesekBon: r.znesekBon ?? null,
      steviloBonov: r.steviloBonov ?? null,
      znesekBonPica: r.znesekBonPica ?? null,
      kupecDavcnaStevilka: r.kupecDavcnaStevilka ?? null,
      kupecNaziv: r.kupecNaziv ?? null,
      kupecNaslov: r.kupecNaslov ?? null,
    });
    setDialogPlacilnaNacin(nacin);
    setDialogGotovina(r.znesekGotovina != null ? String(r.znesekGotovina) : "");
    setDialogKartica(r.znesekKartica != null ? String(r.znesekKartica) : "");
    setDialogBon(r.znesekBon != null ? String(r.znesekBon) : "");
    setDialogBonPica(r.znesekBonPica != null ? String(r.znesekBonPica) : "");
    setDialogSteviloBonov(r.steviloBonov != null ? String(r.steviloBonov) : "");
    setDialogKupecDavcna(r.kupecDavcnaStevilka ?? "");
    setDialogKupecNaziv(r.kupecNaziv ?? null);
    setDialogKupecNaslov(r.kupecNaslov ?? null);
  }

  const dialogVsota = [dialogGotovina, dialogKartica, dialogBon, dialogBonPica]
    .reduce((acc, v) => acc + (v !== "" ? parseFloat(v) || 0 : 0), 0);
  const dialogImaVnose = [dialogGotovina, dialogKartica, dialogBon, dialogBonPica].some(v => v !== "");
  const dialogSkupaj = printDialog?.skupaj ?? 0;
  // Pri negotovinskem načinu negotovinsko pokrije razliko — zadostuje, da vnosi ne presežejo skupaj
  const dialogJeTocno = !dialogImaVnose
    || Math.abs(dialogVsota - dialogSkupaj) <= 0.01
    || (dialogPlacilnaNacin === "negotovinsko" && dialogVsota <= dialogSkupaj + 0.01);
  const dialogGumbOnemogocen = dialogImaVnose && !dialogJeTocno;

  return (
    <div className="p-4 sm:p-8 space-y-6 flex-1 overflow-auto">
      <h1 className="text-3xl font-bold tracking-tight">Arhiv računov</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border bg-muted p-1 gap-1">
          <button
            type="button"
            onClick={() => setStatusFilter("vsi")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === "vsi"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Vsi
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("napake")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === "napake"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Napake
            {steviloNapak > 0 && (
              <Badge className="h-5 min-w-5 px-1 text-xs bg-red-600 hover:bg-red-600 text-white">
                {steviloNapak}
              </Badge>
            )}
          </button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="datum-od" className="text-xs text-muted-foreground">Od</Label>
            <Input
              id="datum-od"
              type="date"
              value={datumOd}
              max={datumDo || todayString()}
              onChange={e => setDatumOd(e.target.value)}
              className="h-9 w-36 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="datum-do" className="text-xs text-muted-foreground">Do</Label>
            <Input
              id="datum-do"
              type="date"
              value={datumDo}
              min={datumOd || undefined}
              max={todayString()}
              onChange={e => setDatumDo(e.target.value)}
              className="h-9 w-36 text-sm"
            />
          </div>
          {imaDateFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetDateFilter}
              className="h-9 gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Ponastavi
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="kupec-filter" className="text-xs text-muted-foreground">Kupec</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id="kupec-filter"
              type="text"
              placeholder="Naziv ali davčna…"
              value={kupecFilter}
              onChange={e => setKupecFilter(e.target.value)}
              className="h-9 w-52 pl-8 text-sm"
            />
            {imaKupecFilter && (
              <button
                type="button"
                onClick={() => setKupecFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Počisti filter kupca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {prikazaniRacuni.map(r => {
          const jaNapaka = jeNapaka(r);
          const jaPotrjen = !!r.eor;
          const jaStorno = !!(r as { jeStorno?: boolean }).jeStorno;
          const jaStorniran = r.status === "storniran";
          const lahkoStornira = !jaStorniran && !jaStorno && r.status !== "napaka";
          const znesekCls = jaStorno ? "text-red-600" : jaStorniran ? "text-muted-foreground line-through" : "";
          const jePoudarjen = poudarjenaStevilka !== null && r.stevilkaRacuna === poudarjenaStevilka;
          return (
            <div
              key={r.id}
              ref={jePoudarjen ? poudarjenRef : null}
              className={`rounded-lg border bg-card overflow-hidden transition-shadow ${jaStorno || jaStorniran ? "opacity-70" : ""} ${jePoudarjen ? "ring-2 ring-primary/40 bg-primary/5 border-primary/30" : ""}`}
            >
              {/* Klikabilna glava */}
              <button
                type="button"
                onClick={() => setExpandedId(prev => prev === r.id ? null : r.id)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-muted/40 transition-colors"
              >
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expandedId === r.id ? "rotate-90" : ""}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold">{r.stevilkaRacuna}</span>
                    {r.jeDelni && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-400 text-blue-700 bg-blue-50">delni</Badge>
                    )}
                    {jaStorno && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-400 text-red-700 bg-red-50">storno</Badge>
                    )}
                    {jaStorniran && !jaStorno && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-gray-400 text-gray-600 bg-gray-50">storniran</Badge>
                    )}
                    {(r as { sumupCheckoutId?: string | null }).sumupCheckoutId && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500 text-blue-700 bg-blue-50 inline-flex items-center gap-0.5">
                        <Smartphone className="h-2.5 w-2.5" />
                        SumUp
                      </Badge>
                    )}
                    {(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-violet-500 text-violet-700 bg-violet-50 inline-flex items-center gap-0.5" title={(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId ?? undefined}>
                        <Smartphone className="h-2.5 w-2.5" />
                        Viva
                      </Badge>
                    )}
                    {(r.kupecNaziv || r.kupecDavcnaStevilka) && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-indigo-400 text-indigo-700 bg-indigo-50 inline-flex items-center gap-0.5 max-w-[160px]">
                        <Building2 className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{r.kupecNaziv ?? "kupec"}</span>
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-muted-foreground">
                    <span>{new Date(r.ustvarjeno).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {r.mizaStevilka && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>Miza {r.mizaStevilka}</span>
                      </>
                    )}
                    <span className="opacity-40">·</span>
                    <span className="capitalize">{r.placilnaNacin}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-sm font-bold whitespace-nowrap ${znesekCls}`}>{r.skupaj.toFixed(2)} €</span>
                  {jaStorniran && !jaStorno ? (
                    <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Storniran</Badge>
                  ) : jaStorno ? (
                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 text-[10px]">Storno</Badge>
                  ) : jaPotrjen ? (
                    <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 text-[10px]">Potrjen</Badge>
                  ) : r.status === "testni" ? (
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[10px]">Testni</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 text-[10px]">Napaka</Badge>
                  )}
                </div>
              </button>

              {/* Razširjeni del */}
              {expandedId === r.id && (
                <div className="border-t px-3 pb-3 pt-2.5 space-y-2.5">
                  {/* Kupec */}
                  {(r.kupecNaziv || r.kupecDavcnaStevilka) && (
                    <div className="flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2">
                      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                      <div className="min-w-0 flex-1 text-[11px] text-indigo-900 space-y-0.5">
                        {r.kupecNaziv && <p className="font-semibold">{r.kupecNaziv}</p>}
                        {r.kupecNaslov && <p className="text-indigo-700">{r.kupecNaslov}</p>}
                        {r.kupecDavcnaStevilka && (
                          <p className="text-indigo-700">
                            <span className="font-medium">ID za DDV: </span>
                            <span className="font-mono">SI{r.kupecDavcnaStevilka}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SumUp checkout ID */}
                  {(r as { sumupCheckoutId?: string | null }).sumupCheckoutId && (
                    <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
                      <Smartphone className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <div className="min-w-0 flex-1 text-[11px] text-blue-900 space-y-0.5">
                        <p className="font-semibold">SumUp Checkout ID</p>
                        <p className="font-mono text-blue-700 break-all">{(r as { sumupCheckoutId?: string | null }).sumupCheckoutId}</p>
                      </div>
                    </div>
                  )}

                  {/* Viva Terminal session ID */}
                  {(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId && (
                    <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2">
                      <Smartphone className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                      <div className="min-w-0 flex-1 text-[11px] text-violet-900 space-y-0.5">
                        <p className="font-semibold">Viva Terminal</p>
                        <p className="font-mono text-violet-700 break-all">{(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId}</p>
                      </div>
                    </div>
                  )}

                  {/* ZOI/EOR — prikaži tudi pri napaki, če je ZOI na voljo */}
                  {(jaPotrjen || r.zoi) && !jaStorniran && <FursSuccessDetail zoi={r.zoi} eor={r.eor} />}

                  {/* Storno referenca */}
                  {jaStorno && (r as { izvorni_racun_id?: number | null }).izvorni_racun_id && (() => {
                    const izvorni = racuni?.find(x => x.id === (r as { izvorni_racun_id?: number | null }).izvorni_racun_id);
                    return (
                      <p className="text-xs text-muted-foreground">
                        Storno izvornega računa <span className="font-mono">{izvorni?.stevilkaRacuna ?? `#${(r as { izvorni_racun_id?: number | null }).izvorni_racun_id}`}</span>
                      </p>
                    );
                  })()}

                  {/* Kopije */}
                  {(r.steviloPrintov ?? 0) > 1 && (
                    <p className="text-xs text-muted-foreground">
                      Kopij natisnjenih: <span className="font-medium text-blue-600">{(r.steviloPrintov ?? 0) - 1}</span>
                    </p>
                  )}

                  {/* Akcije */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
                      onClick={() => odpriPrintDialog(r)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Natisni
                    </Button>
                    {lahkoStornira && (
                      <StornoButton racun={{ id: r.id, stevilkaRacuna: r.stevilkaRacuna, skupaj: r.skupaj }} />
                    )}
                  </div>

                  {/* Zgodovina vračil na Viva terminalu */}
                  {(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId && (
                    <VivaVracilaHistory
                      racunId={r.id}
                      skupaj={r.skupaj}
                      vivaTerminalSessionId={(r as { vivaTerminalSessionId: string }).vivaTerminalSessionId}
                    />
                  )}

                  {/* Skupaj vračila (terminal + storno) */}
                  {!jaStorno && (
                    <SkupajVracilaPanel
                      racunId={r.id}
                      imaVivaTerminal={!!(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId}
                      stornoRacuni={(racuni ?? [])
                        .filter(x => (x as { izvorni_racun_id?: number | null }).izvorni_racun_id === r.id)
                        .map(x => ({ skupaj: x.skupaj, stevilkaRacuna: x.stevilkaRacuna }))}
                    />
                  )}

                  {/* Vračilo na Viva terminal */}
                  {(r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId &&
                    !jaStorno && !jaStorniran && (
                    <VivaTerminalRefundButton
                      racun={{
                        id: r.id,
                        stevilkaRacuna: r.stevilkaRacuna,
                        skupaj: r.skupaj,
                        znesekKartica: (r as { znesekKartica?: number | null }).znesekKartica ?? null,
                        vivaTerminalSessionId: (r as { vivaTerminalSessionId: string }).vivaTerminalSessionId,
                      }}
                    />
                  )}

                  {/* FURS napaka */}
                  {jaNapaka && !jaStorniran && !jaStorno && (
                    <>
                      <RetryFursButton racunId={r.id} />
                      <FursErrorDetail fursOdgovor={r.fursOdgovor} />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {prikazaniRacuni.length === 0 && (
          <div className="rounded-lg border bg-card py-12 text-center text-muted-foreground text-sm">
            {emptyStateMessage()}
          </div>
        )}
      </div>

      <Dialog
        open={printDialog !== null}
        onOpenChange={(open) => { if (!open) setPrintDialog(null); }}
      >
        <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Natisni račun {printDialog?.stevilkaRacuna}</DialogTitle>
          </DialogHeader>
          {printDialog && (
            <PrintReceiptButton
              disabled={dialogGumbOnemogocen}
              racunId={printDialog.id}
              stevilkaRacuna={printDialog.stevilkaRacuna}
              variant="default"
              size="default"
              className="w-full"
              zbirni={true}
              onBeforePrint={async () => {
                const gotovina = dialogGotovina !== "" ? parseFloat(dialogGotovina) : null;
                const kartica = dialogKartica !== "" ? parseFloat(dialogKartica) : null;
                const bon = dialogBon !== "" ? parseFloat(dialogBon) : null;
                const bonPica = dialogBonPica !== "" ? parseFloat(dialogBonPica) : null;
                const steviloBonov = dialogSteviloBonov !== "" ? parseInt(dialogSteviloBonov) : null;
                await updatePlacilnaNacin.mutateAsync({
                  id: printDialog.id,
                  data: {
                    placilnaNacin: dialogPlacilnaNacin,
                    znesekGotovina: gotovina ?? undefined,
                    znesekKartica: kartica ?? undefined,
                    znesekBon: bon ?? undefined,
                    znesekBonPica: bonPica ?? undefined,
                    steviloBonov: steviloBonov ?? undefined,
                    ...((dialogKupecDavcna || dialogKupecNaziv) ? {
                      kupecDavcnaStevilka: /^\d{8}$/.test(dialogKupecDavcna) ? dialogKupecDavcna : undefined,
                      kupecNaziv: dialogKupecNaziv ?? undefined,
                      kupecNaslov: dialogKupecNaslov ?? undefined,
                    } : {}),
                  },
                });
                queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
              }}
              onAfterPrint={() => {
                queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
                setPrintDialog(null);
              }}
            />
          )}
          <div className="space-y-5 pt-2 overflow-y-auto flex-1 pr-1">
            {(dialogPlacilnaNacin === "reprezentanca" || dialogPlacilnaNacin === "lastna_poraba") ? (
              <div className="rounded-md border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Način plačila: <span className="font-medium text-foreground">{dialogPlacilnaNacin === "reprezentanca" ? "Reprezentanca" : "Lastna poraba"}</span> — brez zneska (100% popust)
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <p className="text-sm font-medium">Način plačila</p>
                  <RadioGroup
                    value={dialogPlacilnaNacin}
                    onValueChange={(v) => {
                      const newNacin = v as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba";
                      if (newNacin !== dialogPlacilnaNacin) {
                        const getField = (n: string) => {
                          if (n === "gotovina") return dialogGotovina;
                          if (n === "kartica") return dialogKartica;
                          if (n === "bon") return dialogBon;
                          return "";
                        };
                        const setField = (n: string, val: string) => {
                          if (n === "gotovina") setDialogGotovina(val);
                          else if (n === "kartica") setDialogKartica(val);
                          else if (n === "bon") setDialogBon(val);
                        };
                        const prevAmount = getField(dialogPlacilnaNacin);
                        setField(dialogPlacilnaNacin, "");
                        setField(newNacin, prevAmount);
                      }
                      setDialogPlacilnaNacin(newNacin);
                    }}
                    className="grid grid-cols-3 gap-4"
                  >
                    {NACINI_PLACILA.map(({ value, label, Icon }) => (
                      <div key={value}>
                        <RadioGroupItem value={value} id={`print-nacin-${value}`} className="peer sr-only" />
                        <Label
                          htmlFor={`print-nacin-${value}`}
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary cursor-pointer"
                        >
                          <Icon className="mb-2 h-6 w-6" />
                          {label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Zneski plačil (neobvezno)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="dlg-gotovina" className="text-xs">Gotovina (€)</Label>
                      <Input
                        id="dlg-gotovina"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={dialogGotovina}
                        onChange={(e) => setDialogGotovina(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-kartica" className="text-xs">Kartica (€)</Label>
                      <Input
                        id="dlg-kartica"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={dialogKartica}
                        onChange={(e) => setDialogKartica(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-bon" className="text-xs">Darilni bon (€)</Label>
                      <Input
                        id="dlg-bon"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={dialogBon}
                        onChange={(e) => setDialogBon(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-bon-pica" className="text-xs">Bon za pico (€)</Label>
                      <Input
                        id="dlg-bon-pica"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={dialogBonPica}
                        onChange={(e) => setDialogBonPica(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label htmlFor="dlg-stevilo-bonov" className="text-xs">Število bonov za pico</Label>
                      <Input
                        id="dlg-stevilo-bonov"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={dialogSteviloBonov}
                        onChange={(e) => setDialogSteviloBonov(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {dialogImaVnose && (
                    <div className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${dialogJeTocno ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                      <span>Skupaj vneseno</span>
                      <span>{dialogVsota.toFixed(2)} € / {dialogSkupaj.toFixed(2)} €</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Kupec */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Kupec (neobvezno)
              </p>
              <ShranjeniKupciSelector
                naziv={dialogKupecNaziv}
                naslov={dialogKupecNaslov}
                davcnaStevilka={dialogKupecDavcna}
                onSelect={k => {
                  setDialogKupecNaziv(k.naziv);
                  setDialogKupecNaslov(k.naslov);
                  setDialogKupecDavcna(k.davcnaStevilka ?? "");
                }}
              />
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="dlg-kupec-naziv" className="text-xs text-muted-foreground">Naziv kupca</Label>
                  <Input
                    id="dlg-kupec-naziv"
                    placeholder="Naziv podjetja ali osebe"
                    value={dialogKupecNaziv ?? ""}
                    onChange={e => setDialogKupecNaziv(e.target.value || null)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dlg-kupec-naslov" className="text-xs text-muted-foreground">Naslov (neobvezno)</Label>
                  <Input
                    id="dlg-kupec-naslov"
                    placeholder="Ulica, kraj"
                    value={dialogKupecNaslov ?? ""}
                    onChange={e => setDialogKupecNaslov(e.target.value || null)}
                    className="h-8 text-sm"
                  />
                </div>
                {(dialogKupecNaziv || dialogKupecNaslov) && (
                  <button
                    type="button"
                    onClick={() => { setDialogKupecDavcna(""); setDialogKupecNaziv(null); setDialogKupecNaslov(null); }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Počisti podatke kupca
                  </button>
                )}
              </div>
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
