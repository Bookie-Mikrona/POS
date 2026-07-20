import React, { useState } from "react";
import {
  Layers,
  FolderOpen,
  Building,
  AlertCircle,
  Printer,
  Download,
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
import { useCompany } from "@/contexts/CompanyContext";

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

function exportCsv(
  rows: DimensionReportRow[],
  grandTotalDebit: string,
  grandTotalCredit: string,
  grandTotalBalance: string,
  dimensionLabel: string,
  dateFrom: string,
  dateTo: string,
  accountLabel?: string,
) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const num = (v: string) => v.replace(".", ","); // Slovenian decimal

  const lines: string[] = [];

  // Metadata header
  lines.push(escape(`Analitično računovodstvo — ${dimensionLabel}`));
  lines.push(escape(`Obdobje: ${dateFrom} – ${dateTo}${accountLabel ? ` | Konto: ${accountLabel}` : ""}`));
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
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
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";

  // Filter state (what the user is editing)
  const [dimensionType, setDimensionType] = useState<DimensionType>("costCenter");
  const [dateFrom, setDateFrom] = useState(yearStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [accountId, setAccountId] = useState<string>("");

  // Applied filter state (what was last queried)
  const [applied, setApplied] = useState<{
    dimensionType: DimensionType;
    dateFrom: string;
    dateTo: string;
    accountId: string;
    queried: boolean;
  }>({ dimensionType: "costCenter", dateFrom: yearStart(), dateTo: todayStr(), accountId: "", queried: false });

  // Expanded dimension rows (set of row ids)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Load accounts for filter dropdown
  const { data: accountsData } = useListAccounts(
    companyId,
    {},
    { query: { enabled: !!companyId } as any },
  );

  // Fetch report data (always request account breakdown)
  const { data, isLoading, error } = useGetDimensionReport(
    companyId,
    {
      dimensionType: applied.dimensionType,
      dateFrom: applied.dateFrom || undefined,
      dateTo: applied.dateTo || undefined,
      accountId: applied.accountId || undefined,
      groupBy: "account",
    },
    { query: { enabled: !!companyId && applied.queried } as any },
  );

  function handleGenerate() {
    setApplied({
      dimensionType,
      dateFrom,
      dateTo,
      accountId,
      queried: true,
    });
    setExpandedRows(new Set());
  }

  function handlePrint() {
    window.print();
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
      </div>

      {!companyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ni izbranega podjetja</AlertTitle>
          <AlertDescription>Izberite podjetje za nadaljevanje.</AlertDescription>
        </Alert>
      )}

      {/* Filter bar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Dimension type */}
          <div className="space-y-1.5">
            <Label className="text-xs">Dimenzija</Label>
            <Select
              value={dimensionType}
              onValueChange={(v) => setDimensionType(v as DimensionType)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
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
            <Label className="text-xs">Obdobje od</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Date to */}
          <div className="space-y-1.5">
            <Label className="text-xs">Obdobje do</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Action */}
          <div className="flex gap-2 items-end">
            <Button
              onClick={handleGenerate}
              disabled={!companyId}
              className="h-9 flex-1"
            >
              Prikaži poročilo
            </Button>
            {applied.queried && data && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={() =>
                    exportCsv(
                      data.rows,
                      data.grandTotalDebit,
                      data.grandTotalCredit,
                      data.grandTotalBalance,
                      dimOption.label,
                      applied.dateFrom,
                      applied.dateTo,
                      applied.accountId
                        ? (accountsData?.accounts ?? []).find((a: any) => a.id === applied.accountId)
                            ?.code
                        : undefined,
                    )
                  }
                  title="Izvozi v CSV"
                >
                  <Download className="h-4 w-4" />
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
            <Label className="text-xs">Konto (neobvezno)</Label>
            <Select
              value={accountId || "_all"}
              onValueChange={(v) => setAccountId(v === "_all" ? "" : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Vsi konti" />
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
                setDateFrom(`${y}-01-01`);
                setDateTo(`${y}-12-31`);
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
                setDateFrom(`${y}-01-01`);
                setDateTo(`${y}-12-31`);
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
                const lastDay = new Date(y, m, 0).toISOString().slice(0, 10);
                setDateFrom(firstDay);
                setDateTo(lastDay);
              }}
            >
              Tekoči mesec
            </Button>
          </div>
        </div>
      </div>

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
              Obdobje: {applied.dateFrom} – {applied.dateTo}
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
                {applied.dateFrom} – {applied.dateTo}
              </span>
            )}
          </div>

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
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )
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
