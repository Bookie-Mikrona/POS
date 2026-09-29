import React, { useState, useRef, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
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
  Mail,
  Send,
  X,
  CheckCircle2,
  History,
  RefreshCw,
  Sheet,
} from "lucide-react";
import ExcelJS from "exceljs";
import { LedgerStatementTable, type LedgerStatementView } from "@/components/reports/ledger-statement-table";
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

// Defined locally — backend adds these to responses but they are not yet in the
// generated OpenAPI schema (schema update pending in a future task).
interface AccountTypeWarning {
  accountId: string;
  code: string;
  name: string;
  storedType: string;
  effectiveType: string;
}

interface UnclassifiedAccount {
  accountId: string;
  code: string;
  name: string;
  storedType: string | null;
  reason: string;
  debit: number;
  credit: number;
  net: number;
}

type BalanceSheetDataWithWarnings = BalanceSheetData & {
  typeWarnings?: AccountTypeWarning[];
  unclassifiedAccounts?: UnclassifiedAccount[];
};

type IncomeStatementDataWithWarnings = IncomeStatementData & {
  typeWarnings?: AccountTypeWarning[];
  unclassifiedAccounts?: UnclassifiedAccount[];
};
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@clerk/react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

// ── Server-side PDF export & e-mail ──────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function serverExportPdf(opts: {
  companyId: string;
  params: Record<string, string | undefined>;
  reportType: "balance-sheet" | "income-statement" | "trial-balance";
  filename: string;
  token: string;
}): Promise<void> {
  const { companyId, params, reportType, filename, token } = opts;
  const res = await fetch(`${BASE}/api/companies/${companyId}/reports/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reportType, ...params }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function serverSendEmail(opts: {
  companyId: string;
  params: Record<string, string | undefined>;
  reportType: "balance-sheet" | "income-statement" | "trial-balance";
  email: string;
  token: string;
}): Promise<void> {
  const { companyId, params, reportType, email, token } = opts;
  const res = await fetch(`${BASE}/api/companies/${companyId}/reports/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reportType, email, ...params }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ── E-mail dialog ─────────────────────────────────────────────────────────────

function EmailDialog({
  open,
  onClose,
  onSend,
  loading,
  error,
  success,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (email: string) => void;
  loading: boolean;
  error: string | null;
  success: boolean;
}) {
  const [email, setEmail] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    onSend(email.trim());
  }

  // Reset email input when dialog closes
  React.useEffect(() => {
    if (!open) setEmail("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !loading) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Pošlji poročilo po e-pošti
          </DialogTitle>
          <DialogDescription>
            PDF bo generiran na strežniku in poslan neposredno na vpisani e-poštni naslov.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              E-pošta je bila uspešno poslana!
            </p>
            <Button variant="outline" onClick={onClose} className="mt-2">
              Zapri
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email-recipient" className="text-sm">
                E-poštni naslov prejemnika
              </Label>
              <Input
                id="email-recipient"
                type="email"
                placeholder="revizor@podjetje.si"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="h-9"
                autoFocus
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Prekliči
              </Button>
              <Button type="submit" disabled={loading || !email.trim()} className="gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Pošlji
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Browser PDF export (fallback — kept for reference, no longer used) ────────
// Server-side export is now the primary method.

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

// ── SRS type-mismatch warning block ──────────────────────────────────────────

const ACCOUNT_TYPE_SL: Record<string, string> = {
  asset: "sredstvo",
  liability: "obveznost",
  equity: "kapital",
  revenue: "prihodek",
  expense: "odhodek/strošek",
};

function TypeWarningsAlert({ warnings }: { warnings: AccountTypeWarning[] }) {
  const [open, setOpen] = useState(false);
  if (!warnings || warnings.length === 0) return null;
  return (
    <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 mt-4 print:hidden">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-300 flex items-center gap-2">
        {warnings.length === 1
          ? "1 konto z neskladjem SRS tipa"
          : `${warnings.length} kontov z neskladjem SRS tipa`}
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-normal underline decoration-dotted cursor-pointer ml-1"
        >
          {open ? "Skrij podrobnosti" : "Pokaži podrobnosti"}
        </button>
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-400 text-xs mt-1">
        Šifra konta nakazuje drugačen SRS razred kot shranjeni tip konta. Konto je
        uvrščen v poročilo po SRS razredu šifre (efektivni tip), ne po shranjenem tipu.
        Preverite nastavitve kontnega plana.
        {open && (
          <div className="mt-2 space-y-1">
            {warnings.map((w) => (
              <div
                key={w.accountId}
                className="flex items-center gap-2 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30"
              >
                <span className="font-mono font-medium w-16 flex-shrink-0">{w.code}</span>
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-amber-600 dark:text-amber-400 flex-shrink-0">
                  shranjeni tip: <span className="font-medium">{ACCOUNT_TYPE_SL[w.storedType] ?? w.storedType}</span>
                  {" → "}
                  uvrščen kot:{" "}
                  <span className="font-medium">{ACCOUNT_TYPE_SL[w.effectiveType] ?? w.effectiveType}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Rdeče opozorilo za konte, ki so IZPADLI iz poročila (ne le prerazvrščeni).
 * Prikaže se samo, kadar unclassifiedAccounts ni prazen.
 */
function UnclassifiedAccountsAlert({ accounts }: { accounts: UnclassifiedAccount[] }) {
  const [open, setOpen] = useState(false);
  if (!accounts || accounts.length === 0) return null;
  const totalNet = accounts.reduce((s, a) => s + Math.abs(a.net), 0);
  return (
    <Alert className="border-red-400 bg-red-50 dark:bg-red-950/20 dark:border-red-700 mt-4 print:hidden">
      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
      <AlertTitle className="text-red-800 dark:text-red-300 flex items-center gap-2">
        Pozor: {accounts.length === 1 ? "1 konto" : `${accounts.length} kontov`} ni
        razvrščenih — {fmt(totalNet.toFixed(2))} EUR prikazano kot »Nerazvrščeno«
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-normal underline decoration-dotted cursor-pointer ml-1"
        >
          {open ? "Skrij podrobnosti" : "Pokaži podrobnosti"}
        </button>
      </AlertTitle>
      <AlertDescription className="text-red-700 dark:text-red-400 text-xs mt-1">
        Naslednji konti nimajo prepoznavnega tipa in so prikazani v sekciji{" "}
        <strong>NERAZVRŠČENO</strong> na dnu poročila. Uredite tip konta v kontnem
        načrtu, da bodo pravilno uvrščeni.
        {open && (
          <div className="mt-2 space-y-1">
            {accounts.map((a) => (
              <div
                key={a.accountId}
                className="flex items-center gap-2 px-2 py-1 rounded bg-red-100 dark:bg-red-900/30"
              >
                <span className="font-mono font-medium w-16 flex-shrink-0">{a.code}</span>
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-red-500 dark:text-red-400 flex-shrink-0 text-right">
                  {a.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Inline sekcija "NERAZVRŠČENO" — prikaže konte, ki jih ni mogoče uvrstiti
 * v nobeno standardno kategorijo.  Vedno vidna v telesu poročila, ne le v opozorilu.
 */
function UnclassifiedSection({ accounts }: { accounts: UnclassifiedAccount[] }) {
  if (!accounts || accounts.length === 0) return null;
  const totalNet = accounts.reduce((s, a) => s + Math.abs(a.net), 0);
  return (
    <div className="space-y-1 border border-red-300 dark:border-red-700 rounded-md p-3 bg-red-50/60 dark:bg-red-950/10">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-sm font-bold tracking-tight text-red-700 dark:text-red-400">
          NERAZVRŠČENO
        </h3>
        <Badge variant="outline" className="text-xs border-red-300 text-red-600">
          Neto: {fmt(totalNet.toFixed(2))} EUR
        </Badge>
        <span className="text-xs text-red-500 dark:text-red-400">
          Uredite tip konta v kontnem načrtu
        </span>
      </div>
      {accounts.map((a) => (
        <div
          key={a.accountId}
          className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-red-100/60 dark:hover:bg-red-900/20"
        >
          <span className="font-mono w-16 flex-shrink-0 text-red-700 dark:text-red-400">
            {a.code}
          </span>
          <span className="flex-1 text-muted-foreground truncate">{a.name}</span>
          <span className="text-muted-foreground text-right whitespace-nowrap">
            DB: {fmt(a.debit.toFixed(2))} / KR: {fmt(a.credit.toFixed(2))}
          </span>
          <span className="font-medium min-w-[90px] text-right text-red-600 dark:text-red-400">
            {fmt(Math.abs(a.net).toFixed(2))} EUR
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Balance Sheet tab ─────────────────────────────────────────────────────────

function BalanceSheetTab() {
  const { activeCompany } = useCompany();
  const { getToken } = useAuth();

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

  // Email dialog state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  function handleGenerate() {
    setAppliedAsOf(asOf);
    setAppliedCompareAsOf(enableCompare ? compareAsOf : undefined);
    setQueried(true);
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!data || !activeCompany) return;
    setPdfLoading(true);
    try {
      const token = await getToken();
      await serverExportPdf({
        companyId: activeCompany.id,
        reportType: "balance-sheet",
        params: {
          asOf: appliedAsOf,
          ...(appliedCompareAsOf ? { compareAsOf: appliedCompareAsOf } : {}),
        },
        filename: `bilanca-stanja-${appliedAsOf}.pdf`,
        token: token ?? "",
      });
      trackEvent("report_exported", { report_type: "balance_sheet", format: "pdf" });
    } catch (err) {
      alert(`Napaka pri izvozu PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfLoading(false);
    }
  }

  function handleOpenEmail() {
    setEmailError(null);
    setEmailSuccess(false);
    setEmailOpen(true);
  }

  async function handleSendEmail(email: string) {
    if (!activeCompany) return;
    setEmailLoading(true);
    setEmailError(null);
    try {
      const token = await getToken();
      await serverSendEmail({
        companyId: activeCompany.id,
        reportType: "balance-sheet",
        params: {
          asOf: appliedAsOf,
          ...(appliedCompareAsOf ? { compareAsOf: appliedCompareAsOf } : {}),
        },
        email,
        token: token ?? "",
      });
      setEmailSuccess(true);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailLoading(false);
    }
  }

  const showCompare = !!data?.compare;
  const current = data?.current as BalanceSheetDataWithWarnings | undefined;
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
                  <span className="text-sm">PDF</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={handleOpenEmail}
                  title="Pošlji po e-pošti"
                >
                  <Mail className="h-4 w-4" />
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

          {/* NERAZVRŠČENO — konti z nedoločljivim tipom (nikoli tiha izguba) */}
          {((current as BalanceSheetDataWithWarnings).unclassifiedAccounts?.length ?? 0) > 0 && (
            <>
              <div className="border-t border-red-200 dark:border-red-800 my-4" />
              <UnclassifiedSection
                accounts={(current as BalanceSheetDataWithWarnings).unclassifiedAccounts ?? []}
              />
            </>
          )}

          {/* Balance check */}
          {(() => {
            const diff = Math.abs(parseFloat(current.aktiva.total) - parseFloat(current.pasiva.total));
            const hasUnclassified = ((current as BalanceSheetDataWithWarnings).unclassifiedAccounts?.length ?? 0) > 0;
            if (diff > 0.01) {
              return (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Bilanca se ne ujema</AlertTitle>
                  <AlertDescription>
                    Razlika med aktivo in pasivo: {fmt(diff.toFixed(2))} EUR.
                    {hasUnclassified
                      ? " Del razlike je lahko posledica nerazvrščenih kontov (glejte sekcijo Nerazvrščeno zgoraj)."
                      : " Preverite knjižbe."}
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

          {/* SRS type mismatch warnings (prerazvrščeni) */}
          <TypeWarningsAlert warnings={current.typeWarnings ?? []} />
          {/* Unclassified accounts alert (izpuščeni — kritično) */}
          <UnclassifiedAccountsAlert
            accounts={(current as BalanceSheetDataWithWarnings).unclassifiedAccounts ?? []}
          />
        </div>
      )}

      {!queried && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Izberite datum in kliknite »Prikaži poročilo«.</p>
        </div>
      )}

      <EmailDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSend={handleSendEmail}
        loading={emailLoading}
        error={emailError}
        success={emailSuccess}
      />
    </div>
  );
}

// ── Income Statement tab ──────────────────────────────────────────────────────

function IncomeStatementTab() {
  const { activeCompany } = useCompany();
  const { getToken } = useAuth();

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

  // Email dialog state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

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
    if (!data || !applied || !activeCompany) return;
    setPdfLoading(true);
    try {
      const token = await getToken();
      await serverExportPdf({
        companyId: activeCompany.id,
        reportType: "income-statement",
        params: {
          dateFrom: applied.dateFrom,
          dateTo: applied.dateTo,
          ...(applied.compareDateFrom ? { compareDateFrom: applied.compareDateFrom, compareDateTo: applied.compareDateTo } : {}),
        },
        filename: `izkaz-poslovnega-izida-${applied.dateFrom}-${applied.dateTo}.pdf`,
        token: token ?? "",
      });
      trackEvent("report_exported", { report_type: "income_statement", format: "pdf" });
    } catch (err) {
      alert(`Napaka pri izvozu PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfLoading(false);
    }
  }

  function handleOpenEmail() {
    setEmailError(null);
    setEmailSuccess(false);
    setEmailOpen(true);
  }

  async function handleSendEmail(email: string) {
    if (!activeCompany || !applied) return;
    setEmailLoading(true);
    setEmailError(null);
    try {
      const token = await getToken();
      await serverSendEmail({
        companyId: activeCompany.id,
        reportType: "income-statement",
        params: {
          dateFrom: applied.dateFrom,
          dateTo: applied.dateTo,
          ...(applied.compareDateFrom ? { compareDateFrom: applied.compareDateFrom, compareDateTo: applied.compareDateTo } : {}),
        },
        email,
        token: token ?? "",
      });
      setEmailSuccess(true);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailLoading(false);
    }
  }

  const showCompare = !!data?.compare;
  const current = data?.current as IncomeStatementDataWithWarnings | undefined;
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
                  <span className="text-sm">PDF</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 print:hidden"
                  onClick={handleOpenEmail}
                  title="Pošlji po e-pošti"
                >
                  <Mail className="h-4 w-4" />
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

          {/* NERAZVRŠČENO — konti z nedoločljivim tipom (nikoli tiha izguba) */}
          {((current as IncomeStatementDataWithWarnings).unclassifiedAccounts?.length ?? 0) > 0 && (
            <>
              <div className="border-t border-red-200 dark:border-red-800 my-2" />
              <UnclassifiedSection
                accounts={(current as IncomeStatementDataWithWarnings).unclassifiedAccounts ?? []}
              />
            </>
          )}

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

          {/* SRS type mismatch warnings (prerazvrščeni) */}
          <TypeWarningsAlert warnings={current.typeWarnings ?? []} />
          {/* Unclassified accounts alert (izpuščeni — kritično) */}
          <UnclassifiedAccountsAlert
            accounts={(current as IncomeStatementDataWithWarnings).unclassifiedAccounts ?? []}
          />
        </div>
      )}

      {!queried && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Izberite obdobje in kliknite »Prikaži poročilo«.</p>
        </div>
      )}

      <EmailDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSend={handleSendEmail}
        loading={emailLoading}
        error={emailError}
        success={emailSuccess}
      />
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
  const { getToken } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  const [dateFrom, setDateFrom] = useState(yearStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [queried, setQueried] = useState(false);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const [statementView, setStatementView] = useState<"standard" | LedgerStatementView>("standard");

  const [appliedFrom, setAppliedFrom] = useState(yearStart());
  const [appliedTo, setAppliedTo] = useState(todayStr());

  // Email dialog state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const { data, isFetching, isError, error } = useGetTrialBalance(
    activeCompany?.id ?? "",
    { dateFrom: appliedFrom, dateTo: appliedTo },
    { query: { enabled: !!activeCompany?.id && queried } as any },
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    if (!/^\d{4}-01-01$/.test(dateFrom) || dateTo !== `${dateFrom.slice(0, 4)}-12-31`) {
      setStatementView("standard");
    }
    setQueried(true);
  }

  const isAnnual = /^\d{4}-01-01$/.test(appliedFrom) && appliedTo === `${appliedFrom.slice(0, 4)}-12-31`;

  const filtered: TrialBalanceRow[] = React.useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (classFilter !== "all") {
      rows = rows.filter((r) => r.accountCode.startsWith(classFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.accountCode.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, search, classFilter]);

  async function handleExportPdf() {
    if (!data || !activeCompany) return;
    setExporting(true);
    try {
      const token = await getToken();
      await serverExportPdf({
        companyId: activeCompany.id,
        reportType: "trial-balance",
        params: {
          dateFrom: appliedFrom, dateTo: appliedTo,
          ...(statementView !== "standard" ? { statementView } : {}),
          ...(classFilter !== "all" ? { accountClass: classFilter } : {}),
          ...(search.trim() ? { searchTerm: search.trim() } : {}),
        },
        filename: `${statementView === "standard" ? "bruto-bilanca" : statementView}-${appliedFrom}-${appliedTo}.pdf`,
        token: token ?? "",
      });
      trackEvent("report_exported", { report_type: "trial_balance", format: "pdf" });
    } catch (err) {
      alert(`Napaka pri izvozu PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  const [xlsxExporting, setXlsxExporting] = useState(false);

  async function handleExportXlsx() {
    if (!data) return;
    setXlsxExporting(true);
    try {
      const companyName = activeCompany?.naziv ?? "";

      // Header rows
      const headerRows: (string | number)[][] = [
        [companyName],
        ["Bruto bilanca (preizkusna bilanca)"],
        [`Obdobje: ${appliedFrom} – ${appliedTo}`],
        [],
        ["Šifra", "Naziv konta", "Tip", "Začetni saldo B", "Začetni saldo D", "Promet breme", "Promet dobro", "Saldo breme", "Saldo dobro"],
      ];

      // Export the same account set currently visible on screen.
      const dataRows: (string | number)[][] = filtered.map((row) => [
        row.accountCode,
        row.accountName,
        ACCOUNT_TYPE_LABELS[row.accountType] ?? row.accountType,
        parseFloat(row.openingBalanceDebit || "0"),
        parseFloat(row.openingBalanceCredit || "0"),
        parseFloat(row.turnoverDebit || "0"),
        parseFloat(row.turnoverCredit || "0"),
        parseFloat(row.balanceDebit || "0"),
        parseFloat(row.balanceCredit || "0"),
      ]);

      // Totals row
      const totalObD = filtered.reduce((s, r) => s + parseFloat(r.openingBalanceDebit || "0"), 0);
      const totalObC = filtered.reduce((s, r) => s + parseFloat(r.openingBalanceCredit || "0"), 0);
      const totalDebit = filtered.reduce((s, r) => s + parseFloat(r.turnoverDebit || "0"), 0);
      const totalCredit = filtered.reduce((s, r) => s + parseFloat(r.turnoverCredit || "0"), 0);
      const totalBalDebit = filtered.reduce((s, r) => s + parseFloat(r.balanceDebit || "0"), 0);
      const totalBalCredit = filtered.reduce((s, r) => s + parseFloat(r.balanceCredit || "0"), 0);
      const totalsRow: (string | number)[] = ["", "SKUPAJ", "", totalObD, totalObC, totalDebit, totalCredit, totalBalDebit, totalBalCredit];

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Bruto bilanca");
      worksheet.columns = [
        { width: 12 },  // Šifra
        { width: 40 },  // Naziv
        { width: 14 },  // Tip
        { width: 16 },  // Začetni saldo B
        { width: 16 },  // Začetni saldo D
        { width: 16 },  // Promet breme
        { width: 16 },  // Promet dobro
        { width: 16 },  // Saldo breme
        { width: 16 },  // Saldo dobro
      ];
      for (const row of headerRows) worksheet.addRow(row);
      for (const row of dataRows) worksheet.addRow(row);
      worksheet.addRow([]);
      worksheet.addRow(totalsRow);

      // Number format for numeric columns D–I. Skupne vrednosti so že
      // izračunane v JavaScriptu, zato izvoz ne vsebuje Excel formul.
      const numFmt = "#,##0.00";
      for (let rowIndex = 6; rowIndex <= worksheet.rowCount; rowIndex++) {
        for (let columnIndex = 4; columnIndex <= 9; columnIndex++) {
          const cell = worksheet.getCell(rowIndex, columnIndex);
          if (typeof cell.value === "number") {
            cell.numFmt = numFmt;
          }
        }
      }

      const vsebina = await workbook.xlsx.writeBuffer();
      const blob = new Blob([vsebina as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bruto-bilanca-${appliedFrom}-${appliedTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      trackEvent("report_exported", { report_type: "trial_balance", format: "xlsx" });
    } finally {
      setXlsxExporting(false);
    }
  }

  function handleOpenEmail() {
    setEmailError(null);
    setEmailSuccess(false);
    setEmailOpen(true);
  }

  async function handleSendEmail(email: string) {
    if (!activeCompany) return;
    setEmailLoading(true);
    setEmailError(null);
    try {
      const token = await getToken();
      await serverSendEmail({
        companyId: activeCompany.id,
        reportType: "trial-balance",
        params: {
          dateFrom: appliedFrom, dateTo: appliedTo,
          ...(statementView !== "standard" ? { statementView } : {}),
          ...(classFilter !== "all" ? { accountClass: classFilter } : {}),
          ...(search.trim() ? { searchTerm: search.trim() } : {}),
        },
        email,
        token: token ?? "",
      });
      setEmailSuccess(true);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailLoading(false);
    }
  }

  const fmtZ = (v: string) => fmt(v) === "—" ? "—" : fmt(v);

  // Totals computed from the filtered rows so they reflect the active class/search filter
  const totals = filtered.length > 0 || (queried && data)
    ? {
        openingBalanceDebit: filtered.reduce((s, r) => s + parseFloat(r.openingBalanceDebit || "0"), 0).toFixed(2),
        openingBalanceCredit: filtered.reduce((s, r) => s + parseFloat(r.openingBalanceCredit || "0"), 0).toFixed(2),
        turnoverDebit: filtered.reduce((s, r) => s + parseFloat(r.turnoverDebit || "0"), 0).toFixed(2),
        turnoverCredit: filtered.reduce((s, r) => s + parseFloat(r.turnoverCredit || "0"), 0).toFixed(2),
        balanceDebit: filtered.reduce((s, r) => s + parseFloat(r.balanceDebit || "0"), 0).toFixed(2),
        balanceCredit: filtered.reduce((s, r) => s + parseFloat(r.balanceCredit || "0"), 0).toFixed(2),
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
              <Label className="text-xs">Razred konta</Label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsi razredi</SelectItem>
                  {["0","1","2","3","4","5","6","7","8","9"].map((d) => (
                    <SelectItem key={d} value={d}>Razred {d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="tb-search" className="text-xs">Iskanje konta</Label>
              <Input
                id="tb-search"
                placeholder="Šifra ali naziv…"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44 h-8 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={exporting}
              onClick={handleExportPdf}
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={xlsxExporting}
              onClick={handleExportXlsx}
              title="Izvozi v Excel"
            >
              {xlsxExporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sheet className="h-3 w-3" />
              )}
              Izvozi XLSX
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleOpenEmail}
              title="Pošlji po e-pošti"
            >
              <Mail className="h-3 w-3" />
              E-pošta
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
        <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Prikaz bilance kontov">
          {([
            ["standard", "Bruto bilanca"],
            ["bilanca", "Bilanca kontov"],
            ["zakljucni", "Zaključni račun"],
          ] as const).map(([value, label]) => (
            <Button key={value} type="button" size="sm"
              variant={statementView === value ? "default" : "outline"}
              disabled={value !== "standard" && !isAnnual}
              onClick={() => setStatementView(value)}>
              {label}
            </Button>
          ))}
          {activeCompany?.naziv?.toLocaleLowerCase("sl-SI").includes("mikrona") && (
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setDateFrom("2025-01-01");
              setDateTo("2025-12-31");
              setAppliedFrom("2025-01-01");
              setAppliedTo("2025-12-31");
              setStatementView("zakljucni");
            }}>
              Oddani izpisi 2025
            </Button>
          )}
          {!isAnnual && <span className="text-xs text-muted-foreground">Bilanca kontov in zaključni račun zahtevata celo koledarsko leto.</span>}
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
              {(search || classFilter !== "all") ? ` (skupaj: ${data.rows.length})` : ""}
            </span>
          </div>

          {statementView !== "standard" && (
            <LedgerStatementTable
              rows={filtered}
              view={statementView}
              dateFrom={appliedFrom}
              dateTo={appliedTo}
              companyName={activeCompany?.naziv ?? ""}
            />
          )}
          {statementView === "standard" && <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60">
                  <th className="text-left px-3 py-2 font-semibold w-24">Šifra</th>
                  <th className="text-left px-3 py-2 font-semibold">Naziv konta</th>
                  <th colSpan={2} className="text-center px-3 py-2 font-semibold border-l border-border/50">
                    Začetni saldo
                  </th>
                  <th colSpan={2} className="text-center px-3 py-2 font-semibold border-l border-border/50">
                    Promet v obdobju
                  </th>
                  <th colSpan={2} className="text-center px-3 py-2 font-semibold border-l border-border/50">
                    Zaključni saldo
                  </th>
                </tr>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-1"></th>
                  <th className="px-3 py-1"></th>
                  <th className="text-right px-3 py-1 border-l border-border/50 font-medium">Breme</th>
                  <th className="text-right px-3 py-1 font-medium">Dobro</th>
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
                    <td className="px-3 py-1.5 text-right tabular-nums border-l border-border/30 text-muted-foreground">
                      {parseFloat(row.openingBalanceDebit ?? "0") !== 0 ? fmtZ(row.openingBalanceDebit ?? "") : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {parseFloat(row.openingBalanceCredit ?? "0") !== 0 ? fmtZ(row.openingBalanceCredit ?? "") : ""}
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
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
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
                    <td className="px-3 py-2 text-right tabular-nums border-l border-border/50 text-muted-foreground">
                      {fmt(totals.openingBalanceDebit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fmt(totals.openingBalanceCredit)}
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
          </div>}

          {/* Print header (hidden on screen) */}
          <div className="hidden print:block mb-4">
            <p className="text-base font-bold">{activeCompany?.naziv}</p>
            <p className="text-sm font-semibold">
              {statementView === "standard" ? "Bruto bilanca (preizkusna bilanca)"
                : statementView === "bilanca" ? "Bilanca kontov" : "Zaključni račun"}
            </p>
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

      <EmailDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSend={handleSendEmail}
        loading={emailLoading}
        error={emailError}
        success={emailSuccess}
      />
    </div>
  );
}

// ── Export history tab ────────────────────────────────────────────────────────

interface ExportRecord {
  id: string;
  reportType: "balance-sheet" | "income-statement" | "trial-balance";
  params: Record<string, string | undefined>;
  filename: string;
  exportedBy: string;
  exportedAt: string;
  emailSentTo: string | null;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  "balance-sheet": "Bilanca stanja",
  "income-statement": "Izkaz poslovnega izida",
  "trial-balance": "Bruto bilanca",
};

function formatExportParams(params: Record<string, string | undefined>, reportType: string): string {
  if (reportType === "balance-sheet") {
    return params.compareAsOf
      ? `Stanje: ${params.asOf} | Primerjava: ${params.compareAsOf}`
      : `Stanje na dan: ${params.asOf}`;
  }
  if (reportType === "income-statement") {
    const base = `${params.dateFrom} – ${params.dateTo}`;
    return params.compareDateFrom
      ? `${base} | Primerjava: ${params.compareDateFrom} – ${params.compareDateTo}`
      : base;
  }
  if (reportType === "trial-balance") {
    return [
      `${params.dateFrom} – ${params.dateTo}`,
      params.statementView === "bilanca" ? "Bilanca kontov" :
        params.statementView === "zakljucni" ? "Zaključni račun" : null,
      params.accountClass ? `Razred ${params.accountClass}` : null,
      params.searchTerm ? `Iskanje: ${params.searchTerm}` : null,
    ].filter(Boolean).join(" | ");
  }
  return JSON.stringify(params);
}

function ExportHistoryTab() {
  const { activeCompany } = useCompany();
  const { getToken } = useAuth();

  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function fetchHistory() {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE}/api/companies/${activeCompany.id}/reports/export/history`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRecords(data.exports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeCompany) fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

  async function handleReDownload(record: ExportRecord) {
    if (!activeCompany) return;
    setDownloading(record.id);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE}/api/companies/${activeCompany.id}/reports/export/history/${record.id}/download`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = record.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Napaka pri prenosu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Vsakič, ko je poročilo izvoženo ali poslano po e-pošti, se vnos zabeleži tukaj.
          Shranjene PDF-e je mogoče prenesti brez ponovnega generiranja.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 flex-shrink-0"
          onClick={fetchHistory}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Osveži
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && records.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!loading && records.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <History className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Ni še nobenih izvozov za to podjetje.</p>
          <p className="text-xs mt-1">Ko boste izvozili ali poslali poročilo, se bo tukaj pojavil vnos.</p>
        </div>
      )}

      {records.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Datum izvoza</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Vrsta poročila</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Parametri</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Poslano na</th>
                <th className="text-right px-4 py-2.5 font-semibold text-xs">Prenos</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec, i) => (
                <tr
                  key={rec.id}
                  className={i % 2 === 0 ? "bg-background hover:bg-muted/30" : "bg-muted/10 hover:bg-muted/30"}
                >
                  <td className="px-4 py-2.5 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                    {new Date(rec.exportedAt).toLocaleString("sl-SI", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <Badge variant="outline" className="text-xs font-normal">
                      {REPORT_TYPE_LABELS[rec.reportType] ?? rec.reportType}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs">
                    <span className="truncate block">{formatExportParams(rec.params, rec.reportType)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {rec.emailSentTo ?? (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => handleReDownload(rec)}
                      disabled={downloading === rec.id}
                      title={`Prenesi ${rec.filename}`}
                    >
                      {downloading === rec.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <TabsTrigger value="trial-balance">Bilanca kontov / zaključni račun</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            Zgodovina izvozov
          </TabsTrigger>
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

        <TabsContent value="history" className="mt-0">
          <ExportHistoryTab />
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
