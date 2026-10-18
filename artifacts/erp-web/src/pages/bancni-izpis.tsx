import { formatDatum } from "@/lib/utils";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { useUser } from "@clerk/react";
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
  useListPayments,
  useListInvoices,
  reconcileBankStatementLine,
  useListCostCenters,
  useListProjects,
  updatePaymentDimensions,
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
import { BankStatementDetail } from "@/components/bank-statement-detail";
import { bankImportDimensionWarnings, paymentDimensions, type BankPaymentDimensions } from "@/lib/bank-import-dimensions";
import { bankImportDraftKey, readBankImportDraft, writeBankImportDraft, type ImportedBankPayment } from "@/lib/bank-import-draft";
import { useBankPostingRefresh } from "@/hooks/use-bank-posting-refresh";
import { useBankImportResult } from "@/hooks/use-bank-import-result";
import { useBankImportLeaveGuard } from "@/hooks/use-bank-import-leave-guard";

type ImportError = { message: string; paymentId?: string };

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

type MatchDecision = (
  | { kind: "matched"; invoiceId: string; invoiceNumber: string; counterpartyId: string; counterpartyName: string; allocatedAmount: string }
  | { kind: "standalone"; counterpartyId: string; arApAccountId: string }
  | { kind: "reconcile"; paymentId: string; label: string }
  | { kind: "skip" }
  | { kind: "pending" }) & BankPaymentDimensions;

interface PendingReconcileConfirm {
  transactionId: string;
  lineId: string;
  paymentId: string;
  label: string;
  txDate: string;
  txReference: string | null;
  warnings: string[];
  required: string[];
  error?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function parseBankStatement(
  companyId: string,
  file: File,
): Promise<ParsedStatement> {
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

interface StatementMetadata {
  statementNumber: string | null;
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceIban: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string;
}

interface ParsedStatement {
  transactions: BankTransaction[];
  count: number;
  skippedRows: SkippedRow[];
  metadata: StatementMetadata;
  sourceFilename: string;
  sourceSha256: string;
}

interface RegisteredStatement {
  id: string;
  bankAccountCode: string;
  bankAccountName: string;
  sourceIban: string | null;
  statementNumber: string | null;
  statementDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  currency: string;
  sourceFilename: string;
  lineCount: number;
}

async function registerBankStatement(
  companyId: string,
  bankAccountId: string,
  parsed: ParsedStatement,
): Promise<{ statementId: string; lineIds: Record<string, string> }> {
  const resp = await fetch(`/api/companies/${companyId}/bank-statements/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bankAccountId,
      metadata: parsed.metadata,
      sourceFilename: parsed.sourceFilename,
      sourceSha256: parsed.sourceSha256,
      transactions: parsed.transactions,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw Object.assign(new Error((err as any).error ?? `HTTP ${resp.status}`), { status: resp.status });
  }
  return resp.json();
}

interface CreatePaymentPayload extends BankPaymentDimensions {
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
  bankStatementLineId?: string;
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
    throw Object.assign(new Error((err as any).error ?? `HTTP ${resp.status}`), { status: resp.status });
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
    throw Object.assign(new Error((err as any).error ?? `HTTP ${resp.status}`), { status: resp.status });
  }
}

export async function matchTransactions(
  companyId: string,
  transactions: BankTransaction[],
  onProgress: (current: number, total: number) => void,
): Promise<{ suggestions: TransactionWithSuggestions[] }> {
  const resp = await fetch(`/api/companies/${companyId}/bank-statements/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ transactions }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error("Strežnik ni omogočil prikaza napredka");
  }

  const suggestions: TransactionWithSuggestions[] = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedTotal: number | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "suggestion"; suggestion: TransactionWithSuggestions; current: number; total: number }
      | { type: "complete"; total: number };
    if (event.type === "suggestion") {
      if (event.total !== transactions.length || event.current !== suggestions.length + 1) {
        throw new Error("Strežnik je vrnil neveljaven potek iskanja ujemanj");
      }
      suggestions.push(event.suggestion);
      onProgress(event.current, event.total);
    } else {
      completedTotal = event.total;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
    if (done) break;
  }
  processLine(buffer);

  if (completedTotal !== transactions.length || suggestions.length !== transactions.length) {
    throw new Error("Iskanje ujemanj se je predčasno prekinilo");
  }

  return { suggestions };
}

// ─── Wizard steps ─────────────────────────────────────────────────────────────

type Step = "upload" | "review" | "confirm";

interface BankImportDraft {
  parsedStatement: ParsedStatement;
  suggestions: TransactionWithSuggestions[];
  decisions: [string, MatchDecision][];
  periodId: string;
  bankAccountId: string;
  arAccountId: string;
  apAccountId: string;
  autoPost: boolean;
  imported: Record<string, ImportedBankPayment>;
  registered?: { statementId: string; lineIds: Record<string, string> };
}

// ─── Import config persistence (API-based) ───────────────────────────────────

interface SavedImportConfig {
  bankAccountId: string | null;
  arAccountId: string | null;
  apAccountId: string | null;
}

async function fetchImportConfig(companyId: string, signal?: AbortSignal): Promise<SavedImportConfig | null> {
  try {
    const resp = await fetch(`/api/companies/${companyId}/import-config`, { signal });
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
  const { activeCompany, userId } = useCompany();
  const [wizardCompanyId, setWizardCompanyId] = useState(activeCompany?.id);
  // Identity changes must discard in-memory choices. Company changes remount
  // only after the existing leave guard has approved departure.
  return <BankImportWizard
    key={`${userId ?? ""}:${wizardCompanyId ?? ""}`}
    onCompanyReady={setWizardCompanyId}
  />;
}

function BankImportWizard({ onCompanyReady }: { onCompanyReady: (companyId: string | undefined) => void }) {
  const { activeCompany, setActiveCompany } = useCompany();
  const { user, isLoaded } = useUser();
  const userId = isLoaded ? user?.id : undefined;
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

  // Set to true when at least one saved account ID was cleared because it no
  // longer exists in the active accounts list (deactivated / deleted).
  const [invalidAccountsCleared, setInvalidAccountsCleared] = useState(false);

  // Load saved config when the active company changes
  useEffect(() => {
    if (!activeCompany) return;
    // Strict Mode can replay configuration loading after restoring the draft.
    if (wizardCompanyIdRef.current === activeCompany.id) return;
    // Clear immediately to prevent stale values from a previous company
    setBankAccountId("");
    setArAccountId("");
    setApAccountId("");
    setConfigLoaded(false);
    setInvalidAccountsCleared(false);
    const companyId = activeCompany.id;
    let cancelled = false;
    const controller = new AbortController();
    fetchImportConfig(companyId, controller.signal).then(saved => {
      // Keep the cleanup guard even if the transport ignores cancellation.
      if (cancelled || wizardCompanyIdRef.current) return;
      setBankAccountId(saved?.bankAccountId ?? "");
      setArAccountId(saved?.arAccountId ?? "");
      setApAccountId(saved?.apAccountId ?? "");
      setConfigLoaded(!!saved);
      setInvalidAccountsCleared(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

  // Skipped rows from the last parse
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [parsedStatement, setParsedStatement] = useState<ParsedStatement | null>(null);
  const [registeredStatements, setRegisteredStatements] = useState<RegisteredStatement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<{ companyId: string; id: string } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("statementId");
    if (activeCompany && id && /^[0-9a-f-]{36}$/.test(id)) {
      setSelectedStatement({ companyId: activeCompany.id, id });
    }
  }, [activeCompany?.id]);
  const loadRegisteredStatements = useCallback(async () => {
    if (!activeCompany) return;
    const response = await fetch(`/api/companies/${activeCompany.id}/bank-statements`);
    if (!response.ok) return;
    const data = await response.json();
    setRegisteredStatements(data.statements ?? []);
  }, [activeCompany]);
  useEffect(() => {
    loadRegisteredStatements();
  }, [loadRegisteredStatements]);

  // Step 2 state
  const [suggestions, setSuggestions] = useState<TransactionWithSuggestions[]>([]);
  const [decisions, setDecisions] = useState<Map<string, MatchDecision>>(new Map());
  const [matching, setMatching] = useState(false);
  const [matchingProgress, setMatchingProgress] = useState<{ current: number; total: number } | null>(null);

  // Auto-post option
  const [autoPost, setAutoPost] = useState(false);
  const [imported, setImported] = useState<Record<string, ImportedBankPayment>>({});
  const importedRef = useRef<Record<string, ImportedBankPayment>>({});
  const draftRef = useRef<BankImportDraft | null>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const draftKey = userId && activeCompany?.id ? bankImportDraftKey(userId, activeCompany.id) : null;
  const [restored, setRestored] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  // Track the company that was active when the wizard started (step 1 → 2 transition).
  // If the user switches company while mid-wizard we detect it and reset.
  const wizardCompanyIdRef = useRef<string | null>(null);
  const [showCompanyChangedDialog, setShowCompanyChangedDialog] = useState(false);

  // Step 3 state
  const [confirming, setConfirming] = useState(false);
  const confirmInFlightRef = useRef(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pendingConfirms, setPendingConfirms] = useState<PendingReconcileConfirm[]>([]);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  // Hold the result's scope until departure has been approved, so switching
  // companies cannot discard the only in-memory copy before asking.
  const [resultCompany, setResultCompany] = useState(activeCompany);
  const { result: confirmResult, setResult: setConfirmResult, storageMessage, canRestore } =
    useBankImportResult(userId, resultCompany?.id);
  const hasUnrecoverableWarnings = !!confirmResult?.postErrors.length && !canRestore;
  const confirmLeave = useBankImportLeaveGuard(hasUnrecoverableWarnings);
  useEffect(() => {
    if (resultCompany?.id === activeCompany?.id) {
      onCompanyReady(activeCompany?.id);
      return;
    }
    if (hasUnrecoverableWarnings) {
      if (!confirmLeave()) {
        try { setActiveCompany(resultCompany); } catch { /* In-memory selection is restored even if storage is blocked. */ }
        return;
      }
      wizardCompanyIdRef.current = null;
      draftRef.current = null;
      importedRef.current = {};
      setImported({});
      setPendingConfirms([]);
      setShowCompanyChangedDialog(false);
      setStep("upload");
    }
    setResultCompany(activeCompany);
    onCompanyReady(activeCompany?.id);
  }, [activeCompany?.id, userId, onCompanyReady]);
  const [confirmProgress, setConfirmProgress] = useState<{
    current: number;
    total: number;
    action: "creating" | "posting";
    label: string;
  } | null>(null);

  useEffect(() => {
    if (hasUnrecoverableWarnings) return;
    if (!draftKey || restoredKeyRef.current === draftKey) return;
    const previousKey = restoredKeyRef.current;
    restoredKeyRef.current = draftKey;
    // Existing company-switch confirmation owns clearing the old wizard.
    if (wizardCompanyIdRef.current && wizardCompanyIdRef.current !== activeCompany?.id) return;
    if (previousKey && previousKey !== draftKey) {
      wizardCompanyIdRef.current = null;
      draftRef.current = null;
      importedRef.current = {};
      setImported({});
      setParsedStatement(null);
      setSuggestions([]);
      setDecisions(new Map());
      setStep("upload");
      setRestored(false);
      setConfirmError(null);
    }
    setHydratedKey(draftKey);
    try {
      const draft = readBankImportDraft<BankImportDraft>(draftKey);
      if (!draft) return;
      draftRef.current = draft;
      importedRef.current = draft.imported ?? {};
      setImported(importedRef.current);
      wizardCompanyIdRef.current = activeCompany!.id;
      setParsedStatement(draft.parsedStatement);
      setSkippedRows(draft.parsedStatement.skippedRows ?? []);
      setSuggestions(draft.suggestions);
      setDecisions(new Map(draft.decisions));
      setPeriodId(draft.periodId);
      setBankAccountId(draft.bankAccountId);
      setArAccountId(draft.arAccountId);
      setApAccountId(draft.apAccountId);
      setConfigLoaded(true);
      setAutoPost(draft.autoPost);
      setRestored(true);
      setStep("review");
    } catch {
      setParseError("Osnutka bančnega uvoza ni bilo mogoče obnoviti. Preverite obstoječa plačila pred ponovnim uvozom.");
    }
  }, [draftKey, activeCompany?.id, hasUnrecoverableWarnings]);

  const saveDraft = (): boolean => {
    if (!draftKey || hydratedKey !== draftKey || !parsedStatement || wizardCompanyIdRef.current !== activeCompany?.id) return false;
    const draft: BankImportDraft = {
      parsedStatement, suggestions, decisions: [...decisions], periodId,
      bankAccountId, arAccountId, apAccountId, autoPost, imported: importedRef.current,
      registered: draftRef.current?.registered,
    };
    draftRef.current = draft;
    try {
      writeBankImportDraft(draftKey, draft);
      return true;
    } catch {
      setConfirmError("Napredka uvoza ni mogoče shraniti v brskalnik. Uvoz je ustavljen. Pred nadaljevanjem preverite že ustvarjena plačila v seznamu plačil.");
      return false;
    }
  };
  useEffect(() => {
    if (step !== "upload") saveDraft();
  }, [draftKey, hydratedKey, step, parsedStatement, suggestions, decisions, periodId, bankAccountId, arAccountId, apAccountId, autoPost]);

  const checkpointPayment = (transactionId: string, payment: ImportedBankPayment): boolean => {
    importedRef.current = { ...importedRef.current, [transactionId]: payment };
    setImported(importedRef.current);
    // Synchronous storage write before any following request (especially posting).
    if (!draftKey || !draftRef.current) return false;
    draftRef.current = { ...draftRef.current, imported: importedRef.current };
    try {
      writeBankImportDraft(draftKey, draftRef.current);
      return true;
    } catch {
      setConfirmError("Plačilo je ustvarjeno, vendar napredka ni mogoče shraniti. Uvoz je ustavljen; pred ponovnim uvozom preverite seznam plačil.");
      return false;
    }
  };

  const sessionExpired = (error: any): boolean => {
    if (error?.status !== 401) return false;
    setConfirmError("Seja je potekla. Ponovno se prijavite in nadaljujte uvoz. Že ustvarjena plačila ne bodo poslana znova; stanje nepotrjenega knjiženja preverite v seznamu plačil.");
    return true;
  };

  const clearPostedWarnings = useCallback((postedIds: Set<string>) => {
    // Refresh confirmed posting status in the recovery journal as well as the
    // summary, without changing which rows are eligible for creation.
    for (const [transactionId, payment] of Object.entries(importedRef.current)) {
      if (postedIds.has(payment.paymentId) && payment.posting !== "posted") {
        checkpointPayment(transactionId, { paymentId: payment.paymentId, posting: "posted" });
      }
    }
    setConfirmResult(cur => {
      if (!cur || cur.userId !== userId || cur.companyId !== activeCompany?.id) return cur;
      const resolved = new Set(cur.postErrors.flatMap(error =>
        error.paymentId && postedIds.has(error.paymentId) ? [error.paymentId] : []));
      return {
        ...cur, posted: cur.posted + resolved.size,
        postErrors: cur.postErrors.filter(error => !error.paymentId || !resolved.has(error.paymentId)),
      };
    });
  }, [userId, activeCompany?.id, draftKey]);
  useBankPostingRefresh(userId,
    resultCompany?.id === activeCompany?.id ? activeCompany?.id : undefined,
    [
      ...(confirmResult?.postErrors.flatMap(error => error.paymentId ? [error.paymentId] : []) ?? []),
      ...Object.values(imported).filter(payment => payment.posting === "pending" || payment.posting === "failed")
        .map(payment => payment.paymentId),
    ],
    clearPostedWarnings);

  // Data fetching
  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  // Samo knjižljivi konti — skupinski/sintetični konti (allowsPosting=false) niso na voljo za izbiro
  const accounts = (accountsData?.accounts ?? []).filter(a => a.isActive && a.allowsPosting !== false);
  const bankAccounts = accounts.filter(a => a.code.startsWith("11"));
  const arAccounts = accounts;
  const apAccounts = accounts;
  const { data: invoicesData } = useListInvoices(activeCompany?.id ?? "", {}, {
    query: { enabled: !!activeCompany?.id } as any,
  });
  const invoices = invoicesData?.invoices ?? [];

  const { data: paymentsData } = useListPayments(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const reconcilablePayments = (paymentsData?.payments ?? []).filter(p => p.status === "draft" || p.status === "posted");
  const { data: costCentersData } = useListCostCenters(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const { data: projectsData } = useListProjects(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });

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
    if (hasUnrecoverableWarnings) return;
    // Company changed while wizard is in progress — show warning dialog.
    // The actual reset + ref clear happens when the user confirms the dialog.
    setShowCompanyChangedDialog(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id, step]);

  // After accounts are fetched, validate saved IDs against actual account lists.
  // If a saved ID is no longer in the active accounts, clear it so the user
  // cannot silently post to a deactivated or deleted account.
  // We also surface a warning so the user knows they must choose a new account.
  useEffect(() => {
    if (!configLoaded) return;
    // Only validate once accounts have been fetched (non-empty data means the
    // query resolved — an empty list is itself a valid resolved state).
    if (!accountsData) return;
    let anyCleared = false;
    if (bankAccountId && !bankAccounts.some(a => a.id === bankAccountId)) {
      setBankAccountId("");
      anyCleared = true;
    }
    if (arAccountId && !arAccounts.some(a => a.id === arAccountId)) {
      setArAccountId("");
      anyCleared = true;
    }
    if (apAccountId && !apAccounts.some(a => a.id === apAccountId)) {
      setApAccountId("");
      anyCleared = true;
    }
    if (anyCleared) {
      setInvalidAccountsCleared(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsData, configLoaded, bankAccounts.length, arAccounts.length, apAccounts.length]);

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
      const parsed = await parseBankStatement(activeCompany.id, file);
      if (parsedStatement?.sourceSha256 !== parsed.sourceSha256) {
        importedRef.current = {};
        draftRef.current = null;
        setImported({});
        setRestored(false);
      }
      const { transactions, skippedRows: sr } = parsed;
      setParsedStatement(parsed);
      setSkippedRows(sr);
      setMatching(true);
      setMatchingProgress({ current: 0, total: transactions.length });
      const { suggestions: s } = await matchTransactions(activeCompany.id, transactions, (current, total) => {
        setMatchingProgress({ current, total });
      });

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
      setMatchingProgress(null);
    }
  };

  // ─── Step 2: Review matches ────────────────────────────────────────────────

  const setDecision = (txId: string, decision: MatchDecision) => {
    if (importedRef.current[txId] || confirmInFlightRef.current) return;
    setDecisions(prev => new Map(prev).set(txId, decision));
  };

  const matchedCount = [...decisions].filter(([id, d]) => !imported[id] && (d.kind === "matched" || d.kind === "reconcile" || d.kind === "standalone")).length;
  const skippedCount = [...decisions.values()].filter(d => d.kind === "skip").length;
  const pendingCount = [...decisions.values()].filter(d => d.kind === "pending").length;
  const duplicateCount = suggestions.filter(s => s.duplicateOf).length;
  const dimensionWarnings = new Map(suggestions.map(item => [
    item.transaction.id,
    imported[item.transaction.id] ? [] : bankImportDimensionWarnings(
      decisions.get(item.transaction.id) ?? { kind: "pending" },
      bankAccountId, accounts, invoices, reconcilablePayments, autoPost,
    ),
  ]));
  const hasMissingDimensions = [...dimensionWarnings.values()].some(warnings => warnings.length > 0);

  // ─── Step 3: Confirm ──────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!activeCompany || !userId) return;
    // Hard invariant: the active company must be set and must match the company
    // this wizard session was started for. A null ref means the session was
    // already reset; a mismatch means the user switched company after suggestions
    // were fetched. Either way, block and force a reset.
    if (!wizardCompanyIdRef.current || activeCompany.id !== wizardCompanyIdRef.current) {
      setShowCompanyChangedDialog(true);
      return;
    }
    if (hasMissingDimensions) {
      setConfirmError("Uvoz ni dovoljen: preverite opozorila o obveznih dimenzijah pri transakcijah.");
      return;
    }
    for (const item of suggestions) {
      if (importedRef.current[item.transaction.id]) continue;
      const decision = decisions.get(item.transaction.id);
      if (decision?.kind !== "matched" && decision?.kind !== "standalone") continue;
      const accountId = decision.kind === "standalone"
        ? decision.arApAccountId
        : invoices.find(invoice => invoice.id === decision.invoiceId)?.arApAccountId;
      if (!decision.counterpartyId || !accounts.some(account => account.id === accountId)) {
        setConfirmError(`Transakcija ${item.transaction.reference ?? item.transaction.date}: izberite partnerja in aktiven knjižljiv protikonto.`);
        return;
      }
    }
    // React state is not updated synchronously, so a fast second click can enter
    // this handler before `confirming` disables the button. Acquire a synchronous
    // lock before the first state update to guarantee one import per confirmation.
    if (confirmInFlightRef.current) return;
    if (!saveDraft()) return;
    confirmInFlightRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    setConfirmProgress(null);

    let created = 0;
    let skipped = 0;
    let posted = 0;
    const postErrors: ImportError[] = [];
    const pendingList: PendingReconcileConfirm[] = [];

    // Count only matched transactions for the progress total
    const toProcess = suggestions.filter(item => {
      const d = decisions.get(item.transaction.id);
      return !importedRef.current[item.transaction.id] && d && (d.kind === "matched" || d.kind === "reconcile" || d.kind === "standalone");
    });
    const total = toProcess.length;
    let processedIndex = 0;
    if (!parsedStatement) {
      setConfirmError("Podatki izpiska niso več na voljo. Ponovite uvoz datoteke.");
      setConfirming(false);
      confirmInFlightRef.current = false;
      return;
    }
    let registered: { statementId: string; lineIds: Record<string, string> };
    try {
      // Registration is deliberately not idempotent: the API rejects a repeated
      // source hash. Keep its acknowledged line IDs just like payment results.
      registered = draftRef.current?.registered
        ?? await registerBankStatement(activeCompany.id, bankAccountId, parsedStatement);
      draftRef.current = { ...draftRef.current!, registered };
      writeBankImportDraft(draftKey!, draftRef.current);
    } catch (e: any) {
      if (!sessionExpired(e)) setConfirmError(draftRef.current?.registered
        ? "Izpisek je evidentiran, vendar napredka ni mogoče shraniti. Uvoz je ustavljen; pred ponovnim uvozom preverite evidenco izpiskov."
        : e.message ?? "Izpiska ni bilo mogoče evidentirati");
      setConfirming(false);
      confirmInFlightRef.current = false;
      return;
    }

    for (const item of suggestions) {
      const tx = item.transaction;
      if (importedRef.current[tx.id]) continue;
      const decision = decisions.get(tx.id);
      if (!decision || decision.kind === "skip") { skipped++; continue; }
      if (decision.kind === "pending") { skipped++; continue; }

      if (decision.kind === "reconcile") {
        processedIndex++;
        const lineId = registered.lineIds[tx.id];
        setConfirmProgress({ current: processedIndex, total, action: "creating", label: `Povezujem obstoječe plačilo ${processedIndex} od ${total}` });
        try {
          if (!lineId) throw new Error("Vrstica izpiska ni evidentirana");
          if (Object.keys(paymentDimensions(decision)).length) {
            await updatePaymentDimensions(activeCompany.id, decision.paymentId, paymentDimensions(decision));
          }
          const rec = await reconcileBankStatementLine(activeCompany.id, lineId, { paymentId: decision.paymentId });
          created++;
          if (!checkpointPayment(tx.id, { paymentId: rec.paymentId, posting: rec.status === "posted" ? "posted" : autoPost && rec.requiresExplicitPosting ? "pending" : "draft" })) break;
          // Reconcile never posts; post explicitly only a draft and only if the user chose posting.
          if (autoPost && rec.status === "draft" && rec.requiresExplicitPosting) {
            try {
              await postPayment(activeCompany.id, rec.paymentId); posted++;
              if (!checkpointPayment(tx.id, { paymentId: rec.paymentId, posting: "posted" })) break;
            } catch (e: any) {
              postErrors.push({ paymentId: rec.paymentId, message: `${tx.reference ?? tx.date}: ${e.message ?? "Napaka pri knjiženju"}` });
              if (!checkpointPayment(tx.id, { paymentId: rec.paymentId, posting: "failed", error: e.message }) || sessionExpired(e)) break;
            }
          }
        } catch (e: any) {
          if (e?.status === 409 && e?.data?.confirmationRequired) {
            // Needs explicit user confirmation; do not retry automatically.
            pendingList.push({
              transactionId: tx.id,
              lineId: registered.lineIds[tx.id], paymentId: decision.paymentId, label: decision.label,
              txDate: tx.date, txReference: tx.reference ?? null,
              warnings: e.data.warnings ?? [], required: e.data.requiredConfirmations ?? [],
            });
            continue;
          }
          skipped++;
          postErrors.push({ message: `${tx.reference ?? tx.date}: povezava ni uspela - ${e?.data?.error ?? e.message ?? "napaka"}` });
          if (sessionExpired(e)) break;
        }
        continue;
      }
      if (decision.kind !== "matched" && decision.kind !== "standalone") { skipped++; continue; }

      // matched
      processedIndex++;
      const direction = tx.amount > 0 ? "inbound" : "outbound";
      const arApAccountId = decision.kind === "standalone"
        ? decision.arApAccountId
        : invoices.find(invoice => invoice.id === decision.invoiceId)?.arApAccountId;
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
        if (!arApAccountId) throw new Error("Za transakcijo manjka protikonto. Preverite račun oziroma izberite konto.");
        if (!registered.lineIds[tx.id]) throw new Error("Vrstica izpiska ni evidentirana.");
        paymentId = await createPaymentApi(activeCompany.id, {
          ...paymentDimensions(decision),
          direction,
          counterpartyId,
          periodId,
          paymentDate: tx.date,
          amount: Math.abs(tx.amount),
          reference: tx.reference ?? null,
          bankAccountId,
          arApAccountId,
          notes: tx.description ?? null,
          allocations: decision.kind === "matched" ? [
            {
              invoiceId: decision.invoiceId,
              allocatedAmount: parseFloat(decision.allocatedAmount),
            },
          ] : [],
          bankStatementLineId: registered.lineIds[tx.id],
          force: forceImport,
        });
        created++;
      } catch (e: any) {
        // Record partial failure but continue
        skipped++;
        postErrors.push({ message: `${txLabel}: ${e.message ?? "Plačila ni bilo mogoče ustvariti"}` });
        if (sessionExpired(e)) break;
        continue;
      }
      if (!checkpointPayment(tx.id, { paymentId, posting: autoPost ? "pending" : "draft" })) break;

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
          if (!checkpointPayment(tx.id, { paymentId, posting: "posted" })) break;
        } catch (e: any) {
          const ref = tx.reference ?? tx.date;
          postErrors.push({ paymentId, message: `${ref}: ${e.message ?? "Napaka pri knjiženju"}` });
          if (!checkpointPayment(tx.id, { paymentId, posting: "failed", error: e.message }) || sessionExpired(e)) break;
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
    await loadRegisteredStatements().catch(() => {
      postErrors.push({ message: "Seznama izpiskov ni bilo mogoče osvežiti. Napredek uvoza je ohranjen." });
    });
    setPendingConfirms(pendingList);
    setConfirmResult({ userId, companyId: activeCompany.id, created, skipped, posted, postErrors });
    setConfirmProgress(null);
    setConfirming(false);
    confirmInFlightRef.current = false;
    setStep("confirm");
  };

  const confirmReconcile = async (c: PendingReconcileConfirm) => {
    if (!activeCompany || importedRef.current[c.transactionId] || retryBusy) return;
    setRetryBusy(c.lineId);
    try {
      const rec = await reconcileBankStatementLine(activeCompany.id, c.lineId, {
        paymentId: c.paymentId,
        ...(c.required.includes("confirmDateMismatch") ? { confirmDateMismatch: true } : {}),
        ...(c.required.includes("confirmReferenceMismatch") ? { confirmReferenceMismatch: true } : {}),
      });
      setPendingConfirms(cur => cur.filter(x => x.lineId !== c.lineId));
      if (!checkpointPayment(c.transactionId, { paymentId: rec.paymentId, posting: rec.status === "posted" ? "posted" : autoPost && rec.requiresExplicitPosting ? "pending" : "draft" })) return;
      let posted = 0;
      const errs: ImportError[] = [];
      if (autoPost && rec.status === "draft" && rec.requiresExplicitPosting) {
        try {
          await postPayment(activeCompany.id, rec.paymentId); posted = 1;
          checkpointPayment(c.transactionId, { paymentId: rec.paymentId, posting: "posted" });
        } catch (e: any) {
          checkpointPayment(c.transactionId, { paymentId: rec.paymentId, posting: "failed", error: e.message });
          sessionExpired(e);
          errs.push({ paymentId: rec.paymentId, message: `${c.txReference ?? formatDatum(c.txDate)}: ${e.message ?? "Napaka pri knjiženju"}` });
        }
      }
      setPendingConfirms(cur => cur.filter(x => x.lineId !== c.lineId));
      setConfirmResult(cur => cur && { ...cur, created: cur.created + 1, posted: cur.posted + posted, postErrors: [...cur.postErrors, ...errs] });
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(activeCompany.id) });
    } catch (e: any) {
      sessionExpired(e);
      const msg = e?.data?.error ?? e.message ?? "Povezava ni uspela";
      setPendingConfirms(cur => cur.map(x => x.lineId === c.lineId ? { ...x, error: msg } : x));
    } finally {
      setRetryBusy(null);
    }
  };
  const rejectReconcile = (c: PendingReconcileConfirm) => {
    setPendingConfirms(cur => cur.filter(x => x.lineId !== c.lineId));
    setConfirmResult(cur => cur && { ...cur, skipped: cur.skipped + 1 });
  };

  const reset = () => {
    if (!confirmLeave()) return;
    // A company switch must not delete the new company's recoverable draft.
    if (user?.id && wizardCompanyIdRef.current) {
      sessionStorage.removeItem(bankImportDraftKey(user.id, wizardCompanyIdRef.current));
    }
    wizardCompanyIdRef.current = null;
    importedRef.current = {};
    draftRef.current = null;
    setImported({});
    setRestored(false);
    setPendingConfirms([]);
    confirmInFlightRef.current = false;
    setStep("upload");
    setFile(null);
    setPeriodId("");
    setSuggestions([]);
    setDecisions(new Map());
    setSkippedRows([]);
    setParsedStatement(null);
    setConfirmResult(null);
    setConfirmError(null);
    setParseError(null);
    setMatchingProgress(null);
    setAutoPost(false);
    setInvalidAccountsCleared(false);
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
          Uvozite CAMT.053 XML, CSV ali MT940 datoteko in samodejno uskladite transakcije z odprtimi postavkami.
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

      {!!confirmResult?.postErrors.length && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napake pri obdelavi izpiska</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1 text-left list-disc list-inside">
              {confirmResult.postErrors.map((error, index) => (
                <li key={index} className="text-xs">{error.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">Preverite navedene transakcije. Uspešno ustvarjeni osnutki so v seznamu plačil; neuspešne vrstice ostanejo v evidenci izpiska.</p>
            <p className="mt-2 text-xs">{storageMessage}</p>
            <Button variant="outline" className="mt-3"
              onClick={() => setConfirmResult(cur => cur && { ...cur, postErrors: [] })}>
              Napake so ročno rešene
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {step === "upload" && registeredStatements.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Evidentirani bančni izpiski</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3">Št. izpiska</th>
                  <th className="p-3">Datum / obdobje</th>
                  <th className="p-3">TRR in konto</th>
                  <th className="p-3 text-right">Začetno stanje</th>
                  <th className="p-3 text-right">Končno stanje</th>
                  <th className="p-3 text-right">Vrstice</th>
                </tr>
              </thead>
              <tbody>
                {registeredStatements.map(statement => (
                  <tr
                    key={statement.id}
                    className="border-t cursor-pointer hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    role="button"
                    tabIndex={0}
                    aria-label={`Odpri bančni izpisek ${statement.statementNumber || formatDatum(statement.statementDate)}`}
                    data-testid={`button-open-statement-${statement.id}`}
                    onClick={() => { if (activeCompany) setSelectedStatement({ companyId: activeCompany.id, id: statement.id }); }}
                    onKeyDown={event => {
                      if ((event.key === "Enter" || event.key === " ") && activeCompany) {
                        event.preventDefault();
                        setSelectedStatement({ companyId: activeCompany.id, id: statement.id });
                      }
                    }}
                  >
                    <td className="p-3 font-medium">
                      {statement.statementNumber || "—"}
                      <span className="block text-xs font-normal text-primary">Odpri podrobnosti</span>
                    </td>
                    <td className="p-3">
                      <div>{formatDatum(statement.statementDate)}</div>
                      {statement.periodFrom && statement.periodTo && (
                        <div className="text-xs text-muted-foreground">{statement.periodFrom}–{statement.periodTo}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <div>{statement.sourceIban || "IBAN ni naveden"}</div>
                      <div className="text-xs text-muted-foreground">{statement.bankAccountCode} — {statement.bankAccountName}</div>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {statement.openingBalance == null ? "—" : `${Number(statement.openingBalance).toFixed(2)} ${statement.currency}`}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {statement.closingBalance == null ? "—" : `${Number(statement.closingBalance).toFixed(2)} ${statement.currency}`}
                    </td>
                    <td className="p-3 text-right tabular-nums">{statement.lineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activeCompany && (
            <BankStatementDetail
              companyId={activeCompany.id}
              statementId={selectedStatement?.companyId === activeCompany.id ? selectedStatement.id : null}
              onClose={() => setSelectedStatement(null)}
            />
          )}
        </div>
      )}

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
              accept=".xml,.camt,.csv,.mt940,.sta,.940,.txt"
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
                <p className="text-sm text-muted-foreground mt-1">Podprti formati: CAMT.053 XML, CSV (NLB, SKB, Addiko) in MT940/STA</p>
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
            {configLoaded && !invalidAccountsCleared && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                Predizpolnjeno iz prejšnjega uvoza.
              </div>
            )}
            {invalidAccountsCleared && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <TriangleAlert className="h-3 w-3 shrink-0" />
                Nekateri shranjeni konti niso več aktivni in so bili počiščeni. Preverite nastavitve spodaj.
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
                <Label>Privzeti protikonto za prilive (neobvezno)</Label>
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
                <Label>Privzeti protikonto za odlive (neobvezno)</Label>
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

          {matching && matchingProgress && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-medium">Iščem ujemanja</span>
                <span className="tabular-nums text-muted-foreground">
                  {matchingProgress.current} od {matchingProgress.total}
                </span>
              </div>
              <Progress
                value={matchingProgress.total > 0
                  ? (matchingProgress.current / matchingProgress.total) * 100
                  : 0}
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleParse}
              disabled={!file || !periodId || !bankAccountId || parsing || matching}
            >
              {(parsing || matching) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {parsing
                ? "Razčlenjujem..."
                : matching && matchingProgress
                  ? `Iščem ujemanja ${matchingProgress.current}/${matchingProgress.total}`
                  : matching
                    ? "Iščem ujemanja..."
                    : "Nadaljuj"}
              {!parsing && !matching && <ChevronRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Review ──────────────────────────────────────────────────── */}
      {step === "review" && (
        <div className="space-y-4">
          {(restored || Object.keys(imported).length > 0) && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>{restored ? "Osnutek uvoza je obnovljen" : "Delni uvoz je shranjen"}</AlertTitle>
              <AlertDescription>
                Že ustvarjena plačila: {Object.keys(imported).length}. Te vrstice so izključene iz ponovnega potrjevanja.
                Knjiženje, ki ni potrjeno, preverite v seznamu plačil.
              </AlertDescription>
            </Alert>
          )}
          {confirmError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Preverite podatke transakcije</AlertTitle>
              <AlertDescription>{confirmError}</AlertDescription>
            </Alert>
          )}
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
              <Button variant="outline" size="sm" onClick={() => setStep("upload")} disabled={confirming || !!draftRef.current?.registered}>
                <ChevronLeft className="mr-1 h-3 w-3" /> Nazaj
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={matchedCount === 0 || confirming || hasMissingDimensions}>
                {confirming && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Potrdi {matchedCount} transakcij <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>

          {hasMissingDimensions && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Preverite dimenzije</AlertTitle>
              <AlertDescription>
                Pred potrditvijo preverite označene transakcije ter izberite partnerja,
                stroškovno mesto in projekt neposredno pri ustrezni knjižbeni vrstici.
              </AlertDescription>
            </Alert>
          )}

          {/* Transaction rows */}
          <div className="space-y-3">
            {suggestions.map(item => (
              <TransactionReviewRow
                key={item.transaction.id}
                item={item}
                decision={decisions.get(item.transaction.id) ?? { kind: "pending" }}
                imported={imported[item.transaction.id]}
                onDecision={d => setDecision(item.transaction.id, d)}
                counterparties={counterparties}
                existingPayments={reconcilablePayments}
                duplicateOf={item.duplicateOf}
                accounts={accounts}
                defaultAccountId={item.transaction.amount > 0 ? arAccountId : apAccountId}
                invoiceAccountId={decisions.get(item.transaction.id)?.kind === "matched"
                  ? invoices.find(invoice => invoice.id === (decisions.get(item.transaction.id) as Extract<MatchDecision, { kind: "matched" }>).invoiceId)?.arApAccountId ?? ""
                  : ""}
                dimensionWarnings={dimensionWarnings.get(item.transaction.id)}
                bankAccountId={bankAccountId}
                costCenters={costCentersData?.costCenters ?? []}
                projects={projectsData?.projects ?? []}
              />
            ))}
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("upload")} disabled={confirming || !!draftRef.current?.registered}>
              <ChevronLeft className="mr-2 h-4 w-4" /> Nazaj na uvoz
            </Button>
            <Button onClick={handleConfirm} disabled={matchedCount === 0 || confirming || hasMissingDimensions}>
              {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Potrdi {matchedCount} transakcij
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
      {step === "confirm" && pendingConfirms.length > 0 && (
        <div className="space-y-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Potrebna potrditev ujemanja ({pendingConfirms.length})</h2>
          <p className="text-sm text-amber-900">Podatki obstoječega plačila se razlikujejo od bančne vrstice. Poveži samo, če so razlike pravilne; sicer povezavo zavrni.</p>
          {pendingConfirms.map(c => (
            <div key={c.lineId} className="rounded-md border bg-background p-3 space-y-2 text-sm">
              <div className="font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground">Bančna vrstica: {formatDatum(c.txDate)}{c.txReference ? ` · sklic ${c.txReference}` : ""}</div>
              <ul className="list-disc pl-5 text-amber-800">{c.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              {c.error && <p className="text-destructive">{c.error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => confirmReconcile(c)} disabled={retryBusy === c.lineId}>
                  {retryBusy === c.lineId && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Potrdi razliko in poveži
                </Button>
                <Button size="sm" variant="outline" onClick={() => rejectReconcile(c)} disabled={retryBusy === c.lineId}>Ne poveži</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {step === "confirm" && confirmResult && (
        <div className="max-w-lg mx-auto text-center space-y-6 py-8">
          <div className={`h-20 w-20 rounded-full flex items-center justify-center mx-auto ${confirmResult.postErrors.length > 0 ? "bg-amber-100" : "bg-green-100"}`}>
            {confirmResult.postErrors.length > 0
              ? <AlertCircle className="h-10 w-10 text-amber-600" />
              : <CheckCircle2 className="h-10 w-10 text-green-600" />
            }
          </div>
          <div>
            <h2 className="text-2xl font-bold">
              {confirmError || confirmResult.postErrors.length > 0 ? "Uvoz je delno zaključen"
                : pendingConfirms.length > 0 ? "Uvoz čaka na potrditev" : "Uvoz zaključen"}
            </h2>
            <div className="text-muted-foreground mt-2 space-y-1">
              <p>Skupaj že ustvarjenih ali povezanih plačil v tem uvozu: {Object.keys(imported).length}.</p>
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
          {confirmError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{confirmError}</AlertDescription>
            </Alert>
          )}
          {Object.values(imported).some(payment => payment.posting === "pending" || payment.posting === "failed") && (
            <p className="text-sm text-amber-700">
              Pri nekaterih že ustvarjenih plačilih knjiženje ni potrjeno. Preverite jih v seznamu plačil;
              ponovna potrditev uvoza teh plačil ne bo niti ustvarila niti knjižila znova.
            </p>
          )}
          <div className="flex justify-center gap-3">
            {(matchedCount > 0 || confirmError) && (
              <Button variant="outline" onClick={() => setStep("review")}>Nazaj na pregled</Button>
            )}
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

export function TransactionReviewRow({
  item,
  decision,
  onDecision,
  counterparties,
  existingPayments,
  duplicateOf,
  accounts,
  defaultAccountId,
  invoiceAccountId,
  dimensionWarnings = [],
  imported,
  bankAccountId = "",
  costCenters = [],
  projects = [],
}: {
  item: TransactionWithSuggestions;
  decision: MatchDecision;
  onDecision: (d: MatchDecision) => void;
  counterparties: any[];
  existingPayments: any[];
  duplicateOf?: DuplicateInfo;
  accounts: Array<{ id: string; code: string; name: string }>;
  defaultAccountId: string;
  invoiceAccountId: string;
  dimensionWarnings?: string[];
  imported?: ImportedBankPayment;
  bankAccountId?: string;
  costCenters?: Array<{ id: string; code: string; name: string; isActive?: boolean }>;
  projects?: Array<{ id: string; code: string; name: string; isActive?: boolean }>;
}) {
  const tx = item.transaction;
  const isInbound = tx.amount > 0;
  const existing = decision.kind === "reconcile" ? existingPayments.find(p => p.id === decision.paymentId) : undefined;
  const dimensions = { ...paymentDimensions(existing ?? {}), ...paymentDimensions(decision) };
  const lineAccounts = [
    { label: "Bančna vrstica", accountId: existing?.bankAccountId ?? bankAccountId, costKey: "bankCostCenterId", projectKey: "bankProjectId" },
    { label: "Protikontna vrstica", accountId: existing?.arApAccountId ?? (decision.kind === "standalone" ? decision.arApAccountId : invoiceAccountId), costKey: "counterCostCenterId", projectKey: "counterProjectId" },
  ] as const;
  const [showManual, setShowManual] = useState(false);
  const [manualInvoiceId, setManualInvoiceId] = useState("");
  const [manualAmount, setManualAmount] = useState(Math.abs(tx.amount).toFixed(2));

  if (imported) {
    return (
      <div className="border-2 border-green-500 rounded-lg p-4 space-y-2">
        <Badge>Že ustvarjeno plačilo</Badge>
        <p>{formatDatum(tx.date)} · {tx.reference ?? tx.counterpartyName} · {tx.amount.toFixed(2)} {tx.currency}</p>
        <p className="text-sm">Ta vrstica ne bo ponovno poslana.</p>
        <p className="text-sm">
          {imported.posting === "posted" ? "Knjiženje potrjeno."
            : imported.posting === "draft" ? "Plačilo je shranjeno kot osnutek."
            : "Knjiženje ni potrjeno. Preverite stanje plačila v seznamu plačil."}
          {imported.error && ` ${imported.error}`}
        </p>
      </div>
    );
  }

  // Duplicate transactions get amber border even when skipped, to stay visually distinct
  const statusColor =
    dimensionWarnings.length > 0 ? "border-destructive bg-destructive/5"
    : (decision.kind === "matched" || decision.kind === "reconcile" || decision.kind === "standalone") ? "border-green-500 bg-green-50"
    : decision.kind === "skip" && duplicateOf ? "border-amber-400 bg-amber-50/40"
    : decision.kind === "skip" ? "border-muted bg-muted/20"
    : "border-amber-400 bg-amber-50";

  return (
    <div className={`border-2 rounded-lg p-4 transition-colors ${statusColor}`}>
      {(decision.kind === "matched" || decision.kind === "standalone" || (decision.kind === "reconcile" && existing?.status === "draft")) && (
        <div className="grid gap-3 mb-3 md:grid-cols-2">
          {lineAccounts.map(line => (
            <fieldset key={line.label} className="border rounded p-3 space-y-2">
              <legend className="text-sm font-medium">{line.label} · {accounts.find(a => a.id === line.accountId)?.code ?? "izberite konto"}</legend>
              {([
                { key: line.costKey, label: "Stroškovno mesto", options: costCenters },
                { key: line.projectKey, label: "Projekt", options: projects },
              ] as const).map(field => (
                <label key={field.key} className="block text-sm">
                  {field.label}
                  <Select value={dimensions[field.key] ?? "__none__"} onValueChange={value => onDecision({
                    ...decision, ...dimensions, [field.key]: value === "__none__" ? null : value,
                  })}>
                    <SelectTrigger aria-label={`${line.label} – ${field.label}`}><SelectValue placeholder="Ni izbrano" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Ni izbrano</SelectItem>
                      {field.options.filter(option => option.isActive !== false).map(option => (
                        <SelectItem key={option.id} value={option.id}>{option.code} — {option.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      {dimensionWarnings.length > 0 && (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Preverite obvezne dimenzije</AlertTitle>
          <AlertDescription>
            <ul>{dimensionWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      {decision.kind === "matched" && (
        <p className="text-sm mb-3">
          Protikonto računa: {accounts.find(account => account.id === invoiceAccountId)
            ? `${accounts.find(account => account.id === invoiceAccountId)!.code} — ${accounts.find(account => account.id === invoiceAccountId)!.name}`
            : "Račun nima razpoložljivega knjižljivega konta"}
        </p>
      )}
      {decision.kind !== "reconcile" && (
        <div className="mb-3 space-y-2">
          {decision.kind !== "standalone" ? (
            <Button variant="outline" size="sm" onClick={() => onDecision({
              kind: "standalone", counterpartyId: "", arApAccountId: defaultAccountId,
            })}>Brez računa — izberi protikonto</Button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Protikonto transakcije</Label>
                <Select value={decision.arApAccountId} onValueChange={value => onDecision({ ...decision, arApAccountId: value })}>
                  <SelectTrigger><SelectValue placeholder="Izberite knjižljiv konto" /></SelectTrigger>
                  <SelectContent>{accounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>{account.code} — {account.name}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Partner / prejemnik oziroma plačnik</Label>
                <Select value={decision.counterpartyId} onValueChange={value => onDecision({ ...decision, counterpartyId: value })}>
                  <SelectTrigger><SelectValue placeholder="Izberite partnerja" /></SelectTrigger>
                  <SelectContent>{counterparties.map(partner => (
                    <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Samostojna transakcija brez računa. Knjiži celoten znesek na izbrani protikonto;
                ne ustvarja računa, DDV evidence ali samodejnega zapiranja drugih obveznosti.
              </p>
              <Button variant="ghost" size="sm" onClick={() => onDecision({ kind: "pending" })}>Prekliči izbiro</Button>
            </div>
          )}
        </div>
      )}
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
          ) : decision.kind === "reconcile" ? (
            <>
              <div className="text-xs text-green-700 font-medium">Obstoječe plačilo: {decision.label}</div>
              <Button variant="ghost" size="sm" className="text-muted-foreground h-7 px-2" onClick={() => onDecision({ kind: "pending" })}>
                <X className="h-3 w-3" />
              </Button>
            </>
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
            Plačilo z istim datumom ({formatDatum(duplicateOf.paymentDate)}), zneskom ({parseFloat(duplicateOf.amount).toFixed(2)})
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
      {decision.kind !== "matched" && decision.kind !== "skip" && decision.kind !== "reconcile" && (
        <div className="mt-3 space-y-2">
          {existingPayments.filter(p => p.direction === (isInbound ? "inbound" : "outbound")).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Poveži z obstoječim osnutkom ali knjiženim plačilom (brez podvojitve):</p>
              <Select value="" onValueChange={id => {
                const p = existingPayments.find(x => x.id === id);
                if (p) onDecision({ kind: "reconcile", paymentId: p.id, label: `${p.counterpartyName} ${parseFloat(p.amount).toFixed(2)} (${p.status === "draft" ? "osnutek" : "knjiženo"})` });
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Izberite obstoječe plačilo" /></SelectTrigger>
                <SelectContent>
                  {existingPayments.filter(p => p.direction === (isInbound ? "inbound" : "outbound")).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {formatDatum(p.paymentDate)} - {p.counterpartyName} - {parseFloat(p.amount).toFixed(2)} - {p.status === "draft" ? "osnutek" : "knjiženo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                        <span className="text-muted-foreground">{formatDatum(s.invoiceDate)}</span>
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
