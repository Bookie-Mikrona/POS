import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, TrendingUp, Receipt, Banknote, Store, LayoutGrid, Coffee,
  ShieldAlert, XCircle, HelpCircle, CreditCard, LockKeyhole, UnlockKeyhole,
  AlertTriangle, Scale, Truck, Clock3, CheckCircle2, Ban, MapPin, PackageOpen,
  Warehouse, ClipboardList, MonitorCog, Printer, Wifi, WifiOff, UserRound,
  Utensils, Timer, WalletCards
} from "lucide-react";
import { poslovniDatumZaCas } from "@/lib/posCas";
import {
  useGetOperativnaPorocilaPromet,
  getGetOperativnaPorocilaPrometQueryKey,
  useGetOperativnaPorocilaNapake,
  getGetOperativnaPorocilaNapakeQueryKey,
  useGetOperativnaPorocilaZakljucki,
  getGetOperativnaPorocilaZakljuckiQueryKey,
  useGetOperativnaPorocilaDostave,
  getGetOperativnaPorocilaDostaveQueryKey,
  useGetOperativnaPorocilaNormativi,
  getGetOperativnaPorocilaNormativiQueryKey,
  useGetOperativnaPorocilaZaloge,
  getGetOperativnaPorocilaZalogeQueryKey,
  useGetOperativnaPorocilaNaprave,
  getGetOperativnaPorocilaNapraveQueryKey,
  useGetOperativnaPorocilaPriprava,
  getGetOperativnaPorocilaPripravaQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { OperativnaPorocilaQrFeedback } from "./OperativnaPorocilaQrFeedback";

function fmt(n: number) {
  return n.toFixed(2) + " €";
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

function formatDocumentDate(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function formatProvider(provider: string) {
  switch (provider) {
    case 'payten': return 'Payten';
    case 'sumup': return 'SumUp';
    case 'viva_smart': return 'Viva Smart';
    case 'viva_terminal': return 'Viva Terminal';
    default: return provider;
  }
}

function formatPurpose(purpose: string) {
  switch (purpose) {
    case 'receipt': return 'Račun';
    case 'gift_voucher': return 'Darilni bon';
    default: return purpose;
  }
}

function formatDeliveryStatus(status: string) {
  switch (status) {
    case "prejeto": return "Prejeto";
    case "potrjeno": return "Potrjeno";
    case "v_pripravi": return "V pripravi";
    case "pripravljeno": return "Pripravljeno";
    case "prevzel_kurir": return "Prevzel kurir";
    case "dostavljeno": return "Dostavljeno";
    case "preklicano": return "Preklicano";
    default: return status;
  }
}

function formatQuantity(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat("sl-SI", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatPaymentMethod(method: string) {
  switch (method) {
    case "gotovina": return "Gotovina";
    case "kartica": return "Kartica";
    case "bon": return "Darilni bon";
    case "bon_pica": return "Študentski bon";
    case "negotovinsko": return "Negotovinsko";
    case "reprezentanca": return "Reprezentanca";
    case "lastna_poraba": return "Lastna poraba";
    default: return method;
  }
}

export default function OperativnaPorocila() {
  const queryClient = useQueryClient();
  const defaultDate = poslovniDatumZaCas();
  
  const [odInput, setOdInput] = useState(defaultDate);
  const [doInput, setDoInput] = useState(defaultDate);

  const [queryParams, setQueryParams] = useState({ od: defaultDate, do: defaultDate });

  const {
    data: prometData,
    isLoading: isLoadingPromet,
    isError: isErrorPromet,
    error: errorPromet,
    isFetching: isFetchingPromet
  } = useGetOperativnaPorocilaPromet(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaPrometQueryKey(queryParams),
    }
  });

  const {
    data: napakeData,
    isLoading: isLoadingNapake,
    isError: isErrorNapake,
    error: errorNapake,
    isFetching: isFetchingNapake
  } = useGetOperativnaPorocilaNapake(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaNapakeQueryKey(queryParams),
    }
  });

  const {
    data: zakljuckiData,
    isLoading: isLoadingZakljucki,
    isError: isErrorZakljucki,
    error: errorZakljucki,
    isFetching: isFetchingZakljucki
  } = useGetOperativnaPorocilaZakljucki(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaZakljuckiQueryKey(queryParams),
    }
  });

  const {
    data: dostaveData,
    isLoading: isLoadingDostave,
    isError: isErrorDostave,
    error: errorDostave,
    isFetching: isFetchingDostave
  } = useGetOperativnaPorocilaDostave(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaDostaveQueryKey(queryParams),
    }
  });

  const {
    data: normativiData,
    isLoading: isLoadingNormativi,
    isError: isErrorNormativi,
    error: errorNormativi,
    isFetching: isFetchingNormativi
  } = useGetOperativnaPorocilaNormativi(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaNormativiQueryKey(queryParams),
    }
  });

  const {
    data: zalogeData,
    isLoading: isLoadingZaloge,
    isError: isErrorZaloge,
    error: errorZaloge,
    isFetching: isFetchingZaloge
  } = useGetOperativnaPorocilaZaloge(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaZalogeQueryKey(queryParams),
    }
  });

  const {
    data: napraveData,
    isLoading: isLoadingNaprave,
    isError: isErrorNaprave,
    error: errorNaprave,
    isFetching: isFetchingNaprave
  } = useGetOperativnaPorocilaNaprave(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaNapraveQueryKey(queryParams),
    }
  });

  const {
    data: pripravaData,
    isLoading: isLoadingPriprava,
    isError: isErrorPriprava,
    error: errorPriprava,
    isFetching: isFetchingPriprava
  } = useGetOperativnaPorocilaPriprava(queryParams, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaPripravaQueryKey(queryParams),
    }
  });

  const handleSearch = () => {
    setQueryParams({ od: odInput, do: doInput });
  };

  const handleRefresh = () => {
    if (queryParams.od === odInput && queryParams.do === doInput) {
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaPrometQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaNapakeQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaZakljuckiQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaDostaveQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaNormativiQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaZalogeQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaNapraveQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: getGetOperativnaPorocilaPripravaQueryKey(queryParams) });
      queryClient.invalidateQueries({ queryKey: ["/api/operativna-porocila/qr-feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operativna-porocila/qr-feedback/comments"] });
    } else {
      handleSearch();
    }
  };

  const loading = isLoadingPromet || isLoadingNapake || isLoadingZakljucki || isLoadingDostave
    || isLoadingNormativi || isFetchingPromet || isFetchingNapake || isFetchingZakljucki
    || isLoadingZaloge || isLoadingNaprave || isFetchingDostave || isFetchingNormativi
    || isLoadingPriprava || isFetchingZaloge || isFetchingNaprave || isFetchingPriprava;
  const hasData = prometData && napakeData && zakljuckiData && dostaveData && normativiData
    && zalogeData && napraveData && pripravaData;
  const hasError = isErrorPromet || isErrorNapake || isErrorZakljucki || isErrorDostave
    || isErrorNormativi || isErrorZaloge || isErrorNaprave || isErrorPriprava;
  const hasNapake = napakeData && (napakeData.karticna.skupaj > 0 || napakeData.furs.skupaj > 0);

  return (
    <div className="p-6 md:p-8 space-y-6 flex-1 overflow-auto bg-muted/10 min-h-full">
      {/* Glava */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Operativna poročila
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Skupni pregled operativnega prometa po poslovni enoti, kategoriji in mizi.
          </p>
        </div>
        
        <div className="flex items-end gap-3 bg-background border p-1.5 rounded-xl shadow-sm">
          <div className="px-1.5">
            <Label htmlFor="od-datum" className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">Od datuma</Label>
            <Input
              id="od-datum"
              type="date"
              value={odInput}
              max={doInput || defaultDate}
              onChange={e => setOdInput(e.target.value)}
              className="h-8 text-sm w-36 bg-transparent border-0 shadow-none focus-visible:ring-0 p-0 px-1"
            />
          </div>
          <div className="w-px h-8 bg-border shrink-0 self-center opacity-50" />
          <div className="px-1.5">
            <Label htmlFor="do-datum" className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block font-semibold">Do datuma</Label>
            <Input
              id="do-datum"
              type="date"
              value={doInput}
              min={odInput}
              max={defaultDate}
              onChange={e => setDoInput(e.target.value)}
              className="h-8 text-sm w-36 bg-transparent border-0 shadow-none focus-visible:ring-0 p-0 px-1"
            />
          </div>
          <Button onClick={handleRefresh} disabled={loading} size="sm" className="ml-1 h-9 rounded-lg px-4 font-medium">
            Prikaži
          </Button>
        </div>
      </div>

      {hasError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm flex items-center gap-3">
          <Activity className="h-5 w-5" />
          <span>Napaka pri nalaganju operativnih poročil: {(errorPromet || errorNapake || errorZakljucki || errorDostave || errorNormativi || errorZaloge || errorNaprave || errorPriprava)?.message || "Neznana napaka"}</span>
        </div>
      )}

      {loading && !hasData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[300px] rounded-xl" />
          </div>
        </div>
      )}

      {!loading && hasData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

          {hasNapake && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {napakeData.karticna.skupaj > 0 && (
                <Card className="border-orange-500/30 shadow-sm bg-orange-500/5 overflow-hidden">
                  <CardHeader className="bg-orange-500/10 border-b border-orange-500/20 pb-4 pt-5">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 text-orange-700 dark:text-orange-400">
                        <CreditCard className="h-5 w-5" />
                        Težave pri kartičnih plačilih
                      </CardTitle>
                      <div className="flex gap-3 text-xs font-semibold">
                        {napakeData.karticna.neuspesne > 0 && (
                          <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3.5 w-3.5" />
                            {napakeData.karticna.neuspesne} neuspešnih
                          </div>
                        )}
                        {napakeData.karticna.nejasne > 0 && (
                          <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                            <HelpCircle className="h-3.5 w-3.5" />
                            {napakeData.karticna.nejasne} nejasnih
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[300px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-orange-50 dark:bg-orange-950/20 backdrop-blur shadow-[0_1px_0_rgba(249,115,22,0.2)] z-10">
                          <tr className="text-[11px] text-orange-700/70 dark:text-orange-400/70 uppercase tracking-wider">
                            <th className="text-left py-2 px-4 font-semibold">Čas</th>
                            <th className="text-left py-2 px-4 font-semibold">Enota / Ponudnik</th>
                            <th className="text-left py-2 px-4 font-semibold">Status / Napaka</th>
                            <th className="text-right py-2 px-4 font-semibold">Znesek</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-500/10">
                          {napakeData.karticna.zapisi.map(z => (
                            <tr key={z.id} className="hover:bg-orange-500/10 transition-colors group">
                              <td className="py-2.5 px-4 tabular-nums text-xs whitespace-nowrap">
                                {formatDateTime(z.cas)}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-foreground">{z.enota}</div>
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <span>{formatProvider(z.provider)}</span>
                                  <span className="text-muted-foreground/40">•</span>
                                  <span>{formatPurpose(z.purpose)}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-1.5 font-medium">
                                  {z.status === 'failed' ? (
                                    <span className="text-red-600 dark:text-red-400 flex items-center gap-1 text-xs">
                                      <XCircle className="h-3 w-3" /> Neuspešno
                                    </span>
                                  ) : (
                                    <span className="text-orange-600 dark:text-orange-400 flex items-center gap-1 text-xs font-bold">
                                      <HelpCircle className="h-3 w-3" /> Nejasno (preveri)
                                    </span>
                                  )}
                                </div>
                                {z.napaka && (
                                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-[200px]" title={z.napaka}>
                                    {z.napaka}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-foreground">
                                {fmt(z.znesek)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {napakeData.furs.skupaj > 0 && (
                <Card className="border-red-500/30 shadow-sm bg-red-500/5 overflow-hidden">
                  <CardHeader className="bg-red-500/10 border-b border-red-500/20 pb-4 pt-5">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
                        <ShieldAlert className="h-5 w-5" />
                        Težave pri davčnem potrjevanju (FURS)
                      </CardTitle>
                      <div className="flex gap-3 text-xs font-semibold">
                        {napakeData.furs.neuspesne > 0 && (
                          <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3.5 w-3.5" />
                            {napakeData.furs.neuspesne} neuspešnih
                          </div>
                        )}
                        {napakeData.furs.nejasne > 0 && (
                          <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                            <HelpCircle className="h-3.5 w-3.5" />
                            {napakeData.furs.nejasne} nejasnih
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[300px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-red-50 dark:bg-red-950/20 backdrop-blur shadow-[0_1px_0_rgba(239,68,68,0.2)] z-10">
                          <tr className="text-[11px] text-red-700/70 dark:text-red-400/70 uppercase tracking-wider">
                            <th className="text-left py-2 px-4 font-semibold">Čas</th>
                            <th className="text-left py-2 px-4 font-semibold">Enota / Račun</th>
                            <th className="text-left py-2 px-4 font-semibold">Status / Napaka</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-500/10">
                          {napakeData.furs.zapisi.map(z => (
                            <tr key={z.id} className="hover:bg-red-500/10 transition-colors group">
                              <td className="py-2.5 px-4 tabular-nums text-xs whitespace-nowrap">
                                {formatDateTime(z.cas)}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-foreground">{z.enota}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {z.stevilkaRacuna ? `Račun: ${z.stevilkaRacuna}` : `ID računa: ${z.racunId}`}
                                </div>
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-1.5 font-medium">
                                  {z.outcome === 'failed' ? (
                                    <span className="text-red-600 dark:text-red-400 flex items-center gap-1 text-xs">
                                      <XCircle className="h-3 w-3" /> Neuspešno
                                    </span>
                                  ) : (
                                    <span className="text-orange-600 dark:text-orange-400 flex items-center gap-1 text-xs font-bold">
                                      <HelpCircle className="h-3 w-3" /> Nejasno (preveri)
                                    </span>
                                  )}
                                </div>
                                {z.napaka && (
                                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-[250px]" title={z.napaka}>
                                    {z.napaka}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4 text-emerald-600" />
                  Zaključki blagajn
                </CardTitle>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {zakljuckiData.zaklenjene} zaklenjenih
                  </span>
                  {zakljuckiData.blokirane > 0 && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      {zakljuckiData.blokirane} blokiranih
                    </span>
                  )}
                  {zakljuckiData.odklenjene > 0 && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                      {zakljuckiData.odklenjene} odklenjenih
                    </span>
                  )}
                  {zakljuckiData.odstopanjaGotovine > 0 && (
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                      {zakljuckiData.odstopanjaGotovine} odstopanj
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[430px] overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 text-left font-semibold">Poslovni dan</th>
                      <th className="px-5 py-3 text-left font-semibold">Enota / blagajna</th>
                      <th className="px-5 py-3 text-left font-semibold">Zaključek</th>
                      <th className="px-5 py-3 text-left font-semibold">Gotovina</th>
                      <th className="px-5 py-3 text-left font-semibold">Blokade in opozorila</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {zakljuckiData.zakljucki.map(z => (
                      <tr key={`${z.enotaId}-${z.blagajnaId}-${z.poslovniDatum}`} className="align-top transition-colors hover:bg-muted/30">
                        <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums">
                          {new Intl.DateTimeFormat("sl-SI").format(new Date(`${z.poslovniDatum}T12:00:00Z`))}
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{z.enota}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{z.blagajna}</div>
                        </td>
                        <td className="px-5 py-3">
                          {z.status === "zaklenjeno" && (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                <LockKeyhole className="h-3 w-3" /> Zaklenjeno
                              </span>
                              <div className="mt-1 text-xs text-muted-foreground">Z-{z.zStevilka}</div>
                            </div>
                          )}
                          {z.status === "blokirano" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                              <AlertTriangle className="h-3 w-3" /> Blokirano
                            </span>
                          )}
                          {z.status === "odklenjeno" && (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                                <UnlockKeyhole className="h-3 w-3" /> Odklenjeno
                              </span>
                              <div className="mt-1 text-xs text-muted-foreground">Z-{z.zStevilka} je treba ponovno zaključiti</div>
                            </div>
                          )}
                          {z.status === "ni_zakljuceno" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              <HelpCircle className="h-3 w-3" /> Ni zaključeno
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {z.cashStatus === "manjka_uskladitev" ? (
                            <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                              <Scale className="h-3.5 w-3.5" /> Uskladitev manjka
                            </div>
                          ) : z.cashStatus === "odstopanje" ? (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                                <Scale className="h-3.5 w-3.5" />
                                Razlika {fmt(z.razlikaGotovine ?? 0)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {fmt(z.prestetaGotovina ?? 0)} / pričakovano {fmt(z.pricakovanaGotovina ?? 0)}
                              </div>
                              {z.razlogOdstopanja && <div className="mt-1 text-xs text-muted-foreground">{z.razlogOdstopanja}</div>}
                            </div>
                          ) : (
                            <div>
                              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Usklajeno</div>
                              <div className="mt-1 text-xs text-muted-foreground">{fmt(z.prestetaGotovina ?? 0)}</div>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {z.blokade.length > 0 ? (
                            <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">
                              {z.blokade.map(blokada => (
                                <li key={blokada.type} title={blokada.items.map(item => item.label).join(", ")}>
                                  {blokada.message}
                                </li>
                              ))}
                            </ul>
                          ) : z.cashStatus === "manjka_uskladitev" ? (
                            <span className="text-xs text-red-700 dark:text-red-300">Pred zaključkom je treba potrditi stanje gotovine.</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Brez operativnih blokad</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {zakljuckiData.zakljucki.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Za izbrano obdobje ni aktivnih blagajn.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600" />
                  Dostave in zamude
                </CardTitle>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                    {dostaveData.aktivne} aktivnih
                  </span>
                  {dostaveData.zamujene > 0 && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      {dostaveData.zamujene} zamujenih
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {dostaveData.dostavljene} dostavljenih
                  </span>
                  {dostaveData.preklicane > 0 && (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {dostaveData.preklicane} preklicanih
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[430px] overflow-auto">
                <table className="w-full min-w-[940px] text-sm">
                  <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 text-left font-semibold">Prejeto</th>
                      <th className="px-5 py-3 text-left font-semibold">Enota / naročilo</th>
                      <th className="px-5 py-3 text-left font-semibold">Stranka / naslov</th>
                      <th className="px-5 py-3 text-left font-semibold">Predvidena dostava</th>
                      <th className="px-5 py-3 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {dostaveData.dostave.map(dostava => (
                      <tr key={dostava.id} className="align-top transition-colors hover:bg-muted/30">
                        <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums">
                          {formatDateTime(dostava.ustvarjeno)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{dostava.enota}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Naročilo #{dostava.stevilkaNarocila ?? dostava.id}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{dostava.strankaIme || "Brez imena"}</div>
                          {dostava.naslov && (
                            <div className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>{dostava.naslov}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {dostava.predvidenaDostava ? (
                            <div className={dostava.zamujeno ? "font-semibold text-red-600 dark:text-red-400" : "text-foreground"}>
                              {formatDateTime(dostava.predvidenaDostava)}
                              {dostava.zamujeno && (
                                <div className="mt-1 flex items-center gap-1 text-xs">
                                  <Clock3 className="h-3 w-3" /> Zamuda
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Rok ni določen</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {dostava.dostavaStatus === "dostavljeno" ? (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                <CheckCircle2 className="h-3 w-3" /> Dostavljeno
                              </span>
                              {dostava.dostavljenoOb && <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(dostava.dostavljenoOb)}</div>}
                            </div>
                          ) : dostava.dostavaStatus === "preklicano" ? (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                <Ban className="h-3 w-3" /> Preklicano
                              </span>
                              {dostava.preklicanoOb && <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(dostava.preklicanoOb)}</div>}
                            </div>
                          ) : (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              dostava.zamujeno
                                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                            }`}>
                              <Truck className="h-3 w-3" /> {formatDeliveryStatus(dostava.dostavaStatus)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dostaveData.dostave.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Za izbrano obdobje ni evidentiranih dostav.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <PackageOpen className="h-4 w-4 text-amber-600" />
                    Normativna poraba
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Knjižena poraba vhodnih artiklov iz zaključenih prodaj in priprave.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {fmt(normativiData.skupajVrednost)} porabe
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {normativiData.skupajGibov} gibov
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {normativiData.poEnotah.length > 1 && (
                <div className="flex flex-wrap gap-2 border-b border-border/40 bg-muted/10 px-5 py-3">
                  {normativiData.poEnotah.map(enota => (
                    <div key={enota.enotaId} className="rounded-lg border bg-background px-3 py-2 text-xs">
                      <span className="font-medium">{enota.enota}</span>
                      <span className="ml-2 font-semibold tabular-nums">{fmt(enota.vrednost)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="max-h-[430px] overflow-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 text-left font-semibold">Vhodni artikel</th>
                      <th className="px-5 py-3 text-left font-semibold">Enota</th>
                      <th className="px-5 py-3 text-right font-semibold">Porabljena količina</th>
                      <th className="px-5 py-3 text-right font-semibold">Gibov</th>
                      <th className="px-5 py-3 text-right font-semibold">Vrednost porabe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {normativiData.artikli.map(artikel => (
                      <tr key={`${artikel.enotaId}-${artikel.artikelId}`} className="transition-colors hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{artikel.artikel}</td>
                        <td className="px-5 py-3 text-muted-foreground">{artikel.enota}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatQuantity(artikel.kolicina, artikel.enotaMere)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{artikel.steviloGibov}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(artikel.vrednost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {normativiData.artikli.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Za izbrano obdobje ni knjižene normativne porabe.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-cyan-600" />
                    Zaloge in inventurna odstopanja
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trenutna kritična stanja, inventurne razlike in potrjeni odpisi v izbranem obdobju.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">
                    {fmt(zalogeData.skupajVrednost)} zaloge
                  </span>
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                    {zalogeData.kriticne} negativnih
                  </span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {zalogeData.prazne} praznih
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {zalogeData.inventurnaOdstopanja} inventurnih razlik · {fmt(zalogeData.inventurnaVrednost)}
                  </span>
                  <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                    {zalogeData.steviloOdpisov} odpisov · {fmt(zalogeData.vrednostOdpisov)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-1 divide-y divide-border/50 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                <div>
                  <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Kritična trenutna stanja
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    {zalogeData.zaloge.some((artikel) => artikel.status !== "v_redu") ? (
                      <table className="w-full min-w-[500px] text-sm">
                        <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-5 py-3 text-left font-semibold">Artikel</th>
                            <th className="px-5 py-3 text-left font-semibold">Enota</th>
                            <th className="px-5 py-3 text-right font-semibold">Stanje</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {zalogeData.zaloge.filter((artikel) => artikel.status !== "v_redu").map((artikel) => (
                            <tr key={`${artikel.enotaId}-${artikel.artikelId}`} className="hover:bg-muted/30">
                              <td className="px-5 py-3 font-medium">{artikel.artikel}</td>
                              <td className="px-5 py-3 text-muted-foreground">{artikel.enota}</td>
                              <td className={`px-5 py-3 text-right font-semibold tabular-nums ${
                                artikel.status === "kriticna" ? "text-red-600" : "text-amber-600"
                              }`}>
                                {formatQuantity(artikel.kolicina, artikel.enotaMere)}
                                <span className="ml-2 text-[10px] uppercase">
                                  {artikel.status === "kriticna" ? "Negativno" : "Prazno"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        Ni negativnih ali praznih nabavnih artiklov.
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" />
                    Inventurna odstopanja
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    {zalogeData.odstopanja.length > 0 ? (
                      <table className="w-full min-w-[600px] text-sm">
                        <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-5 py-3 text-left font-semibold">Inventura</th>
                            <th className="px-5 py-3 text-left font-semibold">Artikel</th>
                            <th className="px-5 py-3 text-right font-semibold">Razlika</th>
                            <th className="px-5 py-3 text-right font-semibold">Vrednost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {zalogeData.odstopanja.map((odstopanje) => (
                            <tr key={odstopanje.id} className="hover:bg-muted/30">
                              <td className="px-5 py-3">
                                <div className="font-medium">{odstopanje.inventuraStevilka || `#${odstopanje.inventuraId}`}</div>
                                <div className="text-xs text-muted-foreground">{formatDocumentDate(odstopanje.datum)} · {odstopanje.enota}</div>
                              </td>
                              <td className="px-5 py-3 font-medium">{odstopanje.artikel}</td>
                              <td className={`px-5 py-3 text-right font-semibold tabular-nums ${
                                odstopanje.razlika < 0 ? "text-red-600" : "text-emerald-600"
                              }`}>
                                {odstopanje.razlika > 0 ? "+" : ""}{formatQuantity(odstopanje.razlika, odstopanje.enotaMere)}
                              </td>
                              <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(odstopanje.vrednost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        V izbranem obdobju ni inventurnih odstopanj.
                      </div>
                    )}
                  </div>
                </div>
                <div className="border-t border-border/50 xl:col-span-2">
                  <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <PackageOpen className="h-3.5 w-3.5" />
                    Potrjeni odpisi pripravljene hrane
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    {zalogeData.odpisi.length > 0 ? (
                      <table className="w-full min-w-[820px] text-sm">
                        <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-5 py-3 text-left font-semibold">Zapisnik</th>
                            <th className="px-5 py-3 text-left font-semibold">Artikel</th>
                            <th className="px-5 py-3 text-left font-semibold">Razlog</th>
                            <th className="px-5 py-3 text-right font-semibold">Količina</th>
                            <th className="px-5 py-3 text-right font-semibold">Vrednost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {zalogeData.odpisi.map((odpis) => (
                            <tr key={odpis.id} className="hover:bg-muted/30">
                              <td className="px-5 py-3">
                                <div className="font-medium">#{odpis.stevilkaZapisnika}</div>
                                <div className="text-xs text-muted-foreground">{formatDocumentDate(odpis.datum)} · {odpis.enota}</div>
                              </td>
                              <td className="px-5 py-3 font-medium">{odpis.artikel}</td>
                              <td className="max-w-[360px] px-5 py-3 text-muted-foreground">{odpis.razlog}</td>
                              <td className="px-5 py-3 text-right font-semibold tabular-nums">
                                {formatQuantity(odpis.kolicina, odpis.enotaMere)}
                              </td>
                              <td className="px-5 py-3 text-right font-semibold tabular-nums text-rose-600">{fmt(odpis.vrednost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        V izbranem obdobju ni potrjenih odpisov pripravljene hrane.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Timer className="h-4 w-4 text-fuchsia-600" />
                    Čas priprave po kuhinji in točilnici
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Dejanski čas od nastanka KDS naloga do zaključka na posamezni pripravljalni postaji.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-fuchsia-100 px-2.5 py-1 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-300">
                    {pripravaData.povprecjeMinut == null ? "Brez zaključenih nalogov" : `${pripravaData.povprecjeMinut.toFixed(1)} min povprečno`}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {pripravaData.zakljucenihNalogov}/{pripravaData.skupajNalogov} zaključenih
                  </span>
                  {pripravaData.aktivnihNalogov > 0 && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                      {pripravaData.aktivnihNalogov} aktivnih
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {pripravaData.poPostajah.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/10 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-3 text-left font-semibold">Postaja</th>
                        <th className="px-5 py-3 text-right font-semibold">Nalogov</th>
                        <th className="px-5 py-3 text-right font-semibold">Aktivnih</th>
                        <th className="px-5 py-3 text-right font-semibold">Povprečje</th>
                        <th className="px-5 py-3 text-right font-semibold">Najhitreje</th>
                        <th className="px-5 py-3 text-right font-semibold">Najdlje</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {pripravaData.poPostajah.map(postaja => (
                        <tr key={`${postaja.enotaId}-${postaja.postajaId}`} className="hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="font-medium">{postaja.postaja}</div>
                            <div className="text-xs text-muted-foreground">{postaja.enota}</div>
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">{postaja.zakljucenihNalogov}/{postaja.skupajNalogov}</td>
                          <td className={`px-5 py-3 text-right tabular-nums ${postaja.aktivnihNalogov > 0 ? "font-semibold text-amber-600" : "text-muted-foreground"}`}>
                            {postaja.aktivnihNalogov}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums">
                            {postaja.povprecjeMinut == null ? "—" : `${postaja.povprecjeMinut.toFixed(1)} min`}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {postaja.najkrajsiCasMinut == null ? "—" : `${postaja.najkrajsiCasMinut.toFixed(1)} min`}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {postaja.najdaljsiCasMinut == null ? "—" : `${postaja.najdaljsiCasMinut.toFixed(1)} min`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  V dovoljenih enotah ni aktivnih KDS postaj.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <MonitorCog className="h-4 w-4 text-violet-600" />
                    POS naprave
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Konfiguracija terminalov, dosegljivost tiskalniških agentov in neuspešne naloge.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {napraveData.vRedu} brez težav
                  </span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {napraveData.opozorila} opozoril
                  </span>
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                    {napraveData.napake} napak
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[460px] overflow-auto">
                {napraveData.naprave.length > 0 ? (
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                      <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-3 text-left font-semibold">Naprava</th>
                        <th className="px-5 py-3 text-left font-semibold">Stanje</th>
                        <th className="px-5 py-3 text-left font-semibold">Plačilni terminal</th>
                        <th className="px-5 py-3 text-left font-semibold">Tiskalnik</th>
                        <th className="px-5 py-3 text-right font-semibold">Naloge</th>
                        <th className="px-5 py-3 text-left font-semibold">Opozorila</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {napraveData.naprave.map((naprava) => (
                        <tr key={naprava.id} className="align-top hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="font-medium">{naprava.ime}</div>
                            <div className="text-xs text-muted-foreground">{naprava.enota}</div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              naprava.status === "v_redu"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : naprava.status === "opozorilo"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                            }`}>
                              {naprava.status === "v_redu" ? "V redu" : naprava.status === "opozorilo" ? "Preveri" : "Napaka"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-semibold ${
                              naprava.konfiguracija.terminal === "nepopoln"
                                ? "text-red-600"
                                : naprava.konfiguracija.terminal === "aktiven"
                                  ? "text-emerald-600"
                                  : "text-muted-foreground"
                            }`}>
                              {naprava.konfiguracija.terminal === "nepopoln"
                                ? "Nepopolno"
                                : naprava.konfiguracija.terminal === "aktiven"
                                  ? "Aktiven"
                                  : "Ni aktiven"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              {naprava.tiskalnik.status === "dosegljiv"
                                ? <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                                : naprava.tiskalnik.status === "ni_dosegljiv"
                                  ? <WifiOff className="h-3.5 w-3.5 text-red-600" />
                                  : <Printer className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-medium">
                                {naprava.tiskalnik.ime || (
                                  naprava.konfiguracija.tiskalnik === "ni_nastavljen" ? "Ni nastavljen" : "Vgrajeni tiskalnik"
                                )}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {naprava.tiskalnik.status === "dosegljiv" && naprava.tiskalnik.zadnjiSignal
                                ? `Dosegljiv · ${formatDateTime(naprava.tiskalnik.zadnjiSignal)}`
                                : naprava.tiskalnik.status === "ni_dosegljiv" && naprava.tiskalnik.zadnjiSignal
                                  ? `Ni dosegljiv · zadnji signal ${formatDateTime(naprava.tiskalnik.zadnjiSignal)}`
                                  : naprava.tiskalnik.status === "ni_potrditve"
                                    ? "Dosegljivost ni potrjena"
                                    : "Brez tiskalniške konfiguracije"}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-xs tabular-nums">
                            <div className={naprava.tiskalnik.neuspesneNaloge > 0 ? "font-semibold text-red-600" : "text-muted-foreground"}>
                              {naprava.tiskalnik.neuspesneNaloge} neuspešnih
                            </div>
                            <div className={naprava.tiskalnik.cakajoceNaloge > 0 ? "font-semibold text-amber-600" : "text-muted-foreground"}>
                              {naprava.tiskalnik.cakajoceNaloge} čakajočih
                            </div>
                          </td>
                          <td className="max-w-[340px] px-5 py-3">
                            {naprava.opozorila.length > 0 ? (
                              <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">
                                {naprava.opozorila.map((opozorilo, index) => (
                                  <li key={`${naprava.id}-${index}`}>{opozorilo}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-xs text-muted-foreground">Brez zaznanih težav</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    V dovoljenih poslovnih enotah ni registriranih POS naprav.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Utensils className="h-4 w-4 text-orange-600" />
                Promet po artiklih
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 text-left font-semibold">Artikel</th>
                      <th className="px-5 py-3 text-left font-semibold">Enota</th>
                      <th className="px-5 py-3 text-right font-semibold">Količina</th>
                      <th className="px-5 py-3 text-right font-semibold">Računov</th>
                      <th className="px-5 py-3 text-right font-semibold">Skupaj</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {prometData.prometPoArtiklih.map(artikel => (
                      <tr key={`${artikel.enotaId}-${artikel.artikelId ?? "snapshot"}-${artikel.artikel}`} className="hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{artikel.artikel}</td>
                        <td className="px-5 py-3 text-muted-foreground">{artikel.enota}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{artikel.kolicina.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{artikel.steviloRacunov}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(artikel.skupaj)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {prometData.prometPoArtiklih.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">V obdobju ni prodanih artiklov.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="shadow-sm border-border/60 overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-blue-600" />
                  Promet in napitnine po zaposlenem
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                      <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-3 text-left font-semibold">Zaposleni</th>
                        <th className="px-5 py-3 text-right font-semibold">Računov</th>
                        <th className="px-5 py-3 text-right font-semibold">Napitnine</th>
                        <th className="px-5 py-3 text-right font-semibold">Promet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {prometData.prometPoNatakarjih.map(natakar => (
                        <tr key={`${natakar.enotaId}-${natakar.natakarId ?? natakar.natakar}`} className="hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="font-medium">{natakar.natakar}</div>
                            <div className="text-xs text-muted-foreground">{natakar.enota}</div>
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{natakar.steviloRacunov}</td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-emerald-600">{fmt(natakar.napitnina)}</td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(natakar.skupaj)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/60 overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <WalletCards className="h-4 w-4 text-emerald-600" />
                  Promet po načinu plačila
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
                      <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-3 text-left font-semibold">Način</th>
                        <th className="px-5 py-3 text-right font-semibold">Računov</th>
                        <th className="px-5 py-3 text-right font-semibold">Skupaj</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {prometData.prometPoNacinihPlacila.map(placilo => (
                        <tr key={placilo.nacin} className="hover:bg-muted/30">
                          <td className="px-5 py-3 font-medium">{formatPaymentMethod(placilo.nacin)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{placilo.steviloRacunov}</td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(placilo.skupaj)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Skupni KPI-ji */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-none shadow-sm bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Skupaj promet
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="text-3xl font-bold tabular-nums tracking-tight">{fmt(prometData.skupajPromet)}</div>
              </CardContent>
            </Card>
            
            <Card className="border-none shadow-sm bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" /> Skupaj DDV
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="text-3xl font-bold tabular-nums tracking-tight text-muted-foreground">{fmt(prometData.skupajDdv)}</div>
              </CardContent>
            </Card>
            
            <Card className="border-none shadow-sm bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5" /> Število računov
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="text-3xl font-bold tabular-nums tracking-tight">{prometData.steviloRacunov}</div>
              </CardContent>
            </Card>
          </div>

          {prometData.steviloRacunov === 0 ? (
            <div className="rounded-2xl border border-dashed bg-background/50 p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Receipt className="h-6 w-6 opacity-40" />
              </div>
              <p className="font-medium text-base text-foreground/70">Za izbrano obdobje ni izdanih računov.</p>
              <p className="text-sm mt-1">Spremenite datume in poskusite ponovno.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2.2fr)_minmax(320px,0.8fr)]">
              
              {/* Promet po kategorijah */}
              <Card className="shadow-sm border-border/60">
                <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Coffee className="h-4 w-4 text-orange-500" />
                    Po kategorijah
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[500px]">
                      <thead>
                        <tr className="text-[11px] text-muted-foreground uppercase tracking-wider border-b bg-muted/10">
                          <th className="text-left py-3 px-5 font-semibold">Kategorija</th>
                          <th className="text-right py-3 px-5 font-semibold">Količina</th>
                          <th className="text-right py-3 px-5 font-semibold">Računov</th>
                          <th className="text-right py-3 px-5 font-semibold">Skupaj</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {prometData.prometPoKategorijah.map(k => (
                          <tr key={k.kategorijaId ?? 'neznano'} className="hover:bg-muted/30 transition-colors group">
                            <td className="py-3 px-5 font-medium">{k.kategorija || "Brez kategorije"}</td>
                            <td className="py-3 px-5 text-right tabular-nums text-muted-foreground">{k.kolicina.toFixed(2)}</td>
                            <td className="py-3 px-5 text-right tabular-nums text-muted-foreground">{k.steviloRacunov}</td>
                            <td className="py-3 px-5 text-right tabular-nums font-semibold group-hover:text-primary transition-colors">{fmt(k.skupaj)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                {/* Promet po enotah */}
                <Card className="shadow-sm border-border/60">
                  <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Store className="h-4 w-4 text-blue-500" />
                      Po poslovnih enotah
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] text-muted-foreground uppercase tracking-wider border-b bg-muted/10">
                            <th className="text-left py-3 px-5 font-semibold">Enota</th>
                            <th className="text-right py-3 px-5 font-semibold">Računov</th>
                            <th className="text-right py-3 px-5 font-semibold">Skupaj</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {prometData.prometPoEnotah.map(e => (
                            <tr key={e.enotaId} className="hover:bg-muted/30 transition-colors group">
                              <td className="py-3 px-5 font-medium">{e.enota}</td>
                              <td className="py-3 px-5 text-right tabular-nums text-muted-foreground">{e.steviloRacunov}</td>
                              <td className="py-3 px-5 text-right tabular-nums font-semibold group-hover:text-primary transition-colors">{fmt(e.skupaj)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Promet po prostorih */}
                <Card className="shadow-sm border-border/60">
                  <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-violet-500" />
                      Po prostorih
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] text-muted-foreground uppercase tracking-wider border-b bg-muted/10">
                            <th className="text-left py-3 px-5 font-semibold">Prostor</th>
                            <th className="text-right py-3 px-5 font-semibold">Računov</th>
                            <th className="text-right py-3 px-5 font-semibold">Skupaj</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {prometData.prometPoProstorih.map(p => (
                            <tr key={`${p.enotaId}-${p.prostorId ?? "brez-prostora"}`} className="hover:bg-muted/30 transition-colors group">
                              <td className="py-3 px-5">
                                <div className="font-medium">{p.prostor}</div>
                                {prometData.prometPoEnotah.length > 1 && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5">{p.enota}</div>
                                )}
                              </td>
                              <td className="py-3 px-5 text-right tabular-nums text-muted-foreground">{p.steviloRacunov}</td>
                              <td className="py-3 px-5 text-right tabular-nums font-semibold group-hover:text-primary transition-colors">{fmt(p.skupaj)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {prometData.prometPoProstorih.length === 0 && (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                          Ni evidentiranega prometa po prostorih.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Promet po mizah */}
                <Card className="shadow-sm border-border/60">
                  <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-emerald-500" />
                      Po mizah
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[400px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background/95 backdrop-blur shadow-[0_1px_0_var(--border)] z-10">
                          <tr className="text-[11px] text-muted-foreground uppercase tracking-wider">
                           <th className="text-left py-3 px-5 font-semibold">Prostor / miza</th>
                            <th className="text-right py-3 px-5 font-semibold">Računov</th>
                            <th className="text-right py-3 px-5 font-semibold">Skupaj</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {prometData.prometPoMizah.map(m => (
                            <tr key={`${m.enotaId}-${m.mizaId ?? 'za-s-seboj'}`} className="hover:bg-muted/30 transition-colors group">
                              <td className="py-3 px-5">
                                <div className="font-medium">
                                  {m.miza || "Brez mize"}
                                </div>
                                {m.prostor && (
                                  <div className="text-xs text-muted-foreground mt-0.5">{m.prostor}</div>
                                )}
                                {prometData.prometPoEnotah.length > 1 && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5">{m.enota}</div>
                                )}
                              </td>
                              <td className="py-3 px-5 text-right tabular-nums text-muted-foreground align-top">{m.steviloRacunov}</td>
                              <td className="py-3 px-5 text-right tabular-nums font-semibold align-top group-hover:text-primary transition-colors">{fmt(m.skupaj)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {prometData.prometPoMizah.length === 0 && (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                          Ni evidentiranega prometa po mizah.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-border/40">
            <OperativnaPorocilaQrFeedback queryParams={queryParams} />
          </div>
        </div>
      )}
    </div>
  );
}
