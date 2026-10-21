import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListKategorijeQueryKey, useListArtikli, useListKategorije, useUpdateKategorija } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ODDELKI } from "@/components/order/MenuNav";
import { POGOSTO_QUERY_KEY, usePogosto } from "@/hooks/use-pogosto";

type Rocno = "samodejno" | "pripni" | "skrij";

/** Nastavitve prikaza menija: razvrstitev kategorij v oddelke (meni A) in ročna prilagoditev seznama »Pogosto«. */
export function MenuPrikazSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: kategorije } = useListKategorije();
  const { data: artikli } = useListArtikli();
  const updateKategorija = useUpdateKategorija();
  const { data: pogosto } = usePogosto(true);
  const [iskanje, setIskanje] = useState("");
  const [spremembe, setSpremembe] = useState<Record<number, Rocno>>({});
  const [shranjujem, setShranjujem] = useState(false);

  const rocnoStanje = (artikelId: number): Rocno =>
    spremembe[artikelId] ?? pogosto?.rocno.find((r) => r.artikelId === artikelId)?.akcija ?? "samodejno";

  const prikazani = useMemo(() => {
    const q = iskanje.trim().toLocaleLowerCase("sl");
    const naSeznamu = new Set(pogosto?.artikelIds ?? []);
    return (artikli ?? [])
      .filter((a) => (a as { aktiven?: boolean }).aktiven !== false)
      .filter((a) => (q ? a.ime.toLocaleLowerCase("sl").includes(q) : naSeznamu.has(a.id) || rocnoStanje(a.id) !== "samodejno"))
      .slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artikli, iskanje, pogosto, spremembe]);

  const shraniOddelek = async (k: NonNullable<typeof kategorije>[number], oddelek: string) => {
    try {
      await updateKategorija.mutateAsync({
        id: k.id,
        data: { ime: k.ime, barva: k.barva, vrstniRed: k.vrstniRed, tip: k.tip ?? null, dnevnoFiltriranje: k.dnevnoFiltriranje ?? false, oddelek: oddelek as never },
      });
      await queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
    } catch (error) {
      toast({ title: "Oddelka ni bilo mogoče shraniti", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const shraniPogosto = async () => {
    const trenutno = new Map<number, Rocno>();
    for (const r of pogosto?.rocno ?? []) trenutno.set(r.artikelId, r.akcija);
    for (const [id, v] of Object.entries(spremembe)) {
      if (v === "samodejno") trenutno.delete(Number(id)); else trenutno.set(Number(id), v);
    }
    const pripni = [...trenutno].filter(([, v]) => v === "pripni").map(([id]) => id);
    const skrij = [...trenutno].filter(([, v]) => v === "skrij").map(([id]) => id);
    setShranjujem(true);
    try {
      await customFetch("/api/artikli/pogosto", { method: "PUT", body: JSON.stringify({ pripni, skrij }), headers: { "Content-Type": "application/json" }, responseType: "text" });
      setSpremembe({});
      await queryClient.invalidateQueries({ queryKey: POGOSTO_QUERY_KEY });
      toast({ title: "Seznam »Pogosto« shranjen" });
    } catch (error) {
      toast({ title: "Seznama ni bilo mogoče shraniti", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setShranjujem(false);
    }
  };

  return (
    <Card id="ns-prikaz-menija" data-testid="menu-prikaz-settings">
      <CardHeader>
        <CardTitle>Prikaz menija: oddelki in »Pogosto«</CardTitle>
        <CardDescription>
          Oddelki se uporabljajo v prikazu menija A. Obstoječe kategorije so v oddelku »Drugo«, dokler jih ne razvrstite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          {(kategorije ?? []).map((k) => (
            <label key={k.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{k.ime}</span>
              <select
                aria-label={`Oddelek za ${k.ime}`}
                className="min-h-[44px] border rounded px-2 text-sm bg-background"
                value={(k as { oddelek?: string }).oddelek ?? "Drugo"}
                onChange={(e) => void shraniOddelek(k, e.target.value)}
              >
                {ODDELKI.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Pogosto (24 artiklov)</p>
          <p className="text-xs text-muted-foreground">
            Seznam se samodejno izračuna iz naročil zadnjih 60 dni. Artikel lahko pripnete (vedno je na seznamu) ali skrijete.
          </p>
          <Input value={iskanje} onChange={(e) => setIskanje(e.target.value)} placeholder="Poišči artikel …" className="min-h-[44px]" />
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {prikazani.map((a) => (
              <label key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{a.ime}</span>
                <select
                  aria-label={`Pogosto: ${a.ime}`}
                  className="min-h-[44px] border rounded px-2 text-sm bg-background"
                  value={rocnoStanje(a.id)}
                  onChange={(e) => setSpremembe((prev) => ({ ...prev, [a.id]: e.target.value as Rocno }))}
                >
                  <option value="samodejno">Samodejno</option>
                  <option value="pripni">Pripni</option>
                  <option value="skrij">Skrij</option>
                </select>
              </label>
            ))}
          </div>
          <Button onClick={() => void shraniPogosto()} disabled={shranjujem || Object.keys(spremembe).length === 0}>Shrani seznam</Button>
        </div>
      </CardContent>
    </Card>
  );
}
