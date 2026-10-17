/**
 * amortizacijski-obracun.tsx — Amortizacijski obračun OS (Faza 3c, 1. del)
 *
 * Samo prikaz in izvoz — NE knjiži v glavno knjigo.
 *
 * Pogled:
 *   - Izbira leta obračuna (privzeto 2024)
 *   - Povzetki: skupna amortizacija (računovodska/davčna), brez skupine, polno odpisanih
 *   - Tabela po sredstvih z razširljivimi doknjižbami
 *   - Tabs: Sredstva / Po kontih / Po STM
 *   - Filtri: skupinaId, accountCode, costCenterCode, status, brezSkupine
 *   - Izvoz CSV
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Download,
  BarChart3,
  TrendingDown,
  CheckCircle2,
  Building2,
  Search,
  X,
  FileText,
  PlayCircle,
  BookOpen,
  Info,
  Trash2,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetOsAmortizacija,
  useGetOsAmortizacijaNastavitve,
  useGetOsAmortizacijaObracuni,
  useOsAmortizacijaIzpis,
  usePostOsAmortizacijaObracun,
  usePostOsAmortizacijaStorno,
  usePutOsAmortizacijaOslabitev,
  osAmortizacijaQueryKey,
  osAmortizacijaNastavitveQueryKey,
  osRegisterMedletniQueryKey,
  osnovnaSredstvaQueryKey,
  type SredstvoAmortResult,
  type DoknjizbaAmortResult,
  type ObracunGlavaInfo,
} from "@workspace/api-client-react";
import { AmortizacijaKnjizenjDialog } from "@/components/os/AmortizacijaKnjizenjDialog";
import { AmortizacijaArhiv } from "@/components/os/AmortizacijaArhiv";
import { SavedAmortizationExports } from "@/components/os/SavedAmortizationExports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Printer } from "lucide-react";
import { formatDatum } from "@/lib/utils";

// ─── Pomožniki ────────────────────────────────────────────────────────────────

function fmtEur(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return n.toLocaleString("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(val: string | null | undefined): string {
  if (!val) return "—";
  // sl-SI: vejica kot decimalno ločilo (2,5 % — ne "2.500 %" ki v slovenščini pomeni 2500 %)
  return parseFloat(val).toLocaleString("sl-SI", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }) + " %";
}

const STATUS_LABELS: Record<string, string> = {
  v_teku: "V teku",
  v_uporabi: "V uporabi",
  odpisano: "Odpisano",
  izloceno: "Izločeno",
};

// ─── Opomba na doknjižbi ──────────────────────────────────────────────────────

function DoknjizbaOpomba({ opomba }: { opomba: DoknjizbaAmortResult["opomba"] }) {
  if (!opomba) return null;
  const map: Record<string, { label: string; color: string }> = {
    brez_aktivacije: { label: "Brez aktivacije", color: "bg-gray-100 text-gray-600" },
    polno_odpisano:  { label: "Polno odpisano",  color: "bg-blue-50 text-blue-700" },
    brez_skupine:    { label: "Brez skupine",    color: "bg-amber-50 text-amber-700" },
  };
  const m = map[opomba] ?? { label: opomba, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${m.color}`}>
      {m.label}
    </span>
  );
}

// ─── Razširljiva vrstica doknjižbe ────────────────────────────────────────────

function DoknjizbaRow({ d }: { d: DoknjizbaAmortResult }) {
  const hasAmort = parseFloat(d.obracunanaRacunovodska) > 0;
  return (
    <TableRow className={`bg-muted/30 text-xs ${!hasAmort ? "opacity-60" : ""}`}>
      <TableCell className="pl-8 py-1 text-muted-foreground">
        seq {d.seq} {d.datumAktivacije ? `· akt. ${formatDatum(d.datumAktivacije)}` : "· ni akt."}
        {d.datumIzpisa ? ` · izp. ${formatDatum(d.datumIzpisa)}` : ""}
      </TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtEur(d.nabavnaVrednost)}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtEur(d.osnova)}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtEur(d.preostalo)}</TableCell>
      <TableCell className="px-2 py-1 text-center">
        {d.stMesecev > 0 ? `${d.stMesecev} m` : "—"}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono tabular-nums">
        {hasAmort ? fmtEur(d.obracunanaRacunovodska) : <DoknjizbaOpomba opomba={d.opomba} />}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono tabular-nums">
        {parseFloat(d.obracunanaDavcna) > 0 ? fmtEur(d.obracunanaDavcna) : "—"}
      </TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">
        {fmtEur(d.sedanjaVrednostPoObracunu)}
      </TableCell>
    </TableRow>
  );
}

// ─── Celica za vnos oslabitve (samo na zakljucenem letnem obračunu) ───────────

// Opisi metod za tooltip in prikaz
const METODA_SHORT: Record<number, string> = { 1: "M1", 2: "M2" };

/** Live predogled nove letne AM in stopnje — čisto strežniška zaokroženost, aproks. za UI */
function calcPreviewNovaLetnaAm(
  s: SredstvoAmortResult,
  oslabitevInput: number,
  metoda: 1 | 2,
  novaDobaInput: number,
  leto: number,
): { novaKnjizna: number; preostalaDoba: number; novaLetnaAm: number; novaStopnja: number } | null {
  const sedanja = parseFloat(s.sedanjaVrednostPoObracunu ?? "0");
  const stonja = parseFloat(s.racunovodskaStonja ?? "0");
  if (stonja <= 0 || isNaN(sedanja) || isNaN(oslabitevInput) || oslabitevInput < 0) return null;

  const novaKnjizna = Math.max(0, sedanja - oslabitevInput);
  if (novaKnjizna <= 0) return { novaKnjizna: 0, preostalaDoba: 0, novaLetnaAm: 0, novaStopnja: 0 };

  const skupnaOsnova = parseFloat(s.skupnaOsnova ?? "0");
  let preostalaDoba: number;
  if (metoda === 2 && novaDobaInput >= 1) {
    preostalaDoba = Math.round(novaDobaInput);
  } else {
    // M1: celotna doba − pretečena
    const celotna = 100 / stonja;
    const pretecena = s.activationYear != null ? leto - s.activationYear + 1 : 0;
    preostalaDoba = Math.max(1, Math.round(celotna - pretecena));
  }
  const novaLetnaAm = novaKnjizna / preostalaDoba;
  const novaStopnja = skupnaOsnova > 0 ? (novaLetnaAm / skupnaOsnova) * 100 : 0;
  return { novaKnjizna, preostalaDoba, novaLetnaAm, novaStopnja };
}

function OslabitevCell({
  s,
  obracunZakljucen,
  leto,
  onSaved,
}: {
  s: SredstvoAmortResult;
  obracunZakljucen: boolean;
  leto: number;
  onSaved: (sredstvoId: string, oslabitev: string) => void;
}) {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [metoda, setMetoda] = useState<1 | 2>(1);
  const [novaDobaStr, setNovaDobaStr] = useState(""); // M2: nova preostala doba (leta)
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const putMut = usePutOsAmortizacijaOslabitev(companyId);

  const storedVal = s.savedOslabitev ?? "0.00";
  const storedMetoda: 1 | 2 = (s.savedMetodaOslabitve === 2 ? 2 : 1);
  const hasOslabitev = parseFloat(storedVal) > 0;

  // Live predogled med urejanjem
  const oslabitevNum = parseFloat(value.replace(",", "."));
  const novaDobaNum = parseFloat(novaDobaStr);
  const preview = editing && !isNaN(oslabitevNum) && oslabitevNum > 0
    ? calcPreviewNovaLetnaAm(s, oslabitevNum, metoda, isNaN(novaDobaNum) ? 1 : novaDobaNum, leto)
    : null;

  if (!obracunZakljucen) {
    // Na odprtem / predogledu: prikaz oslabitve iz prev leta + nova letna AM (ko velja)
    const applied = parseFloat(s.skupnaOslabitev ?? "0");
    const novaAm = s.novaLetnaAmPoOslabitvi ? parseFloat(s.novaLetnaAmPoOslabitvi) : 0;
    return (
      <TableCell className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
        {applied > 0 ? (
          <span className="text-orange-600 font-mono">
            {fmtEur(s.skupnaOslabitev)}
            {novaAm > 0 && (
              <span className="block text-xs opacity-60" title={`Nova letna AM: ${fmtEur(s.novaLetnaAmPoOslabitvi!)}/leto, stopnja: ${fmtPct(s.novaStopnjaPoOslabitvi!)}`}>
                AM: {fmtEur(s.novaLetnaAmPoOslabitvi!)}
              </span>
            )}
          </span>
        ) : "—"}
      </TableCell>
    );
  }

  if (!editing) {
    const savedAm = s.savedNovaLetnaAmRac ? parseFloat(s.savedNovaLetnaAmRac) : 0;
    return (
      <TableCell
        className="px-2 py-1.5 text-right tabular-nums cursor-pointer group"
        onClick={(e) => {
          e.stopPropagation();
          setValue(hasOslabitev ? storedVal : "");
          setMetoda(storedMetoda);
          setSaveError(null);
          setEditing(true);
        }}
        title={hasOslabitev
          ? `Oslabitev: ${storedVal} € (${METODA_SHORT[storedMetoda]}) — klikni za urejanje`
          : "Klikni za vnos oslabitve vrednosti OS za to leto"}
      >
        {hasOslabitev ? (
          <span className="font-mono text-orange-600 group-hover:underline">
            {fmtEur(storedVal)}{" "}
            <span className="text-xs opacity-70">({METODA_SHORT[storedMetoda]})</span>
            {savedAm > 0 && (
              <span className="block text-xs text-orange-500/80" title={`Nova letna AM: ${fmtEur(s.savedNovaLetnaAmRac!)}/leto`}>
                → {fmtEur(s.savedNovaLetnaAmRac!)}/leto
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground/50 group-hover:text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const numVal = parseFloat(value.replace(",", "."));
    if (isNaN(numVal) || numVal < 0) {
      setSaveError("Vnesite nenegativen znesek");
      return;
    }
    if (metoda === 2) {
      const db = parseFloat(novaDobaStr);
      if (isNaN(db) || db < 1 || !Number.isFinite(db)) {
        setSaveError("Vnesite novo preostalo dobo (min 1 leto)");
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    try {
      await putMut.mutateAsync({
        leto,
        sredstvoId: s.id,
        oslabitev: numVal.toFixed(2),
        metodaOslabitve: metoda,
        novaDoba: metoda === 2 ? Math.round(parseFloat(novaDobaStr)) : undefined,
      });
      onSaved(s.id, numVal.toFixed(2));
      setEditing(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Napaka pri shranjevanju");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableCell className="px-1 py-1 min-w-[240px]" onClick={(e) => e.stopPropagation()}>
      <form onSubmit={handleSave} className="space-y-1">
        {/* Znesek + gumbi */}
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-6 w-24 text-right text-xs font-mono px-1"
            placeholder="0.00"
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <Button type="submit" size="icon" className="h-6 w-6" disabled={saving} variant="default">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-xs">✓</span>}
          </Button>
          <Button type="button" size="icon" className="h-6 w-6" variant="ghost" onClick={() => setEditing(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
        {/* Izbira metode */}
        <div className="flex flex-col gap-0.5 text-xs">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`metoda-${s.id}`}
              value="1"
              checked={metoda === 1}
              onChange={() => setMetoda(1)}
              className="accent-primary"
            />
            <span title="Nova letna AM = nova knjižna / (celotna doba − pretečena)">
              M1 — preostala doba iz stopnje
            </span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`metoda-${s.id}`}
              value="2"
              checked={metoda === 2}
              onChange={() => setMetoda(2)}
              className="accent-primary"
            />
            <span title="Nova letna AM = nova knjižna / nova preostala doba (ki jo vnesete)">
              M2 — nova preostala doba (let)
            </span>
          </label>
        </div>
        {/* M2: vnos nove dobe */}
        {metoda === 2 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Nova doba:</span>
            <Input
              type="number"
              min={1}
              step={1}
              value={novaDobaStr}
              onChange={(e) => setNovaDobaStr(e.target.value)}
              className="h-5 w-14 text-right text-xs font-mono px-1"
              placeholder="let"
            />
            <span className="text-muted-foreground">let</span>
          </div>
        )}
        {/* Live predogled */}
        {preview && preview.novaLetnaAm > 0 && (
          <div className="text-xs text-muted-foreground border-t pt-1 mt-0.5 space-y-0.5">
            <div>Nova knjižna: <span className="font-mono">{fmtEur(preview.novaKnjizna.toFixed(2))}</span></div>
            <div>Preostala doba: <span className="font-mono">{preview.preostalaDoba} let</span></div>
            <div className="font-medium text-orange-600">
              Nova letna AM: {fmtEur(preview.novaLetnaAm.toFixed(2))}/leto
              {" · "}{preview.novaStopnja.toFixed(2)} %
            </div>
          </div>
        )}
        {preview && preview.novaLetnaAm === 0 && oslabitevNum > 0 && (
          <div className="text-xs text-muted-foreground border-t pt-1 mt-0.5">
            <span className="text-amber-600">Oslabitev ≥ preostale knjižne vrednosti → NV = 0.</span>
          </div>
        )}
      </form>
      {saveError && <p className="text-red-600 text-xs mt-0.5 truncate">{saveError}</p>}
    </TableCell>
  );
}

// ─── Vrstica sredstva (razširljiva) ──────────────────────────────────────────

function SredstvoRow({
  s,
  expanded,
  onToggle,
  obracunZakljucen,
  leto,
  onOslabitevSaved,
}: {
  s: SredstvoAmortResult;
  expanded: boolean;
  onToggle: () => void;
  obracunZakljucen: boolean;
  leto: number;
  onOslabitevSaved: (sredstvoId: string, oslabitev: string) => void;
}) {
  const hasAmort = parseFloat(s.skupnaObracunanaRacunovodska) > 0;
  const isWarning = s.brezSkupine;

  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-muted/50 ${isWarning ? "bg-amber-50/40" : ""}`}
        onClick={onToggle}
      >
        <TableCell className="px-1 py-1.5 w-6">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="px-2 py-1.5 font-mono">{s.inventarnaSt}</TableCell>
        <TableCell className="px-2 py-1.5 truncate overflow-hidden whitespace-nowrap" title={s.naziv}>
          {s.naziv}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-muted-foreground">
          {s.skupinaKoda ? (
            <span title={s.skupinaNaziv ?? ""}>{s.skupinaKoda}</span>
          ) : (
            <span className="text-amber-600 flex items-center gap-0.5">
              <AlertTriangle className="h-3 w-3" />
              <span className="text-xs">Brez</span>
            </span>
          )}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">
          {fmtEur(s.skupnaOsnova)}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">
          {fmtEur(s.skupnaPreostalo)}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-center text-muted-foreground">
          {s.racunovodskaStonja ? fmtPct(s.racunovodskaStonja) : "—"}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-right font-semibold font-mono tabular-nums">
          {hasAmort ? (
            fmtEur(s.skupnaObracunanaRacunovodska)
          ) : (
            <span className="text-muted-foreground font-normal">
              {isWarning ? (
                <span className="text-amber-600">Brez sk.</span>
              ) : (
                "—"
              )}
            </span>
          )}
        </TableCell>
        <TableCell className="px-2 py-1.5 text-right font-mono text-muted-foreground tabular-nums">
          {parseFloat(s.skupnaObracunanaDavcna) > 0
            ? fmtEur(s.skupnaObracunanaDavcna)
            : "—"}
        </TableCell>
        <OslabitevCell
          s={s}
          obracunZakljucen={obracunZakljucen}
          leto={leto}
          onSaved={onOslabitevSaved}
        />
        <TableCell className="px-2 py-1.5 text-right tabular-nums">
          {fmtEur(s.sedanjaVrednostPoObracunu)}
        </TableCell>
      </TableRow>
      {expanded && (
        <>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground border-t border-dashed">
            <TableCell className="pl-8 py-1 font-medium">Doknjižba / akt.</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Nabavna</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Osnova</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Preostalo</TableCell>
            <TableCell className="px-2 py-1 text-center font-medium">Meseci</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Amort. RAC</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Amort. DAV</TableCell>
            <TableCell className="px-2 py-1 text-right font-medium">Sed. vred.</TableCell>
          </TableRow>
          {s.doknjizbe.map((d) => <DoknjizbaRow key={d.id} d={d} />)}
        </>
      )}
    </>
  );
}

// ─── CSV izvoz ────────────────────────────────────────────────────────────────

function exportCsv(
  sredstva: SredstvoAmortResult[],
  leto: number,
) {
  const rows: string[][] = [
    [
      "Inv. št.",
      "Naziv",
      "Skupina",
      "Konto",
      "STM",
      "Stopnja RAC %",
      "Stopnja DAV %",
      "Skupna osnova",
      "Preostalo pred obr.",
      "Obračunana RAC",
      "Obračunana DAV",
      "Sedanja vrednost po obr.",
      "Opomba",
    ],
  ];
  for (const s of sredstva) {
    rows.push([
      s.inventarnaSt,
      s.naziv,
      s.skupinaKoda ?? "brez_skupine",
      s.accountCode ?? "",
      s.costCenterCode ?? "",
      s.racunovodskaStonja ?? "",
      s.davcnaStonja ?? "",
      s.skupnaOsnova,
      s.skupnaPreostalo,
      s.skupnaObracunanaRacunovodska,
      s.skupnaObracunanaDavcna,
      s.sedanjaVrednostPoObracunu,
      s.brezSkupine ? "brez_skupine" : s.polnoOdpisano ? "polno_odpisano" : "",
    ]);
  }
  const csv =
    "\uFEFF" + // BOM za Excel
    rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `amortizacija-${leto}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Glavna stran ─────────────────────────────────────────────────────────────

export default function AmortizacijskiObracun() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";

  const thisYear = new Date().getFullYear();
  // Privzeto leto — določi se po prvi naložitvi nastavitev (gl. useEffect spodaj)
  const [leto, setLeto] = useState<number>(thisYear);
  const letoApplied = useRef(false);
  const arhiv = useGetOsAmortizacijaObracuni(companyId);

  // Naloži OS nastavitve — vsebuje zadnjiObracunLeto in osLeto za privzeto leto
  const { data: nastavitve } = useGetOsAmortizacijaNastavitve(companyId, {
    query: { enabled: !!companyId },
  });

  // Nastavi privzeto leto samo enkrat ob prvi naložitvi nastavitev.
  // Prioriteta: (a) leto zadnjega shranjenega obračuna → (b) OS leto iz nastavitev → (c) tekoče leto
  useEffect(() => {
    if (letoApplied.current) return;
    if (!nastavitve) return; // čakamo na fetch
    letoApplied.current = true;
    const privzeto =
      nastavitve.zadnjiObracunLeto  // (a) zadnji shranjeni obračun
      ?? nastavitve.osLeto          // (b) OS leto iz nastavitev
      ?? thisYear;                  // (c) tekoče leto
    setLeto(privzeto);
  }, [nastavitve, thisYear]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"sredstva" | "konti" | "stm">("sredstva");

  // Dialog za knjiženje (GLK)
  const [knjizenjOpen, setKnjizenjOpen] = useState(false);

  // Dialog za izpis temeljnice (OS-only, brez GLK)
  const [izpisOpen, setIzpisOpen] = useState(false);
  const [izpisFormat, setIzpisFormat] = useState<"pdf" | "csv">("pdf");
  const izpisMut = useOsAmortizacijaIzpis(companyId);

  // Mesečni obračun
  const [doMeseca, setDoMeseca] = useState<number>(12);
  const [obracunResult, setObracunResult] = useState<ObracunGlavaInfo | null>(null);
  const [obracunError, setObracunError] = useState<string | null>(null);
  const [obracunExpanded, setObracunExpanded] = useState(false);
  const obracunMut = usePostOsAmortizacijaObracun(companyId);

  // Stornacija zadnjega obračuna
  const [stornoOpen, setStornoOpen] = useState(false);
  const [stornoError, setStornoError] = useState<string | null>(null);
  const stornoMut = usePostOsAmortizacijaStorno(companyId);
  const queryClient = useQueryClient();

  // Filtri
  const [filterQ, setFilterQ] = useState("");
  const [filterSkupina, setFilterSkupina] = useState<string>("__vse__");
  const [filterKonto, setFilterKonto] = useState<string>("__vse__");
  const [filterStm, setFilterStm] = useState<string>("__vse__");
  const [filterBrezSkupine, setFilterBrezSkupine] = useState<"vse" | "samo_brez" | "samo_z">("vse");

  const { data, isLoading, isError, error } = useGetOsAmortizacija(companyId, leto, {
    query: { enabled: !!companyId },
  });

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Varna sprehoditev po sredstvih (varovalo za primer nepričakovanega API odgovora)
  const sredstvaList: SredstvoAmortResult[] = Array.isArray(data?.sredstva) ? data.sredstva : [];

  // Zberi unikatne vrednosti za filtre
  const skupineOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sredstvaList) {
      if (s.skupinaKoda) seen.set(s.skupinaKoda, s.skupinaNaziv ?? s.skupinaKoda);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([koda, naziv]) => ({ koda, naziv }));
  }, [sredstvaList]);

  const kontoOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sredstvaList) {
      if (s.accountCode) seen.set(s.accountCode, s.accountName ?? s.accountCode);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sredstvaList]);

  const stmOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sredstvaList) {
      if (s.costCenterCode) seen.set(s.costCenterCode, s.costCenterName ?? s.costCenterCode);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sredstvaList]);

  // Filtrirani seznam
  const filteredSredstva = useMemo(() => {
    const q = filterQ.toLowerCase();
    return sredstvaList.filter((s) => {
      if (q && !s.inventarnaSt.toLowerCase().includes(q) && !s.naziv.toLowerCase().includes(q))
        return false;
      if (filterSkupina !== "__vse__" && s.skupinaKoda !== filterSkupina) return false;
      if (filterKonto !== "__vse__" && s.accountCode !== filterKonto) return false;
      if (filterStm !== "__vse__" && s.costCenterCode !== filterStm) return false;
      if (filterBrezSkupine === "samo_brez" && !s.brezSkupine) return false;
      if (filterBrezSkupine === "samo_z" && s.brezSkupine) return false;
      return true;
    });
  }, [data, filterQ, filterSkupina, filterKonto, filterStm, filterBrezSkupine]);

  const hasFilters =
    filterQ !== "" ||
    filterSkupina !== "__vse__" ||
    filterKonto !== "__vse__" ||
    filterStm !== "__vse__" ||
    filterBrezSkupine !== "vse";

  const clearFilters = () => {
    setFilterQ("");
    setFilterSkupina("__vse__");
    setFilterKonto("__vse__");
    setFilterStm("__vse__");
    setFilterBrezSkupine("vse");
  };

  // Leta za izbiro
  const years = [...new Set([
    ...Array.from({ length: thisYear - 2010 + 2 }, (_, i) => 2010 + i),
    ...(arhiv.data ?? []).map((obracun) => obracun.leto),
    leto,
  ])].sort((a, b) => b - a);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!companyId) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Izberite podjetje.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* Naslov + kontrole */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-xl font-semibold">Amortizacijski obračun</h1>
        </div>
        {/* Orodna vrstica — flex-wrap da se vse vidi */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Leto */}
          <Select
            value={String(leto)}
            onValueChange={(v) => {
              setLeto(parseInt(v, 10));
              setExpandedIds(new Set());
            }}
          >
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {data && (
            <>
              {/* Izvoz CSV */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                title="Izvozi amortizacijo v CSV"
                onClick={() => exportCsv(filteredSredstva, leto)}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                CSV
              </Button>

              {/* Izpis temeljnice */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                title="Izpis temeljnice amortizacije (PDF)"
                onClick={() => setIzpisOpen(true)}
              >
                <Printer className="h-3.5 w-3.5 mr-1" />
                Izpis
              </Button>

              {/* Ločilnik */}
              <div className="w-px h-6 bg-border mx-0.5" />

              {/* Do meseca */}
              <Select
                value={String(doMeseca)}
                onValueChange={(v) => setDoMeseca(parseInt(v, 10))}
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue placeholder="Do meseca" />
                </SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                    <SelectItem key={m} value={String(m)}>do {m}/{leto}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Zaženi obračun */}
              <Button
                size="sm"
                className="h-8 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={obracunMut.isPending}
                title="Zaženi amortizacijski obračun"
                onClick={async () => {
                  setObracunError(null);
                  setObracunResult(null);
                  try {
                    const result = await obracunMut.mutateAsync({ leto, doMeseca });
                    setObracunResult(result);
                    void queryClient.invalidateQueries({ queryKey: ["saved-amortization-years", companyId] });
                    setObracunExpanded(true);
                    void queryClient.invalidateQueries({ queryKey: osAmortizacijaQueryKey(companyId, leto) });
                    void queryClient.invalidateQueries({ queryKey: ["osnovna-sredstva", companyId] });
                    // Osveži register (medletni) in nastavitve (zadnjiObracunLeto) po obračunu
                    void queryClient.invalidateQueries({ queryKey: osAmortizacijaNastavitveQueryKey(companyId) });
                    void queryClient.invalidateQueries({
                      predicate: (q) =>
                        q.queryKey[0] === "os-register-medletni" && q.queryKey[1] === companyId,
                    });
                  } catch (e: unknown) {
                    const err = e as { status?: number; message?: string };
                    setObracunError(err.message ?? "Napaka pri zagonu obračuna");
                  }
                }}
              >
                {obracunMut.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Obračun…</>
                  : <><PlayCircle className="h-3.5 w-3.5 mr-1" />Zaženi</>
                }
              </Button>

              {/* Pripravi knjižbo — samo GLK */}
              {nastavitve?.hasGlkModule && (
                <Button
                  size="sm"
                  className="h-8 px-2 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                  title="Pripravi osnutek temeljnice v glavni knjigi"
                  onClick={() => setKnjizenjOpen(true)}
                >
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  Knjižbo
                </Button>
              )}

              {/* Storniraj — samo kadar obstaja shranjeni obračun */}
              {!data.predogled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400"
                  title={`Storniraj amortizacijski obračun ${leto}`}
                  disabled={stornoMut.isPending}
                  onClick={() => setStornoOpen(true)}
                >
                  {stornoMut.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Storno…</>
                    : <><Trash2 className="h-3.5 w-3.5 mr-1" />Storno {leto}</>
                  }
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <SavedAmortizationExports key={companyId} companyId={companyId} />

      <AmortizacijaArhiv
        obracuni={arhiv.data}
        isLoading={arhiv.isLoading}
        isError={arhiv.isError}
        onRetry={() => { void arhiv.refetch(); }}
        leto={leto}
        onSelect={(obracun) => {
          letoApplied.current = true;
          setLeto(obracun.leto);
          setDoMeseca(obracun.doMeseca);
          setActiveTab("sredstva");
          setExpandedIds(new Set());
          clearFilters();
          setObracunResult(null);
          setObracunError(null);
          setStornoError(null);
        }}
      />

      {/* Napaka pri nalaganju */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju</AlertTitle>
          <AlertDescription>{String(error)}</AlertDescription>
        </Alert>
      )}

      {/* Napaka obračuna (409 zaklep ali druga napaka) */}
      {obracunError && (
        <Alert className="border-amber-200 bg-amber-50/60">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Obračun ni bil shranjen</AlertTitle>
          <AlertDescription className="text-amber-800">{obracunError}</AlertDescription>
        </Alert>
      )}

      {/* Rezultat obračuna */}
      {obracunResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="font-semibold text-emerald-800">
                Obračun shranjen — {obracunResult.leto}, do {obracunResult.doMeseca}/{obracunResult.leto}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                obracunResult.status === "zakljucen"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}>
                {obracunResult.status === "zakljucen" ? "Zaključen" : "Odprt"}
              </span>
            </div>
            <button
              onClick={() => setObracunExpanded((v) => !v)}
              className="text-sm text-emerald-700 hover:underline"
            >
              {obracunExpanded ? "Skrij predogled" : "Prikaži predogled"}
            </button>
          </div>
          <div className="text-sm text-emerald-800">
            Skupaj amortizacija: <strong className="font-mono">{fmtEur(obracunResult.skupajBreme)} €</strong>
            {" · "}{obracunResult.steviloSredstev} sredstev
            {obracunResult.brezKontov > 0 && (
              <span className="text-amber-700 ml-2">({obracunResult.brezKontov} brez veljavnih kontov)</span>
            )}
          </div>

          {/* GLK osnutek status */}
          {obracunResult.glkOsnutek && (
            <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${
              obracunResult.glkOsnutek.ustvarjen || obracunResult.glkOsnutek.posodobljen
                ? "bg-blue-50 border border-blue-200 text-blue-800"
                : obracunResult.glkOsnutek.temeljnicaId === null && obracunResult.glkOsnutek.sporocilo.includes("ni odprtega")
                  ? "bg-amber-50 border border-amber-200 text-amber-800"
                  : "bg-slate-50 border border-slate-200 text-slate-600"
            }`}>
              {obracunResult.glkOsnutek.ustvarjen || obracunResult.glkOsnutek.posodobljen
                ? <BookOpen className="h-4 w-4 mt-0.5 shrink-0" />
                : <Info className="h-4 w-4 mt-0.5 shrink-0" />
              }
              <span>{obracunResult.glkOsnutek.sporocilo}</span>
            </div>
          )}
          {obracunExpanded && obracunResult.vrstice.length > 0 && (
            <div className="rounded-md border border-emerald-200 overflow-x-auto bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-emerald-50">
                    <th className="px-3 py-2 text-left">Konto stroška</th>
                    <th className="px-3 py-2 text-left">Konto popravka</th>
                    <th className="px-3 py-2 text-right">Znesek</th>
                    <th className="px-3 py-2 text-right">Sredstev</th>
                  </tr>
                </thead>
                <tbody>
                  {obracunResult.vrstice.map((v: import("@workspace/api-client-react").KnjizenjeVrstica, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-mono">{v.kontoStroskaCode} <span className="text-muted-foreground font-sans">{v.kontoStroskaName}</span></td>
                      <td className="px-3 py-1.5 font-mono">{v.kontoPopravkaCode} <span className="text-muted-foreground font-sans">{v.kontoPopravkaName}</span></td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtEur(v.znesek)} €</td>
                      <td className="px-3 py-1.5 text-right">{v.steviloSredstev}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Nalaganje */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          {/* Banner — knjiženje dostopno */}
          <Alert className="border-blue-200 bg-blue-50/60">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              {nastavitve?.hasGlkModule ? (
                <>
                  <strong>Korak 3c — pregled in knjiženje.</strong> Preveri izračunano amortizacijo za leto {leto},
                  nato klikni <strong>Pripravi knjižbo</strong> za ustvaritev osnutka temeljnice.
                  Osnutek čaka na ročno potrditev — nikoli ni samodejno potrjen.
                </>
              ) : (
                <>
                  <strong>Korak 3c — pregled.</strong> Preveri izračunano amortizacijo za leto {leto}.
                  Za prenos v glavno knjigo uporabi <strong>Izpis temeljnice</strong>.
                </>
              )}
            </AlertDescription>
          </Alert>

          {/* Povzetki */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={<TrendingDown className="h-5 w-5 text-green-600" />}
              label="Skupaj amortizacija (računovodska)"
              value={fmtEur(data.skupajRacunovodska) + " €"}
              highlight
            />
            <SummaryCard
              icon={<BarChart3 className="h-5 w-5 text-indigo-600" />}
              label="Skupaj amortizacija (davčna)"
              value={fmtEur(data.skupajDavcna) + " €"}
            />
            <SummaryCard
              icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
              label="Brez amort. skupin"
              value={`${data.brezSkupine} sredstev`}
              warn={data.brezSkupine > 0}
            />
            <SummaryCard
              icon={<CheckCircle2 className="h-5 w-5 text-gray-500" />}
              label="Polno odpisanih"
              value={`${data.polnoOdpisanih} sredstev`}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {(
              [
                { id: "sredstva", label: `Sredstva (${data.steviloSredstev})` },
                { id: "konti", label: `Po kontih (${data.poKontih.length})` },
                { id: "stm", label: `Po STM (${data.poStroskovnihMestih.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Sredstva ─────────────────────────────────────────────── */}
          {activeTab === "sredstva" && (
            <div className="space-y-3">
              {/* Indikator: predogled ali shranjeni obračun */}
              {data && data.predogled && (
                <div className="flex items-center gap-2 text-sm rounded-md px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Predogled — za leto {leto} ni shranjenega obračuna. Zneski so celoletni izračun.
                    Zaženi obračun, da shraniš dejanske vrednosti.
                  </span>
                </div>
              )}
              {data && !data.predogled && data.doMeseca !== null && data.doMeseca < 12 && !data.zastarel && (
                <div className="flex items-center gap-2 text-sm rounded-md px-3 py-2 bg-blue-50 border border-blue-200 text-blue-800">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    Prikaz temelji na shranjenem obračunu do {data.doMeseca}/{leto}.
                  </span>
                </div>
              )}
              {/* ── Opozorilo zastarelosti ────────────────────────────────────── */}
              {data && !data.predogled && data.zastarel && (
                <div className="rounded-lg border border-orange-300 bg-orange-50/70 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0" />
                    <span className="font-semibold text-orange-800 text-sm">
                      Obračun ni ažuren — prikazani zneski so iz zadnjega shranjenega obračuna
                    </span>
                  </div>
                  {data.zastarelRazlog && (
                    <p className="text-orange-700 text-sm pl-6">{data.zastarelRazlog}.</p>
                  )}
                  <p className="text-orange-700 text-sm pl-6">
                    Za osvežitev znova zaženite obračun z gumbom zgoraj.
                  </p>
                </div>
              )}
              {/* Filtri */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-40">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 text-sm"
                    placeholder="Inv. št. ali naziv…"
                    value={filterQ}
                    onChange={(e) => setFilterQ(e.target.value)}
                  />
                </div>
                <Select value={filterSkupina} onValueChange={setFilterSkupina}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue placeholder="Vsa skupina" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    <SelectItem value="__vse__">Vse skupine</SelectItem>
                    {skupineOptions.map((s) => (
                      <SelectItem key={s.koda} value={s.koda}>
                        {s.koda} — {s.naziv}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterKonto} onValueChange={setFilterKonto}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue placeholder="Vsi konti" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    <SelectItem value="__vse__">Vsi konti</SelectItem>
                    {kontoOptions.map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {code} — {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stmOptions.length > 0 && (
                  <Select value={filterStm} onValueChange={setFilterStm}>
                    <SelectTrigger className="h-8 text-sm w-36">
                      <SelectValue placeholder="Vse STM" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__vse__">Vse STM</SelectItem>
                      {stmOptions.map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {code} — {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select
                  value={filterBrezSkupine}
                  onValueChange={(v) =>
                    setFilterBrezSkupine(v as "vse" | "samo_brez" | "samo_z")
                  }
                >
                  <SelectTrigger className="h-8 text-sm w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vse">Vsa sredstva</SelectItem>
                    <SelectItem value="samo_z">Samo z amort. skupino</SelectItem>
                    <SelectItem value="samo_brez">Samo brez amort. skupin</SelectItem>
                  </SelectContent>
                </Select>
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Počisti
                  </Button>
                )}
              </div>

              {data.brezSkupine > 0 && (
                <Alert className="border-amber-200 bg-amber-50/60 py-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 text-sm">
                    <strong>{data.brezSkupine} sredstev</strong> nima amortizacijske skupine —
                    za ta sredstva amortizacije ni mogoče izračunati. Dodelite skupino v Registru
                    OS.
                  </AlertDescription>
                </Alert>
              )}

              {/* Tabela */}
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed w-full text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6 px-1" />
                      <TableHead className="w-20 px-2">Inv. št.</TableHead>
                      <TableHead className="px-2">Naziv</TableHead>
                      <TableHead className="w-16 px-2">Skupina</TableHead>
                      <TableHead className="w-[88px] px-2 text-right">Osnova</TableHead>
                      <TableHead className="w-[88px] px-2 text-right">Preostalo</TableHead>
                      <TableHead className="w-14 px-2 text-center">St. RAC</TableHead>
                      <TableHead className="w-[88px] px-2 text-right">Amort. RAC</TableHead>
                      <TableHead className="w-[88px] px-2 text-right">Amort. DAV</TableHead>
                      <TableHead className="w-[96px] px-2 text-right" title="Oslabitev vrednosti OS (SRS 1.35+) — vnos na zakljucenem letnem obračunu">Oslabitev</TableHead>
                      <TableHead className="w-[96px] px-2 text-right">Sed. vred.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSredstva.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          {hasFilters ? "Ni rezultatov za izbrane filtre." : "Ni sredstev."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSredstva.map((s) => (
                        <SredstvoRow
                          key={s.id}
                          s={s}
                          expanded={expandedIds.has(s.id)}
                          onToggle={() => toggleExpand(s.id)}
                          obracunZakljucen={!!(data && !data.predogled && data.doMeseca === 12 && !data.zastarel)}
                          leto={leto}
                          onOslabitevSaved={(sredstvoId, oslabitev) => {
                            void queryClient.invalidateQueries({ queryKey: osAmortizacijaQueryKey(companyId, leto) });
                            void queryClient.invalidateQueries({ queryKey: osRegisterMedletniQueryKey(companyId, leto) });
                            void queryClient.invalidateQueries({ queryKey: osnovnaSredstvaQueryKey(companyId) });
                            void queryClient.invalidateQueries({ queryKey: ["os-kronoloski", sredstvoId] });
                          }}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Skupaj vrstica za filtrirani seznam */}
              {filteredSredstva.length > 0 && (
                <div className="flex justify-end gap-8 px-4 py-3 bg-muted/40 rounded-md text-sm">
                  <span className="text-muted-foreground">
                    Prikazano: <strong>{filteredSredstva.length}</strong> od {data.steviloSredstev}
                  </span>
                  <span>
                    RAC:{" "}
                    <strong className="font-mono">
                      {fmtEur(
                        filteredSredstva
                          .reduce(
                            (s, x) => s + parseFloat(x.skupnaObracunanaRacunovodska),
                            0,
                          )
                          .toFixed(2),
                      )}{" "}
                      €
                    </strong>
                  </span>
                  <span>
                    DAV:{" "}
                    <strong className="font-mono">
                      {fmtEur(
                        filteredSredstva
                          .reduce(
                            (s, x) => s + parseFloat(x.skupnaObracunanaDavcna),
                            0,
                          )
                          .toFixed(2),
                      )}{" "}
                      €
                    </strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Po kontih ────────────────────────────────────────────── */}
          {activeTab === "konti" && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Konto koda</TableHead>
                    <TableHead>Naziv konta</TableHead>
                    <TableHead className="text-right">Sredstev</TableHead>
                    <TableHead className="text-right">Amort. RAC</TableHead>
                    <TableHead className="text-right">Amort. DAV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.poKontih.map((row) => (
                    <TableRow key={row.accountCode ?? "__null__"}>
                      <TableCell className="font-mono text-sm">
                        {row.accountCode ?? <span className="text-muted-foreground italic">brez konta</span>}
                      </TableCell>
                      <TableCell className="text-sm">{row.accountName ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">{row.stevilaSredstev}</TableCell>
                      <TableCell className="text-right font-semibold font-mono text-sm">
                        {fmtEur(row.skupajRacunovodska)} €
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {fmtEur(row.skupajDavcna)} €
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Skupaj */}
                  <TableRow className="font-bold bg-muted/40">
                    <TableCell colSpan={3} className="text-sm">SKUPAJ</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmtEur(data.skupajRacunovodska)} €
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {fmtEur(data.skupajDavcna)} €
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Tab: Po STM ──────────────────────────────────────────────── */}
          {activeTab === "stm" && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>STM koda</TableHead>
                    <TableHead>Naziv STM</TableHead>
                    <TableHead className="text-right">Sredstev</TableHead>
                    <TableHead className="text-right">Amort. RAC</TableHead>
                    <TableHead className="text-right">Amort. DAV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.poStroskovnihMestih.map((row) => (
                    <TableRow key={row.costCenterCode ?? "__null__"}>
                      <TableCell className="font-mono text-sm">
                        {row.costCenterCode ?? (
                          <span className="text-muted-foreground italic">brez STM</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.costCenterName ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">{row.stevilaSredstev}</TableCell>
                      <TableCell className="text-right font-semibold font-mono text-sm">
                        {fmtEur(row.skupajRacunovodska)} €
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {fmtEur(row.skupajDavcna)} €
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/40">
                    <TableCell colSpan={3} className="text-sm">SKUPAJ</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmtEur(data.skupajRacunovodska)} €
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {fmtEur(data.skupajDavcna)} €
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Dialog: Izpis temeljnice amortizacije (OS-only, brez GLK) */}
      <Dialog open={izpisOpen} onOpenChange={setIzpisOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Izpis temeljnice amortizacije
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Prenesi temeljnico amortizacije za leto <strong>{leto}</strong>.
              Izpis je samostojen — ne zahteva glavne knjige.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Format
              </label>
              <Select
                value={izpisFormat}
                onValueChange={(v) => setIzpisFormat(v as "pdf" | "csv")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF — pregleden dokument</SelectItem>
                  <SelectItem value="csv">CSV — za zunanji računovodski program</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Opozorilo: prazna amortizacija za izbrano leto */}
            {!izpisMut.isError && data && parseFloat(data.skupajRacunovodska ?? "0") === 0 && (
              <Alert className="border-amber-200 bg-amber-50/60">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 text-sm">
                  Za leto <strong>{leto}</strong> ni izračunane amortizacije. Sredstva so morda
                  v celoti odpisana ali leto ni pravilno.{" "}
                  <strong>Nastavi OS leto v nastavitvah kontov amortizacije.</strong>
                </AlertDescription>
              </Alert>
            )}

            {/* Opozorilo: OS leto ni nastavljeno */}
            {!nastavitve?.osLeto && nastavitve && (
              <Alert className="border-blue-200 bg-blue-50/60">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800 text-sm">
                  OS leto amortizacije ni nastavljeno — privzeto se uporablja {leto}.
                  Nastavi ga v <strong>Nastavitve kontov amortizacije</strong>{nastavitve?.hasGlkModule ? " (gumb Pripravi knjižbo → korak 1)" : ""}.
                </AlertDescription>
              </Alert>
            )}

            {izpisMut.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {izpisMut.error instanceof Error
                    ? izpisMut.error.message
                    : "Napaka pri generiranju izpisa."}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIzpisOpen(false)}>
              Prekliči
            </Button>
            <Button
              disabled={izpisMut.isPending}
              onClick={async () => {
                try {
                  const blob = await izpisMut.mutateAsync({ leto, format: izpisFormat });
                  const ext = izpisFormat === "pdf" ? "pdf" : "csv";
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `amortizacija-temeljnica-${leto}.${ext}`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setIzpisOpen(false);
                  izpisMut.reset();
                } catch {
                  // napaka prikazana zgoraj
                }
              }}
            >
              {izpisMut.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generiranje…</>
              ) : (
                <><Download className="h-4 w-4 mr-2" />Prenesi {izpisFormat.toUpperCase()}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: priprava osnutka temeljnice amortizacije (GLK) */}
      {companyId && (
        <AmortizacijaKnjizenjDialog
          open={knjizenjOpen}
          onOpenChange={setKnjizenjOpen}
          companyId={companyId}
          leto={leto}
          skupajRacunovodska={data?.skupajRacunovodska ?? "0.00"}
        />
      )}

      {/* AlertDialog: potrditev stornacije zadnjega obračuna */}
      <AlertDialog open={stornoOpen} onOpenChange={setStornoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" />
              Storniraj obračun amortizacije {leto}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-1">
              <span className="block">
                Ta dejanje bo <strong>trajno izbrisalo</strong> shranjeni obračun za leto {leto}:
              </span>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Vse vrstice obračuna (postavke po sredstvih) bodo odstranjene s kartic OS.</li>
                <li>Glava obračuna (os_amortizacija_obracun) bo izbrisana.</li>
                <li>Če obstaja GLK osnutek temeljnice (status=osnutek), bo izbrisan.</li>
              </ul>
              <span className="block text-amber-700 font-medium text-sm">
                ⚠ Poknjižene GLK temeljnice ne morejo biti stornirane — v tem primeru boste obveščeni.
              </span>
              {stornoError && (
                <span className="block text-red-600 text-sm font-medium">{stornoError}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction
              disabled={stornoMut.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async (e) => {
                e.preventDefault(); // prepreči zaprtje dialoga pred dokončanjem
                setStornoError(null);
                try {
                  await stornoMut.mutateAsync({ leto });
                  void queryClient.invalidateQueries({ queryKey: ["saved-amortization-years", companyId] });
                  setStornoOpen(false);
                  setObracunResult(null); // počisti predogled — obračun je razveljavljen
                  // Invalidiraj obračun, register (medletni), nastavitve, seznam glav
                  void queryClient.invalidateQueries({ queryKey: osAmortizacijaQueryKey(companyId, leto) });
                  void queryClient.invalidateQueries({ queryKey: ["osnovna-sredstva", companyId] });
                  void queryClient.invalidateQueries({ queryKey: osAmortizacijaNastavitveQueryKey(companyId) });
                  void queryClient.invalidateQueries({
                    predicate: (q) =>
                      q.queryKey[0] === "os-register-medletni" && q.queryKey[1] === companyId,
                  });
                } catch (err: unknown) {
                  const e2 = err as { message?: string };
                  setStornoError(e2.message ?? "Napaka pri stornaciji");
                }
              }}
            >
              {stornoMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Storniram…</>
                : "Potrdi stornacijo"
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Povzetek kartica ─────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  highlight,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-1 ${
        highlight
          ? "bg-green-50/60 border-green-200"
          : warn
          ? "bg-amber-50/60 border-amber-200"
          : "bg-background"
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold font-mono ${highlight ? "text-green-800" : warn ? "text-amber-700" : ""}`}>
        {value}
      </div>
    </div>
  );
}
