import React, { useState } from "react";
import {
  Building2, Users, Plus, ShieldCheck, Loader2, AlertCircle,
  CheckCircle2, ChevronDown, ChevronRight, Trash2, Package, X, TriangleAlert,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminCompany {
  id: string;
  podjetjeDavcna: string;
  naziv: string;
  kratekNaziv: string | null;
  modules: ("erp" | "pos")[];
  userCount: number;
  createdAt: string;
}

interface AdminUser {
  clerkUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  createdAt: string;
  companies: { companyId: string; naziv: string; role: string; createdAt: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const MODULE_LABELS: Record<string, string> = {
  erp: "Glavna knjiga",
  pos: "POS gostinstvo",
};
const MODULE_COLORS: Record<string, string> = {
  erp: "bg-blue-100 text-blue-800 border-blue-200",
  pos: "bg-amber-100 text-amber-800 border-amber-200",
};
const ROLE_LABELS: Record<string, string> = {
  owner: "Lastnik", accountant: "Računovodja", viewer: "Pregledovalec",
};
const POS_VLOGA_LABELS: Record<string, string> = {
  admin: "Admin podjetja",
  admin_enote: "Admin enote",
  uporabnik: "Uporabnik",
};
const POS_VLOGA_COLORS: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 border-violet-200",
  admin_enote: "bg-sky-100 text-sky-800 border-sky-200",
  uporabnik: "bg-slate-100 text-slate-700 border-slate-200",
};

interface PosUserRow {
  id: number;
  clerkUserId: string;
  vloga: string;
  ime: string;
  priimek: string;
  aktiven: boolean;
  enotaId: number | null;
  enotaIme: string | null;
}

interface Enota {
  id: number;
  ime: string;
  aktiven: boolean;
}

// ── POS Roles Section ─────────────────────────────────────────────────────────

function PosRolesSection({ companyId, allUsers }: { companyId: string; allUsers: AdminUser[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ clerkUserId: "", vloga: "admin", enotaId: "" });
  const [feedback, setFeedback] = useState<"ok" | "">("");

  const { data: posData, isLoading: posLoading } = useQuery({
    queryKey: ["admin", "pos-roles", companyId],
    queryFn: () => apiFetch<{ users: PosUserRow[] }>(`/api/admin/companies/${companyId}/pos-roles`),
  });

  const { data: enoteData } = useQuery({
    queryKey: ["admin", "enote", companyId],
    queryFn: () => apiFetch<{ enote: Enota[] }>(`/api/admin/companies/${companyId}/enote`),
  });

  const needsEnota = form.vloga === "admin_enote" || form.vloga === "uporabnik";
  const enote = enoteData?.enote ?? [];
  const posUsers = posData?.users ?? [];

  const assignMutation = useMutation({
    mutationFn: (body: { clerkUserId: string; vloga: string; enotaId?: number | null }) =>
      apiFetch(`/api/admin/companies/${companyId}/pos-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "pos-roles", companyId] });
      setForm({ clerkUserId: "", vloga: "uporabnik", enotaId: "" });
      setFeedback("ok");
      setTimeout(() => setFeedback(""), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch<void>(`/api/admin/companies/${companyId}/pos-roles/${clerkUserId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "pos-roles", companyId] }),
  });

  const canSubmit = form.clerkUserId && (!needsEnota || form.enotaId);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dostop do POS gostinstva</p>

      {/* Obstoječi POS uporabniki */}
      {posLoading ? (
        <div className="space-y-1 mb-3">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : posUsers.length > 0 ? (
        <div className="mb-3 divide-y border rounded-md bg-background">
          {posUsers.map((u) => {
            const name = [u.ime, u.priimek].filter(Boolean).join(" ") || u.clerkUserId;
            return (
              <div key={u.clerkUserId} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-xs font-medium truncate">{name}</span>
                <Badge variant="outline" className={`text-xs shrink-0 ${POS_VLOGA_COLORS[u.vloga] ?? ""}`}>
                  {POS_VLOGA_LABELS[u.vloga] ?? u.vloga}
                </Badge>
                {u.enotaIme && (
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">· {u.enotaIme}</span>
                )}
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  onClick={() => removeMutation.mutate(u.clerkUserId)}
                  disabled={removeMutation.isPending}
                  title="Odstrani dostop"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">Ni POS uporabnikov.</p>
      )}

      {/* Obrazec za dodelitev */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Uporabnik */}
        <Select value={form.clerkUserId} onValueChange={(v) => setForm((f) => ({ ...f, clerkUserId: v }))}>
          <SelectTrigger className="h-8 w-52 text-xs"><SelectValue placeholder="Izberi uporabnika…" /></SelectTrigger>
          <SelectContent>
            {allUsers.map((u) => (
              <SelectItem key={u.clerkUserId} value={u.clerkUserId}>
                <span className="flex flex-col">
                  <span>{u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : u.email}</span>
                  {(u.firstName || u.lastName) && <span className="text-xs text-muted-foreground">{u.email}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Vloga */}
        <Select
          value={form.vloga}
          onValueChange={(v) => setForm((f) => ({ ...f, vloga: v, enotaId: "" }))}
        >
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin podjetja</SelectItem>
            <SelectItem value="admin_enote">Admin enote</SelectItem>
            <SelectItem value="uporabnik">Uporabnik</SelectItem>
          </SelectContent>
        </Select>

        {/* Enota (samo za admin_enote / uporabnik) */}
        {needsEnota && (
          <Select value={form.enotaId} onValueChange={(v) => setForm((f) => ({ ...f, enotaId: v }))}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder={enote.length ? "Izberi enoto…" : "Ni enot"} />
            </SelectTrigger>
            <SelectContent>
              {enote.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={assignMutation.isPending || !canSubmit}
          onClick={() =>
            assignMutation.mutate({
              clerkUserId: form.clerkUserId,
              vloga: form.vloga,
              enotaId: needsEnota && form.enotaId ? Number(form.enotaId) : null,
            })
          }
        >
          {assignMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Dodeli"}
        </Button>

        {feedback === "ok" && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Dostop dodeljen.
          </span>
        )}
        {assignMutation.isError && (
          <span className="text-xs text-destructive">{(assignMutation.error as Error).message}</span>
        )}
      </div>

      {needsEnota && enote.length === 0 && (
        <p className="text-xs text-amber-600 mt-1.5">⚠ Podjetje nima poslovnih enot. Najprej jih ustvari v POS sistemu.</p>
      )}
    </div>
  );
}

// ── Podjetja tab ──────────────────────────────────────────────────────────────

function PodjetjaTab() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ podjetjeDavcna: "", naziv: "", kratekNaziv: "", naslov: "", postnaStevika: "", kraj: "" });
  const [davcnaLookup, setDavcnaLookup] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [assignForm, setAssignForm] = useState<Record<string, { clerkUserId: string; role: string }>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const handleDavcnaChange = async (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 8);
    setCreateForm((f) => ({ ...f, podjetjeDavcna: cleaned }));
    if (cleaned.length === 8) {
      setDavcnaLookup("loading");
      try {
        const res = await fetch(`/api/admin/podjetje/poisci?davcna=${cleaned}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        setCreateForm((f) => ({
          ...f,
          naziv: d.naziv || f.naziv,
          kratekNaziv: d.kratekNaziv || f.kratekNaziv,
          naslov: d.naslov || f.naslov,
          postnaStevika: d.postnaStevika || f.postnaStevika,
          kraj: d.kraj || f.kraj,
        }));
        setDavcnaLookup("found");
      } catch {
        setDavcnaLookup("error");
      }
    } else {
      setDavcnaLookup("idle");
    }
  };

  const { data: usersData } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "companies"],
    queryFn: () => apiFetch<{ companies: AdminCompany[] }>("/api/admin/companies"),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof createForm) =>
      apiFetch("/api/admin/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "companies"] }); setShowCreate(false); setDavcnaLookup("idle"); setCreateForm({ podjetjeDavcna: "", naziv: "", kratekNaziv: "", naslov: "", postnaStevika: "", kraj: "" }); },
  });

  const enableModuleMutation = useMutation({
    mutationFn: ({ companyId, module }: { companyId: string; module: string }) =>
      apiFetch(`/api/admin/companies/${companyId}/modules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "companies"] }),
  });

  const disableModuleMutation = useMutation({
    mutationFn: ({ companyId, module }: { companyId: string; module: string }) =>
      apiFetch<void>(`/api/admin/companies/${companyId}/modules/${module}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "companies"] }),
  });

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // companyId za brisanje

  const deleteMutation = useMutation({
    mutationFn: (companyId: string) =>
      apiFetch<void>(`/api/admin/companies/${companyId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setDeleteConfirm(null);
      setExpanded(null);
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: ({ companyId, clerkUserId, role }: { companyId: string; clerkUserId: string; role: string }) =>
      apiFetch(`/api/admin/companies/${companyId}/roles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clerkUserId, role }) }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setFeedback((f) => ({ ...f, [vars.companyId]: "Dostop dodeljen." }));
      setTimeout(() => setFeedback((f) => { const n = { ...f }; delete n[vars.companyId]; return n; }), 3000);
    },
  });

  const companies = data?.companies ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{companies.length} podjetij v sistemu</p>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="gap-2">
          <Plus className="h-4 w-4" /> Novo podjetje
        </Button>
      </div>

      {showCreate && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ustvari novo podjetje</CardTitle>
            <CardDescription className="text-xs">Vnesite davčno številko — podatki podjetja se samodejno prenesejo iz registra.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(createForm); }}
              className="space-y-3"
            >
              {/* Davčna + indikator */}
              <div className="space-y-1.5">
                <Label>Davčna številka *</Label>
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1 max-w-[200px]">
                    <Input
                      value={createForm.podjetjeDavcna}
                      onChange={(e) => handleDavcnaChange(e.target.value)}
                      placeholder="12345678"
                      maxLength={8}
                      required
                    />
                  </div>
                  {davcnaLookup === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {davcnaLookup === "found" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {davcnaLookup === "error" && <span className="text-xs text-amber-600">Ni najdeno — vnesite ročno</span>}
                </div>
              </div>

              {/* Naziv + kratek naziv */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Naziv *</Label>
                  <Input value={createForm.naziv} onChange={(e) => setCreateForm((f) => ({ ...f, naziv: e.target.value }))} placeholder="Podjetje d.o.o." required />
                </div>
                <div className="space-y-1.5">
                  <Label>Kratek naziv</Label>
                  <Input value={createForm.kratekNaziv} onChange={(e) => setCreateForm((f) => ({ ...f, kratekNaziv: e.target.value }))} placeholder="Podjetje" />
                </div>
              </div>

              {/* Naslov */}
              <div className="space-y-1.5">
                <Label>Naslov</Label>
                <Input value={createForm.naslov} onChange={(e) => setCreateForm((f) => ({ ...f, naslov: e.target.value }))} placeholder="Slovenska cesta 1" />
              </div>

              {/* Poštna + kraj */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Poštna številka</Label>
                  <Input value={createForm.postnaStevika} onChange={(e) => setCreateForm((f) => ({ ...f, postnaStevika: e.target.value }))} placeholder="1000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Kraj</Label>
                  <Input value={createForm.kraj} onChange={(e) => setCreateForm((f) => ({ ...f, kraj: e.target.value }))} placeholder="Ljubljana" />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => { setShowCreate(false); setDavcnaLookup("idle"); setCreateForm({ podjetjeDavcna: "", naziv: "", kratekNaziv: "", naslov: "", postnaStevika: "", kraj: "" }); }}>
                  <X className="h-4 w-4" />
                </Button>
                <Button type="submit" disabled={createMutation.isPending || davcnaLookup === "loading"}>
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ustvari"}
                </Button>
              </div>
            </form>
            {createMutation.isError && (
              <Alert variant="destructive" className="mt-3"><AlertCircle className="h-4 w-4" /><AlertDescription>{(createMutation.error as Error).message}</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : companies.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Ni podjetij. Ustvarite prvega.</div>
      ) : (
        <div className="divide-y border rounded-lg bg-card">
          {companies.map((c) => (
            <div key={c.id}>
              <button
                className="w-full flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors text-left"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.naziv}</span>
                    {c.modules.map((m) => (
                      <Badge key={m} variant="outline" className={`text-xs ${MODULE_COLORS[m]}`}>{MODULE_LABELS[m]}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.podjetjeDavcna} · {c.userCount} {c.userCount === 1 ? "uporabnik" : "uporabnikov"}
                  </p>
                </div>
                {expanded === c.id ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {expanded === c.id && (
                <div className="px-4 pb-4 space-y-4 bg-muted/20 border-t">
                  {/* Moduli */}
                  <div className="pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Aktivni moduli</p>
                    <div className="flex flex-wrap gap-2">
                      {(["erp", "pos"] as const).map((m) => {
                        const active = c.modules.includes(m);
                        return (
                          <button
                            key={m}
                            onClick={() => active
                              ? disableModuleMutation.mutate({ companyId: c.id, module: m })
                              : enableModuleMutation.mutate({ companyId: c.id, module: m })
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                              active
                                ? `${MODULE_COLORS[m]} hover:opacity-70`
                                : "bg-background border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            }`}
                          >
                            <Package className="h-3 w-3" />
                            {MODULE_LABELS[m]}
                            {active ? <X className="h-3 w-3 ml-0.5" /> : <Plus className="h-3 w-3 ml-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Nevarno območje */}
                  <div className="pt-2 border-t border-destructive/20">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Nevarno območje</p>
                    {deleteConfirm === c.id ? (
                      <div className="flex items-center gap-3 bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
                        <TriangleAlert className="h-4 w-4 text-destructive shrink-0" />
                        <span className="text-xs text-destructive flex-1">Trajno izbriši podjetje in vse njegove podatke?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(c.id)}
                        >
                          {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Izbriši"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeleteConfirm(null)}>Prekliči</Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1.5"
                        onClick={() => setDeleteConfirm(c.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Izbriši podjetje
                      </Button>
                    )}
                    {deleteMutation.isError && deleteConfirm === null && (
                      <p className="text-xs text-destructive mt-1">{(deleteMutation.error as Error).message}</p>
                    )}
                  </div>

                  {/* Dodaj ERP dostop — prikaži samo če ima ERP modul */}
                  {c.modules.includes("erp") && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dostop do ERP (glavna knjiga)</p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <Select
                          value={assignForm[c.id]?.clerkUserId ?? ""}
                          onValueChange={(v) => setAssignForm((f) => ({ ...f, [c.id]: { ...f[c.id], clerkUserId: v } }))}
                        >
                          <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue placeholder="Izberi uporabnika…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(usersData?.users ?? []).map((u) => (
                              <SelectItem key={u.clerkUserId} value={u.clerkUserId}>
                                <span className="flex flex-col">
                                  <span>{u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : u.email}</span>
                                  {(u.firstName || u.lastName) && <span className="text-xs text-muted-foreground">{u.email}</span>}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={assignForm[c.id]?.role ?? "accountant"}
                          onValueChange={(v) => setAssignForm((f) => ({ ...f, [c.id]: { ...f[c.id], role: v } }))}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Lastnik</SelectItem>
                            <SelectItem value="accountant">Računovodja</SelectItem>
                            <SelectItem value="viewer">Pregledovalec</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={assignRoleMutation.isPending || !assignForm[c.id]?.clerkUserId}
                          onClick={() => assignRoleMutation.mutate({ companyId: c.id, clerkUserId: assignForm[c.id]?.clerkUserId ?? "", role: assignForm[c.id]?.role ?? "accountant" })}
                        >
                          {assignRoleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Dodeli"}
                        </Button>
                        {feedback[c.id] && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{feedback[c.id]}</span>}
                      </div>
                    </div>
                  )}

                  {/* POS dostop — prikaži samo če ima POS modul */}
                  {c.modules.includes("pos") && (
                    <PosRolesSection companyId={c.id} allUsers={usersData?.users ?? []} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Uporabniki tab ────────────────────────────────────────────────────────────

function UporabnikiAdminTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const users = data?.users ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{users.length} {users.length === 1 ? "uporabnik" : "uporabnikov"} v sistemu</p>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : users.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Ni registriranih uporabnikov.</div>
      ) : (
        <div className="divide-y border rounded-lg bg-card">
          {users.map((u) => {
            const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
            const hasAccess = u.companies.length > 0;
            return (
              <div key={u.clerkUserId} className={`p-4 ${!hasAccess ? "bg-amber-50/50" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{displayName}</p>
                    {displayName !== u.email && (
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    )}
                  </div>
                  {!hasAccess && (
                    <span className="text-xs text-amber-600 flex items-center gap-1 shrink-0 mt-0.5">
                      <AlertCircle className="h-3 w-3" /> Čaka na dostop
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {hasAccess ? (
                    u.companies.map((c) => (
                      <Badge key={c.companyId} variant="outline" className="text-xs gap-1">
                        <Building2 className="h-3 w-3" />
                        {c.naziv} · {ROLE_LABELS[c.role] ?? c.role}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Uporabnik nima dostopa do nobenega podjetja.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-violet-100 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-violet-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administracija sistema</h1>
          <p className="text-sm text-muted-foreground">Upravljanje podjetij, modulov in dostopov.</p>
        </div>
      </div>

      <Tabs defaultValue="podjetja" className="space-y-5">
        <TabsList>
          <TabsTrigger value="podjetja" className="gap-2">
            <Building2 className="h-3.5 w-3.5" /> Podjetja
          </TabsTrigger>
          <TabsTrigger value="uporabniki" className="gap-2">
            <Users className="h-3.5 w-3.5" /> Uporabniki
          </TabsTrigger>
        </TabsList>
        <TabsContent value="podjetja" className="mt-0"><PodjetjaTab /></TabsContent>
        <TabsContent value="uporabniki" className="mt-0"><UporabnikiAdminTab /></TabsContent>
      </Tabs>
    </div>
  );
}
