import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  FileText, Loader2, FileSearch, CheckCircle2, XCircle, AlertCircle, 
  Building2, AlertTriangle, FileUp, UserPlus, ChevronDown, ChevronUp,
  Eye, EyeOff, ZoomIn, ZoomOut, ExternalLink, Maximize2, X, Bookmark
} from "lucide-react";
import { Link } from "wouter";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListDocuments,
  useGetDocument,
  useGetDocumentExchangeRate,
  useConfirmDocument,
  useRejectDocument,
  useListCounterparties,
  useCreateCounterparty,
  useListAccounts,
  useListPeriods,
  useGetCounterpartyAccountTemplates,
  useListVatCodes,
  useListCompanyFursVatCodes,
  getListDocumentsQueryKey,
  getGetDocumentQueryKey,
  getGetDocumentExchangeRateQueryKey,
  getListCounterpartiesQueryKey,
  getListVatCodesQueryKey,
  getListCompanyFursVatCodesQueryKey,
  type DocumentRecord,
  type DocumentExchangeRateQuote,
  type DocumentExchangeRateSnapshot,
  type ProposedLine,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentUpload } from "@/components/documents/document-upload";

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHr / 24);

  if (diffSec < 60) return "pravkar";
  if (diffMin < 60) return `pred ${diffMin} min`;
  if (diffHr < 24) return `pred ${diffHr} h`;
  if (diffDays === 1) return "včeraj";
  return `pred ${diffDays} dnevi`;
}

function formatApprovalAudit(actor: string | null | undefined, dateString: string | null | undefined, action: "confirmed" | "rejected") {
  if (!dateString) return null;
  const label = action === "confirmed" ? "Potrdil" : "Zavrnil";
  const actorLabel = actor || "neznan uporabnik";
  const date = new Date(dateString);
  const dateLabel = date.toLocaleDateString("sl-SI", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString("sl-SI", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${label}: ${actorLabel} · ${dateLabel} ob ${timeLabel}`;
}

const formatEur = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(n);
};

const formatCurrencyAmount = (n: number | null | undefined, currency: string) => {
  if (n === null || n === undefined) return "-";
  try {
    return new Intl.NumberFormat("sl-SI", { style: "currency", currency }).format(n);
  } catch {
    const amount = new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    return `${amount} ${currency}`;
  }
};

type ReviewDocumentType = "invoice_received" | "invoice_issued" | "other";

function isReviewDocumentType(value: string | null | undefined): value is ReviewDocumentType {
  return value === "invoice_received" || value === "invoice_issued" || value === "other";
}

function getPartnerTypeForDocument(documentType: string): "customer" | "supplier" {
  return documentType === "invoice_issued" ? "customer" : "supplier";
}

function normalizeTaxId(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^SI\s*/i, "").replace(/[\s.-]/g, "");
  return normalized && /^\d{8}$/.test(normalized) ? normalized : null;
}

function normalizeCompanyName(value: string | null | undefined) {
  return value?.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "") ?? "";
}

function getSafeDocumentConfirmErrorMessage(error: unknown) {
  const errorRecord = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const response = errorRecord.response && typeof errorRecord.response === "object"
    ? errorRecord.response as Record<string, unknown>
    : {};
  const statusValue = errorRecord.status ?? response.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const data = errorRecord.data;
  const dataRecord = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const structuredMessage = [dataRecord.error, dataRecord.message, dataRecord.detail]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const isSafeMessage = (message: string) =>
    message.length <= 800
    && !/<\/?[a-z!][^>]*>/i.test(message)
    && !/<!doctype|(?:\n|\r)\s*at\s+[\w.$]+\s*\(|\bSQLSTATE\b|\b(?:SELECT|INSERT|UPDATE|DELETE)\b.{0,60}\b(?:FROM|INTO|SET)\b|\b(?:syntax error at or near|relation .* does not exist|duplicate key value)\b/i.test(message);

  if (structuredMessage && isSafeMessage(structuredMessage)) return structuredMessage.trim();

  const message = errorRecord.message;
  if (
    typeof message === "string"
    && message.trim()
    && !/^\s*HTTP\s+\d{3}\b/i.test(message)
    && !/^Failed to parse response\b/i.test(message)
    && isSafeMessage(message)
  ) {
    return message.trim();
  }

  if (status === 400) {
    return "Strežnik je zavrnil podatke. Preverite zahtevane podatke in povezave DDV-kod v DDV šifrantu.";
  }
  if (status === 401 || status === 403) {
    return "Za potrditev dokumenta nimate ustreznih pravic. Preverite dostop ali se obrnite na skrbnika.";
  }
  if (status === 404) {
    return "Dokumenta ni več mogoče najti. Osvežite seznam in poskusite znova.";
  }
  if (status === 409) {
    return "Dokument se je med potrjevanjem spremenil. Osvežite podatke in poskusite znova.";
  }
  if (status && status >= 500) {
    return `Strežnik trenutno ne more potrditi dokumenta (HTTP ${status}). Poskusite znova pozneje; če se težava ponovi, se obrnite na skrbnika.`;
  }
  return "Dokumenta ni bilo mogoče potrditi. Preverite podatke in poskusite znova.";
}

function matchesCompanyIdentity(
  companyTaxId: string | null | undefined,
  companyNames: Array<string | null | undefined>,
  otherTaxId: string | null | undefined,
  otherNames: Array<string | null | undefined>,
) {
  const normalizedCompanyTaxId = normalizeTaxId(companyTaxId);
  const normalizedOtherTaxId = normalizeTaxId(otherTaxId);
  if (normalizedCompanyTaxId && normalizedOtherTaxId) {
    return normalizedCompanyTaxId === normalizedOtherTaxId;
  }
  if (companyTaxId?.trim() && otherTaxId?.trim()) return false;

  const normalizedOtherNames = new Set(otherNames.map(normalizeCompanyName).filter(Boolean));
  return companyNames
    .map(normalizeCompanyName)
    .some(name => name !== "" && normalizedOtherNames.has(name));
}

const STATUS_CONFIG: Record<string, { label: string, variant: "default" | "secondary" | "destructive" | "outline", colorClass?: string }> = {
  pending: { label: "V čakalni vrsti", variant: "secondary" },
  processing: { label: "Obdelujem...", variant: "outline", colorClass: "text-blue-600 border-blue-200 bg-blue-50" },
  done: { label: "Pripravljen", variant: "outline", colorClass: "text-green-600 border-green-200 bg-green-50" },
  confirmed: { label: "Potrjen", variant: "default", colorClass: "bg-emerald-700 hover:bg-emerald-800 text-white" },
  rejected: { label: "Zavrnjen", variant: "destructive" },
  error: { label: "Napaka", variant: "destructive" }
};

export default function Dokumenti() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const { data: listData, isLoading: isLoadingList, error: listError } = useListDocuments(
    activeCompany?.id ?? "",
    {},
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const documents = listData?.documents ?? [];

  // Polling for pending/processing documents
  useEffect(() => {
    if (!activeCompany?.id) return;
    const hasActive = documents.some(d => d.status === "pending" || d.status === "processing");
    if (hasActive) {
      // Query structural sharing keeps `documents` unchanged while OCR is
      // still running. A one-shot timeout would never re-arm in that case.
      const timer = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(activeCompany.id) });
        const selectedDoc = documents.find(d => d.id === selectedDocId);
        const selectedDocIsActive = selectedDoc?.status === "pending" || selectedDoc?.status === "processing";
        if (selectedDocId && selectedDocIsActive) {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(activeCompany.id, selectedDocId) });
        }
      }, 3000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [documents, activeCompany?.id, queryClient, selectedDocId]);

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] gap-4">
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dokumenti v obdelavi</h1>
          <p className="text-muted-foreground mt-1">Naložite dokumente za AI-prepoznavo in predlog; računovodja pregleda podatke pred ustvarjanjem osnutka.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* Left Column: List */}
        <div className="w-[380px] flex flex-col border rounded-xl bg-card shadow-sm overflow-hidden shrink-0">
          <div className="p-4 border-b bg-muted/20 shrink-0">
            <DocumentUpload company={activeCompany} />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {listError ? (
              <div className="p-4 text-sm text-red-600 text-center">Napaka pri nalaganju seznama.</div>
            ) : isLoadingList ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-3 border rounded-lg mb-2"><Skeleton className="h-10 w-full" /></div>
              ))
            ) : documents.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-center text-muted-foreground px-4">
                <FileUp className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm">Ni naloženih dokumentov.</p>
              </div>
            ) : (
              documents.map(doc => {
                const isSelected = doc.id === selectedDocId;
                const statusInfo = STATUS_CONFIG[doc.status] || { label: doc.status, variant: "outline" };
                
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isSelected 
                        ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20" 
                        : "border-transparent hover:bg-muted/50 hover:border-border"
                    }`}
                  >
                    <div className={`mt-0.5 p-2 rounded-md ${isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <FileText className="h-4 w-4 shrink-0" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate text-foreground leading-tight">{doc.fileName}</span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(doc.createdAt)}</span>
                      </div>
                      <div className="flex items-center mt-1">
                        <Badge variant={statusInfo.variant} className={`text-[10px] px-1.5 py-0 font-medium ${statusInfo.colorClass || ""}`}>
                          {doc.status === "processing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {statusInfo.label}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Detail Panel */}
        <div className="flex-1 flex flex-col border rounded-xl bg-card shadow-sm overflow-hidden min-w-0">
          {!selectedDocId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <div className="h-16 w-16 bg-muted/50 rounded-full flex items-center justify-center mb-4">
                <FileSearch className="h-8 w-8 opacity-50" />
              </div>
              <h2 className="text-lg font-medium text-foreground mb-1">Izberite dokument</h2>
              <p className="text-sm max-w-sm text-center">
                Kliknite na dokument v seznamu levo za predogled, obdelavo in potrditev kontiranja.
              </p>
            </div>
          ) : (
            <DocumentDetailPanel key={`${activeCompany?.id ?? ""}:${selectedDocId}`} docId={selectedDocId} onDeselect={() => setSelectedDocId(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentDetailPanel({ docId, onDeselect }: { docId: string, onDeselect: () => void }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const { data: doc, isLoading, error } = useGetDocument(
    activeCompany?.id ?? "",
    docId,
    { query: { enabled: !!(activeCompany?.id && docId), queryKey: getGetDocumentQueryKey(activeCompany?.id ?? "", docId) } as any }
  );

  const confirmMut = useConfirmDocument();
  const rejectMut = useRejectDocument();

  const handleReject = () => {
    if (!activeCompany || !docId) return;
    if (confirm("Ali res želite zavrniti ta dokument?")) {
      rejectMut.mutate(
        { companyId: activeCompany.id, id: docId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(activeCompany.id) });
            queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(activeCompany.id, docId) });
          }
        }
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-8 flex flex-col space-y-6">
        <Skeleton className="h-12 w-2/3" />
        <div className="flex gap-6">
          <Skeleton className="h-[400px] w-1/2" />
          <Skeleton className="h-[400px] w-1/2" />
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Dokumenta ni bilo mogoče naložiti.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const statusInfo = STATUS_CONFIG[doc.status] || { label: doc.status, variant: "outline" };
  const isViewer = activeCompany?.role === "viewer";
  const confirmedExchangeRate = doc.confirmedData?.exchangeRate;

  return (
    <div className="flex flex-col h-full">
      {/* Detail Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between shrink-0 bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/50">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-2.5 bg-primary/10 text-primary rounded-lg shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate leading-tight">{doc.fileName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={statusInfo.variant} className={statusInfo.colorClass}>
                {doc.status === "processing" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {statusInfo.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {(doc.fileSizeBytes ? (doc.fileSizeBytes / 1024 / 1024).toFixed(2) : "0")} MB
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {doc.status === "done" && !isViewer && (
            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={handleReject} disabled={rejectMut.isPending}>
              <XCircle className="mr-1.5 h-4 w-4" />
              Zavrni
            </Button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-muted/10">
        {doc.status === "pending" || doc.status === "processing" ? (
          <div className="flex flex-col items-center justify-center h-full p-8 max-w-md mx-auto text-center space-y-6">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
              <div className="relative bg-background border p-4 rounded-2xl shadow-sm">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
              </div>
            </div>
            <div className="space-y-2 w-full">
              <h3 className="text-lg font-medium">AI analizira dokument...</h3>
              <p className="text-sm text-muted-foreground">
                Sistem bere vsebino računa in pripravlja predlog kontiranja. To običajno traja nekaj sekund.
              </p>
              <Progress value={undefined} className="h-1.5 mt-4 w-full" />
            </div>
          </div>
        ) : doc.status === "error" ? (
          <div className="p-8">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Napaka pri obdelavi</AlertTitle>
              <AlertDescription>{doc.errorMessage || "Neznana napaka pri komunikaciji z AI storitvijo."}</AlertDescription>
            </Alert>
          </div>
        ) : doc.status === "done" || doc.status === "confirmed" || doc.status === "rejected" ? (
          <div className="p-6 space-y-6">
            {/* Stalne reže preprečijo, da bi osvežitev statusa ponovno namestila PDF iframe. */}
            <div className={doc.status === "done" ? "hidden" : undefined}>
              {doc.status === "confirmed" ? (
                <div className="flex items-center gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
                  <div className="h-12 w-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-emerald-800">Dokument potrjen</h3>
                    <p className="text-sm text-emerald-700 mt-0.5">
                      Podatki so bili uspešno shranjeni.
                      {formatApprovalAudit(doc.confirmedBy, doc.updatedAt, "confirmed") && (
                        <span className="ml-1 text-emerald-600">
                          · {formatApprovalAudit(doc.confirmedBy, doc.updatedAt, "confirmed")}
                        </span>
                      )}
                    </p>
                  </div>
                  {doc.linkedInvoiceId && (
                    <Button asChild variant="outline" size="sm" className="shrink-0 border-emerald-300 text-emerald-800 hover:bg-emerald-100">
                      <Link href="/racuni">Odpri račun</Link>
                    </Button>
                  )}
                </div>
              ) : doc.status === "rejected" ? (
                <div className="flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
                  <div className="h-12 w-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                    <XCircle className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-red-800">Dokument zavrnjen</h3>
                    <p className="text-sm text-red-700 mt-0.5">
                      Ta dokument je bil zavrnjen in ne bo obdelan.
                      {formatApprovalAudit(doc.rejectedBy, doc.updatedAt, "rejected") && (
                        <span className="ml-1 text-red-600">
                          · {formatApprovalAudit(doc.rejectedBy, doc.updatedAt, "rejected")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
            <DocumentPreview objectPath={doc.objectPath} mimeType={doc.mimeType} />
            {doc.status === "confirmed" && (
              <>
                {confirmedExchangeRate && <ConfirmedExchangeRateSummary exchangeRate={confirmedExchangeRate} />}
                <ConfirmedDocumentLines
                  lines={getConfirmedDocumentLines(doc)}
                  currency={doc.confirmedData?.currency?.trim().toUpperCase() || "EUR"}
                />
              </>
            )}
            <div className={doc.status === "done" ? undefined : "hidden"}>
              {doc.status === "done" ? <DocumentReviewForm doc={doc} /> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// DOCUMENT PREVIEW COMPONENT
// ----------------------------------------------------------------------

const DocumentPreview = React.memo(function DocumentPreview({ objectPath, mimeType }: { objectPath: string; mimeType: string }) {
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const normalizedPath = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath;
  const apiUrl = `${BASE}/api/storage/objects/${normalizedPath}`;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(apiUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) { if (!cancelled) setLoadError(true); return; }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

  const isPdf = mimeType === "application/pdf";

  return (
    <>
      <Card className="shadow-none border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground">
            <Eye className="h-4 w-4 text-muted-foreground" />
            Predogled dokumenta
          </h3>
          <div className="flex items-center gap-2">
            {blobUrl && (
              <>
                <button
                  onClick={() => setFullscreen(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Celozaslonski predogled"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Razširi</span>
                </button>
                <a
                  href={blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Odpri v novem zavihku"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </>
            )}
            <button
              onClick={() => setCollapsed(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={collapsed ? "Prikaži predogled" : "Skrij predogled"}
            >
              {collapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>{collapsed ? "Prikaži" : "Skrij"}</span>
            </button>
          </div>
        </div>

        {!collapsed && (
          <CardContent className="p-0">
            {loadError ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Predogleda ni bilo mogoče naložiti.
              </div>
            ) : !blobUrl ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isPdf ? (
              <iframe
                src={blobUrl}
                title="Predogled PDF dokumenta"
                className="w-full border-0"
                style={{ height: "520px" }}
              />
            ) : (
              <div className="flex items-center justify-center bg-muted/10 p-4" style={{ minHeight: "300px", maxHeight: "520px" }}>
                <img
                  src={blobUrl}
                  alt="Predogled dokumenta"
                  className="max-w-full object-contain rounded"
                  style={{ maxHeight: "488px" }}
                />
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Fullscreen modal */}
      {fullscreen && blobUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          aria-label="Celozaslonski predogled dokumenta"
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-3 bg-black/60 border-b border-white/10 shrink-0">
            <span className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Eye className="h-4 w-4 text-white/50" />
              Celozaslonski predogled
            </span>
            <div className="flex items-center gap-3">
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
                title="Odpri v novem zavihku"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Nov zavihek</span>
              </a>
              <button
                onClick={() => setFullscreen(false)}
                className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md"
                title="Zapri (Escape)"
              >
                <X className="h-3.5 w-3.5" />
                <span>Zapri</span>
              </button>
            </div>
          </div>

          {/* Modal content */}
          <div className="flex-1 min-h-0 overflow-auto">
            {isPdf ? (
              <iframe
                src={blobUrl}
                title="Celozaslonski predogled PDF dokumenta"
                className="w-full h-full border-0"
                style={{ minHeight: "100%" }}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full p-6">
                <img
                  src={blobUrl}
                  alt="Celozaslonski predogled dokumenta"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});

// ----------------------------------------------------------------------
// FORM & REVIEW SECTION
// ----------------------------------------------------------------------

export function SuggestionSourceIndicator({
  source,
  count,
}: {
  source?: ProposedLine["suggestionSource"];
  count?: number;
}) {
  if (source === "history") {
    return (
      <p className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1">
        <span>✓</span>
        {count != null && count > 0
          ? count === 1
            ? "Na podlagi 1 potrjenega kontiranja tega partnerja"
            : `Na podlagi ${count} potrjenih kontiranj tega partnerja`
          : "Na podlagi potrjenih kontiranj tega partnerja"}
      </p>
    );
  }

  if (source === "pattern") {
    return <p className="text-[10px] text-muted-foreground mt-0.5">Tipičen vzorec kontiranja</p>;
  }

  if (source === "manual") {
    return <p className="text-[10px] text-muted-foreground mt-0.5">Ročna izbira</p>;
  }

  return null;
}

export function getConfirmedDocumentLines(
  doc: Pick<DocumentRecord, "confirmedData" | "ocrResult">,
): ProposedLine[] {
  return doc.confirmedData?.lines ?? doc.ocrResult?.lines ?? [];
}

export function ConfirmedDocumentLines({ lines, currency = "EUR" }: { lines: ProposedLine[]; currency?: string }) {
  if (lines.length === 0) return null;

  return (
    <Card className="shadow-none border-border">
      <CardContent className="p-0">
        <div className="p-5 pb-4 border-b">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Potrjeno kontiranje
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 uppercase border-b">
              <tr>
                <th className="px-4 py-3 font-medium">Opis</th>
                <th className="px-4 py-3 font-medium text-right">Znesek ({currency})</th>
                <th className="px-4 py-3 font-medium text-right">DDV %</th>
                <th className="px-4 py-3 font-medium min-w-[180px]">Konto</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-3 font-medium">{line.description}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyAmount(line.vatBase, currency)}</td>
                  <td className="px-4 py-3 text-right">{line.vatRate}%</td>
                  <td className="px-4 py-3">
                    <span className="font-mono">{line.accountCode || "–"}</span>
                    <SuggestionSourceIndicator
                      source={line.suggestionSource}
                      count={line.suggestionCount}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function ConfirmedExchangeRateSummary({ exchangeRate }: { exchangeRate: DocumentExchangeRateSnapshot }) {
  return (
    <Card className="shadow-none border-border">
      <CardContent className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold text-base">Potrjena pretvorba valute</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {exchangeRate.sourceCurrency} → EUR · 1 EUR = {exchangeRate.unitsPerEur.toLocaleString("sl-SI")} {exchangeRate.sourceCurrency}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Tečaj {exchangeRate.source === "ECB" ? "ECB" : "ročni"} z dne {exchangeRate.rateDate}
          {" "}· zahtevani datum {exchangeRate.requestedDate}
          {exchangeRate.sourceUrl && (
            <> · <a href={exchangeRate.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">vir tečaja</a></>
          )}
        </p>
        {exchangeRate.source === "ECB" && exchangeRate.rateDate < exchangeRate.requestedDate && (
          <p className="text-xs text-muted-foreground">
            Za zahtevani datum ECB tečaja ni objavila; uporabljen je zadnji razpoložljivi predhodni tečaj.
          </p>
        )}
        {exchangeRate.manualReason && (
          <p className="text-sm break-words">Utemeljitev ročnega tečaja: {exchangeRate.manualReason}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground mb-1">Izvorni zneski ({exchangeRate.sourceCurrency})</p>
            <p>Neto {formatCurrencyAmount(exchangeRate.sourceTotals.net, exchangeRate.sourceCurrency)}</p>
            <p>DDV {formatCurrencyAmount(exchangeRate.sourceTotals.vat, exchangeRate.sourceCurrency)}</p>
            <p className="font-medium">Bruto {formatCurrencyAmount(exchangeRate.sourceTotals.gross, exchangeRate.sourceCurrency)}</p>
          </div>
          <div className="rounded-md bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground mb-1">Osnutek EUR</p>
            <p>Neto {formatEur(exchangeRate.eurTotals.net)}</p>
            <p>DDV {formatEur(exchangeRate.eurTotals.vat)}</p>
            <p className="font-medium">Bruto {formatEur(exchangeRate.eurTotals.gross)}</p>
          </div>
        </div>
        {exchangeRate.roundingDifference !== 0 && (
          <p className="text-xs text-muted-foreground">
            Razlika zaokroževanja: {formatEur(exchangeRate.roundingDifference)}. Preračun je zaokrožen po vrsticah, zato se vsota lahko razlikuje od preračuna skupnega zneska.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">Pretvorba je bila potrjena {new Date(exchangeRate.convertedAt).toLocaleString("sl-SI")}.</p>
      </CardContent>
    </Card>
  );
}

export function DocumentReviewForm({ doc }: { doc: DocumentRecord }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const ocr = doc.ocrResult;
  const sourceCurrency = ocr?.currency?.trim().toUpperCase() || "EUR";
  const isForeignCurrency = sourceCurrency !== "EUR";
  const isSupportedFxCurrency = sourceCurrency === "USD";
  const isViewer = activeCompany?.role === "viewer";

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id } as any });
  const allCounterparties = counterpartiesData?.counterparties ?? [];
  const isActiveCompanyIdentity = (taxId: string | null | undefined, name: string | null | undefined) =>
    !!activeCompany && matchesCompanyIdentity(
      activeCompany.podjetjeDavcna,
      [activeCompany.naziv, activeCompany.kratekNaziv],
      taxId,
      [name],
    );
  const counterparties = allCounterparties.filter(counterparty =>
    !isActiveCompanyIdentity(counterparty.taxId, counterparty.name),
  );
  const ocrCounterpartyIsOwnCompany = !!activeCompany && matchesCompanyIdentity(
    activeCompany.podjetjeDavcna,
    [activeCompany.naziv, activeCompany.kratekNaziv],
    ocr?.counterpartyTaxId,
    [ocr?.counterpartyName],
  );

  const { data: accountsData } = useListAccounts(
    activeCompany?.id ?? "",
    { includeInactive: true },
    { query: { enabled: !!activeCompany?.id } as any },
  );
  // V seznamu pokažemo tudi neaktivne/skupinske AI-predloge, da uporabnik vidi,
  // zakaj jih ni mogoče uporabiti. V izbiri so onemogočeni.
  const accounts = accountsData?.accounts ?? [];
  const postableAccounts = accounts.filter(a => a.isActive && a.allowsPosting !== false);

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const confirmMut = useConfirmDocument();
  const createCounterpartyMut = useCreateCounterparty();

  const initialDocumentType = isReviewDocumentType(ocr?.suggestedDocumentType)
    ? ocr.suggestedDocumentType
    : "";
  const [form, setForm] = useState({
    documentType: initialDocumentType,
    counterpartyId: ocr?.suggestedCounterpartyId || "",
    periodId: ocr?.suggestedPeriodId || (openPeriods.length > 0 ? openPeriods[openPeriods.length - 1].id : ""),
    invoiceNumber: ocr?.invoiceNumber || "",
    invoiceDate: ocr?.invoiceDate?.split("T")[0] || "",
    dueDate: ocr?.dueDate?.split("T")[0] || "",
    createInvoice: true
  });
  const [exchangeRateMode, setExchangeRateMode] = useState<"ecb" | "manual">("ecb");
  const [manualRateInput, setManualRateInput] = useState("");
  const [manualRateDate, setManualRateDate] = useState(form.invoiceDate);
  const [manualRateReason, setManualRateReason] = useState("");
  const [reviewedExchangeRateKey, setReviewedExchangeRateKey] = useState("");
  const [debouncedManualRate, setDebouncedManualRate] = useState<number | null>(null);
  const parsedManualRate = (() => {
    const normalized = manualRateInput.trim().replace(/\s/g, "").replace(",", ".");
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
    const rate = Number(normalized);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  })();
  const isIsoDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))
    && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
  const validInvoiceDate = isIsoDate(form.invoiceDate);
  const validManualRateDate = isIsoDate(manualRateDate)
    && !!form.invoiceDate
    && manualRateDate <= form.invoiceDate;
  const manualRateDebouncing = exchangeRateMode === "manual"
    && parsedManualRate !== null
    && parsedManualRate !== debouncedManualRate;
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedManualRate(parsedManualRate), 350);
    return () => window.clearTimeout(timeout);
  }, [parsedManualRate]);

  const exchangeRateParams = {
    date: form.invoiceDate,
    mode: exchangeRateMode,
    ...(exchangeRateMode === "manual" && parsedManualRate !== null
      ? { unitsPerEur: parsedManualRate, rateDate: manualRateDate }
      : {}),
  };
  const validManualReason = manualRateReason.trim().length >= 3;
  const exchangeRateQueryEnabled = !!activeCompany?.id
    && isSupportedFxCurrency
    && validInvoiceDate
    && (exchangeRateMode === "ecb"
      || (parsedManualRate !== null && !manualRateDebouncing && validManualRateDate));
  const exchangeRateQuery = useGetDocumentExchangeRate(
    activeCompany?.id ?? "",
    doc.id,
    exchangeRateParams,
    {
      query: {
        enabled: exchangeRateQueryEnabled,
        queryKey: getGetDocumentExchangeRateQueryKey(
          activeCompany?.id ?? "",
          doc.id,
          exchangeRateParams,
        ),
        placeholderData: undefined,
        retry: false,
        staleTime: 5 * 60 * 1000,
      },
    },
  );
  const fetchedExchangeRate = exchangeRateQuery.data as DocumentExchangeRateQuote | undefined;
  const exchangeRateMatchesRequest = !!fetchedExchangeRate
    && !exchangeRateQuery.isFetching
    && !exchangeRateQuery.isError
    && !exchangeRateQuery.isPlaceholderData
    && fetchedExchangeRate.currency === "USD"
    && fetchedExchangeRate.targetCurrency === "EUR"
    && fetchedExchangeRate.mode === exchangeRateMode
    && fetchedExchangeRate.requestedDate === form.invoiceDate
    && fetchedExchangeRate.convertedLines.length === (ocr?.lines?.length ?? 0)
    && (exchangeRateMode === "ecb"
      ? fetchedExchangeRate.source === "ECB"
      : fetchedExchangeRate.source === "manual"
        && parsedManualRate !== null
        && fetchedExchangeRate.unitsPerEur === parsedManualRate
        && fetchedExchangeRate.rateDate === manualRateDate);
  const exchangeRatePreview = exchangeRateMatchesRequest ? fetchedExchangeRate : undefined;
  const exchangeRateReviewBasis = JSON.stringify({
    companyId: activeCompany?.id ?? "",
    docId: doc.id,
    requestedDate: form.invoiceDate,
    mode: exchangeRateMode,
    manualRateInput,
    manualRateDate,
    manualRateReason,
    preview: exchangeRatePreview ?? null,
  });
  const hasReviewedExchangeRate = !!exchangeRatePreview
    && (exchangeRateMode === "ecb" || validManualReason)
    && reviewedExchangeRateKey === exchangeRateReviewBasis;
  const needsFxReview = isForeignCurrency && isSupportedFxCurrency && form.createInvoice;
  const fxReviewReady = !needsFxReview || (!!exchangeRatePreview
    && (exchangeRateMode === "ecb" || (validManualRateDate && validManualReason))
    && hasReviewedExchangeRate);
  const fursVatDirection: "IN" | "OUT" | undefined = form.documentType === "invoice_issued"
    ? "OUT"
    : form.documentType === "invoice_received"
      ? "IN"
      : undefined;
  const fursVatCodeParams = fursVatDirection ? { direction: fursVatDirection } : undefined;
  const { data: fursVatCodesData } = useListCompanyFursVatCodes(
    activeCompany?.id ?? "",
    fursVatCodeParams,
    {
      query: {
        enabled: !!activeCompany?.id && !!fursVatDirection,
        queryKey: getListCompanyFursVatCodesQueryKey(activeCompany?.id ?? "", fursVatCodeParams),
      },
    },
  );
  const {
    data: companyVatCodesData,
    isLoading: companyVatCodesLoading,
    isError: companyVatCodesError,
  } = useListVatCodes(
    activeCompany?.id ?? "",
    { includeInactive: true },
    {
      query: {
        enabled: !!activeCompany?.id,
        queryKey: getListVatCodesQueryKey(activeCompany?.id ?? "", { includeInactive: true }),
      },
    },
  );
  const globalFursVatCodes = fursVatCodesData?.codes ?? [];
  const allEubVatCodes = globalFursVatCodes.filter(code => code.code.startsWith("EUB"));
  const companyVatCodes = companyVatCodesData?.vatCodes ?? [];
  const selectedCounterpartyId = counterparties.some(counterparty => counterparty.id === form.counterpartyId)
    ? form.counterpartyId
    : "";

  // Mini-form for quick partner creation
  const [showCreatePartner, setShowCreatePartner] = useState(false);
  const [newPartner, setNewPartner] = useState({
    name: ocr?.counterpartyName || "",
    taxId: ocr?.counterpartyTaxId?.replace(/^SI/, "") || "",
    type: getPartnerTypeForDocument(initialDocumentType) as "customer" | "supplier" | "both",
  });

  const handleCreatePartner = () => {
    if (!activeCompany || !isReviewDocumentType(form.documentType) || !newPartner.name.trim()) return;
    createCounterpartyMut.mutate(
      {
        companyId: activeCompany.id,
        data: {
          name: newPartner.name.trim(),
          taxId: newPartner.taxId.trim() || null,
          type: newPartner.type,
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListCounterpartiesQueryKey(activeCompany.id) });
          setForm(p => ({ ...p, counterpartyId: created.id }));
          setShowCreatePartner(false);
        },
      }
    );
  };
  const invoiceVatDate = form.invoiceDate || ocr?.invoiceDate?.slice(0, 10) || "";
  const eubVatCodes = allEubVatCodes.filter(code =>
    !!code.validFrom
    && (!invoiceVatDate || code.validFrom <= invoiceVatDate)
    && (!invoiceVatDate || !code.validTo || code.validTo >= invoiceVatDate),
  );
  const isFursCodeValidForInvoiceDate = (code: { validFrom?: string | null; validTo?: string | null }) =>
    (!code.validFrom || !invoiceVatDate || code.validFrom.slice(0, 10) <= invoiceVatDate)
    && (!code.validTo || !invoiceVatDate || code.validTo.slice(0, 10) >= invoiceVatDate);

  const {
    data: accountTemplatesData,
    isLoading: accountTemplatesLoading,
    isError: accountTemplatesError,
  } = useGetCounterpartyAccountTemplates(
    activeCompany?.id ?? "",
    selectedCounterpartyId,
    {
      query: {
        enabled: !!(activeCompany?.id && selectedCounterpartyId),
      } as any,
    },
  );
  const accountTemplates = accountTemplatesData?.templates ?? [];

  // Fuzzy match account code to loaded accounts list
  const fuzzyMatchAccount = (code: string | null | undefined) => {
    if (!code || postableAccounts.length === 0) return null;
    const exact = postableAccounts.find(a => a.code === code);
    if (exact) return exact;
    // Prefix match: "400" → "4000", or "4200" → "420"
    const prefix = postableAccounts.find(a => a.code.startsWith(code) || code.startsWith(a.code));
    return prefix ?? null;
  };

  // Editable lines state — initialized with OCR lines, fuzzy-resolved account applied
  // We delay init until accounts are loaded; useEffect updates when accounts arrive
  type ReviewLine = ProposedLine & {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatBase: number;
    vatAmount: number;
    accountCode: string | null;
    accountId: string | null;
    confidence: number;
    suggestionSource?: "history" | "pattern" | "manual";
    suggestionCount?: number;
    assetType?: "NONE" | "OTHER_FA" | "REALESTATE";
    assetTypeCandidate?: "OTHER_FA" | "REALESTATE";
    assetTypeReason?: string;
    assetTypeOriginalAccountCode?: string | null;
    assetTypeOriginalAccountId?: string | null;
    vatCodeId?: string;
    vatCodeReason?: string;
    vatCodeReviewRequired?: boolean;
    vatCodeReviewReason?: string;
  };
  const [editableLines, setEditableLines] = useState<ReviewLine[]>(() =>
    ((ocr?.lines ?? []) as ReviewLine[]).map(l => {
      return {
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        vatBase: l.vatBase,
        vatAmount: l.vatAmount,
        accountCode: l.accountCode ?? null,
        accountId: l.accountId ?? null,
        confidence: l.confidence,
        suggestionSource: l.suggestionSource,
        suggestionCount: l.suggestionCount ?? undefined,
        assetType: l.assetType,
        assetTypeCandidate: l.assetTypeCandidate,
        assetTypeReason: l.assetTypeReason,
        assetTypeOriginalAccountCode: l.assetTypeOriginalAccountCode ?? null,
        assetTypeOriginalAccountId: l.assetTypeOriginalAccountId ?? null,
        vatCodeId: l.vatCodeId,
        vatCodeReason: l.vatCodeReason,
        vatCodeReviewRequired: l.vatCodeReviewRequired,
        vatCodeReviewReason: l.vatCodeReviewReason,
      };
    })
  );

  // Once accounts load, apply fuzzy matching to lines that have no resolved accountId
  const accountsLoaded = accounts.length > 0;
  const [fuzzyApplied, setFuzzyApplied] = useState(false);
  useEffect(() => {
    if (!accountsLoaded || fuzzyApplied) return;
    setEditableLines(prev =>
      prev.map(line => {
        if (line.accountId) return line; // already resolved
        const match = fuzzyMatchAccount(line.accountCode);
        if (!match) return line;
        // Preserve suggestionSource/suggestionCount when fuzzy-resolving
        return { ...line, accountId: match.id, accountCode: match.code };
      })
    );
    setFuzzyApplied(true);
  }, [accountsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateLine = (idx: number, accountId: string) => {
    const acct = accounts.find(a => a.id === accountId);
    setEditableLines(prev =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              accountId: accountId || null,
              accountCode: acct?.code ?? l.accountCode,
              ...(l.accountId !== (accountId || null)
                ? { suggestionSource: "manual" as const, suggestionCount: undefined }
                : {}),
            }
          : l
      )
    );
  };

  const applyTemplateToLine = (idx: number, accountId: string) => {
    if (!accounts.some(account => account.id === accountId)) return;
    updateLine(idx, accountId);
  };

  const decideAssetCandidate = (idx: number, accepted: boolean) => {
    setEditableLines(prev => prev.map((line, i) => {
      if (i !== idx || !line.assetTypeCandidate) return line;
      if (accepted) return { ...line, assetType: line.assetTypeCandidate };
      const original = line.assetTypeOriginalAccountId
        ? accounts.find(account => account.id === line.assetTypeOriginalAccountId)
        : undefined;
      return {
        ...line,
        assetType: "NONE",
        accountId: original?.id ?? null,
        accountCode: original?.code ?? null,
        suggestionSource: original ? "pattern" : line.suggestionSource,
      };
    }));
  };
  const resolveVatCodeForLine = (idx: number, vatCodeId: string) => {
    const vatCode = eubVatCodes.find(code => code.id === vatCodeId);
    if (!vatCode) return;
    setEditableLines(prev => prev.map((line, i) => i === idx
      ? {
          ...line,
          vatCodeId,
          vatCodeReviewRequired: false,
          vatCodeReviewReason: undefined,
          vatCodeReason: `Ročno izbrana vstopna koda ${vatCode.code}: ${vatCode.description}`,
        }
      : line));
  };

  const ordinaryFursVatCodesForLine = (line: ReviewLine) => globalFursVatCodes.filter(code =>
    !!fursVatDirection
    && code.direction === fursVatDirection
    && Number(code.rate) === line.vatRate
    && isFursCodeValidForInvoiceDate(code),
  );
  const selectOrdinaryVatCodeForLine = (idx: number, vatCodeId: string) => {
    const line = editableLines[idx];
    const vatCode = line && ordinaryFursVatCodesForLine(line).find(code => code.id === vatCodeId);
    if (!vatCode) return;
    setEditableLines(prev => prev.map((currentLine, i) => i === idx
      ? { ...currentLine, vatCodeId, vatCodeReason: `Ročno izbrana FURS koda ${vatCode.code}: ${vatCode.description}` }
      : currentLine));
  };
  const getVatCodeMappingIssue = (line: ReviewLine) => {
    if (!line.vatCodeId) return null;
    const globalCode = globalFursVatCodes.find(code => code.id === line.vatCodeId);
    if (
      !globalCode
      || !fursVatDirection
      || globalCode.direction !== fursVatDirection
      || Number(globalCode.rate) !== line.vatRate
      || !isFursCodeValidForInvoiceDate(globalCode)
    ) {
      return "Izbrana globalna FURS DDV-koda ne ustreza smeri računa, datumu ali stopnji vrstice. Izberite ustrezno kodo.";
    }
    if (companyVatCodesLoading) return "Preverjanje povezave DDV-kode s šifrantom podjetja še poteka.";
    if (companyVatCodesError) return "Povezave DDV-kode s šifrantom podjetja ni bilo mogoče preveriti. Osvežite podatke ali preverite DDV šifrant.";

    const linkedVatCodes = companyVatCodes.filter(code => code.fursCodeId === globalCode.id);
    if (linkedVatCodes.length === 0) {
      return `Globalna FURS koda ${globalCode.code} ni povezana z DDV-kodo podjetja. Povezavo nastavite v DDV šifrantu.`;
    }
    if (linkedVatCodes.length > 1) {
      return `Globalna FURS koda ${globalCode.code} je povezana z več DDV-kodami podjetja. V DDV šifrantu pustite eno ustrezno povezavo.`;
    }
    const linkedVatCode = linkedVatCodes[0];
    if (
      !linkedVatCode.isActive
      || Number(linkedVatCode.rate) !== Number(globalCode.rate)
      || linkedVatCode.fursCodeDirection !== fursVatDirection
      || (linkedVatCode.validFrom && invoiceVatDate && linkedVatCode.validFrom.slice(0, 10) > invoiceVatDate)
      || (linkedVatCode.validTo && invoiceVatDate && linkedVatCode.validTo.slice(0, 10) < invoiceVatDate)
    ) {
      return `Povezana DDV-koda podjetja za FURS kodo ${globalCode.code} je neaktivna ali ne velja za smer, stopnjo oziroma datum računa. Preverite DDV šifrant.`;
    }
    return null;
  };

  const linesAwaitingAssetDecision = editableLines.filter(line =>
    line.assetTypeCandidate && line.assetType == null,
  );
  const linesAwaitingVatReview = editableLines.filter(line => line.vatCodeReviewRequired && !line.vatCodeId);
  const linesWithVatMappingIssues = editableLines.filter(line => getVatCodeMappingIssue(line));
  const linesWithMissingAccount = editableLines.filter(l => !l.accountId);
  const hasUnresolvedLines = linesWithMissingAccount.length > 0;
  const linesWithInvalidAccount = editableLines.filter(line => {
    const account = line.accountId ? accounts.find(a => a.id === line.accountId) : undefined;
    return account ? !account.isActive || account.allowsPosting === false : false;
  });
  const hasInvalidAccounts = linesWithInvalidAccount.length > 0;
  const hasNoLines = editableLines.length === 0;

  // Confidence calculations
  const docConfidence = ocr?.confidence ? (ocr.confidence <= 1 ? ocr.confidence * 100 : ocr.confidence) : 0;
  const confidenceColor = docConfidence >= 80 ? "text-emerald-600" : docConfidence >= 50 ? "text-amber-600" : "text-red-600";
  const progressColor = docConfidence >= 80 ? "[&>div]:bg-emerald-500" : docConfidence >= 50 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500";

  const handleSubmit = () => {
    if (!activeCompany || !isReviewDocumentType(form.documentType) || !selectedCounterpartyId || hasNoLines) return;
    if (form.createInvoice && isForeignCurrency && (!isSupportedFxCurrency || !fxReviewReady)) return;
    const exchangeRate = needsFxReview && exchangeRatePreview && hasReviewedExchangeRate
      ? {
          mode: exchangeRateMode,
          requestedDate: form.invoiceDate,
          rateDate: exchangeRatePreview.rateDate,
          unitsPerEur: exchangeRatePreview.unitsPerEur,
          reviewed: true as const,
          ...(exchangeRateMode === "manual" ? { manualReason: manualRateReason.trim() } : {}),
        }
      : undefined;
    
    confirmMut.mutate({
      companyId: activeCompany.id,
      id: doc.id,
      data: {
        documentType: form.documentType,
        counterpartyId: selectedCounterpartyId,
        periodId: form.periodId || null,
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        dueDate: form.dueDate || null,
        createInvoice: form.createInvoice,
        ...(exchangeRate ? { exchangeRate } : {}),
        // Submit editable lines (with fuzzy-resolved + manually selected accounts)
        lines: editableLines
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(activeCompany.id) });
        queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(activeCompany.id, doc.id) });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* 2-Column OCR Overview */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Left: Extracted Data Panel */}
        <Card className="shadow-none border-border">
          <CardContent className="p-5">
            <div className="mb-6 flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <FileSearch className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">Prepoznani podatki</span>
              </h3>
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className={`shrink-0 text-sm font-bold ${confidenceColor}`}>{Math.round(docConfidence)}%</span>
                <Progress value={docConfidence} className={`h-2 min-w-0 flex-1 bg-muted ${progressColor}`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-6">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Partner</Label>
                <div className="font-medium text-base mt-0.5">{ocr?.counterpartyName || <span className="text-muted-foreground italic">Ni prepoznano</span>}</div>
                {(ocr?.counterpartyTaxId || ocr?.counterpartyAddress) && (
                  <div className="text-sm text-muted-foreground mt-1 flex flex-col gap-0.5">
                    {ocr?.counterpartyTaxId && <span>ID: {ocr.counterpartyTaxId}</span>}
                    {ocr?.counterpartyAddress && <span>{ocr.counterpartyAddress}</span>}
                  </div>
                )}
              </div>

              <div className="p-3 bg-muted/30 rounded-lg border">
                <Label className="text-xs text-muted-foreground">Številka računa</Label>
                <div className="font-medium mt-1">{ocr?.invoiceNumber || "-"}</div>
              </div>

              <div className="p-3 bg-muted/30 rounded-lg border">
                <Label className="text-xs text-muted-foreground">Datumi</Label>
                <div className="font-medium mt-1 text-sm">
                  Izdaja: {ocr?.invoiceDate ? new Date(ocr.invoiceDate).toLocaleDateString("sl-SI") : "-"}<br/>
                  Rok: {ocr?.dueDate ? new Date(ocr.dueDate).toLocaleDateString("sl-SI") : "-"}
                </div>
              </div>

              <div className="col-span-2 p-4 bg-muted/30 rounded-lg border mt-2">
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-xs text-muted-foreground">Zneski</Label>
                  <span className="text-xs font-mono text-muted-foreground">{sourceCurrency}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b">
                  <span className="text-muted-foreground">Neto:</span>
                  <span className="font-medium">{formatCurrencyAmount(ocr?.totalNet, sourceCurrency)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b">
                  <span className="text-muted-foreground">DDV:</span>
                  <span className="font-medium">{formatCurrencyAmount(ocr?.totalVat, sourceCurrency)}</span>
                </div>
                <div className="flex justify-between text-base py-2 font-bold">
                  <span>Bruto za plačilo:</span>
                  <span>{formatCurrencyAmount(ocr?.totalGross, sourceCurrency)}</span>
                </div>
                {isForeignCurrency && !isSupportedFxCurrency && (
                  <Alert className="mt-3 border-amber-300 bg-amber-50 text-amber-950">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    <AlertDescription className="text-xs">
                      Valuta {sourceCurrency} še ni podprta za samodejni preračun. Ne bo obravnavana kot EUR; ustvarjanje osnutka je onemogočeno. Za vnos preverjenih EUR zneskov uporabite <Link href="/racuni" className="font-medium underline">obstoječi vnos računov</Link>.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              {isForeignCurrency && isSupportedFxCurrency && (
                <div className="col-span-2 min-w-0">
                  <Card className="shadow-none border-border overflow-hidden">
                    <CardContent className="p-4 sm:p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-semibold">Pregled pretvorbe USD v EUR</h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Izvorni USD zneski ostanejo nespremenjeni. Strežnik bo ob potrditvi ponovno izračunal EUR iz poslanih izvornih vrstic.
                          </p>
                        </div>
                        <div className="w-full sm:w-48 shrink-0 space-y-1">
                          <Label htmlFor="exchange-rate-mode" className="text-xs">Vir tečaja</Label>
                          <Select
                            value={exchangeRateMode}
                            onValueChange={value => {
                              if (value === "ecb" || value === "manual") {
                                setReviewedExchangeRateKey("");
                                setExchangeRateMode(value);
                              }
                            }}
                            disabled={isViewer}
                          >
                            <SelectTrigger id="exchange-rate-mode" className="h-9 bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ecb">Samodejni tečaj ECB</SelectItem>
                              <SelectItem value="manual">Ročni tečaj</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {exchangeRateMode === "manual" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor="manual-units-per-eur" className="text-xs">1 EUR = koliko USD?</Label>
                            <Input
                              id="manual-units-per-eur"
                              inputMode="decimal"
                              value={manualRateInput}
                              onChange={event => {
                                setReviewedExchangeRateKey("");
                                setManualRateInput(event.target.value);
                              }}
                              placeholder="npr. 1,08"
                              className="h-9 bg-background"
                              disabled={isViewer}
                            />
                            {manualRateInput && parsedManualRate === null && (
                              <p className="text-xs text-destructive">Vnesite pozitivni tečaj; decimalno vejico lahko uporabite kot ločilo.</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="manual-rate-date" className="text-xs">Datum veljavnosti tečaja</Label>
                            <Input
                              id="manual-rate-date"
                              type="date"
                              value={manualRateDate}
                              onChange={event => {
                                setReviewedExchangeRateKey("");
                                setManualRateDate(event.target.value);
                              }}
                              max={form.invoiceDate || undefined}
                              className="h-9 bg-background"
                              disabled={isViewer}
                            />
                            {!!manualRateDate && !validManualRateDate && (
                              <p className="text-xs text-destructive">Datum tečaja mora biti veljaven in ne sme biti poznejši od datuma računa.</p>
                            )}
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label htmlFor="manual-rate-reason" className="text-xs">Utemeljitev ročnega tečaja (obvezno)</Label>
                            <Input
                              id="manual-rate-reason"
                              value={manualRateReason}
                              onChange={event => {
                                setReviewedExchangeRateKey("");
                                setManualRateReason(event.target.value);
                              }}
                              placeholder="Navedite razlog uporabe ročnega tečaja"
                              maxLength={500}
                              className="bg-background"
                              disabled={isViewer}
                            />
                            {manualRateReason.trim().length > 0 && !validManualReason && (
                              <p className="text-xs text-destructive">Utemeljitev mora vsebovati vsaj 3 znake.</p>
                            )}
                          </div>
                        </div>
                      )}

                      {!validInvoiceDate ? (
                        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                          <AlertTriangle className="h-4 w-4 text-amber-700" />
                          <AlertDescription className="text-sm">Za pridobitev tečaja najprej vnesite veljaven datum računa.</AlertDescription>
                        </Alert>
                      ) : exchangeRateMode === "manual" && parsedManualRate === null ? (
                        <p className="text-sm text-muted-foreground">Vnesite pozitiven ročni tečaj za predogled preračuna.</p>
                      ) : exchangeRateMode === "manual" && !validManualRateDate ? (
                        <p className="text-sm text-destructive">Popravite datum veljavnosti ročnega tečaja.</p>
                      ) : exchangeRateMode === "manual" && manualRateDebouncing ? (
                        <p className="text-sm text-muted-foreground">Posodabljam predogled ročnega tečaja…</p>
                      ) : exchangeRateQuery.isError ? (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                            <span>Tečaja ni bilo mogoče pridobiti. Preverite povezavo ali poskusite znova.</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => exchangeRateQuery.refetch()}>
                              Poskusi znova
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : exchangeRateQuery.isLoading || exchangeRateQuery.isFetching ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Pridobivam tečaj in pripravljam EUR predogled…
                        </div>
                      ) : !exchangeRatePreview ? (
                        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                          <AlertTriangle className="h-4 w-4 text-amber-700" />
                          <AlertDescription className="text-sm">
                            Predogled tečaja še ni na voljo za izbrani datum in način. Osnutka EUR ni mogoče ustvariti brez veljavnega predogleda.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <div className="space-y-4">
                          <div className="rounded-lg border bg-muted/20 p-3 sm:p-4 space-y-2">
                            <p className="font-medium text-sm">
                              1 EUR = {exchangeRatePreview.unitsPerEur.toLocaleString("sl-SI")} USD
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Tečaj je izražen v USD za 1 EUR; preračun v EUR deli izvorni znesek USD s tem tečajem.
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Tečaj {exchangeRatePreview.source === "ECB" ? "ECB" : "ročni"} · veljaven {exchangeRatePreview.rateDate}
                              {" "}· datum računa {exchangeRatePreview.requestedDate}
                              {exchangeRatePreview.sourceUrl && (
                                <> · <a href={exchangeRatePreview.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">vir tečaja</a></>
                              )}
                            </p>
                            {exchangeRatePreview.rateDate < exchangeRatePreview.requestedDate && exchangeRatePreview.source === "ECB" && (
                              <p className="text-xs text-amber-800">
                                Za izbrani datum ECB ni objavila tečaja; uporabljen je zadnji razpoložljivi tečaj za predhodni dan.
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-md border p-3 text-sm">
                              <p className="text-xs text-muted-foreground mb-1">Izvorni zneski ({sourceCurrency})</p>
                              <p>Neto {formatCurrencyAmount(exchangeRatePreview.sourceTotals.net, sourceCurrency)}</p>
                              <p>DDV {formatCurrencyAmount(exchangeRatePreview.sourceTotals.vat, sourceCurrency)}</p>
                              <p className="font-medium">Bruto {formatCurrencyAmount(exchangeRatePreview.sourceTotals.gross, sourceCurrency)}</p>
                            </div>
                            <div className="rounded-md border p-3 text-sm">
                              <p className="text-xs text-muted-foreground mb-1">Predogled osnutka (EUR)</p>
                              <p>Neto {formatEur(exchangeRatePreview.eurTotals.net)}</p>
                              <p>DDV {formatEur(exchangeRatePreview.eurTotals.vat)}</p>
                              <p className="font-medium">Bruto {formatEur(exchangeRatePreview.eurTotals.gross)}</p>
                            </div>
                          </div>

                          {exchangeRatePreview.roundingDifference !== 0 && (
                            <p className="text-xs text-muted-foreground">
                              Razlika zaokroževanja: {formatEur(exchangeRatePreview.roundingDifference)}. Vrstice se preračunajo in zaokrožijo posamično, zato njihov seštevek lahko odstopa od preračuna skupnega zneska.
                            </p>
                          )}

                          <div className="min-w-0 overflow-x-auto rounded-md border">
                            <table className="w-full min-w-[520px] text-xs text-left">
                              <thead className="bg-muted/30 text-muted-foreground border-b">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Vrstica</th>
                                  <th className="px-3 py-2 font-medium text-right">Cena enote (EUR)</th>
                                  <th className="px-3 py-2 font-medium text-right">Osnova (EUR)</th>
                                  <th className="px-3 py-2 font-medium text-right">DDV (EUR)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {editableLines.map((line, index) => {
                                  const converted = exchangeRatePreview.convertedLines[index];
                                  return converted ? (
                                    <tr key={`${line.description}-${index}`}>
                                      <td className="px-3 py-2 font-medium">{line.description}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{formatEur(converted.unitPrice)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{formatEur(converted.vatBase)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{formatEur(converted.vatAmount)}</td>
                                    </tr>
                                  ) : null;
                                })}
                              </tbody>
                            </table>
                          </div>

                          {form.createInvoice && (
                            <div className="flex items-start gap-2 rounded-md border bg-background p-3">
                              <Checkbox
                                id="reviewed-exchange-rate"
                                checked={hasReviewedExchangeRate}
                                disabled={isViewer || !exchangeRatePreview || (exchangeRateMode === "manual" && !validManualReason)}
                                onCheckedChange={checked => setReviewedExchangeRateKey(checked ? exchangeRateReviewBasis : "")}
                              />
                              <Label htmlFor="reviewed-exchange-rate" className="text-sm leading-5 cursor-pointer">
                                Pregledal/-a sem tečaj in EUR predogled ter odobravam uporabo za osnutek računa.
                              </Label>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: Suggested Lines */}
        <Card className="shadow-none border-border flex flex-col">
          <CardContent className="p-0 flex-1 flex flex-col">
            <div className="p-5 pb-4 border-b">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                Predlog kontiranja
              </h3>
            </div>
            
            {hasNoLines && (
              <div className="px-5 pb-2">
                <Alert variant="destructive" className="py-2 px-3">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    Dokument nima vrstic za kontiranje — dodajte vsaj eno vrstico.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {hasUnresolvedLines && (
              <div className="px-5 pb-2">
                <Alert className="py-2 px-3 border-amber-200 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    {linesWithMissingAccount.length === 1
                      ? "1 vrstica nima izbranega konta — izberite konto pred potrditvijo."
                      : `${linesWithMissingAccount.length} vrstice nimajo izbranega konta — izberite konte pred potrditvijo.`}
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {hasInvalidAccounts && (
              <div className="px-5 pb-2">
                <Alert className="py-2 px-3 border-amber-200 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    {linesWithInvalidAccount.length === 1
                      ? "Izbrani konto ni aktiven ali ni knjižljiv — izberite analitični konto pred potrditvijo."
                      : `${linesWithInvalidAccount.length} izbrani konti niso aktivni ali knjižljivi — izberite analitične konte pred potrditvijo.`}
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {linesAwaitingAssetDecision.length > 0 && form.createInvoice && (
              <div className="px-5 pb-2">
                <Alert className="py-2 px-3 border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    Računovodja mora za vsako označeno osnovno sredstvo izrecno sprejeti ali zavrniti predlog pred ustvarjanjem računa.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {linesAwaitingVatReview.length > 0 && form.createInvoice && (
              <div className="px-5 pb-2">
                <Alert className="py-2 px-3 border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    {linesAwaitingVatReview[0].vatCodeReviewReason} Osnutka računa zaradi DDV ne bo mogoče ustvariti, dokler DDV-koda ni preverjena.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {linesWithVatMappingIssues.length > 0 && form.createInvoice && (
              <div className="px-5 pb-2">
                <Alert className="py-2 px-3 border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    DDV-kode na {linesWithVatMappingIssues.length === 1 ? "eni vrstici ni mogoče uporabiti" : `${linesWithVatMappingIssues.length} vrsticah ni mogoče uporabiti`} brez veljavne povezave globalne FURS kode s šifrantom podjetja. Preverite opozorila pri vrsticah in <Link href="/ddv" className="font-medium underline">DDV šifrant</Link>.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {selectedCounterpartyId && (
              <div className="px-5 pb-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs">
                  <Bookmark className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                  <span className="font-medium text-emerald-900">Shranjene predloge za tega partnerja:</span>
                  {accountTemplatesLoading ? (
                    <span className="text-emerald-700">nalagam…</span>
                  ) : accountTemplatesError ? (
                    <span className="text-amber-700">ni jih bilo mogoče naložiti</span>
                  ) : accountTemplates.length > 0 ? (
                    accountTemplates.map(template => (
                      <span key={template.id} className="font-mono text-emerald-800">
                        {template.accountCode} ({template.usageCount}×)
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">zaenkrat ni shranjenih predlog</span>
                  )}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/30 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium">Opis</th>
                    <th className="px-4 py-3 font-medium text-right">Znesek</th>
                    <th className="px-4 py-3 font-medium text-right">DDV %</th>
                    <th className="px-4 py-3 font-medium min-w-[180px]">Konto</th>
                    <th className="px-4 py-3 font-medium text-center">Zanesljivost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {editableLines.length > 0 ? (
                    editableLines.map((line, idx) => {
                      const lConf = line.confidence <= 1 ? line.confidence * 100 : line.confidence;
                      const missing = !line.accountId;
                      const selectedAccount = line.accountId ? accounts.find(a => a.id === line.accountId) : undefined;
                      const accountIsInactive = selectedAccount ? !selectedAccount.isActive : false;
                      const accountIsGroup = selectedAccount ? selectedAccount.allowsPosting === false : false;
                      return (
                        <tr key={idx} className={`hover:bg-muted/10 ${missing ? "bg-amber-50/40" : ""}`}>
                          <td className="px-4 py-3 font-medium max-w-[190px]" title={line.description}>
                            <div className="truncate">{line.description}</div>
                            {line.assetTypeCandidate && (
                              <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-950">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className="border-amber-300 text-amber-900">
                                    Predlog OS: {line.assetTypeCandidate === "REALESTATE" ? "nepremičnina" : "drugo OS"}
                                  </Badge>
                                  {line.assetType === "NONE" && <span className="text-muted-foreground">zavrnjeno</span>}
                                  {(line.assetType === "OTHER_FA" || line.assetType === "REALESTATE") && <span className="text-emerald-700">sprejeto</span>}
                                </div>
                                <p className="mt-1 font-normal">{line.assetTypeReason}</p>
                                {!isViewer && form.createInvoice && (
                                  <div className="mt-1.5 flex gap-2">
                                    <button type="button" onClick={() => decideAssetCandidate(idx, true)} className="font-medium text-emerald-700 hover:underline">
                                      Sprejmi predlog
                                    </button>
                                    <button type="button" onClick={() => decideAssetCandidate(idx, false)} className="font-medium text-muted-foreground hover:underline">
                                      Zavrni predlog
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            {line.vatCodeReviewRequired && !line.vatCodeId && (
                              <div className="mt-1.5 space-y-1.5">
                                <p className="text-[10px] font-normal text-amber-800">{line.vatCodeReviewReason}</p>
                                {!isViewer && form.createInvoice && (
                                  <Select value={line.vatCodeId ?? ""} onValueChange={value => resolveVatCodeForLine(idx, value)}>
                                    <SelectTrigger className="h-8 bg-background text-xs">
                                      <SelectValue placeholder="Izberite vstopno EUB DDV-kodo…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {eubVatCodes.map(code => (
                                        <SelectItem key={code.id} value={code.id}>
                                          <span className="font-mono">{code.code}</span> — {code.description}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {eubVatCodes.length === 0 && (
                                  <p className="text-[10px] font-normal text-destructive">
                                    Veljavne vstopne EUB kode niso na voljo. Obrnite se na skrbnika DDV šifranta.
                                  </p>
                                )}
                              </div>
                            )}
                            {!line.vatCodeReviewRequired && form.createInvoice && isReviewDocumentType(form.documentType) && !isViewer && (
                              <div className="mt-1.5 space-y-1.5">
                                <Label className="text-[10px] font-normal text-muted-foreground">
                                  Globalna FURS DDV-koda
                                </Label>
                                <Select
                                  value={line.vatCodeId ?? ""}
                                  onValueChange={value => selectOrdinaryVatCodeForLine(idx, value)}
                                >
                                  <SelectTrigger
                                    className="h-8 bg-background text-xs"
                                    aria-label={`Globalna FURS DDV-koda — ${line.description}`}
                                  >
                                    <SelectValue placeholder="Izberite FURS kodo glede na stopnjo…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ordinaryFursVatCodesForLine(line).map(code => (
                                      <SelectItem key={code.id} value={code.id}>
                                        <span className="font-mono">{code.code}</span> · {Number(code.rate)} % — {code.description}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {line.vatCodeId && getVatCodeMappingIssue(line) && (
                                  <p className="text-[10px] font-normal text-amber-800">
                                    {getVatCodeMappingIssue(line)}{" "}
                                    <Link href="/ddv" className="font-medium underline">Odprite DDV šifrant.</Link>
                                  </p>
                                )}
                              </div>
                            )}
                            {line.vatCodeId && line.vatCodeReason && (
                              <p className="mt-1 text-[10px] font-normal text-blue-800">
                                {line.vatCodeReviewRequired ? "DDV EUB22/95:" : "FURS DDV-koda:"} {line.vatCodeReason}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyAmount(line.vatBase, sourceCurrency)}</td>
                          <td className="px-4 py-3 text-right">{line.vatRate}%</td>
                          <td className="px-4 py-2">
                            <Select
                              value={line.accountId ?? ""}
                              onValueChange={v => updateLine(idx, v)}
                              disabled={isViewer}
                            >
                              <SelectTrigger
                                className={`h-8 text-xs bg-background ${
                                  missing
                                    ? "border-amber-300 text-amber-700"
                                    : accountIsGroup || accountIsInactive
                                      ? "border-amber-400 bg-amber-50 text-amber-800"
                                      : ""
                                }`}
                              >
                                <SelectValue placeholder={
                                  line.accountCode
                                    ? `${line.accountCode} — ni v planu`
                                    : "Izberite konto…"
                                } />
                              </SelectTrigger>
                              <SelectContent>
                                {accounts.map(a => (
                                  <SelectItem
                                    key={a.id}
                                    value={a.id}
                                    disabled={!a.isActive || a.allowsPosting === false}
                                    className={!a.isActive || a.allowsPosting === false ? "text-muted-foreground opacity-60" : undefined}
                                  >
                                    <span className="font-mono mr-1">{a.code}</span> {a.name}
                                    {!a.isActive && <span className="ml-2 text-[10px]">neaktiven</span>}
                                    {a.isActive && a.allowsPosting === false && <span className="ml-2 text-[10px]">skupinski</span>}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {accountIsGroup && (
                              <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 mt-1">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>Konto {selectedAccount?.code ?? line.accountCode} je skupinski — izberite analitični konto za direktno knjiženje</span>
                              </div>
                            )}
                            {accountIsInactive && (
                              <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 mt-1">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>Konto {selectedAccount?.code ?? line.accountCode} ni aktiven — izberite aktiven konto za direktno knjiženje</span>
                              </div>
                            )}
                            {line.accountId && (
                              <SuggestionSourceIndicator
                                source={line.suggestionSource}
                                count={line.suggestionCount}
                              />
                            )}
                            {accountTemplates.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[10px] text-muted-foreground mr-0.5">Uporabi predlogo:</span>
                                {accountTemplates.map(template => {
                                  const canApply = accounts.some(account => account.id === template.accountId);
                                  return (
                                    <button
                                      key={template.id}
                                      type="button"
                                      disabled={isViewer || !canApply}
                                      onClick={() => applyTemplateToLine(idx, template.accountId)}
                                      className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      title={canApply
                                        ? `Uporabi konto ${template.accountCode} za to vrstico`
                                        : `Konto ${template.accountCode} ni v kontnem planu`}
                                    >
                                      {template.accountCode} ({template.usageCount}×)
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant="secondary" className={`text-[10px] ${lConf >= 80 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                              {Math.round(lConf)}%
                            </Badge>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        AI ni prepoznal posameznih vrstic za kontiranje.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Confirmation Form */}
      <Card className="border-border shadow-sm border-t-4 border-t-primary">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-lg">Potrditev in knjiženje</h3>
              <p className="text-sm text-muted-foreground">Preglejte in popravite ključne podatke preden ustvarite zapis v ERP.</p>
            </div>
            
            <div className="flex items-center space-x-2 bg-muted/50 p-2 rounded-lg border">
              <Checkbox 
                id="createInvoice" 
                checked={form.createInvoice} 
                onCheckedChange={(c) => setForm(p => ({...p, createInvoice: !!c}))} 
              />
              <Label htmlFor="createInvoice" className="text-sm font-medium cursor-pointer">
                Ustvari osnutek računa
              </Label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Tip dokumenta</Label>
              <Select value={form.documentType} onValueChange={v => {
                setForm(p => ({ ...p, documentType: v }));
                if (showCreatePartner) {
                  setNewPartner(p => ({ ...p, type: getPartnerTypeForDocument(v) }));
                }
              }}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Izberite tip dokumenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice_received">Prejet račun</SelectItem>
                  <SelectItem value="invoice_issued">Izdan račun</SelectItem>
                  <SelectItem value="other">Ostalo / Splošna temeljnica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Partner <span className="text-destructive">*</span></Label>
              <Select value={selectedCounterpartyId} onValueChange={v => setForm(p => ({...p, counterpartyId: v}))}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Izberite partnerja" />
                </SelectTrigger>
                <SelectContent>
                  {counterparties.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name} {c.taxId ? `(SI${c.taxId})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ocrCounterpartyIsOwnCompany && (
                <Alert className="mt-1.5 py-2 px-3 border-blue-200 bg-blue-50 text-blue-900">
                  <AlertTriangle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <AlertDescription className="text-xs ml-1">
                    AI je kot partnerja prepoznal vaše podjetje. Preverite vlogo izdajatelja in ročno izberite dejanskega partnerja; lastnega podjetja ni mogoče izbrati kot partnerja.
                  </AlertDescription>
                </Alert>
              )}
              {/* Show hint when AI found a name but no matching counterparty */}
              {!selectedCounterpartyId && ocr?.counterpartyName && !ocrCounterpartyIsOwnCompany && !isViewer && (
                <div className="mt-1.5">
                  <Alert className="py-2 px-3 border-amber-200 bg-amber-50 text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <AlertDescription className="text-xs ml-1">
                      AI je prepoznal "<strong>{ocr.counterpartyName}</strong>", a partnerja ni v sistemu.
                    </AlertDescription>
                  </Alert>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1.5 w-full border-dashed text-amber-700 border-amber-300 hover:bg-amber-50"
                    disabled={!isReviewDocumentType(form.documentType)}
                    onClick={() => {
                      if (!isReviewDocumentType(form.documentType)) return;
                      setNewPartner({
                        name: ocr.counterpartyName || "",
                        taxId: ocr.counterpartyTaxId?.replace(/^SI/, "") || "",
                        type: getPartnerTypeForDocument(form.documentType),
                      });
                      setShowCreatePartner(v => !v);
                    }}
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    Ustvari partnerja iz AI podatkov
                    {showCreatePartner ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                  </Button>
                  {!isReviewDocumentType(form.documentType) && (
                    <p className="mt-1 text-xs text-muted-foreground">Najprej izberite tip dokumenta, nato lahko ustvarite partnerja.</p>
                  )}

                  {/* Inline mini create-partner form */}
                  {showCreatePartner && (
                    <div className="mt-2 p-3 border rounded-lg bg-background space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nov partner</p>
                      <div className="space-y-1">
                        <Label className="text-xs">Ime <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPartner.name}
                          onChange={e => setNewPartner(p => ({ ...p, name: e.target.value }))}
                          placeholder="Naziv podjetja"
                          className="h-8 text-sm bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Davčna številka</Label>
                        <Input
                          value={newPartner.taxId}
                          onChange={e => setNewPartner(p => ({ ...p, taxId: e.target.value }))}
                          placeholder="npr. 12345678"
                          className="h-8 text-sm bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tip</Label>
                        <Select value={newPartner.type} onValueChange={v => setNewPartner(p => ({ ...p, type: v as any }))}>
                          <SelectTrigger className="h-8 text-sm bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="supplier">Dobavitelj</SelectItem>
                            <SelectItem value="customer">Kupec</SelectItem>
                            <SelectItem value="both">Oboje</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={!newPartner.name.trim() || createCounterpartyMut.isPending}
                        onClick={handleCreatePartner}
                      >
                        {createCounterpartyMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}
                        Shrani partnerja
                      </Button>
                      {createCounterpartyMut.isError && (
                        <p className="text-xs text-destructive">Napaka pri ustvarjanju partnerja. Preverite podatke.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Obdobje <span className="text-destructive">*</span></Label>
              <Select value={form.periodId} onValueChange={v => setForm(p => ({...p, periodId: v}))}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Izberite obdobje" />
                </SelectTrigger>
                <SelectContent>
                  {openPeriods.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Številka računa</Label>
              <Input 
                value={form.invoiceNumber} 
                onChange={e => setForm(p => ({...p, invoiceNumber: e.target.value}))} 
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="document-invoice-date">Datum računa</Label>
              <Input 
                id="document-invoice-date"
                type="date" 
                value={form.invoiceDate} 
                  onChange={e => {
                    setReviewedExchangeRateKey("");
                    setForm(p => ({...p, invoiceDate: e.target.value}));
                    setManualRateDate(e.target.value);
                  }}
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label>Rok plačila</Label>
              <Input 
                type="date" 
                value={form.dueDate} 
                onChange={e => setForm(p => ({...p, dueDate: e.target.value}))} 
                className="bg-background"
              />
            </div>
          </div>

          <div className="mt-8 pt-6 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground space-y-1">
              {confirmMut.isError && (
                <Alert variant="destructive" className="max-w-2xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Osnutka računa ni bilo mogoče ustvariti</AlertTitle>
                  <AlertDescription>
                    {getSafeDocumentConfirmErrorMessage(confirmMut.error)}
                  </AlertDescription>
                </Alert>
              )}
              {!selectedCounterpartyId && !ocrCounterpartyIsOwnCompany && (
                <p className="text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Partner ni izbran</p>
              )}
              {!isReviewDocumentType(form.documentType) && (
                <p className="text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Tip dokumenta ni izbran</p>
              )}
              {!form.periodId && (
                <p className="text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Obdobje ni izbrano</p>
              )}
              {hasUnresolvedLines && (
                <p className="text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {linesWithMissingAccount.length} {linesWithMissingAccount.length === 1 ? "vrstica nima" : "vrstice nimajo"} konta</p>
              )}
              {hasInvalidAccounts && (
                <p className="text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {linesWithInvalidAccount.length} {linesWithInvalidAccount.length === 1 ? "konto ni knjižljiv" : "kontov ni knjižljivih"}</p>
              )}
              {form.createInvoice && isForeignCurrency && !isSupportedFxCurrency && (
                <p className="text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Osnutka računa za valuto {sourceCurrency} ni mogoče ustvariti, ker pretvorba ni podprta. Uporabite <Link href="/racuni" className="font-medium underline">Računi</Link> za preverjen ročni EUR vnos.
                </p>
              )}
              {form.createInvoice && needsFxReview && !fxReviewReady && (
                <p className="text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Pred ustvarjanjem EUR osnutka pridobite veljaven tečaj in izrecno preglejte predogled.
                </p>
              )}
            </div>
            <Button 
              size="lg" 
              onClick={handleSubmit} 
              disabled={!isReviewDocumentType(form.documentType) || !selectedCounterpartyId || !form.periodId || hasNoLines || hasUnresolvedLines || hasInvalidAccounts || (form.createInvoice && ((isForeignCurrency && (!isSupportedFxCurrency || !fxReviewReady)) || linesAwaitingAssetDecision.length > 0 || linesAwaitingVatReview.length > 0 || linesWithVatMappingIssues.length > 0)) || confirmMut.isPending || isViewer}
              className="bg-primary text-primary-foreground min-w-[200px]"
            >
              {confirmMut.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
              Potrdi in shrani
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
