import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, X, Edit2, Trash2, AlertCircle, CheckCircle2,
  ChevronRight, Loader2, MapPin
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListCostCenters,
  useCreateCostCenter,
  useUpdateCostCenter,
  useDeleteCostCenter,
  getListCostCentersQueryKey,
  type DeleteCostCenterDeactivatedResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type StmTip = "direktna" | "indirektna" | "projektna";

interface StroskovnoMesto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  tip?: StmTip | null;
  parentId?: string | null;
  odgovornaOseba?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const TIP_LABELS: Record<string, string> = {
  direktna: "Direktna",
  indirektna: "Indirektna",
  projektna: "Projektna",
};

export default function StroskovnaMestaPage() {
  const { user } = useAuth();
  const companyId = user?.companyId;
  const isAdminPodjetja = user?.vloga === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [iskalnik, setIskalnik] = useState("");
  const [showNeaktivna, setShowNeaktivna] = useState(false);
  const [editSm, setEditSm] = useState<StroskovnoMesto | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [brisanjeOpen, setBrisanjeOpen] = useState(false);
  const [brisanjeSm, setBrisanjeSm] = useState<StroskovnoMesto | null>(null);

  const { data, isLoading, error } = useListCostCenters(
    companyId ?? "",
    { includeInactive: true },
    {
      query: {
        enabled: isAdminPodjetja && !!companyId,
        queryKey: getListCostCentersQueryKey(companyId ?? "", { includeInactive: true }),
      },
    },
  );

  const createMut = useCreateCostCenter();
  const updateMut = useUpdateCostCenter();
  const deleteMut = useDeleteCostCenter();

  const seznam = (data?.costCenters ?? []) as StroskovnoMesto[];
  const idMap = useMemo(() => new Map(seznam.map(s => [s.id, s])), [seznam]);

  const filtrirano = useMemo(() => {
    const q = iskalnik.trim().toLowerCase();
    return seznam.filter(s => {
      if (!showNeaktivna && !s.isActive) return false;
      if (q && !s.code.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [seznam, iskalnik, showNeaktivna]);

  const [form, setForm] = useState({
    code: "", name: "", description: "", tip: "" as string,
    parentId: "none", odgovornaOseba: "", isActive: true
  });

  const handleOpenEdit = (sm?: StroskovnoMesto) => {
    if (sm) {
      setEditSm(sm);
      setForm({
        code: sm.code,
        name: sm.name,
        description: sm.description ?? "",
        tip: sm.tip ?? "",
        parentId: sm.parentId ?? "none",
        odgovornaOseba: sm.odgovornaOseba ?? "",
        isActive: sm.isActive,
      });
    } else {
      setEditSm(null);
      setForm({
        code: "", name: "", description: "", tip: "",
        parentId: "none", odgovornaOseba: "", isActive: true
      });
    }
    setEditOpen(true);
  };

  const handleShrani = () => {
    if (!companyId) return;
    const parentId = form.parentId === "none" ? null : form.parentId;
    
    if (editSm) {
      updateMut.mutate({
        companyId,
        id: editSm.id,
        data: {
          name: form.name,
          description: form.description || null,
          tip: form.tip ? form.tip as StmTip : null,
          parentId,
          odgovornaOseba: form.odgovornaOseba || null,
          isActive: form.isActive,
        }
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCostCentersQueryKey(companyId, { includeInactive: true }) });
          toast({ title: "Stroškovno mesto posodobljeno" });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" })
      });
    } else {
      createMut.mutate({
        companyId,
        data: {
          code: form.code,
          name: form.name,
          description: form.description || null,
          tip: form.tip ? form.tip as StmTip : null,
          parentId,
          odgovornaOseba: form.odgovornaOseba || null,
          isActive: form.isActive,
        }
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCostCentersQueryKey(companyId, { includeInactive: true }) });
          toast({ title: "Stroškovno mesto dodano" });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Napaka pri dodajanju", variant: "destructive" })
      });
    }
  };

  const handleBrisanje = () => {
    if (!companyId || !brisanjeSm) return;
    deleteMut.mutate({ companyId, id: brisanjeSm.id }, {
      onSuccess: (res: DeleteCostCenterDeactivatedResponse | void) => {
        qc.invalidateQueries({ queryKey: getListCostCentersQueryKey(companyId, { includeInactive: true }) });
        if (res && res.razlog) {
          toast({ title: "Stroškovno mesto deaktivirano", description: `SM je v uporabi (${res.razlog}).` });
        } else {
          toast({ title: "Stroškovno mesto zbrisano" });
        }
        setBrisanjeOpen(false);
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" })
    });
  };

  const moznaStarsevska = useMemo(() => {
    if (!editSm) return seznam.filter(s => s.isActive);
    const izkljuci = new Set<string>();
    izkljuci.add(editSm.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of seznam) {
        if (s.parentId && izkljuci.has(s.parentId) && !izkljuci.has(s.id)) {
          izkljuci.add(s.id); changed = true;
        }
      }
    }
    return seznam.filter(s => s.isActive && !izkljuci.has(s.id));
  }, [editSm, seznam]);

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
      <div className="p-8 flex-1 min-h-0 flex flex-col items-center justify-center" data-testid="error-stm-company">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Podjetje ni določeno</h2>
          <p className="text-sm text-muted-foreground">Podatkov stroškovnih mest ni mogoče naložiti brez podjetja.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex-1 min-h-0 flex flex-col max-w-6xl mx-auto w-full min-w-0 gap-6">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stroškovna mesta</h1>
            <p className="text-sm text-muted-foreground">Upravljanje stroškovnih mest za knjiženje</p>
          </div>
        </div>
        <Button onClick={() => handleOpenEdit()} className="gap-2" disabled={!!error} data-testid="btn-add-stm">
          <Plus className="w-4 h-4" /> Novo SM
        </Button>
      </div>

      <div className="flex items-center gap-4 shrink-0 bg-card p-2 rounded-xl border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={iskalnik}
            onChange={e => setIskalnik(e.target.value)}
            placeholder="Išči po kodi ali nazivu..."
            className="pl-9 bg-transparent border-0 shadow-none focus-visible:ring-0"
            data-testid="input-search-stm"
          />
        </div>
        <div className="h-6 w-px bg-border" />
        <Label className="flex items-center gap-2 text-sm cursor-pointer pr-4 hover:text-foreground text-muted-foreground transition-colors">
          <Switch checked={showNeaktivna} onCheckedChange={setShowNeaktivna} data-testid="switch-inactive-stm" />
          Pokaži neaktivna
        </Label>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-auto border rounded-xl bg-card" data-testid="stm-list-scroll">
        {error && (
          <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="error-stm-load">
            Napaka pri nalaganju stroškovnih mest
            {error instanceof Error && error.message ? `: ${error.message}` : "."}
          </div>
        )}
        <table className="w-full min-w-max text-sm text-left whitespace-nowrap">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-md border-b text-muted-foreground z-10">
            <tr>
              <th className="px-4 py-3 font-medium w-32">Koda</th>
              <th className="px-4 py-3 font-medium">Naziv</th>
              <th className="px-4 py-3 font-medium w-32">Tip</th>
              <th className="px-4 py-3 font-medium">Nadrejeno SM</th>
              <th className="px-4 py-3 font-medium w-40">Odgovorna oseba</th>
              <th className="px-4 py-3 font-medium w-24 text-center">Status</th>
              <th className="px-4 py-3 font-medium w-24 text-right">Dejanja</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Podatkov ni bilo mogoče prikazati.</td></tr>
            ) : filtrirano.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Ni najdenih stroškovnih mest.</td></tr>
            ) : filtrirano.map(sm => {
              const parent = sm.parentId ? idMap.get(sm.parentId) : null;
              return (
                <tr key={sm.id} className={`hover:bg-muted/30 transition-colors ${!sm.isActive ? "opacity-50" : ""}`} data-testid={`row-stm-${sm.id}`}>
                  <td className="px-4 py-3 font-mono font-medium">
                    {sm.parentId && <ChevronRight className="inline w-3 h-3 text-muted-foreground mr-1" />}
                    {sm.code}
                  </td>
                  <td className="px-4 py-3">{sm.name}</td>
                  <td className="px-4 py-3">
                    {sm.tip ? <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">{TIP_LABELS[sm.tip as StmTip]}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {parent ? `${parent.code} — ${parent.name}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{sm.odgovornaOseba || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {sm.isActive ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" /> : <span className="text-xs">Neaktivno</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleOpenEdit(sm)} data-testid={`btn-edit-stm-${sm.id}`}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { setBrisanjeSm(sm); setBrisanjeOpen(true); }} data-testid={`btn-delete-stm-${sm.id}`}>
                        <Trash2 className="w-4 h-4" />
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
        <DialogContent className="max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editSm ? "Uredi stroškovno mesto" : "Novo stroškovno mesto"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="stm-edit-dialog-scroll-body">
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Koda</Label>
              <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} disabled={!!editSm} placeholder="Npr. 1000" data-testid="input-stm-code" />
            </div>
            <div className="grid gap-1.5">
              <Label>Naziv</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Npr. Prodaja" data-testid="input-stm-name" />
            </div>
            <div className="grid gap-1.5">
              <Label>Opis</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Neobvezen opis stroškovnega mesta"
                data-testid="input-stm-description"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tip</Label>
              <Select value={form.tip} onValueChange={v => setForm({...form, tip: v === "none" ? "" : v})}>
                <SelectTrigger data-testid="select-stm-tip"><SelectValue placeholder="— ni določeno —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— ni določeno —</SelectItem>
                  <SelectItem value="direktna">Direktna</SelectItem>
                  <SelectItem value="indirektna">Indirektna</SelectItem>
                  <SelectItem value="projektna">Projektna</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Nadrejeno SM</Label>
              <Select value={form.parentId} onValueChange={v => setForm({...form, parentId: v})}>
                <SelectTrigger data-testid="select-stm-parent"><SelectValue placeholder="— ni nadrejenega —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— ni nadrejenega —</SelectItem>
                  {moznaStarsevska.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Odgovorna oseba</Label>
              <Input value={form.odgovornaOseba} onChange={e => setForm({...form, odgovornaOseba: e.target.value})} placeholder="Janez Novak" data-testid="input-stm-odgovorna" />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm({...form, isActive: v})} data-testid="switch-stm-active" />
              <Label>Aktivno stroškovno mesto</Label>
            </div>
          </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4" data-testid="stm-edit-dialog-footer">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Prekliči</Button>
            <Button onClick={handleShrani} disabled={!form.code || !form.name || createMut.isPending || updateMut.isPending} data-testid="btn-save-stm">
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={brisanjeOpen} onOpenChange={setBrisanjeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odstrani stroškovno mesto</DialogTitle>
          </DialogHeader>
          <p className="text-sm">Ali res želite odstraniti stroškovno mesto <strong className="font-mono">{brisanjeSm?.code}</strong>?</p>
          <p className="text-sm text-muted-foreground">Če je SM v uporabi, bo samo deaktivirano.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrisanjeOpen(false)}>Prekliči</Button>
            <Button variant="destructive" onClick={handleBrisanje} disabled={deleteMut.isPending} data-testid="btn-confirm-delete-stm">
              {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Odstrani / Deaktiviraj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
