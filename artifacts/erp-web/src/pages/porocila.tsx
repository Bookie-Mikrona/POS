import React, { useState, useRef, useCallback } from "react";
import {
  FileText,
  AlertCircle,
  Printer,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
} from "lucide-react";
import {
  useGetBalanceSheet,
  useGetIncomeStatement,
  useListPeriods,
  useGetTrialBalance,
  type ReportSection,
  type BalanceSheetData,
  type IncomeStatementData,
  type TrialBalanceRow,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function prevYearEnd() {
  return `${new Date().getFullYear() - 1}-12-31`;
}

function prevYearStart() {
  return `${new Date().getFullYear() - 1}-01-01`;
}

// ── PDF export ────────────────────────────────────────────────────────────────

async function exportToPdf(opts: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  companyName: string;
  reportTitle: string;
  subtitle: string;
  filename: string;
}) {
  const { contentRef, companyName, reportTitle, subtitle, filename } = opts;
  if (!contentRef.current) return;

  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const element = contentRef.current;

  // Snapshot without interactive chrome (collapse buttons hidden)
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });

  const PAGE_W = 210; // A4 mm
  const PAGE_H = 297;
  const MARGIN = 14;
  const HEADER_H = 28; // mm reserved for header on first page
  const HEADER_H_CONT = 12; // mm reserved for header on continuation pages
  const FOOTER_H = 10;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const imgW = PAGE_W - MARGIN * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const printableH = PAGE_H - MARGIN - FOOTER_H;

  let remainingH = imgH;
  let sourceY = 0;
  let pageNum = 1;

  const drawHeader = (isFirst: boolean) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(isFirst ? 13 : 9);
    pdf.setTextColor(30, 30, 30);
    if (isFirst) {
      pdf.text(companyName, MARGIN, MARGIN + 5);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(reportTitle, MARGIN, MARGIN + 11);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(subtitle, MARGIN, MARGIN + 17);
      pdf.setDrawColor(200, 200, 200);
      pdf.line(MARGIN, MARGIN + 20, PAGE_W - MARGIN, MARGIN + 20);
    } else {
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${companyName} — ${reportTitle}`, MARGIN, MARGIN + 5);
      pdf.setDrawColor(200, 200, 200);
      pdf.line(MARGIN, MARGIN + 7, PAGE_W - MARGIN, MARGIN + 7);
    }
    pdf.setTextColor(30, 30, 30);
  };

  const drawFooter = (page: number, total: number) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(150, 150, 150);
    const genDate = new Date().toLocaleDateString("sl-SI", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    pdf.text(`Generirano: ${genDate}`, MARGIN, PAGE_H - MARGIN + 4);
    pdf.text(`Stran ${page} / ${total}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 4, { align: "right" });
    pdf.setTextColor(30, 30, 30);
  };

  // Calculate total pages
  const firstPageH = printableH - MARGIN - HEADER_H;
  const contPageH = printableH - MARGIN - HEADER_H_CONT;
  let totalPages = 1;
  let rem = imgH - firstPageH;
  while (rem > 0) {
    totalPages++;
    rem -= contPageH;
  }

  // Render pages
  while (remainingH > 0) {
    const isFirst = pageNum === 1;
    const headerH = isFirst ? HEADER_H : HEADER_H_CONT;
    const contentStartY = MARGIN + headerH;
    const availableH = printableH - contentStartY;

    const sliceH = Math.min(remainingH, availableH);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = (sliceH / imgH) * canvas.height;
    const ctx = sliceCanvas.getContext("2d")!;
    ctx.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceCanvas.height,
      0,
      0,
      canvas.width,
      sliceCanvas.height,
    );

    const sliceDataUrl = sliceCanvas.toDataURL("image/png");

    drawHeader(isFirst);
    pdf.addImage(sliceDataUrl, "PNG", MARGIN, contentStartY, imgW, sliceH);
    drawFooter(pageNum, totalPages);

    sourceY += sliceCanvas.height;
    remainingH -= sliceH;

    if (remainingH > 0) {
      pdf.addPage();
      pageNum++;
    }
  }

  pdf.save(filename);
}

// ── Collapsible section row ───────────────────────────────────────────────────

function SectionBlock({
  section,
  compareSection,
  showCompare,
}: {
  section: ReportSection;
  compareSection?: ReportSection | null;
  showCompare: boolean;
}) {
  const [open, setOpen] = useState(true);
  const subtotal = parseFloat(section.subtotal);
  const cmpSubtotal = compareSection ? parseFloat(compareSection.subtotal) : null;

  return (
    <div className="mb-1">
      {/* Section header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-left group"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground">{section.label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground min-w-[110px] text-right">
          {fmt(subtotal)}
        </span>
        {showCompare && (
          <span className="text-sm tabular-nums text-muted-foreground min-w-[110px] text-right">
            {cmpSubtotal !== null ? fmt(cmpSubtotal) : "—"}
          </span>
        )}
      </button>

      {/* Account lines */}
      {open && (
        <div className="mt-0.5 ml-5 border-l border-border/40 pl-3 space-y-px">
          {section.items.map((item) => {
            const cmpItem = compareSection?.items.find((ci) => ci.accountId === item.accountId);
            return (
              <div
                key={item.accountId}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground w-16 flex-shrink-0">
                  {item.accountCode}
                </span>
                <span className="flex-1 text-sm text-foreground truncate">{item.accountName}</span>
                <span className="text-sm tabular-nums text-foreground min-w-[110px] text-right">
                  {fmt(item.balance)}
                </span>
                {showCompare && (
                  <span className="text-sm tabular-nums text-muted-foreground min-w-[110px] text-right">
                    {cmpItem ? fmt(cmpItem.balance) : "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Total row ─────────────────────────────────────────────────────────────────

function TotalRow({
  label,
  value,
  compareValue,
  showCompare,
  highlight = false,
  size = "normal",
}: {
  label: string;
  value: string;
  compareValue?: string | null;
  showCompare: boolean;
  highlight?: boolean;
  size?: "normal" | "large";
}) {
  const n = parseFloat(value);
  const isPositive = n > 0;
  const isNegative = n < 0;
  const valueColor = highlight
    ? isPositive
      ? "text-emerald-600 dark:text-emerald-400"
      : isNegative
      ? "text-red-600 dark:text-red-400"
      : "text-foreground"
    : "text-foreground";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 rounded-md border ${
        size === "large"
          ? "bg-foreground/5 border-border font-bold"
          : "bg-muted/30 border-border/50 font-semibold"
      }`}
    >
      <span className={`flex-1 ${size === "large" ? "text-base" : "text-sm"}`}>{label}</span>
      {highlight && (
        <span className="mr-1">
          {isPositive ? (
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          ) : isNegative ? (
            <TrendingDown className="h-4 w-4 text-red-500" />
          ) : (
            <Minus className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      )}
      <span className={`tabular-nums min-w-[110px] text-right ${size === "large" ? "text-base" : "text-sm"} ${valueColor}`}>
        {fmt(value)}
      </span>
      {showCompare && (
        <span className="tabular-nums text-muted-foreground min-w-[110px] text-right text-sm">
          {compareValue != null ? fmt(compareValue) : "—"}
        </span>
      )}
    </div>
  );
}

// ── Balance Sheet tab ─────────────────────────────────────────────────────────

function BalanceSheetTab() {
  const { activeCompany } = useCompany();

  const [asOf, setAsOf] = useState(todayStr());
  const [compareAsOf, setCompareAsOf] = useState(prevYearEnd());
  const [enableCompare, setEnableCompare] = useState(false);

  const [appliedAsOf, setAppliedAsOf] = useState(todayStr());
  const [appliedCompareAsOf, setAppliedCompareAsOf] = useState<string | undefined>(undefined);
  const [queried, setQueried] = useState(false);

  const { data, isLoading, error } = useGetBalanceSheet(
    activeCompany?.id ?? "",
    {
      asOf: appliedAsOf,
      ...(appliedCompareAsOf ? { compareAsOf: appliedCompareAsOf } : {}),
    },
    { query: { enabled: !!activeCompany?.id && queried } as any },
  );

  const printRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  function handleGenerate() {
    setAppliedAsOf(asOf);
    setAppliedCompareAsOf(enableCompare ? compareAsOf : undefined);
    setQueried(true);
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!data) return;
    setPdfLoading(true);
    try {
      const subtitle = appliedCompareAsOf
        ? `Stanje na dan: ${appliedAsOf}  |  Primerjava: ${appliedCompareAsOf}`
        : `Stanje na dan: ${appliedAsOf}`;
      await exportToPdf({
        contentRef: printRef,
        companyName: activeCompany?.naziv ?? "Podjetje",
        reportTitle: "BILANCA STANJA",
        subtitle,
        filename: `bilanca-stanja-${appliedAsOf}.pdf`,
      });
    } finally {
      setPdfLoading(false);
    }
  }

  const showCompare = !!data?.compare;
  const current = data?.current;
  const compare = data?.compare;

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Stanje na dan</Label>
            <Input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCompare}
                onChange={(e) => setEnableCompare(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">Primerjaj z</span>
            </label>
          </div>
          {enableCompare && (
            <div className="space-y-1.5">
              <Label className="text-xs">Primerjalni datum</Label>
              <Input
                type="date"
                value={compareAsOf}
                onChange={(e) => setCompareAsOf(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          )}
          <div className="flex gap-2 items-end">
            <Button onClick={handleGenerate} className="h-9 flex-1">
              Prikaži poročilo
            </Button>
            {queried && data && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={handlePrint}
                  title="Natisni"
                >
                  <Printer className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-9 gap-1.5 print:hidden"
                  onClick={handleDownloadPdf}
                  disabled={pdfLoading}
                  title="Prenesi PDF"
                >
                  {pdfLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="text-sm">Prenesi PDF</span>
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => { setAsOf(todayStr()); setEnableCompare(true); setCompareAsOf(prevYearEnd()); }}
          >
            Tekočo leto vs. prejšnje
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => { setAsOf(prevYearEnd()); setEnableCompare(false); }}
          >
            Konec preteklega leta
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && <Skeleton className="h-64 w-full" />}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Napaka pri nalaganju bilance stanja.</AlertDescription>
        </Alert>
      )}

      {/* Report */}
      {data && current && (
        <div ref={printRef} className="space-y-6">
          {/* Print header */}
          <div className="hidden print:block text-center mb-6">
            <h1 className="text-xl font-bold">{activeCompany?.naziv}</h1>
            <h2 className="text-lg font-semibold mt-1">BILANCA STANJA</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Stanje na dan: {appliedAsOf}
              {showCompare && ` | Primerjava: ${appliedCompareAsOf}`}
            </p>
          </div>

          {/* Column headers */}
          {showCompare && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span className="flex-1"></span>
              <span className="min-w-[110px] text-right">{appliedAsOf}</span>
              <span className="min-w-[110px] text-right">{appliedCompareAsOf}</span>
            </div>
          )}

          {/* AKTIVA */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-bold tracking-tight">AKTIVA</h3>
              <Badge variant="outline" className="text-xs">
                Skupaj: {fmt(current.aktiva.total)} EUR
              </Badge>
            </div>
            {current.aktiva.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3">Ni knjiženih postavk na aktivnih kontih.</p>
            ) : (
              current.aktiva.sections.map((sec) => (
                <SectionBlock
                  key={sec.class}
                  section={sec}
                  compareSection={compare?.aktiva.sections.find((s) => s.class === sec.class)}
                  showCompare={showCompare}
                />
              ))
            )}
            <TotalRow
              label="SKUPAJ AKTIVA"
              value={current.aktiva.total}
              compareValue={compare?.aktiva.total}
              showCompare={showCompare}
              size="large"
            />
          </div>

          <div className="border-t border-border my-4" />

          {/* PASIVA */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-bold tracking-tight">PASIVA</h3>
              <Badge variant="outline" className="text-xs">
                Skupaj: {fmt(current.pasiva.total)} EUR
              </Badge>
            </div>
            {current.pasiva.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3">Ni knjiženih postavk na pasivnih kontih.</p>
            ) : (
              current.pasiva.sections.map((sec) => (
                <SectionBlock
                  key={sec.class}
                  section={sec}
                  compareSection={compare?.pasiva.sections.find((s) => s.class === sec.class)}
                  showCompare={showCompare}
                />
              ))
            )}
            <TotalRow
              label="SKUPAJ PASIVA"
              value={current.pasiva.total}
              compareValue={compare?.pasiva.total}
              showCompare={showCompare}
              size="large"
            />
          </div>

          {/* Balance check */}
          {(() => {
            const diff = Math.abs(parseFloat(current.aktiva.total) - parseFloat(current.pasiva.total));
            if (diff > 0.01) {
              return (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Bilanca se ne ujema</AlertTitle>
                  <AlertDescription>
                    Razlika med aktivo in pasivo: {fmt(diff.toFixed(2))} EUR. Preverite knjižbe.
                  </AlertDescription>
                </Alert>
              );
            }
            return (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                <span className="font-medium">✓ Bilanca uravnotežena</span>
                <span className="text-emerald-600/70 dark:text-emerald-400/70 text-xs">
                  (Aktiva = Pasiva = {fmt(current.aktiva.total)} EUR)
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {!queried && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Izberite datum in kliknite »Prikaži poročilo«.</p>
        </div>
      )}
    </div>
  );
}

// ── Income Statement tab ──────────────────────────────────────────────────────

function IncomeStatementTab() {
  const { activeCompany } = useCompany();

  const [dateFrom, setDateFrom] = useState(yearStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [compareDateFrom, setCompareDateFrom] = useState(prevYearStart());
  const [compareDateTo, setCompareDateTo] = useState(prevYearEnd());
  const [enableCompare, setEnableCompare] = useState(false);

  const [applied, setApplied] = useState<{
    dateFrom?: string;
    dateTo?: string;
    compareDateFrom?: string;
    compareDateTo?: string;
  } | null>(null);
  const [queried, setQueried] = useState(false);

  const { data, isLoading, error } = useGetIncomeStatement(
    activeCompany?.id ?? "",
    applied ?? {},
    { query: { enabled: !!activeCompany?.id && queried } as any },
  );

  const printRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  function handleGenerate() {
    setApplied({
      dateFrom,
      dateTo,
      ...(enableCompare ? { compareDateFrom, compareDateTo } : {}),
    });
    setQueried(true);
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!data || !applied) return;
    setPdfLoading(true);
    try {
      const subtitle = applied.compareDateFrom
        ? `Obdobje: ${applied.dateFrom} – ${applied.dateTo}  |  Primerjava: ${applied.compareDateFrom} – ${applied.compareDateTo}`
        : `Obdobje: ${applied.dateFrom} – ${applied.dateTo}`;
      await exportToPdf({
        contentRef: printRef,
        companyName: activeCompany?.naziv ?? "Podjetje",
        reportTitle: "IZKAZ POSLOVNEGA IZIDA",
        subtitle,
        filename: `izkaz-poslovnega-izida-${applied.dateFrom}-${applied.dateTo}.pdf`,
      });
    } finally {
      setPdfLoading(false);
    }
  }

  const showCompare = !!data?.compare;
  const current = data?.current;
  const compare = data?.compare;

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Od datuma</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Do datuma</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCompare}
                onChange={(e) => setEnableCompare(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">Primerja obdobja</span>
            </label>
          </div>
          <div className="flex gap-2 items-end">
            <Button onClick={handleGenerate} className="h-9 flex-1">
              Prikaži poročilo
            </Button>
            {queried && data && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={handlePrint}
                  title="Natisni"
                >
                  <Printer className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-9 gap-1.5 print:hidden"
                  onClick={handleDownloadPdf}
                  disabled={pdfLoading}
                  title="Prenesi PDF"
                >
                  {pdfLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="text-sm">Prenesi PDF</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {enableCompare && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-border/50">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Primerjava od</Label>
              <Input
                type="date"
                value={compareDateFrom}
                onChange={(e) => setCompareDateFrom(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Primerjava do</Label>
              <Input
                type="date"
                value={compareDateTo}
                onChange={(e) => setCompareDateTo(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setDateFrom(yearStart());
              setDateTo(todayStr());
              setEnableCompare(true);
              setCompareDateFrom(prevYearStart());
              setCompareDateTo(prevYearEnd());
            }}
          >
            Tekočo leto vs. prejšnje
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setDateFrom(yearStart());
              setDateTo(todayStr());
              setEnableCompare(false);
            }}
          >
            Tekoče leto
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setDateFrom(prevYearStart());
              setDateTo(prevYearEnd());
              setEnableCompare(false);
            }}
          >
            Preteklo leto
          </Button>
        </div>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Napaka pri nalaganju izkaza poslovnega izida.</AlertDescription>
        </Alert>
      )}

      {data && current && (
        <div ref={printRef} className="space-y-5">
          {/* Print header */}
          <div className="hidden print:block text-center mb-6">
            <h1 className="text-xl font-bold">{activeCompany?.naziv}</h1>
            <h2 className="text-lg font-semibold mt-1">IZKAZ POSLOVNEGA IZIDA</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Obdobje: {applied?.dateFrom} – {applied?.dateTo}
              {showCompare && ` | Primerjava: ${applied?.compareDateFrom} – ${applied?.compareDateTo}`}
            </p>
          </div>

          {/* Column headers */}
          {showCompare && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span className="flex-1"></span>
              <span className="min-w-[110px] text-right">
                {applied?.dateFrom} – {applied?.dateTo}
              </span>
              <span className="min-w-[110px] text-right">
                {applied?.compareDateFrom} – {applied?.compareDateTo}
              </span>
            </div>
          )}

          {/* PRIHODKI */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-bold tracking-tight">PRIHODKI</h3>
              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                {fmt(current.revenue.total)} EUR
              </Badge>
            </div>
            {current.revenue.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3">Ni knjiženih prihodkov v izbranem obdobju.</p>
            ) : (
              current.revenue.sections.map((sec) => (
                <SectionBlock
                  key={sec.class}
                  section={sec}
                  compareSection={compare?.revenue.sections.find((s) => s.class === sec.class)}
                  showCompare={showCompare}
                />
              ))
            )}
            <TotalRow
              label="SKUPAJ PRIHODKI"
              value={current.revenue.total}
              compareValue={compare?.revenue.total}
              showCompare={showCompare}
            />
          </div>

          <div className="border-t border-border my-2" />

          {/* ODHODKI */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-bold tracking-tight">ODHODKI</h3>
              <Badge variant="outline" className="text-xs text-red-600 border-red-300">
                {fmt(current.expenses.total)} EUR
              </Badge>
            </div>
            {current.expenses.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3">Ni knjiženih odhodkov v izbranem obdobju.</p>
            ) : (
              current.expenses.sections.map((sec) => (
                <SectionBlock
                  key={sec.class}
                  section={sec}
                  compareSection={compare?.expenses.sections.find((s) => s.class === sec.class)}
                  showCompare={showCompare}
                />
              ))
            )}
            <TotalRow
              label="SKUPAJ ODHODKI"
              value={current.expenses.total}
              compareValue={compare?.expenses.total}
              showCompare={showCompare}
            />
          </div>

          <div className="border-t-2 border-border mt-4 pt-2" />

          {/* NET RESULT */}
          <TotalRow
            label="POSLOVNI IZID OBDOBJA"
            value={current.netResult}
            compareValue={compare?.netResult}
            showCompare={showCompare}
            highlight={true}
            size="large"
          />

          {/* Margin indicator */}
          {(() => {
            const rev = parseFloat(current.revenue.total);
            const net = parseFloat(current.netResult);
            if (rev === 0) return null;
            const margin = ((net / rev) * 100).toFixed(1);
            return (
              <div className="text-xs text-muted-foreground px-3">
                Marža poslovnega izida: <span className="font-medium">{margin}%</span>
              </div>
            );
          })()}
        </div>
      )}

      {!queried && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Izberite obdobje in kliknite »Prikaži poročilo«.</p>
        </div>
      )}
    </div>
  );
}

// ── Trial Balance (Preizkusna bilanca / Bruto bilanca) ────────────────────────

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Sredstva",
  liability: "Obveznosti",
  equity: "Kapital",
  revenue: "Prihodki",
  expense: "Odhodki",
};

function TrialBalanceTab() {
  const { activeCompany } = useCompany();
  const contentRef = useRef<HTMLDivElement>(null);

  const [dateFrom, setDateFrom] = useState(yearStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [queried, setQueried] = useState(false);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const [appliedFrom, setAppliedFrom] = useState(yearStart());
  const [appliedTo, setAppliedTo] = useState(todayStr());

  const { data, isFetching, isError, error } = useGetTrialBalance(
    activeCompany?.id ?? "",
    { dateFrom: appliedFrom, dateTo: appliedTo },
    { query: { enabled: !!activeCompany?.id && queried } as any },
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    setQueried(true);
  }

  const filtered: TrialBalanceRow[] = React.useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) => r.accountCode.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q),
    );
  }, [data, search]);

  async function handleExportPdf() {
    if (!data || !activeCompany) return;
    setExporting(true);
    try {
      await exportToPdf({
        contentRef,
        companyName: activeCompany.naziv ?? "Podjetje",
        reportTitle: "Bruto bilanca (preizkusna bilanca)",
        subtitle: `Obdobje: ${appliedFrom} – ${appliedTo}`,
        filename: `bruto-bilanca-${appliedFrom}-${appliedTo}.pdf`,
      });
    } finally {
      setExporting(false);
    }
  }

  const fmtZ = (v: string) => fmt(v) === "—" ? "—" : fmt(v);

  // Totals from data (unfiltered for accuracy)
  const totals = data
    ? {
        turnoverDebit: data.totalTurnoverDebit,
        turnoverCredit: data.totalTurnoverCredit,
        balanceDebit: data.totalBalanceDebit,
        balanceCredit: data.totalBalanceCredit,
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 bg-muted/40 rounded-lg p-4 print:hidden"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="tb-from" className="text-xs">Datum od</Label>
          <Input
            id="tb-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tb-to" className="text-xs">Datum do</Label>
          <Input
            id="tb-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-8 text-sm"
          />
        </div>
        <Button type="submit" size="sm" disabled={isFetching} className="h-8">
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Prikaži
        </Button>
        {queried && data && (
          <>
            <div className="flex flex-col gap-1 ml-auto">
              <Label htmlFor="tb-search" className="text-xs">Iskanje konta</Label>
              <Input
                id="tb-search"
                placeholder="Šifra ali naziv…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44 h-8 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={exporting}
              onClick={handleExportPdf}
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              PDF
            </Button>
          </>
        )}
      </form>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? "Poizvedba ni uspela."}
          </AlertDescription>
        </Alert>
      )}

      {isFetching && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}

      {queried && data && !isFetching && (
        <div ref={contentRef}>
          {/* Balance check badge */}
          <div className="flex items-center gap-3 mb-3 print:hidden">
            <span className="text-sm font-medium">Skupaj knjižbe:</span>
            {parseFloat(data.totalTurnoverDebit ?? "0").toFixed(2) ===
            parseFloat(data.totalTurnoverCredit ?? "0").toFixed(2) ? (
              <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
                ✓ Bilanca uravnotežena
              </Badge>
            ) : (
              <Badge variant="destructive">
                ✗ Bilanca ni uravnotežena
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} kontov
              {search ? ` (filter: ${data.rows.length} skupaj)` : ""}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60">
                  <th className="text-left px-3 py-2 font-semibold w-24">Šifra</th>
                  <th className="text-left px-3 py-2 font-semibold">Naziv konta</th>
                  <th colSpan={2} className="text-center px-3 py-2 font-semibold border-l border-border/50">
                    Promet v obdobju
                  </th>
                  <th colSpan={2} className="text-center px-3 py-2 font-semibold border-l border-border/50">
                    Saldo (kumulativno)
                  </th>
                </tr>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-1"></th>
                  <th className="px-3 py-1"></th>
                  <th className="text-right px-3 py-1 border-l border-border/50 font-medium">Breme</th>
                  <th className="text-right px-3 py-1 font-medium">Dobro</th>
                  <th className="text-right px-3 py-1 border-l border-border/50 font-medium">Breme</th>
                  <th className="text-right px-3 py-1 font-medium">Dobro</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={row.accountId}
                    className={
                      i % 2 === 0 ? "bg-background hover:bg-muted/30" : "bg-muted/10 hover:bg-muted/30"
                    }
                  >
                    <td className="px-3 py-1.5 font-mono text-xs tabular-nums">{row.accountCode}</td>
                    <td className="px-3 py-1.5 max-w-xs">
                      <span className="truncate block">{row.accountName}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {ACCOUNT_TYPE_LABELS[row.accountType] ?? row.accountType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums border-l border-border/30 text-blue-700 dark:text-blue-400">
                      {parseFloat(row.turnoverDebit) !== 0 ? fmtZ(row.turnoverDebit) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-blue-700 dark:text-blue-400">
                      {parseFloat(row.turnoverCredit) !== 0 ? fmtZ(row.turnoverCredit) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums border-l border-border/30 font-medium">
                      {parseFloat(row.balanceDebit) !== 0 ? fmtZ(row.balanceDebit) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {parseFloat(row.balanceCredit) !== 0 ? fmtZ(row.balanceCredit) : ""}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      Ni podatkov za izbrano obdobje.
                    </td>
                  </tr>
                )}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-muted/60 font-semibold border-t-2 border-border">
                    <td className="px-3 py-2 text-xs uppercase tracking-wide" colSpan={2}>
                      Skupaj
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-l border-border/50 text-blue-700 dark:text-blue-400">
                      {fmt(totals.turnoverDebit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-700 dark:text-blue-400">
                      {fmt(totals.turnoverCredit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-l border-border/50">
                      {fmt(totals.balanceDebit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(totals.balanceCredit)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Print header (hidden on screen) */}
          <div className="hidden print:block mb-4">
            <p className="text-base font-bold">{activeCompany?.naziv}</p>
            <p className="text-sm font-semibold">Bruto bilanca (preizkusna bilanca)</p>
            <p className="text-xs text-muted-foreground">Obdobje: {appliedFrom} – {appliedTo}</p>
          </div>
        </div>
      )}

      {!queried && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Izberite obdobje in kliknite »Prikaži«.</p>
        </div>
      )}
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function Porocila() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finančna poročila</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bilanca stanja, izkaz poslovnega izida in bruto bilanca kontov po SRS.
        </p>
      </div>

      <Tabs defaultValue="balance-sheet" className="space-y-5">
        <TabsList>
          <TabsTrigger value="balance-sheet">Bilanca stanja</TabsTrigger>
          <TabsTrigger value="income-statement">Izkaz poslovnega izida</TabsTrigger>
          <TabsTrigger value="trial-balance">Bruto bilanca</TabsTrigger>
        </TabsList>

        <TabsContent value="balance-sheet" className="mt-0">
          <BalanceSheetTab />
        </TabsContent>

        <TabsContent value="income-statement" className="mt-0">
          <IncomeStatementTab />
        </TabsContent>

        <TabsContent value="trial-balance" className="mt-0">
          <TrialBalanceTab />
        </TabsContent>
      </Tabs>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .max-w-5xl, .max-w-5xl * { visibility: visible; }
          .max-w-5xl { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
          .print\\:hidden { display: none !important; }
          button, [role="tablist"] { display: none !important; }
          input[type="date"], input[type="checkbox"] { display: none !important; }
          label { display: none !important; }
          .hidden.print\\:block { display: block !important; visibility: visible !important; }
        }
      `}</style>
    </div>
  );
}
