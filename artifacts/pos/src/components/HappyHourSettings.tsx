import { formatEur } from "@/lib/formatEur";
import { useEffect, useMemo, useState } from "react";
import {
  getGetNastavitveQueryKey,
  useListArtikli,
  useListKategorije,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Search, Trash2 } from "lucide-react";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type HappyHourVelikostPice = "mala" | "normalna" | "druzinska";

interface HappyHourPravilo {
  id: string;
  naziv: string;
  od: string;
  do: string;
  dnevi: number[];
  artikelIds: number[];
  velikostiPice: HappyHourVelikostPice[];
}

const DNEVI = [
  { id: 1, kratko: "Pon" },
  { id: 2, kratko: "Tor" },
  { id: 3, kratko: "Sre" },
  { id: 4, kratko: "Čet" },
  { id: 5, kratko: "Pet" },
  { id: 6, kratko: "Sob" },
  { id: 7, kratko: "Ned" },
] as const;

const VSI_DNEVI = DNEVI.map((dan) => dan.id);
const VELIKOSTI_PICE: { id: HappyHourVelikostPice; naziv: string }[] = [
  { id: "mala", naziv: "Mala" },
  { id: "normalna", naziv: "Velika (normalna)" },
  { id: "druzinska", naziv: "Družinska" },
];
const VSE_VELIKOSTI_PICE = VELIKOSTI_PICE.map((velikost) => velikost.id);

function novoPravilo(): HappyHourPravilo {
  return {
    id: `hh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    naziv: "Nov Happy Hour",
    od: "09:00",
    do: "11:00",
    dnevi: [...VSI_DNEVI],
    artikelIds: [],
    velikostiPice: [...VSE_VELIKOSTI_PICE],
  };
}

export function HappyHourSettings() {
  const { nastavitve } = useNastavitve();
  const { data: artikli = [] } = useListArtikli();
  const { data: kategorije = [] } = useListKategorije();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pravila, setPravila] = useState<HappyHourPravilo[]>([]);
  const [iskanje, setIskanje] = useState("");
  const [shranjujem, setShranjujem] = useState(false);

  const razpolozljiviArtikli = useMemo(
    () => artikli
      .filter((artikel) =>
        artikel.aktiven
        && artikel.prodajniArtikel
        && (artikel.happyHourCena != null || artikel.happyHourCenaMala != null || artikel.happyHourCenaDruzinska != null)
      ),
    [artikli],
  );

  useEffect(() => {
    if (!nastavitve) return;
    const hh = nastavitve as typeof nastavitve & {
      happyHourPravila?: HappyHourPravilo[];
      happyHourOd?: string;
      happyHourDo?: string;
    };
    if (Array.isArray(hh.happyHourPravila) && hh.happyHourPravila.length > 0) {
      setPravila(hh.happyHourPravila.map((pravilo) => ({
        ...pravilo,
        velikostiPice: Array.isArray(pravilo.velikostiPice)
          ? pravilo.velikostiPice
          : [...VSE_VELIKOSTI_PICE],
      })));
      return;
    }
    if (hh.happyHourOd && hh.happyHourDo && razpolozljiviArtikli.length > 0) {
      setPravila([{
        id: "legacy",
        naziv: "Obstoječi Happy Hour",
        od: hh.happyHourOd,
        do: hh.happyHourDo,
        dnevi: [...VSI_DNEVI],
        artikelIds: razpolozljiviArtikli.map((artikel) => artikel.id),
        velikostiPice: [...VSE_VELIKOSTI_PICE],
      }]);
      return;
    }
    setPravila([]);
  }, [nastavitve, razpolozljiviArtikli]);

  const updatePravilo = (id: string, update: Partial<HappyHourPravilo>) => {
    setPravila((current) => current.map((pravilo) =>
      pravilo.id === id ? { ...pravilo, ...update } : pravilo
    ));
  };

  const toggleDan = (pravilo: HappyHourPravilo, dan: number) => {
    updatePravilo(pravilo.id, {
      dnevi: pravilo.dnevi.includes(dan)
        ? pravilo.dnevi.filter((value) => value !== dan)
        : [...pravilo.dnevi, dan].sort(),
    });
  };

  const toggleArtikli = (pravilo: HappyHourPravilo, ids: number[]) => {
    const vsiIzbrani = ids.length > 0 && ids.every((id) => pravilo.artikelIds.includes(id));
    updatePravilo(pravilo.id, {
      artikelIds: vsiIzbrani
        ? pravilo.artikelIds.filter((id) => !ids.includes(id))
        : [...new Set([...pravilo.artikelIds, ...ids])],
    });
  };

  const toggleVelikostPice = (pravilo: HappyHourPravilo, velikost: HappyHourVelikostPice) => {
    updatePravilo(pravilo.id, {
      velikostiPice: pravilo.velikostiPice.includes(velikost)
        ? pravilo.velikostiPice.filter((value) => value !== velikost)
        : [...pravilo.velikostiPice, velikost],
    });
  };

  const handleSave = async () => {
    const neveljavno = pravila.find((pravilo) =>
      !pravilo.naziv.trim()
      || !pravilo.od
      || !pravilo.do
      || pravilo.dnevi.length === 0
      || pravilo.artikelIds.length === 0
      || (
        pravilo.artikelIds.some((id) =>
          razpolozljiviArtikli.some((artikel) => artikel.id === id && artikel.jePica)
        )
        && pravilo.velikostiPice.length === 0
      )
    );
    if (neveljavno) {
      toast({
        title: "Pravilo ni popolno",
        description: `Pri pravilu »${neveljavno.naziv || "brez naziva"}« izberite čas, najmanj en dan, najmanj en artikel in pri picah najmanj eno velikost.`,
        variant: "destructive",
      });
      return;
    }

    setShranjujem(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/nastavitve/happy-hour-urnik`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pravila }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Nastavitev ni bilo mogoče shraniti.");
      }
      await queryClient.invalidateQueries({ queryKey: getGetNastavitveQueryKey() });
      toast({ title: "Happy Hour pravila so shranjena" });
    } catch (error) {
      toast({
        title: "Napaka",
        description: error instanceof Error ? error.message : "Nastavitev ni bilo mogoče shraniti.",
        variant: "destructive",
      });
    } finally {
      setShranjujem(false);
    }
  };

  const iskaniArtikli = razpolozljiviArtikli.filter((artikel) =>
    `${artikel.ime} ${artikel.kategorijaIme ?? ""}`.toLocaleLowerCase("sl")
      .includes(iskanje.trim().toLocaleLowerCase("sl"))
  );

  return (
    <Card id="ns-happy-hour">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>⭐ Happy Hour pravila</CardTitle>
            <CardDescription className="mt-1">
              Dodajte več časovnih pravil ter za vsako izberite dneve, artikle in velikosti pic.
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setPravila((current) => [...current, novoPravilo()])}>
            <Plus className="mr-2 h-4 w-4" />
            Dodaj pravilo
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {razpolozljiviArtikli.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Najprej v meniju <strong>Artikli</strong> nastavite Happy Hour ceno vsaj enemu prodajnemu artiklu.
          </div>
        )}

        {pravila.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Ni nastavljenih pravil. Dodate lahko jutranjo kavo, kosilo, večerne pijače ali celodnevno akcijo.
          </div>
        ) : pravila.map((pravilo, index) => (
          <details key={pravilo.id} open={index === 0} className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{pravilo.naziv}</p>
                <p className="text-xs text-muted-foreground">
                  {pravilo.od === pravilo.do ? "Ves dan" : `${pravilo.od}–${pravilo.do}`}
                  {" · "}
                  {pravilo.dnevi.length === 7 ? "vsi dnevi" : pravilo.dnevi.map((id) => DNEVI.find((dan) => dan.id === id)?.kratko).join(", ")}
                  {" · "}
                  {pravilo.artikelIds.length} artiklov
                  {pravilo.artikelIds.some((id) => razpolozljiviArtikli.some((artikel) => artikel.id === id && artikel.jePica))
                    ? ` · ${pravilo.velikostiPice.map((id) => VELIKOSTI_PICE.find((velikost) => velikost.id === id)?.naziv).join(", ")}`
                    : ""}
                </p>
              </div>
              <Badge variant="outline">Pravilo {index + 1}</Badge>
            </summary>

            <div className="space-y-5 border-t p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(180px,1fr)_140px_140px_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label>Naziv pravila</Label>
                  <Input value={pravilo.naziv} onChange={(event) => updatePravilo(pravilo.id, { naziv: event.target.value })} placeholder="npr. Jutranja kava" />
                </div>
                <div className="space-y-1.5">
                  <Label>Začetek</Label>
                  <Input type="time" value={pravilo.od} onChange={(event) => updatePravilo(pravilo.id, { od: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Konec</Label>
                  <Input type="time" value={pravilo.do} onChange={(event) => updatePravilo(pravilo.id, { do: event.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setPravila((current) => current.filter((item) => item.id !== pravilo.id))}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Izbriši
                </Button>
              </div>
              {pravilo.od === pravilo.do && (
                <p className="text-xs text-muted-foreground">Enak začetek in konec pomenita, da pravilo velja ves dan.</p>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Dnevi veljavnosti</Label>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => updatePravilo(pravilo.id, { dnevi: [1, 2, 3, 4, 5] })}>Delovni dnevi</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => updatePravilo(pravilo.id, { dnevi: [...VSI_DNEVI] })}>Vsi dnevi</Button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {DNEVI.map((dan) => {
                    const selected = pravilo.dnevi.includes(dan.id);
                    return (
                      <button
                        key={dan.id}
                        type="button"
                        onClick={() => toggleDan(pravilo, dan.id)}
                        className={`min-h-10 rounded-md border px-2 text-sm font-medium transition-colors ${selected ? "border-amber-500 bg-amber-50 text-amber-950" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {dan.kratko}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div>
                  <Label>Velikosti pic v pravilu</Label>
                  <p className="text-xs text-muted-foreground">
                    Izbira velja samo za pice. Drugi izbrani artikli ostanejo vključeni ne glede na velikost.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {VELIKOSTI_PICE.map((velikost) => {
                    const selected = pravilo.velikostiPice.includes(velikost.id);
                    return (
                      <button
                        key={velikost.id}
                        type="button"
                        onClick={() => toggleVelikostPice(pravilo, velikost.id)}
                        className={`min-h-10 rounded-md border-2 px-2 text-xs font-semibold transition-colors sm:text-sm ${
                          selected
                            ? "border-amber-500 bg-amber-100 text-amber-950 shadow-sm"
                            : "border-border bg-background text-muted-foreground hover:border-amber-300 hover:bg-amber-50"
                        }`}
                      >
                        {velikost.naziv}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label>Artikli v pravilu</Label>
                    <p className="text-xs text-muted-foreground">Prikazani so samo artikli z nastavljeno Happy Hour ceno.</p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input value={iskanje} onChange={(event) => setIskanje(event.target.value)} placeholder="Poišči artikel…" className="pl-9" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleArtikli(pravilo, razpolozljiviArtikli.map((artikel) => artikel.id))}>
                    Vsi artikli
                  </Button>
                  {kategorije.map((kategorija) => {
                    const ids = razpolozljiviArtikli.filter((artikel) => artikel.kategorijaId === kategorija.id).map((artikel) => artikel.id);
                    if (ids.length === 0) return null;
                    const selected = ids.every((id) => pravilo.artikelIds.includes(id));
                    return (
                      <Button key={kategorija.id} type="button" size="sm" variant={selected ? "default" : "outline"} onClick={() => toggleArtikli(pravilo, ids)}>
                        {kategorija.ime}
                      </Button>
                    );
                  })}
                </div>

                <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {iskaniArtikli.map((artikel) => {
                    const selected = pravilo.artikelIds.includes(artikel.id);
                    return (
                      <button
                        key={artikel.id}
                        type="button"
                        onClick={() => toggleArtikli(pravilo, [artikel.id])}
                        className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-amber-500 bg-amber-50" : "hover:bg-muted/60"}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{artikel.ime}</span>
                          <span className="block truncate text-xs text-muted-foreground">{artikel.kategorijaIme ?? "Brez kategorije"}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold text-amber-800">
                          {artikel.jePica
                            ? [
                                artikel.happyHourCenaMala != null ? `M ${formatEur(Number(artikel.happyHourCenaMala))}` : null,
                                artikel.happyHourCena != null ? `N ${formatEur(Number(artikel.happyHourCena))}` : null,
                                artikel.happyHourCenaDruzinska != null ? `D ${formatEur(Number(artikel.happyHourCenaDruzinska))}` : null,
                              ].filter(Boolean).join(" · ")
                            : `${formatEur(Number(artikel.happyHourCena))}`}
                        </span>
                      </button>
                    );
                  })}
                  {iskaniArtikli.length === 0 && (
                    <p className="col-span-full p-3 text-center text-sm text-muted-foreground">Ni ustreznih artiklov.</p>
                  )}
                </div>
              </div>
            </div>
          </details>
        ))}
      </CardContent>

      <CardFooter className="justify-end border-t pt-4">
        <Button type="button" size="sm" onClick={handleSave} disabled={shranjujem}>
          <Save className="mr-2 h-4 w-4" />
          {shranjujem ? "Shranjujem…" : "Shrani vsa pravila"}
        </Button>
      </CardFooter>
    </Card>
  );
}