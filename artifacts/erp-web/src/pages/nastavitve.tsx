import React, { useState, useEffect } from "react";
import { Building2, Users, Save, UserPlus, AlertCircle, CheckCircle2, Loader2, Trash2, Plus, X, RefreshCw, Database, Store } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useGetCompany, useGetMe, useAssignRole } from "@workspace/api-client-react";
import type { CompanyWithRole, RoleAssignment } from "@workspace/api-client-react";

// Lightweight authenticated fetch — vključi Clerk JWT iz cookie/header,
// ki ga Vite proxy posreduje API strežniku.
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyRoleEntry {
  clerkUserId: string;
  role: "owner" | "accountant" | "viewer";
  createdAt: string;
}

interface TrrEntry { iban: string; bic: string; }

interface UpdateCompanyBody {
  naziv?: string;
  kratekNaziv?: string | null;
  naslov?: string | null;
  ulica?: string | null;
  postnaStevika?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  maticnaStevilka?: string | null;
  idZaDdv?: string | null;
  zavezanecDdv?: boolean | null;
  trr?: TrrEntry[] | null;
  email?: string | null;
  telefon?: string | null;
  www?: string | null;
  eRacunPrejemnik?: boolean | null;
  eRacunOmrezje?: string | null;
  eRacunEmail?: string | null;
  eRacunNaslov?: string | null;
  eRacunSifraPu?: string | null;
  eRacunBic?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  owner: "Lastnik",
  accountant: "Računovodja",
  viewer: "Pregledovalec",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-violet-100 text-violet-800 border-violet-200",
  accountant: "bg-blue-100 text-blue-800 border-blue-200",
  viewer: "bg-gray-100 text-gray-700 border-gray-200",
};

// ── Podatki o podjetju ────────────────────────────────────────────────────────

type AnyCompany = Record<string, unknown>;

function PodatkiTab({ companyId, isOwner }: { companyId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const { setActiveCompany, activeCompany } = useCompany();

  const { data, isLoading } = useGetCompany(companyId);

  const emptyForm = {
    naziv: "", kratekNaziv: "", naslov: "", ulica: "", postnaStevika: "", kraj: "",
    drzava: "", kodaDrzave: "", maticnaStevilka: "", idZaDdv: "",
    zavezanecDdv: false,
    email: "", telefon: "", www: "",
    eRacunPrejemnik: false, eRacunOmrezje: "", eRacunEmail: "",
    eRacunNaslov: "", eRacunSifraPu: "", eRacunBic: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [trr, setTrr] = useState<TrrEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [osvezujem, setOsvezujem] = useState(false);
  const [osvezaNapaka, setOsvezaNapaka] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      const d = data as AnyCompany;
      setForm({
        naziv: (d.naziv as string) ?? "",
        kratekNaziv: (d.kratekNaziv as string) ?? "",
        naslov: (d.naslov as string) ?? "",
        ulica: (d.ulica as string) ?? "",
        postnaStevika: (d.postnaStevika as string) ?? "",
        kraj: (d.kraj as string) ?? "",
        drzava: (d.drzava as string) ?? "",
        kodaDrzave: (d.kodaDrzave as string) ?? "",
        maticnaStevilka: (d.maticnaStevilka as string) ?? "",
        idZaDdv: (d.idZaDdv as string) ?? "",
        zavezanecDdv: (d.zavezanecDdv as boolean) ?? false,
        email: (d.email as string) ?? "",
        telefon: (d.telefon as string) ?? "",
        www: (d.www as string) ?? "",
        eRacunPrejemnik: (d.eRacunPrejemnik as boolean) ?? false,
        eRacunOmrezje: (d.eRacunOmrezje as string) ?? "",
        eRacunEmail: (d.eRacunEmail as string) ?? "",
        eRacunNaslov: (d.eRacunNaslov as string) ?? "",
        eRacunSifraPu: (d.eRacunSifraPu as string) ?? "",
        eRacunBic: (d.eRacunBic as string) ?? "",
      });
      setTrr((d.trr as TrrEntry[]) ?? []);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (body: UpdateCompanyBody) =>
      apiFetch<CompanyWithRole>(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["companies", companyId] });
      if (activeCompany?.id === companyId) {
        setActiveCompany({ ...activeCompany, ...updated });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  async function handleOsvezi() {
    setOsvezujem(true);
    setOsvezaNapaka(null);
    try {
      const updated = await apiFetch<AnyCompany>(`/api/companies/${companyId}/osvezi`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["companies", companyId] });
      if (activeCompany?.id === companyId) {
        setActiveCompany({ ...activeCompany, ...updated } as typeof activeCompany);
      }
      setForm({
        naziv: (updated.naziv as string) ?? "",
        kratekNaziv: (updated.kratekNaziv as string) ?? "",
        naslov: (updated.naslov as string) ?? "",
        ulica: (updated.ulica as string) ?? "",
        postnaStevika: (updated.postnaStevika as string) ?? "",
        kraj: (updated.kraj as string) ?? "",
        drzava: (updated.drzava as string) ?? "",
        kodaDrzave: (updated.kodaDrzave as string) ?? "",
        maticnaStevilka: (updated.maticnaStevilka as string) ?? "",
        idZaDdv: (updated.idZaDdv as string) ?? "",
        zavezanecDdv: (updated.zavezanecDdv as boolean) ?? false,
        email: (updated.email as string) ?? "",
        telefon: (updated.telefon as string) ?? "",
        www: (updated.www as string) ?? "",
        eRacunPrejemnik: (updated.eRacunPrejemnik as boolean) ?? false,
        eRacunOmrezje: (updated.eRacunOmrezje as string) ?? "",
        eRacunEmail: (updated.eRacunEmail as string) ?? "",
        eRacunNaslov: (updated.eRacunNaslov as string) ?? "",
        eRacunSifraPu: (updated.eRacunSifraPu as string) ?? "",
        eRacunBic: (updated.eRacunBic as string) ?? "",
      });
      setTrr((updated.trr as TrrEntry[]) ?? []);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setOsvezaNapaka(err instanceof Error ? err.message : "Napaka pri osveževanju");
    } finally {
      setOsvezujem(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
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
      eRacunPrejemnik: form.eRacunPrejemnik,
      eRacunOmrezje: form.eRacunOmrezje || null,
      eRacunEmail: form.eRacunEmail || null,
      eRacunNaslov: form.eRacunNaslov || null,
      eRacunSifraPu: form.eRacunSifraPu || null,
      eRacunBic: form.eRacunBic || null,
    });
  }

  function addTrr() { setTrr(t => [...t, { iban: "", bic: "" }]); }
  function removeTrr(i: number) { setTrr(t => t.filter((_, idx) => idx !== i)); }
  function updateTrr(i: number, field: keyof TrrEntry, val: string) {
    setTrr(t => t.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      {/* Gumb za osvežitev */}
      {isOwner && (
        <div className="flex items-center justify-between pb-1 border-b">
          <p className="text-xs text-muted-foreground">Podatki se samodejno dopolnijo iz registrov Inetis, UJP in AJPES.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleOsvezi()} disabled={osvezujem} className="gap-1.5 shrink-0">
            {osvezujem ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Osveži iz registra
          </Button>
        </div>
      )}

      {/* Identifikacija */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identifikacija</p>
        <div className="space-y-1.5">
          <Label htmlFor="davcna">Davčna številka</Label>
          <Input id="davcna" value={data?.podjetjeDavcna ?? ""} disabled className="bg-muted text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Davčna številka je nespremenljiva.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label htmlFor="naziv">Polni naziv *</Label>
            <Input id="naziv" value={form.naziv} onChange={(e) => setForm((f) => ({ ...f, naziv: e.target.value }))} disabled={!isOwner} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kratekNaziv">Kratek naziv</Label>
            <Input id="kratekNaziv" value={form.kratekNaziv} onChange={(e) => setForm((f) => ({ ...f, kratekNaziv: e.target.value }))} disabled={!isOwner} placeholder="ABC d.o.o." />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="maticna">Matična številka</Label>
            <Input id="maticna" value={form.maticnaStevilka} onChange={(e) => setForm((f) => ({ ...f, maticnaStevilka: e.target.value }))} disabled={!isOwner} placeholder="1234567000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idZaDdv">ID za DDV</Label>
            <Input id="idZaDdv" value={form.idZaDdv} onChange={(e) => setForm((f) => ({ ...f, idZaDdv: e.target.value }))} disabled={!isOwner} placeholder="SI12345678" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="zavezanecDdv"
            checked={form.zavezanecDdv}
            onChange={(e) => setForm((f) => ({ ...f, zavezanecDdv: e.target.checked }))}
            disabled={!isOwner}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="zavezanecDdv" className="font-normal cursor-pointer">Zavezanec za DDV</Label>
        </div>
      </div>

      {/* Naslov */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Naslov</p>
        <div className="space-y-1.5">
          <Label htmlFor="ulica">Ulica in hišna številka</Label>
          <Input id="ulica" value={form.ulica} onChange={(e) => setForm((f) => ({ ...f, ulica: e.target.value }))} disabled={!isOwner} placeholder="Slovenska cesta 1" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="postna">Poštna</Label>
            <Input id="postna" value={form.postnaStevika} onChange={(e) => setForm((f) => ({ ...f, postnaStevika: e.target.value }))} disabled={!isOwner} placeholder="1000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kraj">Kraj</Label>
            <Input id="kraj" value={form.kraj} onChange={(e) => setForm((f) => ({ ...f, kraj: e.target.value }))} disabled={!isOwner} placeholder="Ljubljana" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="drzava">Država</Label>
            <Input id="drzava" value={form.drzava} onChange={(e) => setForm((f) => ({ ...f, drzava: e.target.value }))} disabled={!isOwner} placeholder="Slovenija" />
          </div>
        </div>
      </div>

      {/* Kontakt */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kontakt</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={!isOwner} placeholder="info@podjetje.si" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telefon">Telefon</Label>
            <Input id="telefon" value={form.telefon} onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))} disabled={!isOwner} placeholder="+386 1 234 56 78" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="www">Spletna stran</Label>
          <Input id="www" value={form.www} onChange={(e) => setForm((f) => ({ ...f, www: e.target.value }))} disabled={!isOwner} placeholder="https://www.podjetje.si" />
        </div>
      </div>

      {/* Bančni računi (TRR) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label>Bančni računi (TRR)</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Prvi TRR se samodejno prenese v POS kot IBAN/BIC za negotovinsko plačilo.
            </p>
          </div>
          {isOwner && (
            <Button type="button" variant="outline" size="sm" onClick={addTrr} className="gap-1.5 h-7 text-xs">
              <Plus className="h-3.5 w-3.5" /> Dodaj TRR
            </Button>
          )}
        </div>
        {trr.length === 0 && <p className="text-xs text-muted-foreground italic">Ni dodanih bančnih računov.</p>}
        {trr.map((entry, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-1.5">
              <Input value={entry.iban} onChange={(e) => updateTrr(i, "iban", e.target.value.toUpperCase())} disabled={!isOwner} placeholder="SI56 1234 5678 9012 345" />
            </div>
            <div className="w-36 space-y-1.5">
              <Input value={entry.bic} onChange={(e) => updateTrr(i, "bic", e.target.value.toUpperCase())} disabled={!isOwner} placeholder="BSLJSI2X" />
            </div>
            {isOwner && (
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeTrr(i)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {trr.length > 0 && (
          <div className="flex gap-2 px-0.5">
            <p className="flex-1 text-[10px] text-muted-foreground">IBAN</p>
            <p className="w-36 text-[10px] text-muted-foreground">BIC / SWIFT</p>
            {isOwner && <div className="w-9" />}
          </div>
        )}
      </div>

      {/* e-Račun nastavitve */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">e-Račun</p>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="eRacunPrejemnik"
            checked={form.eRacunPrejemnik}
            onChange={(e) => setForm((f) => ({ ...f, eRacunPrejemnik: e.target.checked }))}
            disabled={!isOwner}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="eRacunPrejemnik" className="font-normal cursor-pointer">Registriran prejemnik e-računov</Label>
        </div>
        {form.eRacunPrejemnik && (
          <div className="space-y-3 pl-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eRacunOmrezje">Omrežje</Label>
                <Select value={form.eRacunOmrezje} onValueChange={(v) => setForm((f) => ({ ...f, eRacunOmrezje: v }))} disabled={!isOwner}>
                  <SelectTrigger id="eRacunOmrezje"><SelectValue placeholder="Izberi…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UJP">UJP (javni sektor)</SelectItem>
                    <SelectItem value="BizBox">BizBox</SelectItem>
                    <SelectItem value="PEPPOL">PEPPOL</SelectItem>
                    <SelectItem value="ZZI">ZZI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eRacunNaslov">Naslov / IBAN prejemnika</Label>
                <Input id="eRacunNaslov" value={form.eRacunNaslov} onChange={(e) => setForm((f) => ({ ...f, eRacunNaslov: e.target.value }))} disabled={!isOwner} placeholder="SI56…" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eRacunEmail">e-Račun e-mail</Label>
                <Input id="eRacunEmail" value={form.eRacunEmail} onChange={(e) => setForm((f) => ({ ...f, eRacunEmail: e.target.value }))} disabled={!isOwner} placeholder="eracun@podjetje.si" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eRacunSifraPu">Šifra PU</Label>
                <Input id="eRacunSifraPu" value={form.eRacunSifraPu} onChange={(e) => setForm((f) => ({ ...f, eRacunSifraPu: e.target.value }))} disabled={!isOwner} placeholder="001" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eRacunBic">BIC banke</Label>
                <Input id="eRacunBic" value={form.eRacunBic} onChange={(e) => setForm((f) => ({ ...f, eRacunBic: e.target.value.toUpperCase() }))} disabled={!isOwner} placeholder="BSLJSI2X" />
              </div>
            </div>
          </div>
        )}
      </div>

      {!isOwner && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Samo lastnik podjetja lahko ureja podatke o podjetju.</AlertDescription>
        </Alert>
      )}

      {osvezaNapaka && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{osvezaNapaka}</AlertDescription>
        </Alert>
      )}

      {updateMutation.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(updateMutation.error as Error)?.message ?? "Napaka pri shranjevanju."}</AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>Podatki so bili uspešno shranjeni.</AlertDescription>
        </Alert>
      )}

      {isOwner && (
        <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Shrani spremembe
        </Button>
      )}
    </form>
  );
}

// ── Uporabniki ────────────────────────────────────────────────────────────────

function UporabnikiTab({ companyId, isOwner }: { companyId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: me } = useGetMe();

  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<"accountant" | "viewer">("accountant");
  const [addSuccess, setAddSuccess] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ["companies", companyId, "roles"],
    queryFn: () =>
      apiFetch<CompanyRoleEntry[]>(`/api/companies/${companyId}/roles`),
    enabled: !!companyId,
  });

  const assignMutation = useMutation({
    mutationFn: (body: { clerkUserId: string; role: string }) =>
      apiFetch<RoleAssignment>(`/api/companies/${companyId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies", companyId, "roles"] });
      setNewUserId("");
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 3000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      apiFetch<void>(`/api/companies/${companyId}/roles/${clerkUserId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies", companyId, "roles"] });
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserId.trim()) return;
    assignMutation.mutate({ clerkUserId: newUserId.trim(), role: newRole });
  }

  const roles = rolesQuery.data ?? [];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Obstoječi uporabniki */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dostop do podjetja</CardTitle>
          <CardDescription>Vsi uporabniki z dostopom do tega podjetja.</CardDescription>
        </CardHeader>
        <CardContent>
          {rolesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ni dodeljenih vlog.</p>
          ) : (
            <div className="divide-y">
              {roles.map((entry) => (
                <div key={entry.clerkUserId} className="flex items-center justify-between py-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-muted-foreground text-xs">
                        {entry.clerkUserId === me?.id ? (
                          <span className="font-medium text-foreground">Vi ({entry.clerkUserId})</span>
                        ) : (
                          entry.clerkUserId
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Dodano: {new Date(entry.createdAt).toLocaleDateString("sl-SI")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-xs ${ROLE_COLORS[entry.role] ?? ""}`}
                    >
                      {ROLE_LABELS[entry.role] ?? entry.role}
                    </Badge>
                    {isOwner && entry.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(entry.clerkUserId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dodaj uporabnika (samo owner) */}
      {isOwner && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Dodaj uporabnika
            </CardTitle>
            <CardDescription>
              Vnesite Clerk ID uporabnika in izberite vlogo. Clerk ID najdete v
              nastavitvah računa (format: user_…).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-48 space-y-1.5">
                <Label htmlFor="clerkId">Clerk ID uporabnika</Label>
                <Input
                  id="clerkId"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  placeholder="user_2abc…"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vloga</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v as "accountant" | "viewer")}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accountant">Računovodja</SelectItem>
                    <SelectItem value="viewer">Pregledovalec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={assignMutation.isPending} className="gap-2">
                {assignMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Dodaj
              </Button>
            </form>

            {assignMutation.isError && (
              <Alert variant="destructive" className="mt-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {(assignMutation.error as Error)?.message ?? "Napaka pri dodajanju."}
                </AlertDescription>
              </Alert>
            )}
            {addSuccess && (
              <Alert className="mt-3 border-green-200 bg-green-50 text-green-800">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>Uporabnik je bil uspešno dodan.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── AJPES PRS sinhronizacija ──────────────────────────────────────────────────

interface AjpesStatus { skupaj: number; zadnjiUvoz: string | null; }

function AjpesTab() {
  const qc = useQueryClient();
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncRezultat, setSyncRezultat] = useState<{ uvozenih: number; datum: string } | null>(null);
  const [syncNapaka, setSyncNapaka] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<AjpesStatus>({
    queryKey: ["ajpes-status"],
    queryFn: () => apiFetch<AjpesStatus>("/api/ajpes/status"),
    staleTime: 60_000,
  });

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncRezultat(null);
    setSyncNapaka(null);
    try {
      const r = await apiFetch<{ uvozenih: number; datum: string }>("/api/ajpes/sync", { method: "POST" });
      setSyncRezultat(r);
      void qc.invalidateQueries({ queryKey: ["ajpes-status"] });
    } catch (err) {
      setSyncNapaka(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncLoading(false);
    }
  };

  const formatDatum = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Poslovni register Slovenije (AJPES PRS)
          </CardTitle>
          <CardDescription>
            Javni register podjetij in samostojnih podjetnikov. Vir:{" "}
            <a href="https://podatki.gov.si/dataset/poslovni-register-slovenije" target="_blank" rel="noopener noreferrer" className="underline">
              podatki.gov.si
            </a>{" "}(licenca CC BY 4.0)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {statusLoading ? (
                  <span className="text-muted-foreground">Nalagam…</span>
                ) : (status?.skupaj ?? 0) > 0 ? (
                  <span>{(status!.skupaj).toLocaleString("sl-SI")} subjektov</span>
                ) : (
                  <span className="text-muted-foreground">Register ni bil še uvožen</span>
                )}
              </p>
              {!statusLoading && status?.zadnjiUvoz && (
                <p className="text-xs text-muted-foreground">Zadnji uvoz: {formatDatum(status.zadnjiUvoz)}</p>
              )}
            </div>
            <Button onClick={() => void handleSync()} disabled={syncLoading} className="gap-2 shrink-0">
              {syncLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncLoading ? "Uvažam…" : "Osveži register"}
            </Button>
          </div>

          {/* Rezultat */}
          {syncRezultat && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Uvoz uspešen: {syncRezultat.uvozenih.toLocaleString("sl-SI")} subjektov ({syncRezultat.datum})
              </AlertDescription>
            </Alert>
          )}
          {syncNapaka && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncNapaka}</AlertDescription>
            </Alert>
          )}

          {/* Navodilo */}
          <div className="rounded-lg border px-4 py-3 space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Kako deluje</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Ko iščete ali osvežite poslovnega partnerja, sistem samodejno preveri AJPES register in zapolni naslov, poštno številko in kraj.</li>
              <li>Kjer podjetje javno objavi e-naslov v registru, bo sistem ta e-naslov samodejno zapolnil v polje <strong>E-mail</strong>.</li>
              <li>Javni izvoz (OPSI) vsebuje: naziv, naslov, pravna oblika. <strong>E-mail</strong> je v polnem izvozu AJPES FTP — na voljo subjektom, ki so ga registrirali.</li>
              <li>Register posodobite mesečno (AJPES posodablja podatke dnevno/tedensko).</li>
              <li><strong>Opozorilo:</strong> uvoz traja 2–5 minut (prenos ~127 MB).</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── UJP sinhronizacija ────────────────────────────────────────────────────────

interface UjpStatus { skupaj: number; zadnjiUvoz: string | null; }

function UjpTab() {
  const qc = useQueryClient();
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncRezultat, setSyncRezultat] = useState<{ uvozenih: number; datum: string } | null>(null);
  const [syncNapaka, setSyncNapaka] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<UjpStatus>({
    queryKey: ["ujp-status"],
    queryFn: () => apiFetch<UjpStatus>("/api/ujp/status"),
    staleTime: 60_000,
  });

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncRezultat(null);
    setSyncNapaka(null);
    try {
      const r = await apiFetch<{ uvozenih: number; datum: string }>("/api/ujp/sync", { method: "POST" });
      setSyncRezultat(r);
      void qc.invalidateQueries({ queryKey: ["ujp-status"] });
    } catch (err) {
      setSyncNapaka(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncLoading(false);
    }
  };

  const formatDatum = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Seznam proračunskih uporabnikov UJP
          </CardTitle>
          <CardDescription>
            Uradni seznam javnih institucij, ki sprejemajo e-račune prek UJP portala. Vir:{" "}
            <a href="https://storitve.ujp.gov.si/dostop/seznam-prejemnikov-eracunov/" target="_blank" rel="noopener noreferrer" className="underline">
              storitve.ujp.gov.si
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {statusLoading ? (
                  <span className="text-muted-foreground">Nalagam…</span>
                ) : (status?.skupaj ?? 0) > 0 ? (
                  <span>{(status!.skupaj).toLocaleString("sl-SI")} proračunskih uporabnikov</span>
                ) : (
                  <span className="text-muted-foreground">Seznam ni bil še uvožen</span>
                )}
              </p>
              {!statusLoading && status?.zadnjiUvoz && (
                <p className="text-xs text-muted-foreground">Zadnji uvoz: {formatDatum(status.zadnjiUvoz)}</p>
              )}
            </div>
            <Button onClick={() => void handleSync()} disabled={syncLoading} className="gap-2 shrink-0">
              {syncLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncLoading ? "Uvažam…" : "Osveži seznam"}
            </Button>
          </div>

          {/* Rezultat */}
          {syncRezultat && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Uvoz uspešen: {syncRezultat.uvozenih.toLocaleString("sl-SI")} proračunskih uporabnikov ({syncRezultat.datum})
              </AlertDescription>
            </Alert>
          )}
          {syncNapaka && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncNapaka}</AlertDescription>
            </Alert>
          )}

          {/* Navodilo */}
          <div className="rounded-lg border px-4 py-3 space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Kako deluje</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Ko iščete poslovnega partnerja po davčni številki, sistem samodejno preveri, ali je ta v UJP seznamu.</li>
              <li>Če je najden, se partnerju nastavi <strong>e-račun prejemnik: DA</strong>, omrežje <strong>UJP</strong> in TRR za dostavo.</li>
              <li>UJP seznam posodobite ročno (dnevno posodabljanje priporočeno).</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── POS Knjiženje ─────────────────────────────────────────────────────────────

interface AccountOption {
  id: string;
  code: string;
  name: string;
  allowsPosting: boolean;
  isActive: boolean;
}

interface PosBookingSettingsData {
  // T1 debet — plačila
  cashAccountId: string | null;
  cardAccountId: string | null;
  voucherAccountId: string | null;
  otherPaymentAccountId: string | null;
  // T1 kredit — prihodki
  revenueMaterial95AccountId: string | null;
  revenueMaterial22AccountId: string | null;
  revenueGoods22AccountId: string | null;
  revenueGoods95AccountId: string | null;
  revenueServiceAccountId: string | null;
  // T1 kredit — DDV
  vat95AccountId: string | null;
  vat22AccountId: string | null;
  // T2 — prejemnice
  inventoryMaterialAccountId: string | null;
  inventoryGoodsAccountId: string | null;
  payablesAccountId: string | null;
  // T3 — COGS
  cogsMaterialAccountId: string | null;
  cogsGoodsAccountId: string | null;
  // T4 — lastna poraba / reprezentanca + KIR
  kirArAccountId: string | null;
  lastnaPorabaAccountId: string | null;
  reprezentancaAccountId: string | null;
  // zastareli fallback konti
  revenueAccountId: string | null;
  vatLiabilityAccountId: string | null;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
}

const EMPTY_PBS: PosBookingSettingsData = {
  cashAccountId: null,
  cardAccountId: null,
  voucherAccountId: null,
  otherPaymentAccountId: null,
  revenueMaterial95AccountId: null,
  revenueMaterial22AccountId: null,
  revenueGoods22AccountId: null,
  revenueGoods95AccountId: null,
  revenueServiceAccountId: null,
  vat95AccountId: null,
  vat22AccountId: null,
  inventoryMaterialAccountId: null,
  inventoryGoodsAccountId: null,
  payablesAccountId: null,
  cogsMaterialAccountId: null,
  cogsGoodsAccountId: null,
  kirArAccountId: null,
  lastnaPorabaAccountId: null,
  reprezentancaAccountId: null,
  revenueAccountId: null,
  vatLiabilityAccountId: null,
  inventoryAccountId: null,
  cogsAccountId: null,
};

function PosKnjizenjeTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PosBookingSettingsData>(EMPTY_PBS);
  const [saved, setSaved] = useState(false);
  const [syncDatum, setSyncDatum] = useState(() => new Date().toISOString().slice(0, 10));
  const [syncResult, setSyncResult] = useState<{ created: string[]; skipped: Array<{ ref: string; reason: string }> } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<PosBookingSettingsData | null>({
    queryKey: ["pos-booking-settings", companyId],
    queryFn: () => apiFetch<PosBookingSettingsData | null>(`/api/companies/${companyId}/pos-booking-settings`),
    staleTime: 30_000,
  });

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: AccountOption[] }>({
    queryKey: ["accounts-list", companyId],
    queryFn: () => apiFetch<{ accounts: AccountOption[] }>(`/api/companies/${companyId}/accounts`),
    staleTime: 60_000,
  });

  // Prikaži vse aktivne konte (tudi skupinske) — uporabnik mora videti celoten kontni plan
  const accounts = (accountsData?.accounts ?? []).filter(a => a.isActive);

  useEffect(() => {
    if (settings) setForm({ ...EMPTY_PBS, ...settings });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<PosBookingSettingsData>(`/api/companies/${companyId}/pos-booking-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["pos-booking-settings", companyId] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const r = await apiFetch<{ created: string[]; skipped: Array<{ ref: string; reason: string }> }>(
        `/api/companies/${companyId}/pos-booking-settings/sync/${syncDatum}`,
        { method: "POST" },
      );
      setSyncResult(r);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncing(false);
    }
  };

  const setField = (field: keyof PosBookingSettingsData, value: string | null) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  function AccountSelect({
    label,
    field,
    description,
  }: {
    label: string;
    field: keyof PosBookingSettingsData;
    description?: string;
  }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const value = form[field] ?? null;
    const selected = accounts.find(a => a.id === value);

    const filtered = query.trim() === ""
      ? accounts
      : accounts.filter(a =>
          a.code.toLowerCase().includes(query.toLowerCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase())
        );

    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal text-sm h-9"
            >
              {selected
                ? <span><span className="font-mono">{selected.code}</span> — {selected.name}</span>
                : <span className="text-muted-foreground">— ni nastavljen —</span>}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Išči po kodi ali imenu…"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>Ni zadetkov.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => { setField(field, null); setOpen(false); setQuery(""); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                    <span className="text-muted-foreground">— ni nastavljen —</span>
                  </CommandItem>
                  {filtered.map(a => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => { setField(field, a.id); setOpen(false); setQuery(""); }}
                      className={!a.allowsPosting ? "opacity-60" : ""}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono text-xs w-16 shrink-0">{a.code}</span>
                      <span className="truncate">{a.name}</span>
                      {!a.allowsPosting && <span className="ml-auto text-xs text-muted-foreground shrink-0">skupinski</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  if (settingsLoading || accountsLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Info */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Samodejno POS → ERP knjiženje</p>
        <p className="text-xs">
          Po vsakem zaključenem POS računu ali prejemnici se za tisti dan avtomatsko osvežijo osnutki treh temeljnic.
          Računovodja jih ročno pregleda in potrdi v seznamu temeljnic.
        </p>
      </div>

      {/* Temeljnica 1: Prodaja — Debet (plačila) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 1 — Dnevna prodaja · Plačilni načini (debet)</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:PRODAJA:YYYY-MM-DD</code>
            {" · "}Vsak plačilni način se knjiži na ločen konto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <AccountSelect label="Blagajna — gotovina" field="cashAccountId" description="Debet — npr. 1000110 Blagajna EUR" />
          <AccountSelect label="Kartica / POS terminal" field="cardAccountId" description="Debet — npr. 1000120 Prehodni konto POS" />
          <AccountSelect label="Darilni boni" field="voucherAccountId" description="Debet — razknjiženje predujma, npr. 2300110" />
          <AccountSelect label="Ostalo (Sodexo, TRR kupci…)" field="otherPaymentAccountId" description="Debet — catch-all za negotovinska plačila" />
        </CardContent>
      </Card>

      {/* Temeljnica 1: Prodaja — Kredit (prihodki) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 1 — Dnevna prodaja · Prihodki po vrsti × DDV (kredit)</CardTitle>
          <CardDescription>
            Prihodki se razdelijo po <strong>vrsti artikla</strong> in <strong>DDV stopnji</strong>.
            Fallback: če konto za kombinacijo ni nastavljen, se uporabi splošni konto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AccountSelect label="Material 9,5 % — hrana kuhinja" field="revenueMaterial95AccountId" description="Kredit — npr. 7620110" />
            <AccountSelect label="Material 22 % — točene alkoholne pijače" field="revenueMaterial22AccountId" description="Kredit — npr. 7620210" />
            <AccountSelect label="Blago 9,5 % — steklenice brezalkoh." field="revenueGoods95AccountId" description="Kredit — npr. 7620320" />
            <AccountSelect label="Blago 22 % — steklenice alkohol" field="revenueGoods22AccountId" description="Kredit — npr. 7620310" />
            <AccountSelect label="Storitev (postrežba) 22 %" field="revenueServiceAccountId" description="Kredit — npr. 7600110" />
            <AccountSelect label="Splošni prihodki (fallback)" field="revenueAccountId" description="Kredit — rezerva, če analitika ni nastavljena" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
            <AccountSelect label="DDV 9,5 % — obveznost" field="vat95AccountId" description="Kredit — npr. 2600195" />
            <AccountSelect label="DDV 22 % — obveznost" field="vat22AccountId" description="Kredit — npr. 2600122" />
            <AccountSelect label="Splošni DDV (fallback)" field="vatLiabilityAccountId" description="Kredit — rezerva, če DDV po stopnji ni nastavljeno" />
          </div>
        </CardContent>
      </Card>

      {/* Temeljnica 2: Prejemnice */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 2 — Prejemnice blaga</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:PREJEMNICA:YYYY-MM-DD</code>
            {" · "}Debet = zaloge po vrsti · Kredit = obveznosti do dobaviteljev
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <AccountSelect label="Zaloga materiala (razred 3)" field="inventoryMaterialAccountId" description="Debet — npr. 3100110 Material — meso, ribe…" />
          <AccountSelect label="Zaloga blaga (razred 6)" field="inventoryGoodsAccountId" description="Debet — npr. 6600110 Blago — pivo v steklenicah" />
          <AccountSelect label="Splošna zaloga (fallback)" field="inventoryAccountId" description="Debet — rezerva" />
          <AccountSelect label="Obveznosti do dobaviteljev" field="payablesAccountId" description="Kredit — npr. 2200110" />
        </CardContent>
      </Card>

      {/* Temeljnica 3: Poraba */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 3 — Poraba materiala / NVPB (COGS)</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:PORABA:YYYY-MM-DD</code>
            {" · "}Debet = stroški · Kredit = zmanjšanje ustrezne zaloge
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <AccountSelect label="Stroški materiala po normativih" field="cogsMaterialAccountId" description="Debet — npr. 4000110 Poraba materiala" />
          <AccountSelect label="Nabavna vrednost prod. blaga (NVPB)" field="cogsGoodsAccountId" description="Debet — npr. 7020110 NVPB alkohol" />
          <AccountSelect label="Splošni COGS (fallback)" field="cogsAccountId" description="Debet — rezerva" />
          <div className="flex items-center text-xs text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 self-end">
            Kredit = konto zalog iz Temeljnice 2 (material ali blago)
          </div>
        </CardContent>
      </Card>

      {/* Temeljnica 4 + KIR */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 4 — Lastna poraba &amp; Reprezentanca + KIR</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:LASTREPR:YYYY-MM-DD</code>
            {" · "}Brezplačni računi z DDV obveznostjo. Debet = odhodek (face value), Kredit = prihodek neto + DDV.
            <br />
            KIR: ko je nastavljen <strong>AR konto</strong>, sync samodejno ustvari vrstice v Knjigi izdanih računov
            (B2C zbirno · B2B posamično · lastna/repr posebej).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <AccountSelect
            label="Terjatve do kupcev — KIR (AR)"
            field="kirArAccountId"
            description="Obvezno za KIR — npr. 1200110 Terjatve do kupcev"
          />
          <div className="flex items-center text-xs text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 self-end">
            Če ni nastavljeno, se KIR preskoči. B2B partnerji se najdejo/ustvarijo po davčni številki.
          </div>
          <AccountSelect
            label="Odhodki — lastna poraba"
            field="lastnaPorabaAccountId"
            description="Debet v T4 — npr. 4830110 Odhodki iz naslova lastne porabe"
          />
          <AccountSelect
            label="Odhodki — reprezentanca"
            field="reprezentancaAccountId"
            description="Debet v T4 — npr. 4861000 Prehrana podjetnika / reprezentanca"
          />
        </CardContent>
      </Card>

      {/* Shrani */}
      <div className="flex items-center gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Save className="h-4 w-4 mr-2" />}
          Shrani nastavitve
        </Button>
        {saved && (
          <span className="text-sm text-green-600 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Shranjeno
          </span>
        )}
        {saveMutation.isError && (
          <span className="text-sm text-destructive">
            {(saveMutation.error as Error).message}
          </span>
        )}
      </div>

      {/* Ročna sinhronizacija */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Ročna sinhronizacija za datum
          </CardTitle>
          <CardDescription>
            Osveži osnutke temeljnic za kateri koli pretekli datum (npr. če je šlo kaj narobe).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              type="date"
              value={syncDatum}
              onChange={e => setSyncDatum(e.target.value)}
              className="w-44"
            />
            <Button onClick={() => void handleSync()} disabled={syncing} variant="outline" className="gap-2">
              {syncing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              {syncing ? "Sinhroniziram…" : "Sinhroniziraj"}
            </Button>
          </div>

          {syncResult && (
            <div className="space-y-2">
              {syncResult.created.length > 0 && (
                <Alert className="border-green-200 bg-green-50 text-green-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Ustvarjeni osnutki: {syncResult.created.join(", ")}
                  </AlertDescription>
                </Alert>
              )}
              {syncResult.skipped.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Preskočeno:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {syncResult.skipped.map((s, i) => (
                        <li key={i}><code>{s.ref}</code>: {s.reason}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {syncResult.created.length === 0 && syncResult.skipped.length === 0 && (
                <Alert className="border-blue-200 bg-blue-50 text-blue-800">
                  <AlertDescription>Ni podatkov za ta dan (brez prodaje, prejemnic ali porabe).</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {syncError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function Nastavitve() {
  const { activeCompany } = useCompany();

  if (!activeCompany) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Building2 className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm">Izberite podjetje za prikaz nastavitev.</p>
      </div>
    );
  }

  const isOwner = activeCompany.role === "owner";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nastavitve podjetja</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {activeCompany.naziv} · {activeCompany.podjetjeDavcna}
        </p>
      </div>

      <Tabs defaultValue="podatki" className="space-y-5">
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="podatki" className="gap-2">
              <Building2 className="h-3.5 w-3.5" />
              Podjetje
            </TabsTrigger>
            <TabsTrigger value="uporabniki" className="gap-2">
              <Users className="h-3.5 w-3.5" />
              Uporabniki
            </TabsTrigger>
            <TabsTrigger value="ujp" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              UJP e-računi
            </TabsTrigger>
            <TabsTrigger value="ajpes" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              AJPES PRS
            </TabsTrigger>
            <TabsTrigger value="pos" className="gap-2">
              <Store className="h-3.5 w-3.5" />
              POS Knjiženje
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="podatki" className="mt-0">
          <PodatkiTab companyId={activeCompany.id} isOwner={isOwner} />
        </TabsContent>

        <TabsContent value="uporabniki" className="mt-0">
          <UporabnikiTab companyId={activeCompany.id} isOwner={isOwner} />
        </TabsContent>

        <TabsContent value="ujp" className="mt-0">
          <UjpTab />
        </TabsContent>

        <TabsContent value="ajpes" className="mt-0">
          <AjpesTab />
        </TabsContent>

        <TabsContent value="pos" className="mt-0">
          <PosKnjizenjeTab companyId={activeCompany.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
