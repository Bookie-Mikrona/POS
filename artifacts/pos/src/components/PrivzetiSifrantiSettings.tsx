import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getEnotaId, getListArtikliQueryKey, getListKategorijeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { posFetch } from "@/lib/pos-auth-headers";

type PrivzetArtikel = { kljuc: string; ime: string; cena: number; davcna: string; obstaja: boolean };
type PrivzetaKategorija = { kljuc: string; ime: string; oddelek: string; obstaja: boolean; artikli: PrivzetArtikel[] };
type Rezultat = {
  kategorije: number; artikli: number; polizdelki: number; surovine: number; normativi: number;
  preskoceniArtikli: number; opozorila: string[];
};

const DAVCNA_OPIS: Record<string, string> = {
  food: "hrana", food_drink: "pijača-jed", hot_beverage: "topla pijača", cold_beverage: "hladna pijača",
  alcoholic: "alkohol", other: "ostalo",
};

/** Izbirni uvoz privzetih kategorij, prodajnih artiklov, normativov, polizdelkov in nabavnih artiklov v aktivno enoto. */
export function PrivzetiSifrantiSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const enotaId = getEnotaId();
  const [izbrani, setIzbrani] = useState<Set<string>>(() => new Set());
  const [odprte, setOdprte] = useState<Set<string>>(() => new Set());
  const [uvazam, setUvazam] = useState(false);
  const [potrdi, setPotrdi] = useState(false);

  const katalog = useQuery({
    queryKey: ["privzeti-sifranti", enotaId],
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const response = await posFetch(`${base}/api/artikli/privzeti-sifranti`);
      const body = await response.json().catch(() => null) as { kategorije?: PrivzetaKategorija[]; error?: string } | null;
      if (!response.ok || !body?.kategorije) throw new Error(body?.error ?? `Kataloga ni bilo mogoče naložiti (HTTP ${response.status}).`);
      return body.kategorije;
    },
  });

  const preklopi = (kljuci: string[], vklop: boolean) => setIzbrani((trenutni) => {
    const n = new Set(trenutni);
    for (const k of kljuci) { if (vklop) n.add(k); else n.delete(k); }
    return n;
  });
  const preklopiOdprto = (k: string) => setOdprte((t) => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const uvozi = async () => {
    setUvazam(true);
    try {
      const response = await posFetch(`${base}/api/artikli/privzeti-sifranti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kategorije: [], artikli: [...izbrani] }),
      });
      const body = await response.json().catch(() => null) as (Rezultat & { error?: string }) | null;
      if (!response.ok || !body || typeof body.artikli !== "number") throw new Error(body?.error ?? `Uvoz ni uspel (HTTP ${response.status}).`);
      setPotrdi(false);
      setIzbrani(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ["privzeti-sifranti"] }),
      ]);
      toast({
        title: "Privzeti šifranti so uvoženi",
        description: `Artikli: ${body.artikli}, kategorije: ${body.kategorije}, polizdelki: ${body.polizdelki}, nabavni artikli: ${body.surovine}, normativi: ${body.normativi}. Že obstoječih preskočenih: ${body.preskoceniArtikli}.${body.opozorila.length ? ` Opozorila: ${body.opozorila.join(" ")}` : ""}`,
      });
    } catch (napaka) {
      toast({ title: "Uvoz ni uspel", description: napaka instanceof Error ? napaka.message : "Poskusite znova.", variant: "destructive" });
    } finally {
      setUvazam(false);
    }
  };

  return (
    <Card data-testid="card-privzeti-sifranti">
      <CardHeader>
        <CardTitle>Privzeti šifranti za novo enoto</CardTitle>
        <CardDescription>
          Označite kategorije ali artikle, ki jih enota potrebuje. Uvoz doda kategorije, prodajne artikle s cenami in davčno skupino,
          normative, polizdelke in nabavne artikle. Obstoječih podatkov ne spremeni. Uvoz velja samo za trenutno enoto{enotaId ? ` (ID ${enotaId})` : ""}.
          Cene so okvirne; po uvozu jih uredite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" data-testid="button-import-privzeti-sifranti" disabled={!enotaId || uvazam || izbrani.size === 0} onClick={() => setPotrdi(true)}>
            {uvazam ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uvažam…</> : `Uvozi označene artikle (${izbrani.size})`}
          </Button>
          {potrdi && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm" role="alert">
              <span>Uvoz bo ustvaril označene artikle in njihove normative v tej enoti. Nadaljujem?</span>
              <Button type="button" size="sm" data-testid="button-potrdi-privzeti-sifranti" disabled={uvazam} onClick={() => void uvozi()}>Da, uvozi</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPotrdi(false)}>Prekliči</Button>
            </div>
          )}
        </div>
        {katalog.isLoading && <p className="text-sm text-muted-foreground">Nalagam katalog…</p>}
        {katalog.error && <p className="text-sm text-destructive">{(katalog.error as Error).message}</p>}
        {katalog.data?.map((k) => {
          const uvozljivi = k.artikli.filter((a) => !a.obstaja).map((a) => a.kljuc);
          const stIzbranih = uvozljivi.filter((x) => izbrani.has(x)).length;
          const stanje: boolean | "indeterminate" = stIzbranih === 0 ? false : stIzbranih === uvozljivi.length ? true : "indeterminate";
          const odprta = odprte.has(k.kljuc);
          return (
            <section key={k.kljuc} className="rounded-md border">
              <div className="flex items-center gap-3 p-3">
                <Checkbox checked={stanje} disabled={uvozljivi.length === 0} aria-label={`Označi vse artikle: ${k.ime}`}
                  onCheckedChange={(c) => preklopi(uvozljivi, c === true)} data-testid={`checkbox-privzeta-kategorija-${k.kljuc}`} />
                <button type="button" className="flex flex-1 items-center gap-2 text-left" aria-expanded={odprta} onClick={() => preklopiOdprto(k.kljuc)}>
                  {odprta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm font-semibold">{k.ime}</span>
                  {k.obstaja && <span className="text-xs text-muted-foreground">(kategorija že obstaja)</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{stIzbranih} / {uvozljivi.length} za uvoz</span>
                </button>
              </div>
              {odprta && (
                <ul className="grid grid-cols-1 gap-2 border-t p-3 sm:grid-cols-2">
                  {k.artikli.map((a) => (
                    <li key={a.kljuc} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox id={`ps-${a.kljuc}`} checked={a.obstaja ? true : izbrani.has(a.kljuc)} disabled={a.obstaja}
                        onCheckedChange={(c) => preklopi([a.kljuc], c === true)} className="mt-0.5" />
                      <label htmlFor={`ps-${a.kljuc}`} className="cursor-pointer">
                        <span className="font-medium">{a.ime}</span>
                        <span className="block text-xs text-muted-foreground">
                          {a.cena.toFixed(2).replace(".", ",")} € · {DAVCNA_OPIS[a.davcna] ?? a.davcna}{a.obstaja ? " · že obstaja" : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
