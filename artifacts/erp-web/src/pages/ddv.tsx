import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListVatCodes, 
  useCreateVatCode, 
  useUpdateVatCode, 
  useSeedVatCodes, 
  useListAccounts,
  useListPeriods,
  useGetVatRegister,
  useGetVatReturn,
  getListVatCodesQueryKey,
  type VatCodeRecord
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Plus, Sprout, Loader2, Edit, Printer, Download } from "lucide-react";

// --- VAT CODES TAB ---
function VatCodesTab() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useListVatCodes(activeCompany?.id ?? "", { includeInactive: true }, { query: { enabled: !!activeCompany?.id } as any });
  const vatCodes = data?.vatCodes ?? [];
  const seedMut = useSeedVatCodes();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editCode, setEditCode] = useState<VatCodeRecord | null>(null);

  const handleSeed = () => {
    if (!activeCompany) return;
    seedMut.mutate({ companyId: activeCompany.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVatCodesQueryKey(activeCompany.id) });
      }
    });
  };

  const openNew = () => { setEditCode(null); setSheetOpen(true); };
  const openEdit = (code: VatCodeRecord) => { setEditCode(code); setSheetOpen(true); };

  if (error) return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle><AlertDescription>Prišlo je do napake pri nalaganju DDV kod.</AlertDescription></Alert>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-tight">DDV Šifranti</h2>
        <div className="flex items-center gap-2">
          {vatCodes.length === 0 && activeCompany?.role !== "viewer" && (
            <Button variant="outline" onClick={handleSeed} disabled={seedMut.isPending}>
              {seedMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
              Posej slovenske DDV kode
            </Button>
          )}
          {activeCompany?.role !== "viewer" && (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Nova DDV koda
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Koda</TableHead>
                <TableHead>Naziv</TableHead>
                <TableHead className="text-right">Stopnja %</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Konto izstopni</TableHead>
                <TableHead>Konto vstopni</TableHead>
                <TableHead>Veljavnost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vatCodes.map(code => (
                <TableRow key={code.id}>
                  <TableCell className="font-medium">{code.code}</TableCell>
                  <TableCell>{code.name}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={
                      parseFloat(code.rate) === 22 ? "text-blue-600 border-blue-200 bg-blue-50" :
                      parseFloat(code.rate) === 9.5 ? "text-purple-600 border-purple-200 bg-purple-50" :
                      "text-slate-600 border-slate-200 bg-slate-50"
                    }>
                      {parseFloat(code.rate)}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      code.behavior === 'standard' ? 'bg-blue-100 text-blue-800' :
                      code.behavior === 'exempt' ? 'bg-slate-100 text-slate-800' :
                      code.behavior === 'zero_rated' ? 'bg-emerald-100 text-emerald-800' :
                      'bg-orange-100 text-orange-800'
                    }>
                      {code.behavior}
                    </Badge>
                  </TableCell>
                  <TableCell><span className="text-muted-foreground text-xs">{code.accountOutputCode || "-"}</span></TableCell>
                  <TableCell><span className="text-muted-foreground text-xs">{code.accountInputCode || "-"}</span></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {code.validFrom ? new Date(code.validFrom).toLocaleDateString("sl-SI") : "Vedno"} - {code.validTo ? new Date(code.validTo).toLocaleDateString("sl-SI") : "Naprej"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={code.isActive ? "default" : "secondary"} className={code.isActive ? "bg-green-600 hover:bg-green-700" : ""}>
                      {code.isActive ? "Aktivna" : "Neaktivna"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {activeCompany?.role !== "viewer" && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(code)}>
                        <Edit className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {vatCodes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Ni najdenih DDV kod</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {sheetOpen && <VatCodeSheet open={sheetOpen} onOpenChange={setSheetOpen} editCode={editCode} />}
    </div>
  );
}

function VatCodeSheet({ open, onOpenChange, editCode }: { open: boolean, onOpenChange: (open: boolean) => void, editCode: VatCodeRecord | null }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const isEdit = !!editCode;

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id && open } as any });
  const accounts = accountsData?.accounts?.filter(a => a.isActive) || [];

  const [formData, setFormData] = useState({
    code: editCode?.code || "",
    name: editCode?.name || "",
    rate: editCode ? parseFloat(editCode.rate) : 22,
    behavior: editCode?.behavior || "standard",
    accountOutputId: editCode?.accountOutputId || "none",
    accountInputId: editCode?.accountInputId || "none",
    validFrom: editCode?.validFrom?.split("T")[0] || "",
    validTo: editCode?.validTo?.split("T")[0] || "",
    notes: editCode?.notes || "",
    isActive: editCode?.isActive ?? true
  });

  const createMut = useCreateVatCode();
  const updateMut = useUpdateVatCode();

  const handleSave = () => {
    if (!activeCompany) return;
    
    const payload = {
      name: formData.name,
      rate: formData.rate,
      behavior: formData.behavior,
      accountOutputId: formData.accountOutputId !== "none" ? formData.accountOutputId : null,
      accountInputId: formData.accountInputId !== "none" ? formData.accountInputId : null,
      validFrom: formData.validFrom || null,
      validTo: formData.validTo || null,
      notes: formData.notes || null,
    };

    if (isEdit) {
      updateMut.mutate({
        companyId: activeCompany.id,
        id: editCode.id,
        data: { ...payload, isActive: formData.isActive }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVatCodesQueryKey(activeCompany.id) });
          onOpenChange(false);
        }
      });
    } else {
      createMut.mutate({
        companyId: activeCompany.id,
        data: { code: formData.code, ...payload }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVatCodesQueryKey(activeCompany.id) });
          onOpenChange(false);
        }
      });
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const canSave = formData.code && formData.name;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>{isEdit ? "Uredi DDV kodo" : "Nova DDV koda"}</SheetTitle>
          <SheetDescription>Vnesite nastavitve davčne kode in računovodske konte.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Koda <span className="text-destructive">*</span></Label>
            <Input value={formData.code} onChange={e => setFormData(p => ({ ...p, code: e.target.value }))} disabled={isEdit} placeholder="Npr. DDV22" />
          </div>
          <div className="space-y-2">
            <Label>Naziv <span className="text-destructive">*</span></Label>
            <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Npr. Splošna stopnja 22%" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Stopnja % <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" max="100" step="0.5" value={formData.rate} onChange={e => setFormData(p => ({ ...p, rate: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-2">
              <Label>Tip</Label>
              <Select value={formData.behavior} onValueChange={val => setFormData(p => ({ ...p, behavior: val as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standardno</SelectItem>
                  <SelectItem value="exempt">Oproščeno (Exempt)</SelectItem>
                  <SelectItem value="zero_rated">Ničelna (0%)</SelectItem>
                  <SelectItem value="reverse_charge">Obrnjena davčna (RC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Konto izstopnega DDV <span className="text-muted-foreground text-xs font-normal ml-2">(za izdane račune 26x, 45x)</span></Label>
            <Select value={formData.accountOutputId} onValueChange={val => setFormData(p => ({ ...p, accountOutputId: val }))}>
              <SelectTrigger><SelectValue placeholder="Izberi konto..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brez konta</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Konto vstopnega DDV <span className="text-muted-foreground text-xs font-normal ml-2">(za prejete račune 16x)</span></Label>
            <Select value={formData.accountInputId} onValueChange={val => setFormData(p => ({ ...p, accountInputId: val }))}>
              <SelectTrigger><SelectValue placeholder="Izberi konto..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brez konta</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Veljavno od</Label>
              <Input type="date" value={formData.validFrom} onChange={e => setFormData(p => ({ ...p, validFrom: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Veljavno do</Label>
              <Input type="date" value={formData.validTo} onChange={e => setFormData(p => ({ ...p, validTo: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Opombe</Label>
            <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={2} />
          </div>

          {isEdit && (
            <div className="flex items-center space-x-2 pt-2">
              <input type="checkbox" id="isActive" checked={formData.isActive} onChange={e => setFormData(p => ({ ...p, isActive: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <Label htmlFor="isActive" className="font-normal cursor-pointer">Koda je aktivna</Label>
            </div>
          )}
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={handleSave} disabled={!canSave || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Shrani
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// --- VAT REGISTER TAB (IR/PR) ---
function VatRegisterTab() {
  const { activeCompany } = useCompany();
  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  
  const [periodId, setPeriodId] = useState<string>("");
  const [type, setType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Set default period if empty
  React.useEffect(() => {
    if (periods.length > 0 && !periodId) {
      setPeriodId(periods[periods.length - 1].id);
    }
  }, [periods, periodId]);

  const { data, isLoading, error } = useGetVatRegister(
    activeCompany?.id ?? "",
    {
      periodId: periodId || "none",
      type: type !== "all" ? (type as any) : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    },
    { query: { enabled: !!(activeCompany?.id && periodId) } as any }
  );

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-tight">Knjiga IR/PR</h2>
        <Button variant="outline">
          <Printer className="mr-2 h-4 w-4" />
          Izvozi
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="space-y-1.5 w-full sm:w-[200px]">
          <Label className="text-xs font-medium text-muted-foreground">Obdobje <span className="text-destructive">*</span></Label>
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger><SelectValue placeholder="Izberite obdobje" /></SelectTrigger>
            <SelectContent>
              {periods.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-full sm:w-[150px]">
          <Label className="text-xs font-medium text-muted-foreground">Knjiga</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Obe knjigi</SelectItem>
              <SelectItem value="issued">Knjiga IR (Izdani)</SelectItem>
              <SelectItem value="received">Knjiga PR (Prejeti)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-full sm:w-[150px]">
          <Label className="text-xs font-medium text-muted-foreground">Od datuma</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>

        <div className="space-y-1.5 w-full sm:w-[150px]">
          <Label className="text-xs font-medium text-muted-foreground">Do datuma</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        {(type !== "all" || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setType("all"); setDateFrom(""); setDateTo(""); }} className="text-muted-foreground">
            Počisti filtre
          </Button>
        )}
      </div>

      {!periodId ? (
        <div className="text-center py-12 border rounded-lg bg-card text-muted-foreground">
          Izberite obdobje za prikaz knjige DDV.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : error ? (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle><AlertDescription>Napaka pri nalaganju.</AlertDescription></Alert>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-card text-muted-foreground">
          Ni vnosov za izbrane filtre.
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Račun</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Davčna št.</TableHead>
                <TableHead>DDV koda</TableHead>
                <TableHead className="text-right">Stopnja %</TableHead>
                <TableHead className="text-right">Osnova</TableHead>
                <TableHead className="text-right">DDV</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(entry => (
                <TableRow key={`${entry.invoiceId}-${entry.vatCodeId}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={entry.invoiceType === 'issued' ? 'border-blue-200 text-blue-700 bg-blue-50' : 'border-amber-200 text-amber-700 bg-amber-50'}>
                        {entry.invoiceType === 'issued' ? 'IR' : 'PR'}
                      </Badge>
                      <span className="font-medium">{entry.invoiceNumber}</span>
                    </div>
                  </TableCell>
                  <TableCell>{new Date(entry.invoiceDate).toLocaleDateString("sl-SI")}</TableCell>
                  <TableCell>{entry.counterpartyName}</TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{entry.counterpartyTaxId || "-"}</span></TableCell>
                  <TableCell><span className="text-xs font-mono">{entry.vatCode || "-"}</span></TableCell>
                  <TableCell className="text-right">{parseFloat(entry.vatRate)}%</TableCell>
                  <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(entry.vatBase))} €</TableCell>
                  <TableCell className="text-right text-muted-foreground">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(entry.vatAmount))} €</TableCell>
                  <TableCell className="text-right font-semibold">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(entry.grossAmount))} €</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot className="border-t bg-muted/50 font-medium">
              <TableRow>
                <TableCell colSpan={6} className="text-right">Skupaj:</TableCell>
                <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(data?.totalVatBase || "0"))} €</TableCell>
                <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(data?.totalVatAmount || "0"))} €</TableCell>
                <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(data?.totalGross || "0"))} €</TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </div>
      )}
    </div>
  );
}

// --- VAT RETURN TAB (DDV-O) ---
function VatReturnTab() {
  const { activeCompany } = useCompany();
  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  
  const [periodId, setPeriodId] = useState<string>("");

  React.useEffect(() => {
    if (periods.length > 0 && !periodId) {
      setPeriodId(periods[periods.length - 1].id);
    }
  }, [periods, periodId]);

  const { data, isLoading, error } = useGetVatReturn(
    activeCompany?.id ?? "",
    { periodId: periodId || "none" },
    { query: { enabled: !!(activeCompany?.id && periodId) } as any }
  );

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const netVatTotal = parseFloat(totals?.netVat || "0");
  const isReceivable = netVatTotal < 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-tight">Obračun DDV (DDV-O)</h2>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Prenesi XML
        </Button>
      </div>

      <div className="flex gap-4 items-end bg-card p-4 rounded-lg border shadow-sm">
        <div className="space-y-1.5 w-[250px]">
          <Label className="text-xs font-medium text-muted-foreground">Obdobje (Mesec / Kvartal) <span className="text-destructive">*</span></Label>
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger><SelectValue placeholder="Izberite obdobje" /></SelectTrigger>
            <SelectContent>
              {periods.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!periodId ? (
        <div className="text-center py-12 border rounded-lg bg-card text-muted-foreground">
          Izberite obdobje za prikaz obračuna.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : error ? (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle><AlertDescription>Napaka pri nalaganju.</AlertDescription></Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Izstopni DDV skupaj (Obveznost)</CardDescription>
                <CardTitle className="text-2xl text-red-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals?.outputVat || "0"))} €</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Vstopni DDV skupaj (Odbitek)</CardDescription>
                <CardTitle className="text-2xl text-blue-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals?.inputVat || "0"))} €</CardTitle>
              </CardHeader>
            </Card>
            <Card className={isReceivable ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}>
              <CardHeader className="pb-2">
                <CardDescription>{isReceivable ? "Neto terjatev do države" : "Neto obveznost za plačilo"}</CardDescription>
                <CardTitle className={`text-3xl ${isReceivable ? "text-green-700" : "text-red-700"}`}>
                  {new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(netVatTotal))} €
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DDV Koda</TableHead>
                  <TableHead className="text-right">Stopnja</TableHead>
                  <TableHead className="text-right">Izstopna osnova</TableHead>
                  <TableHead className="text-right text-red-600">Izstopni DDV</TableHead>
                  <TableHead className="text-right">Vstopna osnova</TableHead>
                  <TableHead className="text-right text-blue-600">Vstopni DDV</TableHead>
                  <TableHead className="text-right">Neto DDV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const net = parseFloat(row.netVat);
                  return (
                    <TableRow key={row.vatCodeId || row.vatCode || Math.random().toString()}>
                      <TableCell>
                        <div className="font-medium">{row.vatCode || "Neznano"}</div>
                        <div className="text-xs text-muted-foreground">{row.vatCodeName}</div>
                      </TableCell>
                      <TableCell className="text-right">{parseFloat(row.vatRate)}%</TableCell>
                      <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(row.outputBase))} €</TableCell>
                      <TableCell className="text-right text-red-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(row.outputVat))} €</TableCell>
                      <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(row.inputBase))} €</TableCell>
                      <TableCell className="text-right text-blue-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(row.inputVat))} €</TableCell>
                      <TableCell className={`text-right font-medium ${net < 0 ? 'text-green-600' : net > 0 ? 'text-red-600' : ''}`}>
                        {new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(net)} €
                      </TableCell>
                    </TableRow>
                  )
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Ni podatkov za prikaz</TableCell>
                  </TableRow>
                )}
              </TableBody>
              {totals && (
                <tfoot className="border-t bg-muted/30 font-bold">
                  <TableRow>
                    <TableCell colSpan={2} className="text-right">SKUPAJ:</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals.outputBase))} €</TableCell>
                    <TableCell className="text-right text-red-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals.outputVat))} €</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals.inputBase))} €</TableCell>
                    <TableCell className="text-right text-blue-600">{new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(totals.inputVat))} €</TableCell>
                    <TableCell className={`text-right text-lg ${isReceivable ? "text-green-600" : "text-red-600"}`}>
                      {new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(netVatTotal)} €
                    </TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// --- MAIN PAGE ---
export default function Ddv() {
  const [activeTab, setActiveTab] = useState("vat_register");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">DDV evidence</h1>
        <p className="text-muted-foreground mt-1">Knjige izdanih in prejetih računov, DDV-O obrazec in šifranti davkov.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="vat_register">Knjiga IR/PR</TabsTrigger>
          <TabsTrigger value="vat_return">DDV-O Obračun</TabsTrigger>
          <TabsTrigger value="vat_codes">DDV Šifranti</TabsTrigger>
        </TabsList>

        <TabsContent value="vat_register" className="mt-0">
          <VatRegisterTab />
        </TabsContent>

        <TabsContent value="vat_return" className="mt-0">
          <VatReturnTab />
        </TabsContent>

        <TabsContent value="vat_codes" className="mt-0">
          <VatCodesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
