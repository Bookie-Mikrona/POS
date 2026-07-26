import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FlaskConical, CalendarDays, Trash2, Loader2, CheckCircle2,
  AlertTriangle, RefreshCw, Shuffle, Info, ChevronRight,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDatum(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface SimState { active: boolean; datum: string | null }
interface ZacetnaPostavka { artikelId: number; artikelIme: string; kolicina: number; cenaKos: number }

// ── component ─────────────────────────────────────────────────────────────────

export default function Simulacija() {
  const [sim, setSim] = useState<SimState>({ active: false, datum: null });
  const [novDatum, setNovDatum] = useState(todayIso());
  const [loadingSim, setLoadingSim] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [loadingZaloge, setLoadingZaloge] = useState(false);
  const [resetPotrjeno, setResetPotrjeno] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [genResult, setGenResult] = useState<ZacetnaPostavka[] | null>(null);

  const fetchSim = useCallback(async () => {
    try {
      const d = await customFetch<SimState>("/api/sim");
      setSim(d);
      if (d.datum) setNovDatum(d.datum);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSim(); }, [fetchSim]);

  function status(type: "ok" | "err", text: string) {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 6000);
  }

  // ── Set sim datum ───────────────────────────────────────────────────────────
  async function handleSetDatum() {
    setLoadingSim(true);
    try {
      const r = await customFetch<{ datum: string; izmeneZaprte: number }>("/api/sim/datum", {
        method: "POST",
        body: JSON.stringify({ datum: novDatum }),
        headers: { "Content-Type": "application/json" },
      });
      setSim({ active: true, datum: r.datum });
      setGenResult(null);
      const msg = r.izmeneZaprte > 0
        ? `Datum nastavljen. Samodejno zaprto ${r.izmeneZaprte} izmena/izmene (zaključek dneva).`
        : "Simulacijski datum nastavljen.";
      status("ok", msg);
    } catch (e: any) {
      status("err", e?.data?.error ?? e?.message ?? "Napaka pri nastavljanju datuma");
    } finally {
      setLoadingSim(false);
    }
  }

  // ── Clear sim datum ─────────────────────────────────────────────────────────
  async function handleClearDatum() {
    setLoadingSim(true);
    try {
      await customFetch("/api/sim/datum", { method: "DELETE" });
      setSim({ active: false, datum: null });
      setNovDatum(todayIso());
      status("ok", "Simulacijski datum odstranjen. Sistem uporablja pravi čas.");
    } catch (e: any) {
      status("err", e?.data?.error ?? e?.message ?? "Napaka");
    } finally {
      setLoadingSim(false);
    }
  }

  // ── Reset all data ──────────────────────────────────────────────────────────
  async function handleReset() {
    setLoadingReset(true);
    setGenResult(null);
    try {
      await customFetch("/api/sim/reset", { method: "POST" });
      status("ok", "Vsi prometi so bili pobrisani. Baza je prazna.");
      setResetPotrjeno(false);
    } catch (e: any) {
      status("err", e?.data?.error ?? e?.message ?? "Napaka pri brisanju");
    } finally {
      setLoadingReset(false);
    }
  }

  // ── Generate random začetne zaloge ──────────────────────────────────────────
  async function handleGenZaloge() {
    if (!sim.datum) { status("err", "Najprej nastavite simulacijski datum."); return; }
    setLoadingZaloge(true);
    const letoInt = parseInt(sim.datum.slice(0, 4));
    try {
      const r = await customFetch<{ id: number; stevilka: string; postavke: ZacetnaPostavka[] }>(
        "/api/sim/zacetne-zaloge",
        {
          method: "POST",
          body: JSON.stringify({ datum: sim.datum, leto: letoInt }),
          headers: { "Content-Type": "application/json" },
        }
      );
      setGenResult(r.postavke);
      status("ok", `Generirane začetne zaloge za ${r.postavke.length} artiklov (leto ${letoInt}).`);
    } catch (e: any) {
      status("err", e?.data?.error ?? e?.message ?? "Napaka pri generiranju");
    } finally {
      setLoadingZaloge(false);
    }
  }

  const minDatum = sim.datum ?? "2000-01-01";

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical className="w-7 h-7 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold">Simulacijski način</h1>
          <p className="text-sm text-muted-foreground">
            Preizkusite delovanje POS z navideznim datumom in svežimi podatki.
          </p>
        </div>
        {sim.active && (
          <Badge className="ml-auto bg-purple-600 text-white shrink-0">
            {fmtDatum(sim.datum!)}
          </Badge>
        )}
      </div>

      {/* Status message */}
      {statusMsg && (
        <Alert className={statusMsg.type === "ok"
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-800"}>
          {statusMsg.type === "ok"
            ? <CheckCircle2 className="h-4 w-4" />
            : <AlertTriangle className="h-4 w-4" />}
          <AlertDescription>{statusMsg.text}</AlertDescription>
        </Alert>
      )}

      {/* ── KORAK 1: Počisti podatke ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold">1</span>
            <CardTitle className="text-base">Počisti vse promete</CardTitle>
          </div>
          <CardDescription>
            Pobriše vsa naročila, račune, izmene, prejemnice, izdajnice, inventure in začetne zaloge.
            Artikli, ceniki in nastavitve ostanejo nedotaknjeni.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
            <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Kar bo zbrisano:</p>
            <ul className="ml-5 list-disc space-y-0.5 text-amber-700">
              <li>Vsa naročila in računi (z FURS ZOI/EOR zapisi)</li>
              <li>Vse izmene (izmene natakarjev)</li>
              <li>Vse prejemnice, izdajnice in inventure</li>
              <li>Vse začetne zaloge in stanja zalog (ponastavljeno na 0)</li>
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="reset-potrdi"
              checked={resetPotrjeno}
              onCheckedChange={v => setResetPotrjeno(v === true)}
            />
            <Label htmlFor="reset-potrdi" className="text-sm cursor-pointer">
              Potrjujem, da bodo vsi podatki o prometih nepovratno izbrisani.
            </Label>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="destructive"
            disabled={!resetPotrjeno || loadingReset}
            onClick={handleReset}
            className="gap-2"
          >
            {loadingReset ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Pobriši vse promete
          </Button>
        </CardFooter>
      </Card>

      {/* ── KORAK 2: Simulacijski datum ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold">2</span>
            <CardTitle className="text-base">Simulacijski datum</CardTitle>
          </div>
          <CardDescription>
            Nastavi datum, ki velja za vsa nova naročila in račune namesto današnjega.
            Ko spremenite datum, se samodejno zapro odprte izmene (zaključek dneva).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sim.active && (
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4 text-purple-600" />
              <span className="font-medium">Trenutni datum:</span>
              <Badge variant="outline" className="border-purple-300 text-purple-700">
                {fmtDatum(sim.datum!)}
              </Badge>
            </div>
          )}
          {!sim.active && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="w-4 h-4" />
              Ni aktiven — sistem uporablja pravi datum in čas.
            </div>
          )}
          <Separator />
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label htmlFor="sim-datum" className="text-sm font-medium">
                {sim.active ? "Nov datum (mora biti ≥ trenutnega)" : "Začetni datum simulacije"}
              </Label>
              <input
                id="sim-datum"
                type="date"
                value={novDatum}
                min={minDatum}
                onChange={e => setNovDatum(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button
              disabled={loadingSim || !novDatum || novDatum < minDatum}
              onClick={handleSetDatum}
              className="gap-2 bg-purple-600 hover:bg-purple-700"
            >
              {loadingSim ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
              {sim.active ? "Prestavi datum" : "Aktiviraj simulacijo"}
            </Button>
            {sim.active && (
              <Button variant="outline" disabled={loadingSim} onClick={handleClearDatum} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Deaktiviraj
              </Button>
            )}
          </div>
          {sim.active && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ChevronRight className="w-3 h-3" />
              Nov datum mora biti večji ali enak {fmtDatum(sim.datum!)} — ni mogoče iti nazaj v preteklost.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── KORAK 3: Začetne zaloge ── */}
      <Card className={!sim.active ? "opacity-60" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold">3</span>
            <CardTitle className="text-base">Naključne začetne zaloge</CardTitle>
          </div>
          <CardDescription>
            Samodejno generira začetne zaloge za vse nabavne artikle z naključnimi
            količinami (10–100) in cenami (0,50–30,00 €). Leto prevzame iz simulacijskega datuma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!sim.active && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Info className="w-4 h-4" />
              Najprej nastavite simulacijski datum (korak 2).
            </p>
          )}
          {sim.active && (
            <p className="text-sm text-muted-foreground">
              Generirane zaloge za leto <strong>{sim.datum?.slice(0, 4)}</strong>,
              datum dokumenta: <strong>{fmtDatum(sim.datum!)}</strong>.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col items-start gap-3">
          <Button
            disabled={!sim.active || loadingZaloge}
            onClick={handleGenZaloge}
            className="gap-2"
            variant="outline"
          >
            {loadingZaloge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
            Generiraj naključne začetne zaloge
          </Button>

          {genResult && genResult.length > 0 && (
            <div className="w-full rounded-md border">
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
                Generirani artikli ({genResult.length})
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-3 py-1.5 font-medium">Artikel</th>
                      <th className="text-right px-3 py-1.5 font-medium">Kol.</th>
                      <th className="text-right px-3 py-1.5 font-medium">Cena/en.</th>
                      <th className="text-right px-3 py-1.5 font-medium">Vrednost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genResult.map(p => (
                      <tr key={p.artikelId} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{p.artikelIme}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.kolicina}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {p.cenaKos.toFixed(2)} €
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {(p.kolicina * p.cenaKos).toFixed(2)} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20">
                      <td className="px-3 py-1.5 font-medium" colSpan={3}>Skupaj</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold">
                        {genResult.reduce((s, p) => s + p.kolicina * p.cenaKos, 0).toFixed(2)} €
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1 pb-4">
        <p className="flex items-center gap-1"><Info className="w-3 h-3" /> Simulacijski datum velja za datum računa (FURS) in datum naročila.</p>
        <p className="flex items-center gap-1"><Info className="w-3 h-3" /> Datum prejemnic, inventur in izdajnic vnesete ročno v vsakem dokumentu.</p>
        <p className="flex items-center gap-1"><Info className="w-3 h-3" /> Simulacijski datum velja samo za to poslovno enoto.</p>
      </div>
    </div>
  );
}
