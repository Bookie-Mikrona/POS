import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Clock3, Phone, Search, Truck } from "lucide-react";
import { getEnotaId, getGetDostavaPredogledQueryKey, useCreateNarocilo, useGetDostavaPredogled } from "@workspace/api-client-react";
import type { NarociloInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Naselje = {
  id: number;
  naziv: string;
  aktivno: boolean;
};

type Naslov = {
  id: number;
  ulica: string;
  hisnaStevilka: string;
  vhod?: string | null;
  nadstropje?: string | null;
  naseljeId: number;
  navodilo?: string | null;
  privzet: boolean;
  naselje?: { id: number; naziv: string; aktivno: boolean | null } | null;
};

type Narocnik = {
  id: number;
  ime: string;
  telefon: string;
  naslovi: Naslov[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (narocilo: { id: number }) => void;
  onBlockAutoStart: () => void;
  initialTelefon?: string | null;
};

function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

function posRequestInit(): RequestInit {
  const enotaId = getEnotaId();
  return {
    credentials: "include",
    headers: enotaId ? { "X-Enota-Id": enotaId } : {},
  };
}

function praznaForma() {
  return {
    telefon: "",
    ime: "",
    nacinIzpolnitve: "prevzem" as "prevzem" | "dostava",
    naslovId: "new",
    ulica: "",
    hisnaStevilka: "",
    vhod: "",
    nadstropje: "",
    naseljeId: "",
    navodilo: "",
  };
}

export function TelefonNarociloDialog({ open, onOpenChange, onCreated, onBlockAutoStart, initialTelefon }: Props) {
  const { toast } = useToast();
  const createNarocilo = useCreateNarocilo();
  const [form, setForm] = useState(praznaForma);
  const [narocnik, setNarocnik] = useState<Narocnik | null>(null);
  const [iskanjeVteku, setIskanjeVteku] = useState(false);
  const [naselja, setNaselja] = useState<Naselje[]>([]);
  const [naseljaLoading, setNaseljaLoading] = useState(false);
  const [naseljaNapaka, setNaseljaNapaka] = useState(false);
  const [napakaOddaje, setNapakaOddaje] = useState<string | null>(null);

  const izbranoNaselje = useMemo(
    () => naselja.find(n => String(n.id) === form.naseljeId) ?? null,
    [naselja, form.naseljeId],
  );
  const izbraniNaslov = useMemo(
    () => narocnik?.naslovi.find(n => String(n.id) === form.naslovId) ?? null,
    [narocnik, form.naslovId],
  );

  useEffect(() => {
    if (!open) return;
    setForm({ ...praznaForma(), telefon: initialTelefon?.trim() ?? "" });
    setNarocnik(null);
    setNaseljaNapaka(false);
    setNapakaOddaje(null);
    let preklicano = false;
    setNaseljaLoading(true);
    fetch(apiUrl("/api/naselja"), posRequestInit())
      .then(async response => {
        if (!response.ok) throw new Error("Naselij ni bilo mogoče naložiti.");
        return response.json() as Promise<Naselje[]>;
      })
      .then(data => {
        if (!preklicano) setNaselja(data.filter(n => n.aktivno));
      })
      .catch(() => {
        if (!preklicano) setNaseljaNapaka(true);
      })
      .finally(() => {
        if (!preklicano) setNaseljaLoading(false);
      });
    return () => { preklicano = true; };
  }, [open, initialTelefon]);

  useEffect(() => {
    const telefon = form.telefon.trim();
    if (!open || telefon.replace(/\D/g, "").length < 6) {
      setNarocnik(null);
      setIskanjeVteku(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIskanjeVteku(true);
      fetch(apiUrl(`/api/narocniki/po-telefonu?telefon=${encodeURIComponent(telefon)}`), posRequestInit())
        .then(async response => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error();
          return response.json() as Promise<Narocnik>;
        })
        .then(found => {
          setNarocnik(found);
          if (found) {
            const naslov = found.naslovi.find(n => n.privzet && n.naselje?.aktivno) ?? found.naslovi.find(n => n.naselje?.aktivno);
            setForm(current => ({
              ...current,
              ime: found.ime,
              naslovId: naslov ? String(naslov.id) : "new",
              ...(naslov ? {
                ulica: naslov.ulica,
                hisnaStevilka: naslov.hisnaStevilka,
                vhod: naslov.vhod ?? "",
                nadstropje: naslov.nadstropje ?? "",
                naseljeId: String(naslov.naseljeId),
                navodilo: naslov.navodilo ?? "",
              } : {}),
            }));
          }
        })
        .catch(() => setNarocnik(null))
        .finally(() => setIskanjeVteku(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.telefon, open]);

  const dostavaPredogledQuery = useGetDostavaPredogled(
    { naseljeId: Number(form.naseljeId) },
    {
      query: {
        enabled: open && form.nacinIzpolnitve === "dostava" && izbranoNaselje?.aktivno === true,
        queryKey: getGetDostavaPredogledQueryKey({ naseljeId: Number(form.naseljeId) }),
      },
      request: posRequestInit(),
    },
  );
  const dostavaPredogled = dostavaPredogledQuery.data;
  const dostavaPredogledLoading = dostavaPredogledQuery.isLoading;
  const dostavaPredogledNapaka = dostavaPredogledQuery.isError;

  const setField = (key: keyof ReturnType<typeof praznaForma>, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const izberiNaslov = (value: string) => {
    if (value === "new") {
      setForm(current => ({ ...current, naslovId: value, ulica: "", hisnaStevilka: "", vhod: "", nadstropje: "", naseljeId: "", navodilo: "" }));
      return;
    }
    const naslov = narocnik?.naslovi.find(n => String(n.id) === value);
    if (!naslov) return;
    setForm(current => ({
      ...current,
      naslovId: value,
      ulica: naslov.ulica,
      hisnaStevilka: naslov.hisnaStevilka,
      vhod: naslov.vhod ?? "",
      nadstropje: naslov.nadstropje ?? "",
      naseljeId: String(naslov.naseljeId),
      navodilo: naslov.navodilo ?? "",
    }));
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    setNapakaOddaje(null);
    const telefon = form.telefon.trim();
    const ime = form.ime.trim();
    if (!telefon || !ime) {
      toast({ title: "Manjkajoči podatki", description: "Vnesite ime in telefonsko številko.", variant: "destructive" });
      return;
    }
    if (form.nacinIzpolnitve === "dostava" && !form.naseljeId) {
      toast({ title: "Izberite naselje", description: "Za dostavo je naselje obvezno.", variant: "destructive" });
      return;
    }

    const data: NarociloInput = {
      nacin: "telefon",
      nacinIzpolnitve: form.nacinIzpolnitve,
      strankaIme: ime,
      strankaTelefon: telefon,
    };
    if (narocnik) data.narocnikId = narocnik.id;
    if (form.nacinIzpolnitve === "dostava") {
      if (narocnik && form.naslovId !== "new") {
        data.dostavaNaslovId = Number(form.naslovId);
      } else {
        data.dostavaNaslov = {
          ulica: form.ulica.trim(),
          hisnaStevilka: form.hisnaStevilka.trim(),
          vhod: form.vhod.trim() || undefined,
          nadstropje: form.nadstropje.trim() || undefined,
          naseljeId: Number(form.naseljeId),
          navodilo: form.navodilo.trim() || undefined,
        };
      }
    }

    onBlockAutoStart();
    createNarocilo.mutate({ data }, {
      onSuccess: result => {
        onOpenChange(false);
        onCreated(result);
        toast({ title: "Telefonsko naročilo ustvarjeno" });
      },
      onError: (error: unknown) => {
        const body = (error as { data?: unknown })?.data;
        const description = body && typeof body === "object"
          ? ["error", "napaka", "message", "detail"]
            .map(key => (body as Record<string, unknown>)[key])
            .find((value): value is string => typeof value === "string" && value.trim().length > 0)
          : undefined;
        const sporocilo = description ?? (error instanceof Error ? error.message : "Telefonskega naročila ni bilo mogoče ustvariti.");
        setNapakaOddaje(sporocilo);
        toast({
          title: "Napaka",
          description: sporocilo,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Phone className="h-5 w-5" />Novo telefonsko naročilo</DialogTitle>
          <DialogDescription>Vnesite kontakt kupca in izberite prevzem ali dostavo.</DialogDescription>
        </DialogHeader>
        {napakaOddaje && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {napakaOddaje}
          </p>
        )}
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="telefon-narocila-telefon">Telefon</Label>
              <div className="relative">
                <Input id="telefon-narocila-telefon" value={form.telefon} onChange={e => setField("telefon", e.target.value)} placeholder="041 123 456" autoFocus />
                {iskanjeVteku && <Search className="absolute right-2.5 top-2.5 h-4 w-4 animate-pulse text-muted-foreground" />}
              </div>
              {narocnik && <p className="text-xs text-green-700">Najden naročnik: {narocnik.ime}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telefon-narocila-ime">Ime naročnika</Label>
              <Input id="telefon-narocila-ime" value={form.ime} onChange={e => setField("ime", e.target.value)} placeholder="Ime in priimek" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Način izpolnitve">
            {(["prevzem", "dostava"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                data-testid={`telefon-nacin-${mode}`}
                onClick={() => setField("nacinIzpolnitve", mode)}
                className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${form.nacinIzpolnitve === mode ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
              >
                {mode === "prevzem" ? "Prevzem" : "Dostava"}
              </button>
            ))}
          </div>

          {form.nacinIzpolnitve === "dostava" && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4" />Dostavni naslov</div>
              {narocnik && narocnik.naslovi.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="telefon-narocila-naslov">Shranjeni naslov</Label>
                  <select id="telefon-narocila-naslov" value={form.naslovId} onChange={e => izberiNaslov(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="new">Nov naslov</option>
                    {narocnik.naslovi.filter(n => n.naselje?.aktivno).map(n => (
                      <option key={n.id} value={n.id}>{n.ulica} {n.hisnaStevilka} · {n.naselje?.naziv ?? "Neznano naselje"}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="telefon-narocila-ulica">Ulica</Label>
                  <Input id="telefon-narocila-ulica" value={form.ulica} onChange={e => setField("ulica", e.target.value)} disabled={!!izbraniNaslov} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="telefon-narocila-hisna">Hišna št.</Label>
                  <Input id="telefon-narocila-hisna" value={form.hisnaStevilka} onChange={e => setField("hisnaStevilka", e.target.value)} disabled={!!izbraniNaslov} className="w-28" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="telefon-narocila-vhod">Vhod</Label>
                  <Input id="telefon-narocila-vhod" value={form.vhod} onChange={e => setField("vhod", e.target.value)} disabled={!!izbraniNaslov} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="telefon-narocila-nadstropje">Nadstropje</Label>
                  <Input id="telefon-narocila-nadstropje" value={form.nadstropje} onChange={e => setField("nadstropje", e.target.value)} disabled={!!izbraniNaslov} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telefon-narocila-naselje">Naselje</Label>
                <select id="telefon-narocila-naselje" value={form.naseljeId} onChange={e => setField("naseljeId", e.target.value)} disabled={!!izbraniNaslov || naseljaLoading} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                  <option value="">{naseljaLoading ? "Nalagam naselja …" : "Izberite naselje"}</option>
                  {naselja.map(n => <option key={n.id} value={n.id}>{n.naziv}</option>)}
                </select>
                {naseljaNapaka && <p className="text-xs text-destructive">Naselij ni bilo mogoče naložiti.</p>}
              </div>
              {dostavaPredogledLoading && (
                <p className="text-xs text-muted-foreground">Nalagam predogled dostave …</p>
              )}
              {dostavaPredogledNapaka && (
                <p className="text-xs text-destructive">Predogleda dostave ni bilo mogoče naložiti. Naslov lahko vseeno vnesete.</p>
              )}
              {dostavaPredogled && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-background px-3 py-2 text-sm text-muted-foreground" data-testid="telefon-naselje-podatki">
                  <span>
                    Dostavna storitev: {dostavaPredogled.storitevIme} · {dostavaPredogled.cenaNaselja > 0
                      ? `fiksna cena naselja ${dostavaPredogled.cenaNaselja.toFixed(2)} €`
                      : `${dostavaPredogled.oddaljenostKm} km × ${dostavaPredogled.cenaNaKm.toFixed(2)} € = ${dostavaPredogled.cenaDostave.toFixed(2)} €`}
                  </span>
                  <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{dostavaPredogled.casDostaveMin} min vožnje</span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="telefon-narocila-navodilo">Navodilo za dostavo</Label>
                <Input id="telefon-narocila-navodilo" value={form.navodilo} onChange={e => setField("navodilo", e.target.value)} disabled={!!izbraniNaslov} placeholder="npr. pokličite ob prihodu" />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" disabled={createNarocilo.isPending}>
              {createNarocilo.isPending ? "Ustvarjam …" : "Ustvari naročilo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}