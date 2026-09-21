/**
 * stroskovana-mesta.tsx — Šifrant stroškovnih mest
 *
 * CRUD: seznam, dodaj, uredi, briši/deaktiviraj
 * Hierarhija: nadrejeno SM (parent_id), preverjanje ciklov na API
 * Dostop: ERP vloge (owner/accountant/viewer); viewer = samo beri
 */

import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, X, Edit2, Trash2, AlertCircle, CheckCircle2,
  ChevronRight, Loader2, TreePine,
} from "lucide-react";
import { useAuth } from "@clerk/react";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Alert, AlertDescription, AlertTitle,
} from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// ─── Tipi ────────────────────────────────────────────────────────────────────

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

const TIP_LABELS: Record<StmTip, string> = {
  direktna: "Direktna",
  indirektna: "Indirektna",
  projektna: "Projektna",
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { credentials: "include", ...options });
}

// ─── Prazen form ─────────────────────────────────────────────────────────────

function prazenForm() {
  return {
    code: "", name: "", description: "", tip: "" as StmTip | "",
    parentId: "", odgovornaOseba: "", isActive: true,
  };
}

// ─── Dialog za dodaj / uredi ──────────────────────────────────────────────────

interface EditDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  companyId: string;
  sm: StroskovnoMesto | null; // null = novo
  vsa: StroskovnoMesto[];
}

function EditDialog({ open, onClose, onSaved, companyId, sm, vsa }: EditDialogProps) {
  const { getToken } = useAuth();
  const [form, setForm] = useState(prazenForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Ob odprtju inicializiraj form
  React.useEffect(() => {
    if (open) {
      if (sm) {
        setForm({
          code: sm.code,
          name: sm.name,
          description: sm.description ?? "",
          tip: (sm.tip as StmTip | null) ?? "",
          parentId: sm.parentId ?? "",
          odgovornaOseba: sm.odgovornaOseba ?? "",
          isActive: sm.isActive,
        });
      } else {
        setForm(prazenForm());
      }
      setError(null);
    }
  }, [open, sm]);

  // Možna nadrejena SM: vsa razen samega sebe in njegovih potomcev
  const moznaStarsevska = useMemo(() => {
    if (!sm) return vsa.filter(s => s.isActive);
    // Izključi SM sam + vse potomce (preprečitev cikla)
    const izkljuci = new Set<string>();
    izkljuci.add(sm.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of vsa) {
        if (s.parentId && izkljuci.has(s.parentId) && !izkljuci.has(s.id)) {
          izkljuci.add(s.id); changed = true;
        }
      }
    }
    return vsa.filter(s => s.isActive && !izkljuci.has(s.id));
  }, [sm, vsa]);

  async function handleShrani() {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Koda in naziv sta obvezna"); return;
    }
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        tip: form.tip || null,
        parentId: form.parentId || null,
        odgovornaOseba: form.odgovornaOseba.trim() || null,
        isActive: form.isActive,
      };
      const url = sm
        ? `${BASE}/api/companies/${companyId}/cost-centers/${sm.id}`
        : `${BASE}/api/companies/${companyId}/cost-centers`;
      const r = await apiFetch(url, {
        method: sm ? "PATCH" : "POST",
        headers, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error((err as any).error ?? `HTTP ${r.status}`);
      }
      toast({ title: sm ? "Stroškovno mesto posodobljeno" : "Stroškovno mesto dodano" });
      onSaved(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sm ? "Uredi stroškovno mesto" : "Novo stroškovno mesto"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Koda */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Koda *</Label>
            <Input
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="npr. 1000"
              disabled={!!sm} // kode ni mogoče spremeniti
              className={sm ? "bg-muted/30" : ""}
            />
            {sm && <p className="text-[10px] text-muted-foreground mt-0.5">Kode obstoječega SM ni mogoče spremeniti</p>}
          </div>

          {/* Naziv */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Naziv *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="npr. KAMNOLOM AGM DOO"
            />
          </div>

          {/* Tip */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Vrsta / tip</Label>
            <Select value={form.tip} onValueChange={v => setForm(f => ({ ...f, tip: v as StmTip | "" }))}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="— ni določeno —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— ni določeno —</SelectItem>
                <SelectItem value="direktna">Direktna (proizvodna / operativna)</SelectItem>
                <SelectItem value="indirektna">Indirektna (splošna / režijska)</SelectItem>
                <SelectItem value="projektna">Projektna</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Nadrejeno SM */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Nadrejeno SM (hierarhija)</Label>
            <Select value={form.parentId} onValueChange={v => setForm(f => ({ ...f, parentId: v }))}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="— ni nadrejenega —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— ni nadrejenega —</SelectItem>
                {moznaStarsevska.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Odgovorna oseba */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Odgovorna oseba</Label>
            <Input
              value={form.odgovornaOseba}
              onChange={e => setForm(f => ({ ...f, odgovornaOseba: e.target.value }))}
              placeholder="npr. Janez Novak"
            />
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 pt-1">
            <Switch
              id="stm-aktiven"
              checked={form.isActive}
              onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="stm-aktiven" className="text-sm cursor-pointer">
              Aktivno stroškovno mesto
            </Label>
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Prekliči</Button>
          <Button onClick={handleShrani} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {sm ? "Shrani" : "Dodaj"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Potrditev brisanja ───────────────────────────────────────────────────────

interface BrisanjeDialogProps {
  open: boolean;
  onClose: () => void;
  onPotrdi: () => void;
  sm: StroskovnoMesto | null;
  loading: boolean;
}

function BrisanjeDialog({ open, onClose, onPotrdi, sm, loading }: BrisanjeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Odstrani stroškovno mesto</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-2">
          <p className="text-sm">
            Odstranjujete: <span className="font-semibold">{sm?.code} — {sm?.name}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Če je SM v uporabi (temeljnice, osnovna sredstva, podrejena SM), bo samo <span className="font-medium">deaktivirano</span> — ne bo zbrisano.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Prekliči</Button>
          <Button variant="destructive" onClick={onPotrdi} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Odstrani / Deaktiviraj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Glavna stran ─────────────────────────────────────────────────────────────

export default function StroskovnaMestaPage() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [seznam, setSeznam] = useState<StroskovnoMesto[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [iskalnik, setIskalnik] = useState("");
  const [showNeaktivna, setShowNeaktivna] = useState(false);
  const [editSm, setEditSm] = useState<StroskovnoMesto | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [brisanjeOpen, setBrisanjeOpen] = useState(false);
  const [brisanjeSm, setBrisanjeSm] = useState<StroskovnoMesto | null>(null);
  const [brisanjeLoading, setBrisanjeLoading] = useState(false);

  // Mapa za hitro iskanje nadrejenega po id
  const idMap = useMemo(() => new Map(seznam.map(s => [s.id, s])), [seznam]);

  async function naloziSeznam(cId: string) {
    setLoading(true); setFetchErr(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await apiFetch(
        `${BASE}/api/companies/${cId}/cost-centers?includeInactive=true`,
        { headers },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setSeznam(data.costCenters ?? []);
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : "Napaka pri nalaganju");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (companyId) void naloziSeznam(companyId);
  }, [companyId]);

  async function handleBrisanje() {
    if (!brisanjeSm || !companyId) return;
    setBrisanjeLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await apiFetch(
        `${BASE}/api/companies/${companyId}/cost-centers/${brisanjeSm.id}`,
        { method: "DELETE", headers },
      );
      if (r.status === 204) {
        toast({ title: "Stroškovno mesto zbrisano" });
      } else if (r.ok) {
        const data = await r.json();
        toast({
          title: "Stroškovno mesto deaktivirano",
          description: `SM je v uporabi (${data.razlog}) — zbrisano ni bilo, samo deaktivirano.`,
        });
      } else {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error((err as any).error ?? `HTTP ${r.status}`);
      }
      setBrisanjeOpen(false);
      void naloziSeznam(companyId);
      qc.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
    } catch (e) {
      toast({ title: "Napaka", description: e instanceof Error ? e.message : "Napaka pri brisanju", variant: "destructive" });
    } finally {
      setBrisanjeLoading(false);
    }
  }

  // Filtriranje
  const filtrirano = useMemo(() => {
    const q = iskalnik.trim().toLowerCase();
    return seznam.filter(s => {
      if (!showNeaktivna && !s.isActive) return false;
      if (q && !s.code.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [seznam, iskalnik, showNeaktivna]);

  const canEdit = useMemo(() => {
    // Pravice po vlogi (superadmin nima posebne izjeme — samo prek dodeljene vloge)
    const role = (activeCompany?.role as string) ?? "";
    // ERP: owner in accountant urejata; viewer ne
    if (role === "owner" || role === "accountant") return true;
    // OS: os_admin in os_user urejata; os_viewer ne
    if (role === "os_admin" || role === "os_user") return true;
    // POS-only (pos_*) in ERP/OS viewer: samo branje
    return false;
  }, [activeCompany]);

  if (!companyId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ni izbranega podjetja</AlertTitle>
          <AlertDescription>Izberite podjetje za nadaljevanje.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stroškovna mesta</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Skupni šifrant — {seznam.filter(s => s.isActive).length} aktivnih od {seznam.length} skupaj
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => { setEditSm(null); setEditOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            Novo SM
          </Button>
        )}
      </div>

      {/* ── Filtri ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Išči po kodi ali nazivu…"
            value={iskalnik}
            onChange={e => setIskalnik(e.target.value)}
          />
          {iskalnik && (
            <button onClick={() => setIskalnik("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <Switch
            checked={showNeaktivna}
            onCheckedChange={setShowNeaktivna}
            className="h-4 w-8"
          />
          Pokaži neaktivna
        </label>
        <span className="text-xs text-muted-foreground ml-auto">{filtrirano.length} SM</span>
      </div>

      {/* ── Napaka ── */}
      {fetchErr && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju</AlertTitle>
          <AlertDescription>{fetchErr}</AlertDescription>
        </Alert>
      )}

      {/* ── Tabela ── */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-28">Koda</TableHead>
              <TableHead>Naziv</TableHead>
              <TableHead className="w-28">Tip</TableHead>
              <TableHead className="w-44">Nadrejeno SM</TableHead>
              <TableHead className="w-36">Odg. oseba</TableHead>
              <TableHead className="w-20 text-center">Status</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                  Nalaganje…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtrirano.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                  {iskalnik ? "Ni zadetkov za iskanje" : "Ni stroškovnih mest"}
                </TableCell>
              </TableRow>
            )}
            {!loading && filtrirano.map(s => {
              const parent = s.parentId ? idMap.get(s.parentId) : null;
              return (
                <TableRow
                  key={s.id}
                  className={!s.isActive ? "opacity-50" : ""}
                >
                  <TableCell className="font-mono text-xs font-semibold">
                    {s.parentId && <ChevronRight className="inline h-3 w-3 text-muted-foreground mr-0.5" />}
                    {s.code}
                  </TableCell>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell>
                    {s.tip ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {TIP_LABELS[s.tip]}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {parent ? `${parent.code} — ${parent.name}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.odgovornaOseba ?? "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {s.isActive
                      ? <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                      : <span className="text-xs text-muted-foreground">neakt.</span>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          className="p-1 rounded hover:bg-muted"
                          onClick={() => { setEditSm(s); setEditOpen(true); }}
                          title="Uredi"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-destructive/10 text-destructive"
                          onClick={() => { setBrisanjeSm(s); setBrisanjeOpen(true); }}
                          title="Odstrani / deaktiviraj"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Legenda tipov ── */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <TreePine className="h-3.5 w-3.5 shrink-0" />
        <span><span className="font-medium">Direktna</span> — neposredno v procesu</span>
        <span>·</span>
        <span><span className="font-medium">Indirektna</span> — splošna/režijska</span>
        <span>·</span>
        <span><span className="font-medium">Projektna</span> — projektno sledenje</span>
        <span>·</span>
        <span><ChevronRight className="inline h-3 w-3" /> pomeni podrejeno SM</span>
      </div>

      {/* ── Dialogi ── */}
      <EditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { if (companyId) void naloziSeznam(companyId); }}
        companyId={companyId}
        sm={editSm}
        vsa={seznam}
      />
      <BrisanjeDialog
        open={brisanjeOpen}
        onClose={() => setBrisanjeOpen(false)}
        onPotrdi={handleBrisanje}
        sm={brisanjeSm}
        loading={brisanjeLoading}
      />
    </div>
  );
}
