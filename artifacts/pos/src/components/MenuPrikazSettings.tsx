import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListArtikliQueryKey, getListKategorijeQueryKey, useListArtikli, useListKategorije, useUpdateKategorija } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ODDELKI } from "@/components/order/MenuNav";
import { predlogOddelka } from "@/lib/predlog-oddelkov";
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

  const [spremljanje, setSpremljanje] = useState<Record<number, boolean>>({});
  const nastaviSpremljanje = async (artikelId: number, vklopljeno: boolean) => {
    setSpremljanje((prev) => ({ ...prev, [artikelId]: vklopljeno }));
    try {
      await customFetch("/api/artikli/spremljaj-porcije", { method: "PUT", body: JSON.stringify({ artikelId, vklopljeno }), headers: { "Content-Type": "application/json" }, responseType: "text" });
      await queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
    } catch (error) {
      setSpremljanje((prev) => { const { [artikelId]: _odstrani, ...ostalo } = prev; return ostalo; });
      toast({ title: "Nastavitve ni bilo mogoče shraniti", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

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

  // Predlog razvrstitve po imenih: nič se ne spremeni brez potrditve.
  const [predlogi, setPredlogi] = useState<Array<{ id: number; ime: string; oddelek: string; izbran: boolean }> | null>(null);
  const pripraviPredlog = () => {
    const seznam = (kategorije ?? [])
      .filter((k) => ((k as { oddelek?: string }).oddelek ?? "Drugo") === "Drugo")
      .map((k) => ({ id: k.id, ime: k.ime, oddelek: predlogOddelka(k.ime), izbran: true }))
      .filter((p) => p.oddelek !== "Drugo");
    setPredlogi(seznam);
  };
  const uveljaviPredlog = async () => {
    for (const p of predlogi ?? []) {
      const k = (kategorije ?? []).find((x) => x.id === p.id);
      if (k && p.izbran) await shraniOddelek(k, p.oddelek);
    }
    setPredlogi(null);
    toast({ title: "Oddelki shranjeni" });
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
          <Button type="button" variant="outline" data-testid="predlagaj-oddelke" onClick={pripraviPredlog}>
            Predlagaj razvrstitev po imenih
          </Button>
          {predlogi && (
            <div className="space-y-2 rounded-lg border p-3" data-testid="predlog-oddelkov">
              {predlogi.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ni kategorij, ki bi jih bilo mogoče razvrstiti (vse so že razvrščene ali imena niso prepoznana).</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Predlog (nič se ne spremeni, dokler ne potrdite):</p>
                  {predlogi.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm min-h-[36px]">
                      <input type="checkbox" checked={p.izbran} aria-label={`Uporabi predlog za ${p.ime}`}
                        onChange={(e) => setPredlogi((prev) => prev?.map((x) => x.id === p.id ? { ...x, izbran: e.target.checked } : x) ?? null)} />
                      <span className="flex-1 truncate">{p.ime}</span>
                      <span className="font-medium">→ {p.oddelek}</span>
                    </label>
                  ))}
                  <div className="flex gap-2">
                    <Button type="button" data-testid="potrdi-predlog-oddelkov" onClick={() => void uveljaviPredlog()} disabled={!predlogi.some((p) => p.izbran)}>Potrdi razvrstitev</Button>
                    <Button type="button" variant="ghost" onClick={() => setPredlogi(null)}>Prekliči</Button>
                  </div>
                </>
              )}
            </div>
          )}
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
            »Porcije« vklopi prikaz zaloge in opozoril v novem prikazu menija (samo prikaz; strežnik preverjanje opravi kot prej). Seznam se samodejno izračuna iz naročil zadnjih 60 dni. Artikel lahko pripnete (vedno je na seznamu) ali skrijete.
          </p>
          <Input value={iskanje} onChange={(e) => setIskanje(e.target.value)} placeholder="Poišči artikel …" className="min-h-[44px]" />
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {prikazani.map((a) => (
              <label key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate flex-1">{a.ime}</span>
                <label className="flex items-center gap-1 text-xs shrink-0">
                  <input
                    type="checkbox"
                    aria-label={`Spremljaj porcije: ${a.ime}`}
                    checked={spremljanje[a.id] ?? Boolean((a as { spremljajPorcije?: boolean }).spremljajPorcije)}
                    onChange={(e) => void nastaviSpremljanje(a.id, e.target.checked)}
                  />
                  Porcije
                </label>
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
