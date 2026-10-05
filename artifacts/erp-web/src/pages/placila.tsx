import React, { useState, useMemo } from "react";
import { defaultAccountingPeriod } from "@/lib/defaultAccountingPeriod";
import { useAuth } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  AlertCircle,
  CreditCard,
  ArrowRightLeft,
  CheckCircle2,
  X,
  FileText,
  Download
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListPayments,
  useGetPayment,
  useCreatePayment,
  usePostPayment,
  useCreatePaymentBatch,
  getListPaymentBatchesQueryKey,
  useVoidPayment,
  useListCounterparties,
  useListPeriods,
  useListAccounts,
  useListInvoices,
  useGetOpenItems,
  useGetBankBalance,
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
import { Checkbox } from "@/components/ui/checkbox";
import { PaymentBatchesPanel } from "@/components/payment-batches-panel";
import { BankAccountMetadataDialog } from "@/components/bank-account-metadata-dialog";
import {
  allocationIdentity,
  buildPaymentAllocationPayload,
  canBulkSelectForCutoff,
  canPrepareSupplierPayment,
  getOpenItemKey,
  isLedgerOpenItem,
  isSupplierPaymentDirectionEligible,
  isPastCutoff,
  openItemDocumentValue,
  openItemSourceLabel,
  groupPaymentBatchAllocations,
  type MixedAllocation,
} from "@/lib/openItems";

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
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();

  const [activeTab, setActiveTab] = useState<string>("inbound");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodSelection, setPeriodSelection] = useState<{ companyId: string; value: string } | null>(null);
  const setPeriodFilter = (value: string) => {
    if (activeCompany) setPeriodSelection({ companyId: activeCompany.id, value });
  };

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const periodFilter = periodSelection && periodSelection.companyId === activeCompany?.id
    ? periodSelection.value
    : defaultAccountingPeriod(periods);

  const { data, isLoading, error } = useListPayments(
    activeCompany?.id ?? "",
    {
      direction: (activeTab === "outbound" ? "outbound" : "inbound") as "inbound" | "outbound",
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      periodId: periodFilter !== "all" ? periodFilter : undefined,
    },
    { query: { enabled: !!activeCompany?.id && !!periodsData && activeTab !== "batches" } as any }
  );

  const payments = data?.payments ?? [];

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [detailPayment, setDetailPayment] = useState<PaymentRecord | null>(null);
  const sspPrefill = useMemo(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const invoiceId = params.get("sspInvoiceId");
    const counterpartyId = params.get("counterpartyId");
    const arApAccountId = params.get("arApAccountId");
    const amount = params.get("amount");
    return invoiceId && counterpartyId && arApAccountId && amount
      ? { invoiceId, counterpartyId, arApAccountId, amount }
      : null;
  }, [location]);

  React.useEffect(() => {
    if (sspPrefill) setNewSheetOpen(true);
  }, [sspPrefill]);

  const postMut = usePostPayment();

  const handleSepaExport = async (e: React.MouseEvent, payment: PaymentRecord) => {
    e.stopPropagation();
    if (!activeCompany) return;
    try {
      const token = await getToken();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/companies/${activeCompany.id}/payments/${payment.id}/sepa.xml`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? "SEPA izvoza ni bilo mogoče pripraviti.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SEPA-${payment.reference || payment.id.slice(0, 8)}.xml`.replace(/[^A-Za-z0-9._-]/g, "_");
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : "SEPA izvoza ni bilo mogoče pripraviti.");
    }
  };
  
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
            <TabsTrigger value="batches">Paketi za banko</TabsTrigger>
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

      {activeTab === "batches" ? (
        <PaymentBatchesPanel />
      ) : isLoading ? (
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
                    {pay.direction === "outbound" && pay.status === "draft" && activeCompany?.role !== "viewer" && (
                      <Button variant="outline" size="sm" className="mr-2" onClick={(e) => handleSepaExport(e, pay)}>
                        <Download className="mr-1.5 h-3 w-3" />
                        SEPA XML
                      </Button>
                    )}
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
          onOpenChange={(open) => {
            setNewSheetOpen(open);
            if (!open && sspPrefill) setLocation("/placila");
          }}
          onBatchCreated={() => setActiveTab("batches")}
          defaultDirection={activeTab === "outbound" ? "outbound" : "inbound"}
          sspPrefill={sspPrefill ?? undefined}
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

function NewPaymentSheet({ open, onOpenChange, onBatchCreated, defaultDirection, sspPrefill }: { open: boolean, onBatchCreated?: () => void, onOpenChange: (open: boolean) => void, defaultDirection: "inbound" | "outbound", sspPrefill?: { invoiceId: string; counterpartyId: string; arApAccountId: string; amount: string } }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id && open } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id && open } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id && open } as any });
  // Samo knjižljivi konti — skupinski/sintetični konti (allowsPosting=false) niso na voljo za izbiro
  const accounts = accountsData?.accounts?.filter(a => a.isActive && a.allowsPosting !== false) || [];

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

  const { data: openItemsData, isLoading: openItemsLoading } = useGetOpenItems(
    activeCompany?.id ?? "",
    {
      counterpartyId: formData.direction === "outbound" ? undefined : formData.counterpartyId || undefined,
      type: formData.direction === "outbound" ? "received" : "issued",
      asOfDate: formData.paymentDate,
    },
    { query: { enabled: !!activeCompany?.id && open && (formData.direction === "outbound" || !!formData.counterpartyId) } as any },
  );
  const { data: bankBalanceData } = useGetBankBalance(
    activeCompany?.id ?? "",
    { query: { enabled: !!activeCompany?.id && open && formData.direction === "outbound" } as any },
  );

  // Meja zapadlosti: independent of execution date. Empty = no due restriction.
  const [cutoffDate, setCutoffDate] = useState(new Date().toISOString().split("T")[0]);
  const [cutoffTouched, setCutoffTouched] = useState(false);
  const [cutoffNotice, setCutoffNotice] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<MixedAllocation[]>([]);

  React.useEffect(() => {
    if (!open || !sspPrefill) return;
    setFormData(prev => ({
      ...prev,
      direction: "inbound",
      counterpartyId: sspPrefill.counterpartyId,
      arApAccountId: sspPrefill.arApAccountId,
      amount: sspPrefill.amount,
      notes: "Poravnava SŠP terjatve",
    }));
    setAllocations([{ id: `ssp-${sspPrefill.invoiceId}`, invoiceId: sspPrefill.invoiceId, allocatedAmount: sspPrefill.amount }]);
  }, [open, sspPrefill]);

  // Duplicate detection state
  const [duplicateWarning, setDuplicateWarning] = useState<{
    paymentId: string;
    message: string;
  } | null>(null);

  const validCounterparties = counterparties;

  const bankAccounts = accounts.filter(a =>
    formData.direction === "outbound"
      ? a.code.startsWith("110")
      : a.code.startsWith("11") || a.code.startsWith("22"),
  );
  const selectedBankBalance = bankBalanceData?.accounts.find(a => a.accountId === formData.bankAccountId);
  
  const arapAccounts = accounts.filter(a =>
    a.isActive && a.allowsPosting !== false && (
      (formData.direction === "outbound" ? a.type === "liability" : a.type === "asset") ||
      (sspPrefill?.arApAccountId === a.id)
    ),
  );

  // Invoices for selected counterparty and direction
  const invoiceTypeForPayment = formData.direction === "inbound" ? "issued" : "received";
  const availableInvoices = allInvoices.filter(i => 
    i.counterpartyId === formData.counterpartyId && 
    i.type === invoiceTypeForPayment &&
    i.status === "posted"
  );
  const inboundLedgerItems = formData.direction === "inbound"
    ? (openItemsData?.items ?? []).filter(item =>
      isLedgerOpenItem(item as any) && (item as any).paymentDirection === "inbound")
    : [];
  const supplierOpenItems = (openItemsData?.items ?? [])
    .filter(item => isSupplierPaymentDirectionEligible(item as any))
    .sort((a, b) => {
      const aDue = a.dueDate || (isLedgerOpenItem(a as any) ? "" : a.invoiceDate);
      const bDue = b.dueDate || (isLedgerOpenItem(b as any) ? "" : b.invoiceDate);
      return aDue.localeCompare(bDue);
    });

  const beyondCutoff = (item: typeof supplierOpenItems[number]) => isPastCutoff(item as any, cutoffDate);
  const hasUnknownNativeMaturity = supplierOpenItems.some(item => isLedgerOpenItem(item as any) && !item.dueDate);

  React.useEffect(() => {
    if (formData.direction !== "outbound" || !cutoffDate) { return; }
    const removed = allocations.filter(a => {
      const it = supplierOpenItems.find(i => {
        const identity = allocationIdentity(i as any);
        return identity?.invoiceId === a.invoiceId && identity?.journalLineId === a.journalLineId;
      });
      return it && beyondCutoff(it);
    });
    if (removed.length === 0) return;
    const identities = new Set(removed.map(a => `${a.invoiceId ?? ""}:${a.journalLineId ?? ""}`));
    setAllocations(cur => cur.filter(a => !identities.has(`${a.invoiceId ?? ""}:${a.journalLineId ?? ""}`)));
    setCutoffNotice(`Zaradi meje zapadlosti ${new Date(cutoffDate).toLocaleDateString("sl-SI")} je bilo odstranjenih ${removed.length} izbranih postavk z znanim kasnejšim rokom.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutoffDate, openItemsData]);

  const addAllocation = () => setAllocations([...allocations, { id: Math.random().toString(), invoiceId: "", allocatedAmount: "" }]);
  const removeAllocation = (id: string) => setAllocations(allocations.filter(a => a.id !== id));
  const updateAllocation = (id: string, field: string, val: string) => setAllocations(allocations.map(a => a.id === id ? { ...a, [field]: val } : a));
  const selectAllocationDocument = (id: string, value: string) => {
    const [kind, ...parts] = value.split(":");
    const documentId = parts.join(":");
    setAllocations(current => current.map(allocation => allocation.id !== id ? allocation : {
      ...allocation,
      invoiceId: kind === "invoice" ? documentId : undefined,
      journalLineId: kind === "ledger" ? documentId : undefined,
    }));
  };
  const toggleSupplierItem = (item: typeof supplierOpenItems[number], checked: boolean) => {
    const identity = allocationIdentity(item as any);
    if (!identity) return;
    const itemKey = getOpenItemKey(item as any);
    if (!checked) {
      setAllocations(current => current.filter(allocation =>
        allocation.invoiceId !== identity.invoiceId || allocation.journalLineId !== identity.journalLineId));
      return;
    }
    if (!canPrepareSupplierPayment(item as any)) return;
    setAllocations(current => [
      ...current,
      { id: `open-item-${itemKey}`, ...identity, allocatedAmount: item.remainingAmount },
    ]);
  };

  React.useEffect(() => {
    if (open && openPeriods.length > 0 && !formData.periodId) {
      setFormData(prev => ({ ...prev, periodId: openPeriods[0].id }));
    }
  }, [open, openPeriods, formData.periodId]);

  React.useEffect(() => {
    // Reset allocations when counterparty or direction changes
    if (sspPrefill) return;
    if (formData.direction === "outbound") return;
    setAllocations([]);
  }, [formData.counterpartyId, formData.direction, sspPrefill]);

  const totals = useMemo(() => {
    let allocated = 0;
    allocations.forEach(a => {
      allocated += parseFloat(a.allocatedAmount) || 0;
    });
    const paymentAmt = parseFloat(formData.amount) || 0;
    return { allocated, unallocated: paymentAmt - allocated, paymentAmt };
  }, [allocations, formData.amount]);

  const isAllocationValid = totals.unallocated >= 0;
  const hasBankStatementBalance = selectedBankBalance?.hasStatementBalance === true && selectedBankBalance.balance != null;
  const availableBankBalance = hasBankStatementBalance ? parseFloat(selectedBankBalance.balance!) : null;
  const missingBankStatementBalance = formData.direction === "outbound" &&
    !!formData.bankAccountId &&
    !hasBankStatementBalance;
  const exceedsBankBalance = formData.direction === "outbound" &&
    !!formData.bankAccountId &&
    availableBankBalance != null &&
    totals.allocated > availableBankBalance + 0.005;

  React.useEffect(() => {
    if (formData.direction !== "outbound") return;
    const amount = totals.allocated > 0 ? totals.allocated.toFixed(2) : "";
    setFormData(current => current.amount === amount ? current : { ...current, amount });
  }, [formData.direction, totals.allocated]);

  const createMut = useCreatePayment();
  const batchMut = useCreatePaymentBatch();
  const batchKeyRef = React.useRef(crypto.randomUUID());

  const buildPayload = (
    force = false,
    batch?: { counterpartyId: string; arApAccountId: string; allocations: typeof allocations },
  ) => {
    const sourceAllocations = batch?.allocations ?? allocations;
    const { allocations: invoiceAllocations, ledgerAllocations } = buildPaymentAllocationPayload(sourceAllocations);

    return {
      companyId: activeCompany!.id,
      data: {
        direction: formData.direction,
        counterpartyId: batch?.counterpartyId ?? formData.counterpartyId,
        periodId: formData.periodId,
        paymentDate: formData.paymentDate,
        amount: batch
          ? [...invoiceAllocations, ...ledgerAllocations].reduce((sum, allocation) => sum + allocation.allocatedAmount, 0)
          : parseFloat(formData.amount),
        reference: formData.reference || null,
        bankAccountId: formData.bankAccountId,
        arApAccountId: batch?.arApAccountId ?? formData.arApAccountId,
        notes: formData.notes || null,
        allocations: invoiceAllocations.length > 0 ? invoiceAllocations : undefined,
        ledgerAllocations: ledgerAllocations.length > 0 ? ledgerAllocations : undefined,
        ...(force ? { force: true } : {}),
      } as any,
    };
  };

  const handleSave = async (force = false) => {
    if (!activeCompany) return;
    
    if (!isAllocationValid) {
      alert("Vsota poravnav ne sme presegati zneska plačila.");
      return;
    }
    if (formData.direction === "outbound" && allocations.some(allocation =>
      supplierOpenItems.some(item => {
        const identity = allocationIdentity(item as any);
        return item.activePaymentBatchId &&
          identity?.invoiceId === allocation.invoiceId &&
          identity?.journalLineId === allocation.journalLineId;
      }))) {
      alert("Ena ali več izbranih postavk je že rezerviranih v aktivnem plačilnem paketu. Odstranite jih iz izbora.");
      return;
    }
    if (exceedsBankBalance) {
      alert("Skupni znesek izbranih računov presega zadnje evidentirano stanje izbranega TRR.");
      return;
    }
    if (missingBankStatementBalance) {
      alert("Za izbrani TRR ni evidentiranega končnega stanja bančnega izpiska.");
      return;
    }

    if (formData.direction === "outbound") {
      // One atomic request: server creates all supplier drafts and the batch, or nothing.
      const proposedPayments = groupPaymentBatchAllocations(allocations, supplierOpenItems as any[]);
      if (proposedPayments.length === 0) return;
      try {
        await batchMut.mutateAsync({
          companyId: activeCompany.id,
          data: {
            bankAccountId: formData.bankAccountId,
            periodId: formData.periodId,
            paymentDate: formData.paymentDate,
            ...(cutoffDate ? { cutoffDate } : {}),
            proposedPayments,
            idempotencyKey: batchKeyRef.current,
          } as any,
        });
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
        queryClient.invalidateQueries({ queryKey: getListPaymentBatchesQueryKey(activeCompany.id) });
        batchKeyRef.current = crypto.randomUUID();
        setDuplicateWarning(null);
        onOpenChange(false);
        onBatchCreated?.();
      } catch (err: any) {
        // Server rejected the request: nothing was saved. A changed retry needs a new key.
        if (err?.status && err.status < 500) batchKeyRef.current = crypto.randomUUID();
        alert(`Paket ni bil ustvarjen, noben osnutek ni shranjen. ${err?.data?.error ?? err?.message ?? ""}`);
      }
      return;
    }

    createMut.mutate(buildPayload(force), {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
        setDuplicateWarning(null);
        onOpenChange(false);
      },
      onError: (err: any) => {
        if (err?.status === 409 && err?.data?.duplicateOf?.paymentId) {
          setDuplicateWarning({
            paymentId: err.data.duplicateOf.paymentId,
            message: err.data?.error ?? "Plačilo s temi podatki že obstaja v sistemu.",
          });
        }
      },
    });
  };

  const canSave = formData.periodId && parseFloat(formData.amount) > 0 && formData.bankAccountId && isAllocationValid && !exceedsBankBalance && !missingBankStatementBalance && (
    formData.direction === "outbound"
      ? allocations.length > 0
      : !!formData.counterpartyId && !!formData.arApAccountId
  );

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
              <Select disabled={!!sspPrefill} value={formData.direction} onValueChange={(val: any) => {
                setAllocations([]);
                setFormData(p => ({ ...p, direction: val, counterpartyId: "" }));
              }}>
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
              <Label>{formData.direction === "outbound" ? "Obseg" : "Partner"} <span className="text-destructive">*</span></Label>
              {formData.direction === "outbound" ? (
                <div className="h-10 rounded-md border bg-muted/30 px-3 flex items-center text-sm font-medium">
                  Vsi partnerji z odprtimi obveznostmi — računi, plače, DDV in druge knjižbe
                </div>
              ) : (
                <Select disabled={!!sspPrefill} value={formData.counterpartyId} onValueChange={val => setFormData(p => ({ ...p, counterpartyId: val }))}>
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
              )}
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
              <Input type="date" value={formData.paymentDate} onChange={e => {
                const v = e.target.value;
                setFormData(p => ({ ...p, paymentDate: v }));
                if (!cutoffTouched) setCutoffDate(v);
              }} />
            </div>
            {formData.direction === "outbound" && (
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Meja zapadlosti (neobvezno)</Label>
                <Input type="date" value={cutoffDate} onChange={e => { setCutoffTouched(true); setCutoffNotice(null); setCutoffDate(e.target.value); }} />
                <p className="text-xs text-muted-foreground">Prazno = brez omejitve zapadlosti. Neodvisno od datuma izvedbe.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Znesek <span className="text-destructive">*</span></Label>
              <Input disabled={formData.direction === "outbound"} type="number" min="0" step="0.01" value={formData.amount} onChange={e => {
                const amount = e.target.value;
                setFormData(p => ({ ...p, amount }));
                if (sspPrefill) setAllocations(current => current.map(a => ({ ...a, allocatedAmount: amount })));
              }} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Sklic</Label>
              <Input value={formData.reference} onChange={e => setFormData(p => ({ ...p, reference: e.target.value }))} placeholder="Npr. SI00 12345" />
            </div>
          </div>

          <div className={`grid gap-4 p-4 border rounded-md bg-muted/10 ${formData.direction === "outbound" ? "grid-cols-1" : "grid-cols-2"}`}>
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
              {formData.direction === "outbound" && formData.bankAccountId && (
                <p className={`text-xs ${(exceedsBankBalance || missingBankStatementBalance) ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {hasBankStatementBalance && availableBankBalance != null
                    ? `Stanje po izpisku na dan ${selectedBankBalance.evidenceDate}: ${availableBankBalance.toLocaleString("sl-SI", { style: "currency", currency: selectedBankBalance.currency ?? "EUR" })}`
                    : "Stanje ni znano — evidentirajte izpisek s končnim stanjem."}
                </p>
              )}
            </div>
            {formData.direction !== "outbound" && <div className="space-y-2">
              <Label>Konto {formData.direction === "inbound" ? "terjatev" : "obveznosti"} <span className="text-destructive">*</span></Label>
              <Select disabled={!!sspPrefill} value={formData.arApAccountId} onValueChange={val => setFormData(p => ({ ...p, arApAccountId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite konto" />
                </SelectTrigger>
                <SelectContent>
                  {arapAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}
          </div>

          {formData.direction === "outbound" ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Odprte obveznosti partnerja</h3>
                <p className="text-xs text-muted-foreground mt-1">Razvrščeno po datumu zapadlosti. Znesek lahko zmanjšate za delno plačilo.</p>
                {hasUnknownNativeMaturity && <p className="text-xs text-amber-700 mt-1">Postavke GK brez roka niso vključene pri izbiri vseh, ker njihove zapadlosti ni mogoče ugotoviti. Po preverjanju jih lahko izberete ročno; niso samodejno označene kot zapadle.</p>}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button type="button" variant="outline" size="sm" disabled={openItemsLoading || supplierOpenItems.length === 0}
                    onClick={() => setAllocations(supplierOpenItems.filter(item => canBulkSelectForCutoff(item as any, cutoffDate) && !item.activePaymentBatchId)
                      .map(item => ({ id: `open-item-${getOpenItemKey(item as any)}`, ...allocationIdentity(item as any)!, allocatedAmount: item.remainingAmount })))}>
                    Izberi vse dovoljene postavke
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={allocations.length === 0} onClick={() => setAllocations([])}>Počisti izbor</Button>
                  {activeCompany && formData.bankAccountId && <BankAccountMetadataDialog companyId={activeCompany.id} accountId={formData.bankAccountId} />}
                </div>
              </div>
              <div className="rounded-md border bg-card overflow-hidden">
                {openItemsLoading ? (
                  <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
                ) : supplierOpenItems.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">Partner nima odprtih obveznosti.</div>
                ) : supplierOpenItems.map(item => {
                  const itemIdentity = allocationIdentity(item as any);
                  const allocation = allocations.find(current => current.invoiceId === itemIdentity?.invoiceId && current.journalLineId === itemIdentity?.journalLineId);
                  const native = isLedgerOpenItem(item as any);
                  const overdue = !!item.dueDate && item.daysOverdue > 0;
                  const future = beyondCutoff(item);
                  const itemKey = getOpenItemKey(item as any);
                  const label = openItemDocumentValue(item as any);
                  return (
                    <div key={itemKey} className="grid grid-cols-[auto_1fr_120px] gap-3 items-center border-b last:border-b-0 p-3">
                      <Checkbox checked={!!allocation} disabled={(!allocation && !!item.activePaymentBatchId) || (future && !allocation)} onCheckedChange={checked => toggleSupplierItem(item, checked === true)} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{label}</span>
                          <Badge variant="outline">{openItemSourceLabel(item as any)}</Badge>
                          {native && item.side && <Badge variant="secondary">{item.side === "debit" ? "Debet" : "Kredit"}</Badge>}
                          <Badge className={overdue ? "bg-red-600 hover:bg-red-600" : "bg-green-600 hover:bg-green-600"}>
                            {native && !item.dueDate ? "Brez zapadlosti" : overdue ? `Zapadlo ${item.daysOverdue} dni` : "Še ni zapadlo"}
                          </Badge>
                          {future && <Badge variant="outline">Po meji zapadlosti</Badge>}
                          {item.activePaymentBatchId && <Badge variant="outline">V aktivnem plačilnem paketu</Badge>}
                        </div>
                        <div className="text-sm font-medium text-foreground/80 mt-1">{item.counterpartyName}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Zapadlost: {item.dueDate ? new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("sl-SI") : native ? "Brez zapadlosti" : "ni določena"}
                          {" · "}Odprto: {parseFloat(item.remainingAmount).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}
                        </div>
                      </div>
                      <Input
                        aria-label={`Znesek plačila za ${native ? "postavko GK" : "račun"} ${label}`}
                        disabled={!allocation || !!item.activePaymentBatchId}
                        type="number"
                        min="0.01"
                        max={item.remainingAmount}
                        step="0.01"
                        value={allocation?.allocatedAmount ?? ""}
                        onChange={event => allocation && updateAllocation(allocation.id, "allocatedAmount", event.target.value)}
                        className="text-right"
                      />
                    </div>
                  );
                })}
              </div>
              <div className={`rounded-md border p-4 ${(exceedsBankBalance || missingBankStatementBalance) ? "border-destructive bg-destructive/10" : "bg-muted/30"}`}>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Vse odprte obveznosti</span>
                  <span>{supplierOpenItems.reduce((t, i) => t + parseFloat(i.remainingAmount), 0).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{cutoffDate ? `Zapadle do ${new Date(cutoffDate).toLocaleDateString("sl-SI")}` : "Brez meje zapadlosti"}</span>
                  <span>{supplierOpenItems.filter(i => canBulkSelectForCutoff(i as any, cutoffDate)).reduce((t, i) => t + parseFloat(i.remainingAmount), 0).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</span>
                </div>
                {hasUnknownNativeMaturity && <div className="flex justify-between text-sm text-amber-700"><span>Brez znane zapadlosti</span><span>{supplierOpenItems.filter(i => isLedgerOpenItem(i as any) && !i.dueDate).reduce((t, i) => t + parseFloat(i.remainingAmount), 0).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</span></div>}
                {cutoffNotice && <p className="text-sm text-amber-700 mb-2">{cutoffNotice}</p>}
                <div className="flex justify-between font-semibold">
                  <span>Skupaj odkljukano za plačilo</span>
                  <span className={exceedsBankBalance ? "text-destructive" : ""}>
                    {totals.allocated.toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
                {exceedsBankBalance && <p className="text-sm text-destructive mt-2">Znesek presega zadnje stanje iz bančnega izpiska. Zmanjšajte zneske ali izberite drug TRR.</p>}
                {missingBankStatementBalance && <p className="text-sm text-destructive mt-2">Za izbrani TRR ni evidentiranega končnega stanja bančnega izpiska.</p>}
              </div>
            </div>
          ) : (
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
                      <Label className="text-xs text-muted-foreground">Dokument</Label>
                      <Select value={alloc.invoiceId ? `invoice:${alloc.invoiceId}` : alloc.journalLineId ? `ledger:${alloc.journalLineId}` : ""} onValueChange={val => selectAllocationDocument(alloc.id, val)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Izberi dokument..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableInvoices.map(inv => (
                            <SelectItem key={`invoice:${inv.id}`} value={`invoice:${inv.id}`}>
                              {inv.invoiceNumber} (Skupaj: {parseFloat(inv.totalGross).toFixed(2)})
                            </SelectItem>
                          ))}
                          {inboundLedgerItems.map(item => {
                            const journalLineId = item.journalLineId;
                            return journalLineId ? (
                              <SelectItem key={`ledger:${journalLineId}`} value={`ledger:${journalLineId}`}>
                                Postavka GK — {openItemDocumentValue(item as any)} ({item.accountCode ?? "konto"})
                              </SelectItem>
                            ) : null;
                          })}
                          {availableInvoices.length === 0 && inboundLedgerItems.length === 0 && <SelectItem value="none" disabled>Ni knjiženih dokumentov</SelectItem>}
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
          )}

          <div className="space-y-2">
            <Label>Opombe (Neobvezno)</Label>
            <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Dodatna pojasnila..." />
          </div>
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={() => handleSave(false)} disabled={!canSave || createMut.isPending || batchMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Shrani plačilo
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* Duplicate payment warning dialog */}
      <Dialog open={!!duplicateWarning} onOpenChange={(v) => { if (!v) setDuplicateWarning(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              Možno podvojeno plačilo
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  V sistemu že obstaja plačilo z istimi podatki (datum, znesek, sklic).
                </p>
                {duplicateWarning && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span className="font-medium">ID obstoječega plačila:</span>{" "}
                    <code className="font-mono text-xs">{duplicateWarning.paymentId}</code>
                  </div>
                )}
                <p className="text-sm">
                  Ali res želite shraniti to plačilo kot novo vnos? Izberite <strong>Vseeno shrani</strong> samo, če ste prepričani, da gre za ločeno plačilo.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDuplicateWarning(null)}>
              Prekliči
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleSave(true)}
              disabled={createMut.isPending}
            >
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vseeno shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const ledgerAllocations = (fullPayment as any)?.ledgerAllocations ?? [];
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
            <h3 className="text-sm font-semibold">Poravnave dokumentov</h3>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : allocations.length === 0 && ledgerAllocations.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-md text-center">
                Ni poravnav za to plačilo.
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dokument</TableHead>
                      <TableHead>Vir</TableHead>
                      <TableHead>Datum dokumenta</TableHead>
                      <TableHead className="text-right">Poravnano</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map(alloc => (
                      <TableRow key={`invoice-${alloc.id}`}>
                        <TableCell className="font-medium">{alloc.invoiceNumber}</TableCell>
                        <TableCell><Badge variant="outline">Račun</Badge></TableCell>
                        <TableCell>{alloc.invoiceDate ? new Date(alloc.invoiceDate).toLocaleDateString("sl-SI") : "—"}</TableCell>
                        <TableCell className="text-right font-medium">{parseFloat(alloc.allocatedAmount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                    {ledgerAllocations.map((alloc: any) => (
                      <TableRow key={`ledger-${alloc.id}`}>
                        <TableCell className="font-medium">
                          {alloc.reference || alloc.description || `Postavka GK ${alloc.accountCode ? `(${alloc.accountCode})` : ""}`}
                          {alloc.entryId && <Link className="ml-2 text-primary underline text-xs" href={`/temeljnice?id=${encodeURIComponent(alloc.entryId)}`}>Odpri temeljnico</Link>}
                        </TableCell>
                        <TableCell><Badge variant="outline">Postavka GK</Badge></TableCell>
                        <TableCell>{alloc.documentDate ? new Date(alloc.documentDate).toLocaleDateString("sl-SI") : "—"}</TableCell>
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
