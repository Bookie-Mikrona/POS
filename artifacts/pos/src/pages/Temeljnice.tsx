import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Search, RefreshCw } from "lucide-react";
import { getEnotaId } from "@workspace/api-client-react";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface Vrstica {
  kontoKoda: string;
  kontoIme: string;
  stran: "debit" | "credit";
  znesek: number;
  opis: string | null;
}

interface Temeljnica {
  id: string;
  entryDate: string;
  reference: string;
  description: string | null;
  status: "draft" | "posted" | "reversed";
  postedAt: string | null;
  skupajDebet: number;
  vrstice: Vrstica[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LJ = "Europe/Ljubljana";

function danes(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: LJ });
}

function mesecNazaj(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("sv-SE", { timeZone: LJ });
}

function datumSlo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function eur(n: number): string {
  return n.toFixed(2) + " €";
}

function statusBadge(status: string) {
  if (status === "posted")
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-[11px] px-1.5 py-0">potrjena</Badge>;
  if (status === "reversed")
    return <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[11px] px-1.5 py-0">storno</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[11px] px-1.5 py-0">osnutek</Badge>;
}

// ── Komponenta ────────────────────────────────────────────────────────────────

export default function Temeljnice() {
  const [od, setOd] = useState<string>(mesecNazaj);
  const [do_, setDo] = useState<string>(danes);
  const [temeljnice, setTemeljnice] = useState<Temeljnica[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // ── Ročni sync ──────────────────────────────────────────────────────────────
  const [syncDatum, setSyncDatum] = useState<string>(danes);
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    if (!syncDatum) return;
    setSyncing(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const enotaId = getEnotaId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (enotaId) headers["X-Enota-Id"] = String(enotaId);
      const res = await fetch(`${base}/api/temeljnice/sync/${syncDatum}`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      const data = await res.json() as { created?: string[]; skipped?: Array<{ ref: string; reason: string }> };
      if (!res.ok) throw new Error((data as any).error ?? "Napaka");
      const ustvarjenih = data.created?.length ?? 0;
      toast({
        title: ustvarjenih > 0 ? `Sinhronizirano (${ustvarjenih})` : "Ni sprememb",
        description: ustvarjenih > 0
          ? `Ustvarjeni osnutki: ${data.created?.join(", ")}`
          : `Za ${syncDatum} ni bilo nič za sinhronizirati.`,
      });
      // Osveži seznam če je datum v filtriranem razponu
      if (syncDatum >= od && syncDatum <= do_) await isci();
    } catch (e: any) {
      toast({ title: "Napaka pri sinhronizaciji", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [syncDatum, od, do_, toast]);

  const isci = useCallback(async () => {
    if (!od || !do_) return;
    setLoading(true);
    setTemeljnice(null);
    setExpanded(new Set());
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const enotaId = getEnotaId();
      const headers: Record<string, string> = {};
      if (enotaId) headers["X-Enota-Id"] = String(enotaId);
      const res = await fetch(
        `${base}/api/temeljnice?od=${od}&do=${do_}`,
        { headers, credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Napaka pri nalaganju");
      }
      const data = await res.json() as { temeljnice: Temeljnica[] };
      setTemeljnice(data.temeljnice);
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [od, do_, toast]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Temeljnice</h1>

      {/* Filter */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Od</Label>
          <Input
            type="date"
            value={od}
            onChange={e => setOd(e.target.value)}
            className="w-38 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Do</Label>
          <Input
            type="date"
            value={do_}
            onChange={e => setDo(e.target.value)}
            className="w-38 text-sm"
          />
        </div>
        <Button onClick={isci} disabled={loading} size="sm" className="gap-1">
          <Search className="w-4 h-4" />
          Pokaži
        </Button>
      </div>

      {/* Ročni sync */}
      <div className="flex flex-wrap gap-3 items-end mb-5 p-3 bg-muted/40 rounded-lg border border-dashed">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground mb-0.5">Ročna sinhronizacija</p>
          <p className="text-xs text-muted-foreground">Ustvari ali osveži temeljnice za izbrani dan (npr. za manjkajoče dni).</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Datum</Label>
            <Input
              type="date"
              value={syncDatum}
              onChange={e => setSyncDatum(e.target.value)}
              className="w-38 text-sm"
            />
          </div>
          <Button onClick={handleSync} disabled={syncing} size="sm" variant="outline" className="gap-1">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sinhroniziram…" : "Sinhroniziraj"}
          </Button>
        </div>
      </div>

      {/* Skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
        </div>
      )}

      {/* Prazno */}
      {!loading && temeljnice !== null && temeljnice.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-10">
          V izbranem obdobju ni nobene temeljnice.
        </p>
      )}

      {/* Seznam */}
      {!loading && temeljnice && temeljnice.length > 0 && (
        <div className="space-y-1.5">
          {temeljnice.map(t => {
            const odprta = expanded.has(t.id);
            return (
              <div key={t.id} className="border rounded-md overflow-hidden bg-white">
                {/* Glava */}
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => toggle(t.id)}
                >
                  {odprta
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground w-20 shrink-0">
                    {datumSlo(t.entryDate)}
                  </span>
                  <span className="font-mono text-sm font-medium flex-1 truncate">
                    {t.reference}
                  </span>
                  <span className="text-sm tabular-nums text-right w-24 shrink-0">
                    {eur(t.skupajDebet)}
                  </span>
                  <span className="ml-2 shrink-0">{statusBadge(t.status)}</span>
                </button>

                {/* Opis */}
                {odprta && t.description && (
                  <div className="px-9 pb-1 text-xs text-muted-foreground italic">
                    {t.description}
                  </div>
                )}

                {/* Vrstice */}
                {odprta && (
                  <div className="border-t bg-gray-50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left px-9 py-1 font-medium">Konto</th>
                          <th className="text-right px-3 py-1 font-medium w-24">Debet</th>
                          <th className="text-right px-3 py-1 font-medium w-24">Kredit</th>
                          <th className="text-left px-3 py-1 font-medium hidden sm:table-cell">Opis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.vrstice.map((v, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-white/60">
                            <td className="px-9 py-1 font-mono">
                              <span className="font-semibold">{v.kontoKoda}</span>
                              <span className="text-muted-foreground ml-1.5">{v.kontoIme}</span>
                            </td>
                            <td className="text-right px-3 py-1 tabular-nums">
                              {v.stran === "debit" ? eur(v.znesek) : ""}
                            </td>
                            <td className="text-right px-3 py-1 tabular-nums">
                              {v.stran === "credit" ? eur(v.znesek) : ""}
                            </td>
                            <td className="px-3 py-1 text-muted-foreground hidden sm:table-cell truncate max-w-[160px]">
                              {v.opis ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-semibold">
                          <td className="px-9 py-1 text-muted-foreground">Skupaj</td>
                          <td className="text-right px-3 py-1 tabular-nums">{eur(t.skupajDebet)}</td>
                          <td className="text-right px-3 py-1 tabular-nums">{eur(t.skupajDebet)}</td>
                          <td className="hidden sm:table-cell" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
