import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus,
  Loader2,
  AlertCircle,
  Receipt,
  FileText,
  Search,
  ArrowRightLeft,
  CheckCircle2,
  Trash2,
  X
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListInvoices,
  useGetInvoice,
  useCreateInvoice,
  usePostInvoice,
  useVoidInvoice,
  useListCounterparties,
  useListPeriods,
  useListAccounts,
  getListInvoicesQueryKey,
  type InvoiceRecord
} from "@workspace/api-client-react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STATUS_LABELS: Record<string, string> = {
  draft: "Osnutek",
  posted: "Knjiženo",
  paid: "Plačano",
  void: "Razveljavljen"
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  posted: "default",
  paid: "default",
  void: "secondary"
};

export default function Racuni() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("issued");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];

  const { data, isLoading, error } = useListInvoices(
    activeCompany?.id ?? "",
    {
      type: activeTab as "issued" | "received",
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      periodId: periodFilter !== "all" ? periodFilter : undefined,
    },
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const invoices = data?.invoices ?? [];

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRecord | null>(null);

  const postMut = usePostInvoice();
  
  const handlePost = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!activeCompany) return;
    if (window.confirm("Ali res želite poknjižiti račun? Osnutek bo zaključen.")) {
      postMut.mutate({ companyId: activeCompany.id, id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(activeCompany.id) });
        }
      });
    }
  };

  const [voidInvoiceId, setVoidInvoiceId] = useState<string | null>(null);

  const clearFilters = () => {
    setStatusFilter("all");
    setPeriodFilter("all");
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju računov.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Računi</h1>
          <p className="text-muted-foreground mt-1">Upravljanje izdanih in prejetih računov.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewSheetOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nov račun
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center bg-card p-4 rounded-lg border shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="issued">Izdani računi</TabsTrigger>
            <TabsTrigger value="received">Prejeti računi</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full sm:w-auto ml-auto">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Obdobje</Label>
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Vsa obdobja" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsa obdobja</SelectItem>
                {periods.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Vsi statusi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsi statusi</SelectItem>
                <SelectItem value="draft">Osnutek</SelectItem>
                <SelectItem value="posted">Knjiženo</SelectItem>
                <SelectItem value="paid">Plačano</SelectItem>
                <SelectItem value="void">Razveljavljen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {(periodFilter !== "all" || statusFilter !== "all") && (
          <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground ml-auto sm:ml-0 mt-4 sm:mt-0">
            Počisti filtre
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Receipt className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Ni najdenih računov</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Za izbrane filtre ni bilo mogoče najti nobenega računa.
          </p>
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewSheetOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Ustvari prvi račun
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Številka</TableHead>
                <TableHead className="w-[100px]">Datum</TableHead>
                <TableHead className="w-[100px]">Zapadlost</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Neto</TableHead>
                <TableHead className="text-right">DDV</TableHead>
                <TableHead className="text-right">Skupaj</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[120px] text-right">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map(inv => (
                <TableRow 
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setDetailInvoice(inv)}
                >
                  <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell>{new Date(inv.invoiceDate).toLocaleDateString("sl-SI")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("sl-SI") : "-"}
                  </TableCell>
                  <TableCell>{inv.counterpartyName}</TableCell>
                  <TableCell className="text-right">{parseFloat(inv.totalNet).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{parseFloat(inv.totalVat).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-semibold">{parseFloat(inv.totalGross).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge 
                      variant={STATUS_VARIANTS[inv.status]} 
                      className={
                        inv.status === 'posted' ? 'bg-green-600 hover:bg-green-700' :
                        inv.status === 'paid' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''
                      }
                    >
                      {STATUS_LABELS[inv.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {inv.status === "draft" && activeCompany?.role !== "viewer" && (
                      <Button variant="outline" size="sm" onClick={(e) => handlePost(e, inv.id)} disabled={postMut.isPending}>
                        <CheckCircle2 className="mr-1.5 h-3 w-3 text-green-600" />
                        Poknjiži
                      </Button>
                    )}
                    {inv.status === "posted" && activeCompany?.role !== "viewer" && (
                      <Button variant="outline" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        setVoidInvoiceId(inv.id);
                      }}>
                        <ArrowRightLeft className="mr-1.5 h-3 w-3 text-destructive" />
                        Storno
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {newSheetOpen && (
        <NewInvoiceSheet 
          open={newSheetOpen} 
          onOpenChange={setNewSheetOpen} 
          defaultType={activeTab as "issued" | "received"}
        />
      )}

      {detailInvoice && (
        <DetailInvoiceSheet
          open={!!detailInvoice}
          onOpenChange={(v) => { if (!v) setDetailInvoice(null); }}
          invoice={detailInvoice}
          onVoid={() => {
            setDetailInvoice(null);
            setVoidInvoiceId(detailInvoice.id);
          }}
        />
      )}

      {voidInvoiceId && (
        <VoidInvoiceDialog
          open={!!voidInvoiceId}
          onOpenChange={(v) => { if (!v) setVoidInvoiceId(null); }}
          invoiceId={voidInvoiceId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEW INVOICE SHEET
// ---------------------------------------------------------------------------

function NewInvoiceSheet({ open, onOpenChange, defaultType }: { open: boolean, onOpenChange: (open: boolean) => void, defaultType: "issued" | "received" }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id && open } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];
  const cpTypeForInvoice = defaultType === "issued" ? "customer" : "supplier";
  const validCounterparties = counterparties.filter(c => c.type === cpTypeForInvoice || c.type === "both");

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id && open } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id && open } as any });
  const accounts = accountsData?.accounts?.filter(a => a.isActive) || [];

  // AR/AP Accounts: 120 (Kupci) / 220 (Dobavitelji) - as an example, adjust as needed. Often 140/430.
  const arapPrefix = defaultType === "issued" ? "120" : "220";
  const arapAccounts = accounts.filter(a => a.code.startsWith(arapPrefix) || a.code.startsWith("140") || a.code.startsWith("430"));

  // VAT Accounts: 450 (DDV obveznosti) za izdane, 160 (vstopni DDV) za prejete
  const vatPrefix = defaultType === "issued" ? "450" : "160";
  const vatAccounts = accounts.filter(a => a.code.startsWith(vatPrefix));

  // Revenue/Expense accounts
  const revExpAccounts = accounts.filter(a => a.code.startsWith("7") || a.code.startsWith("4"));

  const [formData, setFormData] = useState({
    type: defaultType,
    counterpartyId: "",
    periodId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().split("T")[0],
    dueDate: "",
    arApAccountId: "",
    vatAccountId: "",
    notes: ""
  });

  const [lines, setLines] = useState([
    { id: "1", description: "", quantity: "1", unitPrice: "0", vatRate: "22" as "0" | "9.5" | "22", accountId: "" }
  ]);

  const addLine = () => setLines([...lines, { id: Math.random().toString(), description: "", quantity: "1", unitPrice: "0", vatRate: "22", accountId: "" }]);
  const removeLine = (id: string) => { if (lines.length > 1) setLines(lines.filter(l => l.id !== id)); };
  const updateLine = (id: string, field: string, val: any) => setLines(lines.map(l => l.id === id ? { ...l, [field]: val } : l));

  // Set defaults
  React.useEffect(() => {
    if (open && openPeriods.length > 0 && !formData.periodId) {
      setFormData(prev => ({ ...prev, periodId: openPeriods[0].id }));
    }
  }, [open, openPeriods, formData.periodId]);

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    lines.forEach(l => {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      const r = parseFloat(l.vatRate) || 0;
      const lineNet = q * p;
      net += lineNet;
      vat += lineNet * (r / 100);
    });
    return { net, vat, gross: net + vat };
  }, [lines]);

  const createMut = useCreateInvoice();

  const handleSave = () => {
    if (!activeCompany) return;
    
    const validLines = lines.filter(l => l.description && l.accountId).map(l => ({
      description: l.description,
      quantity: parseFloat(l.quantity) || 1,
      unitPrice: parseFloat(l.unitPrice) || 0,
      vatRate: parseFloat(l.vatRate) as 0 | 9.5 | 22,
      accountId: l.accountId
    }));

    if (validLines.length === 0) return;

    createMut.mutate({
      companyId: activeCompany.id,
      data: {
        type: formData.type,
        counterpartyId: formData.counterpartyId,
        periodId: formData.periodId,
        invoiceNumber: formData.invoiceNumber,
        invoiceDate: formData.invoiceDate,
        dueDate: formData.dueDate || null,
        arApAccountId: formData.arApAccountId,
        vatAccountId: (formData.vatAccountId && formData.vatAccountId !== "none") ? formData.vatAccountId : null,
        notes: formData.notes || null,
        lines: validLines
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(activeCompany.id) });
        onOpenChange(false);
      }
    });
  };

  const canSave = formData.counterpartyId && formData.periodId && formData.invoiceNumber && formData.arApAccountId && lines.some(l => l.description && l.accountId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>Nov {formData.type === "issued" ? "izdan" : "prejet"} račun</SheetTitle>
          <SheetDescription>Vnesite podatke za nov račun.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tip računa</Label>
              <Select value={formData.type} onValueChange={(val: any) => setFormData(p => ({ ...p, type: val, counterpartyId: "" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issued">Izdani račun</SelectItem>
                  <SelectItem value="received">Prejeti račun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Partner <span className="text-destructive">*</span></Label>
              <Select value={formData.counterpartyId} onValueChange={val => setFormData(p => ({ ...p, counterpartyId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite partnerja" />
                </SelectTrigger>
                <SelectContent>
                  {validCounterparties.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                  {validCounterparties.length === 0 && <SelectItem value="none" disabled>Ni partnerjev</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Obdobje <span className="text-destructive">*</span></Label>
              <Select value={formData.periodId} onValueChange={val => setFormData(p => ({ ...p, periodId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite obdobje" />
                </SelectTrigger>
                <SelectContent>
                  {openPeriods.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Številka računa <span className="text-destructive">*</span></Label>
              <Input value={formData.invoiceNumber} onChange={e => setFormData(p => ({ ...p, invoiceNumber: e.target.value }))} placeholder="Npr. 2024-001" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Datum izdaje <span className="text-destructive">*</span></Label>
              <Input type="date" value={formData.invoiceDate} onChange={e => setFormData(p => ({ ...p, invoiceDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Rok plačila</Label>
              <Input type="date" value={formData.dueDate} onChange={e => setFormData(p => ({ ...p, dueDate: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 border rounded-md bg-muted/10">
            <div className="space-y-2">
              <Label>Konto {formData.type === "issued" ? "terjatev" : "obveznosti"} <span className="text-destructive">*</span></Label>
              <Select value={formData.arApAccountId} onValueChange={val => setFormData(p => ({ ...p, arApAccountId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite konto" />
                </SelectTrigger>
                <SelectContent>
                  {arapAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Konto DDV</Label>
              <Select value={formData.vatAccountId} onValueChange={val => setFormData(p => ({ ...p, vatAccountId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Brez DDV konta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez DDV konta</SelectItem>
                  {vatAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold">Postavke (Vrstice)</h3>
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Dodaj
              </Button>
            </div>

            <div className="border rounded-md divide-y bg-card">
              {lines.map(line => (
                <div key={line.id} className="p-3 grid gap-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Opis <span className="text-destructive">*</span></Label>
                      <Input value={line.description} onChange={e => updateLine(line.id, "description", e.target.value)} className="h-9" placeholder="Storitev..." />
                    </div>
                    {lines.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-9 w-9 mt-5 text-muted-foreground hover:text-destructive" onClick={() => removeLine(line.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-[80px_100px_80px_1fr] gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Kol.</Label>
                      <Input type="number" min="0" value={line.quantity} onChange={e => updateLine(line.id, "quantity", e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Cena (Neto)</Label>
                      <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={e => updateLine(line.id, "unitPrice", e.target.value)} className="h-9 text-right" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">DDV %</Label>
                      <Select value={line.vatRate} onValueChange={val => updateLine(line.id, "vatRate", val)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">0%</SelectItem>
                          <SelectItem value="9.5">9.5%</SelectItem>
                          <SelectItem value="22">22%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Prih./Odh. Konto <span className="text-destructive">*</span></Label>
                      <Select value={line.accountId} onValueChange={val => updateLine(line.id, "accountId", val)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Izberi..." />
                        </SelectTrigger>
                        <SelectContent>
                          {revExpAccounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-md border bg-muted/30">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Skupaj Neto:</span>
                  <span>{totals.net.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Skupaj DDV:</span>
                  <span>{totals.vat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t">
                  <span>Skupaj za plačilo:</span>
                  <span>{totals.gross.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Opombe (Neobvezno)</Label>
            <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Dodatna navodila za plačilo..." />
          </div>
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={handleSave} disabled={!canSave || createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Shrani račun
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// DETAIL INVOICE SHEET
// ---------------------------------------------------------------------------

function DetailInvoiceSheet({ open, onOpenChange, invoice, onVoid }: { open: boolean, onOpenChange: (open: boolean) => void, invoice: InvoiceRecord, onVoid: () => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: fullInvoice, isLoading } = useGetInvoice(
    activeCompany?.id ?? "",
    invoice.id,
    { query: { enabled: !!activeCompany?.id && open } as any }
  );

  const lines = fullInvoice?.lines ?? [];
  const postMut = usePostInvoice();

  const handlePost = () => {
    if (!activeCompany) return;
    if (window.confirm("Ali res želite poknjižiti račun?")) {
      postMut.mutate({ companyId: activeCompany.id, id: invoice.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(activeCompany.id) });
          onOpenChange(false);
        }
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <div className="flex justify-between items-start">
            <div>
              <SheetTitle>Račun {invoice.invoiceNumber}</SheetTitle>
              <SheetDescription>{invoice.type === 'issued' ? 'Izdan račun' : 'Prejet račun'}</SheetDescription>
            </div>
            <Badge variant={STATUS_VARIANTS[invoice.status]} className={invoice.status === 'posted' ? 'bg-green-600' : ''}>
              {STATUS_LABELS[invoice.status]}
            </Badge>
          </div>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm bg-muted/20 p-4 rounded-lg border">
            <div>
              <div className="text-muted-foreground mb-1">Partner</div>
              <div className="font-medium">{invoice.counterpartyName}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Obdobje</div>
              <div className="font-medium">{invoice.periodName}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Datum izdaje</div>
              <div className="font-medium">{new Date(invoice.invoiceDate).toLocaleDateString("sl-SI")}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Rok plačila</div>
              <div className="font-medium">{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("sl-SI") : "-"}</div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Postavke</h3>
            <div className="border rounded-md overflow-hidden bg-card">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Opis</TableHead>
                    <TableHead className="text-right">Kol</TableHead>
                    <TableHead className="text-right">Cena</TableHead>
                    <TableHead className="text-right">DDV %</TableHead>
                    <TableHead className="text-right">Skupaj</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : lines.length > 0 ? (
                    lines.map((line: any) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="font-medium">{line.description}</div>
                          <div className="text-xs text-muted-foreground">Konto: {line.accountCode}</div>
                        </TableCell>
                        <TableCell className="text-right">{parseFloat(line.quantity).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{parseFloat(line.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{parseFloat(line.vatRate)}%</TableCell>
                        <TableCell className="text-right">{parseFloat(line.grossTotal).toFixed(2)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm italic">Ni postavk.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end p-4 border rounded-md bg-muted/10">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Neto:</span>
                  <span>{parseFloat(invoice.totalNet).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>DDV:</span>
                  <span>{parseFloat(invoice.totalVat).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t">
                  <span>Bruto:</span>
                  <span>{parseFloat(invoice.totalGross).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="space-y-1">
              <div className="text-sm font-semibold">Opombe</div>
              <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/10 whitespace-pre-wrap">
                {invoice.notes}
              </div>
            </div>
          )}

          {invoice.linkedEntryId && (
            <div className="pt-4 border-t">
              <Link href="/temeljnice" className="text-sm text-primary hover:underline font-medium inline-flex items-center">
                <FileText className="h-4 w-4 mr-1.5" />
                Odpri povezano temeljnico
              </Link>
            </div>
          )}
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Zapri</Button>
          {invoice.status === "draft" && activeCompany?.role !== "viewer" && (
            <Button onClick={handlePost} disabled={postMut.isPending}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Poknjiži
            </Button>
          )}
          {invoice.status === "posted" && activeCompany?.role !== "viewer" && (
            <Button variant="secondary" onClick={() => { onOpenChange(false); onVoid(); }}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Razveljavi
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// VOID INVOICE DIALOG
// ---------------------------------------------------------------------------

function VoidInvoiceDialog({ open, onOpenChange, invoiceId }: { open: boolean, onOpenChange: (open: boolean) => void, invoiceId: string }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const voidMut = useVoidInvoice();

  const [reason, setReason] = useState("");

  const handleVoid = () => {
    if (!activeCompany) return;
    voidMut.mutate({
      companyId: activeCompany.id,
      id: invoiceId,
      data: { reason: reason || undefined }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(activeCompany.id) });
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Razveljavitev računa</DialogTitle>
          <DialogDescription>
            Račun bo označen kot razveljavljen in kreirana bo storno temeljnica. To dejanje je nepovratno.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Razlog za razveljavitev (neobvezno)</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Napaka pri vnosu..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button variant="destructive" onClick={handleVoid} disabled={voidMut.isPending}>
            {voidMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Razveljavi račun
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
