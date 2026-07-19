import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  FileUp,
  X,
  Info,
  Banknote,
  Check,
  SkipForward,
  TriangleAlert,
  RotateCcw,
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListPeriods,
  useListAccounts,
  useListCounterparties,
  getListPaymentsQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Types mirrored from backend ─────────────────────────────────────────────

interface SkippedRow {
  lineNumber: number;
  reason: string;
}

interface BankTransaction {
  id: string;
  date: string;
  amount: number;
  reference: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  description: string | null;
  currency: string;
}

interface MatchSuggestion {
  invoiceId: string;
  invoiceNumber: string;
  counterpartyId: string;
  counterpartyName: string;
  invoiceDate: string;
  dueDate: string | null;
  remainingAmount: string;
  confidence: number;
  matchReasons: string[];
}

interface DuplicateInfo {
  paymentId: string;
  paymentDate: string;
  amount: string;
  reference: string | null;
  direction: string;
}

interface TransactionWithSuggestions {
  transaction: BankTransaction;
  suggestions: MatchSuggestion[];
  duplicateOf?: DuplicateInfo;
}

// ─── Decision per transaction ─────────────────────────────────────────────────

type MatchDecision =
  | { kind: "matched"; invoiceId: string; invoiceNumber: string; counterpartyId: string; counterpartyName: string; allocatedAmount: string }
  | { kind: "skip" }
  | { kind: "pending" };

// ─── API helpers ──────────────────────────────────────────────────────────────

async function parseBankStatement(
  companyId: string,
  file: File,
): Promise<{ transactions: BankTransaction[]; count: number; skippedRows: SkippedRow[] }> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`/api/companies/${companyId}/bank-statements/parse`, {
    method: "POST",
    body: form,
    // No Content-Type header - browser sets it with boundary for multipart
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return { skippedRows: [], ...data };
}

interface CreatePaymentPayload {
  direction: "inbound" | "outbound";
  counterpartyId: string;
  periodId: string;
  paymentDate: string;
  amount: number;
  reference: string | null;
  bankAccountId: string;
  arApAccountId: string;
  notes: string | null;
  allocations: { invoiceId: string; allocatedAmount: number }[];
  force?: boolean;
}

async function createPaymentApi(companyId: string, payload: CreatePaymentPayload): Promise<string> {
  const resp = await fetch(`/api/companies/${companyId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.id as string;
}

async function postPayment(companyId: string, paymentId: string): Promise<void> {
  const resp = await fetch(`/api/companies/${companyId}/payments/${paymentId}/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
}

async function matchTransactions(
  companyId: string,
  transactions: BankTransaction[],
): Promise<{ suggestions: TransactionWithSuggestions[] }> {
  const resp = await fetch(`/api/companies/${companyId}/bank-statements/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ─── Wizard steps ─────────────────────────────────────────────────────────────

type Step = "upload" | "review" | "confirm";

// ─── Import config persistence (API-based) ───────────────────────────────────

interface SavedImportConfig {
  bankAccountId: string | null;
  arAccountId: string | null;
  apAccountId: string | null;
}

async function fetchImportConfig(companyId: string): Promise<SavedImportConfig | null> {
  try {
    const resp = await fetch(`/api/companies/${companyId}/import-config`);
    if (!resp.ok) return null;
    const data = await resp.json() as SavedImportConfig;
    // Return null if all fields are empty so callers treat it as "no config"
    if (!data.bankAccountId && !data.arAccountId && !data.apAccountId) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveImportConfigApi(companyId: string, config: SavedImportConfig): Promise<void> {
  try {
    await fetch(`/api/companies/${companyId}/import-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch {
    // Network error — silently skip (non-critical)
  }
}

async function clearImportConfigApi(companyId: string): Promise<void> {
  await saveImportConfigApi(companyId, { bankAccountId: null, arAccountId: null, apAccountId: null });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BancniIzpis() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("upload");

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [periodId, setPeriodId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [arAccountId, setArAccountId] = useState("");
  const [apAccountId, setApAccountId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Whether the current account fields were pre-filled from a saved config
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load saved config when the active company changes
  useEffect(() => {
    if (!activeCompany) return;
    // Clear immediately to prevent stale values from a previous company
    setBankAccountId("");
    setArAccountId("");
    setApAccountId("");
    setConfigLoaded(false);
    const companyId = activeCompany.id;
    fetchImportConfig(companyId).then(saved => {
      // Guard: company may have changed while the request was in-flight
      if (companyId !== activeCompany.id) return;
      setBankAccountId(saved?.bankAccountId ?? "");
      setArAccountId(saved?.arAccountId ?? "");
      setApAccountId(saved?.apAccountId ?? "");
      setConfigLoaded(!!saved);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

  // Skipped rows from the last parse
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);

  // Step 2 state
  const [suggestions, setSuggestions] = useState<TransactionWithSuggestions[]>([]);
  const [decisions, setDecisions] = useState<Map<string, MatchDecision>>(new Map());
  const [matching, setMatching] = useState(false);

  // Auto-post option
  const [autoPost, setAutoPost] = useState(false);

  // Track the company that was active when the wizard started (step 1 → 2 transition).
  // If the user switches company while mid-wizard we detect it and reset.
  const wizardCompanyIdRef = useRef<string | null>(null);
  const [showCompanyChangedDialog, setShowCompanyChangedDialog] = useState(false);

  // Step 3 state
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ created: number; skipped: number; posted: number; postErrors: string[] } | null>(null);
  const [confirmProgress, setConfirmProgress] = useState<{
    current: number;
    total: number;
    action: "creating" | "posting";
    label: string;
  } | null>(null);

  // Data fetching
  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const accounts = accountsData?.accounts?.filter(a => a.isActive) ?? [];
  const bankAccounts = accounts.filter(a => a.code.startsWith("11"));
  const arAccounts = accounts.filter(a => a.code.startsWith("12") || a.code.startsWith("14"));
  const apAccounts = accounts.filter(a => a.code.startsWith("22") || a.code.startsWith("43"));

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  // Detect mid-wizard company switch at any point (including during async parse).
  // Fires whenever the active company OR the current step changes, so a company
  // switch that happened while parse/match was still running (step "upload") is
  // also caught the moment the wizard advances to "review".
  useEffect(() => {
    if (!activeCompany) return;
    if (!wizardCompanyIdRef.current) return;
    if (activeCompany.id === wizardCompanyIdRef.current) return;
    // Company changed while wizard is in progress — show warning dialog.
    // The actual reset + ref clear happens when the user confirms the dialog.
    setShowCompanyChangedDialog(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id, step]);

  // After accounts are fetched, validate saved IDs against actual account lists.
  // If a saved ID is no longer in the active accounts, clear it so the user
  // cannot silently post to a deactivated or deleted account.
  useEffect(() => {
    if (!configLoaded) return;
    if (bankAccountId && !bankAccounts.some(a => a.id === bankAccountId)) {
      setBankAccountId("");
    }
    if (arAccountId && !arAccounts.some(a => a.id === arAccountId)) {
      setArAccountId("");
    }
    if (apAccountId && !apAccounts.some(a => a.id === apAccountId)) {
      setApAccountId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccounts.length, arAccounts.length, apAccounts.length]);

  // ─── Step 1: Upload & Parse ────────────────────────────────────────────────

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleParse = async () => {
    if (!file || !activeCompany || !periodId || !bankAccountId) return;
    // Capture the company ID in a local variable *and* in the ref before any
    // async work. The local copy is the stable "session token" for this specific
    // invocation; the ref is the shared signal that reset() can clear.
    const companyIdAtStart = activeCompany.id;
    wizardCompanyIdRef.current = companyIdAtStart;
    // Persist the current account configuration for next time (fire-and-forget)
    saveImportConfigApi(activeCompany.id, { bankAccountId, arAccountId, apAccountId });
    setConfigLoaded(true);
    setParsing(true);
    setParseError(null);
    try {
      const { transactions, skippedRows: sr } = await parseBankStatement(activeCompany.id, file);
      setSkippedRows(sr);
      setMatching(true);
      const { suggestions: s } = await matchTransactions(activeCompany.id, transactions);

      // Guard: if a company switch was confirmed (reset() cleared the ref) while
      // parse/match was in-flight, discard results and do NOT advance the wizard.
      // Without this check, stale suggestions from company A would be written into
      // state and the wizard would advance to review even after a reset.
      if (wizardCompanyIdRef.current !== companyIdAtStart) {
        return;
      }

      setSuggestions(s);

      // Pre-set decisions:
      // - Duplicates (already imported) → skip by default
      // - High-confidence matches (≥ 0.6) → auto-accept
      // - Everything else → pending
      const initial = new Map<string, MatchDecision>();
      for (const item of s) {
        if (item.duplicateOf) {
          // Default duplicates to skip; user can override manually
          initial.set(item.transaction.id, { kind: "skip" });
          continue;
        }
        const best = item.suggestions[0];
        if (best && best.confidence >= 0.6) {
          initial.set(item.transaction.id, {
            kind: "matched",
            invoiceId: best.invoiceId,
            invoiceNumber: best.invoiceNumber,
            counterpartyId: best.counterpartyId,
            counterpartyName: best.counterpartyName,
            allocatedAmount: best.remainingAmount,
          });
        } else {
          initial.set(item.transaction.id, { kind: "pending" });
        }
      }
      setDecisions(initial);
      setStep("review");
    } catch (err: any) {
      // On failure clear the wizard company ref so the effect stays quiet.
      wizardCompanyIdRef.current = null;
      setParseError(err.message ?? "Napaka pri razčlenjevanju");
    } finally {
      setParsing(false);
      setMatching(false);
    }
  };

  // ─── Step 2: Review matches ────────────────────────────────────────────────

  const setDecision = (txId: string, decision: MatchDecision) => {
    setDecisions(prev => new Map(prev).set(txId, decision));
  };

  const matchedCount = [...decisions.values()].filter(d => d.kind === "matched").length;
  const skippedCount = [...decisions.values()].filter(d => d.kind === "skip").length;
  const pendingCount = [...decisions.values()].filter(d => d.kind === "pending").length;
  const duplicateCount = suggestions.filter(s => s.duplicateOf).length;

  // ─── Step 3: Confirm ──────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!activeCompany) return;
    // Hard invariant: the active company must be set and must match the company
    // this wizard session was started for. A null ref means the session was
    // already reset; a mismatch means the user switched company after suggestions
    // were fetched. Either way, block and force a reset.
    if (!wizardCompanyIdRef.current || activeCompany.id !== wizardCompanyIdRef.current) {
      setShowCompanyChangedDialog(true);
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    setConfirmProgress(null);

    let created = 0;
    let skipped = 0;
    let posted = 0;
    const postErrors: string[] = [];

    // Count only matched transactions for the progress total
    const toProcess = suggestions.filter(item => {
      const d = decisions.get(item.transaction.id);
      return d && d.kind === "matched";
    });
    const total = toProcess.length;
    let processedIndex = 0;

    for (const item of suggestions) {
      const tx = item.transaction;
      const decision = decisions.get(tx.id);
      if (!decision || decision.kind === "skip") { skipped++; continue; }
      if (decision.kind === "pending") { skipped++; continue; }

      // matched
      processedIndex++;
      const direction = tx.amount > 0 ? "inbound" : "outbound";
      const arApAccountId = direction === "inbound" ? arAccountId : apAccountId;
      const counterpartyId = decision.counterpartyId;

      // If the user explicitly chose to import a transaction that was flagged as a
      // duplicate, pass force=true so the server-side duplicate check is bypassed.
      const forceImport = !!item.duplicateOf;

      const txLabel = tx.reference ?? tx.counterpartyName ?? tx.date;

      setConfirmProgress({
        current: processedIndex,
        total,
        action: "creating",
        label: `Ustvarjam plačilo ${processedIndex} od ${total}${txLabel ? ` — ${txLabel}` : ""}`,
      });

      let paymentId: string | null = null;
      try {
        paymentId = await createPaymentApi(activeCompany.id, {
          direction,
          counterpartyId,
          periodId,
          paymentDate: tx.date,
          amount: Math.abs(tx.amount),
          reference: tx.reference ?? null,
          bankAccountId,
          arApAccountId,
          notes: tx.description ?? null,
          allocations: [
            {
              invoiceId: decision.invoiceId,
              allocatedAmount: parseFloat(decision.allocatedAmount),
            },
          ],
          force: forceImport,
        });
        created++;
      } catch (e: any) {
        // Record partial failure but continue
        skipped++;
        continue;
      }

      // Auto-post if requested
      if (autoPost && paymentId) {
        setConfirmProgress({
          current: processedIndex,
          total,
          action: "posting",
          label: `Knjižim plačilo ${processedIndex} od ${total}${txLabel ? ` — ${txLabel}` : ""}`,
        });
        try {
          await postPayment(activeCompany.id, paymentId);
          posted++;
        } catch (e: any) {
          const ref = tx.reference ?? tx.date;
          postErrors.push(`${ref}: ${e.message ?? "Napaka pri knjiženju"}`);
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
    setConfirmResult({ created, skipped, posted, postErrors });
    setConfirmProgress(null);
    setConfirming(false);
    setStep("confirm");
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPeriodId("");
    setSuggestions([]);
    setDecisions(new Map());
    setSkippedRows([]);
    setConfirmResult(null);
    setConfirmError(null);
    setParseError(null);
    setAutoPost(false);
    // Re-hydrate account fields from saved config so that "Nov uvoz" in the
    // same session still shows prefilled values (same behaviour as page reload).
    if (activeCompany) {
      const companyId = activeCompany.id;
      fetchImportConfig(companyId).then(saved => {
        setBankAccountId(saved?.bankAccountId ?? "");
        setArAccountId(saved?.arAccountId ?? "");
        setApAccountId(saved?.apAccountId ?? "");
        setConfigLoaded(!!saved);
      });
    } else {
      setBankAccountId("");
      setArAccountId("");
      setApAccountId("");
      setConfigLoaded(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!activeCompany) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Izberite podjetje.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Uvoz bančnega izpiska</h1>
        <p className="text-muted-foreground mt-1">
          Uvozite CSV ali MT940 datoteko in samodejno uskladite transakcije z odprtimi postavkami.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm">
        <StepIndicator num={1} label="Naložite datoteko" active={step === "upload"} done={step !== "upload"} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <StepIndicator num={2} label="Pregled ujemanja" active={step === "review"} done={step === "confirm"} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <StepIndicator num={3} label="Potrditev" active={step === "confirm"} done={false} />
      </div>

      <Separator />

      {/* ─── STEP 1: Upload ─────────────────────────────────────────────────── */}
      {step === "upload" && (
        <div className="space-y-6 max-w-2xl">
          {/* File drop zone */}
          <div
            className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.mt940,.sta,.940,.txt"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <FileUp className="h-6 w-6 text-primary" />
                </div>
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                <Button variant="ghost" size="sm" className="text-destructive mt-1" onClick={e => { e.stopPropagation(); setFile(null); }}>
                  <X className="h-3 w-3 mr-1" /> Odstrani
                </Button>
              </div>
            ) : (
              <>
                <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center mb-3">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="font-medium">Povlecite datoteko sem ali kliknite za izbor</p>
                <p className="text-sm text-muted-foreground mt-1">Podprti formati: CSV (NLB, SKB, Addiko) in MT940/STA</p>
              </>
            )}
          </div>

          {/* Account & period config */}
          <div className="space-y-4 p-5 border rounded-lg bg-card">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Nastavitve knjiženja</h3>
              {configLoaded && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  title="Ponastavi nastavitve na privzete vrednosti"
                  onClick={() => {
                    if (!activeCompany) return;
                    clearImportConfigApi(activeCompany.id);
                    setBankAccountId("");
                    setArAccountId("");
                    setApAccountId("");
                    setConfigLoaded(false);
                  }}
                >
                  <RotateCcw className="h-3 w-3" />
                  Ponastavi nastavitve
                </button>
              )}
            </div>
            {configLoaded && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                Predizpolnjeno iz prejšnjega uvoza.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Računovodsko obdobje <span className="text-destructive">*</span></Label>
                <Select value={periodId} onValueChange={setPeriodId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Izberite obdobje" />
                  </SelectTrigger>
                  <SelectContent>
                    {openPeriods.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                    {openPeriods.length === 0 && (
                      <SelectItem value="none" disabled>Ni odprtih obdobij</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Bančni konto <span className="text-destructive">*</span></Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="npr. 1100 Banka" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                    {bankAccounts.length === 0 && (
                      <SelectItem value="none" disabled>Ni bančnih kontov (11x)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Konto terjatev (za prejeta plačila)</Label>
                <Select value={arAccountId} onValueChange={setArAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="npr. 1200 Terjatve" />
                  </SelectTrigger>
                  <SelectContent>
                    {arAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Konto obveznosti (za izplačila)</Label>
                <Select value={apAccountId} onValueChange={setApAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="npr. 2200 Obveznosti" />
                  </SelectTrigger>
                  <SelectContent>
                    {apAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Auto-post option */}
          <div className="flex items-start gap-3 p-4 border rounded-lg bg-card">
            <Checkbox
              id="auto-post"
              checked={autoPost}
              onCheckedChange={(v) => setAutoPost(!!v)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="auto-post" className="cursor-pointer font-medium">
                Samodejno poknjiži po uvozu
              </Label>
              <p className="text-xs text-muted-foreground">
                Vsako ustvarjeno plačilo bo takoj poknjiženo. Napake pri posameznem knjiženju ne prekinejo uvoza — prikazane so skupaj na koncu.
              </p>
            </div>
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Napaka pri razčlenjevanju</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleParse}
              disabled={!file || !periodId || !bankAccountId || (!arAccountId && !apAccountId) || parsing || matching}
            >
              {(parsing || matching) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {parsing ? "Razčlenjujem..." : matching ? "Iščem ujemanja..." : "Nadaljuj"}
              {!parsing && !matching && <ChevronRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Review ──────────────────────────────────────────────────── */}
      {step === "review" && (
        <div className="space-y-4">
          {/* Skipped rows warning */}
          {skippedRows.length > 0 && (
            <Alert variant="default" className="border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {skippedRows.length === 1
                  ? "1 vrstica je bila preskočena"
                  : `${skippedRows.length} vrstic je bilo preskočenih`}
              </AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Naslednje vrstice niso bile uvožene zaradi neveljavnih podatkov:
                </p>
                <ul className="space-y-1 text-sm">
                  {skippedRows.slice(0, 10).map((row, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-mono text-amber-700 shrink-0">V{row.lineNumber}:</span>
                      <span>{row.reason}</span>
                    </li>
                  ))}
                  {skippedRows.length > 10 && (
                    <li className="text-amber-700 text-xs">… in še {skippedRows.length - 10} vrstic</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Progress panel — shown while confirming */}
          {confirming && confirmProgress && (
            <div className="p-5 border rounded-lg bg-card space-y-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{confirmProgress.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {confirmProgress.action === "creating" ? "Ustvarjam plačila…" : "Knjižim v glavno knjigo…"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  {confirmProgress.current}/{confirmProgress.total}
                </span>
              </div>
              <Progress
                value={Math.round((confirmProgress.current / confirmProgress.total) * 100)}
                className="h-2"
              />
            </div>
          )}

          {/* Summary bar */}
          <div className="flex flex-wrap gap-4 p-4 border rounded-lg bg-card">
            <div className="text-sm">
              <span className="text-muted-foreground">Skupaj transakcij: </span>
              <span className="font-semibold">{suggestions.length}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Usklajenih: </span>
              <span className="font-semibold text-green-600">{matchedCount}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Preskoči: </span>
              <span className="font-semibold text-muted-foreground">{skippedCount}</span>
            </div>
            {duplicateCount > 0 && (
              <div className="text-sm flex items-center gap-1">
                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-muted-foreground">Možni duplikati: </span>
                <span className="font-semibold text-amber-600">{duplicateCount}</span>
              </div>
            )}
            {pendingCount > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Čaka na odločitev: </span>
                <span className="font-semibold text-amber-600">{pendingCount}</span>
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("upload")} disabled={confirming}>
                <ChevronLeft className="mr-1 h-3 w-3" /> Nazaj
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={matchedCount === 0 || confirming}>
                {confirming && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Poknjiži {matchedCount} plačil <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Transaction rows */}
          <div className="space-y-3">
            {suggestions.map(item => (
              <TransactionReviewRow
                key={item.transaction.id}
                item={item}
                decision={decisions.get(item.transaction.id) ?? { kind: "pending" }}
                onDecision={d => setDecision(item.transaction.id, d)}
                counterparties={counterparties}
                duplicateOf={item.duplicateOf}
              />
            ))}
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("upload")} disabled={confirming}>
              <ChevronLeft className="mr-2 h-4 w-4" /> Nazaj na uvoz
            </Button>
            <Button onClick={handleConfirm} disabled={matchedCount === 0 || confirming}>
              {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Poknjiži {matchedCount} plačil
            </Button>
          </div>
        </div>
      )}

      {/* ─── Company-changed mid-wizard warning dialog ───────────────────────── */}
      <Dialog open={showCompanyChangedDialog} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-500" />
              Podjetje je bilo zamenjano
            </DialogTitle>
            <DialogDescription>
              Med potekom čarovnika ste zamenjali aktivno podjetje. Predlogi ujemanja in sprejete odločitve se nanašajo na prejšnje podjetje in so zato neveljavni.
              <br /><br />
              Čarovnik bo ponastavljen na prvi korak, da lahko začnete uvoz za pravilno podjetje.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowCompanyChangedDialog(false);
                wizardCompanyIdRef.current = null;
                reset();
              }}
            >
              Razumem — ponastavi čarovnik
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── STEP 3: Confirm / Done ──────────────────────────────────────────── */}
      {step === "confirm" && confirmResult && (
        <div className="max-w-lg mx-auto text-center space-y-6 py-8">
          <div className={`h-20 w-20 rounded-full flex items-center justify-center mx-auto ${confirmResult.postErrors.length > 0 ? "bg-amber-100" : "bg-green-100"}`}>
            {confirmResult.postErrors.length > 0
              ? <AlertCircle className="h-10 w-10 text-amber-600" />
              : <CheckCircle2 className="h-10 w-10 text-green-600" />
            }
          </div>
          <div>
            <h2 className="text-2xl font-bold">Uvoz zaključen</h2>
            <div className="text-muted-foreground mt-2 space-y-1">
              <p>
                Ustvarjenih plačil: <span className="font-semibold text-foreground">{confirmResult.created}</span>
                {confirmResult.skipped > 0 && (
                  <> · Preskočenih: <span className="font-semibold text-foreground">{confirmResult.skipped}</span></>
                )}
              </p>
              {autoPost && (
                <p>
                  Poknjiženih: <span className="font-semibold text-green-700">{confirmResult.posted}</span>
                  {confirmResult.postErrors.length > 0 && (
                    <> · Napak pri knjiženju: <span className="font-semibold text-amber-600">{confirmResult.postErrors.length}</span></>
                  )}
                </p>
              )}
            </div>
          </div>
          {confirmResult.postErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Napake pri samodejnem knjiženju</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1 text-left list-disc list-inside">
                  {confirmResult.postErrors.map((e, i) => (
                    <li key={i} className="text-xs">{e}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">Plačila so bila ustvarjena — poknjižite jih ročno v seznamu plačil.</p>
              </AlertDescription>
            </Alert>
          )}
          {confirmError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{confirmError}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={reset}>
              Nov uvoz
            </Button>
            <Button asChild>
              <a href="/placila">Pojdi na plačila</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step indicator component ─────────────────────────────────────────────────

function StepIndicator({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? "text-foreground" : done ? "text-green-600" : "text-muted-foreground"}`}>
      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold border-2 
        ${active ? "border-primary bg-primary text-primary-foreground" : done ? "border-green-600 bg-green-600 text-white" : "border-muted-foreground"}`}>
        {done ? <Check className="h-3 w-3" /> : num}
      </div>
      <span className="text-sm font-medium hidden sm:block">{label}</span>
    </div>
  );
}

// ─── Transaction review row ───────────────────────────────────────────────────

function TransactionReviewRow({
  item,
  decision,
  onDecision,
  counterparties,
  duplicateOf,
}: {
  item: TransactionWithSuggestions;
  decision: MatchDecision;
  onDecision: (d: MatchDecision) => void;
  counterparties: any[];
  duplicateOf?: DuplicateInfo;
}) {
  const tx = item.transaction;
  const isInbound = tx.amount > 0;
  const [showManual, setShowManual] = useState(false);
  const [manualInvoiceId, setManualInvoiceId] = useState("");
  const [manualAmount, setManualAmount] = useState(Math.abs(tx.amount).toFixed(2));

  // Duplicate transactions get amber border even when skipped, to stay visually distinct
  const statusColor =
    decision.kind === "matched" ? "border-green-500 bg-green-50"
    : decision.kind === "skip" && duplicateOf ? "border-amber-400 bg-amber-50/40"
    : decision.kind === "skip" ? "border-muted bg-muted/20"
    : "border-amber-400 bg-amber-50";

  return (
    <div className={`border-2 rounded-lg p-4 transition-colors ${statusColor}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Transaction info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">{tx.date}</span>
            <Badge variant={isInbound ? "default" : "secondary"} className={`text-xs ${isInbound ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-orange-100 text-orange-800 hover:bg-orange-100"}`}>
              {isInbound ? "Prejeto" : "Izplačano"}
            </Badge>
            {tx.reference && (
              <span className="text-xs text-muted-foreground font-mono">{tx.reference}</span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className={`text-lg font-bold ${isInbound ? "text-green-700" : "text-red-700"}`}>
              {isInbound ? "+" : ""}{tx.amount.toFixed(2)} {tx.currency}
            </span>
            {tx.counterpartyName && (
              <span className="text-sm text-muted-foreground truncate">{tx.counterpartyName}</span>
            )}
          </div>
          {tx.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{tx.description}</p>
          )}
        </div>

        {/* Decision actions */}
        <div className="flex items-center gap-2 shrink-0">
          {decision.kind === "skip" ? (
            <Button variant="ghost" size="sm" onClick={() => onDecision({ kind: "pending" })}>
              <X className="h-3 w-3 mr-1" /> Razveljavi preskakovanje
            </Button>
          ) : decision.kind === "matched" ? (
            <>
              <div className="text-xs text-green-700 font-medium">
                ✓ {decision.invoiceNumber} — {parseFloat(decision.allocatedAmount).toFixed(2)}
              </div>
              <Button variant="ghost" size="sm" className="text-muted-foreground h-7 px-2" onClick={() => onDecision({ kind: "pending" })}>
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onDecision({ kind: "skip" })}>
              <SkipForward className="h-3 w-3 mr-1" /> Preskoči
            </Button>
          )}
        </div>
      </div>

      {/* Duplicate warning — shown regardless of decision so user can consciously override */}
      {duplicateOf && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Možni podvojen uvoz.</span>{" "}
            Plačilo z istim datumom ({duplicateOf.paymentDate}), zneskom ({parseFloat(duplicateOf.amount).toFixed(2)})
            {duplicateOf.reference ? ` in sklicem ${duplicateOf.reference}` : ""} je že v sistemu.
            {decision.kind === "skip" && (
              <> Transakcija je privzeto preskočena.{" "}
                <button
                  type="button"
                  className="underline font-medium hover:text-amber-900"
                  onClick={() => onDecision({ kind: "pending" })}
                >
                  Uvozi kljub temu
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {decision.kind !== "matched" && decision.kind !== "skip" && (
        <div className="mt-3 space-y-2">
          {item.suggestions.length > 0 ? (
            <>
              <p className="text-xs font-medium text-muted-foreground">Predlagana ujemanja:</p>
              <div className="space-y-1.5">
                {item.suggestions.map(s => (
                  <button
                    key={s.invoiceId}
                    type="button"
                    className="w-full text-left border rounded-md p-2.5 text-xs hover:border-primary/50 hover:bg-muted/30 transition-colors flex items-center justify-between gap-2"
                    onClick={() => onDecision({
                      kind: "matched",
                      invoiceId: s.invoiceId,
                      invoiceNumber: s.invoiceNumber,
                      counterpartyId: s.counterpartyId,
                      counterpartyName: s.counterpartyName,
                      allocatedAmount: s.remainingAmount,
                    })}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{s.invoiceNumber}</span>
                        <span className="text-muted-foreground">{s.counterpartyName}</span>
                        <span className="text-muted-foreground">{s.invoiceDate}</span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">{s.matchReasons.join(" · ")}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold">{parseFloat(s.remainingAmount).toFixed(2)}</div>
                      <ConfidenceBadge confidence={s.confidence} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Info className="h-3 w-3 shrink-0" />
              Ni samodejnih predlogov. Izberite ročno ali transakcijo preskočite.
            </div>
          )}

          <button
            type="button"
            className="text-xs text-primary underline-offset-4 hover:underline"
            onClick={() => setShowManual(v => !v)}
          >
            {showManual ? "Skrij ročno ujemanje" : "Ročno poravnaj z računom"}
          </button>

          {showManual && (
            <ManualMatchForm
              tx={tx}
              counterparties={counterparties}
              manualAmount={manualAmount}
              setManualAmount={setManualAmount}
              onConfirm={(invoiceId, invoiceNumber, cpId, cpName, amount) => {
                onDecision({
                  kind: "matched",
                  invoiceId,
                  invoiceNumber,
                  counterpartyId: cpId,
                  counterpartyName: cpName,
                  allocatedAmount: amount,
                });
                setShowManual(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.7 ? "text-green-600" : confidence >= 0.4 ? "text-amber-600" : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{pct}% ujemanje</span>;
}

function ManualMatchForm({
  tx,
  counterparties,
  manualAmount,
  setManualAmount,
  onConfirm,
}: {
  tx: BankTransaction;
  counterparties: any[];
  manualAmount: string;
  setManualAmount: (v: string) => void;
  onConfirm: (invoiceId: string, invoiceNumber: string, cpId: string, cpName: string, amount: string) => void;
}) {
  const { activeCompany } = useCompany();
  const [cpId, setCpId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const expectedType = tx.amount > 0 ? "issued" : "received";
  const cpType = tx.amount > 0 ? "customer" : "supplier";
  const validCps = counterparties.filter(c => c.type === cpType || c.type === "both");

  const loadInvoices = async (counterpartyId: string) => {
    if (!activeCompany || !counterpartyId) return;
    setLoadingInvoices(true);
    try {
      const resp = await fetch(`/api/companies/${activeCompany.id}/invoices?counterpartyId=${counterpartyId}&status=posted&type=${expectedType}`);
      const data = await resp.json();
      setInvoices(data.invoices ?? []);
    } finally {
      setLoadingInvoices(false);
    }
  };

  const handleCpChange = (id: string) => {
    setCpId(id);
    setInvoiceId("");
    setInvoices([]);
    loadInvoices(id);
  };

  const selectedInv = invoices.find(i => i.id === invoiceId);
  const selectedCp = validCps.find(c => c.id === cpId);

  return (
    <div className="p-3 border rounded-md bg-background space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Partner</Label>
          <Select value={cpId} onValueChange={handleCpChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Izberite partnerja" />
            </SelectTrigger>
            <SelectContent>
              {validCps.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Račun</Label>
          <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!cpId || loadingInvoices}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={loadingInvoices ? "Nalagam..." : "Izberite račun"} />
            </SelectTrigger>
            <SelectContent>
              {invoices.map(inv => (
                <SelectItem key={inv.id} value={inv.id}>{inv.invoiceNumber} ({parseFloat(inv.totalGross).toFixed(2)})</SelectItem>
              ))}
              {invoices.length === 0 && !loadingInvoices && (
                <SelectItem value="none" disabled>Ni računov</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div className="space-y-1 flex-1">
          <Label className="text-xs">Znesek poravnave</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={manualAmount}
            onChange={e => setManualAmount(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          className="h-8"
          disabled={!cpId || !invoiceId || !parseFloat(manualAmount)}
          onClick={() => {
            if (selectedInv && selectedCp) {
              onConfirm(invoiceId, selectedInv.invoiceNumber, cpId, selectedCp.name, manualAmount);
            }
          }}
        >
          <Check className="h-3 w-3 mr-1" /> Potrdi
        </Button>
      </div>
    </div>
  );
}
