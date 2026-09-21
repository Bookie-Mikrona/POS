import { useEffect, useRef, useState, useMemo } from "react";
import { useListAktivnaNarocila, useListKategorije, getListAktivnaNarocilaQueryKey, useTogglePostavkaPripravljeno, useListKdsPrikazovalniki, getListKdsPrikazovalnikiQueryKey, KdsPrikazovalnik, KdsPostaja, useGetKdsNastavitve, getGetKdsNastavitveQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, UtensilsCrossed, History, ChefHat, MonitorPlay, AlertTriangle } from "lucide-react";
import { getActiveKdsTarget, getKdsCountdown, KdsNarociloGlava, kdsUrgencyClass, sortKdsNarocila } from "@/lib/kdsNarocilo";
import { useKdsPostaje, useKdsNalogiVecPostaj, useBumpNalog, useAckNalog, useFireKdsCourse, KdsNalog, useNalogZgodovina } from "@/hooks/use-kds";
import { canAcknowledgeKdsTicket } from "@/lib/kdsDispatch";
import { getNextKdsCoursesToFire } from "@/lib/kdsCourses";
import { getBarServingSize, getKdsStationStatusLabel, getPairedFoodName, isBarOnlyStation, sortKdsNalogiForStation } from "@/lib/kdsBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPosCas } from "@/lib/posCas";
import { useAuth } from "@/contexts/AuthContext";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";

// Helper functions (same as legacy)
function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function getKdsTimerStart(nalog: KdsNalog): string {
  return nalog.aktiviranoAt ?? nalog.ustvarjeno;
}

export function getNewlyActivatedKdsTicketIds(
  previous: Map<number, KdsNalog["stanje"]>,
  current: KdsNalog[],
): number[] {
  return current
    .filter(nalog => nalog.stanje === "aktivno"
      && (previous.get(nalog.id) === "zadrzano" || !previous.has(nalog.id)))
    .map(nalog => nalog.id);
}

function playKdsFireTone(): void {
  try {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.32);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Browsers may block sound until the KDS screen has received a user gesture.
  }
}

function itemBg(mins: number): string {
  if (mins >= 20) return "bg-red-100 border-l-2 border-l-red-400";
  if (mins >= 10) return "bg-orange-50 border-l-2 border-l-orange-400";
  return "bg-green-50 border-l-2 border-l-green-400";
}

function itemBadge(mins: number): string {
  if (mins >= 20) return "bg-red-500 text-white";
  if (mins >= 10) return "bg-orange-400 text-white";
  return "bg-green-500 text-white";
}

function cardBorder(mins: number): string {
  if (mins >= 20) return "bg-red-50 border-red-300";
  if (mins >= 10) return "bg-yellow-50 border-yellow-300";
  return "bg-white border-border";
}

type KdsStationType = "bar" | "kitchen" | "pizza";

export type KdsCourseGroup = {
  courseNumber?: number | null;
  courseSequence?: number | null;
  nalogi: KdsNalog[];
};

export type KdsHeaderPostavka = {
  gostStevilka?: number | null;
  alergeni?: readonly string[] | null;
  alergeniSledi?: readonly string[] | null;
};

/** Header data is derived only from the order lines visible to this KDS card. */
export function getKdsHeaderWarnings(postavke: readonly KdsHeaderPostavka[]): {
  guestCount: number | null;
  allergens: string[];
  traces: string[];
} {
  const guests = postavke
    .map((postavka) => postavka.gostStevilka)
    .filter((guest): guest is number => typeof guest === "number" && Number.isFinite(guest) && guest > 0);
  const unique = (values: readonly (readonly string[] | null | undefined)[]) =>
    [...new Set(values.flatMap((value) => value ?? []))].sort((a, b) => a.localeCompare(b, "sl"));

  return {
    guestCount: guests.length > 0 ? Math.max(...guests) : null,
    allergens: unique(postavke.map((postavka) => postavka.alergeni)),
    traces: unique(postavke.map((postavka) => postavka.alergeniSledi)),
  };
}

/** Keeps every KDS line on a ticket visible in its immutable serving order. */
export function groupKdsNalogiByCourse(nalogi: KdsNalog[], barOnly = false): KdsCourseGroup[] {
  const sorted = sortKdsNalogiForStation(nalogi, barOnly).sort((a, b) => {
    if (barOnly && a.stanje !== b.stanje) {
      const priority = (a.stanje === "aktivno" ? 0 : a.stanje === "zadrzano" ? 1 : 2)
        - (b.stanje === "aktivno" ? 0 : b.stanje === "zadrzano" ? 1 : 2);
      if (priority !== 0) return priority;
    }
    const sequenceA = a.courseSequence ?? Number.MAX_SAFE_INTEGER;
    const sequenceB = b.courseSequence ?? Number.MAX_SAFE_INTEGER;
    if (sequenceA !== sequenceB) return sequenceA - sequenceB;
    const courseA = a.courseNumber ?? Number.MAX_SAFE_INTEGER;
    const courseB = b.courseNumber ?? Number.MAX_SAFE_INTEGER;
    if (courseA !== courseB) return courseA - courseB;
    const createdA = new Date(a.ustvarjeno).getTime();
    const createdB = new Date(b.ustvarjeno).getTime();
    if (createdA !== createdB) return createdA - createdB;
    return a.id - b.id;
  });
  const groups = new Map<string, KdsCourseGroup>();
  for (const nalog of sorted) {
    const key = nalog.courseSequence != null
      ? `sequence:${nalog.courseSequence}`
      : nalog.courseNumber != null
        ? `course:${nalog.courseNumber}`
        : "ordinary";
    const group = groups.get(key);
    if (group) group.nalogi.push(nalog);
    else groups.set(key, {
      courseNumber: nalog.courseNumber,
      courseSequence: nalog.courseSequence,
      nalogi: [nalog],
    });
  }
  return Array.from(groups.values());
}

/** @deprecated Use pairing-aware getNextKdsCoursesToFire for KDS controls. */
export function getNextKdsCourseToFire(nalogi: KdsNalog[]): number | undefined {
  const courseNumbers = [...new Set(nalogi.map(n => n.courseNumber).filter((course): course is number => course != null))].sort((a, b) => a - b);
  const completed = courseNumbers.filter(course => nalogi.filter(n => n.courseNumber === course)
    .every(n => n.stanje === "bumped" || n.stanje === "ack")).at(-1);
  const next = completed == null ? undefined : completed + 1;
  return next != null && next <= 4 && !courseNumbers.includes(next) ? next : undefined;
}

export default function Kitchen({
  stationTypes,
  title = "KDS",
}: {
  stationTypes?: KdsStationType[];
  title?: string;
}) {
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const keyPrikazovalniki = enotaId ? [...getListKdsPrikazovalnikiQueryKey(), enotaId] : getListKdsPrikazovalnikiQueryKey();

  const { data: postaje, isLoading: loadingPostaje, isError: errorPostaje } = useKdsPostaje();
  const { data: prikazovalniki, isLoading: loadingPrikazovalniki } = useListKdsPrikazovalniki({ query: { queryKey: keyPrikazovalniki, enabled: !!enotaId } });

  const hasKds = postaje && postaje.length > 0;
  const hasPrikazovalniki = prikazovalniki && prikazovalniki.length > 0;

  if (loadingPostaje || loadingPrikazovalniki) {
    return (
      <div className="p-4 flex-1 flex items-center justify-center bg-gray-950 text-white">
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <UtensilsCrossed className="h-10 w-10 animate-pulse" />
          <p>Nalagam...</p>
        </div>
      </div>
    );
  }

  if (errorPostaje) {
    return (
      <div className="p-4 flex-1 flex items-center justify-center bg-gray-950 text-white">
        <div className="flex flex-col items-center gap-4 text-red-500">
          <UtensilsCrossed className="h-10 w-10 opacity-50" />
          <p>Napaka pri nalaganju. Preverite povezavo.</p>
        </div>
      </div>
    );
  }

  const aktivniPrikazovalniki = prikazovalniki?.filter(p => p.aktiven) || [];
  const hasAktivniPrikazovalniki = aktivniPrikazovalniki.length > 0;

  if (hasKds && (stationTypes?.length || hasAktivniPrikazovalniki) && postaje) {
    return <KdsKitchenView prikazovalniki={aktivniPrikazovalniki} postaje={postaje} stationTypes={stationTypes} title={title} />;
  }

  if (hasPrikazovalniki && !hasAktivniPrikazovalniki) {
    return (
      <div className="p-8">
        <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-md">
          <h2 className="font-bold text-lg mb-2">Ni aktivnih prikazovalnikov</h2>
          <p>Dodali ste prikazovalnike, vendar nobeden ni označen kot aktiven. Pojdite v Nastavitve &gt; KDS Nastavitve in aktivirajte vsaj en prikazovalnik za to napravo.</p>
        </div>
      </div>
    );
  }

  return <LegacyKitchenView />;
}

function KdsKitchenView({
  prikazovalniki,
  postaje,
  stationTypes,
  title,
}: {
  prikazovalniki: KdsPrikazovalnik[];
  postaje: KdsPostaja[];
  stationTypes?: KdsStationType[];
  title: string;
}) {
  const { user } = useAuth();
  const gatewayOffline = useGatewayOfflineContext();
  const enotaId = user?.enotaId;
  const keyNastavitve = enotaId ? [...getGetKdsNastavitveQueryKey(), enotaId] : getGetKdsNastavitveQueryKey();
  const { data: nastavitve } = useGetKdsNastavitve({ query: { queryKey: keyNastavitve, enabled: !!enotaId } });

  const [activeDisplayId, setActiveDisplayId] = useState<number>(prikazovalniki.find((p: KdsPrikazovalnik) => p.aktiven)?.id ?? prikazovalniki[0]?.id);

  useEffect(() => {
    if (!prikazovalniki.find((p) => p.id === activeDisplayId)) {
      setActiveDisplayId(prikazovalniki.find((p) => p.aktiven)?.id ?? prikazovalniki[0]?.id);
    }
  }, [prikazovalniki, activeDisplayId]);

  const { data: narocila } = useListAktivnaNarocila();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0);

  const activeDisplay = prikazovalniki.find((p: KdsPrikazovalnik) => p.id === activeDisplayId);
  const barOnly = isBarOnlyStation(stationTypes);
  const subbedPostajaIds = stationTypes?.length
    ? postaje.filter((postaja) => stationTypes.includes(postaja.tip as KdsStationType)).map((postaja) => postaja.id)
    : activeDisplay?.postajaIds || [];

  const postajaQueries = useKdsNalogiVecPostaj(subbedPostajaIds);
  const loadingNalogi = postajaQueries.some(q => q.isLoading);
  const errorNalogi = postajaQueries.some(q => q.isError);
  const serverNalogi = useMemo(() => {
    const unique = new Map<string, KdsNalog>();
    for (const nalog of postajaQueries.flatMap(q => q.data || [])) {
      unique.set(String(nalog.id), nalog);
    }
    return [...unique.values()];
  }, [postajaQueries]);
  const displayNarocila = useMemo(() => {
    if (gatewayOffline.effectiveAuthority !== "GATEWAY") return narocila;
    const jobs = gatewayOffline.snapshot?.kdsJobs ?? [];
    return (gatewayOffline.snapshot?.orders ?? []).map((order: any) => {
      const projection = (order.projection ?? {}) as Record<string, any>;
      const lines = jobs
        .filter((job: any) => String(job.payload?.orderId ?? "") === String(order.orderId))
        .map((job: any) => {
          const line = job.payload?.line ?? {};
          return { ...line, id: line.lineId ?? line.id, pripravljeno: job.state === "COMPLETED",
            ustvarjeno: job.createdAt ?? new Date(0).toISOString() };
        });
      return { ...projection, id: order.orderId, status: order.state === "OPEN" ? "odprto" : "zakljuceno",
        postavke: lines };
    }) as typeof narocila;
  }, [gatewayOffline.effectiveAuthority, gatewayOffline.snapshot, narocila]);
  const previousServerStatesRef = useRef<Map<number, KdsNalog["stanje"]> | null>(null);

  useEffect(() => {
    const previous = previousServerStatesRef.current;
    if (previous && getNewlyActivatedKdsTicketIds(previous, serverNalogi).length > 0) {
      playKdsFireTone();
    }
    previousServerStatesRef.current = new Map(serverNalogi.map(nalog => [nalog.id, nalog.stanje]));
  }, [serverNalogi]);

  const bump = useBumpNalog();
  const ack = useAckNalog();
  const fireCourse = useFireKdsCourse();

  const [localStanja, setLocalStanja] = useState<Record<number, { stanje: "bumped" | "ack", nalog: KdsNalog }>>({});

  // Zgodovina Dialog state
  const [historyNalog, setHistoryNalog] = useState<KdsNalog | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["kds"] });
      setTick(t => t + 1);
    }, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [queryClient]);

  // Combine server nalogi with our optimistic local states
  const activeNalogi = useMemo(() => {
    const map = new Map<number, KdsNalog>();
    if (serverNalogi) {
      for (const n of serverNalogi) {
        if (localStanja[n.id]?.stanje !== "ack") {
          map.set(n.id, { ...n, stanje: localStanja[n.id]?.stanje ?? n.stanje });
        }
      }
    }
    for (const local of Object.values(localStanja)) {
      if (local.stanje !== "ack" && !map.has(local.nalog.id)) {
        map.set(local.nalog.id, { ...local.nalog, stanje: local.stanje });
      }
    }
    // Held tickets are returned for fire controls but never shown as
    // actionable production tickets.
    return Array.from(map.values()).filter(n => n.stanje !== "zadrzano");
  }, [serverNalogi, localStanja]);

  const heldNalogiPoNarocilu = useMemo(() => {
    const map = new Map<number, KdsNalog[]>();
    for (const n of serverNalogi) {
      if (n.stanje !== "zadrzano") continue;
      const current = map.get(n.narociloId) ?? [];
      current.push(n);
      map.set(n.narociloId, current);
    }
    return map;
  }, [serverNalogi]);

  // Map narociloId -> kds nalogi for that narocilo
  const nalogiPoNarocilu = useMemo(() => {
    const map = new Map<number, KdsNalog[]>();
    for (const n of activeNalogi) {
      const arr = map.get(n.narociloId) ?? [];
      arr.push(n);
      map.set(n.narociloId, arr);
    }
    return map;
  }, [activeNalogi]);

  const odprtaPoStarosti = (displayNarocila?.filter(n => n.status === "odprto") ?? [])
    .map(n => {
      const vidniKdsNalogi = nalogiPoNarocilu.get(n.id) ?? [];
      const kdsZaToNarocilo = [...vidniKdsNalogi, ...(heldNalogiPoNarocilu.get(n.id) ?? [])];
      if (vidniKdsNalogi.length === 0) return null;

      const vsePostavke = n.postavke ?? [];

      // We only care about items that are in active KDS nalogi
      // Include held lines as well: they belong to this ticket, even though they
      // must not become actionable production rows before they are fired.
      const kdsPostavkaIds = new Set(kdsZaToNarocilo.map(x => x.postavkaId));

      const topPostavke = vsePostavke
        .filter(p => kdsPostavkaIds.has(p.id))
        .sort((a, b) => {
          const nalogiA = kdsZaToNarocilo.filter(x => x.postavkaId === a.id);
          const nalogiB = kdsZaToNarocilo.filter(x => x.postavkaId === b.id);
          if (barOnly) {
            const priority = (nalogiA.some(n => n.stanje === "aktivno") ? 0 : nalogiA.some(n => n.stanje === "zadrzano") ? 1 : 2)
              - (nalogiB.some(n => n.stanje === "aktivno") ? 0 : nalogiB.some(n => n.stanje === "zadrzano") ? 1 : 2);
            if (priority !== 0) return priority;
          }
          const aDone = nalogiA.length > 0 && nalogiA.every(n => n.stanje === "bumped" || n.stanje === "ack");
          const bDone = nalogiB.length > 0 && nalogiB.every(n => n.stanje === "bumped" || n.stanje === "ack");
          if (aDone !== bDone) return aDone ? 1 : -1;
          const aCourse = nalogiA[0]?.courseNumber ?? 0;
          const bCourse = nalogiB[0]?.courseNumber ?? 0;
          if (aCourse !== bCourse) return aCourse - bCourse;
          const aSequence = nalogiA[0]?.courseSequence ?? 0;
          const bSequence = nalogiB[0]?.courseSequence ?? 0;
          if (aSequence !== bSequence) return aSequence - bSequence;
          return new Date(a.ustvarjeno).getTime() - new Date(b.ustvarjeno).getTime();
        });

      const childMap = new Map<number, typeof vsePostavke>();
      for (const p of vsePostavke) {
        if (p.parentPostavkaId != null) {
          const arr = childMap.get(p.parentPostavkaId) ?? [];
          arr.push(p);
          childMap.set(p.parentPostavkaId, arr);
        }
      }

      const najstarejsi = topPostavke
        .filter(p => {
          const matchingNalogi = kdsZaToNarocilo.filter(x => x.postavkaId === p.id);
          // Only filter it out if ALL matching nalogi are bumped (or acked)
          return matchingNalogi.some(n => n.stanje !== "bumped" && n.stanje !== "ack");
        })
        .reduce((min, p) => {
          const t = new Date(p.ustvarjeno).getTime();
          return t < min ? t : min;
        }, Date.now());

      return { ...n, topPostavke, childMap, kdsZaToNarocilo, najstarejsiMs: najstarejsi };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null && n.topPostavke.length > 0)
    .sort((a, b) => a.najstarejsiMs - b.najstarejsiMs);

  // A bar operator must see a pour that has just been FIRED before held or
  // already served tickets, even when another ticket is older.
  const odprta = barOnly
    ? [...odprtaPoStarosti].sort((a, b) => {
      const aActive = a.kdsZaToNarocilo.some(n => n.stanje === "aktivno");
      const bActive = b.kdsZaToNarocilo.some(n => n.stanje === "aktivno");
      return aActive === bActive ? a.najstarejsiMs - b.najstarejsiMs : aActive ? -1 : 1;
    })
    : sortKdsNarocila(odprtaPoStarosti);

  function handleBump(nalog: KdsNalog, e: React.MouseEvent) {
    e.stopPropagation();
    if (nalog.stanje !== "aktivno") return;

    setLocalStanja(prev => ({ ...prev, [nalog.id]: { stanje: "bumped", nalog } }));

    const idempotencyKey = crypto.randomUUID();
    bump.mutate({ id: nalog.id, idempotencyKey }, {
      onError: () => {
        setLocalStanja(prev => {
          const next = { ...prev };
          delete next[nalog.id];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ["kds"] });
      }
    });
  }

  function handleAck(nalog: KdsNalog, e: React.MouseEvent) {
    e.stopPropagation();
    if (nalog.stanje !== "bumped") return;

    setLocalStanja(prev => ({ ...prev, [nalog.id]: { stanje: "ack", nalog } }));

    const idempotencyKey = crypto.randomUUID();
    ack.mutate({ id: nalog.id, idempotencyKey }, {
      onError: () => {
        setLocalStanja(prev => {
          const next = { ...prev };
          delete next[nalog.id];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ["kds"] });
      }
    });
  }

  function handleItemClick(nalog: KdsNalog, e: React.MouseEvent) {
    if (nalog.stanje === "aktivno") {
      handleBump(nalog, e);
    } else if (canAcknowledgeKdsTicket(nalog.stanje, Boolean(nastavitve?.dispatchOmogocen))) {
      handleAck(nalog, e);
    }
  }

  return (
    <div className="p-4 flex-1 overflow-auto bg-gray-950 text-white flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <MonitorPlay className="h-7 w-7 text-purple-400" />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {!stationTypes?.length && (
            <Select
              value={activeDisplayId.toString()}
              onValueChange={(v) => setActiveDisplayId(Number(v))}
            >
              <SelectTrigger className="w-[250px] bg-gray-900 border-gray-800">
                <SelectValue placeholder="Izberi zaslon" />
              </SelectTrigger>
              <SelectContent>
                {prikazovalniki.map((p: KdsPrikazovalnik) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.ime === "Bar" ? "Točilnica" : p.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2 text-gray-400 text-sm hidden sm:flex">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            Osveži vsakih 15s
          </div>
        </div>
      </div>

      {subbedPostajaIds.length === 0 ? (
        <div className="bg-orange-950 border border-orange-800 text-orange-200 px-4 py-3 rounded-lg mb-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-orange-500 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Ta zaslon nima naročnin</p>
            <p className="text-xs opacity-80">Zaslon ne spremlja nobene postaje. V nastavitvah mu določite postaje (npr. Kuhinja, Pica), da bo prikazoval njihova naročila.</p>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mb-4 items-center">
          <span className="text-xs text-gray-400">Postaje:</span>
          <div className="flex flex-wrap gap-1.5">
            {subbedPostajaIds.map((sid: number) => {
               const p = postaje.find((x: KdsPostaja) => x.id === sid);
               return <Badge key={sid} variant="outline" className="bg-gray-900 border-gray-700 text-gray-300 text-[10px]">{p ? (p.ime === "Bar" ? "Točilnica" : p.ime) : sid}</Badge>;
            })}
          </div>
        </div>
      )}

      <div className="flex gap-4 mb-4 text-xs overflow-x-auto pb-2 shrink-0">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-gray-400">&lt;10 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
          <span className="text-gray-400">10–20 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-gray-400">&gt;20 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-gray-400">Pripravljeno (Bumped)</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
          <span className="text-gray-400">Preusmerjeno na privzeto postajo</span>
        </div>
      </div>

      {errorNalogi ? (
        <div className="flex flex-col items-center justify-center py-32 text-red-500 gap-4 flex-1">
          <MonitorPlay className="h-16 w-16 opacity-50" />
          <p className="text-xl font-medium">Napaka pri nalaganju nalogov</p>
        </div>
      ) : loadingNalogi && !serverNalogi.length ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-600 gap-4 flex-1">
          <MonitorPlay className="h-16 w-16 opacity-30 animate-pulse" />
          <p className="text-xl font-medium">Nalagam naloge...</p>
        </div>
      ) : odprta.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-600 gap-4 flex-1">
          <MonitorPlay className="h-16 w-16 opacity-30" />
          <p className="text-xl font-medium">Ni aktivnih nalogov za izbrani zaslon</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {odprta.map(narocilo => {
            const cardMins = Math.floor((Date.now() - narocilo.najstarejsiMs) / 60000);
            const vsePripravljeno = narocilo.kdsZaToNarocilo.every(n => n.stanje === "bumped" || n.stanje === "ack");
            const target = getActiveKdsTarget(narocilo, vsePripravljeno);
            const targetUrgency = target ? getKdsCountdown(target.iso).urgency : null;
            const imaFallback = narocilo.kdsZaToNarocilo.some(n => n.uporabljenFallback);
            const nextCourses = getNextKdsCoursesToFire(narocilo.kdsZaToNarocilo);
            const courseGroups = groupKdsNalogiByCourse(narocilo.kdsZaToNarocilo, barOnly);
            const headerWarnings = getKdsHeaderWarnings(narocilo.topPostavke);
            const hasActiveBarCourse = barOnly && narocilo.kdsZaToNarocilo.some(n => n.stanje === "aktivno");

            return (
              <Card
                key={narocilo.id}
                data-testid={`kds-narocilo-${narocilo.id}`}
                className={`border-2 transition-all flex flex-col relative ${hasActiveBarCourse ? "ring-2 ring-fuchsia-400 ring-offset-2 ring-offset-gray-950" : targetUrgency ? kdsUrgencyClass(targetUrgency) : cardBorder(cardMins)}`}
              >
                {imaFallback && (
                  <div className="absolute -top-2.5 -right-2.5 bg-yellow-400 text-yellow-950 p-1.5 rounded-full shadow border border-yellow-500" title="Ta listek vsebuje artikle, ki so se preusmerili preko privzete (fallback) postaje, ker niso imeli pravila.">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                <CardHeader className="pb-2 pt-3 px-4 shrink-0">
                  <CardTitle className="sr-only">Naročilo {narocilo.id}</CardTitle>
                  <KdsNarociloGlava
                    narocilo={narocilo}
                    itemCount={narocilo.topPostavke.length}
                    pripravljeno={vsePripravljeno}
                  />
                  {(headerWarnings.guestCount != null || headerWarnings.allergens.length > 0 || headerWarnings.traces.length > 0 || narocilo.opomba) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {headerWarnings.guestCount != null && (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-extrabold text-blue-800">
                          Gostje: {headerWarnings.guestCount}
                        </Badge>
                      )}
                      {headerWarnings.allergens.length > 0 && (
                        <Badge variant="outline" className="border-red-400 bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-900">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Alergeni: {headerWarnings.allergens.join(", ")}
                        </Badge>
                      )}
                      {headerWarnings.traces.length > 0 && (
                        <Badge variant="outline" className="border-orange-400 bg-orange-100 px-1.5 py-0.5 text-[10px] font-extrabold text-orange-900">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Sledi: {headerWarnings.traces.join(", ")}
                        </Badge>
                      )}
                      {narocilo.opomba && (
                        <div className="basis-full rounded-md border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-bold text-amber-950">
                          Opomba / prehranska omejitev: {narocilo.opomba}
                        </div>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="px-3 pb-3 flex-1 flex flex-col min-h-0">
                  <ul className="space-y-1.5 overflow-y-auto pr-0.5 flex-1">
                    {courseGroups.flatMap((courseGroup) => {
                      const courseLabel = courseGroup.courseNumber != null
                        ? `${courseGroup.courseNumber}. hod`
                        : null;
                      return [
                        ...(courseLabel ? [(
                          <li key={`course-${courseGroup.courseSequence ?? courseGroup.courseNumber}`} className="pt-1 first:pt-0">
                            <div className="border-b border-slate-200 pb-1 text-[10px] font-extrabold uppercase tracking-wide text-violet-800">
                              {courseLabel}
                            </div>
                          </li>
                        )] : []),
                        ...courseGroup.nalogi.flatMap(nalog => {
                          const p = narocilo.topPostavke.find(postavka => postavka.id === nalog.postavkaId);
                          if (!p) return [];
                           const done = nalog.stanje === "bumped" || nalog.stanje === "ack";
                           const held = nalog.stanje === "zadrzano";
                           const statusLabel = getKdsStationStatusLabel(nalog, barOnly);
                           const pairedFoodName = barOnly ? getPairedFoodName(p, narocilo.postavke ?? []) : undefined;
                           const servingSize = barOnly ? getBarServingSize(p.ime) : undefined;
                        const isWaitingForDispatch = done && nastavitve?.dispatchOmogocen && nalog.stanje === "bumped";
                        const mins = minutesSince(getKdsTimerStart(nalog));
                        const otroci = narocilo.childMap.get(p.id) ?? [];
                         const itemNalogi = narocilo.kdsZaToNarocilo.filter(x => x.postavkaId === p.id);
                         const actionable = nalog.stanje === "aktivno"
                           || canAcknowledgeKdsTicket(nalog.stanje, Boolean(nastavitve?.dispatchOmogocen));

                        return (
                          <li
                            key={nalog.id}
                             onClick={actionable ? (e) => handleItemClick(nalog, e) : undefined}
                            className={`rounded-md px-2.5 py-2 select-none transition-all relative group ${
                                held
                                 ? "border border-slate-300 bg-slate-100 opacity-55"
                                 : done
                                ? "bg-emerald-100 border-l-2 border-l-emerald-500 opacity-80"
                                 : barOnly
                                   ? "border-2 border-fuchsia-500 bg-fuchsia-50 shadow-md animate-pulse"
                                : itemBg(mins)
                             } ${actionable ? "cursor-pointer active:scale-[0.98]" : "cursor-default"}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                   <span className={`text-sm font-semibold leading-tight ${held ? "text-slate-600" : done ? "text-emerald-900" : "text-gray-900"}`}>{p.ime}</span>
                                   <span className={`font-bold text-xs shrink-0 ${held ? "text-slate-500" : done ? "text-emerald-700" : "text-gray-500"}`}>×{p.kolicina}</span>
                                </div>
                                  {statusLabel && (
                                    <Badge variant="outline" className={`mt-1 border-0 px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                      barOnly && nalog.stanje === "aktivno"
                                        ? "bg-fuchsia-700 text-white animate-pulse"
                                        : held ? "bg-slate-200 text-slate-700"
                                          : done ? "bg-emerald-200 text-emerald-800"
                                            : "bg-orange-100 text-orange-800"
                                    }`}>
                                      {statusLabel}
                                    </Badge>
                                  )}
                                  {barOnly && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {servingSize && <Badge variant="outline" className="border-fuchsia-300 bg-white px-1.5 py-0 text-[9px] font-bold text-fuchsia-900">{servingSize}</Badge>}
                                      {pairedFoodName && <span className="text-[10px] font-semibold text-fuchsia-900">K jedi: {pairedFoodName}</span>}
                                    </div>
                                  )}
                                {p.opomba && (
                                   <span className={`text-xs italic leading-snug block mt-0.5 ${held ? "text-slate-500" : done ? "text-emerald-800" : "text-gray-600"}`}>↳ {p.opomba}</span>
                                )}
                                {otroci.map(d => (
                                   <div key={d.id} className={`text-xs font-medium leading-tight mt-0.5 ${held ? "text-slate-500" : done ? "text-emerald-700" : "text-orange-700"}`}>+ {d.ime}</div>
                                ))}
                                 {itemNalogi.length > 1 && (
                                  <div className="mt-1">
                                    <Badge variant="outline" className={`text-[9px] uppercase font-bold border-0 bg-black/5 ${done ? "text-emerald-700" : "text-gray-600"}`}>
                                      {postaje.find(x => x.id === nalog.postajaId)?.ime || "Neznana postaja"}
                                    </Badge>
                                  </div>
                                )}
                                 {itemNalogi.length <= 1 && (
                                  <div className="mt-1">
                                    <Badge variant="outline" className="text-[9px] uppercase font-bold border-0 bg-black/5 text-gray-600">
                                      {postaje.find(x => x.id === nalog.postajaId)?.ime === "Bar"
                                        ? "Točilnica" : postaje.find(x => x.id === nalog.postajaId)?.ime || "Neznana postaja"}
                                    </Badge>
                                  </div>
                                )}
                                {isWaitingForDispatch && (
                                  <div className="mt-1.5 text-[10px] font-bold text-emerald-800 bg-emerald-200/50 inline-block px-1.5 py-0.5 rounded">
                                    Čaka na izdajo
                                  </div>
                                )}
                                 {nalog.uporabljenFallback && !done && !held && (
                                  <div className="mt-1 text-[9px] font-bold text-yellow-700 uppercase flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Privzeto (Fallback)</div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1.5 shrink-0">
                                 {done ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                 ) : held ? (
                                   <span className="text-[10px] font-bold uppercase text-slate-500">HOLD</span>
                                ) : (
                                  <span className={`flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums ${itemBadge(mins)}`}>
                                    <Clock className="h-3 w-3" />
                                    {mins}′
                                  </span>
                                )}
                                 {!held && <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-1.5 right-1.5 ${done ? "text-emerald-700 hover:text-emerald-900 hover:bg-emerald-200" : "text-gray-500 hover:text-gray-700 hover:bg-black/5"}`}
                                  onClick={(e) => { e.stopPropagation(); setHistoryNalog(nalog); }}
                                  title="Zgodovina naloga"
                                >
                                  <History className="h-3.5 w-3.5" />
                                 </Button>}
                              </div>
                            </div>
                          </li>
                        );
                        }),
                      ];
                    })}
                  </ul>
                  {nextCourses.map((nextCourse) => (
                    <Button
                      key={nextCourse.pairingGroupId}
                      className="mt-3 w-full bg-violet-600 hover:bg-violet-700"
                      disabled={fireCourse.isPending}
                      onClick={() => fireCourse.mutate({
                        narociloId: narocilo.id,
                        courseNumber: nextCourse.courseNumber,
                        pairingGroupId: nextCourse.pairingGroupId,
                        idempotencyKey: `kds-fire:${narocilo.id}:${nextCourse.pairingGroupId}:${nextCourse.courseSequence}`,
                      })}
                      data-testid={`fire-course-${narocilo.id}-${nextCourse.courseNumber}-${nextCourse.pairingGroupId}`}
                    >
                      Sprosti hod {nextCourse.courseNumber}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {historyNalog && (
        <NalogZgodovinaDialog
          nalog={historyNalog}
          onClose={() => setHistoryNalog(null)}
          dispatchOmogocen={Boolean(nastavitve?.dispatchOmogocen)}
          onBump={(nalog) => {
            const idempotencyKey = crypto.randomUUID();
            setLocalStanja(prev => ({ ...prev, [nalog.id]: { stanje: "bumped", nalog } }));
            bump.mutate({ id: nalog.id, idempotencyKey }, {
              onError: () => {
                setLocalStanja(prev => { const next = { ...prev }; delete next[nalog.id]; return next; });
                queryClient.invalidateQueries({ queryKey: ["kds"] });
              }
            });
          }}
          onAck={(nalog) => {
            const idempotencyKey = crypto.randomUUID();
            setLocalStanja(prev => ({ ...prev, [nalog.id]: { stanje: "ack", nalog } }));
            ack.mutate({ id: nalog.id, idempotencyKey }, {
              onError: () => {
                setLocalStanja(prev => { const next = { ...prev }; delete next[nalog.id]; return next; });
                queryClient.invalidateQueries({ queryKey: ["kds"] });
              }
            });
          }}
        />
      )}
    </div>
  );
}

function NalogZgodovinaDialog({
  nalog,
  onClose,
  onBump,
  onAck,
  dispatchOmogocen,
}: {
  nalog: KdsNalog;
  onClose: () => void;
  onBump: (nalog: KdsNalog) => void;
  onAck: (nalog: KdsNalog) => void;
  dispatchOmogocen: boolean;
}) {
  const { data: events, isLoading, error } = useNalogZgodovina(nalog.id);
  // We use the events to determine current state.
  const lastEvent = events?.[events.length - 1];
  const currentState = lastEvent?.tip === "ack" ? "ack" : lastEvent?.tip === "bump" ? "bumped" : "aktivno";

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zgodovina naloga #{nalog.id}</DialogTitle>
          <DialogDescription>
            Pregled dogodkov in akcij za izbrani nalog.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="text-center py-4 text-slate-500">Nalagam zgodovino...</div>
          ) : error ? (
            <div className="text-center py-4 text-red-500">Napaka pri nalaganju zgodovine.</div>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-4 text-slate-500">Ni dogodkov.</div>
          ) : (
            <div className="space-y-4">
              <div className="relative border-l-2 border-slate-200 ml-3 pl-4 space-y-4">
                {events.map((ev, i) => (
                  <div key={ev.id} className="relative">
                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-400 ring-4 ring-white" />
                    <div className="flex flex-col text-sm">
                      <span className="font-semibold capitalize">{ev.tip}</span>
                      <span className="text-slate-500">{formatPosCas(ev.ustvarjeno)}</span>
                      <span className="text-xs text-slate-400 mt-0.5 truncate" title={ev.idempotencyKey}>
                        Ključ: {ev.idempotencyKey}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={onClose}>Zapri</Button>
                {currentState === "aktivno" && (
                  <Button onClick={() => { onBump(nalog); onClose(); }}>
                    Označi kot pripravljeno (Bump)
                  </Button>
                )}
                {canAcknowledgeKdsTicket(currentState, dispatchOmogocen) && (
                  <Button onClick={() => { onAck(nalog); onClose(); }} variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                    Potrdi prevzem (Ack)
                  </Button>
                )}
                {currentState === "bumped" && dispatchOmogocen && (
                  <span className="self-center text-sm font-medium text-amber-700">
                    Pripravljeno — čaka na predajo na zaslonu Izdaja.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------------
// LEGACY IMPLEMENTATION
// --------------------------------------------------------------------------------

function LegacyKitchenView() {
  const gatewayOffline = useGatewayOfflineContext();
  const { data: narocila } = useListAktivnaNarocila();
  const { data: kategorije } = useListKategorije();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0);
  const toggle = useTogglePostavkaPripravljeno();
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
      setTick(t => t + 1);
    }, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [queryClient]);
  if (gatewayOffline.effectiveAuthority === "GATEWAY") {
    const jobs = gatewayOffline.snapshot?.kdsJobs ?? [];
    return (
      <div className="p-6 flex-1 bg-gray-950 text-white">
        <h1 className="text-xl font-semibold">KDS LAN gateway</h1>
        <p className="mt-2 text-sm text-gray-300">
          Gateway jobs: {jobs.length}. Cloud naročila so v tem načinu samo za branje in niso vir KDS podatkov.
        </p>
      </div>
    );
  }

  const hranaIds = new Set((kategorije ?? []).filter(k => k.tip === "hrana").map(k => k.id));

  const odprtaPoStarosti = (narocila?.filter(n => n.status === "odprto") ?? [])
    .map(n => {
      const vsePostavke = n.postavke ?? [];
      const topPostavke = vsePostavke
        .filter(p => p.parentPostavkaId == null
          && p.kategorijaId != null
          && hranaIds.has(p.kategorijaId))
        .sort((a, b) => {
          const aDone = !!a.pripravljeno;
          const bDone = !!b.pripravljeno;
          if (aDone !== bDone) return aDone ? 1 : -1;
          return new Date(a.ustvarjeno).getTime() - new Date(b.ustvarjeno).getTime();
        });
      const childMap = new Map<number, typeof vsePostavke>();
      for (const p of vsePostavke) {
        if (p.parentPostavkaId != null) {
          const arr = childMap.get(p.parentPostavkaId) ?? [];
          arr.push(p);
          childMap.set(p.parentPostavkaId, arr);
        }
      }
      const najstarejsi = topPostavke
        .filter(p => !p.pripravljeno)
        .reduce((min, p) => {
          const t = new Date(p.ustvarjeno).getTime();
          return t < min ? t : min;
        }, Date.now());
      return { ...n, topPostavke, childMap, najstarejsiMs: najstarejsi };
    })
    .filter(n => n.topPostavke.length > 0)
    .sort((a, b) => a.najstarejsiMs - b.najstarejsiMs);
  const odprta = sortKdsNarocila(odprtaPoStarosti);

  function handleToggle(narociloId: number, postavkaId: number, trenutnoPripravljeno: string | null) {
    toggle.mutate({
      id: narociloId,
      postavkaId,
      data: { pripravljeno: !trenutnoPripravljeno, vir: "kuhinja" },
    }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }),
    });
  }

  return (
    <div className="p-4 flex-1 overflow-auto bg-gray-950 text-white flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <UtensilsCrossed className="h-7 w-7 text-orange-400" />
          <h1 className="text-2xl font-bold tracking-tight">Kuhinjski zaslon</h1>
        </div>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          Osveži vsakih 15s
        </div>
      </div>

      <div className="flex gap-4 mb-4 text-xs overflow-x-auto pb-2 shrink-0">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-gray-400">&lt;10 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
          <span className="text-gray-400">10–20 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-gray-400">&gt;20 min</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-gray-400">Pripravljeno</span>
        </div>
      </div>
      {odprta.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-600 gap-4 flex-1">
          <UtensilsCrossed className="h-16 w-16 opacity-30" />
          <p className="text-xl font-medium">Ni odprtih naročil</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {odprta.map(narocilo => {
            const cardMins = Math.floor((Date.now() - narocilo.najstarejsiMs) / 60000);
            const pripravljeno = narocilo.topPostavke.length > 0 && narocilo.topPostavke.every((p) => !!p.pripravljeno);
            const target = getActiveKdsTarget(narocilo, pripravljeno);
            const targetUrgency = target ? getKdsCountdown(target.iso).urgency : null;
            return (
              <Card
                key={narocilo.id}
                data-testid={`kds-narocilo-${narocilo.id}`}
                className={`border-2 transition-all ${targetUrgency ? kdsUrgencyClass(targetUrgency) : cardBorder(cardMins)}`}
              >
                <CardHeader className="pb-2 pt-3 px-4 shrink-0">
                  <CardTitle className="sr-only">Naročilo {narocilo.id}</CardTitle>
                  <KdsNarociloGlava
                    narocilo={narocilo}
                    itemCount={narocilo.topPostavke.length}
                     pripravljeno={pripravljeno}
                  />
                </CardHeader>
                <CardContent className="px-3 pb-3 flex-1 flex flex-col min-h-0">
                  <ul className="space-y-1.5 overflow-y-auto pr-0.5 flex-1">
                    {narocilo.topPostavke.map(p => {
                      const done = !!p.pripravljeno;
                      const mins = minutesSince(p.ustvarjeno);
                      const otroci = narocilo.childMap.get(p.id) ?? [];
                      return (
                        <li
                          key={p.id}
                          onClick={() => handleToggle(narocilo.id, p.id, p.pripravljeno ?? null)}
                          className={`rounded-md px-2.5 py-2 cursor-pointer select-none transition-all active:scale-[0.98] ${
                            done
                              ? "bg-emerald-100 border-l-2 border-l-emerald-500 opacity-75"
                              : itemBg(mins)
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className={`text-sm font-semibold leading-tight ${done ? "line-through text-gray-400" : "text-gray-800"}`}>{p.ime}</span>
                                <span className="text-gray-500 font-bold text-xs shrink-0">×{p.kolicina}</span>
                              </div>
                              {p.opomba && (
                                <span className="text-gray-500 text-xs italic leading-snug block mt-0.5">↳ {p.opomba}</span>
                              )}
                              {otroci.map(d => (
                                <div key={d.id} className="text-orange-700 text-xs font-medium leading-tight mt-0.5">+ {d.ime}</div>
                              ))}
                            </div>
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            ) : (
                              <span className={`flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 tabular-nums ${itemBadge(mins)}`}>
                                <Clock className="h-3 w-3" />
                                {mins}′
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
