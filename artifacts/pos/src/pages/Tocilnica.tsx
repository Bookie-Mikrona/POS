import { useEffect, useRef, useState } from "react";
import { useListAktivnaNarocila, useListKategorije, getListAktivnaNarocilaQueryKey, useTogglePostavkaPripravljeno } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, GlassWater } from "lucide-react";

function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
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

export default function Tocilnica() {
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

  const pijacaIds = new Set((kategorije ?? []).filter(k => k.tip === "pijaca").map(k => k.id));

  const odprta = (narocila?.filter(n => n.status === "odprto") ?? [])
    .map(n => {
      const vsePostavke = n.postavke ?? [];
      const topPostavke = vsePostavke
        .filter(p => p.parentPostavkaId == null && p.kategorijaId != null && pijacaIds.has(p.kategorijaId))
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

  function handleToggle(narociloId: number, postavkaId: number, trenutnoPripravljeno: string | null) {
    toggle.mutate({
      id: narociloId,
      postavkaId,
      data: { pripravljeno: !trenutnoPripravljeno, vir: "tocilnica" },
    }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }),
    });
  }

  return (
    <div className="p-4 flex-1 overflow-auto bg-gray-950 text-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <GlassWater className="h-7 w-7 text-blue-400" />
          <h1 className="text-2xl font-bold tracking-tight">Točilnica</h1>
        </div>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          Osveži vsakih 15s
        </div>
      </div>

      <div className="flex gap-4 mb-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-gray-400">&lt;10 min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
          <span className="text-gray-400">10–20 min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-gray-400">&gt;20 min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-gray-400">Pripravljeno</span>
        </div>
      </div>

      {odprta.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-600 gap-4">
          <GlassWater className="h-16 w-16 opacity-30" />
          <p className="text-xl font-medium">Ni naročil za točilnico</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {odprta.map(narocilo => {
            const cardMins = Math.floor((Date.now() - narocilo.najstarejsiMs) / 60000);
            return (
              <Card key={narocilo.id} className={`border-2 transition-all ${cardBorder(cardMins)}`}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-xl font-black text-gray-900">
                      {narocilo.mizaIme ?? `Miza ${narocilo.mizaStevilka}`}
                    </CardTitle>
                    <span className="text-xs text-gray-500 tabular-nums shrink-0 pt-0.5">
                      {narocilo.topPostavke.length} artik.
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
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
                                <div key={d.id} className="text-blue-700 text-xs font-medium leading-tight mt-0.5">+ {d.ime}</div>
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
