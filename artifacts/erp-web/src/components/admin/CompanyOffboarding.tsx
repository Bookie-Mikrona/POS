import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Loader2, ShieldAlert, AlertTriangle, Info, Calendar, FileText,
  CheckCircle2, History, Database, Archive, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function useApiFetch() {
  const { getToken } = useAuth();
  return useCallback(async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }, [getToken]);
}

interface PreflightBlocker {
  code: string;
  table?: string;
  reason: string;
}

interface PreflightData {
  eligible: boolean;
  readyForDeletion: boolean;
  schemaOnly: boolean;
  blockers: PreflightBlocker[];
  limitations: string[];
  tables: string[];
  metadata: {
    publicBaseTableCount: number;
    foreignKeyCount: number;
    selectedTableCount: number;
    selectedRowCount: number;
    readOnly: boolean;
    snapshotConsistent: boolean;
  };
}

interface Case {
  id: string;
  status: string;
  shared_backup_retain_until: string;
  created_at: string;
}

interface AuditEvent {
  event_type: string;
  created_at: string;
  [key: string]: any;
}

interface CaseDetailResponse {
  case: Case;
  auditEvents: AuditEvent[];
}

function CaseRow({ companyId, caseItem }: { companyId: string; caseItem: Case }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const apiFetch = useApiFetch();
  const { data: detailData, isLoading, isError } = useQuery({
    queryKey: ["admin", "offboarding", "cases", companyId, caseItem.id],
    queryFn: () => apiFetch<CaseDetailResponse>(`/api/admin/companies/${companyId}/offboarding/cases/${caseItem.id}`),
    enabled: isExpanded,
  });

  const displayCase = detailData?.case || caseItem;

  return (
    <div className="border rounded-md p-3 text-sm space-y-2 bg-muted/20">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium">Zahtevek <span className="text-xs text-muted-foreground font-mono">#{displayCase.id.slice(0, 8)}</span></p>
          <p className="text-xs text-muted-foreground mt-0.5">Odprto: {new Date(displayCase.created_at).toLocaleDateString("sl-SI")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="capitalize">{displayCase.status}</Badge>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="bg-background border rounded px-2 py-1.5 text-xs flex justify-between items-center">
        <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Hramba do:</span>
        <span className="font-medium">{new Date(displayCase.shared_backup_retain_until).toLocaleDateString("sl-SI")}</span>
      </div>
      {isExpanded && (
        <div className="pt-2 border-t mt-2">
          {isLoading && <p className="text-xs text-muted-foreground animate-pulse">Nalagam podrobnosti...</p>}
          {isError && <p className="text-xs text-destructive">Napaka pri nalaganju podrobnosti.</p>}
          {detailData?.auditEvents && detailData.auditEvents.length > 0 && (
             <div className="space-y-1 mt-2">
               <p className="text-xs font-semibold text-muted-foreground">Dogodki</p>
               <ul className="text-xs text-muted-foreground list-disc list-inside">
                 {detailData.auditEvents.map((evt, i) => (
                   <li key={i}>{evt.event_type || 'Neznan dogodek'} - {new Date(evt.created_at).toLocaleString("sl-SI")}</li>
                 ))}
               </ul>
             </div>
          )}
          {detailData?.auditEvents && detailData.auditEvents.length === 0 && (
             <p className="text-xs text-muted-foreground mt-2">Ni zabeleženih dogodkov.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CompanyOffboarding({ companyId }: { companyId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  
  const [retainDate, setRetainDate] = useState("");

  const { data: preflight, isLoading: preflightLoading, isError: preflightIsError, error: preflightError } = useQuery({
    queryKey: ["admin", "offboarding", "preflight", companyId],
    queryFn: () => apiFetch<PreflightData>(`/api/admin/companies/${companyId}/offboarding/preflight`),
    enabled: isExpanded,
  });

  const { data: casesData, isLoading: casesLoading, isError: casesIsError, error: casesError } = useQuery({
    queryKey: ["admin", "offboarding", "cases", companyId],
    queryFn: () => apiFetch<{ cases: Case[] }>(`/api/admin/companies/${companyId}/offboarding/cases`),
    enabled: isExpanded,
  });

  const createCaseMutation = useMutation({
    mutationFn: (body: { sharedBackupRetainUntil: string }) =>
      apiFetch(`/api/admin/companies/${companyId}/offboarding/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "offboarding", "cases", companyId] });
      setRetainDate("");
    }
  });

  if (!isExpanded) {
    return (
      <div className="pt-4 border-t border-border/50">
        <Button 
          variant="outline" 
          className="w-full justify-between" 
          onClick={() => setIsExpanded(true)}
          data-testid={`btn-expand-offboarding-${companyId}`}
        >
          <span className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" /> 
            Priprava na zaprtje podjetja
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  if (preflightLoading || casesLoading) {
    return (
      <div className="space-y-4 pt-4 border-t border-border/50">
        <Button 
          variant="outline" 
          className="w-full justify-between" 
          onClick={() => setIsExpanded(false)}
        >
          <span className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" /> 
            Priprava na zaprtje podjetja
          </span>
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const cases = casesData?.cases || [];
  const hasCases = cases.length > 0;

  return (
    <div className="space-y-6 pt-4 border-t border-border/50">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Priprava na zaprtje podjetja
          </h4>
          <Button variant="ghost" size="sm" onClick={() => setIsExpanded(false)}>
            <ChevronUp className="h-4 w-4 mr-1" /> Skrij
          </Button>
        </div>
        
        <Alert className="mb-6 bg-blue-50/50 text-blue-900 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-800">Omejena funkcionalnost (V pripravi)</AlertTitle>
          <AlertDescription className="text-blue-700/80">
            Prenos podatkov, prenos varnostnih kopij uporabniku, potrditev prejema in gumb za avtomatiziran trajen izbris v tej različici <strong>še niso na voljo</strong>. 
            Trenutno je omogočena le diagnostika in evidenca dogovora o hrambi podatkov (odprtje zahtevka).
          </AlertDescription>
        </Alert>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Preflight Diagnostics */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" /> Diagnostika podatkov
              </CardTitle>
              <CardDescription>Samodejni pregled stanja in primernosti za zaprtje</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {preflightIsError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Napaka pri nalaganju diagnostike: {(preflightError as Error)?.message}</AlertDescription>
                </Alert>
              ) : preflight ? (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center py-1 border-b">
                      <span className="text-muted-foreground">Način pregleda</span>
                      {preflight.schemaOnly ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Samo struktura (brez vpogleda v vsebino)</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Poln pregled podatkov</Badge>
                      )}
                    </div>
                    <div className="flex justify-between items-center py-1 border-b">
                      <span className="text-muted-foreground">Primerno za izbris</span>
                      {preflight.eligible ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="h-3 w-3 mr-1" /> Da</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20"><AlertTriangle className="h-3 w-3 mr-1" /> Ne</Badge>
                      )}
                    </div>
                  </div>

                  {preflight.blockers && preflight.blockers.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <p className="font-medium text-destructive flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Blokade zaprtja</p>
                      <ul className="list-disc list-inside pl-4 text-muted-foreground space-y-1">
                        {preflight.blockers.map((b, i) => (
                          <li key={i}>
                            {b.reason} {b.table && <span className="font-mono text-xs opacity-70">({b.table})</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preflight.limitations && preflight.limitations.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <p className="font-medium text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Omejitve in opozorila</p>
                      <ul className="list-disc list-inside pl-4 text-muted-foreground space-y-1">
                        {preflight.limitations.map((l, i) => <li key={i}>{l}</li>)}
                      </ul>
                    </div>
                  )}

                  {preflight.metadata && (
                    <div className="space-y-2 mt-4">
                      <p className="font-medium flex items-center gap-1.5"><Archive className="h-4 w-4" /> Najdeni zapisi (Pregled)</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted px-2 py-1.5 rounded flex justify-between">
                          <span className="text-muted-foreground truncate mr-2">Tabele</span>
                          <span className="font-mono font-medium shrink-0">{preflight.metadata.selectedTableCount ?? 0}</span>
                        </div>
                        <div className="bg-muted px-2 py-1.5 rounded flex justify-between">
                          <span className="text-muted-foreground truncate mr-2">Zapisi</span>
                          <span className="font-mono font-medium shrink-0">{preflight.metadata.selectedRowCount ?? 0}</span>
                        </div>
                        <div className="bg-muted px-2 py-1.5 rounded flex justify-between">
                          <span className="text-muted-foreground truncate mr-2">Blokade</span>
                          <span className="font-mono font-medium shrink-0">{preflight.blockers?.length ?? 0}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Diagnostike ni bilo mogoče naložiti.</p>
              )}
            </CardContent>
          </Card>

          {/* Cases & Workflow */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Odpri zahtevek za zaprtje
                </CardTitle>
                <CardDescription>Določite datum, do katerega se bo hranila varnostna kopija podatkov preden se trajno izbriše.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="retainDate" className="text-xs">Datum hrambe</Label>
                    <div className="flex gap-2">
                      <Input
                        id="retainDate"
                        type="date"
                        value={retainDate}
                        onChange={(e) => setRetainDate(e.target.value)}
                        className="w-full"
                        min={new Date().toISOString().split("T")[0]}
                        disabled={hasCases}
                      />
                      <Button 
                        disabled={!retainDate || createCaseMutation.isPending || (preflight && !preflight.eligible) || hasCases}
                        onClick={() => {
                          if (retainDate) {
                            createCaseMutation.mutate({ sharedBackupRetainUntil: new Date(retainDate).toISOString() });
                          }
                        }}
                      >
                        {createCaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potrdi in odpri"}
                      </Button>
                    </div>
                    {hasCases && (
                      <p className="text-xs text-amber-600 mt-1">Zahtevek je že ustvarjen.</p>
                    )}
                    {preflight && !preflight.eligible && !hasCases && (
                      <p className="text-xs text-destructive mt-1">Zahtevek ni mogoč (obstajajo blokade ali neizpolnjeni pogoji).</p>
                    )}
                  </div>
                  {createCaseMutation.isError && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        {(createCaseMutation.error as Error).message}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Zgodovina zahtevkov
                </CardTitle>
              </CardHeader>
              <CardContent>
                {casesIsError ? (
                   <Alert variant="destructive" className="py-2">
                     <AlertDescription className="text-xs">
                       Napaka pri nalaganju zahtevkov: {(casesError as Error)?.message}
                     </AlertDescription>
                   </Alert>
                ) : cases.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Ni odprtih zahtevkov za zaprtje.</p>
                ) : (
                  <div className="space-y-3">
                    {cases.map((c) => (
                      <CaseRow key={c.id} companyId={companyId} caseItem={c} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
