import { useEffect, useMemo, useState } from "react";
import {
  downloadPreparedFoodWasteRecordPdf,
  getGetPreparedFoodWasteRecordQueryKey,
  getListPreparedFoodDailyHistoryQueryKey,
  getListPreparedFoodWasteRecordsQueryKey,
  getPreviewPreparedFoodWasteRecordQueryKey,
  useConfirmPreparedFoodWasteRecord,
  useCreatePreparedFoodWasteRecord,
  useGetPreparedFoodWasteRecord,
  useListPreparedFoodWasteRecords,
  usePreviewPreparedFoodWasteRecord,
  useUpdatePreparedFoodWasteRecord,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ClipboardList, Eye, FileText, Plus, Save } from "lucide-react";
import { poslovniDatumZaCas } from "@/lib/posCas";

type RecordForm = {
  recordDate: string;
  periodFrom: string;
  periodTo: string;
  wasteObservedAt: string;
  disposalReason: string;
  signaturePerson: string;
  signatureManager: string;
};

const today = () => poslovniDatumZaCas();
const nowLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const emptyForm = (): RecordForm => ({
  recordDate: today(),
  periodFrom: today(),
  periodTo: today(),
  wasteObservedAt: nowLocal(),
  disposalReason: "Pokvarljivost",
  signaturePerson: "",
  signatureManager: "",
});
const isoDate = (value: unknown) => String(value).slice(0, 10);
const localDateTime = (value: unknown) => {
  const date = new Date(String(value));
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function WasteRecordsPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pdfPending, setPdfPending] = useState(false);
  const [form, setForm] = useState<RecordForm>(emptyForm);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: records, isLoading } = useListPreparedFoodWasteRecords({ year });
  const { data: selectedRecord } = useGetPreparedFoodWasteRecord(selectedId ?? 0, {
    query: { enabled: selectedId != null && dialogOpen } as any,
  });
  const draftPeriodChanged = !!selectedRecord
    && selectedRecord.status !== "potrjen"
    && (
      isoDate(selectedRecord.periodFrom) !== form.periodFrom
      || isoDate(selectedRecord.periodTo) !== form.periodTo
    );
  const { data: preview, isLoading: previewLoading } = usePreviewPreparedFoodWasteRecord({
    from: form.periodFrom,
    to: form.periodTo,
  }, {
    query: {
      enabled: dialogOpen
        && (selectedId == null || draftPeriodChanged)
        && !!form.periodFrom
        && !!form.periodTo,
    } as any,
  });
  const createMutation = useCreatePreparedFoodWasteRecord();
  const updateMutation = useUpdatePreparedFoodWasteRecord();
  const confirmMutation = useConfirmPreparedFoodWasteRecord();

  useEffect(() => {
    if (!selectedRecord || selectedRecord.id !== selectedId) return;
    setForm({
      recordDate: isoDate(selectedRecord.recordDate),
      periodFrom: isoDate(selectedRecord.periodFrom),
      periodTo: isoDate(selectedRecord.periodTo),
      wasteObservedAt: localDateTime(selectedRecord.wasteObservedAt),
      disposalReason: selectedRecord.disposalReason,
      signaturePerson: selectedRecord.signaturePerson,
      signatureManager: selectedRecord.signatureManager,
    });
  }, [selectedId, selectedRecord]);

  const shownRecord = selectedId == null ? null : selectedRecord;
  const useFreshPreview = selectedId == null || draftPeriodChanged;
  const shownLines = useFreshPreview ? (preview?.dailyLines ?? []) : (shownRecord?.dailyLines ?? []);
  const shownSummary = useFreshPreview ? (preview?.summaryLines ?? []) : (shownRecord?.summaryLines ?? []);
  const isConfirmed = shownRecord?.status === "potrjen";
  const pending = createMutation.isPending || updateMutation.isPending || confirmMutation.isPending;
  const formValid = useMemo(() => (
    form.recordDate && form.periodFrom && form.periodTo && form.periodFrom <= form.periodTo
    && form.wasteObservedAt && form.disposalReason.trim()
    && form.signaturePerson.trim() && form.signatureManager.trim()
  ), [form]);

  const invalidate = (recordId?: number) => {
    queryClient.invalidateQueries({ queryKey: getListPreparedFoodWasteRecordsQueryKey({ year }) });
    queryClient.invalidateQueries({ queryKey: getListPreparedFoodDailyHistoryQueryKey(year) });
    queryClient.invalidateQueries({ queryKey: getPreviewPreparedFoodWasteRecordQueryKey({
      from: form.periodFrom,
      to: form.periodTo,
    }) });
    if (recordId) queryClient.invalidateQueries({ queryKey: getGetPreparedFoodWasteRecordQueryKey(recordId) });
  };

  const openNew = () => {
    setSelectedId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openExisting = (id: number) => {
    setSelectedId(id);
    setDialogOpen(true);
  };

  const payload = () => ({
    recordDate: form.recordDate,
    periodFrom: form.periodFrom,
    periodTo: form.periodTo,
    wasteObservedAt: new Date(form.wasteObservedAt).toISOString(),
    disposalReason: form.disposalReason.trim(),
    signaturePerson: form.signaturePerson.trim(),
    signatureManager: form.signatureManager.trim(),
  });

  const save = () => {
    if (!formValid || pending) return;
    const callbacks = {
      onSuccess: (record: { id: number }) => {
        setSelectedId(record.id);
        invalidate(record.id);
        toast({ title: "Zapisnik je shranjen", description: "Osnutek lahko še pregledate in nato potrdite." });
      },
      onError: (error: any) => toast({
        title: "Zapisnika ni bilo mogoče shraniti",
        description: error.message,
        variant: "destructive" as const,
      }),
    };
    if (selectedId == null) createMutation.mutate({ data: payload() }, callbacks);
    else updateMutation.mutate({ id: selectedId, data: payload() }, callbacks);
  };

  const confirm = () => {
    if (!selectedId || pending) return;
    confirmMutation.mutate({ id: selectedId }, {
      onSuccess: (record) => {
        invalidate(record.id);
        toast({ title: "Zapisnik je potrjen", description: "Količine kala so atomsko označene kot oddane." });
      },
      onError: (error: any) => toast({
        title: "Zapisnika ni bilo mogoče potrditi",
        description: error.message,
        variant: "destructive",
      }),
    });
  };

  const openPdf = async () => {
    if (!selectedId || pdfPending) return;
    const pdfWindow = window.open("about:blank", "_blank");
    setPdfPending(true);
    try {
      const blob = await downloadPreparedFoodWasteRecordPdf(selectedId);
      const url = URL.createObjectURL(blob);
      if (pdfWindow) pdfWindow.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `zapisnik-kala-${shownRecord?.recordNumber ?? selectedId}.pdf`;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      pdfWindow?.close();
      toast({
        title: "PDF-ja ni bilo mogoče pripraviti",
        description: error instanceof Error ? error.message : "Poskusite znova.",
        variant: "destructive",
      });
    } finally {
      setPdfPending(false);
    }
  };

  const setField = (field: keyof RecordForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Zapisniki kala</CardTitle>
              <CardDescription>Trajni zapis oddaje kala z dnevnimi količinami, rekapitulacijo in podpisoma.</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Label htmlFor="waste-year">Leto:</Label>
                <Input id="waste-year" type="number" min={2000} max={3000} value={year}
                  onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())}
                  className="w-28" />
              </div>
              <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nov zapisnik</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Nalagam...</div>
          ) : !records?.length ? (
            <div className="py-8 text-center text-muted-foreground">Za izbrano leto še ni zapisnikov kala.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[850px]">
                <TableHeader><TableRow>
                  <TableHead>Št.</TableHead><TableHead>Datum</TableHead><TableHead>Obdobje</TableHead><TableHead>Obrat</TableHead>
                  <TableHead>Razlog</TableHead><TableHead className="text-right">Količina</TableHead>
                  <TableHead>Status</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>{records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.recordNumber}</TableCell>
                    <TableCell>{isoDate(record.recordDate)}</TableCell>
                    <TableCell>{isoDate(record.periodFrom)}–{isoDate(record.periodTo)}</TableCell>
                    <TableCell>{record.businessUnitName}</TableCell>
                    <TableCell>{record.disposalReason}</TableCell>
                    <TableCell className="text-right">{record.totalQuantity}</TableCell>
                    <TableCell><Badge variant={record.status === "potrjen" ? "secondary" : "outline"}>
                      {record.status === "potrjen" ? "Potrjen" : "Osnutek"}
                    </Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openExisting(record.id)}>
                      <Eye className="mr-2 h-4 w-4" />Odpri
                    </Button></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />
              {shownRecord ? `Zapisnik kala št. ${shownRecord.recordNumber}` : selectedId ? "Zapisnik kala" : "Nov zapisnik kala"}
            </DialogTitle>
            <DialogDescription>
              {isConfirmed ? "Potrjeni zapisnik je nespremenljiv." : "Količine se pripravijo iz še neoddanega kala v zaključenih dnevnih evidencah."}
            </DialogDescription>
          </DialogHeader>

          {shownRecord && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <strong>{shownRecord.companyName}</strong> · {shownRecord.businessUnitName}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="record-date">Datum zapisnika/odvoza</Label><Input id="record-date" type="date" value={form.recordDate}
              disabled={isConfirmed} onChange={(e) => setField("recordDate", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="period-from">Obdobje od</Label><Input id="period-from" type="date" value={form.periodFrom}
              disabled={isConfirmed} onChange={(e) => setField("periodFrom", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="period-to">Obdobje do</Label><Input id="period-to" type="date" value={form.periodTo}
              disabled={isConfirmed} onChange={(e) => setField("periodTo", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="waste-observed-at">Ugotovitev kala</Label><Input id="waste-observed-at" type="datetime-local" value={form.wasteObservedAt}
              disabled={isConfirmed} onChange={(e) => setField("wasteObservedAt", e.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="disposal-reason">Razlog odpisa</Label><Textarea id="disposal-reason" value={form.disposalReason}
              disabled={isConfirmed} onChange={(e) => setField("disposalReason", e.target.value)}
              placeholder="Naravni kalo, poškodbe, potek roka, pokvarljivost ..." /></div>
            <div className="space-y-2"><Label htmlFor="signature-person">Podpis osebe, ki je kalo ugotovila/predala</Label><Input id="signature-person" value={form.signaturePerson}
              disabled={isConfirmed} onChange={(e) => setField("signaturePerson", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="signature-manager">Podpis odg. osebe</Label><Input id="signature-manager" value={form.signatureManager}
              disabled={isConfirmed} onChange={(e) => setField("signatureManager", e.target.value)} /></div>
          </div>

          {previewLoading ? <div className="py-8 text-center text-muted-foreground">Pripravljam količine...</div> : (
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 font-semibold">Artikli po dnevih</h3>
                <div className="max-h-56 overflow-auto rounded-md border">
                  <Table><TableHeader><TableRow><TableHead>Datum</TableHead><TableHead>Artikel</TableHead>
                    <TableHead>EM</TableHead><TableHead className="text-right">Količina</TableHead>
                  </TableRow></TableHeader><TableBody>{shownLines.length ? shownLines.map((line) => (
                    <TableRow key={`${isoDate(line.businessDate)}-${line.articleId}`}>
                      <TableCell>{isoDate(line.businessDate)}</TableCell><TableCell>{line.articleName}</TableCell>
                      <TableCell>{line.unitOfMeasure}</TableCell><TableCell className="text-right">{line.quantity}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">
                    V obdobju ni neoddanega kala iz zaključenih evidenc.
                  </TableCell></TableRow>}</TableBody></Table>
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Rekapitulacija</h3>
                <div className="rounded-md border">
                  <Table><TableHeader><TableRow><TableHead>Artikel</TableHead><TableHead>EM</TableHead>
                    <TableHead className="text-right">Skupaj</TableHead>
                  </TableRow></TableHeader><TableBody>{shownSummary.map((line) => (
                    <TableRow key={line.articleId}><TableCell>{line.articleName}</TableCell>
                      <TableCell>{line.unitOfMeasure}</TableCell><TableCell className="text-right font-semibold">{line.quantity}</TableCell>
                    </TableRow>
                  ))}</TableBody></Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Zapri</Button>
            {selectedId && <Button variant="outline" onClick={openPdf} disabled={pdfPending || !shownRecord}>
              <FileText className="mr-2 h-4 w-4" />{pdfPending ? "Pripravljam PDF ..." : "Odpri A4 PDF"}
            </Button>}
            {!isConfirmed && <Button onClick={save} disabled={!formValid || !shownLines.length || pending}>
              <Save className="mr-2 h-4 w-4" />{selectedId ? "Osveži in shrani" : "Shrani osnutek"}
            </Button>}
            {selectedId && !isConfirmed && <Button variant="destructive" onClick={confirm} disabled={pending || draftPeriodChanged}>
              <CheckCircle2 className="mr-2 h-4 w-4" />Potrdi zapisnik
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}