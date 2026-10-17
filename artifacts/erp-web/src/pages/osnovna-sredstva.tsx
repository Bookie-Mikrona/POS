/**
 * osnovna-sredstva.tsx — Register osnovnih sredstev (Faza 3a–3b, Možnost A)
 *
 * Hierarhija GLAVA + DOGRADITVE:
 *   Seznam: glave s skupno vrednostjo (Σ doknjižb)
 *   Kartica: glava + vse doknjižbe + seštevki + "Dodaj dograditev"
 *
 * Pogled:
 *   "lista"   — seznam glav z filtri
 *   "kartica" — podrobni prikaz enega sredstva
 *
 * NE vsebuje amortizacijskega obračuna niti knjižb v GK (3c–3f).
 */

import React, { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  AlertCircle,
  Edit2,
  Trash2,
  FileText,
  Search,
  X,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  TrendingDown,
  Percent,
  Building2,
  Upload,
  CheckCircle2,
  TriangleAlert,
  Check,
  Download,
  Wand2,
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListOsnovnaSredstva,
  useGetOsnovnoSredstvoKartica,
  useCreateOsnovnoSredstvo,
  useUpdateOsnovnoSredstvo,
  useIzlociOsnovnoSredstvo,
  useCreateOsDoknjizba,
  useUpdateOsDoknjizba,
  useIzlociOsDoknjizba,
  useListOsAmortizacijskeSkupine,
  osnovnaSredstvaQueryKey,
  osnovnoSredstvoKarticaQueryKey,
  useGetOsRegisterMedletni,
  useGetOsAmortizacijaNastavitve,
  type OsnovnoSredstvo,
  type OsDoknjizba,
  type KronoloskiDogodek,
  type CreateOsBody,
  type UpdateOsBody,
  type CreateDoknjizbaBody,
} from "@workspace/api-client-react";
import {
  useListCostCenters,
  useListAccounts,
  useListCounterparties,
  useCreateCounterparty,
  getListCounterpartiesQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@clerk/react";
import { formatDatum } from "@/lib/utils";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  v_teku: "V teku",
  v_uporabi: "V uporabi",
  odpisano: "Odpisano",
  izloceno: "Izločeno",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  v_teku: "secondary",
  v_uporabi: "default",
  odpisano: "outline",
  izloceno: "destructive",
};

const ZNANI_STATUSI = ["v_teku", "v_uporabi", "odpisano", "izloceno"];

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || !ZNANI_STATUSI.includes(status)) {
    return (
      <Badge variant="destructive" title={`Neznan status v bazi: "${status ?? "null"}"`}>
        ⚠ Neznan status
      </Badge>
    );
  }
  return (
    <Badge variant={STATUS_VARIANTS[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function fmt(val: string | number | undefined | null): string {
  if (val === null || val === undefined || val === "") return "0,00";
  const n = typeof val === "number" ? val : parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Obrazec za ustvarjanje/urejanje GLAVE ────────────────────────────────────

interface OsGlavaFormState {
  inventarnaSt: string;
  naziv: string;
  skupinaId: string;
  costCenterId: string;
  accountId: string;
  kontoPopravkaId: string;
  kontoStroskaId: string;
  status: string;
  opomba: string;
  /** Datum prodaje / odtujitve (YYYY-MM-DD ali prazen string za brez). */
  datumOdtujitve: string;
  /** Besedilni razlog izločitve (prodaja/odpis/…). */
  razlogIzlocitve: string;
  // seq=0 doknjižba (samo pri ustvarjanju)
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumNabave: string;
  datumAktivacije: string;
  datumIzpisa: string;
  /** Dobavitelj za seq=0 — UUID iz counterparties (izbira, ne vnos). */
  partnerId: string;
  /** Številka prejetega računa za seq=0. */
  stRacuna: string;
  /** Datum prejetega računa za seq=0 (YYYY-MM-DD). */
  datumRacuna: string;
}

const emptyGlavaForm = (): OsGlavaFormState => ({
  inventarnaSt: "",
  naziv: "",
  skupinaId: "",
  costCenterId: "",
  accountId: "",
  kontoPopravkaId: "",
  kontoStroskaId: "",
  status: "v_teku",
  opomba: "",
  datumOdtujitve: "",
  razlogIzlocitve: "",
  nabavnaVrednost: "",
  odpisanaVrednost: "0",
  neamortizljiviDelPct: "0",
  datumNabave: new Date().toISOString().slice(0, 10),
  datumAktivacije: "",
  datumIzpisa: "",
  partnerId: "",
  stRacuna: "",
  datumRacuna: "",
});

// ─── Dialog za hiter vpis novega poslovnega partnerja ─────────────────────────

function NovPartnerDialog({
  open, onClose, companyId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onCreated: (id: string) => void;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const createMut = useCreateCounterparty();

  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [ajpesLoading, setAjpesLoading] = useState(false);
  const [ajpesError, setAjpesError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const taxIdRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setName(""); setTaxId(""); setAjpesError(null); setSaveError(null); }
  }, [open]);

  const handleAjpes = async () => {
    if (!taxId.trim()) return;
    setAjpesLoading(true);
    setAjpesError(null);
    try {
      const token = await getToken();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/companies/${companyId}/counterparties/ajpes-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-Id": companyId },
        body: JSON.stringify({ taxId: taxId.trim() }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error((err as any).error || "Napaka pri poizvedbi"); }
      const result = await resp.json();
      if (result.name) setName(result.name);
      if (result.taxId) setTaxId(result.taxId);
    } catch (e: any) {
      setAjpesError(e.message || "Neznana napaka");
    } finally {
      setAjpesLoading(false);
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    setSaveError(null);
    createMut.mutate(
      { companyId, data: { type: "both", name: name.trim(), taxId: taxId.trim() || null, vatPayer: false } as any },
      {
        onSuccess: (created: any) => {
          queryClient.invalidateQueries({ queryKey: getListCounterpartiesQueryKey(companyId) });
          onCreated(created.id);
          onClose();
        },
        onError: (e: any) => setSaveError(e.message || "Napaka pri ustvarjanju partnerja"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nov poslovni partner</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Davčna številka</Label>
            <div className="flex gap-2">
              <Input
                ref={taxIdRef}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAjpes(); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); nameRef.current?.focus(); }
                }}
                placeholder="npr. SI12345678"
                className="h-8 text-sm"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAjpes} disabled={!taxId.trim() || ajpesLoading}>
                {ajpesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "AJPES"}
              </Button>
            </div>
            {ajpesError && <p className="text-xs text-destructive">{ajpesError}</p>}
          </div>
          <div className="space-y-1">
            <Label>Naziv <span className="text-destructive">*</span></Label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); taxIdRef.current?.focus(); }
              }}
              placeholder="Naziv podjetja ali osebe"
              className="h-8 text-sm"
            />
          </div>
          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Prekliči</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Shrani
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Skupni hook za navigacijo po poljih z Enter / ArrowDown / ArrowUp ────────
/** Enter / ArrowDown → naslednje polje; ArrowUp → prejšnje polje.
 *  Na zadnjem polju Enter pokliče onSave (če je podana). Preskoči null refs. */
function useFormNav(count: number) {
  const refs = useRef<(HTMLInputElement | HTMLTextAreaElement | null)[]>(Array(count).fill(null));
  function nav(i: number, e: React.KeyboardEvent, onSave?: () => void) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      for (let j = i + 1; j < refs.current.length; j++) {
        if (refs.current[j]) { e.preventDefault(); refs.current[j]!.focus(); return; }
      }
      if (onSave) { e.preventDefault(); onSave(); }
    } else if (e.key === "ArrowUp") {
      for (let j = i - 1; j >= 0; j--) {
        if (refs.current[j]) { e.preventDefault(); refs.current[j]!.focus(); return; }
      }
    }
  }
  return { r: refs, nav };
}

// ─── Combobox za dolge sezname (skupiny, konti) ───────────────────────────────

interface OsComboboxOption { value: string; label: string }

function OsCombobox({
  value,
  onChange,
  options,
  id,
  placeholder = "— ni določeno —",
  searchPlaceholder = "Išči…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: OsComboboxOption[];
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-8 justify-between text-xs font-normal px-2"
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 px-3 text-xs text-muted-foreground">Ni zadetkov.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => { onChange(""); setOpen(false); }}
                className="text-xs"
              >
                <Check className={`mr-2 h-3.5 w-3.5 ${!value ? "opacity-100" : "opacity-0"}`} />
                {placeholder}
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={`mr-2 h-3.5 w-3.5 ${value === o.value ? "opacity-100" : "opacity-0"}`} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface OsDialogProps {
  open: boolean;
  onClose: () => void;
  editingId: string | null;
  form: OsGlavaFormState;
  setForm: React.Dispatch<React.SetStateAction<OsGlavaFormState>>;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  skupiny: Array<{ id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>;
  costCenters: Array<{ id: string; code: string; name: string }>;
  accounts: Array<{ id: string; code: string; name: string }>;
  counterparties: Array<{ id: string; name: string; taxId: string | null }>;
  companyId: string;
}

export function OsDialog({
  open, onClose, editingId, form, setForm, saving, saveError, onSave, skupiny, costCenters, accounts, counterparties, companyId,
}: OsDialogProps) {
  const isNew = !editingId;
  const isFormValid: boolean = !!form.naziv.trim() && !!form.inventarnaSt.trim() && !!form.nabavnaVrednost.trim() && !!form.datumNabave.trim();
  const [novPartnerOpen, setNovPartnerOpen] = useState(false);
  // Refs za navigacijo: 0=inventarnaSt 1=naziv 2=nabavnaVr 3=odpisanaVr 4=neamortPct
  //   5=datumNabave 6=datumAkt 7=datumIzpisa 8=stRacuna 9=datumRacuna
  //   10=datumOdtujitve(!isNew) 11=razlogIzlocitve(!isNew)
  const { r, nav } = useFormNav(12);

  function field(name: keyof OsGlavaFormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Novo osnovno sredstvo" : "Uredi osnovno sredstvo"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Identifikacija glave */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Inventarna številka *</Label>
              <Input
                ref={(el) => { r.current[0] = el; }}
                value={form.inventarnaSt} onChange={field("inventarnaSt")} placeholder="OS-2024-001"
                onKeyDown={(e) => nav(0, e)}
              />
            </div>
            {isNew && (
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v_teku">V teku</SelectItem>
                    <SelectItem value="v_uporabi">V uporabi</SelectItem>
                    <SelectItem value="odpisano">Odpisano</SelectItem>
                    <SelectItem value="izloceno">Izločeno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Naziv *</Label>
            <Input
              ref={(el) => { r.current[1] = el; }}
              value={form.naziv} onChange={field("naziv")} placeholder="npr. Osebno vozilo Golf"
              onKeyDown={(e) => nav(1, e)}
            />
          </div>

          {/* Skupni atributi — vedno prikazani */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Amortizacijska skupina</Label>
              <OsCombobox
                value={form.skupinaId}
                onChange={(v) => setForm((f) => ({ ...f, skupinaId: v }))}
                options={skupiny.map((s) => ({ value: s.id, label: `${s.koda} — ${s.naziv}` }))}
                placeholder="— ni določena —"
                searchPlaceholder="Išči skupino…"
              />
            </div>
            <div className="space-y-1">
              <Label>Stroškovno mesto (STM)</Label>
              <Select value={form.costCenterId} onValueChange={(v) => setForm((f) => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="— ni določeno —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— ni določeno —</SelectItem>
                  {costCenters.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Kontni načrt */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Konti (skupni za vse doknjižbe)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Konto OS", field: "accountId" as const },
                { label: "Konto stroška amortizacije", field: "kontoStroskaId" as const },
                { label: "Konto popravka vrednosti", field: "kontoPopravkaId" as const },
              ].map(({ label, field: f }) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={`os-${f}`} className="text-xs">{label}</Label>
                  <OsCombobox
                    id={`os-${f}`}
                    value={form[f]}
                    onChange={(v) => setForm((prev) => ({ ...prev, [f]: v }))}
                    options={accounts.map((a: any) => ({ value: a.id, label: `${a.code} — ${a.name}` }))}
                    placeholder={f === "accountId" ? "—" : "— privzeto iz nastavitev modula —"}
                    searchPlaceholder="Išči konto…"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Konta amortizacije sta neobvezna. Prazno polje uporabi privzeti konto iz nastavitev modula.
              Lastna izbira velja za to sredstvo in se upošteva pri naslednjem predogledu knjižbe.
            </p>
          </div>

          {/* seq=0 doknjižba — vrednosti temeljnega nakupa */}
          <>
            <Separator />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isNew ? "Osnovni nakup (seq=0)" : "Osnovni nakup — vrednosti"}</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Nabavna vrednost (€) *</Label>
                  <Input
                    ref={(el) => { r.current[2] = el; }}
                    type="number" step="0.01" min="0" value={form.nabavnaVrednost} onChange={field("nabavnaVrednost")} placeholder="0.00"
                    onKeyDown={(e) => nav(2, e)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Že odpisana vrednost (€)</Label>
                  <Input
                    ref={(el) => { r.current[3] = el; }}
                    type="number" step="0.01" min="0" value={form.odpisanaVrednost} onChange={field("odpisanaVrednost")} placeholder="0.00"
                    onKeyDown={(e) => nav(3, e)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Neamortizljivi del (%)</Label>
                <Input
                  ref={(el) => { r.current[4] = el; }}
                  type="number" step="0.01" min="0" max="100" value={form.neamortizljiviDelPct} onChange={field("neamortizljiviDelPct")} placeholder="0"
                  onKeyDown={(e) => nav(4, e)}
                />
                <p className="text-xs text-muted-foreground">0 = vse amortizirljivo; 100 = nič (npr. zemljišče)</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Datum nabave *</Label>
                  <Input
                    ref={(el) => { r.current[5] = el; }}
                    type="date" value={form.datumNabave} onChange={field("datumNabave")}
                    onKeyDown={(e) => nav(5, e)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Datum aktivacije</Label>
                  <Input
                    ref={(el) => { r.current[6] = el; }}
                    type="date" value={form.datumAktivacije} onChange={field("datumAktivacije")}
                    onKeyDown={(e) => nav(6, e)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Datum izpisa</Label>
                  <Input
                    ref={(el) => { r.current[7] = el; }}
                    type="date" value={form.datumIzpisa} onChange={field("datumIzpisa")}
                    onKeyDown={(e) => nav(7, e)}
                  />
                </div>
              </div>

              {/* Nabavni dokument za seq=0 */}
              <Separator />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nabavni dokument (neobvezno)</p>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>Dobavitelj</Label>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setNovPartnerOpen(true)}
                  >
                    + Dodaj novega
                  </button>
                </div>
                <OsCombobox
                  value={form.partnerId}
                  onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
                  options={counterparties.map((c) => ({
                    value: c.id,
                    label: c.taxId ? `${c.name} (${c.taxId})` : c.name,
                  }))}
                  placeholder="— ni določen —"
                  searchPlaceholder="Išči dobavitelja…"
                />
              </div>
              <NovPartnerDialog
                open={novPartnerOpen}
                onClose={() => setNovPartnerOpen(false)}
                companyId={companyId}
                onCreated={(id) => setForm((f) => ({ ...f, partnerId: id }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Številka računa</Label>
                  <Input
                    ref={(el) => { r.current[8] = el; }}
                    value={form.stRacuna} onChange={field("stRacuna")} placeholder="npr. R-2024-0123"
                    onKeyDown={(e) => nav(8, e)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Datum računa</Label>
                  <Input
                    ref={(el) => { r.current[9] = el; }}
                    type="date" value={form.datumRacuna} onChange={field("datumRacuna")}
                    onKeyDown={(e) => nav(9, e, isFormValid ? onSave : undefined)}
                  />
                </div>
              </div>
          </>

          {/* Opomba */}
          <div className="space-y-1">
            <Label>Opomba</Label>
            <Textarea value={form.opomba} onChange={(e) => setForm((f) => ({ ...f, opomba: e.target.value }))} rows={2} />
          </div>

          {!isNew && (
            <>
              {/* Datum odtujitve / prodaje */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Datum odtujitve / prodaje</Label>
                  <Input
                    ref={(el) => { r.current[10] = el; }}
                    type="date"
                    value={form.datumOdtujitve}
                    onChange={(e) => setForm((f) => ({ ...f, datumOdtujitve: e.target.value }))}
                    placeholder="YYYY-MM-DD"
                    onKeyDown={(e) => nav(10, e)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Mesec odtujitve se ne šteje (AM preneha mesec pred tem).
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Razlog izločitve</Label>
                  <Input
                    ref={(el) => { r.current[11] = el; }}
                    value={form.razlogIzlocitve}
                    onChange={(e) => setForm((f) => ({ ...f, razlogIzlocitve: e.target.value }))}
                    placeholder="prodaja / odpis / uničenje…"
                    maxLength={200}
                    onKeyDown={(e) => nav(11, e, isFormValid ? onSave : undefined)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v_teku">V teku</SelectItem>
                    <SelectItem value="v_uporabi">V uporabi</SelectItem>
                    <SelectItem value="odpisano">Odpisano</SelectItem>
                    <SelectItem value="izloceno">Izločeno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Prekliči</Button>
          <Button onClick={onSave} disabled={saving || !isFormValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Shrani" : "Posodobi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Obrazec za DOGRADITEV (nova doknjižba) ────────────────────────────────────

interface DograditevFormState {
  nazivVlaganja: string;
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumNabave: string;
  datumAktivacije: string;
  datumIzpisa: string;
  /** UUID dobavitelja iz counterparties (izbira, ne vnos). */
  partnerId: string;
  /** Številka prejetega računa. */
  stRacuna: string;
  /** Datum prejetega računa (YYYY-MM-DD). */
  datumRacuna: string;
}

const emptyDograditevForm = (): DograditevFormState => ({
  nazivVlaganja: "",
  nabavnaVrednost: "",
  odpisanaVrednost: "0",
  neamortizljiviDelPct: "0",
  datumNabave: new Date().toISOString().slice(0, 10),
  datumAktivacije: "",
  datumIzpisa: "",
  partnerId: "",
  stRacuna: "",
  datumRacuna: "",
});

interface DograditevDialogProps {
  open: boolean;
  onClose: () => void;
  sredstvoNaziv: string;
  form: DograditevFormState;
  setForm: React.Dispatch<React.SetStateAction<DograditevFormState>>;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  counterparties: Array<{ id: string; name: string; taxId: string | null }>;
  companyId: string;
  /** Ko je nastavljeno, gre za urejanje obstoječe dograditve (ne dodajanje). */
  editingDoknjizbaId?: string | null;
}

function DograditevDialog({
  open, onClose, sredstvoNaziv, form, setForm, saving, saveError, onSave, counterparties, companyId, editingDoknjizbaId,
}: DograditevDialogProps) {
  const isValid: boolean = !!form.nabavnaVrednost.trim() && !!form.datumNabave.trim();
  const [novPartnerOpen, setNovPartnerOpen] = useState(false);
  // Refs: 0=nazivVlaganja 1=nabavnaVr 2=odpisanaVr 3=neamortPct
  //       4=datumNabave 5=datumAkt 6=datumIzpisa 7=stRacuna 8=datumRacuna
  const { r, nav } = useFormNav(9);

  function field(name: keyof DograditevFormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingDoknjizbaId ? "Uredi dograditev" : "Dodaj dograditev"}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{sredstvoNaziv}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Opis vlaganja</Label>
            <Input
              ref={(el) => { r.current[0] = el; }}
              value={form.nazivVlaganja} onChange={field("nazivVlaganja")} placeholder="npr. Zamenjava motorja, Dozidava"
              onKeyDown={(e) => nav(0, e)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Nabavna vrednost (€) *</Label>
              <Input
                ref={(el) => { r.current[1] = el; }}
                type="number" step="0.01" min="0" value={form.nabavnaVrednost} onChange={field("nabavnaVrednost")} placeholder="0.00"
                onKeyDown={(e) => nav(1, e)}
              />
            </div>
            <div className="space-y-1">
              <Label>Že odpisana vrednost (€)</Label>
              <Input
                ref={(el) => { r.current[2] = el; }}
                type="number" step="0.01" min="0" value={form.odpisanaVrednost} onChange={field("odpisanaVrednost")} placeholder="0.00"
                onKeyDown={(e) => nav(2, e)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Neamortizljivi del (%)</Label>
            <Input
              ref={(el) => { r.current[3] = el; }}
              type="number" step="0.01" min="0" max="100" value={form.neamortizljiviDelPct} onChange={field("neamortizljiviDelPct")} placeholder="0"
              onKeyDown={(e) => nav(3, e)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Datum nabave *</Label>
              <Input
                ref={(el) => { r.current[4] = el; }}
                type="date" value={form.datumNabave} onChange={field("datumNabave")}
                onKeyDown={(e) => nav(4, e)}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum aktivacije</Label>
              <Input
                ref={(el) => { r.current[5] = el; }}
                type="date" value={form.datumAktivacije} onChange={field("datumAktivacije")}
                onKeyDown={(e) => nav(5, e)}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum izpisa</Label>
              <Input
                ref={(el) => { r.current[6] = el; }}
                type="date" value={form.datumIzpisa} onChange={field("datumIzpisa")}
                onKeyDown={(e) => nav(6, e)}
              />
            </div>
          </div>

          {/* Nabavni dokument */}
          <Separator />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nabavni dokument (neobvezno)</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Dobavitelj</Label>
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                onClick={() => setNovPartnerOpen(true)}
              >
                + Dodaj novega
              </button>
            </div>
            <OsCombobox
              value={form.partnerId}
              onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
              options={counterparties.map((c) => ({
                value: c.id,
                label: c.taxId ? `${c.name} (${c.taxId})` : c.name,
              }))}
              placeholder="— ni določen —"
              searchPlaceholder="Išči dobavitelja…"
            />
          </div>
          <NovPartnerDialog
            open={novPartnerOpen}
            onClose={() => setNovPartnerOpen(false)}
            companyId={companyId}
            onCreated={(id) => setForm((f) => ({ ...f, partnerId: id }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Številka računa</Label>
              <Input
                ref={(el) => { r.current[7] = el; }}
                value={form.stRacuna} onChange={field("stRacuna")} placeholder="npr. R-2024-0123"
                onKeyDown={(e) => nav(7, e)}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum računa</Label>
              <Input
                ref={(el) => { r.current[8] = el; }}
                type="date" value={form.datumRacuna} onChange={field("datumRacuna")}
                onKeyDown={(e) => nav(8, e, isValid ? onSave : undefined)}
              />
            </div>
          </div>

          <Alert className="border-blue-200 bg-blue-50">
            <Building2 className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-xs">
              Dograditev prevzame amortizacijsko skupino in konte iz osnovnega sredstva.
            </AlertDescription>
          </Alert>

          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Prekliči</Button>
          <Button onClick={onSave} disabled={saving || !isValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingDoknjizbaId ? "Shrani spremembe" : "Dodaj dograditev"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Izloči dialog ─────────────────────────────────────────────────────────────

interface IzlociDialogProps {
  open: boolean;
  onClose: () => void;
  datum: string;
  setDatum: (d: string) => void;
  saving: boolean;
  onConfirm: () => void;
}

function IzlociDialog({ open, onClose, datum, setDatum, saving, onConfirm }: IzlociDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Izloči osnovno sredstvo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Sredstvo bo označeno kot izločeno (prodano, uničeno ali odtujeno).
            Vse doknjižbe bodo prav tako izločene. Podatki ostanejo v evidenci.
          </p>
          <div className="space-y-1">
            <Label>Datum izpisa</Label>
            <Input
              type="date" value={datum} onChange={(e) => setDatum(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && datum && !saving) { e.preventDefault(); onConfirm(); } }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Prekliči</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={saving || !datum}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Izloči
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── OsDialog ovoj — naloži counterparties in ga posreduje OsDialogu ─────────

function OsDialogWithCounterparties({
  companyId,
  ...rest
}: Omit<OsDialogProps, "counterparties"> & { companyId: string }) {
  const { data: cpData } = useListCounterparties(
    companyId,
    { includeInactive: false },
    { query: { enabled: rest.open } as any },
  );
  const counterparties = (cpData?.counterparties ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.name as string,
    taxId: (c.taxId ?? null) as string | null,
  }));
  return <OsDialog {...rest} counterparties={counterparties} companyId={companyId} />;
}

// ─── Medletni register OS ─────────────────────────────────────────────────────
// Dinamični prikaz: začetno stanje (1.1.) + spremembe + končno stanje (do_meseca)

function ListView({
  companyId,
  skupiny,
  costCenters,
  accounts,
  onOpenKartica,
}: {
  companyId: string;
  skupiny: Array<{ id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>;
  costCenters: Array<{ id: string; code: string; name: string }>;
  accounts: Array<{ id: string; code: string; name: string }>;
  onOpenKartica: (id: string) => void;
}) {
  const qc = useQueryClient();

  // Filtri
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterSkupinaId, setFilterSkupinaId] = useState("");
  const [filterCostCenterId, setFilterCostCenterId] = useState("");

  // Medletni specifično — privzeto leto: (a) zadnji obračun → (b) OS leto → (c) tekoče leto
  const thisYear = new Date().getFullYear();
  const [selectedLeto, setSelectedLeto] = useState<number>(thisYear);
  const letoApplied = useRef(false);
  const [podroben, setPodroben] = useState(false); // razširjeni pogled (+ PV stolpci)

  // Nastavitve — vsebuje zadnjiObracunLeto in osLeto za privzeto leto
  const { data: nastavitve } = useGetOsAmortizacijaNastavitve(companyId, {
    query: { enabled: !!companyId },
  });

  // Nastavi privzeto leto samo enkrat ob prvi naložitvi nastavitev.
  // Prioriteta: (a) zadnji shranjeni obračun → (b) OS leto iz nastavitev → (c) tekoče leto
  useEffect(() => {
    if (letoApplied.current) return;
    if (!nastavitve) return;
    letoApplied.current = true;
    const privzeto =
      nastavitve.zadnjiObracunLeto  // (a) zadnji shranjeni obračun
      ?? nastavitve.osLeto          // (b) OS leto iz nastavitev
      ?? thisYear;                  // (c) tekoče leto
    setSelectedLeto(privzeto);
  }, [nastavitve, thisYear]);

  // Dialogi — novo sredstvo
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OsGlavaFormState>(emptyGlavaForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Dialog — izloči
  const [izlociId, setIzlociId] = useState<string | null>(null);
  const [izlociDatum, setIzlociDatum] = useState(new Date().toISOString().slice(0, 10));
  const [izlociSaving, setIzlociSaving] = useState(false);
  const [izlociDialogOpen, setIzlociDialogOpen] = useState(false);

  const medletniFilters: Record<string, string | undefined> = {
    q: q || undefined,
    skupinaId: filterSkupinaId || undefined,
    costCenterId: filterCostCenterId || undefined,
    ...(filterStatus === "active"
      ? {}
      : filterStatus === "izloceno"
        ? { status: "izloceno", includeIzloceno: "true" }
        : { status: filterStatus }),
  };

  const { data, isLoading, error } = useGetOsRegisterMedletni(
    companyId,
    selectedLeto,
    medletniFilters,
    { query: { enabled: !!companyId } },
  );

  const createMut = useCreateOsnovnoSredstvo(companyId);
  const updateMut = useUpdateOsnovnoSredstvo(companyId);
  const izlociMut = useIzlociOsnovnoSredstvo(companyId);
  const updateDoknjizba = useUpdateOsDoknjizba(companyId);
  const { getToken } = useAuth();
  const [seq0DoknjizbaId, setSeq0DoknjizbaId] = useState<string | null>(null);

  const vrstice = data?.osnovnaSredstva ?? [];
  const seštevki = data?.seštevki;
  const periodo = data?.periodo;
  const razpolozljivaLeta = data?.razpolozljivaLeta ?? [];

  // Določi seznam let za selector: shranjeni obračuni + tekoče leto + izbrano leto (če ni v seznamu)
  const currentYear = new Date().getFullYear();
  const letaZaSelector = (() => {
    const base = razpolozljivaLeta.length > 0 ? razpolozljivaLeta : [];
    const extra = new Set([...base, currentYear, selectedLeto]);
    return [...extra].sort((a, b) => a - b);
  })();

  function openNew() {
    setEditingId(null);
    setForm(emptyGlavaForm());
    setSaveError(null);
    setDialogOpen(true);
  }

  async function openEditOs(os: (typeof vrstice)[number]) {
    setEditingId(os.id);
    setSeq0DoknjizbaId(null);
    const e = os as typeof os & {
      costCenterId?: string | null;
      accountId?: string | null;
      kontoPopravkaId?: string | null;
      kontoStroskaId?: string | null;
      opomba?: string | null;
      datumOdtujitve?: string | null;
      razlogIzlocitve?: string | null;
    };
    const base: OsGlavaFormState = {
      inventarnaSt: os.inventarnaSt,
      naziv: os.naziv,
      skupinaId: os.skupinaId ?? "",
      costCenterId: e.costCenterId ?? "",
      accountId: e.accountId ?? "",
      kontoPopravkaId: e.kontoPopravkaId ?? "",
      kontoStroskaId: e.kontoStroskaId ?? "",
      status: (os.status as any) ?? "v_teku",
      opomba: e.opomba ?? "",
      datumOdtujitve: e.datumOdtujitve ?? "",
      razlogIzlocitve: e.razlogIzlocitve ?? "",
      nabavnaVrednost: "",
      odpisanaVrednost: "0",
      neamortizljiviDelPct: "0",
      datumNabave: new Date().toISOString().slice(0, 10),
      datumAktivacije: "",
      datumIzpisa: "",
      partnerId: "",
      stRacuna: "",
      datumRacuna: "",
    };
    // Naloži seq=0 podatke iz kartice za predizpolnitev
    try {
      const token = await getToken();
      const resp = await fetch(
        `/api/companies/${companyId}/osnovna-sredstva/${os.id}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (resp.ok) {
        const kartica = await resp.json();
        const seq0 = (kartica.doknjizbe as any[])?.find((d) => d.seq === 0);
        if (seq0) {
          setSeq0DoknjizbaId(seq0.id);
          base.nabavnaVrednost = seq0.nabavnaVrednost ?? "";
          base.odpisanaVrednost = seq0.odpisanaVrednost ?? "0";
          base.neamortizljiviDelPct = seq0.neamortizljiviDelPct ?? "0";
          base.datumNabave = seq0.datumNabave ?? base.datumNabave;
          base.datumAktivacije = seq0.datumAktivacije ?? "";
          base.datumIzpisa = seq0.datumIzpisa ?? "";
          base.partnerId = seq0.partnerId ?? "";
          base.stRacuna = seq0.stRacuna ?? "";
          base.datumRacuna = seq0.datumRacuna ?? "";
        }
      }
    } catch { /* fallback brez seq=0 predizpolnitve */ }
    setForm(base);
    setSaveError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (!editingId) {
        const body: CreateOsBody = {
          inventarnaSt: form.inventarnaSt.trim(),
          naziv: form.naziv.trim(),
          skupinaId: form.skupinaId || null,
          costCenterId: form.costCenterId || null,
          accountId: form.accountId || null,
          kontoPopravkaId: form.kontoPopravkaId || null,
          kontoStroskaId: form.kontoStroskaId || null,
          opomba: form.opomba.trim() || null,
          nabavnaVrednost: form.nabavnaVrednost,
          odpisanaVrednost: form.odpisanaVrednost || "0",
          neamortizljiviDelPct: form.neamortizljiviDelPct || "0",
          datumNabave: form.datumNabave,
          datumAktivacije: form.datumAktivacije || null,
          datumIzpisa: form.datumIzpisa || null,
          partnerId: form.partnerId || null,
          stRacuna: form.stRacuna.trim() || null,
          datumRacuna: form.datumRacuna || null,
        };
        await createMut.mutateAsync(body);
      } else {
        await updateMut.mutateAsync({
          id: editingId,
          data: {
            inventarnaSt: form.inventarnaSt.trim(),
            naziv: form.naziv.trim(),
            skupinaId: form.skupinaId || null,
            costCenterId: form.costCenterId || null,
            accountId: form.accountId || null,
            kontoPopravkaId: form.kontoPopravkaId || null,
            kontoStroskaId: form.kontoStroskaId || null,
            status: form.status as any,
            opomba: form.opomba.trim() || null,
            datumOdtujitve: form.datumOdtujitve.trim() || null,
            razlogIzlocitve: form.razlogIzlocitve.trim() || null,
          },
        });
        if (seq0DoknjizbaId) {
          await updateDoknjizba.mutateAsync({
            sredstvoId: editingId,
            doknjizbaId: seq0DoknjizbaId,
            data: {
              nabavnaVrednost: form.nabavnaVrednost,
              odpisanaVrednost: form.odpisanaVrednost || "0",
              neamortizljiviDelPct: form.neamortizljiviDelPct || "0",
              datumNabave: form.datumNabave,
              datumAktivacije: form.datumAktivacije || null,
              datumIzpisa: form.datumIzpisa || null,
              partnerId: form.partnerId || null,
              stRacuna: form.stRacuna.trim() || null,
              datumRacuna: form.datumRacuna || null,
            },
          });
        }
      }
      qc.invalidateQueries({ queryKey: osnovnaSredstvaQueryKey(companyId) });
      qc.invalidateQueries({ queryKey: ["os-register-medletni", companyId] });
      setDialogOpen(false);
    } catch (e: any) {
      setSaveError(e.message ?? "Napaka pri shranjevanju");
    } finally {
      setSaving(false);
    }
  }

  async function handleIzloci() {
    if (!izlociId) return;
    setIzlociSaving(true);
    try {
      await izlociMut.mutateAsync({ id: izlociId, datumIzpisa: izlociDatum });
      qc.invalidateQueries({ queryKey: osnovnaSredstvaQueryKey(companyId) });
      qc.invalidateQueries({ queryKey: ["os-register-medletni", companyId] });
      setIzlociDialogOpen(false);
    } catch (e: any) {
      alert(e.message ?? "Napaka pri izločitvi");
    } finally {
      setIzlociSaving(false);
    }
  }

  // Število stolpcev (za colSpan v prazni vrstici in seštevkih)
  // Strnjen  (11): Inv, Naziv, Skup, Status, #, Ned(1.1.), Nov.nab., Amort., Ned.(k), Obr., Akcije
  // Razširjen(15): + NV(1.1.), NV(k) + Rac.% + Dat.nab.
  //   (PV(1.1.), PV(k), Doba, Dat.akt., K.OS, K.Pop., K.Str. → samo v PDF/Excel izpisu)
  const colCount = podroben ? 15 : 11;

  /** Pripravi URL za izvoz registra OS z obstoječimi filtri. */
  function buildExportUrl(format: "pdf" | "xlsx"): string {
    const base = `/api/companies/${companyId}/os-register/${format}`;
    const p = new URLSearchParams();
    if (selectedLeto) p.set("leto", String(selectedLeto));
    if (filterSkupinaId) p.set("skupinaId", filterSkupinaId);
    if (filterCostCenterId) p.set("costCenterId", filterCostCenterId);
    if (filterStatus && filterStatus !== "active") p.set("status", filterStatus);
    if (filterStatus === "izloceno") p.set("includeIzloceno", "true");
    if (q) p.set("q", q);
    return `${base}?${p.toString()}`;
  }

  return (
    <div className="space-y-3">
      {/* Naslov registra z datumom */}
      <div className="flex items-center gap-3 flex-wrap">
        {periodo && !isLoading && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              Register OS na dan {formatDatum(periodo.datumKonca)}
            </span>
            {periodo.predogled && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">
                predogled — brez amortizacije
              </span>
            )}
          </div>
        )}
        {isLoading && <span className="text-sm text-muted-foreground">Nalagam …</span>}
      </div>

      {/* Orodna vrstica */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap flex-1 items-center">
          {/* Iskanje */}
          <div className="relative min-w-44 flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Išči …"
              className="pl-8 h-8 text-xs"
            />
            {q && (
              <button
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQ("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Status */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktivna</SelectItem>
              <SelectItem value="v_teku">V teku</SelectItem>
              <SelectItem value="v_uporabi">V uporabi</SelectItem>
              <SelectItem value="odpisano">Odpisano</SelectItem>
              <SelectItem value="izloceno">Izločeno</SelectItem>
            </SelectContent>
          </Select>

          {/* Skupina */}
          {skupiny.length > 0 && (
            <Select value={filterSkupinaId} onValueChange={setFilterSkupinaId}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Vse skupine" />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="">Vse skupine</SelectItem>
                {skupiny.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.koda} — {s.naziv}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* STM */}
          {costCenters.length > 0 && (
            <Select value={filterCostCenterId} onValueChange={setFilterCostCenterId}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Vsa STM" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Vsa STM</SelectItem>
                {costCenters.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Leto */}
          <Select
            value={String(selectedLeto)}
            onValueChange={(v) => { if (v) setSelectedLeto(parseInt(v, 10)); }}
          >
            <SelectTrigger className="w-24 h-8 text-xs font-mono">
              <SelectValue placeholder="Leto" />
            </SelectTrigger>
            <SelectContent>
              {letaZaSelector.map((l) => (
                <SelectItem key={l} value={String(l)}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Razširi/strni PV + SRS stolpce */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setPodroben(!podroben)}
            title={podroben ? "Strni — skrij razširjene stolpce" : "Razširi — pokaži stopnje, datume, konte"}
          >
            {podroben ? "Strni" : "Razširi"}
          </Button>
        </div>

        <div className="flex gap-1.5 items-center">
          {/* Izvoz PDF */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            title="Izpis registra OS (PDF, landscape A4)"
            onClick={() => { window.open(buildExportUrl("pdf"), "_blank"); }}
          >
            <FileText className="h-3.5 w-3.5 mr-1" />
            PDF
          </Button>
          {/* Izvoz XLSX */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            title="Izvoz registra OS v Excel (XLSX, vsi SRS stolpci)"
            onClick={() => { window.open(buildExportUrl("xlsx"), "_blank"); }}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Excel
          </Button>
          <Button onClick={openNew} size="sm" className="h-8 px-3 text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo sredstvo
          </Button>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto" style={{ zoom: podroben ? 0.72 : 0.78 }}>
          {/* table-fixed + eksplicitne širine; zoom na wrapperju = edina rešitev za sub-browser-minimum font */}
          <table className={`w-full table-fixed border-collapse ${podroben ? "text-[11px] min-w-[840px]" : "text-xs min-w-[600px]"}`}>
            <colgroup>
              <col className="w-[68px]" />{/* Inventarna */}
              <col className={podroben ? "w-[120px]" : "w-[100px]"} />{/* Naziv */}
              <col className="w-[38px]" />{/* Skupina */}
              <col className="w-[68px]" />{/* Status */}
              <col className="w-[22px]" />{/* # */}
              {podroben && <col className="w-[62px]" />}{/* NV(1.1.) */}
              <col className="w-[62px]" />{/* Ned.(1.1.) */}
              <col className="w-[62px]" />{/* Nov. nab. */}
              <col className="w-[62px]" />{/* Amort. */}
              {podroben && <col className="w-[62px]" />}{/* NV(k) */}
              <col className="w-[62px]" />{/* Ned.(k) */}
              {podroben && <col className="w-[46px]" />}{/* Rac.% */}
              {podroben && <col className="w-[62px]" />}{/* Dat. nab. */}
              <col className="w-[42px]" />{/* Obr. */}
              <col className="w-[36px]" />{/* Akcije */}
            </colgroup>
            <thead>
              {/* ── Skupinski naslovi (colSpan se mora ujemati z dejanskim st. stolpcev!) ── */}
              {/* Strnjen : 5 + 1 + 2 + 1 + 2 = 11                                          */}
              {/* Razširjen: 5 + 3 + 2 + 2 + 2 + 2 = 16                                     */}
              <tr className="border-b border-muted">
                <th colSpan={5} className="px-1 py-0.5 text-left" />
                {podroben
                  ? <th colSpan={2} className="px-1 py-0.5 text-center text-[10px] font-semibold text-blue-700 border-l border-blue-200 bg-blue-50/50 whitespace-nowrap" title="PV(1.1.) je v PDF/Excel izpisu">Začetno stanje (1.1.)</th>
                  : <th colSpan={1} className="px-1 py-0.5 text-center text-[10px] font-semibold text-blue-700 border-l border-blue-200 bg-blue-50/50 whitespace-nowrap">Začetno</th>
                }
                <th colSpan={2} className="px-1 py-0.5 text-center text-[10px] font-semibold text-amber-700 border-l border-amber-200 bg-amber-50/50 whitespace-nowrap">Spremembe</th>
                {podroben
                  ? <th colSpan={2} className="px-1 py-0.5 text-center text-[10px] font-semibold text-green-700 border-l border-green-200 bg-green-50/50 whitespace-nowrap">Končno stanje ({periodo ? formatDatum(periodo.datumKonca).slice(4) : ""})</th>
                  : <th colSpan={1} className="px-1 py-0.5 text-center text-[10px] font-semibold text-green-700 border-l border-green-200 bg-green-50/50 whitespace-nowrap">Končno</th>
                }
                {podroben && <th colSpan={2} className="px-1 py-0.5 text-center text-[10px] font-semibold text-purple-700 border-l border-purple-200 bg-purple-50/40 whitespace-nowrap" title="Poln nabor SRS podatkov je v PDF/Excel izpisu">SRS</th>}
                <th colSpan={2} className="px-1 py-0.5 border-l border-muted" />
              </tr>
              {/* Stolpni naslovi */}
              <tr className="border-b bg-muted/20">
                <th className="px-1 py-1 text-left font-medium text-muted-foreground whitespace-nowrap" title="Inventarna številka">Inventarna</th>
                <th className="px-1 py-1 text-left font-medium text-muted-foreground overflow-hidden text-ellipsis">Naziv</th>
                <th className="px-1 py-1 text-left font-medium text-muted-foreground whitespace-nowrap" title="Amortizacijska skupina">Skup.</th>
                <th className="px-1 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                <th className="px-0.5 py-1 text-center font-medium text-muted-foreground" title="Število dograditev (seq>0)">#</th>
                {podroben && <th className="px-0.5 py-1 text-right font-medium text-blue-700 border-l border-blue-100 whitespace-nowrap bg-blue-50/30" title="Nabavna vrednost na 1.1. — PV(1.1.) je v PDF/Excel">NV(1.1.)</th>}
                <th className={`px-0.5 py-1 text-right font-medium text-blue-700 whitespace-nowrap bg-blue-50/30${podroben ? "" : " border-l border-blue-100"}`} title="Neodpisana (knjižna) vrednost na 1.1.">Ned.(1.1.)</th>
                <th className="px-0.5 py-1 text-right font-medium text-amber-700 border-l border-amber-100 whitespace-nowrap bg-amber-50/30" title="Nove nabave in aktivacije v letu">Nov.nab.</th>
                <th className="px-0.5 py-1 text-right font-medium text-amber-700 whitespace-nowrap bg-amber-50/30" title="Obračunana amortizacija v obdobju">Amort.</th>
                {podroben && <th className="px-0.5 py-1 text-right font-medium text-green-700 border-l border-green-100 whitespace-nowrap bg-green-50/30" title="Nabavna vrednost na konec obdobja">NV(k)</th>}
                <th className={`px-0.5 py-1 text-right font-medium text-green-700 whitespace-nowrap bg-green-50/50${podroben ? " border-l border-green-100" : " border-l border-green-100"}`} title="Neodpisana (knjižna) vrednost na konec obdobja">Ned.(k)</th>
                {podroben && <th className="px-0.5 py-1 text-right font-medium text-purple-700 border-l border-purple-100 whitespace-nowrap bg-purple-50/20" title="Računovodska amortizacijska stopnja (Rac.%)">Rac.%</th>}
                {podroben && <th className="px-0.5 py-1 text-left font-medium text-purple-700 whitespace-nowrap bg-purple-50/20" title="Datum nabave — poln nabor SRS v PDF/Excel">Dat.nab.</th>}
                <th className="px-1 py-1 text-center font-medium text-muted-foreground border-l border-muted whitespace-nowrap" title="Obračunsko obdobje">Obr.</th>
                <th className="px-1 py-1 border-l border-muted" />
              </tr>
            </thead>
            <tbody>
              {vrstice.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="text-center text-muted-foreground py-10">
                    Ni sredstev za prikazane filtre.
                  </td>
                </tr>
              ) : (
                vrstice.map((os) => {
                  const skupina = skupiny.find((s) => s.id === os.skupinaId);
                  // Enriched SRS polja (vrnjena iz endpointa v razširjenem tipu)
                  const enriched = os as typeof os & {
                    skupinaKoda?: string | null;
                    skupinaNaziv?: string | null;
                    racunovodskaStonja?: string | null;
                    datumNabave?: string | null;
                    datumAktivacije?: string | null;
                    accountCode?: string | null;
                    kontoPopravkaCode?: string | null;
                    kontoStroskaCode?: string | null;
                  };
                  // Doba koristnosti = 100 / stopnja
                  const dobaStr = enriched.racunovodskaStonja
                    ? (() => { const n = parseFloat(enriched.racunovodskaStonja!); return n > 0 ? `${Math.round(100/n)} l.` : "—"; })()
                    : "—";
                  // Formatiranje datumov
                  const fmtDat = (iso: string | null | undefined) => {
                    if (!iso) return <span className="text-muted-foreground/50">—</span>;
                    const p = iso.split("-");
                    return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
                  };
                  return (
                    <tr
                      key={os.id}
                      className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                      onClick={() => onOpenKartica(os.id)}
                    >
                      <td className="px-1 py-0.5 font-mono font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={os.inventarnaSt}>
                        {os.inventarnaSt}
                      </td>
                      <td className="px-1 py-0.5 overflow-hidden leading-tight line-clamp-3" title={os.naziv}>
                        {os.naziv}
                      </td>
                      <td className="px-1 py-0.5 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis" title={skupina ? `${skupina.koda} — ${skupina.naziv}` : (enriched.skupinaNaziv ?? undefined)}>
                        {enriched.skupinaKoda ?? (skupina ? skupina.koda : <span className="text-border">—</span>)}
                      </td>
                      <td className="px-1 py-0.5 overflow-hidden">
                        <StatusBadge status={os.status} />
                      </td>
                      <td className="px-0.5 py-0.5 text-center text-muted-foreground">{os.steviloDoknjizb}</td>

                      {/* Začetno stanje — NV(1.1.) + Ned(1.1.); PV(1.1.) je v PDF/Excel */}
                      {podroben && <td className="px-0.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-blue-100 bg-blue-50/20">{fmt(os.zacNV)}</td>}
                      <td className={`px-0.5 py-0.5 text-right font-mono tabular-nums font-medium whitespace-nowrap overflow-hidden bg-blue-50/20${podroben ? "" : " border-l border-blue-100"}`}>{fmt(os.zacNed)}</td>

                      {/* Spremembe */}
                      <td className="px-0.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-amber-100 bg-amber-50/20">
                        {parseFloat(os.noveNabave) > 0 ? <span className="text-amber-700 font-medium">+{fmt(os.noveNabave)}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-0.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden bg-amber-50/20">
                        {parseFloat(os.amortObdobja) > 0 ? <span className="text-amber-700">−{fmt(os.amortObdobja)}</span> : <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Končno stanje */}
                      {podroben && <td className="px-0.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-green-100 bg-green-50/20">{fmt(os.konNV)}</td>}
                      <td className="px-0.5 py-0.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap overflow-hidden border-l border-green-100 bg-green-50/30">{fmt(os.konNed)}</td>

                      {/* SRS */}
                      {podroben && <td className="px-0.5 py-0.5 text-right font-mono tabular-nums border-l border-purple-100 bg-purple-50/20 text-purple-800 whitespace-nowrap">
                        {enriched.racunovodskaStonja
                          ? `${parseFloat(enriched.racunovodskaStonja).toLocaleString("sl-SI", { minimumFractionDigits: 2 })} %`
                          : <span className="text-muted-foreground/50">—</span>}
                      </td>}
                      {podroben && <td className="px-0.5 py-0.5 font-mono tabular-nums bg-purple-50/20 text-purple-800 whitespace-nowrap">{fmtDat(enriched.datumNabave)}</td>}

                      <td className="px-1 py-0.5 text-center font-mono text-muted-foreground border-l border-muted whitespace-nowrap">
                        {data?.obracunPeriod ?? "—"}
                      </td>
                      <td className="px-0.5 py-0.5 border-l border-muted" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-0.5 justify-end">
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Kartica" onClick={() => onOpenKartica(os.id)}>
                            <FileText className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Uredi osnovno sredstvo" onClick={() => openEditOs(os)}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          {os.status !== "izloceno" && (
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6" title="Izloči"
                              onClick={() => {
                                setIzlociId(os.id);
                                setIzlociDatum(new Date().toISOString().slice(0, 10));
                                setIzlociDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Seštevki */}
            {seštevki && vrstice.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-foreground/20 bg-muted/30 font-semibold">
                  <td colSpan={5} className="px-2 py-2 text-xs text-muted-foreground">SKUPAJ ({vrstice.length})</td>

                  {/* Začetno — NV(1.1.) + Ned(1.1.); PV(1.1.) je v PDF/Excel */}
                  {podroben && <td className="px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-blue-100">{fmt(seštevki.zacNV)}</td>}
                  {/* PV(1.1.) odstranjeno z zaslona */}
                  <td className={`px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-blue-800${podroben ? "" : " border-l border-blue-200"}`}>{fmt(seštevki.zacNed)}</td>

                  {/* Spremembe */}
                  <td className="px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-amber-200 text-amber-800">
                    {parseFloat(seštevki.noveNabave) > 0 ? `+${fmt(seštevki.noveNabave)}` : "—"}
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden text-amber-800">
                    {parseFloat(seštevki.amortObdobja) > 0 ? `−${fmt(seštevki.amortObdobja)}` : "—"}
                  </td>

                  {/* Končno — NV(k) in Ned(k); PV(k) je v PDF/Excel */}
                  {podroben && <td className="px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-green-200">{fmt(seštevki.konNV)}</td>}
                  <td className="px-1 py-1.5 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden border-l border-green-200 text-green-800">{fmt(seštevki.konNed)}</td>

                  {/* SRS — 2 prazni celici v seštevkih (Rac.% + Dat.nab.) */}
                  {podroben && <td colSpan={2} className="border-l border-purple-100 bg-purple-50/10" />}

                  <td colSpan={2} className="border-l border-muted" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Namig za poln nabor podatkov v razširjenem pogledu */}
      {podroben && !isLoading && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <span className="text-purple-600">ⓘ</span>
          Zaslon prikazuje ključne stolpce. Poln nabor SRS podatkov (konti, doba, datum aktivacije, davčna stopnja…) je v
          {" "}<button
            className="underline text-purple-700 hover:text-purple-900 font-medium"
            onClick={() => window.open(buildExportUrl("pdf"), "_blank")}
          >PDF izpisu</button>
          {" "}in{" "}
          <button
            className="underline text-purple-700 hover:text-purple-900 font-medium"
            onClick={() => window.open(buildExportUrl("xlsx"), "_blank")}
          >Excel izvozu</button>.
        </p>
      )}

      {/* Dialogi */}
      <OsDialogWithCounterparties
        companyId={companyId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editingId={editingId}
        form={form}
        setForm={setForm}
        saving={saving}
        saveError={saveError}
        onSave={handleSave}
        skupiny={skupiny}
        costCenters={costCenters}
        accounts={accounts}
      />

      <IzlociDialog
        open={izlociDialogOpen}
        onClose={() => setIzlociDialogOpen(false)}
        datum={izlociDatum}
        setDatum={setIzlociDatum}
        saving={izlociSaving}
        onConfirm={handleIzloci}
      />
    </div>
  );
}

// ─── Kartica (podrobni prikaz glave + vse doknjižbe) ──────────────────────────

function KarticaView({
  companyId,
  osId,
  skupiny,
  costCenters,
  accounts,
  onBack,
}: {
  companyId: string;
  osId: string;
  skupiny: Array<{ id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>;
  costCenters: Array<{ id: string; code: string; name: string }>;
  accounts: Array<{ id: string; code: string; name: string }>;
  onBack: () => void;
}) {
  const qc = useQueryClient();

  const { data, isLoading, error } = useGetOsnovnoSredstvoKartica(companyId, osId);

  // Counterparties — za dobavitelja v DograditevDialog in OsDialog
  const { data: cpData } = useListCounterparties(companyId, { includeInactive: false });
  const counterparties = (cpData?.counterparties ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.name as string,
    taxId: (c.taxId ?? null) as string | null,
  }));

  // Urejanje glave
  const [editGlavaOpen, setEditGlavaOpen] = useState(false);
  const [glavaForm, setGlavaForm] = useState<OsGlavaFormState>(emptyGlavaForm);
  const [glavaSaving, setGlavaSaving] = useState(false);
  const [glavaError, setGlavaError] = useState<string | null>(null);
  const updateMut = useUpdateOsnovnoSredstvo(companyId);

  // Izloči sredstvo
  const [izlociOpen, setIzlociOpen] = useState(false);
  const [izlociDatum, setIzlociDatum] = useState(new Date().toISOString().slice(0, 10));
  const [izlociSaving, setIzlociSaving] = useState(false);
  const izlociMut = useIzlociOsnovnoSredstvo(companyId);

  // Dodaj / uredi dograditev
  const [dograditevOpen, setDograditevOpen] = useState(false);
  const [dograditevForm, setDograditevForm] = useState<DograditevFormState>(emptyDograditevForm);
  const [dograditevSaving, setDograditevSaving] = useState(false);
  const [dograditevError, setDograditevError] = useState<string | null>(null);
  const [editDoknjizbaId, setEditDoknjizbaId] = useState<string | null>(null);
  const createDoknjizba = useCreateOsDoknjizba(companyId);
  const updateDoknjizba = useUpdateOsDoknjizba(companyId);

  // Izloči doknjižbo
  const [izlociDoknjizbaId, setIzlociDoknjizbaId] = useState<string | null>(null);
  const [izlociDoknjizbaOpen, setIzlociDoknjizbaOpen] = useState(false);
  const [izlociDoknjizbaDate, setIzlociDoknjizbaDate] = useState(new Date().toISOString().slice(0, 10));
  const [izlociDoknjizbaSaving, setIzlociDoknjizbaSaving] = useState(false);
  const izlociDoknjizba = useIzlociOsDoknjizba(companyId);

  // PDF izpis kartice
  const [printingPdf, setPrintingPdf] = useState(false);
  const { getToken } = useAuth();

  async function handlePrintKartica() {
    if (!data) return;
    setPrintingPdf(true);
    try {
      const token = await getToken();
      const resp = await fetch(
        `/api/companies/${companyId}/osnovna-sredstva/${data.id}/kartica-pdf`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error((errJson as any).error ?? "Napaka pri generiranju PDF");
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kartica-${data.inventarnaSt}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message ?? "Napaka pri tiskanju kartice");
    } finally {
      setPrintingPdf(false);
    }
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: osnovnoSredstvoKarticaQueryKey(companyId, osId) });
    qc.invalidateQueries({ queryKey: osnovnaSredstvaQueryKey(companyId) });
  }

  function openEditGlava() {
    if (!data) return;
    const seq0 = data.doknjizbe.find((d) => d.seq === 0);
    setGlavaForm({
      inventarnaSt: data.inventarnaSt,
      naziv: data.naziv,
      skupinaId: data.skupinaId ?? "",
      costCenterId: data.costCenterId ?? "",
      accountId: data.accountId ?? "",
      kontoPopravkaId: data.kontoPopravkaId ?? "",
      kontoStroskaId: data.kontoStroskaId ?? "",
      status: data.status,
      opomba: data.opomba ?? "",
      datumOdtujitve: data.datumOdtujitve ?? "",
      razlogIzlocitve: data.razlogIzlocitve ?? "",
      nabavnaVrednost: seq0?.nabavnaVrednost ?? "",
      odpisanaVrednost: seq0?.odpisanaVrednost ?? "0",
      neamortizljiviDelPct: seq0?.neamortizljiviDelPct ?? "0",
      datumNabave: seq0?.datumNabave ?? new Date().toISOString().slice(0, 10),
      datumAktivacije: seq0?.datumAktivacije ?? "",
      datumIzpisa: seq0?.datumIzpisa ?? "",
      partnerId: seq0?.partnerId ?? "",
      stRacuna: seq0?.stRacuna ?? "",
      datumRacuna: seq0?.datumRacuna ?? "",
    });
    setGlavaError(null);
    setEditGlavaOpen(true);
  }

  async function handleSaveGlava() {
    if (!data) return;
    setGlavaSaving(true);
    setGlavaError(null);
    try {
      const seq0 = data.doknjizbe.find((d) => d.seq === 0);
      await Promise.all([
        updateMut.mutateAsync({
          id: osId,
          data: {
            inventarnaSt: glavaForm.inventarnaSt.trim(),
            naziv: glavaForm.naziv.trim(),
            skupinaId: glavaForm.skupinaId || null,
            costCenterId: glavaForm.costCenterId || null,
            accountId: glavaForm.accountId || null,
            kontoPopravkaId: glavaForm.kontoPopravkaId || null,
            kontoStroskaId: glavaForm.kontoStroskaId || null,
            status: glavaForm.status as any,
            opomba: glavaForm.opomba.trim() || null,
            datumOdtujitve: glavaForm.datumOdtujitve.trim() || null,
            razlogIzlocitve: glavaForm.razlogIzlocitve.trim() || null,
          },
        }),
        ...(seq0 ? [updateDoknjizba.mutateAsync({
          sredstvoId: osId,
          doknjizbaId: seq0.id,
          data: {
            nabavnaVrednost: glavaForm.nabavnaVrednost,
            odpisanaVrednost: glavaForm.odpisanaVrednost || "0",
            neamortizljiviDelPct: glavaForm.neamortizljiviDelPct || "0",
            datumNabave: glavaForm.datumNabave,
            datumAktivacije: glavaForm.datumAktivacije || null,
            datumIzpisa: glavaForm.datumIzpisa || null,
            partnerId: glavaForm.partnerId || null,
            stRacuna: glavaForm.stRacuna.trim() || null,
            datumRacuna: glavaForm.datumRacuna || null,
          },
        })] : []),
      ]);
      invalidate();
      setEditGlavaOpen(false);
    } catch (e: any) {
      setGlavaError(e.message ?? "Napaka pri shranjevanju");
    } finally {
      setGlavaSaving(false);
    }
  }

  async function handleIzloci() {
    setIzlociSaving(true);
    try {
      await izlociMut.mutateAsync({ id: osId, datumIzpisa: izlociDatum });
      invalidate();
      setIzlociOpen(false);
      onBack();
    } catch (e: any) {
      alert(e.message ?? "Napaka pri izločitvi");
    } finally {
      setIzlociSaving(false);
    }
  }

  function openEditDograditev(d: OsDoknjizba) {
    setEditDoknjizbaId(d.id);
    setDograditevForm({
      nazivVlaganja: d.nazivVlaganja ?? "",
      nabavnaVrednost: d.nabavnaVrednost,
      odpisanaVrednost: d.odpisanaVrednost,
      neamortizljiviDelPct: d.neamortizljiviDelPct,
      datumNabave: d.datumNabave,
      datumAktivacije: d.datumAktivacije ?? "",
      datumIzpisa: d.datumIzpisa ?? "",
      partnerId: d.partnerId ?? "",
      stRacuna: d.stRacuna ?? "",
      datumRacuna: d.datumRacuna ?? "",
    });
    setDograditevError(null);
    setDograditevOpen(true);
  }

  async function handleAddDograditev() {
    setDograditevSaving(true);
    setDograditevError(null);
    try {
      if (editDoknjizbaId) {
        // Uredi obstoječo dograditev
        await updateDoknjizba.mutateAsync({
          sredstvoId: osId,
          doknjizbaId: editDoknjizbaId,
          data: {
            nazivVlaganja: dograditevForm.nazivVlaganja.trim() || null,
            nabavnaVrednost: dograditevForm.nabavnaVrednost,
            odpisanaVrednost: dograditevForm.odpisanaVrednost || "0",
            neamortizljiviDelPct: dograditevForm.neamortizljiviDelPct || "0",
            datumNabave: dograditevForm.datumNabave,
            datumAktivacije: dograditevForm.datumAktivacije || null,
            datumIzpisa: dograditevForm.datumIzpisa || null,
            partnerId: dograditevForm.partnerId || null,
            stRacuna: dograditevForm.stRacuna.trim() || null,
            datumRacuna: dograditevForm.datumRacuna || null,
          },
        });
      } else {
        // Dodaj novo dograditev
        const body: CreateDoknjizbaBody = {
          nazivVlaganja: dograditevForm.nazivVlaganja.trim() || null,
          nabavnaVrednost: dograditevForm.nabavnaVrednost,
          odpisanaVrednost: dograditevForm.odpisanaVrednost || "0",
          neamortizljiviDelPct: dograditevForm.neamortizljiviDelPct || "0",
          datumNabave: dograditevForm.datumNabave,
          datumAktivacije: dograditevForm.datumAktivacije || null,
          datumIzpisa: dograditevForm.datumIzpisa || null,
          partnerId: dograditevForm.partnerId || null,
          stRacuna: dograditevForm.stRacuna.trim() || null,
          datumRacuna: dograditevForm.datumRacuna || null,
        };
        await createDoknjizba.mutateAsync({ sredstvoId: osId, data: body });
      }
      invalidate();
      setDograditevOpen(false);
      setEditDoknjizbaId(null);
      setDograditevForm(emptyDograditevForm());
    } catch (e: any) {
      setDograditevError(e.message ?? (editDoknjizbaId ? "Napaka pri urejanju dograditve" : "Napaka pri dodajanju dograditve"));
    } finally {
      setDograditevSaving(false);
    }
  }

  async function handleIzlociDoknjizba() {
    if (!izlociDoknjizbaId) return;
    setIzlociDoknjizbaSaving(true);
    try {
      await izlociDoknjizba.mutateAsync({
        sredstvoId: osId,
        doknjizbaId: izlociDoknjizbaId,
        datumIzpisa: izlociDoknjizbaDate,
      });
      invalidate();
      setIzlociDoknjizbaOpen(false);
    } catch (e: any) {
      alert(e.message ?? "Napaka pri izločitvi dograditve");
    } finally {
      setIzlociDoknjizbaSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64" />
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>{(error as Error)?.message ?? "Sredstvo ni bilo najdeno"}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Nazaj na seznam
        </Button>
      </div>
    );
  }

  const skupina = skupiny.find((s) => s.id === data.skupinaId);
  const costCenter = costCenters.find((c: any) => c.id === data.costCenterId);
  const account = accounts.find((a: any) => a.id === data.accountId);
  const kontoPopravka = accounts.find((a: any) => a.id === data.kontoPopravkaId);
  const kontoStroska = accounts.find((a: any) => a.id === data.kontoStroskaId);

  const activeDoknjizbe = data.doknjizbe.filter((d) => d.status !== "izloceno");
  const allDoknjizbe = data.doknjizbe;
  // Dograditve — iz API polja steviloDoknjizb (enako pravilo kot register stolpec "#")
  const steviloDograditev = data.steviloDoknjizb;

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Navigacija */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Nazaj na seznam
        </button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openEditGlava}>
            <Edit2 className="mr-1 h-4 w-4" />
            Uredi
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={printingPdf}
            onClick={handlePrintKartica}
          >
            <FileText className="mr-1 h-4 w-4" />
            {printingPdf ? "Generiranje..." : "Izpis kartice (PDF)"}
          </Button>
          {data.status !== "izloceno" && (
            <>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  setEditDoknjizbaId(null);
                  setDograditevForm(emptyDograditevForm());
                  setDograditevError(null);
                  setDograditevOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Dodaj dograditev
              </Button>
              <Button
                variant="outline" size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setIzlociOpen(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Izloči
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Glava */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-muted-foreground">{data.inventarnaSt}</span>
          <StatusBadge status={data.status} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{data.naziv}</h1>
        {skupina && (
          <p className="text-sm text-muted-foreground">
            Amort. skupina: {skupina.koda} — {skupina.naziv}
            {skupina.racunovodskaStonja && (() => {
              const rac = parseFloat(skupina.racunovodskaStonja).toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
              const dav = skupina.davcnaStonja ? parseFloat(skupina.davcnaStonja).toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 3 }) : null;
              return (
                <span className="ml-2 font-medium text-foreground/80">
                  {dav && dav !== rac ? `${rac} % (rač.) / ${dav} % (dav.)` : `${rac} %`}
                </span>
              );
            })()}
          </p>
        )}
      </div>

      <Separator />

      {/* Skupni seštevki (Σ vseh doknjižb) */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Skupna vrednost (vse doknjižbe)
        </p>
        {/* Vrstica 1: NV + uvožena odpisana */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="rounded-lg border bg-card p-4 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Nabavna vrednost</p>
            <p className="text-2xl font-bold font-mono">{fmt(data.skupnaNabavna)} €</p>
          </div>
          <div className="rounded-lg border bg-card p-4 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Uvožena odpisana</p>
            <p className="text-2xl font-bold font-mono text-muted-foreground">{fmt(data.skupnaOdpisana)} €</p>
            <p className="text-[10px] text-muted-foreground leading-tight">akumulirana amort. na dan uvoza</p>
          </div>
        </div>
        {/* Vrstica 2: Sedanja PRED + PO obračunu */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-muted bg-muted/30 p-4 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Sedanja vrednost (pred obračunom)</p>
            <p className="text-2xl font-bold font-mono text-muted-foreground">
              {fmt(data.sedanjaVrednostPredObracunom ?? data.sedanjaVrednost)} €
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              NV − uvožena odpisana · stanje ob uvozu/aktivaciji
            </p>
          </div>
          <div className={`rounded-lg border p-4 space-y-1 ${
            data.obracunPeriod
              ? "border-green-300 bg-green-50"
              : "border-primary/20 bg-primary/5"
          }`}>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Sedanja vrednost
              {data.obracunPeriod
                ? <span className="ml-1 normal-case font-normal">(po obr. {data.obracunPeriod})</span>
                : " (po obračunu)"}
            </p>
            <p className={`text-2xl font-bold font-mono ${data.obracunPeriod ? "text-green-800" : ""}`}>
              {fmt(data.sedanjaVrednostPoObracunu ?? data.sedanjaVrednost)} €
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {data.obracunPeriod
                ? `pred obr. − amort. ${fmt(data.skupnaAmortizacijaObracunana ?? "0")} €`
                : "ni shranjenih obračunov"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabela doknjižb */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Doknjižbe ({steviloDograditev})
          </p>
          {data.status !== "izloceno" && (
            <Button variant="outline" size="sm" onClick={() => {
              setEditDoknjizbaId(null);
              setDograditevForm(emptyDograditevForm());
              setDograditevError(null);
              setDograditevOpen(true);
            }}>
              <Plus className="mr-1 h-4 w-4" />
              Dodaj dograditev
            </Button>
          )}
        </div>

        {/* Legenda za doknjizbe stolpce — prikaži samo kadar je obračun */}
        {data.obracunPeriod && (
          <div className="flex items-center gap-4 mb-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-muted border" />
              Sed. (pred obr.) = NV − uvožena odpisana
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-green-100 border border-green-300" />
              Sed. (po obr. {data.obracunPeriod}) = sed. − delež amort.
            </span>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Seq</TableHead>
              <TableHead>Opis vlaganja</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-28 text-right">Nabavna</TableHead>
              <TableHead className="w-28 text-right">Uvož. odp.</TableHead>
              <TableHead className="w-28 text-right" title="Sedanja vrednost pred obračunom = NV − uvožena odpisana">Sed. (pred)</TableHead>
              {data.obracunPeriod && (
                <TableHead className="w-28 text-right bg-green-50/50" title={`Sedanja vrednost po obračunu ${data.obracunPeriod}`}>
                  Sed. (po obr.)
                </TableHead>
              )}
              <TableHead className="w-24">Datum nakupa</TableHead>
              <TableHead className="w-24">Aktivacija</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allDoknjizbe.length === 0 ? (
              <TableRow>
                <TableCell colSpan={data.obracunPeriod ? 10 : 9} className="text-center text-muted-foreground py-8">
                  Ni doknjižb.
                </TableCell>
              </TableRow>
            ) : (
              allDoknjizbe.map((d: OsDoknjizba) => (
                <TableRow key={d.id} className={d.status === "izloceno" ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-sm font-bold text-muted-foreground">
                    {d.seq === 0 ? (
                      <span title="Osnovni nakup">0</span>
                    ) : (
                      <span className="text-blue-600">{d.seq}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>
                      {d.seq === 0
                        ? <span className="text-muted-foreground italic">Osnovni nakup</span>
                        : (d.nazivVlaganja || <span className="text-muted-foreground">—</span>)
                      }
                    </div>
                    {/* Dobavitelj + nabavni dokument */}
                    {(d.partnerNaziv || d.stRacuna) && (
                      <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
                        {d.partnerNaziv && (
                          <span title={d.partnerTaxId ?? undefined}>
                            {d.partnerNaziv}
                            {d.partnerTaxId && <span className="text-muted-foreground/60"> ({d.partnerTaxId})</span>}
                          </span>
                        )}
                        {d.stRacuna && <span>· {d.stRacuna}</span>}
                        {d.datumRacuna && <span>· {formatDatum(d.datumRacuna)}</span>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmt(d.nabavnaVrednost)} €</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmt(d.odpisanaVrednost)} €</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {fmt(d.sedanjaVrednost)} €
                  </TableCell>
                  {data.obracunPeriod && (
                    <TableCell className="text-right font-mono text-sm font-medium text-green-800 bg-green-50/30">
                      {d.sedanjaVrednostPoObracunu !== undefined
                        ? `${fmt(d.sedanjaVrednostPoObracunu)} €`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">{formatDatum(d.datumNabave)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDatum(d.datumAktivacije)}</TableCell>
                  <TableCell>
                    {d.seq > 0 && d.status !== "izloceno" && (
                      <div className="flex gap-0.5">
                        <Button
                          variant="ghost" size="icon"
                          title="Uredi dograditev"
                          onClick={() => openEditDograditev(d)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          title="Izloči dograditev"
                          onClick={() => {
                            setIzlociDoknjizbaId(d.id);
                            setIzlociDoknjizbaDate(new Date().toISOString().slice(0, 10));
                            setIzlociDoknjizbaOpen(true);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Skupni atributi glave */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Skupni atributi (določeni enkrat, veljajo za vse doknjižbe)
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {costCenter && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Stroškovno mesto</span>
              <span className="font-medium">{(costCenter as any).code} — {(costCenter as any).name}</span>
            </div>
          )}
          {account && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Konto OS</span>
              <span className="font-mono font-medium">{(account as any).code}</span>
            </div>
          )}
          {kontoPopravka && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Konto popravka</span>
              <span className="font-mono font-medium">{(kontoPopravka as any).code}</span>
            </div>
          )}
          {kontoStroska && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Konto stroška</span>
              <span className="font-mono font-medium">{(kontoStroska as any).code}</span>
            </div>
          )}
          {(data as any).datumOdtujitve && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Datum odtujitve</span>
              <span className="font-medium">{formatDatum((data as any).datumOdtujitve)}</span>
            </div>
          )}
          {(data as any).razlogIzlocitve && (
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">Razlog izločitve</span>
              <span className="text-right max-w-xs">{(data as any).razlogIzlocitve}</span>
            </div>
          )}
          {data.opomba && (
            <div className="flex justify-between py-1.5 border-b border-border/50 col-span-2">
              <span className="text-muted-foreground">Opomba</span>
              <span className="text-right max-w-xs">{data.opomba}</span>
            </div>
          )}
        </div>
      </div>

      {/* Kronološki pregled gibanja vrednosti */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Kronološki pregled gibanja vrednosti</p>
        </div>
        {(!data.kronoloskiPregled || data.kronoloskiPregled.length === 0) ? (
          <p className="text-xs text-muted-foreground">
            Ni podatkov. Dodaj sredstvo in zaženi amortizacijski obračun.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">Datum</th>
                  <th className="text-left py-2 pr-3 font-medium">Opis dogodka</th>
                  <th className="text-right py-2 pr-3 font-medium whitespace-nowrap">Spr. NV (€)</th>
                  <th className="text-right py-2 pr-3 font-medium whitespace-nowrap">AM (€)</th>
                  <th className="text-right py-2 pr-3 font-medium whitespace-nowrap">Skupni PV (€)</th>
                  <th className="text-right py-2 font-medium whitespace-nowrap">Neodpisana (€)</th>
                </tr>
              </thead>
              <tbody>
                {(data.kronoloskiPregled as KronoloskiDogodek[]).map((ev, i) => {
                  const isObracun = ev.obracunanaAm !== "0.00";
                  const isAktivacija = i === 0;
                  const isIzlocitev = ev.opis.includes("Izločitev");
                  return (
                    <tr
                      key={`${ev.datum}-${i}`}
                      className={`border-b last:border-0 ${
                        isIzlocitev ? "bg-red-50/60" : isObracun ? "bg-blue-50/40" : isAktivacija ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-muted-foreground">
                        {/* dd.mm.yyyy */}
                        {ev.datum.length >= 10
                          ? `${ev.datum.slice(8, 10)}.${ev.datum.slice(5, 7)}.${ev.datum.slice(0, 4)}`
                          : ev.datum}
                      </td>
                      <td className="py-1.5 pr-3 font-medium">{ev.opis}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {parseFloat(ev.spremembaNv) > 0
                          ? <span className="text-green-700 font-semibold">+{fmt(ev.spremembaNv)}</span>
                          : parseFloat(ev.spremembaNv) < 0
                            ? <span className="text-red-700 font-semibold">{fmt(ev.spremembaNv)}</span>
                            : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {parseFloat(ev.obracunanaAm) > 0
                          ? <span className="text-red-700 font-semibold">{fmt(ev.obracunanaAm)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground">
                        {fmt(ev.skupniPv)}
                      </td>
                      <td className="py-1.5 text-right font-mono font-bold">
                        {fmt(ev.neodpisana)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {data.kronoloskiPregled.length > 0 && (() => {
                const z = data.kronoloskiPregled[data.kronoloskiPregled.length - 1];
                return (
                  <tfoot>
                    <tr className="bg-primary/5 border-t-2 border-primary/20">
                      <td colSpan={5} className="py-2 pr-3 font-semibold text-xs">Sedanja vrednost</td>
                      <td className="py-2 text-right font-mono font-bold text-base">
                        {fmt(z.neodpisana)} €
                      </td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        )}
      </div>

      {/* Dialogi */}
      <OsDialog
        open={editGlavaOpen}
        onClose={() => setEditGlavaOpen(false)}
        editingId={osId}
        form={glavaForm}
        setForm={setGlavaForm}
        saving={glavaSaving}
        saveError={glavaError}
        onSave={handleSaveGlava}
        skupiny={skupiny}
        costCenters={costCenters}
        accounts={accounts}
        counterparties={counterparties}
        companyId={companyId}
      />

      <DograditevDialog
        open={dograditevOpen}
        onClose={() => { setDograditevOpen(false); setEditDoknjizbaId(null); }}
        sredstvoNaziv={data.naziv}
        form={dograditevForm}
        setForm={setDograditevForm}
        saving={dograditevSaving}
        saveError={dograditevError}
        onSave={handleAddDograditev}
        counterparties={counterparties}
        companyId={companyId}
        editingDoknjizbaId={editDoknjizbaId}
      />

      <IzlociDialog
        open={izlociOpen}
        onClose={() => setIzlociOpen(false)}
        datum={izlociDatum}
        setDatum={setIzlociDatum}
        saving={izlociSaving}
        onConfirm={handleIzloci}
      />

      {/* Izloči dograditev dialog */}
      <Dialog open={izlociDoknjizbaOpen} onOpenChange={(v) => !v && setIzlociDoknjizbaOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Izloči dograditev</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Dograditev bo označena kot izločena. Podatki ostanejo v evidenci.
            </p>
            <div className="space-y-1">
              <Label>Datum izpisa</Label>
              <Input type="date" value={izlociDoknjizbaDate} onChange={(e) => setIzlociDoknjizbaDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIzlociDoknjizbaOpen(false)} disabled={izlociDoknjizbaSaving}>Prekliči</Button>
            <Button variant="destructive" onClick={handleIzlociDoknjizba} disabled={izlociDoknjizbaSaving}>
              {izlociDoknjizbaSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Izloči
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Uvoz dialog ──────────────────────────────────────────────────────────────

interface UvozNapaka {
  sheet: string;
  vrstica: number;
  polje: string;
  opis: string;
}
interface UvozPreview {
  dryRun: true;
  skupineCount: number;
  stmCount: number;
  sredstvaCount: number;
  dograditveCount: number;
  napake: UvozNapaka[];
}
interface UvozRezultat {
  dryRun: false;
  skupineUpserted: number;
  stmUpserted: number;
  sredstvaInserted: number;
  dograditveInserted: number;
  preskocena: number;
  napake: UvozNapaka[];
}

// ─── Tipi za obogatitev ───────────────────────────────────────────────────────
interface ObogatitevOdgovor {
  dryRun: boolean;
  stmNapolnjenih: number;
  kontoPopravkaNapolnjenih: number;
  kontoStroskaaNapolnjenih: number;
  partnerjevNapolnjenih: number;
  neznanaInventarna: number;
  napake: UvozNapaka[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function osUvozFetch(companyId: string, file: File, dryRun: boolean, token: string | null): Promise<UvozPreview | UvozRezultat> {
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${BASE}/api/os/${companyId}/uvoz?dryRun=${dryRun}`, {
    method: "POST",
    body: fd,
    credentials: "include",
    headers,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error((err as any).error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

function NapakeList({ napake }: { napake: UvozNapaka[] }) {
  if (!napake.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1">
        <TriangleAlert className="h-3.5 w-3.5" /> {napake.length} {napake.length === 1 ? "opozorilo" : "opozoril"}
      </p>
      <div className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-amber-50 divide-y divide-amber-100">
        {napake.map((n, i) => (
          <div key={i} className="px-2.5 py-1.5 text-xs">
            <span className="font-medium text-amber-800">{n.sheet} r.{n.vrstica} [{n.polje}]</span>
            <span className="text-amber-700 ml-1">— {n.opis}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UvozDialog({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UvozPreview | null>(null);
  const [result, setResult] = useState<UvozRezultat | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setStep("upload");
    setError(null);
    setPreview(null);
    setResult(null);
    setLoading(false);
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    setError(null);
    setPreview(null);
    setStep("upload");
  }

  async function handlePredoglej() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const prev = await osUvozFetch(companyId, file, true, token) as UvozPreview;
      setPreview(prev);
      setStep("preview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleUvozi() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await osUvozFetch(companyId, file, false, token) as UvozRezultat;
      setResult(res);
      setStep("done");
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { reset(); setOpen(true); }}>
        <Upload className="h-4 w-4" />
        Uvozi
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); setOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {step === "upload" && "Uvoz iz XLSX"}
              {step === "preview" && "Predogled uvoza"}
              {step === "done" && "Uvoz zaključen"}
            </DialogTitle>
          </DialogHeader>

          {/* ── Korak 1: Nalaganje datoteke ── */}
          {step === "upload" && (
            <div className="space-y-4 py-1">
              <p className="text-sm text-muted-foreground">
                Naloži XLSX z listi: <span className="font-medium">Amortizacijske_skupine</span>,{" "}
                <span className="font-medium">Stroskovna_mesta</span>,{" "}
                <span className="font-medium">Sredstva</span>.
              </p>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  file ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileChange(f);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Povleci datoteko sem ali klikni za izbiro
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">.xlsx ali .csv</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>
          )}

          {/* ── Korak 2: Predogled ── */}
          {step === "preview" && preview && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Skupin", count: preview.skupineCount },
                  { label: "STM", count: preview.stmCount },
                  { label: "Sredstev (glav)", count: preview.sredstvaCount },
                  { label: "Dograditev", count: preview.dograditveCount },
                ].map(({ label, count }) => (
                  <div key={label} className="border rounded-lg p-3 text-center bg-muted/30">
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Datoteka: <span className="font-medium">{file?.name}</span>
                {preview.napake.length > 0
                  ? ` — ${preview.napake.length} opozoril (uvoz bo nadaljeval brez teh vrstic)`
                  : " — brez napak"}
              </p>
              <NapakeList napake={preview.napake} />
              {error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>
          )}

          {/* ── Korak 3: Rezultat ── */}
          {step === "done" && result && (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-medium">Uvoz uspešen</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.skupineUpserted}</p>
                  <p className="text-xs text-muted-foreground">amort. skupin</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.stmUpserted}</p>
                  <p className="text-xs text-muted-foreground">stroškovnih mest</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.sredstvaInserted}</p>
                  <p className="text-xs text-muted-foreground">sredstev (glav)</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.dograditveInserted}</p>
                  <p className="text-xs text-muted-foreground">dograditev</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30 col-span-2">
                  <p className="font-medium">{result.preskocena}</p>
                  <p className="text-xs text-muted-foreground">preskočenih (duplikat)</p>
                </div>
              </div>
              <NapakeList napake={result.napake} />
            </div>
          )}

          <DialogFooter>
            {step === "upload" && (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>Prekliči</Button>
                <Button onClick={handlePredoglej} disabled={!file || loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Predoglej
                </Button>
              </>
            )}
            {step === "preview" && (
              <>
                <Button variant="outline" onClick={() => setStep("upload")} disabled={loading}>Nazaj</Button>
                <Button onClick={handleUvozi} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Uvozi ({preview?.sredstvaCount ?? 0} sredstev)
                </Button>
              </>
            )}
            {step === "done" && (
              <Button onClick={() => { setOpen(false); reset(); }}>Zapri</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Obogatitev: fetch + dialog ───────────────────────────────────────────────

async function osObogatitevFetch(
  companyId: string,
  file: File,
  dryRun: boolean,
  token: string | null,
): Promise<ObogatitevOdgovor> {
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(
    `${BASE}/api/os/${companyId}/uvoz-obogatitev?dryRun=${dryRun}`,
    { method: "POST", body: fd, credentials: "include", headers },
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error((err as any).error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

function ObogatitevDialog({
  companyId,
  onDone,
}: {
  companyId: string;
  onDone: () => void;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ObogatitevOdgovor | null>(null);
  const [result, setResult] = useState<ObogatitevOdgovor | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setStep("upload");
    setError(null);
    setPreview(null);
    setResult(null);
    setLoading(false);
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    setError(null);
    setPreview(null);
    setStep("upload");
  }

  async function handlePredoglej() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const prev = await osObogatitevFetch(companyId, file, true, token);
      setPreview(prev);
      setStep("preview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleIzvedi() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await osObogatitevFetch(companyId, file, false, token);
      setResult(res);
      setStep("done");
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const skupajNapolnjenih = preview
    ? preview.stmNapolnjenih +
      preview.kontoPopravkaNapolnjenih +
      preview.kontoStroskaaNapolnjenih +
      preview.partnerjevNapolnjenih
    : 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Wand2 className="h-4 w-4" />
        Obogatitev podatkov
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          setOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {step === "upload" && "Obogatitev obstoječih sredstev"}
              {step === "preview" && "Predogled obogatitve"}
              {step === "done" && "Obogatitev zaključena"}
            </DialogTitle>
          </DialogHeader>

          {/* ── Korak 1: Nalaganje datoteke ── */}
          {step === "upload" && (
            <div className="space-y-4 py-1">
              <p className="text-sm text-muted-foreground">
                Dopolni manjkajoče podatke (StM, konti, dobavitelji) obstoječih
                sredstev iz XLSX.{" "}
                <span className="font-medium text-foreground">
                  Obstoječih vrednosti ne spreminja
                </span>{" "}
                — napolni samo prazna polja.
              </p>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                Pričakovani stolpci:{" "}
                <span className="font-mono font-medium">inventarna</span>,{" "}
                <span className="font-mono font-medium">stm</span>
                {" "}(opcijsko:{" "}
                <span className="font-mono">konto_popravka</span>,{" "}
                <span className="font-mono">konto_stroska</span>,{" "}
                <span className="font-mono">partner_davcna</span>,{" "}
                <span className="font-mono">partner_naziv</span>)
              </p>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  file
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/30 hover:border-primary/50"
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileChange(f);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Povleci datoteko sem ali klikni za izbiro
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">.xlsx</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) =>
                    handleFileChange(e.target.files?.[0] ?? null)
                  }
                />
              </div>
              {error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>
          )}

          {/* ── Korak 2: Predogled ── */}
          {step === "preview" && preview && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "StM bi napolnil",
                    count: preview.stmNapolnjenih,
                    ok: true,
                  },
                  {
                    label: "Konto popravka",
                    count: preview.kontoPopravkaNapolnjenih,
                    ok: true,
                  },
                  {
                    label: "Konto stroška",
                    count: preview.kontoStroskaaNapolnjenih,
                    ok: true,
                  },
                  {
                    label: "Dobaviteljev",
                    count: preview.partnerjevNapolnjenih,
                    ok: true,
                  },
                  {
                    label: "Neznana inventarna",
                    count: preview.neznanaInventarna,
                    ok: false,
                  },
                  {
                    label: "Napake",
                    count: preview.napake.length,
                    ok: false,
                  },
                ].map(({ label, count, ok }) => (
                  <div
                    key={label}
                    className={`border rounded-lg p-3 text-center ${
                      count > 0 && !ok
                        ? "bg-amber-50 border-amber-200"
                        : count > 0
                        ? "bg-green-50 border-green-200"
                        : "bg-muted/30"
                    }`}
                  >
                    <p
                      className={`text-2xl font-bold ${
                        count > 0 && !ok
                          ? "text-amber-700"
                          : count > 0
                          ? "text-green-700"
                          : ""
                      }`}
                    >
                      {count}
                    </p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Datoteka:{" "}
                <span className="font-medium">{file?.name}</span>
                {skupajNapolnjenih > 0
                  ? ` — skupaj ${skupajNapolnjenih} polj bi napolnil`
                  : " — ni ujemanj"}
              </p>
              <NapakeList napake={preview.napake} />
              {error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>
          )}

          {/* ── Korak 3: Rezultat ── */}
          {step === "done" && result && (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-medium">Obogatitev uspešna</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="border rounded p-2.5 bg-green-50">
                  <p className="font-bold text-green-700">
                    {result.stmNapolnjenih}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    stroškovnih mest
                  </p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.kontoPopravkaNapolnjenih}</p>
                  <p className="text-xs text-muted-foreground">kontov popravka</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.kontoStroskaaNapolnjenih}</p>
                  <p className="text-xs text-muted-foreground">kontov stroška</p>
                </div>
                <div className="border rounded p-2.5 bg-muted/30">
                  <p className="font-medium">{result.partnerjevNapolnjenih}</p>
                  <p className="text-xs text-muted-foreground">dobaviteljev</p>
                </div>
                {result.neznanaInventarna > 0 && (
                  <div className="border rounded p-2.5 bg-amber-50 border-amber-200 col-span-2">
                    <p className="font-medium text-amber-700">
                      {result.neznanaInventarna}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      neznanih inventarnih (preskočeno)
                    </p>
                  </div>
                )}
              </div>
              <NapakeList napake={result.napake} />
            </div>
          )}

          <DialogFooter>
            {step === "upload" && (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Prekliči
                </Button>
                <Button onClick={handlePredoglej} disabled={!file || loading}>
                  {loading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Predoglej
                </Button>
              </>
            )}
            {step === "preview" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setStep("upload")}
                  disabled={loading}
                >
                  Nazaj
                </Button>
                <Button
                  onClick={handleIzvedi}
                  disabled={loading || skupajNapolnjenih === 0}
                >
                  {loading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Izvedi obogatitev
                  {skupajNapolnjenih > 0 && ` (${skupajNapolnjenih} polj)`}
                </Button>
              </>
            )}
            {step === "done" && (
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Zapri
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Glavna stran ─────────────────────────────────────────────────────────────

export default function OsnovnaSredstvaPage() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const qc = useQueryClient();
  const [view, setView] = useState<"lista" | "kartica">("lista");
  const [karticaId, setKarticaId] = useState<string | null>(null);

  const { data: skupinyData } = useListOsAmortizacijskeSkupine(
    companyId ?? "",
    {},
    { query: { enabled: !!companyId } as any },
  );
  const { data: costCentersData } = useListCostCenters(
    companyId ?? "",
    {},
    { query: { enabled: !!companyId } as any },
  );
  const { data: accountsData } = useListAccounts(
    companyId ?? "",
    {},
    { query: { enabled: !!companyId } as any },
  );

  const skupiny = skupinyData?.amortizacijskeSkupine ?? [];
  const costCenters = (costCentersData as any)?.costCenters ?? [];
  // Samo 7-mestni analitični konti (npr. 0200100) — skupinski in zbirni konti niso primerni za OS
  const accounts = ((accountsData as any)?.accounts ?? []).filter((a: any) => /^\d{7}$/.test(a.code));

  function openKartica(id: string) {
    setKarticaId(id);
    setView("kartica");
  }

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

  if (view === "kartica" && karticaId) {
    return (
      <KarticaView
        companyId={companyId}
        osId={karticaId}
        skupiny={skupiny}
        costCenters={costCenters}
        accounts={accounts}
        onBack={() => setView("lista")}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Register osnovnih sredstev</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evidenca — amortizacijski obračun pride v koraku 3c
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ObogatitevDialog
            companyId={companyId}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ["osnovna-sredstva", companyId] });
              qc.invalidateQueries({ queryKey: ["cost-centers", companyId] });
            }}
          />
          <UvozDialog
            companyId={companyId}
            onDone={() => {
              // Invalidate seznama sredstev, skupin in stroškovnih mest
              qc.invalidateQueries({ queryKey: ["osnovna-sredstva", companyId] });
              qc.invalidateQueries({ queryKey: ["os-amortizacijske-skupine", companyId] });
              qc.invalidateQueries({ queryKey: ["cost-centers", companyId] });
            }}
          />
        </div>
      </div>

      <ListView
        companyId={companyId}
        skupiny={skupiny}
        costCenters={costCenters}
        accounts={accounts}
        onOpenKartica={openKartica}
      />
    </div>
  );
}
