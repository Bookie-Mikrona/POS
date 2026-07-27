import { useState, useEffect, useRef, Fragment, forwardRef, useMemo } from "react";
import { useF2Save } from "@/hooks/useF2Save";
import {
  useListZaloge,
  useListPrejemnice,
  useListInventure,
  useListArtikli,
  useCreatePrejemnica,
  useCreateInventura,
  useUpdatePrejemnica,
  useDeletePrejemnica,
  useListIzdajnice,
  useCreateIzdajnica,
  useUpdateIzdajnica,
  useDeleteIzdajnica,
  useGetIzdajnica,
  getListIzdajniceQueryKey,
  getGetIzdajnicaQueryKey,
  useUpdateInventura,
  useDeleteInventura,
  useGetKarticaArtikla,
  useGetPrejemnica,
  useGetInventura,
  getListZalogeQueryKey,
  getListPrejemniceQueryKey,
  getListInventureQueryKey,
  getGetPrejemnicaQueryKey,
  getGetInventuraQueryKey,
  useListZacetneZaloge,
  useCreateZacetnaZaloga,
  useGetZacetnaZaloga,
  useUpdateZacetnaZaloga,
  useDeleteZacetnaZaloga,
  getListZacetneZalogeQueryKey,
  getGetZacetnaZalogaQueryKey,
  useReconcileZaloge,
  useListShranjeniKupci,
  useCreateShranjenKupec,
  useOsveziShranjenKupec,
  useUpdateShranjenKupec,
  getListShranjeniKupciQueryKey,
  useCreateArtikel,
  getListArtikliQueryKey,
  getEnotaId,
  type ShranjenKupec,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, PackageOpen, ClipboardList, TrendingDown,
  Search, X, Pencil, AlertTriangle, Package, Archive, Wrench,
  Building2, UserPlus, Loader2, CheckCircle2, Search as SearchIcon, ChevronDown,
} from "lucide-react";

const DDV_OPCIJE = [
  { label: "22 % (splošna)", value: 22 },
  { label: "9,5 % (znižana)", value: 9.5 },
  { label: "5 % (znižana)", value: 5 },
  { label: "0 % (oproščeno)", value: 0 },
];
const ENOTE_MERE = ["kom", "kg", "g", "l", "dl", "ml", "m", "m²", "m³", "par", "pak", "šk", "pal", "set"];

type PrejemnicaRow = { artikelId: number; kolicina: string; cenaKos: string; enotVPaketu: string };
type InventuraRow = { artikelId: number; steviloNajdeno: string; cenaKos: string };
type ZacetnaZalogaRow = { artikelId: number; kolicina: string; cenaKos: string };
type IzdajnicaRow = { artikelId: number; kolicina: string };
type IzdDiffRow = { artikelId: number; knjizno: number; dejansko: string };

// ── Nabavna cena helper ────────────────────────────────────────────────────
/**
 * Normalizira zadnjo nabavno ceno na neto vrednost/enoto.
 * Če je bila shranjena kot bruto (vrsta_cen = 'bruto'), jo deli z (1 + davek/100).
 */
function resolveNetoNabavnaCena(
  cena: number | null,
  vrstaCen: string | null,
  davek: number,
): number | null {
  if (cena == null) return null;
  if (vrstaCen === "bruto" && davek > 0) {
    return Math.round((cena / (1 + davek / 100)) * 10000) / 10000;
  }
  return cena;
}

// ── Datum helpers ──────────────────────────────────────────────────────────
const formatDateSlo = (iso: string): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

const parseDatumInput = (raw: string, defaultYear: number): string | null => {
  const s = raw.trim();
  if (!s) return null;
  let mt: RegExpMatchArray | null;
  // D.M.YYYY
  mt = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (mt) return `${mt[3]}-${mt[2].padStart(2, "0")}-${mt[1].padStart(2, "0")}`;
  // D.M.YY → 20xx
  mt = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (mt) return `${2000 + parseInt(mt[3])}-${mt[2].padStart(2, "0")}-${mt[1].padStart(2, "0")}`;
  // D.M ali D.M. → privzeto leto
  mt = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (mt) return `${defaultYear}-${mt[2].padStart(2, "0")}-${mt[1].padStart(2, "0")}`;
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};

/** Datum input, ki sprejme DD.MM, DD.MM.LL ali DD.MM.LLLL in dopolni leto. */
const SmartDateInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  defaultYear?: number;
  className?: string;
  placeholder?: string;
}>(function SmartDateInput(
  { value, onChange, onKeyDown, defaultYear = new Date().getFullYear(), className, placeholder = "DD.MM.LLLL" },
  ref
) {
  const [raw, setRaw] = useState(() => formatDateSlo(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(formatDateSlo(value));
  }, [value, focused]);

  const commit = (input: string) => {
    const parsed = parseDatumInput(input, defaultYear);
    if (parsed) {
      onChange(parsed);
      setRaw(formatDateSlo(parsed));
    } else if (!input.trim()) {
      onChange("");
      setRaw("");
    }
  };

  return (
    <input
      ref={ref}
      className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50${className ? ` ${className}` : ""}`}
      placeholder={placeholder}
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onFocus={() => { setFocused(true); setRaw(value ? formatDateSlo(value) : ""); }}
      onBlur={() => { setFocused(false); commit(raw); }}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(raw);
        }
        onKeyDown?.(e);
      }}
    />
  );
});

const handleEnterAsTab = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const dialog = (e.currentTarget as HTMLElement).closest('[role="dialog"]');
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
  ));
  const idx = focusable.indexOf(e.currentTarget as HTMLElement);
  if (idx > -1 && idx < focusable.length - 1) focusable[idx + 1].focus();
};

const fmt = (n: number, d = 2) => n.toLocaleString("sl-SI", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtDatum = (d: string | Date) =>
  new Date(d).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
// Dokumentni datumi so shranjeni kot UTC ekvivalent slovenskega časa → prikaži kot UTC datum
const fmtDatumDoc = (d: string | Date) =>
  new Date(d).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const fmtCas = (d: string | Date) =>
  new Date(d).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function TipBadge({ tip }: { tip: string }) {
  if (tip === "prejemnica") return <Badge className="bg-green-100 text-green-800 border-green-200">↑ Prejemnica</Badge>;
  if (tip === "poraba") return <Badge className="bg-red-100 text-red-800 border-red-200">↓ Poraba</Badge>;
  if (tip === "izdajnica") return <Badge className="bg-orange-100 text-orange-800 border-orange-200">↓ Izdajnica</Badge>;
  if (tip === "inventura") return <Badge className="bg-blue-100 text-blue-800 border-blue-200">≡ Inventura</Badge>;
  return <Badge variant="outline">{tip}</Badge>;
}

// ── Dobavitelj combobox ────────────────────────────────────────────────────
function DobaviteljCombobox({
  value, kupci, onChange, onEnterAfterSelect, onNoResults, _inputRef,
}: {
  value: number | null;
  kupci: ShranjenKupec[];
  onChange: (id: number | null, naziv: string) => void;
  onEnterAfterSelect?: () => void;
  onNoResults?: () => void;
  _inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = (_inputRef ?? ownInputRef) as React.RefObject<HTMLInputElement>;
  const selected = value != null ? kupci.find(k => k.id === value) ?? null : null;
  const filtered = filter
    ? kupci.filter(k =>
        k.naziv.toLowerCase().includes(filter.toLowerCase()) ||
        (k.kratkiNaziv ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (k.davcnaStevilka ?? "").includes(filter)
      )
    : kupci;

  const selectItem = (k: ShranjenKupec) => {
    onChange(k.id, k.naziv);
    setOpen(false);
    setFilter("");
    setHighlight(0);
    // premakni fokus na naslednje polje po kratki zakasnitvi (da se stanje posodobi)
    setTimeout(() => onEnterAfterSelect?.(), 0);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring pr-8"
          placeholder="Išči dobavitelja..."
          value={open ? filter : (selected?.naziv ?? "")}
          onChange={e => { if (open) { setFilter(e.target.value); setHighlight(0); } }}
          readOnly={!!selected && !open}
          onFocus={() => { if (!selected) { setOpen(true); setFilter(""); setHighlight(0); } }}
          onClick={() => { if (selected) { setOpen(true); setFilter(""); setHighlight(0); } }}
          onKeyDown={e => {
            if (selected && !open) {
              if (e.key === "Enter") { e.preventDefault(); onEnterAfterSelect?.(); return; }
              if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onChange(null, ""); }
              return;
            }
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return; }
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length === 0) { onNoResults?.(); return; }
              const k = filtered[highlight] ?? filtered[0];
              if (k) selectItem(k);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {selected && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onMouseDown={e => { e.preventDefault(); onChange(null, ""); setFilter(""); }}
            tabIndex={-1}
            type="button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((k, j) => (
            <div
              key={k.id}
              className={`px-3 py-1.5 text-sm cursor-pointer ${j === highlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
              onMouseDown={e => { e.preventDefault(); selectItem(k); }}
            >
              <div className="font-medium">{k.naziv}</div>
              {k.davcnaStevilka && <div className="text-xs text-muted-foreground">ID: {k.davcnaStevilka}</div>}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg px-3 py-2 text-sm text-muted-foreground">
          Ni zadetkov — pritisnite Enter za dodajanje novega
        </div>
      )}
    </div>
  );
}

interface InetisRezultat {
  id?: number | null;
  naziv?: string | null;
  kratkiNaziv?: string | null;
  ulica?: string | null;
  postnaStevilka?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  zavezanecDdv?: boolean | null;
  davcnaStevilka?: string | null;
  idZaDdv?: string | null;
  maticnaStevilka?: string | null;
  trr?: { iban: string; bic: string }[] | null;
  email?: string | null;
  telefon?: string | null;
  eRacunPrejemnik?: boolean | null;
  eRacunOmrezje?: string | null;
  eRacunEmail?: string | null;
  eRacunNaslov?: string | null;
  eRacunSifraPu?: string | null;
  eRacunBic?: string | null;
}

type VrstaDobavitelja = "obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor" | null;

function popravljTrrBic(trr: { iban: string; bic: string }[]): { iban: string; bic: string }[] {
  return trr.map(t =>
    t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
      ? { ...t, bic: "BSLJSI2X" }
      : t
  );
}

function zaznajVrstoDobavitelja(naziv?: string | null, zavezanecDdv?: boolean | null, maticnaStevilka?: string | null): VrstaDobavitelja {
  if (!naziv) return null;
  if (/\bd\.\s*o\.\s*o\.|\bd\.\s*d\.|\bk\.\s*d\.|\bz\.\s*o\.\s*o\.|\bd\.\s*n\.\s*o\.|\be\.\s*s\.\s*p\.|\bk\.\s*d\.\s*d\.|\bs\.\s*k\.\s*e\./i.test(naziv)) return "podjetje";
  if (/\bs\.\s*p\.(\s|$|,)/i.test(naziv)) return "sp";
  if (/\bkmetij|\bkmet\b|\bkgz\b/i.test(naziv)) return "kmet";
  if (/\bšola\b|\bvrtec\b|\bgimnazija\b|\blicej\b|\buniverzit|\bfakultet|\binštitut\b|\bzavod\b|\bobčina\b|\bministrstvo\b|\bagencija\b|\buprava\b|\bsodišče\b|\bbolnica\b|\bdom\s+zdravja\b|\bzdravstveni\s+dom\b|\bdom\s+starejših\b|\bdom\s+upokojencev\b|\bjavni\s+sklad\b|\bkrajevna\s+skupnost\b|\bmestna\s+občina\b/i.test(naziv)) return "javni_sektor";
  if (maticnaStevilka?.trim()) return "podjetje";
  if (!zavezanecDdv) return "obcan";
  return null;
}

// ── Nov dobavitelj inline kartica ─────────────────────────────────────────
type DobaviteljLookupStanje =
  | { tip: "idle" }
  | { tip: "loading" }
  | { tip: "obstaja"; partner: ShranjenKupec }          // bil v šifrantu pred iskanjem
  | { tip: "shranjen"; id: number; data: InetisRezultat } // /poisci ga je ravno shranil
  | { tip: "najden_nov"; data: InetisRezultat }          // DB-save spodletel, ročno ustvarjanje
  | { tip: "ni_najden" }
  | { tip: "napaka" };

function NovDobaviteljKartica({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number, naziv: string) => void;
}) {
  const [naziv, setNaziv] = useState("");
  const [davcna, setDavcna] = useState("");
  const [stanje, setStanje] = useState<DobaviteljLookupStanje>({ tip: "idle" });
  const { data: kupci } = useListShranjeniKupci();
  const createMutation = useCreateShranjenKupec();
  const updateMutation = useUpdateShranjenKupec();
  const osveziMutation = useOsveziShranjenKupec();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Zgradi popoln payload iz registrskih podatkov — enako kot Partnerji.tsx
  function sestavljPayload(reg: InetisRezultat, nazivOverride: string) {
    return {
      vrstaPartnerja: zaznajVrstoDobavitelja(reg.naziv, reg.zavezanecDdv, reg.maticnaStevilka) ?? null,
      naziv: nazivOverride.trim() || reg.naziv?.trim() || "",
      kratkiNaziv: reg.kratkiNaziv?.trim() || null,
      ulica: reg.ulica?.trim() || null,
      postnaStevilka: reg.postnaStevilka?.trim() || null,
      kraj: reg.kraj?.trim() || null,
      drzava: reg.drzava?.trim() || "Slovenija",
      kodaDrzave: reg.kodaDrzave?.trim() || "SI",
      zavezanecDdv: reg.zavezanecDdv ?? null,
      davcnaStevilka: reg.davcnaStevilka?.trim() || davcna.trim() || null,
      idZaDdv: reg.idZaDdv?.trim() || null,
      maticnaStevilka: reg.maticnaStevilka?.trim() || null,
      kmgMid: null,
      eRacunPrejemnik: reg.eRacunPrejemnik ?? null,
      eRacunOmrezje: reg.eRacunOmrezje?.trim() || null,
      eRacunEmail: reg.eRacunEmail?.trim() || null,
      eRacunNaslov: reg.eRacunNaslov?.trim() || null,
      eRacunSifraPu: reg.eRacunSifraPu?.trim() || null,
      eRacunBic: reg.eRacunBic?.trim() || null,
      trr: reg.trr?.length ? popravljTrrBic(reg.trr) : [],
      email: reg.email?.trim() || null,
      telefon: reg.telefon?.trim() || null,
    };
  }

  async function poisciPoReg(davcnaNum: string) {
    // 1. Preveri lokalni šifrant PRED klicem API-ja
    const obstojecKupec = (kupci ?? []).find(
      k => (k.davcnaStevilka ?? "").trim() === davcnaNum
    );
    if (obstojecKupec) {
      setStanje({ tip: "obstaja", partner: obstojecKupec });
      setNaziv(obstojecKupec.naziv ?? "");
      return;
    }
    // 2. Iskanje v registru
    setStanje({ tip: "loading" });
    try {
      const enotaId = getEnotaId();
      const r = await fetch(`${base}/api/kupec/poisci?davcna=${davcnaNum}`, {
        credentials: "include",
        headers: enotaId ? { "X-Enota-Id": enotaId } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as InetisRezultat;

      if (data.id) {
        // /api/kupec/poisci je samodejno shranil partnerja v šifrant in vrnil id.
        // NE smemo klicati POST /kupec/shranjeni še enkrat — to bi ustvarilo duplikat.
        // Invalidiramo cache, da se seznam posodobi z novim zapisom.
        void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
        setStanje({ tip: "shranjen", id: data.id, data });
        setNaziv(data.naziv ?? "");
        return;
      }
      // data.id je null — DB-shranitev je spodletela (redek primer), dovolimo ročno ustvarjanje
      setStanje({ tip: "najden_nov", data });
      setNaziv(data.naziv ?? "");
    } catch (err: unknown) {
      const status = (err as { message?: string })?.message ?? "";
      if (status.includes("404")) setStanje({ tip: "ni_najden" });
      else setStanje({ tip: "napaka" });
    }
  }

  // Samodejno iskanje ko je vnesenih točno 8 cifr
  useEffect(() => {
    const trimmed = davcna.trim();
    if (!/^\d{8}$/.test(trimmed)) {
      setStanje({ tip: "idle" });
      setNaziv("");
      return;
    }
    const t = setTimeout(() => { void poisciPoReg(trimmed); }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [davcna]);

  // Shrani novega dobavitelja z vsemi polji iz registra
  function handleShrani() {
    if (!naziv.trim()) {
      toast({ title: "Naziv je obvezen", variant: "destructive" });
      return;
    }
    if (stanje.tip === "najden_nov") {
      const payload = sestavljPayload(stanje.data, naziv);
      createMutation.mutate({ data: payload as any }, {
        onSuccess: d => {
          void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
          onCreated(d.id, d.naziv);
          onClose();
        },
        onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
      });
    } else {
      // Brez registrskih podatkov — minimalen vnos (le naziv + davčna)
      createMutation.mutate({
        data: {
          naziv: naziv.trim(),
          davcnaStevilka: davcna.trim() || null,
        } as any,
      }, {
        onSuccess: d => {
          void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
          onCreated(d.id, d.naziv);
          onClose();
        },
        onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
      });
    }
  }
  useF2Save(handleShrani, !createMutation.isPending && !!naziv.trim());

  // Posodobi obstoječega in ga izberi
  async function handleObstajaPosodobi(partner: ShranjenKupec) {
    try {
      // Osvezi iz registra (pridobi sveže podatke iz AJPES/INETIS)
      const updated = await osveziMutation.mutateAsync({ id: partner.id });
      void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
      toast({ title: "Partner posodobljen", description: `„${updated.naziv}" je bil osveži iz registra.` });
      onCreated(updated.id, updated.naziv);
      onClose();
    } catch {
      // Osveževanje ni uspelo — samo izberi obstoječega
      toast({ title: "Osveževanje registra ni uspelo", description: "Partner je bil izbran brez osvežitve.", variant: "destructive" });
      onCreated(partner.id, partner.naziv ?? "");
      onClose();
    }
  }

  const jeZaseden = createMutation.isPending || updateMutation.isPending || osveziMutation.isPending;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Building2 className="w-4 h-4 shrink-0" />Nov dobavitelj
      </p>

      {/* ── Davčna številka ── */}
      <div className="space-y-1">
        <Label className="text-xs">Davčna številka</Label>
        <div className="flex gap-1.5">
          <Input
            value={davcna}
            onChange={e => setDavcna(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="8-mestna številka"
            className="h-8 text-sm font-mono"
            autoFocus
            maxLength={8}
          />
          <Button
            variant="outline" size="sm" className="h-8 px-2 shrink-0"
            disabled={!/^\d{8}$/.test(davcna.trim()) || stanje.tip === "loading"}
            onClick={() => void poisciPoReg(davcna.trim())}
            title="Poišči v registru"
          >
            {stanje.tip === "loading"
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <SearchIcon className="w-4 h-4" />}
          </Button>
        </div>

        {/* Statusna vrstica */}
        {stanje.tip === "loading" && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />Iščem v registru…
          </p>
        )}
        {stanje.tip === "shranjen" && (
          <p className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Najden in shranjen v šifrant — samo ga izberite.
          </p>
        )}
        {stanje.tip === "najden_nov" && (
          <p className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Najden v registru — vsi podatki bodo uvoženi.
          </p>
        )}
        {stanje.tip === "ni_najden" && (
          <p className="text-xs text-amber-700">
            Podjetja s to davčno ni v registru — vnesite naziv ročno.
          </p>
        )}
        {stanje.tip === "napaka" && (
          <p className="text-xs text-destructive">Napaka pri iskanju v registru.</p>
        )}
      </div>

      {/* ── Partner ravno shranjen s strani /poisci ── */}
      {stanje.tip === "shranjen" && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-green-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Partner uvožen iz registra in dodan v šifrant
          </p>
          <p className="text-sm font-medium">{stanje.data.naziv}</p>
          {(stanje.data.ulica || stanje.data.kraj) && (
            <p className="text-xs text-muted-foreground">
              {[stanje.data.ulica, stanje.data.postnaStevilka, stanje.data.kraj]
                .filter(Boolean).join(", ")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose}>
              Prekliči
            </Button>
            <Button
              size="sm" className="flex-1 h-8 text-xs"
              onClick={() => { onCreated(stanje.id, stanje.data.naziv ?? ""); onClose(); }}
            >
              Izberi
            </Button>
          </div>
        </div>
      )}

      {/* ── Partner že v šifrantu ── */}
      {stanje.tip === "obstaja" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Ta partner je že v šifrantu
          </p>
          <p className="text-sm font-medium">{stanje.partner.naziv}</p>
          {(stanje.partner.ulica || stanje.partner.kraj) && (
            <p className="text-xs text-muted-foreground">
              {[stanje.partner.ulica, stanje.partner.postnaStevilka, stanje.partner.kraj]
                .filter(Boolean).join(", ")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose}>
              Prekliči
            </Button>
            <Button
              variant="outline" size="sm" className="flex-1 h-8 text-xs"
              onClick={() => { onCreated(stanje.partner.id, stanje.partner.naziv ?? ""); onClose(); }}
            >
              Samo izberi
            </Button>
            <Button
              size="sm" className="flex-1 h-8 text-xs"
              disabled={jeZaseden}
              onClick={() => void handleObstajaPosodobi(stanje.partner)}
            >
              {osveziMutation.isPending
                ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Osvežujem…</>
                : "Osveži in izberi"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Naziv (prikaži ko ni v šifrantu in ni ravno shranjen) ── */}
      {stanje.tip !== "obstaja" && stanje.tip !== "shranjen" && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">
              Naziv <span className="text-destructive">*</span>
              {stanje.tip === "najden_nov" && (
                <span className="text-muted-foreground font-normal"> (iz registra — po potrebi popravite)</span>
              )}
            </Label>
            <Input
              value={naziv}
              onChange={e => setNaziv(e.target.value)}
              placeholder="npr. Mercator d.o.o."
              className="h-8 text-sm"
              onKeyDown={e => e.key === "Enter" && handleShrani()}
            />
          </div>

          {/* Naslov iz registra */}
          {stanje.tip === "najden_nov" && (stanje.data.ulica || stanje.data.kraj) && (
            <p className="text-xs text-muted-foreground">
              {[stanje.data.ulica, stanje.data.postnaStevilka, stanje.data.kraj]
                .filter(Boolean).join(", ")}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Prekliči</Button>
            <Button
              size="sm"
              onClick={handleShrani}
              disabled={jeZaseden || !naziv.trim() || stanje.tip === "loading"}
            >
              {createMutation.isPending ? "Shranjujem…" : <>Dodaj dobavitelja <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── DDV pretvorba ──────────────────────────────────────────────────────────
/**
 * Pretvori vneseno ceno z dobavnice v ceno, ki se shrani v bazo.
 * Zavezanec shranjuje neto (brez DDV); nezavezanec shranjuje bruto (z DDV).
 */
function konvertirajCeno(
  vnos: number,
  davek: number,
  vrstaCen: "neto" | "bruto",
  jeDdvZavezanec: boolean,
): number {
  if (vnos === 0 || davek === 0) return vnos;
  if (jeDdvZavezanec) {
    // Zavezanec → shranjuj neto
    return vrstaCen === "neto"
      ? vnos
      : Math.round((vnos / (1 + davek / 100)) * 10000) / 10000;
  } else {
    // Nezavezanec → shranjuj bruto
    return vrstaCen === "bruto"
      ? vnos
      : Math.round(vnos * (1 + davek / 100) * 10000) / 10000;
  }
}

// ── Nov artikel kartica (inline v postavkah) ───────────────────────────────
function EnotaMereDropdown({
  value, onChange, onConfirm, triggerRef: externalTriggerRef,
}: { value: string; onChange: (v: string) => void; onConfirm: () => void; triggerRef?: React.RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ownBtnRef = useRef<HTMLButtonElement>(null);
  const btnRef = (externalTriggerRef ?? ownBtnRef) as React.RefObject<HTMLButtonElement>;
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIdx = value ? ENOTE_MERE.indexOf(value) : -1;

  const select = (e: string) => { onChange(e); setOpen(false); setTimeout(() => { onConfirm(); }, 0); };

  const scrollTo = (idx: number) =>
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });

  useEffect(() => {
    if (open) {
      const startIdx = selectedIdx >= 0 ? selectedIdx : 0;
      setHi(startIdx);
      setTimeout(() => scrollTo(startIdx), 0);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={`w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-ring ${!value ? "text-muted-foreground" : ""}`}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            setHi(h => { const n = Math.min(h + 1, ENOTE_MERE.length - 1); scrollTo(n); return n; }); return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            setHi(h => { const n = Math.max(h - 1, 0); scrollTo(n); return n; }); return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (open) { select(ENOTE_MERE[hi]); return; }
            // zaprt + vrednost že izbrana → takoj na nasled. polje
            if (value) { onConfirm(); return; }
            // zaprt + brez vrednosti → odpri
            setOpen(true); return;
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      >
        <span>{value || "— izberite —"}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div ref={listRef} className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {ENOTE_MERE.map((e, j) => (
            <div
              key={e}
              data-idx={j}
              className={`px-3 py-1.5 text-sm cursor-pointer ${j === hi ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
              onMouseDown={ev => { ev.preventDefault(); select(e); }}
            >{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function NovArtikelKartica({
  imePredlog,
  onClose,
  onCreated,
}: {
  imePredlog: string;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [imeZaNabavo, setImeZaNabavo] = useState(imePredlog);
  const [enotaMere, setEnotaMere] = useState("");
  const [davek, setDavek] = useState<number>(22);
  const createArtikel = useCreateArtikel();
  const { toast } = useToast();
  const enotaTriggerRef = useRef<HTMLButtonElement>(null);
  const davekRef = useRef<HTMLSelectElement>(null);
  const dodajRef = useRef<HTMLButtonElement>(null);

  function handleDodaj() {
    if (!imeZaNabavo.trim()) {
      toast({ title: "Ime za nabavo je obvezno", variant: "destructive" }); return;
    }
    if (!enotaMere) {
      toast({ title: "Enota mere je obvezna", variant: "destructive" }); return;
    }
    createArtikel.mutate({
      data: {
        ime: imeZaNabavo.trim(),
        imeZaNabavo: imeZaNabavo.trim(),
        enotaMere,
        davek,
        nabavniArtikel: true,
        prodajniArtikel: false,
        vrstaArtikla: "material",
        cena: 0,
        aktiven: true,
      } as any,
    }, {
      onSuccess: d => {
        toast({ title: "Artikel dodan", description: `„${d.imeZaNabavo || d.ime}" je bil dodan v šifrant.` });
        onCreated(d.id);
      },
      onError: () => toast({ title: "Napaka pri dodajanju artikla", variant: "destructive" }),
    });
  }
  useF2Save(handleDodaj, !createArtikel.isPending && !!imeZaNabavo.trim() && !!enotaMere);

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Package className="w-4 h-4 shrink-0" />Nov artikel
        <span className="text-xs text-muted-foreground font-normal ml-1">· nabavni · material</span>
      </p>
      <div className="space-y-1">
        <Label className="text-xs">Ime za nabavo <span className="text-destructive">*</span></Label>
        <Input
          value={imeZaNabavo}
          onChange={e => setImeZaNabavo(e.target.value)}
          placeholder="npr. Moka T550"
          className="h-8 text-sm"
          autoFocus
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); enotaTriggerRef.current?.focus(); } }}
        />
        {imeZaNabavo.trim() && (
          <p className="text-xs text-muted-foreground">Ime za prodajo bo enako: „{imeZaNabavo.trim()}"</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Enota mere <span className="text-destructive">*</span></Label>
          <EnotaMereDropdown
            value={enotaMere}
            onChange={setEnotaMere}
            onConfirm={() => davekRef.current?.focus()}
            triggerRef={enotaTriggerRef}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">DDV stopnja <span className="text-destructive">*</span></Label>
          <select
            ref={davekRef}
            value={davek}
            onChange={e => setDavek(Number(e.target.value))}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); dodajRef.current?.click(); } }}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DDV_OPCIJE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Prekliči</Button>
        <Button
          ref={dodajRef}
          size="sm"
          onClick={handleDodaj}
          disabled={createArtikel.isPending || !imeZaNabavo.trim() || !enotaMere}
        >
          {createArtikel.isPending
            ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Dodajam…</>
            : <>Dodaj artikel <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
        </Button>
      </div>
    </div>
  );
}

// ── Kartica artikla dialog ─────────────────────────────────────────────────
function KarticaDialog({ artikelId, onClose }: { artikelId: number; onClose: () => void }) {
  const [datumOd, setDatumOd] = useState("");
  const [datumDo, setDatumDo] = useState("");
  const [zbirPorabe, setZbirPorabe] = useState(true);

  const params = {
    ...(datumOd ? { datumOd } : {}),
    ...(datumDo ? { datumDo } : {}),
  };
  const { data, isLoading } = useGetKarticaArtikla(artikelId, params);

  // Agregacija porabe po dnevu
  type GibVrstica = NonNullable<typeof data>["gibi"][number] & { zbranoStevilo?: number };
  const gibiPrikaz: GibVrstica[] = useMemo(() => {
    const gibi = data?.gibi ?? [];
    if (!zbirPorabe) return gibi;
    const result: GibVrstica[] = [];
    const dnevnaMap = new Map<string, { sumKol: number; sumVred: number; zadnji: GibVrstica; stevilo: number }>();
    for (const g of gibi) {
      if (g.tip !== "poraba") { result.push(g); continue; }
      const dayKey = (g.datumDokumenta ?? g.ustvarjeno).slice(0, 10);
      const obs = dnevnaMap.get(dayKey);
      if (obs) {
        obs.sumKol += g.kolicina;
        obs.sumVred += (g.vrednost ?? 0);
        obs.zadnji = g;
        obs.stevilo += 1;
      } else {
        dnevnaMap.set(dayKey, { sumKol: g.kolicina, sumVred: g.vrednost ?? 0, zadnji: g, stevilo: 1 });
      }
    }
    const vstavljena = new Set<string>();
    for (const g of gibi) {
      if (g.tip !== "poraba") continue;
      const dayKey = (g.datumDokumenta ?? g.ustvarjeno).slice(0, 10);
      const agg = dnevnaMap.get(dayKey);
      if (!agg || vstavljena.has(dayKey)) continue;
      if (g === agg.zadnji) {
        result.push({ ...agg.zadnji, id: -(new Date(dayKey).getTime()), kolicina: agg.sumKol, vrednost: agg.sumVred, cenaKos: null, zbranoStevilo: agg.stevilo });
        vstavljena.add(dayKey);
      }
    }
    result.sort((a, b) => {
      const da = a.datumDokumenta ?? a.ustvarjeno;
      const db2 = b.datumDokumenta ?? b.ustvarjeno;
      return da < db2 ? -1 : da > db2 ? 1 : 0;
    });
    return result;
  }, [data?.gibi, zbirPorabe]);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {!data && isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Nalaganje...</div>
        ) : !data ? null : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Package className="w-5 h-5 text-primary" />
                {data.artikelIme}
                {data.imeZaNabavo && data.imeZaNabavo !== data.artikelIme && (
                  <span className="text-muted-foreground text-base font-normal">({data.imeZaNabavo})</span>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Zaloga</p>
                <p className={`text-2xl font-bold tabular-nums ${data.kolicina <= 0 ? "text-red-600" : data.kolicina < 5 ? "text-amber-600" : "text-green-700"}`}>
                  {fmt(data.kolicina, 3)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{data.enotaMere ?? "–"}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Povpr. nab. cena (WAC)</p>
                <p className="text-2xl font-bold tabular-nums">
                  {(data.povprecnaCena ?? data.zadnjaCena) != null ? `${fmt(data.povprecnaCena ?? data.zadnjaCena!, 6)} €` : "–"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">/ {data.enotaMere ?? "enoto"}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Vrednost zaloge</p>
                <p className="text-2xl font-bold tabular-nums">
                  {(data.skupnaVrednost ?? data.vrednost) != null ? `${fmt(data.skupnaVrednost ?? data.vrednost!)} €` : "–"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">po povpr. nab. ceni</p>
              </div>
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="flex items-center gap-3 shrink-0">
                  <p className="text-sm font-semibold">Gibanje zalog</p>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={zbirPorabe}
                      onChange={e => setZbirPorabe(e.target.checked)}
                      className="accent-primary"
                    />
                    Dnevni zbir porabe
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Label className="text-xs text-muted-foreground shrink-0">Od</Label>
                  <SmartDateInput
                    value={datumOd}
                    onChange={setDatumOd}
                    className="h-7 text-xs w-36"
                  />
                  <Label className="text-xs text-muted-foreground shrink-0">Do</Label>
                  <SmartDateInput
                    value={datumDo}
                    onChange={setDatumDo}
                    className="h-7 text-xs w-36"
                  />
                  {(datumOd || datumDo) && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setDatumOd(""); setDatumDo(""); }}>
                      <X className="w-3 h-3 mr-1" />Počisti
                    </Button>
                  )}
                </div>
              </div>
              {isLoading ? (
                <div className="py-4 text-center text-sm text-muted-foreground">Nalaganje...</div>
              ) : data.gibi.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {datumOd || datumDo ? "Ni gibanj za izbrano obdobje" : "Ni zabeleženih gibanj"}
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vrsta</TableHead>
                        <TableHead className="text-right">Kol.</TableHead>
                        <TableHead className="text-right">Cena/en.</TableHead>
                        <TableHead className="text-right">Vrednost</TableHead>
                        <TableHead className="text-right text-xs text-muted-foreground">St. kol.</TableHead>
                        <TableHead className="text-right text-xs text-muted-foreground">St. vred.</TableHead>
                        <TableHead>Opomba</TableHead>
                        <TableHead className="text-right text-xs">Datum/čas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gibiPrikaz.map(g => (
                        <TableRow key={g.id}>
                          <TableCell><TipBadge tip={g.tip} /></TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            <span className={g.kolicina >= 0 ? "text-green-700" : "text-red-600"}>
                              {g.kolicina >= 0 ? "+" : ""}{fmt(g.kolicina, 3)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {g.cenaKos != null ? `${fmt(g.cenaKos, 4)} €` : "–"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            {g.vrednost != null ? (
                              <span className={g.vrednost >= 0 ? "text-green-700" : "text-red-600"}>
                                {g.vrednost >= 0 ? "+" : ""}{fmt(Math.abs(g.vrednost))} €
                              </span>
                            ) : "–"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                            {g.stanjeKolicina != null ? fmt(g.stanjeKolicina, 3) : "–"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground" title={g.stanjePovprecnaCena != null ? `WAC: ${fmt(g.stanjePovprecnaCena, 6)} €/en.` : ""}>
                            {g.stanjeVrednost != null ? `${fmt(g.stanjeVrednost)} €` : "–"}
                          </TableCell>
                          <TableCell className="text-sm max-w-[220px]">
                            {g.tip === "prejemnica" ? (
                              <div className="space-y-0.5">
                                {g.prejStevilka && (
                                  <div className="font-mono text-xs font-medium text-primary">{g.prejStevilka}</div>
                                )}
                                {g.dobaviteljNaziv && (
                                  <div className="truncate text-xs font-medium">{g.dobaviteljNaziv}</div>
                                )}
                                {g.opomba && <div className="truncate text-muted-foreground text-xs">{g.opomba}</div>}
                                {!g.prejStevilka && !g.dobaviteljNaziv && !g.opomba && <span className="text-muted-foreground">–</span>}
                              </div>
                            ) : g.tip === "izdajnica" ? (
                              <div className="space-y-0.5">
                                {g.izdStevilka && (
                                  <div className="font-mono text-xs font-medium text-primary">{g.izdStevilka}</div>
                                )}
                                {g.opomba && <div className="truncate text-muted-foreground text-xs">{g.opomba}</div>}
                                {!g.izdStevilka && !g.opomba && <span className="text-muted-foreground">–</span>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{g.opomba ?? "–"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                            {fmtCas(g.datumDokumenta ?? g.ustvarjeno)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Prejemnica dialog ─────────────────────────────────────────────────
// ── Edit Izdajnica dialog ──────────────────────────────────────────────────
function EditIzdajnicaDialog({
  id, nabavniArtikli, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useGetIzdajnica(id);
  const updateIzdajnica = useUpdateIzdajnica();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  const [rows, setRows] = useState<IzdajnicaRow[]>([]);
  const initializedId = useRef<number | null>(null);
  const izdEditKoliRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [izdEditDdOpenIdx, setIzdEditDdOpenIdx] = useState<number | null>(null);
  const [izdEditDdFilter, setIzdEditDdFilter] = useState("");
  const [izdEditDdHighlight, setIzdEditDdHighlight] = useState(0);
  const izdEditArtInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!data) return;
    if (initializedId.current === data.id) return;
    initializedId.current = data.id;
    setDatum(new Date(data.datum).toISOString().slice(0, 10));
    setOpomba(data.opomba ?? "");
    setRows(data.postavke.map((p: { artikelId: number; kolicina: number }) => ({ artikelId: p.artikelId, kolicina: String(p.kolicina) })));
  }, [data]);

  const updateArtikel = (i: number, artikelId: number) => {
    setRows(r => r.map((row, j) => j === i ? { ...row, artikelId } : row));
    setIzdEditDdOpenIdx(null);
    setIzdEditDdFilter("");
    setTimeout(() => izdEditKoliRefs.current.get(i)?.focus(), 30);
  };
  const addRow = () => setRows(r => [...r, { artikelId: 0, kolicina: "" }]);
  const removeRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const handleSave = () => {
    const validRows = rows.filter(r => r.artikelId > 0 && r.kolicina !== "");
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    updateIzdajnica.mutate({
      id,
      data: {
        datum: datum || undefined,
        opomba: opomba || null,
        postavke: validRows.map(r => ({ artikelId: r.artikelId, kolicina: parseDecimal(r.kolicina) || 0 })),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzdajniceQueryKey() });
        toast({ title: "Izdajnica posodobljena" });
        onSaved();
      },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  useF2Save(handleSave, !updateIzdajnica.isPending && rows.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Uredi izdajnico</DialogTitle></DialogHeader>
        {isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={datum} onChange={setDatum} />
              </div>
              <div className="space-y-2">
                <Label>Opomba</Label>
                <Input value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Opomba..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="space-y-2">
                {rows.map((row, i) => {
                  const isOpen = izdEditDdOpenIdx === i;
                  const selectedArtikel = row.artikelId > 0 ? nabavniArtikli.find(a => a.id === row.artikelId) : null;
                  const filtered = izdEditDdFilter
                    ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(izdEditDdFilter.toLowerCase()))
                    : nabavniArtikli;
                  return (
                    <div key={i} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <input
                          ref={el => { if (el) izdEditArtInputRefs.current.set(i, el); else izdEditArtInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? izdEditDdFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${selectedArtikel.enotaMere})` : ""}` : "")}
                          onChange={e => { if (selectedArtikel) return; setIzdEditDdFilter(e.target.value); setIzdEditDdHighlight(0); if (!isOpen) setIzdEditDdOpenIdx(i); }}
                          readOnly={!!selectedArtikel && !isOpen}
                          onFocus={() => { if (!selectedArtikel) { setIzdEditDdOpenIdx(i); setIzdEditDdFilter(""); setIzdEditDdHighlight(0); } }}
                          onKeyDown={e => {
                            if (selectedArtikel && !isOpen) {
                              if (e.key === "Enter") { e.preventDefault(); izdEditKoliRefs.current.get(i)?.focus(); return; }
                              if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setRows(r => r.map((row, j) => j === i ? { ...row, artikelId: 0 } : row)); setIzdEditDdOpenIdx(i); setIzdEditDdFilter(""); return; }
                              return;
                            }
                            if (e.key === "Escape") { e.preventDefault(); setIzdEditDdOpenIdx(null); return; }
                            if (e.key === "ArrowDown") { e.preventDefault(); setIzdEditDdHighlight(h => Math.min(h + 1, filtered.length - 1)); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); setIzdEditDdHighlight(h => Math.max(h - 1, 0)); return; }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (!isOpen) { setIzdEditDdOpenIdx(i); setIzdEditDdFilter(""); setIzdEditDdHighlight(0); return; }
                              const art = filtered[izdEditDdHighlight];
                              if (art) updateArtikel(i, art.id);
                            }
                          }}
                        />
                        {isOpen && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                            {filtered.length === 0
                              ? <div className="px-3 py-2 text-xs text-muted-foreground">Ni zadetkov</div>
                              : filtered.map((a, j) => (
                                <div key={a.id}
                                  className={`px-3 py-1.5 text-sm cursor-pointer ${j === izdEditDdHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                                  onMouseDown={e => { e.preventDefault(); updateArtikel(i, a.id); }}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </div>
                              ))
                            }
                          </div>
                        )}
                      </div>
                      <DecimalInput
                        ref={el => { if (el) izdEditKoliRefs.current.set(i, el); else izdEditKoliRefs.current.delete(i); }}
                        placeholder="Količina"
                        value={row.kolicina}
                        onChange={e => setRows(r => r.map((row, j) => j === i ? { ...row, kolicina: e.target.value } : row))}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const el = izdEditKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                          else if (e.key === "ArrowUp") { e.preventDefault(); const el = izdEditKoliRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                        }}
                        className="w-28"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="w-4 h-4 mr-1" />Dodaj postavko
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={handleSave} disabled={updateIzdajnica.isPending || rows.length === 0}>
            {updateIzdajnica.isPending ? "Shranjujem..." : <>Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPrejemnicaDialog({
  id, nabavniArtikli, zaloge, jeDdvZavezanec, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null; davek: number }[];
  zaloge: { artikelId: number; zadnjaCena?: number | null }[] | undefined;
  jeDdvZavezanec: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useGetPrejemnica(id);
  const updatePrejemnica = useUpdatePrejemnica();
  const { data: kupci } = useListShranjeniKupci();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  const [dobaviteljId, setDobaviteljId] = useState<number | null>(null);
  const [rows, setRows] = useState<PrejemnicaRow[]>([]);
  const [novDobaviteljOpen, setNovDobaviteljOpen] = useState(false);
  const initializedId = useRef<number | null>(null);
  const initializedVrstaCen = useRef<string | null>(null);
  const editArtInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editKoliInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editCenaInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editEnotInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editNovArtBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const editPakBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const editDodajRef = useRef<HTMLButtonElement>(null);
  const editDatumRef = useRef<HTMLInputElement>(null);
  const editDobavInputRef = useRef<HTMLInputElement>(null);
  const editOpombaRef = useRef<HTMLInputElement>(null);
  const editFocusedOnOpen = useRef(false);
  type ZadnjaNabavnaEdit = { zadnjaNabavnaCena: number; zadnjaVrstaCen: string };
  const zadnjeNabavneEditRef = useRef<Map<number, ZadnjaNabavnaEdit>>(new Map());

  useEffect(() => {
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const enotaId = localStorage.getItem("pos_enota_id") ?? "";
    fetch(`${base}/api/zaloge/zadnje-nabavne`, {
      credentials: "include",
      headers: { "x-enota-id": enotaId },
    })
      .then(r => r.ok ? r.json() : [])
      .then((rows: { artikelId: number; zadnjaNabavnaCena: number; zadnjaVrstaCen: string }[]) => {
        zadnjeNabavneEditRef.current = new Map(rows.map(r => [r.artikelId, { zadnjaNabavnaCena: r.zadnjaNabavnaCena, zadnjaVrstaCen: r.zadnjaVrstaCen }]));
      })
      .catch(() => {});
  }, [id]);

  const navEdit = (rowIdx: number, col: "art" | "enot" | "koli" | "cena", dir: "left" | "right" | "up" | "down") => {
    const cols = ["art", "enot", "koli", "cena"] as const;
    const refs: Record<string, React.MutableRefObject<Map<number, HTMLInputElement>>> = {
      art: editArtInputRefs, enot: editEnotInputRefs, koli: editKoliInputRefs, cena: editCenaInputRefs,
    };
    if (dir === "up" || dir === "down") {
      const nextRow = dir === "down" ? rowIdx + 1 : rowIdx - 1;
      const el = refs[col].current.get(nextRow);
      if (el) { el.focus(); el.select(); }
    } else {
      const step = dir === "right" ? 1 : -1;
      let c = cols.indexOf(col) + step;
      while (c >= 0 && c < cols.length) {
        const el = refs[cols[c]].current.get(rowIdx);
        if (el) { el.focus(); el.select(); return; }
        c += step;
      }
    }
  };
  const editShraniRef = useRef<HTMLButtonElement>(null);
  const [ddOpenIdx, setDdOpenIdx] = useState<number | null>(null);
  const [ddFilter, setDdFilter] = useState("");
  const [ddHighlight, setDdHighlight] = useState(0);
  const [editNovArtikelRowIdx, setEditNovArtikelRowIdx] = useState<number | null>(null);
  const [editVrstaCen, setEditVrstaCen] = useState<"neto" | "bruto">("neto");

  useEffect(() => {
    if (isLoading || rows.length === 0) return;
    if (editFocusedOnOpen.current) return;
    editFocusedOnOpen.current = true;
    setTimeout(() => editDatumRef.current?.focus(), 50);
  }, [isLoading, rows.length]);

  useEffect(() => {
    if (!data) return;
    const isNewId = initializedId.current !== data.id;
    // data.vrstaCen je lahko undefined v starem React Query cache-u (pred dodanim SELECT poljem);
    // ko pride sveži fetch z dejansko vrednostjo, jo posodobimo tudi če je ID enak
    const serverVrstaCen = data.vrstaCen ?? null;
    const vrstaCenChanged = serverVrstaCen !== null && serverVrstaCen !== initializedVrstaCen.current;

    if (!isNewId && !vrstaCenChanged) return;

    const vrstaCenLoaded = serverVrstaCen === "bruto" ? "bruto" : "neto";

    if (isNewId) {
      initializedId.current = data.id;
      setDatum(new Date(data.datum).toISOString().slice(0, 10));
      setOpomba(data.opomba ?? "");
      setDobaviteljId((data as any).dobaviteljId ?? null);
    }

    initializedVrstaCen.current = vrstaCenLoaded;
    setEditVrstaCen(vrstaCenLoaded as "neto" | "bruto");
    setRows(data.postavke.map(p => {
      // cenaKos v bazi je vedno neto/enoto; pri bruto načinu pretvorimo nazaj v bruto
      const davek = nabavniArtikli.find(a => a.id === p.artikelId)?.davek ?? 0;
      const cenaNetoEnoto = Number(p.cenaKos);
      const prikazCenaEnoto = vrstaCenLoaded === "bruto" && davek
        ? Math.round(cenaNetoEnoto * (1 + davek / 100) * 10000) / 10000
        : cenaNetoEnoto;
      // Če je bil vnos v paketih, razpakiramo: paketov = kolicina / enot, cena/paket = cena/enoto * enot
      const enot = Number((p as any).enotVPaketu ?? 1);
      const jeVPaketih = enot > 1;
      const prikazKolicina = jeVPaketih ? Math.round(Number(p.kolicina) / enot * 10000) / 10000 : Number(p.kolicina);
      const prikazCena = jeVPaketih ? Math.round(prikazCenaEnoto * enot * 10000) / 10000 : prikazCenaEnoto;
      return {
        artikelId: p.artikelId,
        kolicina: String(prikazKolicina),
        cenaKos: String(prikazCena),
        enotVPaketu: jeVPaketih ? String(enot) : "",
      };
    }));
  }, [data, nabavniArtikli]);

  const addRow = () => {
    const newIdx = rows.length;
    setRows(r => [...r, { artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "" }]);
    setTimeout(() => editArtInputRefs.current.get(newIdx)?.focus(), 30);
  };
  const selectArtikelInEditRow = (rowIdx: number, artikelId: number, skipFocus = false) => {
    const nabavnaEntry = zadnjeNabavneEditRef.current.get(artikelId);
    const davek = nabavniArtikli.find(a => a.id === artikelId)?.davek ?? 0;
    const zadnjaCenaNeto = nabavnaEntry
      ? resolveNetoNabavnaCena(nabavnaEntry.zadnjaNabavnaCena, nabavnaEntry.zadnjaVrstaCen, davek)
      : null;
    const prikazCena = zadnjaCenaNeto != null
      ? (editVrstaCen === "bruto" && davek
          ? Math.round(zadnjaCenaNeto * (1 + davek / 100) * 10000) / 10000
          : zadnjaCenaNeto)
      : null;
    setRows(r => r.map((row, j) => j === rowIdx
      ? { ...row, artikelId, cenaKos: prikazCena != null ? String(prikazCena) : row.cenaKos }
      : row));
    setDdOpenIdx(null);
    setDdFilter("");
    if (!skipFocus) setTimeout(() => editPakBtnRefs.current.get(rowIdx)?.focus(), 30);
  };
  const removeRow = (i: number) => setRows(r => {
    const next = r.filter((_, j) => j !== i);
    return next.length > 0 ? next : [{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "" }];
  });
  const updateRow = <K extends keyof PrejemnicaRow>(i: number, key: K, val: PrejemnicaRow[K]) =>
    setRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));

  const skupajTotals = rows.reduce((acc, r) => {
    const enot = parseDecimal(r.enotVPaketu) || 1;
    const kol = (parseDecimal(r.kolicina) || 0) * enot;
    const vnos = parseDecimal(r.cenaKos) || 0;
    const cenaNaEnoto = enot > 1 ? vnos / enot : vnos;
    const davek = nabavniArtikli.find(a => a.id === r.artikelId)?.davek ?? 0;
    const shranjeno = konvertirajCeno(cenaNaEnoto, davek, editVrstaCen, jeDdvZavezanec);
    const neto = jeDdvZavezanec ? shranjeno : (davek ? shranjeno / (1 + davek / 100) : shranjeno);
    const bruto = jeDdvZavezanec ? (davek ? shranjeno * (1 + davek / 100) : shranjeno) : shranjeno;
    return { neto: acc.neto + kol * neto, bruto: acc.bruto + kol * bruto };
  }, { neto: 0, bruto: 0 });

  const handleSave = () => {
    const validRows = rows.filter(r => r.artikelId > 0 && r.kolicina !== "");
    if (!validRows.length) { toast({ title: "Vsaj ena postavka je obvezna", variant: "destructive" }); return; }
    updatePrejemnica.mutate({
      id,
      data: {
        datum,
        dobaviteljId: dobaviteljId ?? null,
        opomba: opomba || null,
        vrstaCen: editVrstaCen,
        postavke: validRows.map(r => {
          const enot = parseDecimal(r.enotVPaketu) || 1;
          const cenaNaEnoto = enot > 1 ? (parseDecimal(r.cenaKos) || 0) / enot : (parseDecimal(r.cenaKos) || 0);
          return {
            artikelId: r.artikelId,
            kolicina: parseDecimal(r.kolicina) * enot,
            cenaKos: konvertirajCeno(
              cenaNaEnoto,
              nabavniArtikli.find(a => a.id === r.artikelId)?.davek ?? 0,
              editVrstaCen,
              jeDdvZavezanec,
            ),
            enotVPaketu: enot,
          };
        }),
      } as any,
    }, {
      onSuccess: () => { toast({ title: "Prejemnica posodobljena" }); onSaved(); },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  useF2Save(handleSave, !updatePrejemnica.isPending && rows.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Uredi prejemnico</DialogTitle></DialogHeader>
        {isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput ref={editDatumRef} value={datum} onChange={setDatum}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); editDobavInputRef.current?.focus(); } }} />
              </div>
              <div className="space-y-2">
                <Label>Dobavitelj</Label>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <DobaviteljCombobox
                      value={dobaviteljId}
                      kupci={kupci ?? []}
                      onChange={(id) => setDobaviteljId(id)}
                      _inputRef={editDobavInputRef}
                      onEnterAfterSelect={() => editOpombaRef.current?.focus()}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    title="Dodaj novega dobavitelja"
                    onClick={() => setNovDobaviteljOpen(v => !v)}
                  >
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Opomba</Label>
              <Input ref={editOpombaRef} value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Referenca, opomba..." onKeyDown={handleEnterAsTab} />
            </div>

            {/* Vrsta cen na dobavnici */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Cene na dobavnici:</span>
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button type="button"
                  className={`px-3 py-1.5 transition-colors ${editVrstaCen === "neto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => setEditVrstaCen("neto")}>Neto (brez DDV)</button>
                <button type="button"
                  className={`px-3 py-1.5 border-l transition-colors ${editVrstaCen === "bruto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => setEditVrstaCen("bruto")}>Bruto (maloprodajne)</button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="space-y-2">
                {rows.map((row, i) => {
                  const isOpen = ddOpenIdx === i;
                  const selectedArtikel = row.artikelId > 0 ? nabavniArtikli.find(a => a.id === row.artikelId) : null;
                  const filtered = ddFilter
                    ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(ddFilter.toLowerCase()))
                    : nabavniArtikli;
                  return (
                    <Fragment key={i}>
                    <div className="flex gap-2 items-center">
                      {/* Artikel combobox */}
                      <div className="relative flex-1">
                        {selectedArtikel ? (
                          <div
                            className="w-full border rounded-md px-3 py-2 text-sm bg-background flex items-center gap-1"
                            tabIndex={0}
                            onKeyDown={e => {
                              if (e.key === "Backspace" || e.key === "Delete") {
                                e.preventDefault();
                                updateRow(i, "artikelId", 0);
                                setTimeout(() => editArtInputRefs.current.get(i)?.focus(), 10);
                              }
                            }}
                          >
                            <span className="flex-1 truncate">
                              {selectedArtikel.imeZaNabavo || selectedArtikel.ime}
                              {selectedArtikel.enotaMere ? ` (${selectedArtikel.enotaMere})` : ""}
                            </span>
                            <button type="button" tabIndex={-1}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              onClick={() => { updateRow(i, "artikelId", 0); setTimeout(() => editArtInputRefs.current.get(i)?.focus(), 10); }}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <input
                            ref={el => { if (el) editArtInputRefs.current.set(i, el); else editArtInputRefs.current.delete(i); }}
                            className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="Išči artikel..."
                            onFocus={() => { setDdOpenIdx(i); setDdFilter(""); setDdHighlight(0); }}
                            onBlur={() => setDdOpenIdx(null)}
                            onChange={e => { setDdFilter(e.target.value); setDdHighlight(0); }}
                            onKeyDown={e => {
                              if (e.key === "Escape") { e.preventDefault(); setDdOpenIdx(null); return; }
                              if (e.key === "ArrowDown") { e.preventDefault(); setDdHighlight(h => Math.min(h + 1, Math.max(0, filtered.length - 1))); return; }
                              if (e.key === "ArrowUp") { e.preventDefault(); setDdHighlight(h => Math.max(h - 1, 0)); return; }
                              if (e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "art", "right"); return; }
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (filtered.length === 0) { setDdOpenIdx(null); setEditNovArtikelRowIdx(i); return; }
                                const art = filtered[ddHighlight];
                                if (art) selectArtikelInEditRow(i, art.id);
                              }
                            }}
                          />
                        )}
                        {isOpen && !selectedArtikel && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                            {filtered.length === 0 ? (
                              <div className="px-3 py-2 space-y-1.5">
                                <p className="text-xs text-muted-foreground">Ni zadetkov za „{ddFilter}"</p>
                                <button
                                  ref={el => { if (el) editNovArtBtnRefs.current.set(i, el); else editNovArtBtnRefs.current.delete(i); }}
                                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      setDdOpenIdx(null);
                                      setEditNovArtikelRowIdx(i);
                                    }
                                  }}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setDdOpenIdx(null);
                                    setEditNovArtikelRowIdx(i);
                                  }}
                                >
                                  <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                                </button>
                              </div>
                            ) : filtered.map((a, j) => (
                              <div key={a.id}
                                className={`px-3 py-1.5 text-sm cursor-pointer ${j === ddHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                                onMouseDown={e => { e.preventDefault(); selectArtikelInEditRow(i, a.id); }}>
                                {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Pakiranje gumb + enot-v-paketu polje */}
                      <div className="flex flex-col items-center gap-0.5">
                        <Button ref={el => { if (el) editPakBtnRefs.current.set(i, el); else editPakBtnRefs.current.delete(i); }}
                          variant="ghost" size="icon" className={`h-8 w-8 ${row.enotVPaketu ? "text-primary" : "text-muted-foreground"}`}
                          title="Pakiranje (vez, karton, …)"
                          onClick={() => {
                            if (row.enotVPaketu) {
                              updateRow(i, "enotVPaketu", "");
                            } else {
                              setTimeout(() => editEnotInputRefs.current.get(i)?.focus(), 30);
                            }
                          }}>
                          <Package className="w-3.5 h-3.5" />
                        </Button>
                        {(row.enotVPaketu !== undefined) && (
                          <DecimalInput
                            ref={el => { if (el) editEnotInputRefs.current.set(i, el as any); else editEnotInputRefs.current.delete(i); }}
                            value={row.enotVPaketu}
                            placeholder="enot/pak"
                            onChange={e => updateRow(i, "enotVPaketu", e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "enot", "right"); }
                              else if (e.key === "ArrowLeft") { e.preventDefault(); navEdit(i, "enot", "left"); }
                              else if (e.key === "ArrowUp") { e.preventDefault(); navEdit(i, "enot", "up"); }
                              else if (e.key === "ArrowDown") { e.preventDefault(); navEdit(i, "enot", "down"); }
                            }}
                            className="w-16 text-xs h-7 text-center"
                          />
                        )}
                      </div>
                      {/* Količina / Paketov */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput
                          ref={el => { if (el) editKoliInputRefs.current.set(i, el as any); else editKoliInputRefs.current.delete(i); }}
                          placeholder={row.enotVPaketu ? "Paketov" : "Količina"}
                          value={row.kolicina}
                          onChange={e => updateRow(i, "kolicina", e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "koli", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navEdit(i, "koli", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navEdit(i, "koli", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navEdit(i, "koli", "down"); }
                          }}
                          className="w-24" />
                        {row.enotVPaketu && parseDecimal(row.enotVPaketu) > 1 && parseDecimal(row.kolicina) > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            = {fmt(parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1))} {nabavniArtikli.find(a => a.id === row.artikelId)?.enotaMere ?? "enot"}
                          </span>
                        )}
                      </div>
                      {/* Cena / Cena na paket */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput value={row.cenaKos}
                          placeholder={row.enotVPaketu ? "Cena/paket" : (editVrstaCen === "neto" ? "Cena brez DDV" : "Maloprodajna cena")}
                          onChange={e => updateRow(i, "cenaKos", e.target.value)}
                          ref={el => { if (el) editCenaInputRefs.current.set(i, el as any); else editCenaInputRefs.current.delete(i); }}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); editDodajRef.current?.focus(); return; }
                            if (e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "cena", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navEdit(i, "cena", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navEdit(i, "cena", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navEdit(i, "cena", "down"); }
                          }}
                          className="w-28" />
                        {row.enotVPaketu && parseDecimal(row.enotVPaketu) > 1 && parseDecimal(row.cenaKos) > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            = {fmt(parseDecimal(row.cenaKos) / (parseDecimal(row.enotVPaketu) || 1))} €/enoto
                          </span>
                        )}
                      </div>
                      {/* Preračunana cena (readonly) */}
                      {(() => {
                        const enot = parseDecimal(row.enotVPaketu) || 1;
                        const vnos = parseDecimal(row.cenaKos) || 0;
                        const cenaNaEnoto = enot > 1 ? vnos / enot : vnos;
                        const davek = nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0;
                        const shranjeno = konvertirajCeno(cenaNaEnoto, davek, editVrstaCen, jeDdvZavezanec);
                        return (
                          <input
                            readOnly
                            tabIndex={-1}
                            value={vnos ? fmt(shranjeno) : ""}
                            placeholder={jeDdvZavezanec ? "Neto" : "Bruto"}
                            title={jeDdvZavezanec ? "Cena/enoto, ki se shrani (brez DDV)" : "Cena/enoto, ki se shrani (z DDV)"}
                            className="w-24 border rounded-md px-2 py-2 text-sm bg-muted text-muted-foreground text-right cursor-default select-none"
                          />
                        );
                      })()}
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => removeRow(i)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    {editNovArtikelRowIdx === i && (
                      <NovArtikelKartica
                        imePredlog={ddFilter}
                        onClose={() => setEditNovArtikelRowIdx(null)}
                        onCreated={id => {
                          void queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
                          setEditNovArtikelRowIdx(null);
                          setTimeout(() => { selectArtikelInEditRow(i, id, true); editPakBtnRefs.current.get(i)?.focus(); }, 150);
                        }}
                      />
                    )}
                    </Fragment>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <Button ref={editDodajRef} variant="outline" size="sm" onClick={addRow}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); addRow(); return; }
                    if (e.key === "Tab" && !e.shiftKey) {
                      e.preventDefault();
                      editShraniRef.current?.focus();
                    }
                  }}>
                  <Plus className="w-4 h-4 mr-1" />Dodaj postavko
                </Button>
                <div className="text-sm text-muted-foreground text-right space-y-0.5">
                  <div>Skupaj brez DDV: <strong className="text-foreground">{fmt(skupajTotals.neto)} €</strong></div>
                  <div>Skupaj z DDV: <strong className="text-foreground">{fmt(skupajTotals.bruto)} €</strong></div>
                </div>
              </div>
            </div>
          </div>
        )}
        {novDobaviteljOpen && (
          <div className="px-6 pb-2">
            <NovDobaviteljKartica
              onClose={() => setNovDobaviteljOpen(false)}
              onCreated={(id, naziv) => {
                setDobaviteljId(id);
                void naziv;
                queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
              }}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button ref={editShraniRef} onClick={handleSave} disabled={updatePrejemnica.isPending || rows.length === 0}>
            {updatePrejemnica.isPending ? "Shranjujem..." : <>Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Inventura dialog ──────────────────────────────────────────────────
function EditInventuraDialog({
  id, nabavniArtikli, zaloge, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null }[];
  zaloge: { artikelId: number; kolicina: number; zadnjaCena?: number | null }[] | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useGetInventura(id);
  const updateInventura = useUpdateInventura();
  const { toast } = useToast();

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  type EditRow = InventuraRow & { steviloPrejsnje: string };
  const [rows, setRows] = useState<EditRow[]>([]);
  const initializedId = useRef<number | null>(null);
  const invEditNajdenoRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  type ZadnjaNabavnaInv = { zadnjaNabavnaCena: number; zadnjaVrstaCen: string };
  const zadnjeNabavneInvRef = useRef<Map<number, ZadnjaNabavnaInv>>(new Map());

  useEffect(() => {
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const enotaId = localStorage.getItem("pos_enota_id") ?? "";
    fetch(`${base}/api/zaloge/zadnje-nabavne`, {
      credentials: "include",
      headers: { "x-enota-id": enotaId },
    })
      .then(r => r.ok ? r.json() : [])
      .then((fetched: { artikelId: number; zadnjaNabavnaCena: number; zadnjaVrstaCen: string }[]) => {
        zadnjeNabavneInvRef.current = new Map(fetched.map(r => [r.artikelId, { zadnjaNabavnaCena: r.zadnjaNabavnaCena, zadnjaVrstaCen: r.zadnjaVrstaCen }]));
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (data && initializedId.current !== data.id) {
      initializedId.current = data.id;
      setDatum(new Date(data.datum).toISOString().slice(0, 10));
      setOpomba(data.opomba ?? "");
      setRows(data.postavke.map(p => ({
        artikelId: p.artikelId,
        steviloNajdeno: String(p.steviloNajdeno),
        cenaKos: String(p.cenaKos),
        steviloPrejsnje: String(p.steviloPrejsnje),
      })));
    }
  }, [data]);

  const addRow = () => {
    setRows(r => [...r, { artikelId: 0, steviloNajdeno: "0", cenaKos: "0", steviloPrejsnje: "0" }]);
  };
  const removeRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));
  const updateRow = (i: number, val: string) =>
    setRows(r => r.map((row, j) => j === i ? { ...row, steviloNajdeno: val } : row));
  const updateArtikel = (i: number, artikelId: number) => {
    const nabavnaEntry = zadnjeNabavneInvRef.current.get(artikelId);
    // Inventura nima davka — cena se vedno shranjuje kot neto, davek = 0
    const zadnjaCenaNeto = nabavnaEntry
      ? resolveNetoNabavnaCena(nabavnaEntry.zadnjaNabavnaCena, nabavnaEntry.zadnjaVrstaCen, 0)
      : null;
    setRows(r => r.map((row, j) => j === i ? { ...row, artikelId, cenaKos: zadnjaCenaNeto != null ? String(zadnjaCenaNeto) : row.cenaKos } : row));
  };

  const handleSave = () => {
    const validRows = rows.filter(r => r.artikelId > 0);
    if (!validRows.length) { toast({ title: "Vsaj ena postavka je obvezna", variant: "destructive" }); return; }
    updateInventura.mutate({
      id,
      data: {
        datum,
        opomba: opomba || null,
        postavke: validRows.map(r => ({
          artikelId: r.artikelId,
          steviloNajdeno: parseDecimal(r.steviloNajdeno) || 0,
        })),
      },
    }, {
      onSuccess: () => { toast({ title: "Inventura posodobljena" }); onSaved(); },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  useF2Save(handleSave, !updateInventura.isPending && rows.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Uredi inventuro</DialogTitle></DialogHeader>
        {isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={datum} onChange={setDatum} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} />
              </div>
              <div className="space-y-2">
                <Label>Opomba</Label>
                <Input value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Opomba k inventuri..." onKeyDown={handleEnterAsTab} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Cena</TableHead>
                      <TableHead className="text-right">Knjižno</TableHead>
                      <TableHead className="text-right w-28">Dejansko</TableHead>
                      <TableHead className="text-right text-red-700">Razl. kol. (−)</TableHead>
                      <TableHead className="text-right text-green-700">Razl. kol. (+)</TableHead>
                      <TableHead className="text-right text-red-700">Razl. vredn. (−)</TableHead>
                      <TableHead className="text-right text-green-700">Razl. vredn. (+)</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const art = nabavniArtikli.find(a => a.id === row.artikelId);
                      const zalogaInfo = zaloge?.find(z => z.artikelId === row.artikelId);
                      const cena = parseDecimal(row.cenaKos) || null;
                      // Knjižno = shranjeno steviloPrejsnje iz inventure (ne tekoča zaloga!)
                      const knjizno = parseDecimal(row.steviloPrejsnje) || 0;
                      const dejansko = parseDecimal(row.steviloNajdeno) || 0;
                      const razlikaKol = dejansko - knjizno;
                      const razlikaVrednost = cena != null ? razlikaKol * cena : null;
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <select
                              className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                              value={row.artikelId}
                              onChange={e => updateArtikel(i, parseInt(e.target.value))}
                            >
                              <option value={0} disabled>— Izberi artikel —</option>
                              {nabavniArtikli.map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {cena != null ? `${fmt(cena)} €` : <span className="text-muted-foreground">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(knjizno, 3)}</TableCell>
                          <TableCell>
                            <DecimalInput value={row.steviloNajdeno}
                              ref={el => { if (el) invEditNajdenoRefs.current.set(i, el as any); else invEditNajdenoRefs.current.delete(i); }}
                              onChange={e => updateRow(i, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const el = invEditNajdenoRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = invEditNajdenoRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="text-right h-8" />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-red-600">
                            {razlikaKol < 0 ? fmt(razlikaKol, 3) : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-green-600">
                            {razlikaKol > 0 ? `+${fmt(razlikaKol, 3)}` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-red-600">
                            {razlikaVrednost != null && razlikaVrednost < 0 ? `${fmt(razlikaVrednost)} €` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-green-600">
                            {razlikaVrednost != null && razlikaVrednost > 0 ? `+${fmt(razlikaVrednost)} €` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => removeRow(i)} disabled={rows.length === 1}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="w-4 h-4 mr-1" />Dodaj postavko
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={handleSave} disabled={updateInventura.isPending || rows.length === 0}>
            {updateInventura.isPending ? "Shranjujem..." : <>Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Začetna zaloga dialog ─────────────────────────────────────────────
function EditZacetnaZalogaDialog({
  id, nabavniArtikli, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useGetZacetnaZaloga(id);
  const updateZacetnaZaloga = useUpdateZacetnaZaloga();
  const { toast } = useToast();

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  const [rows, setRows] = useState<ZacetnaZalogaRow[]>([]);
  const initializedId = useRef<number | null>(null);
  const zzEditKoliRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const zzEditCenaRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const navZZEdit = (i: number, col: "koli" | "cena", dir: "left" | "right" | "up" | "down") => {
    const focus = (ref: Map<number, HTMLInputElement>, row: number) => { const el = ref.get(row); if (el) { el.focus(); el.select(); } };
    if (dir === "up") focus(col === "koli" ? zzEditKoliRefs.current : zzEditCenaRefs.current, i - 1);
    else if (dir === "down") focus(col === "koli" ? zzEditKoliRefs.current : zzEditCenaRefs.current, i + 1);
    else if (dir === "right") {
      if (col === "koli") focus(zzEditCenaRefs.current, i);
      else focus(zzEditKoliRefs.current, i + 1);
    } else if (dir === "left") {
      if (col === "cena") focus(zzEditKoliRefs.current, i);
    }
  };

  useEffect(() => {
    if (data && initializedId.current !== data.id) {
      initializedId.current = data.id;
      setDatum(new Date(data.datum).toISOString().slice(0, 10));
      setOpomba(data.opomba ?? "");
      setRows(data.postavke.map(p => ({
        artikelId: p.artikelId,
        kolicina: String(p.kolicina),
        cenaKos: String(p.cenaKos),
      })));
    }
  }, [data]);

  const skupajVrednost = rows.reduce((s, r) => s + (parseDecimal(r.kolicina) || 0) * (parseDecimal(r.cenaKos) || 0), 0);

  const addRow = () => {
    const usedIds = new Set(rows.map(r => r.artikelId));
    const next = nabavniArtikli.find(a => !usedIds.has(a.id));
    setRows(r => [...r, { artikelId: next?.id ?? nabavniArtikli[0]?.id ?? 0, kolicina: "0", cenaKos: "0" }]);
  };
  const removeRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));
  const updateRow = (i: number, key: keyof ZacetnaZalogaRow, val: string | number) =>
    setRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));

  const handleSave = () => {
    const validRows = rows.filter(r => r.artikelId > 0);
    if (!validRows.length) { toast({ title: "Vsaj ena postavka je obvezna", variant: "destructive" }); return; }
    updateZacetnaZaloga.mutate({
      id,
      data: {
        datum,
        opomba: opomba || null,
        postavke: validRows.map(r => ({
          artikelId: r.artikelId,
          kolicina: parseDecimal(r.kolicina) || 0,
          cenaKos: parseDecimal(r.cenaKos) || 0,
        })),
      },
    }, {
      onSuccess: () => { toast({ title: "Začetne zaloge posodobljene" }); onSaved(); },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  useF2Save(handleSave, !updateZacetnaZaloga.isPending && rows.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Uredi začetne zaloge</DialogTitle></DialogHeader>
        {isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={datum} onChange={setDatum} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} />
              </div>
              <div className="space-y-2">
                <Label>Opomba</Label>
                <Input value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Opomba..." onKeyDown={handleEnterAsTab} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right w-28">Količina</TableHead>
                      <TableHead className="text-right w-28">Cena/enoto</TableHead>
                      <TableHead className="text-right w-28">Vrednost (€)</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const vrednost = (parseDecimal(row.kolicina) || 0) * (parseDecimal(row.cenaKos) || 0);
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <select
                              className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                              value={row.artikelId}
                              onChange={e => updateRow(i, "artikelId", parseInt(e.target.value))}
                            >
                              {nabavniArtikli.map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell>
                            <DecimalInput value={row.kolicina}
                              ref={el => { if (el) zzEditKoliRefs.current.set(i, el as any); else zzEditKoliRefs.current.delete(i); }}
                              onChange={e => updateRow(i, "kolicina", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="text-right h-8" />
                          </TableCell>
                          <TableCell>
                            <DecimalInput value={row.cenaKos}
                              ref={el => { if (el) zzEditCenaRefs.current.set(i, el as any); else zzEditCenaRefs.current.delete(i); }}
                              onChange={e => updateRow(i, "cenaKos", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowLeft") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="text-right h-8" />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            {vrednost > 0 ? `${fmt(vrednost)} €` : <span className="text-muted-foreground">–</span>}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => removeRow(i)} disabled={rows.length === 1}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addRow}>
                  <Plus className="w-4 h-4 mr-1" />Dodaj postavko
                </Button>
                <p className="text-sm text-muted-foreground">
                  Skupna vrednost: <strong className="text-foreground">{fmt(skupajVrednost)} €</strong>
                </p>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={handleSave} disabled={updateZacetnaZaloga.isPending || rows.length === 0}>
            {updateZacetnaZaloga.isPending ? "Shranjujem..." : <>Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Zaloge() {
  const { data: zaloge, isLoading: loadingZ } = useListZaloge();
  const { data: prejemnice, isLoading: loadingP } = useListPrejemnice();
  const { data: inventure, isLoading: loadingI } = useListInventure();
  const { data: zacetneZaloge, isLoading: loadingZZ } = useListZacetneZaloge();
  const { data: izdajnice, isLoading: loadingIzd } = useListIzdajnice();
  const { data: artikli } = useListArtikli();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const jeAdmin = user?.vloga === "admin" || user?.vloga === "superadmin";
  const currentYear = new Date().getFullYear();

  // ── Reconcile ──────────────────────────────────────────────────────
  const reconcile = useReconcileZaloge();
  const [reconcileDialogOpen, setReconcileDialogOpen] = useState(false);
  const handleReconcile = () => {
    reconcile.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        toast({ title: `Zaloge popravljene (${data.popravljeno} artiklov)` });
      },
      onError: () => toast({ title: "Napaka pri popravljanju zalog", variant: "destructive" }),
    });
  };

  const nabavniArtikli = (artikli ?? []).filter(a => a.nabavniArtikel);

  // ── DDV zavezanec: bere se iz companiesTable.zavezanecDdv prek user profila ──
  const jeDdvZavezanec = user?.jeDdvZavezanec ?? false;

  // ── Kartica ────────────────────────────────────────────────────────
  const [karticeArtikelId, setKarticeArtikelId] = useState<number | null>(null);

  // ── Search ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const filteredZaloge = (zaloge ?? []).filter(z =>
    !q || z.artikelIme.toLowerCase().includes(q) || (z.imeZaNabavo ?? "").toLowerCase().includes(q)
  );
  const negativneZaloge = (zaloge ?? []).filter(z => z.kolicina < 0);

  // ── Prejemnica create ──────────────────────────────────────────────
  const { data: kupci } = useListShranjeniKupci();
  const [prejDialogOpen, setPrejDialogOpen] = useState(false);
  const [prejDatum, setPrejDatum] = useState("");
  const [prejDobaviteljId, setPrejDobaviteljId] = useState<number | null>(null);
  const [prejDobaviteljNaziv, setPrejDobaviteljNaziv] = useState("");
  const [novDobaviteljOpen, setNovDobaviteljOpen] = useState(false);
  const [prejStevilkaDobavnice, setPrejStevilkaDobavnice] = useState("");
  const [prejDatumDobavnice, setPrejDatumDobavnice] = useState("");
  const [prejOpomba, setPrejOpomba] = useState("");
  const [prejRows, setPrejRows] = useState<PrejemnicaRow[]>([{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "" }]);
  // Dropdown state za artikel combobox
  const [dropdownOpenIdx, setDropdownOpenIdx] = useState<number | null>(null);
  const [dropdownFilter, setDropdownFilter] = useState("");
  const [dropdownHighlight, setDropdownHighlight] = useState(0);

  // Ko se odpre dropdown za artikel, porinemo vrstico na vrh dialoga, da ima spodaj prostor za seznam
  useEffect(() => {
    if (dropdownOpenIdx !== null) {
      setTimeout(() => {
        artInputRefs.current.get(dropdownOpenIdx)?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 30);
    }
  }, [dropdownOpenIdx]);
  const [novArtikelRowIdx, setNovArtikelRowIdx] = useState<number | null>(null);
  // Vrsta cen na dobavnici (neto/bruto) — per-form, ponastavi ob odprtju
  const [vrstaCen, setVrstaCen] = useState<"neto" | "bruto">("neto");
  // Zadnje nabavne cene — napolni se ob odprtju dialoga (svež direkten klic)
  type ZadnjaNabavna = { zadnjaNabavnaCena: number; zadnjaVrstaCen: string };
  const zadnjeNabavneRef = useRef<Map<number, ZadnjaNabavna>>(new Map());

  // Refs za focus management
  const artInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const koliInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const cenaInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const enotInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const novArtBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const pakBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const invNajdenoRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const zzKoliRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const zzCenaRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Navigacija s puščicami po mreži polj: art → enot → koli → cena (levo/desno), vrstice gor/dol
  const navPrej = (rowIdx: number, col: "art" | "enot" | "koli" | "cena", dir: "left" | "right" | "up" | "down") => {
    const cols = ["art", "enot", "koli", "cena"] as const;
    const refs: Record<string, React.MutableRefObject<Map<number, HTMLInputElement>>> = {
      art: artInputRefs, enot: enotInputRefs, koli: koliInputRefs, cena: cenaInputRefs,
    };
    if (dir === "up" || dir === "down") {
      const nextRow = dir === "down" ? rowIdx + 1 : rowIdx - 1;
      const el = refs[col].current.get(nextRow);
      if (el) { el.focus(); el.select(); }
    } else {
      const step = dir === "right" ? 1 : -1;
      let c = cols.indexOf(col) + step;
      while (c >= 0 && c < cols.length) {
        const el = refs[cols[c]].current.get(rowIdx);
        if (el) { el.focus(); el.select(); return; }
        c += step;
      }
    }
  };
  const prejDatumRef = useRef<HTMLInputElement>(null);
  const prejDobaviteljInputRef = useRef<HTMLInputElement>(null);
  const prejDodajDobaviteljaRef = useRef<HTMLButtonElement>(null);
  const prejStevilkaRef = useRef<HTMLInputElement>(null);
  const prejDatumDobavniceRef = useRef<HTMLInputElement>(null);
  const prejOpombaRef = useRef<HTMLInputElement>(null);
  const prejNetoRef = useRef<HTMLButtonElement>(null);
  const prejBrutoRef = useRef<HTMLButtonElement>(null);
  const createPrejemnica = useCreatePrejemnica();

  const openPrejDialog = async () => {
    // Svež direkten klic — počakamo preden odpremo dialog
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const enotaId = localStorage.getItem("pos_enota_id") ?? "";
      const r = await fetch(`${base}/api/zaloge/zadnje-nabavne`, {
        credentials: "include",
        headers: { "x-enota-id": enotaId },
      });
      const rows: { artikelId: number; zadnjaNabavnaCena: number; zadnjaVrstaCen: string }[] = r.ok ? await r.json() : [];
      zadnjeNabavneRef.current = new Map(rows.map(row => [row.artikelId, { zadnjaNabavnaCena: row.zadnjaNabavnaCena, zadnjaVrstaCen: row.zadnjaVrstaCen }]));
    } catch { /* dialog se odpre vseeno */ }
    setVrstaCen("neto");
    setPrejDatum(new Date().toISOString().slice(0, 10));
    setPrejDobaviteljId(null);
    setPrejDobaviteljNaziv("");
    setPrejStevilkaDobavnice("");
    setPrejDatumDobavnice("");
    setPrejOpomba("");
    setPrejRows([{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "" }]);
    setDropdownOpenIdx(null);
    setDropdownFilter("");
    setDropdownHighlight(0);
    setPrejDialogOpen(true);
  };
  const handleSavePrejemnica = () => {
    const validRows = prejRows.filter(r => r.artikelId > 0 && r.kolicina !== "");
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    const datumDobavniceSlo = prejDatumDobavnice ? formatDateSlo(prejDatumDobavnice) : "";
    const refParts = [prejStevilkaDobavnice, datumDobavniceSlo].filter(Boolean);
    const refPrefix = refParts.length > 0 ? `(${refParts.join(", ")})` : "";
    const fullOpomba = [refPrefix, prejOpomba].filter(Boolean).join(" ");
    createPrejemnica.mutate({
      data: {
        datum: prejDatum || undefined,
        dobaviteljId: prejDobaviteljId ?? undefined,
        opomba: fullOpomba || undefined,
        vrstaCen,
        postavke: validRows.map(r => {
          const enot = parseDecimal(r.enotVPaketu) || 1;
          const kolicinaPaketov = parseDecimal(r.kolicina);
          const cenaNaPaket = parseDecimal(r.cenaKos) || 0;
          return {
            artikelId: r.artikelId,
            kolicina: kolicinaPaketov * enot,
            cenaKos: konvertirajCeno(
              enot > 1 ? cenaNaPaket / enot : cenaNaPaket,
              nabavniArtikli.find(a => a.id === r.artikelId)?.davek ?? 0,
              vrstaCen,
              jeDdvZavezanec,
            ),
            enotVPaketu: enot,
          };
        }),
      } as any,
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPrejemniceQueryKey() });
        setPrejDialogOpen(false);
        toast({ title: "Prejemnica shranjena" });
      },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  const addPrejRow = () => {
    const newIdx = prejRows.length;
    setPrejRows(r => [...r, { artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "" }]);
    setTimeout(() => artInputRefs.current.get(newIdx)?.focus(), 30);
  };
  const removePrejRow = (i: number) => setPrejRows(r => r.filter((_, j) => j !== i));
  const updatePrejRow = <K extends keyof PrejemnicaRow>(i: number, key: K, val: PrejemnicaRow[K]) =>
    setPrejRows(r => r.map((row, j) => {
      if (j !== i) return row;
      const posodobljena = { ...row, [key]: val };
      // Ko se spremeni enotVPaketu in artikel je že izbran → posodobi predlagano ceno
      if (key === "enotVPaketu" && row.artikelId > 0) {
        const zr = (zaloge ?? []).find(z => z.artikelId === row.artikelId);
        const zadnjaCenaNeto = resolveNetoNabavnaCena(zr?.zadnjaNabavnaCena ?? null, zr?.zadnjaVrstaCen ?? null, nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0) ?? zr?.zadnjaCena ?? null;
        if (zadnjaCenaNeto != null) {
          const davek = nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0;
          const cenaNaEnoto = vrstaCen === "bruto" && davek
            ? Math.round(zadnjaCenaNeto * (1 + davek / 100) * 10000) / 10000
            : zadnjaCenaNeto;
          const novaEnot = parseDecimal(String(val)) || 1;
          posodobljena.cenaKos = String(Math.round(cenaNaEnoto * novaEnot * 10000) / 10000);
        }
      }
      return posodobljena;
    }));
  const selectArtikelInRow = (rowIdx: number, artikelId: number, skipFocus = false) => {
    updatePrejRow(rowIdx, "artikelId", artikelId);
    const nabavnaEntry = zadnjeNabavneRef.current.get(artikelId);
    const davek = nabavniArtikli.find(a => a.id === artikelId)?.davek ?? 0;
    const zadnjaCenaNeto = nabavnaEntry
      ? resolveNetoNabavnaCena(nabavnaEntry.zadnjaNabavnaCena, nabavnaEntry.zadnjaVrstaCen, davek)
      : null;
    if (zadnjaCenaNeto != null) {
      // zadnjaCenaNeto je normalizirana neto cena/enoto; pretvorimo v ceno za prikaz v vnosnem polju
      const enotVPaketu = parseDecimal(prejRows[rowIdx]?.enotVPaketu) || 1;
      // najprej neto → bruto če je bruto način, potem × enot v paketu za ceno/paket
      const cenaNaEnoto = vrstaCen === "bruto" && davek
        ? Math.round(zadnjaCenaNeto * (1 + davek / 100) * 10000) / 10000
        : zadnjaCenaNeto;
      const prikazCena = Math.round(cenaNaEnoto * enotVPaketu * 10000) / 10000;
      updatePrejRow(rowIdx, "cenaKos", String(prikazCena));
    } else {
      updatePrejRow(rowIdx, "cenaKos", "");
    }
    setDropdownOpenIdx(null);
    setDropdownFilter("");
    if (!skipFocus) setTimeout(() => pakBtnRefs.current.get(rowIdx)?.focus(), 30);
  };

  // ── Izdajnica create ───────────────────────────────────────────────
  const [izdDialogOpen, setIzdDialogOpen] = useState(false);
  const [izdDatum, setIzdDatum] = useState("");
  const [izdOpomba, setIzdOpomba] = useState("");
  const [izdRows, setIzdRows] = useState<IzdajnicaRow[]>([{ artikelId: 0, kolicina: "" }]);
  const [izdDropdownOpenIdx, setIzdDropdownOpenIdx] = useState<number | null>(null);
  const [izdDropdownFilter, setIzdDropdownFilter] = useState("");
  const [izdDropdownHighlight, setIzdDropdownHighlight] = useState(0);
  const [izdNovArtikelRowIdx, setIzdNovArtikelRowIdx] = useState<number | null>(null);
  const izdArtInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const izdKoliInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const izdAddBtnRef = useRef<HTMLButtonElement>(null);
  const izdDatumRef = useRef<HTMLInputElement>(null);
  const izdOpombaRef = useRef<HTMLInputElement>(null);
  // ── Razlika zalog (ne-normativni artikli) ──────────────────────────
  const [izdDiffOpen, setIzdDiffOpen] = useState(false);
  const [izdDiffRows, setIzdDiffRows] = useState<IzdDiffRow[]>([]);
  const izdDiffDejanRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const createIzdajnica = useCreateIzdajnica();

  const openIzdDialog = () => {
    setIzdDatum(new Date().toISOString().slice(0, 10));
    setIzdOpomba("");
    setIzdRows([{ artikelId: 0, kolicina: "" }]);
    setIzdDropdownOpenIdx(null);
    setIzdDropdownFilter("");
    setIzdDropdownHighlight(0);
    setIzdNovArtikelRowIdx(null);
    setIzdDiffOpen(false);
    setIzdDiffRows([]);
    setIzdDialogOpen(true);
    setTimeout(() => izdDatumRef.current?.focus(), 50);
  };

  const openIzdDiff = () => {
    const neNormativni = nabavniArtikli.filter(a => !a.vNormativih);
    setIzdDiffRows(neNormativni.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      const knjizno = Number(z?.kolicina ?? 0);
      return { artikelId: a.id, knjizno, dejansko: fmt(knjizno, 3) };
    }));
    setIzdDiffOpen(true);
  };
  const handleSaveIzdajnica = () => {
    const validRows = izdRows.filter(r => r.artikelId > 0 && r.kolicina !== "");
    // Razlika zalog: poraba = knjizno − dejansko, samo kjer poraba > 0
    const diffPostavke = izdDiffOpen
      ? izdDiffRows
          .map(r => ({ artikelId: r.artikelId, kolicina: r.knjizno - (parseDecimal(r.dejansko) || 0) }))
          .filter(r => r.kolicina > 0.0001)
      : [];
    const vsePostavke = [
      ...validRows.map(r => ({ artikelId: r.artikelId, kolicina: parseDecimal(r.kolicina) || 0 })),
      ...diffPostavke,
    ];
    if (!vsePostavke.length) { toast({ title: "Ni porabe za shraniti — preverite vnešene količine", variant: "destructive" }); return; }
    createIzdajnica.mutate({
      data: {
        datum: izdDatum || undefined,
        opomba: izdOpomba || null,
        postavke: vsePostavke,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzdajniceQueryKey() });
        setIzdDialogOpen(false);
        toast({ title: "Izdajnica shranjena" });
      },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  const addIzdRow = () => {
    const newIdx = izdRows.length;
    setIzdRows(r => [...r, { artikelId: 0, kolicina: "" }]);
    setTimeout(() => izdArtInputRefs.current.get(newIdx)?.focus(), 30);
  };
  const removeIzdRow = (i: number) => setIzdRows(r => r.filter((_, j) => j !== i));
  const updateIzdRow = <K extends keyof IzdajnicaRow>(i: number, key: K, val: IzdajnicaRow[K]) =>
    setIzdRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));
  const selectIzdArtikelInRow = (rowIdx: number, artikelId: number) => {
    updateIzdRow(rowIdx, "artikelId", artikelId);
    setIzdDropdownOpenIdx(null);
    setIzdDropdownFilter("");
    setTimeout(() => izdKoliInputRefs.current.get(rowIdx)?.focus(), 30);
  };

  // ── Izdajnica edit ─────────────────────────────────────────────────
  const [editIzdId, setEditIzdId] = useState<number | null>(null);

  // ── Izdajnica delete ───────────────────────────────────────────────
  const [deleteIzdId, setDeleteIzdId] = useState<number | null>(null);
  const deleteIzdajnica = useDeleteIzdajnica();
  const handleDeleteIzdajnica = () => {
    if (!deleteIzdId) return;
    deleteIzdajnica.mutate({ id: deleteIzdId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzdajniceQueryKey() });
        setDeleteIzdId(null);
        toast({ title: "Izdajnica izbrisana, zaloge povrnjene" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  // ── Prejemnica edit ────────────────────────────────────────────────
  const [editPrejId, setEditPrejId] = useState<number | null>(null);

  // ── Prejemnica delete ──────────────────────────────────────────────
  const [deletePrejId, setDeletePrejId] = useState<number | null>(null);
  const deletePrejemnica = useDeletePrejemnica();
  const handleDeletePrejemnica = () => {
    if (!deletePrejId) return;
    deletePrejemnica.mutate({ id: deletePrejId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPrejemniceQueryKey() });
        setDeletePrejId(null);
        toast({ title: "Prejemnica izbrisana, zaloge povrnjene" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  // ── Inventura create ───────────────────────────────────────────────
  const [invDialogOpen, setInvDialogOpen] = useState(false);
  const [invDatum, setInvDatum] = useState("");
  const [invOpomba, setInvOpomba] = useState("");
  const [invRows, setInvRows] = useState<InventuraRow[]>([]);
  const [invFilterNormativi, setInvFilterNormativi] = useState(true);
  const createInventura = useCreateInventura();

  const openInvDialog = () => {
    // Prisilno osveži artikle, da je vNormativih polje vedno sveže
    queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
    setInvDatum(new Date().toISOString().slice(0, 10));
    setInvOpomba("");
    setInvRows(nabavniArtikli.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      return { artikelId: a.id, steviloNajdeno: String(z?.kolicina ?? 0), cenaKos: String(z?.zadnjaCena ?? 0) };
    }));
    setInvDialogOpen(true);
  };
  const invRowsVisible = invFilterNormativi
    ? invRows.filter(r => (artikli ?? []).find(a => a.id === r.artikelId)?.vNormativih)
    : invRows;

  const handleSaveInventura = () => {
    const validRows = invRowsVisible.filter(r => r.artikelId > 0 && r.steviloNajdeno !== "");
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    createInventura.mutate({
      data: {
        datum: invDatum || undefined,
        opomba: invOpomba || undefined,
        postavke: validRows.map(r => ({ artikelId: r.artikelId, steviloNajdeno: parseDecimal(r.steviloNajdeno) || 0 })),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListInventureQueryKey() });
        setInvDialogOpen(false);
        toast({ title: "Inventura shranjena" });
      },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  const updateInvRow = (i: number, val: string) =>
    setInvRows(r => r.map((row, j) => j === i ? { ...row, steviloNajdeno: val } : row));

  const invTotals = invRowsVisible.reduce((acc, row) => {
    const art = nabavniArtikli.find(a => a.id === row.artikelId);
    const zalogaInfo = zaloge?.find(z => z.artikelId === row.artikelId);
    const cena = parseDecimal(row.cenaKos) || (zalogaInfo?.zadnjaCena ?? null);
    const knjizno = Number(zalogaInfo?.kolicina ?? 0);
    const dejansko = parseDecimal(row.steviloNajdeno) || 0;
    if (!art) return acc;
    acc.knjizna += cena != null ? knjizno * cena : 0;
    acc.dejanska += cena != null ? dejansko * cena : 0;
    const razlikaKol = dejansko - knjizno;
    const razlikaVrednost = cena != null ? razlikaKol * cena : 0;
    if (razlikaVrednost < 0) acc.negativna += razlikaVrednost;
    if (razlikaVrednost > 0) acc.pozitivna += razlikaVrednost;
    return acc;
  }, { knjizna: 0, dejanska: 0, negativna: 0, pozitivna: 0 });

  // ── Inventura edit ─────────────────────────────────────────────────
  const [editInvId, setEditInvId] = useState<number | null>(null);

  // ── Inventura delete ───────────────────────────────────────────────
  const [deleteInvId, setDeleteInvId] = useState<number | null>(null);
  const deleteInventura = useDeleteInventura();

  // ── Začetne zaloge create ──────────────────────────────────────────
  const [zzDialogOpen, setZzDialogOpen] = useState(false);
  const [zzDatum, setZzDatum] = useState("");
  const [zzOpomba, setZzOpomba] = useState("");
  const [zzLeto, setZzLeto] = useState(currentYear);
  const [zzRows, setZzRows] = useState<ZacetnaZalogaRow[]>([]);
  const createZacetnaZaloga = useCreateZacetnaZaloga();

  const openZzDialog = () => {
    setZzDatum(new Date().toISOString().slice(0, 10));
    setZzOpomba("");
    setZzLeto(currentYear);
    setZzRows(nabavniArtikli.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      return { artikelId: a.id, kolicina: String(z?.kolicina ?? 0), cenaKos: String(z?.zadnjaCena ?? 0) };
    }));
    setZzDialogOpen(true);
  };
  const handleSaveZacetnaZaloga = () => {
    const validRows = zzRows.filter(r => r.artikelId > 0);
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    createZacetnaZaloga.mutate({
      data: {
        leto: zzLeto,
        datum: zzDatum || undefined,
        opomba: zzOpomba || null,
        postavke: validRows.map(r => ({
          artikelId: r.artikelId,
          kolicina: parseDecimal(r.kolicina) || 0,
          cenaKos: parseDecimal(r.cenaKos) || 0,
        })),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListZacetneZalogeQueryKey() });
        setZzDialogOpen(false);
        toast({ title: `Začetne zaloge za leto ${zzLeto} shranjene` });
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: msg ?? "Napaka pri shranjevanju", variant: "destructive" });
      },
    });
  };
  useF2Save(handleSaveIzdajnica, izdDialogOpen && !createIzdajnica.isPending);
  useF2Save(handleSavePrejemnica, prejDialogOpen && !createPrejemnica.isPending);
  useF2Save(handleSaveInventura, invDialogOpen && !createInventura.isPending);
  useF2Save(handleSaveZacetnaZaloga, zzDialogOpen && !createZacetnaZaloga.isPending);
  const zzSkupajVrednost = zzRows.reduce((s, r) => s + (parseDecimal(r.kolicina) || 0) * (parseDecimal(r.cenaKos) || 0), 0);

  const addZzRow = () => {
    const usedIds = new Set(zzRows.map(r => r.artikelId));
    const next = nabavniArtikli.find(a => !usedIds.has(a.id));
    setZzRows(r => [...r, { artikelId: next?.id ?? nabavniArtikli[0]?.id ?? 0, kolicina: "0", cenaKos: "0" }]);
  };
  const removeZzRow = (i: number) => setZzRows(r => r.filter((_, j) => j !== i));
  const updateZzRow = <K extends keyof ZacetnaZalogaRow>(i: number, key: K, val: ZacetnaZalogaRow[K]) =>
    setZzRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));

  // ── Začetne zaloge edit ────────────────────────────────────────────
  const [editZzId, setEditZzId] = useState<number | null>(null);

  // ── Začetne zaloge delete ──────────────────────────────────────────
  const [deleteZzId, setDeleteZzId] = useState<number | null>(null);
  const deleteZacetnaZaloga = useDeleteZacetnaZaloga();
  const handleDeleteZacetnaZaloga = () => {
    if (!deleteZzId) return;
    deleteZacetnaZaloga.mutate({ id: deleteZzId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListZacetneZalogeQueryKey() });
        setDeleteZzId(null);
        toast({ title: "Začetne zaloge izbrisane, zaloge povrnjene" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  const letoZzExists = (leto: number) => (zacetneZaloge ?? []).some(z => z.leto === leto);
  const handleDeleteInventura = () => {
    if (!deleteInvId) return;
    deleteInventura.mutate({ id: deleteInvId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListInventureQueryKey() });
        setDeleteInvId(null);
        toast({ title: "Inventura izbrisana, zaloge povrnjene na prejšnje vrednosti" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  return (
    <div className="p-6 flex-1 overflow-auto space-y-4">
      <div className="flex items-center gap-3">
        <PackageOpen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Zaloge</h1>
      </div>

      <Tabs defaultValue="zaloge">
        <TabsList>
          <TabsTrigger value="zaloge">Trenutne zaloge</TabsTrigger>
          <TabsTrigger value="prejemnice">Prejemnice</TabsTrigger>
          <TabsTrigger value="izdajnice">Izdajnice</TabsTrigger>
          <TabsTrigger value="inventure">Inventure</TabsTrigger>
          <TabsTrigger value="zacetne-zaloge">Začetne zaloge</TabsTrigger>
        </TabsList>

        {/* ── Trenutne zaloge ──────────────────────────────────────── */}
        <TabsContent value="zaloge" className="space-y-4 mt-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Iskanje artiklov..." className="pl-8 pr-8" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-sm text-muted-foreground self-center flex-1">Kliknite vrstico za kartico artikla</p>
            {jeAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReconcileDialogOpen(true)}
                  disabled={reconcile.isPending}
                  title="Preračuna stanja zalog iz dnevnika gibanj"
                >
                  <Wrench className="w-4 h-4 mr-1.5" />
                  {reconcile.isPending ? "Popravljam..." : "Popravi zaloge"}
                </Button>
                <AlertDialog open={reconcileDialogOpen} onOpenChange={setReconcileDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Popravi zaloge?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Preračuna zaloge vseh artiklov iz dnevnika gibanj. Obstoječa stanja bodo nadomeščena z izračunanimi vrednostmi.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Prekliči</AlertDialogCancel>
                      <AlertDialogAction onClick={handleReconcile}>Potrdi</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
          {!loadingZ && negativneZaloge.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
              <span className="text-sm font-medium">
                {negativneZaloge.length === 1
                  ? "1 artikel ima negativno zalogo"
                  : `${negativneZaloge.length} artiklov ima negativno zalogo`}
                {" — "}
                {negativneZaloge.map(z => z.artikelIme).join(", ")}
              </span>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead>Ime za nabavo</TableHead>
                  <TableHead className="text-right">Zaloga</TableHead>
                  <TableHead>Enota</TableHead>
                  <TableHead className="text-right">Povpr. nab. cena</TableHead>
                  <TableHead className="text-right">Vrednost</TableHead>
                  <TableHead className="hidden sm:table-cell text-right text-muted-foreground text-xs">Posodobljeno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingZ ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : filteredZaloge.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Ni zadetkov</TableCell></TableRow>
                ) : filteredZaloge.map(z => (
                  <TableRow
                    key={z.artikelId}
                    className={`cursor-pointer hover:bg-muted/50 ${z.kolicina < 0 ? "bg-red-50 hover:bg-red-100" : ""}`}
                    onClick={() => setKarticeArtikelId(z.artikelId)}
                  >
                    <TableCell className="font-medium">{z.artikelIme}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{z.imeZaNabavo ?? "–"}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      <span className={`inline-flex items-center justify-end gap-1 ${z.kolicina < 0 ? "text-red-600" : z.kolicina === 0 ? "text-red-500" : z.kolicina < 5 ? "text-amber-600" : "text-green-700"}`}>
                        {z.kolicina < 0 && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {fmt(z.kolicina, 3)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{z.enotaMere ?? "–"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {(z.povprecnaCena ?? z.zadnjaCena) != null ? `${fmt((z.povprecnaCena ?? z.zadnjaCena)!, 4)} €` : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm tabular-nums">
                      {z.skupnaVrednost != null ? `${fmt(z.skupnaVrednost)} €` : z.zadnjaCena != null ? `${fmt(z.kolicina * z.zadnjaCena)} €` : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-muted-foreground text-xs">{fmtDatum(z.zadnjaPosodobitev)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!loadingZ && filteredZaloge.length > 0 && (
              <div className="border-t px-4 py-2 flex justify-end text-sm text-muted-foreground">
                Skupaj vrednost zalog:&nbsp;
                <strong className="text-foreground">
                  {fmt(filteredZaloge.reduce((s, z) => s + (z.skupnaVrednost != null ? z.skupnaVrednost : z.zadnjaCena != null ? z.kolicina * z.zadnjaCena : 0), 0))} €
                </strong>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Prejemnice ────────────────────────────────────────────── */}
        <TabsContent value="prejemnice" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openPrejDialog}>
              <Plus className="w-4 h-4 mr-2" />Nova prejemnica
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Številka</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Dobavitelj</TableHead>
                  <TableHead>Opomba</TableHead>
                  <TableHead className="text-center">Postavke</TableHead>
                  <TableHead className="text-right">Vrednost</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingP ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : (prejemnice ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Ni prejemnic</TableCell></TableRow>
                ) : (prejemnice ?? []).slice().sort((a, b) => (b.stevilka ?? "").localeCompare(a.stevilka ?? "", "sl", { numeric: true })).map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm font-medium text-primary">{p.stevilka ?? "–"}</TableCell>
                    <TableCell className="font-medium">{fmtDatum(p.datum)}</TableCell>
                    <TableCell className="text-sm">
                      {(p as any).dobaviteljNaziv
                        ? <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />{(p as any).dobaviteljNaziv}</span>
                        : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.opomba ?? "–"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline">{p.steviloPostavk ?? 0}</Badge></TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{fmt(Number(p.skupajVrednost))} €</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setEditPrejId(p.id)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeletePrejId(p.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── Izdajnice ─────────────────────────────────────────────── */}
        <TabsContent value="izdajnice" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openIzdDialog}>
              <Plus className="w-4 h-4 mr-2" />Nova izdajnica
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Številka</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Opomba</TableHead>
                  <TableHead className="text-center">Postavke</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingIzd ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : (izdajnice ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Ni izdajnic</TableCell></TableRow>
                ) : (izdajnice ?? []).map((iz: { id: number; stevilka?: string | null; datum: string; opomba?: string | null; steviloPostavk: number }) => (
                  <TableRow key={iz.id}>
                    <TableCell className="font-mono text-sm font-medium text-primary">{iz.stevilka ?? "–"}</TableCell>
                    <TableCell className="font-medium">{fmtDatumDoc(iz.datum)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{iz.opomba ?? "–"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline">{iz.steviloPostavk ?? 0}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditIzdId(iz.id)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteIzdId(iz.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── Inventure ─────────────────────────────────────────────── */}
        <TabsContent value="inventure" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openInvDialog}>
              <ClipboardList className="w-4 h-4 mr-2" />Nova inventura
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Številka</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Opomba</TableHead>
                  <TableHead className="text-center">Postavke</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingI ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : (inventure ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Ni inventur</TableCell></TableRow>
                ) : (inventure ?? []).map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm font-medium text-primary">{inv.stevilka ?? "–"}</TableCell>
                    <TableCell className="font-medium">{fmtDatumDoc(inv.datum)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{inv.opomba ?? "–"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline">{inv.steviloPostavk ?? 0}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setEditInvId(inv.id)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteInvId(inv.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── Začetne zaloge ─────────────────────────────────────────── */}
        <TabsContent value="zacetne-zaloge" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              En dokument na leto. Zahtevano pred prvim naročilom v novem letu.
            </p>
            <Button size="sm" onClick={openZzDialog} disabled={letoZzExists(currentYear)}>
              <Plus className="w-4 h-4 mr-2" />
              {letoZzExists(currentYear) ? `Leto ${currentYear} že vneseno` : `Nova začetna zaloga (${currentYear})`}
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Leto</TableHead>
                  <TableHead className="w-28">Številka</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Opomba</TableHead>
                  <TableHead className="text-center">Artiklov</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingZZ ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : (zacetneZaloge ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Ni začetnih zalog</TableCell></TableRow>
                ) : (zacetneZaloge ?? []).map(zz => (
                  <TableRow key={zz.id}>
                    <TableCell className="font-bold text-lg tabular-nums">{zz.leto}</TableCell>
                    <TableCell className="font-mono text-sm font-medium text-primary">{zz.stevilka ?? "–"}</TableCell>
                    <TableCell className="font-medium">{fmtDatum(zz.datum)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{zz.opomba ?? "–"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline">{zz.steviloPostavk ?? 0}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setEditZzId(zz.id)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteZzId(zz.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Kartica dialog ──────────────────────────────────────────── */}
      {karticeArtikelId != null && (
        <KarticaDialog artikelId={karticeArtikelId} onClose={() => setKarticeArtikelId(null)} />
      )}

      {/* ── Izdajnica create dialog ──────────────────────────────────── */}
      <Dialog open={izdDialogOpen} onOpenChange={v => { setIzdDialogOpen(v); if (!v) setIzdDropdownOpenIdx(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5" />Nova izdajnica
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Datum</Label>
                <SmartDateInput ref={izdDatumRef} value={izdDatum} onChange={setIzdDatum} defaultYear={currentYear}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); izdOpombaRef.current?.focus(); } }} />
              </div>
              <div className="space-y-1.5">
                <Label>Opomba <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
                <Input ref={izdOpombaRef} value={izdOpomba} onChange={e => setIzdOpomba(e.target.value)} placeholder="Dodatna opomba..."
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); izdArtInputRefs.current.get(0)?.focus(); } }} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="space-y-2">
                {izdRows.map((row, i) => {
                  const isOpen = izdDropdownOpenIdx === i;
                  const selectedArtikel = row.artikelId > 0 ? nabavniArtikli.find(a => a.id === row.artikelId) : null;
                  const filtered = izdDropdownFilter
                    ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(izdDropdownFilter.toLowerCase()))
                    : nabavniArtikli;
                  return (
                    <Fragment key={i}>
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <input
                          ref={el => { if (el) izdArtInputRefs.current.set(i, el); else izdArtInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? izdDropdownFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${selectedArtikel.enotaMere})` : ""}` : "")}
                          onChange={e => {
                            if (selectedArtikel) return;
                            setIzdDropdownFilter(e.target.value);
                            setIzdDropdownHighlight(0);
                            if (izdDropdownOpenIdx !== i) setIzdDropdownOpenIdx(i);
                          }}
                          readOnly={!!selectedArtikel && !isOpen}
                          onFocus={() => {
                            if (!selectedArtikel && izdDropdownOpenIdx !== i) {
                              setIzdDropdownOpenIdx(i); setIzdDropdownFilter(""); setIzdDropdownHighlight(0);
                            }
                          }}
                          onKeyDown={e => {
                            if (selectedArtikel && !isOpen) {
                              if (e.key === "Enter") { e.preventDefault(); izdKoliInputRefs.current.get(i)?.focus(); return; }
                              if (e.key === "ArrowDown") { e.preventDefault(); const el = izdKoliInputRefs.current.get(i + 1) ?? izdArtInputRefs.current.get(i + 1); el?.focus(); return; }
                              if (e.key === "ArrowUp") { e.preventDefault(); const el = izdArtInputRefs.current.get(i - 1); el?.focus(); return; }
                              if (e.key === "Backspace" || e.key === "Delete") {
                                e.preventDefault();
                                updateIzdRow(i, "artikelId", 0);
                                setIzdDropdownOpenIdx(i); setIzdDropdownFilter(""); setIzdDropdownHighlight(0);
                              }
                              return;
                            }
                            if (e.key === "Escape") { e.preventDefault(); setIzdDropdownOpenIdx(null); return; }
                            if (e.key === "ArrowDown") { e.preventDefault(); if (isOpen) setIzdDropdownHighlight(h => Math.min(h + 1, filtered.length - 1)); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); if (isOpen) setIzdDropdownHighlight(h => Math.max(h - 1, 0)); return; }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (!isOpen) { setIzdDropdownOpenIdx(i); setIzdDropdownFilter(""); setIzdDropdownHighlight(0); return; }
                              if (filtered.length === 0) { setIzdDropdownOpenIdx(null); setIzdNovArtikelRowIdx(i); return; }
                              const art = filtered[izdDropdownHighlight];
                              if (art) selectIzdArtikelInRow(i, art.id);
                            }
                          }}
                        />
                        {isOpen && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                            {filtered.length === 0
                              ? (
                                <div className="px-3 py-2 space-y-1.5">
                                  <p className="text-xs text-muted-foreground">
                                    {izdDropdownFilter ? `Ni zadetkov za „${izdDropdownFilter}"` : "Ni artiklov v šifrantu"}
                                  </p>
                                  <button
                                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                                    onMouseDown={e => { e.preventDefault(); setIzdDropdownOpenIdx(null); setIzdNovArtikelRowIdx(i); }}>
                                    <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                                  </button>
                                </div>
                              )
                              : filtered.map((a, j) => (
                                <div key={a.id}
                                  className={`px-3 py-1.5 text-sm cursor-pointer ${j === izdDropdownHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                                  onMouseDown={e => { e.preventDefault(); selectIzdArtikelInRow(i, a.id); }}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </div>
                              ))
                            }
                          </div>
                        )}
                      </div>
                      <DecimalInput
                        ref={el => { if (el) izdKoliInputRefs.current.set(i, el); else izdKoliInputRefs.current.delete(i); }}
                        placeholder="Količina"
                        value={row.kolicina}
                        onChange={e => updateIzdRow(i, "kolicina", e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") { e.preventDefault(); izdAddBtnRef.current?.focus(); }
                          else if (e.key === "ArrowUp") { e.preventDefault(); const el = izdKoliInputRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                          else if (e.key === "ArrowDown") { e.preventDefault(); const el = izdKoliInputRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                        }}
                        className="w-28"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeIzdRow(i)} disabled={izdRows.length === 1}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    {izdNovArtikelRowIdx === i && (
                      <NovArtikelKartica
                        imePredlog={izdDropdownFilter}
                        onClose={() => setIzdNovArtikelRowIdx(null)}
                        onCreated={id => {
                          void queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
                          setIzdNovArtikelRowIdx(null);
                          setTimeout(() => { selectIzdArtikelInRow(i, id); }, 150);
                        }}
                      />
                    )}
                    </Fragment>
                  );
                })}
              </div>
              <Button
                ref={izdAddBtnRef}
                variant="outline" size="sm"
                onClick={addIzdRow}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addIzdRow(); } }}>
                <Plus className="w-4 h-4 mr-1" />Dodaj postavko
              </Button>
            </div>
            {/* ── Razlika zalog ─────────────────────────────────────── */}
            {!izdDiffOpen ? (
              <Button variant="outline" size="sm" className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={openIzdDiff}>
                <Plus className="w-4 h-4 mr-1" />Vnos porabe po razliki zalog (ne-normativni artikli)
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Poraba po razliki zalog</Label>
                  <button type="button" onClick={() => setIzdDiffOpen(false)}
                    className="text-xs text-muted-foreground hover:text-foreground underline">Skrij</button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Knjižno = trenutna zaloga. Vpišite dejansko (fizično) zalogo — poraba se izračuna samodejno. Vrstice z nično porabo se preskočijo.
                </p>
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artikel</TableHead>
                        <TableHead className="text-right w-28">Knjižno</TableHead>
                        <TableHead className="text-right w-32">Dejansko</TableHead>
                        <TableHead className="text-right w-28">Poraba</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {izdDiffRows.map((row, i) => {
                        const art = nabavniArtikli.find(a => a.id === row.artikelId);
                        const dejansko = parseDecimal(row.dejansko) ?? row.knjizno;
                        const poraba = row.knjizno - dejansko;
                        return (
                          <TableRow key={row.artikelId} className={poraba > 0.0001 ? "bg-orange-50/60" : ""}>
                            <TableCell className="text-sm font-medium whitespace-nowrap py-1.5">
                              {art?.imeZaNabavo || art?.ime}
                              {art?.enotaMere && <span className="text-muted-foreground text-xs ml-1">({art.enotaMere})</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm py-1.5">{fmt(row.knjizno, 3)}</TableCell>
                            <TableCell className="text-right py-1.5">
                              <DecimalInput
                                ref={el => { if (el) izdDiffDejanRefs.current.set(i, el as any); else izdDiffDejanRefs.current.delete(i); }}
                                value={row.dejansko}
                                onChange={e => setIzdDiffRows(r => r.map((dr, j) => j === i ? { ...dr, dejansko: e.target.value } : dr))}
                                onKeyDown={e => {
                                  if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const el = izdDiffDejanRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                  else if (e.key === "ArrowUp") { e.preventDefault(); const el = izdDiffDejanRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                }}
                                className="w-24 text-right ml-auto h-8"
                              />
                            </TableCell>
                            <TableCell className={`text-right tabular-nums text-sm font-semibold py-1.5 ${poraba > 0.0001 ? "text-orange-700" : "text-muted-foreground/40"}`}>
                              {poraba > 0.0001 ? `−${fmt(poraba, 3)}` : "–"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {izdDiffRows.some(r => r.knjizno - (parseDecimal(r.dejansko) ?? r.knjizno) > 0.0001) && (
                  <p className="text-xs text-muted-foreground text-right">
                    Skupna poraba: <strong className="text-orange-700">
                      {fmt(izdDiffRows.reduce((s, r) => { const p = r.knjizno - (parseDecimal(r.dejansko) ?? r.knjizno); return s + (p > 0 ? p : 0); }, 0), 3)}
                    </strong> enot
                  </p>
                )}
              </div>
            )}

            <Button className="w-full" onClick={handleSaveIzdajnica} disabled={createIzdajnica.isPending}>
              {createIzdajnica.isPending ? "Shranjujem..." : <>Shrani izdajnico <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Prejemnica create dialog ─────────────────────────────────── */}
      <Dialog open={prejDialogOpen} onOpenChange={v => { setPrejDialogOpen(v); if (!v) setDropdownOpenIdx(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova prejemnica</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Datum + Dobavitelj */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Datum</Label>
                <SmartDateInput ref={prejDatumRef} value={prejDatum} onChange={setPrejDatum} defaultYear={currentYear}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); prejDobaviteljInputRef.current?.focus(); } }} />
              </div>
              <div className="space-y-1.5">
                <Label>Dobavitelj</Label>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <DobaviteljCombobox
                      value={prejDobaviteljId}
                      kupci={kupci ?? []}
                      onChange={(id, naziv) => { setPrejDobaviteljId(id); setPrejDobaviteljNaziv(naziv); }}
                      onEnterAfterSelect={() => prejStevilkaRef.current?.focus()}
                      onNoResults={() => { setNovDobaviteljOpen(true); setTimeout(() => prejDodajDobaviteljaRef.current?.focus(), 50); }}
                      _inputRef={prejDobaviteljInputRef}
                    />
                  </div>
                  <Button
                    ref={prejDodajDobaviteljaRef}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    title="Dodaj novega dobavitelja"
                    onClick={() => setNovDobaviteljOpen(v => !v)}
                  >
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            {/* Nov dobavitelj inline */}
            {novDobaviteljOpen && (
              <NovDobaviteljKartica
                onClose={() => setNovDobaviteljOpen(false)}
                onCreated={(id, naziv) => {
                  setPrejDobaviteljId(id);
                  setPrejDobaviteljNaziv(naziv);
                  setNovDobaviteljOpen(false);
                  queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
                }}
              />
            )}
            {/* Številka + Datum dobavnice */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Številka dobavnice</Label>
                <Input ref={prejStevilkaRef} value={prejStevilkaDobavnice} onChange={e => setPrejStevilkaDobavnice(e.target.value)} placeholder="npr. DOB-2026-001"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); prejDatumDobavniceRef.current?.focus(); } }} />
              </div>
              <div className="space-y-1.5">
                <Label>Datum dobavnice</Label>
                <SmartDateInput ref={prejDatumDobavniceRef} value={prejDatumDobavnice} onChange={setPrejDatumDobavnice} defaultYear={currentYear}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); prejOpombaRef.current?.focus(); } }} />
              </div>
            </div>
            {/* Opomba */}
            <div className="space-y-1.5">
              <Label>Opomba <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
              <Input ref={prejOpombaRef} value={prejOpomba} onChange={e => setPrejOpomba(e.target.value)} placeholder="Dodatna opomba..."
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (vrstaCen === "neto" ? prejNetoRef : prejBrutoRef).current?.focus(); } }} />
            </div>
            {/* Vrsta cen na dobavnici */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Cene na dobavnici:</span>
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button ref={prejNetoRef} type="button"
                  className={`px-3 py-1.5 transition-colors ${vrstaCen === "neto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => setVrstaCen("neto")}
                  onKeyDown={e => {
                    if (e.key === "ArrowRight") { e.preventDefault(); setVrstaCen("bruto"); prejBrutoRef.current?.focus(); }
                    if (e.key === "Enter") { e.preventDefault(); artInputRefs.current.get(0)?.focus(); }
                  }}>Neto (brez DDV)</button>
                <button ref={prejBrutoRef} type="button"
                  className={`px-3 py-1.5 border-l transition-colors ${vrstaCen === "bruto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => setVrstaCen("bruto")}
                  onKeyDown={e => {
                    if (e.key === "ArrowLeft") { e.preventDefault(); setVrstaCen("neto"); prejNetoRef.current?.focus(); }
                    if (e.key === "Enter") { e.preventDefault(); artInputRefs.current.get(0)?.focus(); }
                  }}>Bruto (maloprodajne)</button>
              </div>
            </div>
            {/* Postavke */}
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="space-y-2">
                {prejRows.map((row, i) => {
                  const isOpen = dropdownOpenIdx === i;
                  const selectedArtikel = row.artikelId > 0 ? nabavniArtikli.find(a => a.id === row.artikelId) : null;
                  const filtered = dropdownFilter
                    ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(dropdownFilter.toLowerCase()))
                    : nabavniArtikli;
                  return (
                    <Fragment key={i}>
                    <div className="flex gap-2 items-center">
                      {/* Artikel combobox */}
                      <div className="relative flex-1">
                        <input
                          ref={el => { if (el) artInputRefs.current.set(i, el); else artInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? dropdownFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${selectedArtikel.enotaMere})` : ""}` : "")}
                          onChange={e => {
                            if (selectedArtikel) return;
                            setDropdownFilter(e.target.value);
                            setDropdownHighlight(0);
                            if (dropdownOpenIdx !== i) setDropdownOpenIdx(i);
                          }}
                          readOnly={!!selectedArtikel && !isOpen}
                          onFocus={() => {
                            if (!selectedArtikel && dropdownOpenIdx !== i) {
                              setDropdownOpenIdx(i); setDropdownFilter(""); setDropdownHighlight(0);
                            }
                          }}
                          onKeyDown={e => {
                            if (selectedArtikel && !isOpen) {
                              if (e.key === "Enter") { e.preventDefault(); pakBtnRefs.current.get(i)?.focus(); }
                              if (e.key === "ArrowUp") { e.preventDefault(); navPrej(i, "art", "up"); return; }
                              if (e.key === "ArrowDown") { e.preventDefault(); navPrej(i, "art", "down"); return; }
                              if (e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "art", "right"); return; }
                              if (e.key === "Backspace" || e.key === "Delete") {
                                e.preventDefault();
                                updatePrejRow(i, "artikelId", 0); updatePrejRow(i, "cenaKos", "");
                                setDropdownOpenIdx(i); setDropdownFilter(""); setDropdownHighlight(0);
                              }
                              return;
                            }
                            if (e.key === "Escape") { e.preventDefault(); setDropdownOpenIdx(null); return; }
                            if (e.key === "ArrowDown") {
                              if (isOpen) { e.preventDefault(); setDropdownHighlight(h => Math.min(h + 1, filtered.length - 1)); }
                              else { e.preventDefault(); navPrej(i, "art", "down"); }
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              if (isOpen) { e.preventDefault(); setDropdownHighlight(h => Math.max(h - 1, 0)); }
                              else { e.preventDefault(); navPrej(i, "art", "up"); }
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (!isOpen) { setDropdownOpenIdx(i); setDropdownFilter(""); setDropdownHighlight(0); return; }
                              if (filtered.length === 0) { setDropdownOpenIdx(null); setNovArtikelRowIdx(i); return; }
                              const art = filtered[dropdownHighlight];
                              if (art) selectArtikelInRow(i, art.id);
                            }
                          }}
                        />
                        {isOpen && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                            {filtered.length === 0
                              ? (
                                <div className="px-3 py-2 space-y-1.5">
                                  <p className="text-xs text-muted-foreground">
                                    {dropdownFilter ? `Ni zadetkov za „${dropdownFilter}"` : "Ni artiklov v šifrantu"}
                                  </p>
                                  <button
                                    ref={el => { if (el) novArtBtnRefs.current.set(i, el); else novArtBtnRefs.current.delete(i); }}
                                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        setDropdownOpenIdx(null);
                                        setNovArtikelRowIdx(i);
                                      }
                                    }}
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      setDropdownOpenIdx(null);
                                      setNovArtikelRowIdx(i);
                                    }}
                                  >
                                    <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                                  </button>
                                </div>
                              )
                              : filtered.map((a, j) => (
                                <div key={a.id}
                                  className={`px-3 py-1.5 text-sm cursor-pointer ${j === dropdownHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                                  onMouseDown={e => { e.preventDefault(); selectArtikelInRow(i, a.id); }}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </div>
                              ))
                            }
                          </div>
                        )}
                      </div>
                      {/* Pakiranje gumb + enot-v-paketu polje */}
                      <div className="flex flex-col items-center gap-0.5">
                        <Button ref={el => { if (el) pakBtnRefs.current.set(i, el); else pakBtnRefs.current.delete(i); }}
                          variant="ghost" size="icon" className={`h-8 w-8 ${row.enotVPaketu ? "text-primary" : "text-muted-foreground"}`}
                          title="Pakiranje (vez, karton, …)"
                          onClick={() => {
                            if (row.enotVPaketu) {
                              updatePrejRow(i, "enotVPaketu", "");
                            } else {
                              updatePrejRow(i, "enotVPaketu", "");
                              setTimeout(() => enotInputRefs.current.get(i)?.focus(), 30);
                            }
                          }}>
                          <Package className="w-3.5 h-3.5" />
                        </Button>
                        {(row.enotVPaketu !== undefined) && (
                          <DecimalInput
                            ref={el => { if (el) enotInputRefs.current.set(i, el); else enotInputRefs.current.delete(i); }}
                            value={row.enotVPaketu}
                            placeholder="enot/pak"
                            onChange={e => updatePrejRow(i, "enotVPaketu", e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "enot", "right"); }
                              else if (e.key === "ArrowLeft") { e.preventDefault(); navPrej(i, "enot", "left"); }
                              else if (e.key === "ArrowUp") { e.preventDefault(); navPrej(i, "enot", "up"); }
                              else if (e.key === "ArrowDown") { e.preventDefault(); navPrej(i, "enot", "down"); }
                            }}
                            className="w-16 text-xs h-7 text-center"
                          />
                        )}
                      </div>
                      {/* Količina / Paketov */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput
                          ref={el => { if (el) koliInputRefs.current.set(i, el); else koliInputRefs.current.delete(i); }}
                          placeholder={row.enotVPaketu ? "Paketov" : "Količina"} value={row.kolicina}
                          onChange={e => updatePrejRow(i, "kolicina", e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "koli", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navPrej(i, "koli", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navPrej(i, "koli", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navPrej(i, "koli", "down"); }
                          }}
                          className="w-24" />
                        {row.enotVPaketu && parseDecimal(row.enotVPaketu) > 1 && parseDecimal(row.kolicina) > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            = {fmt(parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1))} {nabavniArtikli.find(a => a.id === row.artikelId)?.enotaMere ?? "enot"}
                          </span>
                        )}
                      </div>
                      {/* Nabavna cena / Cena na paket */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput
                          ref={el => { if (el) cenaInputRefs.current.set(i, el); else cenaInputRefs.current.delete(i); }}
                          placeholder={row.enotVPaketu ? "Cena/paket" : (vrstaCen === "neto" ? "Cena brez DDV" : "Maloprodajna cena")} value={row.cenaKos}
                          onChange={e => updatePrejRow(i, "cenaKos", e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); addBtnRef.current?.focus(); }
                            else if (e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "cena", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navPrej(i, "cena", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navPrej(i, "cena", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navPrej(i, "cena", "down"); }
                          }}
                          className="w-28" />
                        {row.enotVPaketu && parseDecimal(row.enotVPaketu) > 1 && parseDecimal(row.cenaKos) > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            = {fmt(parseDecimal(row.cenaKos) / (parseDecimal(row.enotVPaketu) || 1))} €/enoto
                          </span>
                        )}
                      </div>
                      {/* Preračunana cena (readonly) */}
                      {(() => {
                        const enot = parseDecimal(row.enotVPaketu) || 1;
                        const vnos = parseDecimal(row.cenaKos) || 0;
                        const cenaNaEnoto = enot > 1 ? vnos / enot : vnos;
                        const davek = nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0;
                        const shranjeno = konvertirajCeno(cenaNaEnoto, davek, vrstaCen, jeDdvZavezanec);
                        return (
                          <input
                            readOnly
                            tabIndex={-1}
                            value={vnos ? fmt(shranjeno) : ""}
                            placeholder={jeDdvZavezanec ? "Neto" : "Bruto"}
                            title={jeDdvZavezanec ? "Cena/enoto, ki se shrani (brez DDV)" : "Cena/enoto, ki se shrani (z DDV)"}
                            className="w-24 border rounded-md px-2 py-2 text-sm bg-muted text-muted-foreground text-right cursor-default select-none"
                          />
                        );
                      })()}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePrejRow(i)} disabled={prejRows.length === 1}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    {novArtikelRowIdx === i && (
                      <NovArtikelKartica
                        imePredlog={dropdownFilter}
                        onClose={() => setNovArtikelRowIdx(null)}
                        onCreated={id => {
                          void queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
                          setNovArtikelRowIdx(null);
                          setTimeout(() => { selectArtikelInRow(i, id, true); pakBtnRefs.current.get(i)?.focus(); }, 150);
                        }}
                      />
                    )}
                    </Fragment>
                  );
                })}
              </div>
              <Button
                ref={addBtnRef}
                variant="outline" size="sm"
                onClick={addPrejRow}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPrejRow(); } }}>
                <Plus className="w-4 h-4 mr-1" />Dodaj postavko
              </Button>
              {prejRows.some(r => r.kolicina && r.cenaKos) && (() => {
                const totals = prejRows.reduce((acc, r) => {
                  const enot = parseDecimal(r.enotVPaketu) || 1;
                  const kol = (parseDecimal(r.kolicina) || 0) * enot;
                  const vnos = parseDecimal(r.cenaKos) || 0;
                  const cenaNaEnoto = enot > 1 ? vnos / enot : vnos;
                  const davek = nabavniArtikli.find(a => a.id === r.artikelId)?.davek ?? 0;
                  const shranjeno = konvertirajCeno(cenaNaEnoto, davek, vrstaCen, jeDdvZavezanec);
                  const neto = jeDdvZavezanec ? shranjeno : (davek ? shranjeno / (1 + davek / 100) : shranjeno);
                  const bruto = jeDdvZavezanec ? (davek ? shranjeno * (1 + davek / 100) : shranjeno) : shranjeno;
                  return { neto: acc.neto + kol * neto, bruto: acc.bruto + kol * bruto };
                }, { neto: 0, bruto: 0 });
                return (
                  <div className="text-sm text-muted-foreground text-right space-y-0.5">
                    <div>Skupaj brez DDV: <strong className="text-foreground">{fmt(totals.neto)} €</strong></div>
                    <div>Skupaj z DDV: <strong className="text-foreground">{fmt(totals.bruto)} €</strong></div>
                  </div>
                );
              })()}
            </div>
            <Button className="w-full" onClick={handleSavePrejemnica} disabled={createPrejemnica.isPending}>
              {createPrejemnica.isPending ? "Shranjujem..." : <>Shrani prejemnico <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Izdajnica edit dialog ─────────────────────────────────────── */}
      {editIzdId != null && (
        <EditIzdajnicaDialog
          id={editIzdId}
          nabavniArtikli={nabavniArtikli}
          onClose={() => setEditIzdId(null)}
          onSaved={() => {
            const savedId = editIzdId;
            setEditIzdId(null);
            queryClient.resetQueries({ queryKey: getGetIzdajnicaQueryKey(savedId) });
            queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListIzdajniceQueryKey() });
          }}
        />
      )}

      {/* ── Izdajnica delete confirm ───────────────────────────────────── */}
      <AlertDialog open={!!deleteIzdId} onOpenChange={v => !v && setDeleteIzdId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši izdajnico?</AlertDialogTitle>
            <AlertDialogDescription>
              Izdajnica bo izbrisana in <strong>zaloge bodo povrnjene</strong> za količino iz te izdajnice. Tega dejanja ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteIzdajnica} disabled={deleteIzdajnica.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteIzdajnica.isPending ? "Brišem..." : "Potrdi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Prejemnica edit dialog ────────────────────────────────────── */}
      {editPrejId != null && (
        <EditPrejemnicaDialog
          id={editPrejId}
          nabavniArtikli={nabavniArtikli}
          zaloge={zaloge}
          jeDdvZavezanec={jeDdvZavezanec}
          onClose={() => setEditPrejId(null)}
          onSaved={() => {
            const savedId = editPrejId;
            setEditPrejId(null);
            queryClient.resetQueries({ queryKey: getGetPrejemnicaQueryKey(savedId) });
            queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListPrejemniceQueryKey() });
          }}
        />
      )}

      {/* ── Prejemnica delete confirm ──────────────────────────────────── */}
      <AlertDialog open={!!deletePrejId} onOpenChange={v => !v && setDeletePrejId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši prejemnico?</AlertDialogTitle>
            <AlertDialogDescription>
              Prejemnica bo izbrisana in <strong>zaloge bodo zmanjšane</strong> za količino iz te prejemnice. Tega dejanja ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePrejemnica} disabled={deletePrejemnica.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletePrejemnica.isPending ? "Brišem..." : "Potrdi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Inventura create dialog ───────────────────────────────────── */}
      <Dialog open={invDialogOpen} onOpenChange={setInvDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5" />Nova inventura
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={invDatum} onChange={setInvDatum} defaultYear={currentYear} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} />
              </div>
              <div className="space-y-2">
                <Label>Opomba</Label>
                <Input value={invOpomba} onChange={e => setInvOpomba(e.target.value)} placeholder="Opomba k inventuri..." onKeyDown={handleEnterAsTab} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Dejanske zaloge</Label>
                <div className="flex items-center rounded-md border overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setInvFilterNormativi(true)}
                    className={`px-3 py-1.5 transition-colors ${invFilterNormativi ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >
                    Samo normativni
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvFilterNormativi(false)}
                    className={`px-3 py-1.5 transition-colors ${!invFilterNormativi ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >
                    Vsi artikli
                  </button>
                </div>
              </div>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Cena</TableHead>
                      <TableHead className="text-right">Knjižno</TableHead>
                      <TableHead className="text-right">Dejansko</TableHead>
                      <TableHead className="text-right text-red-700">Razl. kol. (−)</TableHead>
                      <TableHead className="text-right text-green-700">Razl. kol. (+)</TableHead>
                      <TableHead className="text-right">Knj. vrednost</TableHead>
                      <TableHead className="text-right">Dej. vrednost</TableHead>
                      <TableHead className="text-right text-red-700">Razl. vredn. (−)</TableHead>
                      <TableHead className="text-right text-green-700">Razl. vredn. (+)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invRowsVisible.map((row, i) => {
                      const art = nabavniArtikli.find(a => a.id === row.artikelId);
                      const zalogaInfo = zaloge?.find(z => z.artikelId === row.artikelId);
                      const cena = zalogaInfo?.zadnjaCena ?? null;
                      const knjizno = Number(zalogaInfo?.kolicina ?? 0);
                      const dejansko = parseDecimal(row.steviloNajdeno) || 0;
                      const razlikaKol = dejansko - knjizno;
                      const knj = cena != null ? knjizno * cena : null;
                      const dej = cena != null ? dejansko * cena : null;
                      const razlikaVrednost = cena != null ? razlikaKol * cena : null;
                      return (
                        <TableRow key={row.artikelId}>
                          <TableCell className="font-medium text-sm whitespace-nowrap">
                            {art?.imeZaNabavo || art?.ime} <span className="text-muted-foreground">({art?.enotaMere ?? "–"})</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {cena != null ? `${fmt(cena)} €` : <span className="text-muted-foreground">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(knjizno, 3)}</TableCell>
                          <TableCell className="text-right">
                            <DecimalInput value={row.steviloNajdeno}
                              ref={el => { if (el) invNajdenoRefs.current.set(i, el as any); else invNajdenoRefs.current.delete(i); }}
                              onChange={e => updateInvRow(i, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const el = invNajdenoRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = invNajdenoRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="w-24 text-right ml-auto h-8" />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-red-600">
                            {razlikaKol < 0 ? fmt(razlikaKol, 3) : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-green-600">
                            {razlikaKol > 0 ? `+${fmt(razlikaKol, 3)}` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{knj != null ? `${fmt(knj)} €` : "–"}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{dej != null ? `${fmt(dej)} €` : "–"}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-red-600">
                            {razlikaVrednost != null && razlikaVrednost < 0 ? `${fmt(razlikaVrednost)} €` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-green-600">
                            {razlikaVrednost != null && razlikaVrednost > 0 ? `+${fmt(razlikaVrednost)} €` : <span className="text-muted-foreground/40">–</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm px-1 pt-1">
                <span className="text-muted-foreground">Knjižna vrednost: <strong className="text-foreground">{fmt(invTotals.knjizna)} €</strong></span>
                <span className="text-muted-foreground">Dejanska vrednost: <strong className="text-foreground">{fmt(invTotals.dejanska)} €</strong></span>
                <span className="text-muted-foreground">Manko (−): <strong className="text-red-600">{fmt(invTotals.negativna)} €</strong></span>
                <span className="text-muted-foreground">Višek (+): <strong className="text-green-600">+{fmt(invTotals.pozitivna)} €</strong></span>
                <span className="text-muted-foreground">Neto razlika: <strong className={invTotals.negativna + invTotals.pozitivna < 0 ? "text-red-600" : invTotals.negativna + invTotals.pozitivna > 0 ? "text-green-600" : "text-foreground"}>
                  {invTotals.negativna + invTotals.pozitivna > 0 ? "+" : ""}{fmt(invTotals.negativna + invTotals.pozitivna)} €
                </strong></span>
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveInventura} disabled={createInventura.isPending}>
              {createInventura.isPending ? "Shranjujem..." : <>Potrdi inventuro <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Inventura edit dialog ──────────────────────────────────────── */}
      {editInvId != null && (
        <EditInventuraDialog
          id={editInvId}
          nabavniArtikli={nabavniArtikli}
          zaloge={zaloge?.map(z => ({ artikelId: z.artikelId, kolicina: z.kolicina, zadnjaCena: z.zadnjaCena ?? null }))}
          onClose={() => setEditInvId(null)}
          onSaved={() => {
            setEditInvId(null);
            queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListInventureQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetInventuraQueryKey(editInvId) });
          }}
        />
      )}

      {/* ── Inventura delete confirm ───────────────────────────────────── */}
      <AlertDialog open={!!deleteInvId} onOpenChange={v => !v && setDeleteInvId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši inventuro?</AlertDialogTitle>
            <AlertDialogDescription>
              Inventura bo izbrisana in <strong>zaloge bodo povrnjene na vrednosti pred inventuro</strong>. Tega dejanja ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteInventura} disabled={deleteInventura.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteInventura.isPending ? "Brišem..." : "Potrdi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Začetne zaloge create dialog ──────────────────────────────── */}
      <Dialog open={zzDialogOpen} onOpenChange={setZzDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="w-5 h-5" />Začetne zaloge
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Leto</Label>
                <Input type="number" value={zzLeto} onChange={e => setZzLeto(parseInt(e.target.value) || currentYear)}
                  min={2000} max={2100} onKeyDown={handleEnterAsTab} />
              </div>
              <div className="space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={zzDatum} onChange={setZzDatum} defaultYear={currentYear} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} />
              </div>
              <div className="space-y-2">
                <Label>Opomba</Label>
                <Input value={zzOpomba} onChange={e => setZzOpomba(e.target.value)} placeholder="Opomba..." onKeyDown={handleEnterAsTab} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Artikli</Label>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right w-32">Količina</TableHead>
                      <TableHead className="text-right w-32">Cena/enoto (€)</TableHead>
                      <TableHead className="text-right w-28">Vrednost (€)</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zzRows.map((row, i) => {
                      const vrednost = (parseDecimal(row.kolicina) || 0) * (parseDecimal(row.cenaKos) || 0);
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <select className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                              value={row.artikelId}
                              onChange={e => updateZzRow(i, "artikelId", parseInt(e.target.value))}>
                              {nabavniArtikli.map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ""}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell>
                            <DecimalInput value={row.kolicina}
                              ref={el => { if (el) zzKoliRefs.current.set(i, el as any); else zzKoliRefs.current.delete(i); }}
                              onChange={e => updateZzRow(i, "kolicina", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzCenaRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzKoliRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="text-right h-8" />
                          </TableCell>
                          <TableCell>
                            <DecimalInput value={row.cenaKos}
                              ref={el => { if (el) zzCenaRefs.current.set(i, el as any); else zzCenaRefs.current.delete(i); }}
                              onChange={e => updateZzRow(i, "cenaKos", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowLeft") { e.preventDefault(); const el = zzKoliRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzCenaRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzCenaRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="text-right h-8" />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            {vrednost > 0 ? `${fmt(vrednost)} €` : <span className="text-muted-foreground">–</span>}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => removeZzRow(i)} disabled={zzRows.length === 1}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addZzRow}>
                  <Plus className="w-4 h-4 mr-1" />Dodaj artikel
                </Button>
                <p className="text-sm text-muted-foreground">
                  Skupna vrednost: <strong className="text-foreground">{fmt(zzSkupajVrednost)} €</strong>
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveZacetnaZaloga} disabled={createZacetnaZaloga.isPending}>
              {createZacetnaZaloga.isPending ? "Shranjujem..." : <>Shrani začetne zaloge ({zzLeto}) <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Začetne zaloge edit dialog ────────────────────────────────── */}
      {editZzId != null && (
        <EditZacetnaZalogaDialog
          id={editZzId}
          nabavniArtikli={nabavniArtikli}
          onClose={() => setEditZzId(null)}
          onSaved={() => {
            setEditZzId(null);
            queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListZacetneZalogeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetZacetnaZalogaQueryKey(editZzId) });
          }}
        />
      )}

      {/* ── Začetne zaloge delete confirm ─────────────────────────────── */}
      <AlertDialog open={!!deleteZzId} onOpenChange={v => !v && setDeleteZzId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši začetne zaloge?</AlertDialogTitle>
            <AlertDialogDescription>
              Začetne zaloge bodo izbrisane in <strong>zaloge artiklov bodo povrnjene na vrednosti pred vnosom</strong>. Tega dejanja ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteZacetnaZaloga} disabled={deleteZacetnaZaloga.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteZacetnaZaloga.isPending ? "Brišem..." : "Izbriši"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
