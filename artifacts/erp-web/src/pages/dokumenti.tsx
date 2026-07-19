import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  FileText, Upload, Loader2, FileSearch, CheckCircle2, XCircle, AlertCircle, 
  Building2, AlertTriangle, FileUp, UserPlus, ChevronDown, ChevronUp,
  Eye, EyeOff, ZoomIn, ZoomOut, ExternalLink, Maximize2, X
} from "lucide-react";
import { Link } from "wouter";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListDocuments,
  useGetDocument,
  useRegisterDocument,
  useConfirmDocument,
  useRejectDocument,
  useRequestUploadUrl,
  useListCounterparties,
  useCreateCounterparty,
  useListAccounts,
  useListPeriods,
  getListDocumentsQueryKey,
  getGetDocumentQueryKey,
  getListCounterpartiesQueryKey,
  type DocumentRecord,
  type ProposedLine,
} from "@workspace/api-client-react";

// Task #31 dodal ti polji v backend, še nista v generiranem scheemu
type ProposedLineExtended = ProposedLine & {
  suggestionSource?: "history" | "pattern";
  suggestionCount?: number;
};

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

const formatEur = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(n);
};

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
      const timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(activeCompany.id) });
        if (selectedDocId) {
          queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(activeCompany.id, selectedDocId) });
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [documents, activeCompany?.id, queryClient, selectedDocId]);

  // Upload Logic
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const requestUploadMut = useRequestUploadUrl();
  const registerDocMut = useRegisterDocument();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCompany) return;

    try {
      setUploading(true);
      // 1. Get upload URL
      const { uploadURL, objectPath } = await requestUploadMut.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type }
      });

      // 2. Upload directly via PUT
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`Upload failed: ${putRes.statusText}`);
      }

      // 3. Register document
      await registerDocMut.mutateAsync({
        companyId: activeCompany.id,
        data: {
          objectPath,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size
        }
      });

      // 4. Refresh list
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(activeCompany.id) });
      
    } catch (err) {
      console.error("Upload error:", err);
      alert("Napaka pri nalaganju datoteke.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] gap-4">
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dokumenti v obdelavi</h1>
          <p className="text-muted-foreground mt-1">Naložite dokumente za AI prepoznavo in avtomatsko knjiženje.</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* Left Column: List */}
        <div className="w-[380px] flex flex-col border rounded-xl bg-card shadow-sm overflow-hidden shrink-0">
          <div className="p-4 border-b bg-muted/20 shrink-0">
            <input 
              type="file" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange}
              accept=".pdf,.jpg,.jpeg,.png,.webp"
            />
            <Button 
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || activeCompany?.role === "viewer"}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? "Nalaganje..." : "Naloži dokument"}
            </Button>
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
            <DocumentDetailPanel docId={selectedDocId} onDeselect={() => setSelectedDocId(null)} />
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
        ) : doc.status === "done" ? (
          <div className="p-6">
            <DocumentReviewForm doc={doc} />
          </div>
        ) : doc.status === "confirmed" ? (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="h-12 w-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-emerald-800">Dokument potrjen</h3>
                <p className="text-sm text-emerald-700 mt-0.5">
                  Podatki so bili uspešno shranjeni.
                  {doc.updatedAt && (
                    <span className="ml-1 text-emerald-600">
                      · {new Date(doc.updatedAt).toLocaleString("sl-SI", { dateStyle: "medium", timeStyle: "short" })}
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
            <DocumentPreview objectPath={doc.objectPath} mimeType={doc.mimeType} />
          </div>
        ) : doc.status === "rejected" ? (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
              <div className="h-12 w-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                <XCircle className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-red-800">Dokument zavrnjen</h3>
                <p className="text-sm text-red-700 mt-0.5">
                  Ta dokument je bil zavrnjen in ne bo obdelan.
                  {doc.updatedAt && (
                    <span className="ml-1 text-red-600">
                      · {new Date(doc.updatedAt).toLocaleString("sl-SI", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <DocumentPreview objectPath={doc.objectPath} mimeType={doc.mimeType} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// DOCUMENT PREVIEW COMPONENT
// ----------------------------------------------------------------------

function DocumentPreview({ objectPath, mimeType }: { objectPath: string; mimeType: string }) {
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
}

// ----------------------------------------------------------------------
// FORM & REVIEW SECTION
// ----------------------------------------------------------------------

function DocumentReviewForm({ doc }: { doc: DocumentRecord }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const ocr = doc.ocrResult;
  const isViewer = activeCompany?.role === "viewer";

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", { includeInactive: false }, { query: { enabled: !!activeCompany?.id } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  const { data: accountsData } = useListAccounts(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const accounts = accountsData?.accounts ?? [];

  const { data: periodsData } = useListPeriods(activeCompany?.id ?? "", { query: { enabled: !!activeCompany?.id } as any });
  const periods = periodsData?.periods ?? [];
  const openPeriods = periods.filter(p => p.status === "open");

  const confirmMut = useConfirmDocument();
  const createCounterpartyMut = useCreateCounterparty();

  // Mini-form for quick partner creation
  const [showCreatePartner, setShowCreatePartner] = useState(false);
  const [newPartner, setNewPartner] = useState({
    name: ocr?.counterpartyName || "",
    taxId: ocr?.counterpartyTaxId?.replace(/^SI/, "") || "",
    type: "supplier" as "customer" | "supplier" | "both",
  });

  const handleCreatePartner = () => {
    if (!activeCompany || !newPartner.name.trim()) return;
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

  const [form, setForm] = useState({
    documentType: ocr?.suggestedDocumentType || "invoice_received",
    counterpartyId: ocr?.suggestedCounterpartyId || "",
    periodId: ocr?.suggestedPeriodId || (openPeriods.length > 0 ? openPeriods[openPeriods.length - 1].id : ""),
    invoiceNumber: ocr?.invoiceNumber || "",
    invoiceDate: ocr?.invoiceDate?.split("T")[0] || "",
    dueDate: ocr?.dueDate?.split("T")[0] || "",
    createInvoice: true
  });

  // Fuzzy match account code to loaded accounts list
  const fuzzyMatchAccount = (code: string | null | undefined) => {
    if (!code || accounts.length === 0) return null;
    const exact = accounts.find(a => a.code === code);
    if (exact) return exact;
    // Prefix match: "400" → "4000", or "4200" → "420"
    const prefix = accounts.find(a => a.code.startsWith(code) || code.startsWith(a.code));
    return prefix ?? null;
  };

  // Editable lines state — initialized with OCR lines, fuzzy-resolved account applied
  // We delay init until accounts are loaded; useEffect updates when accounts arrive
  const [editableLines, setEditableLines] = useState<Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatBase: number;
    vatAmount: number;
    accountCode: string | null;
    accountId: string | null;
    confidence: number;
    suggestionSource?: "history" | "pattern";
    suggestionCount?: number;
  }>>(() =>
    (ocr?.lines ?? []).map(l => {
      const le = l as ProposedLineExtended;
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
        suggestionSource: le.suggestionSource,
        suggestionCount: le.suggestionCount ?? undefined,
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
        i === idx ? { ...l, accountId: accountId || null, accountCode: acct?.code ?? l.accountCode } : l
      )
    );
  };

  const linesWithMissingAccount = editableLines.filter(l => !l.accountId);
  const hasUnresolvedLines = linesWithMissingAccount.length > 0;

  // Confidence calculations
  const docConfidence = ocr?.confidence ? (ocr.confidence <= 1 ? ocr.confidence * 100 : ocr.confidence) : 0;
  const confidenceColor = docConfidence >= 80 ? "text-emerald-600" : docConfidence >= 50 ? "text-amber-600" : "text-red-600";
  const progressColor = docConfidence >= 80 ? "[&>div]:bg-emerald-500" : docConfidence >= 50 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500";

  const handleSubmit = () => {
    if (!activeCompany) return;
    
    confirmMut.mutate({
      companyId: activeCompany.id,
      id: doc.id,
      data: {
        documentType: form.documentType as any,
        counterpartyId: form.counterpartyId || null,
        periodId: form.periodId || null,
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        dueDate: form.dueDate || null,
        createInvoice: form.createInvoice,
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
      {/* Document Preview */}
      <DocumentPreview objectPath={doc.objectPath} mimeType={doc.mimeType} />

      {/* 2-Column OCR Overview */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Left: Extracted Data Panel */}
        <Card className="shadow-none border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <FileSearch className="h-5 w-5 text-muted-foreground" />
                Prepoznani podatki
              </h3>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${confidenceColor}`}>{Math.round(docConfidence)}%</span>
                <Progress value={docConfidence} className={`h-2 w-24 bg-muted ${progressColor}`} />
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
                  <span className="text-xs font-mono text-muted-foreground">{ocr?.currency || "EUR"}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b">
                  <span className="text-muted-foreground">Neto:</span>
                  <span className="font-medium">{formatEur(ocr?.totalNet)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b">
                  <span className="text-muted-foreground">DDV:</span>
                  <span className="font-medium">{formatEur(ocr?.totalVat)}</span>
                </div>
                <div className="flex justify-between text-base py-2 font-bold">
                  <span>Bruto za plačilo:</span>
                  <span>{formatEur(ocr?.totalGross)}</span>
                </div>
              </div>
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
                      return (
                        <tr key={idx} className={`hover:bg-muted/10 ${missing ? "bg-amber-50/40" : ""}`}>
                          <td className="px-4 py-3 font-medium truncate max-w-[150px]" title={line.description}>{line.description}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatEur(line.vatBase)}</td>
                          <td className="px-4 py-3 text-right">{line.vatRate}%</td>
                          <td className="px-4 py-2">
                            <Select
                              value={line.accountId ?? ""}
                              onValueChange={v => updateLine(idx, v)}
                              disabled={isViewer}
                            >
                              <SelectTrigger
                                className={`h-8 text-xs bg-background ${missing ? "border-amber-300 text-amber-700" : ""}`}
                              >
                                <SelectValue placeholder={
                                  line.accountCode
                                    ? `${line.accountCode} — ni v planu`
                                    : "Izberite konto…"
                                } />
                              </SelectTrigger>
                              <SelectContent>
                                {accounts.map(a => (
                                  <SelectItem key={a.id} value={a.id}>
                                    <span className="font-mono mr-1">{a.code}</span> {a.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {line.suggestionSource === "history" && line.accountId && (
                              <p className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1">
                                <span>✓</span>
                                {line.suggestionCount != null && line.suggestionCount > 0
                                  ? `Na podlagi ${line.suggestionCount} preteklih ${line.suggestionCount === 1 ? "računa" : "računov"} tega dobavitelja`
                                  : "Na podlagi preteklih računov tega dobavitelja"}
                              </p>
                            )}
                            {line.suggestionSource === "pattern" && line.accountId && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Tipičen vzorec kontiranja
                              </p>
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
              <Select value={form.documentType} onValueChange={v => setForm(p => ({...p, documentType: v as typeof p.documentType}))}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
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
              <Select value={form.counterpartyId} onValueChange={v => setForm(p => ({...p, counterpartyId: v}))}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Izberite partnerja" />
                </SelectTrigger>
                <SelectContent>
                  {counterparties.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name} {c.taxId ? `(SI${c.taxId})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show hint when AI found a name but no matching counterparty */}
              {!form.counterpartyId && ocr?.counterpartyName && !isViewer && (
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
                    onClick={() => {
                      setNewPartner({
                        name: ocr.counterpartyName || "",
                        taxId: ocr.counterpartyTaxId?.replace(/^SI/, "") || "",
                        type: "supplier",
                      });
                      setShowCreatePartner(v => !v);
                    }}
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    Ustvari partnerja iz AI podatkov
                    {showCreatePartner ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
                  </Button>

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
              <Label>Datum računa</Label>
              <Input 
                type="date" 
                value={form.invoiceDate} 
                onChange={e => setForm(p => ({...p, invoiceDate: e.target.value}))} 
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
              {!form.counterpartyId && (
                <p className="text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Partner ni izbran</p>
              )}
              {!form.periodId && (
                <p className="text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Obdobje ni izbrano</p>
              )}
              {hasUnresolvedLines && (
                <p className="text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {linesWithMissingAccount.length} {linesWithMissingAccount.length === 1 ? "vrstica nima" : "vrstice nimajo"} konta</p>
              )}
            </div>
            <Button 
              size="lg" 
              onClick={handleSubmit} 
              disabled={!form.counterpartyId || !form.periodId || hasUnresolvedLines || confirmMut.isPending || isViewer}
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
