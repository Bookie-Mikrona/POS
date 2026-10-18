import { formatDatum } from "@/lib/utils";
import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Layers,
  FolderOpen,
  Building,
  AlertCircle,
  Printer,
  Download,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  useGetDimensionReport,
  type DimensionType,
  type DimensionReportRow,
  type AccountBreakdownRow,
  useListAccounts,
} from "@workspace/api-client-react";
import { useCompany, useSharedCompanyAccess } from "@/contexts/CompanyContext";
import { useDimensionReportFilters } from "@/hooks/use-dimension-report-filters";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── CSV export ────────────────────────────────────────────────────────────────

export function exportCsv(
  rows: DimensionReportRow[],
  grandTotalDebit: string,
  grandTotalCredit: string,
  grandTotalBalance: string,
  dimensionLabel: string,
  dateFrom: string,
  dateTo: string,
  accountLabel?: string,
) {
  const escape = (v: string) => {
    // CSV quoting alone does not stop Excel/Calc from evaluating formulas.
    // Prefix text only (also after whitespace/control characters); keep the
    // numeric path separate so negative balances remain spreadsheet numbers.
    const safe = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const num = (v: string) => v.replace(".", ","); // Slovenian decimal

  const lines: string[] = [];

  // Metadata header
  lines.push(escape(`Analitično računovodstvo — ${dimensionLabel}`));
  lines.push(escape(`Obdobje: ${formatDatum(dateFrom)} – ${formatDatum(dateTo)}${accountLabel ? ` | Konto: ${accountLabel}` : ""}`));
  lines.push(""); // blank separator

  // Column headers
  lines.push(["Koda", "Naziv", "Debet (EUR)", "Kredit (EUR)", "Saldo (EUR)"].map(escape).join(";"));

  // Data rows
  for (const row of rows) {
    lines.push([
      escape(row.code),
      escape(row.name),
      num(row.totalDebit),
      num(row.totalCredit),
      num(row.balance),
    ].join(";"));

    for (const account of row.accounts ?? []) {
      lines.push([
        escape(`  > Konto ${account.code}`),
        escape(account.name),
        num(account.totalDebit),
        num(account.totalCredit),
        num(account.balance),
      ].join(";"));
    }
  }

  // Grand total
  lines.push([
    escape("SKUPAJ"),
    escape(""),
    num(grandTotalDebit),
    num(grandTotalCredit),
    num(grandTotalBalance),
  ].join(";"));

  // UTF-8 BOM + content
  const bom = "\uFEFF";
  const csv = bom + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeDate = dateFrom && dateTo ? `_${dateFrom}_${dateTo}` : "";
  a.href = url;
  a.download = `porocilo_dimenzije_${dimensionLabel.replace(/\s+/g, "_")}${safeDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toLocaleString("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function balanceColor(val: string): string {
  const n = parseFloat(val);
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function BalanceIcon({ val }: { val: string }) {
  const n = parseFloat(val);
  if (n > 0) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (n < 0) return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

const DIM_OPTIONS: { value: DimensionType; label: string; icon: React.ElementType }[] = [
  { value: "costCenter", label: "Stroškovna mesta", icon: Layers },
  { value: "project", label: "Projekti", icon: FolderOpen },
  { value: "department", label: "Oddelki", icon: Building },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PorocilaAnalitika() {
  const { activeCompany, setActiveCompany } = useCompany();
  const { sharedCompanyId } = useDimensionReportFilters();
  const access = useSharedCompanyAccess(sharedCompanyId);

  // Do not even mount data hooks, controls or exports until the URL's company
  // is verified and explicitly selected. Disabled queries can still hold data.
  if (sharedCompanyId !== null) {
    let message: React.ReactNode;
    let action: React.ReactNode;
    let title = "Podjetje deljenega poročila";
    if (access.checking) {
      message = "Preverjanje dostopa do podjetja …";
    } else if (access.failed) {
      title = "Dostopa ni mogoče preveriti";
      message = "Poročilo ni naloženo. Poskusite znova.";
      action = <Button onClick={() => void access.retry()}>Poskusi znova</Button>;
    } else if (!access.company) {
      title = "Ni dostopa do poročila";
      message = "Do podjetja v povezavi nimate računovodskega dostopa ali podjetje ne obstaja. Podatki poročila niso prikazani.";
    } else if (activeCompany?.id !== access.company.id) {
      message = (
        <>
          Povezava je za podjetje <strong>{access.company.naziv}</strong>.
          {activeCompany
            ? <> Trenutno je izbrano podjetje <strong>{activeCompany.naziv}</strong>.</>
            : " Trenutno ni izbranega podjetja."}
          {" "}Za prikaz poročila potrdite preklop podjetja. Filtri bodo ostali nespremenjeni.
        </>
      );
      const target = access.company;
      action = <Button onClick={() => setActiveCompany(target)}>Preklopi na {target.naziv}</Button>;
    } else {
      return <DimensionReport key={activeCompany.id} />;
    }
    return (
      <div className="space-y-4 p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold">Analitično računovodstvo</h1>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        {action}
      </div>
    );
  }

  return <DimensionReport key={activeCompany?.id ?? ""} />;
}

function DimensionReport() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";

  // The URL is the source of truth, including on reload and back/forward navigation.
  const { filters, queried, updateFilters, errors: filterErrors, isValid: filtersValid, reportParams } = useDimensionReportFilters(companyId);
  const { dimensionType, dateFrom, dateTo, accountId } = filters;
  const applied = { ...filters, queried };
  const [excelExporting, setExcelExporting] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);

  // Expanded dimension rows (set of row ids)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAllUntagged, setShowAllUntagged] = useState(false);
  useEffect(() => {
    setShowAllUntagged(false);
  }, [dimensionType, dateFrom, dateTo, accountId, queried, companyId]);
  useEffect(() => {
    setExpandedRows(new Set());
  }, [companyId]);

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Load accounts for filter dropdown
  const { data: accountsData, error: accountsError, isPlaceholderData: accountsPlaceholder } = useListAccounts(
    companyId,
    { includeInactive: true },
    { query: { enabled: !!companyId } as any },
  );
  const accountError = !accountId ? undefined
    : accountsError ? `Konta »${accountId}« ni mogoče preveriti, ker nalaganje kontov ni uspelo. Poskusite znova osvežiti stran ali izberite »Vsi konti«.`
    : !accountsData || accountsPlaceholder ? `Preverjanje konta »${accountId}« še poteka. Počakajte, da se naloži seznam kontov, ali izberite »Vsi konti«.`
    : accountsData.accounts.some((account) => account.id === accountId) ? undefined
    : `Konto »${accountId}« ne obstaja v izbranem podjetju ali je bil izbrisan. Izberite veljaven konto ali »Vsi konti«.`;
  const errors = { ...filterErrors, accountId: accountError };
  const isValid = filtersValid && !accountError;

  // Fetch report data (always request account breakdown)
  const report = useGetDimensionReport(
    companyId,
    {
      ...(isValid ? reportParams : undefined),
      groupBy: "account",
    },
    { query: { enabled: !!companyId && applied.queried && isValid } as any },
  );
  // Disabled queries can still expose cached results. Never show or export them
  // while the URL is invalid, including during history navigation.
  const data = isValid ? report.data : undefined;
  const isLoading = isValid && report.isLoading;
  const error = isValid && report.error;

  // Filters update the URL immediately. Keep CSV data and metadata together
  // while the request for the next valid view is pending (or fails).
  const dimensionLabel = (DIM_OPTIONS.find((d) => d.value === applied.dimensionType) ?? DIM_OPTIONS[0]).label;
  const accountLabel = applied.accountId
    ? accountsData?.accounts.find((account) => account.id === applied.accountId)?.code
    : undefined;
  const [csvReport, setCsvReport] = useState<{
    data: NonNullable<typeof data>;
    dimensionLabel: string;
    dateFrom: string;
    dateTo: string;
    accountLabel?: string;
  } | null>(null);
  useEffect(() => {
    if (data && applied.queried && !report.isPlaceholderData) {
      setCsvReport({
        data, dimensionLabel, dateFrom: applied.dateFrom, dateTo: applied.dateTo, accountLabel,
      });
    }
  }, [data, applied.queried, report.isPlaceholderData, dimensionLabel, applied.dateFrom, applied.dateTo, accountLabel]);

  const expandableRows = (data?.rows ?? []).filter((row) => (row.accounts?.length ?? 0) > 0);
  const allExpanded = expandableRows.length > 0 && expandableRows.every((row) => expandedRows.has(row.id));

  function toggleAllRows() {
    setExpandedRows(allExpanded ? new Set() : new Set(expandableRows.map((row) => row.id)));
  }

  function handleGenerate() {
    updateFilters();
    setExpandedRows(new Set());
  }

  function handlePrint() {
    window.print();
  }

  async function handleExcelExport() {
    if (!data || excelExporting) return;
    setExcelExporting(true);
    setExcelError(null);
    try {
      const options = {
        rows: data.rows,
        grandTotalDebit: data.grandTotalDebit,
        grandTotalCredit: data.grandTotalCredit,
        grandTotalBalance: data.grandTotalBalance,
        untagged: data.untaggedLines.length > 0 ? {
          debit: data.untaggedDebit,
          credit: data.untaggedCredit,
          balance: data.untaggedBalance,
        } : undefined,
        dimensionLabel: dimOption.label,
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        accountLabel: applied.accountId
          ? (accountsData?.accounts ?? []).find((a) => a.id === applied.accountId)?.code ?? applied.accountId
          : undefined,
        companyName: activeCompany?.naziv,
      };
      const { exportDimensionReportExcel } = await import("@/lib/dimensionReportExcel");
      await exportDimensionReportExcel(options);
    } catch {
      setExcelError("Izvoz v Excel ni uspel. Poskusite znova.");
    } finally {
      setExcelExporting(false);
    }
  }

  const dimOption = DIM_OPTIONS.find((d) => d.value === applied.dimensionType) ?? DIM_OPTIONS[0];
  const DimIcon = dimOption.icon;

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">
            Analitično računovodstvo
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Promet in saldo po stroškovnih mestih, projektih ali oddelkih za izbrano obdobje.
        </p>
        {activeCompany && <p className="text-sm font-medium mt-2">Podjetje: {activeCompany.naziv}</p>}
      </div>

      {!companyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ni izbranega podjetja</AlertTitle>
          <AlertDescription>Izberite podjetje za nadaljevanje.</AlertDescription>
        </Alert>
      )}

      {/* Filter bar */}
      {!isValid && (
        <Alert variant="destructive" id="dimension-filter-errors">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Neveljavni filtri poročila</AlertTitle>
          <AlertDescription>
            <p>Poročilo ni prikazano. Popravite filtre spodaj.</p>
            <ul className="list-disc pl-5">
              {Object.entries(errors).map(([key, message]) => message && <li key={key}>{message}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Dimension type */}
          <div className="space-y-1.5">
            <Label htmlFor="dimension-type" className="text-xs">Dimenzija</Label>
            <Select
              value={errors.dimensionType ? "" : dimensionType}
              onValueChange={(v) => updateFilters({ dimensionType: v as DimensionType })}
            >
              <SelectTrigger id="dimension-type" aria-invalid={!!errors.dimensionType} aria-describedby={errors.dimensionType ? "dimension-filter-errors" : undefined} className="h-9 text-sm">
                <SelectValue placeholder="Izberite veljavno dimenzijo" />
              </SelectTrigger>
              <SelectContent>
                {DIM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="space-y-1.5">
            <Label htmlFor="dimension-date-from" className="text-xs">Obdobje od</Label>
            <Input
              id="dimension-date-from"
              aria-invalid={!!(errors.dateFrom || errors.period)}
              aria-describedby={errors.dateFrom || errors.period ? "dimension-filter-errors" : undefined}
              type="date"
              value={dateFrom}
              onChange={(e) => updateFilters({ dateFrom: e.target.value })}
              className="h-9 text-sm"
            />
          </div>

          {/* Date to */}
          <div className="space-y-1.5">
            <Label htmlFor="dimension-date-to" className="text-xs">Obdobje do</Label>
            <Input
              id="dimension-date-to"
              aria-invalid={!!(errors.dateTo || errors.period)}
              aria-describedby={errors.dateTo || errors.period ? "dimension-filter-errors" : undefined}
              type="date"
              value={dateTo}
              onChange={(e) => updateFilters({ dateTo: e.target.value })}
              className="h-9 text-sm"
            />
          </div>

          {/* Action */}
          <div className="flex flex-wrap gap-2 items-end lg:col-span-2">
            <Button
              onClick={handleGenerate}
              disabled={!companyId || !isValid}
              className="h-9 flex-1"
            >
              Prikaži poročilo
            </Button>
            {applied.queried && isValid && csvReport && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={() =>
                    exportCsv(
                      csvReport.data.rows,
                      csvReport.data.grandTotalDebit,
                      csvReport.data.grandTotalCredit,
                      csvReport.data.grandTotalBalance,
                      csvReport.dimensionLabel,
                      csvReport.dateFrom,
                      csvReport.dateTo,
                      csvReport.accountLabel,
                    )
                  }
                  title="Izvozi v CSV"
                >
                  <Download className="h-4 w-4" />
                </Button>
            )}
            {applied.queried && data && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 print:hidden"
                  onClick={handleExcelExport}
                  disabled={excelExporting}
                  title="Izvozi v Excel"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {excelExporting ? "Izvažam …" : "Izvozi v Excel"}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={handlePrint}
                  title="Natisni"
                >
                  <Printer className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Account filter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dimension-account" className="text-xs">Konto (neobvezno)</Label>
            <Select
              value={accountError ? "" : accountId || "_all"}
              onValueChange={(v) => updateFilters({ accountId: v === "_all" ? "" : v })}
            >
              <SelectTrigger id="dimension-account" aria-invalid={!!accountError} aria-describedby={accountError ? "dimension-filter-errors" : undefined} className="h-9 text-sm">
                <SelectValue placeholder={accountError ? "Izberite veljaven konto" : "Vsi konti"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Vsi konti</SelectItem>
                {(accountsData?.accounts ?? []).map((acc: any) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.code} — {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick presets */}
          <div className="flex gap-2 items-end col-span-1 sm:col-span-3">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                const y = new Date().getFullYear();
                updateFilters({ dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` });
              }}
            >
              Tekoče leto
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                const y = new Date().getFullYear() - 1;
                updateFilters({ dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` });
              }}
            >
              Preteklo leto
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = now.getMonth() + 1;
                const firstDay = `${y}-${String(m).padStart(2, "0")}-01`;
                // Lokalni zadnji dan — ne toISOString(), ki pri UTC+2 da prejšnji dan
                const _ld = new Date(y, m, 0);
                const lastDay = `${_ld.getFullYear()}-${String(_ld.getMonth() + 1).padStart(2, "0")}-${String(_ld.getDate()).padStart(2, "0")}`;
                updateFilters({ dateFrom: firstDay, dateTo: lastDay });
              }}
            >
              Tekoči mesec
            </Button>
          </div>
        </div>
      </div>

      {excelError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri izvozu</AlertTitle>
          <AlertDescription>{excelError}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Napaka pri nalaganju poročila.</AlertDescription>
        </Alert>
      )}

      {/* Untagged lines warning */}
      {data && applied.queried && data.untaggedLines.length > 0 && (
        <Alert variant="destructive" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-semibold">Poročilo ni popolno — obstajajo knjižbe brez dimenzije</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              V izbranem obdobju je{" "}
              <strong>
                {fmt(data.untaggedBalance)} EUR
              </strong>{" "}
              neto salda iz vrstic, ki niso označene z dimenzijo{" "}
              <strong>{DIM_OPTIONS.find((d) => d.value === applied.dimensionType)?.label ?? applied.dimensionType}</strong>.
              Te vrstice so izključene iz poročila.
            </p>
            <p className="text-xs opacity-80">
              Debet brez dimenzije: {fmt(data.untaggedDebit)} EUR · Kredit brez dimenzije: {fmt(data.untaggedCredit)} EUR
            </p>
            <Table aria-label="Knjižbe brez dimenzije">
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Temeljnica</TableHead>
                  <TableHead>Konto / opis vrstice</TableHead>
                  <TableHead className="text-right">Debet (EUR)</TableHead>
                  <TableHead className="text-right">Kredit (EUR)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(showAllUntagged ? data.untaggedLines : data.untaggedLines.slice(0, 20)).map((line) => (
                  <TableRow key={line.lineId}>
                    <TableCell className="whitespace-nowrap">{formatDatum(line.entryDate)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/temeljnice?id=${encodeURIComponent(line.entryId)}`}
                        className="font-medium underline underline-offset-2"
                        aria-label={`Odpri temeljnico ${line.reference || line.entryDescription}`}
                      >
                        {line.reference || line.entryDescription}
                      </Link>
                      {line.reference && <div className="text-xs">{line.entryDescription}</div>}
                    </TableCell>
                    <TableCell>
                      <div>{line.accountCode} — {line.accountName}</div>
                      {line.description && <div className="text-xs">{line.description}</div>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {line.side === "debit" ? fmt(line.amount) : "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {line.side === "credit" ? fmt(line.amount) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.untaggedLines.length > 20 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span>
                  Prikazanih {showAllUntagged ? data.untaggedLines.length : 20} od {data.untaggedLines.length} vrstic.
                </span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-inherit print:hidden"
                  onClick={() => setShowAllUntagged((value) => !value)}
                  aria-expanded={showAllUntagged}
                >
                  {showAllUntagged ? "Prikaži manj" : "Prikaži vse"}
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Report table */}
      {data && applied.queried && (
        <div className="space-y-4">
          {/* Print header */}
          <div className="hidden print:block text-center mb-6">
            <h1 className="text-xl font-bold">{activeCompany?.naziv}</h1>
            <h2 className="text-lg font-semibold mt-1">
              ANALITIČNO RAČUNOVODSTVO — {dimOption.label.toUpperCase()}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Obdobje: {formatDatum(applied.dateFrom)} – {formatDatum(applied.dateTo)}
              {applied.accountId && ` | Konto: ${applied.accountId}`}
            </p>
          </div>

          {/* Summary badges */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <DimIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{dimOption.label}</span>
            </div>
            <Badge variant="outline" className="text-xs">
              Debet skupaj: {fmt(data.grandTotalDebit)} EUR
            </Badge>
            <Badge variant="outline" className="text-xs">
              Kredit skupaj: {fmt(data.grandTotalCredit)} EUR
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs font-semibold ${balanceColor(data.grandTotalBalance)}`}
            >
              Saldo: {fmt(data.grandTotalBalance)} EUR
            </Badge>
            {applied.dateFrom && applied.dateTo && (
              <span className="text-xs text-muted-foreground ml-auto print:hidden">
                {formatDatum(applied.dateFrom)} – {formatDatum(applied.dateTo)}
              </span>
            )}
          </div>

          {expandableRows.length > 0 && (
            <div className="flex justify-end print:hidden">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAllRows}
                aria-expanded={allExpanded}
              >
                {allExpanded ? <ChevronDown className="h-4 w-4 mr-2" /> : <ChevronRight className="h-4 w-4 mr-2" />}
                {allExpanded ? "Strni vse" : "Razširi vse"}
              </Button>
            </div>
          )}

          {/* Table */}
          {data.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Ni knjižb z dimenzijami za izbrane filtre.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Preverite, ali so temeljnice že potrjene in ali so vrstice označene z dimenzijami.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-8 print:hidden" />
                    <TableHead className="w-28 font-semibold">Koda</TableHead>
                    <TableHead className="font-semibold">Naziv</TableHead>
                    <TableHead className="text-right font-semibold min-w-[120px]">
                      Debet (EUR)
                    </TableHead>
                    <TableHead className="text-right font-semibold min-w-[120px]">
                      Kredit (EUR)
                    </TableHead>
                    <TableHead className="text-right font-semibold min-w-[120px]">
                      Saldo (EUR)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row: DimensionReportRow) => {
                    const hasAccounts = (row.accounts?.length ?? 0) > 0;
                    const isExpanded = expandedRows.has(row.id);
                    return (
                      <React.Fragment key={row.id}>
                        {/* Dimension row */}
                        <TableRow
                          className={`hover:bg-muted/30 transition-colors ${hasAccounts ? "cursor-pointer" : ""}`}
                          onClick={hasAccounts ? () => toggleRow(row.id) : undefined}
                        >
                          <TableCell className="print:hidden w-8 pl-3 pr-0">
                            {hasAccounts ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? "Strni" : "Razširi"} dimenzijo ${row.code} – ${row.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleRow(row.id);
                                }}
                              >
                                {isExpanded ? (
                                  <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-sm font-medium">
                            {row.code}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmt(row.totalDebit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmt(row.totalCredit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            <div className="flex items-center justify-end gap-1.5">
                              <BalanceIcon val={row.balance} />
                              <span className={`font-semibold ${balanceColor(row.balance)}`}>
                                {fmt(row.balance)}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Account breakdown sub-rows */}
                        {isExpanded && row.accounts?.map((acc: AccountBreakdownRow) => (
                          <TableRow
                            key={acc.accountId}
                            className="bg-muted/20 hover:bg-muted/40 transition-colors"
                          >
                            <TableCell className="print:hidden w-8" />
                            <TableCell className="pl-8 font-mono text-xs text-muted-foreground">
                              {acc.code}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground pl-4">
                              {acc.name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {fmt(acc.totalDebit)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {fmt(acc.totalCredit)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              <span className={`${balanceColor(acc.balance)}`}>
                                {fmt(acc.balance)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Grand total footer */}
              <div className="border-t border-border bg-muted/50 px-4 py-3 flex flex-wrap gap-4 justify-between items-center">
                <span className="text-sm font-bold uppercase tracking-wide">
                  Skupaj ({data.rows.length}{" "}
                  {data.rows.length === 1
                    ? "vrstica"
                    : data.rows.length < 5
                    ? "vrstice"
                    : "vrstic"}
                  )
                </span>
                <div className="flex flex-wrap gap-6 items-center">
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground mb-0.5">Debet</div>
                    <div className="text-sm font-semibold tabular-nums">
                      {fmt(data.grandTotalDebit)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground mb-0.5">Kredit</div>
                    <div className="text-sm font-semibold tabular-nums">
                      {fmt(data.grandTotalCredit)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground mb-0.5">Saldo</div>
                    <div
                      className={`text-sm font-bold tabular-nums ${balanceColor(data.grandTotalBalance)}`}
                    >
                      {fmt(data.grandTotalBalance)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Prompt to generate */}
      {!applied.queried && !isLoading && companyId && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Izberite dimenzijo in obdobje ter kliknite <strong>Prikaži poročilo</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
