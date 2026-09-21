import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, RefreshCw, ShieldAlert, Users } from "lucide-react";
import {
  getListRazpolozljiveMizeQueryKey,
  useListRazpolozljiveMize,
  type Miza,
  type MizaRazpolozljivost,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatIsoToLjubljanaDatetimeLocal,
  parseLjubljanaDatetimeToISO,
} from "@/components/RezervacijaDialog";
import { formatPosCas } from "@/lib/posCas";

function privzetiTermin(): string {
  const naslednjiTermin = new Date(Date.now() + 60 * 60 * 1000);
  naslednjiTermin.setUTCMinutes(Math.ceil(naslednjiTermin.getUTCMinutes() / 15) * 15, 0, 0);
  return formatIsoToLjubljanaDatetimeLocal(naslednjiTermin.toISOString());
}

function opisStanja(rezultat: MizaRazpolozljivost): string {
  if (rezultat.stanje === "rezervirana") {
    const rezervacija = rezultat.konfliktnaRezervacija;
    return rezervacija
      ? `${rezervacija.strankaIme} · ${formatPosCas(rezervacija.zacetek)}`
      : "Konflikt z drugo rezervacijo";
  }
  if (rezultat.stanje === "zasedena") {
    return rezultat.steviloOdprtihNarocil > 0
      ? `Trenutno ${rezultat.steviloOdprtihNarocil} odprt${rezultat.steviloOdprtihNarocil === 1 ? "o naročilo" : "i naročili"}`
      : "Miza je trenutno zasedena, prihodnji termin pa je prost";
  }
  return "Na voljo za rezervacijo";
}

export function RazpolozljivostMizDialog({
  open,
  onOpenChange,
  onIzberiMizo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIzberiMizo: (miza: Miza, zacetekIso: string) => void;
}) {
  const [datum, setDatum] = useState("");
  const [ura, setUra] = useState("");
  const [steviloOseb, setSteviloOseb] = useState(2);

  useEffect(() => {
    if (!open || (datum && ura)) return;
    const termin = privzetiTermin();
    const [novDatum, novaUra] = termin.split("T");
    setDatum(novDatum ?? "");
    setUra(novaUra ?? "");
  }, [open, datum, ura]);

  const lokalniTermin = datum && ura ? `${datum}T${ura}` : "";
  const zacetekIso = lokalniTermin ? parseLjubljanaDatetimeToISO(lokalniTermin) : "";
  const terminJeVeljaven = Boolean(
    zacetekIso
    && formatIsoToLjubljanaDatetimeLocal(zacetekIso) === lokalniTermin
    && new Date(zacetekIso).getTime() > Date.now(),
  );
  const osebeSoVeljavne = Number.isInteger(steviloOseb) && steviloOseb >= 1 && steviloOseb <= 100;

  const query = useListRazpolozljiveMize(
    {
      zacetek: zacetekIso || new Date(0).toISOString(),
      steviloOseb: osebeSoVeljavne ? steviloOseb : 1,
    },
    {
      query: {
        queryKey: getListRazpolozljiveMizeQueryKey({
          zacetek: zacetekIso || new Date(0).toISOString(),
          steviloOseb: osebeSoVeljavne ? steviloOseb : 1,
        }),
        enabled: open && terminJeVeljaven && osebeSoVeljavne,
        staleTime: 0,
        refetchInterval: open ? 15_000 : false,
        refetchOnWindowFocus: true,
      },
    },
  );

  const skupine = useMemo(() => {
    const poProstorih = new Map<string, { ime: string; rezultati: MizaRazpolozljivost[] }>();
    for (const rezultat of query.data ?? []) {
      const kljuc = rezultat.miza.prostorId == null ? "brez-prostora" : String(rezultat.miza.prostorId);
      const skupina = poProstorih.get(kljuc) ?? {
        ime: rezultat.prostorIme ?? "Ostalo",
        rezultati: [],
      };
      skupina.rezultati.push(rezultat);
      poProstorih.set(kljuc, skupina);
    }
    return Array.from(poProstorih.entries()).map(([id, skupina]) => ({ id, ...skupina }));
  }, [query.data]);
  const steviloProstih = (query.data ?? []).filter((rezultat) => rezultat.naVoljo).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90dvh]" data-testid="razpolozljivost-miz-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Poišči prosto mizo
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm font-medium">
            <span>Datum</span>
            <Input
              type="date"
              value={datum}
              onInput={(event) => setDatum(event.currentTarget.value)}
              data-testid="razpolozljivost-datum"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Ura</span>
            <Input
              type="time"
              step={900}
              value={ura}
              onInput={(event) => setUra(event.currentTarget.value)}
              data-testid="razpolozljivost-ura"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Število oseb</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={steviloOseb}
              onInput={(event) => setSteviloOseb(event.currentTarget.valueAsNumber)}
              data-testid="razpolozljivost-osebe"
            />
          </label>
        </div>

        {!terminJeVeljaven && lokalniTermin && (
          <p className="text-sm font-medium text-destructive">Izberite veljaven termin v prihodnosti.</p>
        )}
        {!osebeSoVeljavne && (
          <p className="text-sm font-medium text-destructive">Število oseb mora biti med 1 in 100.</p>
        )}

        <div className="min-h-32 flex-1 overflow-y-auto pr-1">
          {query.isFetching && !query.data ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Preverjam razpoložljivost…
            </div>
          ) : query.isError ? (
            <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-destructive">Razpoložljivosti ni bilo mogoče preveriti.</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Poskusi znova
              </Button>
            </div>
          ) : terminJeVeljaven && osebeSoVeljavne && (query.data?.length ?? 0) === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Users className="h-7 w-7 opacity-50" />
              <p className="text-sm">Ni miz z zadostno kapaciteto za {steviloOseb} oseb.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {query.data && query.data.length > 0 && steviloProstih === 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  Za ta termin ni proste mize. Spodaj so prikazane rezervirane in zasedene mize.
                </div>
              )}
              {skupine.map((skupina) => (
                <section key={skupina.id} data-testid={`razpolozljivost-prostor-${skupina.id}`}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {skupina.ime}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {skupina.rezultati.map((rezultat) => {
                      const jeProsta = rezultat.stanje === "prosta";
                      const jeNaVoljo = rezultat.naVoljo;
                      return (
                        <div
                          key={rezultat.miza.id}
                          className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                            jeProsta
                              ? "border-green-200 bg-green-50"
                              : rezultat.stanje === "rezervirana"
                                ? "border-amber-200 bg-amber-50"
                                : "border-red-200 bg-red-50"
                          }`}
                          data-testid={`razpolozljivost-miza-${rezultat.miza.id}`}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold">
                                {rezultat.miza.ime || `Miza ${rezultat.miza.stevilka}`}
                              </p>
                              <Badge variant="outline" className="bg-white/70">
                                <Users className="mr-1 h-3 w-3" />
                                {rezultat.miza.kapaciteta}
                              </Badge>
                            </div>
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock3 className="h-3 w-3 shrink-0" />
                              {opisStanja(rezultat)}
                            </p>
                          </div>
                          {jeNaVoljo ? (
                            <Button
                              size="sm"
                              onClick={() => onIzberiMizo(rezultat.miza, zacetekIso)}
                              data-testid={`izberi-prosto-mizo-${rezultat.miza.id}`}
                            >
                              {jeProsta ? "Izberi" : "Rezerviraj"}
                            </Button>
                          ) : (
                            <Badge
                              className={
                                rezultat.stanje === "rezervirana"
                                  ? "bg-amber-100 text-amber-900 hover:bg-amber-100"
                                  : "bg-red-100 text-red-900 hover:bg-red-100"
                              }
                            >
                              {rezultat.stanje === "rezervirana" ? "Rezervirana" : "Zasedena"}
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {query.isFetching && query.data && (
          <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Osvežujem…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}