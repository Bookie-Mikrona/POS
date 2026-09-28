import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useHappyHour } from "@/contexts/HappyHourContext";
import { useGlasovniUkaz } from "@/hooks/use-glasovni-ukaz";
import { useGlasovniSinonimi } from "@/hooks/use-glasovni-sinonimi";
import { setSkipAutoStart, clearSkipAutoStart } from "@/lib/autoStartGuard";

import { useAutoStartRef } from "@/contexts/AutoStartContext";
import { useParams, useLocation, useSearch } from "wouter";
import { isTemporaryPostavkaId, useAddPostavkaOptimistic } from "@/hooks/useAddPostavkaOptimistic";
import type { ArtikelZaOptimistiko } from "@/hooks/useAddPostavkaOptimistic";
import {
  useGetNarocilo,
  getGetNarociloQueryKey,
  useListArtikli,
  getListArtikliQueryKey,
  useListKategorije,
  getListKategorijeQueryKey,
  useRemovePostavka,
  useUpdatePostavkaKolicina,
  useListMize,
  getListMizeQueryKey,
  useListNarocila,
  getListNarocilaQueryKey,
  getListAktivnaNarocilaQueryKey,
  useSpojiNarocili,
  useUpdateNarocilo,
  useListRacuni,
  getListRacuniQueryKey,
  useGetRacunPostavke,
  getGetRacunPostavkeQueryKey,
  useAddPostavkaModifikatorji,
  getGetModifikatorNormativiQueryKey,
  getGetModifikatorNormativiQueryOptions,
  useListDnevniMeni,
  useListProstori,
  useGetPreparedFoodAvailability,
  getGetPreparedFoodAvailabilityQueryKey,
  type ModSkupinaFull,
  ApiError,
  customFetch,
  useAddMulticourseMenu,
  useGetKdsNastavitve,
  getGetKdsNastavitveQueryKey,
} from "@workspace/api-client-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, ChevronDown, ClipboardList, Clock3, GitMerge, GripVertical, Mic, MicOff, Minus, Pencil, Percent, Pizza, Plus, Search, Settings2, ShieldAlert, ShoppingBag, Trash2, Users, Wallet, X } from "lucide-react";
import { DdvNeskladjeAlert } from "@/components/DdvNeskladjeAlert";
import { useToast } from "@/hooks/use-toast";
import { useNaprava } from "@/contexts/NapravaContext";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNastavitve } from "@/contexts/NastavitveContext";
import SystemInputDialog from "@/components/SystemInputDialog";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { casZaPosDatetimeLocal, formatPosCas, poslovniDatumZaCas, posDatetimeLocalToIso } from "@/lib/posCas";
import { isOrderArticleVisible } from "@/lib/order-article-visibility";
import { orderAddErrorMessage } from "@/lib/order-add-error";
import { DostavaStatusPanel } from "@/components/DostavaStatusPanel";
import { KdsCountdown } from "@/lib/kdsNarocilo";
import { getNextKdsCoursesToFire } from "@/lib/kdsCourses";
import { useFireKdsCourse, useKdsNalogiVecPostaj, useKdsPostaje } from "@/hooks/use-kds";
import { formatMizaProstor } from "@/lib/formatMizaProstor";
import {
  groupMulticourseOrderRows,
  multicourseSelectionRequirements,
  validateMulticourseOrderSelection,
} from "@/lib/multicourse-order";
import { useAiSvetovalec } from "@/hooks/use-ai-svetovalec";
import { AiSvetovalecPanel } from "@/components/AiSvetovalecPanel";
import { DailyLunchOrderFlow } from "@/components/DailyLunchOrderFlow";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";
import { onlyActiveArticles } from "@/lib/activeArticles";
import { GatewayConflictError, localOrderRoute, parseLocalOrderRoute, type GatewayOrderSnapshot } from "@/lib/gatewayClient";

export function selectOrderKdsNalogi<T extends { narociloId: unknown }>(
  nalogi: T[], gatewayMode: boolean, gatewayOrderId: string | null, id: number | undefined,
): T[] {
  const activeKdsOrderId = gatewayMode && gatewayOrderId ? gatewayOrderId : id;
  return nalogi.filter((nalog) => activeKdsOrderId != null &&
    String(nalog.narociloId) === String(activeKdsOrderId));
}

type VelikostPice = "mala" | "normalna" | "druzinska";

const ORDER_MENU_STALE_TIME = 60_000;

function IkonaVelikostiPice({ velikost }: { velikost: VelikostPice }) {
  const meta: Record<VelikostPice, { naziv: string; razred: string; barva: string }> = {
    mala: { naziv: "Mala pica", razred: "h-4 w-4", barva: "bg-sky-100 text-sky-700" },
    normalna: { naziv: "Normalna pica", razred: "h-5 w-5", barva: "bg-emerald-100 text-emerald-700" },
    druzinska: { naziv: "Družinska pica", razred: "h-6 w-6", barva: "bg-violet-100 text-violet-700" },
  };
  const { naziv, razred, barva } = meta[velikost];

  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${barva}`}
      title={naziv}
      aria-label={naziv}
      data-testid={`velikost-pice-${velikost}`}
    >
      <Pizza className={razred} aria-hidden="true" />
    </span>
  );
}

function OrderContextLine({
  prostorIme,
  mizaIme,
  mizaStevilka,
  stevilkaNarocila,
  virOznaka,
  dostavaOb,
  testId = "order-context-line",
  className = "",
}: {
  prostorIme: string | null;
  mizaIme: string | null;
  mizaStevilka: number | null;
  stevilkaNarocila: number | string;
  virOznaka: "QR" | null;
  dostavaOb: string | null;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-nowrap items-center gap-x-1.5 overflow-x-auto whitespace-nowrap text-[11px] leading-tight text-muted-foreground ${className}`} data-testid={testId}>
      <span className="shrink-0 font-semibold text-foreground">
        {formatMizaProstor({ mizaIme, mizaStevilka, prostorIme })}
      </span>
      <span aria-hidden="true">·</span>
      <span className="shrink-0 font-semibold text-foreground">#{stevilkaNarocila}</span>
      {virOznaka && (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 font-bold text-violet-800">{virOznaka}</span>
        </>
      )}
      {dostavaOb && (
        <>
          <span aria-hidden="true">·</span>
          <span
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-foreground"
            title={`Dostava ob ${dostavaOb}`}
            aria-label={`Dostava ob ${dostavaOb}`}
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{dostavaOb}</span>
          </span>
        </>
      )}
    </div>
  );
}


interface ArtikelItem {
  id: number;
  ime: string;
  cena: number;
  davek: number;
  aktiven: boolean;
  kategorijaId: number;
  kategorijaIme: string | null;
  barva: string | null;
  vrstniRed: number;
  opis?: string | null;
  prodajniArtikel?: boolean;
  nabavniArtikel?: boolean;
  jePica?: boolean;
  pripravaVrsta?: "pica" | "hrana" | "pijaca" | null;
  cenaMala?: number | null;
  cenaDruzinska?: number | null;
  happyHourCena?: number | null;
  happyHourCenaMala?: number | null;
  happyHourCenaDruzinska?: number | null;
  jeDodatekZaPico?: boolean;
  privzetiDodatki?: number[];
  jeModifikator?: boolean;
  privzetiModifikatorji?: number[];
  skupina?: string | null;
  toGo?: boolean;
  taxCategory?: string;
  mealType?: "ala_carte" | "prepared" | "composite";
  availableQuantity?: number | null;
  availableBySize?: Partial<Record<VelikostPice, number | null>>;
  modifierAvailability?: Map<number, number>;
}

interface MulticourseMenuConfig {
  id: number;
  menuArtikelId: number;
  /** Legacy field, retained for menus saved before generic course selection. */
  izbor?: "fixed_four" | "choose_three";
  selectionMode?: "fixed" | "choose";
  selectionCount?: number | null;
  aktivno: boolean;
  courses: {
    courseNumber: number;
    courseName?: string;
    allowedFoodArtikelIds: number[];
    allowedWineArtikelIds: number[];
    wineRequired?: boolean;
    informational?: boolean;
  }[];
}

function playTapSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // AudioContext not available — silent fallback
  }
}

interface ArtikelLookup {
  ime: string;
  aktiven?: boolean;
  jeDodatekZaPico?: boolean;
  jeModifikator?: boolean;
}

interface SortableCardProps {
  artikel: ArtikelItem;
  onAdd: (id: number) => void;
  pending: boolean;
  flashing: boolean;
  artikliMap?: Map<number, ArtikelLookup>;
  isHappyHourActive?: boolean;
  happyHourVelikostiPice?: Set<"mala" | "normalna" | "druzinska">;
}

// ── Slovensko korenjenje za glasovne ukaze ────────────────────────────────────
// Odstraní najpogostejše sklanjatevne pripone, da "pico" ujame "Pica" ipd.
function koreniSlo(beseda: string): string {
  const MIN = 3; // minimalna dolžina korena
  for (const s of [
    "nimi", "imi", "ega", "emu", "jem", "oma", "ima", "ama",
    "em", "om", "ah", "ih", "im", "am", "ev", "ov",
    "ja", "ju", "jo", "je", "ji", "ga", "mu",
    "o", "e", "i", "u", "a",
  ]) {
    if (beseda.endsWith(s) && beseda.length - s.length >= MIN) {
      return beseda.slice(0, beseda.length - s.length);
    }
  }
  return beseda;
}

/** Odstrani slovenške diakritike: š→s, č→c, ž→z (itd.).
 *  Speech recognition pogosto vrne besede brez diakritik (npr. "lasko" namesto "laško").
 *  Ker normaliziramo tako iskanje kot ime artikla, ujemanje deluje v obe smeri. */
function odstraniDiakritike(niz: string): string {
  return niz
    .replace(/š/g, "s").replace(/Š/g, "S")
    .replace(/č/g, "c").replace(/Č/g, "C")
    .replace(/ž/g, "z").replace(/Ž/g, "Z")
    .replace(/ć/g, "c").replace(/Ć/g, "C")
    .replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Normalizira enote: dcl → dl, da se "5dcl" ujema s sinonimom "5dl". */
function normalizirajEnote(niz: string): string {
  return niz.replace(/dcl/g, "dl").replace(/DCL/g, "dl").replace(/Dcl/g, "dl");
}

/** Normalizira celoten niz: male črke + odstranitev diakritik + normalizacija enot + korenjenje vsake besede. */
function normalizirajSlo(niz: string): string {
  return odstraniDiakritike(normalizirajEnote(niz.toLowerCase().replace(/[-–—]/g, " ")))
    .split(/\s+/).map(koreniSlo).join(" ");
}

/**
 * Vgrajeni sinonimni pari — vedno aktivni, neodvisno od baze.
 * Format: [oblika v iskanju, oblika v imenu artikla] (ali obratno — ujemanje je dvosmerno).
 */
const SINONIMI: [string, string][] = [
  ["pica",     "pizza"    ],
  ["kafa",     "coffee"   ],
  ["pivo",     "beer"     ],
  ["sok",      "juice"    ],
  ["čaj",      "tea"      ],
  ["špageti",  "spaghetti"],
  ["rižota",   "risotto"  ],
  ["solata",   "salad"    ],
  ["juha",     "soup"     ],
  ["tortica",  "cake"     ],
  ["sladoled", "gelato"   ],
];

/**
 * Pretvori besedno obliko števila (po odstranitvi diakritik) v cifro.
 * Uporablja se za ujemanje iskanja "malica dva" z artiklom "Malica 2".
 */
const STEVKA_V_CIFRO: Record<string, string> = {
  en: "1", ena: "1", eno: "1", enega: "1",
  dve: "2", dva: "2", dveh: "2", dvema: "2",
  tri: "3", treh: "3",
  stiri: "4", stirih: "4",
  pet: "5", petih: "5",
  sest: "6", sestih: "6",
  sedem: "7", sedmih: "7",
  osem: "8", osmih: "8",
  devet: "9", devetih: "9",
  deset: "10", desetih: "10",
};

function zamenjajBesedneStevilke(niz: string): string {
  return niz.split(/\s+/).map(b => STEVKA_V_CIFRO[b] ?? b).join(" ");
}

/** Pretvori slovensko številko v besedi v integer (1–10). */
const STEVILKE_V_BESEDAH: Record<string, number> = {
  en: 1, ena: 1, eno: 1, enega: 1, eni: 1, enkrat: 1,
  dve: 2, dva: 2, dveh: 2, dvema: 2, dvakrat: 2,
  tri: 3, treh: 3, trem: 3, trikrat: 3,
  štiri: 4, "stiri": 4, štirih: 4, "stirih": 4, štirikrat: 4, "stirikrat": 4,
  pet: 5, petih: 5, petkrat: 5,
  šest: 6, "sest": 6, šestih: 6, "sestih": 6, šestkrat: 6, "sestkrat": 6,
  sedem: 7, sedmih: 7, sedemkrat: 7,
  osem: 8, osmih: 8, osemkrat: 8,
  devet: 9, devetih: 9, devetkrat: 9,
  deset: 10, desetih: 10, desetkrat: 10,
};

/** Vrne true če artikel z danim imenom ustreza iskanemu nizu (z upoštevanjem sklanjatev in sinonimov). */
function ujemaSeArtikel(ime: string, iskanje: string, extra: [string, string][] = []): boolean {
  const imeLow = ime.toLowerCase();
  const imeNorm = normalizirajSlo(imeLow);
  const iskanjeNorm = normalizirajSlo(iskanje);
  if (imeLow.includes(iskanje) || imeNorm.includes(iskanjeNorm)) return true;
  // Večbesedno iskanje: vse besede morajo biti prisotne v imenu (vrstni red ni važen)
  const besede = iskanjeNorm.split(/\s+/).filter(Boolean);
  if (besede.length > 1 && besede.every(b => imeNorm.includes(b))) return true;
  for (const [a, b] of [...SINONIMI, ...extra]) {
    const aN = normalizirajSlo(a);
    const bN = normalizirajSlo(b);
    // Ko se sinonim ujame, morajo preostale (ne-sinonimne) besede iskanja
    // prav tako biti prisotne v imenu artikla — sicer bi "pica malo" ujelo pivo.
    if (iskanjeNorm.includes(aN) && imeNorm.includes(bN)) {
      const sinonimBesede = new Set(aN.split(/\s+/).filter(Boolean));
      const ostale = besede.filter(w => !sinonimBesede.has(w));
      if (ostale.every(w => imeNorm.includes(w))) return true;
    }
    if (iskanjeNorm.includes(bN) && imeNorm.includes(aN)) {
      const sinonimBesede = new Set(bN.split(/\s+/).filter(Boolean));
      const ostale = besede.filter(w => !sinonimBesede.has(w));
      if (ostale.every(w => imeNorm.includes(w))) return true;
    }
  }
  // Zamenjaj besedne številke s ciframi na obeh straneh: "malica dva" ↔ "Malica 2", "malica ena" ↔ "Malica ena"
  // Obe strani pretvorimo z zamenjajBesedneStevilke, da se ujamejo vse kombinacije (cifra↔beseda).
  const iskanjeZCiframi = zamenjajBesedneStevilke(odstraniDiakritike(iskanje.toLowerCase()));
  const imeZCiframi     = zamenjajBesedneStevilke(odstraniDiakritike(imeLow));
  const normIskZC = normalizirajSlo(iskanjeZCiframi);
  const normImeZC = normalizirajSlo(imeZCiframi);
  if (normImeZC.includes(normIskZC)) return true;
  const bZC = normIskZC.split(/\s+/).filter(Boolean);
  if (bZC.length > 1 && bZC.every(b => normImeZC.includes(b))) return true;
  return false;
}
// ─────────────────────────────────────────────────────────────────────────────

function SortableArtikelCard({ artikel, onAdd, pending, flashing, artikliMap, isHappyHourActive, happyHourVelikostiPice }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: artikel.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const bg = artikel.barva ?? undefined;
  const hasColor = !!artikel.barva;

  const privzetiModArr = artikel.privzetiModifikatorji ?? [];
  const artModSkupineArr = (artikel as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
  // Prikaži privzete modifikatorje iz skupin (novi sistem)
  const privzetiNovImena = artModSkupineArr.flatMap(sk =>
    sk.modifikatorji.filter((m: ModSkupinaFull["modifikatorji"][number]) => privzetiModArr.includes(m.id)).map((m: ModSkupinaFull["modifikatorji"][number]) => m.ime)
  );
  const privzetiImena = privzetiNovImena.length > 0 ? privzetiNovImena.slice(0, 3) : null;
  const privzetiOstanek = privzetiNovImena.length > 3 ? privzetiNovImena.length - 3 : 0;
  const modifierPortions = artModSkupineArr.flatMap(sk =>
    sk.modifikatorji.filter(m => m.aktiven && artikel.modifierAvailability?.has(m.id))
      .map(m => `${m.ime}: ${artikel.modifierAvailability!.get(m.id)} porcij`),
  );
  // Strežnik izpusti neaktivne velikosti; odsotna velikost ni neomejena zaloga.
  const availablePizzaSizes = ([
    ["mala", "Mala"],
    ["normalna", "Normalna"],
    ["druzinska", "Družinska"],
  ] as const).filter(([size]) => artikel.availableBySize?.[size] !== undefined);

  return (
    <div ref={setNodeRef} style={style}>
      <button
        className="relative flex flex-col items-start p-3 border rounded-lg shadow-sm text-left w-full justify-between transition-all hover:brightness-95 active:scale-95"
        style={{
          backgroundColor: bg ?? "hsl(var(--card))",
          color: hasColor ? "#fff" : undefined,
          borderColor: hasColor ? "transparent" : undefined,
          animation: flashing ? "pos-flash 0.28s ease-out" : undefined,
          minHeight: privzetiImena ? "5.5rem" : "4.5rem",
        }}
        onClick={() => onAdd(artikel.id)}
        disabled={pending}
      >
        <span
          className="text-xs font-semibold leading-tight pr-5"
          style={{ color: hasColor ? "rgba(255,255,255,0.95)" : undefined }}
        >
          {artikel.ime}
        </span>
        {(() => {
          const hhCena = artikel.happyHourCena;
          const hhAktiven = isHappyHourActive && (hhCena != null || artikel.happyHourCenaMala != null || artikel.happyHourCenaDruzinska != null);
          const hhOznaka = artikel.jePica
            ? [
                happyHourVelikostiPice?.has("mala") ? "M" : null,
                happyHourVelikostiPice?.has("normalna") ? "V" : null,
                happyHourVelikostiPice?.has("druzinska") ? "D" : null,
              ].filter(Boolean).join("/")
            : "";
          const osnovnaCenaJeHappyHour = hhAktiven
            && (!artikel.jePica || happyHourVelikostiPice?.has("normalna"));
          return (
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {hhAktiven && (
                <span className="text-[10px] font-bold rounded px-1 py-0" style={{ backgroundColor: "rgba(251,191,36,0.9)", color: "#000" }}>
                  {artikel.jePica ? `⭐ HH ${hhOznaka}` : `⭐ ${hhCena!.toFixed(2)} €`}
                </span>
              )}
              <span
                className="text-sm font-bold"
                style={{
                  color: hasColor ? "rgba(255,255,255,0.9)" : "hsl(var(--primary))",
                  textDecoration: osnovnaCenaJeHappyHour ? "line-through" : undefined,
                  opacity: osnovnaCenaJeHappyHour ? 0.6 : 1,
                  fontSize: osnovnaCenaJeHappyHour ? "0.7rem" : undefined,
                }}
              >
                {artikel.cena.toFixed(2)} €
              </span>
            </div>
          );
        })()}

        {artikel.jePica && availablePizzaSizes.length > 0 ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: hasColor ? "rgba(255,255,255,0.2)" : "hsl(var(--secondary))",
              color: hasColor ? "#fff" : "hsl(var(--secondary-foreground))",
            }}
            data-testid={`available-portions-${artikel.id}`}
          >
            {availablePizzaSizes.map(([size, label]) => (
              <span key={size} className="mr-1.5 last:mr-0">
                {label}: {artikel.availableBySize?.[size] == null ? "brez izračunane omejitve" : artikel.availableBySize?.[size]}
              </span>
            ))}
          </span>
        ) : artikel.mealType !== "ala_carte" && artikel.availableQuantity != null && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: hasColor ? "rgba(255,255,255,0.2)" : "hsl(var(--secondary))",
              color: hasColor ? "#fff" : "hsl(var(--secondary-foreground))",
            }}
            data-testid={`available-portions-${artikel.id}`}
          >
            {artikel.availableQuantity} porcij
          </span>
        )}
        {modifierPortions.length > 0 && (
          <span
            className="w-full text-[10px] leading-tight"
            style={{ color: hasColor ? "rgba(255,255,255,0.85)" : "hsl(var(--muted-foreground))" }}
            title={modifierPortions.join(" · ")}
            data-testid={`modifier-portions-${artikel.id}`}
          >
            Dodatki: {modifierPortions.slice(0, 2).join(" · ")}
            {modifierPortions.length > 2 ? ` · +${modifierPortions.length - 2}` : ""}
          </span>
        )}

        {privzetiImena && (
          <span
            className="flex items-center gap-0.5 text-[10px] leading-tight mt-0.5 w-full"
            style={{ color: hasColor ? "rgba(255,255,255,0.7)" : "hsl(var(--muted-foreground))" }}
          >
            <Plus className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {privzetiImena.join(", ")}{privzetiOstanek > 0 ? ` +${privzetiOstanek}` : ""}
            </span>
          </span>
        )}

        {/* Drag handle — stops click propagation so drag doesn't trigger add */}
        <span
          {...attributes}
          {...listeners}
          className="absolute top-1.5 right-1.5 cursor-grab active:cursor-grabbing p-0.5 rounded opacity-40 hover:opacity-80"
          style={{ color: hasColor ? "#fff" : undefined, touchAction: "none" }}
          onClick={e => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  );
}

// ── Grupiranje podobnih artiklov ────────────────────────────────
interface ArtikelGrupa {
  type: "grupa";
  baseIme: string;
  barva?: string | null;
  children: ArtikelItem[];
}
type GridItem = { type: "artikel"; artikel: ArtikelItem } | ArtikelGrupa;

// Volumen: "3 decilitre", "5 decilitrov", "0,5 litrov", "3 dl", "5 l", "330 ml" …
const SKUPINA_VOLUMEN_RE = /\d+[,.]?\d*\s*(decilitr[a-z]*|dl\b|litr[a-z]*|liter\b|ml\b|cl\b|l\b)/gi;
// Velikost: "velika", "mala", "mali", "malo", "velik", "majhna" …
const SKUPINA_VELIKOST_RE = /\b(velik[ao]?[io]?|mali?[ao]?[io]?|majhni?[ao]?[io]?|polovičn[aio]?|2-1|1-2)\b/gi;
// Osamljene številke: "1", "2" …
const SKUPINA_STEVILKA_RE = /\b\d+\b/g;

function normalizirajSkupinaIme(ime: string): string {
  return ime
    .replace(SKUPINA_VOLUMEN_RE, " ")
    .replace(SKUPINA_VELIKOST_RE, " ")
    .replace(SKUPINA_STEVILKA_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function skupinaArtiklov(list: ArtikelItem[]): GridItem[] {
  // Ključ za grupiranje: eksplicitna skupina (s: prefix) ali normalizirano ime
  const getKey = (a: ArtikelItem): string =>
    a.skupina ? `s:${a.skupina.toLowerCase()}` : normalizirajSkupinaIme(a.ime).toLowerCase();
  const getDisplayName = (a: ArtikelItem): string =>
    a.skupina ? a.skupina : normalizirajSkupinaIme(a.ime);

  // Štej koliko artiklov ima enak ključ
  const groupCount = new Map<string, number>();
  for (const a of list) {
    const key = getKey(a);
    if (key) groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
  }

  // Zberi otroke in ime za prikaz (iz prve pojavitve)
  const groupChildren = new Map<string, ArtikelItem[]>();
  const groupDisplayName = new Map<string, string>();
  for (const a of list) {
    const key = getKey(a);
    if ((groupCount.get(key) ?? 0) >= 2) {
      if (!groupChildren.has(key)) {
        groupChildren.set(key, []);
        groupDisplayName.set(key, getDisplayName(a));
      }
      groupChildren.get(key)!.push(a);
    }
  }

  // Sestavi rezultat — skupina se pojavi na mestu prvega člana
  const addedGroups = new Set<string>();
  const result: GridItem[] = [];
  for (const a of list) {
    const key = getKey(a);
    if ((groupCount.get(key) ?? 0) >= 2) {
      if (!addedGroups.has(key)) {
        addedGroups.add(key);
        const children = groupChildren.get(key)!;
        result.push({
          type: "grupa",
          baseIme: groupDisplayName.get(key)!,
          barva: children[0].barva,
          children,
        });
      }
    } else {
      result.push({ type: "artikel", artikel: a });
    }
  }
  return result;
}

function GrupaGumbStaro({ grupa, onAdd, pendingArtikliIds, artikliMap }: { grupa: ArtikelGrupa; onAdd: (id: number) => void; pendingArtikliIds: Set<number>; artikliMap?: Map<number, ArtikelLookup> }) {
  const [open, setOpen] = useState(false);
  const bg = grupa.barva ?? undefined;
  const hasColor = !!grupa.barva;
  const allPending = grupa.children.every(a => pendingArtikliIds.has(a.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex flex-col items-start p-3 border rounded-lg shadow-sm text-left min-h-[4.5rem] w-full justify-between transition-all hover:brightness-95 active:scale-95"
          style={{ backgroundColor: bg ?? "hsl(var(--card))", color: hasColor ? "#fff" : undefined, borderColor: hasColor ? "transparent" : undefined }}
          disabled={allPending}
        >
          <span className="text-xs font-semibold leading-tight" style={{ color: hasColor ? "rgba(255,255,255,0.95)" : undefined }}>{grupa.baseIme}</span>
          <span className="flex items-center gap-0.5 text-xs" style={{ color: hasColor ? "rgba(255,255,255,0.7)" : "hsl(var(--muted-foreground))" }}>
            <ChevronDown className="w-3 h-3" />{grupa.children.length}×
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" side="top">
        <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">{grupa.baseIme}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {grupa.children.map(a => {
            const privzetiModArr = a.privzetiModifikatorji ?? [];
            const aModSkupineArr = (a as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
            const privzetiNovImenaA = aModSkupineArr.flatMap(sk =>
              sk.modifikatorji.filter((m: ModSkupinaFull["modifikatorji"][number]) => privzetiModArr.includes(m.id)).map((m: ModSkupinaFull["modifikatorji"][number]) => m.ime)
            );
            const privzetiImena = privzetiNovImenaA.length > 0 ? privzetiNovImenaA.slice(0, 3) : null;
            const privzetiOstanek = privzetiNovImenaA.length > 3 ? privzetiNovImenaA.length - 3 : 0;
            return (
              <button
                key={a.id}
                className="flex flex-col items-start p-2.5 border rounded-md text-left transition-colors hover:bg-accent"
                style={{ backgroundColor: a.barva ?? undefined, color: a.barva ? "#fff" : undefined, borderColor: a.barva ? "transparent" : undefined }}
                onClick={() => { onAdd(a.id); setOpen(false); }}
                disabled={pendingArtikliIds.has(a.id)}
              >
                <span className="text-xs font-semibold leading-tight">{a.ime}</span>
                <span className="text-xs font-bold mt-0.5" style={{ color: a.barva ? "rgba(255,255,255,0.9)" : "hsl(var(--primary))" }}>{a.cena.toFixed(2)} €</span>
                {privzetiImena && (
                  <div className="flex items-center gap-0.5 text-[10px] leading-tight mt-1" style={{ color: a.barva ? "rgba(255,255,255,0.7)" : "hsl(var(--muted-foreground))" }}>
                    <Plus className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      {privzetiImena.join(", ")}{privzetiOstanek > 0 ? ` +${privzetiOstanek}` : ""}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Izvleče razlikovalni del variante (npr. "3 decilitre", "velika", "1")
function ekstrahirajVariantoLabel(ime: string): string {
  const volMatch = ime.match(/\d+[,.]?\d*\s*(decilitr[a-z]*|dl\b|litr[a-z]*|liter\b|ml\b|cl\b|l\b)/i);
  if (volMatch) return volMatch[0].trim();
  const sizeMatch = ime.match(/\b(velik[ao]?[io]?|mali?[ao]?[io]?|majhni?[ao]?[io]?)\b/i);
  if (sizeMatch) return sizeMatch[0].trim();
  const numMatch = ime.match(/\b(\d+)\s*$/);
  if (numMatch) return numMatch[1];
  return ime.trim().split(/\s+/).pop() ?? ime;
}

// Vrne sort ključ variante — po volumnu (normalizirano v litre) ali ceni
function variantoSortKljuc(label: string, cena: number): number {
  const m = label.match(/(\d+[,.]?\d*)/);
  if (m) {
    const num = parseFloat(m[1].replace(",", "."));
    if (/decilitr|dl\b/i.test(label)) return num / 10;
    if (/\bcl\b/i.test(label)) return num / 100;
    if (/\bml\b/i.test(label)) return num / 1000;
    if (/litr|liter/i.test(label)) return num;
    return num;
  }
  if (/\bmal/i.test(label)) return -1;
  if (/\bvelik/i.test(label)) return 1;
  return cena;
}

function GrupaGumb({ grupa, onAdd, pendingArtikliIds, artikliMap }: { grupa: ArtikelGrupa; onAdd: (id: number) => void; pendingArtikliIds: Set<number>; artikliMap?: Map<number, ArtikelLookup> }) {
  const [open, setOpen] = useState(false);
  const bg = grupa.barva ?? undefined;
  const hasColor = !!grupa.barva;
  const allPending = grupa.children.every(a => pendingArtikliIds.has(a.id));

  const varianteZLabeli = useMemo(() =>
    grupa.children
      .map(a => ({ ...a, varLabel: ekstrahirajVariantoLabel(a.ime) }))
      .sort((a, b) => variantoSortKljuc(a.varLabel, a.cena) - variantoSortKljuc(b.varLabel, b.cena)),
    [grupa.children]
  );

  const cenaMin = Math.min(...grupa.children.map(a => a.cena));
  const cenaMax = Math.max(...grupa.children.map(a => a.cena));
  const cols = varianteZLabeli.length <= 3
    ? "grid-cols-1"
    : varianteZLabeli.length <= 6
      ? "grid-cols-1 sm:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <>
      <button
        className="relative flex flex-col items-start p-3 border rounded-lg shadow-sm text-left min-h-[4.5rem] w-full justify-between transition-all hover:brightness-95 active:scale-95"
        style={{
          backgroundColor: bg ?? "hsl(var(--card))",
          color: hasColor ? "#fff" : undefined,
          borderColor: hasColor ? "transparent" : undefined,
        }}
        disabled={allPending}
        onClick={() => setOpen(true)}
      >
        <span className="text-xs font-semibold leading-tight pr-5" style={{ color: hasColor ? "rgba(255,255,255,0.95)" : undefined }}>
          {grupa.baseIme}
        </span>
        <div className="flex items-center justify-between w-full">
          <span className="text-sm font-bold" style={{ color: hasColor ? "rgba(255,255,255,0.9)" : "hsl(var(--primary))" }}>
            {cenaMin === cenaMax ? `${cenaMin.toFixed(2)} €` : `od ${cenaMin.toFixed(2)} €`}
          </span>
          <span className="flex items-center gap-0.5 text-xs" style={{ color: hasColor ? "rgba(255,255,255,0.6)" : "hsl(var(--muted-foreground))" }}>
            <ChevronDown className="w-3.5 h-3.5" />{grupa.children.length}
          </span>
        </div>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80" onClick={() => setOpen(false)}>
          <div
            role="region"
            aria-label={grupa.baseIme}
            className="absolute inset-x-0 top-0 flex h-[75dvh] max-h-[75dvh] flex-col overflow-hidden rounded-b-[10px] border bg-background"
            onClick={event => event.stopPropagation()}
          >
          <div className="shrink-0 border-b p-4 pb-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold leading-none tracking-tight">{grupa.baseIme}</h2>
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent transition-colors"
              onClick={() => setOpen(false)}
              aria-label="Zapri izbor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          </div>
        <div
          className={`min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-scroll p-4 pb-8 grid content-start gap-3 ${cols}`}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {varianteZLabeli.map(a => {
            const aBg = a.barva ?? undefined;
            const aHasColor = !!a.barva;
            const privzetiModArr = a.privzetiModifikatorji ?? [];
            const aModSkupineArrD = (a as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
            const privzetiNovImenaD = aModSkupineArrD.flatMap(sk =>
              sk.modifikatorji.filter((m: ModSkupinaFull["modifikatorji"][number]) => privzetiModArr.includes(m.id)).map((m: ModSkupinaFull["modifikatorji"][number]) => m.ime)
            );
            const privzetiImena = privzetiNovImenaD.length > 0 ? privzetiNovImenaD.slice(0, 3) : null;
            const privzetiOstanek = privzetiNovImenaD.length > 3 ? privzetiNovImenaD.length - 3 : 0;
            return (
              <button
                key={a.id}
                className="flex items-center gap-4 p-4 border rounded-xl text-left transition-all hover:brightness-95 active:scale-[0.98] min-h-[5rem] shadow-sm"
                style={{
                  backgroundColor: aBg ?? "hsl(var(--card))",
                  color: aHasColor ? "#fff" : undefined,
                  borderColor: aHasColor ? "transparent" : undefined,
                }}
                onClick={() => { onAdd(a.id); setOpen(false); }}
                disabled={pendingArtikliIds.has(a.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xl font-bold leading-tight" style={{ color: aHasColor ? "rgba(255,255,255,0.95)" : undefined }}>
                    {a.varLabel}
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: aHasColor ? "rgba(255,255,255,0.6)" : "hsl(var(--muted-foreground))" }}>
                    {a.ime}
                  </div>
                  {privzetiImena && (
                    <div className="flex items-center gap-0.5 text-[10px] leading-tight mt-1" style={{ color: aHasColor ? "rgba(255,255,255,0.7)" : "hsl(var(--muted-foreground))" }}>
                      <Plus className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">
                        {privzetiImena.join(", ")}{privzetiOstanek > 0 ? ` +${privzetiOstanek}` : ""}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-xl font-extrabold shrink-0" style={{ color: aHasColor ? "rgba(255,255,255,0.9)" : "hsl(var(--primary))" }}>
                  {a.cena.toFixed(2)} €
                </div>
              </button>
            );
          })}
        </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

interface DiscountInputProps {
  postavkaId: number;
  cenaKos: number;
  cenaKosOriginalna: number | null;
  kolicina: number;
  onApply: (postavkaId: number, novaCenaKos: number) => void;
  onCancel: () => void;
}

function DiscountInput({ postavkaId, cenaKos, cenaKosOriginalna, kolicina, onApply, onCancel }: DiscountInputProps) {
  const [mode, setMode] = useState<"%" | "€">("%");
  const [value, setValue] = useState("");

  const originalCena = cenaKosOriginalna ?? cenaKos;

  function handleApply() {
    const num = parseFloat(value.replace(",", "."));
    if (isNaN(num) || num < 0) return;

    let novaCenaKos: number;
    if (mode === "%") {
      if (num > 100) return;
      novaCenaKos = Math.round(originalCena * (1 - num / 100) * 100) / 100;
    } else {
      if (num > originalCena) return;
      novaCenaKos = Math.round((originalCena - num) * 100) / 100;
    }
    if (novaCenaKos < 0) novaCenaKos = 0;
    onApply(postavkaId, novaCenaKos);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleApply();
    if (e.key === "Escape") onCancel();
  }

  const previewCena = (() => {
    const num = parseFloat(value.replace(",", "."));
    if (isNaN(num) || num < 0) return null;
    if (mode === "%") {
      if (num > 100) return null;
      return Math.round(originalCena * (1 - num / 100) * 100) / 100;
    } else {
      if (num > originalCena) return null;
      return Math.round((originalCena - num) * 100) / 100;
    }
  })();

  return (
    <div className="flex items-center gap-1 pl-5 py-1 bg-muted/60 rounded-md">
      {/* mode toggle */}
      <button
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${mode === "%" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background"}`}
        onClick={() => setMode("%")}
        type="button"
      >
        %
      </button>
      <button
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${mode === "€" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background"}`}
        onClick={() => setMode("€")}
        type="button"
      >
        €
      </button>
      <Input
        autoFocus
        className="h-6 w-16 text-xs px-1.5"
        placeholder={mode === "%" ? "10" : "0.50"}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        inputMode="decimal"
      />
      {previewCena !== null && (
        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          → {previewCena.toFixed(2)} €
        </span>
      )}
      <button
        className="h-6 w-6 flex items-center justify-center rounded text-green-600 hover:bg-green-100 disabled:opacity-40"
        onClick={handleApply}
        disabled={previewCena === null}
        type="button"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
        onClick={onCancel}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function Order() {
  const params = useParams();
  const gatewayOrderId = params.id ? parseLocalOrderRoute(params.id) ?? null : null;
  const cloudId = params.id && !gatewayOrderId && /^\d+$/.test(params.id) ? Number(params.id) : undefined;
  const id = cloudId as number;
  const gatewayOffline = useGatewayOfflineContext();
  const gatewayMode = gatewayOffline.effectiveAuthority === "GATEWAY" ||
    (!!gatewayOrderId && gatewayOffline.authorityForOrder(gatewayOrderId) === "GATEWAY");
  const [, setLocation] = useLocation();
  const urlSearch = useSearch();
  const urlGost = (() => {
    const raw = new URLSearchParams(urlSearch).get("gost");
    if (!raw) return null;
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
  })();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const leaveClosedOrder = () => {
    void queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
    toast({
      title: "Naročilo je zaprto",
      description: "Račun je bil izdan na drugem terminalu. Vračam vas na pregled miz.",
      variant: "destructive",
    });
    setLocation("/");
  };
  const isClosedOrderConflict = (err: unknown) => {
    if (!(err instanceof ApiError) || err.status !== 409) return false;
    const data = err.data as { code?: string; error?: string } | null;
    return data?.code === "ORDER_ALREADY_CLOSED"
      || /naročilo (ni odprto|je zaprto|je že zaključeno)|račun je bil že izdan|že pokrite z račun/i.test(
        data?.error?.toLocaleLowerCase("sl") ?? "",
      );
  };
  const [mobileTab, setMobileTab] = useState<"meni" | "narocilo">("meni");
  const [flashingId, setFlashingId] = useState<number | null>(null);
  const [discountOpenId, setDiscountOpenId] = useState<number | null>(null);
  // Modifikatorji dialog: prikaže se pred dodajanjem artikla z obveznimi skupinami
  const [modDialogArtikelId, setModDialogArtikelId] = useState<number | null>(null);
  const [modDialogIzbrani, setModDialogIzbrani] = useState<{ skupinaId: number; modifikatorId: number }[]>([]);
  const [modDialogPodIzbire, setModDialogPodIzbire] = useState<Record<string, number[]>>({});
  const [modDialogKolicina, setModDialogKolicina] = useState(1);
  const [modDialogOpomba, setModDialogOpomba] = useState<string | null>(null);
  const [modDialogVelikostPice, setModDialogVelikostPice] = useState<"mala" | "normalna" | "druzinska" | undefined>();
  // Opcije dialog: naknadni dostop do izbirnih skupin obstoječe postavke
  const [opcijePostavkaId, setOpcijePostavkaId] = useState<number | null>(null);
  const [opcijeIzbrani, setOpcijeIzbrani] = useState<{ skupinaId: number; modifikatorId: number }[]>([]);
  const [opcijePodIzbire, setOpcijePodIzbire] = useState<Record<string, number[]>>({});
  const [opcijeNestedDataError, setOpcijeNestedDataError] = useState(false);
  const [mikrofon, setMikrofon] = useState<{ postavkaId: number; stanje: "poslusam" | "napaka" } | null>(null);
  const [aiObdeluje, setAiObdeluje] = useState(false);
  // Ločeno od hook-ovega poslusam: ostane true skozi celotno glasovno sejo (vključno z
  // avtomatskimi Chrome restarti), da gumb ne utripa med ponovnim zaganjanjem seje.
  const [glasovnoAktivno, setGlasovnoAktivno] = useState(false);
  const [glasovnoTranskript, setGlasovnoTranskript] = useState("");
  const [opombaPostavka, setOpombaPostavka] = useState<{ id: number; kolicina: number; opomba: string | null } | null>(null);
  const { zacni: zacniMikrofon, ustavi: ustaviMikrofon } = useGlasovniUkaz();
  const [steviloGostov, setSteviloGostov] = useState(0);
  const [aktivniGostStevilka, setAktivniGostStevilka] = useState<number | null>(urlGost);
  const [spojiDialogOpen, setSpojiDialogOpen] = useState(false);
  const [prestaviDialogOpen, setPrestaviDialogOpen] = useState(false);
  const [gatewayConflict, setGatewayConflict] = useState<unknown | null>(null);
  const [uvozDialogOpen, setUvozDialogOpen] = useState(false);
  const [uvozRacunId, setUvozRacunId] = useState<number | null>(null);
  const [uvozKolicine, setUvozKolicine] = useState<Map<number, number>>(new Map());
  const [uvozIzkljuceni, setUvozIzkljuceni] = useState<Set<number>>(new Set());
  const [uvozIsci, setUvozIsci] = useState("");
  const [uvozVprogress, setUvozVprogress] = useState(false);
  const [pendingPostavke, setPendingPostavke] = useState<Set<number>>(new Set());
  const [pendingArtikli, setPendingArtikli] = useState<Set<number>>(new Set());
  const [toGoDdVWarningVisible, setToGoDdVWarningVisible] = useState(false);
  const [casDialogOpen, setCasDialogOpen] = useState(false);
  const [casZaUrejanje, setCasZaUrejanje] = useState("");
  const [multicourseMenu, setMulticourseMenu] = useState<MulticourseMenuConfig | null>(null);
  const [multicourseCourses, setMulticourseCourses] = useState<number[]>([]);
  const [multicourseFoods, setMulticourseFoods] = useState<Record<number, number>>({});
  const [multicourseWines, setMulticourseWines] = useState<Record<number, number>>({});
  const [multicourseOpomba, setMulticourseOpomba] = useState("");
  const [multicourseError, setMulticourseError] = useState<string | null>(null);

  const { data: cloudNarocilo, isLoading: cloudOrderLoading } = useGetNarocilo(id, {
    query: { enabled: !!id && !gatewayMode, queryKey: getGetNarociloQueryKey(id) },
  });
  const gatewayOrder = gatewayOffline.snapshot?.orders.find(order => String(order.orderId) === String(gatewayOrderId));
  const narocilo = (gatewayMode && gatewayOrder
    ? (() => {
      const projection = (gatewayOrder.projection ?? gatewayOrder) as Record<string, any>;
       const lines = Array.isArray(projection.lines) ? projection.lines : [];
      return {
        ...projection, id: gatewayOrderId, mizaId: projection.mizaId ?? projection.tableId ?? null,
        status: projection.status === "OPEN" || projection.status === "open" ? "odprto" : projection.status,
        postavke: lines, skupaj: Number(projection.skupaj ?? projection.total ?? 0),
      };
    })()
    : gatewayMode ? undefined : cloudNarocilo) as typeof cloudNarocilo;
  const loadingNarocila = gatewayMode
    ? !gatewayOffline.snapshot : cloudOrderLoading;
  const leaseRef = useRef<import("@/lib/gatewayClient").GatewayLease | null>(null);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!gatewayMode || !gatewayOrderId || !gatewayOffline.snapshot) return;
    let disposed = false;
    let renewTimer: number | undefined;
    void gatewayOffline.acquireLease(
      gatewayOrderId,
      Number(gatewayOrder?.version ?? 0),
      120,
    ).then(lease => {
      if (disposed) {
        void gatewayOffline.releaseLease(lease);
        return;
      }
      leaseRef.current = lease;
      renewTimer = window.setInterval(() => {
        if (leaseRef.current) {
          void gatewayOffline.renewLease(leaseRef.current, 120)
            .then(next => { leaseRef.current = next; });
        }
      }, 60_000);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      if (renewTimer) window.clearInterval(renewTimer);
      const lease = leaseRef.current;
      leaseRef.current = null;
      if (lease) void gatewayOffline.releaseLease(lease);
    };
  }, [gatewayMode, gatewayOrderId, gatewayOffline.scope?.companyId,
    gatewayOffline.scope?.enotaId, gatewayOffline.acquireLease,
    gatewayOffline.renewLease, gatewayOffline.releaseLease]);

  const getNarociloPayload = useCallback(() => {
    if (!narocilo) return null;
    return {
      id: narocilo.id,
      nacin: (narocilo as any).nacin,
      status: narocilo.status,
      miza: narocilo.mizaId,
      strankaIme: narocilo.strankaIme,
      telefon: narocilo.strankaTelefon,
      naslovDostave: narocilo.dostavaUlica
        ? [
            `${narocilo.dostavaUlica} ${narocilo.dostavaHisnaStevilka ?? ""}`.trim(),
            narocilo.dostavaNaseljeNaziv,
          ].filter(Boolean).join(", ")
        : null,
      skupaj: narocilo.skupaj,
      postavke: (narocilo.postavke ?? []).filter((p: any) => !p.parentPostavkaId).map((p: any) => ({
        naziv: p.ime,
        kolicina: p.kolicina,
        skupaj: p.skupaj,
        opomba: p.opomba
      }))
    };
  }, [narocilo]);

  const aiSvetovalec = useAiSvetovalec("narocilo", getNarociloPayload);

  // A waiter must be able to release the next multicourse course without
  // navigating to the kitchen screen. Query every KDS station because a prior
  // course can span more than one station.
  const { data: kdsPostaje = [] } = useKdsPostaje();
  const { data: kdsNastavitve } = useGetKdsNastavitve({
    query: { queryKey: [...getGetKdsNastavitveQueryKey(), gatewayOffline.scope?.enotaId],
      enabled: !!gatewayOffline.scope?.enotaId },
  });
  const kdsPostajaIds = useMemo(() => kdsPostaje.map((postaja) => postaja.id), [kdsPostaje]);
  const { data: kdsRouting = [] } = useQuery<Array<{ postajaId: number; artikelId: number | null; kategorijaId: number | null }>>({
    queryKey: ["kds", "routing", gatewayOffline.scope?.enotaId, kdsPostajaIds],
    enabled: kdsPostajaIds.length > 0,
    queryFn: async () => (await Promise.all(kdsPostajaIds.map(async (postajaId) => {
      const mappings = await customFetch<Array<{ artikelId: number | null; kategorijaId: number | null }>>(
        `/api/kds/postaje/${postajaId}/mapiranja`,
      );
      return mappings.map(mapping => ({ ...mapping, postajaId }));
    }))).flat(),
  });
  const kdsNalogQueries = useKdsNalogiVecPostaj(kdsPostajaIds);
  const activeKdsOrderId = gatewayMode && gatewayOrderId ? gatewayOrderId : id;
  const orderKdsNalogi = useMemo(
    () => selectOrderKdsNalogi(
      kdsNalogQueries.flatMap((query) => query.data ?? []),
      gatewayMode, gatewayOrderId, id,
    ),
    [kdsNalogQueries, activeKdsOrderId, gatewayOrderId, gatewayMode],
  );
  const nextKdsCourses = useMemo(() => getNextKdsCoursesToFire(orderKdsNalogi), [orderKdsNalogi]);
  const { data: artikli, isLoading: loadingArtikli } = useListArtikli(undefined, {
    query: {
      queryKey: getListArtikliQueryKey(),
      staleTime: ORDER_MENU_STALE_TIME,
    },
  });
  const { data: preparedFoodAvailability } = useGetPreparedFoodAvailability({
    query: {
      queryKey: getGetPreparedFoodAvailabilityQueryKey(),
      refetchInterval: 5_000,
      staleTime: 2_000,
    },
  });
  const modifierAvailabilityById = useMemo(
    () => new Map((preparedFoodAvailability?.modifierItems ?? [])
      .map(item => [item.modifierId, item.availableQuantity] as const)),
    [preparedFoodAvailability],
  );
  const { data: kategorije, isLoading: loadingKategorije } = useListKategorije({
    query: {
      queryKey: getListKategorijeQueryKey(),
      staleTime: ORDER_MENU_STALE_TIME,
    },
  });
  const danasStr = preparedFoodAvailability?.businessDate ?? poslovniDatumZaCas();
  const { data: dnevniMeniDanes } = useListDnevniMeni({ od: danasStr, do: danasStr });
  // This endpoint is intentionally not generated yet; keep its cache key explicit
  // so menu configuration changes get a normal freshness path.
  const { data: multicourseMenuji = [] } = useQuery<MulticourseMenuConfig[]>({
    queryKey: ["/api/multicourse-menus"],
    queryFn: () => customFetch<MulticourseMenuConfig[]>("/api/multicourse-menus"),
    staleTime: ORDER_MENU_STALE_TIME,
  });
  const activeMulticourseMenuArticleIds = useMemo(
    () => new Set(multicourseMenuji.filter((menu) => menu.aktivno).map((menu) => menu.menuArtikelId)),
    [multicourseMenuji],
  );
  const { data: mize } = useListMize();
  const currentMiza = mize?.find(m => m.id === narocilo?.mizaId);
  const isBlocked = !!currentMiza?.noviNarocilaBlokirani || !!currentMiza?.novaNarocilaBlokirana || gatewayConflict !== null;
  const { data: prostori } = useListProstori();
  const { naprava } = useNaprava();
  const { nastavitve } = useNastavitve();
  const grupiranjeNacin = (nastavitve as ({ grupiranjeNacin?: string } | undefined))?.grupiranjeNacin ?? "novo";
  const aktivneVelikostiPice = [
    { id: "mala" as const, premer: Number((nastavitve as any)?.picaPremerMala ?? 0) },
    { id: "normalna" as const, premer: Number((nastavitve as any)?.picaPremerNormalna ?? 0) },
    { id: "druzinska" as const, premer: Number((nastavitve as any)?.picaPremerDruzinska ?? 0) },
  ].filter((velikost) => velikost.premer > 0);
  const privzetaVelikostPice = aktivneVelikostiPice.find((velikost) => velikost.id === "normalna")?.id
    ?? aktivneVelikostiPice[0]?.id;
  const { status: hhStatus } = useHappyHour();
  const activeHappyHourArticleIds = useMemo(
    () => new Set(hhStatus?.aktivniArtikelIds ?? []),
    [hhStatus?.aktivniArtikelIds],
  );
  const activeHappyHourPizzaSizes = useMemo(
    () => new Map(
      Object.entries(hhStatus?.aktivneVelikostiPice ?? {}).map(([artikelId, velikosti]) => [
        Number(artikelId),
        new Set(velikosti),
      ]),
    ),
    [hhStatus?.aktivneVelikostiPice],
  );
  const { data: racuniZaUvoz } = useListRacuni(undefined, {
    query: { enabled: uvozDialogOpen && uvozRacunId === null, queryKey: getListRacuniQueryKey() },
  });
  const { data: uvozPostavke, isLoading: loadingUvozPostavke } = useGetRacunPostavke(
    uvozRacunId ?? 0,
    { query: { enabled: uvozRacunId != null, queryKey: getGetRacunPostavkeQueryKey(uvozRacunId ?? 0) } }
  );
  const autoStartsHome = (mize !== undefined && mize.length === 0) || (naprava?.dovoljeneMize?.length === 1);
  const backUrl = autoStartsHome ? "/?skipAutoStart=1" : "/";

  // Ref sinhroniziran z artikliMapForOrder na vsakem renderu (dlje spodaj);
  // onMutate bere .current ob klicu — vedno najnovejši katalog
  const _artikliMapRef = useRef<Map<number, ArtikelZaOptimistiko>>(new Map());
  const cloudAddPostavka = useAddPostavkaOptimistic(_artikliMapRef);
  const cloudRemovePostavka = useRemovePostavka();
  const cloudUpdateKolicina = useUpdatePostavkaKolicina();
  const cloudAddModifikatorji = useAddPostavkaModifikatorji();
  const spojiMutation = useSpojiNarocili();
  const cloudPrestaviMutation = useUpdateNarocilo();
  const cloudUpdateNarociloForOrder = useUpdateNarocilo();
  const cloudCancelNarocilo = useUpdateNarocilo();
  const addMulticourseMenu = useAddMulticourseMenu();
  const fireKdsCourse = useFireKdsCourse();
  type GatewayMutation = {
    isPending: boolean;
    mutate: (value: any, options?: {
      onSuccess?: (result: any) => void;
      onError?: (error: any) => void;
      onSettled?: () => void;
    }) => void;
    mutateAsync: (value: any) => Promise<any>;
  };

  const gatewayReplaceSnapshot = useCallback(async (mutate: (snapshot: GatewayOrderSnapshot) => GatewayOrderSnapshot) => {
    if (!gatewayMode || !narocilo || !gatewayOrderId) {
      throw new Error("Gateway način ni aktiven.");
    }
    const write = async () => {
      const lease = leaseRef.current ?? await gatewayOffline.acquireLease(
        gatewayOrderId, Number(gatewayOrder?.version ?? 0),
      );
      leaseRef.current = lease;
      const result = await gatewayOffline.replaceOrder((latest) => mutate({
        ...latest, orderId: gatewayOrderId,
        companyId: gatewayOffline.scope!.companyId, enotaId: gatewayOffline.scope!.enotaId,
        projection: latest.projection,
        lines: (latest.lines ?? []).map((line: any) => ({ ...line, lineId: String(line.lineId ?? line.id) })),
      }), lease);
      leaseRef.current = { ...lease, version: result.version };
      const projected = { ...result.projection, id: gatewayOrderId,
        status: result.projection.status === "open" ? "odprto" : result.projection.status,
        postavke: (result.projection.lines ?? []).map((line: any) => ({
          ...line, id: line.id ?? line.lineId,
        })) };
      queryClient.setQueryData(getGetNarociloQueryKey(id), projected);
      return projected;
    };
    try {
      const result = writeQueueRef.current.then(write, write);
      writeQueueRef.current = result.catch(() => undefined);
      return await result;
    } catch (error) {
      if (error instanceof GatewayConflictError || gatewayOffline.isConflict(error)) setGatewayConflict(error);
      throw error;
    }
  }, [gatewayOffline, narocilo, gatewayOrderId, gatewayOrder, queryClient, id]);

  const gatewayMutation = useCallback(<T,>(
    fn: (value: T) => Promise<unknown>,
  ) => ({
    isPending: false,
    mutate: (value: T, options?: { onSuccess?: (result: unknown) => void; onError?: (error: unknown) => void; onSettled?: () => void }) => {
      void fn(value).then(result => options?.onSuccess?.(result)).catch(error => options?.onError?.(error)).finally(() => options?.onSettled?.());
    },
    mutateAsync: (value: T) => fn(value),
  }), []);

  const addPostavka: GatewayMutation = gatewayMode ? gatewayMutation((value: any) =>
    gatewayReplaceSnapshot(snapshot => ({
      ...snapshot,
      lines: [...(snapshot.lines ?? []), ...materializeGatewayLine(value.data)],
    }))) : cloudAddPostavka;
  const removePostavka: GatewayMutation = gatewayMode ? gatewayMutation((value: any) =>
    gatewayReplaceSnapshot(snapshot => ({
      ...snapshot, lines: (snapshot.lines ?? []).filter(line => String(line.lineId ?? line.id) !== String(value.postavkaId)),
    }))) : cloudRemovePostavka;
  const updateKolicina: GatewayMutation = gatewayMode ? gatewayMutation((value: any) =>
    gatewayReplaceSnapshot(snapshot => ({
      ...snapshot, lines: (snapshot.lines ?? []).map(line => String(line.lineId ?? line.id) === String(value.postavkaId)
        ? { ...line, ...value.data } : line),
    }))) : cloudUpdateKolicina;
  const addModifikatorji: GatewayMutation = gatewayMode ? gatewayMutation((value: any) =>
    gatewayReplaceSnapshot(snapshot => ({
      ...snapshot, lines: (snapshot.lines ?? []).map(line => String(line.lineId ?? line.id) === String(value.postavkaId)
        ? { ...line, ...value.data } : line),
    }))) : cloudAddModifikatorji;
  const materializeGatewayLine = useCallback((data: Record<string, any>) => {
    const article = _artikliMapRef.current.get(Number(data.artikelId));
    if (!article) throw new Error("Gateway zahteva popoln katalog artiklov.");
    const size = data.velikostPice as "mala" | "normalna" | "druzinska" | undefined;
    const regular = Number(size === "mala" ? article.cenaMala : size === "druzinska" ? article.cenaDruzinska : article.cena);
    const happy = Number(size === "mala" ? article.happyHourCenaMala
      : size === "druzinska" ? article.happyHourCenaDruzinska : article.happyHourCena);
    const unit = article.happyHourAktiven && Number.isFinite(happy) && happy > 0 ? happy : regular;
    if (!Number.isFinite(unit) || !Number.isFinite(Number(data.kolicina ?? 1))) {
      throw new Error("Gateway postavka nima popolne cene ali količine.");
    }
    const quantity = Number(data.kolicina ?? 1);
    const activeStations = kdsPostaje.filter(postaja => postaja.aktivna !== false);
    const mappedStations = kdsRouting.filter(mapping =>
      mapping.artikelId === article.id || mapping.kategorijaId === article.kategorijaId,
    ).map(mapping => mapping.postajaId).filter(postajaId =>
      activeStations.some(postaja => postaja.id === postajaId),
    );
    const kind = `${article.kategorijaIme ?? ""} ${(article as any).skupina ?? ""}`.toLocaleLowerCase("sl");
    const legacyType = article.jePica || /\bpica\b|\bpice\b|pizza/.test(kind) ? "pica"
      : /pija|napit|pivo|vino|bar|drink/.test(kind) ? "pijaca" : "hrana";
    const preparationType = (article as typeof article & {
      pripravaVrsta?: "pica" | "hrana" | "pijaca" | null;
    }).pripravaVrsta ?? legacyType;
    const targetStationType = preparationType === "pica" ? "pizza"
      : preparationType === "pijaca" ? "bar" : "kitchen";
    const inferredStationId = activeStations.find(postaja => postaja.tip === targetStationType)?.id;
    const fallbackStation = kdsNastavitve?.fallbackPostajaId
      ? activeStations.find(postaja => postaja.id === kdsNastavitve.fallbackPostajaId)?.id
      : undefined;
    const routedStations = [...new Set(mappedStations.length ? mappedStations :
      inferredStationId ? [inferredStationId] : fallbackStation ? [fallbackStation] : [])];
    if (!routedStations.length) throw new Error(`Artikel ${article.ime} nima veljavne KDS postaje.`);
    const lineId = crypto.randomUUID();
    return [{
      lineId, cloudLineId: null, artikelId: article.id, ime: article.ime, kolicina: quantity,
      cenaKos: unit, cenaKosOriginalna: unit === regular ? null : regular,
      skupaj: unit * quantity, neto: unit * quantity, davek: Number(article.davek),
      davcnaSkupina: Number(article.davek), izbranModifikatorji: data.izbranModifikatorji ?? [],
      modifikatorji: data.izbranModifikatorji ?? [], gostStevilka: data.gostStevilka ?? null,
      opomba: data.opomba ?? null, toGo: Boolean(data.toGo), pripravljeno: null,
      parentPostavkaId: null, racunId: null, postajaId: routedStations[0], postajaIds: routedStations,
      courseNumber: data.courseNumber ?? null, pairingGroupId: data.pairingGroupId ?? null,
      velikostPice: size ?? null,
    }];
  }, [kdsPostaje, kdsRouting, kdsNastavitve?.fallbackPostajaId]);
  const gatewayOrderMutation: any = gatewayMutation((value: any) =>
    gatewayReplaceSnapshot(snapshot => ({
      ...snapshot, ...(value.data ?? {}),
      status: value.data?.status === "preklicano" ? "cancelled" : value.data?.status ?? snapshot.status,
      tableId: value.data?.mizaId ?? value.data?.tableId ?? snapshot.tableId,
    })));
  const prestaviMutation: GatewayMutation = gatewayMode ? gatewayOrderMutation : cloudPrestaviMutation as unknown as GatewayMutation;
  const updateNarociloForOrder: GatewayMutation = gatewayMode ? gatewayOrderMutation : cloudUpdateNarociloForOrder as unknown as GatewayMutation;
  const cancelNarocilo: GatewayMutation = gatewayMode ? gatewayOrderMutation : cloudCancelNarocilo as unknown as GatewayMutation;

  const handleFireNextKdsCourse = (course: (typeof nextKdsCourses)[number]) => {
    fireKdsCourse.mutate({
      narociloId: gatewayMode && gatewayOrderId ? gatewayOrderId : id,
      courseNumber: course.courseNumber,
      pairingGroupId: course.pairingGroupId,
      idempotencyKey: `kds-fire:${id}:${course.pairingGroupId}:${course.courseSequence}`,
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(id) });
        toast({ title: `${course.courseNumber}. hod sproščen` });
      },
      onError: () => toast({
        title: "Hoda ni bilo mogoče sprostiti",
        description: "Osvežite naročilo in poskusite znova.",
        variant: "destructive",
      }),
    });
  };

  const checkBlock = () => {
    if (isBlocked) {
      toast({ title: "Blokirano", description: "Spremembe so blokirane zaradi prihajajoče rezervacije.", variant: "destructive" });
      return true;
    }
    return false;
  };

  const autoStartRef = useAutoStartRef();

  // Refs za samodejni preklic praznega naročila ob odhodu s strani
  const narociloRef = useRef(narocilo);
  useEffect(() => { narociloRef.current = narocilo; }, [narocilo]);
  const manuallyCalledRef = useRef(false);

  // useLayoutEffect se izvede SINHRONSKO po commitu, PREDEN se zaženejo pasivni
  // useEffect-i katerega koli komponenta (vključno z Home avtostartom).
  //
  // setup  → postavi zastavico takoj ko se Order naloži (naročilo je sprva prazno)
  // cleanup → postavi zastavico sinhronsko ob unmountu IZ PRAZNEGA naročila.
  //           Kadar naročilo ima artikle, zastavice ne postavljamo — avtostart
  //           za naslednje naročilo je dovoljen (clearSkipAutoStart klicano v
  //           handleAddArtikel/uvoz).
  useLayoutEffect(() => {
    setSkipAutoStart();
    return () => {
      const postavke = narociloRef.current?.postavke ?? [];
      if (postavke.length === 0) {
        // Prazno naročilo: ohrani zastavice (blokira avtostart pri vrnitvi na Home)
        setSkipAutoStart();
      } else {
        // Naročilo z artikli: odblokira avtostart → sme delovati za naslednjega kupca
        autoStartRef.current.unblock();
        clearSkipAutoStart();
      }
    };
  }, []);

  // Samodejni preklic: ko komponenta odmontira, prekliče prazno odprto naročilo
  useEffect(() => {
    return () => {
      const n = narociloRef.current;
      if (!manuallyCalledRef.current && n && n.status === "odprto" && (n.postavke?.length ?? 0) === 0) {
        // zastavica je že postavljena iz mount effecta zgoraj
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        void fetch(`${base}/api/narocila/${n.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "preklicano" }),
          keepalive: true,
        });
      }
    };
  }, []); // samo ob unmount

  const handleBack = useCallback(() => {
    if (narocilo && (narocilo.postavke?.length ?? 0) === 0) {
      setSkipAutoStart();
      manuallyCalledRef.current = true;
      cancelNarocilo.mutate(
        { id: narocilo.id, data: { status: "preklicano" } },
        { onSettled: () => setLocation(backUrl) }
      );
    } else {
      setLocation(backUrl);
    }
  }, [narocilo, backUrl, setLocation, cancelNarocilo]);

  // Mize za prenos naročila (le proste, ne trenutna, ne blokirana za nova naročila)
  const prosteMize = useMemo(() => {
    if (!mize || !narocilo) return [];
    return mize.filter(m =>
      m.status === "prosta" &&
      m.id !== narocilo.mizaId &&
      !m.noviNarocilaBlokirani &&
      !m.novaNarocilaBlokirana
    );
  }, [mize, narocilo]);

  // Naročila za isto mizo (za gumb Združi)
  const mizaId = narocilo?.mizaId ?? null;
  const listNarocilaParams = mizaId != null ? { mizaId, status: "odprto" as const } : undefined;
  const { data: istaMizaNarocila } = useListNarocila(listNarocilaParams, {
    query: { enabled: mizaId != null, queryKey: getListNarocilaQueryKey(listNarocilaParams) },
  });
  const drugaNarocila = (istaMizaNarocila ?? []).filter(n => n.id !== id);

  // ── DDV neskladje — vrne strežnik ob vsaki spremembi postavke ──
  const ddvNeskladje = narocilo?.ddvNeskladje ?? null;

  // ── Filtrirane postavke po gostu ────────────────────────────
  const vsePostavke = narocilo?.postavke ?? [];
  const nezaracunaneVse = vsePostavke.filter(p => p.racunId === null);
  // Stabilen ključ za kompaktirni useEffect — sortiran po id, neodvisen od vrstnega reda v odgovoru
  const nezaracunaneKljuc = [...nezaracunaneVse]
    .sort((a, b) => a.id - b.id)
    .map(p => `${p.id}:${p.gostStevilka ?? 'n'}`)
    .join(',');
  const filtiranePostavke = aktivniGostStevilka !== null
    ? nezaracunaneVse.filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === aktivniGostStevilka)
    : nezaracunaneVse;
  const gostSkupaj = filtiranePostavke.reduce((sum, p) => sum + p.skupaj, 0);

  // ── Delni račun — neračunane postavke ───────────────────────
  const neracunanePostavke = filtiranePostavke;
  const neracunaneSkupaj = gostSkupaj;
  const imaCastiRacunane = aktivniGostStevilka !== null
    ? vsePostavke.some(p => p.racunId != null && (p as typeof p & { gostStevilka?: number | null }).gostStevilka === aktivniGostStevilka)
    : vsePostavke.some(p => p.racunId != null);

  // ── Seštevek po gostih ───────────────────────────────────────
  const sestevekvPoGostih = useMemo(() => {
    if (steviloGostov < 2) return [];
    return Array.from({ length: steviloGostov }, (_, i) => {
      const g = i + 1;
      const skupaj = nezaracunaneVse
        .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === g)
        .reduce((sum, p) => sum + p.skupaj, 0);
      return { gost: g, skupaj };
    });
  }, [steviloGostov, nezaracunaneVse]);

  // ── Local ordered item list ──────────────────────────────────
  const [orderedIds, setOrderedIds] = useState<number[]>([]);

  useEffect(() => {
    if (artikli && orderedIds.length === 0) {
      setOrderedIds(artikli.map(a => a.id));
    }
  }, [artikli]);

  // Izračunaj max gostStevilka samo iz nezaračunanih postavk (primitiv — stabilen dep za useEffect)
  const maxGostVPostavkah = nezaracunaneVse.reduce(
    (m, p) => Math.max(m, (p as typeof p & { gostStevilka?: number | null }).gostStevilka ?? 0), 0
  );

  // Sinhroniziraj steviloGostov s podatki
  // - ob spremembi naročila (id) ali ko max=0: hard reset (npr. po čiščenju gostov)
  // - pri istem naročilu: Math.max — ohrani prazen gost-slot, ki ga je user ročno dodal
  const prevNarociloIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!narocilo?.postavke) return;
    const idChanged = prevNarociloIdRef.current !== (narocilo.id ?? null);
    prevNarociloIdRef.current = narocilo.id ?? null;
    if (idChanged || maxGostVPostavkah === 0) {
      setSteviloGostov(maxGostVPostavkah);
      setAktivniGostStevilka(prev => prev !== null && prev > maxGostVPostavkah ? null : prev);
    } else {
      setSteviloGostov(prev => Math.max(prev, maxGostVPostavkah));
    }
  }, [narocilo?.id, maxGostVPostavkah]);

  // Kompaktirni učinek: zaznaj vrzeli v gostStevilka in jih samodejno popravi
  // Primer: gost 1 prazen, gost 2 ima artikle → preimenuj gost 2 → gost 1
  // Primer: samo 1 gost z artikli (vrzel ali brisanje) → počisti vse gostStevilka
  const isCompacting = useRef(false);
  const aktivniGostStevilkaRef = useRef(aktivniGostStevilka);
  useEffect(() => { aktivniGostStevilkaRef.current = aktivniGostStevilka; }, [aktivniGostStevilka]);
  // Sledimo prejšnjemu nizu gostov — shouldClear se sproži samo ko se gostji ZMANJŠAJO (ne povečajo)
  const prevGostjiRef = useRef<number[]>([]);

  useEffect(() => {
    if (isCompacting.current) return;

    const gostji = [...new Set(
      nezaracunaneVse.map(p => p.gostStevilka ?? null).filter((g): g is number => g !== null)
    )].sort((a, b) => a - b);

    // Vedno posodobi prevGostjiRef (tudi pri gostji=[])
    const prevGostji = prevGostjiRef.current;
    prevGostjiRef.current = [...gostji];

    if (gostji.length === 0) return;

    const maxG = gostji[gostji.length - 1];
    const hasGap = maxG > gostji.length; // npr. [2] → max=2 > count=1
    // shouldClear: 1 gost z artikli IN (je vrzel ALI so se gostji zmanjšali iz 2+ na 1)
    // gostjiReduced=true samo ko gostji PADEJO (ne ob dodajanju ali prvem montiranju)
    const gostjiReduced = prevGostji.length > 0 && gostji.length < prevGostji.length;
    const shouldClear = gostji.length === 1 && (hasGap || gostjiReduced);

    if (!hasGap && !shouldClear) return; // ni akcije
    const mapping = shouldClear ? null : new Map(gostji.map((g, i) => [g, i + 1]));

    const toUpdate = nezaracunaneVse.filter(p => {
      const g = p.gostStevilka ?? null;
      if (g === null) return false;
      return shouldClear ? true : mapping!.get(g) !== g;
    });

    isCompacting.current = true;
    (async () => {
      try {
        if (toUpdate.length > 0) {
          await Promise.all(toUpdate.map(p =>
            updateKolicina.mutateAsync({
              id,
              postavkaId: p.id,
              data: {
                kolicina: p.kolicina,
                gostStevilka: shouldClear ? null : mapping!.get(p.gostStevilka!)!,
              },
            })
          ));
        }
        const newCount = shouldClear ? 0 : gostji.length;
        setSteviloGostov(newCount);
        if (shouldClear) {
          setAktivniGostStevilka(null);
        } else if (aktivniGostStevilkaRef.current !== null) {
          const newG = mapping!.get(aktivniGostStevilkaRef.current) ?? null;
          if (newG !== aktivniGostStevilkaRef.current) setAktivniGostStevilka(newG);
        }
        await queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(id) });
      } finally {
        isCompacting.current = false;
      }
    })();
  }, [nezaracunaneKljuc, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedArtikli = useMemo((): ArtikelItem[] => {
    if (!artikli) return [];
    const availabilityItems = (preparedFoodAvailability?.items ?? []) as Array<{
      articleId: number;
      availableQuantity: number | null;
      availableBySize?: ArtikelItem["availableBySize"];
    }>;
    const availabilityByArticle = new Map(availabilityItems.map((item) => [item.articleId, item]));
    const mapped = onlyActiveArticles(artikli).map((article) => ({
      ...article,
      modifierAvailability: modifierAvailabilityById,
      availableQuantity: article.jePica && availabilityByArticle.get(article.id)?.availableBySize
        ? (Object.values(availabilityByArticle.get(article.id)!.availableBySize!).some((quantity) => quantity == null || quantity > 0)
          ? null
          : 0)
        : availabilityByArticle.get(article.id)?.availableQuantity ?? null,
      availableBySize: availabilityByArticle.get(article.id)?.availableBySize,
    })) as ArtikelItem[];
    const map = new Map(mapped.map(a => [a.id, a]));
    const ordered = orderedIds.flatMap(id => (map.has(id) ? [map.get(id)!] : []));
    const extra = mapped.filter(a => !orderedIds.includes(a.id));
    return [...ordered, ...extra];
  }, [artikli, orderedIds, preparedFoodAvailability, modifierAvailabilityById]);

  // ── Search & filter ──────────────────────────────────────────
  const [activeKategorija, setActiveKategorija] = useState<string>("all");
  const [search, setSearch] = useState("");
  const { poslusam: glasovnoMeni, zacni: zacniGlasovnoMeni, ustavi: ustaviGlasovnoMeni } = useGlasovniUkaz();
  // Ref na funkcijo za ročno prekinitev glasovne seje (nastavi jo handleGlasovnoMeni ob zagonu)
  const glasovnoPrekinoRef = useRef<(() => void) | null>(null);
  const { sinonimi: uporabniskiSinonimi } = useGlasovniSinonimi();
  const extraSinonimi = useMemo<[string, string][]>(
    () => uporabniskiSinonimi.map(s => [s.beseda, s.alias]),
    [uporabniskiSinonimi]
  );
  // Ref vedno kaže na najnovejšo vrednost — prepreči stale closure v onResult callbacku
  // (mic gumb se pritisne preden React Query vrne podatke → closure bi ujela prazen array).
  const extraSinomiRef = useRef<[string, string][]>(extraSinonimi);
  useEffect(() => { extraSinomiRef.current = extraSinonimi; }, [extraSinonimi]);

  const artikliMapForOrder = useMemo(() => new Map((artikli ?? []).map(a => [a.id, a])), [artikli]);
  const modDialogSelectedModifierIds = useMemo(
    () => [...new Set([...modDialogIzbrani, ...opcijeIzbrani].map(selection => selection.modifikatorId))],
    [modDialogIzbrani, opcijeIzbrani],
  );
  const modDialogNormativiQueries = useQueries({
    queries: modDialogSelectedModifierIds.map(modifierId => getGetModifikatorNormativiQueryOptions(modifierId, {
      query: {
        queryKey: getGetModifikatorNormativiQueryKey(modifierId),
        enabled: modDialogArtikelId !== null || opcijePostavkaId !== null,
      },
    })),
  });
  // Sinhronizacija ref za useAddPostavkaOptimistic (onMutate bere .current ob klicu)
  _artikliMapRef.current = new Map(
    Array.from(artikliMapForOrder.entries()).map(([artikelId, artikel]) => [
      artikelId,
      {
        ...artikel,
        happyHourAktiven: activeHappyHourArticleIds.has(artikelId),
        happyHourVelikostiPice: [...(activeHappyHourPizzaSizes.get(artikelId) ?? [])],
      } as ArtikelZaOptimistiko,
    ]),
  );

  const dnevnoFiltriranjeKatIds = useMemo(() => {
    if (!kategorije) return new Set<number>();
    return new Set(
      (kategorije as (typeof kategorije[number] & { dnevnoFiltriranje?: boolean })[])
        .filter(k => k.dnevnoFiltriranje)
        .map(k => k.id)
    );
  }, [kategorije]);

  const dnevniMeniModIdsPoArtiklu = useMemo(() => {
    const map = new Map<number, Set<number>>();
    if (!dnevniMeniDanes) return map;
    for (const vnos of dnevniMeniDanes) {
      if (!map.has(vnos.artikelId)) map.set(vnos.artikelId, new Set());
      map.get(vnos.artikelId)!.add(vnos.modifikatorId);
    }
    return map;
  }, [dnevniMeniDanes]);

  const { filteredArtikli, filteredArtikliModMatch } = useMemo(() => {
    // Only show output articles (prodajniArtikel) that have a category assigned
    let list = orderedArtikli.filter((article) =>
      isOrderArticleVisible(article, activeMulticourseMenuArticleIds.has(article.id))
    );
    if (narocilo?.nacin === "telefon") {
      list = list.filter(a => a.toGo === true);
    }
    if (activeKategorija !== "all") {
      list = list.filter(a => a.kategorijaId != null && a.kategorijaId.toString() === activeKategorija);
    }
    const modMatch = new Map<number, { skupinaId: number; modifikatorId: number; modIme: string }>();
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const byName = list.filter(a => ujemaSeArtikel(a.ime, q, extraSinonimi));
      if (byName.length > 0) return { filteredArtikli: byName, filteredArtikliModMatch: modMatch };
      // Ni zadetkov po imenu — išči po modifikatorjih
      const byMod: typeof list = [];
      for (const a of list) {
        const modSkupine = (a as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
        let found = false;
        for (const sk of modSkupine) {
          for (const m of sk.modifikatorji) {
            if (m.aktiven && ujemaSeArtikel(m.ime, q, extraSinonimi)) {
              modMatch.set(a.id, { skupinaId: sk.id, modifikatorId: m.id, modIme: m.ime });
              byMod.push(a);
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      return { filteredArtikli: byMod, filteredArtikliModMatch: modMatch };
    }
    return { filteredArtikli: list, filteredArtikliModMatch: modMatch };
  }, [orderedArtikli, activeKategorija, search, extraSinonimi, narocilo?.nacin, activeMulticourseMenuArticleIds]);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() });
  }, [nezaracunaneKljuc, queryClient]);

  // ── Drag-and-drop ────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
  );

  const saveReorder = useCallback(async (newIds: number[]) => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const body = newIds.map((id, index) => ({ id, vrstniRed: index }));
      await fetch(`${base}/api/artikli/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // silent — local order is still applied
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Find positions within the full orderedIds list
    const activeId = active.id as number;
    const overId = over.id as number;

    setOrderedIds(prev => {
      const oldIdx = prev.indexOf(activeId);
      const newIdx = prev.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const next = [...prev];
      next.splice(oldIdx, 1);
      next.splice(newIdx, 0, activeId);
      saveReorder(next);
      return next;
    });
  }, [saveReorder]);

  // ── Order handlers ───────────────────────────────────────────
  const gostBarva = (g: number) => {
    const palette = [
      "bg-blue-100 text-blue-700 border-blue-300",
      "bg-green-100 text-green-700 border-green-300",
      "bg-purple-100 text-purple-700 border-purple-300",
      "bg-orange-100 text-orange-700 border-orange-300",
    ];
    return palette[(g - 1) % palette.length];
  };

  // Regex fallback za glasovne ukaze (zahteva "dodaj X" obliko)
  const tolkujTranskriptRegex = (tekst: string) => {
    const q = tekst.toLowerCase().trim();
    if (!q) {
      toast({ title: "Ukaz ni prepoznan", description: `Slišano: "${tekst}". Poskusite znova.`, variant: "destructive" });
      return;
    }
    // Odstrani opcijsko "dodaj" na začetku
    const brezDodaj = q.replace(/^dodaj\s+/i, "");
    const rawDeli = brezDodaj.split(/\s+in\s+/);
    const segmenti: string[] = [];
    {
      let current = "";
      for (const del of rawDeli) {
        if (current === "") {
          current = del;
        } else {
          const currentImaOpombo = /\s+z\s+opombo\s+/i.test(current);
          const delImaOpombo = /\s+z\s+opombo\s+/i.test(del);
          if (currentImaOpombo && !delImaOpombo) {
            current = current + " in " + del;
          } else {
            segmenti.push(current.trim());
            current = del;
          }
        }
      }
      if (current) segmenti.push(current.trim());
    }
    const dodani: string[] = [];
    const neznani: string[] = [];
    const vecZadetkov: { iskanje: string; kandidati: typeof orderedArtikli }[] = [];

    for (const segment of segmenti) {
      const opombaUjemanje = segment.match(/^(.*?)\s+z\s+opombo\s+(.+)$/i);
      const segmentArtikel = opombaUjemanje ? opombaUjemanje[1].trim() : segment;
      const opomba: string | undefined = opombaUjemanje ? opombaUjemanje[2].trim() : undefined;
      const tokeni = segmentArtikel.split(/\s+/);
      let kolicina = 1;
      let iskanje = segmentArtikel;
      const nxUjemanje = tokeni[0].match(/^(\d+)x(.*)$/i);
      if (nxUjemanje) {
        kolicina = parseInt(nxUjemanje[1], 10);
        iskanje = [nxUjemanje[2], ...tokeni.slice(1)].filter(Boolean).join(" ");
      } else if (tokeni.length > 1) {
        const kol = STEVILKE_V_BESEDAH[tokeni[0]];
        if (kol !== undefined) {
          kolicina = kol;
          const zacetek = (tokeni.length > 2 && tokeni[1] === "krat") ? 2 : 1;
          iskanje = tokeni.slice(zacetek).join(" ");
        }
      }
      const kandidati = orderedArtikli.filter(
        a => isOrderArticleVisible(a, activeMulticourseMenuArticleIds.has(a.id))
          && ujemaSeArtikel(a.ime, iskanje, extraSinomiRef.current)
      );
      if (kandidati.length === 0) {
        // Poskusi "artikel z modifikator" razbitje (npr. "malica ena z golaž")
        let handled = false;
        const zMatch = iskanje.match(/^(.+?)\s+z\s+(.+)$/i);
        if (zMatch) {
          const artDel = zMatch[1].trim();
          const modDel = zMatch[2].trim();
          const artK = orderedArtikli.filter(a =>
            isOrderArticleVisible(a, activeMulticourseMenuArticleIds.has(a.id))
              && ujemaSeArtikel(a.ime, artDel, extraSinomiRef.current)
          );
          if (artK.length === 1) {
            const modSkupine = (artK[0] as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
            for (const sk of modSkupine) {
              const mod = sk.modifikatorji.find(m => m.aktiven && ujemaSeArtikel(m.ime, modDel, extraSinomiRef.current));
              if (mod) {
                handleAddArtikelZModifikatorjem(artK[0].id, sk.id, mod.id, mod.ime, kolicina, opomba);
                dodani.push(`${artK[0].ime} + ${mod.ime}`);
                handled = true;
                break;
              }
            }
          }
        }
        if (!handled) {
          // Iskanje samo po modifikatorjih (npr. "golaž" → Malica 1 + Golaž)
          const prodajni = orderedArtikli.filter(a =>
            isOrderArticleVisible(a, activeMulticourseMenuArticleIds.has(a.id))
          );
          let modFound = false;
          for (const a of prodajni) {
            const modSkupine = (a as { modSkupine?: ModSkupinaFull[] }).modSkupine ?? [];
            for (const sk of modSkupine) {
              const mod = sk.modifikatorji.find(m => m.aktiven && ujemaSeArtikel(m.ime, iskanje, extraSinomiRef.current));
              if (mod) {
                handleAddArtikelZModifikatorjem(a.id, sk.id, mod.id, mod.ime, kolicina, opomba);
                dodani.push(`${a.ime} + ${mod.ime}`);
                modFound = true;
                break;
              }
            }
            if (modFound) break;
          }
          if (!modFound) neznani.push(iskanje);
        }
      } else if (kandidati.length === 1) {
        const rezultat = handleAddArtikel(kandidati[0].id, kolicina, opomba);
        if (rezultat === "direct") {
          const imeZOpombo = opomba ? `${kandidati[0].ime} (${opomba})` : kandidati[0].ime;
          dodani.push(kolicina > 1 ? `${kolicina}× ${imeZOpombo}` : imeZOpombo);
        }
      } else {
        vecZadetkov.push({ iskanje, kandidati });
      }
    }
    if (dodani.length > 0) toast({ title: `Dodano: ${dodani.join(", ")}` });
    if (neznani.length > 0) toast({ title: "Artikel ni najden", description: `Ni ujemanja za: ${neznani.join(", ")}`, variant: "destructive" });
    if (vecZadetkov.length > 0) {
      const zadnji = vecZadetkov[vecZadetkov.length - 1];
      setActiveKategorija("all");
      setSearch(zadnji.iskanje);
      toast({ title: `${zadnji.kandidati.length} zadetkov za "${zadnji.iskanje}"`, description: "Izberi artikel s klikom." });
    } else {
      setSearch("");
    }
  };

  // AI tolkovanje glasovnega ukaza — pošlje transkript in seznam artiklov na strežnik
  const tolkujTranskriptAI = async (tekst: string) => {
    setAiObdeluje(true);
    try {
      // Zaznaj "to go" / "za domov" / "za s seboj" — obravnavamo loceno, ne prek AI
      const TO_GO_RE = /\bto[\s-]*go\b|za\s+domov\b|za\s+doma\b|za\s+seboj\b|za\s+s\s+seboj|za\s+odnesti|za\s+odnes/gi;
      const jeToGo = TO_GO_RE.test(tekst);
      // Zloži consecutive duplicate besede — artefakti sl-SI prepoznave (npr. "pizza pizza pizza" → "pizza")
      const tekstBrezPonavljanja = tekst
        .split(/\s+/)
        .filter((b, i, arr) => b !== arr[i - 1])
        .join(" ");
      // Odstrani fraze iz transkripta pred pošiljanjem AI (da ne zamešamo iskanja artiklov)
      const tekstZaAI = tekstBrezPonavljanja.replace(TO_GO_RE, " ").replace(/\s{2,}/g, " ").trim();

      const artikliZaAI = orderedArtikli
        .filter(a => isOrderArticleVisible(a, activeMulticourseMenuArticleIds.has(a.id)))
        .map(a => {
          const artInfo = artikliMapForOrder.get(a.id);
          const artModSkupine = (artInfo as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? [];
          return {
            id: a.id,
            ime: a.ime,
            kategorija: a.kategorijaIme ?? "",
             jePica: Boolean(a.jePica),
             velikostiPice: a.jePica ? aktivneVelikostiPice.map((velikost) => velikost.id) : [],
            modifikatorji: artModSkupine.flatMap(sk =>
               sk.modifikatorji
                 .filter(m => m.aktiven)
                 .map(m => ({ id: m.id, ime: m.ime, skupinaIme: sk.ime, obvezna: sk.obvezna }))
            ),
          };
        });

      const odgovor = await fetch("/api/ai/glasovni-ukaz", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transkript: tekstZaAI, artikli: artikliZaAI }),
      });

      if (!odgovor.ok) { tolkujTranskriptRegex(tekst); return; }

      const { postavke } = await odgovor.json() as {
         postavke: {
           artikelId: number;
           kolicina: number;
           opomba?: string;
           modifikatorji?: number[];
           velikostPice?: VelikostPice;
         }[];
      };

      if (!postavke || postavke.length === 0) { tolkujTranskriptRegex(tekst); return; }

      const dodani: string[] = [];

      for (const p of postavke) {
        const artInfo = artikliMapForOrder.get(p.artikelId);
        if (!artInfo) continue;
        const artModSkupine = (artInfo as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? [];
         const jePica = Boolean((artInfo as { jePica?: boolean }).jePica);
         const aiVelikostPice = jePica
           && p.velikostPice
           && aktivneVelikostiPice.some((velikost) => velikost.id === p.velikostPice)
           ? p.velikostPice
           : privzetaVelikostPice;

         if (artModSkupine.length > 0 || (jePica && aktivneVelikostiPice.length > 1)) {
          // Sestavi payload iz AI izbranih modifikatorjev
          const izbraniIds = p.modifikatorji ?? [];
          const modPayload: { modifikatorId: number; ime: string; cenaDodatek: number }[] = [];
          for (const modId of izbraniIds) {
            for (const sk of artModSkupine) {
              const mod = sk.modifikatorji.find(m => m.id === modId);
              if (mod) { modPayload.push({ modifikatorId: mod.id, ime: mod.ime, cenaDodatek: Number(mod.cenaDodatek) }); break; }
            }
          }
          // Preveri, ali so vse obvezne skupine pokrite
          const obveznePokriti = artModSkupine.filter(s => s.obvezna).every(s =>
            modPayload.some(mp => s.modifikatorji.some(m => m.id === mp.modifikatorId))
          );
          if (!obveznePokriti) {
            // Odpri dialog z AI predizbranimi modifikatorji
            const privzetiSelected = modPayload.flatMap(mp => {
              for (const sk of artModSkupine) {
                if (sk.modifikatorji.some(m => m.id === mp.modifikatorId)) return [{ skupinaId: sk.id, modifikatorId: mp.modifikatorId }];
              }
              return [];
            });
            setModDialogArtikelId(p.artikelId);
            setModDialogIzbrani(privzetiSelected);
             setModDialogVelikostPice(aiVelikostPice ?? null);
            setModDialogKolicina(p.kolicina);
            setModDialogOpomba(p.opomba ?? null);
            continue;
          }
          // Dodaj direktno z modifikatorji
          if (!pendingArtikli.has(p.artikelId)) {
            setPendingArtikli(prev => new Set(prev).add(p.artikelId));
            const settle = () => setPendingArtikli(prev => { const s = new Set(prev); s.delete(p.artikelId); return s; });
            // Zajemi znane ID-je postavk preden dodamo — za zaznavo novo dodane postavke v onSuccess
            const znaniIds = new Set((queryClient.getQueryData(getGetNarociloQueryKey(id)) as { postavke?: { id: number }[] } | undefined)?.postavke?.map(po => po.id) ?? []);
            const artikelIdZaToGo = p.artikelId;
            addPostavka.mutate(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
               { id, data: {
                 artikelId: p.artikelId,
                 kolicina: p.kolicina,
                 gostStevilka: aktivniGostStevilka,
                 opomba: p.opomba ?? null,
                 izbranModifikatorji: modPayload,
                 ...(jePica && aiVelikostPice ? { velikostPice: aiVelikostPice } : {}),
               } as any },
              {
                onSuccess: (u) => {
                  clearSkipAutoStart();
                  queryClient.setQueryData(getGetNarociloQueryKey(id), u);
                  queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
                  settle();
                  // To Go: označi novo postavko in dodaj embalažo
                  if (jeToGo && (artikliMapForOrder.get(artikelIdZaToGo) as { toGo?: boolean } | undefined)?.toGo) {
                    const nova = (u as { postavke?: { id: number; artikelId: number; kolicina: number; toGo?: boolean }[] }).postavke?.find(po => !znaniIds.has(po.id) && po.artikelId === artikelIdZaToGo);
                    if (nova) handleToGo(nova);
                  }
                },
                onError: (err) => {
                  if (isClosedOrderConflict(err)) {
                    leaveClosedOrder();
                  } else {
                    toast({ title: "Napaka", description: "Ni bilo mogoče dodati artikla", variant: "destructive" });
                  }
                  settle();
                },
              }
            );
          }
        } else {
          // Brez modifikatorjev — direktno dodaj
          if (!pendingArtikli.has(p.artikelId)) {
            setPendingArtikli(prev => new Set(prev).add(p.artikelId));
            const settle = () => setPendingArtikli(prev => { const s = new Set(prev); s.delete(p.artikelId); return s; });
            // Zajemi znane ID-je postavk preden dodamo — za zaznavo novo dodane postavke v onSuccess
            const znaniIds = new Set((queryClient.getQueryData(getGetNarociloQueryKey(id)) as { postavke?: { id: number }[] } | undefined)?.postavke?.map(po => po.id) ?? []);
            const artikelIdZaToGo = p.artikelId;
            addPostavka.mutate(
              { id, data: { artikelId: p.artikelId, kolicina: p.kolicina, gostStevilka: aktivniGostStevilka, opomba: p.opomba ?? null } },
              {
                onSuccess: (u) => {
                  clearSkipAutoStart();
                  queryClient.setQueryData(getGetNarociloQueryKey(id), u);
                  queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
                  settle();
                  // To Go: označi novo postavko in dodaj embalažo
                  if (jeToGo && (artikliMapForOrder.get(artikelIdZaToGo) as { toGo?: boolean } | undefined)?.toGo) {
                    const nova = (u as { postavke?: { id: number; artikelId: number; kolicina: number; toGo?: boolean }[] }).postavke?.find(po => !znaniIds.has(po.id) && po.artikelId === artikelIdZaToGo);
                    if (nova) handleToGo(nova);
                  }
                },
                onError: (err) => {
                  if (isClosedOrderConflict(err)) {
                    leaveClosedOrder();
                  } else {
                    toast({ title: "Napaka", description: "Ni bilo mogoče dodati artikla", variant: "destructive" });
                  }
                  settle();
                },
              }
            );
          }
        }
        const imeZOpombo = p.opomba ? `${artInfo.ime} (${p.opomba})` : artInfo.ime;
        dodani.push(p.kolicina > 1 ? `${p.kolicina}× ${imeZOpombo}` : imeZOpombo);
      }
      if (dodani.length > 0) toast({ title: `Dodano: ${dodani.join(", ")}` });
      setSearch("");
    } catch {
      tolkujTranskriptRegex(tekst);
    } finally {
      setAiObdeluje(false);
    }
  };

  const handleGlasovnoMeni = () => {
    if (checkBlock()) return;
    if (glasovnoAktivno || aiObdeluje) {
      // Ročna prekinitev — pokliči shranjeno prekini() da pravilno nastavi zakljuceno=true
      // in prepreči neskončno zanko restart ↔ stop v onEnd handlerju
      glasovnoPrekinoRef.current?.();
      return;
    }
    setGlasovnoAktivno(true);

    // continuous=true: ena seja za celotno naročilo.
    // Chrome v continuous načinu vseeno konča sejo pri no-speech napaki —
    // v tem primeru sejo transparentno obnovimo (zahtevanoKoncanje=false).
    // Sejo zaključimo SAMO ko tihiTimer (2,5s tišine) ali maksTimer (60s) sproži zakljuci().
    let transkriptBuffer = "";
    let tihiTimer: ReturnType<typeof setTimeout> | null = null;
    let maksTimer: ReturnType<typeof setTimeout> | null = null;
    let zakljuceno = false;
    // Razlikuje med našim namernim koncem (true) in Chrome-ovim samovoljnim koncem (false)
    let zahtevanoKoncanje = false;

    const zakljuci = () => {
      if (zakljuceno) return;
      zakljuceno = true;
      zahtevanoKoncanje = true;
      glasovnoPrekinoRef.current = null;
      if (tihiTimer) { clearTimeout(tihiTimer); tihiTimer = null; }
      if (maksTimer) { clearTimeout(maksTimer); maksTimer = null; }
      setGlasovnoAktivno(false);
      setGlasovnoTranskript("");
      if (transkriptBuffer.trim()) setAiObdeluje(true);
      ustaviGlasovnoMeni();
      if (transkriptBuffer.trim()) {
        void tolkujTranskriptAI(transkriptBuffer.trim());
      } else {
        toast({ title: "Govora ni bilo mogoče prepoznati", description: "Preverite mikrofon ali govorite glasneje.", variant: "destructive" });
      }
    };

    // Ročna zaustavitev s tipko:
    // - če je bil govor zaznan → procesiramo ukaz (zakljuci)
    // - če govora ni bilo → tiha prekinitev brez obvestila (prekini)
    const prekini = () => {
      if (zakljuceno) return;
      zakljuceno = true;
      zahtevanoKoncanje = true;
      glasovnoPrekinoRef.current = null;
      if (tihiTimer) { clearTimeout(tihiTimer); tihiTimer = null; }
      if (maksTimer) { clearTimeout(maksTimer); maksTimer = null; }
      setGlasovnoAktivno(false);
      setGlasovnoTranskript("");
      ustaviGlasovnoMeni();
      // Buffer zavržemo — ne kličemo tolkujTranskriptAI
    };
    glasovnoPrekinoRef.current = () => {
      if (transkriptBuffer.trim()) {
        zakljuci();
      } else {
        prekini();
      }
    };

    const resetTihiTimer = () => {
      if (zakljuceno) return;
      if (tihiTimer) clearTimeout(tihiTimer);
      tihiTimer = setTimeout(zakljuci, 4500);
    };

    // Ena seja na klik — brez restartov.
    // Na Android Chrome vsak r.start() brez neposredne user gesture (gumb klik)
    // takoj sproži onEnd, kar povzroča vidno ciklanje. Zato: ena seja, klik za vsak ukaz.
    const uspelo = zacniGlasovnoMeni(
      {
        onResult: (tekst) => {
          if (zakljuceno) return;
          transkriptBuffer = transkriptBuffer ? transkriptBuffer + " " + tekst : tekst;
          setGlasovnoTranskript(transkriptBuffer);
          resetTihiTimer();
        },
        onError: (napaka) => {
          if (zakljuceno) return;
          if (napaka !== "no-speech") {
            zakljuceno = true;
            if (tihiTimer) clearTimeout(tihiTimer);
            if (maksTimer) clearTimeout(maksTimer);
            toast({ title: "Napaka mikrofona", description: napaka ? `Napaka: ${napaka}` : "Ni bilo mogoče prepoznati govora.", variant: "destructive" });
          }
        },
        onEnd: () => {
          if (zakljuceno) return;
          if (zahtevanoKoncanje) return;
          if (tihiTimer) return; // govor prejet, čakamo na tišino
          // Chrome končal brez govora — tiho ugasnemo, brez restaranja
          prekini();
        },
      },
      naprava?.glasovniPragZaupanja ?? undefined,
      { continuous: true },
    );
    if (!uspelo) {
      zakljuceno = true;
      toast({ title: "Glasovni vnos ni podprt", description: "Vaš brskalnik ne podpira prepoznavanja govora.", variant: "destructive" });
    }
    // Varnostni maks 60s — prepreči uhajanje seje
    maksTimer = setTimeout(zakljuci, 60_000);
  };

  const handleAddArtikel = (artikelId: number, kolicina = 1, opomba?: string): "dialog" | "direct" | "blocked" => {
    if (checkBlock()) return "blocked";
    const configuredMenu = multicourseMenuji.find(menu => menu.aktivno && menu.menuArtikelId === artikelId);
    if (configuredMenu) {
      setMulticourseMenu(configuredMenu);
      setMulticourseCourses(multicourseSelectionRequirements(configuredMenu, configuredMenu.courses).mode === "fixed"
        ? configuredMenu.courses.filter(course => !course.informational).map(course => course.courseNumber)
        : []);
      setMulticourseFoods({});
      setMulticourseWines({});
      setMulticourseOpomba(opomba ?? "");
      setMulticourseError(null);
      return "dialog";
    }
    const artInfo = artikliMapForOrder.get(artikelId);
    const jePica = !!artInfo?.jePica;
    const artModSkupine = (artInfo as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? [];
    const hasObvezne = artModSkupine.some(s => s.obvezna);
    // Odpri splošni dialog za: vsak artikel z vsaj eno modifikatorsko skupino
    if (artModSkupine.length > 0 || (jePica && aktivneVelikostiPice.length > 1)) {
      setFlashingId(artikelId);
      playTapSound();
      setTimeout(() => setFlashingId(null), 300);
      setModDialogArtikelId(artikelId);
      // Prednastavi privzete modifikatorje iz privzetiModifikatorji polja na artiklu
      const artPrivzeti: number[] = artInfo?.privzetiModifikatorji ?? [];
      const privzetiSelected = artPrivzeti.flatMap(modId => {
        // 1. Novi sistem: iskanje po modifier ID
        for (const sk of artModSkupine) {
          if (sk.modifikatorji.some(m => m.id === modId)) {
            return [{ skupinaId: sk.id, modifikatorId: modId }];
          }
        }
        // 2. Stari sistem: modId je artikel ID — poišči po imenu v skupinah
        const artZaIme = artikliMapForOrder.get(modId);
        if (artZaIme) {
          for (const sk of artModSkupine) {
            const mod = sk.modifikatorji.find(m => m.ime === artZaIme.ime);
            if (mod) return [{ skupinaId: sk.id, modifikatorId: mod.id }];
          }
        }
        return [];
      });
      setModDialogIzbrani(privzetiSelected);
      setModDialogKolicina(kolicina);
      setModDialogOpomba(opomba ?? null);
      setModDialogVelikostPice(privzetaVelikostPice);
      return "dialog";
    }
    // Direktno dodajanje z optimistično posodobitvijo (onMutate v useAddPostavkaOptimistic):
    // artikel se takoj prikaže v seznam, strežnik potrdi v ozadju.
    // Gumb ni blokiran — natakar lahko takoj tapne naslednjega.
    setFlashingId(artikelId);
    playTapSound();
    setTimeout(() => setFlashingId(null), 300);
    addPostavka.mutate({ id, data: { artikelId, kolicina, gostStevilka: aktivniGostStevilka, opomba: opomba ?? null } }, {
      onSuccess: (updatedNarocilo) => {
        clearSkipAutoStart();
        // Zamenjaj temp postavko (id < 0) s strežniško (pravi id, DDV, happy hour cena)
        queryClient.setQueryData(getGetNarociloQueryKey(id), updatedNarocilo);
        queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        setSearch("");
      },
      onError: (err) => {
        // Rollback optimistične posodobitve je v useAddPostavkaOptimistic.onError
        if (isClosedOrderConflict(err)) {
          leaveClosedOrder();
        } else if (err instanceof ApiError && err.status === 409) {
          toast({
            title: "Ni mogoče spremeniti naročila",
            description: orderAddErrorMessage(err, "Spremembe naročila trenutno niso dovoljene."),
            variant: "destructive",
          });
          void queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() });
        } else {
          toast({ title: "Artikla ni bilo mogoče dodati", description: orderAddErrorMessage(err, "Artikel je bil odstranjen iz naročila."), variant: "destructive" });
        }
      },
    });
    return "direct";
  };

  // Dodaj artikel z vnaprej izbranim modifikatorjem (iz iskanja po modifikatorjih)
  const handleAddArtikelZModifikatorjem = (artikelId: number, skupinaId: number, modifikatorId: number, modIme: string, kolicina = 1, opomba?: string) => {
    if (checkBlock()) return;
    const artInfo = artikliMapForOrder.get(artikelId);
    const artModSkupine = (artInfo as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? [];
    setFlashingId(artikelId);
    playTapSound();
    setTimeout(() => setFlashingId(null), 300);
    // Prednastavi privzete + iskani modifikator
    const artPrivzeti: number[] = artInfo?.privzetiModifikatorji ?? [];
    const privzetiSelected = artPrivzeti.flatMap(modId => {
      for (const sk of artModSkupine) {
        if (sk.modifikatorji.some(m => m.id === modId)) return [{ skupinaId: sk.id, modifikatorId: modId }];
      }
      return [];
    });
    // Dodaj iskani modifikator (če ga ni že med privzetimi)
    const iskaničeNi = privzetiSelected.some(s => s.skupinaId === skupinaId && s.modifikatorId === modifikatorId)
      ? privzetiSelected
      : [...privzetiSelected, { skupinaId, modifikatorId }];
    setModDialogArtikelId(artikelId);
    setModDialogIzbrani(iskaničeNi);
    setModDialogKolicina(kolicina);
    setModDialogOpomba(opomba ?? null);
    setModDialogVelikostPice(artInfo?.jePica ? privzetaVelikostPice : undefined);
    // Če je to edini modifikator in skupina ni obvezna z minIzbir>1 — direktno potrdi
    const skupina = artModSkupine.find(s => s.id === skupinaId);
    const vskeObvezne = artModSkupine.filter(s => s.obvezna);
    const vseIzpolnjene = vskeObvezne.every(s => iskaničeNi.some(sel => sel.skupinaId === s.id));
    if (artModSkupine.length === 1 && !skupina?.obvezna && vseIzpolnjene) {
      // Ena neobvezna skupina — direktno dodaj brez dialoga
      setModDialogArtikelId(null);
      setModDialogIzbrani([]);
      setModDialogKolicina(1);
      setModDialogOpomba(null);
      if (pendingArtikli.has(artikelId)) return;
      setPendingArtikli(prev => new Set(prev).add(artikelId));
      const settle = () => setPendingArtikli(prev => { const s = new Set(prev); s.delete(artikelId); return s; });
      const modPayload = [{ modifikatorId, ime: modIme, cenaDodatek: Number(skupina?.modifikatorji.find(m => m.id === modifikatorId)?.cenaDodatek ?? 0) }];
      addPostavka.mutate(
        { id, data: { artikelId, kolicina, gostStevilka: aktivniGostStevilka, opomba: opomba ?? null, izbranModifikatorji: modPayload } as any },
        {
          onSuccess: (updatedNarocilo) => { clearSkipAutoStart(); queryClient.setQueryData(getGetNarociloQueryKey(id), updatedNarocilo); queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }); setSearch(""); settle(); },
           onError: (err) => { toast({ title: "Napaka", description: orderAddErrorMessage(err), variant: "destructive" }); settle(); },
        }
      );
    }
    // Sicer ostane dialog odprt
  };

  const handleSpremeniGosta = (postavkaId: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId)) return;
    const postavka = narocilo?.postavke?.find(p => p.id === postavkaId);
    if (!postavka || steviloGostov === 0) return;
    const current = (postavka as typeof postavka & { gostStevilka?: number | null }).gostStevilka ?? null;
    const next: number | null = current === null ? 1 : current >= steviloGostov ? null : current + 1;
    updateKolicina.mutate({ id, postavkaId, data: { kolicina: postavka.kolicina, gostStevilka: next } }, {
      onSuccess: (u) => queryClient.setQueryData(getGetNarociloQueryKey(id), u),
      onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče spremeniti gosta", variant: "destructive" }),
    });
  };

  const handleDodajPrvegaGosta = async () => {
    if (checkBlock()) return;
    const nezaracunane = vsePostavke.filter(p => !p.racunId);
    if (nezaracunane.length > 0) {
      setSteviloGostov(2);
      setAktivniGostStevilka(2);
      try {
        await Promise.all(
          nezaracunane.map(p =>
            updateKolicina.mutateAsync({
              id,
              postavkaId: p.id,
              data: { kolicina: p.kolicina, gostStevilka: 1 },
            })
          )
        );
        await queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(id) });
      } catch {
        toast({ title: "Napaka", description: "Ni bilo mogoče pripisati postavk gostu", variant: "destructive" });
      }
    } else {
      setSteviloGostov(1);
      setAktivniGostStevilka(1);
    }
  };

  const handleRemovePostavka = (postavkaId: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId) || pendingPostavke.has(postavkaId)) return;
    setPendingPostavke(prev => new Set(prev).add(postavkaId));
    const settle = () => setPendingPostavke(prev => { const s = new Set(prev); s.delete(postavkaId); return s; });
    removePostavka.mutate({ id, postavkaId }, {
      onSuccess: (u) => {
        queryClient.setQueryData(getGetNarociloQueryKey(id), u);
        queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        settle();
      },
      onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče odstraniti artikla", variant: "destructive" }); settle(); },
    });
  };

  const handleUpdateKolicina = (postavkaId: number, novaKolicina: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId) || pendingPostavke.has(postavkaId)) return;
    setPendingPostavke(prev => new Set(prev).add(postavkaId));
    const settle = () => setPendingPostavke(prev => { const s = new Set(prev); s.delete(postavkaId); return s; });
    if (novaKolicina <= 0) {
      removePostavka.mutate({ id, postavkaId }, {
        onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }); settle(); },
        onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče odstraniti artikla", variant: "destructive" }); settle(); },
      });
    } else {
      updateKolicina.mutate({ id, postavkaId, data: { kolicina: novaKolicina } }, {
        onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); settle(); },
        onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče spremeniti količine", variant: "destructive" }); settle(); },
      });
    }
  };

  const handleDodatekDecrement = (postavkaId: number, kolicina: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId) || pendingPostavke.has(postavkaId)) return;
    setPendingPostavke(prev => new Set(prev).add(postavkaId));
    const settle = () => setPendingPostavke(prev => { const s = new Set(prev); s.delete(postavkaId); return s; });
    if (kolicina <= 1) {
      removePostavka.mutate({ id, postavkaId }, {
        onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }); settle(); },
        onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče odstraniti artikla", variant: "destructive" }); settle(); },
      });
    } else {
      updateKolicina.mutate({ id, postavkaId, data: { kolicina: kolicina - 1 } }, {
        onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); settle(); },
        onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče spremeniti količine", variant: "destructive" }); settle(); },
      });
    }
  };

  const handleDodatekIncrement = (postavkaId: number, kolicina: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId) || pendingPostavke.has(postavkaId)) return;
    setPendingPostavke(prev => new Set(prev).add(postavkaId));
    const settle = () => setPendingPostavke(prev => { const s = new Set(prev); s.delete(postavkaId); return s; });
    updateKolicina.mutate({ id, postavkaId, data: { kolicina: kolicina + 1 } }, {
      onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); settle(); },
      onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče spremeniti količine", variant: "destructive" }); settle(); },
    });
  };

  const handleMikrofon = (postavka: { id: number; kolicina: number; opomba?: string | null }) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavka.id)) return;
    if (mikrofon?.postavkaId === postavka.id) {
      ustaviMikrofon();
      setMikrofon(null);
      return;
    }
    setMikrofon({ postavkaId: postavka.id, stanje: "poslusam" });
    const uspelo = zacniMikrofon({
      onResult: (besedilo) => {
        const novaOpomba = postavka.opomba ? `${postavka.opomba} ${besedilo}` : besedilo;
        updateKolicina.mutate({ id, postavkaId: postavka.id, data: { kolicina: postavka.kolicina, opomba: novaOpomba } }, {
          onSuccess: (u) => queryClient.setQueryData(getGetNarociloQueryKey(id), u),
          onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče shraniti opombe", variant: "destructive" }),
        });
      },
      onError: () => setMikrofon(prev => prev?.postavkaId === postavka.id ? { ...prev, stanje: "napaka" } : prev),
      onEnd: () => setMikrofon(prev => prev?.postavkaId === postavka.id ? null : prev),
    });
    if (!uspelo) {
      setMikrofon(null);
      toast({ title: "Glasovni vnos ni podprt", description: "Vaš brskalnik ne podpira prepoznavanja govora.", variant: "destructive" });
    }
  };

  const handleShraniOpombo = (postavkaId: number, kolicina: number, novaOpomba: string) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId)) return;
    const opomba = novaOpomba.trim() || null;
    updateKolicina.mutate({ id, postavkaId, data: { kolicina, opomba } }, {
      onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); setOpombaPostavka(null); },
      onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče shraniti opombe", variant: "destructive" }),
    });
  };

  const handleBrisiOpombo = (postavka: { id: number; kolicina: number }) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavka.id)) return;
    updateKolicina.mutate({ id, postavkaId: postavka.id, data: { kolicina: postavka.kolicina, opomba: null } }, {
      onSuccess: (u) => queryClient.setQueryData(getGetNarociloQueryKey(id), u),
      onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče zbrisati opombe", variant: "destructive" }),
    });
  };

  const handleToGo = (postavka: { id: number; artikelId: number; kolicina: number; toGo?: boolean }) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavka.id)) return;
    const artInfo = artikliMapForOrder.get(postavka.artikelId);
    const toGoIds: number[] = (artInfo as { toGoArtikli?: number[] } | undefined)?.toGoArtikli ?? [];
    const jeToGo = !!(postavka as { toGo?: boolean }).toGo;

    if (jeToGo) {
      const childPostavke = (narocilo?.postavke ?? []).filter(
        p => (p as typeof p & { parentPostavkaId?: number | null }).parentPostavkaId === postavka.id
          && (p as typeof p & { modifikatorId?: number | null }).modifikatorId == null
      );
      updateKolicina.mutate({ id, postavkaId: postavka.id, data: { kolicina: postavka.kolicina, toGo: false } }, {
        onSuccess: (u) => {
          queryClient.setQueryData(getGetNarociloQueryKey(id), u);
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        },
        onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče odstraniti To Go oznake", variant: "destructive" }),
      });
      for (const child of childPostavke) {
        removePostavka.mutate({ id, postavkaId: child.id }, {
          onSuccess: (u) => {
            queryClient.setQueryData(getGetNarociloQueryKey(id), u);
            queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
          },
        });
      }
    } else {
      updateKolicina.mutate({ id, postavkaId: postavka.id, data: { kolicina: postavka.kolicina, toGo: true } }, {
        onSuccess: (u) => {
          queryClient.setQueryData(getGetNarociloQueryKey(id), u);
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
          const vsebujeVrocoPijaco = (narocilo?.postavke ?? []).some((p) => {
            const artikel = artikliMapForOrder.get(p.artikelId) as { taxCategory?: string } | undefined;
            return artikel?.taxCategory === "hot_beverage";
          });
          if (vsebujeVrocoPijaco) setToGoDdVWarningVisible(true);
          for (const toGoArtikelId of toGoIds) {
            addPostavka.mutate({ id, data: { artikelId: toGoArtikelId, kolicina: 1, parentPostavkaId: postavka.id, gostStevilka: aktivniGostStevilka } }, {
              onSuccess: (u2) => {
                queryClient.setQueryData(getGetNarociloQueryKey(id), u2);
                queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
              },
              onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče dodati To Go artikla", variant: "destructive" }),
            });
          }
        },
        onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče označiti To Go", variant: "destructive" }),
      });
    }
  };

  const handleApplyDiscount = (postavkaId: number, novaCenaKos: number) => {
    if (checkBlock()) return;
    if (isTemporaryPostavkaId(postavkaId) || pendingPostavke.has(postavkaId)) return;
    const postavka = narocilo?.postavke?.find(p => p.id === postavkaId);
    if (!postavka) return;
    setDiscountOpenId(null);
    setPendingPostavke(prev => new Set(prev).add(postavkaId));
    const settle = () => setPendingPostavke(prev => { const s = new Set(prev); s.delete(postavkaId); return s; });
    updateKolicina.mutate({ id, postavkaId, data: { kolicina: postavka.kolicina, cenaKos: novaCenaKos } }, {
      onSuccess: (u) => { queryClient.setQueryData(getGetNarociloQueryKey(id), u); settle(); },
      onError: () => { toast({ title: "Napaka", description: "Ni bilo mogoče uporabiti popusta", variant: "destructive" }); settle(); },
    });
  };

  const odpriUrejanjeCasa = () => {
    if (!narocilo || narocilo.nacin !== "telefon") return;
    setCasZaUrejanje(casZaPosDatetimeLocal(narocilo.predvidenPrevzem));
    setCasDialogOpen(true);
  };

  const shraniCasPrevzema = () => {
    if (!casZaUrejanje) {
      toast({ title: "Izberite čas", description: "Vnesite predviden čas prevzema.", variant: "destructive" });
      return;
    }
    const cas = posDatetimeLocalToIso(casZaUrejanje);
    if (!cas) {
      toast({ title: "Neveljaven čas", variant: "destructive" });
      return;
    }
    updateNarociloForOrder.mutate({
      id,
      data: { predvidenPrevzem: cas, predvidenPrevzemRocen: true },
    }, {
      onSuccess: updated => {
        queryClient.setQueryData(getGetNarociloQueryKey(id), updated);
        void queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        setCasDialogOpen(false);
        toast({ title: "Čas naročila posodobljen" });
      },
      onError: () => toast({ title: "Napaka", description: "Časa naročila ni bilo mogoče shraniti.", variant: "destructive" }),
    });
  };

  const ponastaviCasPrevzema = () => {
    updateNarociloForOrder.mutate({
      id,
      data: { predvidenPrevzem: null, predvidenPrevzemRocen: false },
    }, {
      onSuccess: updated => {
        queryClient.setQueryData(getGetNarociloQueryKey(id), updated);
        void queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
        setCasDialogOpen(false);
        toast({ title: "Čas se ponovno izračunava samodejno" });
      },
      onError: () => toast({ title: "Napaka", description: "Samodejnega časa ni bilo mogoče nastaviti.", variant: "destructive" }),
    });
  };

  const handleUvozPotrditev = async () => {
    if (checkBlock()) return;
    if (!uvozPostavke || uvozPostavke.length === 0) return;
    const artikliMap = new Map(artikli?.map(a => [a.id, a]));
    const neaktivni: string[] = [];
    const uvoziti: Array<{ artikelId: number; kolicina: number }> = [];
    for (const p of uvozPostavke) {
      if (uvozIzkljuceni.has(p.artikelId)) continue;
      const artikel = artikliMap.get(p.artikelId);
      if (!artikel || !artikel.aktiven) { neaktivni.push(p.ime); continue; }
      uvoziti.push({ artikelId: p.artikelId, kolicina: uvozKolicine.get(p.artikelId) ?? p.kolicina });
    }
    if (uvoziti.length === 0) {
      toast({ title: "Ni artiklov za uvoz", description: neaktivni.length > 0 ? `Preskočeni (neaktivni): ${neaktivni.join(", ")}` : "Označi vsaj en artikel.", variant: "destructive" });
      return;
    }
    setUvozVprogress(true);
    try {
      clearSkipAutoStart(); // uvoz artiklov — naročilo ne bo več prazno
      for (const item of uvoziti) {
        await addPostavka.mutateAsync({ id, data: { artikelId: item.artikelId, kolicina: item.kolicina, gostStevilka: aktivniGostStevilka } });
      }
      await queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(id) });
      let opis = `Uvoženo ${uvoziti.length} ${uvoziti.length === 1 ? "artikel" : "artiklov"}.`;
      if (neaktivni.length > 0) opis += ` Preskočeni (neaktivni): ${neaktivni.join(", ")}.`;
      toast({ title: "Uvoz uspešen", description: opis });
      setUvozDialogOpen(false);
      setUvozRacunId(null);
      setUvozKolicine(new Map());
      setUvozIzkljuceni(new Set());
      setUvozIsci("");
    } catch {
      toast({ title: "Napaka pri uvozu", description: "Ni bilo mogoče uvoziti artiklov.", variant: "destructive" });
    } finally {
      setUvozVprogress(false);
    }
  };

  if (loadingNarocila) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!narocilo) return <div className="p-8">Naročilo ne obstaja.</div>;

  const postavkeCount = (narocilo?.postavke ?? []).filter(p => p.parentPostavkaId == null).length;
  const currentMizaProstorId = mize?.find(m => m.id === narocilo.mizaId)?.prostorId ?? null;
  const prostorIme = narocilo.prostorIme
    ?? (currentMizaProstorId != null ? (prostori?.find(p => p.id === currentMizaProstorId)?.ime ?? null) : null);
  const stevilkaNarocila = narocilo.stevilkaNarocila ?? narocilo.id;
  const virOznaka = narocilo.vir === "qr_gost" ? "QR" : null;
  const jeTelefonskoNarocilo = narocilo.nacin === "telefon";
  const jeDostava = jeTelefonskoNarocilo && narocilo.nacinIzpolnitve === "dostava";
  const dostavaStatus = narocilo.dostavaStatus;
  const dostavaKurirId = narocilo.dostavaKurirId;
  const predvidenCas = formatPosCas(narocilo.predvidenPrevzem);
  const dostavaPodatki = narocilo as typeof narocilo & { casDostaveMin?: number | null; cenaDostave?: number | null };
  const casVoznjeMin = dostavaPodatki.casDostaveMin
    ?? (narocilo.predvidenPrevzem && narocilo.predvidenaDostava
      ? Math.max(0, Math.round((new Date(narocilo.predvidenaDostava).getTime() - new Date(narocilo.predvidenPrevzem).getTime()) / 60_000))
      : null);
  const pripravaCas = formatPosCas(narocilo.predvidenPrevzem);
  const dostavaCas = formatPosCas(narocilo.predvidenaDostava);
  const cenaDostave = dostavaPodatki.cenaDostave;
  const predvidenaDostava = narocilo.predvidenaDostava;
  const dostavaEtaAktivna = jeDostava
    && predvidenaDostava
    && dostavaStatus !== "dostavljeno"
    && dostavaStatus !== "preklicano";
  const dostavaIzracun = jeDostava && pripravaCas && dostavaCas && casVoznjeMin != null ? (
    <div className="text-xs text-muted-foreground" data-testid="dostava-izracun">
      Priprava do {pripravaCas} + vožnja {casVoznjeMin} min ={" "}
      <span
        className="inline-flex items-center gap-1 font-medium"
        title={`Dostava ob ${dostavaCas}`}
        aria-label={`Dostava ob ${dostavaCas}`}
      >
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        {dostavaCas}
      </span>
      {dostavaEtaAktivna && (
        <span className="ml-2" data-testid="dostava-odstevanje">
          <KdsCountdown target={{ iso: predvidenaDostava, label: "Dostava ob" }} />
        </span>
      )}
      {typeof cenaDostave === "number" && <> · Dostava {cenaDostave.toFixed(2)} €</>}
    </div>
  ) : null;

  return (
    <>
    {isBlocked && (
      <div className="bg-red-600 text-white p-2 text-center text-sm font-semibold flex items-center justify-center gap-2 shrink-0 shadow-sm z-50">
        <ShieldAlert className="w-4 h-4" />
        Spreminjanje naročila je blokirano, ker se bliža čas rezervacije (manj kot 2 uri). Možen je samo zaključek ali prestavitev naročila.
      </div>
    )}
    <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden bg-muted/20">
      {/* ── Mobile tab switcher ──────────────────────────────── */}
      <div className="md:hidden flex items-center border-b bg-background shrink-0 gap-1 px-1 py-1" data-testid="mobile-order-tabs">
        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="flex-1 min-w-0" aria-hidden="true" />
        <button
          onClick={() => setMobileTab("meni")}
          className={`shrink-0 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
            mobileTab === "meni" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Meni
        </button>
        <button
          onClick={() => setMobileTab("narocilo")}
          className={`shrink-0 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
            mobileTab === "narocilo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Naročilo{postavkeCount > 0 && ` (${postavkeCount})`}
        </button>
      </div>

      {/* ── Levi del — Meni ──────────────────────────────────── */}
      <div className={`flex-1 flex flex-col h-full border-r bg-background ${mobileTab === "narocilo" ? "hidden md:flex" : "flex"}`}>
        <div className="hidden md:flex p-2 border-b items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-tight">Meni</h1>
            <p className="text-xs leading-tight text-muted-foreground">Izberi artikle • povleci za razvrščanje</p>
          </div>
          {!jeTelefonskoNarocilo && aktivniGostStevilka !== null && (
            <button
              type="button"
              onClick={() => setAktivniGostStevilka(null)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 transition-colors ${gostBarva(aktivniGostStevilka)}`}
              title="Klikni za preklic izbire gosta"
            >
              <Users className="h-3.5 w-3.5" />
              Gost {aktivniGostStevilka}
              <X className="h-3 w-3 opacity-70" />
            </button>
          )}
        </div>

        <Tabs
          defaultValue="all"
          className="flex-1 flex flex-col overflow-hidden"
          onValueChange={v => { setActiveKategorija(v); setSearch(""); }}
        >
          <div className="px-2 pt-1.5 pb-1.5 border-b space-y-1.5">
            <OrderContextLine
              prostorIme={prostorIme}
              mizaIme={narocilo.mizaIme ?? null}
              mizaStevilka={narocilo.mizaStevilka ?? null}
              stevilkaNarocila={stevilkaNarocila}
              virOznaka={virOznaka}
              dostavaOb={predvidenCas}
              className="pb-1 border-b border-border/60"
            />
            <div className="relative flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <KlavijaturaInput
                  placeholder="Iskanje artikla..."
                  value={search}
                  onChange={setSearch}
                  naslov="Iskanje artikla"
                  className="pl-8 pr-8 h-9"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {glasovnoAktivno && (
                <div className="absolute left-0 right-10 -top-8 bg-red-50 border border-red-200 rounded-md px-2 py-1 text-xs text-red-700 truncate pointer-events-none">
                  {glasovnoTranskript ? glasovnoTranskript : <span className="opacity-60 italic">Poslušam…</span>}
                </div>
              )}
              <button
                onClick={handleGlasovnoMeni}
                disabled={aiObdeluje}
                title={glasovnoAktivno ? "Poslušam… klikni za zaustavitev" : aiObdeluje ? "AI analizira naročilo…" : "Glasovni ukaz — naroči s prostim govorom"}
                className={`shrink-0 flex items-center justify-center h-9 w-9 rounded-md border transition-colors ${
                  glasovnoAktivno
                    ? "bg-red-50 border-red-300 text-red-500 animate-pulse"
                    : aiObdeluje
                    ? "bg-blue-50 border-blue-300 text-blue-500 animate-pulse"
                    : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {glasovnoAktivno ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>
            {/* Gostje — samo mobile */}
            {!jeTelefonskoNarocilo && <div className="md:hidden flex flex-wrap gap-1 items-center">
              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {steviloGostov === 0 ? (
                <button type="button" onClick={() => { void handleDodajPrvegaGosta(); }}
                  className="text-xs px-2 py-0.5 rounded-full border border-dashed text-muted-foreground hover:text-foreground transition-colors">
                  + Dodaj gosta
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => setAktivniGostStevilka(null)}
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${aktivniGostStevilka === null ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                    Skupaj
                  </button>
                  {Array.from({ length: steviloGostov }, (_, i) => i + 1).map(g => (
                    <button key={g} type="button" onClick={() => setAktivniGostStevilka(g)}
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${aktivniGostStevilka === g ? `${gostBarva(g)} border-current` : "bg-background text-muted-foreground hover:text-foreground"}`}>
                      Gost {g}
                    </button>
                  ))}
                  {(() => {
                    const zadnjiPrazen = steviloGostov > 0 && nezaracunaneVse.every(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka !== steviloGostov);
                    return (
                      <button type="button" disabled={zadnjiPrazen}
                        onClick={() => { const n = steviloGostov + 1; setSteviloGostov(n); setAktivniGostStevilka(n); }}
                        className="text-xs px-2 py-0.5 rounded-full border border-dashed text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={zadnjiPrazen ? "Zadnji gost nima artiklov" : undefined}>
                        + Gost
                      </button>
                    );
                  })()}
                </>
              )}
            </div>}
            <TabsList className="h-auto flex-wrap w-full justify-start gap-1 bg-transparent p-0">
              <TabsTrigger value="all" className="rounded-full border text-xs h-7 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary">Vse</TabsTrigger>
              {kategorije?.map(k => (
                <TabsTrigger key={k.id} value={k.id.toString()} className="rounded-full border text-xs h-7 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary">{k.ime}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="flex-1 p-3">
             {loadingArtikli || loadingKategorije ? (
               <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pb-20 md:pb-4">
                 {Array.from({ length: 12 }).map((_, index) => (
                   <Skeleton key={index} className="h-24 w-full rounded-lg" />
                 ))}
               </div>
             ) : (() => {
              const gridItems: GridItem[] = (search.trim() || grupiranjeNacin === "izklopljeno")
                ? filteredArtikli.map(a => ({ type: "artikel" as const, artikel: a }))
                : skupinaArtiklov(filteredArtikli);
              const sortableIds = gridItems.flatMap(item =>
                item.type === "artikel" ? [item.artikel.id] : []
              );
              return (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pb-20 md:pb-4">
                      {gridItems.map(item =>
                        item.type === "artikel" ? (
                          <SortableArtikelCard
                            key={item.artikel.id}
                            artikel={item.artikel}
                            onAdd={(artId) => {
                              if (multicourseMenuji.some(menu => menu.aktivno && menu.menuArtikelId === artId)) {
                                handleAddArtikel(artId);
                                return;
                              }
                              const modM = filteredArtikliModMatch.get(artId);
                              if (modM) handleAddArtikelZModifikatorjem(artId, modM.skupinaId, modM.modifikatorId, modM.modIme);
                              else handleAddArtikel(artId);
                            }}
                            pending={pendingArtikli.has(item.artikel.id)}
                            flashing={flashingId === item.artikel.id}
                            artikliMap={artikliMapForOrder}
                            isHappyHourActive={activeHappyHourArticleIds.has(item.artikel.id)}
                            happyHourVelikostiPice={activeHappyHourPizzaSizes.get(item.artikel.id)}
                          />
                        ) : (
                          <div key={`grupa-${item.baseIme}`}>
                            {grupiranjeNacin === "staro" ? (
                              <GrupaGumbStaro
                                grupa={item}
                                onAdd={handleAddArtikel}
                                pendingArtikliIds={pendingArtikli}
                                artikliMap={artikliMapForOrder}
                              />
                            ) : (
                              <GrupaGumb
                                grupa={item}
                                onAdd={handleAddArtikel}
                                pendingArtikliIds={pendingArtikli}
                                artikliMap={artikliMapForOrder}
                              />
                            )}
                          </div>
                        )
                      )}
                      {filteredArtikli.length === 0 && (
                        <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                          {search ? `Ni zadetkov za "${search}"` : "Ni artiklov v tej kategoriji."}
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              );
             })()}
          </ScrollArea>
        </Tabs>
      </div>

      {/* ── Desni del — Račun ────────────────────────────────── */}
      <div className={`w-full md:w-[400px] flex-col md:h-full flex-1 min-h-0 bg-background shadow-xl z-10 relative ${mobileTab === "meni" ? "hidden md:flex" : "flex"}`}>
        {narocilo.status === "odprto" && (
          <details className="shrink-0 border-b bg-card px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold">Dodaj dnevno kosilo</summary>
            <div className="pt-3">
              <DailyLunchOrderFlow
                narociloId={narocilo.id}
                onAdded={() => {
                  queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(narocilo.id) });
                  queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
                }}
              />
            </div>
          </details>
        )}
        <div className="shrink-0 p-3 md:p-2.5 border-b bg-card space-y-1.5 md:space-y-0.5">
          <OrderContextLine
            prostorIme={prostorIme}
            mizaIme={narocilo.mizaIme ?? null}
            mizaStevilka={narocilo.mizaStevilka ?? null}
            stevilkaNarocila={stevilkaNarocila}
            virOznaka={virOznaka}
            dostavaOb={predvidenCas}
            testId="right-order-context-line"
            className="hidden md:flex pb-1 border-b border-border/60"
          />
          {/* Dodatni podatki za telefonska/dostavna naročila — kontekst je že v prvi vrstici */}
          {(jeTelefonskoNarocilo || (jeDostava && narocilo.dostavaUlica)) && (
          <div className="hidden md:flex items-center gap-1 min-w-0">
            <div className="flex-1 min-w-0">
              {jeTelefonskoNarocilo && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={odpriUrejanjeCasa} data-testid="uredi-predviden-cas">
                    <Pencil className="h-3 w-3" /> Uredi čas
                  </button>
                </div>
              )}
              {jeDostava && narocilo.dostavaUlica && (
                <>
                  <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="dostavni-naslov">
                    {narocilo.dostavaUlica} {narocilo.dostavaHisnaStevilka}{narocilo.dostavaVhod ? `, vhod ${narocilo.dostavaVhod}` : ""}{narocilo.dostavaNadstropje ? `, ${narocilo.dostavaNadstropje}. nadst.` : ""}{narocilo.dostavaNaseljeNaziv ? ` · ${narocilo.dostavaNaseljeNaziv}` : ""}
                  </p>
                  {dostavaIzracun}
                </>
              )}
            </div>
          </div>
          )}
          {glasovnoAktivno && (
            <div className="mx-0 mb-1 bg-red-50 border border-red-200 rounded-md px-2 py-1 text-xs text-red-700 truncate">
              {glasovnoTranskript ? glasovnoTranskript : <span className="opacity-60 italic">Poslušam…</span>}
            </div>
          )}
          <div className="md:hidden rounded-md bg-muted/50 px-2.5 py-2.5 text-xs space-y-2" data-testid="mobile-order-summary">
            <OrderContextLine
              prostorIme={prostorIme}
              mizaIme={narocilo.mizaIme ?? null}
              mizaStevilka={narocilo.mizaStevilka ?? null}
              stevilkaNarocila={stevilkaNarocila}
              virOznaka={virOznaka}
              dostavaOb={predvidenCas}
              className="pb-2 border-b border-border/60"
            />
            {jeTelefonskoNarocilo && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {narocilo.strankaIme && <span className="font-semibold text-foreground">{narocilo.strankaIme}</span>}
                <button type="button" className="text-primary underline underline-offset-2" onClick={odpriUrejanjeCasa}>
                  Uredi čas
                </button>
              </div>
            )}

            {jeDostava && narocilo.dostavaUlica && (
              <div className="space-y-1">
                <p className="break-words [overflow-wrap:anywhere] text-muted-foreground" data-testid="dostavni-naslov-mobile">
                  {narocilo.dostavaUlica} {narocilo.dostavaHisnaStevilka}
                  {narocilo.dostavaVhod ? `, vhod ${narocilo.dostavaVhod}` : ""}
                  {narocilo.dostavaNadstropje ? `, ${narocilo.dostavaNadstropje}. nadst.` : ""}
                  {narocilo.dostavaNaseljeNaziv ? ` · ${narocilo.dostavaNaseljeNaziv}` : ""}
                </p>
                {dostavaIzracun}
              </div>
            )}
          </div>
          {jeDostava && (
            <DostavaStatusPanel
              narociloId={narocilo.id}
              status={dostavaStatus}
              kurirId={dostavaKurirId}
            />
          )}

          {nextKdsCourses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5" data-testid="order-next-kds-course-actions">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-violet-800">Naslednji hod</span>
              {nextKdsCourses.map((course) => (
                <Button
                  key={course.pairingGroupId}
                  type="button"
                  size="sm"
                  className="h-7 bg-violet-600 px-2 text-xs hover:bg-violet-700"
                  disabled={fireKdsCourse.isPending}
                  onClick={() => handleFireNextKdsCourse(course)}
                  data-testid={`order-fire-course-${course.courseNumber}-${course.pairingGroupId}`}
                >
                  {fireKdsCourse.isPending ? "Sproščanje …" : `Sprosti ${course.courseNumber}. hod`}
                </Button>
              ))}
            </div>
          )}

          {/* Gostje + mobile ikone */}
          <div className="flex flex-wrap gap-1 items-center pt-0.5 md:pt-0">
            {!jeTelefonskoNarocilo && <>
            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {steviloGostov === 0 ? (
              <button
                type="button"
                onClick={() => { void handleDodajPrvegaGosta(); }}
                className="text-xs px-2 py-0.5 rounded-full border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              >
                + Dodaj gosta
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAktivniGostStevilka(null)}
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${aktivniGostStevilka === null ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  Skupaj
                </button>
                {Array.from({ length: steviloGostov }, (_, i) => i + 1).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setAktivniGostStevilka(g)}
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${aktivniGostStevilka === g ? `${gostBarva(g)} border-current` : "bg-background text-muted-foreground hover:text-foreground"}`}
                  >
                    Gost {g}
                  </button>
                ))}
                {(() => {
                  const zadnjiPrazen = steviloGostov > 0 && nezaracunaneVse.every(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka !== steviloGostov);
                  return (
                    <button
                      type="button"
                      disabled={zadnjiPrazen}
                      onClick={() => { const n = steviloGostov + 1; setSteviloGostov(n); setAktivniGostStevilka(n); }}
                      className="text-xs px-2 py-0.5 rounded-full border border-dashed text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={zadnjiPrazen ? "Zadnji gost nima artiklov" : undefined}
                    >
                      + Gost
                    </button>
                  );
                })()}
              </>
            )}</>}
            {/* Akcije so poravnane z gumbi za goste v isti vrstici */}
            <div className="ml-auto flex shrink-0 items-center gap-1" data-testid="right-order-guest-actions">
              {narocilo.status === "odprto" && (
                <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" title="Uvozi iz računa" onClick={() => setUvozDialogOpen(true)}>
                  <ClipboardList className="h-3.5 w-3.5" />
                </Button>
              )}
              {!jeTelefonskoNarocilo && prosteMize.length > 0 && (
                <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" title="Prestavi na mizo" onClick={() => setPrestaviDialogOpen(true)}>
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </Button>
              )}
              {drugaNarocila.length > 0 && (
                <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" title="Združi naročili" onClick={() => setSpojiDialogOpen(true)}>
                  <GitMerge className="h-3.5 w-3.5" />
                </Button>
              )}
              <button
                onClick={handleGlasovnoMeni}
                disabled={aiObdeluje}
                title={glasovnoAktivno ? "Poslušam… klikni za zaustavitev" : aiObdeluje ? "AI analizira naročilo…" : "Glasovni ukaz — naroči s prostim govorom"}
                className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-md border transition-colors ${glasovnoAktivno ? "bg-red-50 border-red-300 text-red-500 animate-pulse" : aiObdeluje ? "bg-blue-50 border-blue-300 text-blue-500 animate-pulse" : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              >
                {glasovnoAktivno ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {aiSvetovalec.aktiven && (
          <div className="px-3 md:px-2 pb-1 shrink-0">
            <AiSvetovalecPanel 
              loading={aiSvetovalec.loading}
              data={aiSvetovalec.data}
              error={aiSvetovalec.error}
              onRefresh={(vprasanje) => aiSvetovalec.performCheck(vprasanje)}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-1 pb-2 md:py-0 md:pb-1">
          {toGoDdVWarningVisible && (
            <div
              role="alert"
              data-testid="to-go-ddv-warning"
              className="mb-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-950"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span className="flex-1">
                Nekatere postavke imajo starejšo DDV stopnjo — odstranite in znova dodajte, da se DDV posodobi
              </span>
              <button
                type="button"
                aria-label="Opusti opozorilo o DDV pri To Go"
                className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100"
                onClick={() => setToGoDdVWarningVisible(false)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          {nezaracunaneVse.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground p-8 text-center text-sm">
              Ni še dodanih artiklov.
            </div>
          ) : (<>
            {aktivniGostStevilka !== null && filtiranePostavke.length === 0 && (
              <div className="flex items-center justify-center text-muted-foreground p-8 text-center text-sm">
                Gost {aktivniGostStevilka} nima dodeljenih artiklov.
              </div>
            )}
            <div className="divide-y">
              {(() => {
                const dodMapOrder = new Map<number, typeof filtiranePostavke[0][]>();
                const modChildMapOrder = new Map<number, typeof filtiranePostavke[0][]>();
                for (const p of filtiranePostavke) {
                  const pid = (p as typeof p & { parentPostavkaId?: number | null }).parentPostavkaId;
                  if (pid != null) {
                    const isModChild = (p as typeof p & { modifikatorId?: number | null }).modifikatorId != null;
                    if (isModChild) {
                      const arr = modChildMapOrder.get(pid) ?? [];
                      arr.push(p);
                      modChildMapOrder.set(pid, arr);
                    } else {
                      const arr = dodMapOrder.get(pid) ?? [];
                      arr.push(p);
                      dodMapOrder.set(pid, arr);
                    }
                  }
                }
                const topPostavkeOrder = groupMulticourseOrderRows(filtiranePostavke.filter(p =>
                  (p as typeof p & { parentPostavkaId?: number | null }).parentPostavkaId == null
                ));
                return topPostavkeOrder.map((postavka, idx) => {
                const artRaw = artikliMapForOrder.get(postavka.artikelId) as { jePica?: boolean; modSkupine?: ModSkupinaFull[] } | undefined;
                const artIzbirneOrder = (artRaw?.modSkupine ?? []).filter(s => !s.obvezna);
                const dodat = dodMapOrder.get(postavka.id) ?? [];
                const jeVecHodniMeni = postavka.isMulticourseBundle === true;
                const hasDiscount =
                  !jeVecHodniMeni &&
                  postavka.cenaKosOriginalna != null &&
                  postavka.cenaKosOriginalna > 0 &&
                  Math.abs(postavka.cenaKosOriginalna - postavka.cenaKos) >= 0.01;
                const isDiscountOpen = discountOpenId === postavka.id;
                const jeRacunana = !!postavka.racunId;
                const jeZacasnaPostavka = isTemporaryPostavkaId(postavka.id);
                const jePostavkaVObdelavi = jeZacasnaPostavka || pendingPostavke.has(postavka.id);

                return (
                  <div
                    key={postavka.id}
                    aria-busy={jeZacasnaPostavka || undefined}
                    className={`flex flex-col py-1 px-1 transition-colors gap-0.5 ${jeRacunana ? "opacity-50" : "hover:bg-muted/50"}`}
                  >
                    {/* Vrstica 1: številka + ime + gost badge + gumbi */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground w-4 shrink-0 text-right">{idx + 1}.</span>
                      <span className={`flex-1 text-lg font-medium min-w-0 leading-snug ${jeRacunana ? "line-through text-muted-foreground" : ""}`}>{postavka.ime}</span>
                      {postavka.velikostPice && (
                        <IkonaVelikostiPice velikost={postavka.velikostPice as VelikostPice} />
                      )}
                       {jeZacasnaPostavka && (
                         <span className="text-[9px] text-muted-foreground shrink-0 animate-pulse">Shranjujem…</span>
                       )}
                      {!jeRacunana && !!(postavka as typeof postavka & { toGo?: boolean }).toGo && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 text-[9px] font-semibold border border-orange-200 shrink-0">
                          <ShoppingBag className="h-2.5 w-2.5" />
                          To Go
                        </span>
                      )}
                      {jeRacunana && (
                        <button
                          type="button"
                          title={postavka.racunStevilka ? `Odpri račun ${postavka.racunStevilka}` : "zaračunano"}
                          onClick={() => setLocation(postavka.racunStevilka ? `/racuni?stevilka=${encodeURIComponent(postavka.racunStevilka)}` : "/racuni")}
                          className="flex flex-col items-end shrink-0 cursor-pointer group"
                        >
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-muted-foreground/20 group-hover:border-primary/40 group-hover:text-primary transition-colors">
                            zaračunano
                          </span>
                          {postavka.racunStevilka && (
                            <span className="text-[9px] text-primary underline-offset-1 group-hover:underline px-1 mt-0.5 tabular-nums">
                              {postavka.racunStevilka}
                            </span>
                          )}
                        </button>
                      )}
                      {!jeRacunana && !jeVecHodniMeni && steviloGostov > 0 && (() => {
                        const g = (postavka as typeof postavka & { gostStevilka?: number | null }).gostStevilka ?? null;
                        return (
                          <button
                            type="button"
                            title="Klikni za spremembo gosta"
                            onClick={() => handleSpremeniGosta(postavka.id)}
                            disabled={jePostavkaVObdelavi}
                            className={`text-xs font-bold px-2.5 py-1 rounded-full border shrink-0 transition-colors ${g !== null ? gostBarva(g) : "bg-muted text-muted-foreground border-muted-foreground/30 hover:bg-muted/80"}`}
                          >
                            {g !== null ? `G${g}` : "—"}
                          </button>
                        );
                      })()}
                      {!jeRacunana && !jeVecHodniMeni && !jeDostava && (() => {
                        const artInfo = artikliMapForOrder.get(postavka.artikelId) as { toGo?: boolean } | undefined;
                        if (!artInfo?.toGo) return null;
                        const jeToGoAktiven = !!(postavka as typeof postavka & { toGo?: boolean }).toGo;
                        return (
                          <button
                            type="button"
                            className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${jeToGoAktiven ? "bg-orange-500 text-white border-orange-500 hover:bg-orange-600" : "bg-orange-50 text-orange-500 border-orange-200 hover:bg-orange-100"}`}
                            onClick={() => handleToGo(postavka)}
                            disabled={jePostavkaVObdelavi}
                            title={jeZacasnaPostavka ? "Artikel se še shranjuje" : jeToGoAktiven ? "Odstrani To Go embalažo" : "Dodaj To Go embalažo"}
                          >
                            <ShoppingBag className="h-4 w-4" />
                          </button>
                        );
                      })()}
                      {!jeRacunana && (
                        <button
                          type="button"
                          className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${hasDiscount ? "bg-amber-50 text-amber-500 border-amber-200 hover:bg-amber-100" : "bg-muted/60 text-muted-foreground border-border hover:bg-amber-50 hover:text-amber-500 hover:border-amber-200"}`}
                          onClick={() => setDiscountOpenId(isDiscountOpen ? null : postavka.id)}
                          disabled={jePostavkaVObdelavi}
                          title="Dodaj popust"
                        >
                          <Percent className="h-4 w-4" />
                        </button>
                      )}
                      {!jeRacunana && !jeVecHodniMeni && (() => {
                        const poslusam = mikrofon?.postavkaId === postavka.id && mikrofon.stanje === "poslusam";
                        const napaka = mikrofon?.postavkaId === postavka.id && mikrofon.stanje === "napaka";
                        return (
                          <button
                            type="button"
                            className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${poslusam ? "bg-red-50 text-red-500 border-red-200 animate-pulse" : napaka ? "bg-red-50 text-red-500 border-red-200" : "bg-muted/60 text-muted-foreground border-border hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200"}`}
                            onClick={() => handleMikrofon(postavka)}
                            disabled={jePostavkaVObdelavi}
                            title={jeZacasnaPostavka ? "Artikel se še shranjuje" : poslusam ? "Klikni za zaustavitev" : "Dodaj zvočno opombo"}
                          >
                            {poslusam ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                          </button>
                        );
                      })()}
                      {!jeRacunana && !jeVecHodniMeni && (
                        <button
                          type="button"
                          className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${postavka.opomba ? "bg-amber-50 text-amber-500 border-amber-200 hover:bg-amber-100" : "bg-muted/60 text-muted-foreground border-border hover:bg-violet-50 hover:text-violet-500 hover:border-violet-200"}`}
                          onClick={() => setOpombaPostavka({ id: postavka.id, kolicina: postavka.kolicina, opomba: postavka.opomba ?? null })}
                            disabled={jePostavkaVObdelavi}
                            title={jeZacasnaPostavka ? "Artikel se še shranjuje" : "Vnesi opombo s tipkovnico"}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {!jeRacunana && (
                        <button
                          type="button"
                          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border bg-red-50 text-red-500 border-red-200 hover:bg-red-100 transition-colors"
                          onClick={() => handleRemovePostavka(postavka.id)}
                          disabled={jePostavkaVObdelavi}
                          title={jeZacasnaPostavka ? "Artikel se še shranjuje" : "Odstrani artikel"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {/* Opomba vrstica */}
                    {postavka.opomba && (
                      <div className="flex items-center gap-1 pl-5 pr-1">
                        <span className="text-[10px] text-muted-foreground italic flex-1 leading-snug">{postavka.opomba}</span>
                        {!jeRacunana && (
                          <button
                            type="button"
                            className="h-6 w-6 shrink-0 flex items-center justify-center rounded border border-transparent text-muted-foreground/50 hover:text-destructive hover:border-destructive/30 hover:bg-red-50 transition-colors"
                            title="Zbriši opombo"
                            onClick={() => handleBrisiOpombo(postavka)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {/* Vrstica 2: gumbi za količino + cena */}
                    <div className="flex items-center gap-0.5 pl-5">
                      {!jeRacunana && !jeVecHodniMeni && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleUpdateKolicina(postavka.id, postavka.kolicina - 1)}
                          disabled={jePostavkaVObdelavi}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      )}
                      <span className={`text-sm font-bold w-8 text-center tabular-nums ${postavka.kolicina < 0 ? "text-destructive" : ""}`}>
                        {postavka.kolicina}
                      </span>
                      {!jeRacunana && !jeVecHodniMeni && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleUpdateKolicina(postavka.id, postavka.kolicina + 1)}
                          disabled={jePostavkaVObdelavi}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                      <span className="hidden sm:flex flex-col items-start ml-1 leading-none">
                        {hasDiscount && (
                          <span className="text-[9px] text-muted-foreground line-through tabular-nums">
                            {postavka.cenaKosOriginalna!.toFixed(2)} €
                          </span>
                        )}
                        <span className={`text-[10px] tabular-nums ${hasDiscount ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                          {postavka.cenaKos.toFixed(2)} €/kos
                        </span>
                      </span>
                      <span className="flex-1" />
                      <span className={`text-base font-extrabold tabular-nums ${postavka.kolicina < 0 ? "text-destructive" : "text-foreground"}`}>
                        {postavka.skupaj.toFixed(2)} €
                      </span>
                    </div>
                    {/* Vrstica 3: vnosno polje za popust (pogojno) */}
                    {isDiscountOpen && !jeVecHodniMeni && (
                      <DiscountInput
                        postavkaId={postavka.id}
                        cenaKos={postavka.cenaKos}
                        cenaKosOriginalna={postavka.cenaKosOriginalna ?? null}
                        kolicina={postavka.kolicina}
                        onApply={handleApplyDiscount}
                        onCancel={() => setDiscountOpenId(null)}
                      />
                    )}
                    {/* Dodatki za pico */}
                    {dodat.map(d => (
                      <div key={d.id} className="flex items-center gap-1 pl-7 py-0.5">
                        <span className="text-amber-500 font-semibold text-[10px]">+</span>
                        <span className="flex-1 text-[10px] leading-snug">{d.ime}</span>
                        {!jeRacunana && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-5 w-5 shrink-0"
                            onClick={() => handleDodatekDecrement(d.id, d.kolicina)}
                            disabled={pendingPostavke.has(d.id)}
                          >
                            <Minus className="h-2.5 w-2.5" />
                          </Button>
                        )}
                        <span className="text-[10px] font-bold tabular-nums w-5 text-center">{d.kolicina}</span>
                        {!jeRacunana && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-5 w-5 shrink-0"
                            onClick={() => handleDodatekIncrement(d.id, d.kolicina)}
                            disabled={pendingPostavke.has(d.id)}
                          >
                            <Plus className="h-2.5 w-2.5" />
                          </Button>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground ml-1">{d.skupaj.toFixed(2)} €</span>
                      </div>
                    ))}
                    {/* Modifikatorji (read-only) */}
                    {(modChildMapOrder.get(postavka.id) ?? []).map(mc => (
                      <div key={mc.id} className="flex items-center gap-1 pl-7 py-0.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <Settings2 className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                            <span className="flex-1 text-[10px] leading-snug text-muted-foreground">{mc.ime}</span>
                            {mc.skupaj > 0 && (
                              <span className="text-[10px] tabular-nums text-muted-foreground">+{mc.skupaj.toFixed(2)} €</span>
                            )}
                          </div>
                          {(modChildMapOrder.get(mc.id) ?? [])
                            .filter(nested => (nested as typeof nested & { modifierSourceArticleId?: number | null }).modifierSourceArticleId != null)
                            .map(nested => {
                              const sourceId = (nested as typeof nested & { modifierSourceArticleId?: number | null }).modifierSourceArticleId!;
                              const sourceIme = (artikliMapForOrder.get(sourceId) as { ime?: string } | undefined)?.ime ?? `Artikel ${sourceId}`;
                              return (
                                <div key={nested.id} className="ml-4 flex items-center gap-1 py-0.5" data-testid={`saved-nested-modifier-${nested.id}`}>
                                  <span className="text-[9px] text-muted-foreground">{sourceIme}:</span>
                                  <span className="flex-1 text-[10px] leading-snug text-muted-foreground">{nested.ime}</span>
                                  {nested.skupaj > 0 && (
                                    <span className="text-[10px] tabular-nums text-muted-foreground">+{nested.skupaj.toFixed(2)} €</span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                    {artIzbirneOrder.length > 0 && !jeRacunana && !jeVecHodniMeni && (
                      <div className="flex gap-1.5 pl-5 mt-0.5 mb-0.5">
                        {artIzbirneOrder.length > 0 && (
                          <button
                            type="button"
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
                            onClick={() => {
                              const childRows = (narocilo?.postavke ?? []).filter(
                                p => (p as typeof p & { parentPostavkaId?: number | null }).parentPostavkaId === postavka.id
                                  && (p as typeof p & { modifikatorId?: number | null }).modifikatorId != null
                              );
                              const preloaded: { skupinaId: number; modifikatorId: number }[] = [];
                              for (const cr of childRows) {
                                const modId = (cr as typeof cr & { modifikatorId?: number | null }).modifikatorId!;
                                for (const sk of artIzbirneOrder) {
                                  if (sk.modifikatorji.some(m => m.id === modId)) {
                                    preloaded.push({ skupinaId: sk.id, modifikatorId: modId });
                                    break;
                                  }
                                }
                              }
                              const nestedSelections: Record<string, number[]> = {};
                              let missingSource = false;
                              for (const cr of childRows) {
                                const parentModifierId = (cr as typeof cr & { modifikatorId?: number | null }).modifikatorId;
                                if (parentModifierId == null || !preloaded.some(selection => selection.modifikatorId === parentModifierId)) continue;
                                const nestedRows = (narocilo?.postavke ?? []).filter(row =>
                                  (row as typeof row & { parentPostavkaId?: number | null }).parentPostavkaId === cr.id
                                    && (row as typeof row & { modifikatorId?: number | null }).modifikatorId != null,
                                );
                                for (const nestedRow of nestedRows) {
                                  const sourceId = (nestedRow as typeof nestedRow & { modifierSourceArticleId?: number | null }).modifierSourceArticleId;
                                  const nestedModifierId = (nestedRow as typeof nestedRow & { modifikatorId?: number | null }).modifikatorId;
                                  if (sourceId == null || nestedModifierId == null) {
                                    missingSource = true;
                                    continue;
                                  }
                                  const key = `${parentModifierId}:${sourceId}`;
                                  nestedSelections[key] = [...(nestedSelections[key] ?? []), nestedModifierId];
                                }
                              }
                              setOpcijeNestedDataError(missingSource);
                              setOpcijePodIzbire(nestedSelections);
                              setOpcijePostavkaId(postavka.id);
                              setOpcijeIzbrani(preloaded);
                            }}
                          >
                            <Settings2 className="h-3 w-3" />Opcije
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
              })()}
            </div>
          </>)}
        </div>

        {/* ── Seštevek po gostih ────────────────────────────────── */}
        {sestevekvPoGostih.length >= 2 && (
          <div className="px-4 py-2 border-t bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <Users className="h-3 w-3" />
              Seštevek po gostih
              <span className="normal-case font-normal tracking-normal ml-1">— klikni za dodajanje</span>
            </p>
            <div className="space-y-0.5">
              {sestevekvPoGostih.map(({ gost, skupaj }) => (
                <button
                  key={gost}
                  type="button"
                  onClick={() => setAktivniGostStevilka(aktivniGostStevilka === gost ? null : gost)}
                  className={`w-full flex items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
                    aktivniGostStevilka === gost
                      ? `${gostBarva(gost)} font-semibold`
                      : "hover:bg-muted/60 text-foreground"
                  }`}
                >
                  <span>Gost {gost}</span>
                  <span className="tabular-nums font-bold">{skupaj.toFixed(2)} €</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 p-3 md:p-4 border-t bg-card space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {aktivniGostStevilka !== null ? `Gost ${aktivniGostStevilka}` : "Skupaj"}
            </span>
            <span className="text-xl md:text-2xl font-bold text-primary tabular-nums">
              {neracunaneSkupaj.toFixed(2)} €
            </span>
          </div>
          {ddvNeskladje && (
            <DdvNeskladjeAlert razlika={ddvNeskladje.razlika} />
          )}
          <Button
            size="lg"
            className="w-full text-lg h-12"
            onClick={() => {
              const gostParam = aktivniGostStevilka !== null && neracunanePostavke.length > 0
                ? `&gost=${aktivniGostStevilka}`
                : "";
              setLocation(`/blagajna?narocilo=${gatewayMode && gatewayOrderId ? localOrderRoute(gatewayOrderId) : narocilo.id}${gostParam}`);
            }}
            disabled={narocilo.postavke?.length === 0}
          >
            {ddvNeskladje ? (
              <AlertTriangle className="w-5 h-5 mr-2 text-yellow-300" />
            ) : (
              <Wallet className="w-5 h-5 mr-2" />
            )}
            Na blagajno
          </Button>
        </div>
      </div>
    </div>

    <Dialog open={casDialogOpen} onOpenChange={setCasDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Predviden čas {jeDostava ? "dostave" : "prevzema"}</DialogTitle>
          <DialogDescription>
            Ročni čas ostane nastavljen tudi ob spremembi postavk. Za samodejni izračun ga lahko ponastavite.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            aria-label="Predviden čas prevzema"
            type="datetime-local"
            value={casZaUrejanje}
            onChange={event => setCasZaUrejanje(event.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {narocilo.predvidenPrevzemRocen && (
              <Button type="button" variant="outline" onClick={ponastaviCasPrevzema} disabled={updateNarociloForOrder.isPending}>
                Samodejno
              </Button>
            )}
            <Button type="button" onClick={shraniCasPrevzema} disabled={updateNarociloForOrder.isPending}>
              Shrani čas
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>


    {/* ── Dialog: Uvozi iz računa ──────────────────────────── */}
    <Dialog open={uvozDialogOpen} onOpenChange={(open) => {
      setUvozDialogOpen(open);
      if (!open) { setUvozRacunId(null); setUvozKolicine(new Map()); setUvozIzkljuceni(new Set()); setUvozIsci(""); }
    }}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-4 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {uvozRacunId === null ? "Izberi račun za uvoz" : "Izberi artikle"}
          </DialogTitle>
          <DialogDescription>
            {uvozRacunId === null
              ? "Izberi arhiviran račun — artikli se dodajo v aktivno naročilo."
              : "Nastavi količine in potrdi uvoz v naročilo."}
          </DialogDescription>
        </DialogHeader>

        {uvozRacunId === null ? (
          /* ── Korak 1: izberi račun ── */
          <div className="flex flex-col flex-1 min-h-0 p-4 pt-3 gap-3">
            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <KlavijaturaInput
                placeholder="Išči po številki računa..."
                value={uvozIsci}
                onChange={setUvozIsci}
                naslov="Iskanje računa"
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="flex-1 min-h-0">
              {(() => {
                const filtered = (racuniZaUvoz ?? [])
                  .slice(0, 50)
                  .filter(r => {
                    if (!uvozIsci.trim()) return true;
                    const q = uvozIsci.toLowerCase();
                    const datumStr = new Date(r.ustvarjeno).toLocaleString("sl-SI", { dateStyle: "short", timeStyle: "short" }).toLowerCase();
                    return r.stevilkaRacuna.toLowerCase().includes(q) || datumStr.includes(q);
                  });
                if (filtered.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-8">Ni računov.</p>;
                }
                return (
                  <div className="space-y-1 pr-1">
                    {filtered.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        className="w-full text-left rounded-lg border p-3 hover:bg-muted/60 transition-colors"
                        onClick={() => { setUvozRacunId(r.id); setUvozIsci(""); }}
                      >
                        <p className="text-sm font-semibold tabular-nums">{r.stevilkaRacuna}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.ustvarjeno).toLocaleString("sl-SI", { dateStyle: "short", timeStyle: "short" })}
                          {r.mizaStevilka != null && ` · Miza ${r.mizaStevilka}`}
                          {" · "}{Number(r.skupaj).toFixed(2)} €
                        </p>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </ScrollArea>
          </div>
        ) : (
          /* ── Korak 2: nastavi artikle ── */
          <div className="flex flex-col flex-1 min-h-0 p-4 pt-3 gap-3">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground self-start"
              onClick={() => { setUvozRacunId(null); setUvozKolicine(new Map()); setUvozIzkljuceni(new Set()); }}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Nazaj na seznam računov
            </button>

            {loadingUvozPostavke ? (
              <Skeleton className="h-40 w-full" />
            ) : !uvozPostavke || uvozPostavke.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Račun nima postavk.</p>
            ) : (
              <>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-1 pr-1">
                    {uvozPostavke.map(p => {
                      const izkljucen = uvozIzkljuceni.has(p.artikelId);
                      const artikel = artikli?.find(a => a.id === p.artikelId);
                      const jeNeaktiven = !artikel || !artikel.aktiven;
                      const kolicina = uvozKolicine.get(p.artikelId) ?? p.kolicina;
                      return (
                        <div key={p.artikelId} className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${izkljucen || jeNeaktiven ? "opacity-40" : ""}`}>
                          <Checkbox
                            checked={!izkljucen && !jeNeaktiven}
                            disabled={jeNeaktiven}
                            onCheckedChange={(checked) => {
                              setUvozIzkljuceni(prev => {
                                const next = new Set(prev);
                                if (checked) next.delete(p.artikelId); else next.add(p.artikelId);
                                return next;
                              });
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-snug ${jeNeaktiven ? "line-through" : ""}`}>{p.ime}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">{p.cenaKos.toFixed(2)} €/kos{jeNeaktiven ? " · neaktiven" : ""}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="outline" size="icon" className="h-6 w-6"
                              disabled={izkljucen || jeNeaktiven || kolicina <= 1}
                              onClick={() => setUvozKolicine(prev => { const m = new Map(prev); m.set(p.artikelId, Math.max(1, kolicina - 1)); return m; })}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-xs font-bold w-6 text-center tabular-nums">{kolicina}</span>
                            <Button variant="outline" size="icon" className="h-6 w-6"
                              disabled={izkljucen || jeNeaktiven}
                              onClick={() => setUvozKolicine(prev => { const m = new Map(prev); m.set(p.artikelId, kolicina + 1); return m; })}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                <Button
                  className="w-full shrink-0"
                  disabled={uvozVprogress || uvozPostavke.every(p => uvozIzkljuceni.has(p.artikelId) || !artikli?.find(a => a.id === p.artikelId)?.aktiven)}
                  onClick={() => { void handleUvozPotrditev(); }}
                >
                  {uvozVprogress ? "Uvažam..." : `Uvozi ${uvozPostavke.filter(p => !uvozIzkljuceni.has(p.artikelId) && !!artikli?.find(a => a.id === p.artikelId)?.aktiven).length} artiklov`}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* ── Dialog: Prestavi na mizo ────────────────────────── */}
    <Dialog open={prestaviDialogOpen} onOpenChange={setPrestaviDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Prestavi na mizo
          </DialogTitle>
          <DialogDescription>
            Izberi ciljno mizo za naročilo #{narocilo.stevilkaNarocila ?? narocilo.id}. Prikazane so le proste mize.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {prosteMize.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Ni prostih miz.</p>
          ) : (
            prosteMize.map(miza => (
              <div key={miza.id} className="flex items-center justify-between rounded-lg border p-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {formatMizaProstor({
                      mizaIme: miza.ime,
                      mizaStevilka: miza.stevilka,
                      prostorIme: miza.prostorId != null
                        ? (prostori?.find(prostor => prostor.id === miza.prostorId)?.ime ?? null)
                        : null,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Kapaciteta: {miza.kapaciteta}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  className="shrink-0"
                  disabled={prestaviMutation.isPending}
                  onClick={() => {
                    prestaviMutation.mutate({ id, data: { mizaId: miza.id } }, {
                      onSuccess: (u) => {
                        const ciljnaMiza = formatMizaProstor({
                          mizaIme: miza.ime,
                          mizaStevilka: miza.stevilka,
                          prostorIme: miza.prostorId != null
                            ? (prostori?.find(prostor => prostor.id === miza.prostorId)?.ime ?? null)
                            : null,
                        });
                        setPrestaviDialogOpen(false);
                        queryClient.setQueryData(getGetNarociloQueryKey(id), u);
                        toast({
                          title: "Naročilo prestavljeno",
                          description: `Naročilo #${narocilo.id} je bilo prestavljeno na ${ciljnaMiza}.`,
                        });
                      },
                      onError: () => toast({ title: "Napaka", description: "Prenos ni uspel", variant: "destructive" }),
                    });
                  }}
                >
                  Prestavi
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Dialog: Modifikatorji pred dodajanjem artikla ───────── */}
    {(() => {
      const artRawSkupine = modDialogArtikelId !== null
        ? ((artikliMapForOrder.get(modDialogArtikelId) as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? [])
        : [];
      const artKategorijaId = modDialogArtikelId !== null
        ? ((artikliMapForOrder.get(modDialogArtikelId) as { kategorijaId?: number | null } | undefined)?.kategorijaId ?? null)
        : null;
      const jeFiltrirana = artKategorijaId != null && dnevnoFiltriranjeKatIds.has(artKategorijaId);
      const danesMeniModIds = modDialogArtikelId != null ? (dnevniMeniModIdsPoArtiklu.get(modDialogArtikelId) ?? null) : null;
      const artSkupine = jeFiltrirana && danesMeniModIds !== null && danesMeniModIds.size > 0
        ? artRawSkupine.map(sk => ({
            ...sk,
            modifikatorji: sk.modifikatorji.filter(m => danesMeniModIds.has(m.id)),
          })).filter(sk => sk.modifikatorji.length > 0)
        : artRawSkupine;
      const artIme = modDialogArtikelId !== null
        ? String((artikliMapForOrder.get(modDialogArtikelId) as { ime?: string } | undefined)?.ime ?? "Artikel")
        : "Artikel";
      const artCena = modDialogArtikelId !== null
        ? Number((artikliMapForOrder.get(modDialogArtikelId) as { cena?: number } | undefined)?.cena ?? 0)
        : 0;
      const artCenaMala = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as { cenaMala?: number | null } | undefined)?.cenaMala
        : null;
      const artCenaDruzinska = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as { cenaDruzinska?: number | null } | undefined)?.cenaDruzinska
        : null;
      const artHappyHourCena = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as { happyHourCena?: number | null } | undefined)?.happyHourCena
        : null;
      const artHappyHourCenaMala = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as { happyHourCenaMala?: number | null } | undefined)?.happyHourCenaMala
        : null;
      const artHappyHourCenaDruzinska = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as { happyHourCenaDruzinska?: number | null } | undefined)?.happyHourCenaDruzinska
        : null;
      const artJeHappyHourAktiven = modDialogArtikelId !== null
        && activeHappyHourArticleIds.has(modDialogArtikelId);
      const artHappyHourVelikostiPice = modDialogArtikelId !== null
        ? activeHappyHourPizzaSizes.get(modDialogArtikelId)
        : undefined;
      const artJePica = modDialogArtikelId !== null
        ? Boolean((artikliMapForOrder.get(modDialogArtikelId) as { jePica?: boolean } | undefined)?.jePica)
        : false;
      const artRazpolozljivostVelikosti = modDialogArtikelId !== null
        ? (artikliMapForOrder.get(modDialogArtikelId) as ArtikelItem | undefined)?.availableBySize
        : undefined;
      const aktivneVelikostiPic = [
        { id: "mala" as const, naziv: "Mala", premer: Number((nastavitve as any)?.picaPremerMala ?? 0) },
        { id: "normalna" as const, naziv: "Normalna", premer: Number((nastavitve as any)?.picaPremerNormalna ?? 0) },
        { id: "druzinska" as const, naziv: "Družinska", premer: Number((nastavitve as any)?.picaPremerDruzinska ?? 0) },
      ].filter((velikost) => velikost.premer > 0);
      const cenaZaVelikostPice = (velikost: "mala" | "normalna" | "druzinska") => {
        const rednaCenaVelikosti = velikost === "mala"
          ? artCenaMala
          : velikost === "druzinska"
            ? artCenaDruzinska
            : artCena;
        const happyHourCenaVelikosti = velikost === "mala"
          ? artHappyHourCenaMala
          : velikost === "druzinska"
            ? artHappyHourCenaDruzinska
            : artHappyHourCena;
        const cenaVelikosti = artJeHappyHourAktiven
          && artHappyHourVelikostiPice?.has(velikost)
          && happyHourCenaVelikosti != null
          ? happyHourCenaVelikosti
          : rednaCenaVelikosti;
        return cenaVelikosti == null ? artCena : Number(cenaVelikosti);
      };
      const izbranaVelikostPice = modDialogVelikostPice
        ?? aktivneVelikostiPic.find((velikost) => velikost.id === "normalna" && artRazpolozljivostVelikosti?.normalna !== 0)?.id
        ?? aktivneVelikostiPic.find((velikost) => artRazpolozljivostVelikosti?.[velikost.id] !== 0)?.id
        ?? aktivneVelikostiPic[0]?.id;
      const jeIzbranaVelikostPiceRazprodana = izbranaVelikostPice != null
        && artRazpolozljivostVelikosti?.[izbranaVelikostPice] === 0;
      const artCenaZaPrikaz = artJePica
        ? cenaZaVelikostPice(izbranaVelikostPice ?? "normalna")
        : artCena;
      const queryByModifierId = new Map(
        modDialogSelectedModifierIds.map((modifierId, index) => [modifierId, modDialogNormativiQueries[index]] as const),
      );
      const nestedSourcesForModifier = (modifierId: number) => {
        const query = queryByModifierId.get(modifierId);
        if (!Array.isArray(query?.data)) return [];
        const sourceArticles = new Map<number, {
          artikelId: number;
          ime: string;
          groups: ModSkupinaFull[];
        }>();
        for (const normativeRow of query.data) {
          if (!(Number(normativeRow.kolicina) > 0)) continue;
          const article = artikliMapForOrder.get(normativeRow.vhodniArtikelId) as
            (ArtikelItem & { modSkupine?: ModSkupinaFull[] }) | undefined;
          if (!article || article.prodajniArtikel !== true || sourceArticles.has(article.id)) continue;
          if (!Array.isArray(article.modSkupine)) continue;
          sourceArticles.set(article.id, {
            artikelId: article.id,
            ime: article.ime,
            groups: article.modSkupine,
          });
        }
        return [...sourceArticles.values()];
      };
      const invalidNestedSources = modDialogSelectedModifierIds.some(modifierId => {
        const query = queryByModifierId.get(modifierId);
        if (!Array.isArray(query?.data) || loadingArtikli) return false;
        return query.data.some(normativeRow => {
          if (!(Number(normativeRow.kolicina) > 0)) return false;
          const article = artikliMapForOrder.get(normativeRow.vhodniArtikelId) as
            (ArtikelItem & { modSkupine?: ModSkupinaFull[] }) | undefined;
          return !article || Boolean(article.prodajniArtikel === true && !Array.isArray(article.modSkupine));
        });
      });
      const modifierNormativeLoading = modDialogSelectedModifierIds.some(modifierId => {
        const query = queryByModifierId.get(modifierId);
        const positiveRows = Array.isArray(query?.data) && query.data.some(row => Number(row.kolicina) > 0);
        return !query || (!query.isError && !Array.isArray(query.data)) || (loadingArtikli && positiveRows);
      });
      const modifierNormativeError = modDialogSelectedModifierIds.some(modifierId => {
        const query = queryByModifierId.get(modifierId);
        return Boolean(query?.isError);
      });
      const modifierNormativeResolved = !modifierNormativeLoading && !modifierNormativeError && !invalidNestedSources;
      const nestedSelectionInvalid = modDialogSelectedModifierIds.some(modifierId =>
        nestedSourcesForModifier(modifierId).some(source => source.groups.some(group => {
          const selectedIds = modDialogPodIzbire[`${modifierId}:${source.artikelId}`] ?? [];
          const selectedCount = selectedIds.filter(modifierId => group.modifikatorji.some(option => option.id === modifierId && option.aktiven)).length;
          const minimum = group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir;
          return selectedCount < minimum || (group.maxIzbir > 0 && selectedCount > group.maxIzbir);
        })),
      );

      const RAZREZ_RE = /\brazrez/i;
      const BREZ_RE = /\bbrez\b/i;
      const picaGroups = artJePica ? (() => {
        const vseMods = artSkupine.flatMap(sk =>
          sk.modifikatorji.filter(m => m.aktiven).map(m => ({ ...m, skupinaId: sk.id, maxIzbir: sk.maxIzbir }))
        );
        const dodatki = vseMods.filter(m => !BREZ_RE.test(m.ime) && !RAZREZ_RE.test(m.ime));
        const brez = vseMods.filter(m => BREZ_RE.test(m.ime) && !RAZREZ_RE.test(m.ime));
        const razrez = vseMods.filter(m => RAZREZ_RE.test(m.ime));
        return [
          { naslov: "Dodatki", barvaClass: "text-green-700", mods: dodatki },
          { naslov: "Brez", barvaClass: "text-orange-600", mods: brez },
          { naslov: "Razrez", barvaClass: "text-slate-600", mods: razrez },
        ].filter(g => g.mods.length > 0);
      })() : [];
      const razrezIzbire = new Set(
        picaGroups
          .find(group => group.naslov === "Razrez")
          ?.mods.map(mod => `${mod.skupinaId}:${mod.id}`) ?? [],
      );

      const isPotrdiDisabled = jeIzbranaVelikostPiceRazprodana || artSkupine.filter(s => s.obvezna).some(s => {
        const selected = modDialogIzbrani.filter(m => m.skupinaId === s.id).length;
        return selected < Math.max(1, s.minIzbir);
      }) || !modifierNormativeResolved || nestedSelectionInvalid;

      const skupajDoplačilo = modDialogIzbrani.reduce((sum, m) => {
        for (const sk of artSkupine) {
          const mod = sk.modifikatorji.find(mod2 => mod2.id === m.modifikatorId);
          if (mod) return sum + Number(mod.cenaDodatek);
        }
        return sum;
      }, 0);
      const skupajDoplačiloPodIzbire = modDialogSelectedModifierIds.reduce((sum, parentModifierId) =>
        sum + nestedSourcesForModifier(parentModifierId).reduce((sourceSum, source) => {
          const selectedIds = modDialogPodIzbire[`${parentModifierId}:${source.artikelId}`] ?? [];
          return sourceSum + source.groups.reduce((groupSum, group) =>
            groupSum + group.modifikatorji
              .filter(option => option.aktiven && selectedIds.includes(option.id))
              .reduce((optionSum, option) => optionSum + Number(option.cenaDodatek), 0),
          0);
        }, 0),
      0);

      function toggleMod(skupinaId: number, modifikatorId: number, maxIzbir: number, samoEnRazrez = false) {
        const previous = modDialogIzbrani;
        const isSelected = previous.some(m => m.skupinaId === skupinaId && m.modifikatorId === modifikatorId);
        let next: typeof previous;
        if (samoEnRazrez) {
          const brezRazreza = previous.filter(
            izbira => !razrezIzbire.has(`${izbira.skupinaId}:${izbira.modifikatorId}`),
          );
          next = isSelected ? brezRazreza : [...brezRazreza, { skupinaId, modifikatorId }];
        } else if (maxIzbir === 1) {
          const filtered = previous.filter(m => m.skupinaId !== skupinaId);
          next = isSelected ? filtered : [...filtered, { skupinaId, modifikatorId }];
        } else if (isSelected) {
          next = previous.filter(m => !(m.skupinaId === skupinaId && m.modifikatorId === modifikatorId));
        } else {
          const currentCount = previous.filter(m => m.skupinaId === skupinaId).length;
          if (maxIzbir > 0 && currentCount >= maxIzbir) return;
          next = [...previous, { skupinaId, modifikatorId }];
        }
        setModDialogIzbrani(next);
        const stillSelectedIds = new Set(next.map(selection => selection.modifikatorId));
        const removedIds = new Set(previous
          .map(selection => selection.modifikatorId)
          .filter(id => !stillSelectedIds.has(id)));
        if (removedIds.size > 0) {
          setModDialogPodIzbire(previousNested => Object.fromEntries(
            Object.entries(previousNested).filter(([key]) =>
              ![...removedIds].some(removedId => key.startsWith(`${removedId}:`)),
            ),
          ));
        }
      }

      function toggleNestedMod(parentModifierId: number, source: { artikelId: number; groups: ModSkupinaFull[] }, group: ModSkupinaFull, choiceId: number) {
        const key = `${parentModifierId}:${source.artikelId}`;
        setModDialogPodIzbire(previous => {
          const selected = previous[key] ?? [];
          const isSelected = selected.includes(choiceId);
          if (group.maxIzbir === 1) {
            const groupOptionIds = new Set(group.modifikatorji.map(option => option.id));
            return {
              ...previous,
              [key]: [...selected.filter(id => !groupOptionIds.has(id)), ...(isSelected ? [] : [choiceId])],
            };
          }
          if (isSelected) return { ...previous, [key]: selected.filter(id => id !== choiceId) };
          const selectedInGroup = selected.filter(id => group.modifikatorji.some(option => option.id === id)).length;
          if (group.maxIzbir > 0 && selectedInGroup >= group.maxIzbir) return previous;
          return { ...previous, [key]: [...selected, choiceId] };
        });
      }

      function renderNestedChoices(parentModifierId: number) {
        return nestedSourcesForModifier(parentModifierId).map(source => (
          <div
            key={`${parentModifierId}-${source.artikelId}`}
            className="ml-5 mt-1 space-y-1 border-l-2 border-primary/20 pl-3"
            data-testid={`nested-modifier-source-${parentModifierId}-${source.artikelId}`}
          >
            {source.groups.map(nestedGroup => {
              const nestedKey = `${parentModifierId}:${source.artikelId}`;
              const nestedSelected = modDialogPodIzbire[nestedKey] ?? [];
              return (
                <div key={nestedGroup.id} role="group" aria-label={`${source.ime} – ${nestedGroup.ime}`} data-testid={`nested-modifier-group-${nestedGroup.id}`}>
                  <div className="space-y-1">
                    {nestedGroup.modifikatorji.filter(choice => choice.aktiven).map(choice => {
                      const nestedIsSelected = nestedSelected.includes(choice.id);
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          role="checkbox"
                          aria-label={choice.ime}
                          data-testid={`button-nested-modifier-${parentModifierId}-${source.artikelId}-${choice.id}`}
                          aria-checked={nestedIsSelected}
                          className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors ${nestedIsSelected ? "bg-primary/10 border-primary/30" : "hover:bg-muted/50 border-transparent"}`}
                          onClick={() => toggleNestedMod(parentModifierId, source, nestedGroup, choice.id)}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${nestedIsSelected ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                            {nestedIsSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <span className="flex-1">{choice.ime}</span>
                          {Number(choice.cenaDodatek) > 0 && (
                            <span className="text-xs tabular-nums text-muted-foreground">+{Number(choice.cenaDodatek).toFixed(2)} €</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ));
      }

      function handlePotrdiModifikatorje() {
        if (modDialogArtikelId === null) return;
        if (pendingArtikli.has(modDialogArtikelId)) return;
        const artikelId = modDialogArtikelId;
        const izbrani = [...modDialogIzbrani];
        const kolicina = modDialogKolicina;
        const opomba = modDialogOpomba;
        const velikostPice = artJePica
          ? (modDialogVelikostPice ?? aktivneVelikostiPic.find((velikost) => velikost.id === "normalna")?.id ?? aktivneVelikostiPic[0]?.id)
          : undefined;
        setPendingArtikli(prev => new Set(prev).add(artikelId));
        const settle = () => setPendingArtikli(prev => { const s = new Set(prev); s.delete(artikelId); return s; });
        const modPayload: { modifikatorId: number; ime: string; cenaDodatek: number; podIzbire?: { artikelId: number; modifikatorIds: number[] }[] }[] = [];
        for (const m of izbrani) {
          for (const sk of artSkupine) {
            const mod = sk.modifikatorji.find(mod2 => mod2.id === m.modifikatorId);
            if (mod) {
              const podIzbire = nestedSourcesForModifier(mod.id).map(source => ({
                artikelId: source.artikelId,
                modifikatorIds: modDialogPodIzbire[`${mod.id}:${source.artikelId}`] ?? [],
              }));
              modPayload.push({
                modifikatorId: mod.id,
                ime: mod.ime,
                cenaDodatek: Number(mod.cenaDodatek),
                ...(podIzbire.length ? { podIzbire } : {}),
              });
              break;
            }
          }
        }
        addPostavka.mutate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { id, data: { artikelId, kolicina, gostStevilka: aktivniGostStevilka, opomba: opomba ?? null, izbranModifikatorji: modPayload, velikostPice } as any },
          {
            onSuccess: (updatedNarocilo) => {
              setModDialogArtikelId(null);
              setModDialogIzbrani([]);
               setModDialogPodIzbire({});
              setModDialogKolicina(1);
              setModDialogOpomba(null);
              setModDialogVelikostPice(undefined);
              clearSkipAutoStart();
              queryClient.setQueryData(getGetNarociloQueryKey(id), updatedNarocilo);
              queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
              setSearch("");
              settle();
            },
            onError: (err) => {
              if (isClosedOrderConflict(err)) {
                leaveClosedOrder();
              } else {
                toast({ title: "Napaka", description: orderAddErrorMessage(err), variant: "destructive" });
              }
              settle();
            },
          }
        );
      }

        return (
        <Dialog open={modDialogArtikelId !== null} onOpenChange={(open) => { if (!open) { setModDialogArtikelId(null); setModDialogIzbrani([]); setModDialogPodIzbire({}); } }}>
          <DialogContent className="top-8 md:top-8 translate-y-0 w-[calc(100%-1rem)] max-w-4xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                {artIme}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span>Izberi možnosti pred potrditvijo.</span>
                <span className="tabular-nums font-semibold text-foreground shrink-0 ml-2">{artCenaZaPrikaz.toFixed(2)} €</span>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 min-h-0 max-h-[min(62dvh,34rem)] overflow-y-auto overscroll-contain pr-1" style={{ overflowAnchor: "none" }}>
              {modDialogSelectedModifierIds.length > 0 && modifierNormativeLoading && (
                <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="modifier-normative-loading">
                  Nalagam možnosti iz normativov izbranih modifikatorjev …
                </p>
              )}
              {modifierNormativeError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="modifier-normative-error">
                  Normativa izbranega modifikatorja ni mogoče naložiti. Poskusi znova; naročila še ni mogoče potrditi.
                </p>
              )}
              {invalidNestedSources && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="modifier-normative-source-error">
                  Prodajnega artikla iz normativa ni v naloženem katalogu možnosti. Naročila ni mogoče potrditi.
                </p>
              )}
              {artJePica && aktivneVelikostiPic.length > 1 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2">Velikost pice</p>
                  <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
                    {aktivneVelikostiPic.map((velikost) => (
                      <Button
                        key={velikost.id}
                        type="button"
                        size="sm"
                        variant={izbranaVelikostPice === velikost.id ? "default" : "outline"}
                        className="h-auto min-h-[4.5rem] min-w-0 w-full flex-col gap-0.5 whitespace-normal px-2 py-2 text-center leading-tight"
                        aria-pressed={izbranaVelikostPice === velikost.id}
                        disabled={artRazpolozljivostVelikosti?.[velikost.id] === 0}
                        onClick={() => setModDialogVelikostPice(velikost.id)}
                      >
                        <span className="font-semibold">{velikost.naziv}</span>
                        <span className="text-xs opacity-80">{velikost.premer} cm</span>
                        {artRazpolozljivostVelikosti && (
                          <span className="text-[10px] opacity-80">
                            {artRazpolozljivostVelikosti[velikost.id] == null ? "Brez izračunane omejitve" : `Na voljo: ${artRazpolozljivostVelikosti[velikost.id]}`}
                          </span>
                        )}
                        <span className="font-bold">{cenaZaVelikostPice(velikost.id).toFixed(2)} €</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {artJePica ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {picaGroups.map(grupa => (
                  <div
                    key={grupa.naslov}
                    className="min-w-0 rounded-lg border bg-muted/20 p-3"
                    data-testid={`pizza-mod-group-${grupa.naslov.toLowerCase()}`}
                  >
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${grupa.barvaClass}`}>
                      {grupa.naslov === "Dodatki" && <Plus className="inline h-3 w-3 mr-1" />}
                      {grupa.naslov === "Brez" && <Minus className="inline h-3 w-3 mr-1" />}
                      {grupa.naslov}
                    </p>
                  <div className="grid grid-cols-2 gap-2">
                      {grupa.mods.map(mod => {
                        const isSelected = modDialogIzbrani.some(m => m.skupinaId === mod.skupinaId && m.modifikatorId === mod.id);
                        const availablePortions = modifierAvailabilityById.get(mod.id);
                        return (
                          <div key={mod.id} className="min-w-0" data-testid={`modifier-choice-row-${mod.id}`}>
                            <button
                              type="button"
                              data-testid={`button-modifier-${mod.id}`}
                              aria-pressed={isSelected}
                              className={`flex min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md border px-2 py-2 text-center text-sm leading-tight transition-colors ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "hover:bg-muted/60 border-muted-foreground/30"
                              }`}
                              onClick={() => toggleMod(
                                mod.skupinaId,
                                mod.id,
                                mod.maxIzbir,
                                grupa.naslov === "Razrez",
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3 shrink-0" />}
                              <span className="min-w-0 break-words">{mod.ime}</span>
                              {availablePortions !== undefined && (
                                <span className="shrink-0 text-[10px] opacity-80">{availablePortions} porcij</span>
                              )}
                              {Number(mod.cenaDodatek) > 0 && (
                                <span className={`shrink-0 tabular-nums text-xs ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                  +{Number(mod.cenaDodatek).toFixed(2)} €
                                </span>
                              )}
                            </button>
                            {isSelected && renderNestedChoices(mod.id)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                </div>
              ) : (
                artSkupine.map(skupina => (
                  <div key={skupina.id}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      {skupina.ime}
                      {skupina.obvezna && <span className="text-destructive ml-1">★</span>}
                      {skupina.maxIzbir > 1 && (
                        <span className="ml-1 normal-case font-normal tracking-normal">(do {skupina.maxIzbir})</span>
                      )}
                    </p>
                    <div className="space-y-1">
                      {skupina.modifikatorji.filter(m => m.aktiven).map(mod => {
                        const isSelected = modDialogIzbrani.some(m => m.skupinaId === skupina.id && m.modifikatorId === mod.id);
                        const availablePortions = modifierAvailabilityById.get(mod.id);
                        return (
                          <div key={mod.id} data-testid={`modifier-choice-row-${mod.id}`}>
                            <button
                              type="button"
                              data-testid={`button-modifier-${mod.id}`}
                              aria-pressed={isSelected}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors ${isSelected ? "bg-primary/10 border-primary/30" : "hover:bg-muted/50 border-transparent"}`}
                              onClick={() => toggleMod(skupina.id, mod.id, skupina.maxIzbir)}
                            >
                              <div className={`w-4 h-4 shrink-0 flex items-center justify-center border-2 transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"} ${skupina.maxIzbir === 1 ? "rounded-full" : "rounded"}`}>
                                {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </div>
                              <span className="flex-1 text-sm">{mod.ime}</span>
                              {availablePortions !== undefined && (
                                <span className="text-xs text-muted-foreground tabular-nums">{availablePortions} porcij</span>
                              )}
                              {Number(mod.cenaDodatek) > 0 && (
                                <span className="text-xs text-muted-foreground tabular-nums">+{Number(mod.cenaDodatek).toFixed(2)} €</span>
                              )}
                            </button>
                            {isSelected && renderNestedChoices(mod.id)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            {skupajDoplačilo + skupajDoplačiloPodIzbire > 0 && (
              <div className="border-t pt-2 flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground">Skupaj</span>
                <span className="font-bold tabular-nums">{(artCenaZaPrikaz + skupajDoplačilo + skupajDoplačiloPodIzbire).toFixed(2)} €</span>
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { setModDialogArtikelId(null); setModDialogIzbrani([]); setModDialogPodIzbire({}); }}>Prekliči</Button>
              <Button className="flex-1" disabled={isPotrdiDisabled || addPostavka.isPending} onClick={handlePotrdiModifikatorje}>
                Potrdi
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}

    {/* ── Dialog: configured multicourse menu ───────────────────────────── */}
    {(() => {
      const menu = multicourseMenu;
      if (!menu) return null;
      const courses = [...menu.courses].sort((a, b) => a.courseNumber - b.courseNumber);
      const menuArtikel = artikliMapForOrder.get(menu.menuArtikelId);
      const selection = multicourseSelectionRequirements(menu, courses);
      const close = () => {
        setMulticourseMenu(null);
        setMulticourseCourses([]);
        setMulticourseFoods({});
        setMulticourseWines({});
        setMulticourseOpomba("");
        setMulticourseError(null);
      };
      const toggleCourse = (courseNumber: number) => {
        if (selection.mode === "fixed") return;
        setMulticourseCourses(current => current.includes(courseNumber)
          ? current.filter(number => number !== courseNumber)
          : current.length < selection.count ? [...current, courseNumber] : current);
        setMulticourseError(null);
      };
      const submit = () => {
        const selections = courses
          .filter(course => multicourseCourses.includes(course.courseNumber))
          .map(course => ({
            courseNumber: course.courseNumber,
            foodArtikelId: multicourseFoods[course.courseNumber],
            wineArtikelId: multicourseWines[course.courseNumber],
          }));
        const validationError = validateMulticourseOrderSelection(menu, courses, selections);
        if (validationError) {
          setMulticourseError(validationError);
          return;
        }
        addMulticourseMenu.mutate({
          id,
          data: {
            menuArtikelId: menu.menuArtikelId,
            quantity: 1,
            gostStevilka: aktivniGostStevilka,
            opomba: multicourseOpomba.trim() || null,
            // The generated client may still describe the legacy required-wine
            // payload while deployed APIs accept optional wine for a course.
            selections: selections as unknown as { courseNumber: number; foodArtikelId: number; wineArtikelId: number }[],
          },
        }, {
          onSuccess: (updatedNarocilo) => {
            clearSkipAutoStart();
            queryClient.setQueryData(getGetNarociloQueryKey(id), updatedNarocilo);
            queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() });
            setSearch("");
            close();
          },
          onError: (err) => {
            if (isClosedOrderConflict(err)) {
              leaveClosedOrder();
            } else if (err instanceof ApiError && err.status === 409) {
              const serverError = (err.data as { error?: string } | null)?.error;
              toast({ title: "Menija ni bilo mogoče dodati", description: serverError ?? "Spremembe naročila trenutno niso dovoljene.", variant: "destructive" });
              void queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() });
            } else {
              toast({ title: "Menija ni bilo mogoče dodati", description: "Poskusite znova.", variant: "destructive" });
            }
          },
        });
      };

      return (
        <Dialog open onOpenChange={(open) => { if (!open && !addMulticourseMenu.isPending) close(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{menuArtikel?.ime ?? "Večhodni meni"}</DialogTitle>
              <DialogDescription>
                {selection.mode === "fixed"
                  ? `Vseh ${selection.count} hodov je v določenem vrstnem redu.`
                  : `Izberite natanko ${selection.count} od ${courses.filter(course => !course.informational).length} hodov v želenem zaporedju.`} Za vsak izbran hod izberite jed{courses.some(course => !course.informational && course.wineRequired !== false) ? "; vino izberite le, kjer je obvezno." : "."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {courses.map(course => {
                const selected = multicourseCourses.includes(course.courseNumber);
                  const informational = course.informational === true;
                const foods = course.allowedFoodArtikelIds
                  .map(foodId => artikliMapForOrder.get(foodId))
                  .flatMap(food => food ? [food] : []);
                const wines = course.allowedWineArtikelIds
                  .map(wineId => artikliMapForOrder.get(wineId))
                  .flatMap(wine => wine ? [wine] : []);
                return (
                  <fieldset key={course.courseNumber} className="rounded-lg border p-3" data-testid={`multicourse-course-${course.courseNumber}`}>
                    <label className="flex items-center gap-2 font-medium">
                      {!informational && <Checkbox
                        checked={selected}
                        disabled={selection.mode === "fixed"}
                        onCheckedChange={() => toggleCourse(course.courseNumber)}
                        data-testid={`toggle-multicourse-course-${course.courseNumber}`}
                      />}
                      <span>{course.courseName || `${course.courseNumber}. hod`}</span>
                      {informational && <span className="text-xs font-normal text-muted-foreground">(samodejno vključen hod)</span>}
                    </label>
                    {selected && !informational && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="block text-sm">
                          Jed
                          <select
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            value={multicourseFoods[course.courseNumber] ?? ""}
                            onChange={event => {
                              const foodId = Number(event.target.value);
                              setMulticourseFoods(current => foodId
                                ? { ...current, [course.courseNumber]: foodId }
                                : Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== course.courseNumber)));
                              setMulticourseError(null);
                            }}
                            data-testid={`select-multicourse-food-${course.courseNumber}`}
                          >
                            <option value="">Izberite jed</option>
                            {foods.map(food => <option key={food.id} value={food.id}>{food.ime}</option>)}
                          </select>
                        </label>
                        <label className="block text-sm">
                          Vino (1 dl){course.wineRequired !== false ? " *" : " (neobvezno)"}
                          <select
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            value={multicourseWines[course.courseNumber] ?? ""}
                            onChange={event => {
                              const wineId = Number(event.target.value);
                              setMulticourseWines(current => wineId
                                ? { ...current, [course.courseNumber]: wineId }
                                : Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== course.courseNumber)));
                              setMulticourseError(null);
                            }}
                            data-testid={`select-multicourse-wine-${course.courseNumber}`}
                          >
                            <option value="">{course.wineRequired !== false ? "Izberite vino" : "Brez vina"}</option>
                            {wines.map(wine => <option key={wine.id} value={wine.id}>{wine.ime} · 1 dl</option>)}
                          </select>
                        </label>
                      </div>
                    )}
                  </fieldset>
                );
              })}
              <label className="block text-sm">
                Opomba
                <Input value={multicourseOpomba} onChange={event => setMulticourseOpomba(event.target.value)} maxLength={1000} data-testid="input-multicourse-note" />
              </label>
              {multicourseError && <p role="alert" className="text-sm text-destructive" data-testid="multicourse-selection-error">{multicourseError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={close} disabled={addMulticourseMenu.isPending} data-testid="button-cancel-multicourse-menu">Prekliči</Button>
              <Button onClick={submit} disabled={addMulticourseMenu.isPending} data-testid="button-add-multicourse-menu">
                {addMulticourseMenu.isPending ? "Dodajanje …" : "Dodaj meni"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}

    {/* ── Dialog: Opcije — izbirne modifikatorske skupine obstoječe postavke ── */}
    {(() => {
      const opcijePostavka = opcijePostavkaId !== null ? (narocilo?.postavke ?? []).find(p => p.id === opcijePostavkaId) : undefined;
      const opcijeArtikelId = opcijePostavka?.artikelId ?? null;
      const opcijeArtSkupine = opcijeArtikelId !== null
        ? ((artikliMapForOrder.get(opcijeArtikelId) as { modSkupine?: ModSkupinaFull[] } | undefined)?.modSkupine ?? []).filter(s => !s.obvezna)
        : [];
      const opcijeArtIme = opcijePostavka?.ime ?? "Artikel";
      const opcijeQueryByModifierId = new Map(
        modDialogSelectedModifierIds.map((modifierId, index) => [modifierId, modDialogNormativiQueries[index]] as const),
      );
      const opcijeSourcesForModifier = (modifierId: number) => {
        const query = opcijeQueryByModifierId.get(modifierId);
        if (!Array.isArray(query?.data)) return [];
        const sources = new Map<number, { artikelId: number; ime: string; groups: ModSkupinaFull[] }>();
        for (const row of query.data) {
          if (!(Number(row.kolicina) > 0)) continue;
          const article = artikliMapForOrder.get(row.vhodniArtikelId) as
            (ArtikelItem & { modSkupine?: ModSkupinaFull[] }) | undefined;
          if (!article || article.prodajniArtikel !== true || sources.has(article.id) || !Array.isArray(article.modSkupine)) continue;
          sources.set(article.id, { artikelId: article.id, ime: article.ime, groups: article.modSkupine });
        }
        return [...sources.values()];
      };
      const opcijeInvalidSources = opcijeIzbrani.some(selection => {
        const query = opcijeQueryByModifierId.get(selection.modifikatorId);
        if (!Array.isArray(query?.data) || loadingArtikli) return false;
        return query.data.some(row => {
          if (!(Number(row.kolicina) > 0)) return false;
          const article = artikliMapForOrder.get(row.vhodniArtikelId) as
            (ArtikelItem & { modSkupine?: ModSkupinaFull[] }) | undefined;
          return !article || Boolean(article.prodajniArtikel === true && !Array.isArray(article.modSkupine));
        });
      });
      const opcijeNormativiLoading = opcijeIzbrani.some(selection => {
        const query = opcijeQueryByModifierId.get(selection.modifikatorId);
        const hasPositiveSources = Array.isArray(query?.data) && query.data.some(row => Number(row.kolicina) > 0);
        return !query || (!query.isError && !Array.isArray(query.data)) || (loadingArtikli && hasPositiveSources);
      });
      const opcijeNormativiError = opcijeIzbrani.some(selection => Boolean(opcijeQueryByModifierId.get(selection.modifikatorId)?.isError));
      const opcijeNestedInvalid = opcijeIzbrani.some(selection =>
        opcijeSourcesForModifier(selection.modifikatorId).some(source => source.groups.some(group => {
          const selectedIds = opcijePodIzbire[`${selection.modifikatorId}:${source.artikelId}`] ?? [];
          const validOptionIds = new Set(group.modifikatorji.filter(option => option.aktiven).map(option => option.id));
          const count = selectedIds.filter(optionId => validOptionIds.has(optionId)).length;
          return count < (group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir)
            || (group.maxIzbir > 0 && count > group.maxIzbir);
        })),
      );
      const opcijeNestedSourceMissing = Object.keys(opcijePodIzbire).some(key => {
        const [parentIdString, sourceIdString] = key.split(":");
        const parentId = Number(parentIdString);
        const sourceId = Number(sourceIdString);
        if (!opcijeIzbrani.some(selection => selection.modifikatorId === parentId)) return false;
        const query = opcijeQueryByModifierId.get(parentId);
        if (!Array.isArray(query?.data)) return false;
        return !opcijeSourcesForModifier(parentId).some(source => source.artikelId === sourceId);
      });
      const opcijeNestedChoiceMissing = Object.entries(opcijePodIzbire).some(([key, selectedIds]) => {
        const [parentIdString, sourceIdString] = key.split(":");
        const parentId = Number(parentIdString);
        const sourceId = Number(sourceIdString);
        if (!opcijeIzbrani.some(selection => selection.modifikatorId === parentId)) return false;
        const query = opcijeQueryByModifierId.get(parentId);
        if (!Array.isArray(query?.data)) return false;
        const source = opcijeSourcesForModifier(parentId).find(candidate => candidate.artikelId === sourceId);
        if (!source) return false;
        const knownOptionIds = new Set(source.groups.flatMap(group => group.modifikatorji.map(option => option.id)));
        return selectedIds.some(optionId => !knownOptionIds.has(optionId));
      });
      const opcijeCanSubmit = !opcijeNormativiLoading && !opcijeNormativiError && !opcijeInvalidSources
        && !opcijeNestedDataError && !opcijeNestedSourceMissing && !opcijeNestedChoiceMissing && !opcijeNestedInvalid;

      function toggleOpcije(skupinaId: number, modifikatorId: number, maxIzbir: number) {
        const previous = opcijeIzbrani;
        const isSelected = previous.some(m => m.skupinaId === skupinaId && m.modifikatorId === modifikatorId);
        let next: typeof previous;
        if (maxIzbir === 1) {
          const filtered = previous.filter(m => m.skupinaId !== skupinaId);
          next = isSelected ? filtered : [...filtered, { skupinaId, modifikatorId }];
        } else if (isSelected) {
          next = previous.filter(m => !(m.skupinaId === skupinaId && m.modifikatorId === modifikatorId));
        } else {
          const currentCount = previous.filter(m => m.skupinaId === skupinaId).length;
          if (maxIzbir > 0 && currentCount >= maxIzbir) return;
          next = [...previous, { skupinaId, modifikatorId }];
        }
        setOpcijeIzbrani(next);
        const remainingModifierIds = new Set(next.map(selection => selection.modifikatorId));
        const removedIds = new Set(previous.map(selection => selection.modifikatorId).filter(id => !remainingModifierIds.has(id)));
        if (removedIds.size > 0) {
          setOpcijePodIzbire(previousSelections => Object.fromEntries(
            Object.entries(previousSelections).filter(([key]) =>
              ![...removedIds].some(removedId => key.startsWith(`${removedId}:`)),
            ),
          ));
        }
      }

      function toggleOpcijeNested(parentModifierId: number, source: { artikelId: number }, group: ModSkupinaFull, choiceId: number) {
        const key = `${parentModifierId}:${source.artikelId}`;
        setOpcijePodIzbire(previous => {
          const selected = previous[key] ?? [];
          const isSelected = selected.includes(choiceId);
          if (group.maxIzbir === 1) {
            const groupOptionIds = new Set(group.modifikatorji.map(option => option.id));
            return { ...previous, [key]: [...selected.filter(optionId => !groupOptionIds.has(optionId)), ...(isSelected ? [] : [choiceId])] };
          }
          if (isSelected) return { ...previous, [key]: selected.filter(optionId => optionId !== choiceId) };
          const selectedInGroup = selected.filter(optionId => group.modifikatorji.some(option => option.id === optionId)).length;
          if (group.maxIzbir > 0 && selectedInGroup >= group.maxIzbir) return previous;
          return { ...previous, [key]: [...selected, choiceId] };
        });
      }

      function renderOpcijeNestedChoices(parentModifierId: number) {
        return opcijeSourcesForModifier(parentModifierId).map(source => (
          <div key={`${parentModifierId}-${source.artikelId}`} className="ml-5 mt-2 space-y-3 border-l-2 border-primary/20 pl-3" data-testid={`edit-nested-source-${parentModifierId}-${source.artikelId}`}>
            <p className="text-xs font-semibold text-muted-foreground">{source.ime}</p>
            {source.groups.map(group => {
              const selectedIds = opcijePodIzbire[`${parentModifierId}:${source.artikelId}`] ?? [];
              return (
                <div key={group.id} data-testid={`edit-nested-group-${parentModifierId}-${source.artikelId}-${group.id}`}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.ime}
                    {group.obvezna && <span className="ml-1 text-destructive">★</span>}
                    {group.maxIzbir > 1 && <span className="ml-1 normal-case font-normal tracking-normal">(do {group.maxIzbir})</span>}
                  </p>
                  <div className="space-y-1">
                    {group.modifikatorji.filter(option => option.aktiven || selectedIds.includes(option.id)).map(option => {
                      const selected = selectedIds.includes(option.id);
                      const unavailable = !option.aktiven;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          data-testid={`button-edit-nested-${parentModifierId}-${source.artikelId}-${option.id}`}
                          aria-pressed={selected}
                          className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm ${selected ? "bg-primary/10 border-primary/30" : "hover:bg-muted/50 border-transparent"} ${unavailable ? "opacity-70" : ""}`}
                          onClick={() => toggleOpcijeNested(parentModifierId, source, group, option.id)}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center border-2 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"} ${group.maxIzbir === 1 ? "rounded-full" : "rounded"}`}>
                            {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <span className="flex-1">{option.ime}</span>
                          {unavailable && <span className="text-[10px] text-destructive">Ni več na voljo</span>}
                          {Number(option.cenaDodatek) > 0 && <span className="text-xs tabular-nums text-muted-foreground">+{Number(option.cenaDodatek).toFixed(2)} €</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ));
      }

      function handlePotrdiOpcije() {
        if (opcijePostavkaId === null) return;
        if (!opcijeCanSubmit || addModifikatorji.isPending) return;
        const stavkaId = opcijePostavkaId;
        const izbrani = [...opcijeIzbrani];
        // Include all optional skupinaIds so server can clear groups with empty selection
        const skupineScope = opcijeArtSkupine.map(s => s.id);
        const modifikatorji = izbrani.map(selection => ({
          modifikatorId: selection.modifikatorId,
          podIzbire: opcijeSourcesForModifier(selection.modifikatorId).map(source => ({
            artikelId: source.artikelId,
            modifikatorIds: opcijePodIzbire[`${selection.modifikatorId}:${source.artikelId}`] ?? [],
          })),
        }));
        addModifikatorji.mutate(
          {
            id,
            postavkaId: stavkaId,
            data: {
              modifikatorji,
              skupineIds: skupineScope,
            },
          },
          {
            onSuccess: (updatedNarocilo) => {
              setOpcijePostavkaId(null);
              setOpcijeIzbrani([]);
              setOpcijePodIzbire({});
              setOpcijeNestedDataError(false);
              queryClient.setQueryData(getGetNarociloQueryKey(id), updatedNarocilo);
              queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
            },
            onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče shraniti možnosti", variant: "destructive" }),
          }
        );
      }

      const skupajDoplačiloOpcije = opcijeIzbrani.reduce((sum, m) => {
        for (const sk of opcijeArtSkupine) {
          const mod = sk.modifikatorji.find(mod2 => mod2.id === m.modifikatorId);
          if (mod) return sum + Number(mod.cenaDodatek);
        }
        return sum;
      }, 0);
      const skupajDoplačiloNestedOpcije = opcijeIzbrani.reduce((sum, selection) =>
        sum + opcijeSourcesForModifier(selection.modifikatorId).reduce((sourceSum, source) => {
          const selectedIds = opcijePodIzbire[`${selection.modifikatorId}:${source.artikelId}`] ?? [];
          return sourceSum + source.groups.reduce((groupSum, group) =>
            groupSum + group.modifikatorji
              .filter(option => option.aktiven && selectedIds.includes(option.id))
              .reduce((optionSum, option) => optionSum + Number(option.cenaDodatek), 0),
          0);
        }, 0),
      0);

      return (
        <Dialog open={opcijePostavkaId !== null} onOpenChange={(open) => { if (!open) { setOpcijePostavkaId(null); setOpcijeIzbrani([]); setOpcijePodIzbire({}); setOpcijeNestedDataError(false); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Opcije — {opcijeArtIme}
              </DialogTitle>
              <DialogDescription>Dodaj izbirne možnosti k tej postavki.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {opcijeIzbrani.length > 0 && opcijeNormativiLoading && (
                <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="edit-modifier-normative-loading">
                  Nalagam normative izbranih možnosti …
                </p>
              )}
              {opcijeNormativiError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="edit-modifier-normative-error">
                  Normativa izbrane možnosti ni mogoče naložiti. Poskusi znova; sprememb še ni mogoče shraniti.
                </p>
              )}
              {(opcijeInvalidSources || opcijeNestedSourceMissing || opcijeNestedChoiceMissing || opcijeNestedDataError) && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="edit-modifier-source-error">
                  Shranjenih izbir iz normativa ni mogoče zanesljivo povezati z razpoložljivimi viri. Sprememb ne bomo shranili, da ne izgubimo obstoječih izbir.
                </p>
              )}
              {opcijeNestedInvalid && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" role="alert" data-testid="edit-nested-validation-error">
                  Dopolni obvezne nested izbire in upoštevaj omejitve največjega števila izbir.
                </p>
              )}
              {opcijeArtSkupine.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Ni izbirnih možnosti za ta artikel.</p>
              )}
              {opcijeArtSkupine.map(skupina => (
                <div key={skupina.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    {skupina.ime}
                    {skupina.maxIzbir > 1 && (
                      <span className="ml-1 normal-case font-normal tracking-normal">(do {skupina.maxIzbir})</span>
                    )}
                  </p>
                  <div className="space-y-1">
                    {skupina.modifikatorji.filter(m => m.aktiven).map(mod => {
                      const isSelected = opcijeIzbrani.some(m => m.skupinaId === skupina.id && m.modifikatorId === mod.id);
                      return (
                        <div key={mod.id} data-testid={`edit-modifier-row-${mod.id}`}>
                          <button
                            type="button"
                            data-testid={`button-edit-modifier-${mod.id}`}
                            aria-pressed={isSelected}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors ${isSelected ? "bg-primary/10 border-primary/30" : "hover:bg-muted/50 border-transparent"}`}
                            onClick={() => toggleOpcije(skupina.id, mod.id, skupina.maxIzbir)}
                          >
                            <div className={`w-4 h-4 shrink-0 flex items-center justify-center border-2 transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"} ${skupina.maxIzbir === 1 ? "rounded-full" : "rounded"}`}>
                              {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </div>
                            <span className="flex-1 text-sm">{mod.ime}</span>
                            {Number(mod.cenaDodatek) > 0 && (
                              <span className="text-xs text-muted-foreground tabular-nums">+{Number(mod.cenaDodatek).toFixed(2)} €</span>
                            )}
                          </button>
                          {isSelected && renderOpcijeNestedChoices(mod.id)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {skupajDoplačiloOpcije + skupajDoplačiloNestedOpcije > 0 && (
              <div className="border-t pt-2 flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground">Doplačilo</span>
                <span className="font-bold tabular-nums">+{(skupajDoplačiloOpcije + skupajDoplačiloNestedOpcije).toFixed(2)} €</span>
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { setOpcijePostavkaId(null); setOpcijeIzbrani([]); setOpcijePodIzbire({}); setOpcijeNestedDataError(false); }}>Prekliči</Button>
              <Button
                className="flex-1"
                disabled={addModifikatorji.isPending || !opcijeCanSubmit}
                onClick={handlePotrdiOpcije}
              >
                Potrdi ({opcijeIzbrani.length})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}

    {/* ── Dialog: Združi naročili ──────────────────────────── */}
    <Dialog open={spojiDialogOpen} onOpenChange={setSpojiDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Združi naročili
          </DialogTitle>
          <DialogDescription>
            Izberi naročilo, ki ga želiš prenesti v trenutno naročilo #{narocilo.id}. Vse neračunane postavke se prenesejo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {drugaNarocila.map(n => (
            <div key={n.id} className="flex items-center justify-between rounded-lg border p-3 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Naročilo #{n.stevilkaNarocila ?? n.id}</p>
                <p className="text-xs text-muted-foreground">
                  {(n.postavke?.filter(p => p.racunId === null && p.parentPostavkaId == null).length ?? 0)} artiklov •{" "}
                  {Number(n.skupaj).toFixed(2)} €
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                className="shrink-0"
                disabled={spojiMutation.isPending}
                onClick={() => {
                  spojiMutation.mutate({ id, data: { virNarociloId: n.id } }, {
                    onSuccess: (u) => {
                      setSpojiDialogOpen(false);
                      queryClient.setQueryData(getGetNarociloQueryKey(id), u);
                      toast({ title: "Združeno", description: `Naročilo #${n.stevilkaNarocila ?? n.id} je bilo uspešno združeno.` });
                    },
                    onError: () => toast({ title: "Napaka", description: "Združevanje ni uspelo", variant: "destructive" }),
                  });
                }}
              >
                Združi
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
    {opombaPostavka && (
      <SystemInputDialog
        naslov="Opomba"
        vrednost={opombaPostavka.opomba ?? ""}
        onPotrdi={(nova) => handleShraniOpombo(opombaPostavka.id, opombaPostavka.kolicina, nova)}
        onPreklic={() => setOpombaPostavka(null)}
      />
    )}
    <Dialog open={gatewayConflict !== null} onOpenChange={() => undefined}>
      <DialogContent className="max-w-md" onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" /> Naročilo je trenutno zaklenjeno
          </DialogTitle>
          <DialogDescription>
            Drug POS ga ureja. Naročilo je samo za branje, dokler lastništvo ni sproščeno ali ga ne prevzame vodja.
          </DialogDescription>
        </DialogHeader>
        {(() => {
          const detail = (gatewayConflict as GatewayConflictError | null)?.detail;
          let info: any = detail;
          if (typeof detail === "string") { try { info = JSON.parse(detail); } catch { /* plain */ } }
          return (
            <div className="space-y-3">
              <div className="rounded border bg-muted/40 p-3 text-sm">
                <p><strong>Lastnik:</strong> {info?.ownerClientId ?? "neznan"}</p>
                <p><strong>Velja do:</strong> {info?.leaseUntil ?? "poteklo"}</p>
              </div>
              {gatewayOffline.scope && gatewayOrderId && (
                <Button className="w-full" variant="destructive" onClick={() => {
                  const approvalCode = window.prompt("Vnesite enkratno kodo potrditve upravitelja:");
                  if (!approvalCode) return;
                  void gatewayOffline.acquireLease(gatewayOrderId, Number(gatewayOrder?.version ?? info?.currentVersion ?? 0), 120, true, approvalCode)
                    .then(() => setGatewayConflict(null))
                    .catch(error => setGatewayConflict(error));
                }}>
                  Prevzemi kot vodja
                </Button>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
    </>
  );
}
