import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { sl } from "date-fns/locale";
import { 
  useListPreparedFoodDaily, 
  getListPreparedFoodDailyQueryKey, 
  getListPreparedFoodDailyHistoryQueryKey,
  getListMalicaDailyOffersQueryKey,
  useListMalicaDailyOffers,
  useSavePreparedFoodDaily, 
  useClosePreparedFoodDaily,
  useListPreparedFoodDailyHistory,
  useListPreparedFoodStocks,
  getListPreparedFoodStocksQueryKey,
  useUpdatePreparedFoodStocks,
  useListArtikli,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Snowflake, Calendar as CalendarIcon, PackageOpen, CheckCircle2, Save, ClipboardList, ArrowLeft, Star } from "lucide-react";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Checkbox } from "@/components/ui/checkbox";
import { WasteRecordsPanel } from "@/pages/prepared-food/WasteRecordsPanel";
import { PreparationConsumptionDialog } from "@/pages/prepared-food/PreparationConsumptionDialog";
import { PreparationBatchEditor } from "@/pages/prepared-food/PreparationBatchEditor";
import { posFetch } from "@/lib/pos-auth-headers";
import type { PreparationBatch } from "@workspace/api-client-react";
import {
  formatPreparedFoodQuantity,
  preparedFoodQuantityLargeStep,
  preparedFoodQuantityStep,
  preparedFoodUnitLabel,
} from "@/lib/prepared-food-unit";

function parseQuantity(value: string): number {
  const parsed = parseDecimal(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const mobileCell = "flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 [&>*:last-child]:ml-auto lg:[&>*:last-child]:ml-0 border-b border-border/40 px-3 py-2 text-sm last:border-0 lg:table-cell lg:border-0 lg:p-2";
const mobileLabel = "shrink-0 text-xs font-medium text-muted-foreground lg:hidden";

type EditState = {
  thawed: string;
  prepared: string;
  correction: string;
  frozen: string;
  batches?: PreparationBatch[] | null;
};

function TouchQuantityInput({
  label,
  value,
  onChange,
  allowNegative = false,
  maxQuantity,
  unit = "porcija",
  onInspect,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
  maxQuantity?: number;
  unit?: string | null;
  onInspect?: () => void;
}) {
  const amount = parseQuantity(value);
  const step = preparedFoodQuantityStep(unit);
  const largeStep = preparedFoodQuantityLargeStep(unit);
  const stepLabel = formatPreparedFoodQuantity(step);
  const largeStepLabel = formatPreparedFoodQuantity(largeStep);
  const portionBased = step === 1;
  const accessibleStepLabel = portionBased ? "eno" : stepLabel;
  const accessibleLargeStepLabel = portionBased ? "deset" : largeStepLabel;
  const adjust = (delta: number) => {
    const next = Math.round((amount + delta) * 10_000) / 10_000;
    onChange(String(Math.min(maxQuantity ?? Infinity, allowNegative ? next : Math.max(0, next))));
  };
  return (
    <div className="flex shrink-0 items-stretch justify-end gap-1">
      <div className="flex flex-col gap-0.5">
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 30, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: povečaj za ${accessibleLargeStepLabel}`} onClick={() => adjust(largeStep)} disabled={maxQuantity !== undefined && amount >= maxQuantity}>
          +{largeStepLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 30, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: zmanjšaj za ${accessibleLargeStepLabel}`} onClick={() => adjust(-largeStep)} disabled={!allowNegative && amount < (maxQuantity === undefined ? largeStep : step)}>
          −{largeStepLabel}
        </Button>
      </div>
      <DecimalInput
        value={value}
        onClick={onInspect}
        onKeyDown={event => {
          if (onInspect && event.key === "Enter") {
            event.preventDefault();
            onInspect();
          }
        }}
        readOnly={portionBased}
        aria-label={label}
        onChange={portionBased ? undefined : event => onChange(event.target.value)}
        className="shrink-0 text-center font-semibold"
        style={{ height: 32, width: 44, fontSize: 12 }}
      />
      <div className="flex flex-col gap-0.5">
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 30, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: povečaj za ${accessibleStepLabel}`} onClick={() => adjust(step)} disabled={maxQuantity !== undefined && amount >= maxQuantity}>
          +{stepLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 30, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: zmanjšaj za ${accessibleStepLabel}`} onClick={() => adjust(-step)} disabled={!allowNegative && amount < step}>
          −{stepLabel}
        </Button>
      </div>
    </div>
  );
}

function DailyDateDetail({ date, year, onBack }: { date: string, year: number, onBack: () => void }) {
  const { data, isLoading } = useListPreparedFoodDaily(date);
  const { data: stocks, isLoading: loadingStocks } = useListPreparedFoodStocks(year);
  const { data: articles } = useListArtikli();
  const { data: malicaOffers = [], isLoading: loadingMalica } = useListMalicaDailyOffers({ from: date, to: date });
  const pizzaArticleId = articles?.find(article => article.jePica)?.id;
  const pizzaDoughQuery = useQuery({
    queryKey: ["prepared-food-pizza-dough-norms", pizzaArticleId],
    enabled: Boolean(pizzaArticleId),
    queryFn: async () => {
      if (!pizzaArticleId) return [];
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/artikli/${pizzaArticleId}/pizza-dough-norms`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Hlebčkov za pico ni bilo mogoče naložiti.";
        throw new Error(message);
      }
      if (!Array.isArray(body)) throw new Error("Strežnik je vrnil neveljavne nastavitve hlebčkov.");
      return body as Array<{
        size: "normalna" | "mala" | "druzinska";
        ingredient: { id: number; name: string };
        quantity: number;
      }>;
    },
  });
  
  const saveMutation = useSavePreparedFoodDaily();
  const closeMutation = useClosePreparedFoodDaily();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [consumptionArticleId, setConsumptionArticleId] = useState<number | null>(null);

  useEffect(() => {
    if (data) {
      setEdits(prev => {
        const next = { ...prev };
        let changed = false;
        for (const row of data) {
          if (!next[row.artikelId]) {
            next[row.artikelId] = {
              thawed: String(row.thawedQuantity || 0),
              prepared: String(row.preparedQuantity || 0),
              correction: String(row.correctionQuantity || 0),
              frozen: String(row.frozenAtEndQuantity || 0),
              batches: row.preparationBatches ?? null,
            };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [data]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyQueryKey(date) });
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodStocksQueryKey(year) });
      queryClient.invalidateQueries({ queryKey: getListMalicaDailyOffersQueryKey({ from: date, to: date }) });
    }, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [date, year, queryClient]);

  const updateEdit = useCallback((artikelId: number, field: keyof EditState, value: string) => {
    setEdits(prev => ({
      ...prev,
      [artikelId]: { ...prev[artikelId], [field]: value,
        ...(field === "prepared" ? { batches: null } : {}) }
    }));
  }, []);

  const hasEditableRows = useMemo(() => data?.some(row => row.editable) ?? false, [data]);
  
  const isDirty = useMemo(() => {
    if (!data) return false;
    return data.some(row => {
      if (!row.editable) return false;
      const edit = edits[row.artikelId];
      if (!edit) return false;
      return (
        edit.thawed !== String(row.thawedQuantity || 0) ||
        edit.prepared !== String(row.preparedQuantity || 0) ||
        edit.correction !== String(row.correctionQuantity || 0) ||
        edit.frozen !== String(row.frozenAtEndQuantity || 0)
        || JSON.stringify(edit.batches ?? null) !== JSON.stringify(row.preparationBatches ?? null)
      );
    });
  }, [data, edits]);

  const rowsWithCalculations = useMemo(() => {
    if (!data) return [];
    return data.map(row => {
      const edit: EditState = edits[row.artikelId] || { thawed: String(row.thawedQuantity || 0), prepared: String(row.preparedQuantity || 0), correction: String(row.correctionQuantity || 0), frozen: String(row.frozenAtEndQuantity || 0), batches: row.preparationBatches ?? null };
      const stock = stocks?.find(s => s.artikelId === row.artikelId);
      const availableThaw = Number(stock?.frozenQuantity ?? 0);
      const maxThaw = Number.isFinite(availableThaw) ? Math.max(0, availableThaw) : 0;
      const totalQuantity = parseQuantity(edit.thawed)
        + parseQuantity(edit.prepared)
        + parseQuantity(edit.correction);
      const calculatedWaste = totalQuantity - Number(row.soldQuantity) - parseQuantity(edit.frozen);
      const isClosed = !!row.closedAt;
      const isReadOnly = !row.editable || isClosed;
      
      return {
        ...row,
        edit,
        unitOfMeasure: preparedFoodUnitLabel(
          (stock as typeof stock & { unitOfMeasure?: string })?.unitOfMeasure ?? row.unitOfMeasure,
        ),
        totalQuantity,
        calculatedWaste,
        hasInvalidWaste: !isClosed && calculatedWaste < 0,
        maxThaw,
        hasInvalidThaw: !isReadOnly && (parseQuantity(edit.thawed) < 0 || parseQuantity(edit.thawed) > maxThaw),
        isClosed,
        isReadOnly
      };
    });
  }, [data, edits, stocks]);

  const featuredArticleIds = useMemo(() => {
    const offer = malicaOffers.find(item => item.businessDate === date
      && (item.status === "published" || item.status === "closed"));
    const ids = new Set<number>();
    for (const item of offer?.mainItems ?? []) if (item.enabled) ids.add(item.artikelId);
    for (const item of offer?.includedCourses ?? []) if (item.enabled) ids.add(item.artikelId);
    return ids;
  }, [date, malicaOffers]);

  const pizzaDoughArticles = useMemo(() => {
    const result = new Map<number, Array<"normalna" | "mala" | "druzinska">>();
    const bySize = new Map((pizzaDoughQuery.data ?? []).map(item => [item.size, item.ingredient]));
    for (const size of ["normalna", "mala", "druzinska"] as const) {
      const article = bySize.get(size);
      if (!article || !rowsWithCalculations.some(row => row.artikelId === article.id)) continue;
      result.set(article.id, [...(result.get(article.id) ?? []), size]);
    }
    return result;
  }, [pizzaDoughQuery.data, rowsWithCalculations]);

  const orderedRows = useMemo(() => {
    const collator = new Intl.Collator("sl", { sensitivity: "base", numeric: true });
    const byName = (a: typeof rowsWithCalculations[number], b: typeof rowsWithCalculations[number]) =>
      collator.compare(a.articleName ?? "", b.articleName ?? "");
    const featured = rowsWithCalculations.filter(row => featuredArticleIds.has(row.artikelId)).sort(byName);
    const featuredIds = new Set(featured.map(row => row.artikelId));
    const dough = [...pizzaDoughArticles.keys()]
      .filter(articleId => !featuredIds.has(articleId))
      .map(articleId => rowsWithCalculations.find(row => row.artikelId === articleId))
      .filter((row): row is typeof rowsWithCalculations[number] => Boolean(row));
    const placedIds = new Set([...featuredIds, ...dough.map(row => row.artikelId)]);
    const remaining = rowsWithCalculations.filter(row => !placedIds.has(row.artikelId));
    const thawAvailable = remaining
      .filter(row => Number(stocks?.find(stock => stock.artikelId === row.artikelId)?.frozenQuantity ?? 0) > 0
        || parseQuantity(row.edit.thawed) > 0)
      .sort(byName);
    const thawAvailableIds = new Set(thawAvailable.map(row => row.artikelId));
    const prepareAsNeeded = remaining.filter(row => !thawAvailableIds.has(row.artikelId)).sort(byName);
    return [
      ...featured,
      ...dough,
      ...thawAvailable,
      ...prepareAsNeeded,
    ];
  }, [featuredArticleIds, pizzaDoughArticles, rowsWithCalculations, stocks]);

  const hasAnyInvalidWaste = useMemo(() => rowsWithCalculations.some(r => r.hasInvalidWaste), [rowsWithCalculations]);
  const hasAnyInvalidThaw = rowsWithCalculations.some(r => r.hasInvalidThaw);
  const isCompactReadOnlyTable = rowsWithCalculations.length > 0
    && rowsWithCalculations.every(row => row.isReadOnly);

  const handleSaveAll = async () => {
    if (!data || loadingStocks || hasAnyInvalidThaw) return;
    setIsSaving(true);
    try {
      for (const row of data.filter(row => row.editable && !row.closedAt)) {
        const edit = edits[row.artikelId];
        if (!edit) continue;
        await saveMutation.mutateAsync({
          date,
          articleId: row.artikelId,
          data: {
            thawedQuantity: parseQuantity(edit.thawed),
            preparedQuantity: parseQuantity(edit.prepared),
            preparationBatches: edit.batches ?? null,
            correctionQuantity: parseQuantity(edit.correction),
            frozenAtEndQuantity: parseQuantity(edit.frozen)
          }
        });
      }
      toast({ title: "Shranjeno", description: "Vse odprte evidence so shranjene." });
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyQueryKey(date) });
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyHistoryQueryKey(year) });
    } catch (err: any) {
      toast({ title: "Napaka", description: err.message || "Ne morem shraniti", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseAll = async () => {
    if (!data || loadingStocks || hasAnyInvalidThaw) return;
    setIsClosing(true);
    try {
      const openRows = data.filter(row => row.editable && !row.closedAt);
      for (const row of openRows) {
        const edit = edits[row.artikelId];
        if (!edit) continue;
        await saveMutation.mutateAsync({
          date,
          articleId: row.artikelId,
          data: {
            thawedQuantity: parseQuantity(edit.thawed),
            preparedQuantity: parseQuantity(edit.prepared),
            preparationBatches: edit.batches ?? null,
            correctionQuantity: parseQuantity(edit.correction),
            frozenAtEndQuantity: parseQuantity(edit.frozen)
          }
        });
      }

      for (const row of openRows) {
        await closeMutation.mutateAsync({
          date,
          articleId: row.artikelId,
        });
      }
      
      toast({ title: "Zaključeno", description: "Vse dnevne evidence za izbran dan so zaključene." });
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyQueryKey(date) });
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyHistoryQueryKey(year) });
      queryClient.invalidateQueries({ queryKey: getListPreparedFoodStocksQueryKey(year) });
    } catch (err: any) {
      toast({ title: "Napaka pri zaključku", description: err.message || "Ne morem zaključiti", variant: "destructive" });
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Nazaj
            </Button>
            <div>
              <CardTitle>
                <button
                  type="button"
                  onClick={onBack}
                  className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                  {format(parseISO(date), "dd.MM.yyyy", { locale: sl })}
                </button>
              </CardTitle>
              <CardDescription>
                Količine vseh stolpcev so v enoti ob imenu artikla. Korekcija +/− uskladi računalniško stanje z dejansko količino v posodi.
              </CardDescription>
            </div>
          </div>
          {hasEditableRows && (
            <div className="flex items-center gap-2">
              <Button 
                variant={isDirty ? "default" : "secondary"} 
                onClick={handleSaveAll}
                 disabled={isSaving || isClosing || loadingStocks || hasAnyInvalidThaw}
              >
                <Save className="w-4 h-4 mr-2" /> Shrani vse
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setConfirmOpen(true)}
                 disabled={isSaving || isClosing || loadingStocks || hasAnyInvalidWaste || hasAnyInvalidThaw}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Zaključi vse
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || loadingStocks || loadingMalica || pizzaDoughQuery.isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
        ) : rowsWithCalculations.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Ni artiklov z operativnim načinom "Pripravljena hrana".</div>
        ) : (
          <div className="rounded-md border p-3 lg:p-0">
              <Table aria-label="Dnevna evidenca pripravljene hrane" className={`block w-full table-fixed lg:table ${isCompactReadOnlyTable ? "lg:text-xs" : "lg:min-w-[1040px]"}`}>
               <TableHeader className="hidden lg:table-header-group">
                <TableRow>
                  <TableHead className={isCompactReadOnlyTable ? "w-28 !px-1 text-[11px]" : "w-32"}>Artikel</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-32 text-right"}>Odtajano</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-40 text-right"}>Pripravljeno</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-32 text-right"}>Korekcija</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-20 text-right"}>Skupaj</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-16 text-right"}>Prodano</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-24 !px-1 text-right text-[11px]" : "w-44 text-right"}>Zamrznjeno</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-16 text-right"}>Kalo</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-24 text-right"}>Stanje</TableHead>
                </TableRow>
              </TableHeader>
               <TableBody className="block lg:table-row-group">
                 {orderedRows.map((row) => {
                   const stock = stocks?.find(s => s.artikelId === row.artikelId);
                    const isMalicaFeatured = featuredArticleIds.has(row.artikelId);
                    const doughSizes = pizzaDoughArticles.get(row.artikelId) ?? [];
                    const doughSizeNames = doughSizes.map(size => ({
                      normalna: "normalno",
                      mala: "malo",
                      druzinska: "družinsko",
                    }[size])).join(", ");
                  const availableToFreeze = Math.max(0, Math.round((row.totalQuantity - Number(row.soldQuantity)) * 10_000) / 10_000);
                  return (
                     <TableRow key={row.id} className={`mb-3 block overflow-hidden rounded-md ring-1 ring-border last:mb-0 lg:mb-0 lg:table-row lg:overflow-visible lg:rounded-none lg:ring-0 ${row.isClosed ? "bg-muted/30" : ""}`}>
                       <TableCell className={`${mobileCell} break-words font-medium ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                          {isMalicaFeatured && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Objavljeno v malicah" />}
                          <span>{row.articleName || `Artikel #${row.artikelId}`}</span>
                         <span className="ml-1 whitespace-nowrap text-xs font-normal text-muted-foreground">({preparedFoodUnitLabel(row.unitOfMeasure)})</span>
                          {doughSizes.length > 0 && <span className="block text-xs font-normal text-muted-foreground">Hlebček za pico: {doughSizeNames}</span>}
                          {!isMalicaFeatured && doughSizes.length === 0 && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {Number(stock?.frozenQuantity ?? 0) > 0 || parseQuantity(row.edit.thawed) > 0
                                ? "Na voljo za odtajanje ali že odtajano"
                                : "Priprava po potrebi"}
                            </span>
                          )}
                       </TableCell>
                       <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Odtajano</span>
                        {row.isReadOnly ? (
                           <div className="text-right">{formatPreparedFoodQuantity(row.thawedQuantity)}</div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                              <TouchQuantityInput label={row.unitOfMeasure === "porcija" ? "Odtajano" : `Odtajano (${row.unitOfMeasure})`} unit={row.unitOfMeasure} value={row.edit.thawed} maxQuantity={row.maxThaw} onChange={(value) => updateEdit(row.artikelId, "thawed", value)} />
                             <div className={`text-right text-xs font-bold ${row.hasInvalidThaw ? "text-destructive" : "text-foreground"}`}>
                                Na voljo za odtajanje: {formatPreparedFoodQuantity(stock?.frozenQuantity ?? 0)} {preparedFoodUnitLabel(row.unitOfMeasure)}
                               {row.hasInvalidThaw && <span className="block">Vnesite od 0 do {row.maxThaw}.</span>}
                             </div>
                          </div>
                        )}
                      </TableCell>
                       <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Pripravljeno</span>
                        <div className="flex flex-col items-end gap-1">
                          {(row.normativeBatchPieces || row.defaultRecipeBatchPieces) && row.unitOfMeasure === "porcija" && (
                            <PreparationBatchEditor name={row.articleName ?? `Artikel #${row.artikelId}`}
                              defaultPieces={row.normativeBatchPieces ?? row.defaultRecipeBatchPieces ?? 1}
                              value={row.isReadOnly ? row.preparationBatches ?? null : row.edit.batches ?? null}
                              readOnly={row.isReadOnly} onChange={batches => setEdits(prev => ({
                                ...prev, [row.artikelId]: { ...prev[row.artikelId], batches,
                                  prepared: String(batches.reduce((sum, b) => sum + b.batchCount * b.piecesPerBatch, 0)) },
                              }))} />
                          )}
                          {row.isReadOnly ? (
                            <button type="button" className="text-right underline decoration-dotted underline-offset-4"
                              aria-label={`Poraba artiklov: ${row.articleName}`}
                              onClick={() => setConsumptionArticleId(row.artikelId)}>
                              {formatPreparedFoodQuantity(row.preparedQuantity)}
                            </button>
                          ) : row.edit.batches != null || row.defaultRecipeBatchPieces ? (
                            <span className="font-semibold">{formatPreparedFoodQuantity(row.edit.prepared)} kosov</span>
                          ) : (
                            <TouchQuantityInput label={row.unitOfMeasure === "porcija" ? "Pripravljeno" : `Pripravljeno (${row.unitOfMeasure})`} unit={row.unitOfMeasure} value={row.edit.prepared} onChange={(value) => updateEdit(row.artikelId, "prepared", value)} onInspect={() => setConsumptionArticleId(row.artikelId)} />
                          )}
                          {!row.isReadOnly && <button type="button" className="text-[10px] text-primary underline underline-offset-2"
                            aria-label={`Poraba artiklov: ${row.articleName}`} onClick={() => setConsumptionArticleId(row.artikelId)}>
                            Poraba artiklov
                          </button>}
                        </div>
                      </TableCell>
                        <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                         <span className={mobileLabel}>Korekcija</span>
                         {row.isReadOnly ? (
                            <div className="text-right">{formatPreparedFoodQuantity(row.correctionQuantity)}</div>
                         ) : (
                             <TouchQuantityInput label={row.unitOfMeasure === "porcija" ? "Korekcija" : `Korekcija (${row.unitOfMeasure})`} unit={row.unitOfMeasure} value={row.edit.correction} onChange={(value) => updateEdit(row.artikelId, "correction", value)} allowNegative />
                         )}
                       </TableCell>
                       <TableCell className={`${mobileCell} font-bold lg:text-right ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                          <span className={mobileLabel}>Skupaj</span>{formatPreparedFoodQuantity(row.totalQuantity)}
                         {!row.isClosed && (
                            <div className="text-xs font-normal text-muted-foreground">Po prodaji: {formatPreparedFoodQuantity(availableToFreeze)} {preparedFoodUnitLabel(row.unitOfMeasure)}</div>
                         )}
                       </TableCell>
                        <TableCell className={`${mobileCell} lg:text-right ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}><span className={mobileLabel}>Prodano</span>{formatPreparedFoodQuantity(row.soldQuantity)}</TableCell>
                       <TableCell className={`${mobileCell} flex-wrap ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Zamrznjeno</span>
                        {row.isReadOnly ? (
                           <div className="text-right">{formatPreparedFoodQuantity(row.frozenAtEndQuantity)}</div>
                        ) : (
                            <div className="flex shrink-0 items-center justify-end gap-1.5">
                              <TouchQuantityInput label={row.unitOfMeasure === "porcija" ? "Zamrznjeno" : `Zamrznjeno (${row.unitOfMeasure})`} unit={row.unitOfMeasure} value={row.edit.frozen} onChange={(value) => updateEdit(row.artikelId, "frozen", value)} />
                              <Checkbox
                                id={`freeze-all-${row.artikelId}`}
                                aria-label={`Zamrzni vso razpoložljivo količino: ${row.articleName || `Artikel #${row.artikelId}`}`}
                                title="Vso preostalo količino vpiši za zamrznitev"
                                checked={availableToFreeze > 0 && parseQuantity(row.edit.frozen) === availableToFreeze}
                                disabled={isSaving || isClosing || availableToFreeze <= 0}
                                onCheckedChange={(checked) => updateEdit(row.artikelId, "frozen", checked === true ? String(availableToFreeze) : "0")}
                              />
                              <Label htmlFor={`freeze-all-${row.artikelId}`} className="cursor-pointer text-xs">Vse</Label>
                            </div>
                        )}
                      </TableCell>
                       <TableCell className={`${mobileCell} lg:text-right ${isCompactReadOnlyTable ? "lg:p-1" : "lg:align-top lg:pt-2"} ${row.hasInvalidWaste ? "font-semibold text-destructive" : ""}`}>
                        <span className={mobileLabel}>Kalo</span>
                         {row.isClosed ? formatPreparedFoodQuantity(row.wasteQuantity) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                       <TableCell className={`${mobileCell} lg:text-right ${isCompactReadOnlyTable ? "lg:p-1" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Stanje</span>
                        {row.isClosed ? (
                          <Badge variant="secondary" className="whitespace-nowrap">Zaključeno</Badge>
                        ) : row.isReadOnly ? (
                          <Badge variant="outline" className="whitespace-nowrap">Samo ogled</Badge>
                        ) : (
                          <Badge className="whitespace-nowrap">Odprto</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {rowsWithCalculations.filter(row => row.artikelId === consumptionArticleId).map(row => (
        <PreparationConsumptionDialog key={row.artikelId} date={date}
          selection={{ articleId: row.artikelId, articleName: row.articleName || `Artikel #${row.artikelId}`,
            quantity: row.isReadOnly ? String(row.preparedQuantity) : row.edit.prepared,
            unit: row.unitOfMeasure, readOnly: row.isReadOnly || !!row.defaultRecipeBatchPieces, closed: row.isClosed,
            unsaved: parseQuantity(row.edit.prepared) !== Number(row.preparedQuantity)
              || JSON.stringify(row.edit.batches ?? null) !== JSON.stringify(row.preparationBatches ?? null),
            batchCount: (row.isReadOnly ? row.preparationBatches : row.edit.batches)?.reduce((sum, b) => sum + b.batchCount, 0) }}
          onClose={() => setConsumptionArticleId(null)}
          onQuantityChange={value => updateEdit(row.artikelId, "prepared", value)} />
      ))}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Zaključi evidenco za {format(parseISO(date), "dd.MM.yyyy", { locale: sl })}</DialogTitle>
            <DialogDescription>
              Preglejte izračunano kalo pred zaključkom. Zaključek evidence je nepovraten.
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-2 max-h-[60vh] space-y-3 overflow-y-auto rounded-md border p-3">
            {rowsWithCalculations.filter(r => r.editable && !r.isClosed).map(row => (
              <div key={row.id} className="rounded-md border p-3">
                <div className="mb-2 font-medium">{row.articleName || `Artikel #${row.artikelId}`}</div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  {[
                    ["Pripravljeno", formatPreparedFoodQuantity(row.edit.prepared)],
                    ["Korekcija", formatPreparedFoodQuantity(row.edit.correction)],
                    ["Skupaj", formatPreparedFoodQuantity(row.totalQuantity)],
                    ["Prodano", formatPreparedFoodQuantity(row.soldQuantity)],
                    ["Zamrznjeno", formatPreparedFoodQuantity(row.edit.frozen)],
                    ["Kalo", formatPreparedFoodQuantity(row.calculatedWaste)],
                  ].map(([label, value]) => (
                    <div key={label} className={label === "Kalo" ? "font-medium text-destructive" : ""}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Prekliči</Button>
            <Button variant="destructive" onClick={handleCloseAll} disabled={isClosing}>
              Potrdi in zaključi vse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DailyDateList({ year, onYearChange, onSelectDate }: { year: number, onYearChange: (y: number) => void, onSelectDate: (d: string) => void }) {
  const { data: dailyHistory, isLoading } = useListPreparedFoodDailyHistory(year);
  const [newEntryDate, setNewEntryDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const datesList = useMemo(() => {
    const map = new Map<string, { date: string, allClosed: boolean }>();
    if (dailyHistory) {
      for (const row of dailyHistory) {
        const d = String(row.businessDate).slice(0, 10);
        if (!map.has(d)) {
          map.set(d, { date: d, allClosed: true });
        }
        if (!row.closedAt) {
          map.get(d)!.allClosed = false;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [dailyHistory, year]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Dnevna evidenca priprave</CardTitle>
            <CardDescription>Priprava in zamrzovanje po dnevih</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex items-center gap-2">
              <Label htmlFor="daily-history-year">Leto:</Label>
              <Input
                id="daily-history-year"
                type="number"
                value={year}
                onChange={(e) => onYearChange(parseInt(e.target.value) || new Date().getFullYear())}
                className="w-24"
                min={2000}
                max={2100}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="new-daily-entry-date">Nov vnos:</Label>
              <Input
                id="new-daily-entry-date"
                type="date"
                value={newEntryDate}
                onChange={(e) => setNewEntryDate(e.target.value)}
                className="w-40"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!newEntryDate) return;
                  onYearChange(Number(newEntryDate.slice(0, 4)));
                  onSelectDate(newEntryDate);
                }}
              >
                Odpri
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
        ) : datesList.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Za izbrano leto ni evidenc.</div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Akcija</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datesList.map(item => (
                  <TableRow 
                    key={item.date} 
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => onSelectDate(item.date)}
                  >
                    <TableCell className="font-medium">{format(parseISO(item.date), "dd.MM.yyyy", { locale: sl })}</TableCell>
                       <TableCell className="align-top pt-2">
                      {item.allClosed ? <Badge variant="secondary">Zaključeno</Badge> : <Badge>Odprto</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Odpri</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyTab() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  if (selectedDate) {
    return <DailyDateDetail date={selectedDate} year={year} onBack={() => setSelectedDate(null)} />;
  }
  return <DailyDateList year={year} onYearChange={setYear} onSelectDate={setSelectedDate} />;
}

type StockEdit = { openingQuantity: string; openingCostPerPortion: string };

function StockRow({
  stock,
  articleName,
  edit,
  onChange,
}: {
  stock: any;
  articleName: string;
  edit: StockEdit;
  onChange: (field: keyof StockEdit, value: string) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {articleName}
        <span className="ml-1 whitespace-nowrap text-xs font-normal text-muted-foreground">({preparedFoodUnitLabel(stock.unitOfMeasure)})</span>
      </TableCell>
                       <TableCell className="align-top pt-2">
        <DecimalInput step="0.0001" value={edit.openingQuantity} onChange={(e) => onChange("openingQuantity", e.target.value)} className="w-full text-right" />
      </TableCell>
      <TableCell>
        <div className="relative w-full">
          <DecimalInput step="0.0001" value={edit.openingCostPerPortion} onChange={(e) => onChange("openingCostPerPortion", e.target.value)} className="w-full pr-8 text-right" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-medium">{formatPreparedFoodQuantity(stock.frozenQuantity)}</TableCell>
      <TableCell className="text-right text-muted-foreground">€{stock.frozenCostPerPortion.toFixed(4)}</TableCell>
    </TableRow>
  );
}

export default function PreparedFoodPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [stockEdits, setStockEdits] = useState<Record<number, StockEdit>>({});
  
  const { data: artikli } = useListArtikli();
  const { data: stockData, isLoading: loadingStock, error: stockError, refetch: reloadStock } = useListPreparedFoodStocks(year);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStocksMutation = useUpdatePreparedFoodStocks();

  useEffect(() => {
    setStockEdits({});
  }, [year]);

  const articleMap = useMemo(() => {
    const map = new Map<number, string>();
    if (artikli) {
      artikli.forEach(a => map.set(a.id, a.ime));
    }
    return map;
  }, [artikli]);

  const changedStocks = useMemo(() => (
    (stockData ?? []).flatMap((stock) => {
      const edit = stockEdits[stock.artikelId];
      if (!edit) return [];
      if (
        edit.openingQuantity === String(stock.openingQuantity)
        && edit.openingCostPerPortion === String(stock.openingCostPerPortion)
      ) return [];
      return [{
        articleId: stock.artikelId,
        openingQuantity: parseQuantity(edit.openingQuantity),
        openingCostPerPortion: parseQuantity(edit.openingCostPerPortion),
      }];
    })
  ), [stockData, stockEdits]);

  const handleStockChange = useCallback((articleId: number, field: keyof StockEdit, value: string) => {
    setStockEdits((current) => {
      const stock = stockData?.find((item) => item.artikelId === articleId);
      if (!stock) return current;
      const existing = current[articleId] ?? {
        openingQuantity: String(stock.openingQuantity),
        openingCostPerPortion: String(stock.openingCostPerPortion),
      };
      return {
        ...current,
        [articleId]: { ...existing, [field]: value },
      };
    });
  }, [stockData]);

  const handleSaveStocks = () => {
    if (changedStocks.length === 0 || updateStocksMutation.isPending) return;
    updateStocksMutation.mutate({
      year,
      data: { items: changedStocks },
    }, {
      onSuccess: (savedStocks) => {
        setStockEdits({});
        toast({
          title: "Shranjeno",
          description: `${savedStocks.length} ${savedStocks.length === 1 ? "artikel je" : "artikli so"} posodobljeni.`,
        });
        queryClient.invalidateQueries({ queryKey: getListPreparedFoodStocksQueryKey(year) });
      },
      onError: (err: any) => {
        toast({
          title: "Napaka pri shranjevanju",
          description: err.message || "Začetnih zalog ni bilo mogoče shraniti.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
          <Snowflake className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pripravljena hrana</h1>
          <p className="text-muted-foreground text-sm">Evidenca priprave, zamrzovanja in porabe</p>
        </div>
      </div>

      <Tabs defaultValue="daily" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="daily" className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4" /> Dnevna evidenca
          </TabsTrigger>
          <TabsTrigger value="stock" className="flex items-center gap-2">
            <PackageOpen className="w-4 h-4" /> Začetna zaloga (Letna)
          </TabsTrigger>
          <TabsTrigger value="waste" className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" /> Zapisniki kala
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-4">
          <DailyTab />
        </TabsContent>

        <TabsContent value="stock" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle>Letna začetna zaloga</CardTitle>
                  <CardDescription>
                    Vnesite začetno količino in strošek na enoto, prikazano ob posameznem artiklu. To je operativni podatek za vrednotenje kala, ne računovodska začetna knjižba.
                  </CardDescription>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Label>Leto:</Label>
                    <Input
                      type="number"
                      value={year}
                      onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
                      className="w-24"
                      min={2000}
                      max={2100}
                    />
                  </div>
                  <Button
                    onClick={handleSaveStocks}
                    disabled={changedStocks.length === 0 || updateStocksMutation.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {updateStocksMutation.isPending ? "Shranjujem..." : "Shrani vse"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stockError ? (
                <div role="alert" className="space-y-3 py-6 text-sm">
                  <p className="text-destructive">{stockError.message || "Začetne zaloge ni mogoče prenesti. Preverite zaključek dnevnih evidenc starega leta."}</p>
                  <Button variant="outline" onClick={() => void reloadStock()}>Ponovno preveri</Button>
                </div>
              ) : loadingStock ? (
                <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
              ) : !stockData || stockData.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">Ni artiklov z nastavljenim operativnim načinom "Pripravljena hrana".</div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table className="min-w-[900px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[260px]">Artikel</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Začetna količina (01.01)</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Strošek na enoto</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Trenutno zamrznjeno</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Drseča cena na enoto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockData.map((row) => {
                        const edit = stockEdits[row.artikelId] ?? {
                          openingQuantity: String(row.openingQuantity),
                          openingCostPerPortion: String(row.openingCostPerPortion),
                        };
                        return (
                          <StockRow
                            key={row.id}
                            stock={row}
                            articleName={row.articleName || articleMap.get(row.artikelId) || `Artikel #${row.artikelId}`}
                            edit={edit}
                            onChange={(field, value) => handleStockChange(row.artikelId, field, value)}
                          />
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="waste" className="space-y-4">
          <WasteRecordsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
