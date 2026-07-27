/**
 * §134 — KIR/KPR Evidence pregled pred oddajo FURS-u
 *
 * Vsebuje:
 *  - Izbirnik leta in obdobja (mesečno/trimesečno)
 *  - KIR tabela: vsaka vrstica = en dokument (direction=OUT)
 *  - KPR tabela: vsaka vrstica = en dokument (direction=IN)
 *  - Rekonciliacijski razdelek: KIR/KPR vsote vs DDV-O polja
 *  - Opozorila/napake po D.4 pravilih
 *  - Gumb "Izvozi XML" (placeholder)
 */
import React, { useState, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetVatLedgerReport,
  useListVatSubmissions,
  useCreateVatSubmission,
  vatSubmissionsQueryKey,
  type KirRow,
  type KprRow,
  type VatWarning,
  type ReconRow,
  type VatSubmission,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Download, FileText, ChevronRight,
  Clock, CheckCheck, XCircle, Loader2,
} from "lucide-react";

// ─── Konstante ───────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

const MESECNA_OBDOBJA = [
  { value: "0701", label: "Januar" },
  { value: "0702", label: "Februar" },
  { value: "0703", label: "Marec" },
  { value: "0704", label: "April" },
  { value: "0705", label: "Maj" },
  { value: "0706", label: "Junij" },
  { value: "0707", label: "Julij" },
  { value: "0708", label: "Avgust" },
  { value: "0709", label: "September" },
  { value: "0710", label: "Oktober" },
  { value: "0711", label: "November" },
  { value: "0712", label: "December" },
];

const TRIMESECNA_OBDOBJA = [
  { value: "0703", label: "Q1 (jan–mar)" },
  { value: "0706", label: "Q2 (apr–jun)" },
  { value: "0709", label: "Q3 (jul–sep)" },
  { value: "0712", label: "Q4 (okt–dec)" },
];

// ─── Pomočniki ────────────────────────────────────────────────────────────────

const fmtEur = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "–";
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return n < 0 ? `−${formatted}` : formatted;
};

const isNonZero = (v: string) => Math.abs(parseFloat(v)) >= 0.005;

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "–";
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("sl-SI", { timeZone: "UTC" });
};

// ─── KIR Tabela ───────────────────────────────────────────────────────────────

const KIR_STOLPCI = [
  { key: "p7",  label: "P7 (dom. osnova)" },
  { key: "p8",  label: "P8 (76.a osnova)" },
  { key: "p9",  label: "P9 (oproščeno)" },
  { key: "p10", label: "P10 (EU blago)" },
  { key: "p11", label: "P11 (EU tristran.)" },
  { key: "p12", label: "P12 (daljava)" },
  { key: "p13", label: "P13 (montaža)" },
  { key: "p14", label: "P14 (DDV 22%)" },
  { key: "p15", label: "P15 (DDV 9,5%)" },
  { key: "p16", label: "P16 (DDV 5%)" },
  { key: "p17", label: "P17 (EU-B 22%)" },
  { key: "p18", label: "P18 (EU-S 22%)" },
  { key: "p19", label: "P19 (EU-B 9,5%)" },
  { key: "p20", label: "P20 (EU-S 9,5%)" },
  { key: "p21", label: "P21 (EU-B 5%)" },
  { key: "p22", label: "P22 (EU-S 5%)" },
  { key: "p23", label: "P23 (76.a 22%)" },
  { key: "p24", label: "P24 (76.a 9,5%)" },
  { key: "p25", label: "P25 (76.a 5%)" },
  { key: "p26", label: "P26 (uvoz)" },
  { key: "p27", label: "P27 (zunaj SI)" },
];

function KirTabela({ rows, totals }: { rows: KirRow[]; totals: Record<string, string> }) {
  // Pokaži samo stolpce kjer vsaj ena vrstica ni nič
  const visibleCols = KIR_STOLPCI.filter(col =>
    rows.some(r => isNonZero((r as any)[col.key] ?? "0"))
  );

  if (rows.length === 0) {
    return (
      <div className="text-center py-10 border rounded-lg bg-card text-muted-foreground">
        <FileText className="mx-auto h-8 w-8 mb-2 opacity-40" />
        V tem obdobju ni KIR vpisov.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg bg-card">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-8 text-center">#</TableHead>
            <TableHead>P2 (Datum knj.)</TableHead>
            <TableHead>P3 (Dok. štev.)</TableHead>
            <TableHead>P4 (Datum listine)</TableHead>
            <TableHead>P5 (Kupec)</TableHead>
            <TableHead>P6 / P6DS</TableHead>
            {visibleCols.map(c => (
              <TableHead key={c.key} className="text-right whitespace-nowrap">{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow key={row.zapst} className={row.reported ? "opacity-60" : ""}>
              <TableCell className="text-center text-muted-foreground">{row.zapst}</TableCell>
              <TableCell className="whitespace-nowrap">{fmtDate(row.p2)}</TableCell>
              <TableCell className="font-medium whitespace-nowrap">{row.p3}</TableCell>
              <TableCell className="whitespace-nowrap">{fmtDate(row.p4)}</TableCell>
              <TableCell className="max-w-[180px] truncate" title={row.p5 ?? ""}>{row.p5 || <span className="text-muted-foreground">–</span>}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.p6 || "–"}{row.p6ds ? ` / ${row.p6ds}` : ""}
              </TableCell>
              {visibleCols.map(c => {
                const v = (row as any)[c.key] ?? "0";
                const n = parseFloat(v);
                return (
                  <TableCell key={c.key} className={`text-right whitespace-nowrap ${n < 0 ? "text-red-600" : n > 0 ? "" : "text-muted-foreground/40"}`}>
                    {isNonZero(v) ? fmtEur(v) : "–"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
        <tfoot>
          <TableRow className="border-t-2 bg-muted/30 font-semibold">
            <TableCell colSpan={6} className="text-right">SKUPAJ KIR:</TableCell>
            {visibleCols.map(c => {
              const v = totals[c.key] ?? "0";
              const n = parseFloat(v);
              return (
                <TableCell key={c.key} className={`text-right whitespace-nowrap ${n < 0 ? "text-red-600" : n > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>
                  {isNonZero(v) ? fmtEur(v) : "–"}
                </TableCell>
              );
            })}
          </TableRow>
        </tfoot>
      </Table>
    </div>
  );
}

// ─── KPR Tabela ───────────────────────────────────────────────────────────────

const KPR_STOLPCI = [
  { key: "p8",  label: "P8 (nabave osnova)" },
  { key: "p9",  label: "P9 (76.a osnova)" },
  { key: "p10", label: "P10 (EU blago)" },
  { key: "p11", label: "P11 (EU storitve)" },
  { key: "p12", label: "P12 (nepremič.)" },
  { key: "p13", label: "P13 (druga OS)" },
  { key: "p14", label: "P14 (oproščene)" },
  { key: "p15", label: "P15 (nepremič. opr.)" },
  { key: "p16", label: "P16 (OS opr.)" },
  { key: "p17", label: "P17 (neodbitni DDV)" },
  { key: "p18", label: "P18 (odbiti 22%)" },
  { key: "p19", label: "P19 (odbiti 9,5%)" },
  { key: "p20", label: "P20 (odbiti 5%)" },
  { key: "p21", label: "P21 (pavšal 8%)" },
  { key: "p22", label: "P22 (opomba/MRN)" },
];

function KprTabela({ rows, totals }: { rows: KprRow[]; totals: Record<string, string> }) {
  const visibleCols = KPR_STOLPCI.filter(col =>
    rows.some(r => isNonZero((r as any)[col.key] ?? "0"))
  );

  if (rows.length === 0) {
    return (
      <div className="text-center py-10 border rounded-lg bg-card text-muted-foreground">
        <FileText className="mx-auto h-8 w-8 mb-2 opacity-40" />
        V tem obdobju ni KPR vpisov.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg bg-card">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-8 text-center">#</TableHead>
            <TableHead>P2 (Datum knj.)</TableHead>
            <TableHead>P3 (Dok. štev.)</TableHead>
            <TableHead>P4 (Datum prejem)</TableHead>
            <TableHead>P5 (Datum listine)</TableHead>
            <TableHead>P6 (Dobavitelj)</TableHead>
            <TableHead>P7 / P7DS</TableHead>
            {visibleCols.map(c => (
              <TableHead key={c.key} className="text-right whitespace-nowrap">{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow key={row.zapst} className={row.reported ? "opacity-60" : ""}>
              <TableCell className="text-center text-muted-foreground">{row.zapst}</TableCell>
              <TableCell className="whitespace-nowrap">{fmtDate(row.p2)}</TableCell>
              <TableCell className="font-medium whitespace-nowrap">{row.p3}</TableCell>
              <TableCell className="whitespace-nowrap">{fmtDate(row.p4)}</TableCell>
              <TableCell className="whitespace-nowrap">{fmtDate(row.p5)}</TableCell>
              <TableCell className="max-w-[160px] truncate" title={row.p6 ?? ""}>{row.p6 || <span className="text-muted-foreground">–</span>}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.p7 || "–"}{row.p7ds ? ` / ${row.p7ds}` : ""}
              </TableCell>
              {visibleCols.map(c => {
                const v = (row as any)[c.key] ?? "0";
                const n = parseFloat(v);
                return (
                  <TableCell key={c.key} className={`text-right whitespace-nowrap ${n < 0 ? "text-red-600" : n > 0 ? "" : "text-muted-foreground/40"}`}>
                    {isNonZero(v) ? fmtEur(v) : "–"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
        <tfoot>
          <TableRow className="border-t-2 bg-muted/30 font-semibold">
            <TableCell colSpan={7} className="text-right">SKUPAJ KPR:</TableCell>
            {visibleCols.map(c => {
              const v = totals[c.key] ?? "0";
              const n = parseFloat(v);
              return (
                <TableCell key={c.key} className={`text-right whitespace-nowrap ${n < 0 ? "text-red-600" : n > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>
                  {isNonZero(v) ? fmtEur(v) : "–"}
                </TableCell>
              );
            })}
          </TableRow>
        </tfoot>
      </Table>
    </div>
  );
}

// ─── Rekonciliacija ───────────────────────────────────────────────────────────

function RekonPanel({
  recon,
  summary,
}: {
  recon: ReconRow[];
  summary: { totalObracunan: string; totalOdbitni: string; netoDdv: string };
}) {
  const netoDdv = parseFloat(summary.netoDdv);
  const isObveznost = netoDdv >= 0;

  return (
    <div className="space-y-4">
      <div className="border rounded-lg bg-card overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Rekonciliacija KIR/KPR → DDV-O polja
        </div>
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">DDV-O</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead className="w-24 text-center">KIR polje</TableHead>
              <TableHead className="w-24 text-center">KPR polje</TableHead>
              <TableHead className="text-right w-32">Znesek (€)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recon.map(row => {
              const v = parseFloat(row.value);
              const isZero = Math.abs(v) < 0.005;
              return (
                <TableRow key={row.dvoField} className={isZero ? "opacity-50" : ""}>
                  <TableCell className="font-mono font-medium text-primary">{row.dvoField}</TableCell>
                  <TableCell className="text-muted-foreground">{row.label}</TableCell>
                  <TableCell className="text-center">
                    {row.kirField ? <Badge variant="outline" className="text-xs font-mono">{row.kirField}</Badge> : "–"}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.kprField ? <Badge variant="outline" className="text-xs font-mono">{row.kprField}</Badge> : "–"}
                  </TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${v < 0 ? "text-red-600" : v > 0 ? "" : "text-muted-foreground"}`}>
                    {isZero ? "–" : `${fmtEur(row.value)} €`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Neto DDV */}
      <div className={`border rounded-lg p-4 flex items-center justify-between ${isObveznost ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
        <div>
          <div className="text-sm font-medium text-muted-foreground">Skupaj obračunani DDV</div>
          <div className="font-semibold tabular-nums">{fmtEur(summary.totalObracunan)} €</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-medium text-muted-foreground">Skupaj odbitni DDV</div>
          <div className="font-semibold tabular-nums text-emerald-700">{fmtEur(summary.totalOdbitni)} €</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <div className="text-right">
          <div className="text-sm font-medium text-muted-foreground">
            {isObveznost ? "Neto DDV obveznost (f51)" : "Neto DDV presežek"}
          </div>
          <div className={`text-xl font-bold tabular-nums ${isObveznost ? "text-red-700" : "text-emerald-700"}`}>
            {fmtEur(Math.abs(netoDdv))} €
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Opozorila panel ──────────────────────────────────────────────────────────

function OpozorilaPanel({ warnings }: { warnings: VatWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-3 border rounded-lg bg-emerald-50 border-emerald-200 p-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <div className="font-medium text-emerald-800">Brez opozoril</div>
          <div className="text-sm text-emerald-700">Vsi pred-oddajni pregledi so uspešno opravljeni.</div>
        </div>
      </div>
    );
  }

  const errors = warnings.filter(w => w.severity === "ERROR");
  const warningsList = warnings.filter(w => w.severity === "WARNING");

  return (
    <div className="space-y-2">
      {errors.map(w => (
        <div key={w.id} className="flex items-start gap-3 border rounded-lg bg-red-50 border-red-200 p-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge variant="destructive" className="text-xs">NAPAKA</Badge>
              <span className="text-xs text-muted-foreground font-mono">{w.rule}</span>
              {w.documentNo && <span className="text-xs font-medium truncate">{w.documentNo}</span>}
            </div>
            <div className="text-sm text-red-800">{w.message}</div>
          </div>
        </div>
      ))}
      {warningsList.map(w => (
        <div key={w.id} className="flex items-start gap-3 border rounded-lg bg-amber-50 border-amber-200 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge className="text-xs bg-amber-500 hover:bg-amber-500">OPOZORILO</Badge>
              <span className="text-xs text-muted-foreground font-mono">{w.rule}</span>
              {w.documentNo && <span className="text-xs font-medium truncate">{w.documentNo}</span>}
            </div>
            <div className="text-sm text-amber-800">{w.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Repozitorij oddaj ────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: "Osnutek",
  submitted: "Oddano",
  accepted: "Sprejeto",
  rejected: "Zavrnjeno",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

function SubmissionsPanel({
  companyId,
  currentYear,
  currentPeriod,
}: {
  companyId: string;
  currentYear: number;
  currentPeriod: string;
}) {
  const { data, isLoading } = useListVatSubmissions(companyId);

  const handleDownload = useCallback(
    (s: VatSubmission) => {
      const url = `/api/companies/${companyId}/vat-submissions/${s.id}/download`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `KIR_KPR_${s.periodYear}_${s.period}_${s.kind}.xml`;
      a.click();
    },
    [companyId],
  );

  const forCurrentPeriod = data?.submissions.filter(
    s => s.periodYear === currentYear && s.period === currentPeriod,
  ) ?? [];

  const rest = data?.submissions.filter(
    s => !(s.periodYear === currentYear && s.period === currentPeriod),
  ) ?? [];

  const all = [...forCurrentPeriod, ...rest];

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (all.length === 0) return null;

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="bg-muted/50 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Repozitorij XML oddaj
      </div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Obdobje</TableHead>
            <TableHead>Vsebina</TableHead>
            <TableHead>KIR</TableHead>
            <TableHead>KPR</TableHead>
            <TableHead>Shema</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ustvarjeno</TableHead>
            <TableHead className="text-right w-24">Prenos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {all.map(s => {
            const isCurrent = s.periodYear === currentYear && s.period === currentPeriod;
            return (
              <TableRow key={s.id} className={isCurrent ? "bg-primary/5" : ""}>
                <TableCell className="font-mono font-medium">
                  {s.periodYear}/{s.period}
                  {isCurrent && <span className="ml-1 text-primary text-xs">◀ trenutno</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{s.kind}</Badge>
                </TableCell>
                <TableCell className="text-center">{s.kirCount}</TableCell>
                <TableCell className="text-center">{s.kprCount}</TableCell>
                <TableCell className="text-muted-foreground font-mono">{s.schemaVersion}</TableCell>
                <TableCell>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[s.status] ?? ""}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {new Date(s.createdAt).toLocaleString("sl-SI", { timeZone: "UTC",
                    day: "2-digit", month: "2-digit", year: "numeric",
                    hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() => handleDownload(s)}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    XML
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Glavna komponenta ────────────────────────────────────────────────────────

export function KirKprEvidenceTab() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [periodMode, setPeriodMode] = useState<"mesecno" | "trimesecno">("mesecno");
  const [period, setPeriod] = useState<string>(() => {
    const m = new Date().getMonth() + 1; // 1-12
    return `07${String(m).padStart(2, "0")}`;
  });
  const [exportError, setExportError] = useState<string | null>(null);

  // Ko se zamenja mode, nastavi privzeto obdobje
  const handleModeChange = (mode: "mesecno" | "trimesecno") => {
    setPeriodMode(mode);
    if (mode === "trimesecno") {
      const m = new Date().getMonth() + 1;
      const q = Math.ceil(m / 3) * 3;
      setPeriod(`07${String(q).padStart(2, "0")}`);
    } else {
      const m = new Date().getMonth() + 1;
      setPeriod(`07${String(m).padStart(2, "0")}`);
    }
  };

  const obdobja = periodMode === "mesecno" ? MESECNA_OBDOBJA : TRIMESECNA_OBDOBJA;

  const { data, isLoading, error } = useGetVatLedgerReport(
    activeCompany?.id ?? "",
    { year, period },
    { query: { enabled: !!(activeCompany?.id && period) } },
  );

  const createSubmission = useCreateVatSubmission(activeCompany?.id ?? "");

  const handleExport = useCallback(async () => {
    if (!activeCompany?.id) return;
    setExportError(null);
    try {
      const result = await createSubmission.mutateAsync({ year, period });
      // Sproži download takoj
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = `KIR_KPR_${year}_${period}_${result.kind}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Osveži seznam oddaj
      queryClient.invalidateQueries({ queryKey: vatSubmissionsQueryKey(activeCompany.id) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Napaka pri izvozu XML";
      setExportError(msg);
    }
  }, [activeCompany, year, period, createSubmission, queryClient]);

  const hasErrors = data?.hasErrors ?? false;
  const totalWarnings = (data?.errorCount ?? 0) + (data?.warningCount ?? 0);
  const isEmpty = (data?.kirCount ?? 0) + (data?.kprCount ?? 0) === 0;
  const canExport = !hasErrors && !isEmpty && !!data;

  return (
    <div className="space-y-5">
      {/* Glava + izbirnik */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 bg-card border rounded-lg p-4 shadow-sm">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Vrsta zavezanca</Label>
          <div className="flex gap-1">
            <button
              onClick={() => handleModeChange("mesecno")}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${periodMode === "mesecno" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
            >
              Mesečni
            </button>
            <button
              onClick={() => handleModeChange("trimesecno")}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${periodMode === "trimesecno" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
            >
              Trimesečni
            </button>
          </div>
        </div>

        <div className="space-y-1.5 w-full sm:w-[130px]">
          <Label className="text-xs font-medium text-muted-foreground">Leto</Label>
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-full sm:w-[200px]">
          <Label className="text-xs font-medium text-muted-foreground">Obdobje</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {obdobja.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Statistike / gumb */}
        <div className="flex-1" />
        {data && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              KIR: <span className="font-medium text-foreground">{data.kirCount}</span>
              {" · "}
              KPR: <span className="font-medium text-foreground">{data.kprCount}</span>
            </span>
            {totalWarnings > 0 && (
              <Badge variant={hasErrors ? "destructive" : "outline"} className={!hasErrors ? "border-amber-300 text-amber-700 bg-amber-50" : ""}>
                {hasErrors ? `${data.errorCount} napaka` : `${data.warningCount} opozorilo`}
              </Badge>
            )}
          </div>
        )}

        <Button
          onClick={handleExport}
          disabled={!canExport || createSubmission.isPending}
          className="shrink-0"
          title={
            hasErrors ? "Odpravite napake preden izvozite XML"
            : isEmpty ? "V tem obdobju ni vpisov za izvoz"
            : "Generiraj in prenesi KIR/KPR XML za FURS"
          }
        >
          {createSubmission.isPending
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <Download className="h-4 w-4 mr-2" />}
          Izvozi XML
        </Button>
      </div>

      {/* Napaka pri izvozu */}
      {exportError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri izvozu</AlertTitle>
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      )}

      {/* Vsebina */}
      {!activeCompany ? (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Izberite podjetje</AlertTitle></Alert>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju evidence</AlertTitle>
          <AlertDescription>Prišlo je do napake. Preverite obdobje in poskusite znova.</AlertDescription>
        </Alert>
      ) : data ? (
        <div className="space-y-6">
          {/* Opozorila (na vrhu, da so vidna) */}
          {data.warnings.length > 0 && (
            <section>
              <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
                {hasErrors
                  ? <AlertCircle className="h-4 w-4 text-red-500" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                Pred-oddajna opozorila
                <Badge variant={hasErrors ? "destructive" : "outline"} className={!hasErrors ? "border-amber-300 text-amber-700 bg-amber-50" : ""}>
                  {data.errorCount > 0 && `${data.errorCount} napaka`}
                  {data.errorCount > 0 && data.warningCount > 0 && " · "}
                  {data.warningCount > 0 && `${data.warningCount} opozorilo`}
                </Badge>
              </h3>
              <OpozorilaPanel warnings={data.warnings} />
            </section>
          )}

          {/* KIR tabela */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-base font-semibold">KIR — Evidenca izdanih računov</h3>
              <Badge variant="secondary">{data.kirCount} {data.kirCount === 1 ? "vpis" : "vpisov"}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                {data.periodFrom} – {data.periodTo}
              </span>
            </div>
            <KirTabela rows={data.kirRows} totals={data.kirTotals} />
          </section>

          {/* KPR tabela */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-base font-semibold">KPR — Evidenca prejetih računov</h3>
              <Badge variant="secondary">{data.kprCount} {data.kprCount === 1 ? "vpis" : "vpisov"}</Badge>
            </div>
            <KprTabela rows={data.kprRows} totals={data.kprTotals} />
          </section>

          {/* Rekonciliacija */}
          <section>
            <h3 className="text-base font-semibold mb-2">Rekonciliacija → DDV-O</h3>
            <RekonPanel recon={data.recon} summary={data.reconSummary} />
          </section>

          {/* Prazna evidenca notice */}
          {data.kirCount === 0 && data.kprCount === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Prazna evidenca</AlertTitle>
              <AlertDescription>
                V obdobju {data.periodFrom} – {data.periodTo} ni KIR/KPR vpisov v evidenci.
                Ob oddaji boste morali FURS-u oddati prazno evidenco z {"<KIR>false</KIR>"} in {"<KPR>false</KPR>"}.
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}

      {/* Repozitorij XML oddaj */}
      {activeCompany && (
        <section>
          <SubmissionsPanel
            companyId={activeCompany.id}
            currentYear={year}
            currentPeriod={period}
          />
        </section>
      )}
    </div>
  );
}
