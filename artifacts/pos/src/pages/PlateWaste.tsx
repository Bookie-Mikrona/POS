import { useState, useEffect, useCallback } from "react";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { 
  useGetPlateWasteOverview, 
  getGetPlateWasteOverviewQueryKey,
  useSavePlateWasteDailyEntry,
  useCreatePlateWasteHandover,
  downloadPlateWasteExport,
  downloadPlateWasteHandoverPdf,
  PlateWasteDailyEntry,
  PlateWasteHandover
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
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { AlertCircle, Download, FileText, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { poslovniDatumZaCas } from "@/lib/posCas";

function parseQuantity(value: string): number {
  const parsed = parseDecimal(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    const nextFixed = Number(next.toFixed(2));
    onChange(String(allowNegative ? nextFixed : Math.max(0, nextFixed)));
  };
  
  return (
    <div className="flex items-center gap-1.5 w-full">
      <Button type="button" variant="outline" className="h-12 w-14 shrink-0 touch-manipulation text-lg font-bold" onClick={() => adjust(-1)} disabled={!allowNegative && amount < 1}>-1</Button>
      <Button type="button" variant="outline" className="h-12 w-14 shrink-0 touch-manipulation text-lg font-bold" onClick={() => adjust(-0.1)} disabled={!allowNegative && amount < 0.1}>-.1</Button>
      
      <div className="relative flex-1">
        <DecimalInput 
          value={value} 
          onChange={(e) => onChange(e.target.value)} 
          className="h-12 text-center text-xl font-bold pr-8" 
          aria-label={label}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium pointer-events-none">kg</span>
      </div>
      
      <Button type="button" variant="outline" className="h-12 w-14 shrink-0 touch-manipulation text-lg font-bold" onClick={() => adjust(0.1)}>+.1</Button>
      <Button type="button" variant="outline" className="h-12 w-14 shrink-0 touch-manipulation text-lg font-bold" onClick={() => adjust(1)}>+1</Button>
    </div>
  );
}

function DailyEntryForm({ onSuccess }: { onSuccess: () => void }) {
  const [date, setDate] = useState(poslovniDatumZaCas);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  
  const saveMutation = useSavePlateWasteDailyEntry();
  const { toast } = useToast();
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseQuantity(quantity);
    if (qty <= 0) {
      toast({ title: "Napaka", description: "Količina mora biti večja od 0", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Napaka", description: "Datum je obvezen", variant: "destructive" });
      return;
    }
    
    saveMutation.mutate({
      date,
      data: {
        quantityKg: qty,
        note: note.trim() || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Shranjeno", description: "Dnevni vnos je bil uspešno shranjen." });
        setQuantity("");
        setNote("");
        onSuccess();
      },
      onError: (err: any) => {
        toast({ title: "Napaka", description: err.message || "Dnevnega vnosa ni bilo mogoče shraniti.", variant: "destructive" });
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Nov dnevni vnos</CardTitle>
        <CardDescription>Zabeleži količino nastalih odpadkov s krožnikov ob koncu izmene (kg).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-xl">
          <div className="grid gap-2">
            <Label htmlFor="daily-date">Datum vnosa</Label>
            <Input id="daily-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="h-12" required />
          </div>
          <div className="grid gap-2">
            <Label>Količina (kg)</Label>
            <TouchQuantityInput label="Količina" value={quantity} onChange={setQuantity} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="daily-note">Opomba (neobvezno)</Label>
            <Input id="daily-note" value={note} onChange={e => setNote(e.target.value)} className="h-12" placeholder="Npr. Povečan ostanek zaradi dogodka..." />
          </div>
          <Button type="submit" disabled={saveMutation.isPending} className="h-12 text-lg mt-2">
            <Save className="w-5 h-5 mr-2" /> {saveMutation.isPending ? "Shranjujem..." : "Shrani dnevni vnos"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DailyEntriesTable({ entries, isLoading }: { entries?: PlateWasteDailyEntry[], isLoading: boolean }) {
  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Nalagam...</div>;
  if (!entries || entries.length === 0) return <div className="py-8 text-center text-muted-foreground border rounded-md bg-muted/20">V tem obdobju ni dnevnih vnosov.</div>;
  
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">Datum</TableHead>
            <TableHead className="text-right w-[140px]">Količina (kg)</TableHead>
            <TableHead>Opomba</TableHead>
            <TableHead className="w-[180px]">Vnesel</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(entry => (
            <TableRow key={entry.id}>
              <TableCell className="font-medium">{format(parseISO(entry.businessDate), "dd. MM. yyyy")}</TableCell>
              <TableCell className="text-right font-semibold">{entry.quantityKg.toFixed(2)}</TableCell>
              <TableCell className="text-muted-foreground">{entry.note || "-"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{entry.createdByName || entry.createdBy}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HandoverForm({ onSuccess }: { onSuccess: () => void }) {
  const [handoverDate, setHandoverDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantity, setQuantity] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [manifestNumber, setManifestNumber] = useState("");
  const [note, setNote] = useState("");
  
  const createMutation = useCreatePlateWasteHandover();
  const { toast } = useToast();
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseQuantity(quantity);
    if (qty <= 0) {
      toast({ title: "Napaka", description: "Količina mora biti večja od 0", variant: "destructive" });
      return;
    }
    if (!handoverDate) {
      toast({ title: "Napaka", description: "Datum je obvezen", variant: "destructive" });
      return;
    }
    if (!collectorName.trim()) {
      toast({ title: "Napaka", description: "Naziv prevzemnika je obvezen", variant: "destructive" });
      return;
    }
    
    createMutation.mutate({
      data: {
        handoverDate,
        entryType: "oddaja",
        quantityKg: qty,
        collectorName: collectorName.trim(),
        manifestNumber: manifestNumber.trim() || undefined,
        note: note.trim() || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Oddaja zabeležena", description: "Oddaja odpadkov je bila uspešno shranjena." });
        setQuantity("");
        setManifestNumber("");
        setNote("");
        onSuccess();
      },
      onError: (err: any) => {
        toast({ title: "Napaka", description: err.message || "Podatkov ni bilo mogoče shraniti.", variant: "destructive" });
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Evidentiraj oddajo</CardTitle>
        <CardDescription>Vnesi podatke ob predaji odpadkov pooblaščenemu prevzemniku.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
            <div className="grid gap-2">
              <Label htmlFor="handover-date">Datum oddaje</Label>
              <Input id="handover-date" type="date" value={handoverDate} onChange={e => setHandoverDate(e.target.value)} className="h-12" required />
            </div>
            <div className="grid gap-2">
              <Label>Količina (kg)</Label>
              <TouchQuantityInput label="Količina" value={quantity} onChange={setQuantity} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="collector">Naziv prevzemnika</Label>
              <Input id="collector" value={collectorName} onChange={e => setCollectorName(e.target.value)} className="h-12" placeholder="Npr. Koto d.o.o." required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manifest">Številka evidenčnega lista (neobvezno)</Label>
              <Input id="manifest" value={manifestNumber} onChange={e => setManifestNumber(e.target.value)} className="h-12" placeholder="Npr. EV-2023-001" />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="handover-note">Opomba (neobvezno)</Label>
              <Input id="handover-note" value={note} onChange={e => setNote(e.target.value)} className="h-12" placeholder="" />
            </div>
          </div>
          <div className="mt-2">
            <Button type="submit" disabled={createMutation.isPending} className="h-12 text-lg w-full sm:w-auto px-8">
              <Save className="w-5 h-5 mr-2" /> {createMutation.isPending ? "Shranjujem..." : "Zabeleži oddajo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function HandoversTable({
  handovers,
  isLoading,
  onCorrect,
  onDownloadPdf,
  downloadingId,
}: {
  handovers?: PlateWasteHandover[];
  isLoading: boolean;
  onCorrect: (h: PlateWasteHandover) => void;
  onDownloadPdf: (handover: PlateWasteHandover) => void;
  downloadingId: number | null;
}) {
  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Nalagam...</div>;
  if (!handovers || handovers.length === 0) return <div className="py-8 text-center text-muted-foreground border rounded-md bg-muted/20">V tem obdobju ni zabeleženih oddaj ali popravkov.</div>;
  
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Datum</TableHead>
            <TableHead className="w-[100px]">Tip</TableHead>
            <TableHead className="text-right w-[140px]">Količina (kg)</TableHead>
            <TableHead>Prevzemnik / Evid. list</TableHead>
            <TableHead>Opomba</TableHead>
            <TableHead className="text-right w-[100px]">Akcija</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {handovers.map(handover => {
             const isCorrection = handover.entryType === "popravek";
             return (
               <TableRow key={handover.id} className={isCorrection ? "bg-muted/30" : ""}>
                 <TableCell className="font-medium">{format(parseISO(handover.handoverDate), "dd. MM. yyyy")}</TableCell>
                 <TableCell>
                   {isCorrection ? <Badge variant="secondary">Popravek</Badge> : <Badge variant="outline">Oddaja</Badge>}
                 </TableCell>
                 <TableCell className={`text-right font-semibold ${isCorrection && handover.quantityKg < 0 ? "text-destructive" : ""}`}>
                   {handover.quantityKg > 0 && isCorrection ? "+" : ""}{handover.quantityKg.toFixed(2)}
                 </TableCell>
                 <TableCell>
                   <div className="font-medium text-sm">{handover.collectorName}</div>
                   {handover.manifestNumber && <div className="text-xs text-muted-foreground">{handover.manifestNumber}</div>}
                 </TableCell>
                 <TableCell className="text-muted-foreground text-sm">
                   {handover.note || "-"}
                   {handover.correctionOfId && <div className="text-xs opacity-70 mt-1">Vezano na ID: {handover.correctionOfId}</div>}
                 </TableCell>
                 <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownloadPdf(handover)}
                        disabled={downloadingId === handover.id}
                        title="Odpri A4 PDF"
                        aria-label={`Odpri A4 PDF za zapis ${handover.id}`}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      {!isCorrection && (
                        <Button variant="ghost" size="sm" onClick={() => onCorrect(handover)}>
                          Popravek
                        </Button>
                      )}
                    </div>
                 </TableCell>
               </TableRow>
             );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function CorrectionDialog({ 
  handover, 
  open, 
  onOpenChange, 
  onSuccess 
}: { 
  handover: PlateWasteHandover | null, 
  open: boolean, 
  onOpenChange: (open: boolean) => void,
  onSuccess: () => void 
}) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  
  const createMutation = useCreatePlateWasteHandover();
  const { toast } = useToast();
  
  useEffect(() => {
    if (open && handover) {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setQuantity(String(-handover.quantityKg));
      setNote(`Popravek za oddajo z dne ${format(parseISO(handover.handoverDate), "dd. MM. yyyy")}`);
    }
  }, [open, handover]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!handover) return;
    
    const qty = parseQuantity(quantity);
    if (qty === 0) {
      toast({ title: "Napaka", description: "Količina popravka ne sme biti 0", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Napaka", description: "Datum je obvezen", variant: "destructive" });
      return;
    }
    
    createMutation.mutate({
      data: {
        handoverDate: date,
        entryType: "popravek",
        quantityKg: qty,
        collectorName: handover.collectorName,
        manifestNumber: handover.manifestNumber || undefined,
        note: note.trim() || undefined,
        correctionOfId: handover.id
      }
    }, {
      onSuccess: () => {
        toast({ title: "Popravek zabeležen", description: "Popravek količine je bil uspešno shranjen." });
        onOpenChange(false);
        onSuccess();
      },
      onError: (err: any) => {
        toast({ title: "Napaka", description: err.message || "Popravka ni bilo mogoče shraniti.", variant: "destructive" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Popravek oddaje</DialogTitle>
          <DialogDescription>
            {handover && `Ustvarjate popravek za oddajo z dne ${format(parseISO(handover.handoverDate), "dd. MM. yyyy")} (originalna količina: ${handover.quantityKg.toFixed(2)} kg). Negativna vrednost zmanjša oddano količino.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid gap-2">
            <Label htmlFor="corr-date">Datum popravka</Label>
            <Input id="corr-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="h-12" required />
          </div>
          <div className="grid gap-2">
            <Label>Količina popravka (kg)</Label>
            <TouchQuantityInput label="Količina popravka" value={quantity} onChange={setQuantity} allowNegative />
            <span className="text-xs text-muted-foreground mt-1">Znak minus (-) pomeni zmanjšanje (storno oddane količine).</span>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="corr-note">Opomba / razlog za popravek</Label>
            <Input id="corr-note" value={note} onChange={e => setNote(e.target.value)} className="h-12" required />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" variant="destructive" disabled={createMutation.isPending}>
              Shrani popravek
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PlateWastePage() {
  const currentBusinessDate = parseISO(poslovniDatumZaCas());
  const [dateFrom, setDateFrom] = useState(() => format(startOfMonth(currentBusinessDate), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(endOfMonth(currentBusinessDate), "yyyy-MM-dd"));
  const [correctionHandover, setCorrectionHandover] = useState<PlateWasteHandover | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);

  const validRange = dateFrom <= dateTo;
  const { data: overview, isLoading, isError } = useGetPlateWasteOverview(
    { from: dateFrom, to: dateTo },
    { query: { enabled: validRange } as any },
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetPlateWasteOverviewQueryKey({ from: dateFrom, to: dateTo }) });
  }, [queryClient, dateFrom, dateTo]);

  const handleExport = async () => {
    try {
      const blob = await downloadPlateWasteExport(
        { from: dateFrom, to: dateTo },
        { responseType: "blob" } as any,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `odpadki-krozniki-${dateFrom}-do-${dateTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Napaka", description: "Napaka pri izvozu podatkov", variant: "destructive" });
    }
  };

  const handleDownloadPdf = async (handover: PlateWasteHandover) => {
    setDownloadingPdfId(handover.id);
    try {
      const blob = await downloadPlateWasteHandoverPdf(handover.id, { responseType: "blob" } as any);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `odpadki-kroznik-${handover.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Napaka", description: "PDF izpisa ni bilo mogoče pripraviti.", variant: "destructive" });
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const summary = overview?.summary || { generatedQuantityKg: 0, handedOverQuantityKg: 0, remainingQuantityKg: 0 };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Odpadki s krožnikov</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {overview ? `${overview.companyName} · ${overview.businessUnitName}` : "Aktivna poslovna enota"} · koda 20 01 08
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-muted/50 px-2 py-1 rounded-md border">
            <Input 
              type="date" 
              value={dateFrom} 
              onChange={e => setDateFrom(e.target.value)} 
              className="h-8 text-sm w-36 border-0 bg-transparent"
            />
            <span className="text-muted-foreground text-sm">-</span>
            <Input 
              type="date" 
              value={dateTo} 
              onChange={e => setDateTo(e.target.value)} 
              className="h-8 text-sm w-36 border-0 bg-transparent"
            />
          </div>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" /> Izvoz (CSV)
          </Button>
        </div>
      </div>

      <Alert className="bg-blue-50/50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800">
        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertTitle>Neodvisna evidenca</AlertTitle>
        <AlertDescription>
          Ta modul je ločena interna evidenca biološko razgradljivih kuhinjskih odpadkov iz ostankov s krožnikov.
          Vnosi ne vplivajo na zalogo, prodajo, normative, pripravljeno hrano, kalo ali računovodstvo.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Nastalo v izbranem obdobju</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.generatedQuantityKg.toFixed(2)} <span className="text-lg text-muted-foreground font-normal">kg</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Oddano in popravki</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.handedOverQuantityKg.toFixed(2)} <span className="text-lg text-muted-foreground font-normal">kg</span></div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Razlika v izbranem obdobju</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.remainingQuantityKg.toFixed(2)} <span className="text-lg text-muted-foreground font-normal">kg</span></div>
          </CardContent>
        </Card>
      </div>

      {!validRange && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Neveljavno obdobje</AlertTitle>
          <AlertDescription>Datum »od« mora biti pred datumom »do« ali enak.</AlertDescription>
        </Alert>
      )}
      {validRange && isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Evidence ni bilo mogoče naložiti</AlertTitle>
          <AlertDescription>Preverite povezavo in poskusite znova.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="daily" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="daily">Dnevni vnosi odpadkov</TabsTrigger>
          <TabsTrigger value="handover">Oddaja prevzemnikom</TabsTrigger>
        </TabsList>
        
        <TabsContent value="daily" className="space-y-6">
          <DailyEntryForm onSuccess={invalidate} />
          <div>
            <h3 className="text-lg font-semibold mb-3">Vnosi v izbranem obdobju</h3>
            <DailyEntriesTable entries={overview?.entries} isLoading={isLoading} />
          </div>
        </TabsContent>
        
        <TabsContent value="handover" className="space-y-6">
          <HandoverForm onSuccess={invalidate} />
          <div>
            <h3 className="text-lg font-semibold mb-3">Oddaje in popravki v izbranem obdobju</h3>
          <HandoversTable
            handovers={overview?.handovers}
            isLoading={isLoading}
            onCorrect={setCorrectionHandover}
            onDownloadPdf={handleDownloadPdf}
            downloadingId={downloadingPdfId}
          />
          </div>
        </TabsContent>
      </Tabs>

      <CorrectionDialog 
        handover={correctionHandover} 
        open={!!correctionHandover} 
        onOpenChange={(open) => !open && setCorrectionHandover(null)}
        onSuccess={invalidate}
      />
    </div>
  );
}
