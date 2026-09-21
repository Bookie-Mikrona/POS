import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListKdsIzdaja,
  getListKdsIzdajaQueryKey,
  useIssueKdsNarocilo,
  useGetKdsNastavitve,
  getGetKdsNastavitveQueryKey,
  KdsIzdajaNarocilo,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare, Clock, PackageCheck, AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatPosCas } from "@/lib/posCas";
import { Button } from "@/components/ui/button";

function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function IzdajaPage() {
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const queryClient = useQueryClient();

  const keyNastavitve = enotaId ? [...getGetKdsNastavitveQueryKey(), enotaId] : getGetKdsNastavitveQueryKey();
  const { data: nastavitve, isLoading: loadingNastavitve } = useGetKdsNastavitve({
    query: { queryKey: keyNastavitve, enabled: !!enotaId }
  });

  const keyIzdaja = enotaId ? [...getListKdsIzdajaQueryKey(), enotaId] : getListKdsIzdajaQueryKey();
  const { data: narocila, isLoading: loadingIzdaja, isError, error, refetch } = useListKdsIzdaja({
    query: { queryKey: keyIzdaja, enabled: !!enotaId && !!nastavitve?.dispatchOmogocen }
  });

  const issueMut = useIssueKdsNarocilo();
  const idempotencyKeysRef = useRef<Record<number, string>>({});
  
  // Track mutating states locally for fast UI response
  const [localIssuing, setLocalIssuing] = useState<Record<number, boolean>>({});
  const [localErrors, setLocalErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!nastavitve?.dispatchOmogocen) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: keyIzdaja });
    }, 12000);
    return () => clearInterval(interval);
  }, [queryClient, keyIzdaja, nastavitve?.dispatchOmogocen]);

  // Keep timestamp up-to-date every minute
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  if (loadingNastavitve) {
    return (
      <div className="p-4 flex-1 flex items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <CheckSquare className="h-10 w-10 animate-pulse" />
          <p>Nalagam nastavitve...</p>
        </div>
      </div>
    );
  }

  if (nastavitve && !nastavitve.dispatchOmogocen) {
    return (
      <div className="p-4 flex-1 flex items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4 text-orange-400 bg-orange-950/30 p-8 rounded-2xl border border-orange-900/50 max-w-md text-center">
          <AlertCircle className="h-12 w-12 opacity-80" />
          <h2 className="text-xl font-semibold text-orange-100">Izdajni zaslon je izklopljen</h2>
          <p className="text-orange-200/70 text-sm">
            Za uporabo ekspedita morate v Nastavitvah KDS vklopiti opcijo "Izdajni zaslon (Dispatch)".
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 flex-1 flex flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <div className="flex flex-col items-center gap-4 text-red-400 bg-red-950/30 p-8 rounded-2xl border border-red-900/50">
          <AlertTriangle className="h-12 w-12 opacity-80" />
          <p className="text-lg font-medium text-red-100">Napaka pri pridobivanju naročil</p>
          <p className="text-sm opacity-80">{error instanceof Error ? error.message : "Neznana napaka"}</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4 border-red-800 text-red-200 hover:bg-red-900/50">
            <RefreshCw className="w-4 h-4 mr-2" /> Poskusi znova
          </Button>
        </div>
      </div>
    );
  }

  const handleIssue = (narocilo: KdsIzdajaNarocilo) => {
    if (localIssuing[narocilo.id]) return;
    setLocalErrors(prev => {
      const next = { ...prev };
      delete next[narocilo.id];
      return next;
    });
    
    // Ensure we use the exact same idempotency key for this order if we retry
    if (!idempotencyKeysRef.current[narocilo.id]) {
      idempotencyKeysRef.current[narocilo.id] = crypto.randomUUID();
    }
    const idempotencyKey = idempotencyKeysRef.current[narocilo.id];

    setLocalIssuing(prev => ({ ...prev, [narocilo.id]: true }));

    issueMut.mutate(
      { narociloId: narocilo.id, data: { idempotencyKey } },
      {
        onSuccess: () => {
          // Remove key on success so if this order ID somehow reused, we get a new key
          delete idempotencyKeysRef.current[narocilo.id];
          queryClient.invalidateQueries({ queryKey: keyIzdaja });
          // Optimistically remove from view or just wait for invalidation
          setLocalIssuing(prev => ({ ...prev, [narocilo.id]: false }));
        },
        onError: (mutationError) => {
          setLocalIssuing(prev => ({ ...prev, [narocilo.id]: false }));
          setLocalErrors(prev => ({
            ...prev,
            [narocilo.id]: mutationError instanceof Error
              ? mutationError.message
              : "Predaje ni bilo mogoče potrditi. Poskusite znova.",
          }));
          // Do NOT delete the idempotency key on error
        }
      }
    );
  };

  const activeOrders = narocila ?? [];

  return (
    <div className="p-4 flex-1 overflow-auto bg-slate-950 text-white flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <CheckSquare className="h-7 w-7 text-indigo-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Izdaja <span className="text-slate-500 font-normal ml-2">Ekspedit</span></h1>
        </div>
        <div className="flex items-center gap-2 text-indigo-200/50 text-sm hidden sm:flex">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
          Zadnja osvežitev: {new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute:'2-digit', second:'2-digit' })}
        </div>
      </div>

      {loadingIzdaja && !narocila ? (
        <div className="flex flex-col items-center justify-center py-32 text-indigo-400/50 gap-4 flex-1">
          <CheckSquare className="h-16 w-16 animate-pulse" />
          <p className="text-xl font-medium">Nalagam naročila za izdajo...</p>
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-slate-600 gap-4 flex-1">
          <PackageCheck className="h-20 w-20 opacity-30" />
          <p className="text-2xl font-medium text-slate-500">Ni naročil za izdajo</p>
          <p className="text-slate-600 text-sm">Vsa pripravljena naročila so bila uspešno izdana.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {activeOrders.map(narocilo => {
            const isIssuing = localIssuing[narocilo.id];
            const issueError = localErrors[narocilo.id];
            const mins = minutesSince(narocilo.ustvarjeno);
            const isLate = mins > 15;

            return (
              <Card 
                key={narocilo.id} 
                className={`flex flex-col border-2 relative overflow-hidden transition-all shadow-xl ${
                  isIssuing 
                    ? "opacity-50 scale-[0.98] border-indigo-500/30 bg-slate-900/50" 
                    : isLate 
                      ? "border-orange-500/50 bg-slate-900 shadow-orange-900/10" 
                      : "border-indigo-500/20 bg-slate-900 hover:border-indigo-500/40"
                }`}
              >
                {/* Status indicator strip on top */}
                <div className={`h-1.5 w-full ${isLate ? "bg-orange-500" : "bg-indigo-500"}`} />

                <CardHeader className="pb-3 pt-4 px-4 shrink-0 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black tracking-tight text-white">
                        {narocilo.stevilkaNarocila ? `#${narocilo.stevilkaNarocila}` : "Brez št."}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-bold ${isLate ? "bg-orange-500/20 text-orange-300" : "bg-indigo-500/20 text-indigo-300"}`}>
                      <Clock className="w-3.5 h-3.5" />
                      {mins} min
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    {(narocilo.mizaIme || narocilo.mizaStevilka) && (
                      <div className="flex items-center gap-1 text-slate-300 font-medium">
                        <span className="text-slate-500">Miza:</span>
                        {narocilo.mizaIme || narocilo.mizaStevilka}
                        {narocilo.prostorIme ? ` (${narocilo.prostorIme})` : ''}
                      </div>
                    )}
                    {narocilo.strankaIme && (
                      <div className="flex items-center gap-1 text-slate-300">
                        <span className="text-slate-500">Stranka:</span>
                        <span className="font-semibold text-indigo-200">{narocilo.strankaIme}</span>
                      </div>
                    )}
                    {narocilo.nacin && (
                      <div className="flex items-center gap-1 text-slate-300">
                        <span className="text-slate-500">Način:</span>
                        <span className="uppercase text-xs font-bold tracking-wider">{narocilo.nacin}</span>
                      </div>
                    )}
                  </div>
                  {narocilo.opomba && (
                    <div className="mt-2 text-sm italic text-amber-200/80 bg-amber-500/10 px-2 py-1 rounded">
                      "{narocilo.opomba}"
                    </div>
                  )}
                </CardHeader>
                
                <CardContent className="px-3 py-3 flex-1 flex flex-col justify-between">
                  <ul className="space-y-1.5 mb-4">
                    {narocilo.postavke.map(p => (
                      <li key={p.id} className="flex justify-between items-start gap-2 bg-black/20 px-2.5 py-1.5 rounded-md border border-white/5">
                        <div className="text-sm font-medium text-slate-200 leading-snug">
                          <span className="text-indigo-400 font-bold mr-1.5">{p.kolicina}×</span>
                          {p.ime}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <Button 
                    className={`w-full h-14 text-lg font-bold transition-all shadow-lg active:scale-95 ${
                      isIssuing 
                        ? "bg-slate-700 text-slate-400" 
                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20 hover:shadow-indigo-500/30"
                    }`}
                    onClick={() => handleIssue(narocilo)}
                    disabled={isIssuing}
                  >
                    {isIssuing ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Izdajam...
                      </span>
                    ) : (
                      "IZDAJ NAROČILO"
                    )}
                  </Button>
                  {issueError && (
                    <div role="alert" className="mt-2 rounded-md border border-red-800/70 bg-red-950/50 px-3 py-2 text-sm text-red-200">
                      Predaja ni potrjena. {issueError}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
