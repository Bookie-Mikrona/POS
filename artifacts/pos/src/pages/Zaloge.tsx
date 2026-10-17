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
  useListPartnerji,
  useCreatePartner,
  useOsveziPartnerja,
  useUpdatePartner,
  getListPartnerjiQueryKey,
  useCreateArtikel,
  getListArtikliQueryKey,
  getEnotaId,
  type Partner,
  type AlergenKoda,
  type AlergenStatus,
  type AlergenVir,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
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
  Building2, UserPlus, Loader2, CheckCircle2, Search as SearchIcon, ChevronDown, ChevronRight,
  FileUp,
  Download,
} from "lucide-react";
import { UvozPrejemniceDialog } from "./uvoz/UvozPrejemniceDialog";
import { EmbalazaTab } from "./zaloge/EmbalazaTab";
import { PreparedStockTab } from "./zaloge/PreparedStockTab";
import { DEFAULT_NEW_PURCHASE_ARTICLE_TYPE } from "@/lib/article-type-defaults";
import { primerjajSlovensko } from "@/lib/slovensko-razvrscanje";
import { AlergenEditor, AlergeniBadge, type AlergenSnapshot } from "@/components/AlergenEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShieldAlert } from "lucide-react";
import {
  MassYieldFields,
  isPieceUnit,
  netMassPerUnitG,
  normalizeMassYield,
} from "@/components/MassYieldFields";
import {
  buildReceiptPricePayload,
  originalPriceIsUnchanged,
  restoreImportedPrice,
  sourceDiscountFactor,
  type OriginalReceiptPriceSnapshot,
  type PriceBasis,
} from "@/lib/prejemnica-pricing";
import { BookingPreviewDialog } from "./uvoz/BookingPreviewDialog";
import {
  areEslogUnitsCompatible,
  canonicalEslogUnit,
  validateGroupSourceLine,
} from "@/lib/skupinski-nabavni-artikel";
import { posFetch } from "@/lib/pos-auth-headers";
import { ESLOG_UNITS, displayEslogUnit } from "@/components/EslogUnitPicker";
import { downloadArtikelKatalogPdf, type ArtikelKatalogScope } from "@/lib/artikel-katalog-pdf";

function AlergeniRowPopover({
  row,
  onUpdate,
  companyId,
  open,
  onOpenChange,
}: {
  row: PrejemnicaRow;
  onUpdate: (snapshot: AlergenSnapshot) => void;
  companyId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const snapshot: AlergenSnapshot = {
    alergeni: row.alergeni ?? [],
    alergeniSledi: row.alergeniSledi ?? [],
    alergeniStatus: row.alergeniStatus ?? "nepreverjeno",
    alergeniVir: row.alergeniVir ?? null,
    alergeniOpombaVira: row.alergeniOpombaVira ?? null,
    alergeniDocumentId: row.alergeniDocumentId ?? null,
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 px-2 relative" title="Alergeni in deklaracija">
          <ShieldAlert className={`w-4 h-4 ${snapshot.alergeniStatus === 'nepreverjeno' ? 'text-orange-500' : 'text-green-600'}`} />
          {(snapshot.alergeni.length > 0 || snapshot.alergeniSledi.length > 0) && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[450px] p-4" align="end" side="left">
        <h4 className="font-medium text-sm mb-4 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Alergeni in deklaracija
        </h4>
        <AlergenEditor value={snapshot} onChange={onUpdate} companyId={companyId} />
      </PopoverContent>
    </Popover>
  );
}

const DDV_OPCIJE = [
  { label: "22 % (splošna)", value: 22 },
  { label: "9,5 % (znižana)", value: 9.5 },
  { label: "5 % (znižana)", value: 5 },
  { label: "0 % (oproščeno)", value: 0 },
];
const ENOTE_MERE: string[] = ESLOG_UNITS.map(unit => unit.code);

function massYieldZaPrejemnico(
  row: PrejemnicaRow,
  article?: { brutoTezaG?: number | null; netoTezaG?: number | null; netoDelezOdst?: number | null } | null,
) {
  return {
    brutoTezaG: row.brutoTezaGTouched ? row.brutoTezaG ?? "" : row.brutoTezaG || (article?.brutoTezaG == null ? "" : String(article.brutoTezaG)),
    netoTezaG: row.netoTezaGTouched ? row.netoTezaG ?? "" : row.netoTezaG || (article?.netoTezaG == null ? "" : String(article.netoTezaG)),
    netoDelezOdst: row.netoDelezOdstTouched ? row.netoDelezOdst ?? "" : row.netoDelezOdst || (article?.netoDelezOdst == null ? "" : String(article.netoDelezOdst)),
  };
}

function payloadIzplenPrejemnice(row: PrejemnicaRow) {
  const values = normalizeMassYield({
    brutoTezaG: row.brutoTezaG ?? "",
    netoTezaG: row.netoTezaG ?? "",
    netoDelezOdst: row.netoDelezOdst ?? "",
  });
  const result: Partial<ReturnType<typeof normalizeMassYield>> = {};
  if (row.brutoTezaG?.trim() || row.brutoTezaGTouched) result.brutoTezaG = values.brutoTezaG;
  if (row.netoTezaG?.trim() || row.netoTezaGTouched) result.netoTezaG = values.netoTezaG;
  if (row.netoDelezOdst?.trim() || row.netoDelezOdstTouched) result.netoDelezOdst = values.netoDelezOdst;
  if (row.brutoTezaG?.trim() && row.netoTezaG?.trim()) result.netoDelezOdst = values.netoDelezOdst;
  return result;
}

function izracunajIzvornoKolicinoZaloge(
  row: PrejemnicaRow,
  enotaMere?: string | null,
  article?: { brutoTezaG?: number | null; netoTezaG?: number | null; netoDelezOdst?: number | null } | null,
): number | null {
  const izvornaKolicina = parseDecimal(row.izvKolicina);
  const netoGrami = netMassPerUnitG(massYieldZaPrejemnico(row, article));
  const enota = enotaMere?.trim().toLowerCase();
  if (!Number.isFinite(izvornaKolicina) || izvornaKolicina <= 0
    || !isPieceUnit(row.izvEnota) || netoGrami == null || !Number.isFinite(netoGrami)) return null;
  if (enota === "kg" || enota === "kgm") return izvornaKolicina * netoGrami / 1000;
  if (enota === "g" || enota === "grm") return izvornaKolicina * netoGrami;
  return null;
}

function izracunajVrednostPostavke(row: PrejemnicaRow): number {
  const izvornaKolicina = row.izvKolicina?.trim() ? parseDecimal(row.izvKolicina) : null;
  const kolicina = izvornaKolicina != null && Number.isFinite(izvornaKolicina)
    ? izvornaKolicina
    : parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1);
  return kolicina * parseDecimal(row.cenaKos) * faktorPopusta(row.popust, row.rabatVkljucenVCeni === true);
}

function razcleniPopust(value: string): [number, number] {
  const parts = value.split("+").map(part => parseDecimal(part.trim())).filter(Number.isFinite);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

function faktorPopusta(value: string, popustJeVkljucenVCeni = false): number {
  const [rabat1, rabat2] = razcleniPopust(value);
  return sourceDiscountFactor(rabat1, rabat2, popustJeVkljucenVCeni);
}

type PrejemnicaRow = {
  id?: number;
  artikelId: number;
  kolicina: string;
  cenaKos: string;
  enotVPaketu: string;
  popust: string;
  ddvStopnja: string;
  izvNaziv?: string | null;
  izvEnota?: string | null;
  izvKolicina?: string;
  izvCena?: number | string | null;
  izvCenaVrsta?: PriceBasis | null;
  rabatVkljucenVCeni?: boolean | null;
  sourcePriceEditable?: boolean;
  originalPriceSnapshot?: OriginalReceiptPriceSnapshot;
  brutoTezaG?: string;
  netoTezaG?: string;
  netoDelezOdst?: string;
  brutoTezaGTouched?: boolean;
  netoTezaGTouched?: boolean;
  netoDelezOdstTouched?: boolean;

  alergeni?: AlergenKoda[];
  alergeniSledi?: AlergenKoda[];
  alergeniStatus?: AlergenStatus;
  alergeniVir?: AlergenVir | null;
  alergeniOpombaVira?: string | null;
  alergeniDocumentId?: string | null;
};

const ESLOG_ENOTE_SKUPINSKIH_ARTIKLOV = [
  "H87", "KGM", "GRM", "LTR", "MLT", "MTR", "MTK", "MTQ", "CT", "BX",
  "KOM", "KOS", "PCE", "EA", "KG", "G", "L", "ML", "M", "M2", "M3", "KAR", "SKA",
];

type PrejemnicaArtikel = {
  ime: string;
  imeZaNabavo?: string | null;
  enotaMere?: string | null;
  jeSkupinskiNabavniArtikel?: boolean;
  brutoTezaG?: number | null;
  netoTezaG?: number | null;
  netoDelezOdst?: number | null;
};

function IzvornaPostavkaPolja({
  row,
  target,
  error,
  id,
  onChange,
}: {
  row: PrejemnicaRow;
  target: PrejemnicaArtikel | null | undefined;
  error?: string;
  id: string;
  onChange: (field: "izvNaziv" | "izvEnota", value: string) => void;
}) {
  if (!target) return null;
  const isGroupTarget = Boolean(target.jeSkupinskiNabavniArtikel);
  const sourceUnitUnsupported = Boolean(row.izvEnota?.trim() && !canonicalEslogUnit(row.izvEnota));
  const sourceMismatch = Boolean(
    row.izvEnota?.trim()
    && canonicalEslogUnit(row.izvEnota)
    && !areEslogUnitsCompatible(row.izvEnota, target.enotaMere),
  );
  const inlineError = error ?? (
    sourceUnitUnsupported
      ? `Enota dobavitelja »${row.izvEnota}« ni podprta e-SLOG enota.`
      : sourceMismatch
        ? `Enota dobavitelja (${row.izvEnota}) ne ustreza enoti skupinskega artikla (${displayEslogUnit(target.enotaMere) || "ni navedena"}).`
        : undefined
  );
  if (!isGroupTarget && !row.izvNaziv && !row.izvEnota) return null;
  const targetName = target.imeZaNabavo || target.ime;

  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/60 p-2">
      {isGroupTarget && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`source-name-${id}`} className="text-xs">Dobaviteljev naziv postavke</Label>
              <Input
                id={`source-name-${id}`}
                data-testid={`input-source-line-name-${id}`}
                value={row.izvNaziv ?? ""}
                onChange={e => onChange("izvNaziv", e.target.value)}
                placeholder="Naziv na dobavnici"
                aria-invalid={Boolean(error && !row.izvNaziv?.trim())}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`source-unit-${id}`} className="text-xs">Dobaviteljeva e-SLOG enota</Label>
              <Input
                id={`source-unit-${id}`}
                data-testid={`input-source-line-unit-${id}`}
                list={`source-unit-options-${id}`}
                value={row.izvEnota ?? ""}
                onChange={e => onChange("izvEnota", e.target.value)}
                placeholder="npr. KGM"
                aria-invalid={Boolean(inlineError)}
              />
              <datalist id={`source-unit-options-${id}`}>
                {ESLOG_ENOTE_SKUPINSKIH_ARTIKLOV.map(unit => <option key={unit} value={unit} />)}
              </datalist>
            </div>
          </div>
          {inlineError && (
            <p className="mt-1 text-xs text-destructive" role="alert" data-testid={`text-source-line-error-${id}`}>
              {inlineError}
            </p>
          )}
        </>
      )}
      {(row.izvNaziv || row.izvEnota || isGroupTarget) && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-receipt-line-mapping-${id}`}>
          Dobavitelj: <span className="font-medium text-foreground">{row.izvNaziv || "naziv ni vnesen"}</span>
          {row.izvEnota && <> ({row.izvEnota})</>}
          {" → zaloga: "}
          <span className="font-semibold text-foreground">{targetName}</span>
          {target.enotaMere && <> ({displayEslogUnit(target.enotaMere)})</>}
        </p>
      )}
    </div>
  );
}

export type OdvisniStrosekRow = {
  naziv: string;
  znesek: string;
  ddvStopnja: string;
  obravnava: "zaloga" | "strosek";
};
type InventuraRow = { artikelId: number; steviloNajdeno: string; cenaKos: string };
type InventuraOcrResult = {
  rows: { artikelId: number; steviloNajdeno: number | null; cenaKos: number | null }[];
  unmatched: string[];
  datum: string | null;
  documentPath: string;
};

function primerjajInventurneArtikle(
  a: { davek?: number | string | null; ime: string; imeZaNabavo?: string | null },
  b: { davek?: number | string | null; ime: string; imeZaNabavo?: string | null },
): number {
  const rank = (value: number) => value === 5 ? 0 : value === 9.5 ? 1 : value === 22 ? 2 : value === 0 ? 3 : 4;
  const aRate = Number(a.davek);
  const bRate = Number(b.davek);
  return rank(aRate) - rank(bRate)
    || (rank(aRate) === 4 ? aRate - bRate : 0)
    || primerjajSlovensko(a.imeZaNabavo || a.ime, b.imeZaNabavo || b.ime);
}
type ZacetnaZalogaRow = { artikelId: number; kolicina: string; cenaKos: string };
type IzdajnicaRow = { artikelId: number; kolicina: string };
type IzdDiffRow = { artikelId: number; knjizno: number; dejansko: string };
type QuantityOnlyArticle = { id: number; drobniInventar?: boolean };
const jeDrobniInventar = (artikel: QuantityOnlyArticle | null | undefined) => artikel?.drobniInventar === true;

export function OdvisniStroskiEditor({
  value,
  onChange,
}: {
  value: OdvisniStrosekRow[];
  onChange: (next: OdvisniStrosekRow[]) => void;
}) {
  const add = () => onChange([
    ...value,
    { naziv: "", znesek: "", ddvStopnja: "", obravnava: "zaloga" },
  ]);
  const update = <K extends keyof OdvisniStrosekRow>(
    index: number,
    key: K,
    nextValue: OdvisniStrosekRow[K],
  ) => onChange(value.map((row, rowIndex) => (
    rowIndex === index ? { ...row, [key]: nextValue } : row
  )));

  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>Odvisni/ostali stroški</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Prevoz, zavarovanje in podobno. Označite, ali strošek poveča vrednost zaloge.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Dodaj strošek
        </Button>
      </div>
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_8rem_2rem] sm:items-center">
              <Input
                aria-label={`Naziv stroška ${index + 1}`}
                value={row.naziv}
                onChange={(event) => update(index, "naziv", event.target.value)}
                placeholder="npr. Prevoz"
              />
              <DecimalInput
                aria-label={`Znesek stroška ${index + 1}`}
                value={row.znesek}
                onChange={(event) => update(index, "znesek", event.target.value)}
                placeholder="Znesek"
              />
              <DecimalInput
                aria-label={`DDV stopnja stroška ${index + 1}`}
                value={row.ddvStopnja}
                onChange={(event) => update(index, "ddvStopnja", event.target.value)}
                placeholder="DDV %"
              />
              <select
                aria-label={`Obravnava stroška ${index + 1}`}
                value={row.obravnava}
                onChange={(event) => update(index, "obravnava", event.target.value === "strosek" ? "strosek" : "zaloga")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="zaloga">Vrednost zaloge</option>
                <option value="strosek">Ločen strošek</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label={`Odstrani strošek ${index + 1}`}
                onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
  value, kupci, onChange, onEnterAfterSelect, onNoResults, onDropdownOpenChange, _inputRef,
}: {
  value: string | null;
  kupci: Partner[];
  onChange: (id: string | null, naziv: string) => void;
  onEnterAfterSelect?: () => void;
  onNoResults?: () => void;
  onDropdownOpenChange?: (open: boolean) => void;
  _inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Shrani vrednost pred odprtjem dropdowna (za Escape / klik zunaj)
  const prevRef = useRef<{ id: string | null; naziv: string } | null>(null);
  const inputRef = (_inputRef ?? ownInputRef) as React.RefObject<HTMLInputElement>;
  const selected = value != null ? kupci.find(k => k.id === value) ?? null : null;
  const filtered = filter
    ? kupci.filter(k =>
        k.naziv.toLowerCase().includes(filter.toLowerCase()) ||
        (k.kratkiNaziv ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (k.davcnaStevilka ?? "").includes(filter)
      )
    : kupci;

  // Obvesti starša o stanju dropdowna (za onEscapeKeyDown na DialogContent)
  useEffect(() => { onDropdownOpenChange?.(open); }, [open]);

  // Ko se highlight premakne, zagotovimo, da je izbrani element viden v dropdownu
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const cancelAndRestore = () => {
    if (prevRef.current !== null) {
      onChange(prevRef.current.id, prevRef.current.naziv);
      prevRef.current = null;
    }
    setOpen(false);
    setFilter("");
  };

  const selectItem = (k: Partner) => {
    prevRef.current = null;
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
          data-pos-keyboard-readonly-trigger
          placeholder="Išči dobavitelja..."
          value={open ? filter : (selected?.naziv ?? "")}
          onChange={e => { if (open) { setFilter(e.target.value); setHighlight(0); } }}
          readOnly={!!selected && !open}
          onFocus={() => {
            if (selected && !open) {
              prevRef.current = { id: value, naziv: selected.naziv };
              const idx = kupci.findIndex(k => k.id === value);
              setHighlight(idx >= 0 ? idx : 0);
            }
            setOpen(true);
            setFilter("");
          }}
          onClick={() => {
            if (selected) {
              // Shrani staro vrednost za morebitno obnovitev z Escape
              prevRef.current = { id: value, naziv: selected.naziv };
              // Odpri dropdown in skočim na trenutno izbranega
              const idx = kupci.findIndex(k => k.id === value);
              setOpen(true);
              setFilter("");
              setHighlight(idx >= 0 ? idx : 0);
            }
          }}
          onKeyDown={e => {
            if (selected && !open) {
              if (e.key === "Enter") { e.preventDefault(); onEnterAfterSelect?.(); return; }
              if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onChange(null, ""); }
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation(); // prepreči, da Radix Dialog zapre formo
              cancelAndRestore();
              // fokus ostane na polju
              setTimeout(() => inputRef.current?.focus(), 0);
              return;
            }
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return; }
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length === 0) { onNoResults?.(); return; }
              const k = filtered[highlight] ?? filtered[0];
              if (k) selectItem(k);
            }
          }}
          onBlur={() => setTimeout(() => { cancelAndRestore(); }, 150)}
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
        <div ref={listRef} className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
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
  id?: string | null;
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
  | { tip: "obstaja"; partner: Partner }          // bil v šifrantu pred iskanjem
  | { tip: "shranjen"; id: string; data: InetisRezultat } // /poisci ga je ravno shranil
  | { tip: "najden_nov"; data: InetisRezultat }          // DB-save spodletel, ročno ustvarjanje
  | { tip: "ni_najden" }
  | { tip: "napaka" };

function NovDobaviteljKartica({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, naziv: string) => void;
}) {
  const [naziv, setNaziv] = useState("");
  const [davcna, setDavcna] = useState("");
  const [stanje, setStanje] = useState<DobaviteljLookupStanje>({ tip: "idle" });
  const { data: kupci } = useListPartnerji();
  const createMutation = useCreatePartner();
  const updateMutation = useUpdatePartner();
  const osveziMutation = useOsveziPartnerja();
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

  function jeVeljavenVatVnos(v: string) {
    return /^\d{8}$/.test(v) || /^[A-Z]{2}\S{2,}$/.test(v);
  }

  async function poisciPoReg(vatInput: string) {
    const jeSi = /^\d{8}$/.test(vatInput);
    const enotaId = getEnotaId();

    // 1. Preveri lokalni šifrant (po davcnaStevilka ali idZaDdv)
    const obstojecKupec = (kupci ?? []).find(k =>
      jeSi
        ? (k.davcnaStevilka ?? "").trim() === vatInput
        : (k.idZaDdv ?? "").trim().toUpperCase().replace(/\s/g, "") === vatInput.toUpperCase()
    );
    if (obstojecKupec) {
      setStanje({ tip: "obstaja", partner: obstojecKupec });
      setNaziv(obstojecKupec.naziv ?? "");
      return;
    }

    // 2. Iskanje v registru
    setStanje({ tip: "loading" });
    try {
      const url = jeSi
        ? `${base}/api/kupec/poisci?davcna=${vatInput}`
        : `${base}/api/kupec/poisci-vies?vatId=${encodeURIComponent(vatInput.toUpperCase())}`;
      const r = await fetch(url, {
        credentials: "include",
        headers: enotaId ? { "X-Enota-Id": enotaId } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as InetisRezultat;

      if (data.id) {
        void queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
        setStanje({ tip: "shranjen", id: data.id, data });
        setNaziv(data.naziv ?? "");
        return;
      }
      setStanje({ tip: "najden_nov", data });
      setNaziv(data.naziv ?? "");
    } catch (err: unknown) {
      const status = (err as { message?: string })?.message ?? "";
      if (status.includes("404")) setStanje({ tip: "ni_najden" });
      else setStanje({ tip: "napaka" });
    }
  }

  // Samodejno iskanje ko je vnos veljaven (8 cifer SI ali EU VAT)
  useEffect(() => {
    const trimmed = davcna.trim().toUpperCase();
    if (!jeVeljavenVatVnos(trimmed)) {
      setStanje({ tip: "idle" });
      setNaziv("");
      return;
    }
    const t = setTimeout(() => { void poisciPoReg(trimmed); }, 700);
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
          void queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
          onCreated(d.id, d.naziv);
          onClose();
        },
        onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
      });
    } else {
      // Brez registrskih podatkov — minimalen vnos
      const vatTrimmed = davcna.trim().toUpperCase();
      const jeTuji = /^[A-Z]{2}/.test(vatTrimmed) && !/^\d{8}$/.test(vatTrimmed);
      createMutation.mutate({
        data: {
          naziv: naziv.trim(),
          davcnaStevilka: jeTuji ? null : (vatTrimmed || null),
          idZaDdv: jeTuji ? vatTrimmed : null,
          kodaDrzave: jeTuji ? vatTrimmed.slice(0, 2) : "SI",
          drzava: jeTuji ? null : "Slovenija",
          zavezanecDdv: jeTuji ? true : null,
        } as any,
      }, {
        onSuccess: d => {
          void queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
          onCreated(d.id, d.naziv);
          onClose();
        },
        onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
      });
    }
  }
  useF2Save(handleShrani, !createMutation.isPending && !!naziv.trim());

  // Posodobi obstoječega in ga izberi
  async function handleObstajaPosodobi(partner: Partner) {
    try {
      // Osvezi iz registra (pridobi sveže podatke iz AJPES/INETIS)
      const updated = await osveziMutation.mutateAsync({ id: partner.id });
      void queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
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

      {/* ── Davčna / VAT ID ── */}
      <div className="space-y-1">
        <Label className="text-xs">Davčna / VAT ID</Label>
        <div className="flex gap-1.5">
          <Input
            value={davcna}
            onChange={e => setDavcna(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))}
            placeholder="SI12345678 ali DE195033395"
            className="h-8 text-sm font-mono"
            autoFocus
          />
          <Button
            variant="outline" size="sm" className="h-8 px-2 shrink-0"
            disabled={!jeVeljavenVatVnos(davcna.trim()) || stanje.tip === "loading"}
            onClick={() => void poisciPoReg(davcna.trim().toUpperCase())}
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
export function konvertirajCeno(
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

export function efektivnaDdvStopnja(vnos: string, privzetaStopnja: number): number {
  return vnos === "" ? privzetaStopnja : parseDecimal(vnos);
}

function preračunajPrejemnico(
  row: PrejemnicaRow,
  artikel: {
    enotaMere?: string | null;
    davek?: number;
    brutoTezaG?: number | null;
    netoTezaG?: number | null;
    netoDelezOdst?: number | null;
  } | undefined,
  vrstaCen: "neto" | "bruto",
  jeDdvZavezanec: boolean,
) {
  const enot = parseDecimal(row.enotVPaketu) || 1;
  const izvornaKolicina = row.izvKolicina?.trim() ? parseDecimal(row.izvKolicina) : null;
  const imaIzvornoEnoto = Boolean(row.izvEnota?.trim());
  const imaIzvorniNakup = izvornaKolicina != null && Number.isFinite(izvornaKolicina)
    && izvornaKolicina > 0 && imaIzvornoEnoto;
  const izracunanaKolicina = izracunajIzvornoKolicinoZaloge(row, artikel?.enotaMere, artikel);
  const vnesenaKolicina = parseDecimal(row.kolicina);
  const kolicina = izracunanaKolicina ?? (Number.isFinite(vnesenaKolicina) ? vnesenaKolicina : 0) * enot;
  const popustF = faktorPopusta(row.popust, row.rabatVkljucenVCeni === true);
  const vnos = parseDecimal(row.cenaKos) || 0;
  const cenaNaNakupnoEnoto = imaIzvorniNakup ? vnos : (enot > 1 ? vnos / enot : vnos);
  const ddvStopnja = efektivnaDdvStopnja(row.ddvStopnja, artikel?.davek ?? 0);
  const shranjenaCenaNakupneEnote = konvertirajCeno(
    cenaNaNakupnoEnoto * popustF,
    ddvStopnja,
    vrstaCen,
    jeDdvZavezanec,
  );
  const shranjenaCena = imaIzvorniNakup && kolicina > 0
    ? shranjenaCenaNakupneEnote * izvornaKolicina! / kolicina
    : shranjenaCenaNakupneEnote;
  const netoCena = jeDdvZavezanec
    ? shranjenaCena
    : (ddvStopnja ? shranjenaCena / (1 + ddvStopnja / 100) : shranjenaCena);
  return {
    enot,
    kolicina,
    ddvStopnja,
    shranjenaCena,
    ddvOsnova: netoCena * kolicina,
    izvornaKolicina: imaIzvorniNakup ? izvornaKolicina : null,
  };
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
        <span>{displayEslogUnit(value) || "— izberite —"}</span>
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
            >{ESLOG_UNITS[j]?.label}</div>
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
        vrstaArtikla: DEFAULT_NEW_PURCHASE_ARTICLE_TYPE,
        cena: 0,
        aktiven: true,
        ...(import.meta.env.DEV ? {
          alergeni: [],
          alergeniSledi: [],
          alergeniStatus: "potrjeno_brez",
          alergeniVir: "rocno",
          alergeniOpombaVira: "Testno delovanje",
        } : {}),
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
          <p className="text-xs text-muted-foreground">Naziv artikla bo enak: „{imeZaNabavo.trim()}"</p>
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
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const toggleDay = (id: number) => setExpandedDays(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { gibiPrikaz, dnevniDetail } = useMemo(() => {
    const gibi = data?.gibi ?? [];
    if (!zbirPorabe) return { gibiPrikaz: gibi as GibVrstica[], dnevniDetail: new Map<number, GibVrstica[]>() };
    const result: GibVrstica[] = [];
    const detail = new Map<number, GibVrstica[]>();
    const dnevnaMap = new Map<string, { sumKol: number; sumVred: number; zadnji: GibVrstica; stevilo: number; gibi: GibVrstica[] }>();
    for (const g of gibi) {
      if (g.tip !== "poraba") { result.push(g); continue; }
      const dayKey = (g.datumDokumenta ?? g.ustvarjeno).slice(0, 10);
      const obs = dnevnaMap.get(dayKey);
      if (obs) {
        obs.sumKol += g.kolicina;
        obs.sumVred += (g.vrednost ?? 0);
        obs.zadnji = g;
        obs.stevilo += 1;
        obs.gibi.push(g);
      } else {
        dnevnaMap.set(dayKey, { sumKol: g.kolicina, sumVred: g.vrednost ?? 0, zadnji: g, stevilo: 1, gibi: [g] });
      }
    }
    const vstavljena = new Set<string>();
    for (const g of gibi) {
      if (g.tip !== "poraba") continue;
      const dayKey = (g.datumDokumenta ?? g.ustvarjeno).slice(0, 10);
      const agg = dnevnaMap.get(dayKey);
      if (!agg || vstavljena.has(dayKey)) continue;
      if (g === agg.zadnji) {
        const synId = -(new Date(dayKey).getTime());
        const avgCena = agg.sumKol !== 0 ? agg.sumVred / agg.sumKol : null;
        result.push({ ...agg.zadnji, id: synId, kolicina: agg.sumKol, vrednost: agg.sumVred, cenaKos: avgCena, zbranoStevilo: agg.stevilo });
        detail.set(synId, agg.gibi);
        vstavljena.add(dayKey);
      }
    }
    result.sort((a, b) => {
      const da = a.datumDokumenta ?? a.ustvarjeno;
      const db2 = b.datumDokumenta ?? b.ustvarjeno;
      return da < db2 ? -1 : da > db2 ? 1 : 0;
    });
    return { gibiPrikaz: result, dnevniDetail: detail };
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
                <p className="text-xs text-muted-foreground mt-1">{displayEslogUnit(data.enotaMere) || "–"}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Povpr. nab. cena (WAC)</p>
                <p className="text-2xl font-bold tabular-nums">
                  {(data.povprecnaCena ?? data.zadnjaCena) != null ? `${fmt(data.povprecnaCena ?? data.zadnjaCena!, 6)} €` : "–"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">/ {displayEslogUnit(data.enotaMere) || "enoto"}</p>
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
                      {gibiPrikaz.flatMap(g => {
                        const isZbir = g.tip === "poraba" && (g as GibVrstica).zbranoStevilo != null;
                        const isExpanded = isZbir && expandedDays.has(g.id);
                        const subGibi = isZbir ? (dnevniDetail.get(g.id) ?? []) : [];

                        const mainRow = (
                          <TableRow
                            key={g.id}
                            className={isZbir ? "cursor-pointer hover:bg-muted/60 select-none" : undefined}
                            onClick={isZbir ? () => toggleDay(g.id) : undefined}
                          >
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {isZbir && (
                                  isExpanded
                                    ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                    : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                )}
                                <TipBadge tip={g.tip} />
                              </div>
                            </TableCell>
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
                                  {g.prejStevilka && <div className="font-mono text-xs font-medium text-primary">{g.prejStevilka}</div>}
                                  {g.dobaviteljNaziv && <div className="truncate text-xs font-medium">{g.dobaviteljNaziv}</div>}
                                  {g.opomba && <div className="truncate text-muted-foreground text-xs">{g.opomba}</div>}
                                  {!g.prejStevilka && !g.dobaviteljNaziv && !g.opomba && <span className="text-muted-foreground">–</span>}
                                </div>
                              ) : isZbir ? (
                                <span className="text-xs text-muted-foreground">{(g as GibVrstica).zbranoStevilo} računov</span>
                              ) : g.tip === "izdajnica" || g.tip === "poraba" ? (
                                <div className="space-y-0.5">
                                  {g.izdStevilka && <div className="font-mono text-xs font-medium text-primary">{g.izdStevilka}</div>}
                                  {g.opomba && <div className="truncate text-muted-foreground text-xs">{g.opomba}</div>}
                                  {!g.izdStevilka && !g.opomba && <span className="text-muted-foreground">–</span>}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">{g.opomba ?? "–"}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                              {isZbir
                                ? (g.datumDokumenta ?? g.ustvarjeno).slice(0, 10)
                                : fmtCas(g.datumDokumenta ?? g.ustvarjeno)}
                            </TableCell>
                          </TableRow>
                        );

                        const subRows = isExpanded ? subGibi.map(sg => (
                          <TableRow key={sg.id} className="bg-muted/30 text-xs">
                            <TableCell className="pl-8"><TipBadge tip={sg.tip} /></TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className="text-red-600">{fmt(sg.kolicina, 3)}</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {sg.cenaKos != null ? `${fmt(sg.cenaKos, 4)} €` : "–"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {sg.vrednost != null ? `${fmt(Math.abs(sg.vrednost))} €` : "–"}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                            <TableCell className="max-w-[220px]">
                              {sg.izdStevilka && <div className="font-mono text-xs font-medium text-primary">{sg.izdStevilka}</div>}
                              {sg.opomba && <div className="truncate text-muted-foreground">{sg.opomba}</div>}
                              {!sg.izdStevilka && !sg.opomba && <span className="text-muted-foreground">–</span>}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {fmtCas(sg.datumDokumenta ?? sg.ustvarjeno)}
                            </TableCell>
                          </TableRow>
                        )) : [];

                        return [mainRow, ...subRows];
                      })}
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
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null; drobniInventar?: boolean }[];
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
  const [scope, setScope] = useState<"material" | "drobni">("material");
  const scopeArtikli = nabavniArtikli.filter(a => jeDrobniInventar(a) === (scope === "drobni"));
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
    const prvi = data.postavke[0] as { artikelId: number } | undefined;
    setScope(jeDrobniInventar(nabavniArtikli.find(a => a.id === prvi?.artikelId)) ? "drobni" : "material");
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
    if (validRows.some(r => !scopeArtikli.some(a => a.id === r.artikelId))) {
      toast({ title: "Izdaja materiala in drobnega inventarja mora biti ločena", description: "Odstranite artikle iz druge skupine ali jih vnesite na ločeni izdajnici.", variant: "destructive" });
      return;
    }
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
      onError: (error) => {
        const data = error instanceof ApiError
          ? error.data as { error?: string } | null
          : null;
        toast({
          title: "Napaka pri shranjevanju",
          description: data?.error ?? (error instanceof Error ? error.message : undefined),
          variant: "destructive",
        });
      },
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
            <p className="text-sm font-medium text-muted-foreground">
              {scope === "drobni" ? "Izdaja drobnega inventarja" : "Izdaja materiala"}
            </p>
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
                    ? scopeArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(izdEditDdFilter.toLowerCase()))
                    : scopeArtikli;
                  return (
                    <div key={i} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <input
                          ref={el => { if (el) izdEditArtInputRefs.current.set(i, el); else izdEditArtInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? izdEditDdFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${displayEslogUnit(selectedArtikel.enotaMere)})` : ""}` : "")}
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
                                    {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}{jeDrobniInventar(a) ? " · Drobni inventar" : ""}
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
  id, nabavniArtikli, zaloge, jeDdvZavezanec, companyId, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: {
    id: number;
    ime: string;
    imeZaNabavo?: string | null;
    enotaMere?: string | null;
    jeSkupinskiNabavniArtikel?: boolean;
    brutoTezaG?: number | null;
    netoTezaG?: number | null;
    netoDelezOdst?: number | null;
    davek: number;
    alergeni?: AlergenKoda[];
    alergeniSledi?: AlergenKoda[];
    alergeniStatus?: AlergenStatus;
    alergeniVir?: AlergenVir | null;
    alergeniOpombaVira?: string | null;
    alergeniDocumentId?: string | null;
  }[];
  zaloge: { artikelId: number; zadnjaCena?: number | null }[] | undefined;
  jeDdvZavezanec: boolean;
  companyId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading, isError } = useGetPrejemnica(id);
  const updatePrejemnica = useUpdatePrejemnica();
  const { data: kupci } = useListPartnerji();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bookingPreviewId, setBookingPreviewId] = useState<number | null>(null);
  const status = (data as any)?.status as "draft" | "confirmed" | undefined;
  const isConfirmed = status === "confirmed";
  const confirmPrejemnica = async () => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const enotaId = localStorage.getItem("pos_enota_id") || localStorage.getItem("enotaId");
      const response = await fetch(`${base}/api/prejemnice/${id}/confirm`, {
        method: "POST", credentials: "include",
        headers: enotaId ? { "X-Enota-Id": enotaId } : {},
      });
      if (!response.ok) throw new Error("Potrditev prejemnice ni uspela.");
      toast({ title: "Prejemnica potrjena", description: "Promet zaloge in embalaže je bil ustvarjen." });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: getGetPrejemnicaQueryKey(id) }),
        queryClient.refetchQueries({ queryKey: getListPrejemniceQueryKey() }),
        queryClient.refetchQueries({ queryKey: getListZalogeQueryKey() }),
      ]);
      await queryClient.invalidateQueries({ predicate: q => q.queryKey.some(k => String(k).toLowerCase().includes("embal")) });
      setConfirmOpen(false);
      setBookingPreviewId(id);
    } catch (error) {
      toast({ title: "Potrditev ni uspela", description: (error as Error).message, variant: "destructive" });
    }
  };

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  const [stDokumenta, setStDokumenta] = useState("");
  const [datumDokumenta, setDatumDokumenta] = useState("");
  const [valuta, setValuta] = useState("EUR");
  const [datumZapadlosti, setDatumZapadlosti] = useState("");
  const [placanoZGotovino, setPlacanoZGotovino] = useState(false);
  const [odvisniStroski, setOdvisniStroski] = useState<OdvisniStrosekRow[]>([]);
  const [dobaviteljId, setDobaviteljId] = useState<string | null>(null);
  const [rows, setRows] = useState<PrejemnicaRow[]>([]);
  const [sourceLineErrors, setSourceLineErrors] = useState<Record<number, string>>({});
  const [novDobaviteljOpen, setNovDobaviteljOpen] = useState(false);
  const [dobDropdownOpen, setDobDropdownOpen] = useState(false);
  const initializedId = useRef<number | null>(null);
  const initializedVrstaCen = useRef<string | null>(null);
  const editArtInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editKoliInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editCenaInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editEnotInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editPopustInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const editNovArtBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const editPakBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const editDodajRef = useRef<HTMLButtonElement>(null);
  const editDatumRef = useRef<HTMLInputElement>(null);
  const editDobavInputRef = useRef<HTMLInputElement>(null);
  const editStevilkaRef = useRef<HTMLInputElement>(null);
  const editDatumDobavniceRef = useRef<HTMLInputElement>(null);
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

  const navEdit = (rowIdx: number, col: "art" | "enot" | "koli" | "cena" | "popust", dir: "left" | "right" | "up" | "down") => {
    const cols = ["art", "enot", "koli", "cena", "popust"] as const;
    const refs: Record<string, React.MutableRefObject<Map<number, HTMLInputElement>>> = {
      art: editArtInputRefs, enot: editEnotInputRefs, koli: editKoliInputRefs, cena: editCenaInputRefs, popust: editPopustInputRefs,
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
  const ddDialogRef = useRef<HTMLDivElement>(null);
  const [ddOpenIdx, setDdOpenIdx] = useState<number | null>(null);
  const [alergeniOpenIdx, setAlergeniOpenIdx] = useState<number | null>(null);
  const [ddFilter, setDdFilter] = useState("");
  const [ddHighlight, setDdHighlight] = useState(0);
  const [ddPos, setDdPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (ddOpenIdx === null) { setDdPos(null); return; }
    const inputEl = editArtInputRefs.current.get(ddOpenIdx);
    const dialogEl = ddDialogRef.current;
    if (!inputEl || !dialogEl) { setDdPos(null); return; }
    const ir = inputEl.getBoundingClientRect();
    const dr = dialogEl.getBoundingClientRect();
    setDdPos({ top: ir.bottom - dr.top + 4, left: ir.left - dr.left });
  }, [ddOpenIdx]);
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
      setStDokumenta((data as any).stDokumenta ?? "");
      setDatumDokumenta(
        (data as any).datumDokumenta
          ? new Date((data as any).datumDokumenta).toISOString().slice(0, 10)
          : ""
      );
      setValuta((data as any).valuta ?? "EUR");
      setDatumZapadlosti((data as any).datumZapadlosti ?? "");
      setPlacanoZGotovino(Boolean((data as any).placanoZGotovino));
      setOdvisniStroski(((data as any).odvisniStroski ?? []).map((s: any) => ({
        naziv: s.naziv ?? "",
        znesek: s.znesek != null ? String(s.znesek) : "",
        ddvStopnja: s.ddvStopnja != null ? String(s.ddvStopnja) : "",
        obravnava: s.obravnava === "strosek" ? "strosek" : "zaloga",
      })));
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

      // Uvozna izvirna (katalog) cena in popust — dva e-SLOG primera:
      //
      // BT-136 (InvoiceLine/AllowanceCharge, rabatVkljucenVCeni=false):
      //   izv_cena = bruto cena → razlikuje se od cena_kos; popust izračunamo iz razlike.
      //
      // BT-147 (Price/AllowanceCharge, rabatVkljucenVCeni=true):
      //   izv_cena = neto cena (že vgrajen rabat) → enaka cena_kos; popust je shranjen v
      //   rabat_1_odst. Bruto rekonstruiramo: bruto = neto / ((1−r1/100)×(1−r2/100)).
      const izvCena: number | null = (p as any).izvCena ?? null;
      const izvKolicina: number | null = (p as any).izvKolicina ?? null;
      const izvCenaVrsta: PriceBasis | null = (p as any).izvCenaVrsta ?? null;
      const rabatVkljucenVCeni: boolean | null = (p as any).rabatVkljucenVCeni ?? null;
      const rabat1Odst: number = Number((p as any).rabat1Odst ?? 0);
      const rabat2Odst: number = Number((p as any).rabat2Odst ?? 0);
      const cenaNetoNaPaket = cenaNetoEnoto * enot; // neto cena na paket
      let prikazCena: number;
      let prikazPopust: string;
      let sourcePriceEditable = true;

      if (izvCena != null && izvCenaVrsta != null) {
        const restored = restoreImportedPrice({
          sourcePrice: izvCena,
          sourcePriceBasis: izvCenaVrsta,
          receiptPriceBasis: vrstaCenLoaded,
          discountIncluded: rabatVkljucenVCeni,
          discount1: rabat1Odst,
          discount2: rabat2Odst,
          taxRate: (p as any).ddvStopnja ?? davek,
        });
        prikazCena = Number(restored.price);
        prikazPopust = restored.discount;
        sourcePriceEditable = restored.editable;
      } else if (izvKolicina != null && izvCena != null) {
        // Legacy source semantics are unknown: retain a readable snapshot but
        // don't let a user resave it as though its VAT/discount basis were known.
        prikazCena = izvCena;
        prikazPopust = rabat2Odst > 0 ? `${rabat1Odst}+${rabat2Odst}` : rabat1Odst > 0 ? String(rabat1Odst) : "";
        sourcePriceEditable = false;
      } else if (izvCena != null && izvCena > 0 && Math.abs(izvCena - cenaNetoNaPaket) > 0.0001) {
        // BT-136: izv_cena je bruto — prikaži izvirno ceno, popust iz razlike cen
        const izvCenaPrikaz = vrstaCenLoaded === "bruto" && davek
          ? Math.round(izvCena * (1 + davek / 100) * 10000) / 10000
          : izvCena;
        const popustEfekt = Math.round((1 - cenaNetoNaPaket / izvCena) * 10000) / 100; // 2 dec.
        prikazCena = izvCenaPrikaz;
        prikazPopust = popustEfekt > 0 ? String(popustEfekt) : "";
      } else if (rabat1Odst > 0) {
        // BT-147: izv_cena je neto (= cenaNetoNaPaket) — rekonstruiraj bruto iz shranjenega rabata
        // bruto = neto / ((1 − r1/100) × (1 − r2/100))   [verižni rabati]
        const faktor = (1 - rabat1Odst / 100) * (rabat2Odst > 0 ? (1 - rabat2Odst / 100) : 1);
        if (faktor > 0.0001) { // varnostni check za 100%-popust ali deljenje z 0
          const brutoPaket = Math.round(cenaNetoNaPaket / faktor * 10000) / 10000;
          prikazCena = vrstaCenLoaded === "bruto" && davek
            ? Math.round(brutoPaket * (1 + davek / 100) * 10000) / 10000
            : brutoPaket;
          prikazPopust = rabat2Odst > 0 ? `${rabat1Odst}+${rabat2Odst}` : String(rabat1Odst);
        } else {
          // Popust ~100 % — fallback: prikaži neto brez popusta
          prikazCena = jeVPaketih ? Math.round(prikazCenaEnoto * enot * 10000) / 10000 : prikazCenaEnoto;
          prikazPopust = "";
        }
      } else {
        // Ni popusta in ni razlike — prikaži neto ceno
        prikazCena = jeVPaketih ? Math.round(prikazCenaEnoto * enot * 10000) / 10000 : prikazCenaEnoto;
        prikazPopust = "";
      }

      const displayPrice = String(prikazCena);
      const displayDiscount = prikazPopust;
      const originalPriceSnapshot: OriginalReceiptPriceSnapshot = {
        artikelId: p.artikelId,
        price: displayPrice,
        discount: displayDiscount,
        quantity: String(prikazKolicina),
        packageCount: jeVPaketih ? String(enot) : "",
        sourceQuantity: izvKolicina == null ? "" : String(izvKolicina),
        taxRate: (p as any).ddvStopnja == null ? String(davek) : String((p as any).ddvStopnja),
        receiptPriceBasis: vrstaCenLoaded,
        sourcePrice: izvCena,
        sourcePriceBasis: izvCenaVrsta,
        discountIncluded: rabatVkljucenVCeni,
        discount1: rabat1Odst,
        discount2: rabat2Odst,
        netAmount: (p as any).ddvOsnova ?? (p as any).netoZnesek ?? null,
        vatAmount: (p as any).ddvZnesek ?? null,
        stockAmount: (p as any).skupaj ?? null,
        stockQuantity: p.kolicina,
        stockUnitPrice: p.cenaKos,
        sourceUnit: (p as any).izvEnota ?? (p as any).enotaMereEslog ?? null,
        brutoTezaG: (p as any).brutoTezaG == null ? "" : String((p as any).brutoTezaG),
        netoTezaG: (p as any).netoTezaG == null ? "" : String((p as any).netoTezaG),
        netoDelezOdst: (p as any).netoDelezOdst == null ? "" : String((p as any).netoDelezOdst),
      };

      return {
        id: p.id,
        artikelId: p.artikelId,
        kolicina: String(prikazKolicina),
        cenaKos: displayPrice,
        enotVPaketu: jeVPaketih ? String(enot) : "",
        popust: displayDiscount,
        ddvStopnja: (p as any).ddvStopnja != null ? String((p as any).ddvStopnja) : String(davek),
        alergeni: (p as any).alergeni ?? [],
        alergeniSledi: (p as any).alergeniSledi ?? [],
        alergeniStatus: (p as any).alergeniStatus ?? "nepreverjeno",
        alergeniVir: (p as any).alergeniVir ?? null,
        alergeniOpombaVira: (p as any).alergeniOpombaVira ?? null,
        alergeniDocumentId: (p as any).alergeniDocumentId ?? null,
        izvNaziv: (p as any).izvNaziv ?? null,
        izvEnota: (p as any).izvEnota ?? (p as any).enotaMereEslog ?? null,
        izvKolicina: (p as any).izvKolicina == null ? "" : String((p as any).izvKolicina),
        izvCena,
        izvCenaVrsta,
        rabatVkljucenVCeni,
        sourcePriceEditable,
        originalPriceSnapshot,
        brutoTezaG: (p as any).brutoTezaG == null ? "" : String((p as any).brutoTezaG),
        netoTezaG: (p as any).netoTezaG == null ? "" : String((p as any).netoTezaG),
        netoDelezOdst: (p as any).netoDelezOdst == null ? "" : String((p as any).netoDelezOdst),
      };
    }));
  }, [data, nabavniArtikli]);

  const addRow = () => {
    const newIdx = rows.length;
    setRows(r => [...r, { artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "", popust: "", ddvStopnja: "" }]);
    setTimeout(() => editArtInputRefs.current.get(newIdx)?.focus(), 30);
  };
  const selectArtikelInEditRow = (rowIdx: number, artikelId: number, skipFocus = false) => {
    setSourceLineErrors(current => {
      const next = { ...current };
      delete next[rowIdx];
      return next;
    });
    const nabavnaEntry = zadnjeNabavneEditRef.current.get(artikelId);
    const artikel = nabavniArtikli.find(a => a.id === artikelId);
    const davek = artikel?.davek ?? 0;
    const zadnjaCenaNeto = nabavnaEntry
      ? resolveNetoNabavnaCena(nabavnaEntry.zadnjaNabavnaCena, nabavnaEntry.zadnjaVrstaCen, davek)
      : null;
    const prikazCena = zadnjaCenaNeto != null
      ? (editVrstaCen === "bruto" && davek
          ? Math.round(zadnjaCenaNeto * (1 + davek / 100) * 10000) / 10000
          : zadnjaCenaNeto)
      : null;
    const potrjenProfil = artikel?.alergeniStatus && artikel.alergeniStatus !== "nepreverjeno";
    setRows(r => r.map((row, j) => j === rowIdx
      ? {
          ...row,
          artikelId,
          cenaKos: prikazCena != null ? String(prikazCena) : row.cenaKos,
          alergeni: import.meta.env.DEV ? [] : (artikel?.alergeni ?? []),
          alergeniSledi: import.meta.env.DEV ? [] : (artikel?.alergeniSledi ?? []),
          alergeniStatus: import.meta.env.DEV
            ? "potrjeno_brez"
            : (potrjenProfil ? artikel!.alergeniStatus : "nepreverjeno"),
          alergeniVir: import.meta.env.DEV ? "rocno" : (artikel?.alergeniVir ?? null),
          alergeniOpombaVira: import.meta.env.DEV ? "Testno delovanje" : (artikel?.alergeniOpombaVira ?? null),
          alergeniDocumentId: import.meta.env.DEV ? null : (artikel?.alergeniDocumentId ?? null),
        }
      : row));
    setDdOpenIdx(null);
    setDdFilter("");
    if (!import.meta.env.DEV && !potrjenProfil) {
      setTimeout(() => setAlergeniOpenIdx(rowIdx), 0);
    }
    if (!skipFocus) setTimeout(() => editPakBtnRefs.current.get(rowIdx)?.focus(), 30);
  };
  const removeRow = (i: number) => {
    setRows(r => {
      const next = r.filter((_, j) => j !== i);
      return next.length > 0 ? next : [{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "", popust: "", ddvStopnja: "" }];
    });
    setSourceLineErrors({});
  };
  const updateRow = <K extends keyof PrejemnicaRow>(i: number, key: K, val: PrejemnicaRow[K]) => {
    setRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));
    if (key === "izvNaziv" || key === "izvEnota" || key === "artikelId") {
      setSourceLineErrors(current => {
        const next = { ...current };
        delete next[i];
        return next;
      });
    }
  };

  const changeEditPriceBasis = (next: "neto" | "bruto") => {
    if (next === editVrstaCen) return;
    if (rows.some(row => row.sourcePriceEditable === false)) {
      toast({
        title: "Ni mogoče spremeniti vrste cen",
        description: "Vsaj ena uvožena postavka nima znane osnove izvorne cene/popusta.",
        variant: "destructive",
      });
      return;
    }
    const direction = next === "bruto" ? 1 : -1;
    setRows(current => current.map(row => {
      const entered = parseDecimal(row.cenaKos);
      if (!Number.isFinite(entered)) return row;
      const article = nabavniArtikli.find(item => item.id === row.artikelId);
      const rate = efektivnaDdvStopnja(row.ddvStopnja, article?.davek ?? 0);
      const multiplier = 1 + rate / 100;
      if (multiplier === 0) return row;
      const converted = direction > 0 ? entered * multiplier : entered / multiplier;
      return { ...row, cenaKos: String(Math.round((converted + Number.EPSILON) * 10000) / 10000) };
    }));
    setEditVrstaCen(next);
  };

  const skupajTotals = rows.reduce((acc, r) => {
    const article = nabavniArtikli.find(a => a.id === r.artikelId);
    const receipt = preračunajPrejemnico(r, article, editVrstaCen, jeDdvZavezanec);
    const neto = jeDdvZavezanec
      ? receipt.shranjenaCena
      : (receipt.ddvStopnja ? receipt.shranjenaCena / (1 + receipt.ddvStopnja / 100) : receipt.shranjenaCena);
    const bruto = jeDdvZavezanec
      ? (receipt.ddvStopnja ? receipt.shranjenaCena * (1 + receipt.ddvStopnja / 100) : receipt.shranjenaCena)
      : receipt.shranjenaCena;
    return { neto: acc.neto + receipt.kolicina * neto, bruto: acc.bruto + receipt.kolicina * bruto };
  }, { neto: 0, bruto: 0 });

  const handleSave = () => {
    const validRows = rows.filter(r => {
      if (r.artikelId <= 0) return false;
      const article = nabavniArtikli.find(a => a.id === r.artikelId);
      return r.kolicina !== "" || izracunajIzvornoKolicinoZaloge(r, article?.enotaMere, article) != null;
    });
    if (!validRows.length) { toast({ title: "Vsaj ena postavka je obvezna", variant: "destructive" }); return; }
    if (validRows.some(row => row.sourcePriceEditable === false && !originalPriceIsUnchanged(row, editVrstaCen))) {
      toast({
        title: "Vir cene ni dovolj opredeljen",
        description: "Nespremenjene uvožene vrednosti lahko ohranite, za spremembo cene pa sta potrebna znana osnova cene in obravnava popusta.",
        variant: "destructive",
      });
      return;
    }
    const sourceErrors = Object.fromEntries(validRows.flatMap(row => {
      const rowIndex = rows.indexOf(row);
      const article = nabavniArtikli.find(a => a.id === row.artikelId);
      const error = validateGroupSourceLine(
        Boolean(article?.jeSkupinskiNabavniArtikel),
        article?.enotaMere,
        row.izvNaziv,
        row.izvEnota,
      );
      return error ? [[rowIndex, error]] : [];
    }));
    setSourceLineErrors(sourceErrors);
    if (Object.keys(sourceErrors).length > 0) {
      const [rowIndex, error] = Object.entries(sourceErrors)[0];
      toast({
        title: "Preverite izvorno postavko",
        description: `Vrstica ${Number(rowIndex) + 1}: ${error}`,
        variant: "destructive",
      });
      return;
    }
    updatePrejemnica.mutate({
      id,
      data: {
        datum,
        dobaviteljId: dobaviteljId ?? null,
        opomba: opomba || null,
        stDokumenta: stDokumenta || null,
        datumDokumenta: datumDokumenta || null,
        valuta: valuta || "EUR",
        datumZapadlosti: datumZapadlosti || null,
        placanoZGotovino,
        odvisniStroski: odvisniStroski
          .filter(s => s.naziv.trim() && s.znesek !== "")
          .map(s => ({
            naziv: s.naziv.trim(),
            znesek: parseDecimal(s.znesek),
            ddvStopnja: s.ddvStopnja === "" ? null : parseDecimal(s.ddvStopnja),
            obravnava: s.obravnava,
          })),
        vrstaCen: editVrstaCen,
        postavke: validRows.map(r => {
          const article = nabavniArtikli.find(a => a.id === r.artikelId);
          const katalogCena = parseDecimal(r.cenaKos) || 0; // cena v formi = katalog (pred popustom)
          const receipt = preračunajPrejemnico(r, article, editVrstaCen, jeDdvZavezanec);
          const { enot, kolicina, shranjenaCena, ddvStopnja, ddvOsnova } = receipt;
          const [popustOdst, popust2Odst] = razcleniPopust(r.popust);
          const pricePayload = buildReceiptPricePayload(r, editVrstaCen, {
            netAmount: ddvOsnova,
            vatAmount: ddvOsnova * ddvStopnja / 100,
            stockQuantity: kolicina,
            stockUnitPrice: shranjenaCena,
            sourcePrice: katalogCena,
            discount1: popustOdst,
            discount2: popust2Odst,
          });
          return {
            id: r.id,
            artikelId: r.artikelId,
            kolicina: pricePayload.kolicina,
            cenaKos: pricePayload.cenaKos,
            ddvStopnja,
            ddvOsnova: pricePayload.ddvOsnova,
            ddvZnesek: pricePayload.ddvZnesek,
            skupaj: pricePayload.skupaj,
            vrsticaTip: "zaloga" as const,
            enotVPaketu: enot,
            izvCena: pricePayload.izvCena,
            izvCenaVrsta: pricePayload.izvCenaVrsta,
            rabatVkljucenVCeni: pricePayload.rabatVkljucenVCeni,
            rabat1Odst: pricePayload.rabat1Odst,
            rabat2Odst: pricePayload.rabat2Odst,
            alergeni: r.alergeni ?? [],
            alergeniSledi: r.alergeniSledi ?? [],
            alergeniStatus: r.alergeniStatus ?? "nepreverjeno",
            alergeniVir: r.alergeniVir ?? null,
            alergeniOpombaVira: r.alergeniOpombaVira ?? null,
            alergeniDocumentId: r.alergeniDocumentId ?? null,
            izvNaziv: r.izvNaziv ?? null,
            izvEnota: r.izvEnota ?? null,
            izvKolicina: receipt.izvornaKolicina,
            ...payloadIzplenPrejemnice(r),
          };
        }),
      } as any,
    }, {
      onSuccess: () => { toast({ title: "Prejemnica posodobljena" }); onSaved(); },
      onError: (error) => {
        const data = error instanceof ApiError
          ? error.data as { error?: string } | null
          : null;
        toast({
          title: "Napaka pri shranjevanju",
          description: data?.error ?? (error instanceof Error ? error.message : undefined),
          variant: "destructive",
        });
      },
    });
  };
  useF2Save(handleSave, !updatePrejemnica.isPending && rows.length > 0);

  if (bookingPreviewId !== null) {
    return (
      <BookingPreviewDialog
        receiptId={bookingPreviewId}
        onClose={() => setBookingPreviewId(null)}
        onConfirmed={() => {
          setBookingPreviewId(null);
          onSaved();
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        ref={ddDialogRef}
        className="max-w-4xl lg:w-[96vw] lg:max-w-[1280px] max-h-[90vh] flex flex-col overflow-hidden"
        onEscapeKeyDown={e => { if (dobDropdownOpen || ddOpenIdx !== null) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Uredi prejemnico
            {data && <Badge variant={isConfirmed ? "default" : "secondary"}>{isConfirmed ? "Potrjena" : "Osnutek"}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {!isConfirmed && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Osnutek še ne vpliva na zalogo ali evidenco embalaže. Pred uporabo zaloge potrdite prejemnico.
          </div>
        )}
        {isError ? (
          <div role="alert" className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p>Prejemnice ni mogoče odpreti. Preverite povezavo, izbrano enoto in dovoljenja.</p>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Zapri</Button>
          </div>
        ) : isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1">
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
                      onEnterAfterSelect={() => editStevilkaRef.current?.focus()}
                      onDropdownOpenChange={setDobDropdownOpen}
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
            {/* Številka + Datum dobavnice */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Številka dobavnice</Label>
                <Input ref={editStevilkaRef} value={stDokumenta} onChange={e => setStDokumenta(e.target.value)} placeholder="npr. DOB-2026-001"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); editDatumDobavniceRef.current?.focus(); } }} />
              </div>
              <div className="space-y-1.5">
                <Label>Datum dobavnice</Label>
                <SmartDateInput ref={editDatumDobavniceRef} value={datumDokumenta} onChange={setDatumDokumenta}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); editOpombaRef.current?.focus(); } }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Valuta <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
                <Input value={valuta} onChange={e => setValuta(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" />
              </div>
              <div className="space-y-1.5">
                <Label>Rok plačila <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
                <SmartDateInput value={datumZapadlosti} onChange={setDatumZapadlosti} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Opomba</Label>
              <Input ref={editOpombaRef} value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Referenca, opomba..." onKeyDown={handleEnterAsTab} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={placanoZGotovino} onChange={e => setPlacanoZGotovino(e.target.checked)} disabled={isConfirmed} />
              Plačano z gotovino
            </label>

            {/* Vrsta cen na dobavnici */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Cene na dobavnici:</span>
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button type="button"
                  className={`px-3 py-1.5 transition-colors ${editVrstaCen === "neto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => changeEditPriceBasis("neto")}>Neto (brez DDV)</button>
                <button type="button"
                  className={`px-3 py-1.5 border-l transition-colors ${editVrstaCen === "bruto" ? "bg-primary text-primary-foreground font-medium" : "bg-background hover:bg-muted"}`}
                  onClick={() => changeEditPriceBasis("bruto")}>Bruto (maloprodajne)</button>
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
                    <div className={isOpen && !selectedArtikel ? "relative z-10" : "relative"}>
                    <div className="overflow-x-auto lg:overflow-x-visible">
                    <div className="flex gap-2 items-center min-w-max lg:min-w-0 lg:w-full">
                      {/* Artikel combobox */}
                      <div className="w-56 shrink-0 lg:w-auto lg:min-w-0 lg:flex-1">
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
                              {selectedArtikel.enotaMere ? ` (${displayEslogUnit(selectedArtikel.enotaMere)})` : ""}
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
                            = {fmt(parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1))} {displayEslogUnit(nabavniArtikli.find(a => a.id === row.artikelId)?.enotaMere) || "enot"}
                          </span>
                        )}
                      </div>
                      {/* Cena / Cena na paket */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput value={row.cenaKos}
                          placeholder={row.enotVPaketu ? "Cena/paket" : (editVrstaCen === "neto" ? "Cena brez DDV" : "Maloprodajna cena")}
                          onChange={e => updateRow(i, "cenaKos", e.target.value)}
                          disabled={row.sourcePriceEditable === false}
                          ref={el => { if (el) editCenaInputRefs.current.set(i, el as any); else editCenaInputRefs.current.delete(i); }}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "cena", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navEdit(i, "cena", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navEdit(i, "cena", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navEdit(i, "cena", "down"); }
                          }}
                          className="w-28" />
                        {row.sourcePriceEditable === false && (
                          <span className="max-w-28 text-[10px] leading-tight text-destructive">
                            Uvožena osnova cene/popusta ni dovolj znana za varno spremembo.
                          </span>
                        )}
                        {row.enotVPaketu && parseDecimal(row.enotVPaketu) > 1 && parseDecimal(row.cenaKos) > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            = {fmt(parseDecimal(row.cenaKos) / (parseDecimal(row.enotVPaketu) || 1))} €/enoto
                          </span>
                        )}
                      </div>
                      {/* Popust % */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput
                          ref={el => { if (el) editPopustInputRefs.current.set(i, el as any); else editPopustInputRefs.current.delete(i); }}
                          value={row.popust}
                          placeholder="Popust %"
                          onChange={e => updateRow(i, "popust", e.target.value)}
                          disabled={row.sourcePriceEditable === false || row.rabatVkljucenVCeni === true}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); editDodajRef.current?.focus(); return; }
                            if (e.key === "ArrowRight") { e.preventDefault(); navEdit(i, "popust", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navEdit(i, "popust", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navEdit(i, "popust", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navEdit(i, "popust", "down"); }
                          }}
                          className="w-20" />
                        {parseDecimal(row.popust) > 0 && (
                          <span className="text-xs text-muted-foreground">%</span>
                        )}
                        {row.rabatVkljucenVCeni === true
                          && ((row.originalPriceSnapshot?.discount1 ?? 0) > 0
                            || (row.originalPriceSnapshot?.discount2 ?? 0) > 0) && (
                            <span className="max-w-20 text-[10px] leading-tight text-muted-foreground">
                              Popust je že vključen v ceno
                            </span>
                          )}
                      </div>
                      <DecimalInput
                        value={row.ddvStopnja}
                        placeholder="DDV %"
                        onChange={e => updateRow(i, "ddvStopnja", e.target.value)}
                        className="w-20"
                      />
                      {/* Preračunana cena po popustu (readonly) */}
                      {(() => {
                        const enot = parseDecimal(row.enotVPaketu) || 1;
                        const vnos = parseDecimal(row.cenaKos) || 0;
                        const popustF = 1 - (parseDecimal(row.popust) || 0) / 100;
                        const cenaNaEnoto = (enot > 1 ? vnos / enot : vnos) * popustF;
                        const davek = efektivnaDdvStopnja(
                          row.ddvStopnja,
                          nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0,
                        );
                        const shranjeno = konvertirajCeno(cenaNaEnoto, davek, editVrstaCen, jeDdvZavezanec);
                        return (
                          <input
                            readOnly
                            tabIndex={-1}
                            value={vnos ? fmt(shranjeno, 4) : ""}
                            placeholder={jeDdvZavezanec ? "Neto" : "Bruto"}
                            title={jeDdvZavezanec ? "Cena/enoto, ki se shrani (brez DDV)" : "Cena/enoto, ki se shrani (z DDV)"}
                            className="w-28 border rounded-md px-2 py-2 text-sm bg-muted text-muted-foreground text-right cursor-default select-none"
                          />
                        );
                      })()}

                      <AlergeniRowPopover
                        row={row}
                        companyId={companyId}
                        open={alergeniOpenIdx === i}
                        onOpenChange={open => setAlergeniOpenIdx(open ? i : null)}
                        onUpdate={(snap) => {
                          updateRow(i, "alergeni", snap.alergeni);
                          updateRow(i, "alergeniSledi", snap.alergeniSledi);
                          updateRow(i, "alergeniStatus", snap.alergeniStatus);
                          updateRow(i, "alergeniVir", snap.alergeniVir);
                          updateRow(i, "alergeniOpombaVira", snap.alergeniOpombaVira);
                          updateRow(i, "alergeniDocumentId", snap.alergeniDocumentId);
                        }}
                      />

                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => removeRow(i)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    </div>
                    </div>
                    <IzvornaPostavkaPolja
                      row={row}
                      target={selectedArtikel}
                      error={sourceLineErrors[i]}
                      id={`edit-${row.id ?? i}`}
                      onChange={(field, value) => updateRow(i, field, value)}
                    />
                    <MassYieldFields
                      key={`edit-mass-${row.id ?? i}`}
                      value={massYieldZaPrejemnico(row, selectedArtikel)}
                      onChange={next => {
                        const current = massYieldZaPrejemnico(row, selectedArtikel);
                        if (next.brutoTezaG !== current.brutoTezaG) {
                          updateRow(i, "brutoTezaG", next.brutoTezaG);
                          updateRow(i, "brutoTezaGTouched", true);
                        }
                        if (next.netoTezaG !== current.netoTezaG) {
                          updateRow(i, "netoTezaG", next.netoTezaG);
                          updateRow(i, "netoTezaGTouched", true);
                        }
                        if (next.netoDelezOdst !== current.netoDelezOdst) {
                          updateRow(i, "netoDelezOdst", next.netoDelezOdst);
                          updateRow(i, "netoDelezOdstTouched", true);
                        }
                      }}
                      sourceUnit={row.izvEnota ?? ""}
                      baseUnit={selectedArtikel?.enotaMere}
                      quantity={izracunajIzvornoKolicinoZaloge(row, selectedArtikel?.enotaMere, selectedArtikel)
                        ?? parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1)}
                      lineValue={izracunajVrednostPostavke(row)}
                      priceMode={editVrstaCen}
                      taxRate={efektivnaDdvStopnja(row.ddvStopnja, selectedArtikel?.davek ?? 0)}
                      buyerVatRegistered={jeDdvZavezanec}
                      autoOpen={["kg", "kgm"].includes(selectedArtikel?.enotaMere?.trim().toLowerCase() ?? "")}
                      purchaseQuantity={row.izvKolicina ?? ""}
                      onPurchaseQuantityChange={value => updateRow(i, "izvKolicina", value)}
                      onPurchaseUnitChange={value => updateRow(i, "izvEnota", value)}
                    />
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
                <Button
                  ref={editDodajRef}
                  variant="outline"
                  size="sm"
                  className="focus:bg-primary focus:text-primary-foreground focus:border-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={addRow}
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
            <OdvisniStroskiEditor value={odvisniStroski} onChange={setOdvisniStroski} />
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
                queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
              }}
            />
          </div>
        )}
        {ddOpenIdx !== null && ddPos !== null && (() => {
          const ddFiltered = ddFilter ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(ddFilter.toLowerCase())) : nabavniArtikli;
          return (
            <div style={{ position: 'absolute', top: ddPos.top, left: ddPos.left, width: 192, zIndex: 100 }}
                 className="bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
              {ddFiltered.length === 0 ? (
                <div className="px-3 py-2 space-y-1.5">
                  <p className="text-xs text-muted-foreground">Ni zadetkov za „{ddFilter}"</p>
                  <button
                    ref={el => { if (el) editNovArtBtnRefs.current.set(ddOpenIdx, el); else editNovArtBtnRefs.current.delete(ddOpenIdx); }}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setDdOpenIdx(null); setEditNovArtikelRowIdx(ddOpenIdx); } }}
                    onMouseDown={e => { e.preventDefault(); setDdOpenIdx(null); setEditNovArtikelRowIdx(ddOpenIdx); }}
                  >
                    <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                  </button>
                </div>
              ) : ddFiltered.map((a, j) => (
                <div key={a.id}
                  className={`px-3 py-1.5 text-sm cursor-pointer ${j === ddHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                  onMouseDown={e => { e.preventDefault(); selectArtikelInEditRow(ddOpenIdx, a.id); }}>
                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}
                </div>
              ))}
            </div>
          );
        })()}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          {!isConfirmed && <Button ref={editShraniRef} onClick={handleSave} disabled={updatePrejemnica.isPending || rows.length === 0}>
            {updatePrejemnica.isPending ? "Shranjujem..." : <>Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
          </Button>}
          {status === "draft" && (
            <Button onClick={() => setConfirmOpen(true)}>Potrdi prejemnico</Button>
          )}
          {isConfirmed && (
            <Button onClick={() => setBookingPreviewId(id)}>Pripravi računovodski osnutek</Button>
          )}
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potrdi prejemnico?</AlertDialogTitle>
            <AlertDialogDescription>
              Šele potrditev vpliva na zalogo in evidenco embalaže. Po potrditvi postavk prejemnice ni več mogoče urejati.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmPrejemnica(); }}>
              Potrdi prejemnico
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ── Edit Inventura dialog ──────────────────────────────────────────────────
function EditInventuraDialog({
  id, nabavniArtikli, zaloge, onClose, onSaved,
}: {
  id: number;
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null; drobniInventar?: boolean }[];
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
  const [editedPrices, setEditedPrices] = useState<Set<number>>(new Set());
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
      setEditedPrices(new Set());
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
          ...(editedPrices.has(r.artikelId) && !jeDrobniInventar(nabavniArtikli.find(a => a.id === r.artikelId)) && parseDecimal(r.cenaKos) > 0
            ? { cenaKos: parseDecimal(r.cenaKos) } : {}),
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
                      <TableHead className="text-right">Nabavna cena</TableHead>
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
                       const jeKolicinski = jeDrobniInventar(art);
                       const cena = jeKolicinski ? null : parseDecimal(row.cenaKos) || null;
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
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}
                                </option>
                              ))}
                            </select>
                            {jeKolicinski && <Badge className="mt-1 border-amber-300 bg-amber-100 text-amber-900">Drobni inventar · količina</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            {jeKolicinski ? <span className="text-muted-foreground">–</span> : <DecimalInput value={row.cenaKos}
                              aria-label={`Nabavna cena ${art?.imeZaNabavo || art?.ime || row.artikelId}`}
                              onChange={e => {
                                setEditedPrices(previous => new Set(previous).add(row.artikelId));
                                setRows(previous => previous.map((item, index) => index === i ? { ...item, cenaKos: e.target.value } : item));
                              }}
                              className="w-24 text-right ml-auto h-8" />}
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
  nabavniArtikli: { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null; drobniInventar?: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useGetZacetnaZaloga(id);
  const updateZacetnaZaloga = useUpdateZacetnaZaloga();
  const { toast } = useToast();

  const [datum, setDatum] = useState("");
  const [opomba, setOpomba] = useState("");
  const [rows, setRows] = useState<ZacetnaZalogaRow[]>([]);
  const [scope, setScope] = useState<"material" | "drobni">("material");
  const scopeArtikli = nabavniArtikli.filter(a => jeDrobniInventar(a) === (scope === "drobni"));
  const nerabljeniArtikli = scopeArtikli.filter(a => !rows.some(r => r.artikelId === a.id));
  const artikelJeKolicinski = (artikelId: number) => jeDrobniInventar(nabavniArtikli.find(a => a.id === artikelId));
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
        cenaKos: jeDrobniInventar(nabavniArtikli.find(a => a.id === p.artikelId)) ? "0" : String(p.cenaKos),
      })));
    }
  }, [data]);

  const skupajVrednost = rows.reduce((s, r) => s + (parseDecimal(r.kolicina) || 0) * (parseDecimal(r.cenaKos) || 0), 0);

  const addRow = () => {
    const next = nerabljeniArtikli[0];
    if (!next) {
      toast({ title: "Vsi artikli te skupine so že na seznamu" });
      return;
    }
    setRows(r => [...r, { artikelId: next.id, kolicina: "0", cenaKos: "0" }]);
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
          cenaKos: artikelJeKolicinski(r.artikelId) ? 0 : parseDecimal(r.cenaKos) || 0,
        })),
      },
    }, {
      onSuccess: (data: any) => {
        if (data?.bookingRef) {
          toast({ title: "Začetne zaloge posodobljene", description: `Poknjiženo v ERP (${data.bookingRef})` });
        } else if (data?.bookingSkipped) {
          toast({ title: "Začetne zaloge posodobljene", description: `⚠️ ERP knjiženje preskočeno: ${data.bookingSkipped}` });
        } else {
          toast({ title: "Začetne zaloge posodobljene" });
        }
        onSaved();
      },
      onError: () => toast({ title: "Napaka pri shranjevanju", variant: "destructive" }),
    });
  };
  useF2Save(handleSave, !updateZacetnaZaloga.isPending && rows.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-3 sm:p-6 gap-3 sm:gap-4">
        <DialogHeader><DialogTitle>Uredi začetne zaloge</DialogTitle></DialogHeader>
        {isLoading || rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje...</div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            <Tabs value={scope} onValueChange={value => setScope(value as "material" | "drobni")}>
              <TabsList>
                <TabsTrigger value="material">Material</TabsTrigger>
                <TabsTrigger value="drobni">Drobni inventar</TabsTrigger>
              </TabsList>
            </Tabs>
            {scope === "drobni" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                Drobni inventar se vodi samo količinsko: cena je 0 € in sprememba začetne zaloge ne ustvari GL knjižbe.
                Prejemnica dejanskega nakupa ohrani dobaviteljevo ceno in stroškovno knjiženje.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="space-y-1 sm:space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={datum} onChange={setDatum} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} className="h-10 sm:h-9" />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <Label>Opomba</Label>
                <Input value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Opomba..." onKeyDown={handleEnterAsTab} className="h-10 sm:h-9" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Postavke</Label>
              <div className="space-y-2 sm:space-y-0 sm:border sm:rounded-md sm:bg-background">
                <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_6rem_2.5rem] gap-2 px-3 py-2 bg-muted/50 rounded-t-md text-sm font-medium text-muted-foreground border-b">
                  <div>Artikel</div>
                  <div className="text-right">Količina</div>
                  <div className="text-right">Cena/enoto</div>
                  <div className="text-right">Vrednost (€)</div>
                  <div></div>
                </div>
                <div className="space-y-2 sm:space-y-0">
                  {rows.map((row, i) => {
                    const artikelKolicinski = artikelJeKolicinski(row.artikelId);
                    if (row.artikelId > 0 && artikelKolicinski !== (scope === "drobni")) return null;
                    const vrednost = artikelKolicinski ? 0 : (parseDecimal(row.kolicina) || 0) * (parseDecimal(row.cenaKos) || 0);
                    return (
                      <div key={i} className="flex flex-col sm:grid sm:grid-cols-[1fr_7rem_7rem_6rem_2.5rem] gap-2 sm:gap-2 items-start sm:items-center bg-card border sm:border-transparent sm:border-b sm:last:border-b-transparent rounded-md sm:rounded-none p-2 sm:p-2 sm:px-3 shadow-sm sm:shadow-none">

                        <div className="w-full flex items-end gap-2 sm:contents">
                          <div className="flex-1">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Artikel</div>
                            <select
                              className="w-full border rounded-md px-2 text-base sm:text-sm bg-background h-9 sm:h-8 focus:ring-2 focus:ring-primary focus:outline-none"
                              value={row.artikelId}
                              onChange={e => {
                                const artikelId = parseInt(e.target.value);
                                setRows(current => current.map((item, index) => index === i
                                  ? { ...item, artikelId, ...(jeDrobniInventar(nabavniArtikli.find(a => a.id === artikelId)) ? { cenaKos: "0" } : {}) }
                                  : item));
                              }}
                            >
                              {scopeArtikli.filter(a => a.id === row.artikelId || !rows.some(r => r.artikelId === a.id)).map(a => (
                            <option key={a.id} value={a.id}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}{jeDrobniInventar(a) ? " · Drobni inventar" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:hidden shrink-0">
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="w-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:contents">
                          <div className="w-full">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Količina</div>
                            <DecimalInput value={row.kolicina}
                              ref={el => { if (el) zzEditKoliRefs.current.set(i, el as any); else zzEditKoliRefs.current.delete(i); }}
                              onChange={e => updateRow(i, "kolicina", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="w-full text-right h-9 sm:h-8 text-base sm:text-sm" />
                          </div>

                          <div className="w-full">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Cena/enoto</div>
                            {artikelJeKolicinski(row.artikelId) ? (
                              <div className="flex h-9 items-center justify-end text-right text-xs font-medium text-amber-800 sm:h-8">
                                Samo količina · 0 €
                              </div>
                            ) : <DecimalInput value={row.cenaKos}
                              ref={el => { if (el) zzEditCenaRefs.current.set(i, el as any); else zzEditCenaRefs.current.delete(i); }}
                              onChange={e => updateRow(i, "cenaKos", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowLeft") { e.preventDefault(); const el = zzEditKoliRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzEditCenaRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="w-full text-right h-9 sm:h-8 text-base sm:text-sm" />}
                          </div>

                          <div className="sm:contents">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Vrednost</div>
                            <div className="h-9 flex items-center justify-end text-right tabular-nums text-sm font-semibold text-primary sm:h-auto sm:text-sm sm:font-medium sm:text-foreground">
                              {vrednost > 0 ? `${fmt(vrednost)} €` : <span className="text-muted-foreground">–</span>}
                            </div>
                          </div>
                        </div>

                        <div className="hidden sm:flex justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => removeRow(i)} disabled={rows.length === 1}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addRow} disabled={nerabljeniArtikli.length === 0}>
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
  const receiptSearch = useSearch();
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

  // ── Aktivni tab (kontroliran, da ga lahko preklopi program) ────────
  const [activeTab, setActiveTab] = useState("zaloge");

  // ── Search ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const [stockScope, setStockScope] = useState<"material" | "drobni">("material");
  const stockScopedRows = (zaloge ?? []).filter(z =>
    !z.povratnaEmbalaza
    && jeDrobniInventar(artikli?.find(a => a.id === z.artikelId)) === (stockScope === "drobni")
  );
  const filteredZaloge = stockScopedRows
    .filter(z => !q || z.artikelIme.toLowerCase().includes(q) || (z.imeZaNabavo ?? "").toLowerCase().includes(q))
    .sort((a, b) => primerjajSlovensko(a.artikelIme, b.artikelIme));
  const negativneZaloge = stockScopedRows.filter(z =>
    z.kolicina < 0 && (!q || z.artikelIme.toLowerCase().includes(q) || (z.imeZaNabavo ?? "").toLowerCase().includes(q))
  );

  const [exportingPdf, setExportingPdf] = useState(false);
  const [katalogPdfLoading, setKatalogPdfLoading] = useState(false);
  const downloadKatalogPdf = async (scope: Extract<ArtikelKatalogScope, "nabavni" | "drobni">) => {
    setKatalogPdfLoading(true);
    try {
      await downloadArtikelKatalogPdf(scope);
    } catch (error) {
      toast({
        title: "Napaka pri izvozu kataloga",
        description: error instanceof Error ? error.message : "Kataloga PDF ni bilo mogoče ustvariti.",
        variant: "destructive",
      });
    } finally {
      setKatalogPdfLoading(false);
    }
  };

  const downloadPdf = async (kind: "stock" | "popis", scope: "material" | "drobni") => {
    setExportingPdf(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/zaloge/export/pdf?kind=${kind}&scope=${scope}`);
      if (!response.ok) throw new Error(`Strežnik je vrnil napako ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${kind === "stock" ? "zaloge" : "popis"}-${scope}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      toast({
        title: "PDF-ja ni bilo mogoče prenesti",
        description: error instanceof Error ? error.message : "Preverite povezavo in poskusite znova.",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Prejemnica create ──────────────────────────────────────────────
  const { data: kupci } = useListPartnerji();

  // ── Uvoz dobavnice ─────────────────────────────────────────────────
  const [uvozDialogOpen, setUvozDialogOpen] = useState(false);
  const dobaviteljiMap = useMemo(() =>
    new Map((kupci ?? []).map((k: Partner) => [k.id, k.naziv ?? ""])),
    [kupci]
  );
  const [prejDialogOpen, setPrejDialogOpen] = useState(false);
  const [prejDobDropdownOpen, setPrejDobDropdownOpen] = useState(false);
  const [prejDatum, setPrejDatum] = useState("");
  const [prejDobaviteljId, setPrejDobaviteljId] = useState<string | null>(null);
  const [prejDobaviteljNaziv, setPrejDobaviteljNaziv] = useState("");
  const [novDobaviteljOpen, setNovDobaviteljOpen] = useState(false);
  const [prejStevilkaDobavnice, setPrejStevilkaDobavnice] = useState("");
  const [prejDatumDobavnice, setPrejDatumDobavnice] = useState("");
  const [prejOpomba, setPrejOpomba] = useState("");
  const [prejValuta, setPrejValuta] = useState("EUR");
  const [prejDatumZapadlosti, setPrejDatumZapadlosti] = useState("");
  const [prejPlacanoZGotovino, setPrejPlacanoZGotovino] = useState(false);
  const [prejOdvisniStroski, setPrejOdvisniStroski] = useState<OdvisniStrosekRow[]>([]);
  const [prejRows, setPrejRows] = useState<PrejemnicaRow[]>([{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "", popust: "", ddvStopnja: "" }]);
  const [prejSourceErrors, setPrejSourceErrors] = useState<Record<number, string>>({});
  // Dropdown state za artikel combobox
  const prejArtDialogRef = useRef<HTMLDivElement>(null);
  const [dropdownOpenIdx, setDropdownOpenIdx] = useState<number | null>(null);
  const [prejAlergeniOpenIdx, setPrejAlergeniOpenIdx] = useState<number | null>(null);
  const [dropdownFilter, setDropdownFilter] = useState("");
  const [dropdownHighlight, setDropdownHighlight] = useState(0);
  const [artDropdownPos, setArtDropdownPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (dropdownOpenIdx === null) { setArtDropdownPos(null); return; }
    const inputEl = artInputRefs.current.get(dropdownOpenIdx);
    const dialogEl = prejArtDialogRef.current;
    if (!inputEl || !dialogEl) { setArtDropdownPos(null); return; }
    const ir = inputEl.getBoundingClientRect();
    const dr = dialogEl.getBoundingClientRect();
    setArtDropdownPos({ top: ir.bottom - dr.top + 4, left: ir.left - dr.left });
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
  const popustInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const novArtBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const pakBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const invNajdenoRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const zzKoliRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const zzCenaRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Navigacija s puščicami po mreži polj: art → enot → koli → cena → popust (levo/desno), vrstice gor/dol
  const navPrej = (rowIdx: number, col: "art" | "enot" | "koli" | "cena" | "popust", dir: "left" | "right" | "up" | "down") => {
    const cols = ["art", "enot", "koli", "cena", "popust"] as const;
    const refs: Record<string, React.MutableRefObject<Map<number, HTMLInputElement>>> = {
      art: artInputRefs, enot: enotInputRefs, koli: koliInputRefs, cena: cenaInputRefs, popust: popustInputRefs,
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
    setPrejValuta("EUR");
    setPrejDatumZapadlosti("");
    setPrejPlacanoZGotovino(false);
    setPrejOdvisniStroski([]);
    setPrejRows([{ artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "", popust: "", ddvStopnja: "" }]);
    setPrejSourceErrors({});
    setDropdownOpenIdx(null);
    setDropdownFilter("");
    setDropdownHighlight(0);
    setPrejDialogOpen(true);
  };
  const handleSavePrejemnica = () => {
    const validRows = prejRows.filter(r => {
      if (r.artikelId <= 0) return false;
      const article = nabavniArtikli.find(a => a.id === r.artikelId);
      return r.kolicina !== "" || izracunajIzvornoKolicinoZaloge(r, article?.enotaMere, article) != null;
    });
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    const sourceErrors = Object.fromEntries(validRows.flatMap(row => {
      const rowIndex = prejRows.indexOf(row);
      const article = nabavniArtikli.find(a => a.id === row.artikelId);
      const error = validateGroupSourceLine(
        Boolean(article?.jeSkupinskiNabavniArtikel),
        article?.enotaMere,
        row.izvNaziv,
        row.izvEnota,
      );
      return error ? [[rowIndex, error]] : [];
    }));
    setPrejSourceErrors(sourceErrors);
    if (Object.keys(sourceErrors).length > 0) {
      const [rowIndex, error] = Object.entries(sourceErrors)[0];
      toast({
        title: "Preverite izvorno postavko",
        description: `Vrstica ${Number(rowIndex) + 1}: ${error}`,
        variant: "destructive",
      });
      return;
    }
    createPrejemnica.mutate({
      data: {
        datum: prejDatum || undefined,
        dobaviteljId: prejDobaviteljId ?? undefined,
        opomba: prejOpomba || undefined,
        stDokumenta: prejStevilkaDobavnice || undefined,
        datumDokumenta: prejDatumDobavnice || undefined,
        valuta: prejValuta || "EUR",
        datumZapadlosti: prejDatumZapadlosti || undefined,
        placanoZGotovino: prejPlacanoZGotovino,
        odvisniStroski: prejOdvisniStroski
          .filter(s => s.naziv.trim() && s.znesek !== "")
          .map(s => ({
            naziv: s.naziv.trim(),
            znesek: parseDecimal(s.znesek),
            ddvStopnja: s.ddvStopnja === "" ? null : parseDecimal(s.ddvStopnja),
            obravnava: s.obravnava,
          })),
        vrstaCen,
        postavke: validRows.map(r => {
          const article = nabavniArtikli.find(a => a.id === r.artikelId);
          const katalogCena = parseDecimal(r.cenaKos) || 0; // cena v formi = katalog (pred popustom)
          const receipt = preračunajPrejemnico(r, article, vrstaCen, jeDdvZavezanec);
          const { enot, kolicina, shranjenaCena, ddvStopnja, ddvOsnova } = receipt;
          const [popustOdst, popust2Odst] = razcleniPopust(r.popust);
          return {
            artikelId: r.artikelId,
            kolicina,
            cenaKos: shranjenaCena,
            ddvStopnja,
            ddvOsnova,
            ddvZnesek: ddvOsnova * ddvStopnja / 100,
            vrsticaTip: "zaloga" as const,
            enotVPaketu: enot,
            izvCena: katalogCena,
            izvCenaVrsta: vrstaCen,
            rabatVkljucenVCeni: false,
            rabat1Odst: popustOdst,
            rabat2Odst: popust2Odst,
            alergeni: r.alergeni ?? [],
            alergeniSledi: r.alergeniSledi ?? [],
            alergeniStatus: r.alergeniStatus ?? "nepreverjeno",
            alergeniVir: r.alergeniVir ?? null,
            alergeniOpombaVira: r.alergeniOpombaVira ?? null,
            alergeniDocumentId: r.alergeniDocumentId ?? null,
            izvNaziv: r.izvNaziv?.trim() || null,
            izvEnota: r.izvEnota?.trim() || null,
            izvKolicina: receipt.izvornaKolicina,
            ...payloadIzplenPrejemnice(r),
          };
        }),
      } as any,
    }, {
      onSuccess: () => {
        // refetchQueries garantira takojšen refresh seznama (ne le označi za stale)
        void queryClient.refetchQueries({ queryKey: getListZalogeQueryKey() });
        void queryClient.refetchQueries({ queryKey: getListPrejemniceQueryKey() });
        setPrejDialogOpen(false);
        toast({ title: "Prejemnica je shranjena kot osnutek." });
      },
      onError: error => {
        const data = error instanceof ApiError ? error.data as { error?: string } | null : null;
        toast({
          title: "Napaka pri shranjevanju",
          description: data?.error ?? (error instanceof Error ? error.message : undefined),
          variant: "destructive",
        });
      },
    });
  };
  const addPrejRow = () => {
    const newIdx = prejRows.length;
    setPrejRows(r => [...r, { artikelId: 0, kolicina: "", cenaKos: "", enotVPaketu: "", popust: "", ddvStopnja: "" }]);
    setTimeout(() => artInputRefs.current.get(newIdx)?.focus(), 30);
  };
  const removePrejRow = (i: number) => {
    setPrejRows(r => r.filter((_, j) => j !== i));
    setPrejSourceErrors({});
  };
  const updatePrejRow = <K extends keyof PrejemnicaRow>(i: number, key: K, val: PrejemnicaRow[K]) => {
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
    if (key === "izvNaziv" || key === "izvEnota" || key === "artikelId") {
      setPrejSourceErrors(current => {
        const next = { ...current };
        delete next[i];
        return next;
      });
    }
  };
  const selectArtikelInRow = (rowIdx: number, artikelId: number, skipFocus = false) => {
    updatePrejRow(rowIdx, "artikelId", artikelId);
    const artikel = nabavniArtikli.find(a => a.id === artikelId);
    const davek = artikel?.davek ?? 0;

    // Predizpolni alergenski profil; v pravem načinu manjkajoč profil takoj odpre urejevalnik.
    if (artikel) {
      const potrjenProfil = artikel.alergeniStatus && artikel.alergeniStatus !== "nepreverjeno";
      updatePrejRow(rowIdx, "alergeni", import.meta.env.DEV ? [] : (artikel.alergeni ?? []));
      updatePrejRow(rowIdx, "alergeniSledi", import.meta.env.DEV ? [] : (artikel.alergeniSledi ?? []));
      updatePrejRow(rowIdx, "alergeniStatus", import.meta.env.DEV ? "potrjeno_brez" : (potrjenProfil ? artikel.alergeniStatus : "nepreverjeno"));
      updatePrejRow(rowIdx, "alergeniVir", import.meta.env.DEV ? "rocno" : (artikel.alergeniVir ?? null));
      updatePrejRow(rowIdx, "alergeniOpombaVira", import.meta.env.DEV ? "Testno delovanje" : (artikel.alergeniOpombaVira ?? null));
      updatePrejRow(rowIdx, "alergeniDocumentId", import.meta.env.DEV ? null : (artikel.alergeniDocumentId ?? null));
      if (!import.meta.env.DEV && !potrjenProfil) {
        setTimeout(() => setPrejAlergeniOpenIdx(rowIdx), 0);
      }
    } else if (!import.meta.env.DEV) {
      setTimeout(() => setPrejAlergeniOpenIdx(rowIdx), 0);
    }

    const nabavnaEntry = zadnjeNabavneRef.current.get(artikelId);
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
  const [izdScope, setIzdScope] = useState<"material" | "drobni">("material");
  const izdScopeArtikli = nabavniArtikli.filter(a => jeDrobniInventar(a) === (izdScope === "drobni"));
  const spremeniIzdScope = (scope: "material" | "drobni") => {
    if (scope === izdScope) return;
    setIzdScope(scope);
    setIzdRows([{ artikelId: 0, kolicina: "" }]);
    setIzdDropdownOpenIdx(null);
    setIzdDropdownFilter("");
    setIzdNovArtikelRowIdx(null);
    setIzdDiffOpen(false);
    setIzdDiffRows([]);
  };
  const izdArtDialogRef = useRef<HTMLDivElement>(null);
  const [izdDropdownOpenIdx, setIzdDropdownOpenIdx] = useState<number | null>(null);
  const [izdDropdownFilter, setIzdDropdownFilter] = useState("");
  const [izdDropdownHighlight, setIzdDropdownHighlight] = useState(0);
  const [izdDropdownPos, setIzdDropdownPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (izdDropdownOpenIdx === null) { setIzdDropdownPos(null); return; }
    const inputEl = izdArtInputRefs.current.get(izdDropdownOpenIdx);
    const dialogEl = izdArtDialogRef.current;
    if (!inputEl || !dialogEl) { setIzdDropdownPos(null); return; }
    const ir = inputEl.getBoundingClientRect();
    const dr = dialogEl.getBoundingClientRect();
    const prostorPod = window.innerHeight - ir.bottom;
    const top = prostorPod < 220 && ir.top > 220 ? ir.top - dr.top - 208 - 4 : ir.bottom - dr.top + 4;
    setIzdDropdownPos({ top, left: ir.left - dr.left });
  }, [izdDropdownOpenIdx]);
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
    setIzdScope("material");
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
    const neNormativni = izdScopeArtikli.filter(a => !a.vNormativih);
    setIzdDiffRows(neNormativni.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      const knjizno = Number(z?.kolicina ?? 0);
      return { artikelId: a.id, knjizno, dejansko: fmt(knjizno, 3) };
    }));
    setIzdDiffOpen(true);
  };
  const handleSaveIzdajnica = () => {
    const validRows = izdRows.filter(r => r.artikelId > 0 && r.kolicina !== "" && izdScopeArtikli.some(a => a.id === r.artikelId));
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
  useEffect(() => {
    const rawReceiptId = new URLSearchParams(receiptSearch).get("prejemnica");
    if (rawReceiptId === null) return;

    const receiptId = Number(rawReceiptId);
    if (!/^\d+$/.test(rawReceiptId) || !Number.isSafeInteger(receiptId) || receiptId <= 0) {
      toast({
        title: "Prejemnice ni mogoče odpreti",
        description: "Povezava ne vsebuje veljavne prejemnice.",
        variant: "destructive",
      });
      return;
    }

    setActiveTab("prejemnice");
    setEditPrejId(receiptId);
  }, [receiptSearch, toast]);

  // ── Prejemnica delete ──────────────────────────────────────────────
  const [deletePrejId, setDeletePrejId] = useState<number | null>(null);
  const deletePrejemnica = useDeletePrejemnica();
  const handleDeletePrejemnica = () => {
    if (!deletePrejId) return;
    deletePrejemnica.mutate({ id: deletePrejId }, {
      onSuccess: () => {
        void queryClient.refetchQueries({ queryKey: getListZalogeQueryKey() });
        void queryClient.refetchQueries({ queryKey: getListPrejemniceQueryKey() });
        setDeletePrejId(null);
        toast({ title: "Prejemnica izbrisana, zaloge povrnjene" });
      },
      onError: (e: unknown) => {
        const data = (e as { data?: { error?: string; prizadeti?: Array<{ artikelIme?: string | null }> } })?.data;
        const description = data?.prizadeti?.length
          ? data.prizadeti.map(p => p.artikelIme ?? "?").join(", ")
          : (data?.error ?? undefined);
        toast({ title: "Napaka pri brisanju", description, variant: "destructive" });
      },
    });
  };

  // ── Inventura create ───────────────────────────────────────────────
  const [invDialogOpen, setInvDialogOpen] = useState(false);
  const [invDatum, setInvDatum] = useState("");
  const [invOpomba, setInvOpomba] = useState("");
  const [invRows, setInvRows] = useState<InventuraRow[]>([]);
  const [invScope, setInvScope] = useState<"material" | "drobni">("material");
  const [invFilter, setInvFilter] = useState<"normativi" | "vsi">("normativi");
  const [invSearch, setInvSearch] = useState("");
  const [invOcrLoading, setInvOcrLoading] = useState(false);
  const [invOcrResult, setInvOcrResult] = useState<InventuraOcrResult | null>(null);
  const [invEditedPrices, setInvEditedPrices] = useState<Set<number>>(new Set());
  const createInventura = useCreateInventura();

  const openInvDialog = () => {
    // Prisilno osveži artikle, da je vNormativih polje vedno sveže
    queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
    setInvDatum(new Date().toISOString().slice(0, 10));
    setInvOpomba("");
    setInvScope(stockScope);
    setInvFilter("normativi");
    setInvSearch("");
    setInvOcrResult(null);
    setInvEditedPrices(new Set());
    setInvRows(nabavniArtikli.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      return { artikelId: a.id, steviloNajdeno: String(z?.kolicina ?? 0), cenaKos: String(z?.zadnjaCena ?? 0) };
    }));
    setInvDialogOpen(true);
  };
  const invRowsInScope = invRows.filter(row => {
    const article = artikli?.find(a => a.id === row.artikelId);
    if (jeDrobniInventar(article) !== (invScope === "drobni")) return false;
    return invScope === "drobni" || invFilter === "vsi" || article?.vNormativih;
  });
  const invRowsVisible = invRowsInScope.filter(row => {
    const article = nabavniArtikli.find(a => a.id === row.artikelId);
    const query = invSearch.trim().toLocaleLowerCase();
    return !query || `${article?.imeZaNabavo ?? ""} ${article?.ime ?? ""}`.toLocaleLowerCase().includes(query);
  }).sort((left, right) => {
    const a = nabavniArtikli.find(art => art.id === left.artikelId);
    const b = nabavniArtikli.find(art => art.id === right.artikelId);
    return a && b ? primerjajInventurneArtikle(a, b) : 0;
  });

  const importInventorySheet = async (file: File) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) {
      toast({ title: "Izberite PDF, JPG ali PNG do 20 MB", variant: "destructive" });
      return;
    }
    setInvOcrLoading(true);
    setInvOcrResult(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const upload = await posFetch(`${base}/api/inventure/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!upload.ok) throw new Error((await upload.json().catch(() => ({})) as { error?: string }).error || `Nalaganje: ${upload.status}`);
      const { uploadURL, objectPath } = await upload.json() as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Prenos datoteke ni uspel (${put.status})`);
      const recognized = await posFetch(`${base}/api/inventure/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath, scope: invScope }),
      });
      if (!recognized.ok) throw new Error((await recognized.json().catch(() => ({})) as { error?: string }).error || `OCR: ${recognized.status}`);
      const result = await recognized.json() as InventuraOcrResult;
      const byId = new Map(result.rows.map(row => [row.artikelId, row]));
      setInvEditedPrices(new Set(result.rows.filter(row => row.cenaKos != null).map(row => row.artikelId)));
      setInvFilter("vsi");
      setInvSearch("");
      setInvRows(previous => previous.map(row => {
        const article = nabavniArtikli.find(a => a.id === row.artikelId);
        if (jeDrobniInventar(article) !== (invScope === "drobni")) return row;
        const ocr = byId.get(row.artikelId);
        return {
          ...row,
          steviloNajdeno: ocr?.steviloNajdeno != null ? String(ocr.steviloNajdeno) : "",
          cenaKos: ocr?.cenaKos != null ? String(ocr.cenaKos) : row.cenaKos,
        };
      }));
      if (result.datum) setInvDatum(result.datum);
      setInvOcrResult(result);
      toast({ title: `Prebranih ${result.rows.length} postavk`, description: "Pred potrditvijo preverite prepoznane vrednosti." });
    } catch (error) {
      toast({ title: "Popisnega lista ni bilo mogoče prebrati", description: error instanceof Error ? error.message : "Poskusite znova.", variant: "destructive" });
    } finally {
      setInvOcrLoading(false);
    }
  };

  const downloadInventorySheet = async (id: number) => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/inventure/${id}/document`);
      if (!response.ok) throw new Error(`Strežnik je vrnil napako ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `inventura-${id}.${response.headers.get("Content-Type")?.includes("pdf") ? "pdf" : response.headers.get("Content-Type")?.includes("png") ? "png" : "jpg"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({ title: "Priloge ni bilo mogoče prenesti", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveInventura = () => {
    if (invOcrLoading) return;
    // Search only changes what is shown. Save every entered row for this category/filter.
    const validRows = invRowsInScope.filter(r => r.artikelId > 0 && r.steviloNajdeno !== "");
    if (!validRows.length) { toast({ title: "Dodajte vsaj eno postavko", variant: "destructive" }); return; }
    createInventura.mutate({
      data: {
        datum: invDatum || undefined,
        opomba: invOpomba || undefined,
        documentPath: invOcrResult?.documentPath,
        postavke: validRows.map(r => ({
          artikelId: r.artikelId,
          steviloNajdeno: parseDecimal(r.steviloNajdeno) || 0,
          ...(invScope === "material" && invEditedPrices.has(r.artikelId) && parseDecimal(r.cenaKos) > 0
            ? { cenaKos: parseDecimal(r.cenaKos) } : {}),
        })),
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
    const cena = jeDrobniInventar(art) ? null : parseDecimal(row.cenaKos) || (zalogaInfo?.zadnjaCena ?? null);
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
  const [zzScope, setZzScope] = useState<"material" | "drobni">("material");
  const createZacetnaZaloga = useCreateZacetnaZaloga();

  const openZzDialog = () => {
    setZzDatum(`${currentYear}-01-01`);
    setZzOpomba("");
    setZzLeto(currentYear);
    setZzScope("material");
    setZzRows(nabavniArtikli.map(a => {
      const z = zaloge?.find(z => z.artikelId === a.id);
      return { artikelId: a.id, kolicina: String(z?.kolicina ?? 0), cenaKos: jeDrobniInventar(a) ? "0" : String(z?.zadnjaCena ?? 0) };
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
          cenaKos: jeDrobniInventar(nabavniArtikli.find(a => a.id === r.artikelId)) ? 0 : parseDecimal(r.cenaKos) || 0,
        })),
      },
    }, {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListZacetneZalogeQueryKey() });
        setZzDialogOpen(false);
        if (data?.bookingRef) {
          toast({ title: `Začetne zaloge za leto ${zzLeto} shranjene`, description: `Poknjiženo v ERP (${data.bookingRef})` });
        } else if (data?.bookingSkipped) {
          toast({ title: `Začetne zaloge za leto ${zzLeto} shranjene`, description: `⚠️ ERP knjiženje preskočeno: ${data.bookingSkipped}`, variant: "default" });
        } else {
          toast({ title: `Začetne zaloge za leto ${zzLeto} shranjene` });
        }
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
    const zzScopeArtikli = nabavniArtikli.filter(a => jeDrobniInventar(a) === (zzScope === "drobni"));
    const next = zzScopeArtikli.find(a => !usedIds.has(a.id));
    setZzRows(r => [...r, { artikelId: next?.id ?? zzScopeArtikli[0]?.id ?? 0, kolicina: "0", cenaKos: "0" }]);
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
    <div className="min-w-0 w-full flex-1 space-y-4 overflow-auto p-3 sm:p-6">
      <div className="flex items-center gap-3">
        <PackageOpen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Zaloge</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
        <TabsList className="flex h-auto w-full max-w-full justify-start gap-1 overflow-x-auto p-1 [&_[role=tab]]:shrink-0">
          <TabsTrigger value="zaloge">Trenutne zaloge</TabsTrigger>
          <TabsTrigger value="pripravljene-jedi">Pripravljene jedi</TabsTrigger>
          <TabsTrigger value="prejemnice">Prejemnice</TabsTrigger>
          <TabsTrigger value="izdajnice">Izdajnice</TabsTrigger>
          <TabsTrigger value="inventure">Inventure</TabsTrigger>
          <TabsTrigger value="zacetne-zaloge">Začetne zaloge</TabsTrigger>
          <TabsTrigger value="povratna-embalaza">Povratna embalaža</TabsTrigger>
        </TabsList>

        {/* ── Trenutne zaloge ──────────────────────────────────────── */}
        <TabsContent value="zaloge" className="space-y-4 mt-4">
          <Tabs value={stockScope} onValueChange={value => setStockScope(value as "material" | "drobni")}>
            <TabsList>
              <TabsTrigger value="material">Material</TabsTrigger>
              <TabsTrigger value="drobni">Drobni inventar</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-1.5">
            {/* Iskanje + admin gumb v eni vrstici */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Iskanje artiklov..." className="pl-8 pr-8" />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {jeAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReconcileDialogOpen(true)}
                  disabled={reconcile.isPending}
                  title="Preračuna stanja zalog iz dnevnika gibanj"
                  className="shrink-0"
                >
                  <Wrench className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">
                    {reconcile.isPending ? "Popravljam..." : "Popravi zaloge"}
                  </span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadPdf("stock", stockScope)}
                disabled={exportingPdf}
                className="shrink-0"
                title={`Prenesi PDF zalog — ${stockScope === "material" ? "material" : "drobni inventar"}`}
              >
                <Download className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">PDF zalog</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadKatalogPdf(stockScope === "material" ? "nabavni" : "drobni")}
                disabled={katalogPdfLoading}
                className="shrink-0"
                title={stockScope === "material" ? "Prenesi nabavni katalog PDF" : "Prenesi katalog PDF drobnega inventarja"}
                data-testid={stockScope === "material" ? "button-export-katalog-nabavni" : "button-export-katalog-drobni"}
              >
                <Download className="w-4 h-4 sm:mr-1.5" />
                <span>{katalogPdfLoading ? "Izvažam..." : stockScope === "material" ? "Nabavni katalog PDF" : "Drobni katalog PDF"}</span>
              </Button>
            </div>
            {/* Namig — skrit na mobilnem kjer ni prostora */}
            <p className="hidden sm:block text-sm text-muted-foreground">Kliknite vrstico za kartico artikla</p>
            {/* Dialog za potrditev — portal, lokacija v DOM ni važna */}
            {jeAdmin && (
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
            )}
          </div>
          {!loadingZ && negativneZaloge.length > 0 && (
            <div className="flex min-w-0 items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-red-800 sm:items-center sm:px-4">
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
              <span className="min-w-0 break-words text-sm font-medium">
                {negativneZaloge.length === 1
                  ? "1 artikel ima negativno zalogo"
                  : `${negativneZaloge.length} artiklov ima negativno zalogo`}
                {" — "}
                {negativneZaloge.map(z => z.artikelIme).join(", ")}
              </span>
            </div>
          )}
          <Card className="min-w-0 overflow-hidden">
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
                ) : filteredZaloge.map(z => {
                  const jeKolicinski = jeDrobniInventar(artikli?.find(a => a.id === z.artikelId));
                  return <TableRow
                    key={z.artikelId}
                    className={`cursor-pointer hover:bg-muted/50 ${z.kolicina < 0 ? "bg-red-50 hover:bg-red-100" : ""}`}
                    onClick={() => setKarticeArtikelId(z.artikelId)}
                  >
                    <TableCell className="font-medium">
                      {z.artikelIme}
                      {jeKolicinski && <Badge className="ml-2 border-amber-300 bg-amber-100 text-amber-900">Drobni inventar · količina</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{z.imeZaNabavo ?? "–"}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      <span className={`inline-flex items-center justify-end gap-1 ${z.kolicina < 0 ? "text-red-600" : z.kolicina === 0 ? "text-red-500" : z.kolicina < 5 ? "text-amber-600" : "text-green-700"}`}>
                        {z.kolicina < 0 && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {fmt(z.kolicina, 3)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{displayEslogUnit(z.enotaMere) || "–"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {jeKolicinski ? <span className="text-amber-800">Količinsko</span> : (z.povprecnaCena ?? z.zadnjaCena) != null ? `${fmt((z.povprecnaCena ?? z.zadnjaCena)!, 4)} €` : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm tabular-nums">
                      {jeKolicinski ? <span className="text-amber-800">Brez vrednotenja</span> : z.skupnaVrednost != null ? `${fmt(z.skupnaVrednost)} €` : z.zadnjaCena != null ? `${fmt(z.kolicina * z.zadnjaCena)} €` : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-muted-foreground text-xs">{fmtDatum(z.zadnjaPosodobitev)}</TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
            {!loadingZ && filteredZaloge.length > 0 && stockScope === "material" && (
              <div className="border-t px-4 py-2 flex justify-end text-sm text-muted-foreground">
                Skupaj vrednost zalog:&nbsp;
                <strong className="text-foreground">
                  {fmt(filteredZaloge.reduce((s, z) => s + (jeDrobniInventar(artikli?.find(a => a.id === z.artikelId)) ? 0 : z.skupnaVrednost != null ? z.skupnaVrednost : z.zadnjaCena != null ? z.kolicina * z.zadnjaCena : 0), 0))} €
                </strong>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="pripravljene-jedi" className="mt-4">
          <PreparedStockTab />
        </TabsContent>

        {/* ── Prejemnice ────────────────────────────────────────────── */}
        <TabsContent value="prejemnice" className="space-y-4 mt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="outline" onClick={() => setUvozDialogOpen(true)} className="w-full sm:w-auto">
              <FileUp className="w-4 h-4 mr-2" />Uvozi dobavnico
            </Button>
            <Button size="sm" onClick={openPrejDialog} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />Nova prejemnica
            </Button>
          </div>
          <Card className="min-w-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Številka</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Dobavitelj</TableHead>
                  <TableHead>Opomba</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Postavke</TableHead>
                  <TableHead className="text-right">Vrednost</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingP ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nalaganje...</TableCell></TableRow>
                ) : (prejemnice ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Ni prejemnic</TableCell></TableRow>
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
                    <TableCell>
                      <Badge variant={(p as any).status === "confirmed" ? "default" : "secondary"}>
                        {(p as any).status === "confirmed" ? "Potrjena" : "Osnutek"}
                      </Badge>
                    </TableCell>
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
            <Button size="sm" onClick={openIzdDialog} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />Nova izdajnica
            </Button>
          </div>
          <Card className="min-w-0 overflow-hidden">
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void downloadPdf("popis", "material")} disabled={exportingPdf}>
              <Download className="mr-2 h-4 w-4" />Popisni list – material
            </Button>
            <Button size="sm" variant="outline" onClick={() => void downloadPdf("popis", "drobni")} disabled={exportingPdf}>
              <Download className="mr-2 h-4 w-4" />Popisni list – drobni inventar
            </Button>
            <Button size="sm" onClick={openInvDialog} className="w-full sm:w-auto">
              <ClipboardList className="w-4 h-4 mr-2" />Nova inventura
            </Button>
          </div>
          <Card className="min-w-0 overflow-hidden">
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
                        {inv.documentPath && <Button variant="ghost" size="icon" className="h-7 w-7" title="Prenesi izpolnjen popisni list" aria-label="Prenesi izpolnjen popisni list"
                          onClick={() => void downloadInventorySheet(inv.id)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>}
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              En dokument na leto. Zahtevano pred prvim naročilom v novem letu.
            </p>
            <Button size="sm" onClick={openZzDialog} disabled={letoZzExists(currentYear)} className="w-full shrink-0 sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              {letoZzExists(currentYear) ? `Leto ${currentYear} že vneseno` : `Nova začetna zaloga (${currentYear})`}
            </Button>
          </div>
          <Card className="min-w-0 overflow-hidden">
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

        <TabsContent value="povratna-embalaza" className="mt-4">
          <EmbalazaTab />
        </TabsContent>
      </Tabs>

      {/* ── Kartica dialog ──────────────────────────────────────────── */}
      {karticeArtikelId != null && (
        <KarticaDialog artikelId={karticeArtikelId} onClose={() => setKarticeArtikelId(null)} />
      )}

      {/* ── Izdajnica create dialog ──────────────────────────────────── */}
      <Dialog open={izdDialogOpen} onOpenChange={v => { setIzdDialogOpen(v); if (!v) setIzdDropdownOpenIdx(null); }}>
        <DialogContent
          ref={izdArtDialogRef}
          className="max-w-3xl max-h-[90vh] flex flex-col overflow-visible"
          onEscapeKeyDown={e => { if (izdDropdownOpenIdx !== null) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5" />Nova izdajnica
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
          <div className="space-y-4">
            <Tabs value={izdScope} onValueChange={value => spremeniIzdScope(value as "material" | "drobni")}>
              <TabsList>
                <TabsTrigger value="material">Izdaja materiala</TabsTrigger>
                <TabsTrigger value="drobni">Izdaja drobnega inventarja</TabsTrigger>
              </TabsList>
            </Tabs>
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
                    ? izdScopeArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(izdDropdownFilter.toLowerCase()))
                    : izdScopeArtikli;
                  return (
                    <Fragment key={i}>
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <input
                          ref={el => { if (el) izdArtInputRefs.current.set(i, el); else izdArtInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? izdDropdownFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${displayEslogUnit(selectedArtikel.enotaMere)})` : ""}` : "")}
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
                        <TableHead className="text-right w-24">Knjižno</TableHead>
                        <TableHead className="text-right w-32">Dejansko</TableHead>
                        <TableHead className="text-right w-24">Poraba</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {izdDiffRows.map((row, i) => {
                        const art = nabavniArtikli.find(a => a.id === row.artikelId);
                        const dejansko = parseDecimal(row.dejansko) ?? row.knjizno;
                        const poraba = row.knjizno - dejansko;
                        return (
                          <TableRow key={row.artikelId} className={poraba > 0.0001 ? "bg-orange-50/60" : ""}>
                            <TableCell className="text-sm font-medium py-1.5">
                              {art?.imeZaNabavo || art?.ime}
                              {art?.enotaMere && <span className="text-muted-foreground text-xs ml-1">({displayEslogUnit(art.enotaMere)})</span>}
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
          </div>
          {izdDropdownOpenIdx !== null && izdDropdownPos !== null && (() => {
            const izdF = izdDropdownFilter ? izdScopeArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(izdDropdownFilter.toLowerCase())) : izdScopeArtikli;
            return (
              <div style={{ position: 'absolute', top: izdDropdownPos.top, left: izdDropdownPos.left, width: 240, zIndex: 100 }}
                   className="bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                {izdF.length === 0 ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{izdDropdownFilter ? `Ni zadetkov za „${izdDropdownFilter}"` : "Ni artiklov v šifrantu"}</p>
                    <button className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                      onMouseDown={e => { e.preventDefault(); if (izdDropdownOpenIdx !== null) { setIzdDropdownOpenIdx(null); setIzdNovArtikelRowIdx(izdDropdownOpenIdx); } }}>
                      <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                    </button>
                  </div>
                ) : izdF.map((a, j) => (
                  <div key={a.id}
                    className={`px-3 py-1.5 text-sm cursor-pointer ${j === izdDropdownHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                    onMouseDown={e => { e.preventDefault(); if (izdDropdownOpenIdx !== null) selectIzdArtikelInRow(izdDropdownOpenIdx, a.id); }}>
                    {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}
                  </div>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Prejemnica create dialog ─────────────────────────────────── */}
      <Dialog open={prejDialogOpen} onOpenChange={v => { setPrejDialogOpen(v); if (!v) setDropdownOpenIdx(null); }}>
        <DialogContent
          ref={prejArtDialogRef}
          className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          onEscapeKeyDown={e => { if (prejDobDropdownOpen || dropdownOpenIdx !== null) e.preventDefault(); }}
        >
          <DialogHeader className="shrink-0"><DialogTitle>Nova prejemnica</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto pr-1">
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
                      onDropdownOpenChange={setPrejDobDropdownOpen}
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
                  queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Valuta <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
                <Input value={prejValuta} onChange={e => setPrejValuta(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" />
              </div>
              <div className="space-y-1.5">
                <Label>Rok plačila <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
                <SmartDateInput value={prejDatumZapadlosti} onChange={setPrejDatumZapadlosti} defaultYear={currentYear} />
              </div>
            </div>
            {/* Opomba */}
            <div className="space-y-1.5">
              <Label>Opomba <span className="text-xs text-muted-foreground">(neobvezno)</span></Label>
              <Input ref={prejOpombaRef} value={prejOpomba} onChange={e => setPrejOpomba(e.target.value)} placeholder="Dodatna opomba..."
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (vrstaCen === "neto" ? prejNetoRef : prejBrutoRef).current?.focus(); } }} />
            </div>
             <label className="flex items-center gap-2 text-sm">
               <input type="checkbox" checked={prejPlacanoZGotovino} onChange={e => setPrejPlacanoZGotovino(e.target.checked)} />
               Plačano z gotovino
             </label>
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
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
              Pri drobnem inventarju tukaj vnesite dejansko ceno z računa: prejemnica nakup knjiži med stroške, ne kot vrednost zaloge.
            </p>
            <div className="space-y-2">
                {prejRows.map((row, i) => {
                  const isOpen = dropdownOpenIdx === i;
                  const selectedArtikel = row.artikelId > 0 ? nabavniArtikli.find(a => a.id === row.artikelId) : null;
                  const filtered = dropdownFilter
                    ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(dropdownFilter.toLowerCase()))
                    : nabavniArtikli;
                  return (
                    <Fragment key={i}>
                    <div className={isOpen ? "relative z-10" : "relative"}>
                    <div className="flex gap-2 items-center">
                      {/* Artikel combobox */}
                      <div className="w-56 shrink-0">
                        <input
                          ref={el => { if (el) artInputRefs.current.set(i, el); else artInputRefs.current.delete(i); }}
                          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Izberi artikel"
                          value={isOpen ? dropdownFilter : (selectedArtikel ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${displayEslogUnit(selectedArtikel.enotaMere)})` : ""}${jeDrobniInventar(selectedArtikel) ? " · Drobni inventar — nabavni strošek" : ""}` : "")}
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
                            = {fmt(parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1))} {displayEslogUnit(nabavniArtikli.find(a => a.id === row.artikelId)?.enotaMere) || "enot"}
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
                            if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "cena", "right"); }
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
                      {/* Popust % */}
                      <div className="flex flex-col items-end gap-0.5">
                        <DecimalInput
                          ref={el => { if (el) popustInputRefs.current.set(i, el); else popustInputRefs.current.delete(i); }}
                          value={row.popust}
                          placeholder="Popust %"
                          onChange={e => updatePrejRow(i, "popust", e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); addBtnRef.current?.focus(); }
                            else if (e.key === "ArrowRight") { e.preventDefault(); navPrej(i, "popust", "right"); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); navPrej(i, "popust", "left"); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); navPrej(i, "popust", "up"); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); navPrej(i, "popust", "down"); }
                          }}
                          className="w-20" />
                        {parseDecimal(row.popust) > 0 && (
                          <span className="text-xs text-muted-foreground">%</span>
                        )}
                      </div>
                      <DecimalInput
                        value={row.ddvStopnja}
                        placeholder="DDV %"
                        onChange={e => updatePrejRow(i, "ddvStopnja", e.target.value)}
                        className="w-20"
                      />
                      {/* Preračunana cena po popustu (readonly) */}
                      {(() => {
                        const enot = parseDecimal(row.enotVPaketu) || 1;
                        const vnos = parseDecimal(row.cenaKos) || 0;
                        const popustF = 1 - (parseDecimal(row.popust) || 0) / 100;
                        const cenaNaEnoto = (enot > 1 ? vnos / enot : vnos) * popustF;
                        const davek = efektivnaDdvStopnja(
                          row.ddvStopnja,
                          nabavniArtikli.find(a => a.id === row.artikelId)?.davek ?? 0,
                        );
                        const shranjeno = konvertirajCeno(cenaNaEnoto, davek, vrstaCen, jeDdvZavezanec);
                        return (
                          <input
                            readOnly
                            tabIndex={-1}
                            value={vnos ? fmt(shranjeno, 4) : ""}
                            placeholder={jeDdvZavezanec ? "Neto" : "Bruto"}
                            title={jeDdvZavezanec ? "Cena/enoto, ki se shrani (brez DDV)" : "Cena/enoto, ki se shrani (z DDV)"}
                            className="w-28 border rounded-md px-2 py-2 text-sm bg-muted text-muted-foreground text-right cursor-default select-none"
                          />
                        );
                      })()}

                      <AlergeniRowPopover
                        row={row}
                        companyId={user?.companyId}
                        open={prejAlergeniOpenIdx === i}
                        onOpenChange={open => setPrejAlergeniOpenIdx(open ? i : null)}
                        onUpdate={(snap) => {
                          updatePrejRow(i, "alergeni", snap.alergeni);
                          updatePrejRow(i, "alergeniSledi", snap.alergeniSledi);
                          updatePrejRow(i, "alergeniStatus", snap.alergeniStatus);
                          updatePrejRow(i, "alergeniVir", snap.alergeniVir);
                          updatePrejRow(i, "alergeniOpombaVira", snap.alergeniOpombaVira);
                          updatePrejRow(i, "alergeniDocumentId", snap.alergeniDocumentId);
                        }}
                      />

                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePrejRow(i)} disabled={prejRows.length === 1}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    </div>
                    <IzvornaPostavkaPolja
                      row={row}
                      target={selectedArtikel}
                      error={prejSourceErrors[i]}
                      id={`new-${i}`}
                      onChange={(field, value) => updatePrejRow(i, field, value)}
                    />
                    <MassYieldFields
                      key={`new-mass-${i}`}
                      value={massYieldZaPrejemnico(row, selectedArtikel)}
                      onChange={next => {
                        const current = massYieldZaPrejemnico(row, selectedArtikel);
                        if (next.brutoTezaG !== current.brutoTezaG) {
                          updatePrejRow(i, "brutoTezaG", next.brutoTezaG);
                          updatePrejRow(i, "brutoTezaGTouched", true);
                        }
                        if (next.netoTezaG !== current.netoTezaG) {
                          updatePrejRow(i, "netoTezaG", next.netoTezaG);
                          updatePrejRow(i, "netoTezaGTouched", true);
                        }
                        if (next.netoDelezOdst !== current.netoDelezOdst) {
                          updatePrejRow(i, "netoDelezOdst", next.netoDelezOdst);
                          updatePrejRow(i, "netoDelezOdstTouched", true);
                        }
                      }}
                      sourceUnit={row.izvEnota ?? ""}
                      baseUnit={selectedArtikel?.enotaMere}
                      quantity={izracunajIzvornoKolicinoZaloge(row, selectedArtikel?.enotaMere, selectedArtikel)
                        ?? parseDecimal(row.kolicina) * (parseDecimal(row.enotVPaketu) || 1)}
                      lineValue={izracunajVrednostPostavke(row)}
                      priceMode={vrstaCen}
                      taxRate={efektivnaDdvStopnja(row.ddvStopnja, selectedArtikel?.davek ?? 0)}
                      buyerVatRegistered={jeDdvZavezanec}
                      autoOpen={["kg", "kgm"].includes(selectedArtikel?.enotaMere?.trim().toLowerCase() ?? "")}
                      purchaseQuantity={row.izvKolicina ?? ""}
                      onPurchaseQuantityChange={value => updatePrejRow(i, "izvKolicina", value)}
                      onPurchaseUnitChange={value => updatePrejRow(i, "izvEnota", value)}
                    />
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
                variant="outline"
                size="sm"
                className="focus:bg-primary focus:text-primary-foreground focus:border-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
                onClick={addPrejRow}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPrejRow(); } }}>
                <Plus className="w-4 h-4 mr-1" />Dodaj postavko
              </Button>
              <OdvisniStroskiEditor value={prejOdvisniStroski} onChange={setPrejOdvisniStroski} />
              {prejRows.some(r => (r.kolicina || r.izvKolicina) && r.cenaKos) && (() => {
                const totals = prejRows.reduce((acc, r) => {
                  const article = nabavniArtikli.find(a => a.id === r.artikelId);
                  const receipt = preračunajPrejemnico(r, article, vrstaCen, jeDdvZavezanec);
                  const neto = jeDdvZavezanec
                    ? receipt.shranjenaCena
                    : (receipt.ddvStopnja ? receipt.shranjenaCena / (1 + receipt.ddvStopnja / 100) : receipt.shranjenaCena);
                  const bruto = jeDdvZavezanec
                    ? (receipt.ddvStopnja ? receipt.shranjenaCena * (1 + receipt.ddvStopnja / 100) : receipt.shranjenaCena)
                    : receipt.shranjenaCena;
                  return {
                    neto: acc.neto + receipt.kolicina * neto,
                    bruto: acc.bruto + receipt.kolicina * bruto,
                  };
                }, { neto: 0, bruto: 0 });
                return (
                  <div className="text-sm text-muted-foreground text-right space-y-0.5">
                    <div>Skupaj brez DDV: <strong className="text-foreground">{fmt(totals.neto)} €</strong></div>
                    <div>Skupaj z DDV: <strong className="text-foreground">{fmt(totals.bruto)} €</strong></div>
                  </div>
                );
              })()}
            </div>
          </div>
          </div>
          <div className="shrink-0 pt-3 border-t">
            <Button className="w-full" onClick={handleSavePrejemnica} disabled={createPrejemnica.isPending}>
              {createPrejemnica.isPending ? "Shranjujem..." : <>Shrani prejemnico <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
          {dropdownOpenIdx !== null && artDropdownPos !== null && (() => {
            const artF = dropdownFilter ? nabavniArtikli.filter(a => (a.imeZaNabavo || a.ime).toLowerCase().includes(dropdownFilter.toLowerCase())) : nabavniArtikli;
            return (
              <div style={{ position: 'absolute', top: artDropdownPos.top, left: artDropdownPos.left, width: 192, zIndex: 100 }}
                   className="bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                {artF.length === 0 ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{dropdownFilter ? `Ni zadetkov za „${dropdownFilter}"` : "Ni artiklov v šifrantu"}</p>
                    <button
                      ref={el => { if (el) novArtBtnRefs.current.set(dropdownOpenIdx, el); else novArtBtnRefs.current.delete(dropdownOpenIdx); }}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setDropdownOpenIdx(null); setNovArtikelRowIdx(dropdownOpenIdx); } }}
                      onMouseDown={e => { e.preventDefault(); setDropdownOpenIdx(null); setNovArtikelRowIdx(dropdownOpenIdx); }}
                    >
                      <Plus className="w-3.5 h-3.5" />Nov artikel v šifrant
                    </button>
                  </div>
                ) : artF.map((a, j) => (
                  <div key={a.id}
                    className={`px-3 py-1.5 text-sm cursor-pointer ${j === dropdownHighlight ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                    onMouseDown={e => { e.preventDefault(); selectArtikelInRow(dropdownOpenIdx, a.id); }}>
                    {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}{jeDrobniInventar(a) ? " · Drobni inventar (nakup = strošek)" : ""}
                  </div>
                ))}
              </div>
            );
          })()}
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

      {/* ── Uvoz dobavnice dialog ─────────────────────────────────────── */}
      <UvozPrejemniceDialog
        open={uvozDialogOpen}
        onClose={() => setUvozDialogOpen(false)}
        onUvozDone={() => {
          // refetchQueries garantira takojšen refresh (ne le označi za stale)
          void queryClient.refetchQueries({ queryKey: getListZalogeQueryKey() });
          void queryClient.refetchQueries({ queryKey: getListPrejemniceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
          // Invalidiramo artikle, ker so morda bili ustvarjeni novi med uparjanjem
          queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          // Preklopi na tab "Prejemnice" — na mobilnem zaslonu se sicer ne osvežijo
          setActiveTab("prejemnice");
        }}
        onOdpriPrejemnico={(id) => {
          setUvozDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListPrejemniceQueryKey() });
          setEditPrejId(id);
        }}
        nabavniArtikli={nabavniArtikli}
        dobaviteljiMap={dobaviteljiMap}
        jeDdvZavezanec={jeDdvZavezanec}
      />

      {/* ── Prejemnica edit dialog ────────────────────────────────────── */}
      {editPrejId != null && (
        <EditPrejemnicaDialog
          id={editPrejId}
          nabavniArtikli={nabavniArtikli}
          zaloge={zaloge}
          jeDdvZavezanec={jeDdvZavezanec}
          companyId={user?.companyId}
          onClose={() => setEditPrejId(null)}
          onSaved={() => {
            const savedId = editPrejId;
            setEditPrejId(null);
            queryClient.resetQueries({ queryKey: getGetPrejemnicaQueryKey(savedId) });
            void queryClient.refetchQueries({ queryKey: getListZalogeQueryKey() });
            void queryClient.refetchQueries({ queryKey: getListPrejemniceQueryKey() });
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadPdf("popis", invScope)}
                  disabled={exportingPdf}
                >
                  <Download className="mr-2 h-4 w-4" /> PDF popisnega lista
                </Button>
              </div>
              <div className="rounded-md border p-3 space-y-2 text-sm">
                <Label htmlFor="inventura-ocr-file" className="cursor-pointer inline-flex items-center gap-2">
                  {invOcrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  {invOcrLoading ? "Berem popisni list …" : "Naloži izpolnjen popisni list (PDF, JPG, PNG)"}
                </Label>
                <Input id="inventura-ocr-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  disabled={invOcrLoading || createInventura.isPending}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void importInventorySheet(file);
                    event.target.value = "";
                  }} />
                <p className="text-muted-foreground">OCR predlaga količine in ročno vpisane nabavne cene. Pred potrditvijo preglejte vse vrednosti; neprepoznane postavke ostanejo prazne.</p>
                {invOcrResult && (
                  <div role="status" className="space-y-1">
                    <p>Prepoznane postavke: {invOcrResult.rows.length}. Nejasne vrstice: {invOcrResult.unmatched.length}.</p>
                    {invOcrResult.unmatched.length > 0 && <p className="text-amber-700">Ročno preverite: {invOcrResult.unmatched.join(", ")}</p>}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center rounded-md border overflow-hidden text-xs font-medium">
                  <button type="button" onClick={() => setInvScope("material")} className={`px-3 py-1.5 transition-colors ${invScope === "material" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                    Material
                  </button>
                  <button type="button" onClick={() => setInvScope("drobni")} className={`px-3 py-1.5 transition-colors ${invScope === "drobni" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                    Drobni inventar
                  </button>
                </div>
                {invScope === "material" && (
                  <div className="flex items-center rounded-md border overflow-hidden text-xs font-medium">
                    <button type="button" onClick={() => setInvFilter("normativi")} className={`px-3 py-1.5 transition-colors ${invFilter === "normativi" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                      Samo normativni
                    </button>
                    <button type="button" onClick={() => setInvFilter("vsi")} className={`px-3 py-1.5 transition-colors ${invFilter === "vsi" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                      Vsi materiali
                    </button>
                  </div>
                )}
                <Input value={invSearch} onChange={event => setInvSearch(event.target.value)} placeholder="Iskanje artiklov..." className="max-w-xs" />
              </div>
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Nabavna cena</TableHead>
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
                    {invRowsVisible.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Ni artiklov za prikaz</TableCell></TableRow>
                    ) : null}
                    {invRowsVisible.map(row => {
                      const rowIndex = invRows.findIndex(candidate => candidate.artikelId === row.artikelId);
                      const visibleIndex = invRowsVisible.findIndex(candidate => candidate.artikelId === row.artikelId);
                      const art = nabavniArtikli.find(a => a.id === row.artikelId);
                      const zalogaInfo = zaloge?.find(z => z.artikelId === row.artikelId);
                      const jeKolicinski = jeDrobniInventar(art);
                      const cena = jeKolicinski ? null : zalogaInfo?.zadnjaCena ?? null;
                      const knjizno = Number(zalogaInfo?.kolicina ?? 0);
                      const dejansko = parseDecimal(row.steviloNajdeno) || 0;
                      const razlikaKol = dejansko - knjizno;
                      const knj = cena != null ? knjizno * cena : null;
                      const dej = cena != null ? dejansko * cena : null;
                      const razlikaVrednost = cena != null ? razlikaKol * cena : null;
                      return (
                        <TableRow key={row.artikelId}>
                          <TableCell className="font-medium text-sm whitespace-nowrap">
                             {art?.imeZaNabavo || art?.ime} <span className="text-muted-foreground">({displayEslogUnit(art?.enotaMere) || "–"})</span>
                             {jeKolicinski && <Badge className="ml-2 border-amber-300 bg-amber-100 text-amber-900">Drobni inventar · količina</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            {jeKolicinski ? <span className="text-muted-foreground">–</span> : <DecimalInput value={row.cenaKos}
                              aria-label={`Nabavna cena ${art?.imeZaNabavo || art?.ime || row.artikelId}`}
                              onChange={e => {
                                setInvEditedPrices(previous => new Set(previous).add(row.artikelId));
                                setInvRows(previous => previous.map((item, index) => index === rowIndex ? { ...item, cenaKos: e.target.value } : item));
                              }}
                              className="w-24 text-right ml-auto h-8" />}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(knjizno, 3)}</TableCell>
                          <TableCell className="text-right">
                            <DecimalInput value={row.steviloNajdeno}
                              ref={el => { if (el) invNajdenoRefs.current.set(rowIndex, el as any); else invNajdenoRefs.current.delete(rowIndex); }}
                              onChange={e => updateInvRow(rowIndex, e.target.value)}
                              onKeyDown={e => {
                                const moveBy = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                                if (moveBy) {
                                  e.preventDefault();
                                  const next = invRowsVisible[visibleIndex + moveBy];
                                  const nextIndex = next ? invRows.findIndex(candidate => candidate.artikelId === next.artikelId) : -1;
                                  const el = invNajdenoRefs.current.get(nextIndex);
                                  if (el) { el.focus(); el.select(); }
                                }
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
            <Button className="w-full" onClick={handleSaveInventura} disabled={createInventura.isPending || invOcrLoading}>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-3 sm:p-6 gap-3 sm:gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="w-5 h-5" />Začetne zaloge
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4">
            <Tabs value={zzScope} onValueChange={value => setZzScope(value as "material" | "drobni")}>
              <TabsList>
                <TabsTrigger value="material" data-testid="tab-zz-material">Material</TabsTrigger>
                <TabsTrigger value="drobni" data-testid="tab-zz-drobni">Drobni inventar</TabsTrigger>
              </TabsList>
            </Tabs>
            {zzScope === "drobni" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <strong>Drobni inventar se vodi samo količinsko.</strong> Začetna zaloga ima ceno 0 € in ne ustvari GL knjižbe.
                Dejanski nakup se na prejemnici še vedno vnese po dobaviteljevi ceni in knjiži med stroške.
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-1 sm:space-y-2">
                <Label>Leto</Label>
                <Input type="number" value={zzLeto} onChange={e => {
                  const leto = parseInt(e.target.value) || currentYear;
                  setZzLeto(leto);
                  setZzDatum(`${leto}-01-01`);
                }}
                  min={2000} max={2100} onKeyDown={handleEnterAsTab} className="h-10 sm:h-9" />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <Label>Datum</Label>
                <SmartDateInput value={zzDatum} onChange={setZzDatum} defaultYear={currentYear} onKeyDown={handleEnterAsTab as (e: React.KeyboardEvent<HTMLInputElement>) => void} className="h-10 sm:h-9" />
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1 sm:space-y-2">
                <Label>Opomba</Label>
                <Input value={zzOpomba} onChange={e => setZzOpomba(e.target.value)} placeholder="Opomba..." onKeyDown={handleEnterAsTab} className="h-10 sm:h-9" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Artikli</Label>
              <div className="space-y-2 sm:space-y-0 sm:border sm:rounded-md sm:bg-background">
                <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_6rem_2.5rem] gap-2 px-3 py-2 bg-muted/50 rounded-t-md text-sm font-medium text-muted-foreground border-b">
                  <div>Artikel</div>
                  <div className="text-right">Količina</div>
                  <div className="text-right">Cena/enoto</div>
                  <div className="text-right">Vrednost (€)</div>
                  <div></div>
                </div>
                <div className="space-y-2 sm:space-y-0">
                  {zzRows.map((row, i) => {
                    const artikelKolicinski = jeDrobniInventar(nabavniArtikli.find(a => a.id === row.artikelId));
                    if (row.artikelId > 0 && artikelKolicinski !== (zzScope === "drobni")) return null;
                    const vrednost = artikelKolicinski ? 0 : (parseDecimal(row.kolicina) || 0) * (parseDecimal(row.cenaKos) || 0);
                    return (
                      <div key={i} className="flex flex-col sm:grid sm:grid-cols-[1fr_7rem_7rem_6rem_2.5rem] gap-2 sm:gap-2 items-start sm:items-center bg-card border sm:border-transparent sm:border-b sm:last:border-b-transparent rounded-md sm:rounded-none p-2 sm:p-2 sm:px-3 shadow-sm sm:shadow-none">

                        <div className="w-full flex items-end gap-2 sm:contents">
                          <div className="flex-1">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Artikel</div>
                            <select className="w-full border rounded-md px-2 text-base sm:text-sm bg-background h-9 sm:h-8 focus:ring-2 focus:ring-primary focus:outline-none"
                              value={row.artikelId}
                               onChange={e => {
                                 const artikelId = parseInt(e.target.value);
                                 setZzRows(current => current.map((item, index) => index === i
                                   ? { ...item, artikelId, ...(jeDrobniInventar(nabavniArtikli.find(a => a.id === artikelId)) ? { cenaKos: "0" } : {}) }
                                   : item));
                               }}>
                              {nabavniArtikli.filter(a => jeDrobniInventar(a) === (zzScope === "drobni")).map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.imeZaNabavo || a.ime}{a.enotaMere ? ` (${displayEslogUnit(a.enotaMere)})` : ""}{jeDrobniInventar(a) ? " · Drobni inventar" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:hidden shrink-0">
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeZzRow(i)} disabled={zzRows.length === 1}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="w-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:contents">
                          <div className="w-full">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Količina</div>
                            <DecimalInput value={row.kolicina}
                              ref={el => { if (el) zzKoliRefs.current.set(i, el as any); else zzKoliRefs.current.delete(i); }}
                              onChange={e => updateZzRow(i, "kolicina", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzCenaRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzKoliRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="w-full text-right h-9 sm:h-8 text-base sm:text-sm" />
                          </div>

                          <div className="w-full">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Cena/enoto</div>
                            {artikelKolicinski ? (
                              <div className="flex h-9 items-center justify-end text-right text-xs font-medium text-amber-800 sm:h-8">
                                Samo količina · 0 €
                              </div>
                            ) : <DecimalInput value={row.cenaKos}
                              ref={el => { if (el) zzCenaRefs.current.set(i, el as any); else zzCenaRefs.current.delete(i); }}
                              onChange={e => updateZzRow(i, "cenaKos", e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); const el = zzKoliRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowLeft") { e.preventDefault(); const el = zzKoliRefs.current.get(i); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowUp") { e.preventDefault(); const el = zzCenaRefs.current.get(i - 1); if (el) { el.focus(); el.select(); } }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const el = zzCenaRefs.current.get(i + 1); if (el) { el.focus(); el.select(); } }
                              }}
                              className="w-full text-right h-9 sm:h-8 text-base sm:text-sm" />}
                          </div>

                          <div className="sm:contents">
                            <div className="text-[10px] font-medium text-muted-foreground sm:hidden mb-0.5">Vrednost</div>
                            <div className="h-9 flex items-center justify-end text-right tabular-nums text-sm font-semibold text-primary sm:h-auto sm:text-sm sm:font-medium sm:text-foreground">
                              {vrednost > 0 ? `${fmt(vrednost)} €` : <span className="text-muted-foreground">–</span>}
                            </div>
                          </div>
                        </div>

                        <div className="hidden sm:flex justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => removeZzRow(i)} disabled={zzRows.length === 1}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>

                      </div>
                    );
                  })}
                </div>
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
