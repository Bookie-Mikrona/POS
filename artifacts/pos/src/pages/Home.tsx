import { useEffect, useRef, useState, useCallback } from "react";
import { shouldSkipAutoStart, clearSkipAutoStart, setSkipAutoStart } from "@/lib/autoStartGuard";
import { useAutoStart } from "@/contexts/AutoStartContext";
import { Link, useLocation, useSearch } from "wouter";
import { useListMize, useListAktivnaNarocila, useCreateNarocilo, useUpdateMiza, useUpdateNarocilo, useListProstori, getListAktivnaNarocilaQueryKey, getListMizeQueryKey } from "@workspace/api-client-react";
import type { Miza, Narocilo } from "@workspace/api-client-react";
import { useNaprava } from "@/contexts/NapravaContext";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, MicOff, Plus, Users, UtensilsCrossed, X, CalendarClock, Unlock, ShoppingCart, AlertTriangle, ReceiptText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useGlasovniUkaz } from "@/hooks/use-glasovni-ukaz";

// ── Tloris floor-plan constants (must match TlorisEditor in Settings) ────────
const TLORIS_W = 700;
const TLORIS_H = 440;
const TLORIS_CW = 88;
const TLORIS_CH = 54;

// Read-only floor plan view rendered on the Home screen
function TlorisPregled({
  vseMize,
  filtriraneMize,
  narocila,
  cardProps,
}: {
  vseMize: Miza[];
  filtriraneMize: Miza[];
  narocila: Narocilo[];
  cardProps: {
    onCreateNarocilo: (mizaId?: number) => void;
    onCancelNarocilo: (narociloId: number, mizaId: number) => void;
    onToggleRezervirano: (miza: Miza) => void;
    isPending: boolean;
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ mizaId: number; x: number; y: number } | null>(null);

  // Build a set of filtered IDs for dimming
  const filteredIds = new Set(filtriraneMize.map(m => m.id));

  return (
    <div
      ref={containerRef}
      className="relative border-2 border-dashed border-border rounded-xl bg-stone-50 overflow-hidden w-full"
      style={{ aspectRatio: `${TLORIS_W}/${TLORIS_H}` }}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* Dot grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          <pattern id="hp-tloris-dots" x="0" y="0"
            width={`${(50 / TLORIS_W) * 100}%`}
            height={`${(50 / TLORIS_H) * 100}%`}
            patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" className="text-gray-300" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hp-tloris-dots)" />
      </svg>

      {vseMize.map(m => {
        if (m.posX == null || m.posY == null) return null;
        const aktivnoNarocilo = narocila.find(n => n.mizaId === m.id && n.status === "odprto");
        const isFiltered = filteredIds.has(m.id);

        const postavke = (aktivnoNarocilo?.postavke ?? []).filter((p: any) => p.parentPostavkaId == null);
        const zaracunanoSt = postavke.filter((p: any) => p.racunId != null).length;
        const imaDelniRacun = zaracunanoSt > 0 && zaracunanoSt < postavke.length;
        const imaVseZaracunano = postavke.length > 0 && zaracunanoSt === postavke.length;

        const borderColor =
          !aktivnoNarocilo ? (m.status === "rezervirana" ? "border-yellow-400" : "border-green-400") :
          imaVseZaracunano ? "border-teal-400" :
          imaDelniRacun ? "border-orange-400" :
          "border-red-400";

        const bgColor =
          !aktivnoNarocilo ? (m.status === "rezervirana" ? "bg-yellow-50" : "bg-green-50") :
          imaVseZaracunano ? "bg-teal-50" :
          imaDelniRacun ? "bg-orange-50" :
          "bg-red-50";

        return (
          <button
            key={m.id}
            className={`absolute border-2 rounded-md flex flex-col items-center justify-center text-center transition-all hover:shadow-lg hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary ${borderColor} ${bgColor} ${!isFiltered ? "opacity-30" : ""}`}
            style={{
              left: `${(m.posX / TLORIS_W) * 100}%`,
              top: `${(m.posY / TLORIS_H) * 100}%`,
              width: `${(TLORIS_CW / TLORIS_W) * 100}%`,
              height: `${(TLORIS_CH / TLORIS_H) * 100}%`,
            }}
            onClick={() => {
              if (!isFiltered) return;
              if (aktivnoNarocilo && (aktivnoNarocilo.postavke ?? []).filter((p: any) => p.parentPostavkaId == null).length > 0) {
                cardProps.onCreateNarocilo(m.id); // will navigate to existing
              } else {
                cardProps.onCreateNarocilo(m.id);
              }
            }}
            title={m.ime || `Miza ${m.stevilka}`}
          >
            <span className="text-[clamp(7px,1.2vw,12px)] font-bold leading-tight px-0.5 truncate w-full text-center">
              {m.ime || `M${m.stevilka}`}
            </span>
            {aktivnoNarocilo && (
              <span className="text-[clamp(6px,0.9vw,10px)] font-medium leading-tight">
                {aktivnoNarocilo.skupaj.toFixed(0)}€
              </span>
            )}
          </button>
        );
      })}

      {/* Mize brez pozicije — prikaži v mini mreži pod platnom */}
      {(() => {
        const brezPos = filtriraneMize.filter(m => m.posX == null || m.posY == null);
        if (brezPos.length === 0) return null;
        return (
          <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-1">
            {brezPos.map(m => {
              const aktivnoNarocilo = narocila.find(n => n.mizaId === m.id && n.status === "odprto");
              return (
                <button
                  key={m.id}
                  className="text-[clamp(7px,1vw,11px)] font-medium border rounded px-1 py-0.5 bg-white hover:bg-muted transition-colors"
                  onClick={() => cardProps.onCreateNarocilo(m.id)}
                  title={m.ime || `Miza ${m.stevilka}`}
                >
                  {m.ime || `M${m.stevilka}`}
                  {aktivnoNarocilo && <span className="ml-0.5 text-red-600">●</span>}
                </button>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

function MizaCard({ miza, aktivnoNarocilo, onCreateNarocilo, onCancelNarocilo, onToggleRezervirano, isPending }: {
  miza: Miza;
  aktivnoNarocilo: Narocilo | undefined;
  onCreateNarocilo: (mizaId?: number) => void;
  onCancelNarocilo: (narociloId: number, mizaId: number) => void;
  onToggleRezervirano: (miza: Miza) => void;
  isPending: boolean;
}) {
  const postavke = (aktivnoNarocilo?.postavke ?? []).filter(p => p.parentPostavkaId == null);
  const isEmpty = aktivnoNarocilo && postavke.length === 0;

  const zaracunanoSt = postavke.filter(p => p.racunId != null).length;
  const imaDelniRacun = zaracunanoSt > 0 && zaracunanoSt < postavke.length;
  const imaVseZaracunano = postavke.length > 0 && zaracunanoSt === postavke.length;

  return (
    <Card
      className={`flex flex-col h-full border-l-4 transition-all hover-elevate ${
        miza.status === "prosta" ? "border-l-green-500" :
        imaVseZaracunano ? "border-l-teal-500" :
        imaDelniRacun ? "border-l-orange-500" :
        miza.status === "zasedena" ? "border-l-red-500" :
        "border-l-yellow-500"
      }`}
    >
      <CardHeader className="pb-1 px-3 pt-3 md:px-6 md:pt-6 md:pb-2">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base md:text-xl">{miza.ime || `Miza ${miza.stevilka}`}</CardTitle>
            {aktivnoNarocilo?.ddvNeskladje?.imaNeskladje && (
              <span
                title="DDV neskladje — izdaja računa bo morda zavrnjena"
                className="inline-flex items-center text-yellow-500"
                data-testid="ddv-neskladje-indikator"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
          <div className="flex items-center text-muted-foreground text-xs md:text-sm">
            <Users className="w-3 h-3 md:w-4 md:h-4 mr-1" />
            {miza.kapaciteta}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-1 px-3 md:px-6 md:pb-2">
        {aktivnoNarocilo ? (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">Odprto naročilo</p>
            <p className="text-lg md:text-2xl font-bold">{aktivnoNarocilo.skupaj.toFixed(2)} €</p>
            <p className="text-xs text-muted-foreground">
              {postavke.length || 0} artiklov
            </p>
            {(() => {
              const vseSt = postavke.length;
              const zaracunanoZnesek = postavke
                .filter(p => p.racunId != null)
                .reduce((s, p) => s + Number(p.skupaj), 0);
              const odprtZnesek = postavke
                .filter(p => p.racunId == null)
                .reduce((s, p) => s + Number(p.skupaj), 0);

              if (zaracunanoSt > 0 && zaracunanoSt < vseSt) {
                return (
                  <div className="flex flex-col gap-0.5 mt-1" data-testid="delni-racun-indikator">
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                      title="Del naročila je že zaračunan"
                    >
                      <ReceiptText className="w-3 h-3 shrink-0" />
                      {zaracunanoSt}/{vseSt} zaračunano
                    </span>
                    <span className="text-[10px] text-muted-foreground pl-0.5">
                      <span className="text-amber-700 font-medium">{zaracunanoZnesek.toFixed(2)} € zaračunano</span>
                      {" · "}
                      <span className="font-medium">{odprtZnesek.toFixed(2)} € odprto</span>
                    </span>
                  </div>
                );
              }
              if (zaracunanoSt > 0 && zaracunanoSt === vseSt) {
                return (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 mt-1"
                    title="Vse postavke so zaračunane"
                    data-testid="delni-racun-indikator"
                  >
                    <ReceiptText className="w-3 h-3 shrink-0" />
                    Vse zaračunano
                  </span>
                );
              }
              return null;
            })()}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground py-2">
            <p className="text-xs md:text-sm text-center">Ni odprtih naročil</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0 px-3 pb-3 md:px-6 md:pb-4 flex flex-col gap-2">
        {aktivnoNarocilo ? (
          <>
            {isEmpty ? (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => onCancelNarocilo(aktivnoNarocilo.id, miza.id)}
                disabled={isPending}
              >
                <X className="w-4 h-4 mr-2 text-destructive" />
                <span className="text-destructive">Zapri prazno mizo</span>
              </Button>
            ) : (
              <Button
                className="w-full h-10 md:h-9 text-sm"
                variant="secondary"
                asChild
              >
                <Link href={`/narocilo/${aktivnoNarocilo.id}`}>
                  <UtensilsCrossed className="w-4 h-4 mr-2" />
                  Odpri
                </Link>
              </Button>
            )}
          </>
        ) : miza.status === "rezervirana" ? (
          <>
            <Button
              className="w-full"
              onClick={() => onCreateNarocilo(miza.id)}
              disabled={isPending}
            >
              <Plus className="w-4 h-4 mr-2" />
              <span className="sm:hidden">Naročilo</span>
              <span className="hidden sm:inline">Novo naročilo</span>
            </Button>
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              onClick={() => onToggleRezervirano(miza)}
              disabled={isPending}
            >
              <Unlock className="w-4 h-4 mr-2" />
              <span className="sm:hidden">Sprosti</span>
              <span className="hidden sm:inline">Sprosti rezervacijo</span>
            </Button>
          </>
        ) : (
          <>
            <Button
              className="w-full"
              onClick={() => onCreateNarocilo(miza.id)}
              disabled={isPending}
            >
              <Plus className="w-4 h-4 mr-2" />
              <span className="sm:hidden">Naročilo</span>
              <span className="hidden sm:inline">Novo naročilo</span>
            </Button>
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              onClick={() => onToggleRezervirano(miza)}
              disabled={isPending}
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              Rezerviraj
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

export default function Home() {
  const { naprava } = useNaprava();
  const { data: vseMize, isLoading: loadingMize } = useListMize();
  const mize = (() => {
    if (!naprava?.dovoljeneMize?.length) return vseMize;
    const filtered = vseMize?.filter(m => naprava.dovoljeneMize!.includes(m.id));
    // Če filter vrne 0 miz, a vseMize ima mize — naprava ima napačne ID-je → pokaži vse
    if (filtered !== undefined && filtered.length === 0 && vseMize!.length > 0) return vseMize;
    return filtered;
  })();
  const { data: narocila, isLoading: loadingNarocila, isFetching: narocilaFetching } = useListAktivnaNarocila();
  const { data: prostori } = useListProstori();
  const createNarocilo = useCreateNarocilo();
  const updateMiza = useUpdateMiza();
  const updateNarocilo = useUpdateNarocilo();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { poslusam, zacni: zacniGlasovno, ustavi: ustaviGlasovno } = useGlasovniUkaz();

  const handleToggleRezervirano = (miza: Miza) => {
    const noviStatus = miza.status === "rezervirana" ? "prosta" : "rezervirana";
    updateMiza.mutate(
      { id: miza.id, data: { stevilka: miza.stevilka, kapaciteta: miza.kapaciteta, ime: miza.ime ?? null, status: noviStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
          toast({
            title: noviStatus === "rezervirana" ? "Miza rezervirana" : "Rezervacija sproščena",
          });
        },
        onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče spremeniti statusa mize.", variant: "destructive" }),
      }
    );
  };

  const handleCancelNarocilo = (narociloId: number, mizaId: number) => {
    updateNarocilo.mutate({ id: narociloId, data: { status: "preklicano" } }, {
      onSuccess: () => {
        setSkipAutoStart();
        queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
        toast({ title: "Miza sproščena", description: "Prazno naročilo je bilo preklicano." });
      },
      onError: () => {
        toast({ title: "Napaka", description: "Ni bilo mogoče preklicati naročila.", variant: "destructive" });
      }
    });
  };

  const handleGlasovniUkaz = () => {
    if (poslusam) { ustaviGlasovno(); return; }
    const uspelo = zacniGlasovno({
      onResult: (tekst) => {
        const q = tekst.toLowerCase().trim();
        const ujemanje = q.match(/odpri(?:\s+mi[zs]o?)?\s+(.+)/);
        if (!ujemanje) {
          toast({ title: "Ukaz ni prepoznan", description: `Slišano: "${tekst}". Reci npr. "odpri mizo 3" ali "odpri bar".`, variant: "destructive" });
          return;
        }
        const iskanje = ujemanje[1].trim();
        const stevilka = parseInt(iskanje, 10);
        const najdena = (mize ?? []).find(m => {
          if (!isNaN(stevilka) && m.stevilka === stevilka) return true;
          if (m.ime && m.ime.toLowerCase().includes(iskanje)) return true;
          if (!isNaN(stevilka) && m.ime && m.ime.toLowerCase().includes(String(stevilka))) return true;
          return false;
        });
        if (!najdena) {
          toast({ title: "Miza ni najdena", description: `Ni mize za "${iskanje}".`, variant: "destructive" });
          return;
        }
        const obstoječe = (narocila ?? []).find(n => n.mizaId === najdena.id && n.status === "odprto");
        if (obstoječe) {
          setLocation(`/narocilo/${obstoječe.id}`);
        } else {
          handleCreateNarocilo(najdena.id);
        }
      },
      onError: () => toast({ title: "Napaka mikrofona", description: "Ni bilo mogoče prepoznati govora.", variant: "destructive" }),
    });
    if (!uspelo) {
      toast({ title: "Glasovni vnos ni podprt", description: "Vaš brskalnik ne podpira prepoznavanja govora.", variant: "destructive" });
    }
  };

  const handleCreateNarocilo = (mizaId?: number) => {
    setSkipAutoStart(); // SINHRONNO — postavi sessionStorage zastavico preden karkoli drugega
    block(); // blokira avtostart ne glede na to ali je klik ročen ali avtomatski
    // Če za to mizo že obstaja odprto naročilo, ga le odpri (ne ustvari novega)
    if (mizaId != null) {
      const obstoječe = narocila?.find(n => n.mizaId === mizaId && n.status === "odprto");
      if (obstoječe) {
        setLocation(`/narocilo/${obstoječe.id}`);
        return;
      }
    }
    const miza = mizaId != null ? mize?.find(m => m.id === mizaId) : undefined;
    createNarocilo.mutate({ data: { mizaId: mizaId ?? null } }, {
      onSuccess: (narocilo) => {
        // clearSkipAutoStart() se ne kliče tukaj — sessionStorage se briše šele ko se dodajo artikli
        if (miza && mizaId != null) {
          updateMiza.mutate({
            id: mizaId,
            data: { stevilka: miza.stevilka, kapaciteta: miza.kapaciteta, ime: miza.ime ?? null, status: "zasedena" }
          }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ["/api/mize"] });
            }
          });
        }
        setLocation(`/narocilo/${narocilo.id}`);
      },
      onError: (err: unknown) => {
        const body = (err as { data?: { code?: string; error?: string } })?.data;
        if (body?.code === "MISSING_ZACETNE_ZALOGE") {
          toast({ title: "Začetne zaloge niso vnesene", description: body.error ?? "Pred prvim naročilom vnesite začetne zaloge v razdelku Zaloge.", variant: "destructive", duration: 8000 });
        } else {
          toast({ title: "Napaka", description: "Ni bilo mogoče ustvariti naročila.", variant: "destructive" });
        }
      }
    });
  };

  const handleDirektna = () => {
    block();
    const obstoječe = narocila?.find(n => n.status === "odprto" && n.mizaId == null);
    if (obstoječe) {
      clearSkipAutoStart();
      setLocation(`/narocilo/${obstoječe.id}`);
    } else {
      handleCreateNarocilo();
    }
  };

  const search = useSearch();

  const [aktivniFilter, setAktivniFilter] = useState<"vse" | "prosta" | "zasedena" | "delno_zaracunana" | "vse_zaracunano" | "rezervirana">("vse");

  const { blocked, block } = useAutoStart();

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (mize === undefined || narocila === undefined || narocilaFetching || autoStartedRef.current) return;

    const urlSkip = new URLSearchParams(search).has("skipAutoStart");

    // Naprava ima natanko eno dovoljeno mizo — enako kot direktna prodaja:
    // avtostart samo ko ni odprtega naročila za to mizo
    if (naprava?.dovoljeneMize?.length === 1 && mize.length === 1) {
      const mizaId = mize[0].id;
      const openOrder = narocila.find(n => n.mizaId === mizaId && n.status === "odprto");
      if (openOrder) {
        // Odprto naročilo obstaja (morda zastareli predpomnilnik) —
        // NE nastavimo autoStartedRef, da efekt preveri znova ko pridejo svežji podatki
        return;
      }
      // Ni odprtega naročila — zavrti avtostart, razen če smo pravkar prišli iz preklica
      if (urlSkip) { autoStartedRef.current = true; return; }
      autoStartedRef.current = true;
      block();
      handleCreateNarocilo(mizaId);
      return;
    }

    // Ni nastavljenih miz → direktna prodaja (le če ni že odprtih naročil in ni blokade)
    if (mize.length === 0 && narocila.length === 0) {
      const shouldSkip = urlSkip || shouldSkipAutoStart();
      if (shouldSkip) {
        autoStartedRef.current = true;
        return;
      }
      autoStartedRef.current = true;
      block();
      handleDirektna();
    }
  }, [mize, narocila, narocilaFetching, search, naprava]);

  if (loadingMize || loadingNarocila) {
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Pregled miz</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const isPending = createNarocilo.isPending || updateMiza.isPending || updateNarocilo.isPending;

  const getMizaEfektivniStatus = (miza: Miza) => {
    const narocilo = narocila?.find(n => n.mizaId === miza.id && n.status === "odprto");
    if (!narocilo) return miza.status;
    const postavke = (narocilo.postavke ?? []).filter(p => p.parentPostavkaId == null);
    const zaracunanoSt = postavke.filter(p => p.racunId != null).length;
    if (zaracunanoSt > 0 && zaracunanoSt === postavke.length) return "vse_zaracunano";
    if (zaracunanoSt > 0 && zaracunanoSt < postavke.length) return "delno_zaracunana";
    return miza.status;
  };

  const filtriraneMize = (seznam: Miza[]) => {
    if (aktivniFilter === "vse") return seznam;
    return seznam.filter(m => getMizaEfektivniStatus(m) === aktivniFilter);
  };

  const cardProps = {
    onCreateNarocilo: handleCreateNarocilo,
    onCancelNarocilo: handleCancelNarocilo,
    onToggleRezervirano: handleToggleRezervirano,
    isPending,
  };

  const renderMizaCard = (miza: Miza) => {
    const aktivnoNarocilo = narocila?.find(n => n.mizaId === miza.id && n.status === "odprto");
    return (
      <MizaCard
        key={miza.id}
        miza={miza}
        aktivnoNarocilo={aktivnoNarocilo}
        {...cardProps}
      />
    );
  };

  const prostoriSeznam = prostori ?? [];
  const hasProstori = prostoriSeznam.length > 0;

  type FilterOption = { id: typeof aktivniFilter; label: string; aktivnaClass: string; neaktivnaClass: string };
  const filterMoznosti: FilterOption[] = [
    { id: "vse", label: "Vse", aktivnaClass: "bg-foreground text-background border-foreground", neaktivnaClass: "bg-background text-foreground border-border hover:bg-muted" },
    { id: "prosta", label: "Prosta", aktivnaClass: "bg-green-600 text-white border-green-600", neaktivnaClass: "bg-green-50 text-green-800 border-green-200 hover:bg-green-100" },
    { id: "zasedena", label: "Zasedena", aktivnaClass: "bg-red-600 text-white border-red-600", neaktivnaClass: "bg-red-50 text-red-800 border-red-200 hover:bg-red-100" },
    { id: "delno_zaracunana", label: "Delno zaračunana", aktivnaClass: "bg-orange-500 text-white border-orange-500", neaktivnaClass: "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100" },
    { id: "vse_zaracunano", label: "Vse zaračunano", aktivnaClass: "bg-teal-600 text-white border-teal-600", neaktivnaClass: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100" },
    { id: "rezervirana", label: "Rezervirana", aktivnaClass: "bg-yellow-500 text-white border-yellow-500", neaktivnaClass: "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100" },
  ];

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6 flex-1 overflow-auto">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pregled miz</h1>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 transition-colors ${poslusam ? "text-red-500 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleGlasovniUkaz}
            title={poslusam ? "Poslušam… klikni za zaustavitev" : "Glasovni ukaz (npr. »odpri mizo 3«)"}
          >
            {poslusam ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        </div>
        {(mize?.length ?? 0) === 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDirektna}
              disabled={isPending}
              className="shrink-0"
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              <span>Direktna prodaja</span>
            </Button>
          </div>
        )}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {filterMoznosti.map(f => (
          <button
            key={f.id}
            onClick={() => setAktivniFilter(f.id)}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] md:text-xs font-semibold transition-colors cursor-pointer ${aktivniFilter === f.id ? f.aktivnaClass : f.neaktivnaClass}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {(mize?.length ?? 0) === 0 && mize !== undefined ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 text-muted-foreground">
          <ShoppingCart className="w-12 h-12 opacity-30" />
          <div className="space-y-1">
            <p className="text-base font-medium">Ni nastavljenih miz</p>
            <p className="text-sm">Mize dodajte v Nastavitvah ali začnite z direktno prodajo.</p>
          </div>
          <Button onClick={handleDirektna} disabled={isPending}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Direktna prodaja
          </Button>
        </div>
      ) : hasProstori ? (
        <div className="space-y-6 md:space-y-8">
          {prostoriSeznam.map(prostor => {
            const vseMizeProstora = mize?.filter(m => m.prostorId === prostor.id) ?? [];
            const mizeProstora = filtriraneMize(vseMizeProstora);
            if (mizeProstora.length === 0) return null;

            // Tlorisni prikaz: pokažemo ga, ko ima vsaj ena miza v prostoru nastavljeno pozicijo
            const imaTloris = vseMizeProstora.some(m => m.posX != null && m.posY != null);

            return (
              <div key={prostor.id}>
                <h2 className="text-base md:text-lg font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border hidden sm:block" />
                  {prostor.ime}
                  <span className="h-px flex-1 bg-border" />
                </h2>
                {imaTloris ? (
                  <TlorisPregled
                    vseMize={vseMizeProstora}
                    filtriraneMize={mizeProstora}
                    narocila={narocila ?? []}
                    cardProps={cardProps}
                  />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                    {mizeProstora.map(renderMizaCard)}
                  </div>
                )}
              </div>
            );
          })}
          {(() => {
            const brezProstora = filtriraneMize(mize?.filter(m => m.prostorId == null) ?? []);
            if (brezProstora.length === 0) return null;
            return (
              <div>
                <h2 className="text-base md:text-lg font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border hidden sm:block" />
                  Ostalo
                  <span className="h-px flex-1 bg-border" />
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                  {brezProstora.map(renderMizaCard)}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {filtriraneMize(mize ?? []).map(renderMizaCard)}
        </div>
      )}
      {aktivniFilter !== "vse" && (mize?.length ?? 0) > 0 && filtriraneMize(mize ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-2 text-muted-foreground">
          <p className="text-sm">Ni miz z izbranim statusom.</p>
          <button onClick={() => setAktivniFilter("vse")} className="text-xs underline underline-offset-2 hover:text-foreground transition-colors">
            Prikaži vse mize
          </button>
        </div>
      )}
    </div>
  );
}
