import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDostavniKurirjiQueryKey,
  getGetNastavitveQueryKey,
  getListArtikliQueryKey,
  useCreateDostavniKurir,
  useListArtikli,
  useListDostavniKurirji,
  useUpdateDostavniKurirActivity,
  useUpdateNastavitve,
} from "@workspace/api-client-react";
import type { Nastavitve } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { CtiSettings } from "@/components/CtiSettings";

function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

type TelefonForm = {
  osnovniCasMin: string;
  cakalnaVrstaMin: string;
  kapaciteta: string;
  najvecCasMin: string;
  zaokrozevanjeMin: string;
  pijacaOsnovniCasMin: string;
  pijacaCakalnaVrstaMin: string;
  pijacaKapaciteta: string;
  pijacaNajvecCasMin: string;
  pijacaZaokrozevanjeMin: string;
};

interface DostavaSettingsProps {
  enotaId?: number | null;
}

export function DostavaSettings({ enotaId }: DostavaSettingsProps) {
  const { nastavitve, nastavitveLoading } = useNastavitve();
  const { data: artikli = [] } = useListArtikli();
  const updateNastavitve = useUpdateNastavitve();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dostavaArtikelId, setDostavaArtikelId] = useState<string>("none");
  const [telefon, setTelefon] = useState<TelefonForm>({
    osnovniCasMin: "5", cakalnaVrstaMin: "0", kapaciteta: "3", najvecCasMin: "30", zaokrozevanjeMin: "5",
    pijacaOsnovniCasMin: "3", pijacaCakalnaVrstaMin: "0", pijacaKapaciteta: "2", pijacaNajvecCasMin: "20", pijacaZaokrozevanjeMin: "1",
  });
  const [telefonSaving, setTelefonSaving] = useState(false);
  const [novKurirIme, setNovKurirIme] = useState("");
  const [novKurirTelefon, setNovKurirTelefon] = useState("");

  const kurirji = useListDostavniKurirji();
  const dodajKurir = useCreateDostavniKurir({
    mutation: {
      onSuccess: async () => {
        setNovKurirIme("");
        setNovKurirTelefon("");
        await queryClient.invalidateQueries({ queryKey: getListDostavniKurirjiQueryKey() });
        toast({ title: "Kurir dodan" });
      },
      onError: (error: unknown) => {
        toast({
          title: "Kurirja ni bilo mogoče dodati",
          description: error instanceof Error ? error.message : "Preverite podatke in poskusite znova.",
          variant: "destructive",
        });
      },
    },
  });
  const spremeniAktivnostKurirja = useUpdateDostavniKurirActivity({
    mutation: {
      onSuccess: async (_data, variables) => {
        await queryClient.invalidateQueries({ queryKey: getListDostavniKurirjiQueryKey() });
        toast({ title: variables.data.aktiven ? "Kurir aktiviran" : "Kurir deaktiviran" });
      },
      onError: (error: unknown) => {
        toast({
          title: "Statusa kurirja ni bilo mogoče spremeniti",
          description: error instanceof Error ? error.message : "Preverite povezavo in poskusite znova.",
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    if (!nastavitve) return;
    setDostavaArtikelId(nastavitve.dostavaArtikelId == null ? "none" : String(nastavitve.dostavaArtikelId));
    setTelefon({
      osnovniCasMin: String(nastavitve.telefonNarocilaOsnovniCasMin ?? 5),
      cakalnaVrstaMin: String(nastavitve.telefonNarocilaCakalnaVrstaMin ?? 0),
      kapaciteta: String(nastavitve.telefonNarocilaKapaciteta ?? 3),
      najvecCasMin: String(nastavitve.telefonNarocilaNajvecCasMin ?? 30),
      zaokrozevanjeMin: String(nastavitve.telefonNarocilaZaokrozevanjeMin ?? 5),
      pijacaOsnovniCasMin: String(nastavitve.telefonNarocilaPijacaOsnovniCasMin ?? 3),
      pijacaCakalnaVrstaMin: String(nastavitve.telefonNarocilaPijacaCakalnaVrstaMin ?? 0),
      pijacaKapaciteta: String(nastavitve.telefonNarocilaPijacaKapaciteta ?? 2),
      pijacaNajvecCasMin: String(nastavitve.telefonNarocilaPijacaNajvecCasMin ?? 20),
      pijacaZaokrozevanjeMin: String(nastavitve.telefonNarocilaPijacaZaokrozevanjeMin ?? 1),
    });
  }, [nastavitve]);

  const storitve = artikli.filter(artikel => {
    const extended = artikel as typeof artikel & { vrstaArtikla?: string };
    return artikel.aktiven && extended.vrstaArtikla === "storitev";
  });

  const saveDostavaArtikel = () => {
    if (!nastavitve) return;
    updateNastavitve.mutate({
      data: {
        ...nastavitve,
        dostavaArtikelId: dostavaArtikelId === "none" ? null : Number(dostavaArtikelId),
      } as Nastavitve,
    }, {
      onSuccess: data => {
        queryClient.setQueryData(getGetNastavitveQueryKey(), data);
        queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
        toast({ title: "Dostavna storitev shranjena" });
      },
      onError: () => toast({ title: "Napaka", description: "Dostavne storitve ni bilo mogoče shraniti.", variant: "destructive" }),
    });
  };

  const saveTelefon = async () => {
    const values = Object.fromEntries(Object.entries(telefon).map(([key, value]) => [key, Number(value)])) as Record<keyof TelefonForm, number>;
    if (!Number.isInteger(values.osnovniCasMin) || values.osnovniCasMin < 1 || values.osnovniCasMin > 120
      || !Number.isInteger(values.cakalnaVrstaMin) || values.cakalnaVrstaMin < 0 || values.cakalnaVrstaMin > 60
      || !Number.isInteger(values.kapaciteta) || values.kapaciteta < 1 || values.kapaciteta > 50
      || !Number.isInteger(values.najvecCasMin) || values.najvecCasMin < 5 || values.najvecCasMin > 240
       || !Number.isInteger(values.zaokrozevanjeMin) || values.zaokrozevanjeMin < 0 || values.zaokrozevanjeMin > 60
       || !Number.isInteger(values.pijacaOsnovniCasMin) || values.pijacaOsnovniCasMin < 1 || values.pijacaOsnovniCasMin > 120
       || !Number.isInteger(values.pijacaCakalnaVrstaMin) || values.pijacaCakalnaVrstaMin < 0 || values.pijacaCakalnaVrstaMin > 60
       || !Number.isInteger(values.pijacaKapaciteta) || values.pijacaKapaciteta < 1 || values.pijacaKapaciteta > 50
       || !Number.isInteger(values.pijacaNajvecCasMin) || values.pijacaNajvecCasMin < 5 || values.pijacaNajvecCasMin > 240
       || !Number.isInteger(values.pijacaZaokrozevanjeMin) || values.pijacaZaokrozevanjeMin < 0 || values.pijacaZaokrozevanjeMin > 60) {
      toast({ title: "Preverite dovoljena območja nastavitev", variant: "destructive" });
      return;
    }

    setTelefonSaving(true);
    try {
      const response = await fetch(apiUrl("/api/nastavitve/telefon-narocila"), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(enotaId != null ? { "X-Enota-Id": String(enotaId) } : {}),
        },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: getGetNastavitveQueryKey() });
      toast({ title: "Ocena telefonskih naročil shranjena" });
    } catch {
      toast({ title: "Napaka", description: "Nastavitev ocene ni bilo mogoče shraniti.", variant: "destructive" });
    } finally {
      setTelefonSaving(false);
    }
  };

  const handleDodajKurir = (event: React.FormEvent) => {
    event.preventDefault();
    if (!novKurirIme.trim() || dodajKurir.isPending) return;
    dodajKurir.mutate({
      data: {
        ime: novKurirIme.trim(),
        telefon: novKurirTelefon.trim() || null,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nastavitve dostave</CardTitle>
          <CardDescription>Izberite aktivno storitev iz kataloga artiklov. Njena cena predstavlja ceno na kilometer (€/km).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md space-y-2">
            <Label htmlFor="dostava-artikel">Dostavna storitev</Label>
            <Select value={dostavaArtikelId} onValueChange={setDostavaArtikelId} disabled={nastavitveLoading}>
              <SelectTrigger id="dostava-artikel"><SelectValue placeholder="Izberite storitev" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brez dostavne postavke</SelectItem>
                {storitve.map(artikel => <SelectItem key={artikel.id} value={String(artikel.id)}>{artikel.ime} · {artikel.cena.toFixed(2)} €/km ({artikel.davek} % DDV)</SelectItem>)}
              </SelectContent>
            </Select>
            {dostavaArtikelId === "none" && <p className="text-sm text-destructive">Dostava ni mogoča, dokler ni izbrana dostavna storitev.</p>}
            {storitve.length === 0 && <p className="text-sm text-muted-foreground">Najprej v katalogu artiklov ustvarite aktivno storitev.</p>}
          </div>
          <Button size="sm" onClick={saveDostavaArtikel} disabled={nastavitveLoading || updateNastavitve.isPending}>Shrani dostavno storitev</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kurirji</CardTitle>
          <CardDescription>Upravljajte kurirji, ki jih lahko osebje izbere pri prevzemu dostavnega naročila.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleDodajKurir} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="nov-kurir-ime">Ime kurirja</Label>
              <Input
                id="nov-kurir-ime"
                value={novKurirIme}
                onChange={event => setNovKurirIme(event.target.value)}
                placeholder="npr. Ana Novak"
                maxLength={120}
                disabled={dodajKurir.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nov-kurir-telefon">Telefon (neobvezno)</Label>
              <Input
                id="nov-kurir-telefon"
                value={novKurirTelefon}
                onChange={event => setNovKurirTelefon(event.target.value)}
                placeholder="npr. 041 123 456"
                maxLength={50}
                disabled={dodajKurir.isPending}
              />
            </div>
            <Button type="submit" disabled={!novKurirIme.trim() || dodajKurir.isPending}>
              {dodajKurir.isPending ? "Dodajam …" : "Dodaj kurirja"}
            </Button>
          </form>

          {kurirji.isError && (
            <p className="text-sm text-destructive">Seznama kurirjev ni bilo mogoče naložiti.</p>
          )}
          {kurirji.isLoading ? (
            <p className="text-sm text-muted-foreground">Nalaganje kurirjev …</p>
          ) : kurirji.data && kurirji.data.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {kurirji.data.map(kurir => (
                <li key={kurir.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{kurir.ime}</p>
                    {kurir.telefon && <p className="text-xs text-muted-foreground">{kurir.telefon}</p>}
                  </div>
                  <Badge variant="outline" className={kurir.aktiven
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 bg-slate-50 text-slate-600"}>
                    {kurir.aktiven ? "Aktiven" : "Neaktiven"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={spremeniAktivnostKurirja.isPending}
                    onClick={() => spremeniAktivnostKurirja.mutate({ id: kurir.id, data: { aktiven: !kurir.aktiven } })}
                  >
                    {kurir.aktiven ? "Deaktiviraj" : "Aktiviraj"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Kurirji še niso dodani.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ocena časa naročil</CardTitle>
          <CardDescription>Kuhinja ostane skupna za hrano in mešana naročila. Naročilo, sestavljeno samo iz kategorij pijač, uporablja ločeno barsko vrsto.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm font-semibold">Kuhinja</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {([
              ["osnovniCasMin", "Osnovni čas kuhinje", "1–120 min"],
              ["cakalnaVrstaMin", "Čakalna vrsta kuhinje", "0–60 min"],
              ["kapaciteta", "Kapaciteta kuhinje", "1–50"],
              ["najvecCasMin", "Največji čas kuhinje", "5–240 min"],
              ["zaokrozevanjeMin", "Zaokroževanje kuhinje", "0–60 min"],
            ] as const).map(([field, label, hint]) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`telefon-${field}`}>{label}</Label>
                <Input id={`telefon-${field}`} type="number" min="0" step="1" value={telefon[field]} onChange={event => setTelefon(current => ({ ...current, [field]: event.target.value }))} />
                <p className="text-xs text-muted-foreground">{hint}{field === "zaokrozevanjeMin" ? " (0 = izklopljeno)" : ""}</p>
              </div>
            ))}
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-sm font-semibold">Točilnica — samo naročila pijač</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {([
              ["pijacaOsnovniCasMin", "Osnovni čas pijač", "1–120 min"],
              ["pijacaCakalnaVrstaMin", "Čakalna vrsta pijač", "0–60 min"],
              ["pijacaKapaciteta", "Kapaciteta pijač", "1–50"],
              ["pijacaNajvecCasMin", "Največji čas pijač", "5–240 min"],
              ["pijacaZaokrozevanjeMin", "Zaokroževanje pijač", "0–60 min"],
            ] as const).map(([field, label, hint]) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`telefon-${field}`}>{label}</Label>
                <Input id={`telefon-${field}`} type="number" min="0" step="1" value={telefon[field]} onChange={event => setTelefon(current => ({ ...current, [field]: event.target.value }))} />
                <p className="text-xs text-muted-foreground">{hint}{field === "pijacaZaokrozevanjeMin" ? " (0 = izklopljeno)" : ""}</p>
              </div>
            ))}
            </div>
          </div>
          <Button size="sm" onClick={saveTelefon} disabled={nastavitveLoading || telefonSaving}>{telefonSaving ? "Shranjujem …" : "Shrani oceno časa"}</Button>
        </CardContent>
      </Card>

      {enotaId != null && <CtiSettings enotaId={enotaId} />}
    </div>
  );
}