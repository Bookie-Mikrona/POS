import { useCallback, useEffect, useState } from "react";
import { BellRing, PhoneCall, UserRound, X } from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListAktivnaNarocilaQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { TelefonNarociloDialog } from "@/components/TelefonNarociloDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useAutoStart } from "@/contexts/AutoStartContext";
import { useToast } from "@/hooks/use-toast";

type CtiKlic = {
  id: number;
  telefon: string;
  prejeto: string;
  narocnikId: number | null;
  narocnikIme: string | null;
};

function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

function formatPrejeto(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} / ${part("hour")}:${part("minute")}`;
}

export function CtiDohodniKlicPopup() {
  const { user } = useAuth();
  const { block } = useAutoStart();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [klici, setKlici] = useState<CtiKlic[]>([]);
  const [telefonDialogOpen, setTelefonDialogOpen] = useState(false);
  const [initialTelefon, setInitialTelefon] = useState<string | null>(null);
  const [obravnavamId, setObravnavamId] = useState<number | null>(null);
  const enotaId = user?.enotaId;

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    ...(enotaId ? { "X-Enota-Id": String(enotaId) } : {}),
  }), [enotaId]);

  const naloziKlice = useCallback(async () => {
    if (!enotaId) {
      setKlici([]);
      return;
    }
    try {
      const response = await fetch(apiUrl("/api/cti/aktivni-klici"), {
        credentials: "include",
        headers: headers(),
        cache: "no-store",
      });
      if (!response.ok) return;
      setKlici(await response.json() as CtiKlic[]);
    } catch {
      // CTI ne sme motiti običajnega POS dela, če je polling začasno nedosegljiv.
    }
  }, [enotaId, headers]);

  useEffect(() => {
    void naloziKlice();
    const interval = window.setInterval(() => { void naloziKlice(); }, 5000);
    return () => window.clearInterval(interval);
  }, [naloziKlice]);

  const oznaciObravnavano = async (klic: CtiKlic): Promise<boolean> => {
    if (!enotaId) return false;
    setObravnavamId(klic.id);
    try {
      const response = await fetch(apiUrl(`/api/cti/klici/${klic.id}/obravnavano`), {
        method: "POST",
        credentials: "include",
        headers: headers(),
      });
      if (!response.ok) throw new Error();
      setKlici(current => current.filter(item => item.id !== klic.id));
      return true;
    } catch {
      toast({ title: "CTI klica ni bilo mogoče označiti", description: "Poskusite znova.", variant: "destructive" });
      return false;
    } finally {
      setObravnavamId(null);
    }
  };

  const active = klici[0] ?? null;
  const zacniNarocilo = async () => {
    if (!active || !await oznaciObravnavano(active)) return;
    setInitialTelefon(active.telefon);
    setTelefonDialogOpen(true);
  };

  if (!active && !telefonDialogOpen) return null;

  return (
    <>
      {active && !telefonDialogOpen && (
        <section
          className="fixed right-3 top-3 z-[90] w-[calc(100%-1.5rem)] max-w-md rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-2xl"
          data-testid="cti-dohodni-klic-popup"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-emerald-600 p-2 text-white animate-pulse">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-emerald-950">Dohodni klic</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold text-foreground">
                <UserRound className="h-4 w-4 text-emerald-700" />
                {active.narocnikIme ?? "Neznan naročnik"}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-emerald-900">
                <PhoneCall className="h-4 w-4" />
                <span data-testid="cti-telefon">{active.telefon}</span>
                <span className="text-emerald-700/80">· {formatPrejeto(active.prejeto)}</span>
              </p>
              {klici.length > 1 && <p className="mt-1 text-xs text-emerald-800">Še {klici.length - 1} {klici.length === 2 ? "klic" : "klici"} v čakanju.</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void zacniNarocilo()} disabled={obravnavamId === active.id}>
                  <PhoneCall className="mr-1.5 h-4 w-4" />
                  Začni naročilo
                </Button>
                <Button size="sm" variant="outline" onClick={() => void oznaciObravnavano(active)} disabled={obravnavamId === active.id}>
                  <X className="mr-1.5 h-4 w-4" />
                  Prezri
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
      <TelefonNarociloDialog
        open={telefonDialogOpen}
        initialTelefon={initialTelefon}
        onOpenChange={setTelefonDialogOpen}
        onBlockAutoStart={block}
        onCreated={narocilo => {
          void queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
          setLocation(`/narocilo/${narocilo.id}`);
        }}
      />
    </>
  );
}