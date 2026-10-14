import { formatEur } from "@/lib/formatEur";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNaprava } from "@/contexts/NapravaContext";
import { useListRacuni, usePonoviPosiljanjeRacuna, useStornirajRacun, getListRacuniQueryKey, useUpdateRacunPlacilnaNacin, useVivaTerminalRefund, useListVivaVracila, getListVivaVracilaQueryKey, useListFursAttempts, useListUnknownVivaRefunds, getListUnknownVivaRefundsQueryKey, useResolveUnknownVivaRefund, vivaTerminalRefundStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PrintReceiptButton } from "@/components/PrintReceiptButton";
import { ChevronDown, ChevronRight, AlertCircle, RefreshCw, X, Printer, Banknote, CreditCard, Gift, Undo2, Building2, Search, Smartphone, Landmark, FileDown, Send, CheckCircle2, TriangleAlert, Mail } from "lucide-react";
import { PartnerjiSelector } from "@/components/PartnerjiSelector";
import { useToast } from "@/hooks/use-toast";
import { poslovniDatumZaCas } from "@/lib/posCas";
import { hasReceiptPrintChanges } from "@/lib/receipt-print-changes";
import { MonthlyInvoicesDialog } from "@/components/MonthlyInvoicesDialog";
import { FursStateBadge, ReliabilityPanels, classifyFursReceipt } from "@/components/PaymentReliabilityPanels";

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

type StatusFilter = "vsi" | "failed" | "pending" | "sending" | "confirmed" | "unknown" | "eracun_napake";

function jeNapaka(r: { status?: string | null; zoi?: string | null; eor?: string | null }): boolean {
  return classifyFursReceipt(r) === "failed";
}

/** Vrne true, če je pošiljanje e-računa spodletelo ali prejemnik zavrnil — vidno iz DB, ne toasta. */
function jeNapakaPosiljanja(r: {
  eRacunBizboxOdgovor?: string | null;
  eRacunEmailOdgovor?: string | null;
  eRacunBizboxStatus?: string | null;
}): boolean {
  if (r.eRacunBizboxStatus === "zavrnjeno") return true;
  if (r.eRacunBizboxStatus === "napaka") return true;
  if (r.eRacunEmailOdgovor?.startsWith("NAPAKA")) return true;
  return false;
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
        data-testid={`button-retry-furs-${racunId}`}
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
        Storno računa <span className="font-mono font-semibold">{racun.stevilkaRacuna}</span> ({formatEur(racun.skupaj)}) — izda se nov negativni račun pri FURS.
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

// ── bizBox pošiljanje ─────────────────────────────────────────────────────────
type BizBoxOkolje = "test" | "prod";

/** Slovensko ime za bizBox dostavi status */
function formatBizboxStatus(status: string): string {
  switch (status) {
    case "oddano":     return "Oddano (v dostavi)";
    case "v_obdelavi": return "V obdelavi";
    case "dostavljeno": return "Dostavljeno";
    case "zavrnjeno":  return "Zavrnjeno";
    case "napaka":     return "Napaka statusa";
    default: return status;
  }
}

/** Tailwind razredi za barvni badge glede na status */
function bizboxStatusColorClass(status: string | null): string {
  switch (status) {
    case "dostavljeno": return "text-green-700 border-green-300 bg-green-50";
    case "v_obdelavi":  return "text-amber-700 border-amber-300 bg-amber-50";
    case "zavrnjeno":
    case "napaka":      return "text-red-700 border-red-300 bg-red-50";
    case "oddano":      return "text-blue-700 border-blue-300 bg-blue-50";
    default:            return "text-muted-foreground border-muted-foreground/30 bg-background";
  }
}

/**
 * Prikaz statusa dostave prek bizBox in gumb "Preveri".
 * Prikazuje badge statusa, docId in gumb za osvežitev.
 */
function BizBoxStatusButton({
  racunId,
  eRacunBizboxId,
  eRacunBizboxStatus: initialStatus,
  bizBoxKonfiguriran,
}: {
  racunId: number;
  eRacunBizboxId: string | null;
  eRacunBizboxStatus: string | null;
  bizBoxKonfiguriran: boolean;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(initialStatus);

  async function handlePreveri() {
    if (!bizBoxKonfiguriran || !eRacunBizboxId) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/pos/racuni/${racunId}/eracun/status`, { method: "POST" });
      const data = await resp.json() as { bizboxStatus?: string; error?: string; docId?: string };
      if (!resp.ok) {
        toast({ title: "bizBox status: napaka", description: data.error ?? "Neznana napaka", variant: "destructive" });
      } else {
        setStatus(data.bizboxStatus ?? null);
        toast({ title: "bizBox status", description: formatBizboxStatus(data.bizboxStatus ?? "") });
      }
    } catch (err) {
      toast({ title: "Napaka", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Samodejno preveri status ob prvem prikazu, če je nedokončan (enkrat, z naključnim zamikom)
  useEffect(() => {
    if (!bizBoxKonfiguriran || !eRacunBizboxId) return;
    if (status !== "oddano" && status !== "v_obdelavi") return;
    // Naključni zamik 1–5s, da se klici razvrstijo pri večih računih na zaslonu
    const ms = 1000 + Math.random() * 4000;
    const timer = setTimeout(() => { handlePreveri(); }, ms);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Samo ob prvem prikazu

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {/* Status badge */}
      {status && (
        <span
          className={`inline-flex items-center gap-1 text-xs border rounded px-2 py-1 ${bizboxStatusColorClass(status)}`}
          title={`bizBox dostava: ${formatBizboxStatus(status)}`}
        >
          {status === "dostavljeno" ? <CheckCircle2 className="h-3 w-3" /> :
           status === "zavrnjeno"  ? <AlertCircle className="h-3 w-3" /> :
           null}
          {formatBizboxStatus(status)}
        </span>
      )}
      {/* docId — majhen, za diagnostiko */}
      {eRacunBizboxId && (
        <span
          className="text-[10px] text-muted-foreground/60 font-mono"
          title={`bizBox document ID: ${eRacunBizboxId}`}
        >
          #{eRacunBizboxId}
        </span>
      )}
      {/* Gumb "Preveri" — samo ko je docId znan in bizBox konfiguriran */}
      {eRacunBizboxId && bizBoxKonfiguriran && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePreveri}
          disabled={loading}
          className="h-6 px-2 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 gap-1"
          title="Preveri status dostave pri bizBox"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "…" : "Preveri status"}
        </Button>
      )}
    </span>
  );
}

function BizBoxOkoljeIndikator({ okolje }: { okolje: BizBoxOkolje }) {
  if (okolje === "prod") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 border border-red-300">
        <TriangleAlert className="h-2.5 w-2.5" />
        bizBox: PRODUKCIJA (ws.zzi.si)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
      bizBox: TESTNO (demo.zzi.si)
    </span>
  );
}

function BizBoxPosljiButton({
  racunId,
  stevilkaRacuna,
  eRacunStatus,
  eRacunPoslanoDne,
  bizBoxKonfiguriran,
  bizBoxOkolje,
  onUspeh,
}: {
  racunId: number;
  stevilkaRacuna: string;
  eRacunStatus: string | null;
  eRacunPoslanoDne: string | Date | null;
  bizBoxKonfiguriran: boolean;
  bizBoxOkolje: BizBoxOkolje;
  onUspeh: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const jePoslano = eRacunStatus === "poslano";

  async function handlePoslji() {
    if (!bizBoxKonfiguriran || jePoslano) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/pos/racuni/${racunId}/eracun/poslji`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await resp.json() as {
        uspeh?: boolean; error?: string;
        from?: string; to?: string;
        docId?: string | null; ediEnabled?: boolean | null;
      };
      if (!resp.ok) {
        toast({
          title: "bizBox: oddaja ni uspela",
          description: data.error ?? "Neznana napaka",
          variant: "destructive",
        });
      } else {
        toast({
          title: "e-Račun poslan",
          description: `${stevilkaRacuna} → ${data.to ?? ""} (${bizBoxOkolje === "prod" ? "produkcija" : "testno okolje"})${data.docId ? ` • doc #${data.docId}` : ""}`,
        });
        // isEdiEnabled predpreverba opozorilo — ne blokiramo, a opozorimo
        if (data.ediEnabled === false) {
          toast({
            title: "Opozorilo: prejemnik morda ni registriran",
            description: `${data.to ?? "Prejemnik"} ni potrjen v bizBox omrežju. Pošiljanje je poteklo, a preverite status dostave z gumbom "Preveri status".`,
            variant: "destructive",
          });
        }
        onUspeh();
      }
    } catch (err) {
      toast({ title: "Napaka", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (jePoslano) {
    const datumStr = eRacunPoslanoDne
      ? new Date(eRacunPoslanoDne).toLocaleString("sl-SI", {
          timeZone: "Europe/Ljubljana",
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : null;
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-green-700 border border-green-300 rounded px-2 py-1 bg-green-50"
        title={datumStr ? `Oddano: ${datumStr}` : undefined}
      >
        <CheckCircle2 className="h-3 w-3" />
        poslano (bizBox){datumStr ? ` ${datumStr}` : ""}
      </span>
    );
  }

  if (!bizBoxKonfiguriran) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground border border-dashed border-muted-foreground/40 rounded px-2 py-1 cursor-not-allowed select-none"
        title="Nastavite BIZBOX_USER in BIZBOX_PASS v Secrets"
      >
        <Send className="h-3 w-3" />
        bizBox ni konfiguriran
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handlePoslji}
      disabled={loading}
      className={`gap-1.5 ${
        bizBoxOkolje === "prod"
          ? "border-red-400 text-red-700 hover:bg-red-50 hover:border-red-500 ring-2 ring-red-200"
          : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
      }`}
      title={bizBoxOkolje === "prod" ? "⚠️ PRODUKCIJSKO okolje — pošlje na ws.zzi.si" : "Pošlji na demo.zzi.si (testno okolje)"}
    >
      {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      {loading ? "Pošiljanje…" : "Pošlji prek bizBox"}
    </Button>
  );
}

// ── e-SLOG e-mail pošiljanje ─────────────────────────────────────────────────
function EslogEmailButton({
  racunId,
  stevilkaRacuna,
  eRacunStatus,
  eRacunPoslanoDne,
  kupecCpId,
  onUspeh,
}: {
  racunId: number;
  stevilkaRacuna: string;
  eRacunStatus: string | null;
  eRacunPoslanoDne: string | Date | null;
  kupecCpId: string | null | undefined;
  onUspeh: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const jePoslanoEmail = eRacunStatus === "poslano_email";
  const [cakaPotrditve, setCakaPotrditve] = useState(false);

  async function posljiEmail(force = false) {
    setLoading(true);
    setCakaPotrditve(false);
    try {
      const url = `/api/pos/racuni/${racunId}/eracun/poslji-email${force ? "?forcePonoviPosilj=1" : ""}`;
      const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await resp.json() as { uspeh?: boolean; email?: string; error?: string; poslanoPred?: string };
      if (resp.status === 409) {
        // Idempotentnost: poslan pred kratkim — vprašaj za potrditev
        setCakaPotrditve(true);
        toast({
          title: "e-Račun je bil že poslan",
          description: "Račun je bil poslan pred kratkim. Kliknite 'Pošlji znova' za potrditev.",
        });
      } else if (!resp.ok) {
        toast({ title: "e-Račun po e-pošti: ni uspelo", description: data.error ?? "Neznana napaka", variant: "destructive" });
      } else {
        toast({ title: "e-Račun poslan", description: `${stevilkaRacuna} → ${data.email ?? ""}` });
        onUspeh();
      }
    } catch (err) {
      toast({ title: "Napaka", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handlePoslji() {
    if (!kupecCpId || jePoslanoEmail) return;
    await posljiEmail(false);
  }

  if (jePoslanoEmail) {
    const datumStr = eRacunPoslanoDne
      ? new Date(eRacunPoslanoDne).toLocaleString("sl-SI", {
          timeZone: "Europe/Ljubljana",
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : null;
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-green-700 border border-green-300 rounded px-2 py-1 bg-green-50"
        title={datumStr ? `Poslano: ${datumStr}` : undefined}
      >
        <CheckCircle2 className="h-3 w-3" />
        poslano (e-pošta){datumStr ? ` ${datumStr}` : ""}
      </span>
    );
  }

  if (!kupecCpId) return null;

  // Potrditev po 409 (poslan pred kratkim)
  if (cakaPotrditve) {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-amber-700">Že poslano — pošljete znova?</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => posljiEmail(true)}
          disabled={loading}
          className="gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 h-7 px-2 text-xs"
        >
          {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
          Pošlji znova
        </Button>
        <button
          type="button"
          onClick={() => setCakaPotrditve(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Prekliči
        </button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handlePoslji}
      disabled={loading}
      className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      title="Pošlji e-SLOG XML + PDF na kupčev e-naslov za e-račune"
    >
      {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
      {loading ? "Pošiljanje…" : "Pošlji po e-pošti"}
    </Button>
  );
}

function statusVivaVracilaBadge(status: string) {
  if (status === "paid") return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Potrjeno</span>;
  if (status === "failed") return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">Zavrnjeno</span>;
  if (status === "unknown") return <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">Ročna uskladitev</span>;
  return <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">V teku</span>;
}

function UnknownVivaRefundsPanel({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListUnknownVivaRefunds({
    query: { enabled, queryKey: getListUnknownVivaRefundsQueryKey() },
  });
  const resolveRefund = useResolveUnknownVivaRefund();
  const [preverja, setPreverja] = useState<string | null>(null);
  const [izbrano, setIzbrano] = useState<NonNullable<typeof data>["items"][number] | null>(null);
  const [status, setStatus] = useState<"paid" | "failed">("paid");
  const [razlog, setRazlog] = useState("");
  const [dokaz, setDokaz] = useState("");

  if (!enabled || isLoading || !data?.items.length) return null;

  async function osvezi(refundSessionId: string) {
    setPreverja(refundSessionId);
    try {
      const odgovor = await vivaTerminalRefundStatus(refundSessionId);
      await queryClient.invalidateQueries({ queryKey: getListUnknownVivaRefundsQueryKey() });
      toast({
        title: odgovor.status === "PAID" || odgovor.status === "FAILED" ? "Status je razrešen" : "Izid še ni znan",
        description: odgovor.status === "UNKNOWN"
          ? "Viva še vedno ne vrača zanesljivega izida. Preverite terminal ali izpisek."
          : `Viva je vrnila status ${odgovor.status}.`,
      });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string; napaka?: string } } })?.response?.data;
      toast({ title: "Preverjanje ni uspelo", description: msg?.error ?? msg?.napaka ?? "Status ni dosegljiv.", variant: "destructive" });
    } finally {
      setPreverja(null);
    }
  }

  function potrdiRazresitev() {
    if (!izbrano) return;
    resolveRefund.mutate(
      { sessionId: izbrano.refundSessionId, data: { status, razlog: razlog.trim(), dokazReferenca: dokaz.trim() } },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListUnknownVivaRefundsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(izbrano.racunId) }),
          ]);
          toast({ title: "Vračilo je razrešeno", description: `Ročno stanje je nastavljeno na ${status}.` });
          setIzbrano(null);
          setRazlog("");
          setDokaz("");
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Ročna razrešitev ni uspela.";
          toast({ title: "Razrešitev ni uspela", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3" data-testid="panel-unknown-viva-refunds">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <h2 className="font-semibold text-amber-950">Nejasna Viva vračila ({data.items.length})</h2>
            <p className="text-xs text-amber-800">Najprej ponovno preverite Vivo. Ročno zaključite šele po primerjavi s terminalom ali izpiskom.</p>
          </div>
        </div>
        <div className="space-y-2">
          {data.items.map(item => (
            <div key={item.id} className="rounded-md border border-amber-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.stevilkaRacuna} · {formatEur(Number(item.znesek))}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.ustvarjeno).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" })}
                    {" · "}<span className="font-mono">{item.refundSessionId}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => osvezi(item.refundSessionId)} disabled={preverja === item.refundSessionId}>
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${preverja === item.refundSessionId ? "animate-spin" : ""}`} />
                    Ponovno preveri Vivo
                  </Button>
                  <Button type="button" size="sm" onClick={() => { setIzbrano(item); setStatus("paid"); }}>
                    Ročno razreši
                  </Button>
                </div>
              </div>
              {item.napaka && <p className="mt-1 text-xs text-amber-800">{item.napaka}</p>}
              <p className="mt-1 text-[11px] text-slate-600">Naprava: <span className="font-mono">{item.napravaKljuc ?? "ni zabeležena"}</span> · izvajalec: {item.actorNatakarId != null ? `Natakar #${item.actorNatakarId}` : item.actorClerkUserId ?? "ni zabeležen"}</p>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={!!izbrano} onOpenChange={open => !open && setIzbrano(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ročna razrešitev Viva vračila</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              Ta korak ne kliče terminala. Izberite stanje samo na podlagi preverjenega terminala ali izpiska.
            </div>
            <div className="space-y-2">
              <Label>Končno stanje</Label>
              <RadioGroup value={status} onValueChange={value => setStatus(value as "paid" | "failed")} className="flex gap-4">
                <label className="flex items-center gap-2"><RadioGroupItem value="paid" /> Vračilo je bilo izvedeno</label>
                <label className="flex items-center gap-2"><RadioGroupItem value="failed" /> Vračilo ni bilo izvedeno</label>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-resolution-reason">Razlog odločitve</Label>
              <textarea id="refund-resolution-reason" value={razlog} onChange={e => setRazlog(e.target.value)} className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Kaj ste preverili in zakaj je izbrano stanje pravilno?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-resolution-proof">Dokaz ali referenca</Label>
              <Input id="refund-resolution-proof" value={dokaz} onChange={e => setDokaz(e.target.value)} placeholder="ID transakcije, št. izpiska ali interna referenca" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIzbrano(null)}>Prekliči</Button>
              <Button type="button" onClick={potrdiRazresitev} disabled={resolveRefund.isPending || razlog.trim().length < 10 || dokaz.trim().length < 3}>
                {resolveRefund.isPending ? "Shranjevanje…" : "Potrdi ročno razrešitev"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VivaVracilaHistory({
  racunId,
  skupaj,
  vivaTerminalSessionId,
  prikaziAudit,
}: {
  racunId: number;
  skupaj: number;
  vivaTerminalSessionId?: string;
  prikaziAudit: boolean;
}) {
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
                  <span className="text-violet-900 font-mono font-semibold">{formatEur(znesek)}</span>
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
              {v.status === "unknown" && (
                <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  <p className="text-[10px] text-amber-800">
                    Izid vračila ni znan. Ne ponavljajte vračila in ne nadaljujte s stornom, dokler odgovorna oseba ne preveri transakcije na Viva terminalu.
                  </p>
                </div>
              )}
              {prikaziAudit && (
                <div className="rounded border border-slate-200 bg-white/70 px-2 py-1.5 text-[10px] text-slate-700 space-y-1">
                  <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-3">
                    <p>
                      <span className="font-semibold">Izvajalec:</span>{" "}
                      {v.actorNatakarId != null
                        ? `Natakar #${v.actorNatakarId}`
                        : v.actorClerkUserId
                          ? `Uporabnik ${v.actorClerkUserId}`
                          : "ni zabeležen"}
                    </p>
                    <p>
                      <span className="font-semibold">Naprava:</span>{" "}
                      <span className="font-mono break-all">{v.napravaKljuc ?? "ni zabeležena"}</span>
                    </p>
                    <p>
                      <span className="font-semibold">Provider ref.:</span>{" "}
                      <span className="font-mono break-all">{v.providerReferenca}</span>
                    </p>
                  </div>
                  {v.statusPrehodi.length > 0 && (
                    <details>
                      <summary className="cursor-pointer font-semibold text-slate-700">
                        Potek statusa ({v.statusPrehodi.length})
                      </summary>
                      <div className="mt-1 space-y-1 border-l-2 border-slate-200 pl-2">
                        {v.statusPrehodi.map(prehod => (
                          <div key={prehod.id}>
                            <p>
                              {new Date(prehod.ustvarjeno).toLocaleString("sl-SI", {
                                timeZone: "Europe/Ljubljana",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                              {" · "}
                              <span className="font-medium">
                                {prehod.prejsnjiStatus ? `${prehod.prejsnjiStatus} → ` : ""}
                                {prehod.noviStatus}
                              </span>
                            </p>
                            <p className="text-slate-500">
                              {prehod.actorNatakarId != null
                                ? `Natakar #${prehod.actorNatakarId}`
                                : prehod.actorClerkUserId
                                  ? `Uporabnik ${prehod.actorClerkUserId}`
                                  : "Neznan izvajalec"}
                              {" · naprava "}
                              <span className="font-mono">{prehod.napravaKljuc ?? "ni zabeležena"}</span>
                            </p>
                            {prehod.napaka && <p className="text-red-700">{prehod.napaka}</p>}
                            {prehod.vir === "manual" && (
                              <p className="text-amber-800">
                                Ročno: {prehod.razlog ?? "brez razloga"} · dokaz: <span className="font-mono">{prehod.dokazReferenca ?? "ni zabeležen"}</span>
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
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
                <span className="text-violet-900 font-mono font-semibold">{formatEur(skupajVrnjeno)}</span>
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
            <span className="font-mono text-slate-700">{formatEur(skupajVivaVrnjeno)}</span>
          </div>
        )}
        {stornoRacuni.map(s => (
          <div key={s.stevilkaRacuna} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-600 flex items-center gap-1">
              <Undo2 className="h-3 w-3" />
              Storno {s.stevilkaRacuna}
            </span>
            <span className="font-mono text-slate-700">{formatEur(Math.abs(Number(s.skupaj)))}</span>
          </div>
        ))}
        <div className="border-t border-slate-200 mt-1" />
        <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
          <span className="text-slate-800 font-semibold">Skupaj vrnjeno:</span>
          <span className="font-mono font-semibold text-slate-900">{formatEur(skupajVrnjeno)}</span>
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
  const { napravaKljuc } = useNaprava();
  const queryClient = useQueryClient();
  const [faza, setFaza] = useState<VivaRefundFaza>("idle");
  const [refundSessionId, setRefundSessionId] = useState<string | null>(null);
  const [napakaSporocilo, setNapakaSporocilo] = useState<string | null>(null);
  const [limitDosezen, setLimitDosezen] = useState(false);
  const [unknownIzid, setUnknownIzid] = useState(false);
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
        const res = await fetch(
          `/api/terminal/viva/terminal/refund/status/${encodeURIComponent(refundSessionId)}`,
          { headers: napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {} },
        );
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
        } else if (data.status === "UNKNOWN") {
          setUnknownIzid(true);
          setFaza("napaka");
          setNapakaSporocilo(data.napaka ?? "Izid terminalskega vračila ni znan; potrebna je ročna uskladitev.");
          queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(racun.id) });
          clearInterval(interval);
        }
      } catch {
        // network error, keep polling
      }
    }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [faza, refundSessionId, racun.id, racun.stevilkaRacuna, toast, queryClient, napravaKljuc]);

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
          queryClient.invalidateQueries({ queryKey: getListVivaVracilaQueryKey(racun.id) });
          if (data.status === "unknown") {
            setUnknownIzid(true);
            setFaza("napaka");
            setNapakaSporocilo("Izid terminalskega vračila ni znan; potrebna je ročna uskladitev.");
          }
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
    setUnknownIzid(false);
  }

  function handlePonoviVracilo() {
    setNapakaSporocilo(null);
    setRefundSessionId(null);
    setLimitDosezen(false);
    setUnknownIzid(false);
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
        Vračilo na terminal ({formatEur(znesekVracila)})
      </Button>
    );
  }

  if (faza === "potrditev") {
    return (
      <div className="flex flex-wrap items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
        <div className="flex-1 space-y-1.5">
          <p className="text-sm text-violet-800">
            Vračilo <span className="font-mono font-semibold">{formatEur(znesekVracila)}</span> na Viva Terminal — stranka mora priložiti kartico.
          </p>
          {jeDeljenoPlacilo && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                Račun je bil plačan delno z gotovino. Vračilo zajema samo kartični del ({formatEur(znesekVracila)} od {formatEur(racun.skupaj)}).
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
          {limitDosezen ? "Vračilo ni mogoče." : unknownIzid ? "Izid vračila ni znan." : "Terminal je zavrnil vračilo."}
        </p>
        {unknownIzid && (
          <p className="text-xs font-medium text-red-800">
            Ustavite postopek. Ne ponavljajte vračila in ne izvedite fiskalnega storna, dokler odgovorna oseba ne preveri transakcije na Viva terminalu.
          </p>
        )}
        {napakaSporocilo && (
          <p className="text-xs text-red-700" data-testid="refund-napaka-sporocilo">
            <span className="font-medium">Razlog:</span> {napakaSporocilo}
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {!limitDosezen && !unknownIzid && (
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

type StornoFlowRacun = {
  id: number;
  stevilkaRacuna: string;
  skupaj: number;
  znesekKartica?: number | null;
  vivaTerminalSessionId: string;
};

function KarticniStornoFlow({
  racun,
  stornoRacuni,
}: {
  racun: StornoFlowRacun;
  stornoRacuni: Array<{ skupaj: number; stevilkaRacuna: string }>;
}) {
  const { data: vracila, isLoading } = useListVivaVracila(racun.id, {
    query: {
      queryKey: getListVivaVracilaQueryKey(racun.id),
      refetchInterval: (query) => {
        const data = query.state.data as { status: string }[] | undefined;
        return Array.isArray(data) && data.some(v => v.status === "pending") ? 3000 : false;
      },
    },
  });
  const imaStorno = stornoRacuni.length > 0;
  const imaPotrjenoVracilo = (vracila ?? []).some(v => v.status === "paid");
  const imaUnknown = !imaPotrjenoVracilo && (vracila ?? []).some(v => v.status === "unknown");
  const imaPending = !imaPotrjenoVracilo && (vracila ?? []).some(v => v.status === "pending");
  const lahkoZacneVracilo = !isLoading && !imaPotrjenoVracilo && !imaUnknown && !imaPending;
  const obaZakljucena = imaPotrjenoVracilo && imaStorno;

  return (
    <div className={`rounded-md border px-3 py-3 space-y-3 ${obaZakljucena ? "border-green-200 bg-green-50/50" : imaUnknown ? "border-red-300 bg-red-50/60" : "border-slate-300 bg-slate-50/70"}`}>
      <div className="flex items-start gap-2">
        {obaZakljucena ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Storno kartičnega računa — 2 koraka</p>
          <p className="text-xs text-slate-600">
            Terminalsko vračilo in fiskalni storno sta ločena. Postopek je končan šele, ko sta potrjena oba.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className={`rounded border px-3 py-2 ${imaPotrjenoVracilo ? "border-green-200 bg-green-50" : imaUnknown ? "border-red-200 bg-red-50" : "border-violet-200 bg-violet-50"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">1. Vračilo na Viva terminal</p>
            {imaPotrjenoVracilo
              ? <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Korak končan</span>
              : imaUnknown
                ? <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">Postopek ustavljen</span>
                : imaPending
                  ? <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Čakanje na terminal</span>
                  : <Badge variant="outline" className="text-[10px]">Ni izvedeno</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {imaPotrjenoVracilo ? "Kartični znesek je potrjeno vrnjen." : imaUnknown ? "Izid ni znan; potrebna je ročna uskladitev." : imaPending ? "Čakanje na končni odgovor terminala." : "Najprej vrnite kartični znesek stranki."}
          </p>
        </div>
        <div className={`rounded border px-3 py-2 ${imaStorno ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">2. Fiskalni storno pri FURS</p>
            {imaStorno ? <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Izdan</span> : <Badge variant="outline" className="text-[10px]">Ni izveden</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {imaStorno ? `FURS dokument ${stornoRacuni[0]?.stevilkaRacuna ?? ""} je shranjen.` : imaPotrjenoVracilo ? "Terminal je potrjen; zdaj izdajte še fiskalni storno." : "Ta korak se odpre po potrjenem terminalskem vračilu."}
          </p>
        </div>
      </div>

      {imaUnknown && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <p className="text-xs font-medium text-red-900">
            Postopek je ustavljen. Ne ponavljajte vračila in ne izvedite fiskalnega storna, dokler odgovorna oseba ne preveri izida na Viva terminalu.
          </p>
        </div>
      )}

      {!obaZakljucena && !imaUnknown && (
        <div>
          {lahkoZacneVracilo && <VivaTerminalRefundButton racun={racun} />}
          {imaPotrjenoVracilo && !imaStorno && (
            <StornoButton racun={{ id: racun.id, stevilkaRacuna: racun.stevilkaRacuna, skupaj: racun.skupaj }} />
          )}
          {imaPending && (
            <p className="text-xs text-violet-800">Počakajte na končni odgovor terminala. Fiskalni storno je do takrat onemogočen.</p>
          )}
        </div>
      )}
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
  return poslovniDatumZaCas();
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
  const { user } = useAuth();
  const { nastavitve } = useNastavitve();
  const bizBoxOkolje = ((nastavitve as (typeof nastavitve & { bizBoxOkolje?: string }) | undefined)?.bizBoxOkolje ?? "test") as BizBoxOkolje;
  const bizBoxKonfiguriran = !!((nastavitve as (typeof nastavitve & { bizBoxKonfiguriran?: boolean }) | undefined)?.bizBoxKonfiguriran);
  const imaTrr = user?.imaTrr ?? false;
  const lahkoVidiRefundAudit = ["admin", "admin_enote", "superadmin", "super_admin"].includes(user?.vloga ?? "");
  const [mesecniOpen, setMesecniOpen] = useState(false);
  const lahkoIzdaMesecne = ["admin", "admin_enote"].includes(user?.vloga ?? "");
  const nacinIPlacila = NACINI_PLACILA.filter(n => {
    if (n.value === "kartica" || n.value === "negotovinsko") return imaTrr;
    return true;
  });
  const search = useSearch();
  const poudarjenaStevilka = new URLSearchParams(search).get("stevilka") ?? null;
  const poudarjenRef = useRef<HTMLDivElement | null>(null);
  const { data: racuni, isLoading } = useListRacuni();
  const { data: fursAudit } = useListFursAttempts();
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

  const fursStateFor = (receipt: { id: number; status?: string | null; eor?: string | null; zoi?: string | null }) =>
    fursAudit?.items.find(item => item.id === receipt.id)?.state ?? classifyFursReceipt(receipt);
  const fursCounts = (racuni ?? []).reduce<Record<"pending" | "sending" | "confirmed" | "failed" | "unknown", number>>(
    (counts, receipt) => {
      counts[fursStateFor(receipt)]++;
      return counts;
    },
    { pending: 0, sending: 0, confirmed: 0, failed: 0, unknown: 0 }
  );
  const steviloERacunNapak = racuni?.filter(r => jeNapakaPosiljanja(r as {
    eRacunBizboxOdgovor?: string | null;
    eRacunEmailOdgovor?: string | null;
    eRacunBizboxStatus?: string | null;
  })).length ?? 0;

  const kupecFilterNorm = kupecFilter.trim().toLowerCase();

  const prikazaniRacuni = (racuni ?? []).filter(r => {
    if (statusFilter !== "vsi" && statusFilter !== "eracun_napake" && fursStateFor(r) !== statusFilter) return false;
    if (statusFilter === "eracun_napake" && !jeNapakaPosiljanja(r as {
      eRacunBizboxOdgovor?: string | null;
      eRacunEmailOdgovor?: string | null;
      eRacunBizboxStatus?: string | null;
    })) return false;
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
    if (statusFilter !== "vsi" && statusFilter !== "eracun_napake") return `Ni računov FURS v stanju »${statusFilter}« za izbrane filtre.`;
    if (statusFilter === "eracun_napake" && imaDateFilter && imaKupecFilter) return "Ni neuspešnih e-računov za izbranega kupca v izbranem obdobju.";
    if (statusFilter === "eracun_napake" && imaKupecFilter) return "Ni neuspešnih e-računov za izbranega kupca.";
    if (statusFilter === "eracun_napake" && imaDateFilter) return "Ni neuspešnih e-računov v izbranem obdobju.";
    if (statusFilter === "eracun_napake") return "Vsi e-računi so dostavljeni ali v obdelavi.";
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
      placilnaNacin: nacin,
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

  // dialogBonPica je informativna vrednost (skupaj je že neto) — ne šteje k plačilni vsoti
  const dialogVsota = [dialogGotovina, dialogKartica, dialogBon]
    .reduce((acc, v) => acc + (v !== "" ? parseFloat(v) || 0 : 0), 0);
  const dialogImaVnose = [dialogGotovina, dialogKartica, dialogBon].some(v => v !== "");
  const dialogSkupaj = printDialog?.skupaj ?? 0;
  // Pri negotovinskem načinu negotovinsko pokrije razliko — zadostuje, da vnosi ne presežejo skupaj
  const dialogJeTocno = !dialogImaVnose
    || Math.abs(dialogVsota - dialogSkupaj) <= 0.01
    || (dialogPlacilnaNacin === "negotovinsko" && dialogVsota <= dialogSkupaj + 0.01);
  const dialogGumbOnemogocen = dialogImaVnose && !dialogJeTocno;

  return (
    <div className="p-2 sm:p-8 space-y-2 sm:space-y-6 flex-1 overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl sm:text-3xl font-bold tracking-tight leading-tight">Arhiv računov</h1>
        {lahkoIzdaMesecne && (
          <Button type="button" variant="outline" onClick={() => setMesecniOpen(true)} data-testid="button-monthly-invoices">
            <FileDown className="mr-2 h-4 w-4" />
            Mesečni računi
          </Button>
        )}
      </div>
      {lahkoIzdaMesecne && <MonthlyInvoicesDialog open={mesecniOpen} onOpenChange={setMesecniOpen} />}
       <ReliabilityPanels />
      <UnknownVivaRefundsPanel enabled={lahkoVidiRefundAudit} />

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2 sm:gap-3">
        <div className="grid w-full grid-cols-4 sm:flex sm:w-auto rounded-lg border bg-muted p-0.5 sm:p-1 gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => setStatusFilter("vsi")}
            data-testid="button-filter-furs-vsi"
            className={`min-w-0 rounded-md px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors ${
              statusFilter === "vsi"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Vsi
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("failed")}
            data-testid="button-filter-furs-failed"
            className={`min-w-0 inline-flex items-center justify-center gap-0.5 sm:gap-1.5 rounded-md px-1 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors ${
              statusFilter === "failed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="sm:hidden">FURS napake</span>
            <span className="hidden sm:inline">FURS neuspešno</span>
            {fursCounts.failed > 0 && (
              <Badge className="h-5 min-w-5 px-1 text-xs bg-red-600 hover:bg-red-600 text-white">
                {fursCounts.failed}
              </Badge>
            )}
          </button>
          {(["pending", "sending", "confirmed", "unknown"] as const).map(state => (
            <button
              key={state}
              type="button"
              onClick={() => setStatusFilter(state)}
              data-testid={`button-filter-furs-${state}`}
              className={`min-w-0 inline-flex items-center justify-center gap-0.5 sm:gap-1.5 rounded-md px-0.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors ${statusFilter === state ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FursStateBadge state={state} />
              {fursCounts[state] > 0 && <span className="text-xs">{fursCounts[state]}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStatusFilter("eracun_napake")}
            data-testid="button-filter-eracun-napake"
            className={`min-w-0 inline-flex items-center justify-center gap-0.5 sm:gap-1.5 rounded-md px-1 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors ${
              statusFilter === "eracun_napake"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Računi, kjer je pošiljanje e-računa spodletelo ali bilo zavrnjeno"
          >
            <span className="sm:hidden">e-R napake</span>
            <span className="hidden sm:inline">e-Račun napake</span>
            {steviloERacunNapak > 0 && (
              <Badge className="h-5 min-w-5 px-1 text-xs bg-orange-600 hover:bg-orange-600 text-white">
                {steviloERacunNapak}
              </Badge>
            )}
          </button>
        </div>

        <div className="flex w-full sm:w-auto items-end gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-1 sm:flex-none flex-col gap-0.5 sm:gap-1">
            <Label htmlFor="datum-od" className="text-[10px] sm:text-xs text-muted-foreground">Od</Label>
            <Input
              id="datum-od"
              type="date"
              value={datumOd}
              max={datumDo || todayString()}
              onChange={e => setDatumOd(e.target.value)}
              className="h-8 w-full sm:h-9 sm:w-36 px-1.5 sm:px-3 text-xs sm:text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-1 sm:flex-none flex-col gap-0.5 sm:gap-1">
            <Label htmlFor="datum-do" className="text-[10px] sm:text-xs text-muted-foreground">Do</Label>
            <Input
              id="datum-do"
              type="date"
              value={datumDo}
              min={datumOd || undefined}
              max={todayString()}
              onChange={e => setDatumDo(e.target.value)}
              className="h-8 w-full sm:h-9 sm:w-36 px-1.5 sm:px-3 text-xs sm:text-sm"
            />
          </div>
          {imaDateFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetDateFilter}
              className="h-8 sm:h-9 px-2 gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ponastavi</span>
            </Button>
          )}
        </div>

        <div className="flex w-full sm:w-auto flex-col gap-0.5 sm:gap-1">
          <Label htmlFor="kupec-filter" className="sr-only sm:not-sr-only text-xs text-muted-foreground">Kupec</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id="kupec-filter"
              type="text"
              placeholder="Naziv ali davčna…"
              value={kupecFilter}
              onChange={e => setKupecFilter(e.target.value)}
              className="h-8 sm:h-9 w-full sm:w-52 pl-8 text-xs sm:text-sm"
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
          const fursState = fursStateFor(r);
          const jaNapaka = fursState === "failed";
          const jaPotrjen = fursState === "confirmed";
          const jaStorno = !!(r as { jeStorno?: boolean }).jeStorno;
          const jaStorniran = r.status === "storniran";
          const lahkoStornira = !jaStorniran && !jaStorno && r.status !== "napaka";
          const vivaTerminalSessionId = (r as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId ?? null;
          const stornoRacuni = (racuni ?? [])
            .filter(x => (x as { izvorni_racun_id?: number | null }).izvorni_racun_id === r.id)
            .map(x => ({ skupaj: x.skupaj, stevilkaRacuna: x.stevilkaRacuna }));
          const znesekCls = jaStorno ? "text-red-600" : jaStorniran ? "text-muted-foreground line-through" : "";
          const jePoudarjen = poudarjenaStevilka !== null && r.stevilkaRacuna === poudarjenaStevilka;
          return (
            <div
              key={r.id}
              ref={jePoudarjen ? poudarjenRef : null}
              className={`rounded-lg border bg-card overflow-hidden transition-shadow ${jaStorno || (jaStorniran && !vivaTerminalSessionId) ? "opacity-70" : ""} ${jePoudarjen ? "ring-2 ring-primary/40 bg-primary/5 border-primary/30" : ""}`}
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
                  <span className={`text-sm font-bold whitespace-nowrap ${znesekCls}`}>{formatEur(r.skupaj)}</span>
                  {jaStorniran && !jaStorno ? (
                    <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Storniran</Badge>
                  ) : jaStorno ? (
                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 text-[10px]">Storno</Badge>
                  ) : jaPotrjen ? (
                    <FursStateBadge state="confirmed" testId={`status-furs-receipt-${r.id}`} />
                  ) : r.status === "testni" ? (
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[10px]">Testni</Badge>
                  ) : (
                    <FursStateBadge state={fursState} testId={`status-furs-receipt-${r.id}`} />
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
                    {lahkoStornira && !vivaTerminalSessionId && (
                      <StornoButton racun={{ id: r.id, stevilkaRacuna: r.stevilkaRacuna, skupaj: r.skupaj }} />
                    )}
                    {/* e-Račun XML prenos (pripravljen ali poslano) */}
                    {((r as { eRacunStatus?: string | null }).eRacunStatus === "pripravljen" ||
                      (r as { eRacunStatus?: string | null }).eRacunStatus === "poslano") && (
                      <a
                        href={`/api/pos/racuni/${r.id}/eracun.xml`}
                        download={`eracun-${r.stevilkaRacuna}.xml`}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          e-Račun XML
                        </Button>
                      </a>
                    )}
                    {/* bizBox pošiljanje — ko je XML pripravljen ali že poslano */}
                    {((r as { eRacunStatus?: string | null }).eRacunStatus === "pripravljen" ||
                      (r as { eRacunStatus?: string | null }).eRacunStatus === "poslano") && (
                      <BizBoxPosljiButton
                        racunId={r.id}
                        stevilkaRacuna={r.stevilkaRacuna}
                        eRacunStatus={(r as { eRacunStatus?: string | null }).eRacunStatus ?? null}
                        eRacunPoslanoDne={(r as { eRacunPoslanoDne?: string | Date | null }).eRacunPoslanoDne ?? null}
                        bizBoxKonfiguriran={bizBoxKonfiguriran}
                        bizBoxOkolje={bizBoxOkolje}
                        onUspeh={() => queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() })}
                      />
                    )}
                    {/* bizBox status dostave — ko je poslan prek bizBox, prikaži badge + Preveri gumb */}
                    {(r as { eRacunStatus?: string | null }).eRacunStatus === "poslano" && (
                      <BizBoxStatusButton
                        racunId={r.id}
                        eRacunBizboxId={(r as { eRacunBizboxId?: string | null }).eRacunBizboxId ?? null}
                        eRacunBizboxStatus={(r as { eRacunBizboxStatus?: string | null }).eRacunBizboxStatus ?? null}
                        bizBoxKonfiguriran={bizBoxKonfiguriran}
                      />
                    )}
                    {/* e-SLOG e-mail pošiljanje — ko je XML pripravljen ali že poslano po e-pošti */}
                    {((r as { eRacunStatus?: string | null }).eRacunStatus === "pripravljen" ||
                      (r as { eRacunStatus?: string | null }).eRacunStatus === "poslano_email") && (
                      <EslogEmailButton
                        racunId={r.id}
                        stevilkaRacuna={r.stevilkaRacuna}
                        eRacunStatus={(r as { eRacunStatus?: string | null }).eRacunStatus ?? null}
                        eRacunPoslanoDne={(r as { eRacunPoslanoDne?: string | Date | null }).eRacunPoslanoDne ?? null}
                        kupecCpId={(r as { kupecCpId?: string | null }).kupecCpId ?? null}
                        onUspeh={() => queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() })}
                      />
                    )}
                    {/* bizBox okolje indikator — pokažemo samo ko je račun v stanju pripravljen */}
                    {(r as { eRacunStatus?: string | null }).eRacunStatus === "pripravljen" && bizBoxKonfiguriran && (
                      <BizBoxOkoljeIndikator okolje={bizBoxOkolje} />
                    )}
                    {(r as { eRacunStatus?: string | null }).eRacunStatus === "napaka" && (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-red-600 border border-red-300 rounded px-2 py-1 bg-red-50"
                        title={(r as { eRacunNapaka?: string | null }).eRacunNapaka ?? "Napaka pri generiranju e-računa"}
                      >
                        <AlertCircle className="h-3 w-3" />
                        e-Račun: napaka
                      </span>
                    )}
                    {/* Trajni badge napake pošiljanja — bere se iz DB, ne izgine po zaprtju toasta */}
                    {jeNapakaPosiljanja(r as {
                      eRacunBizboxOdgovor?: string | null;
                      eRacunEmailOdgovor?: string | null;
                      eRacunBizboxStatus?: string | null;
                    }) && (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-orange-700 border border-orange-300 rounded px-2 py-1 bg-orange-50"
                        title={
                          (() => {
                            const r2 = r as {
                              eRacunBizboxOdgovor?: string | null;
                              eRacunEmailOdgovor?: string | null;
                              eRacunBizboxStatus?: string | null;
                            };
                            if (r2.eRacunBizboxStatus === "zavrnjeno") return "bizBox: prejemnik je zavrnil e-račun";
                            if (r2.eRacunBizboxOdgovor?.includes("NAPAKA")) return r2.eRacunBizboxOdgovor ?? "Napaka pošiljanja";
                            if (r2.eRacunEmailOdgovor?.startsWith("NAPAKA")) return r2.eRacunEmailOdgovor ?? "Napaka e-pošte";
                            return "Napaka pošiljanja e-računa";
                          })()
                        }
                      >
                        <TriangleAlert className="h-3 w-3" />
                        {(r as { eRacunBizboxStatus?: string | null }).eRacunBizboxStatus === "zavrnjeno"
                          ? "e-Račun zavrnjeno"
                          : "Napaka pošiljanja"}
                      </span>
                    )}
                  </div>

                  {/* Voden storno kartičnega računa: terminalsko vračilo + FURS */}
                  {vivaTerminalSessionId && !jaStorno && (
                    <KarticniStornoFlow
                      racun={{
                        id: r.id,
                        stevilkaRacuna: r.stevilkaRacuna,
                        skupaj: r.skupaj,
                        znesekKartica: (r as { znesekKartica?: number | null }).znesekKartica ?? null,
                        vivaTerminalSessionId,
                      }}
                      stornoRacuni={stornoRacuni}
                    />
                  )}

                  {/* Zgodovina vračil na Viva terminalu */}
                  {vivaTerminalSessionId && (
                    <VivaVracilaHistory
                      racunId={r.id}
                      skupaj={r.skupaj}
                      vivaTerminalSessionId={vivaTerminalSessionId}
                      prikaziAudit={lahkoVidiRefundAudit}
                    />
                  )}

                  {/* Skupaj vračila (terminal + storno) */}
                  {!jaStorno && (
                    <SkupajVracilaPanel
                      racunId={r.id}
                      imaVivaTerminal={!!vivaTerminalSessionId}
                      stornoRacuni={stornoRacuni}
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
                const gotovina = dialogGotovina !== "" ? parseDecimal(dialogGotovina) : null;
                const kartica = dialogKartica !== "" ? parseDecimal(dialogKartica) : null;
                const bon = dialogBon !== "" ? parseDecimal(dialogBon) : null;
                const bonPica = dialogBonPica !== "" ? parseDecimal(dialogBonPica) : null;
                const steviloBonov = dialogSteviloBonov !== "" ? parseInt(dialogSteviloBonov) : null;
                const data = {
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
                  };
                if (!hasReceiptPrintChanges(printDialog, data)) return;
                await updatePlacilnaNacin.mutateAsync({
                  id: printDialog.id,
                  data,
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
                    {nacinIPlacila.map(({ value, label, Icon }) => (
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
                      <DecimalInput
                        id="dlg-gotovina"
                        placeholder="0,00"
                        value={dialogGotovina}
                        onChange={(e) => setDialogGotovina(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-kartica" className="text-xs">Kartica (€)</Label>
                      <DecimalInput
                        id="dlg-kartica"
                        placeholder="0,00"
                        value={dialogKartica}
                        onChange={(e) => setDialogKartica(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-bon" className="text-xs">Darilni bon (€)</Label>
                      <DecimalInput
                        id="dlg-bon"
                        placeholder="0,00"
                        value={dialogBon}
                        onChange={(e) => setDialogBon(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-bon-pica" className="text-xs">Bon za pico (€)</Label>
                      <DecimalInput
                        id="dlg-bon-pica"
                        placeholder="0,00"
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
                      <span>{formatEur(dialogVsota)} / {formatEur(dialogSkupaj)}</span>
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
              <PartnerjiSelector
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
