/**
 * ERP Prejemnice brez računa
 *
 * Tok: Blago prispe z dobavnico → prejemnica (DR zaloga / CR 221) →
 *      ob prejemu računa ujemanje (DR 221 / CR 220).
 */
import React, { useState, useCallback } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useListCounterparties,
  useListPeriods,
  useListAccounts,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, Plus, FileCheck, Link2, Link2Off, XCircle,
  ChevronDown, ChevronRight, Loader2, PackageOpen,
} from "lucide-react";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface GoodsReceiptLine {
  id: string;
  description: string;
  accountId: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
  notes: string | null;
}

interface GoodsReceipt {
  id: string;
  counterpartyId: string;
  counterpartyName: string | null;
  periodId: string;
  periodName: string | null;
  receiptDate: string;
  deliveryNoteNo: string;
  description: string | null;
  status: "open" | "matched" | "voided";
  totalAmount: string;
  linkedEntryId: string | null;
  matchedInvoiceId: string | null;
  matchEntryId: string | null;
  createdAt: string;
  lines?: GoodsReceiptLine[];
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  counterpartyName: string | null;
  totalAmount?: string;
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Alias so existing call sites work unchanged
const customFetch = apiFetch;

// ─── API helpers ─────────────────────────────────────────────────────────────

function useGoodsReceipts(companyId: string, status?: string) {
  return useQuery({
    queryKey: ["companies", companyId, "goods-receipts", status],
    queryFn: () => {
      const qs = status ? `?status=${status}` : "";
      return customFetch<{ receipts: GoodsReceipt[] }>(
        `/api/companies/${companyId}/goods-receipts${qs}`,
      );
    },
    enabled: !!companyId,
  });
}

function usePostedReceivedInvoices(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["companies", companyId, "invoices-posted-received"],
    queryFn: () =>
      customFetch<{ invoices: InvoiceOption[] }>(
        `/api/companies/${companyId}/invoices?type=received&status=posted`,
      ),
    enabled: !!companyId && enabled,
  });
}

// ─── Pomočniki ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "Odprta",
  matched: "Ujeta",
  voided: "Preklicana",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-blue-100 text-blue-800",
  matched: "bg-emerald-100 text-emerald-800",
  voided: "bg-slate-100 text-slate-500 line-through",
};

function fmtEur(v: string | number | null | undefined) {
  const n = parseFloat(String(v ?? "0"));
  if (isNaN(n)) return "–";
  return new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "–";
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("sl-SI", { timeZone: "UTC" });
}

// ─── Forma za novo prejemnico ─────────────────────────────────────────────────

interface NewReceiptLine {
  description: string;
  quantity: string;
  unitPrice: string;
  accountId: string;
  notes: string;
}

const DEFAULT_LINE: NewReceiptLine = { description: "", quantity: "1", unitPrice: "", accountId: "", notes: "" };

function NewReceiptDialog({
  open,
  onClose,
  companyId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    counterpartyId: "", periodId: "", receiptDate: new Date().toISOString().slice(0, 10),
    deliveryNoteNo: "", description: "", transitAccountId: "", inventoryAccountId: "", notes: "",
  });
  const [lines, setLines] = useState<NewReceiptLine[]>([{ ...DEFAULT_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: cpData } = useListCounterparties(companyId, { includeInactive: false }, { query: { enabled: open } as any });
  const { data: periodsData } = useListPeriods(companyId, { query: { enabled: open } as any });
  const { data: accountsData } = useListAccounts(companyId, {}, { query: { enabled: open } as any });

  const counterparties = (cpData?.counterparties ?? []).filter((c: any) => c.type === "supplier" || c.type === "both");
  const openPeriods = (periodsData?.periods ?? []).filter((p: any) => p.status === "open");
  const postableAccounts = (accountsData?.accounts ?? []).filter((a: any) => a.allowsPosting && a.isActive);

  const totalAmount = lines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity || "1") || 0;
    const price = parseFloat(l.unitPrice || "0") || 0;
    return sum + qty * price;
  }, 0);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!form.counterpartyId || !form.periodId || !form.receiptDate || !form.deliveryNoteNo || !form.transitAccountId || !form.inventoryAccountId) {
      setError("Izpolnite vsa obvezna polja"); return;
    }
    if (lines.some(l => !l.description || !l.unitPrice)) {
      setError("Vsaka vrstica mora imeti opis in ceno"); return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/companies/${companyId}/goods-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          lines: lines.map(l => ({
            description: l.description,
            quantity: parseFloat(l.quantity) || 1,
            unitPrice: parseFloat(l.unitPrice),
            accountId: l.accountId || undefined,
            notes: l.notes || undefined,
          })),
        }),
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Napaka pri shranjevanju");
    } finally {
      setSaving(false);
    }
  }, [form, lines, companyId, onCreated, onClose]);

  const addLine = () => setLines(l => [...l, { ...DEFAULT_LINE }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof NewReceiptLine, val: string) =>
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: val } : line));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            Nova prejemnica brez računa
          </DialogTitle>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Dobavitelj *</Label>
            <Select value={form.counterpartyId} onValueChange={v => setForm(f => ({ ...f, counterpartyId: v }))}>
              <SelectTrigger><SelectValue placeholder="Izberi dobavitelja…" /></SelectTrigger>
              <SelectContent>
                {counterparties.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Obdobje *</Label>
            <Select value={form.periodId} onValueChange={v => setForm(f => ({ ...f, periodId: v }))}>
              <SelectTrigger><SelectValue placeholder="Izberi obdobje…" /></SelectTrigger>
              <SelectContent>
                {openPeriods.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Datum prejema *</Label>
            <Input type="date" value={form.receiptDate} onChange={e => setForm(f => ({ ...f, receiptDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Številka dobavnice *</Label>
            <Input placeholder="npr. DN-2026-0042" value={form.deliveryNoteNo} onChange={e => setForm(f => ({ ...f, deliveryNoteNo: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Zalogni konto * <span className="text-muted-foreground text-xs">(DR, npr. 310, 660)</span></Label>
            <Select value={form.inventoryAccountId} onValueChange={v => setForm(f => ({ ...f, inventoryAccountId: v }))}>
              <SelectTrigger><SelectValue placeholder="Izberi konto zaloge…" /></SelectTrigger>
              <SelectContent>
                {postableAccounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Prehodni konto * <span className="text-muted-foreground text-xs">(CR, npr. 221)</span></Label>
            <Select value={form.transitAccountId} onValueChange={v => setForm(f => ({ ...f, transitAccountId: v }))}>
              <SelectTrigger><SelectValue placeholder="Izberi konto 221…" /></SelectTrigger>
              <SelectContent>
                {postableAccounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Opis</Label>
            <Input placeholder="Opis dobave…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </div>

        {/* Vrstice */}
        <div className="space-y-2 mt-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Vrstice blaga</Label>
            <Button size="sm" variant="outline" onClick={addLine} type="button">
              <Plus className="h-3 w-3 mr-1" />Dodaj vrstico
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[35%]">Opis *</TableHead>
                  <TableHead className="w-16 text-right">Kol.</TableHead>
                  <TableHead className="w-24 text-right">Cena/enoto *</TableHead>
                  <TableHead className="w-24 text-right">Znesek</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input className="h-7 text-xs" value={l.description} onChange={e => updateLine(i, "description", e.target.value)} placeholder="Opis artikla…" />
                    </TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs text-right" value={l.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs text-right" value={l.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)} placeholder="0.00" />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmtEur((parseFloat(l.quantity || "1") || 0) * (parseFloat(l.unitPrice || "0") || 0))}
                    </TableCell>
                    <TableCell>
                      {lines.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeLine(i)}>
                          <XCircle className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="text-right text-sm font-semibold">
            Skupaj: <span className="tabular-nums">{fmtEur(totalAmount)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Opomba</Label>
          <Textarea className="text-sm" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Prekliči</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Shrani in poknjiži
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog za ujemanje z računom ────────────────────────────────────────────

function MatchDialog({
  receipt,
  companyId,
  onClose,
  onMatched,
}: {
  receipt: GoodsReceipt;
  companyId: string;
  onClose: () => void;
  onMatched: () => void;
}) {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: invData, isLoading } = usePostedReceivedInvoices(companyId, true);
  const invoices = invData?.invoices ?? [];

  const handleMatch = async () => {
    if (!selectedInvoiceId) { setError("Izberite račun"); return; }
    setSaving(true); setError(null);
    try {
      await customFetch(`/api/companies/${companyId}/goods-receipts/${receipt.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: selectedInvoiceId }),
      });
      onMatched();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Napaka");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Ujemi z računom: {receipt.deliveryNoteNo}
          </DialogTitle>
        </DialogHeader>

        <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Dobavitelj:</span><span className="font-medium">{receipt.counterpartyName}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Datum dobavnice:</span><span>{fmtDate(receipt.receiptDate)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Znesek prejemnice:</span><span className="font-semibold">{fmtEur(receipt.totalAmount)}</span></div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Izberite poknjižen prejeti račun. Ob ujemanju se samodejno ustvari temeljnica:
            <span className="font-medium"> DR 221 Neobračunano blago / CR 220 Obveznosti do dobaviteljev</span>.
          </p>
          {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

          {isLoading ? <Skeleton className="h-10 w-full" /> : (
            <Select value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Izberi poknjižen prejeti račun…" />
              </SelectTrigger>
              <SelectContent>
                {invoices.length === 0 && (
                  <SelectItem value="_none" disabled>Ni poknjiženih prejetih računov</SelectItem>
                )}
                {invoices.map((inv: any) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {inv.counterpartyName ?? "?"} ({fmtDate(inv.invoiceDate)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Prekliči</Button>
          <Button onClick={handleMatch} disabled={saving || !selectedInvoiceId}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Potrdi ujemanje
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Kartica ene prejemnice ───────────────────────────────────────────────────

function ReceiptRow({
  receipt,
  companyId,
  onRefresh,
}: {
  receipt: GoodsReceipt;
  companyId: string;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [actioning, setActioning] = useState(false);

  const handleUnmatch = async () => {
    if (!confirm("Razveljaviti ujemanje in stornirati zapiralno temeljnico?")) return;
    setActioning(true);
    try {
      await customFetch(`/api/companies/${companyId}/goods-receipts/${receipt.id}/match`, { method: "DELETE" });
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setActioning(false); }
  };

  const handleVoid = async () => {
    if (!confirm("Preklicati prejemnico in stornirati temeljnico?")) return;
    setActioning(true);
    try {
      await customFetch(`/api/companies/${companyId}/goods-receipts/${receipt.id}/void`, { method: "POST" });
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setActioning(false); }
  };

  return (
    <>
      <TableRow className={receipt.status === "voided" ? "opacity-50" : ""}>
        <TableCell className="w-6 p-1">
          <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="font-medium whitespace-nowrap">{fmtDate(receipt.receiptDate)}</TableCell>
        <TableCell className="font-mono font-medium">{receipt.deliveryNoteNo}</TableCell>
        <TableCell className="max-w-[180px] truncate">{receipt.counterpartyName ?? "–"}</TableCell>
        <TableCell>{receipt.description ?? <span className="text-muted-foreground">–</span>}</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{fmtEur(receipt.totalAmount)}</TableCell>
        <TableCell>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[receipt.status]}`}>
            {STATUS_LABEL[receipt.status]}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            {receipt.status === "open" && (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setMatchOpen(true)} disabled={actioning}>
                  <Link2 className="h-3 w-3 mr-1" />Ujemi
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600 hover:text-red-700" onClick={handleVoid} disabled={actioning}>
                  <XCircle className="h-3 w-3 mr-1" />Prekliči
                </Button>
              </>
            )}
            {receipt.status === "matched" && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={handleUnmatch} disabled={actioning}>
                <Link2Off className="h-3 w-3 mr-1" />Razveži
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/20 p-0">
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                {receipt.linkedEntryId && (
                  <div>
                    <span className="text-muted-foreground text-xs">Temeljnica zaloge:</span>
                    <div className="font-mono text-xs mt-0.5 text-primary">
                      DR Zaloga / CR 221 — <a href={`/temeljnice`} className="underline">{receipt.linkedEntryId.slice(0, 8)}…</a>
                    </div>
                  </div>
                )}
                {receipt.matchEntryId && (
                  <div>
                    <span className="text-muted-foreground text-xs">Temeljnica zapiranja:</span>
                    <div className="font-mono text-xs mt-0.5 text-emerald-700">
                      DR 221 / CR 220 — <a href={`/temeljnice`} className="underline">{receipt.matchEntryId.slice(0, 8)}…</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}

      {matchOpen && (
        <MatchDialog
          receipt={receipt}
          companyId={companyId}
          onClose={() => setMatchOpen(false)}
          onMatched={onRefresh}
        />
      )}
    </>
  );
}

// ─── Glavna stran ─────────────────────────────────────────────────────────────

export default function Prejemnice() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading, error } = useGoodsReceipts(
    activeCompany?.id ?? "",
    statusFilter === "all" ? undefined : statusFilter,
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["companies", activeCompany?.id, "goods-receipts"] });
  }, [queryClient, activeCompany?.id]);

  const receipts = data?.receipts ?? [];

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prejemnice brez računa</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Blago prispelo z dobavnico — račun čaka. <span className="font-medium">DR Zaloga / CR 221</span> ob prejemu,
            <span className="font-medium"> DR 221 / CR 220</span> ob ujemanju z računom.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} disabled={!activeCompany}>
          <Plus className="h-4 w-4 mr-2" />
          Nova prejemnica
        </Button>
      </div>

      {/* Filtri */}
      <div className="flex gap-1.5">
        {(["open", "matched", "voided", "all"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
          >
            {s === "open" ? "Odprte" : s === "matched" ? "Ujete" : s === "voided" ? "Preklicane" : "Vse"}
          </button>
        ))}
      </div>

      {/* Vsebina */}
      {!activeCompany ? (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Izberite podjetje</AlertTitle></Alert>
      ) : isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju</AlertTitle>
          <AlertDescription>Prišlo je do napake. Poskusite znova.</AlertDescription>
        </Alert>
      ) : receipts.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-card text-muted-foreground">
          <PackageOpen className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <div className="font-medium">
            {statusFilter === "open" ? "Ni odprtih prejemnic" : statusFilter === "matched" ? "Ni ujetih prejemnic" : "Ni prejemnic"}
          </div>
          {statusFilter === "open" && (
            <div className="text-sm mt-1">Kliknite „Nova prejemnica" ko prispe blago z dobavnico brez računa.</div>
          )}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-6 p-1" />
                <TableHead>Datum</TableHead>
                <TableHead>Dobavnica</TableHead>
                <TableHead>Dobavitelj</TableHead>
                <TableHead>Opis</TableHead>
                <TableHead className="text-right">Znesek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-32">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map(r => (
                <ReceiptRow key={r.id} receipt={r} companyId={activeCompany.id} onRefresh={invalidate} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Legenda */}
      <div className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/20 space-y-1">
        <div className="font-medium text-foreground mb-1">Računovodski tok:</div>
        <div>1. <span className="font-medium">Nova prejemnica</span> → samodejno poknjiži: <span className="font-mono">DR Zaloga / CR 221 Neobračunano blago</span></div>
        <div>2. <span className="font-medium">Ujemi z računom</span> (ko račun prispe) → samodejno poknjiži: <span className="font-mono">DR 221 / CR 220 Obveznosti do dobaviteljev</span></div>
        <div>3. Račun se nato plača po normalnem postopku prek konta 220.</div>
      </div>

      {newOpen && activeCompany && (
        <NewReceiptDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          companyId={activeCompany.id}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}
