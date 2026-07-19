import { useState, useMemo } from "react";
import {
  useListKategorije,
  useListArtikli,
  useListDnevniMeni,
  useSetDnevniMeniArtikel,
  useKopirajTeden,
  getListDnevniMeniQueryKey,
  type ModSkupinaFull,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Copy, CalendarDays, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

const DNI = ["Ponedeljek", "Torek", "Sreda", "Četrtek", "Petek", "Sobota", "Nedelja"];

function ponedeljakTedna(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateSlo(d: Date): string {
  return d.toLocaleDateString("sl-SI", { day: "numeric", month: "short" });
}

type ArtWithMod = {
  id: number;
  ime: string;
  modSkupine: ModSkupinaFull[];
};

export default function DnevniMeni() {
  const { user } = useAuth();
  const jeAdmin = user?.vloga === "admin_enote" || user?.vloga === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tedenStart, setTedenStart] = useState<Date>(() => ponedeljakTedna(new Date()));

  const tedenDatumi = useMemo<Date[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(tedenStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [tedenStart]);

  const odStr = formatDate(tedenDatumi[0]);
  const doStr = formatDate(tedenDatumi[6]);

  const { data: kategorije } = useListKategorije();
  const { data: artikli } = useListArtikli();
  const { data: dnevniMeniData, isLoading: loadingMeni } = useListDnevniMeni({ od: odStr, do: doStr });

  const setDnevniMeniArtikel = useSetDnevniMeniArtikel();
  const kopirajTeden = useKopirajTeden();

  const filtriranjeKatIds = useMemo(() => {
    if (!kategorije) return new Set<number>();
    return new Set(
      (kategorije as (typeof kategorije[number] & { dnevnoFiltriranje?: boolean })[])
        .filter(k => k.dnevnoFiltriranje)
        .map(k => k.id)
    );
  }, [kategorije]);

  const artiFiltrirani = useMemo<ArtWithMod[]>(() => {
    if (!artikli || filtriranjeKatIds.size === 0) return [];
    return artikli
      .filter(a =>
        a.aktiven &&
        a.kategorijaId != null &&
        filtriranjeKatIds.has(a.kategorijaId) &&
        ((a as typeof a & { modSkupine?: ModSkupinaFull[] }).modSkupine ?? []).length > 0
      )
      .map(a => ({
        id: a.id,
        ime: a.ime,
        modSkupine: (a as typeof a & { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [],
      }));
  }, [artikli, filtriranjeKatIds]);

  const meniPoDateArtikel = useMemo<Map<string, Set<number>>>(() => {
    const map = new Map<string, Set<number>>();
    if (!dnevniMeniData) return map;
    for (const vnos of dnevniMeniData) {
      const key = `${vnos.datum}::${vnos.artikelId}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(vnos.modifikatorId);
    }
    return map;
  }, [dnevniMeniData]);

  const [pendingSet, setPendingSet] = useState<Set<string>>(new Set());

  const handleToggleMod = (datum: string, artikelId: number, modId: number, vsiMods: number[]) => {
    if (!jeAdmin) return;
    const key = `${datum}::${artikelId}`;
    const trenutni = meniPoDateArtikel.get(key) ?? new Set<number>();
    const noviSet = new Set(trenutni);
    if (noviSet.has(modId)) {
      noviSet.delete(modId);
    } else {
      noviSet.add(modId);
    }
    const _ = vsiMods;

    setPendingSet(prev => new Set(prev).add(key));
    setDnevniMeniArtikel.mutate(
      { datum, artikelId, data: { modifikatorIds: Array.from(noviSet) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDnevniMeniQueryKey({ od: odStr, do: doStr }) });
          setPendingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
        },
        onError: () => {
          toast({ title: "Napaka", description: "Ni bilo mogoče shraniti", variant: "destructive" });
          setPendingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
        },
      }
    );
  };

  const handleKopirajTeden = () => {
    const naslednji = new Date(tedenStart);
    naslednji.setDate(naslednji.getDate() + 7);
    kopirajTeden.mutate(
      { data: { izDatum: odStr, doDatum: formatDate(naslednji) } },
      {
        onSuccess: (res) => {
          toast({
            title: "Teden kopiran",
            description: `Kopirano ${res.kopirano} vnosov v teden ${formatDateSlo(naslednji)}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListDnevniMeniQueryKey() });
        },
        onError: () => toast({ title: "Napaka pri kopiranju", variant: "destructive" }),
      }
    );
  };

  const prejsniTeden = () => {
    setTedenStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const naslednjTeden = () => {
    setTedenStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const danasStr = formatDate(new Date());
  const defaultTab = tedenDatumi.findIndex(d => formatDate(d) === danasStr);
  const startTab = defaultTab >= 0 ? String(defaultTab) : "0";

  if (filtriranjeKatIds.size === 0 && !loadingMeni) {
    return (
      <div className="flex flex-col gap-6 p-4 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold">Dnevni meni</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm text-center py-8">
              Nobena kategorija nima vključenega dnevnega filtriranja.<br />
              V <span className="font-medium">Meniju</span> uredite kategorijo in odkljukajte
              &quot;Dnevno filtriranje modifikatorjev&quot;.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          Dnevni meni
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prejsniTeden}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">
            {formatDateSlo(tedenDatumi[0])} – {formatDateSlo(tedenDatumi[6])}
          </span>
          <Button variant="outline" size="sm" onClick={naslednjTeden}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {jeAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleKopirajTeden}
              disabled={kopirajTeden.isPending}
              className="flex items-center gap-1.5"
            >
              <Copy className="h-4 w-4" />
              Kopiraj v naslednji teden
            </Button>
          )}
        </div>
      </div>

      {artiFiltrirani.length === 0 && !loadingMeni ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm text-center py-8">
              V kategorijah z dnevnim filtriranjem ni aktivnih artiklov z modifikatorji.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={startTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 mb-2">
            {tedenDatumi.map((d, i) => {
              const ds = formatDate(d);
              const isToday = ds === danasStr;
              const steviloVnosov = artiFiltrirani.reduce((acc, art) => {
                const key = `${ds}::${art.id}`;
                return acc + (meniPoDateArtikel.get(key)?.size ?? 0);
              }, 0);
              return (
                <TabsTrigger key={i} value={String(i)} className="flex-col items-start gap-0.5 h-auto py-2 px-3">
                  <span className={`text-xs font-semibold ${isToday ? "text-primary" : ""}`}>{DNI[i].slice(0, 3)}</span>
                  <span className="text-xs text-muted-foreground">{formatDateSlo(d)}</span>
                  {steviloVnosov > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 mt-0.5">{steviloVnosov}</Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {tedenDatumi.map((d, i) => {
            const ds = formatDate(d);
            return (
              <TabsContent key={i} value={String(i)} className="mt-0">
                <div className="space-y-3">
                  {loadingMeni ? (
                    <Skeleton className="h-32 w-full" />
                  ) : artiFiltrirani.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Ni artiklov.</p>
                  ) : (
                    artiFiltrirani.map(art => {
                      const key = `${ds}::${art.id}`;
                      const izbrani = meniPoDateArtikel.get(key) ?? new Set<number>();
                      const isPending = pendingSet.has(key);
                      const vsiMods = art.modSkupine.flatMap(s => s.modifikatorji.filter(m => m.aktiven).map(m => m.id));

                      return (
                        <Card key={art.id} className={isPending ? "opacity-60" : ""}>
                          <CardHeader className="py-3 px-4">
                            <CardTitle className="text-base flex items-center justify-between">
                              <span>{art.ime}</span>
                              {izbrani.size > 0 && (
                                <Badge variant="default" className="text-xs">{izbrani.size} izbran{izbrani.size === 1 ? "" : "ih"}</Badge>
                              )}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4 pt-0">
                            <div className="space-y-3">
                              {art.modSkupine.map(sk => {
                                const aktivniMods = sk.modifikatorji.filter(m => m.aktiven);
                                if (aktivniMods.length === 0) return null;
                                return (
                                  <div key={sk.id}>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                                      {sk.ime}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {aktivniMods.map(mod => {
                                        const isSelected = izbrani.has(mod.id);
                                        return (
                                          <button
                                            key={mod.id}
                                            type="button"
                                            disabled={!jeAdmin || isPending}
                                            onClick={() => handleToggleMod(ds, art.id, mod.id, vsiMods)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors disabled:cursor-not-allowed ${
                                              isSelected
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "border-border hover:bg-muted text-foreground"
                                            }`}
                                          >
                                            {isSelected && <Check className="h-3 w-3" />}
                                            {mod.ime}
                                            {Number(mod.cenaDodatek) > 0 && (
                                              <span className="text-xs opacity-70">+{Number(mod.cenaDodatek).toFixed(2)} €</span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
