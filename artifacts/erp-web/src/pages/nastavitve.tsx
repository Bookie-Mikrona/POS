import React, { useState, useEffect } from "react";
import { Building2, Users, Save, UserPlus, AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

interface UpdateCompanyBody {
  naziv?: string;
  kratekNaziv?: string | null;
  naslov?: string | null;
  postnaStevika?: string | null;
  kraj?: string | null;
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

function PodatkiTab({ companyId, isOwner }: { companyId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const { setActiveCompany, activeCompany } = useCompany();

  const { data, isLoading } = useGetCompany(companyId);

  const [form, setForm] = useState({
    naziv: "",
    kratekNaziv: "",
    naslov: "",
    postnaStevika: "",
    kraj: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        naziv: data.naziv ?? "",
        kratekNaziv: data.kratekNaziv ?? "",
        naslov: data.naslov ?? "",
        postnaStevika: data.postnaStevika ?? "",
        kraj: data.kraj ?? "",
      });
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
      // Posodobi aktivno podjetje v kontekstu
      if (activeCompany?.id === companyId) {
        setActiveCompany({ ...activeCompany, ...updated });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
      naziv: form.naziv || undefined,
      kratekNaziv: form.kratekNaziv || null,
      naslov: form.naslov || null,
      postnaStevika: form.postnaStevika || null,
      kraj: form.kraj || null,
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div className="space-y-1.5">
        <Label htmlFor="davcna">Davčna številka</Label>
        <Input
          id="davcna"
          value={data?.podjetjeDavcna ?? ""}
          disabled
          className="bg-muted text-muted-foreground"
        />
        <p className="text-xs text-muted-foreground">Davčna številka je nespremenljiva.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="naziv">Polni naziv podjetja *</Label>
        <Input
          id="naziv"
          value={form.naziv}
          onChange={(e) => setForm((f) => ({ ...f, naziv: e.target.value }))}
          disabled={!isOwner}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="kratekNaziv">Kratek naziv</Label>
        <Input
          id="kratekNaziv"
          value={form.kratekNaziv}
          onChange={(e) => setForm((f) => ({ ...f, kratekNaziv: e.target.value }))}
          disabled={!isOwner}
          placeholder="npr. ABC d.o.o."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="naslov">Naslov</Label>
        <Input
          id="naslov"
          value={form.naslov}
          onChange={(e) => setForm((f) => ({ ...f, naslov: e.target.value }))}
          disabled={!isOwner}
          placeholder="Ulica 1"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="postna">Poštna številka</Label>
          <Input
            id="postna"
            value={form.postnaStevika}
            onChange={(e) => setForm((f) => ({ ...f, postnaStevika: e.target.value }))}
            disabled={!isOwner}
            placeholder="1000"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kraj">Kraj</Label>
          <Input
            id="kraj"
            value={form.kraj}
            onChange={(e) => setForm((f) => ({ ...f, kraj: e.target.value }))}
            disabled={!isOwner}
            placeholder="Ljubljana"
          />
        </div>
      </div>

      {!isOwner && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Samo lastnik podjetja lahko ureja podatke o podjetju.
          </AlertDescription>
        </Alert>
      )}

      {updateMutation.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {(updateMutation.error as Error)?.message ?? "Napaka pri shranjevanju."}
          </AlertDescription>
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
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
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
        <TabsList>
          <TabsTrigger value="podatki" className="gap-2">
            <Building2 className="h-3.5 w-3.5" />
            Podatki o podjetju
          </TabsTrigger>
          <TabsTrigger value="uporabniki" className="gap-2">
            <Users className="h-3.5 w-3.5" />
            Uporabniki in pravice
          </TabsTrigger>
        </TabsList>

        <TabsContent value="podatki" className="mt-0">
          <PodatkiTab companyId={activeCompany.id} isOwner={isOwner} />
        </TabsContent>

        <TabsContent value="uporabniki" className="mt-0">
          <UporabnikiTab companyId={activeCompany.id} isOwner={isOwner} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
