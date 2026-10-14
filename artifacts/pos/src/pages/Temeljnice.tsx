import { formatEur } from "@/lib/formatEur";
import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Search, RefreshCw, Download } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { poslovniDatumZaCas } from "@/lib/posCas";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

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
  posArchive?: boolean;
  enotaIme?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nazivTemeljnice(t: Temeljnica): string {
  if (!/:E\d+$/.test(t.reference)) return t.reference;
  const naziv = t.description?.replace(/\s*[—–-]\s*\d{4}-\d{2}(?:-\d{2})?$/, "") || "POS temeljnica";
  return `${naziv} · ${t.enotaIme || "Enota ni več na voljo"}`;
}

function danes(): string {
  return poslovniDatumZaCas();
}

function mesecNazaj(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
}

function datumSlo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function eur(n: number): string {
  return formatEur(n);
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
  const [canTransfer, setCanTransfer] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);

  async function exportPeriod(format: "xlsx" | "csv") {
    if (!od || !do_ || od > do_) {
      toast({ title: "Neveljavno obdobje", description: "Izberite datuma Od in Do; Od mora biti pred ali enak datumu Do.", variant: "destructive" });
      return;
    }
    setExporting(format);
    let url: string | undefined;
    try {
      const params = new URLSearchParams({ od, do: do_, format });
      const blob = await customFetch<Blob>(`/api/temeljnice/izvoz?${params}`, {
        credentials: "include", responseType: "blob",
      });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `temeljnice-${od}-${do_}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast({ title: "Izvoz ni uspel", description: error instanceof Error ? error.message : "Neznana napaka pri izvozu.", variant: "destructive" });
    } finally {
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
      setExporting(null);
    }
  }

  // ── Ročni sync ──────────────────────────────────────────────────────────────
  const [syncDatum, setSyncDatum] = useState<string>(danes);
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    if (!syncDatum) return;
    setSyncing(true);
    try {
      const data = await customFetch<{ created?: string[]; skipped?: Array<{ ref: string; reason: string }> }>(`/api/temeljnice/sync/${syncDatum}`, {
        method: "POST",
        credentials: "include",
      });
      const ustvarjenih = data.created?.length ?? 0;
      const preskocenih = data.skipped?.length ?? 0;

      if (ustvarjenih > 0 && preskocenih === 0) {
        toast({
          title: `Sinhronizirano (${ustvarjenih})`,
          description: `Ustvarjeni osnutki: ${data.created?.join(", ")}`,
        });
      } else if (ustvarjenih > 0 && preskocenih > 0) {
        toast({
          title: `Delno sinhronizirano (${ustvarjenih} ustvarjenih, ${preskocenih} preskočenih)`,
          description: data.skipped?.map(s => `${s.ref}: ${s.reason}`).join("\n"),
          variant: "destructive",
        });
      } else if (preskocenih > 0) {
        toast({
          title: `Temeljnice preskočene (${preskocenih})`,
          description: data.skipped?.map(s => `• ${s.reason}`).join("\n"),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Ni podatkov",
          description: `Za ${syncDatum.split("-").reverse().join(".")} v POS ni računov ali prejemnic.`,
        });
      }
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
    setSelected(new Set());
    try {
      const data = await customFetch<{ temeljnice: Temeljnica[]; canTransfer?: boolean }>(
        `/api/temeljnice?od=${od}&do=${do_}`,
        { credentials: "include" },
      );
      setTemeljnice(data.temeljnice);
      setCanTransfer(data.canTransfer === true);
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [od, do_, toast]);

  async function transferToLedger() {
    setTransferring(true);
    try {
      const result = await customFetch<{ created: string[]; alreadyTransferred: string[] }>("/api/temeljnice/prenos-v-gk", {
        method: "POST", credentials: "include",
        body: JSON.stringify({ ids: [...selected], confirmed: true }),
      });
      toast({ title: "Prenos v GK", description: `Ustvarjenih osnutkov: ${result.created.length}. Že prenesenih: ${result.alreadyTransferred.length}.` });
      setTransferOpen(false);
      await isci();
    } catch (error) {
      toast({ title: "Prenos ni izveden", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    } finally { setTransferring(false); }
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex-1 overflow-auto">
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
        <Button onClick={() => exportPeriod("xlsx")} variant="outline" size="sm" className="gap-1"
          disabled={exporting !== null || !od || !do_ || od > do_}>
          <Download className="w-4 h-4" />
          {exporting === "xlsx" ? "Izvažam…" : "Izvozi Excel"}
        </Button>
        <Button onClick={() => exportPeriod("csv")} variant="outline" size="sm" className="gap-1"
          disabled={exporting !== null || !od || !do_ || od > do_}>
          <Download className="w-4 h-4" />
          {exporting === "csv" ? "Izvažam…" : "Izvozi CSV"}
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
      {temeljnice?.some(t => t.posArchive) && (
        <div className="mb-4 rounded border p-3 text-sm">
          <p>POS temeljnice so ločene od interne glavne knjige. Vklop GK jih ne prenese samodejno.</p>
          {canTransfer && <Button className="mt-2" variant="outline" size="sm"
            disabled={selected.size === 0 || selected.size > 100 || transferring}
            onClick={() => setTransferOpen(true)}>
            Prenesi izbrane POS temeljnice v GK ({selected.size})
          </Button>}
        </div>
      )}
      <Dialog open={transferOpen} onOpenChange={open => { if (!transferring) setTransferOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Potrdi prenos v glavno knjigo</DialogTitle>
            <DialogDescription>
              Izbranih POS temeljnic: {selected.size}. Ustvarjeni bodo osnutki v GK, ne potrjene knjižbe.
              Za vse datume mora biti odprto obdobje GK. Že prenesene temeljnice se ne podvojijo ali prepišejo.
              Izvirniki ostanejo v POS. Prenos se izvede samo s to potrditvijo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={transferring} onClick={() => setTransferOpen(false)}>Prekliči</Button>
            <Button disabled={transferring || selected.size === 0 || selected.size > 100} onClick={transferToLedger}>
              {transferring ? "Prenašam…" : "Potrdi prenos v GK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!loading && temeljnice && temeljnice.length > 0 && (
        <div className="space-y-1.5">
          {temeljnice.map(t => {
            const odprta = expanded.has(t.id);
            return (
              <div key={t.id} className="border rounded-md overflow-hidden bg-white">
                {canTransfer && t.posArchive && (
                  <label className="flex items-center gap-2 px-3 pt-2 text-xs">
                    <Checkbox aria-label={`Izberi za prenos: ${nazivTemeljnice(t)}`} checked={selected.has(t.id)} disabled={transferring}
                      onCheckedChange={checked => setSelected(prev => {
                        const next = new Set(prev);
                        if (checked === true) next.add(t.id); else next.delete(t.id);
                        return next;
                      })} />
                    Izberi POS temeljnico za prenos v GK
                  </label>
                )}
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
                  <span className="text-sm font-medium flex-1 truncate">
                    {nazivTemeljnice(t)}
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
