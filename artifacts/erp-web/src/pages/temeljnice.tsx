import React, { useState, useMemo, useEffect } from "react";
import { useF2Save } from "@/hooks/useF2Save";
import { useQueryClient } from "@tanstack/react-query";

import { Plus, Search, Filter, AlertCircle, AlertTriangle, FileText, Loader2, ArrowRightLeft, CheckCircle2, Trash2, ChevronRight, Building2, FolderKanban, Users } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListJournalEntries,
  useGetJournalEntry,
  useCreateJournalEntry,
  usePostJournalEntry,
  useReverseJournalEntry,
  useListPeriods,
  useListAccounts,
  useListCounterparties,
  useListCostCenters,
  useListProjects,
  useListDepartments,
  getListJournalEntriesQueryKey,
  type JournalEntry,
} from "@workspace/api-client-react";

// API vrne dimenzijska polja za seznam, ki niso (še) v generiranem tipu
type JournalEntryWithDims = JournalEntry & {
  costCenterNames?: string[];
  projectNames?: string[];
  departmentNames?: string[];
};

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const STATUS_LABELS: Record<string, string> = {
  draft: "Osnutek",
  posted: "Knjiženo",
  reversed: "Stornirano"
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Ročno",
  bank_import: "Banka",
  document: "Dokument",
  ai_suggestion: "AI",
};
const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-gray-100 text-gray-700",
  bank_import: "bg-blue-100 text-blue-700",
  document: "bg-violet-100 text-violet-700",
  ai_suggestion: "bg-amber-100 text-amber-700",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  posted: "default",
  reversed: "secondary"
};

export default function Temeljnice() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [costCenterFilter, setCostCenterFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];

  const { data: costCentersData } = useListCostCenters(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const costCenters = costCentersData?.costCenters ?? [];

  const { data: projectsData } = useListProjects(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const projects = projectsData?.projects ?? [];

  const { data: departmentsData } = useListDepartments(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const departments = departmentsData?.departments ?? [];

  const { data: entriesData, isLoading, error } = useListJournalEntries(
    activeCompany?.id ?? "",
    {
      periodId: periodFilter !== "all" ? periodFilter : undefined,
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      costCenterId: costCenterFilter !== "all" ? costCenterFilter : undefined,
      projectId: projectFilter !== "all" ? projectFilter : undefined,
      departmentId: departmentFilter !== "all" ? departmentFilter : undefined,
    },
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const entries = entriesData?.entries ?? [];

  const postMut = usePostJournalEntry();

  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<JournalEntry | null>(null);

  const [stornoOpen, setStornoOpen] = useState(false);
  const [stornoEntry, setStornoEntry] = useState<JournalEntry | null>(null);

  const handlePost = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!activeCompany) return;
    if (window.confirm("Ali res želite poknjižiti temeljnico? Po knjiženju popravki niso več mogoči.")) {
      postMut.mutate({ companyId: activeCompany.id, id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey(activeCompany.id) });
        }
      });
    }
  };

  const handleStornoClick = (e: React.MouseEvent, entry: JournalEntry) => {
    e.stopPropagation();
    setStornoEntry(entry);
    setStornoOpen(true);
  };

  const clearFilters = () => {
    setPeriodFilter("all");
    setStatusFilter("all");
    setCostCenterFilter("all");
    setProjectFilter("all");
    setDepartmentFilter("all");
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju temeljnic.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Temeljnice</h1>
          <p className="text-muted-foreground mt-1">Upravljanje z dnevniki in knjiženjem prometa.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewEntryOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova temeljnica
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Obdobje</Label>
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger>
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
              <SelectTrigger>
                <SelectValue placeholder="Vsi statusi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsi statusi</SelectItem>
                <SelectItem value="draft">Osnutek</SelectItem>
                <SelectItem value="posted">Knjiženo</SelectItem>
                <SelectItem value="reversed">Stornirano</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {costCenters.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Stroškovno mesto</Label>
              <Select value={costCenterFilter} onValueChange={setCostCenterFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Vsa stroškovna mesta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsa stroškovna mesta</SelectItem>
                  {costCenters.map(cc => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {projects.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Projekt</Label>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Vsi projekti" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsi projekti</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {departments.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Oddelek</Label>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Vsi oddelki" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsi oddelki</SelectItem>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {(periodFilter !== "all" || statusFilter !== "all" || costCenterFilter !== "all" || projectFilter !== "all" || departmentFilter !== "all") && (
          <div className="flex">
            <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground h-8 px-3 text-xs">
              Počisti filtre
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : entries.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Ni najdenih temeljnic</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Za izbrane filtre ni bilo mogoče najti nobene temeljnice. Poskusite spremeniti iskalne pogoje ali ustvarite novo.
          </p>
          {activeCompany?.role !== "viewer" && (
            <Button onClick={() => setNewEntryOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Ustvari prvo temeljnico
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Datum</TableHead>
                <TableHead>Opis</TableHead>
                <TableHead className="w-[90px]">Izvor</TableHead>
                <TableHead className="w-[150px]">Obdobje</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[160px] text-right">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries as JournalEntryWithDims[]).map(entry => (
                <TableRow 
                  key={entry.id} 
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setDetailEntry(entry)}
                >
                  <TableCell className="font-medium">{new Date(entry.entryDate).toLocaleDateString("sl-SI")}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div>
                        {entry.description}
                        {entry.reversalOf && <Badge variant="secondary" className="ml-2 text-[10px] py-0">Storno</Badge>}
                      </div>
                      {((entry.costCenterNames?.length ?? 0) > 0 || (entry.projectNames?.length ?? 0) > 0 || (entry.departmentNames?.length ?? 0) > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {entry.costCenterNames?.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                              <Building2 className="h-2.5 w-2.5" />{name}
                            </span>
                          ))}
                          {entry.projectNames?.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              <FolderKanban className="h-2.5 w-2.5" />{name}
                            </span>
                          ))}
                          {entry.departmentNames?.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                              <Users className="h-2.5 w-2.5" />{name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {entry.sourceType ? (
                      <Badge variant="secondary" className={`text-[10px] py-0 ${SOURCE_COLORS[entry.sourceType] ?? ""}`}>
                        {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
                      </Badge>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{entry.periodName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[entry.status]} className={entry.status === 'posted' ? 'bg-green-600 hover:bg-green-700' : ''}>
                      {STATUS_LABELS[entry.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {entry.status === "draft" && activeCompany?.role !== "viewer" && (
                        <Button variant="outline" size="sm" onClick={(e) => handlePost(e, entry.id)} disabled={postMut.isPending}>
                          {postMut.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-2 h-3 w-3 text-green-600" />}
                          Poknjiži
                        </Button>
                      )}
                      {entry.status === "posted" && activeCompany?.role !== "viewer" && (
                        <Button variant="outline" size="sm" onClick={(e) => handleStornoClick(e, entry)}>
                          <ArrowRightLeft className="mr-2 h-3 w-3" />
                          Storno
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {newEntryOpen && (
        <NewEntrySheet open={newEntryOpen} onOpenChange={setNewEntryOpen} />
      )}

      {detailEntry && (
        <DetailEntrySheet 
          entry={detailEntry} 
          open={!!detailEntry} 
          onOpenChange={(v) => { if (!v) setDetailEntry(null); }}
          onStorno={(entry) => setStornoEntry(entry)}
        />
      )}

      {stornoEntry && (
        <StornoDialog 
          entry={stornoEntry} 
          open={stornoOpen} 
          onOpenChange={setStornoOpen} 
          onSuccess={() => setStornoEntry(null)} 
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEW ENTRY SHEET
// ---------------------------------------------------------------------------

function NewEntrySheet({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const accounts = accountsData?.accounts?.filter(a => a.isActive && !a.parentId) || []; 
  // Normally you'd select analytic accounts (those that don't have children or are designated as selectable). 
  // Let's assume accounts without children in the tree, or we just list all active accounts.
  // Actually, we'll list all active accounts but typically you post to analytic.
  const activeAccounts = accountsData?.accounts?.filter(a => a.isActive) || [];

  const [periodId, setPeriodId] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [autoPost, setAutoPost] = useState(false);

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  const { data: costCentersData } = useListCostCenters(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const costCenters = costCentersData?.costCenters ?? [];

  const { data: projectsData } = useListProjects(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const projects = projectsData?.projects ?? [];

  const { data: departmentsData } = useListDepartments(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const departments = departmentsData?.departments ?? [];

  const [lines, setLines] = useState([
    { id: "1", accountId: "", side: "debit" as const, amount: "", description: "", partnerId: "", costCenterId: "", projectId: "", departmentId: "" },
    { id: "2", accountId: "", side: "credit" as const, amount: "", description: "", partnerId: "", costCenterId: "", projectId: "", departmentId: "" },
  ]);

  const addLine = () => {
    setLines([...lines, { id: Math.random().toString(), accountId: "", side: "debit", amount: "", description: "", partnerId: "", costCenterId: "", projectId: "", departmentId: "" }]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines(lines.filter(l => l.id !== id));
  };

  const updateLine = (id: string, field: string, value: any) => {
    setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    lines.forEach(l => {
      const val = parseFloat(l.amount) || 0;
      if (l.side === "debit") debit += val;
      if (l.side === "credit") credit += val;
    });
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.001 };
  }, [lines]);

  const createMut = useCreateJournalEntry();

  const handleSave = () => {
    if (!activeCompany) return;
    const finalLines = lines.filter(l => l.accountId && parseFloat(l.amount) > 0).map(l => ({
      accountId: l.accountId,
      side: l.side,
      amount: parseFloat(l.amount),
      description: l.description || null,
      partnerId: l.partnerId || null,
      costCenterId: l.costCenterId || null,
      projectId: l.projectId || null,
      departmentId: l.departmentId || null,
    }));

    if (finalLines.length < 2) return;

    createMut.mutate({
      companyId: activeCompany.id,
      data: {
        periodId,
        entryDate,
        description,
        reference: reference || null,
        autoPost,
        lines: finalLines
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey(activeCompany.id) });
        onOpenChange(false);
      }
    });
  };
  useF2Save(handleSave, canSave && !createMut.isPending);

  // set default period if open periods exist
  useEffect(() => {
    if (open && openPeriods.length > 0 && !periodId) {
      setPeriodId(openPeriods[0].id);
    }
  }, [open, openPeriods, periodId]);

  const validLines = lines.filter(l => l.accountId && parseFloat(l.amount) > 0);
  const dimensionErrors = validLines.some(l => {
    const acc = activeAccounts.find(a => a.id === l.accountId);
    if (!acc) return false;
    if (acc.requiresPartner && !l.partnerId) return true;
    if (acc.requiresCostCenter && !l.costCenterId) return true;
    if (acc.requiresProject && !l.projectId) return true;
    return false;
  });
  const groupAccountErrors = lines.some(l => {
    if (!l.accountId) return false;
    const acc = activeAccounts.find(a => a.id === l.accountId);
    return acc ? acc.allowsPosting === false : false;
  });
  const canSave = periodId && description && validLines.length >= 2 && (!autoPost || totals.balanced) && !dimensionErrors && !groupAccountErrors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>Nova temeljnica</SheetTitle>
          <SheetDescription>Ročni vnos dnevniških knjižb v glavno knjigo.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Datum</Label>
              <Input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Obdobje</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite obdobje" />
                </SelectTrigger>
                <SelectContent>
                  {openPeriods.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                  {openPeriods.length === 0 && <SelectItem value="none" disabled>Ni odprtih obdobij</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Opis temeljnice</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Npr. Prejeti račun 2024-001" />
          </div>

          <div className="space-y-2">
            <Label>Sklic (neobvezno)</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Npr. SI00 2024001" />
          </div>

          <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
            <Checkbox id="autopost" checked={autoPost} onCheckedChange={(c) => setAutoPost(!!c)} />
            <Label htmlFor="autopost" className="font-medium cursor-pointer">Takoj poknjiži</Label>
            <span className="text-xs text-muted-foreground ml-2">(Preskoči osnutek)</span>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold">Postavke (Vrstice)</h3>
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Dodaj vrstico
              </Button>
            </div>

            <div className="border rounded-md divide-y bg-card">
              {lines.map((line, i) => (
                <div key={line.id} className="p-3 grid gap-3 relative group">
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Konto</Label>
                      <Select value={line.accountId} onValueChange={(val) => updateLine(line.id, "accountId", val)}>
                        <SelectTrigger className={`h-9 ${line.accountId && activeAccounts.find(a => a.id === line.accountId)?.allowsPosting === false ? "border-amber-500 ring-1 ring-amber-500" : ""}`}>
                          <SelectValue placeholder="Izberite konto..." />
                        </SelectTrigger>
                        <SelectContent>
                          {activeAccounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {line.accountId && activeAccounts.find(a => a.id === line.accountId)?.allowsPosting === false && (
                        <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span>To je skupinski konto — na njem knjiženje ni dovoljeno. Izberite analitični konto.</span>
                        </div>
                      )}
                    </div>
                    {lines.length > 2 && (
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive self-end" onClick={() => removeLine(line.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-[100px_1fr_1fr] gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Stran</Label>
                      <Select value={line.side} onValueChange={(val) => updateLine(line.id, "side", val)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debit">Breme (D)</SelectItem>
                          <SelectItem value="credit">Dobro (K)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Znesek</Label>
                      <Input type="number" min="0.01" step="0.01" value={line.amount} onChange={e => updateLine(line.id, "amount", e.target.value)} className="h-9 text-right" placeholder="0.00" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Opis (neobvezno)</Label>
                      <Input value={line.description} onChange={e => updateLine(line.id, "description", e.target.value)} className="h-9" placeholder="..." />
                    </div>
                  </div>

                  {(() => {
                    const selAcc = activeAccounts.find(a => a.id === line.accountId);
                    const reqPartner = selAcc?.requiresPartner ?? false;
                    const reqCostCenter = selAcc?.requiresCostCenter ?? false;
                    const reqProject = selAcc?.requiresProject ?? false;
                    const showPartner = counterparties.length > 0 || reqPartner;
                    const showCostCenter = costCenters.length > 0 || reqCostCenter;
                    const showProject = projects.length > 0 || reqProject;
                    const showDept = departments.length > 0;
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        {showPartner && (
                          <div className="space-y-1.5">
                            <Label className={`text-xs ${reqPartner ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                              Partner{reqPartner ? <span className="text-destructive ml-0.5">*</span> : " (neobvezno)"}
                            </Label>
                            <Select value={line.partnerId || "__none__"} onValueChange={(val) => updateLine(line.id, "partnerId", val === "__none__" ? "" : val)}>
                              <SelectTrigger className={`h-9 ${reqPartner && !line.partnerId ? "border-destructive ring-1 ring-destructive" : ""}`}>
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {!reqPartner && <SelectItem value="__none__">—</SelectItem>}
                                {counterparties.map(c => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {reqPartner && !line.partnerId && (
                              <p className="text-xs text-destructive">Za ta konto je poslovni partner obvezen.</p>
                            )}
                          </div>
                        )}
                        {showCostCenter && (
                          <div className="space-y-1.5">
                            <Label className={`text-xs ${reqCostCenter ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                              Stroškovno mesto{reqCostCenter ? <span className="text-destructive ml-0.5">*</span> : " (neobvezno)"}
                            </Label>
                            <Select value={line.costCenterId || "__none__"} onValueChange={(val) => updateLine(line.id, "costCenterId", val === "__none__" ? "" : val)}>
                              <SelectTrigger className={`h-9 ${reqCostCenter && !line.costCenterId ? "border-destructive ring-1 ring-destructive" : ""}`}>
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {!reqCostCenter && <SelectItem value="__none__">—</SelectItem>}
                                {costCenters.map(cc => (
                                  <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {reqCostCenter && !line.costCenterId && (
                              <p className="text-xs text-destructive">Za ta konto je stroškovno mesto obvezno.</p>
                            )}
                          </div>
                        )}
                        {showProject && (
                          <div className="space-y-1.5">
                            <Label className={`text-xs ${reqProject ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                              Projekt{reqProject ? <span className="text-destructive ml-0.5">*</span> : " (neobvezno)"}
                            </Label>
                            <Select value={line.projectId || "__none__"} onValueChange={(val) => updateLine(line.id, "projectId", val === "__none__" ? "" : val)}>
                              <SelectTrigger className={`h-9 ${reqProject && !line.projectId ? "border-destructive ring-1 ring-destructive" : ""}`}>
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {!reqProject && <SelectItem value="__none__">—</SelectItem>}
                                {projects.map(p => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {reqProject && !line.projectId && (
                              <p className="text-xs text-destructive">Za ta konto je projekt obvezen.</p>
                            )}
                          </div>
                        )}
                        {showDept && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Oddelek (neobvezno)</Label>
                            <Select value={line.departmentId || "__none__"} onValueChange={(val) => updateLine(line.id, "departmentId", val === "__none__" ? "" : val)}>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">—</SelectItem>
                                {departments.map(d => (
                                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className={`p-4 rounded-md border flex justify-between items-center ${totals.balanced ? 'bg-green-50/50 border-green-200' : 'bg-red-50/50 border-red-200'}`}>
              <div className="text-sm font-medium">Skupaj:</div>
              <div className="flex gap-6 text-sm">
                <div>Breme: <span className="font-semibold">{totals.debit.toFixed(2)}</span></div>
                <div>Dobro: <span className="font-semibold">{totals.credit.toFixed(2)}</span></div>
                <div className={`font-bold ml-4 ${totals.balanced ? 'text-green-600' : 'text-red-600'}`}>
                  {totals.balanced ? "Izravnano" : `Razlika: ${Math.abs(totals.debit - totals.credit).toFixed(2)}`}
                </div>
              </div>
            </div>
          </div>
        </div>

        {dimensionErrors && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Nekatere vrstice imajo konto, ki zahteva stroškovno mesto ali projekt — izpolnite obvezna polja, označena z <strong>*</strong>.</span>
          </div>
        )}

        <SheetFooter className="mt-4 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={handleSave} disabled={!canSave || createMut.isPending}>
            {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Shrani temeljnico <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// DETAIL ENTRY SHEET
// ---------------------------------------------------------------------------

function DetailEntrySheet({ entry, open, onOpenChange, onStorno }: { entry: JournalEntry, open: boolean, onOpenChange: (open: boolean) => void, onStorno: (entry: JournalEntry) => void }) {
  const { activeCompany } = useCompany();

  // Pridobi polni zapis temeljnice z vrsticami (list endpoint ne vrne lines)
  const { data: fullEntry, isLoading: linesLoading } = useGetJournalEntry(
    activeCompany?.id ?? "",
    entry.id,
    { query: { enabled: !!activeCompany?.id && open } as any },
  );

  const lines = fullEntry?.lines ?? [];

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    lines.forEach((l: any) => {
      const val = parseFloat(l.amount) || 0;
      if (l.side === "debit") debit += val;
      if (l.side === "credit") credit += val;
    });
    return { debit, credit };
  }, [lines]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <div className="flex justify-between items-start">
            <div>
              <SheetTitle>Detajli temeljnice</SheetTitle>
              <SheetDescription>ID: {entry.id}</SheetDescription>
            </div>
            <Badge variant={STATUS_VARIANTS[entry.status]} className={entry.status === 'posted' ? 'bg-green-600' : ''}>
              {STATUS_LABELS[entry.status]}
            </Badge>
          </div>
        </SheetHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
            <div>
              <div className="text-muted-foreground mb-1">Datum</div>
              <div className="font-medium">{new Date(entry.entryDate).toLocaleDateString("sl-SI")}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Obdobje</div>
              <div className="font-medium">{entry.periodName}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground mb-1">Opis</div>
              <div className="font-medium">{entry.description}</div>
            </div>
            {entry.reference && (
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">Sklic</div>
                <div className="font-medium">{entry.reference}</div>
              </div>
            )}
            {entry.reversalOf && (
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">Storno za</div>
                <div className="font-medium">{entry.reversalOf}</div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Postavke</h3>
            <div className="border rounded-md overflow-hidden bg-card">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Konto / Dimenzije</TableHead>
                    <TableHead className="text-right w-[120px]">Breme</TableHead>
                    <TableHead className="text-right w-[120px]">Dobro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linesLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : lines.length > 0 ? (
                    lines.map((line: any) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="font-medium">{line.accountCode} — {line.accountName}</div>
                          {line.description && <div className="text-xs mt-0.5 text-muted-foreground/80 italic">{line.description}</div>}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {line.partnerName && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                                Partner: {line.partnerName}
                              </Badge>
                            )}
                            {line.costCenterName && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal bg-blue-50 border-blue-200 text-blue-700">
                                SM: {line.costCenterName}
                              </Badge>
                            )}
                            {line.projectName && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal bg-violet-50 border-violet-200 text-violet-700">
                                Projekt: {line.projectName}
                              </Badge>
                            )}
                            {line.departmentName && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal bg-amber-50 border-amber-200 text-amber-700">
                                Oddelek: {line.departmentName}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{line.side === 'debit' ? parseFloat(line.amount).toFixed(2) : ''}</TableCell>
                        <TableCell className="text-right">{line.side === 'credit' ? parseFloat(line.amount).toFixed(2) : ''}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-6 text-muted-foreground text-sm italic">
                        Ni postavk.
                      </TableCell>
                    </TableRow>
                  )}
                  {lines.length > 0 && (
                    <TableRow className="bg-muted/20 font-semibold">
                      <TableCell className="text-right">Skupaj:</TableCell>
                      <TableCell className="text-right">{totals.debit.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{totals.credit.toFixed(2)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Zapri</Button>
          {entry.status === 'posted' && (
            <Button variant="secondary" onClick={() => { onOpenChange(false); onStorno(entry); }}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Storno
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// STORNO DIALOG
// ---------------------------------------------------------------------------

function StornoDialog({ entry, open, onOpenChange, onSuccess }: { entry: JournalEntry, open: boolean, onOpenChange: (open: boolean) => void, onSuccess: () => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const revMut = useReverseJournalEntry();

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const openPeriods = periodsData?.periods?.filter(p => p.status === "open") || [];

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [desc, setDesc] = useState(`STORNO: ${entry.description}`);
  const [periodId, setPeriodId] = useState(entry.periodId); // Default to original period, user can change to another open period if needed

  useEffect(() => {
    if (open) {
      setDesc(`STORNO: ${entry.description}`);
      setDate(new Date().toISOString().split("T")[0]);
      setPeriodId(entry.periodId);
    }
  }, [open, entry]);

  const handleReverse = () => {
    if (!activeCompany) return;
    revMut.mutate({
      companyId: activeCompany.id,
      id: entry.id,
      data: {
        entryDate: date,
        description: desc,
        periodId: periodId
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey(activeCompany.id) });
        onOpenChange(false);
        onSuccess();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Storno temeljnice</DialogTitle>
          <DialogDescription>
            Ustvarjena bo nova temeljnica z obrnjenimi zneski. Izvirna temeljnica bo označena kot stornirana.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Datum storna</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Obdobje</Label>
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
          <div className="grid gap-2">
            <Label>Opis storno temeljnice</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button variant="destructive" onClick={handleReverse} disabled={revMut.isPending || !date || !desc}>
            {revMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Storniraj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
