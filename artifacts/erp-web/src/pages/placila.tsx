import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  AlertCircle,
  CreditCard,
  ArrowRightLeft,
  CheckCircle2,
  X,
  FileText
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListPayments,
  useGetPayment,
  useCreatePayment,
  usePostPayment,
  useVoidPayment,
  useListCounterparties,
  useListPeriods,
  useListAccounts,
  useListInvoices,
  getListPaymentsQueryKey,
  type PaymentRecord,
  type PaymentWithAllocations,
  type PaymentAllocationRecord
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
  void: "Razveljavljeno"
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  posted: "default",
  void: "secondary"
};

export default function Placila() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("inbound");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];

  const { data, isLoading, error } = useListPayments(
    activeCompany?.id ?? "",
    {
      direction: activeTab as "inbound" | "outbound",
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      periodId: periodFilter !== "all" ? periodFilter : undefined,
    },
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const payments = data?.payments ?? [];

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [detailPayment, setDetailPayment] = useState<PaymentRecord | null>(null);

  const postMut = usePostPayment();
  
  const handlePost = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!activeCompany) return;
    if (window.confirm("Ali res želite poknjižiti plačilo? Osnutek bo zaključen.")) {
      postMut.mutate({ companyId: activeCompany.id, id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
        }
      });
    }
  };

  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);

  const clearFilters = () => {
    setStatusFilter("all");
    setPeriodFilter("all");
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju plačil.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plačila</h1>
          <p className="text-muted-foreground mt-1">Upravljanje prejetih in izplačanih sredstev.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewSheetOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Novo plačilo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center bg-card p-4 rounded-lg border shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="inbound">Prejeta plačila</TabsTrigger>
            <TabsTrigger value="outbound">Izplačila</TabsTrigger>
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
                <SelectItem value="void">Razveljavljeno</SelectItem>
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
      ) : payments.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Ni najdenih plačil</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Za izbrane filtre ni bilo mogoče najti nobenega plačila.
          </p>
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewSheetOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Ustvari prvo plačilo
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Datum</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Znesek</TableHead>
                <TableHead className="text-right">Poravnano</TableHead>
                <TableHead className="text-right">Neporavnano</TableHead>
                <TableHead>Sklic</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[120px] text-right">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map(pay => (
                <TableRow 
                  key={pay.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setDetailPayment(pay)}
                >
                  <TableCell>{new Date(pay.paymentDate).toLocaleDateString("sl-SI")}</TableCell>
                  <TableCell className="font-medium">{pay.counterpartyName}</TableCell>
                  <TableCell className="text-right font-semibold">{parseFloat(pay.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{parseFloat(pay.allocatedAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">{parseFloat(pay.unallocatedAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-muted-foreground">{pay.reference || "-"}</TableCell>
                  <TableCell>
                    <Badge 
                      variant={STATUS_VARIANTS[pay.status]} 
                      className={pay.status === 'posted' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
                    >
                      {STATUS_LABELS[pay.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {pay.status === "draft" && activeCompany?.role !== "viewer" && (
                      <Button variant="outline" size="sm" onClick={(e) => handlePost(e, pay.id)} disabled={postMut.isPending}>
                        <CheckCircle2 className="mr-1.5 h-3 w-3 text-green-600" />
                        Poknjiži
                      </Button>
                    )}
                    {pay.status === "posted" && activeCompany?.role !== "viewer" && (
                      <Button variant="outline" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        setVoidPaymentId(pay.id);
                      }}>
                        <ArrowRightLeft className="mr-1.5 h-3 w-3 text-destructive" />
                        Razveljavi
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
        <NewPaymentSheet 
          open={newSheetOpen} 
          onOpenChange={setNewSheetOpen} 
          defaultDirection={activeTab as "inbound" | "outbound"}
        />
      )}

      {detailPayment && (
        <DetailPaymentSheet
          open={!!detailPayment}
          onOpenChange={(v) => { if (!v) setDetailPayment(null); }}
          payment={detailPayment}
          onVoid={() => {
            setDetailPayment(null);
            setVoidPaymentId(detailPayment.id);
          }}
        />
      )}

      {voidPaymentId && (
        <VoidPaymentDialog
          open={!!voidPaymentId}
          onOpenChange={(v) => { if (!v) setVoidPaymentId(null); }}
          paymentId={voidPaymentId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEW PAYMENT SHEET
// ---------------------------------------------------------------------------

function NewPaymentSheet({ open, onOpenChange, defaultDirection }: { open: boolean, onOpenChange: (open: boolean) => void, defaultDirection: "inbound" | "outbound" }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id && open } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id && open } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id && open } as any });
  const accounts = accountsData?.accounts?.filter(a => a.isActive) || [];

  const { data: invoicesData } = useListInvoices(activeCompany?.id ?? "", { status: "posted" } as any, { query: { enabled: !!activeCompany?.id && open } as any });
  const allInvoices = invoicesData?.invoices ?? [];

  const [formData, setFormData] = useState({
    direction: defaultDirection,
    counterpartyId: "",
    periodId: "",
    paymentDate: new Date().toISOString().split("T")[0],
    amount: "",
    reference: "",
    bankAccountId: "",
    arApAccountId: "",
    notes: ""
  });

  const [allocations, setAllocations] = useState<{ id: string; invoiceId: string; allocatedAmount: string }[]>([]);

  const cpTypeForPayment = formData.direction === "inbound" ? "customer" : "supplier";
  const validCounterparties = counterparties.filter(c => c.type === cpTypeForPayment || c.type === "both");

  const bankAccounts = accounts.filter(a => a.code.startsWith("11") || a.code.startsWith("22")); // 110 banka, 220 blagajna etc
  
  const arapPrefix = formData.direction === "inbound" ? "120" : "220";
  const arapAccounts = accounts.filter(a => a.code.startsWith(arapPrefix) || a.code.startsWith("14") || a.code.startsWith("43"));

  // Invoices for selected counterparty and direction
  const invoiceTypeForPayment = formData.direction === "inbound" ? "issued" : "received";
  const availableInvoices = allInvoices.filter(i => 
    i.counterpartyId === formData.counterpartyId && 
    i.type === invoiceTypeForPayment &&
    i.status === "posted"
  );

  const addAllocation = () => setAllocations([...allocations, { id: Math.random().toString(), invoiceId: "", allocatedAmount: "" }]);
  const removeAllocation = (id: string) => setAllocations(allocations.filter(a => a.id !== id));
  const updateAllocation = (id: string, field: string, val: string) => setAllocations(allocations.map(a => a.id === id ? { ...a, [field]: val } : a));

  React.useEffect(() => {
    if (open && openPeriods.length > 0 && !formData.periodId) {
      setFormData(prev => ({ ...prev, periodId: openPeriods[0].id }));
    }
  }, [open, openPeriods, formData.periodId]);

  React.useEffect(() => {
    // Reset allocations when counterparty or direction changes
    setAllocations([]);
  }, [formData.counterpartyId, formData.direction]);

  const totals = useMemo(() => {
    let allocated = 0;
    allocations.forEach(a => {
      allocated += parseFloat(a.allocatedAmount) || 0;
    });
    const paymentAmt = parseFloat(formData.amount) || 0;
    return { allocated, unallocated: paymentAmt - allocated, paymentAmt };
  }, [allocations, formData.amount]);

  const isAllocationValid = totals.unallocated >= 0;

  const createMut = useCreatePayment();

  const handleSave = () => {
    if (!activeCompany) return;
    
    if (!isAllocationValid) {
      alert("Vsota poravnav ne sme presegati zneska plačila.");
      return;
    }

    const validAllocations = allocations
      .filter(a => a.invoiceId && parseFloat(a.allocatedAmount) > 0)
      .map(a => ({
        invoiceId: a.invoiceId,
        allocatedAmount: parseFloat(a.allocatedAmount)
      }));

    createMut.mutate({
      companyId: activeCompany.id,
      data: {
        direction: formData.direction,
        counterpartyId: formData.counterpartyId,
        periodId: formData.periodId,
        paymentDate: formData.paymentDate,
        amount: parseFloat(formData.amount),
        reference: formData.reference || null,
        bankAccountId: formData.bankAccountId,
        arApAccountId: formData.arApAccountId,
        notes: formData.notes || null,
        allocations: validAllocations.length > 0 ? validAllocations : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
        onOpenChange(false);
      }
    });
  };

  const canSave = formData.counterpartyId && formData.periodId && parseFloat(formData.amount) > 0 && formData.bankAccountId && formData.arApAccountId && isAllocationValid;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>Novo plačilo</SheetTitle>
          <SheetDescription>Vnesite podatke o prejetem ali izdanem plačilu.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tip plačila</Label>
              <Select value={formData.direction} onValueChange={(val: any) => setFormData(p => ({ ...p, direction: val, counterpartyId: "" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Prejeto plačilo</SelectItem>
                  <SelectItem value="outbound">Izplačilo</SelectItem>
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
              <Label>Datum plačila <span className="text-destructive">*</span></Label>
              <Input type="date" value={formData.paymentDate} onChange={e => setFormData(p => ({ ...p, paymentDate: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Znesek <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" step="0.01" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Sklic</Label>
              <Input value={formData.reference} onChange={e => setFormData(p => ({ ...p, reference: e.target.value }))} placeholder="Npr. SI00 12345" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 border rounded-md bg-muted/10">
            <div className="space-y-2">
              <Label>Bančni / Blagajniški konto <span className="text-destructive">*</span></Label>
              <Select value={formData.bankAccountId} onValueChange={val => setFormData(p => ({ ...p, bankAccountId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite konto" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Konto {formData.direction === "inbound" ? "terjatev" : "obveznosti"} <span className="text-destructive">*</span></Label>
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
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold">Poravnave (Opcijsko)</h3>
              <Button variant="outline" size="sm" onClick={addAllocation} disabled={!formData.counterpartyId}>
                <Plus className="mr-2 h-4 w-4" />
                Dodaj
              </Button>
            </div>

            {allocations.length > 0 ? (
              <div className="border rounded-md divide-y bg-card">
                {allocations.map(alloc => (
                  <div key={alloc.id} className="p-3 flex items-start gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Račun</Label>
                      <Select value={alloc.invoiceId} onValueChange={val => updateAllocation(alloc.id, "invoiceId", val)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Izberi račun..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableInvoices.map(inv => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.invoiceNumber} (Skupaj: {parseFloat(inv.totalGross).toFixed(2)})
                            </SelectItem>
                          ))}
                          {availableInvoices.length === 0 && <SelectItem value="none" disabled>Ni knjiženih računov</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-[120px] space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Znesek poravnave</Label>
                      <Input type="number" min="0" step="0.01" value={alloc.allocatedAmount} onChange={e => updateAllocation(alloc.id, "allocatedAmount", e.target.value)} className="h-9 text-right" />
                    </div>
                    <Button variant="ghost" size="icon" className="h-9 w-9 mt-5 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeAllocation(alloc.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center p-4 border rounded-md">
                Plačilo lahko ostane neporavnano in se poravna kasneje.
              </div>
            )}

            <div className={`p-4 rounded-md border ${!isAllocationValid ? 'border-destructive bg-destructive/10' : 'bg-muted/30'}`}>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Znesek plačila:</span>
                  <span>{totals.paymentAmt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Poravnano skupaj:</span>
                  <span>{totals.allocated.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between font-bold text-base mt-2 pt-2 border-t ${!isAllocationValid ? 'text-destructive' : ''}`}>
                  <span>Neporavnano:</span>
                  <span>{totals.unallocated.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Opombe (Neobvezno)</Label>
            <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Dodatna pojasnila..." />
          </div>
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={handleSave} disabled={!canSave || createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Shrani plačilo
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// DETAIL PAYMENT SHEET
// ---------------------------------------------------------------------------

function DetailPaymentSheet({ open, onOpenChange, payment, onVoid }: { open: boolean, onOpenChange: (open: boolean) => void, payment: PaymentRecord, onVoid: () => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: fullPayment, isLoading } = useGetPayment(
    activeCompany?.id ?? "",
    payment.id,
    { query: { enabled: !!activeCompany?.id && open } as any }
  );

  const allocations = fullPayment?.allocations ?? [];
  const postMut = usePostPayment();

  const handlePost = () => {
    if (!activeCompany) return;
    if (window.confirm("Ali res želite poknjižiti plačilo?")) {
      postMut.mutate({ companyId: activeCompany.id, id: payment.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
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
              <SheetTitle>Plačilo</SheetTitle>
              <SheetDescription>{payment.direction === 'inbound' ? 'Prejeto plačilo' : 'Izplačilo'}</SheetDescription>
            </div>
            <Badge variant={STATUS_VARIANTS[payment.status]} className={payment.status === 'posted' ? 'bg-green-600 text-white' : ''}>
              {STATUS_LABELS[payment.status]}
            </Badge>
          </div>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm bg-muted/20 p-4 rounded-lg border">
            <div>
              <div className="text-muted-foreground mb-1">Partner</div>
              <div className="font-medium">{payment.counterpartyName}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Datum plačila</div>
              <div className="font-medium">{new Date(payment.paymentDate).toLocaleDateString("sl-SI")}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Znesek</div>
              <div className="font-medium text-lg">{parseFloat(payment.amount).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Sklic</div>
              <div className="font-medium">{payment.reference || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Bančni konto</div>
              <div className="font-medium">{payment.bankAccountCode} — {payment.bankAccountName}</div>
            </div>
            {payment.linkedEntryId && (
              <div>
                <div className="text-muted-foreground mb-1">Temeljnica</div>
                <div className="font-medium flex items-center text-primary">
                  <FileText className="h-3 w-3 mr-1" />
                  <a href={`/temeljnice?id=${payment.linkedEntryId}`} className="hover:underline">Odpri temeljnico</a>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Poravnave računa</h3>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : allocations.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-md text-center">
                Ni poravnav za to plačilo.
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Račun</TableHead>
                      <TableHead>Datum računa</TableHead>
                      <TableHead className="text-right">Poravnano</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map(alloc => (
                      <TableRow key={alloc.id}>
                        <TableCell className="font-medium">{alloc.invoiceNumber}</TableCell>
                        <TableCell>{new Date(alloc.invoiceDate).toLocaleDateString("sl-SI")}</TableCell>
                        <TableCell className="text-right font-medium">{parseFloat(alloc.allocatedAmount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            
            <div className="flex flex-col gap-1.5 text-sm p-4 border rounded-md bg-muted/10 mt-2">
              <div className="flex justify-between text-muted-foreground">
                <span>Skupaj poravnano:</span>
                <span>{parseFloat(payment.allocatedAmount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-1.5 mt-1.5">
                <span>Neporavnano:</span>
                <span>{parseFloat(payment.unallocatedAmount).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {payment.notes && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Opombe</h3>
              <div className="text-sm p-4 bg-muted/20 rounded-md border whitespace-pre-wrap">
                {payment.notes}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Zapri</Button>
          {payment.status === "draft" && activeCompany?.role !== "viewer" && (
            <Button onClick={handlePost} disabled={postMut.isPending}>
              {postMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Poknjiži
            </Button>
          )}
          {payment.status === "posted" && activeCompany?.role !== "viewer" && (
            <Button variant="destructive" onClick={onVoid}>
              Razveljavi
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// VOID PAYMENT DIALOG
// ---------------------------------------------------------------------------

function VoidPaymentDialog({ open, onOpenChange, paymentId }: { open: boolean, onOpenChange: (open: boolean) => void, paymentId: string }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [periodId, setPeriodId] = useState("");

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id && open } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  React.useEffect(() => {
    if (open && openPeriods.length > 0 && !periodId) {
      setPeriodId(openPeriods[0].id);
    }
  }, [open, openPeriods, periodId]);

  const voidMut = useVoidPayment();

  const handleVoid = () => {
    if (!activeCompany) return;
    voidMut.mutate({ 
      companyId: activeCompany.id, 
      id: paymentId, 
      data: { periodId: periodId || undefined, reason: reason || null } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Razveljavi plačilo</DialogTitle>
          <DialogDescription>
            Razveljavitev plačila bo ustvarila storno temeljnico in sprostila poravnave.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Obdobje za storno</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
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
            <Label>Razlog (neobvezno)</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Npr. Napačen znesek..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button variant="destructive" onClick={handleVoid} disabled={voidMut.isPending || !periodId}>
            {voidMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Razveljavi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
