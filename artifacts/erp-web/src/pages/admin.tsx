import React, { useState, useEffect, useCallback } from "react";
import {
  Building2, Users, Plus, ShieldCheck, Loader2, AlertCircle,
  CheckCircle2, ChevronDown, ChevronRight, Trash2, Package, X, TriangleAlert,
  RefreshCw, Save, Ban, Unlock, MonitorX, Clock, LogOut,
  Laptop, Smartphone, Monitor, Wifi, WifiOff, MapPin, History, Download,
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
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@clerk/react";
import {
  getGetAdminEventTransferDiagnosticsQueryKey,
  getGetAdminEventTransferDetailQueryKey,
  getGetAdminEventTransferMovementDetailQueryKey,
  useGetAdminEventTransferDetail,
  useGetAdminEventTransferMovementDetail,
  useGetAdminEventTransferDiagnostics,
  type EventTransferDetail,
  type EventTransferMovementDetail,
  type EventTransferDiagnosticMovement,
  type EventTransferDiagnosticViolation,
} from "@workspace/api-client-react";
import { CompanyOffboarding } from "@/components/admin/CompanyOffboarding";
import {
  buildEventTransferDiagnosticsCsv,
  eventTransferDiagnosticsCsvFilename,
} from "@/lib/eventTransferDiagnosticsCsv";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminCompany {
  id: string;
  podjetjeDavcna: string;
  naziv: string;
  kratekNaziv: string | null;
  modules: string[];
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
  lastActiveAt: string | null;
  imaAktivnoSejo: boolean;
  banned: boolean;
  isSuperAdmin: boolean;
  companies: { companyId: string; naziv: string; role: string; sistem: "erp" | "pos" | "os"; createdAt: string }[];
}

interface AdminSession {
  sessionId: string;
  clientId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  lastActiveAt: string;
  expireAt: string;
  createdAt: string;
  brskalnik: string | null;
  brskalnikVerzija: string | null;
  naprava: string | null;
  jeMobilen: boolean;
  ip: string | null;
  mesto: string | null;
  drzava: string | null;
}

interface AdminDevice {
  clientId: string;
  jeAktivna: boolean;
  brskalnik: string | null;
  brskalnikVerzija: string | null;
  naprava: string | null;
  jeMobilen: boolean;
  ip: string | null;
  mesto: string | null;
  drzava: string | null;
  zadnjaAktivnost: string;
  prvaPrijava: string;
  uporabniki: { userId: string; email: string; firstName: string; lastName: string }[];
  aktivneSejeId: string[];
}

/** Uporabnik je "online" če je bil aktiven v zadnjih 5 minutah */
function jeOnline(lastActiveAt: string | null): boolean {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() < 5 * 60 * 1000;
}

/** Prijazni prikaz časa zadnje aktivnosti */
function zadnjaAktivnost(lastActiveAt: string | null): string {
  if (!lastActiveAt) return "Nikoli";
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Pravkar";
  if (min < 60) return `pred ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `pred ${h} h`;
  const d = Math.floor(h / 24);
  return `pred ${d} d`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Hook, ki vrne apiFetch funkcijo z vsakič svežim Clerk žetonom.
 * Rešuje problem 60s TTL Clerk JWT v dev načinu — __session piškotek
 * poteče, a getToken() vedno vrne svežo vrednost.
 */
function useApiFetch() {
  const { getToken } = useAuth();
  return useCallback(async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }, [getToken]);
}

const VIOLATION_KIND_LABELS: Record<string, string> = {
  missing_movement: "Manjkajoč premik zaloge",
  extra_movement: "Odvečen premik zaloge",
  movement_value_mismatch: "Neskladje vrednosti/količine premika",
  unexpected_movement_for_status: "Nepričakovan premik za status",
  missing_transfer_link: "Manjkajoča povezava s prenosom",
  orphan_transfer_link: "Osirela povezava s prenosom",
  reference_conflict: "Konflikt referenc",
  non_event_has_transfer_link: "Nepovezan dogodek ima prenos",
  ambiguous_transfer_line: "Dvoumna vrstica prenosa",
};
const DIRECTION_LABELS: Record<string, string> = {
  outbound: "Izhod",
  return: "Povratek",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Osnutek",
  completed: "Zaključeno",
  cancelled: "Preklicano",
};

const MODULE_LABELS: Record<string, string> = {
  erp: "Glavna knjiga",
  pos: "POS gostinstvo",
  osnovna_sredstva: "Osnovna sredstva",
};
const MODULE_COLORS: Record<string, string> = {
  erp: "bg-blue-100 text-blue-800 border-blue-200",
  pos: "bg-amber-100 text-amber-800 border-amber-200",
  osnovna_sredstva: "bg-emerald-100 text-emerald-800 border-emerald-200",
};
const OS_VLOGA_LABELS: Record<string, string> = {
  os_admin: "OS Admin",
  os_user: "OS Upravljalec",
  os_viewer: "OS Pregledovalec",
};
const OS_VLOGA_COLORS: Record<string, string> = {
  os_admin: "bg-emerald-100 text-emerald-800 border-emerald-200",
  os_user: "bg-teal-100 text-teal-800 border-teal-200",
  os_viewer: "bg-slate-100 text-slate-700 border-slate-200",
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

const ACCESS_SECTION_CLASS = "space-y-3";
const ACCESS_TITLE_CLASS = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2";
const ACCESS_LIST_CLASS = "divide-y border rounded-md bg-background";
const ACCESS_ROW_CLASS = "flex items-center gap-2 px-3 py-2";
const ACCESS_FORM_CLASS = "flex flex-wrap gap-2 items-center";
const ACCESS_ROLE_BADGE_CLASS = "text-xs shrink-0";
const ACCESS_WARNING_CLASS = "text-xs text-amber-600 mt-1.5";

interface PosUserRow {
  id: number;
  clerkUserId: string;
  vloga: string;
  ime: string;
  priimek: string;
  aktiven: boolean;
  enotaId: number | null;
  enotaIme: string | null;
  blagajnaId: number | null;
  blagajnaIme: string | null;
}

interface Enota {
  id: number;
  ime: string;
  aktiven: boolean;
  prostorId: string | null;
  prostorNaziv: string | null;
}

interface AdminBlagajna {
  id: number;
  ime: string;
  ppId: string;
  bId: string;
  enotaId: number;
  aktivna: boolean;
}

// ── ERP Roles Section ─────────────────────────────────────────────────────────

interface ErpUserRow {
  id: string;
  clerkUserId: string;
  role: string;
  createdAt: string;
}

function ErpRolesSection({ companyId, allUsers }: { companyId: string; allUsers: AdminUser[] }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ clerkUserId: "", role: "accountant" });
  const [feedback, setFeedback] = useState<"ok" | "">("");

  const { data: erpData, isLoading: erpLoading } = useQuery({
    queryKey: ["admin", "erp-roles", companyId],
    queryFn: () => apiFetch<{ users: ErpUserRow[] }>(`/api/admin/companies/${companyId}/roles`),
  });

  const assignMutation = useMutation({
    mutationFn: (body: { clerkUserId: string; role: string }) =>
      apiFetch(`/api/admin/companies/${companyId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "erp-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setForm({ clerkUserId: "", role: "accountant" });
      setFeedback("ok");
      setTimeout(() => setFeedback(""), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch<void>(`/api/admin/companies/${companyId}/roles/${clerkUserId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "erp-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const erpUsers = erpData?.users ?? [];
  const userMap = new Map(allUsers.map((u) => [u.clerkUserId, u]));
  const displayName = (clerkUserId: string) => {
    const user = userMap.get(clerkUserId);
    if (!user) return clerkUserId;
    return user.firstName || user.lastName
      ? `${user.firstName} ${user.lastName}`.trim()
      : user.email;
  };

  return (
    <div className={ACCESS_SECTION_CLASS}>
      <div>
        <p className={ACCESS_TITLE_CLASS}>Dostop do Glavne knjige</p>
        <p className={ACCESS_TITLE_CLASS}>Obstoječi uporabniki Glavne knjige</p>
        {erpLoading ? (
          <div className="space-y-1">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : erpUsers.length > 0 ? (
          <div className={ACCESS_LIST_CLASS}>
            {erpUsers.map((user) => (
              <div key={user.clerkUserId} className={ACCESS_ROW_CLASS}>
                <span className="flex-1 text-xs font-medium truncate">{displayName(user.clerkUserId)}</span>
                <Badge variant="outline" className={`${ACCESS_ROLE_BADGE_CLASS} bg-blue-50 text-blue-800 border-blue-200`}>
                  {ROLE_LABELS[user.role] ?? user.role}
                </Badge>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  onClick={() => removeMutation.mutate(user.clerkUserId)}
                  disabled={removeMutation.isPending}
                  title="Odstrani dostop do Glavne knjige"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Ni uporabnikov Glavne knjige.</p>
        )}
      </div>

      <div className={ACCESS_FORM_CLASS}>
        <Select value={form.clerkUserId} onValueChange={(v) => setForm((f) => ({ ...f, clerkUserId: v }))}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Uporabnik…" /></SelectTrigger>
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
        <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">Lastnik</SelectItem>
            <SelectItem value="accountant">Računovodja</SelectItem>
            <SelectItem value="viewer">Pregledovalec</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          disabled={assignMutation.isPending || !form.clerkUserId}
          onClick={() => assignMutation.mutate({ clerkUserId: form.clerkUserId, role: form.role })}
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
    </div>
  );
}

// ── POS Roles Section ─────────────────────────────────────────────────────────

function PosRolesSection({ companyId, allUsers }: { companyId: string; allUsers: AdminUser[] }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ clerkUserId: "", vloga: "uporabnik", enotaId: "", blagajnaId: "" });
  const [feedback, setFeedback] = useState<"ok" | "">("");

  const { data: posData, isLoading: posLoading } = useQuery({
    queryKey: ["admin", "pos-roles", companyId],
    queryFn: () => apiFetch<{ users: PosUserRow[] }>(`/api/admin/companies/${companyId}/pos-roles`),
  });

  const { data: enoteData } = useQuery({
    queryKey: ["admin", "enote", companyId],
    queryFn: () => apiFetch<{ enote: Enota[] }>(`/api/admin/companies/${companyId}/enote`),
    staleTime: 0,
  });

  // Blagajne za izbrano enoto — naloži samo ko je enota izbrana
  const { data: blagajneData } = useQuery({
    queryKey: ["admin", "blagajne", companyId, form.enotaId],
    queryFn: () =>
      apiFetch<{ blagajne: AdminBlagajna[] }>(
        `/api/admin/companies/${companyId}/blagajne?enotaId=${form.enotaId}`,
      ),
    enabled: !!form.enotaId,
  });

  const needsEnota = form.vloga === "admin_enote" || form.vloga === "uporabnik";
  const needsBlagajna = form.vloga === "uporabnik";
  const enote = enoteData?.enote ?? [];
  const blagajne = blagajneData?.blagajne ?? [];

  // Ko se blagajne naložijo za izbrano enoto, samodejno izberi, če je samo ena
  useEffect(() => {
    if (!needsBlagajna || !form.enotaId || blagajne.length !== 1) return;
    setForm((f) => f.blagajnaId ? f : { ...f, blagajnaId: String(blagajne[0].id) });
  }, [blagajne, needsBlagajna, form.enotaId]);
  const posUsers = posData?.users ?? [];

  const assignMutation = useMutation({
    mutationFn: (body: { clerkUserId: string; vloga: string; enotaId?: number | null; blagajnaId?: number | null }) =>
      apiFetch(`/api/admin/companies/${companyId}/pos-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "pos-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setForm({ clerkUserId: "", vloga: "uporabnik", enotaId: "", blagajnaId: "" });
      setFeedback("ok");
      setTimeout(() => setFeedback(""), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch<void>(`/api/admin/companies/${companyId}/pos-roles/${clerkUserId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "pos-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const canSubmit =
    form.clerkUserId &&
    (!needsEnota || form.enotaId) &&
    (!needsBlagajna || form.blagajnaId);

  return (
    <div className={ACCESS_SECTION_CLASS}>
      <div>
        <p className={ACCESS_TITLE_CLASS}>Dostop do POS gostinstva</p>
        <p className={ACCESS_TITLE_CLASS}>Obstoječi uporabniki POS gostinstva</p>

        {posLoading ? (
          <div className="space-y-1">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : posUsers.length > 0 ? (
          <div className={ACCESS_LIST_CLASS}>
            {posUsers.map((u) => {
              const name = [u.ime, u.priimek].filter(Boolean).join(" ") || u.clerkUserId;
              return (
                <div key={u.clerkUserId} className={ACCESS_ROW_CLASS}>
                  <span className="flex-1 text-xs font-medium truncate">{name}</span>
                  <Badge variant="outline" className={`${ACCESS_ROLE_BADGE_CLASS} ${POS_VLOGA_COLORS[u.vloga] ?? ""}`}>
                    {POS_VLOGA_LABELS[u.vloga] ?? u.vloga}
                  </Badge>
                  {u.enotaIme && (
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">· {u.enotaIme}</span>
                  )}
                  {u.blagajnaIme && (
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline font-mono">· {u.blagajnaIme}</span>
                  )}
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={() => removeMutation.mutate(u.clerkUserId)}
                    disabled={removeMutation.isPending}
                    title="Odstrani dostop do POS gostinstva"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Ni uporabnikov POS gostinstva.</p>
        )}
      </div>

      {/* Obrazec za dodelitev */}
      <div className={ACCESS_FORM_CLASS}>
        {/* Uporabnik */}
        <Select value={form.clerkUserId} onValueChange={(v) => setForm((f) => ({ ...f, clerkUserId: v }))}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Uporabnik…" /></SelectTrigger>
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
          onValueChange={(v) => setForm((f) => ({ ...f, vloga: v, enotaId: "", blagajnaId: "" }))}
        >
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin podjetja</SelectItem>
            <SelectItem value="admin_enote">Admin enote</SelectItem>
            <SelectItem value="uporabnik">Uporabnik</SelectItem>
          </SelectContent>
        </Select>

        {/* Enota (samo za admin_enote / uporabnik) */}
        {needsEnota && (
          <Select
            value={form.enotaId}
            onValueChange={(v) => setForm((f) => ({ ...f, enotaId: v, blagajnaId: "" }))}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder={enote.length ? "Enota…" : "Ni enot"} />
            </SelectTrigger>
            <SelectContent>
              {enote.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Poslovni prostor — samodejno iz enote (1:1 razmerje) */}
        {needsEnota && form.enotaId && (() => {
          const en = enote.find(e => String(e.id) === form.enotaId);
          return en?.prostorId ? (
            <span className="text-xs text-muted-foreground shrink-0">
              Prostor: <span className="font-mono font-medium text-foreground">{en.prostorId}</span>
            </span>
          ) : null;
        })()}

        {/* Blagajna (samo za vloga === "uporabnik" in ko je enota izbrana) */}
        {needsBlagajna && form.enotaId && (
          <Select
            value={form.blagajnaId}
            onValueChange={(v) => setForm((f) => ({ ...f, blagajnaId: v }))}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder={blagajne.length ? "Blagajna…" : "Ni blagajn"} />
            </SelectTrigger>
            <SelectContent>
              {blagajne.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  <span className="font-mono">{b.ppId}-{b.bId}</span>
                  {b.ime && <span className="text-muted-foreground ml-1.5">{b.ime}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Opozorilo: čakamo na izbiro enote za prikaz blagajn */}
        {needsBlagajna && !form.enotaId && (
          <span className="text-xs text-muted-foreground shrink-0">← najprej enoto</span>
        )}

        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          disabled={assignMutation.isPending || !canSubmit}
          onClick={() =>
            assignMutation.mutate({
              clerkUserId: form.clerkUserId,
              vloga: form.vloga,
              enotaId: needsEnota && form.enotaId ? Number(form.enotaId) : null,
              blagajnaId: needsBlagajna && form.blagajnaId ? Number(form.blagajnaId) : null,
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
        <p className={ACCESS_WARNING_CLASS}>⚠ Podjetje nima poslovnih enot. Najprej jih ustvari v POS sistemu.</p>
      )}
      {needsBlagajna && form.enotaId && blagajne.length === 0 && (
        <p className={ACCESS_WARNING_CLASS}>⚠ Izbrana enota nima registriranih blagajn.</p>
      )}
    </div>
  );
}

// ── OS Roles Section ──────────────────────────────────────────────────────────

interface OsUserRow {
  id: string;
  clerkUserId: string;
  role: string;
  createdAt: string;
}

function OsRolesSection({ companyId, allUsers }: { companyId: string; allUsers: AdminUser[] }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ clerkUserId: "", role: "os_user" });
  const [feedback, setFeedback] = useState<"ok" | "">("");

  const { data: osData, isLoading: osLoading } = useQuery({
    queryKey: ["admin", "os-roles", companyId],
    queryFn: () => apiFetch<{ users: OsUserRow[] }>(`/api/admin/companies/${companyId}/os-roles`),
  });

  const assignMutation = useMutation({
    mutationFn: (body: { clerkUserId: string; role: string }) =>
      apiFetch(`/api/admin/companies/${companyId}/os-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "os-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setForm({ clerkUserId: "", role: "os_user" });
      setFeedback("ok");
      setTimeout(() => setFeedback(""), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch<void>(`/api/admin/companies/${companyId}/os-roles/${clerkUserId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "os-roles", companyId] });
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const osUsers = osData?.users ?? [];

  // Za prikaz: Clerk userjev za ime
  const userMap = new Map(allUsers.map((u) => [u.clerkUserId, u]));
  const displayName = (cu: string) => {
    const u = userMap.get(cu);
    if (!u) return cu;
    return u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : u.email;
  };

  return (
    <div className={ACCESS_SECTION_CLASS}>
      <div>
        <p className={ACCESS_TITLE_CLASS}>Dostop do Osnovnih sredstev</p>
        <p className={ACCESS_TITLE_CLASS}>Obstoječi uporabniki Osnovnih sredstev</p>

        {osLoading ? (
          <div className="space-y-1">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : osUsers.length > 0 ? (
          <div className={ACCESS_LIST_CLASS}>
            {osUsers.map((u) => (
              <div key={u.clerkUserId} className={ACCESS_ROW_CLASS}>
                <span className="flex-1 text-xs font-medium truncate">{displayName(u.clerkUserId)}</span>
                <Badge variant="outline" className={`${ACCESS_ROLE_BADGE_CLASS} ${OS_VLOGA_COLORS[u.role] ?? ""}`}>
                  {OS_VLOGA_LABELS[u.role] ?? u.role}
                </Badge>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  onClick={() => removeMutation.mutate(u.clerkUserId)}
                  disabled={removeMutation.isPending}
                  title="Odstrani dostop do Osnovnih sredstev"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Ni uporabnikov Osnovnih sredstev.</p>
        )}
      </div>

      <div className={ACCESS_FORM_CLASS}>
        <Select value={form.clerkUserId} onValueChange={(v) => setForm((f) => ({ ...f, clerkUserId: v }))}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Uporabnik…" /></SelectTrigger>
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

        <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="os_admin">OS Admin</SelectItem>
            <SelectItem value="os_user">OS Upravljalec</SelectItem>
            <SelectItem value="os_viewer">OS Pregledovalec</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          disabled={assignMutation.isPending || !form.clerkUserId}
          onClick={() => assignMutation.mutate({ clerkUserId: form.clerkUserId, role: form.role })}
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
    </div>
  );
}

// ── Urejanje podatkov podjetja (admin) ───────────────────────────────────────

interface TrrVrstica { iban: string; bic: string; }

interface AdminCompanyDetail {
  id: string; podjetjeDavcna: string; naziv: string; kratekNaziv?: string | null;
  naslov?: string | null; ulica?: string | null; postnaStevika?: string | null;
  kraj?: string | null; drzava?: string | null; kodaDrzave?: string | null;
  maticnaStevilka?: string | null; idZaDdv?: string | null; zavezanecDdv?: boolean | null;
  trr?: TrrVrstica[] | null;
  email?: string | null; telefon?: string | null; www?: string | null;
  modules?: string[];
}

function PodatkiPodjetjaSection({ companyId }: { companyId: string }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AdminCompanyDetail>({
    queryKey: ["admin", "company-detail", companyId],
    queryFn: () => apiFetch<AdminCompanyDetail>(`/api/admin/companies/${companyId}`),
  });

  const emptyForm = {
    naziv: "", kratekNaziv: "", naslov: "", ulica: "", postnaStevika: "", kraj: "",
    drzava: "", kodaDrzave: "", maticnaStevilka: "", idZaDdv: "",
    zavezanecDdv: false,
    email: "", telefon: "", www: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [trr, setTrr] = useState<TrrVrstica[]>([]);
  const [saved, setSaved] = useState(false);
  const [osvezujem, setOsvezujem] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    setForm({
      naziv: data.naziv ?? "",
      kratekNaziv: data.kratekNaziv ?? "",
      naslov: data.naslov ?? "",
      ulica: data.ulica ?? "",
      postnaStevika: data.postnaStevika ?? "",
      kraj: data.kraj ?? "",
      drzava: data.drzava ?? "",
      kodaDrzave: data.kodaDrzave ?? "",
      maticnaStevilka: data.maticnaStevilka ?? "",
      idZaDdv: data.idZaDdv ?? "",
      zavezanecDdv: data.zavezanecDdv ?? false,
      email: data.email ?? "",
      telefon: data.telefon ?? "",
      www: data.www ?? "",
    });
    setTrr(data.trr ?? []);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<AdminCompanyDetail>(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      qc.setQueryData(["admin", "company-detail", companyId], updated);
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      setNapaka(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => setNapaka((err as Error).message),
  });

  async function handleOsvezi() {
    setOsvezujem(true);
    setNapaka(null);
    try {
      const updated = await apiFetch<AdminCompanyDetail>(`/api/admin/companies/${companyId}/osvezi`, { method: "POST" });
      qc.setQueryData(["admin", "company-detail", companyId], updated);
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      setForm({
        naziv: updated.naziv ?? "", kratekNaziv: updated.kratekNaziv ?? "",
        naslov: updated.naslov ?? "", ulica: updated.ulica ?? "",
        postnaStevika: updated.postnaStevika ?? "", kraj: updated.kraj ?? "",
        drzava: updated.drzava ?? "", kodaDrzave: updated.kodaDrzave ?? "",
        maticnaStevilka: updated.maticnaStevilka ?? "", idZaDdv: updated.idZaDdv ?? "",
        zavezanecDdv: updated.zavezanecDdv ?? false,
        email: updated.email ?? "", telefon: updated.telefon ?? "", www: updated.www ?? "",
      });
      setTrr(updated.trr ?? []);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setNapaka((err as Error).message);
    } finally {
      setOsvezujem(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate({
      naziv: form.naziv || undefined,
      kratekNaziv: form.kratekNaziv || null,
      naslov: form.naslov || null,
      ulica: form.ulica || null,
      postnaStevika: form.postnaStevika || null,
      kraj: form.kraj || null,
      drzava: form.drzava || null,
      kodaDrzave: form.kodaDrzave || null,
      maticnaStevilka: form.maticnaStevilka || null,
      idZaDdv: form.idZaDdv || null,
      zavezanecDdv: form.zavezanecDdv,
      trr: trr.length > 0 ? trr : null,
      email: form.email || null,
      telefon: form.telefon || null,
      www: form.www || null,
    });
  }

  if (isLoading) return <div className="space-y-2">{[0,1,2].map(i=><div key={i} className="h-8 bg-muted animate-pulse rounded"/>)}</div>;

  return (
    <form onSubmit={(e) => { handleSubmit(e); }} className="space-y-4">
      {/* Gumb osvezi */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Podatki podjetja</p>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => void handleOsvezi()} disabled={osvezujem}>
          {osvezujem ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Osveži iz registra
        </Button>
      </div>

      {/* Identifikacija */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Davčna številka</label>
          <Input value={data?.podjetjeDavcna ?? ""} disabled className="h-8 text-xs bg-muted" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Matična številka</label>
          <Input value={form.maticnaStevilka} onChange={(e) => setForm((f) => ({ ...f, maticnaStevilka: e.target.value }))} className="h-8 text-xs" placeholder="1234567000" />
        </div>
        <div className="space-y-1 col-span-2">
          <label className="text-xs text-muted-foreground">Polni naziv *</label>
          <Input value={form.naziv} onChange={(e) => setForm((f) => ({ ...f, naziv: e.target.value }))} className="h-8 text-xs" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Kratek naziv</label>
          <Input value={form.kratekNaziv} onChange={(e) => setForm((f) => ({ ...f, kratekNaziv: e.target.value }))} className="h-8 text-xs" placeholder="ABC d.o.o." />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">ID za DDV</label>
          <Input value={form.idZaDdv} onChange={(e) => setForm((f) => ({ ...f, idZaDdv: e.target.value }))} className="h-8 text-xs" placeholder="SI12345678" />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id={`zavezanec-${companyId}`} checked={form.zavezanecDdv} onChange={(e) => setForm((f) => ({ ...f, zavezanecDdv: e.target.checked }))} className="h-3.5 w-3.5 rounded border-input" />
          <label htmlFor={`zavezanec-${companyId}`} className="text-xs cursor-pointer">Zavezanec za DDV</label>
        </div>
      </div>

      {/* Naslov */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1 col-span-3">
          <label className="text-xs text-muted-foreground">Ulica in hišna številka</label>
          <Input value={form.ulica} onChange={(e) => setForm((f) => ({ ...f, ulica: e.target.value }))} className="h-8 text-xs" placeholder="Slovenska cesta 1" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Poštna</label>
          <Input value={form.postnaStevika} onChange={(e) => setForm((f) => ({ ...f, postnaStevika: e.target.value }))} className="h-8 text-xs" placeholder="1000" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Kraj</label>
          <Input value={form.kraj} onChange={(e) => setForm((f) => ({ ...f, kraj: e.target.value }))} className="h-8 text-xs" placeholder="Ljubljana" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Država</label>
          <Input value={form.drzava} onChange={(e) => setForm((f) => ({ ...f, drzava: e.target.value }))} className="h-8 text-xs" placeholder="Slovenija" />
        </div>
      </div>

      {/* Kontakt */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">E-mail</label>
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="h-8 text-xs" placeholder="info@podjetje.si" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Telefon</label>
          <Input value={form.telefon} onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))} className="h-8 text-xs" placeholder="+386 1 234 56 78" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Spletna stran</label>
          <Input value={form.www} onChange={(e) => setForm((f) => ({ ...f, www: e.target.value }))} className="h-8 text-xs" placeholder="https://www.podjetje.si" />
        </div>
      </div>

      {/* Bančni računi */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Bančni računi (TRR)</label>
          <button type="button" onClick={() => setTrr(t => [...t, { iban: "", bic: "" }])} className="text-xs text-primary hover:underline flex items-center gap-1">
            <Plus className="h-3 w-3" /> Dodaj
          </button>
        </div>
        {trr.map((t, i) => (
          <div key={i} className="flex gap-1.5">
            <Input value={t.iban} onChange={(e) => setTrr(arr => arr.map((x,j)=>j===i?{...x,iban:e.target.value.toUpperCase()}:x))} className="h-8 text-xs flex-1" placeholder="SI56…" />
            <Input value={t.bic} onChange={(e) => setTrr(arr => arr.map((x,j)=>j===i?{...x,bic:e.target.value.toUpperCase()}:x))} className="h-8 text-xs w-28" placeholder="BSLJSI2X" />
            <button type="button" onClick={() => setTrr(arr=>arr.filter((_,j)=>j!==i))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {/* Napake / uspeh */}
      {napaka && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{napaka}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="py-2 border-green-200 bg-green-50 text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="text-xs">Shranjeno.</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="sm" className="h-8 text-xs gap-1.5" disabled={saveMutation.isPending}>
        {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Shrani
      </Button>
    </form>
  );
}

// ── Podjetja tab ──────────────────────────────────────────────────────────────

function PodjetjaTab() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ podjetjeDavcna: "", naziv: "", kratekNaziv: "", naslov: "", postnaStevika: "", kraj: "" });
  const [davcnaLookup, setDavcnaLookup] = useState<"idle" | "loading" | "found" | "error">("idle");
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
  const [accountsDeleteConfirm, setAccountsDeleteConfirm] = useState<string | null>(null);

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

  const deleteAccountsMutation = useMutation({
    mutationFn: (companyId: string) =>
      apiFetch<{ deletedCount: number }>(`/api/admin/companies/${companyId}/accounts`, { method: "DELETE" }),
    onSuccess: (result, companyId) => {
      setAccountsDeleteConfirm(null);
      setFeedback((f) => ({ ...f, [companyId]: `Izbrisanih kontov: ${result.deletedCount}.` }));
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
                  {/* Podatki podjetja */}
                  <div className="pt-4 border-b pb-4">
                    <PodatkiPodjetjaSection companyId={c.id} />
                  </div>

                  {/* Moduli */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Aktivni moduli</p>
                    <div className="flex flex-wrap gap-2">
                      {(["erp", "pos", "osnovna_sredstva"] as const).map((m) => {
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
                    <div className="mt-2 space-y-1">
                      {(["erp", "pos", "osnovna_sredstva"] as const)
                        .filter((m) => !c.modules.includes(m))
                        .map((m) => (
                          <p key={m} className={ACCESS_WARNING_CLASS}>
                            ⚠ Modul {MODULE_LABELS[m]} ni aktiven. Aktivirajte ga zgoraj.
                          </p>
                        ))}
                    </div>
                  </div>

                  {/* Offboarding / Priprava na zaprtje */}
                  <CompanyOffboarding companyId={c.id} />

                  {/* Nevarno območje */}
                  <div className="pt-2 border-t border-destructive/20 mt-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Nevarno območje</p>
                     {accountsDeleteConfirm === c.id ? (
                       <div className="flex items-center gap-3 bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2 mb-2">
                         <TriangleAlert className="h-4 w-4 text-destructive shrink-0" />
                         <span className="text-xs text-destructive flex-1">
                           Trajno izbriši celoten kontni plan? Dejanja ni mogoče razveljaviti.
                         </span>
                         <Button
                           size="sm"
                           variant="destructive"
                           className="h-7 text-xs"
                           disabled={deleteAccountsMutation.isPending}
                           onClick={() => deleteAccountsMutation.mutate(c.id)}
                         >
                           {deleteAccountsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Izbriši konte"}
                         </Button>
                         <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAccountsDeleteConfirm(null)}>Prekliči</Button>
                       </div>
                     ) : (
                       <Button
                         size="sm"
                         variant="outline"
                         className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1.5 mb-2"
                         onClick={() => setAccountsDeleteConfirm(c.id)}
                       >
                         <Trash2 className="h-3 w-3" />
                         Izbriši kontni plan
                       </Button>
                     )}
                     {deleteAccountsMutation.isError && accountsDeleteConfirm === null && (
                       <p className="text-xs text-destructive mb-2">{(deleteAccountsMutation.error as Error).message}</p>
                     )}
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

                  {/* Dostop do Glavne knjige — prikaži samo če je modul aktiven */}
                  {c.modules.includes("erp") && (
                    <ErpRolesSection companyId={c.id} allUsers={usersData?.users ?? []} />
                  )}

                  {/* POS dostop — prikaži samo če ima POS modul */}
                  {c.modules.includes("pos") && (
                    <PosRolesSection companyId={c.id} allUsers={usersData?.users ?? []} />
                  )}

                  {/* Osnovna sredstva dostop — prikaži samo če ima OS modul */}
                  {c.modules.includes("osnovna_sredstva") && (
                    <OsRolesSection companyId={c.id} allUsers={usersData?.users ?? []} />
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

// ── Status seje: oznake in barve ──────────────────────────────────────────────

const SEJA_STATUS_LABEL: Record<string, string> = {
  active: "Aktivna",
  expired: "Potekla",
  revoked: "Prekinjena",
  ended: "Končana",
  abandoned: "Zapuščena",
  removed: "Odstranjena",
};

const SEJA_STATUS_CLASS: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
  revoked: "bg-red-50 text-red-600 border-red-200",
  ended: "bg-gray-100 text-gray-500 border-gray-200",
  abandoned: "bg-gray-100 text-gray-400 border-gray-200",
  removed: "bg-gray-100 text-gray-400 border-gray-200",
};

function ikona(s: AdminSession) {
  if (s.jeMobilen) return <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

// ── Panel zgodovine sej za enega uporabnika ───────────────────────────────────

function UserSejePanel({ clerkUserId, onRevoke }: { clerkUserId: string; onRevoke?: () => void }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin", "user-sessions", clerkUserId],
    queryFn: () => apiFetch<{ sessions: AdminSession[] }>(`/api/admin/users/${clerkUserId}/sessions`),
    staleTime: 30_000,
  });
  const sessions = data?.sessions ?? [];

  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/admin/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "user-sessions", clerkUserId] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setRevokeConfirm(null);
      onRevoke?.();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-1.5 py-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">Ni zabeleženih sej.</p>;
  }

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">
          {sessions.length} {sessions.length === 1 ? "seja" : sessions.length < 5 ? "seji / seje" : "sej"}
        </p>
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>
      {sessions.map((s) => {
        const isRevoking = revokeMutation.isPending && revokeConfirm === s.sessionId;
        const brskalnik = [s.brskalnik, s.brskalnikVerzija?.split(".")[0]].filter(Boolean).join(" ");
        const lokacija = [s.mesto, s.drzava].filter(Boolean).join(", ");
        const datumPrijave = new Date(s.createdAt).toLocaleString("sl-SI", {
          day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        const datumAktivnosti = new Date(s.lastActiveAt).toLocaleString("sl-SI", {
          day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        return (
          <div
            key={s.sessionId}
            className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-md border text-xs ${
              s.status === "active"
                ? "bg-green-50/60 border-green-100"
                : "bg-gray-50 border-gray-100 opacity-80"
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              {/* Statusna pika */}
              <div className="relative mt-0.5 shrink-0">
                <div className={`h-2 w-2 rounded-full mt-0.5 ${s.status === "active" ? "bg-green-500" : "bg-gray-300"}`} />
                {s.status === "active" && (
                  <div className="absolute inset-0 h-2 w-2 rounded-full bg-green-500 animate-ping opacity-50 mt-0.5" />
                )}
              </div>

              <div className="min-w-0">
                {/* Brskalnik + naprava */}
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  {ikona(s)}
                  <span className="font-medium text-neutral-800">
                    {brskalnik || (s.jeMobilen ? "Mobilna naprava" : "Namizni računalnik")}
                  </span>
                  <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${SEJA_STATUS_CLASS[s.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {SEJA_STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </div>

                {/* Meta podatki */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Prijava: {datumPrijave}
                  </span>
                  {s.status !== "active" && (
                    <span>Zadnja aktivnost: {datumAktivnosti}</span>
                  )}
                  {s.ip && <span className="font-mono">{s.ip}</span>}
                  {lokacija && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{lokacija}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Prekini (samo aktivne) */}
            {s.status === "active" && (
              <div className="shrink-0">
                {revokeConfirm === s.sessionId ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2"
                      disabled={isRevoking}
                      onClick={() => revokeMutation.mutate(s.sessionId)}
                    >
                      {isRevoking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Prekini"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                      onClick={() => setRevokeConfirm(null)}>Ne</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost"
                    className="h-6 text-[10px] px-2 gap-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setRevokeConfirm(s.sessionId)}
                  >
                    <LogOut className="h-3 w-3" /> Prekini
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Uporabniki tab ────────────────────────────────────────────────────────────

function UporabnikiAdminTab() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const users = data?.users ?? [];

  const [banConfirm, setBanConfirm] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<string | null>(null);

  const banMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch(`/api/admin/users/${clerkUserId}/ban`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setBanConfirm(null); },
  });
  const unbanMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch(`/api/admin/users/${clerkUserId}/unban`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

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
            // imaAktivnoSejo = ima vsaj eno aktivno Clerk sejo (zanesljiv vir)
            // jeOnline kot rezerva, če bi bili podatki o seji nedostopni
            const online = u.imaAktivnoSejo || jeOnline(u.lastActiveAt);
            const isBanning = banMutation.isPending && banConfirm === u.clerkUserId;
            const isUnbanning = unbanMutation.isPending;
            return (
              <div key={u.clerkUserId} className={`p-4 ${u.banned ? "bg-red-50/40" : !hasAccess ? "bg-amber-50/50" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Status pill */}
                    {u.banned ? (
                      <span className="inline-flex items-center gap-1.5 shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700 border border-red-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                        Blokiran
                      </span>
                    ) : online ? (
                      <span className="inline-flex items-center gap-1.5 shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">
                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                        </span>
                        Aktiven
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                        Neaktiven
                      </span>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium leading-tight ${u.banned ? "text-red-700" : "text-neutral-900"}`}>{displayName}</p>
                      </div>
                      {displayName !== u.email && (
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {u.banned ? "Prijava blokirana" : online ? "Pravkar aktiven" : zadnjaAktivnost(u.lastActiveAt)}
                      </p>
                    </div>
                  </div>

                  {/* Akcije desno */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!hasAccess && !u.banned && !u.isSuperAdmin && (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Čaka na dostop
                      </span>
                    )}
                    {u.isSuperAdmin ? (
                      <span className="text-xs text-muted-foreground/60 italic">Super admin</span>
                    ) : u.banned ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
                        disabled={isUnbanning}
                        onClick={() => unbanMutation.mutate(u.clerkUserId)}
                      >
                        {isUnbanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
                        Odblokiraj
                      </Button>
                    ) : banConfirm === u.clerkUserId ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-destructive">Res blokiraj?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          disabled={isBanning}
                          onClick={() => banMutation.mutate(u.clerkUserId)}
                        >
                          {isBanning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Da"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBanConfirm(null)}>Ne</Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setBanConfirm(u.clerkUserId)}
                      >
                        <Ban className="h-3 w-3" /> Blokiraj
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pl-4">
                  {hasAccess ? (
                    u.companies.map((c) => {
                      const isPos = c.sistem === "pos";
                      const isOs = c.sistem === "os";
                      const roleLabel = isPos
                        ? (POS_VLOGA_LABELS[c.role] ?? c.role)
                        : isOs
                        ? (OS_VLOGA_LABELS[c.role] ?? c.role)
                        : (ROLE_LABELS[c.role] ?? c.role);
                      const colorClass = isPos
                        ? (POS_VLOGA_COLORS[c.role] ?? "bg-amber-100 text-amber-800 border-amber-200")
                        : isOs
                        ? (OS_VLOGA_COLORS[c.role] ?? "bg-emerald-100 text-emerald-800 border-emerald-200")
                        : "bg-blue-50 text-blue-800 border-blue-200";
                      const sistemLabel = isPos ? "POS" : isOs ? "OS" : "Glavna knjiga";
                      return (
                        <Badge key={`${c.sistem}-${c.companyId}`} variant="outline" className={`text-xs gap-1 ${colorClass} ${u.banned ? "opacity-50" : ""}`}>
                          <Building2 className="h-3 w-3" />
                          {c.naziv}
                          <span className="opacity-60">·</span>
                          <span className="font-normal opacity-75">{sistemLabel}</span>
                          <span className="opacity-40">·</span>
                          {roleLabel}
                        </Badge>
                      );
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground">Uporabnik nima dostopa do nobenega podjetja.</p>
                  )}
                </div>

                {/* Zgodovina sej — razširi/skrči */}
                <div className="pl-4 pt-2">
                  <button
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() =>
                      setExpandedSessions(expandedSessions === u.clerkUserId ? null : u.clerkUserId)
                    }
                  >
                    <History className="h-3.5 w-3.5" />
                    {expandedSessions === u.clerkUserId ? "Skrij zgodovino sej" : "Prikaži zgodovino sej"}
                    {expandedSessions === u.clerkUserId
                      ? <ChevronDown className="h-3 w-3" />
                      : <ChevronRight className="h-3 w-3" />
                    }
                  </button>

                  {expandedSessions === u.clerkUserId && (
                    <div className="mt-2 pl-1">
                      <UserSejePanel
                        clerkUserId={u.clerkUserId}
                        onRevoke={() => {
                          qc.invalidateQueries({ queryKey: ["admin", "users"] });
                        }}
                      />
                    </div>
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

// ── Seje tab ──────────────────────────────────────────────────────────────────

function SejeAdminTab() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: () => apiFetch<{ sessions: AdminSession[] }>("/api/admin/sessions"),
    refetchInterval: 30_000, // osveži vsakih 30s
  });
  const sessions = data?.sessions ?? [];

  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/admin/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setRevokeConfirm(null);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {sessions.length} {sessions.length === 1 ? "aktivna seja" : sessions.length < 5 ? "aktivne seje" : "aktivnih sej"}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Osveži
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <MonitorX className="h-8 w-8 mx-auto mb-2 opacity-30" />
          Ni aktivnih sej.
        </div>
      ) : (
        <div className="divide-y border rounded-lg bg-card">
          {sessions.map((s) => {
            const displayName = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.email;
            const isRevoking = revokeMutation.isPending && revokeConfirm === s.sessionId;
            const expireDate = new Date(s.expireAt);
            const diffMin = Math.round((new Date(s.lastActiveAt).getTime() - Date.now()) / 60_000);
            const lastActive = zadnjaAktivnost(s.lastActiveAt);
            return (
              <div key={s.sessionId} className="p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {/* Zeleni kroglec — seja je aktivna */}
                  <div className="relative mt-1 shrink-0">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <div className="absolute inset-0 h-2 w-2 rounded-full bg-green-500 animate-ping opacity-50" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 leading-tight">{displayName}</p>
                    {displayName !== s.email && (
                      <p className="text-xs text-muted-foreground">{s.email}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Zadnja aktivnost: {lastActive}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Poteče: {expireDate.toLocaleDateString("sl-SI", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Prekini sejo */}
                <div className="shrink-0">
                  {revokeConfirm === s.sessionId ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-destructive whitespace-nowrap">Res prekini?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        disabled={isRevoking}
                        onClick={() => revokeMutation.mutate(s.sessionId)}
                      >
                        {isRevoking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Da"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRevokeConfirm(null)}>Ne</Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeConfirm(s.sessionId)}
                    >
                      <LogOut className="h-3 w-3" /> Prekini
                    </Button>
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

// ── Naprave tab ───────────────────────────────────────────────────────────────

function napravaIkona(d: AdminDevice) {
  if (d.jeMobilen) return <Smartphone className="h-4 w-4 shrink-0" />;
  if (d.naprava?.toLowerCase().includes("tablet")) return <Laptop className="h-4 w-4 shrink-0" />;
  return <Monitor className="h-4 w-4 shrink-0" />;
}

function napravaIme(d: AdminDevice): string {
  const b = d.brskalnik ?? "Neznan brskalnik";
  const v = d.brskalnikVerzija ? ` ${d.brskalnikVerzija.split(".")[0]}` : "";
  const n = d.jeMobilen ? "Mobilna naprava" : (d.naprava ?? "Namizni računalnik");
  return `${b}${v} · ${n}`;
}

function NapraveAdminTab() {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: () => apiFetch<{ devices: AdminDevice[] }>("/api/admin/devices"),
    refetchInterval: 60_000,
  });
  const devices = data?.devices ?? [];
  const [blockConfirm, setBlockConfirm] = useState<string | null>(null);

  const blockMutation = useMutation({
    mutationFn: (clientId: string) =>
      apiFetch(`/api/admin/clients/${encodeURIComponent(clientId)}/sessions`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "devices"] });
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
      setBlockConfirm(null);
    },
  });

  const aktivnih = devices.filter((d) => d.jeAktivna).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {devices.length} {devices.length === 1 ? "naprava" : devices.length < 5 ? "naprave" : "naprav"}
          {aktivnih > 0 && <span className="text-green-600 font-medium"> · {aktivnih} aktivnih</span>}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
          onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Osveži
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <Monitor className="h-8 w-8 mx-auto mb-2 opacity-30" />
          Ni zabeleženih naprav.
        </div>
      ) : (
        <div className="divide-y border rounded-lg bg-card">
          {devices.map((d) => {
            const isBlocking = blockMutation.isPending && blockConfirm === d.clientId;
            return (
              <div key={d.clientId} className={`p-4 ${d.jeAktivna ? "" : "opacity-70"}`}>
                <div className="flex items-start justify-between gap-3">
                  {/* Leva stran — naprava info */}
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Indikator aktivnosti */}
                    <div className="relative mt-0.5 shrink-0">
                      <div className={`h-2 w-2 rounded-full ${d.jeAktivna ? "bg-green-500" : "bg-gray-300"}`} />
                      {d.jeAktivna && (
                        <div className="absolute inset-0 h-2 w-2 rounded-full bg-green-500 animate-ping opacity-60" />
                      )}
                    </div>

                    <div className="min-w-0">
                      {/* Ime naprave */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {napravaIkona(d)}
                        <span className="text-sm font-medium text-neutral-900">{napravaIme(d)}</span>
                        {d.jeAktivna
                          ? <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 py-0 gap-1"><Wifi className="h-2.5 w-2.5" /> Aktivna</Badge>
                          : <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500 border-gray-200 py-0 gap-1"><WifiOff className="h-2.5 w-2.5" /> Neaktivna</Badge>
                        }
                      </div>

                      {/* Meta podatki */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                        {(d.mesto || d.drzava) && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {[d.mesto, d.drzava].filter(Boolean).join(", ")}
                          </span>
                        )}
                        {d.ip && (
                          <span className="text-xs text-muted-foreground font-mono">{d.ip}</span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {d.jeAktivna ? "Zdaj aktivna" : `Zadnja aktivnost: ${zadnjaAktivnost(d.zadnjaAktivnost)}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Prva prijava: {new Date(d.prvaPrijava).toLocaleDateString("sl-SI", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>

                      {/* Uporabniki na tej napravi */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {d.uporabniki.map((u) => {
                          const ime = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
                          return (
                            <Badge key={u.userId} variant="outline" className="text-xs gap-1 bg-blue-50 text-blue-800 border-blue-200">
                              <Users className="h-2.5 w-2.5" /> {ime}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Desna stran — akcija */}
                  <div className="shrink-0">
                    {d.jeAktivna && (
                      blockConfirm === d.clientId ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-destructive whitespace-nowrap">Res blokiraj?</span>
                          <Button size="sm" variant="destructive" className="h-7 text-xs"
                            disabled={isBlocking}
                            onClick={() => blockMutation.mutate(d.clientId)}>
                            {isBlocking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Da"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => setBlockConfirm(null)}>Ne</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost"
                          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setBlockConfirm(d.clientId)}>
                          <Ban className="h-3 w-3" /> Blokiraj napravo
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Diagnostics Section ───────────────────────────────────────────────────────

export function AdminDiagnosticsSection() {
  const [companyId, setCompanyId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [detailSelection, setDetailSelection] = useState<{ eventId: number; transferId: number | null } | null>(null);
  const [movementId, setMovementId] = useState<number | null>(null);

  const apiFetch = useApiFetch();

  const { data: companiesData } = useQuery({
    queryKey: ["admin", "companies"],
    queryFn: () => apiFetch<{ companies: AdminCompany[] }>("/api/admin/companies"),
  });
  const companies = companiesData?.companies ?? [];

  const { data: enoteData } = useQuery({
    queryKey: ["admin", "enote", companyId],
    queryFn: () => apiFetch<{ enote: Enota[] }>(`/api/admin/companies/${companyId}/enote`),
    enabled: !!companyId,
    staleTime: 0,
  });

  const enote = enoteData?.enote ?? [];

  const queryParams = { unitId: unitId !== "all" ? Number(unitId) : undefined };
  const { data: report, isLoading, isError, error } = useGetAdminEventTransferDiagnostics(
    companyId,
    queryParams,
    { query: { enabled: !!companyId, queryKey: getGetAdminEventTransferDiagnosticsQueryKey(companyId, queryParams) } }
  );
  const {
    data: eventDetail,
    isLoading: isDetailLoading,
    isError: isDetailError,
  } = useGetAdminEventTransferDetail(
    companyId,
    detailSelection?.eventId ?? 0,
    {
      query: {
        enabled: !!companyId && detailSelection !== null,
        queryKey: getGetAdminEventTransferDetailQueryKey(companyId, detailSelection?.eventId ?? 0),
      },
    },
  );
  const {
    data: movementDetail,
    isLoading: isMovementLoading,
    isError: isMovementError,
  } = useGetAdminEventTransferMovementDetail(
    companyId,
    movementId ?? 0,
    {
      query: {
        enabled: Boolean(companyId) && movementId !== null,
        queryKey: getGetAdminEventTransferMovementDetailQueryKey(companyId, movementId ?? 0),
      },
    },
  );

  const filteredViolations = React.useMemo(() => {
    if (!report?.violations) return [];
    if (kindFilter === "all") return report.violations;
    return report.violations.filter(v => v.kind === kindFilter);
  }, [report, kindFilter]);

  const uniqueKinds = React.useMemo(() => {
    if (!report?.violations) return [];
    return Array.from(new Set(report.violations.map(v => v.kind)));
  }, [report]);

  const selectedCompany = companies.find(company => company.id === companyId);
  const selectedUnit = unitId === "all"
    ? null
    : enote.find(unit => unit.id === Number(unitId));
  const selectedFilterLabel = kindFilter === "all"
    ? "Vse vrste"
    : VIOLATION_KIND_LABELS[kindFilter] ?? kindFilter;

  const downloadCsv = () => {
    if (!report || filteredViolations.length === 0 || !selectedCompany) return;
    const csv = buildEventTransferDiagnosticsCsv({
      report,
      violations: filteredViolations,
      companyName: selectedCompany.naziv,
      unitName: selectedUnit?.ime ?? "Vse enote",
      filterLabel: selectedFilterLabel,
      kindLabels: VIOLATION_KIND_LABELS,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = eventTransferDiagnosticsCsvFilename(selectedCompany.naziv, report.generatedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col bg-muted/10">
       <div className="p-4 border-b bg-background shrink-0 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium text-muted-foreground" htmlFor="diag-company">Podjetje:</Label>
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setUnitId("all"); setKindFilter("all"); setDetailSelection(null); setMovementId(null); }}>
              <SelectTrigger id="diag-company" className="h-8 w-64 text-xs" data-testid="select-diag-company">
                <SelectValue placeholder="Izberi podjetje..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id} data-testid={`option-company-${c.id}`}>
                    {c.naziv}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium text-muted-foreground" htmlFor="diag-unit">Enota:</Label>
             <Select
               value={unitId}
               onValueChange={(value) => {
                 setUnitId(value);
                 setKindFilter("all");
               }}
               disabled={!companyId}
             >
              <SelectTrigger id="diag-unit" className="h-8 w-48 text-xs" data-testid="select-diag-unit">
                <SelectValue placeholder="Vse enote" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-unit-all">Vse enote</SelectItem>
                {enote.map(e => (
                  <SelectItem key={e.id} value={String(e.id)} data-testid={`option-unit-${e.id}`}>
                    {e.ime}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-xs font-medium text-muted-foreground" htmlFor="diag-filter">Vrsta neskladja:</Label>
            <Select value={kindFilter} onValueChange={setKindFilter} disabled={!report || report.violations.length === 0}>
              <SelectTrigger id="diag-filter" className="h-8 w-64 text-xs" data-testid="select-diag-filter">
                <SelectValue placeholder="Vse vrste" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-filter-all">Vse vrste ({report?.violations.length ?? 0})</SelectItem>
                {uniqueKinds.map(kind => (
                  <SelectItem key={kind} value={kind} data-testid={`option-filter-${kind}`}>
                    {VIOLATION_KIND_LABELS[kind] || kind} ({report?.violations.filter(v => v.kind === kind).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge variant="outline" className="gap-1.5 text-xs" data-testid="status-diagnostics-read-only">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            Samo za pregled
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={downloadCsv}
            disabled={!report || filteredViolations.length === 0 || !selectedCompany}
            title={filteredViolations.length === 0 ? "Ni neskladij za prenos" : "Prenesi trenutno prikazana neskladja"}
            data-testid="button-download-diagnostics-csv"
          >
            <Download className="h-3.5 w-3.5" />
            Prenesi CSV
          </Button>
       </div>

       <div className="flex-1 p-6 relative min-h-[500px]">
         {!companyId ? (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
             <Building2 className="h-12 w-12 mb-4 opacity-20" />
             <p className="text-sm font-medium">Izberite podjetje za prikaz diagnostike zalog</p>
             <p className="text-xs mt-1">Pregled neskladij med dogodkovnimi prenosi in dejanskimi premiki.</p>
           </div>
         ) : isLoading ? (
           <div className="space-y-4 max-w-6xl mx-auto">
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               <Skeleton className="h-24 w-full" />
               <Skeleton className="h-24 w-full" />
               <Skeleton className="h-24 w-full" />
               <Skeleton className="h-24 w-full" />
             </div>
             <Skeleton className="h-32 w-full" />
             <Skeleton className="h-32 w-full" />
           </div>
         ) : isError ? (
           <Alert variant="destructive" className="max-w-2xl mx-auto mt-8">
             <AlertCircle className="h-4 w-4" />
             <AlertDescription>
               Napaka pri nalaganju diagnostike: {(error as Error)?.message || "Neznana napaka"}
             </AlertDescription>
           </Alert>
         ) : report ? (
           <div className="max-w-6xl mx-auto space-y-6 pb-12">
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               <Card>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-sm font-medium text-muted-foreground">Preverjeni prenosi</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className="text-2xl font-bold font-mono" data-testid="text-checked-transfers">{report.checked.transfers}</div>
                 </CardContent>
               </Card>
               <Card>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-sm font-medium text-muted-foreground">Preverjene vrstice</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className="text-2xl font-bold font-mono" data-testid="text-checked-lines">{report.checked.lines}</div>
                 </CardContent>
               </Card>
               <Card>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-sm font-medium text-muted-foreground">Preverjeni premiki</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className="text-2xl font-bold font-mono" data-testid="text-checked-movements">{report.checked.movements}</div>
                 </CardContent>
               </Card>
               <Card className={report.violationCount > 0 ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" : "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20"}>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-sm font-medium text-muted-foreground">Zaznana neskladja</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className={`text-2xl font-bold font-mono ${report.violationCount > 0 ? "text-amber-600 dark:text-amber-500" : "text-emerald-600 dark:text-emerald-500"}`} data-testid="text-violation-count">
                     {report.violationCount}
                   </div>
                 </CardContent>
               </Card>
             </div>

             {report.violations.length === 0 ? (
               <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-background border-dashed">
                 <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                   <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                 </div>
                 <h3 className="text-lg font-medium text-foreground mb-1">Stanje je optimalno</h3>
                 <p className="text-sm text-muted-foreground max-w-md">Ni bilo zaznanih nobenih neskladij med dogodki, prenosi zalog in dejanskimi blagovnimi premiki.</p>
               </div>
             ) : (
               <div className="space-y-4">
                 <h3 className="text-sm font-medium tracking-tight border-b pb-2">Seznam neskladij ({filteredViolations.length})</h3>
                 <div className="grid grid-cols-1 gap-4">
                   {filteredViolations.map((v, idx) => (
                      <ViolationCard
                        key={`${v.kind}-${v.transferId}-${idx}`}
                        v={v}
                        idx={idx}
                        onOpenDetail={(eventId, transferId) => setDetailSelection({ eventId, transferId })}
                         onOpenMovement={setMovementId}
                      />
                   ))}
                 </div>
               </div>
             )}
           </div>
         ) : null}
       </div>
       <EventTransferDetailDialog
         detail={eventDetail}
         selectedTransferId={detailSelection?.transferId ?? null}
         open={detailSelection !== null}
         isLoading={isDetailLoading}
         isError={isDetailError}
         onOpenChange={(open) => {
           if (!open) setDetailSelection(null);
         }}
          onOpenMovement={setMovementId}
        />
        <MovementAuditDialog
          detail={movementDetail}
          open={movementId !== null}
          isLoading={isMovementLoading}
          isError={isMovementError}
          onOpenChange={(movementOpen) => {
            if (!movementOpen) setMovementId(null);
          }}
       />
    </div>
  );
}

function ViolationCard({
  v,
  idx,
  onOpenDetail,
  onOpenMovement,
}: {
  v: EventTransferDiagnosticViolation;
  idx: number;
  onOpenDetail: (eventId: number, transferId: number | null) => void;
  onOpenMovement: (movementId: number) => void;
}) {
  const eventBadge = (
    <Badge variant="outline" className="text-xs bg-blue-50/50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
      Dogodek: {v.eventName ? `${v.eventName} · ` : ""}<span className="font-mono">#{v.eventId}</span>
    </Badge>
  );
  const transferBadge = (
    <Badge variant="outline" className="text-xs font-mono bg-purple-50/50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400">
      Prenos: {v.transferId}
    </Badge>
  );

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-md bg-background shadow-sm" data-testid={`card-violation-${idx}`}>
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-amber-500 shrink-0" />
            {VIOLATION_KIND_LABELS[v.kind] || v.kind}
          </h4>
          <p className="text-sm text-muted-foreground mt-1" data-testid={`text-violation-detail-${idx}`}>{v.detail}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap md:justify-end">
          {v.eventId && (
            v.eventExists ? (
              <button
                type="button"
                className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-80"
                aria-label={`Odpri podrobnosti dogodka ${v.eventName ?? v.eventId}`}
                data-testid={`button-event-detail-${idx}`}
                onClick={() => onOpenDetail(v.eventId!, null)}
              >
                {eventBadge}
              </button>
            ) : eventBadge
          )}
          {v.transferId && (
            v.transferExists && v.eventExists && v.eventId ? (
              <button
                type="button"
                className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-80"
                aria-label={`Odpri podrobnosti prenosa ${v.transferId}`}
                data-testid={`button-transfer-detail-${idx}`}
                onClick={() => onOpenDetail(v.eventId!, v.transferId)}
              >
                {transferBadge}
              </button>
            ) : transferBadge
          )}
          {v.direction && <Badge variant="secondary" className="text-xs">{DIRECTION_LABELS[v.direction] || v.direction}</Badge>}
          {v.status && <Badge variant="secondary" className="text-xs">{STATUS_LABELS[v.status] || v.status}</Badge>}
          {v.sourceUnitId !== null && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Iz enote: {v.sourceUnitName ? `${v.sourceUnitName} · ` : ""}<span className="font-mono">#{v.sourceUnitId}</span>
            </Badge>
          )}
          {v.targetUnitId !== null && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              V enoto: {v.targetUnitName ? `${v.targetUnitName} · ` : ""}<span className="font-mono">#{v.targetUnitId}</span>
            </Badge>
          )}
          {v.lineId != null && <Badge variant="outline" className="text-xs font-mono text-muted-foreground">Vrstica: {v.lineId}</Badge>}
          {v.movementId != null && (
            <button
              type="button"
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-80"
              aria-label={`Odpri revizijsko sled premika ${v.movementId}`}
              data-testid={`button-movement-detail-${idx}`}
              onClick={() => onOpenMovement(v.movementId!)}
            >
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground">Premik: {v.movementId}</Badge>
            </button>
          )}
        </div>
      </div>

      {(v.expected || v.actual) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2 border-t pt-3">
          {v.expected ? (
             <div className="rounded-md bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800 p-3">
               <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Pričakovan premik</div>
               <MovementDetails mov={v.expected} />
             </div>
          ) : (
             <div className="rounded-md bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800 p-3 flex items-center justify-center text-xs text-muted-foreground italic h-full min-h-[100px]">
               Ni pričakovanega premika
             </div>
           )}

          {v.actual ? (
             <div className={`rounded-md border p-3 ${v.differences && v.differences.length > 0 ? "bg-amber-50/30 border-amber-200/50 dark:bg-amber-950/10 dark:border-amber-900/50" : "bg-slate-50/50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800"}`}>
               <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700/70 dark:text-amber-500/70 mb-3">Dejanski premik</div>
               <MovementDetails mov={v.actual} differences={v.differences} />
             </div>
          ) : (
             <div className={`rounded-md border p-3 flex items-center justify-center text-xs italic h-full min-h-[100px] ${v.expected ? "bg-amber-50/30 border-amber-200/50 text-amber-700/70 dark:bg-amber-950/10 dark:border-amber-900/50 dark:text-amber-500/70" : "bg-slate-50/50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800 text-muted-foreground"}`}>
               Ni dejanskega premika
             </div>
          )}
        </div>
      )}
    </div>
  );
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  festival: "Festival",
  wedding: "Poroka",
  catering: "Catering",
  celebration: "Praznovanje",
  other: "Drugo",
};

function formatDiagnosticDate(value: string) {
  return new Date(value).toLocaleString("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EventTransferDetailDialog({
  detail,
  selectedTransferId,
  open,
  isLoading,
  isError,
  onOpenChange,
  onOpenMovement,
}: {
  detail: EventTransferDetail | undefined;
  selectedTransferId: number | null;
  open: boolean;
  isLoading: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenMovement: (movementId: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" data-testid="dialog-event-transfer-detail">
        <DialogHeader>
          <DialogTitle>
            {detail ? `${detail.event.name} · #${detail.event.id}` : "Podrobnosti dogodka"}
          </DialogTitle>
          <DialogDescription>
            Samo za pregled — podatkov v tem oknu ni mogoče spreminjati.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4" data-testid="event-detail-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="destructive" data-testid="event-detail-error">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Podrobnosti dogodka niso več dosegljive. Dogodek je bil morda odstranjen.</AlertDescription>
          </Alert>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Vrsta</span><div className="font-medium">{EVENT_TYPE_LABELS[detail.event.type] ?? detail.event.type}</div></div>
              <div><span className="text-muted-foreground">Status</span><div className="font-medium">{STATUS_LABELS[detail.event.status] ?? detail.event.status}</div></div>
              <div><span className="text-muted-foreground">Lokacija</span><div className="font-medium">{detail.event.location}</div></div>
              <div><span className="text-muted-foreground">Matična enota</span><div className="font-medium">{detail.event.unitName} · #{detail.event.unitId}</div></div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Začetek</span><div className="font-medium">{formatDiagnosticDate(detail.event.startsAt)}</div></div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Konec</span><div className="font-medium">{formatDiagnosticDate(detail.event.endsAt)}</div></div>
              {detail.event.customerName && <div className="sm:col-span-2"><span className="text-muted-foreground">Naročnik</span><div className="font-medium">{detail.event.customerName}</div></div>}
              {detail.event.notes && <div className="sm:col-span-2"><span className="text-muted-foreground">Opomba</span><div className="font-medium whitespace-pre-wrap">{detail.event.notes}</div></div>}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Prenosi ({detail.transfers.length})</h3>
              {detail.transfers.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Dogodek nima prenosov zaloge.</div>
              ) : detail.transfers.map(transfer => (
                <div
                  key={transfer.id}
                  className={`rounded-md border p-4 space-y-3 ${transfer.id === selectedTransferId ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/20" : "bg-background"}`}
                  data-testid={`event-detail-transfer-${transfer.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Prenos #{transfer.id}</span>
                    <Badge variant="secondary">{DIRECTION_LABELS[transfer.direction] ?? transfer.direction}</Badge>
                    <Badge variant="secondary">{STATUS_LABELS[transfer.status] ?? transfer.status}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{formatDiagnosticDate(transfer.createdAt)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {transfer.sourceUnitName} · #{transfer.sourceUnitId} → {transfer.targetUnitName} · #{transfer.targetUnitId}
                    {transfer.returnOfId && <> · vračilo za prenos #{transfer.returnOfId}</>}
                  </div>
                  {transfer.lines.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">Prenos nima vrstic.</div>
                  ) : (
                    <div className="space-y-3">
                      {transfer.lines.map(line => (
                        <div key={line.id} className="rounded-md border bg-muted/10 p-3 space-y-3" data-testid={`event-detail-line-${line.id}`}>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span className="font-semibold">Vrstica #{line.id}</span>
                            <span>{line.sourceArticleName} · <span className="font-mono">#{line.sourceArticleId}</span></span>
                            <span aria-hidden="true">→</span>
                            <span>{line.targetArticleName} · <span className="font-mono">#{line.targetArticleId}</span></span>
                            <span className="ml-auto font-mono">Kol. {line.quantity} · Cena {line.unitCost} · Vrednost {line.value}</span>
                          </div>
                          {line.movements.length === 0 ? (
                            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                              Za vrstico ni pričakovanih primerjav pri statusu »{STATUS_LABELS[transfer.status] ?? transfer.status}«.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              {line.movements.map((movement, movementIndex) => (
                                <MovementComparison
                                  key={`${movement.expected.type}-${movementIndex}`}
                                  comparison={movement}
                                  onOpenMovement={onOpenMovement}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {transfer.unexpectedMovements.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50/40 p-3 space-y-3 dark:border-red-900/50 dark:bg-red-950/10" data-testid={`unexpected-movements-${transfer.id}`}>
                      <div className="text-xs font-semibold text-red-700 dark:text-red-400">
                        Nepričakovani dodatni premiki ({transfer.unexpectedMovements.length})
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {transfer.unexpectedMovements.map(movement => (
                          <div key={movement.movementId} className="rounded-md border bg-background p-3">
                            <div className="text-[10px] uppercase tracking-wider text-red-600 mb-2">
                              <button
                                type="button"
                                className="font-mono underline underline-offset-2 hover:text-red-800 dark:hover:text-red-300"
                                onClick={() => onOpenMovement(movement.movementId)}
                              >
                                Premik #{movement.movementId}
                              </button>
                              {" · "}{movement.reason === "extra" ? "dodaten premik" : "nepričakovan glede na status"}
                            </div>
                            <MovementDetails mov={movement.actual} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MovementComparison({
  comparison,
  onOpenMovement,
}: {
  comparison: EventTransferDetail["transfers"][number]["lines"][number]["movements"][number];
  onOpenMovement: (movementId: number) => void;
}) {
  const stateLabel = comparison.state === "matched"
    ? "Usklajeno"
    : comparison.state === "missing"
      ? "Premik manjka"
      : "Vrednosti se razlikujejo";
  const stateClass = comparison.state === "matched"
    ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/10"
    : "border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/10";

  return (
    <div className={`rounded-md border p-3 space-y-3 ${stateClass}`} data-testid={`movement-comparison-${comparison.state}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span>{comparison.expected.type.endsWith("_out") ? "Izhodni premik" : "Vhodni premik"}</span>
        <Badge variant={comparison.state === "matched" ? "secondary" : "destructive"}>
          {stateLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-md border bg-background/70 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Pričakovano</div>
          <MovementDetails mov={comparison.expected} />
        </div>
        {comparison.actual ? (
          <div className="rounded-md border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Dejansko ·{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2 hover:text-foreground"
                onClick={() => onOpenMovement(comparison.movementId!)}
              >
                premik #{comparison.movementId}
              </button>
            </div>
            <MovementDetails mov={comparison.actual} differences={comparison.differences} />
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background/70 p-3 flex items-center justify-center text-xs text-red-600 dark:text-red-400">
            Povezanega dejanskega premika ni.
          </div>
        )}
      </div>
    </div>
  );
}

function MovementAuditDialog({
  detail,
  open,
  isLoading,
  isError,
  onOpenChange,
}: {
  detail: EventTransferMovementDetail | undefined;
  open: boolean;
  isLoading: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-movement-audit">
        <DialogHeader>
          <DialogTitle>{detail ? `Premik zaloge #${detail.id}` : "Revizijska sled premika"}</DialogTitle>
          <DialogDescription>
            Samo za pregled — prikazani so le metapodatki, ki jih sistem dejansko hrani.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3 py-4" data-testid="movement-audit-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="destructive" data-testid="movement-audit-error">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Premik ne obstaja več ali ne pripada izbranemu podjetju.</AlertDescription>
          </Alert>
        ) : detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <AuditField label="Čas nastanka" value={formatDiagnosticDate(detail.createdAt)} />
              <AuditField label="Tip premika" value={detail.type} mono />
              <AuditField label="Artikel" value={`${detail.articleName} · #${detail.articleId}`} />
              <AuditField label="Enota" value={`${detail.unitName} · #${detail.unitId}`} />
              <AuditField label="Količina" value={detail.quantity} mono />
              <AuditField label="Nabavna cena" value={detail.unitCost ?? "Ni zabeležena"} mono />
              <AuditField label="Vrednost" value={detail.value ?? "Ni zabeležena"} mono />
              <AuditField label="Referenca" value={detail.referenceId == null ? "Ni povezave" : `#${detail.referenceId}`} mono />
              <AuditField label="Namenski prenos" value={detail.eventTransferId == null ? "Ni povezave" : `#${detail.eventTransferId}`} mono />
              <AuditField
                label="Neposredni akter premika"
                value={detail.actorSnapshot ?? "Pri tem premiku ni dokazljivo zabeležen"}
                mono={detail.actorSnapshot !== null}
              />
              <AuditField
                label="Izvor premika"
                value={detail.sourceSnapshot ?? "Pri starejšem premiku ni zabeležen"}
                mono={detail.sourceSnapshot !== null}
              />
              <AuditField
                label="Povezani dogodek"
                value={detail.eventId == null ? "Ni veljavne povezave" : `${detail.eventName ?? "Dogodek"} · #${detail.eventId}`}
              />
              <AuditField
                label="Status prenosa"
                value={detail.transferStatus == null ? "Ni veljavne povezave" : (STATUS_LABELS[detail.transferStatus] ?? detail.transferStatus)}
              />
              <AuditField
                label="Smer prenosa"
                value={detail.transferDirection == null ? "Ni veljavne povezave" : (DIRECTION_LABELS[detail.transferDirection] ?? detail.transferDirection)}
              />
              <AuditField label="Izvor povezanega prenosa" value={detail.transferCreatedBy ?? "Ni zabeležen"} mono />
            </div>
            {detail.note && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground mb-1">Opomba premika</div>
                <div className="whitespace-pre-wrap">{detail.note}</div>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AuditField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`font-medium break-words ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function MovementDetails({
  mov,
  differences,
}: {
  mov: EventTransferDiagnosticMovement;
  differences?: EventTransferDiagnosticViolation["differences"];
}) {
  type DifferenceField = NonNullable<EventTransferDiagnosticViolation["differences"]>[number];
  const isDiff = (field: DifferenceField) => differences?.includes(field);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs items-center">
      <div className="text-muted-foreground">Artikel</div>
      <div className="text-right text-foreground">
        {mov.articleName && <span>{mov.articleName} · </span>}
        <span className="font-mono">#{mov.articleId}</span>
      </div>

      <div className="text-muted-foreground">Tip premika</div>
      <div className="text-foreground">{mov.type}</div>

      <div className="text-muted-foreground">Količina</div>
      <div className={`font-mono ${isDiff('quantity') ? 'text-red-600 font-bold dark:text-red-400' : 'text-foreground'}`}>
        {mov.quantity}
      </div>

      {mov.unitCost !== null && (
        <>
          <div className="text-muted-foreground">Nabavna cena</div>
          <div className={`font-mono ${isDiff('unitCost') ? 'text-red-600 font-bold dark:text-red-400' : 'text-foreground'}`}>
            {mov.unitCost}
          </div>
        </>
      )}

      {mov.value !== null && (
        <>
          <div className="text-muted-foreground">Skupna vrednost</div>
          <div className={`font-mono ${isDiff('value') ? 'text-red-600 font-bold dark:text-red-400' : 'text-foreground'}`}>
            {mov.value}
          </div>
        </>
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
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="podjetja" className="gap-2">
            <Building2 className="h-3.5 w-3.5" /> Podjetja
          </TabsTrigger>
          <TabsTrigger value="uporabniki" className="gap-2">
            <Users className="h-3.5 w-3.5" /> Uporabniki
          </TabsTrigger>
          <TabsTrigger value="seje" className="gap-2">
            <MonitorX className="h-3.5 w-3.5" /> Aktivne seje
          </TabsTrigger>
          <TabsTrigger value="naprave" className="gap-2">
            <Monitor className="h-3.5 w-3.5" /> Naprave
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-2" data-testid="tab-diagnostics">
            <Package className="h-3.5 w-3.5" /> Diagnostika zalog
          </TabsTrigger>
        </TabsList>
        <TabsContent value="podjetja" className="mt-0"><PodjetjaTab /></TabsContent>
        <TabsContent value="uporabniki" className="mt-0"><UporabnikiAdminTab /></TabsContent>
        <TabsContent value="seje" className="mt-0"><SejeAdminTab /></TabsContent>
        <TabsContent value="naprave" className="mt-0"><NapraveAdminTab /></TabsContent>
        <TabsContent value="diagnostics" className="mt-0 min-h-[600px] border rounded-md overflow-hidden bg-background">
          <AdminDiagnosticsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
