import React, { useState, useEffect } from "react";
import { Building2, Users, Save, UserPlus, AlertCircle, AlertTriangle, CheckCircle2, Loader2, Trash2, Plus, X, RefreshCw, Database, Store, CalendarDays, KeyRound, FileText } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useGetCompany, useGetMe, useAssignRole, useListCounterparties, useListNatakari } from "@workspace/api-client-react";
import type { CompanyWithRole, RoleAssignment, TipAllocation, TipPolicy } from "@workspace/api-client-react";

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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, formatDatum } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyRoleEntry {
  clerkUserId: string;
  role: "owner" | "accountant" | "viewer";
  createdAt: string;
}

interface TrrEntry { iban: string; bic: string; }

interface TipJournalPreview {
  hasTips: boolean;
  summary?: {
    gross: number;
    employerRevenue: number;
    employeeLiability: number;
    vat: number;
    receiptCount: number;
  };
  entries: Array<{
    entryId: string;
    entryDate: string;
    reference: string;
    description: string;
    status: string;
    lines: Array<{
      accountCode: string;
      accountName: string;
      side: string;
      amount: string;
      description: string | null;
    }>;
  }>;
}

interface TipPool {
  id: string; tipPolicyId: string; name: string; decisionType: string; decisionDate: string; ruleReference: string;
  effectiveFrom: string; effectiveTo: string | null; evidenceReference: string;
}

function TipJournalCard({ preview }: { preview: TipJournalPreview | null }) {
  if (!preview?.hasTips) return null;
  const money = (value: number | string) => `${Number(value).toFixed(2)} €`;
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-700" />
          Temeljnica z napitnino
        </CardTitle>
        <CardDescription>
          Prikaz je vezan na račune, ki vsebujejo napitnino. Vrstice so dejanski osnutek,
          ki ga je ustvaril POS zbirnik.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.summary && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><div className="text-muted-foreground">Napitnina</div><strong>{money(preview.summary.gross)}</strong></div>
            <div><div className="text-muted-foreground">Obveznost zaposlenim</div><strong>{money(preview.summary.employeeLiability)}</strong></div>
            <div><div className="text-muted-foreground">Prihodek delodajalca</div><strong>{money(preview.summary.employerRevenue)}</strong></div>
            <div><div className="text-muted-foreground">DDV od napitnine</div><strong>{money(preview.summary.vat)}</strong></div>
          </div>
        )}
        <div className="space-y-3">
          {preview.entries.length === 0 ? (
            <Alert><AlertDescription>Računi z napitnino obstajajo, vendar pripadajoča POS temeljnica še ni bila ustvarjena.</AlertDescription></Alert>
          ) : preview.entries.map((entry) => (
            <div key={entry.entryId} className="rounded-md border bg-background overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
                <div><strong>{entry.reference}</strong><span className="ml-2 text-muted-foreground">{entry.description}</span></div>
                <Badge variant={entry.status === "posted" ? "default" : "outline"}>
                  {entry.status === "posted" ? "Knjiženo" : "Osnutek"}
                </Badge>
              </div>
              <div className="divide-y text-sm">
                {entry.lines.map((line, index) => (
                  <div key={`${entry.entryId}-${index}`} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2">
                    <div>
                      <span className="font-medium">{line.accountCode}</span> {line.accountName}
                      {line.description && <div className="text-xs text-muted-foreground">{line.description}</div>}
                    </div>
                    <span className="text-muted-foreground">{line.side === "debit" ? "D" : "K"}</span>
                    <span className="tabular-nums">{money(line.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Alert className="border-amber-200 bg-amber-100/60 text-amber-950">
          <AlertDescription className="text-xs leading-relaxed">
            <strong>Obrazložitev:</strong> pri napitnini za tuj račun je kredit na kontu obveznosti
            do zaposlenih. Če napitnino obvladuje delodajalec, je kredit na prihodkovnem kontu,
            pripadajoči DDV pa na kontu izstopnega DDV. Pavšalna kartična provizija se napitnini
            ne pripiše; odstotna provizija se upošteva samo, če jo po dogovoru nosi zaposleni.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

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

export type NastavitveTab = "podatki" | "uporabniki" | "ujp" | "ajpes" | "pos";

export interface NastavitveVisibility {
  showUsers: boolean;
  showPosBooking: boolean;
  showERacunRegistration: boolean;
  showBizBoxCredentials: boolean;
  activeTab: NastavitveTab;
}

export function getNastavitveVisibility({
  isErpOwnerCompany,
  hasPosModule,
  selectedTab,
}: {
  isErpOwnerCompany: boolean;
  hasPosModule: boolean;
  selectedTab: NastavitveTab;
}): NastavitveVisibility {
  const showUsers = !isErpOwnerCompany;
  const showPosBooking = hasPosModule;
  const showERacunRegistration = !isErpOwnerCompany;
  const showBizBoxCredentials = !isErpOwnerCompany;
  const selectedTabIsHidden =
    (selectedTab === "uporabniki" && !showUsers) ||
    (selectedTab === "pos" && !showPosBooking);

  return {
    showUsers,
    showPosBooking,
    showERacunRegistration,
    showBizBoxCredentials,
    activeTab: selectedTabIsHidden ? "podatki" : selectedTab,
  };
}

// ── Podatki o podjetju ────────────────────────────────────────────────────────

type AnyCompany = Record<string, unknown>;

function PodatkiTab({
  companyId,
  isOwner,
  showERacunRegistration = true,
  showBizBoxCredentials = true,
}: {
  companyId: string;
  isOwner: boolean;
  showERacunRegistration?: boolean;
  showBizBoxCredentials?: boolean;
}) {
  const qc = useQueryClient();
  const { setActiveCompany, activeCompany } = useCompany();

  const { data, isLoading } = useGetCompany(companyId);

  const emptyForm = {
    naziv: "", kratekNaziv: "", naslov: "", ulica: "", postnaStevika: "", kraj: "",
    drzava: "", kodaDrzave: "", maticnaStevilka: "", idZaDdv: "",
    zavezanecDdv: false,
    email: "", telefon: "", www: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [trr, setTrr] = useState<TrrEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [osvezujem, setOsvezujem] = useState(false);
  const [osvezaNapaka, setOsvezaNapaka] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      const d = data as unknown as AnyCompany;
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
    <div className="space-y-0 max-w-xl">
    <form onSubmit={handleSubmit} className="space-y-5">
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
    {showERacunRegistration && <ERacunRegistracijaSekcija companyId={companyId} isOwner={isOwner} />}
    {showBizBoxCredentials && isOwner && <BizBoxPoverilniceSekcija companyId={companyId} />}
  </div>
  );
}

// ── e-Račun registracija (ERP owner ali POS admin) ───────────────────────────
function ERacunRegistracijaSekcija({ companyId, isOwner }: { companyId: string; isOwner: boolean }) {
  const [prejemnik, setPrejemnik] = useState(false);
  const [omrezje, setOmrezje] = useState("");
  const [naslov, setNaslov] = useState("");
  const [email, setEmail] = useState("");
  const [sifraPu, setSifraPu] = useState("");
  const [bic, setBic] = useState("");
  const [naložen, setNaložen] = useState(false);
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [uspeh, setUspeh] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{
          eRacunPrejemnik?: boolean | null;
          eRacunOmrezje?: string | null;
          eRacunNaslov?: string | null;
          eRacunEmail?: string | null;
          eRacunSifraPu?: string | null;
          eRacunBic?: string | null;
        }>(`/api/companies/${companyId}/eracun-nastavitve`);
        setPrejemnik(r.eRacunPrejemnik ?? false);
        setOmrezje(r.eRacunOmrezje ?? "");
        setNaslov(r.eRacunNaslov ?? "");
        setEmail(r.eRacunEmail ?? "");
        setSifraPu(r.eRacunSifraPu ?? "");
        setBic(r.eRacunBic ?? "");
        setNaložen(true);
      } catch { /* ignoriramo */ }
    })();
  }, [companyId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setShranjujem(true); setNapaka(null); setUspeh(false);
    try {
      await apiFetch<object>(`/api/companies/${companyId}/eracun-nastavitve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eRacunPrejemnik: prejemnik,
          eRacunOmrezje: omrezje || null,
          eRacunNaslov: naslov || null,
          eRacunEmail: email || null,
          eRacunSifraPu: sifraPu || null,
          eRacunBic: bic || null,
        }),
      });
      setUspeh(true); setTimeout(() => setUspeh(false), 4000);
    } catch (err) {
      setNapaka(err instanceof Error ? err.message : "Napaka pri shranjevanju");
    } finally {
      setShranjujem(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-5 mt-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" />e-Račun registracija
      </p>
      {!naložen && <p className="text-xs text-muted-foreground">Nalagam…</p>}
      <form onSubmit={(e) => { void handleSave(e); }} className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="er-prejemnik"
            checked={prejemnik}
            onChange={(e) => setPrejemnik(e.target.checked)}
            disabled={!isOwner}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="er-prejemnik" className="font-normal cursor-pointer">Registriran prejemnik e-računov</Label>
        </div>
        {prejemnik && (
          <div className="space-y-3 pl-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="er-omrezje">Omrežje</Label>
                <Select value={omrezje} onValueChange={setOmrezje} disabled={!isOwner}>
                  <SelectTrigger id="er-omrezje"><SelectValue placeholder="Izberi…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UJP">UJP (javni sektor)</SelectItem>
                    <SelectItem value="BizBox">BizBox</SelectItem>
                    <SelectItem value="PEPPOL">PEPPOL</SelectItem>
                    <SelectItem value="ZZI">ZZI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="er-naslov">Naslov / IBAN prejemnika</Label>
                <Input id="er-naslov" value={naslov} onChange={(e) => setNaslov(e.target.value)} disabled={!isOwner} placeholder="SI56…" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="er-email">e-Račun e-mail</Label>
                <Input id="er-email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isOwner} placeholder="eracun@podjetje.si" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="er-sifra-pu">Šifra PU</Label>
                <Input id="er-sifra-pu" value={sifraPu} onChange={(e) => setSifraPu(e.target.value)} disabled={!isOwner} placeholder="001" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="er-bic">BIC banke</Label>
                <Input id="er-bic" value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} disabled={!isOwner} placeholder="BSLJSI2X" />
              </div>
            </div>
          </div>
        )}
        {napaka && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{napaka}</AlertDescription>
          </Alert>
        )}
        {uspeh && (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>e-Račun nastavitve shranjene.</AlertDescription>
          </Alert>
        )}
        {isOwner && (
          <Button type="submit" disabled={shranjujem} className="gap-2">
            {shranjujem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Shrani e-Račun nastavitve
          </Button>
        )}
      </form>
    </div>
  );
}

// ── bizBox poverilnice (ERP owner) ───────────────────────────────────────────
function BizBoxPoverilniceSekcija({ companyId }: { companyId: string }) {
  const [user, setUser] = useState("");
  const [novGeslo, setNovGeslo] = useState("");
  const [gesloNastavljeno, setGesloNastavljeno] = useState(false);
  const [okolje, setOkolje] = useState<"test" | "prod">("test");
  const [posiljatelj, setPosiljatelj] = useState("");
  const [naložen, setNaložen] = useState(false);
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [uspeh, setUspeh] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{
          gesloNastavljeno: boolean; bizboxUser: string;
          bizboxOkolje: string; posiljateljDavcna: string | null;
        }>(`/api/companies/${companyId}/bizbox-nastavitve`);
        setUser(r.bizboxUser ?? "");
        setOkolje((r.bizboxOkolje ?? "test") as "test" | "prod");
        setPosiljatelj(r.posiljateljDavcna ?? "");
        setGesloNastavljeno(r.gesloNastavljeno ?? false);
        setNaložen(true);
      } catch { /* ignoriramo */ }
    })();
  }, [companyId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user.trim()) return;
    setShranjujem(true); setNapaka(null); setUspeh(false);
    try {
      const body: Record<string, string | null> = {
        bizboxUser: user.trim(), bizboxOkolje: okolje,
        posiljateljDavcna: posiljatelj.trim() || null,
      };
      if (novGeslo) body["bizboxPass"] = novGeslo;
      await apiFetch<{ uspeh: boolean }>(`/api/companies/${companyId}/bizbox-nastavitve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setGesloNastavljeno(true); setNovGeslo("");
      setUspeh(true); setTimeout(() => setUspeh(false), 4000);
    } catch (err) {
      setNapaka(err instanceof Error ? err.message : "Napaka pri shranjevanju");
    } finally {
      setShranjujem(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-5 mt-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <KeyRound className="h-3.5 w-3.5" />bizBox poverilnice
      </p>
      {!naložen && <p className="text-xs text-muted-foreground">Nalagam…</p>}
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bb-user">Uporabniško ime</Label>
            <Input id="bb-user" value={user} onChange={e => setUser(e.target.value)}
              placeholder="npr. podjetje@zzi.si" autoComplete="username" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bb-geslo">Geslo</Label>
            {gesloNastavljeno && !novGeslo && (
              <p className="text-xs text-green-700 font-medium">✓ Geslo je nastavljeno — pustite prazno za ohranitev</p>
            )}
            <Input id="bb-geslo" type="password" autoComplete="new-password"
              placeholder={gesloNastavljeno ? "Novo geslo (pustite prazno)" : "Vnesite geslo"}
              value={novGeslo} onChange={e => setNovGeslo(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bb-okolje">Okolje</Label>
            <Select value={okolje} onValueChange={v => setOkolje(v as "test" | "prod")}>
              <SelectTrigger id="bb-okolje"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Testno (demo.zzi.si)</SelectItem>
                <SelectItem value="prod">Produkcija (ws.zzi.si)</SelectItem>
              </SelectContent>
            </Select>
            {okolje === "prod" && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />Produkcijsko okolje
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bb-posiljatelj">Pošiljateljev eDDress override</Label>
            <Input id="bb-posiljatelj" value={posiljatelj} onChange={e => setPosiljatelj(e.target.value)}
              placeholder="Privzeto: davčna podjetja" />
            <p className="text-xs text-muted-foreground">Prazno = uporabi davčno podjetja</p>
          </div>
        </div>
        {napaka && (
          <Alert variant="destructive"><AlertCircle className="h-4 w-4" />
            <AlertDescription>{napaka}</AlertDescription></Alert>
        )}
        {uspeh && (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>bizBox poverilnice so bile uspešno shranjene.</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={shranjujem || !user.trim() || (!gesloNastavljeno && !novGeslo)} className="gap-2">
          {shranjujem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Shrani bizBox poverilnice
        </Button>
      </form>
    </div>
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
  type: string;
}

interface PosCategoryRevenueAccountData {
  categoryId: number;
  categoryName: string;
  unitId: number;
  unitName: string;
  accountId: string | null;
}

interface PosBookingSettingsData {
  categoryRevenueAccounts: PosCategoryRevenueAccountData[];
  // T1 debet — plačila
  cashAccountId: string | null;
  bankAccountId: string | null;
  cashInTransitAccountId: string | null;
  cardAccountId: string | null;
  tipsLiabilityAccountId: string | null;
  tipsRevenueAccountId: string | null;
  tipsVatAccountId: string | null;
  tipsCardFeeExpenseAccountId: string | null;
  voucherAccountId: string | null;
  advancePaymentsAccountId: string | null;
  otherPaymentAccountId: string | null;
  contractReceivableTransitAccountId: string | null;
  subsidyReceivableAccountId: string | null;
  subsidyCounterpartyId: string | null;
  // T1 kredit — prihodki
  revenueMaterial95AccountId: string | null;
  revenueMaterial22AccountId: string | null;
  revenueMaterial5AccountId: string | null;
  revenueGoods22AccountId: string | null;
  revenueGoods95AccountId: string | null;
  revenueGoods5AccountId: string | null;
  revenueService22AccountId: string | null;
  revenueService95AccountId: string | null;
  revenueService5AccountId: string | null;
  revenueServiceAccountId: string | null;
  // T1 kredit — DDV konti
  vat95AccountId: string | null;
  vat5AccountId: string | null;
  vat22AccountId: string | null;
  // T1 kredit — DDV kode (za KIR/vat_ledger)
  vat5VatCodeId: string | null;
  vat95VatCodeId: string | null;
  vat22VatCodeId: string | null;
  // T2 — prejemnice
  inventoryMaterialAccountId: string | null;
  inventoryGoodsAccountId: string | null;
  payablesAccountId: string | null;
  returnablePackagingAccountId: string | null;
  returnablePackagingWriteoffAccountId: string | null;
  nabavaObracunAccountId: string | null;
  inputVatAccountId: string | null;
  inputVat22AccountId: string | null;
  inputVat95AccountId: string | null;
  inputVat5AccountId: string | null;
  otherCostsAccountId: string | null;
  rawMaterialExpenseAccountId: string | null;
  inboundFreightExpenseAccountId: string | null;
  // T3 — COGS
  cogsMaterialAccountId: string | null;
  cogsGoodsAccountId: string | null;
  wasteAccountId: string | null;
  // T4 — lastna poraba / reprezentanca + KIR
  kirArAccountId: string | null;
  lastnaPorabaAccountId: string | null;
  reprezentancaAccountId: string | null;
  // Začetna zaloga — otvoritvena temeljnica
  openingBalanceAccountId: string | null;
  // zastareli fallback konti
  revenueAccountId: string | null;
  vatLiabilityAccountId: string | null;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
  salesBookingFrequency: "daily" | "monthly";
  consumptionBookingFrequency: "daily" | "monthly";
  frequencyEffectiveFrom: string | null;
}

export interface PosBookingVatCodeOption {
  id: string;
  code: string;
  description: string;
  rate: string | number;
}

export function getPosBookingVatCodesEndpoint(companyId: string): string {
  return `/api/companies/${companyId}/pos-booking-settings/vat-codes`;
}

export function formatPosBookingVatCode(option: PosBookingVatCodeOption): string {
  return `${option.code} — ${option.description}`;
}

const EMPTY_PBS: PosBookingSettingsData = {
  categoryRevenueAccounts: [],
  cashAccountId: null,
  bankAccountId: null,
  cashInTransitAccountId: null,
  cardAccountId: null,
  tipsLiabilityAccountId: null,
  tipsRevenueAccountId: null,
  tipsVatAccountId: null,
  tipsCardFeeExpenseAccountId: null,
  voucherAccountId: null,
  advancePaymentsAccountId: null,
  otherPaymentAccountId: null,
  contractReceivableTransitAccountId: null,
  subsidyReceivableAccountId: null,
  subsidyCounterpartyId: null,
  revenueMaterial95AccountId: null,
  revenueMaterial22AccountId: null,
  revenueMaterial5AccountId: null,
  revenueGoods22AccountId: null,
  revenueGoods95AccountId: null,
  revenueGoods5AccountId: null,
  revenueService22AccountId: null,
  revenueService95AccountId: null,
  revenueService5AccountId: null,
  revenueServiceAccountId: null,
  vat95AccountId: null,
  vat5AccountId: null,
  vat22AccountId: null,
  vat5VatCodeId: null,
  vat95VatCodeId: null,
  vat22VatCodeId: null,
  inventoryMaterialAccountId: null,
  inventoryGoodsAccountId: null,
  payablesAccountId: null,
  returnablePackagingAccountId: null,
  returnablePackagingWriteoffAccountId: null,
  nabavaObracunAccountId: null,
  inputVatAccountId: null,
  inputVat22AccountId: null,
  inputVat95AccountId: null,
  inputVat5AccountId: null,
  otherCostsAccountId: null,
  rawMaterialExpenseAccountId: null,
  inboundFreightExpenseAccountId: null,
  cogsMaterialAccountId: null,
  cogsGoodsAccountId: null,
  wasteAccountId: null,
  kirArAccountId: null,
  lastnaPorabaAccountId: null,
  reprezentancaAccountId: null,
  openingBalanceAccountId: null,
  revenueAccountId: null,
  vatLiabilityAccountId: null,
  inventoryAccountId: null,
  cogsAccountId: null,
  salesBookingFrequency: "daily",
  consumptionBookingFrequency: "monthly",
  frequencyEffectiveFrom: null,
};

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function TipManagementCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const today = localIsoDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [range, setRange] = useState({ from: monthStart, to: today });
  const [policyForm, setPolicyForm] = useState({
    effectiveFrom: today,
    mode: "direct_employee",
    evidenceType: "internal_rule",
    evidenceReference: "",
    agreementConfirmed: true,
    cardFeeTreatment: "employer_expense",
    cardFeeKind: "none",
    cardFeePercent: "",
    cardFeeFlatAmount: "",
    notes: "",
  });
  const [allocationForm, setAllocationForm] = useState({
    racunId: "",
    tipPolicyId: "",
    recipientNatakarId: "",
    grossAmount: "",
    feeAmount: "0",
    tipPoolId: "",
  });
  const [poolForm, setPoolForm] = useState({ name: "", tipPolicyId: "", decisionType: "employee_agreement", decisionDate: today, ruleReference: "", effectiveFrom: today, evidenceReference: "" });
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string, {
    method: "cash" | "bank" | "payroll" | "student_service";
    reference: string;
    employerDocumentType: "payroll" | "other_income" | "student_referral";
    employerDocumentReference: string;
  }>>({});

  const policiesQuery = useQuery<TipPolicy[]>({
    queryKey: ["tip-policies", companyId],
    queryFn: () => apiFetch<TipPolicy[]>(`/api/companies/${companyId}/tip-policies`),
    staleTime: 15_000,
  });
  const ledgerQuery = useQuery<TipAllocation[]>({
    queryKey: ["tips-ledger", companyId, range.from, range.to],
    queryFn: () => apiFetch<TipAllocation[]>(
      `/api/companies/${companyId}/tips-ledger?from=${range.from}&to=${range.to}`,
    ),
    staleTime: 15_000,
  });
  const poolsQuery = useQuery<{ pools: TipPool[] }>({
    queryKey: ["tip-pools", companyId],
    queryFn: () => apiFetch<{ pools: TipPool[] }>(`/api/companies/${companyId}/tip-pools`),
    staleTime: 15_000,
  });
  const natakariQuery = useListNatakari();

  const policies = policiesQuery.data ?? [];
  const activeNatakari = (natakariQuery.data ?? []).filter(natakar => natakar.aktiven);
  const activePolicy = policies.find(policy =>
    policy.enotaId == null
    && policy.effectiveFrom <= today
    && (policy.effectiveTo == null || policy.effectiveTo >= today)
  ) ?? null;
  const selectedAllocationPolicy = policies.find(policy => policy.id === allocationForm.tipPolicyId) ?? null;

  useEffect(() => {
    if (!allocationForm.tipPolicyId && activePolicy) {
      setAllocationForm(current => ({ ...current, tipPolicyId: activePolicy.id }));
    }
  }, [activePolicy, allocationForm.tipPolicyId]);

  const createPolicy = useMutation({
    mutationFn: () => apiFetch<TipPolicy>(`/api/companies/${companyId}/tip-policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effectiveFrom: policyForm.effectiveFrom,
        mode: policyForm.mode,
        evidenceType: policyForm.evidenceType,
        evidenceReference: policyForm.evidenceReference.trim(),
        agreementConfirmed: policyForm.agreementConfirmed,
        cardFeeTreatment: policyForm.mode === "employer_controlled" || policyForm.cardFeeKind === "flat"
          ? "employer_expense"
          : policyForm.cardFeeTreatment,
        cardFeeKind: policyForm.cardFeeKind,
        cardFeePercent: policyForm.cardFeeKind === "percentage" ? Number(policyForm.cardFeePercent) : null,
        cardFeeFlatAmount: policyForm.cardFeeKind === "flat" ? Number(policyForm.cardFeeFlatAmount) : null,
        notes: policyForm.notes.trim() || null,
      }),
    }),
    onSuccess: async () => {
      setPolicyForm(current => ({ ...current, evidenceReference: "", notes: "" }));
      await qc.invalidateQueries({ queryKey: ["tip-policies", companyId] });
    },
  });

  const createAllocation = useMutation({
    mutationFn: () => {
      const grossAmount = Number(allocationForm.grossAmount);
      const feeAmount = Number(allocationForm.feeAmount || 0);
      const selectedPool = (poolsQuery.data?.pools ?? []).find(pool => pool.id === allocationForm.tipPoolId);
      const selectedNatakar = activeNatakari.find(natakar => String(natakar.id) === allocationForm.recipientNatakarId);
      const isPoolAllocation = selectedAllocationPolicy?.mode === "independent_pool";
      return apiFetch<TipAllocation>(`/api/companies/${companyId}/tip-allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          racunId: Number(allocationForm.racunId),
          tipPolicyId: allocationForm.tipPolicyId,
          tipPoolId: isPoolAllocation ? allocationForm.tipPoolId || null : null,
          recipientNatakarId: isPoolAllocation ? null : Number(allocationForm.recipientNatakarId),
          recipientSnapshot: isPoolAllocation
            ? selectedPool?.name
            : selectedNatakar ? `${selectedNatakar.ime} ${selectedNatakar.priimek}`.trim() : undefined,
          grossAmount,
          feeAmount,
          netAmount: grossAmount - feeAmount,
        }),
      });
    },
    onSuccess: async () => {
      setAllocationForm(current => ({
        ...current,
        racunId: "",
        recipientNatakarId: "",
        grossAmount: "",
        feeAmount: "0",
      }));
      await qc.invalidateQueries({ queryKey: ["tips-ledger", companyId] });
    },
  });

  const createPool = useMutation({
    mutationFn: () => apiFetch<TipPool>(`/api/companies/${companyId}/tip-pools`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(poolForm),
    }),
    onSuccess: async () => {
      setPoolForm(current => ({ ...current, name: "", ruleReference: "", evidenceReference: "" }));
      await qc.invalidateQueries({ queryKey: ["tip-pools", companyId] });
    },
  });

  const settleAllocation = useMutation({
    mutationFn: ({ allocationId, method, reference, employerDocumentType, employerDocumentReference }: {
      allocationId: string;
      method: "cash" | "bank" | "payroll" | "student_service"; reference: string;
      employerDocumentType: "payroll" | "other_income" | "student_referral"; employerDocumentReference: string;
    }) => apiFetch(`/api/companies/${companyId}/tip-settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocationId,
        settlementMethod: method,
        settlementReference: reference.trim(),
        evidenceReference: reference.trim(),
        employerDocumentType: employerDocumentReference.trim() ? employerDocumentType : null,
        employerDocumentReference: employerDocumentReference.trim() || null,
        settledAt: new Date().toISOString(),
      }),
    }),
    onSuccess: async (_, variables) => {
      setSettlementDrafts(current => {
        const next = { ...current };
        delete next[variables.allocationId];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["tips-ledger", companyId] });
    },
  });

  const modeLabel: Record<string, string> = {
    direct_employee: "Neposredno zaposlenemu",
    independent_pool: "Neodvisni sklad zaposlenih",
    employer_controlled: "Pod nadzorom delodajalca",
  };
  const settlementLabel: Record<string, string> = {
    cash: "Gotovina",
    bank: "Nakazilo",
    payroll: "Plača",
    student_service: "Študentski servis",
  };
  const mutationError = createPolicy.error ?? createPool.error ?? createAllocation.error ?? settleAllocation.error;

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Napitnine — politika, dodelitve in poravnave</CardTitle>
        <CardDescription>
          Nova politika velja od izbranega datuma naprej. Račun ob izdaji shrani nespremenljiv posnetek takrat veljavne politike.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {activePolicy ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Za vse poslovne enote trenutno velja: <strong>{modeLabel[activePolicy.mode]}</strong>, od {formatDatum(activePolicy.effectiveFrom)}.
              {activePolicy.cardFeeKind === "percentage" && ` Provizija ${activePolicy.cardFeePercent ?? 0} %.`}
              {activePolicy.cardFeeKind === "flat" && ` Pavšalna provizija ${Number(activePolicy.cardFeeFlatAmount ?? 0).toFixed(2)} € je ločen strošek.`}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Za današnji dan ni veljavne politike napitnin za vse poslovne enote. Posamezne enote imajo lahko lastne politike, prikazane v zgodovini.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Neodvisni sklad zaposlenih</p>
            <p className="text-xs text-muted-foreground">Sklad je ločen od delodajalca in zahteva evidentirano odločitev/pravilo ter dokazilo.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input value={poolForm.name} onChange={e => setPoolForm(v => ({ ...v, name: e.target.value }))} placeholder="Ime sklada" />
            <Select value={poolForm.tipPolicyId} onValueChange={tipPolicyId => setPoolForm(v => ({ ...v, tipPolicyId }))}><SelectTrigger><SelectValue placeholder="Politika sklada" /></SelectTrigger><SelectContent>{policies.filter(p => p.mode === "independent_pool").map(p => <SelectItem key={p.id} value={p.id}>{formatDatum(p.effectiveFrom)}</SelectItem>)}</SelectContent></Select>
            <Select value={poolForm.decisionType} onValueChange={decisionType => setPoolForm(v => ({ ...v, decisionType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="employee_agreement">Dogovor zaposlenih</SelectItem><SelectItem value="collective_agreement">Kolektivna pogodba</SelectItem></SelectContent></Select>
            <Input type="date" value={poolForm.decisionDate} onChange={e => setPoolForm(v => ({ ...v, decisionDate: e.target.value }))} />
            <Input value={poolForm.ruleReference} onChange={e => setPoolForm(v => ({ ...v, ruleReference: e.target.value }))} placeholder="Sklic pravila/odločitve" />
            <Input value={poolForm.evidenceReference} onChange={e => setPoolForm(v => ({ ...v, evidenceReference: e.target.value }))} placeholder="Sklic dokazila" />
          </div>
          <Button size="sm" onClick={() => createPool.mutate()} disabled={createPool.isPending || !poolForm.tipPolicyId || !poolForm.name.trim() || !poolForm.ruleReference.trim() || !poolForm.evidenceReference.trim()}>Ustvari neodvisni sklad</Button>
          {(poolsQuery.data?.pools ?? []).length > 0 && <p className="text-xs text-muted-foreground">Evidentirani skladi: {(poolsQuery.data?.pools ?? []).map(pool => `${pool.name} (${pool.evidenceReference})`).join(", ")}</p>}
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Nova časovno veljavna politika</p>
            <p className="text-xs text-muted-foreground">
              Nova politika bo veljala za vse poslovne enote podjetja. Prejšnja splošna politika se samodejno zaključi dan pred začetkom nove.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Velja od</Label>
              <Input type="date" value={policyForm.effectiveFrom} onChange={e => setPolicyForm(v => ({ ...v, effectiveFrom: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Režim napitnin</Label>
              <Select value={policyForm.mode} onValueChange={mode => setPolicyForm(v => ({
                ...v,
                mode,
                cardFeeTreatment: mode === "employer_controlled" ? "employer_expense" : v.cardFeeTreatment,
              }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_employee">Neposredno zaposlenemu</SelectItem>
                  <SelectItem value="independent_pool">Neodvisni sklad zaposlenih</SelectItem>
                  <SelectItem value="employer_controlled">Pod nadzorom delodajalca — prihodek z DDV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Podlaga</Label>
              <Select value={policyForm.evidenceType} onValueChange={evidenceType => setPolicyForm(v => ({ ...v, evidenceType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employment_contract">Pogodba o zaposlitvi</SelectItem>
                  <SelectItem value="collective_agreement">Kolektivna pogodba</SelectItem>
                  <SelectItem value="internal_rule">Interni pravilnik</SelectItem>
                  <SelectItem value="other">Drugo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Sklic na podlago</Label>
              <Input value={policyForm.evidenceReference} onChange={e => setPolicyForm(v => ({ ...v, evidenceReference: e.target.value }))} placeholder="npr. Pravilnik o napitninah, člen 4" />
            </div>
            <div className="space-y-1.5">
              <Label>Vrsta kartične provizije</Label>
              <Select value={policyForm.cardFeeKind} onValueChange={cardFeeKind => setPolicyForm(v => ({
                ...v,
                cardFeeKind,
                cardFeeTreatment: cardFeeKind === "flat" ? "employer_expense" : v.cardFeeTreatment,
              }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez pripisane provizije</SelectItem>
                  <SelectItem value="percentage">Odstotek od napitnine</SelectItem>
                  <SelectItem value="flat">Pavšal na transakcijo — ločen strošek</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {policyForm.cardFeeKind !== "none" && (
              <div className="space-y-1.5">
                <Label>{policyForm.cardFeeKind === "percentage" ? "Provizija (%)" : "Pavšal (€)"}</Label>
                <Input
                  type="number"
                  min="0"
                  step={policyForm.cardFeeKind === "percentage" ? "0.0001" : "0.01"}
                  value={policyForm.cardFeeKind === "percentage" ? policyForm.cardFeePercent : policyForm.cardFeeFlatAmount}
                  onChange={e => setPolicyForm(v => policyForm.cardFeeKind === "percentage"
                    ? ({ ...v, cardFeePercent: e.target.value })
                    : ({ ...v, cardFeeFlatAmount: e.target.value }))}
                />
              </div>
            )}
            {policyForm.cardFeeKind === "percentage" && policyForm.mode !== "employer_controlled" && (
              <div className="space-y-1.5">
                <Label>Kdo nosi odstotno provizijo</Label>
                <Select value={policyForm.cardFeeTreatment} onValueChange={cardFeeTreatment => setPolicyForm(v => ({ ...v, cardFeeTreatment }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employer_expense">Delodajalec</SelectItem>
                    <SelectItem value="deduct_from_tip">Zaposleni — odbitek od napitnine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 lg:col-span-3">
              <Label>Opomba</Label>
              <Textarea value={policyForm.notes} onChange={e => setPolicyForm(v => ({ ...v, notes: e.target.value }))} rows={2} />
            </div>
            <label className="flex items-start gap-2 text-sm lg:col-span-3">
              <Checkbox checked={policyForm.agreementConfirmed} onCheckedChange={checked => setPolicyForm(v => ({ ...v, agreementConfirmed: checked === true }))} />
              <span>Potrjujem, da je dogovor z zaposlenimi dokumentiran in se ujema z izbrano podlago.</span>
            </label>
          </div>
          <Button
            onClick={() => createPolicy.mutate()}
            disabled={createPolicy.isPending || !policyForm.effectiveFrom || !policyForm.evidenceReference.trim()
              || ((policyForm.mode === "direct_employee" || policyForm.mode === "independent_pool") && !policyForm.agreementConfirmed)
              || (policyForm.cardFeeKind === "percentage" && !(Number(policyForm.cardFeePercent) > 0))
              || (policyForm.cardFeeKind === "flat" && !(Number(policyForm.cardFeeFlatAmount) > 0))}
          >
            {createPolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Uveljavi novo politiko
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Zgodovina politik</p>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Politike še niso vnesene.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Veljavnost</th><th className="p-2">Obseg</th><th className="p-2">Režim</th><th className="p-2">Podlaga</th><th className="p-2">Provizija</th></tr></thead>
                <tbody>{policies.map(policy => (
                  <tr key={policy.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{formatDatum(policy.effectiveFrom)}–{policy.effectiveTo ? formatDatum(policy.effectiveTo) : "naprej"}</td>
                    <td className="p-2 whitespace-nowrap">{policy.enotaId == null ? "Vse enote" : `Enota #${policy.enotaId}`}</td>
                    <td className="p-2">{modeLabel[policy.mode]}</td>
                    <td className="p-2">{policy.evidenceReference}</td>
                    <td className="p-2">
                      {policy.cardFeeKind === "none" && "brez"}
                      {policy.cardFeeKind === "percentage" && `${policy.cardFeePercent ?? 0} % · ${policy.cardFeeTreatment === "deduct_from_tip" ? "zaposleni" : "delodajalec"}`}
                      {policy.cardFeeKind === "flat" && `${Number(policy.cardFeeFlatAmount ?? 0).toFixed(2)} € · delodajalec`}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Ročna dodelitev napitnine z računa</p>
            <p className="text-xs text-muted-foreground">Sistem ne dovoli, da vsota dodelitev preseže razpoložljivo neto napitnino računa.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="space-y-1.5"><Label>ID računa</Label><Input type="number" value={allocationForm.racunId} onChange={e => setAllocationForm(v => ({ ...v, racunId: e.target.value }))} /></div>
            {selectedAllocationPolicy?.mode !== "independent_pool" && (
              <div className="space-y-1.5 lg:col-span-2">
                <Label>Natakar</Label>
                <Select value={allocationForm.recipientNatakarId} onValueChange={recipientNatakarId => setAllocationForm(v => ({ ...v, recipientNatakarId }))}>
                  <SelectTrigger><SelectValue placeholder={natakariQuery.isLoading ? "Nalagam natakarje …" : "Izberi natakarja"} /></SelectTrigger>
                  <SelectContent>
                    {activeNatakari.map(natakar => (
                      <SelectItem key={natakar.id} value={String(natakar.id)}>{natakar.ime} {natakar.priimek}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!natakariQuery.isLoading && activeNatakari.length === 0 && <p className="text-xs text-muted-foreground">V šifrantu ni aktivnih natakarjev.</p>}
              </div>
            )}
            <div className="space-y-1.5"><Label>Bruto (€)</Label><Input type="number" min="0" step="0.01" value={allocationForm.grossAmount} onChange={e => setAllocationForm(v => ({ ...v, grossAmount: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Odbita provizija (€)</Label><Input type="number" min="0" step="0.01" value={allocationForm.feeAmount} onChange={e => setAllocationForm(v => ({ ...v, feeAmount: e.target.value }))} /></div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label>Politika računa</Label>
              <Select value={allocationForm.tipPolicyId} onValueChange={tipPolicyId => setAllocationForm(v => ({ ...v, tipPolicyId }))}>
                <SelectTrigger><SelectValue placeholder="Izberi politiko" /></SelectTrigger>
                <SelectContent>{policies.map(policy => <SelectItem key={policy.id} value={policy.id}>{policy.effectiveFrom} · {modeLabel[policy.mode]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedAllocationPolicy?.mode === "independent_pool" && <div className="min-w-0 flex-1 space-y-1.5"><Label>Neodvisni sklad</Label><Select value={allocationForm.tipPoolId} onValueChange={tipPoolId => setAllocationForm(v => ({ ...v, tipPoolId }))}><SelectTrigger><SelectValue placeholder="Izberi sklad" /></SelectTrigger><SelectContent>{(poolsQuery.data?.pools ?? []).map(pool => <SelectItem key={pool.id} value={pool.id}>{pool.name}</SelectItem>)}</SelectContent></Select></div>}
            <div className="text-sm"><span className="text-muted-foreground">Neto: </span><strong>{Math.max(0, Number(allocationForm.grossAmount || 0) - Number(allocationForm.feeAmount || 0)).toFixed(2)} €</strong></div>
            <Button onClick={() => createAllocation.mutate()} disabled={createAllocation.isPending || !allocationForm.racunId || !allocationForm.tipPolicyId || (selectedAllocationPolicy?.mode === "independent_pool" ? !allocationForm.tipPoolId : !allocationForm.recipientNatakarId) || !(Number(allocationForm.grossAmount) > 0) || Number(allocationForm.feeAmount) < 0 || Number(allocationForm.feeAmount) > Number(allocationForm.grossAmount)}>
              {createAllocation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Dodaj dodelitev
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-medium">Evidenca dodelitev in poravnav</p><p className="text-xs text-muted-foreground">Poravnane dodelitve ostanejo trajno vidne.</p></div>
            <div className="flex gap-2">
              <Input aria-label="Od datuma" type="date" value={range.from} onChange={e => setRange(v => ({ ...v, from: e.target.value }))} />
              <Input aria-label="Do datuma" type="date" value={range.to} onChange={e => setRange(v => ({ ...v, to: e.target.value }))} />
            </div>
          </div>
          {(ledgerQuery.data ?? []).length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">V izbranem obdobju ni dodelitev.</p>
          ) : (ledgerQuery.data ?? []).map(allocation => {
            const draft = settlementDrafts[allocation.id] ?? { method: "bank" as const, reference: "", employerDocumentType: "payroll" as const, employerDocumentReference: "" };
            return (
              <div key={allocation.id} className="rounded-lg border p-3 text-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><strong>{allocation.recipientSnapshot}</strong> · račun #{allocation.racunId} · neto {Number(allocation.netAmount).toFixed(2)} €</div>
                  <Badge variant={allocation.status === "settled" ? "default" : allocation.status === "cancelled" ? "destructive" : "secondary"}>
                    {allocation.status === "settled" ? "poravnano" : allocation.status === "cancelled" ? "razveljavljeno" : "odprto"}
                  </Badge>
                </div>
                {allocation.status === "open" && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_12rem_1fr_auto]">
                    <Select value={draft.method} onValueChange={(method: "cash" | "bank" | "payroll" | "student_service") => setSettlementDrafts(v => ({ ...v, [allocation.id]: { ...draft, method } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(settlementLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={draft.reference} onChange={e => setSettlementDrafts(v => ({ ...v, [allocation.id]: { ...draft, reference: e.target.value } }))} placeholder="Sklic dokazila o nakazilu / izplačilu" />
                    <Select value={draft.employerDocumentType} onValueChange={(employerDocumentType: "payroll" | "other_income" | "student_referral") => setSettlementDrafts(v => ({ ...v, [allocation.id]: { ...draft, employerDocumentType } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="payroll">Plača</SelectItem><SelectItem value="other_income">Drug dohodek</SelectItem><SelectItem value="student_referral">Študentska napotnica</SelectItem></SelectContent></Select>
                    <Input value={draft.employerDocumentReference} onChange={e => setSettlementDrafts(v => ({ ...v, [allocation.id]: { ...draft, employerDocumentReference: e.target.value } }))} placeholder="Sklic obračuna (za delodajalca)" />
                    <Button size="sm" onClick={() => settleAllocation.mutate({ allocationId: allocation.id, method: draft.method, reference: draft.reference, employerDocumentType: draft.employerDocumentType, employerDocumentReference: draft.employerDocumentReference })} disabled={!draft.reference.trim() || settleAllocation.isPending}>Označi poravnano</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {mutationError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{mutationError instanceof Error ? mutationError.message : "Operacija ni uspela."}</AlertDescription></Alert>}
      </CardContent>
    </Card>
  );
}

function PosKnjizenjeTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PosBookingSettingsData>(EMPTY_PBS);
  const [saved, setSaved] = useState(false);
  const [syncDatum, setSyncDatum] = useState(() => new Date().toISOString().slice(0, 10));
  const [syncResult, setSyncResult] = useState<{ created: string[]; skipped: Array<{ ref: string; reason: string }> } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [tipJournal, setTipJournal] = useState<TipJournalPreview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncRangeFrom, setSyncRangeFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [syncRangeTo, setSyncRangeTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [syncRangeProgress, setSyncRangeProgress] = useState<{ completed: number; total: number } | null>(null);
  const [syncRangeResult, setSyncRangeResult] = useState<{ created: string[]; skipped: Array<{ ref: string; reason: string }> } | null>(null);
  const [syncRangeError, setSyncRangeError] = useState<string | null>(null);
  const [syncingRange, setSyncingRange] = useState(false);
  // Mesečni sync
  const [syncMesec, setSyncMesec] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [syncMesecResult, setSyncMesecResult] = useState<{ created: string[]; skipped: Array<{ ref: string; reason: string }> } | null>(null);
  const [syncMesecError, setSyncMesecError] = useState<string | null>(null);
  const [tipJournalMesec, setTipJournalMesec] = useState<TipJournalPreview | null>(null);
  const [syncingMesec, setSyncingMesec] = useState(false);

  // ── DDV zaključek nastavitve (neto konti) ─────────────────────────────────
  const [ddvForm, setDdvForm] = useState<{ netoObveznostAccountId: string | null; netoTerjatevAccountId: string | null }>({
    netoObveznostAccountId: null,
    netoTerjatevAccountId: null,
  });
  const [ddvSaved, setDdvSaved] = useState(false);

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
  const { data: counterpartiesData, isLoading: counterpartiesLoading } = useListCounterparties(
    companyId,
    { includeInactive: false },
    { query: { enabled: !!companyId } as any },
  );
  const counterparties = counterpartiesData?.counterparties ?? [];

  // Te nastavitve so vedno knjižne vrstice: skupinski, neaktivni in kratki konti niso veljavna izbira.
  const accounts = (accountsData?.accounts ?? []).filter(
    a => a.isActive && a.allowsPosting && /^\d{7}$/.test(a.code),
  );

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

  // ── DDV zaključek nastavitve — query + mutation ───────────────────────────
  const { data: ddvSettings } = useQuery<{ netoObveznostAccountId: string | null; netoTerjatevAccountId: string | null } | null>({
    queryKey: ["ddv-zakljucek-settings", companyId],
    queryFn: () => apiFetch<{ netoObveznostAccountId: string | null; netoTerjatevAccountId: string | null } | null>(
      `/api/companies/${companyId}/ddv-zakljucek-settings`
    ),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (ddvSettings) {
      setDdvForm({
        netoObveznostAccountId: ddvSettings.netoObveznostAccountId ?? null,
        netoTerjatevAccountId: ddvSettings.netoTerjatevAccountId ?? null,
      });
    }
  }, [ddvSettings]);

  const saveDdvMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ netoObveznostAccountId: string | null; netoTerjatevAccountId: string | null }>(
        `/api/companies/${companyId}/ddv-zakljucek-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ddvForm),
        },
      ),
    onSuccess: () => {
      setDdvSaved(true);
      void qc.invalidateQueries({ queryKey: ["ddv-zakljucek-settings", companyId] });
      setTimeout(() => setDdvSaved(false), 3000);
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
      setTipJournal(await apiFetch<TipJournalPreview>(
        `/api/companies/${companyId}/pos-booking-settings/tip-journal/${syncDatum}/${syncDatum}`,
      ));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncMesec = async () => {
    setSyncingMesec(true);
    setSyncMesecResult(null);
    setSyncMesecError(null);
    try {
      const r = await apiFetch<{ created: string[]; skipped: Array<{ ref: string; reason: string }> }>(
        `/api/companies/${companyId}/pos-booking-settings/sync-month/${syncMesec}`,
        { method: "POST" },
      );
      setSyncMesecResult(r);
      const monthStart = `${syncMesec}-01`;
      const monthEnd = new Date(Date.UTC(Number(syncMesec.slice(0, 4)), Number(syncMesec.slice(5, 7)), 0))
        .toISOString().slice(0, 10);
      setTipJournalMesec(await apiFetch<TipJournalPreview>(
        `/api/companies/${companyId}/pos-booking-settings/tip-journal/${monthStart}/${monthEnd}`,
      ));
    } catch (err) {
      setSyncMesecError(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncingMesec(false);
    }
  };

  const handleSyncRange = async () => {
    setSyncingRange(true);
    setSyncRangeProgress(null);
    setSyncRangeResult(null);
    setSyncRangeError(null);
    try {
      const response = await fetch(`/api/companies/${companyId}/pos-booking-settings/sync-range`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: syncRangeFrom, to: syncRangeTo }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Strežnik ni vrnil napredka sinhronizacije");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: "progress" | "complete" | "error";
            completed?: number;
            total?: number;
            created?: string[];
            skipped?: Array<{ ref: string; reason: string }>;
            error?: string;
          };
          if (event.type === "progress") {
            setSyncRangeProgress({ completed: event.completed ?? 0, total: event.total ?? 0 });
          } else if (event.type === "complete") {
            setSyncRangeProgress({ completed: event.total ?? 0, total: event.total ?? 0 });
            setSyncRangeResult({ created: event.created ?? [], skipped: event.skipped ?? [] });
            completed = true;
          } else if (event.type === "error") {
            throw new Error(event.error ?? "Napaka pri sinhronizaciji POS temeljnic");
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error("Sinhronizacija se je končala brez povzetka");
    } catch (err) {
      setSyncRangeError(err instanceof Error ? err.message : "Neznana napaka");
    } finally {
      setSyncingRange(false);
    }
  };

  const setField = (field: keyof PosBookingSettingsData, value: string | null) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  function AccountSelect({
    label,
    field,
    description,
    prefixes,
    excludePrefixes,
  }: {
    label: string;
    field: keyof PosBookingSettingsData;
    description?: string;
    prefixes?: string[];
    excludePrefixes?: string[];
  }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const value = form[field] ?? null;
    const selected = accounts.find(a => a.id === value);

    const prefixAllowed = prefixes?.length
      ? accounts.filter(a => prefixes.some(prefix => a.code.startsWith(prefix)))
      : accounts;
    const allowed = excludePrefixes?.length
      ? prefixAllowed.filter(a => !excludePrefixes.some(prefix => a.code.startsWith(prefix)))
      : prefixAllowed;
    const filtered = query.trim() === ""
      ? allowed
      : allowed.filter(a =>
          a.code.toLowerCase().includes(query.toLowerCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase())
        );

    return (
      <div className="min-w-0 space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full min-w-0 justify-between gap-2 font-normal text-sm h-9"
            >
              {selected
                ? <span className="min-w-0 flex-1 truncate text-left"><span className="font-mono text-xs">{selected.code}</span> — {selected.name}</span>
                : <span className="text-muted-foreground">— ni nastavljen —</span>}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[calc(100vw-2rem)] max-w-[30rem] p-0"
            align="start"
            collisionPadding={8}
          >
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
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono text-xs w-16 shrink-0">{a.code}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
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

  // ── AccountSelectSimple — generični izbirnik konta (brez vezave na form polje) ─

  function AccountSelectSimple({
    label,
    description,
    value,
    onChange,
    emptyLabel = "— ni nastavljen (samodejno) —",
    allowedTypes,
  }: {
    label: string;
    description?: string;
    value: string | null;
    onChange: (v: string | null) => void;
    emptyLabel?: string;
    allowedTypes?: string[];
  }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const allowedAccounts = allowedTypes?.length
      ? accounts.filter((account) => allowedTypes.includes(account.type))
      : accounts;
    const selected = allowedAccounts.find(a => a.id === value);
    const filtered = query.trim() === ""
      ? allowedAccounts
      : allowedAccounts.filter(a =>
          a.code.toLowerCase().includes(query.toLowerCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase())
        );
    return (
      <div className="min-w-0 space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full min-w-0 justify-between gap-2 font-normal text-sm h-9"
            >
              {selected
                ? <span className="min-w-0 flex-1 truncate text-left"><span className="font-mono text-xs">{selected.code}</span> — {selected.name}</span>
                : <span className="text-muted-foreground">{emptyLabel}</span>}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[calc(100vw-2rem)] max-w-[30rem] p-0"
            align="start"
            collisionPadding={8}
          >
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
                    onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                    <span className="text-muted-foreground">{emptyLabel}</span>
                  </CommandItem>
                  {filtered.map(a => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => { onChange(a.id); setOpen(false); setQuery(""); }}
                      className={!a.allowsPosting ? "opacity-60" : ""}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono text-xs w-16 shrink-0">{a.code}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
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

  // DDV kode iz istega globalnega FURS vira kot POS (za vat_ledger integracijo).
  // Pos_booking_settings hrani UUID-je iz tabele vat_code, zato mora seznam
  // dropdowna uporabljati isti endpoint in isti response shape kot POS.
  const { data: vatCodesData } = useQuery({
    queryKey: ["pos-booking-settings-vat-codes", companyId],
    queryFn: () => apiFetch<{ vatCodes: PosBookingVatCodeOption[] }>(
      getPosBookingVatCodesEndpoint(companyId),
    ),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  const vatCodes = vatCodesData?.vatCodes ?? [];
  // Endpoint že vrne samo veljavne izhodne (KIR) FURS kode.
  const outVatCodes = vatCodes;

  function VatCodeSelect({
    label,
    field,
    description,
    warnMsg,
  }: {
    label: string;
    field: keyof PosBookingSettingsData;
    description?: string;
    /** Opozorilo, ki se prikaže pod izbornikom, ko je vrednost NULL */
    warnMsg?: string;
  }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const value = form[field] ?? null;
    const selected = outVatCodes.find(v => v.id === value);
    const showWarn = value === null && !!warnMsg;

    const filtered = query.trim() === ""
      ? outVatCodes
      : outVatCodes.filter(v =>
          v.code.toLowerCase().includes(query.toLowerCase()) ||
          v.description.toLowerCase().includes(query.toLowerCase())
        );

    return (
      <div className="min-w-0 space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full min-w-0 justify-between gap-2 font-normal text-sm h-9"
            >
              {selected
                ? <span className="min-w-0 flex-1 truncate text-left">{formatPosBookingVatCode(selected)}</span>
                : <span className="text-muted-foreground">— ni nastavljena —</span>}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[calc(100vw-2rem)] max-w-[30rem] p-0"
            align="start"
            collisionPadding={8}
          >
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
                    <span className="text-muted-foreground">— ni nastavljena —</span>
                  </CommandItem>
                  {filtered.map(v => (
                    <CommandItem
                      key={v.id}
                      value={v.id}
                      onSelect={() => { setField(field, v.id); setOpen(false); setQuery(""); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === v.id ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono text-xs w-24 shrink-0">{v.code}</span>
                        <span className="min-w-0 flex-1 truncate">{v.description}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {showWarn && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 dark:border-amber-700 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800 dark:text-amber-300">{warnMsg}</p>
          </div>
        )}
      </div>
    );
  }

  if (settingsLoading || accountsLoading || counterpartiesLoading) {
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
          Samodejno se osvežujejo samo osnutki za POS prodajo in porabo.
          Prejemnico prenese v osnutek glavne knjige izključno računovodja z ročnim dejanjem.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Frekvenca POS zbirnikov — raven podjetja</CardTitle>
          <CardDescription>
            Prodaja in poraba imata ločeni frekvenci. Sprememba se uporabi prvi dan naslednjega meseca, zato tekoči mesec ostane nespremenjen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-w-0 space-y-1.5">
            <Label>Prodaja</Label>
            <Select value={form.salesBookingFrequency} onValueChange={(value) => setField("salesBookingFrequency", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Dnevno</SelectItem>
                <SelectItem value="monthly">Mesečno</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label>Poraba</Label>
            <Select value={form.consumptionBookingFrequency} onValueChange={(value) => setField("consumptionBookingFrequency", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Dnevno</SelectItem>
                <SelectItem value="monthly">Mesečno (priporočeno)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground lg:col-span-2">
            {form.frequencyEffectiveFrom
              ? `Naslednja sprememba začne veljati ${form.frequencyEffectiveFrom}.`
              : "Ob spremembi se datum uveljavitve samodejno nastavi na 1. naslednjega meseca."}
          </p>
        </CardContent>
      </Card>

      {/* Temeljnica 1: Prodaja — Debet (plačila) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 1 — Dnevna prodaja · Plačilni načini (debet)</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:PRODAJA:YYYY-MM-DD</code>
            {" · "}Vsak plačilni način se knjiži na ločen konto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect label="Blagajna — gotovina" field="cashAccountId" description="Debet — npr. 1000000" />
          <AccountSelect label="Kartica / POS terminal" field="cardAccountId" description="Debet — npr. 1092000 (denar na poti – kartice) ali 1102000" />
          <AccountSelect label="Napitnine — obveznost do osebja" field="tipsLiabilityAccountId" description="Kredit — ločena obveznost za kartične napitnine; ne knjiži se med prodajne prihodke ali prodajne DDV vrstice." />
           <AccountSelect label="Napitnine — prihodek delodajalca" field="tipsRevenueAccountId" prefixes={["76"]} description="Kredit — samo za režim pod nadzorom delodajalca; ločeno od redne prodaje." />
           <AccountSelect label="Napitnine — izhodni DDV" field="tipsVatAccountId" prefixes={["260"]} description="Kredit — ločen analitični konto DDV obdavčljivih napitnin." />
           <AccountSelect label="Napitnine — kartična provizija" field="tipsCardFeeExpenseAccountId" prefixes={["4"]} description="Debet — samo odstotni del provizije, ki ga po politiki nosi delodajalec. Pavšal se napitnini ne pripiše." />
          <AccountSelect label="Bon za pico" field="voucherAccountId" description="Debet — npr. 2301000" />
          <AccountSelect label="Darilni boni (predplačila 230)" field="advancePaymentsAccountId" prefixes={["23"]} description="Izdaja: kredit predplačil; unovčitev: debet, npr. 2301000" />
           <AccountSelect label="Študentski boni — terjatev" field="subsidyReceivableAccountId" prefixes={["16"]} description="Debet — npr. 1650000/1651000" />
          <AccountSelect label="Ostalo (Sodexo, TRR kupci…)" field="otherPaymentAccountId" description="Debet — catch-all za negotovinska plačila" />
          <AccountSelect label="Pogodbene malice — prehodna terjatev" field="contractReceivableTransitAccountId" prefixes={["16"]} description="Dnevno debet; mesečni A-račun ga zapre v dobro in prenese znesek na konto 120." />
            <div className="min-w-0 space-y-1.5">
             <Label className="text-sm font-medium">Partner za študentske bone</Label>
             <p className="text-xs text-muted-foreground">MDDSZ/ŠOS, ki poravna subvencionirani del prodaje.</p>
             <Select
               value={form.subsidyCounterpartyId ?? "none"}
               onValueChange={(value) => setField("subsidyCounterpartyId", value === "none" ? null : value)}
             >
               <SelectTrigger>
                 <SelectValue placeholder="— ni nastavljen —" />
               </SelectTrigger>
               <SelectContent>
                 <SelectItem value="none">— ni nastavljen —</SelectItem>
                 {counterparties.map((counterparty) => (
                   <SelectItem key={counterparty.id} value={counterparty.id}>
                     {counterparty.name}{counterparty.taxId ? ` (${counterparty.taxId})` : ""}
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Blagajniški prenosi med TRR in gotovino</CardTitle>
          <CardDescription>
            Blagajniški premiki se ne štejejo med prihodke, stroške ali DDV. POS stopnja prenosa se vedno knjiži prek prehodnega konta 109/1090000.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
           <AccountSelect label="TRR (110)" field="bankAccountId" prefixes={["110"]} excludePrefixes={["109"]} description="Bančna stopnja ob bančnem izpisku — npr. 1100000" />
           <AccountSelect label="Denar na poti (109)" field="cashInTransitAccountId" prefixes={["109"]} description="Obvezen prehodni konto za TRR ↔ blagajna — npr. 1090000" />
        </CardContent>
      </Card>

      {/* Temeljnica 1: Prodaja — Kredit (prihodki) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Temeljnica 1 — Dnevna prodaja · Prihodki po POS kategorijah (kredit)</CardTitle>
          <CardDescription>
            Neto prihodki se razdelijo po POS kategorijah, DDV pa ostane ločen po stopnjah.
            Kategorija brez izbranega konta uporabi splošni konto prihodkov.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Konti po POS kategorijah</p>
                <p className="text-xs text-muted-foreground">
                  Nastavitev velja za dnevne in mesečne temeljnice ter KIR.
                </p>
              </div>
              <Badge variant="outline">
                {form.categoryRevenueAccounts.filter((mapping) => mapping.accountId !== null).length}
                /{form.categoryRevenueAccounts.length} nastavljenih
              </Badge>
            </div>
            {settingsLoading ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : form.categoryRevenueAccounts.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Podjetje še nima POS kategorij.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {form.categoryRevenueAccounts.map((mapping) => (
                  <AccountSelectSimple
                    key={mapping.categoryId}
                    label={`${mapping.unitName} · ${mapping.categoryName}`}
                    description={`POS kategorija #${mapping.categoryId}`}
                    value={mapping.accountId}
                    emptyLabel="— uporabi splošni konto prihodkov —"
                    allowedTypes={["revenue"]}
                    onChange={(accountId) => {
                      setForm((current) => ({
                        ...current,
                        categoryRevenueAccounts: current.categoryRevenueAccounts.map((item) =>
                          item.categoryId === mapping.categoryId ? { ...item, accountId } : item,
                        ),
                      }));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 border-t pt-4 lg:grid-cols-2">
            <AccountSelect
              label="Splošni prihodki (fallback)"
              field="revenueAccountId"
              description="Obvezen za vse POS kategorije brez lastne preslikave"
            />
          </div>
          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Združljivost s starejšimi postavkami</p>
              <p className="text-xs text-muted-foreground">
                Spodnji konti so zadnji varnostni fallback, kadar kategorija nima preslikave in splošni konto ni nastavljen.
              </p>
            </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
             <AccountSelect label="Hrana (kuhinja) 9,5 % — storitev" field="revenueService95AccountId" prefixes={["760"]} description="Kredit — npr. 7601200" />
             <AccountSelect label="Točene pijače 22 % — storitev" field="revenueService22AccountId" prefixes={["760"]} description="Kredit — npr. 7601100" />
             <AccountSelect label="Steklenice 22 % — blago" field="revenueGoods22AccountId" description="Kredit — npr. 7620100" />
             <AccountSelect label="Steklenice brezalkoholne 9,5 % — blago" field="revenueGoods95AccountId" description="Kredit — npr. 7620200" />
             <AccountSelect label="Blago 5 %" field="revenueGoods5AccountId" description="Kredit — npr. 7620300" />
             <AccountSelect label="Material 22 % — samo za artikle vrste material" field="revenueMaterial22AccountId" description="Kredit — posebni primeri materiala" />
             <AccountSelect label="Material 9,5 % — samo za artikle vrste material" field="revenueMaterial95AccountId" description="Kredit — posebni primeri materiala" />
            <AccountSelect label="Material 5 % — samo za artikle vrste material" field="revenueMaterial5AccountId" description="Kredit — posebni primeri materiala" />
             <AccountSelect label="Storitev 5 % — ostale storitve" field="revenueService5AccountId" prefixes={["760"]} description="Kredit — npr. 7601300" />
          </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t">
             <AccountSelect label="DDV 5 % — obveznost" field="vat5AccountId" prefixes={["260"]} description="Kredit — npr. 2602000" />
             <AccountSelect label="DDV 9,5 % — obveznost" field="vat95AccountId" description="Kredit — npr. 2601000" />
             <AccountSelect label="DDV 22 % — obveznost" field="vat22AccountId" description="Kredit — npr. 2600000" />
            <AccountSelect label="Splošni DDV (fallback)" field="vatLiabilityAccountId" description="Kredit — rezerva, če DDV po stopnji ni nastavljeno" />
          </div>
          {/* DDV kode za vat_ledger (KIR) integracija — #138 / #215 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t">
            <div className="lg:col-span-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                FURS DDV kode — za samodejni vpis v Knjigo izdanih računov (KIR)
              </p>
              {/* Zbirno opozorilo — prikaže se, ko katera koli od ključnih preslikav (9,5 % ali 22 %) manjka */}
              {(form.vat95VatCodeId == null || form.vat22VatCodeId == null) && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                    <p className="font-medium">Preslikava DDV kod za POS ni popolna.</p>
                    <p>
                      POS promet{" "}
                      {[
                        form.vat95VatCodeId == null && "9,5 %",
                        form.vat22VatCodeId == null && "22 %",
                      ].filter(Boolean).join(" in ")}{" "}
                      ne bo samodejno vpisan v DDV obračun (KIR). Nastavi manjkajoče kode spodaj.
                    </p>
                  </div>
                </div>
              )}
              {/* Opozorilo samo za 5 % — manj alarmantno, ker je stopnja redka */}
              {form.vat95VatCodeId != null && form.vat22VatCodeId != null && form.vat5VatCodeId == null && (
                <p className="text-xs text-muted-foreground">
                  DDV koda za 5 % ni nastavljena — če POS ne zaračunava te stopnje, to ni potrebno.
                </p>
              )}
            </div>
            <VatCodeSelect
              label="DDV koda 5 %"
              field="vat5VatCodeId"
              description="Za DDV vrstice v POS temeljnicah (izhodni DDV 5 %, npr. S5)"
              warnMsg="Ni nastavljeno — POS promet po stopnji 5 % ne bo zajet v KIR/DDV obračun. Nastavi, če podjetje zaračunava DDV 5 %."
            />
            <VatCodeSelect
              label="DDV koda 9,5 %"
              field="vat95VatCodeId"
              description="Za DDV vrstice v POS temeljnicah (izhodni DDV 9,5 %)"
              warnMsg="Ni nastavljeno — POS promet po stopnji 9,5 % ne bo zajet v KIR/DDV obračun. To je pogosta stopnja v gostinstvu."
            />
            <VatCodeSelect
              label="DDV koda 22 %"
              field="vat22VatCodeId"
              description="Za DDV vrstice v POS temeljnicah (izhodni DDV 22 %)"
              warnMsg="Ni nastavljeno — POS promet po stopnji 22 % ne bo zajet v KIR/DDV obračun."
            />
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
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect label="Zaloga materiala (razred 3)" field="inventoryMaterialAccountId" description="Debet — npr. 3100000 (živila 3101000, pijača 3102000)" />
          <AccountSelect label="Zaloga blaga (razred 6)" field="inventoryGoodsAccountId" description="Debet — npr. 6600000" />
          <AccountSelect label="Splošna zaloga (fallback)" field="inventoryAccountId" description="Debet — rezerva" />
          <AccountSelect label="Obveznosti do dobaviteljev" field="payablesAccountId" description="Kredit — npr. 2200000" />
          <AccountSelect label="Zaloga povratne embalaže" field="returnablePackagingAccountId" description="Debet — konto 3107000" />
          <AccountSelect label="Strošek odpisa povratne embalaže" field="returnablePackagingWriteoffAccountId" prefixes={["4"]} description="Debet pri razbitju/uničenju — konto razreda 4" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nabava in vstopni DDV</CardTitle>
          <CardDescription>
            Konti so pripravljeni za prihodnjo nabavno temeljnico; ta korak še ne ustvarja knjižb.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect label="Obračun nabave" field="nabavaObracunAccountId" prefixes={["10"]} description="Prehodni konto nabave — npr. 3000000" />
          <AccountSelect label="Vstopni DDV 22 %" field="inputVat22AccountId" prefixes={["16"]} description="Debet — npr. 1600000" />
          <AccountSelect label="Vstopni DDV 9,5 %" field="inputVat95AccountId" prefixes={["16"]} description="Debet — npr. 1601000" />
          <AccountSelect label="Vstopni DDV 5 %" field="inputVat5AccountId" prefixes={["16"]} description="Debet — npr. 1602000" />
          <AccountSelect label="Vstopni DDV (privzeti)" field="inputVatAccountId" prefixes={["16"]} description="Uporabi se, če za stopnjo ni ločenega konta." />
          <AccountSelect label="Ostali stroški" field="otherCostsAccountId" prefixes={["48", "41"]} description="Stroški, ki se pri prejemnici ne kapitalizirajo v zalogo." />
          <AccountSelect label="Strošek surovin (neposredna poraba)" field="rawMaterialExpenseAccountId" prefixes={["40", "41", "48"]} description="Debet za vrstico poraba_surovin; brez artikla in brez zalogovnega prometa." />
          <AccountSelect label="Prevozne storitve pri nabavi" field="inboundFreightExpenseAccountId" prefixes={["41", "48"]} description="Debet za vrstico prevoz; brez artikla in brez zalogovnega prometa." />
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
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect label="Stroški materiala po normativih" field="cogsMaterialAccountId" description="Debet — npr. 4000000 (živila 4002000, pijača 4003000)" />
          <AccountSelect label="Nabavna vrednost prod. blaga (NVPB)" field="cogsGoodsAccountId" description="Debet — npr. 7000000" />
          <AccountSelect label="Kalo pripravljene hrane" field="wasteAccountId" description="Debet kala; isti znesek se prenese v dobro s konta stroškov materiala." />
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
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect
            label="Terjatve do kupcev — KIR (AR)"
            field="kirArAccountId"
            description="Obvezno za KIR — npr. 1200000"
          />
          <div className="flex items-center text-xs text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 self-end">
            Če ni nastavljeno, se KIR preskoči. B2B partnerji se najdejo/ustvarijo po davčni številki.
          </div>
          <AccountSelect
            label="Odhodki — lastna poraba"
            field="lastnaPorabaAccountId"
            description="Debet v T4 — npr. 4809000"
          />
          <AccountSelect
            label="Odhodki — reprezentanca"
            field="reprezentancaAccountId"
            description="Debet v T4 — npr. 4141000"
          />
        </CardContent>
      </Card>

      {/* Začetna zaloga */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Začetna zaloga — otvoritvena temeljnica</CardTitle>
          <CardDescription>
            Referenca: <code className="text-xs bg-muted px-1 rounded">POS:ZZ:LLLL</code>
            {" · "}Debet = konto zalog (iz T2) · Kredit = otvoritveni konto bilance stanja.
            <br />
            Temeljnica se samodejno ustvari, ko v POS vnesete začetne zaloge za novo leto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelect
            label="Otvoritveni konto bilance stanja"
            field="openingBalanceAccountId"
            description="Kredit — npr. 9000000"
          />
          <div className="flex items-center text-xs text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 self-end">
            Debet = konto zalog iz T2 (razred 3 za material, razred 6 za blago), razčlenjen po vrsti artikla.
          </div>
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
          <TipJournalCard preview={tipJournal} />

          {syncError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Ročna sinhronizacija obsega */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Ročna sinhronizacija obsega
          </CardTitle>
          <CardDescription>
            Za vsak dan v izbranem obdobju zaporedoma ustvari ali osveži POS osnutke. Obseg je omejen na največ 366 dni.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label htmlFor="sync-range-from">Od</Label>
              <Input id="sync-range-from" type="date" value={syncRangeFrom} onChange={e => setSyncRangeFrom(e.target.value)} className="w-44" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sync-range-to">Do</Label>
              <Input id="sync-range-to" type="date" value={syncRangeTo} onChange={e => setSyncRangeTo(e.target.value)} className="w-44" />
            </div>
            <Button onClick={() => void handleSyncRange()} disabled={syncingRange} variant="outline" className="gap-2">
              {syncingRange ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncingRange ? "Sinhroniziram…" : "Sinhroniziraj obseg"}
            </Button>
          </div>

          {syncRangeProgress && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex justify-between text-sm">
                <span>Napredek sinhronizacije</span>
                <span className="tabular-nums">{syncRangeProgress.completed}/{syncRangeProgress.total} dni</span>
              </div>
              <Progress value={syncRangeProgress.total > 0 ? (syncRangeProgress.completed / syncRangeProgress.total) * 100 : 0} />
            </div>
          )}

          {syncRangeResult && (
            <Alert className={syncRangeResult.skipped.length > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}>
              {syncRangeResult.skipped.length > 0 ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <AlertDescription>
                Ustvarjenih temeljnic: <strong>{syncRangeResult.created.length}</strong>.
                Preskočenih: <strong>{syncRangeResult.skipped.length}</strong>.
                {syncRangeResult.skipped.length > 0 && (
                  <ul className="mt-2 list-disc list-inside space-y-0.5 text-xs">
                    {syncRangeResult.skipped.map((item, index) => <li key={index}><code>{item.ref}</code>: {item.reason}</li>)}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          {syncRangeError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncRangeError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Mesečni zbirnik — ročni trigger */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Mesečni POS zbirnik — ročna generacija
          </CardTitle>
          <CardDescription>
            Ustvari osnutke mesečnih temeljnic prodaje, lastne porabe in porabe blaga za zaključeni mesec.
            Deluje samo za enote z nastavljeno mesečno frekvenco in za mesece, ki so že v celoti pretekli.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              type="month"
              value={syncMesec}
              onChange={e => setSyncMesec(e.target.value)}
              className="w-44"
            />
            <Button onClick={() => void handleSyncMesec()} disabled={syncingMesec} variant="outline" className="gap-2">
              {syncingMesec
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CalendarDays className="h-4 w-4" />}
              {syncingMesec ? "Generiram…" : "Generiraj mesečni zbirnik"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Obstoječi osnutki za izbrani mesec se nadomestijo. Potrjenih temeljnic sync ne pobriše.
          </p>

          {syncMesecResult && (
            <div className="space-y-2">
              {syncMesecResult.created.length > 0 && (
                <Alert className="border-green-200 bg-green-50 text-green-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Ustvarjeni osnutki ({syncMesecResult.created.length}):</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {syncMesecResult.created.map((ref, i) => <li key={i}><code>{ref}</code></li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {syncMesecResult.skipped.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Preskočeno ({syncMesecResult.skipped.length}):</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {syncMesecResult.skipped.map((s, i) => (
                        <li key={i}><code>{s.ref}</code>: {s.reason}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {syncMesecResult.created.length === 0 && syncMesecResult.skipped.length === 0 && (
                <Alert className="border-blue-200 bg-blue-50 text-blue-800">
                  <AlertDescription>Ni podatkov za ta mesec (brez prodaje ali porabe).</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <TipJournalCard preview={tipJournalMesec} />

          {syncMesecError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{syncMesecError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* DDV zaključek — konti za neto DDV obveznost/presežek */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">DDV zaključek — Neto konti</CardTitle>
          <CardDescription>
            Funkcija <strong>"Pripravi zaključno temeljnico (osnutek)"</strong> v DDV evidenci zapira salde
            vseh 160x in 260x kontov ter neto razliko zapiše na ta dva konti.
            Če pustite prazno, se avtomatsko uporabi koda 2609000 (obveznost) oz. 1609000 (terjatev/presežek)
            — konto se samodejno ustvari, če ne obstaja.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountSelectSimple
            label="Neto DDV obveznost (kredit)"
            description="Privzeto: 2609000 Obveznost za DDV po obračunu"
            value={ddvForm.netoObveznostAccountId}
            onChange={v => setDdvForm(prev => ({ ...prev, netoObveznostAccountId: v }))}
          />
          <AccountSelectSimple
            label="Neto DDV terjatev / presežek (debet)"
            description="Privzeto: 1609000 Terjatev za presežek DDV"
            value={ddvForm.netoTerjatevAccountId}
            onChange={v => setDdvForm(prev => ({ ...prev, netoTerjatevAccountId: v }))}
          />
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={() => saveDdvMutation.mutate()} disabled={saveDdvMutation.isPending}>
          {saveDdvMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Save className="h-4 w-4 mr-2" />}
          Shrani DDV nastavitve
        </Button>
        {ddvSaved && (
          <span className="text-sm text-green-600 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Shranjeno
          </span>
        )}
        {saveDdvMutation.isError && (
          <span className="text-sm text-destructive">
            {(saveDdvMutation.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

interface ErpSystemResponse {
  erpOwnerCompanyId?: string | null;
}

export default function Nastavitve() {
  const { activeCompany } = useCompany();
  const { data: me } = useGetMe();
  const isSuperAdmin = !!(me as { isSuperAdmin?: boolean } | undefined)?.isSuperAdmin;
  const { data: erpSystem } = useQuery<ErpSystemResponse>({
    queryKey: ["/api/admin/system"],
    queryFn: () => apiFetch<ErpSystemResponse>("/api/admin/system"),
    enabled: isSuperAdmin,
    staleTime: 30_000,
    retry: false,
  });
  const erpOwnerCompanyId = erpSystem?.erpOwnerCompanyId ?? null;
  const isErpOwnerCompany =
    isSuperAdmin && activeCompany !== null && erpOwnerCompanyId !== null && activeCompany.id === erpOwnerCompanyId;
  const hasPosModule =
    (activeCompany as (CompanyWithRole & { modules?: string[] }) | null)?.modules?.includes("pos") ?? false;
  const [selectedTab, setSelectedTab] = useState<NastavitveTab>("podatki");
  const visibility = getNastavitveVisibility({
    isErpOwnerCompany,
    hasPosModule,
    selectedTab,
  });

  useEffect(() => {
    if (visibility.activeTab !== selectedTab) {
      setSelectedTab(visibility.activeTab);
    }
  }, [selectedTab, visibility.activeTab]);

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

      <Tabs
        value={visibility.activeTab}
        onValueChange={(value) => setSelectedTab(value as NastavitveTab)}
        className="space-y-5"
      >
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="podatki" className="gap-2">
              <Building2 className="h-3.5 w-3.5" />
              Podjetje
            </TabsTrigger>
            {visibility.showUsers && (
              <TabsTrigger value="uporabniki" className="gap-2">
                <Users className="h-3.5 w-3.5" />
                Uporabniki
              </TabsTrigger>
            )}
            <TabsTrigger value="ujp" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              UJP e-računi
            </TabsTrigger>
            <TabsTrigger value="ajpes" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              AJPES PRS
            </TabsTrigger>
            {visibility.showPosBooking && (
              <TabsTrigger value="pos" className="gap-2">
                <Store className="h-3.5 w-3.5" />
                POS Knjiženje
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="podatki" className="mt-0">
          <PodatkiTab
            companyId={activeCompany.id}
            isOwner={isOwner}
            showERacunRegistration={visibility.showERacunRegistration}
            showBizBoxCredentials={visibility.showBizBoxCredentials}
          />
        </TabsContent>

        {visibility.showUsers && (
          <TabsContent value="uporabniki" className="mt-0">
            <UporabnikiTab companyId={activeCompany.id} isOwner={isOwner} />
          </TabsContent>
        )}

        <TabsContent value="ujp" className="mt-0">
          <UjpTab />
        </TabsContent>

        <TabsContent value="ajpes" className="mt-0">
          <AjpesTab />
        </TabsContent>

        {visibility.showPosBooking && (
          <TabsContent value="pos" className="mt-0">
            <PosKnjizenjeTab companyId={activeCompany.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
