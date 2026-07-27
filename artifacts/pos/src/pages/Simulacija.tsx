import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  FlaskConical, CalendarDays, Trash2, Loader2, CheckCircle2,
  AlertTriangle, RefreshCw, Shuffle, Info, ChevronRight,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDatum(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

/** ISO (2026-01-02) → evropski (02.01.2026) */
function toEuro(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Evropski (02.01.2026 ali 2.1.2026) → ISO (2026-01-02); "" če neveljaven */
function toIso(euro: string): string {
  const m = euro.replace(/\s/g, "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function todayEuro() {
  return toEuro(new Date().toISOString().slice(0, 10));
}

interface SimState { active: boolean; datum: string | null }
interface ZacetnaPostavka { artikelId: number; artikelIme: string; kolicina: number; cenaKos: number }

// ── component ─────────────────────────────────────────────────────────────────

export default function Simulacija() {
  const [sim, setSim] = useState<SimState>({ active: false, datum: null });
  const [novDatum, setNovDatum] = useState(todayEuro());
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
      if (d.datum) setNovDatum(toEuro(d.datum));
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
      const iso = toIso(novDatum);
      if (!iso) { status("err", "Neveljaven datum. Uporabite obliko DD.MM.LLLL."); setLoadingSim(false); return; }
      const r = await customFetch<{ datum: string; izmeneZaprte: number }>("/api/sim/datum", {
        method: "POST",
        body: JSON.stringify({ datum: iso }),
        headers: { "Content-Type": "application/json" },
      });
      setSim({ active: true, datum: r.datum });
      setNovDatum(toEuro(r.datum));
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
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6 overflow-y-auto h-full">

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
        <div className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
          statusMsg.type === "ok"
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {statusMsg.type === "ok"
            ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
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
        <CardContent>
          {sim.active && (
            <div className="flex items-center gap-2 text-sm mb-4">
              <CalendarDays className="w-4 h-4 text-purple-600" />
              <span className="font-medium">Trenutni datum:</span>
              <Badge variant="outline" className="border-purple-300 text-purple-700">
                {fmtDatum(sim.datum!)}
              </Badge>
            </div>
          )}
          {!sim.active && (
            <p className="text-sm text-gray-500 mb-4">
              Ni aktiven — sistem uporablja pravi datum in čas.
            </p>
          )}
          <div className="mb-2">
            <label htmlFor="sim-datum" className="block text-sm font-medium mb-1">
              {sim.active ? "Nov datum (mora biti ≥ trenutnega)" : "Začetni datum simulacije"}
            </label>
            <input
              id="sim-datum"
              type="text"
              placeholder="DD.MM.LLLL"
              value={novDatum}
              onChange={e => setNovDatum(e.target.value)}
              style={{
                display: "block",
                width: "180px",
                padding: "6px 12px",
                fontSize: "14px",
                fontFamily: "monospace",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                color: "#111827",
                backgroundColor: "#ffffff",
                outline: "none",
              }}
            />
          </div>
          <div className="flex gap-2 flex-wrap mt-3">
            <Button
              disabled={loadingSim || !toIso(novDatum) || toIso(novDatum) < (sim.datum ?? "2000-01-01")}
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
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-3">
              <ChevronRight className="w-3 h-3" />
              Nov datum mora biti večji ali enak {fmtDatum(sim.datum!)}.
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
