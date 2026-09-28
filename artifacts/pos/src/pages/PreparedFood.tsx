import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { sl } from "date-fns/locale";
import { 
  useListPreparedFoodDaily, 
  getListPreparedFoodDailyQueryKey, 
  getListPreparedFoodDailyHistoryQueryKey,
  useSavePreparedFoodDaily, 
  useClosePreparedFoodDaily,
  useListPreparedFoodDailyHistory,
  useListPreparedFoodStocks,
  getListPreparedFoodStocksQueryKey,
  useUpdatePreparedFoodStocks,
  useListArtikli,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Snowflake, Calendar as CalendarIcon, PackageOpen, CheckCircle2, Save, ClipboardList, ArrowLeft } from "lucide-react";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Checkbox } from "@/components/ui/checkbox";
import { WasteRecordsPanel } from "@/pages/prepared-food/WasteRecordsPanel";

function parseQuantity(value: string): number {
  const parsed = parseDecimal(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const mobileCell = "flex min-w-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-sm last:border-0 lg:table-cell lg:border-0 lg:p-2";
const mobileLabel = "shrink-0 text-xs font-medium text-muted-foreground lg:hidden";

type EditState = {
  thawed: string;
  prepared: string;
  correction: string;
  frozen: string;
};

function TouchQuantityInput({
  label,
  value,
  onChange,
  allowNegative = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
}) {
  const amount = parseQuantity(value);
  const adjust = (delta: number) => {
    const next = amount + delta;
    onChange(String(allowNegative ? next : Math.max(0, next)));
  };
  return (
    <div className="flex items-stretch justify-end gap-1">
      <div className="flex flex-col gap-0.5">
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 24, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: povečaj za deset`} onClick={() => adjust(10)}>
          +10
        </Button>
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 24, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: zmanjšaj za deset`} onClick={() => adjust(-10)} disabled={!allowNegative && amount < 10}>
          −10
        </Button>
      </div>
      <DecimalInput value={value} readOnly aria-label={label} className="text-center font-semibold" style={{ height: 32, width: 44, fontSize: 12 }} />
      <div className="flex flex-col gap-0.5">
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 24, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: povečaj za eno`} onClick={() => adjust(1)}>
          +1
        </Button>
        <Button type="button" variant="outline" size="sm" className="touch-manipulation p-0 font-semibold" style={{ height: 16, minHeight: 16, width: 24, fontSize: 8, lineHeight: 1, borderRadius: 2 }} aria-label={`${label}: zmanjšaj za eno`} onClick={() => adjust(-1)} disabled={!allowNegative && amount < 1}>
          −1
        </Button>
      </div>
    </div>
  );
}

function DailyDateDetail({ date, year, onBack }: { date: string, year: number, onBack: () => void }) {
  const { data, isLoading } = useListPreparedFoodDaily(date);
  const { data: stocks, isLoading: loadingStocks } = useListPreparedFoodStocks(year);
  
  const saveMutation = useSavePreparedFoodDaily();
  const closeMutation = useClosePreparedFoodDaily();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

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
    }, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [date, queryClient]);

  const updateEdit = useCallback((artikelId: number, field: keyof EditState, value: string) => {
    setEdits(prev => ({
      ...prev,
      [artikelId]: { ...prev[artikelId], [field]: value }
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
      );
    });
  }, [data, edits]);

  const rowsWithCalculations = useMemo(() => {
    if (!data) return [];
    return data.map(row => {
      const edit = edits[row.artikelId] || { thawed: String(row.thawedQuantity || 0), prepared: String(row.preparedQuantity || 0), correction: String(row.correctionQuantity || 0), frozen: String(row.frozenAtEndQuantity || 0) };
      const totalQuantity = parseQuantity(edit.thawed)
        + parseQuantity(edit.prepared)
        + parseQuantity(edit.correction);
      const calculatedWaste = totalQuantity - Number(row.soldQuantity) - parseQuantity(edit.frozen);
      const isClosed = !!row.closedAt;
      const isReadOnly = !row.editable || isClosed;
      
      return {
        ...row,
        edit,
        totalQuantity,
        calculatedWaste,
        hasInvalidWaste: !isClosed && calculatedWaste < 0,
        isClosed,
        isReadOnly
      };
    });
  }, [data, edits]);

  const hasAnyInvalidWaste = useMemo(() => rowsWithCalculations.some(r => r.hasInvalidWaste), [rowsWithCalculations]);
  const isCompactReadOnlyTable = rowsWithCalculations.length > 0
    && rowsWithCalculations.every(row => row.isReadOnly);

  const handleSaveAll = async () => {
    if (!data) return;
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
    if (!data) return;
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
          <div className="flex items-center gap-3">
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
                  {format(parseISO(date), "EEEE, d. MMMM yyyy", { locale: sl })}
                </button>
              </CardTitle>
              <CardDescription>
                Korekcija +/− uskladi računalniško stanje z dejansko količino v posodi.
              </CardDescription>
            </div>
          </div>
          {hasEditableRows && (
            <div className="flex items-center gap-2">
              <Button 
                variant={isDirty ? "default" : "secondary"} 
                onClick={handleSaveAll}
                disabled={isSaving || isClosing}
              >
                <Save className="w-4 h-4 mr-2" /> Shrani vse
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setConfirmOpen(true)}
                disabled={isSaving || isClosing || hasAnyInvalidWaste}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Zaključi vse
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || loadingStocks ? (
          <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
        ) : rowsWithCalculations.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Ni artiklov z operativnim načinom "Pripravljena hrana".</div>
        ) : (
          <div className="rounded-md border p-3 lg:p-0">
              <Table aria-label="Dnevna evidenca pripravljene hrane" className={`block w-full table-fixed lg:table ${isCompactReadOnlyTable ? "lg:text-xs" : ""}`}>
               <TableHeader className="hidden lg:table-header-group">
                <TableRow>
                  <TableHead className={isCompactReadOnlyTable ? "w-28 !px-1 text-[11px]" : "w-32"}>Artikel</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-24 text-right"}>Odtajano</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-24 text-right"}>Pripravljeno</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-24 text-right"}>Korekcija</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-16 text-right"}>Skupaj</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-16 text-right"}>Prodano</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-24 !px-1 text-right text-[11px]" : "w-44 text-right"}>Zamrznjeno</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-14 !px-1 text-right text-[11px]" : "w-16 text-right"}>Kalo</TableHead>
                  <TableHead className={isCompactReadOnlyTable ? "w-16 !px-1 text-right text-[11px]" : "w-16 text-right"}>Stanje</TableHead>
                </TableRow>
              </TableHeader>
               <TableBody className="block lg:table-row-group">
                {rowsWithCalculations.map((row) => {
                  const stock = stocks?.find(s => s.artikelId === row.artikelId);
                  const availableToFreeze = Math.max(0, Math.round((row.totalQuantity - Number(row.soldQuantity)) * 10_000) / 10_000);
                  return (
                     <TableRow key={row.id} className={`mb-3 block overflow-hidden rounded-md ring-1 ring-border last:mb-0 lg:mb-0 lg:table-row lg:overflow-visible lg:rounded-none lg:ring-0 ${row.isClosed ? "bg-muted/30" : ""}`}>
                      <TableCell className={`${mobileCell} break-words font-medium ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>{row.articleName || `Artikel #${row.artikelId}`}</TableCell>
                       <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Odtajano</span>
                        {row.isReadOnly ? (
                          <div className="text-right">{row.thawedQuantity}</div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <TouchQuantityInput label="Odtajano" value={row.edit.thawed} onChange={(value) => updateEdit(row.artikelId, "thawed", value)} />
                            {stock != null && (
                              <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                Na voljo za odtajanje: {stock.frozenQuantity}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                       <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Pripravljeno</span>
                        {row.isReadOnly ? (
                          <div className="text-right">{row.preparedQuantity}</div>
                        ) : (
                           <TouchQuantityInput label="Pripravljeno" value={row.edit.prepared} onChange={(value) => updateEdit(row.artikelId, "prepared", value)} />
                        )}
                      </TableCell>
                        <TableCell className={`${mobileCell} ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                         <span className={mobileLabel}>Korekcija</span>
                         {row.isReadOnly ? (
                           <div className="text-right">{row.correctionQuantity}</div>
                         ) : (
                            <TouchQuantityInput label="Korekcija" value={row.edit.correction} onChange={(value) => updateEdit(row.artikelId, "correction", value)} allowNegative />
                         )}
                       </TableCell>
                       <TableCell className={`${mobileCell} font-bold lg:text-right ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}><span className={mobileLabel}>Skupaj</span>{row.totalQuantity}</TableCell>
                       <TableCell className={`${mobileCell} lg:text-right ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}><span className={mobileLabel}>Prodano</span>{row.soldQuantity}</TableCell>
                       <TableCell className={`${mobileCell} flex-wrap ${isCompactReadOnlyTable ? "lg:p-1 lg:text-xs" : "lg:align-top lg:pt-2"}`}>
                        <span className={mobileLabel}>Zamrznjeno</span>
                        {row.isReadOnly ? (
                          <div className="text-right">{row.frozenAtEndQuantity}</div>
                        ) : (
                            <div className="flex shrink-0 items-center justify-end gap-1.5">
                              <TouchQuantityInput label="Zamrznjeno" value={row.edit.frozen} onChange={(value) => updateEdit(row.artikelId, "frozen", value)} />
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
                        {row.isClosed ? row.wasteQuantity : <span className="text-muted-foreground">-</span>}
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Zaključi evidenco za {format(parseISO(date), "d. MMMM yyyy", { locale: sl })}</DialogTitle>
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
                    ["Pripravljeno", parseQuantity(row.edit.prepared)],
                    ["Korekcija", parseQuantity(row.edit.correction)],
                    ["Skupaj", row.totalQuantity],
                    ["Prodano", row.soldQuantity],
                    ["Zamrznjeno", parseQuantity(row.edit.frozen)],
                    ["Kalo", row.calculatedWaste],
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
                    <TableCell className="font-medium">{format(parseISO(item.date), "d. MMMM yyyy", { locale: sl })}</TableCell>
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
      <TableCell className="font-medium">{articleName}</TableCell>
                       <TableCell className="align-top pt-2">
        <DecimalInput value={edit.openingQuantity} onChange={(e) => onChange("openingQuantity", e.target.value)} className="w-full text-right" />
      </TableCell>
      <TableCell>
        <div className="relative w-full">
          <DecimalInput value={edit.openingCostPerPortion} onChange={(e) => onChange("openingCostPerPortion", e.target.value)} className="w-full pr-8 text-right" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-medium">{stock.frozenQuantity}</TableCell>
      <TableCell className="text-right text-muted-foreground">€{stock.frozenCostPerPortion.toFixed(4)}</TableCell>
    </TableRow>
  );
}

export default function PreparedFoodPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [stockEdits, setStockEdits] = useState<Record<number, StockEdit>>({});
  
  const { data: artikli } = useListArtikli();
  const { data: stockData, isLoading: loadingStock } = useListPreparedFoodStocks(year);

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
                    Vnesite začetno število porcij in strošek na porcijo. To je operativni podatek za vrednotenje kala, ne računovodska začetna knjižba.
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
              {loadingStock ? (
                <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
              ) : !stockData || stockData.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">Ni artiklov z nastavljenim operativnim načinom "Pripravljena hrana".</div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table className="min-w-[900px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[260px]">Artikel</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Začetne porcije (01.01)</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Strošek na porcijo</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Trenutna kol. zamrznjeno</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap text-right">Trenutna drseča cena</TableHead>
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
