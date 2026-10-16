import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShoppingBag, ShieldAlert, Check } from "lucide-react";
import { useAddMalicaToOrder, useQuoteMalicaOrder, useListMalicaPartnerGroupPrices, useListPartnerji, useResolveMalicaBeneficiary } from "@workspace/api-client-react";
import type { MalicaDailyOffer, MalicaBootstrap, Artikel } from "@workspace/api-client-react";
import type { MalicaPizzaSize } from "@workspace/api-client-react";
import { isMalicaChoiceUnavailable } from "@/lib/malicaHelpers";
import { formatQuoteCents, formatLimitCents, isCourseIncluded, mapLimitErrorToMessage } from "@/lib/malicaQuoteHelpers";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getGetNarociloQueryKey, getListAktivnaNarocilaQueryKey, getListNarocilaQueryKey, getGetPreparedFoodAvailabilityQueryKey, getListMalicaDailyOffersQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PIZZA_SIZE_LABELS: Record<MalicaPizzaSize, string> = {
  mala: "Mala",
  normalna: "Normalna",
  druzinska: "Družinska",
};

export function MalicaOrderFlow({
  narociloId,
  maliceOffers,
  maliceBootstrap,
  artikli,
  onCancel,
  onSuccess
}: {
  narociloId: number;
  maliceOffers?: MalicaDailyOffer[];
  maliceBootstrap?: MalicaBootstrap;
  artikli?: Artikel[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [malicaMainItemId, setMalicaMainItemId] = useState<number | null>(null);
  const [malicaSoupIds, setMalicaSoupIds] = useState<number[]>([]);
  const [malicaDessertIds, setMalicaDessertIds] = useState<number[]>([]);
  const [malicaPartnerId, setMalicaPartnerId] = useState<string>("none");
  const [beneficiaryType, setBeneficiaryType] = useState<"pin" | "barcode" | "qr" | "nfc" | "none">("none");
  const [beneficiaryIdInput, setBeneficiaryIdInput] = useState("");
  const [resolvedBeneficiaryMasked, setResolvedBeneficiaryMasked] = useState<string | null>(null);
  const [resolvedBeneficiaryToken, setResolvedBeneficiaryToken] = useState<string | null>(null);

  const { data: partnerjiList } = useListPartnerji();
  const resolveBeneficiary = useResolveMalicaBeneficiary();
  
  const addMalicaToOrder = useAddMalicaToOrder();
  const quoteMalicaOrder = useQuoteMalicaOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleResolve = () => {
    if (beneficiaryType === "none" || !beneficiaryIdInput) return;
    resolveBeneficiary.mutate({
      data: {
        partnerId: malicaPartnerId,
        identifierType: beneficiaryType,
        identifier: beneficiaryIdInput
      }
    }, {
      onSuccess: (res) => {
        const token = res.beneficiaryToken;
        if (!token) {
          toast({ title: "Napaka", description: "Strežnik ni vrnil žetona upravičenca.", variant: "destructive" });
          return;
        }
        setResolvedBeneficiaryMasked(res.maskedSuffix ?? "Preverjeno");
        setResolvedBeneficiaryToken(token);
        setBeneficiaryIdInput(""); // Clear secret immediately
        toast({ title: "Upravičenec prepoznan", description: "Identiteta uspešno potrjena." });
      },
      onError: () => {
        setResolvedBeneficiaryMasked(null);
        setResolvedBeneficiaryToken(null);
        toast({ title: "Napaka", description: "Upravičenca ni bilo mogoče prepoznati.", variant: "destructive" });
      }
    });
  };

  const currentPayload = useMemo(() => {
    const publishedOffer = maliceOffers?.find(o => o.status === "published");
    if (!publishedOffer || !malicaMainItemId) return null;
    if (malicaPartnerId !== "none" && beneficiaryType !== "none" && !resolvedBeneficiaryToken) return null;
    return {
      offerId: publishedOffer.id,
      mainItemId: malicaMainItemId,
      soupIds: malicaSoupIds,
      dessertIds: malicaDessertIds,
      ...(malicaPartnerId !== "none" ? { partnerId: malicaPartnerId } : {}),
      ...(resolvedBeneficiaryToken && beneficiaryType !== "none" ? { 
        beneficiaryToken: resolvedBeneficiaryToken
      } : {})
    };
  }, [maliceOffers, malicaMainItemId, malicaSoupIds, malicaDessertIds, malicaPartnerId, resolvedBeneficiaryToken, beneficiaryType]);

  useEffect(() => {
    if (currentPayload) {
      quoteMalicaOrder.mutate({ id: narociloId, data: currentPayload });
    }
  }, [currentPayload, narociloId]);

  const handleSubmit = async () => {
    if (!currentPayload) return;
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await addMalicaToOrder.mutateAsync({
        id: narociloId,
        data: { ...currentPayload, quantity: 1, idempotencyKey }
      });
      queryClient.setQueryData(getGetNarociloQueryKey(narociloId), res);
      queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListNarocilaQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMalicaDailyOffersQueryKey() });
      
      if (res.malicaWarnings?.omittedCourseIds && res.malicaWarnings.omittedCourseIds.length > 0) {
        toast({ title: "Malica dodana delno", description: "Nekatere izbrane jedi so medtem pošle in niso bile dodane.", variant: "destructive" });
      } else {
        toast({ title: "Malica dodana" });
      }
      onSuccess();
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message || "Napaka pri dodajanju malice", variant: "destructive" });
    }
  };

  const publishedOffer = maliceOffers?.find(o => o.status === "published");
  if (!publishedOffer) return <div className="text-center py-12 text-muted-foreground">Trenutno ni objavljene ponudbe malic.</div>;

  const getArt = (id: number) => artikli?.find(a => a.id === id);
  const getGrp = (id: number) => maliceBootstrap?.groups?.find(g => g.id === id);

  const sortedMainItems = [...(publishedOffer.mainItems || [])].sort((a, b) => {
    const ga = getGrp(a.groupId)?.sortOrder || 99;
    const gb = getGrp(b.groupId)?.sortOrder || 99;
    return ga - gb;
  });

  const toggleCourse = (id: number, list: number[], setList: (l: number[]) => void) => {
    if (list.includes(id)) setList(list.filter(i => i !== id));
    else setList([...list, id]);
  };

  const quote = quoteMalicaOrder.data;
  const quoteError = quoteMalicaOrder.error as any;
  const limitError = quote ? mapLimitErrorToMessage(quote.mode, quote.remainingDaily, quote.remainingBeneficiaryMonthlyCents, quote.remainingContractMonthlyCents) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Dnevne malice</h2>
        <p className="text-muted-foreground text-sm mt-1">Izberite glavno jed in opcijske dodatke.</p>
      </div>

      <div className="space-y-4">
        <div className="bg-slate-50 p-4 rounded-xl border">
          <Label className="mb-2 block">Pogodbeni partner (neobvezno)</Label>
          <Select value={malicaPartnerId} onValueChange={id => { setMalicaPartnerId(id); setBeneficiaryType("none"); setBeneficiaryIdInput(""); setResolvedBeneficiaryMasked(null); setResolvedBeneficiaryToken(null); }}>
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Brez partnerja (splošna malica)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez partnerja (splošna malica)</SelectItem>
              {partnerjiList?.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.naziv}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {malicaPartnerId !== "none" && (
          <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
            <Label>Identifikacija upravičenca</Label>
            <Tabs value={beneficiaryType} onValueChange={v => { setBeneficiaryType(v as any); setResolvedBeneficiaryMasked(null); setResolvedBeneficiaryToken(null); setBeneficiaryIdInput(""); }}>
              <TabsList className="w-full">
                <TabsTrigger value="none" className="flex-1">Brez</TabsTrigger>
                <TabsTrigger value="pin" className="flex-1">PIN / ID</TabsTrigger>
                <TabsTrigger value="barcode" className="flex-1">Barkoda</TabsTrigger>
              </TabsList>
            </Tabs>
            {beneficiaryType !== "none" && !resolvedBeneficiaryMasked && (
              <div className="flex gap-2">
                <Input type={beneficiaryType === "pin" ? "password" : "text"} placeholder="Vnesite identifikator" value={beneficiaryIdInput} onChange={e => setBeneficiaryIdInput(e.target.value)} />
                <Button onClick={handleResolve} disabled={!beneficiaryIdInput || resolveBeneficiary.isPending}>Preveri</Button>
              </div>
            )}
            {resolvedBeneficiaryMasked && (
              <div className="flex items-center justify-between bg-green-50 p-3 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 text-green-800">
                  <Check className="h-5 w-5" />
                  <span className="font-semibold">Potrjeno: {resolvedBeneficiaryMasked}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setResolvedBeneficiaryMasked(null); setBeneficiaryIdInput(""); }}>Spremeni</Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <h3 className="font-semibold text-lg border-b pb-2">Glavne jedi (izberite 1)</h3>
          <div className="grid gap-3">
            {sortedMainItems.filter(m => m.artikelId).map(m => {
              const grp = getGrp(m.groupId);
              const art = getArt(m.artikelId!);
              if (!grp || !art) return null;
              const isSelected = malicaMainItemId === m.id;
              const isExhausted = isMalicaChoiceUnavailable(m);
              
              let badgeText = grp.name;
              let bgClass = "bg-slate-100 text-slate-700";
              if (grp.name.toLowerCase().includes("topla")) {
                bgClass = "bg-orange-100 text-orange-800";
              } else if (grp.name.toLowerCase().includes("hladna")) {
                bgClass = "bg-blue-100 text-blue-800";
              }

              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={isExhausted}
                  className={`text-left p-3 rounded-xl border-2 transition-all flex items-center justify-between gap-3 ${
                    isExhausted ? "opacity-50 cursor-not-allowed bg-muted/30 border-muted" :
                    isSelected ? "border-amber-600 bg-amber-50" : "border-muted bg-card hover:border-amber-200"
                  }`}
                  onClick={() => setMalicaMainItemId(isSelected ? null : m.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${bgClass}`}>
                        {badgeText}
                      </span>
                      {isExhausted && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 uppercase tracking-wider">
                          Razprodano
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-base truncate">
                      {art.ime}
                      {m.velikostPice && <span className="ml-1 text-muted-foreground"> ({PIZZA_SIZE_LABELS[m.velikostPice]})</span>}
                    </div>
                    {m.remainingQuantity != null && !isExhausted && (
                      <div className="text-xs font-semibold text-amber-700 mt-1">Na voljo še: {m.remainingQuantity}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-lg border-b pb-2">Juhe</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {publishedOffer.includedCourses?.filter(c => c.courseType === "soup").map(c => {
              const art = getArt(c.artikelId);
              if (!art) return null;
              const isSelected = malicaSoupIds.includes(c.id);
              const isExhausted = isMalicaChoiceUnavailable(c);
              const quoteCourse = quote?.courses.find(qc => qc.dailyCourseId === c.id);
              const displayLabel = quoteCourse ? (isCourseIncluded(quoteCourse) ? "Vključeno" : `Doplačilo +${formatQuoteCents(quoteCourse.grossCents)}`) : null;

              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={isExhausted}
                  className={`text-left p-3 rounded-xl border-2 transition-all flex items-center justify-between gap-2 ${
                    isExhausted ? "opacity-50 cursor-not-allowed bg-muted/30 border-muted" :
                    isSelected ? "border-amber-600 bg-amber-50" : "border-muted bg-card hover:border-amber-200"
                  }`}
                  onClick={() => toggleCourse(c.id, malicaSoupIds, setMalicaSoupIds)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{art.ime}</span>
                      {isExhausted ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-red-100 text-red-800 uppercase">Razprodano</span>
                      ) : displayLabel ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase ${isCourseIncluded(quoteCourse!) ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{displayLabel}</span>
                      ) : null}
                    </div>
                    {c.remainingQuantity != null && !isExhausted && (
                      <div className="text-[10px] font-semibold text-amber-700 mt-0.5">Ostalo: {c.remainingQuantity}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-lg border-b pb-2">Sladice</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {publishedOffer.includedCourses?.filter(c => c.courseType === "dessert").map(c => {
              const art = getArt(c.artikelId);
              if (!art) return null;
              const isSelected = malicaDessertIds.includes(c.id);
              const isExhausted = isMalicaChoiceUnavailable(c);
              const quoteCourse = quote?.courses.find(qc => qc.dailyCourseId === c.id);
              const displayLabel = quoteCourse ? (isCourseIncluded(quoteCourse) ? "Vključeno" : `Doplačilo +${formatQuoteCents(quoteCourse.grossCents)}`) : null;

              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={isExhausted}
                  className={`text-left p-3 rounded-xl border-2 transition-all flex items-center justify-between gap-2 ${
                    isExhausted ? "opacity-50 cursor-not-allowed bg-muted/30 border-muted" :
                    isSelected ? "border-amber-600 bg-amber-50" : "border-muted bg-card hover:border-amber-200"
                  }`}
                  onClick={() => toggleCourse(c.id, malicaDessertIds, setMalicaDessertIds)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{art.ime}</span>
                      {isExhausted ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-red-100 text-red-800 uppercase">Razprodano</span>
                      ) : displayLabel ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase ${isCourseIncluded(quoteCourse!) ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{displayLabel}</span>
                      ) : null}
                    </div>
                    {c.remainingQuantity != null && !isExhausted && (
                      <div className="text-[10px] font-semibold text-amber-700 mt-0.5">Ostalo: {c.remainingQuantity}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 p-4 bg-background border-t mt-8 -mx-4 pb-8 md:pb-4 shadow-lg rounded-t-xl z-20">
        <div className="max-w-md mx-auto">
          {quoteMalicaOrder.isPending ? (
            <div className="flex justify-center p-4 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : quoteError ? (
            <div className="mb-4 p-3 bg-red-50 text-red-900 border border-red-200 rounded-lg text-sm flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Napaka izračuna:</strong> {quoteError.message || "Neveljavna izbira"}
              </div>
            </div>
          ) : quote ? (
            <div className="mb-4 bg-slate-50 p-4 rounded-xl border text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Redna cena malice:</span>
                <span>{formatQuoteCents(quote.regularTotalCents)}</span>
              </div>
              {quote.extrasCents > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Doplačila za dodatke:</span>
                  <span>{formatQuoteCents(quote.extrasCents)}</span>
                </div>
              )}
              {quote.surchargeCents > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Doplačilo višje skupine:</span>
                  <span>{formatQuoteCents(quote.surchargeCents)}</span>
                </div>
              )}
              {quote.partnerCoveredCents > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Krije partner ({quote.mode}):</span>
                  <span>- {formatQuoteCents(quote.partnerCoveredCents)}</span>
                </div>
              )}
              {quote.remainingBeneficiaryMonthlyCents != null && (
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Preostanek mesečnega kritja (upravičenec):</span>
                  <span>{formatQuoteCents(quote.remainingBeneficiaryMonthlyCents)}</span>
                </div>
              )}
              {quote.remainingContractMonthlyCents != null && (
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Preostanek mesečnega kritja (pogodba):</span>
                  <span>{formatQuoteCents(quote.remainingContractMonthlyCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t mt-2">
                <span>Za plačilo:</span>
                <span>{formatQuoteCents(quote.guestPayableCents)}</span>
              </div>
              
              {limitError && (
                <div className="mt-3 p-2 bg-red-100 text-red-900 border border-red-200 rounded text-xs font-bold text-center">
                  {limitError}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel} type="button">
              Prekliči
            </Button>
            <Button 
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!malicaMainItemId || addMalicaToOrder.isPending || !!limitError || !!quoteError || quoteMalicaOrder.isPending}
              onClick={handleSubmit}
            >
              {addMalicaToOrder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <ShoppingBag className="w-5 h-5 mr-2" />
              Dodaj na račun
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
