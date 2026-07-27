import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getEnotaId } from "@workspace/api-client-react";
import {
  Download, Search, Banknote, CreditCard, Gift, Smartphone,
  Landmark, Users, Package, Receipt, TrendingUp, FileText,
} from "lucide-react";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface PrometObdobjaData {
  skupajPromet: number;
  steviloRacunov: number;
  skupajDDV: number;
  prometPoNacinuPlacila: {
    gotovina: number; kartica: number; bon: number; sumup: number;
    bonPica: number; steviloBonov: number; negotovinsko: number;
    reprezentanca: number; lastna_poraba: number;
  };
  prometPoBlagajnah: {
    blagajnaKoda: string; skupaj: number; steviloRacunov: number;
    odZap: string | null; doZap: string | null;
  }[];
  prometPoNatakarjih: {
    natakarIme: string; skupaj: number; gotovina: number; kartica: number;
    sumup: number; bon: number; bonPica: number; steviloBonov: number; steviloRacunov: number;
  }[];
  ddvPoStopnjah: { stopnja: number; ddvZnesek: number; osnova: number }[];
  prihodkiPoVrsti: { storitve: number; blago: number; material: number };
  izdaniKuponi: number;
  prejetiKuponi: number;
  odZap: string | null;
  doZap: string | null;
  podjetje: { naziv: string; naslov: string; davcnaStevilka: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LJ = "Europe/Ljubljana";

function danes(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: LJ });
}

function fmt(n: number): string {
  return n.toFixed(2) + " €";
}

function datumSlo(iso: string): string {
  // iso je YYYY-MM-DD
  const [y, m, d] = iso.split("-");
  return `${d ?? ""}.${m ?? ""}.${y ?? ""}`;
}

const NACINI = [
  { kljuc: "gotovina",      ime: "Gotovina",       ikona: <Banknote className="h-4 w-4 text-green-600" /> },
  { kljuc: "kartica",       ime: "Kartica",         ikona: <CreditCard className="h-4 w-4 text-blue-600" /> },
  { kljuc: "sumup",         ime: "SumUp kartica",   ikona: <Smartphone className="h-4 w-4 text-purple-600" /> },
  { kljuc: "bon",           ime: "Bon",             ikona: <Gift className="h-4 w-4 text-orange-500" /> },
  { kljuc: "bonPica",       ime: "Bon za pico",     ikona: <Gift className="h-4 w-4 text-red-500" /> },
  { kljuc: "negotovinsko",  ime: "Negotovinsko",    ikona: <Landmark className="h-4 w-4 text-sky-600" /> },
  { kljuc: "reprezentanca", ime: "Reprezentanca",   ikona: <Users className="h-4 w-4 text-yellow-500" />, navidezni: true },
  { kljuc: "lastna_poraba", ime: "Lastna poraba",   ikona: <Package className="h-4 w-4 text-slate-500" />, navidezni: true },
];

// ── CSV izvoz ─────────────────────────────────────────────────────────────────

function genCsv(datum: string, data: PrometObdobjaData): string {
  const rows: string[][] = [];
  const row = (...cells: (string | number)[]) => rows.push(cells.map(c => `"${String(c).replace(/"/g, '""')}"`));

  row("DNEVNI IZKAZ", datumSlo(datum));
  row("Podjetje", data.podjetje.naziv);
  if (data.podjetje.davcnaStevilka) row("DDV ID", "SI" + data.podjetje.davcnaStevilka);
  rows.push([]);

  row("SKUPNI PROMET");
  row("Promet z DDV (€)", data.skupajPromet.toFixed(2));
  row("DDV skupaj (€)", data.skupajDDV.toFixed(2));
  row("Osnova skupaj (€)", (data.skupajPromet - data.skupajDDV).toFixed(2));
  row("Število računov", data.steviloRacunov);
  if (data.odZap || data.doZap) row("Zaporedne številke", `${data.odZap ?? "—"} – ${data.doZap ?? "—"}`);
  rows.push([]);

  row("NAČINI PLAČILA");
  row("Način", "Znesek (€)");
  const pl = data.prometPoNacinuPlacila as unknown as Record<string, number>;
  for (const n of NACINI) {
    const z = pl[n.kljuc] ?? 0;
    if (z !== 0) row(n.ime + (n.navidezni ? " (navidezni)" : ""), z.toFixed(2));
  }
  rows.push([]);

  row("DDV PO STOPNJAH");
  row("Stopnja (%)", "Osnova (€)", "DDV (€)");
  for (const d of data.ddvPoStopnjah) {
    row(d.stopnja.toFixed(0) + " %", d.osnova.toFixed(2), d.ddvZnesek.toFixed(2));
  }
  rows.push([]);

  row("PRIHODKI PO VRSTI (brez DDV)");
  row("Blago (€)", data.prihodkiPoVrsti.blago.toFixed(2));
  row("Storitve (€)", data.prihodkiPoVrsti.storitve.toFixed(2));
  row("Material (€)", data.prihodkiPoVrsti.material.toFixed(2));
  rows.push([]);

  if (data.prometPoNatakarjih.length > 0) {
    row("PO NATAKARJIH");
    row("Natakar", "Skupaj (€)", "Gotovina (€)", "Kartica (€)", "SumUp (€)", "Bon (€)", "Bon pica (€)", "Negot. (€)", "Računov");
    for (const n of data.prometPoNatakarjih) {
      row(n.natakarIme, n.skupaj.toFixed(2), n.gotovina.toFixed(2), n.kartica.toFixed(2), n.sumup.toFixed(2), n.bon.toFixed(2), n.bonPica.toFixed(2), "0.00", n.steviloRacunov);
    }
    rows.push([]);
  }

  if (data.prometPoBlagajnah.length > 0) {
    row("PO BLAGAJNAH");
    row("Blagajna", "Skupaj (€)", "Računov", "Od zap.", "Do zap.");
    for (const b of data.prometPoBlagajnah) {
      row(b.blagajnaKoda, b.skupaj.toFixed(2), b.steviloRacunov, b.odZap ?? "", b.doZap ?? "");
    }
  }

  return rows.map(r => r.join(";")).join("\r\n");
}

function izvoziCsv(datum: string, data: PrometObdobjaData) {
  const csv = genCsv(datum, data);
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `izkaz_${datum}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Komponenta ────────────────────────────────────────────────────────────────

export default function DnevniIzkaz() {
  const [datum, setDatum] = useState<string>(danes());
  const [data, setData] = useState<PrometObdobjaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);
  const { toast } = useToast();

  const poisci = useCallback(async (d: string) => {
    if (!d) return;
    setLoading(true);
    setNapaka(null);
    setData(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const enotaId = getEnotaId();
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (enotaId) headers["X-Enota-Id"] = String(enotaId);
      const r = await fetch(`${base}/api/statistike/promet-obdobja?od=${d}&do=${d}`, {
        credentials: "include",
        headers,
      });
      if (!r.ok) throw new Error(`Napaka ${r.status}`);
      const json = (await r.json()) as PrometObdobjaData;
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Neznana napaka";
      setNapaka(msg);
      toast({ title: "Napaka pri nalaganju", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Naloži ob prvem renderu
  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    setInitialized(true);
    void poisci(datum);
  }

  const placila = data?.prometPoNacinuPlacila as unknown as Record<string, number> | undefined;
  const skupajPlacila = placila
    ? NACINI.filter(n => !n.navidezni).reduce((acc, n) => acc + (placila[n.kljuc] ?? 0), 0)
    : 0;
  const osnova = data ? data.skupajPromet - data.skupajDDV : 0;

  return (
    <div className="p-6 md:p-8 space-y-6 flex-1 overflow-auto">
      {/* Glava */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Dnevni izkaz
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">{data.podjetje.naziv}</p>
          )}
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <div>
            <Label htmlFor="datum-izkaz" className="text-xs text-muted-foreground mb-1 block">Datum</Label>
            <Input
              id="datum-izkaz"
              type="date"
              value={datum}
              max={danes()}
              onChange={e => setDatum(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void poisci(datum); }}
              className="w-44"
            />
          </div>
          <Button onClick={() => void poisci(datum)} disabled={loading}>
            <Search className="h-4 w-4 mr-1.5" />
            Prikaži
          </Button>
          {data && (
            <Button variant="outline" onClick={() => izvoziCsv(datum, data)}>
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {/* Stanje */}
      {loading && <Skeleton className="h-[400px] w-full rounded-xl" />}
      {napaka && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">{napaka}</div>
      )}

      {data && !loading && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Skupaj promet
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold tabular-nums">{fmt(data.skupajPromet)}</div>
                <p className="text-xs text-muted-foreground mt-0.5">z DDV</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5" /> Izdani računi
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold tabular-nums">{data.steviloRacunov}</div>
                {(data.odZap || data.doZap) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data.odZap ?? "—"} – {data.doZap ?? "—"}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Osnova (brez DDV)</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold tabular-nums">{fmt(osnova)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Obračunan DDV</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold tabular-nums">{fmt(data.skupajDDV)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Načini plačila */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-blue-500" />
                  Načini plačila
                </CardTitle>
              </CardHeader>
              <CardContent>
                {skupajPlacila === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Ni računov za ta datum.</p>
                ) : (
                  <div className="space-y-1">
                    {NACINI.filter(n => !n.navidezni).map(n => {
                      const z = placila?.[n.kljuc] ?? 0;
                      if (z === 0) return null;
                      const pct = skupajPlacila > 0 ? (z / skupajPlacila) * 100 : 0;
                      return (
                        <div key={n.kljuc} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                          <span className="flex-shrink-0">{n.ikona}</span>
                          <span className="flex-1 text-sm font-medium">{n.ime}</span>
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
                          <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(z)}</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-3 rounded-lg px-3 py-2 border-t mt-1 pt-3">
                      <span className="flex-shrink-0 w-4" />
                      <span className="flex-1 text-sm font-semibold text-muted-foreground">Skupaj</span>
                      <span className="text-xs text-muted-foreground w-10 text-right">100%</span>
                      <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(skupajPlacila)}</span>
                    </div>
                    {/* Navidezni promet */}
                    {NACINI.filter(n => n.navidezni && (placila?.[n.kljuc] ?? 0) > 0).length > 0 && (
                      <>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-3 pt-3 pb-1 font-semibold">
                          Navidezni promet (ni vključen v skupaj)
                        </p>
                        {NACINI.filter(n => n.navidezni).map(n => {
                          const z = placila?.[n.kljuc] ?? 0;
                          if (z === 0) return null;
                          return (
                            <div key={n.kljuc} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors opacity-70">
                              <span className="flex-shrink-0">{n.ikona}</span>
                              <span className="flex-1 text-sm font-medium">{n.ime}</span>
                              <span className="text-xs text-muted-foreground w-10 text-right">—</span>
                              <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(z)}</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                    {(placila?.["steviloBonov"] ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground px-3 pt-2">
                        Boni za pico: {placila!["steviloBonov"]} × 10,00 € = {fmt(placila?.["bonPica"] ?? 0)}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* DDV razrez */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">DDV po stopnjah</CardTitle>
              </CardHeader>
              <CardContent>
                {data.ddvPoStopnjah.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Ni podatkov.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left pb-2 font-medium">Stopnja</th>
                        <th className="text-right pb-2 font-medium">Osnova</th>
                        <th className="text-right pb-2 font-medium">DDV</th>
                        <th className="text-right pb-2 font-medium">Skupaj</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {data.ddvPoStopnjah.map(d => (
                        <tr key={d.stopnja} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2 font-medium">{d.stopnja.toFixed(0)} %</td>
                          <td className="py-2 text-right tabular-nums">{fmt(d.osnova)}</td>
                          <td className="py-2 text-right tabular-nums">{fmt(d.ddvZnesek)}</td>
                          <td className="py-2 text-right tabular-nums font-semibold">{fmt(d.osnova + d.ddvZnesek)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-semibold">
                        <td className="pt-2">Skupaj</td>
                        <td className="pt-2 text-right tabular-nums">{fmt(data.ddvPoStopnjah.reduce((a, d) => a + d.osnova, 0))}</td>
                        <td className="pt-2 text-right tabular-nums">{fmt(data.ddvPoStopnjah.reduce((a, d) => a + d.ddvZnesek, 0))}</td>
                        <td className="pt-2 text-right tabular-nums">{fmt(data.skupajPromet)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Prihodki po vrsti */}
          {(data.prihodkiPoVrsti.blago + data.prihodkiPoVrsti.storitve + data.prihodkiPoVrsti.material) > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Prihodki po vrsti (brez DDV)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { ime: "Blago", z: data.prihodkiPoVrsti.blago },
                    { ime: "Storitve", z: data.prihodkiPoVrsti.storitve },
                    { ime: "Material", z: data.prihodkiPoVrsti.material },
                  ].filter(v => v.z > 0).map(v => (
                    <div key={v.ime} className="rounded-lg bg-muted/40 px-4 py-3 text-center">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{v.ime}</div>
                      <div className="font-bold tabular-nums">{fmt(v.z)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Natakari */}
          {data.prometPoNatakarjih.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Po natakarjih</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left pb-2 font-medium">Natakar</th>
                      <th className="text-right pb-2 font-medium">Skupaj</th>
                      <th className="text-right pb-2 font-medium">Gotovina</th>
                      <th className="text-right pb-2 font-medium">Kartica</th>
                      <th className="text-right pb-2 font-medium">Bon</th>
                      <th className="text-right pb-2 font-medium">Računov</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.prometPoNatakarjih.map(n => (
                      <tr key={n.natakarIme} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2 font-medium">{n.natakarIme}</td>
                        <td className="py-2 text-right tabular-nums font-semibold">{fmt(n.skupaj)}</td>
                        <td className="py-2 text-right tabular-nums">{n.gotovina > 0 ? fmt(n.gotovina) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{(n.kartica + n.sumup) > 0 ? fmt(n.kartica + n.sumup) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{n.bon > 0 ? fmt(n.bon) : "—"}</td>
                        <td className="py-2 text-right">{n.steviloRacunov}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Blagajne */}
          {data.prometPoBlagajnah.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Po blagajnah</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left pb-2 font-medium">Blagajna</th>
                      <th className="text-right pb-2 font-medium">Skupaj</th>
                      <th className="text-right pb-2 font-medium">Računov</th>
                      <th className="text-right pb-2 font-medium">Zap. številke</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.prometPoBlagajnah.map(b => (
                      <tr key={b.blagajnaKoda} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2 font-mono text-xs">{b.blagajnaKoda}</td>
                        <td className="py-2 text-right tabular-nums font-semibold">{fmt(b.skupaj)}</td>
                        <td className="py-2 text-right">{b.steviloRacunov}</td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {b.odZap ?? "—"} – {b.doZap ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Kuponi */}
          {(data.izdaniKuponi > 0 || data.prejetiKuponi > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Gift className="h-4 w-4 text-orange-500" />
                  Kuponi
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-8">
                  {data.prejetiKuponi > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground">Prejeti (unovčeni)</div>
                      <div className="font-bold tabular-nums">{fmt(data.prejetiKuponi)}</div>
                    </div>
                  )}
                  {data.izdaniKuponi > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground">Izdani</div>
                      <div className="font-bold tabular-nums">{fmt(data.izdaniKuponi)}</div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Prazno */}
          {data.steviloRacunov === 0 && (
            <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
              <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Za {datumSlo(datum)} ni evidentirani računov.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
