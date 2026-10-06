import { formatDatum } from "@/lib/utils";
import React, { useState, useMemo } from "react";
import { defaultAccountingPeriod } from "@/lib/defaultAccountingPeriod";
import { useF2Save } from "@/hooks/useF2Save";
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
  X,
  Link2,
  Unlink,
  Landmark,
  Package,
  Download,
  Clock,
  CheckCircle,
  History,
  CalendarRange,
} from "lucide-react";
import { useAuth } from "@clerk/react";

const BASE_URL_RACUNI = import.meta.env.BASE_URL.replace(/\/$/, "");

async function downloadEslogPaket(companyId: string, receiptId: number, invoiceNumber: string, token: string) {
  const res = await fetch(`${BASE_URL_RACUNI}/api/companies/${companyId}/external-exports/receipts/${receiptId}/eracun-paket.zip`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Napaka pri prenosu (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prejeti-racun-${invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListInvoices,
  useGetInvoice,
  useCreateInvoice,
  usePostInvoice,
  useVoidInvoice,
  useGetInvoicePosReceiptLinks,
  useLinkInvoicePosReceipt,
  useUnlinkInvoicePosReceipt,
  useListCounterparties,
  useListPeriods,
  useListAccounts,
  getListInvoicesQueryKey,
  getGetInvoicePosReceiptLinksQueryKey,
  type InvoiceRecord,
  type InvoicePosReceiptMatchHistoryEntry
  ,customFetch
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
  const [periodSelection, setPeriodSelection] = useState<{ companyId: string; value: string } | null>(null);
  const setPeriodFilter = (value: string) => {
    if (activeCompany) setPeriodSelection({ companyId: activeCompany.id, value });
  };

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const periodFilter = periodSelection && periodSelection.companyId === activeCompany?.id
    ? periodSelection.value
    : defaultAccountingPeriod(periods);

  const { data, isLoading, error } = useListInvoices(
    activeCompany?.id ?? "",
    {
      type: activeTab as "issued" | "received",
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      periodId: periodFilter !== "all" ? periodFilter : undefined,
    },
    { query: { enabled: !!activeCompany?.id && !!periodsData } as any }
  );

  // API orders oldest first; reverse a copy only for this list's display.
  const invoices = useMemo(
    () => [...(data?.invoices ?? [])].reverse(),
    [data?.invoices],
  );

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [contractSummaryOpen, setContractSummaryOpen] = useState(false);
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
            <>
              {activeTab === "issued" && (
                <Button variant="outline" onClick={() => setContractSummaryOpen(true)}>
                  <CalendarRange className="mr-2 h-4 w-4" />
                  Mesečni A-račun
                </Button>
              )}
              <Button onClick={() => setNewSheetOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nov račun
              </Button>
            </>
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
                  <TableCell>{formatDatum(inv.invoiceDate)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {inv.dueDate ? formatDatum(inv.dueDate) : "-"}
                  </TableCell>
                  <TableCell>{inv.counterpartyName}</TableCell>
                   <TableCell className="text-right">{(inv as any).sourceType === "bookie-old" && (inv as any).historicalNet == null ? "—" : parseFloat(inv.totalNet).toFixed(2)}</TableCell>
                   <TableCell className="text-right text-muted-foreground">{(inv as any).sourceType === "bookie-old" && (inv as any).historicalVat == null ? "—" : parseFloat(inv.totalVat).toFixed(2)}</TableCell>
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
                     {inv.status === "draft" && (inv as any).sourceType !== "bookie-old" && activeCompany?.role !== "viewer" && (
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

      {contractSummaryOpen && activeCompany && (
        <ContractSummaryDialog
          open={contractSummaryOpen}
          onOpenChange={setContractSummaryOpen}
          companyId={activeCompany.id}
          onCreated={() => queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(activeCompany.id) })}
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

type ContractSummaryPreview = {
  month: string;
  receiptCount: number;
  grossAmount: string;
  paymentTermsDays: number;
  receipts: Array<{ id: number; invoiceNumber: string; businessDate: string; grossAmount: string; unitName: string }>;
  vatBuckets: Array<{ vatRate: string; netAmount: string; vatAmount: string; grossAmount: string }>;
};

function previousMonth(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 1, 1);
  return date.toISOString().slice(0, 7);
}

function ContractSummaryDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onCreated: () => void;
}) {
  const { data } = useListCounterparties(
    companyId,
    { includeInactive: false },
    { query: { enabled: open } as any },
  );
  const partners = (data?.counterparties ?? []).filter((partner: any) =>
    partner.type === "customer" || partner.type === "both",
  );
  const [month, setMonth] = useState(previousMonth);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [preview, setPreview] = useState<ContractSummaryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPreview = async () => {
    if (!counterpartyId || !month) return;
    setLoading(true);
    setError(null);
    try {
      const result = await customFetch<ContractSummaryPreview>(
        `/api/companies/${companyId}/invoices/pos-contract-summary/preview?month=${encodeURIComponent(month)}&counterpartyId=${encodeURIComponent(counterpartyId)}`,
      );
      setPreview(result);
      if (!dueDate && result.paymentTermsDays > 0) {
        const date = new Date(`${invoiceDate}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + result.paymentTermsDays);
        setDueDate(date.toISOString().slice(0, 10));
      }
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : "Predogleda ni bilo mogoče pripraviti.");
    } finally {
      setLoading(false);
    }
  };

  const createSummary = async () => {
    if (!preview || !invoiceNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await customFetch(`/api/companies/${companyId}/invoices/pos-contract-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          counterpartyId,
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          dueDate: dueDate || null,
        }),
      });
      onCreated();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A-računa ni bilo mogoče ustvariti.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mesečni zbirni A-račun</DialogTitle>
          <DialogDescription>
            Združi fiskalizirane pogodbene POS račune. Prihodki in DDV ostanejo knjiženi samo dnevno;
            mesečni dokument ob potrditvi prenese prehodno terjatev na partnerja.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Poslovni mesec</Label>
            <Input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPreview(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Pogodbeni partner</Label>
            <Select value={counterpartyId} onValueChange={(value) => { setCounterpartyId(value); setPreview(null); }}>
              <SelectTrigger><SelectValue placeholder="Izberite partnerja" /></SelectTrigger>
              <SelectContent>
                {partners.map((partner: any) => (
                  <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Številka A-računa</Label>
            <Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="npr. AR-2026-08-001" />
          </div>
          <div className="space-y-1.5">
            <Label>Datum izdaje</Label>
            <Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Rok plačila</Label>
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </div>
        </div>
        <Button variant="outline" onClick={loadPreview} disabled={loading || !counterpartyId || !month}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Pripravi predogled
        </Button>
        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {preview && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div><strong>{preview.receiptCount}</strong> dnevnih POS računov</div>
              <div className="text-lg font-semibold">{Number(preview.grossAmount).toFixed(2)} €</div>
            </div>
            <div className="text-xs text-muted-foreground">
              {preview.vatBuckets.map((bucket) =>
                `${Number(bucket.vatRate).toFixed(1)} %: osnova ${Number(bucket.netAmount).toFixed(2)} €, DDV ${Number(bucket.vatAmount).toFixed(2)} €`,
              ).join(" · ")}
            </div>
            <div className="max-h-32 overflow-y-auto text-xs">
              {preview.receipts.map((receipt) => (
                <div key={receipt.id} className="flex justify-between border-t py-1.5">
                  <span>{receipt.businessDate} · {receipt.invoiceNumber} · {receipt.unitName}</span>
                  <span>{Number(receipt.grossAmount).toFixed(2)} €</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={createSummary} disabled={loading || !preview || preview.receiptCount === 0 || !invoiceNumber.trim()}>
            Ustvari osnutek A-računa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  // Samo knjižljivi konti — skupinski/sintetični konti (allowsPosting=false) niso na voljo za izbiro
  const accounts = accountsData?.accounts?.filter(a => a.isActive && a.allowsPosting !== false) || [];

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
    destinationIban: "",
    destinationBic: "",
    paymentModel: "",
    paymentReference: "",
    paymentPurpose: "",
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
        destinationIban: formData.type === "received" ? formData.destinationIban || null : null,
        destinationBic: formData.type === "received" ? formData.destinationBic || null : null,
        paymentModel: formData.type === "received" ? formData.paymentModel || null : null,
        paymentReference: formData.type === "received" ? formData.paymentReference || null : null,
        paymentPurpose: formData.type === "received" ? formData.paymentPurpose || null : null,
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
  useF2Save(handleSave, !!canSave && !createMut.isPending);

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
              <Select value={formData.counterpartyId} onValueChange={val => {
                const partner = validCounterparties.find((item) => item.id === val);
                setFormData(p => ({
                  ...p,
                  counterpartyId: val,
                  destinationIban: defaultType === "received" ? (partner?.iban || "") : "",
                  destinationBic: "",
                }));
              }}>
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

          {formData.type === "received" && (
            <div className="space-y-4 rounded-md border bg-muted/10 p-4">
              <div>
                <h3 className="text-sm font-semibold">Plačilna navodila dobavitelja</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Vnesite podatke, navedene na tem računu. Uporabljeni bodo pri SEPA izvozu.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>TRR / IBAN za plačilo</Label>
                  <Input value={formData.destinationIban} onChange={e => setFormData(p => ({ ...p, destinationIban: e.target.value }))} placeholder="SI56 ..." />
                </div>
                <div className="space-y-2">
                  <Label>BIC</Label>
                  <Input value={formData.destinationBic} onChange={e => setFormData(p => ({ ...p, destinationBic: e.target.value }))} placeholder="BIC banke" />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input value={formData.paymentModel} onChange={e => setFormData(p => ({ ...p, paymentModel: e.target.value }))} placeholder="SI00" />
                </div>
                <div className="space-y-2">
                  <Label>Sklic</Label>
                  <Input value={formData.paymentReference} onChange={e => setFormData(p => ({ ...p, paymentReference: e.target.value }))} placeholder="Sklic prejemnika" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Namen plačila</Label>
                  <Input value={formData.paymentPurpose} onChange={e => setFormData(p => ({ ...p, paymentPurpose: e.target.value }))} placeholder="Namen, naveden na računu" />
                </div>
              </div>
            </div>
          )}

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
            Shrani račun <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// DETAIL INVOICE SHEET
// ---------------------------------------------------------------------------

export function DetailInvoiceSheet({ open, onOpenChange, invoice, onVoid }: { open: boolean, onOpenChange: (open: boolean) => void, invoice: InvoiceRecord, onVoid: () => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const [eslogBusy, setEslogBusy] = useState<number | null>(null);

  const handleEslogDownload = async (prejemnicaId: number, documentNumber: string | null) => {
    if (!activeCompany) return;
    setEslogBusy(prejemnicaId);
    try {
      const token = await getToken();
      await downloadEslogPaket(activeCompany.id, prejemnicaId, documentNumber ?? String(prejemnicaId), token ?? "");
    } catch (e: any) {
      alert(e.message ?? "Napaka pri prenosu e-SLOG paketa.");
    } finally {
      setEslogBusy(null);
    }
  };

  const { data: fullInvoice, isLoading } = useGetInvoice(
    activeCompany?.id ?? "",
    invoice.id,
    { query: { enabled: !!activeCompany?.id && open } as any }
  );

  const lines = fullInvoice?.lines ?? [];
  const postMut = usePostInvoice();
  const [posLinkMode, setPosLinkMode] = useState<"delivery_note_invoice" | "invoice_with_delivery_notes">("invoice_with_delivery_notes");
  const {
    data: posReceiptsData,
    isLoading: posReceiptsLoading,
  } = useGetInvoicePosReceiptLinks(
    activeCompany?.id ?? "",
    invoice.id,
    { query: { enabled: !!activeCompany?.id && open && invoice.type === "received" } as any },
  );
  const linkPosReceiptMut = useLinkInvoicePosReceipt();
  const unlinkPosReceiptMut = useUnlinkInvoicePosReceipt();

  const [linkCandidate, setLinkCandidate] = useState<{
    prejemnicaId: number;
    matchMethod: "manual" | "suggested" | "exact";
    enotaName: string;
    documentNumber: string | null;
    netAmount: string | number;
    reason: string;
    financeComplete: boolean;
    bookedTo109: boolean;
  } | null>(null);

  const [unlinkCandidate, setUnlinkCandidate] = useState<{
    prejemnicaId: number;
    enotaName: string;
    documentNumber: string | null;
  } | null>(null);

  const refreshPosReceipts = () => {
    if (!activeCompany) return;
    queryClient.invalidateQueries({
      queryKey: getGetInvoicePosReceiptLinksQueryKey(activeCompany.id, invoice.id),
    });
  };

  const confirmLink = () => {
    if (!activeCompany || !linkCandidate) return;
    linkPosReceiptMut.mutate({
      companyId: activeCompany.id,
      id: invoice.id,
      data: { prejemnicaId: linkCandidate.prejemnicaId, mode: posLinkMode, matchMethod: linkCandidate.matchMethod },
    }, {
      onSuccess: () => {
        refreshPosReceipts();
        setLinkCandidate(null);
      }
    });
  };

  const confirmUnlink = () => {
    if (!activeCompany || !unlinkCandidate) return;
    unlinkPosReceiptMut.mutate({
      companyId: activeCompany.id,
      id: invoice.id,
      prejemnicaId: unlinkCandidate.prejemnicaId,
    }, {
      onSuccess: () => {
        refreshPosReceipts();
        setUnlinkCandidate(null);
      }
    });
  };

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
        {(invoice as any).sourceType === "bookie-old" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 mb-4">
            Zgodovinski zapis Bookie Old. Zneski in postavke so prevzeti iz izvornih evidenc;
            povezane temeljnice v ERP ostanejo osnutki. Tega računa ni dovoljeno ponovno knjižiti.
            {!invoice.linkedEntryId && " Temeljnica GK manjka — potreben je pregled."}
          </div>
        )}

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
              <div className="font-medium">{formatDatum(invoice.invoiceDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Rok plačila</div>
              <div className="font-medium">{invoice.dueDate ? formatDatum(invoice.dueDate) : "-"}</div>
            </div>
          </div>

          {invoice.type === "received" && (
            <div className="rounded-lg border bg-muted/10 p-4 text-sm">
              <h3 className="font-semibold mb-3">Plačilna navodila dobavitelja</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                <div>
                  <div className="text-muted-foreground mb-1">TRR / IBAN za ta račun</div>
                  <div className="font-mono font-medium break-all">{fullInvoice?.destinationIban || invoice.destinationIban || "Ni navedeno"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">BIC</div>
                  <div className="font-medium">{fullInvoice?.destinationBic || invoice.destinationBic || "Ni navedeno"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Model in sklic</div>
                  <div className="font-medium">
                    {[fullInvoice?.paymentModel || invoice.paymentModel, fullInvoice?.paymentReference || invoice.paymentReference].filter(Boolean).join(" ") || "Ni navedeno"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Namen</div>
                  <div className="font-medium">{fullInvoice?.paymentPurpose || invoice.paymentPurpose || "Ni navedeno"}</div>
                </div>
              </div>
            </div>
          )}

           <div className="space-y-3">
             <h3 className="text-sm font-semibold">{(invoice as any).sourceType === "bookie-old" && invoice.type === "received" ? "Finančni račun" : "Postavke"}</h3>
             {!isLoading && (invoice as any).sourceType === "bookie-old" && invoice.type === "received" && (
               <p className="text-sm text-muted-foreground">
                 Prejeti račun v starem programu nima artikelskih postavk. Finančni zneski so prikazani spodaj;
                 podrobna kontiranja so v povezani GK temeljnici.
               </p>
             )}
             {!isLoading && (invoice as any).sourceType === "bookie-old" && invoice.type === "issued" && (
               <p className="text-xs text-muted-foreground">Količina in cena sta izvorna podatka; pri popustih veljata izvorna neto in DDV vrednost postavke.</p>
             )}
             {((invoice as any).sourceType !== "bookie-old" || invoice.type === "issued") && (
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
             )}
            <div className="flex justify-end p-4 border rounded-md bg-muted/10">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Neto:</span>
                   <span>{(invoice as any).sourceType === "bookie-old" && (invoice as any).historicalNet == null ? "Ni razrešeno" : parseFloat(invoice.totalNet).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>DDV:</span>
                   <span>{(invoice as any).sourceType === "bookie-old" && (invoice as any).historicalVat == null ? "Ni razrešeno" : parseFloat(invoice.totalVat).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t">
                  <span>Bruto:</span>
                  <span>{parseFloat(invoice.totalGross).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {invoice.type === "received" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-primary" />
                    POS prejemnice — zapiranje 109
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Prejemnice so lahko iz različnih enot, vendar morajo pripadati istemu dobavitelju.
                  </p>
                </div>
                {invoice.status === "draft" && (
                  <div className="w-full sm:w-[250px]">
                    <Select value={posLinkMode} onValueChange={(value) => setPosLinkMode(value as typeof posLinkMode)}>
                      <SelectTrigger className="h-9" data-testid="select-pos-link-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="invoice_with_delivery_notes">B — račun z dobavnicami</SelectItem>
                        <SelectItem value="delivery_note_invoice">A — dobavnica je račun</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {posLinkMode === "delivery_note_invoice" && invoice.status === "draft" && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Način A je dovoljen samo, če ima prejemnica številko in datum dokumenta ter popolne DDV podatke.
                  </AlertDescription>
                </Alert>
              )}

              {posReceiptsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-6">
                  {posReceiptsData?.preview?.isDirectDeliveryNoteInvoice ? (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-green-200 bg-green-50 text-sm">
                      <div>
                        <div className="font-semibold text-green-800">Neposredni prejeti račun</div>
                        <div className="text-green-700">Faktura-dobavnica se knjiži brez prehodnega konta 109.</div>
                      </div>
                      <Badge className="bg-green-600 hover:bg-green-700">Pripravljeno</Badge>
                    </div>
                  ) : posReceiptsData?.preview ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-md border bg-muted/20 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Povezano na 109</div>
                        <div className="font-semibold">{Number(posReceiptsData.preview.linkedNet).toFixed(2)} €</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Neto račun</div>
                        <div className="font-semibold">{Number(posReceiptsData.preview.invoiceNet).toFixed(2)} €</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Presežek 109</div>
                        <div className="font-semibold">{Number(posReceiptsData.preview.unclosed109).toFixed(2)} €</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Stanje</div>
                        <Badge variant={posReceiptsData.preview.canPost ? "default" : "outline"} className={posReceiptsData.preview.canPost ? "bg-green-600 hover:bg-green-700" : ""}>
                          {posReceiptsData.preview.canPost ? "Pripravljeno" : "Preverjanje"}
                        </Badge>
                      </div>
                    </div>
                  ) : null}

                  {(posReceiptsData?.preview.reasons?.length ?? 0) > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Račun ostane osnutek</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-sm">
                          {posReceiptsData?.preview.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Links Table */}
                  {(posReceiptsData?.links?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        Povezane prejemnice
                      </h4>
                      <div className="border rounded-md overflow-hidden bg-card">
                        <Table>
                          <TableHeader className="bg-muted/50">
                            <TableRow>
                              <TableHead>Enota / prejemnica</TableHead>
                              <TableHead>Dokument</TableHead>
                              <TableHead>Metoda in status</TableHead>
                              <TableHead className="text-right">Neto</TableHead>
                              <TableHead className="w-[120px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {posReceiptsData?.links.map((link: any) => (
                              <TableRow key={link.id}>
                                <TableCell>
                                  <div className="font-medium">{link.enotaName}</div>
                                  <div className="text-xs text-muted-foreground">Prejemnica {link.receiptNumber ?? `#${link.prejemnicaId}`}</div>
                                </TableCell>
                                <TableCell className="text-sm">{link.documentNumber ?? "Brez številke"}</TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1 items-start">
                                    <Badge variant="outline" className="text-[10px] font-mono whitespace-nowrap bg-muted/30">
                                      {link.matchMethod === "exact" ? "Natančno" : link.matchMethod === "suggested" ? "Predlog" : "Ročno"}
                                    </Badge>
                                    {link.mode === "delivery_note_invoice" ? (
                                      <Badge className="bg-green-600 hover:bg-green-700 text-[10px]">Faktura-dobavnica</Badge>
                                    ) : (
                                      <Badge
                                        variant={link.status === "closed109" ? "default" : "secondary"}
                                        className={link.status === "closed109" ? "bg-green-600 hover:bg-green-700 text-[10px]" : "text-[10px]"}
                                      >
                                        {link.status === "closed109" ? "109 zaprt" : "Potrjeno v osnutku"}
                                      </Badge>
                                    )}
                                    {link.matchedAt && (
                                      <div className="text-[10px] text-muted-foreground mt-1">
                                        Povezal/a {link.matchedBy}<br/>
                                        {new Date(link.matchedAt).toLocaleString("sl-SI")}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  <div className="flex flex-col items-end gap-1">
                                    <span>{Number(link.netAmount).toFixed(2)} €</span>
                                    {link.mode === "delivery_note_invoice" ? (
                                      <Badge variant="outline" className="text-[10px] border-green-200 text-green-700 bg-green-50 px-1 py-0.5 h-auto">Brez 109</Badge>
                                    ) : link.bookedTo109 ? (
                                      <Badge variant="outline" className="text-[10px] border-green-200 text-green-700 bg-green-50 px-1 py-0.5 h-auto">Knjiženo v 109</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50 px-1 py-0.5 h-auto">Čaka 109</Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2 text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-50"
                                      onClick={() => handleEslogDownload(link.prejemnicaId, link.documentNumber ?? null)}
                                      disabled={eslogBusy === link.prejemnicaId}
                                      title="Prenesi e-SLOG paket (XML + PDF + izvirnik)"
                                      data-testid={`button-download-eslog-${link.prejemnicaId}`}
                                    >
                                      {eslogBusy === link.prejemnicaId
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Package className="h-3.5 w-3.5" />}
                                      <span className="ml-1 sr-only sm:not-sr-only">e-SLOG</span>
                                    </Button>
                                    {invoice.status === "draft" && link.status !== "closed109" && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => setUnlinkCandidate({
                                          prejemnicaId: link.prejemnicaId,
                                          enotaName: link.enotaName,
                                          documentNumber: link.documentNumber
                                        })}
                                        disabled={unlinkPosReceiptMut.isPending}
                                        title="Razveži prejemnico"
                                        data-testid={`button-unlink-receipt-${link.prejemnicaId}`}
                                      >
                                        <Unlink className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Candidates Table */}
                  {invoice.status === "draft" && (posReceiptsData?.candidates?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Search className="h-4 w-4" />
                        Predlagane prejemnice ({posReceiptsData?.candidates?.length})
                      </h4>
                      <div className="border rounded-md overflow-hidden bg-card">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead>Prejemnica / Enota</TableHead>
                              <TableHead>Dokument</TableHead>
                              <TableHead>Zanesljivost in razlog</TableHead>
                              <TableHead className="text-right">Neto / 109 status</TableHead>
                              <TableHead className="w-[112px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {posReceiptsData?.candidates.map((candidate: any) => {
                              const isExact = candidate.matchMethod === "exact";
                              return (
                                <TableRow key={candidate.prejemnicaId}>
                                  <TableCell>
                                    <div className="font-medium">{candidate.enotaName}</div>
                                    <div className="text-xs text-muted-foreground">#{candidate.prejemnicaId}</div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">{candidate.documentNumber ?? "-"}</div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col gap-1 items-start">
                                      <Badge variant={isExact ? "default" : "secondary"} className={isExact ? "bg-blue-600 hover:bg-blue-700 text-[10px]" : "text-[10px]"}>
                                        {isExact ? "Natančno ujemanje" : `Predlog (${Math.round((candidate.confidence ?? 0) * 100)}%)`}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">{candidate.reason}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex flex-col items-end gap-1">
                                      <span className="font-medium">{Number(candidate.netAmount).toFixed(2)} €</span>
                                      {candidate.bookedTo109 ? (
                                        <Badge variant="outline" className="text-[10px] border-green-200 text-green-700 bg-green-50 px-1 py-0.5 h-auto">Knjiženo v 109</Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50 px-1 py-0.5 h-auto">Čaka 109</Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant={isExact ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => setLinkCandidate({
                                        prejemnicaId: candidate.prejemnicaId,
                                        matchMethod: isExact ? "exact" : "suggested",
                                        enotaName: candidate.enotaName,
                                        documentNumber: candidate.documentNumber,
                                        netAmount: candidate.netAmount,
                                        reason: candidate.reason,
                                        financeComplete: candidate.financeComplete,
                                        bookedTo109: candidate.bookedTo109
                                      })}
                                      disabled={linkPosReceiptMut.isPending || (posLinkMode === "delivery_note_invoice" && !candidate.financeComplete)}
                                      title={posLinkMode === "delivery_note_invoice" && !candidate.financeComplete ? "Za način A manjkajo finančni podatki." : undefined}
                                      data-testid={`button-link-candidate-${candidate.prejemnicaId}`}
                                    >
                                      <Link2 className="mr-1.5 h-3.5 w-3.5" />
                                      Poveži
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* History Log */}
                  {(posReceiptsData?.matchHistory?.length ?? 0) > 0 && (
                    <div className="space-y-2 pt-4">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                        <History className="h-4 w-4" />
                        Zgodovina povezav
                      </h4>
                      <div className="border rounded-md p-0 bg-card overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/20">
                            <TableRow>
                              <TableHead className="w-[140px] text-xs">Čas</TableHead>
                              <TableHead className="text-xs">Uporabnik</TableHead>
                              <TableHead className="text-xs">Akcija</TableHead>
                              <TableHead className="text-xs">Prejemnica</TableHead>
                              <TableHead className="text-xs">Status / Metoda</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {posReceiptsData?.matchHistory.map((entry: InvoicePosReceiptMatchHistoryEntry, i: number) => {
                              const isUnlink = entry.action === "unlinked";
                              const isClosed109 = entry.action === "closed109";
                              return (
                                <TableRow key={i} className={isUnlink ? "opacity-75" : ""}>
                                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {new Date(entry.changedAt).toLocaleString("sl-SI")}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {entry.changedBy}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={`text-[10px] ${
                                      isUnlink ? "text-destructive border-destructive/30 bg-destructive/5"
                                      : isClosed109 ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                                      : "text-blue-700 border-blue-200 bg-blue-50"
                                    }`}>
                                      {isUnlink ? "Razveza" : isClosed109 ? "Zaprtje 109" : "Povezava"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    {entry.prejemnicaId ? `#${entry.prejemnicaId}` : "-"}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {entry.status === "closed109" ? "109 zaprt" : entry.status === "confirmed" ? "Osnutek" : entry.status === "unlinked" ? "Razvezano" : entry.status}
                                    {entry.matchMethod && ` • ${entry.matchMethod === 'exact' ? 'Natančno' : entry.matchMethod === 'suggested' ? 'Predlog' : 'Ročno'}`}
                                    {entry.mode && ` • ${entry.mode === 'delivery_note_invoice' ? 'Način A' : 'Način B'}`}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Empty history state if no links and no candidates and no history */}
                  {(posReceiptsData?.links?.length === 0) && (posReceiptsData?.candidates?.length === 0) && (posReceiptsData?.matchHistory?.length === 0) && (
                    <div className="text-center p-6 border rounded-md bg-muted/10 text-muted-foreground text-sm">
                      Ni najdenih prejemnic za tega dobavitelja.
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

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
          {invoice.status === "draft" && (invoice as any).sourceType !== "bookie-old" && activeCompany?.role !== "viewer" && (
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

      <Dialog open={!!linkCandidate} onOpenChange={(open) => {
        if (!open) {
          setLinkCandidate(null);
          linkPosReceiptMut.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Potrditev povezave</DialogTitle>
            <DialogDescription>
              Preglejte podatke pred povezavo prejemnice z računom.
            </DialogDescription>
          </DialogHeader>
          {linkCandidate && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Prejemnica:</div>
                <div className="font-medium text-right">#{linkCandidate.prejemnicaId} ({linkCandidate.enotaName})</div>

                <div className="text-muted-foreground">Dokument:</div>
                <div className="font-medium text-right">{linkCandidate.documentNumber ?? "-"}</div>

                <div className="text-muted-foreground">Neto znesek:</div>
                <div className="font-medium text-right">{Number(linkCandidate.netAmount).toFixed(2)} €</div>

                <div className="text-muted-foreground">Način povezave:</div>
                <div className="font-medium text-right">
                  {posLinkMode === "delivery_note_invoice" ? "A — dobavnica je račun" : "B — račun z dobavnicami"}
                </div>

                <div className="text-muted-foreground">Metoda ujemanja:</div>
                <div className="font-medium text-right">
                  {linkCandidate.matchMethod === "exact" ? "Natančno" : linkCandidate.matchMethod === "suggested" ? "Predlagano" : "Ročno"}
                </div>

                <div className="text-muted-foreground">Knjiženo v 109:</div>
                <div className="font-medium text-right flex items-center justify-end gap-1">
                  {linkCandidate.bookedTo109 ? (
                    <><CheckCircle className="h-3.5 w-3.5 text-green-600" /> Da</>
                  ) : (
                    <><Clock className="h-3.5 w-3.5 text-amber-600" /> Ne</>
                  )}
                </div>
              </div>

              {posLinkMode === "delivery_note_invoice" && !linkCandidate.financeComplete && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Prejemnica nima popolnih finančnih podatkov (DDV / zneski), zato je ni mogoče neposredno povezati kot način A (dobavnica je račun).
                  </AlertDescription>
                </Alert>
              )}

              {linkPosReceiptMut.error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{(linkPosReceiptMut.error as any)?.data?.error || (linkPosReceiptMut.error as any)?.error || "Prišlo je do napake pri povezovanju."}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkCandidate(null); linkPosReceiptMut.reset(); }} disabled={linkPosReceiptMut.isPending}>Prekliči</Button>
            <Button
              onClick={confirmLink}
              disabled={linkPosReceiptMut.isPending || (posLinkMode === "delivery_note_invoice" && linkCandidate?.financeComplete === false)}
              data-testid="button-confirm-link"
            >
              {linkPosReceiptMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Potrdi povezavo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unlinkCandidate} onOpenChange={(open) => {
        if (!open) {
          setUnlinkCandidate(null);
          unlinkPosReceiptMut.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Razveži prejemnico</DialogTitle>
            <DialogDescription>
              Ali res želite razvezati prejemnico od tega računa? Razvezane prejemnice bodo na voljo za ponovno povezavo, če se ujemajo po dobavitelju.
            </DialogDescription>
          </DialogHeader>
          {unlinkCandidate && (
            <div className="grid gap-2 py-4 text-sm bg-muted/20 p-4 rounded-md border mt-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prejemnica:</span>
                <span className="font-medium">#{unlinkCandidate.prejemnicaId} ({unlinkCandidate.enotaName})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dokument:</span>
                <span className="font-medium">{unlinkCandidate.documentNumber ?? "-"}</span>
              </div>
            </div>
          )}
          {unlinkPosReceiptMut.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{(unlinkPosReceiptMut.error as any)?.data?.error || (unlinkPosReceiptMut.error as any)?.error || "Prišlo je do napake pri razvezovanju."}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnlinkCandidate(null); unlinkPosReceiptMut.reset(); }} disabled={unlinkPosReceiptMut.isPending}>Prekliči</Button>
            <Button variant="destructive" onClick={confirmUnlink} disabled={unlinkPosReceiptMut.isPending} data-testid="button-confirm-unlink">
              {unlinkPosReceiptMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Razveži prejemnico
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
