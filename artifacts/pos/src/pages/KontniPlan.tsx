import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Edit2, Download, AlertCircle, Play, Square, Loader2, BookOpen, ChevronRight
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListAccounts,
  useCreateAccount,
  useUpdateAccount,
  useSeedAccounts,
  getListAccountsQueryKey,
  type AccountRecord
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-500/10 text-blue-600",
  liability: "bg-red-500/10 text-red-600",
  equity: "bg-purple-500/10 text-purple-600",
  revenue: "bg-green-500/10 text-green-600",
  expense: "bg-orange-500/10 text-orange-600",
};

const TYPE_LABELS: Record<string, string> = {
  asset: "Sredstvo",
  liability: "Obveznost",
  equity: "Kapital",
  revenue: "Prihodek",
  expense: "Odhodek",
};

function buildTree(accounts: AccountRecord[]): (AccountRecord & { _depth: number })[] {
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  const result: (AccountRecord & { _depth: number })[] = [];
  const addWithChildren = (parentId: string | null, depth: number) => {
    sorted.filter(a => a.parentId === parentId).forEach(account => {
      result.push({ ...account, _depth: depth });
      addWithChildren(account.id, depth + 1);
    });
  };
  addWithChildren(null, 0);
  return result;
}

export default function KontniPlanPage() {
  const { user } = useAuth();
  const companyId = user?.companyId;
  const isAdminPodjetja = user?.vloga === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [iskalnik, setIskalnik] = useState("");
  const [showNeaktivna, setShowNeaktivna] = useState(false);
  const [editAcc, setEditAcc] = useState<AccountRecord | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error } = useListAccounts(
    companyId ?? "",
    { includeInactive: true },
    {
      query: {
        enabled: isAdminPodjetja && !!companyId,
        queryKey: getListAccountsQueryKey(companyId ?? "", { includeInactive: true }),
      },
    },
  );

  const createMut = useCreateAccount();
  const updateMut = useUpdateAccount();
  const seedMut = useSeedAccounts();

  const accounts = data?.accounts ?? [];
  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const filtrirano = useMemo(() => {
    const q = iskalnik.trim().toLowerCase();
    return tree.filter(acc => {
      if (!showNeaktivna && !acc.isActive) return false;
      if (q && !acc.code.toLowerCase().includes(q) && !acc.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tree, iskalnik, showNeaktivna]);

  const [form, setForm] = useState({
    code: "", name: "", type: "asset", description: "", parentId: "none",
    isCash: false, isOpenItem: false, allowsPosting: true,
    requiresPartner: false,
    costCenterPolicy: "allowed" as "not_allowed" | "allowed" | "required",
    requiresProject: false,
    taxBehavior: "none"
  });

  const handleOpenEdit = (acc?: AccountRecord) => {
    if (acc) {
      setEditAcc(acc);
      setForm({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        description: acc.description || "",
        parentId: acc.parentId || "none",
        isCash: acc.isCash ?? false,
        isOpenItem: acc.isOpenItem ?? false,
        allowsPosting: acc.allowsPosting ?? true,
        requiresPartner: acc.requiresPartner ?? false,
        costCenterPolicy: acc.costCenterPolicy ?? (acc.requiresCostCenter ? "required" : "allowed"),
        requiresProject: acc.requiresProject ?? false,
        taxBehavior: acc.taxBehavior ?? "none"
      });
    } else {
      setEditAcc(null);
      setForm({
        code: "", name: "", type: "asset", description: "", parentId: "none",
        isCash: false, isOpenItem: false, allowsPosting: true,
        requiresPartner: false, costCenterPolicy: "allowed", requiresProject: false,
        taxBehavior: "none"
      });
    }
    setEditOpen(true);
  };

  const handleShrani = () => {
    if (!companyId) return;
    const parentId = form.parentId === "none" ? null : form.parentId;
    
    if (editAcc) {
      updateMut.mutate({
        companyId,
        id: editAcc.id,
        data: {
          name: form.name,
          description: form.description || null,
          parentId,
          isCash: form.isCash,
          isOpenItem: form.isOpenItem,
          allowsPosting: form.allowsPosting,
          requiresPartner: form.requiresPartner,
           costCenterPolicy: form.costCenterPolicy,
           requiresCostCenter: form.costCenterPolicy === "required",
          requiresProject: form.requiresProject,
          taxBehavior: form.taxBehavior as any,
        }
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAccountsQueryKey(companyId, { includeInactive: true }) });
          toast({ title: "Konto posodobljen" });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" })
      });
    } else {
      createMut.mutate({
        companyId,
        data: {
          code: form.code,
          name: form.name,
          type: form.type as any,
          description: form.description || null,
          parentId,
          isCash: form.isCash,
          isOpenItem: form.isOpenItem,
          allowsPosting: form.allowsPosting,
          requiresPartner: form.requiresPartner,
           costCenterPolicy: form.costCenterPolicy,
           requiresCostCenter: form.costCenterPolicy === "required",
          requiresProject: form.requiresProject,
          taxBehavior: form.taxBehavior as any,
        }
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAccountsQueryKey(companyId, { includeInactive: true }) });
          toast({ title: "Konto dodan" });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" })
      });
    }
  };

  const handleStatusToggle = (acc: AccountRecord) => {
    if (!companyId) return;
    if (acc.isActive && !window.confirm(`Ali res želite deaktivirati konto ${acc.code}?`)) return;
    updateMut.mutate({ companyId, id: acc.id, data: { isActive: !acc.isActive } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAccountsQueryKey(companyId, { includeInactive: true }) });
        toast({ title: acc.isActive ? "Konto deaktiviran" : "Konto aktiviran" });
      },
      onError: () => toast({ title: "Napaka", variant: "destructive" })
    });
  };

  const handleSeed = () => {
    if (!companyId) return;
    seedMut.mutate({ companyId }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAccountsQueryKey(companyId, { includeInactive: true }) });
        toast({ title: "Kontni plan za d.o.o. uvožen" });
      },
      onError: () => toast({ title: "Napaka", variant: "destructive" })
    });
  };

  if (!isAdminPodjetja) {
    return (
      <div className="p-8 flex-1 min-h-0 flex flex-col items-center justify-center">
        <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-destructive mb-2">Nimate dodeljene pravice</h2>
          <p className="text-sm text-destructive/80">Ta šifrant je dostopen samo administratorju podjetja.</p>
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-8 flex-1 min-h-0 flex flex-col items-center justify-center" data-testid="error-accounts-company">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Podjetje ni določeno</h2>
          <p className="text-sm text-muted-foreground">Kontnega plana ni mogoče naložiti brez podjetja.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex-1 min-h-0 flex flex-col max-w-6xl mx-auto w-full min-w-0 gap-6">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kontni plan</h1>
            <p className="text-sm text-muted-foreground">Upravljanje sintetičnih in analitičnih kontov</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && !error && accounts.length === 0 && (
            <Button variant="outline" onClick={handleSeed} disabled={seedMut.isPending} className="gap-2" data-testid="btn-seed-accounts">
              {seedMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Uvozi kontni plan za d.o.o.
            </Button>
          )}
          <Button onClick={() => handleOpenEdit()} className="gap-2" disabled={!!error} data-testid="btn-add-account">
            <Plus className="w-4 h-4" /> Nov konto
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0 bg-card p-2 rounded-xl border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={iskalnik}
            onChange={e => setIskalnik(e.target.value)}
            placeholder="Išči po kodi ali imenu..."
            className="pl-9 bg-transparent border-0 shadow-none focus-visible:ring-0"
            data-testid="input-search-account"
          />
        </div>
        <div className="h-6 w-px bg-border" />
        <Label className="flex items-center gap-2 text-sm cursor-pointer pr-4 hover:text-foreground text-muted-foreground transition-colors">
          <Switch checked={showNeaktivna} onCheckedChange={setShowNeaktivna} data-testid="switch-inactive-accounts" />
          Pokaži neaktivne
        </Label>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-auto border rounded-xl bg-card" data-testid="account-list-scroll">
        {error && (
          <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="error-accounts-load">
            Napaka pri nalaganju kontnega plana
            {error instanceof Error && error.message ? `: ${error.message}` : "."}
          </div>
        )}
        <table className="w-full min-w-max text-sm text-left whitespace-nowrap">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-md border-b text-muted-foreground z-10">
            <tr>
              <th className="px-4 py-3 font-medium w-40">Koda</th>
              <th className="px-4 py-3 font-medium">Ime konta</th>
              <th className="px-4 py-3 font-medium w-32">Tip</th>
              <th className="px-4 py-3 font-medium">Lastnosti</th>
              <th className="px-4 py-3 font-medium w-24 text-center">Status</th>
              <th className="px-4 py-3 font-medium w-24 text-right">Dejanja</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : error ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Podatkov ni bilo mogoče prikazati.</td></tr>
            ) : filtrirano.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Ni najdenih kontov.</td></tr>
            ) : filtrirano.map(acc => {
              const isRootClass = !acc.parentId && acc.code.length <= 2;
              return (
                <tr key={acc.id} className={`hover:bg-muted/30 transition-colors ${!acc.isActive ? "opacity-50" : ""}`} data-testid={`row-account-${acc.id}`}>
                  <td className="px-4 py-3 font-mono">
                    <div style={{ paddingLeft: `${acc._depth * 16}px` }} className={`flex items-center ${isRootClass ? "font-bold text-foreground" : "font-medium"}`}>
                      {acc._depth > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground opacity-50 mr-1" />}
                      {acc.code}
                    </div>
                  </td>
                  <td className={`px-4 py-3 ${isRootClass ? "font-semibold" : ""}`}>{acc.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[acc.type]}`}>
                      {TYPE_LABELS[acc.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {acc.isCash && <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 text-[9px] font-semibold">Denarni</span>}
                      {acc.isOpenItem && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 text-[9px] font-semibold">Saldakonto</span>}
                      {!acc.allowsPosting && <span className="px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-600 text-[9px] font-semibold">Skupinski</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {acc.isActive ? <span className="text-green-500 font-bold text-lg leading-none">&bull;</span> : <span className="text-xs text-muted-foreground">Neakt.</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleOpenEdit(acc)} data-testid={`btn-edit-acc-${acc.id}`}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleStatusToggle(acc)} data-testid={`btn-toggle-acc-${acc.id}`}>
                        {acc.isActive ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 text-primary" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editAcc ? "Uredi konto" : "Nov konto"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="account-edit-dialog-scroll-body">
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label>Koda</Label>
                <Input
                  value={form.code}
                  onChange={e => {
                    const code = e.target.value;
                    const firstDigit = code.trim().charAt(0);
                    const costCenterPolicy =
                      firstDigit === "4" ? "required"
                      : ["1", "2", "9"].includes(firstDigit) ? "not_allowed"
                      : "allowed";
                    setForm({ ...form, code, costCenterPolicy });
                  }}
                  disabled={!!editAcc}
                  placeholder="Npr. 020"
                  data-testid="input-acc-code"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Ime konta</Label>
                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Npr. Zgradbe" data-testid="input-acc-name" />
              </div>
              <div className="grid gap-1.5">
                <Label>Opis</Label>
                <Textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Neobvezen opis konta"
                  data-testid="input-acc-description"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Tip {editAcc && <span className="font-normal text-muted-foreground">(pri urejanju nespremenljiv)</span>}</Label>
                <Select value={form.type} onValueChange={v => setForm({...form, type: v})} disabled={!!editAcc}>
                  <SelectTrigger data-testid="select-acc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Nadrejeni konto</Label>
                <Select value={form.parentId} onValueChange={v => setForm({...form, parentId: v})}>
                  <SelectTrigger data-testid="select-acc-parent"><SelectValue placeholder="Brez nadrejenega" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez nadrejenega (Razred)</SelectItem>
                    {tree.filter(a => a.id !== editAcc?.id).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label>DDV obravnava</Label>
                <Select value={form.taxBehavior} onValueChange={v => setForm({...form, taxBehavior: v})}>
                  <SelectTrigger data-testid="select-acc-tax"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez DDV</SelectItem>
                    <SelectItem value="output_vat">Izstopni DDV (prodaja)</SelectItem>
                    <SelectItem value="input_vat">Vstopni DDV (nabava)</SelectItem>
                    <SelectItem value="exempt">Oproščeno DDV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="border rounded-xl p-3 space-y-2.5 bg-muted/20">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nastavitve knjiženja</p>
                <label className="flex items-center justify-between text-sm cursor-pointer hover:text-foreground">
                  <span>Dovoli knjižbe</span>
                  <Switch checked={form.allowsPosting} onCheckedChange={v => setForm({...form, allowsPosting: v})} data-testid="switch-acc-posting" />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer hover:text-foreground">
                  <span>Denarni konto</span>
                  <Switch checked={form.isCash} onCheckedChange={v => setForm({...form, isCash: v})} data-testid="switch-acc-cash" />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer hover:text-foreground">
                  <span>Saldakontni konto</span>
                  <Switch checked={form.isOpenItem} onCheckedChange={v => setForm({...form, isOpenItem: v})} data-testid="switch-acc-open-item" />
                </label>
              </div>

              <div className="border rounded-xl p-3 space-y-2.5 bg-muted/20">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Obvezne dimenzije</p>
                <label className="flex items-center justify-between text-sm cursor-pointer hover:text-foreground">
                  <span>Zahteva partnerja</span>
                  <Switch checked={form.requiresPartner} onCheckedChange={v => setForm({...form, requiresPartner: v})} data-testid="switch-acc-partner" />
                </label>
                <div className="space-y-1.5">
                  <Label className="text-sm">Stroškovno mesto</Label>
                  <Select
                    value={form.costCenterPolicy}
                    onValueChange={value => setForm({
                      ...form,
                      costCenterPolicy: value as "not_allowed" | "allowed" | "required",
                    })}
                  >
                    <SelectTrigger data-testid="select-acc-cost-center-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_allowed">Ni dovoljeno</SelectItem>
                      <SelectItem value="allowed">Dovoljeno</SelectItem>
                      <SelectItem value="required">Obvezno</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center justify-between text-sm cursor-pointer hover:text-foreground">
                  <span>Zahteva projekt</span>
                  <Switch checked={form.requiresProject} onCheckedChange={v => setForm({...form, requiresProject: v})} data-testid="switch-acc-project" />
                </label>
              </div>
            </div>
          </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4" data-testid="account-edit-dialog-footer">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Prekliči</Button>
            <Button onClick={handleShrani} disabled={!form.code || !form.name || createMut.isPending || updateMut.isPending} data-testid="btn-save-acc">
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
