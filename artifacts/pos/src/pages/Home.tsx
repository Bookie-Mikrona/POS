import { useEffect, useRef, useState, useCallback } from "react";
import { trackEvent } from "@/lib/analytics";
import { shouldSkipAutoStart, clearSkipAutoStart, setSkipAutoStart } from "@/lib/autoStartGuard";
import { useAutoStart } from "@/contexts/AutoStartContext";
import { Link, useLocation, useSearch } from "wouter";
import { getGetNarociloQueryKey, getListArtikliQueryKey, getListArtikliQueryOptions, getListKategorijeQueryKey, getListKategorijeQueryOptions, useListMize, useListAktivnaNarocila, useCreateNarocilo, useUpdateNarocilo, useListProstori, getListAktivnaNarocilaQueryKey, getListMizeQueryKey, useReleaseRezervacijaMize } from "@workspace/api-client-react";
import type { Miza, Narocilo, RezervacijaMize } from "@workspace/api-client-react";
import { useNaprava } from "@/contexts/NapravaContext";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, MicOff, Plus, Users, UtensilsCrossed, X, CalendarClock, Unlock, ShoppingCart, AlertTriangle, ReceiptText, Phone, Clock3, Play, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useGlasovniUkaz } from "@/hooks/use-glasovni-ukaz";
import { RezervacijaDialog } from "@/components/RezervacijaDialog";
import { RazpolozljivostMizDialog } from "@/components/RazpolozljivostMizDialog";
import { useAuth } from "@/contexts/AuthContext";
import { TelefonNarociloDialog } from "@/components/TelefonNarociloDialog";
import { KdsCountdown, KdsTypeBadge, type KdsTarget } from "@/lib/kdsNarocilo";
import { formatPosCas, formatPosDatum } from "@/lib/posCas";
import { osveziPregledMizPoTelefonu } from "@/lib/osveziPregledMiz";
import { QrGostStaffInfo } from "@/components/QrGostStaffInfo";
import {
  AGENT_OPEN_TABLE_EVENT,
  AGENT_OPEN_TABLE_STORAGE_KEY,
  resolveAgentOpenTable,
} from "@/lib/agent-table-navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQrWaiterRequests, useUpdateQrWaiterRequest, type QrWaiterRequest } from "@/hooks/use-kds";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";
import { localOrderRoute } from "@/lib/gatewayClient";

const DOSTAVA_STATUS_LABELS: Record<string, string> = {
  prejeto: "Prejeto",
  potrjeno: "Potrjeno",
  v_pripravi: "V pripravi",
  pripravljeno: "Pripravljeno",
  prevzel_kurir: "Prevzel kurir",
  dostavljeno: "Dostavljeno",
  preklicano: "Preklicano",
};

const DOSTAVA_STATUS_CLASSES: Record<string, string> = {
  prejeto: "border-slate-300 bg-slate-50 text-slate-700",
  potrjeno: "border-blue-300 bg-blue-50 text-blue-700",
  v_pripravi: "border-amber-300 bg-amber-50 text-amber-700",
  pripravljeno: "border-emerald-300 bg-emerald-50 text-emerald-700",
  prevzel_kurir: "border-violet-300 bg-violet-50 text-violet-700",
  dostavljeno: "border-green-300 bg-green-50 text-green-700",
  preklicano: "border-red-300 bg-red-50 text-red-700",
};

const ORDER_MENU_STALE_TIME = 60_000;

export function getDostavaStatusLabel(status: unknown): string | null {
  return typeof status === "string" && status in DOSTAVA_STATUS_LABELS
    ? DOSTAVA_STATUS_LABELS[status]
    : null;
}

/** Persistent operational queue for authenticated staff responding to QR calls. */
export function QrWaiterQueue({ requests, mize }: { requests: QrWaiterRequest[]; mize: Miza[] }) {
  const updateRequest = useUpdateQrWaiterRequest();
  const aktivniZahtevki = requests.filter(request => request.stanje !== "zakljuceno");
  if (!aktivniZahtevki.length) return null;
  return (
    <Card className="border-violet-200 bg-violet-50/40" data-testid="qr-waiter-queue">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-700" />
          Klic natakarja
          <Badge className="bg-violet-700">{aktivniZahtevki.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {aktivniZahtevki.map(request => {
          const miza = mize.find(item => item.id === request.mizaId);
          return (
            <div key={request.id} className="rounded-lg border border-violet-200 bg-background p-3" data-testid={`qr-waiter-request-${request.id}`}>
              <p className="font-semibold">{miza?.ime || `Miza ${miza?.stevilka ?? request.mizaId}`}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Klic ob {formatPosCas(request.ustvarjeno)}</p>
              <div className="mt-3 flex gap-2">
                {request.stanje === "caka" && (
                  <Button size="sm" variant="outline" disabled={updateRequest.isPending}
                    onClick={() => updateRequest.mutate({ id: request.id, stanje: "potrjeno" })}>
                    Potrdi
                  </Button>
                )}
                <Button size="sm" disabled={updateRequest.isPending}
                  onClick={() => updateRequest.mutate({ id: request.id, stanje: "zakljuceno" })}>
                  Zaključi
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function getAktivnoNarociloEtaTarget(
  narocilo: Pick<Narocilo, "nacin" | "nacinIzpolnitve" | "dostavaStatus" | "predvidenaDostava" | "predvidenPrevzem">,
): KdsTarget {
  const jeDostava = narocilo.nacinIzpolnitve === "dostava";
  if (jeDostava && (narocilo.dostavaStatus === "dostavljeno" || narocilo.dostavaStatus === "preklicano")) {
    return null;
  }
  const iso = jeDostava ? narocilo.predvidenaDostava : narocilo.predvidenPrevzem;
  return iso ? { iso, label: "Dostava ob" } : null;
}

export function jeAktivnoTelefonskoNarocilo(
  narocilo: Pick<Narocilo, "nacin" | "status" | "nacinIzpolnitve" | "dostavaStatus">,
): boolean {
  const jeZakljucenaDostava = narocilo.nacinIzpolnitve === "dostava"
    && (narocilo.dostavaStatus === "preklicano" || narocilo.dostavaStatus === "dostavljeno");
  return narocilo.nacin === "telefon"
    && narocilo.status === "odprto"
    && !jeZakljucenaDostava;
}

export function moraPregledMizPocakatiNaPodatke(
  loadingMize: boolean,
  loadingNarocila: boolean,
  loadingProstori: boolean,
): boolean {
  return loadingMize || loadingNarocila || loadingProstori;
}

export function jeAktivniProstorVeljaven(
  aktivniProstor: number | null,
  prostori: Array<{ id: number }>,
): boolean {
  return aktivniProstor === null || prostori.some(prostor => prostor.id === aktivniProstor);
}

import { TlorisViewer } from "@/components/TlorisViewer";
import { resolveTableVisualStatus, TABLE_CARD_BORDER_CLASS } from "@/lib/table-visual-status";

// ── Tloris floor-plan constants (must match TlorisEditor in Settings) ────────
const TLORIS_W = 700;
const TLORIS_H = 440;
const TLORIS_CW = 88;
const TLORIS_CH = 54;

export function MizaCard({ miza, aktivnaNarocila, onSelectMiza, onCancelNarocilo, onRezerviraj, isPending, rezervacijeOmogocene = true }: {
  miza: Miza;
  aktivnaNarocila: Narocilo[];
  rezervacijeOmogocene?: boolean;
  onSelectMiza: (mizaId: number) => void;
  onCancelNarocilo: (narociloId: number, mizaId: number) => void;
  onRezerviraj: (miza: Miza) => void;
  isPending: boolean;
}) {
  const aktivnoNarocilo = aktivnaNarocila[0];
  const postavke = aktivnaNarocila.flatMap(n => (n.postavke ?? []).filter(p => p.parentPostavkaId == null));
  const isEmpty = aktivnaNarocila.length === 1 && postavke.length === 0;
  const qrPripravljeno = postavke.length > 0 && postavke.every(p => !!p.pripravljeno);
  const qrNarocila = aktivnaNarocila.filter(n => n.vir === "qr_gost");
  const skupaj = aktivnaNarocila.reduce((vsota, narocilo) => vsota + narocilo.skupaj, 0);
  const zaracunanoSt = postavke.filter(p => p.racunId != null).length;

  const isBlocked = miza.noviNarocilaBlokirani || miza.novaNarocilaBlokirana;
  const showReservations = miza.reservations && miza.reservations.length > 0;
  const visualStatus = resolveTableVisualStatus(miza.status, aktivnaNarocila);

  return (
    <Card
      className={`flex flex-col h-full border-l-4 transition-all hover-elevate ${TABLE_CARD_BORDER_CLASS[visualStatus]}`}
    >
      <CardHeader className="pb-1 px-3 pt-3 md:px-6 md:pt-6 md:pb-2">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base md:text-xl">{miza.ime || `Miza ${miza.stevilka}`}</CardTitle>
            {aktivnaNarocila.some(n => n.ddvNeskladje?.imaNeskladje) && (
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
        <div className="mt-1">
          <KdsTypeBadge narocilo={{
            id: aktivnoNarocilo?.id ?? miza.id,
            mizaIme: miza.ime,
            mizaStevilka: miza.stevilka,
          }} />
          {qrNarocila.length > 0 && (
            <Badge className="ml-1.5 bg-violet-100 text-violet-800 border border-violet-200" data-testid={`badge-qr-gost-${qrNarocila[0].id}`}>
              {qrNarocila.length > 1 ? `${qrNarocila.length} QR naročili` : "QR gost"}
            </Badge>
          )}
        </div>
        {aktivnaNarocila.length === 1 && (
          <QrGostStaffInfo
            vir={aktivnoNarocilo?.vir}
            predvidenPrevzem={aktivnoNarocilo?.predvidenPrevzem}
            pripravljeno={qrPripravljeno}
            compact
            className="mt-2"
          />
        )}
      </CardHeader>
      <CardContent className="flex-1 pb-1 px-3 md:px-6 md:pb-2">
        {isBlocked && (
          <div className="mb-3 bg-red-50 text-red-700 p-2 text-xs font-medium rounded flex items-start gap-1.5" data-testid={`blokada-rezervacija-${miza.id}`}>
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Naročila blokirana (rezervacija čez &lt; 2h)</span>
          </div>
        )}

        {aktivnaNarocila.length > 0 ? (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">
              {aktivnaNarocila.length === 1 ? "Odprto naročilo" : `${aktivnaNarocila.length} odprti naročili`}
            </p>
            <p className="text-lg md:text-2xl font-bold">{skupaj.toFixed(2)} €</p>
            <p className="text-xs text-muted-foreground">
              {aktivnaNarocila.length > 1 ? `${aktivnaNarocila.length} ločeni naročili · ` : ""}
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
        ) : !showReservations ? (
          <div className="h-full flex items-center justify-center text-muted-foreground py-2">
            <p className="text-xs md:text-sm text-center">Ni odprtih naročil</p>
          </div>
        ) : null}

        {showReservations && (
          <div className={`${aktivnaNarocila.length > 0 ? "mt-3 pt-3 border-t" : "h-full flex flex-col justify-center py-2"} space-y-2`}>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Prihajajoče rezervacije ({miza.reservations.length})</p>
            {miza.reservations.slice(0, 2).map((rez) => (
              <div key={rez.id} className="text-xs p-2 rounded-md bg-yellow-50 border border-yellow-200">
                <div className="font-semibold truncate text-yellow-900" title={rez.strankaIme}>{rez.strankaIme}</div>
                <div className="flex items-center justify-between mt-1 text-yellow-800">
                  <div className="flex items-center gap-1">
                    <Clock3 className="w-3 h-3" />
                    {formatPosDatum(rez.zacetek)}, {formatPosCas(rez.zacetek)}
                  </div>
                  {rez.telefon && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {rez.telefon}
                    </div>
                  )}
                </div>
                {rez.opomba && <div className="mt-1 text-[10px] italic text-yellow-700 truncate">{rez.opomba}</div>}
              </div>
            ))}
            {miza.reservations.length > 2 && (
              <p className="text-[10px] text-center text-muted-foreground">+ še {miza.reservations.length - 2} rezervacij</p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0 px-3 pb-3 md:px-6 md:pb-4 flex flex-col gap-2">
        <Button
          className="w-full h-10 md:h-9 text-sm"
          variant={aktivnaNarocila.length > 0 || showReservations ? "secondary" : "default"}
          onClick={() => onSelectMiza(miza.id)}
          disabled={isPending}
          data-testid={`izberi-narocilo-miza-${miza.id}`}
        >
          {aktivnaNarocila.length > 0 || showReservations ? (
            <><UtensilsCrossed className="w-4 h-4 mr-2" /> Pregled mize</>
          ) : (
            <><Plus className="w-4 h-4 mr-2" /> Dodaj naročilo</>
          )}
        </Button>
        {aktivnaNarocila.length > 0 && isEmpty && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => onCancelNarocilo(aktivnoNarocilo.id, miza.id)}
            disabled={isPending}
            data-testid={`zapri-prazno-narocilo-${aktivnoNarocilo.id}`}
          >
            <X className="w-4 h-4 mr-2 text-destructive" />
            <span className="text-destructive">Zapri prazno mizo</span>
          </Button>
        )}
        {rezervacijeOmogocene && !showReservations && miza.status === "prosta" && (
          <Button
            className="w-full h-9 text-xs"
            variant="outline"
            onClick={() => onRezerviraj(miza)}
            disabled={isPending}
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            Nova rezervacija
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function MizaNarocilaDialog({
  open,
  miza,
  narocila,
  onOpenChange,
  onDodajNarocilo,
  onRezerviraj,
  onEditRezervacija,
  onZacniRezervacijo,
  onSprostiRezervacijo,
  gatewayMode = false,
  isPending,
}: {
  open: boolean;
  miza?: Miza;
  narocila: Narocilo[];
  onOpenChange: (open: boolean) => void;
  onDodajNarocilo: (mizaId: number) => void;
  onRezerviraj?: (miza: Miza) => void;
  onEditRezervacija?: (miza: Miza, rezervacija: RezervacijaMize) => void;
  onZacniRezervacijo?: (mizaId: number, rezervacijaId: number) => void;
  onSprostiRezervacijo?: (mizaId: number, rezervacijaId: number) => void;
  gatewayMode?: boolean;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="izbira-narocil-dialog" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {miza?.ime || (miza ? `Miza ${miza.stevilka}` : "Odprta naročila")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Active Orders Section */}
          {(narocila.length > 0 || !miza) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Odprta naročila</h3>
              {narocila.map(narocilo => {
                const steviloPostavk = (narocilo.postavke ?? []).filter(p => p.parentPostavkaId == null).length;
                return (
                  <Button
                    key={narocilo.id}
                    variant="outline"
                    className="h-auto w-full justify-between gap-3 px-4 py-3"
                    asChild
                  >
                    <Link
                      href={`/narocilo/${gatewayMode ? localOrderRoute(String(narocilo.id)) : narocilo.id}`}
                      onClick={() => onOpenChange(false)}
                      data-testid={`izbira-narocilo-${narocilo.id}`}
                    >
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="font-semibold">
                          Naročilo #{narocilo.stevilkaNarocila ?? narocilo.id}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {narocilo.vir === "qr_gost" ? "QR gost" : "Osebje"} · {steviloPostavk} artiklov
                        </span>
                      </span>
                      <span className="shrink-0 font-bold">{narocilo.skupaj.toFixed(2)} €</span>
                    </Link>
                  </Button>
                );
              })}
            </div>
          )}

          {/* New Order Walk-in Button */}
          {miza && (
            <Button
              className="w-full"
              onClick={() => onDodajNarocilo(miza.id)}
              disabled={isPending || miza.noviNarocilaBlokirani || miza.novaNarocilaBlokirana}
              data-testid={`dodaj-narocilo-dialog-${miza.id}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj naročilo (Walk-in)
            </Button>
          )}

          {/* Reservations Section */}
          {miza && onRezerviraj && (
            <div className="space-y-2 pt-4 border-t">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Rezervacije</h3>
                {onRezerviraj && (
                  <Button variant="ghost" size="sm" onClick={() => { onOpenChange(false); onRezerviraj(miza); }} disabled={isPending}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nova
                  </Button>
                )}
              </div>

              {miza.reservations && miza.reservations.length > 0 ? (
                miza.reservations.map((rez) => {
                  const isInYellowWindow = new Date(rez.zacetek).getTime() - Date.now() <= 60 * 60 * 1000;
                  return (
                    <div key={rez.id} className="bg-yellow-50 border border-yellow-200 rounded-md p-3 space-y-2" data-testid={`rezervacija-item-${rez.id}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-yellow-900">{rez.strankaIme}</p>
                          <p className="text-xs text-yellow-800 flex items-center gap-1 mt-0.5">
                            <Clock3 className="w-3 h-3" />
                            {formatPosDatum(rez.zacetek)}, {formatPosCas(rez.zacetek)}
                          </p>
                          {rez.telefon && (
                            <p className="text-xs text-yellow-800 flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3" />
                              {rez.telefon}
                            </p>
                          )}
                          {rez.opomba && (
                            <p className="text-xs text-yellow-700 italic mt-1">{rez.opomba}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          {onEditRezervacija && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-900" onClick={() => onEditRezervacija(miza, rez)} disabled={isPending}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {onSprostiRezervacijo && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-900" onClick={() => { onOpenChange(false); onSprostiRezervacijo(miza.id, rez.id); }} disabled={isPending}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {onZacniRezervacijo && isInYellowWindow && narocila.length === 0 && (
                        <Button
                          className="w-full mt-2 bg-yellow-600 hover:bg-yellow-700 text-white"
                          size="sm"
                          onClick={() => { onOpenChange(false); onZacniRezervacijo(miza.id, rez.id); }}
                          disabled={isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Začni to rezervacijo
                        </Button>
                      )}
                      {isInYellowWindow && narocila.length > 0 && (
                        <p className="text-xs font-medium text-red-700">
                          Najprej zaključite ali prestavite odprta naročila na tej mizi.
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">Ni prihajajočih rezervacij.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const { naprava, napravaKljuc } = useNaprava();
  const gatewayOffline = useGatewayOfflineContext();
  const { data: vseMize, isLoading: loadingMize } = useListMize();
  const { data: waiterRequests = [] } = useQrWaiterRequests();
  const { data: narocila, isLoading: loadingNarocila, isFetching: narocilaFetching } = useListAktivnaNarocila();
  const { data: prostori, isLoading: loadingProstori } = useListProstori();
  const gatewayMode = gatewayOffline.effectiveAuthority === "GATEWAY";
  const gatewayMize = (gatewayOffline.snapshot?.tables ?? []).map(table => ({
    id: String(table.tableId),
    ime: String((table.projection as Record<string, unknown> | undefined)?.name ?? `Miza ${table.tableId}`),
    stevilka: String(table.tableId),
    kapaciteta: 0,
    status: table.status === "occupied" ? "zasedena" : "prosta",
    reservations: [],
    noviNarocilaBlokirani: false,
    novaNarocilaBlokirana: false,
  })) as unknown as Miza[];
  const gatewayNarocila = (gatewayOffline.snapshot?.orders ?? [])
    .map(item => {
      const projection = (item.projection ?? item) as Record<string, unknown>;
      const gatewayId = String(item.orderId ?? projection.orderId);
      const { postavke: _postavke, ...canonicalProjection } = projection;
      return { ...canonicalProjection, id: gatewayId, gatewayId,
        cloudId: projection.cloudOrderId ?? projection.cloudId ?? null } as Record<string, unknown>;
    })
    .filter((order: Record<string, unknown>) => ["odprto", "OPEN", "open"].includes(String(order.status))) as unknown as Narocilo[];
  const effectiveVseMize = gatewayMode ? gatewayMize : vseMize;
  const effectiveNarocila = gatewayMode ? gatewayNarocila : narocila;
  const mize = (() => {
    if (!naprava?.dovoljeneMize?.length) return effectiveVseMize;
    const filtered = effectiveVseMize?.filter(m => naprava.dovoljeneMize!.includes(m.id));
    if (filtered !== undefined && filtered.length === 0 && effectiveVseMize!.length > 0) return effectiveVseMize;
    return filtered;
  })();
  useEffect(() => {
    if (!gatewayOffline.healthy || gatewayOffline.mode !== "cloud" || !vseMize || !narocila ||
        gatewayOffline.primed) return;
    void gatewayOffline.prime(
      vseMize.map(table => ({ tableId: String(table.id), status: table.status, activeOrderIds: [] })),
      narocila.map(order => {
        const allRows = order.postavke ?? [];
        const lines = allRows.map(postavka => {
            const row = postavka as typeof postavka & Record<string, any>;
            const parentCloudLineId = row.parentPostavkaId ?? null;
            return {
              lineId: `cloud:${order.id}:${row.id}`,
              cloudLineId: row.id,
              sourceLineRef: `cloud:${order.id}:${row.id}`,
              parentCloudLineId,
              parentSourceLineRef: parentCloudLineId == null ? null : `cloud:${order.id}:${parentCloudLineId}`,
              articleId: row.artikelId ?? null,
              modifierId: row.modifikatorId ?? null,
              quantity: row.kolicina,
              kolicina: row.kolicina,
              gross: row.skupaj,
              skupaj: row.skupaj,
              unitGross: row.cenaKos,
              cenaKos: row.cenaKos,
              vatRate: row.davek,
              davek: row.davek,
              name: row.ime,
              naziv: row.ime,
              opomba: row.opomba ?? null,
              toGo: row.toGo ?? false,
              pripravljeno: row.pripravljeno ?? null,
              postajaId: row.postajaId ?? null,
              postajaIds: row.postajaIds ?? [],
              courseNumber: row.courseNumber ?? null,
              pairingGroupId: row.pairingGroupId ?? null,
            };
          });
        const { postavke: _postavke, ...rest } = order as Narocilo & { postavke?: unknown };
         return { ...rest, orderId: String(order.id), cloudOrderId: order.id,
           lines, baseLines: lines.map(line => ({ ...line })), status: order.status };
      }),
    );
  }, [gatewayOffline.healthy, gatewayOffline.mode, gatewayOffline.primed, vseMize, narocila, gatewayOffline.prime]);
  const createNarocilo = useCreateNarocilo();
  const updateNarocilo = useUpdateNarocilo();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const prefetchOrderMenu = useCallback(() => Promise.all([
    queryClient.prefetchQuery(getListArtikliQueryOptions(undefined, {
      query: {
        queryKey: getListArtikliQueryKey(),
        staleTime: ORDER_MENU_STALE_TIME,
      },
    })),
    queryClient.prefetchQuery(getListKategorijeQueryOptions({
      query: {
        queryKey: getListKategorijeQueryKey(),
        staleTime: ORDER_MENU_STALE_TIME,
      },
    })),
  ]), [queryClient]);

  // Katalog je potreben takoj po odprtju naročila. Naložimo ga v ozadju že
  // med pregledom miz, da prehod na meni ni vezan na zaporedje novih zahtev.
  useEffect(() => {
    void prefetchOrderMenu();
  }, [prefetchOrderMenu]);

  const [rezervacijaMiza, setRezervacijaMiza] = useState<Miza | null>(null);
  const [rezervacijaEdit, setRezervacijaEdit] = useState<RezervacijaMize | null>(null);
  const [rezervacijaZacetek, setRezervacijaZacetek] = useState<string | null>(null);
  const [rezervacijaDialogOpen, setRezervacijaDialogOpen] = useState(false);
  const [razpolozljivostDialogOpen, setRazpolozljivostDialogOpen] = useState(false);
  const releaseRezervacija = useReleaseRezervacijaMize();

  const handleRezervirajClick = (miza: Miza) => {
    setRezervacijaMiza(miza);
    setRezervacijaEdit(null);
    setRezervacijaZacetek(null);
    setRezervacijaDialogOpen(true);
  };

  const handleIzberiRazpolozljivoMizo = (miza: Miza, zacetekIso: string) => {
    setRazpolozljivostDialogOpen(false);
    setRezervacijaMiza(miza);
    setRezervacijaEdit(null);
    setRezervacijaZacetek(zacetekIso);
    setRezervacijaDialogOpen(true);
  };

  const handleEditRezervacija = (miza: Miza, rezervacija: RezervacijaMize) => {
    setRezervacijaMiza(miza);
    setRezervacijaEdit(rezervacija);
    setRezervacijaZacetek(null);
    setRezervacijaDialogOpen(true);
  };

  const handleSprostiRezervacijo = (mizaId: number, rezervacijaId: number) => {
    releaseRezervacija.mutate({ id: mizaId, rezervacijaId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
        toast({ title: "Rezervacija sproščena" });
      },
      onError: (err: any) => {
        const errMsg = err?.data?.error || "Ni bilo mogoče sprostiti rezervacije.";
        toast({ title: "Napaka", description: errMsg, variant: "destructive" });
      }
    });
  };

  const { poslusam, zacni: zacniGlasovno, ustavi: ustaviGlasovno } = useGlasovniUkaz();

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
        handleCreateNarocilo(najdena.id);
      },
      onError: () => toast({ title: "Napaka mikrofona", description: "Ni bilo mogoče prepoznati govora.", variant: "destructive" }),
    });
    if (!uspelo) {
      toast({ title: "Glasovni vnos ni podprt", description: "Vaš brskalnik ne podpira prepoznavanja govora.", variant: "destructive" });
    }
  };

  const ustvariNarocilo = (mizaId?: number, rezervacijaId?: number) => {
    if (gatewayMode && (!gatewayOffline.healthy || !gatewayOffline.snapshot || !gatewayOffline.scope)) {
      toast({ title: "LAN gateway ni dosegljiv", description: "Cloud ustvarjanje in spreminjanje naročil je blokirano do uskladitve.", variant: "destructive" });
      return;
    }
    if (gatewayMode && rezervacijaId != null) {
      toast({ title: "Rezervacije niso podprte", description: "V LAN načinu ustvarite naročilo neposredno na gatewayu.", variant: "destructive" });
      return;
    }
    if (gatewayMode && gatewayOffline.scope) {
      void gatewayOffline.openOrder({ tableId: mizaId ?? null, status: "open", lines: [] }).then(result => {
        const localId = String(result.orderId);
        setSkipAutoStart();
        setLocation(`/narocilo/${localOrderRoute(localId)}`);
      }).catch(error => {
        toast({ title: "Gateway naročilo ni bilo odprto", description: error instanceof Error ? error.message : "Poskusite znova.", variant: "destructive" });
      });
      return;
    }
    createNarocilo.mutate({ data: { mizaId: mizaId ?? null, rezervacijaId: rezervacijaId ?? null } }, {
      onSuccess: (narocilo) => {
        trackEvent("order_created", {
          source: rezervacijaId ? "reservation" : mizaId ? "table" : "direct",
        });
        // clearSkipAutoStart() se ne kliče tukaj — sessionStorage se briše šele ko se dodajo artikli
        // Odgovor vsebuje celotno novo naročilo; stran naročila ga lahko
        // prikaže takoj, brez čakanja na ponovni GET.
        queryClient.setQueryData(getGetNarociloQueryKey(narocilo.id), narocilo);
        queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() }); // Refresh to show active order / clear reservation state
        setLocation(`/narocilo/${narocilo.id}`);
      },
      onError: (err: unknown) => {
        const body = (err as { data?: { code?: string; error?: string } })?.data;
        if (body?.code === "MISSING_ZACETNE_ZALOGE") {
          toast({ title: "Začetne zaloge niso vnesene", description: body.error ?? "Pred prvim naročilom vnesite začetne zaloge v razdelku Zaloge.", variant: "destructive", duration: 8000 });
        } else {
          toast({ title: "Napaka", description: body?.error ?? "Ni bilo mogoče ustvariti naročila.", variant: "destructive" });
        }
      }
    });
  };

  const handleSelectMiza = (mizaId: number) => {
    setSkipAutoStart();
    block();
    void prefetchOrderMenu();
    setIzbiraNarocilMizaId(mizaId);
  };

  const handleDodajNarocilo = (mizaId: number) => {
    setIzbiraNarocilMizaId(null);
    setSkipAutoStart();
    block();
    ustvariNarocilo(mizaId);
  };

  const handleZacniRezervacijo = (mizaId: number, rezervacijaId: number) => {
    setIzbiraNarocilMizaId(null);
    setSkipAutoStart();
    block();
    ustvariNarocilo(mizaId, rezervacijaId);
  };

  const handleCreateNarocilo = (mizaId?: number) => {
    setSkipAutoStart(); // SINHRONNO — postavi sessionStorage zastavico preden karkoli drugega
    block(); // blokira avtostart ne glede na to ali je klik ročen ali avtomatski
    if (mizaId != null) {
      const obstoječa = effectiveNarocila?.filter(n => n.mizaId === mizaId && n.status === "odprto") ?? [];
      if (obstoječa.length > 0) {
        setIzbiraNarocilMizaId(mizaId);
        return;
      }
    }
    ustvariNarocilo(mizaId);
  };

  const handleCancelNarocilo = (narociloId: number, mizaId: number) => {
    if (gatewayMode) {
      if (!gatewayOffline.healthy || !gatewayOffline.snapshot) {
        toast({ title: "LAN gateway ni dosegljiv", description: "Cloud ustvarjanje in spreminjanje naročil je blokirano do uskladitve.", variant: "destructive" });
        return;
      }
      const current = gatewayOffline.snapshot.orders.find(item => String(item.orderId) === String(narociloId));
      const projection = (current?.projection ?? current) as Record<string, unknown> | undefined;
      if (projection && gatewayOffline.scope) {
        void gatewayOffline.acquireLease(String(narociloId), Number(current?.version ?? 0)).then(lease =>
          gatewayOffline.replaceOrder((latest) => ({
            ...latest, orderId: String(narociloId),
            companyId: gatewayOffline.scope!.companyId,
            enotaId: gatewayOffline.scope!.enotaId, status: "cancelled",
          } as any), lease)
        ).then(() => toast({ title: "Naročilo preklicano" }))
          .catch(error => toast({ title: "Naročilo ni bilo preklicano", description: error instanceof Error ? error.message : "Konflikt lastništva.", variant: "destructive" }));
      }
      else toast({ title: "Gateway naročilo ni najdeno", description: "Osvežite gateway po uskladitvi.", variant: "destructive" });
      return;
    }
    updateNarocilo.mutate({ id: narociloId, data: { status: "preklicano" } }, {
      onSuccess: () => {
        setSkipAutoStart();
        queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
        toast({ title: "Naročilo preklicano", description: "Prazno naročilo je bilo preklicano." });
      },
      onError: () => {
        toast({ title: "Napaka", description: "Ni bilo mogoče preklicati naročila.", variant: "destructive" });
      }
    });
  };

  const handleDirektna = () => {
    block();
    const obstoječe = effectiveNarocila?.find(n => n.status === "odprto" && n.mizaId == null);
    if (obstoječe) {
      clearSkipAutoStart();
      setLocation(`/narocilo/${gatewayMode ? localOrderRoute(String(obstoječe.id)) : obstoječe.id}`);
    } else {
      handleCreateNarocilo();
    }
  };

  const search = useSearch();

  const [aktivniFilter, setAktivniFilter] = useState<"vse" | "prosta" | "zasedena" | "delno_zaracunana" | "vse_zaracunano" | "rezervirana">("vse");
  const { user: avtUser } = useAuth();
  const rezervacijeOmogocene = avtUser?.capabilities?.includes("reservations") ?? false;
  const telefonskaNarocilaOmogocena = avtUser?.capabilities?.includes("phone_orders") ?? false;
  const [telefonDialogOpen, setTelefonDialogOpen] = useState(false);
  const [izbiraNarocilMizaId, setIzbiraNarocilMizaId] = useState<number | null>(null);
  const prostoLsKey = `pos_aktivni_prostor_${napravaKljuc}`;
  const [aktivniProstor, setAktivniProstor] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(`pos_aktivni_prostor_${napravaKljuc}`);
      return raw ? parseInt(raw, 10) : null;
    } catch { return null; }
  });
  const handleSetAktivniProstor = (id: number | null) => {
    setAktivniProstor(id);
    try {
      if (id === null) localStorage.removeItem(prostoLsKey);
      else localStorage.setItem(prostoLsKey, String(id));
    } catch { /* nič */ }
  };

  useEffect(() => {
    if (loadingProstori || prostori === undefined) return;
    if (!jeAktivniProstorVeljaven(aktivniProstor, prostori)) {
      handleSetAktivniProstor(null);
    }
  }, [aktivniProstor, loadingProstori, prostori, prostoLsKey]);

  const { blocked, block } = useAutoStart();

  const telefonskaNarocila = (effectiveNarocila ?? []).filter(jeAktivnoTelefonskoNarocilo);

  useEffect(() => {
    const consumeAgentOpenTable = () => {
      const queryTableNumber = new URLSearchParams(search).get("odpriMizo");
      const storedTableNumber = sessionStorage.getItem(AGENT_OPEN_TABLE_STORAGE_KEY);
      const tableNumberRaw = queryTableNumber ?? storedTableNumber;
      if (!tableNumberRaw || mize === undefined || narocila === undefined) return;
      if (queryTableNumber) setLocation("/", { replace: true });
      if (storedTableNumber) sessionStorage.removeItem(AGENT_OPEN_TABLE_STORAGE_KEY);

      const table = resolveAgentOpenTable(`odpriMizo=${encodeURIComponent(tableNumberRaw)}`, mize);
      if (!table) {
        toast({
          title: "Miza ni najdena",
          description: `Miza ${tableNumberRaw} v aktivni enoti ne obstaja.`,
          variant: "destructive",
        });
        return;
      }
      handleCreateNarocilo(table.id);
    };

    consumeAgentOpenTable();
    window.addEventListener(AGENT_OPEN_TABLE_EVENT, consumeAgentOpenTable);
    return () => window.removeEventListener(AGENT_OPEN_TABLE_EVENT, consumeAgentOpenTable);
  }, [mize, narocila, search]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (mize === undefined || narocila === undefined || narocilaFetching || autoStartedRef.current) return;

    const urlSkip = new URLSearchParams(search).has("skipAutoStart");

    // Naprava ima natanko eno dovoljeno mizo — enako kot direktna prodaja:
    // avtostart samo ko ni odprtega naročila za to mizo
    if (naprava?.dovoljeneMize?.length === 1 && mize.length === 1) {
      const mizaId = mize[0].id;
      const openOrder = (effectiveNarocila ?? []).find(n => n.mizaId === mizaId && n.status === "odprto");
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
    if (mize.length === 0 && (effectiveNarocila ?? []).length === 0) {
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

  if (moraPregledMizPocakatiNaPodatke(
    gatewayMode ? false : loadingMize,
    gatewayMode ? false : loadingNarocila,
    gatewayMode ? false : loadingProstori,
  )) {
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

  const isPending = createNarocilo.isPending || updateNarocilo.isPending || releaseRezervacija.isPending;

  const getMizaEfektivniStatus = (miza: Miza) => {
    const narocilaMize = effectiveNarocila?.filter(n => n.mizaId === miza.id && n.status === "odprto") ?? [];
    return resolveTableVisualStatus(miza.status, narocilaMize);
  };

  const filtriraneMize = (seznam: Miza[]) => {
    if (aktivniFilter === "vse") return seznam;
    return seznam.filter(m => getMizaEfektivniStatus(m) === aktivniFilter);
  };

  const cardProps = {
    onSelectMiza: handleSelectMiza,
    onCancelNarocilo: handleCancelNarocilo,
    onRezerviraj: handleRezervirajClick,
    isPending,
    rezervacijeOmogocene,
  };

  const renderMizaCard = (miza: Miza) => {
    const aktivnaNarocila = effectiveNarocila?.filter(n => n.mizaId === miza.id && n.status === "odprto") ?? [];
    return (
      <MizaCard
        key={miza.id}
        miza={miza}
        aktivnaNarocila={aktivnaNarocila}
        {...cardProps}
      />
    );
  };
  const izbirnaMiza = mize?.find(miza => miza.id === izbiraNarocilMizaId);
  const izbirnaNarocila = (effectiveNarocila ?? []).filter(
    narocilo => narocilo.mizaId === izbiraNarocilMizaId && narocilo.status === "odprto",
  );

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
    <div className="p-2 md:px-4 md:pt-2 md:pb-4 space-y-2 flex-1 overflow-auto">
      {gatewayMode && (!gatewayOffline.healthy || !gatewayOffline.snapshot) && (
        <Card className="border-destructive bg-destructive/10" data-testid="gateway-recovery-block">
          <CardContent className="py-4 font-semibold text-destructive">
            LAN gateway ni dosegljiv. Cloud ustvarjanje in spreminjanje naročil je blokirano do uskladitve.
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap justify-between items-center gap-1 md:gap-2">
        <div className="flex items-center gap-1 md:gap-2">
          <h1 className="text-lg md:text-3xl font-bold tracking-tight">Pregled miz</h1>
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
        <div className="flex items-center gap-2 flex-wrap">
          {rezervacijeOmogocene && <Button
            size="sm"
            variant="outline"
            onClick={() => setRazpolozljivostDialogOpen(true)}
            disabled={isPending}
            className="shrink-0"
            data-testid="poisci-prosto-mizo"
          >
            <CalendarClock className="w-4 h-4 mr-1.5" />
            <span>Poišči mizo</span>
          </Button>}
          {telefonskaNarocilaOmogocena && <Button
            size="sm"
            onClick={() => { setSkipAutoStart(); block(); setTelefonDialogOpen(true); }}
            disabled={isPending}
            className="shrink-0"
            data-testid="novo-telefonsko-narocilo"
          >
            <Phone className="w-4 h-4 mr-1.5" />
            <span>Telefonsko naročilo</span>
          </Button>}
          {(mize?.length ?? 0) === 0 ? (
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
          ) : null}
        </div>
      </div>
      <QrWaiterQueue requests={waiterRequests} mize={vseMize ?? []} />
      {telefonskaNarocilaOmogocena && telefonskaNarocila.length > 0 && (
        <Card data-testid="aktivna-telefonska-narocila">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Aktivna telefonska naročila
              <span className="text-xs font-normal text-muted-foreground">({telefonskaNarocila.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {telefonskaNarocila.map(n => {
              const jeDostava = n.nacinIzpolnitve === "dostava";
              const cas = formatPosCas(jeDostava ? n.predvidenaDostava : n.predvidenPrevzem);
              const dostavaStatus = jeDostava ? n.dostavaStatus : null;
              const dostavaStatusLabel = getDostavaStatusLabel(dostavaStatus);
              const etaTarget = getAktivnoNarociloEtaTarget(n);
              return (
                <Link key={n.id}
                  href={`/narocilo/${gatewayMode ? localOrderRoute(String(n.id)) : n.id}`}
                  className="rounded-lg border p-3 hover:bg-muted/50 transition-colors" data-testid={`aktivno-narocilo-${n.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{n.strankaIme || "Telefonsko naročilo"}</span>
                    <KdsTypeBadge narocilo={n} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>#{n.stevilkaNarocila ?? n.id}</span>
                    <span className="inline-flex items-center gap-2">
                      {cas && <span className="inline-flex items-center gap-1 font-medium text-foreground"><Clock3 className="h-3 w-3" />{cas}</span>}
                      {etaTarget && (
                        <span data-testid={`aktivno-narocilo-eta-${n.id}`}>
                          <KdsCountdown target={etaTarget} />
                        </span>
                      )}
                    </span>
                  </div>
                  {jeDostava && n.dostavaNaseljeNaziv && <p className="mt-1 text-xs text-muted-foreground truncate">{n.dostavaUlica} {n.dostavaHisnaStevilka}, {n.dostavaNaseljeNaziv}</p>}
                  {jeDostava && (
                    <Badge
                      variant="outline"
                      className={`mt-2 text-[11px] ${
                        typeof dostavaStatus === "string" && dostavaStatusLabel
                          ? DOSTAVA_STATUS_CLASSES[dostavaStatus]
                          : "border-amber-300 bg-amber-50 text-amber-800"
                      }`}
                      data-testid={`dostava-status-badge-${n.id}`}
                    >
                      Dostava: {dostavaStatusLabel ?? "Neznan status"}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
      {/* Filter po prostoru */}
      {hasProstori && (
        <div className="flex gap-1 md:gap-1.5 flex-wrap">
          <button
            onClick={() => handleSetAktivniProstor(null)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] md:px-2 md:py-px md:text-[10px] font-semibold transition-colors cursor-pointer ${
              aktivniProstor === null
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-border hover:bg-muted"
            }`}
          >
            Vsi
          </button>
          {prostoriSeznam.map(prostor => (
            <button
              key={prostor.id}
              onClick={() => handleSetAktivniProstor(prostor.id)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] md:px-2 md:py-px md:text-[10px] font-semibold transition-colors cursor-pointer ${
                aktivniProstor === prostor.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              {prostor.ime}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 md:gap-1.5 flex-wrap mt-2 md:mt-0">
        {filterMoznosti.map(f => (
          <button
            key={f.id}
            onClick={() => setAktivniFilter(f.id)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] md:px-2 md:py-px md:text-[10px] font-semibold transition-colors cursor-pointer ${aktivniFilter === f.id ? f.aktivnaClass : f.neaktivnaClass}`}
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
           {telefonskaNarocilaOmogocena && <Button variant="outline" onClick={() => { setSkipAutoStart(); block(); setTelefonDialogOpen(true); }} disabled={isPending}>
             <Phone className="w-4 h-4 mr-2" />
             Telefonsko naročilo
           </Button>}
        </div>
      ) : hasProstori ? (
        <div className="space-y-3 md:space-y-8">
          {(aktivniProstor === null ? prostoriSeznam : prostoriSeznam.filter(p => p.id === aktivniProstor)).map(prostor => {
            const vseMizeProstora = mize?.filter(m => m.prostorId === prostor.id) ?? [];
            const mizeProstora = filtriraneMize(vseMizeProstora);
            if (mizeProstora.length === 0) return null;

            return (
              <div key={prostor.id}>
                {/* Naslov prostora skrijemo, ko je izbran točno ta prostor — je že razvidno iz filtra */}
                {aktivniProstor === null && (
                  <h2 className="text-[10px] md:text-base font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 md:mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    {prostor.ime}
                    <span className="h-px flex-1 bg-border" />
                  </h2>
                )}
                <TlorisViewer
                  prostorId={prostor.id}
                  vseMize={vseMizeProstora}
                  filtriraneMize={mizeProstora}
                  narocila={effectiveNarocila ?? []}
                  onSelectMiza={cardProps.onSelectMiza}
                  isPending={cardProps.isPending}
                />
              </div>
            );
          })}
          {/* Mize brez prostora — prikaži samo pri "Vsi" */}
          {aktivniProstor === null && (() => {
            const brezProstora = filtriraneMize(mize?.filter(m => m.prostorId == null) ?? []);
            if (brezProstora.length === 0) return null;
            return (
              <div>
                <h2 className="text-[10px] md:text-base font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 md:mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border" />
                  Ostalo
                  <span className="h-px flex-1 bg-border" />
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-4">
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
      <TelefonNarociloDialog
        open={telefonDialogOpen}
        onOpenChange={setTelefonDialogOpen}
        onBlockAutoStart={block}
        onCreated={narocilo => {
          void osveziPregledMizPoTelefonu(queryClient)
            .finally(() => setLocation(`/narocilo/${narocilo.id}`));
        }}
      />
      <MizaNarocilaDialog
        open={izbiraNarocilMizaId !== null}
        onOpenChange={open => {
          if (!open) setIzbiraNarocilMizaId(null);
        }}
        miza={izbirnaMiza}
        narocila={izbirnaNarocila}
        onDodajNarocilo={handleDodajNarocilo}
        onRezerviraj={rezervacijeOmogocene ? handleRezervirajClick : undefined}
        onEditRezervacija={rezervacijeOmogocene ? handleEditRezervacija : undefined}
        onZacniRezervacijo={rezervacijeOmogocene ? handleZacniRezervacijo : undefined}
        onSprostiRezervacijo={rezervacijeOmogocene ? handleSprostiRezervacijo : undefined}
        gatewayMode={gatewayMode}
        isPending={isPending}
      />

      <RezervacijaDialog
        miza={rezervacijaMiza}
        rezervacija={rezervacijaEdit}
        initialZacetek={rezervacijaZacetek}
        open={rezervacijaDialogOpen}
        onOpenChange={setRezervacijaDialogOpen}
      />
      <RazpolozljivostMizDialog
        open={razpolozljivostDialogOpen}
        onOpenChange={setRazpolozljivostDialogOpen}
        onIzberiMizo={handleIzberiRazpolozljivoMizo}
      />
    </div>
  );
}
