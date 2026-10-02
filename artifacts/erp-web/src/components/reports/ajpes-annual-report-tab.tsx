import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, Save } from "lucide-react";
import {
  useGetAjpesAnnualReport,
  useSaveAjpesAnnualReport,
  getGetAjpesAnnualReportQueryKey,
  type AjpesAnnualReport,
  type AjpesAnnualSettings,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrepEditor, ManualGrid } from "./ajpes-annual-report-editor";
import { Statement, Explanation } from "./ajpes-annual-report-preview";
import { cleanSettings, defaultAjpesYear, emptyAjpesSettings, errMsg, invalidInputs } from "./ajpes-annual-report-model";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AjpesAnnualReportTab() {
  const { activeCompany } = useCompany();
  const [year, setYear] = useState(defaultAjpesYear());
  const [yearText, setYearText] = useState(String(year));
  if (!activeCompany) {
    return <div className="rounded-md border p-6 text-sm text-muted-foreground">Izberite podjetje za pripravo letnega poročila.</div>;
  }
  const yearOk = /^\d{4}$/.test(yearText) && Number(yearText) >= 2000 && Number(yearText) <= 2100;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ajpes-year" className="text-xs text-muted-foreground block mb-1">Poslovno leto</label>
          <Input
            id="ajpes-year" className="w-28" inputMode="numeric" value={yearText}
            onChange={(e) => { setYearText(e.target.value); const n = Number(e.target.value); if (/^\d{4}$/.test(e.target.value) && n >= 2000 && n <= 2100) setYear(n); }}
            aria-invalid={!yearOk}
          />
        </div>
        {!yearOk && <p className="text-xs text-destructive pb-2">Leto mora biti med 2000 in 2100.</p>}
        <p className="text-xs text-muted-foreground pb-2">Izvoz XML je trenutno mogoč samo za leto 2025; XLSX in PDF sta na voljo za vsako leto.</p>
      </div>
      <AnnualInner key={`${activeCompany.id}:${year}`} companyId={activeCompany.id} year={year} yearValid={yearOk} viewer={(activeCompany.role as string) === "viewer"} />
    </div>
  );
}

function AnnualInner({ companyId, year, yearValid, viewer }: { companyId: string; year: number; yearValid: boolean; viewer: boolean }) {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const queryKey = getGetAjpesAnnualReportQueryKey(companyId, year);
  const q = useGetAjpesAnnualReport(companyId, year, { query: { queryKey, staleTime: 0 } });
  const save = useSaveAjpesAnnualReport();
  const report: AjpesAnnualReport | undefined = q.data;
  const [draft, setDraft] = useState<AjpesAnnualSettings>(emptyAjpesSettings);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const lastFp = useRef<string | null>(null);

  useEffect(() => {
    if (!report) return;
    if (!dirty) setDraft(report.settings);
    if (lastFp.current && lastFp.current !== report.sourceFingerprint && !report.reviewed) setStaleNotice(true);
    lastFp.current = report.sourceFingerprint;
  }, [report, dirty]);

  const patch = (fn: (s: AjpesAnnualSettings) => AjpesAnnualSettings) => { setDraft(fn); setDirty(true); setMsg(null); };
  const blocking = (report?.issues ?? []).filter((i) => i.blocking);
  const invalidKeys = useMemo(() => invalidInputs(draft), [draft]);
  const missingReg = !report?.company.registrationNumber?.trim();

  async function doSave(review: boolean) {
    if (!report || viewer || !yearValid) return;
    if (invalidKeys.length) { setMsg({ kind: "err", text: "Popravite neveljavne vnose (številke ali razlogi za ignoriranje)." }); return; }
    setBusy(review ? "review" : "save"); setMsg(null);
    try {
      const saved = await save.mutateAsync({ companyId, year, data: { revision: report.revision, settings: cleanSettings(draft), reviewedFingerprint: null } });
      let final = saved as AjpesAnnualReport;
      if (review) {
        if (final.issues.some((i) => i.blocking)) throw new Error("Poročila ni mogoče potrditi: obstajajo blokirajoče opozorilo.");
        final = (await save.mutateAsync({ companyId, year, data: { revision: final.revision, settings: final.settings, reviewedFingerprint: final.sourceFingerprint } })) as AjpesAnnualReport;
      }
      qc.setQueryData(queryKey, final);
      setDraft(final.settings); setDirty(false); setStaleNotice(false);
      setMsg({ kind: "ok", text: review ? "Poročilo je shranjeno in potrjeno." : "Osnutek shranjen. Pred izvozom je potreben ponoven pregled." });
    } catch (e) {
      setMsg({ kind: "err", text: errMsg(e) });
      if ((e as { status?: number })?.status === 409) { setDirty(false); await q.refetch(); }
    } finally { setBusy(null); }
  }

  async function doExport(format: "xlsx" | "pdf" | "xml") {
    if (!report || !yearValid) return;
    setBusy(format); setMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/companies/${companyId}/reports/ajpes/${year}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-Id": companyId },
        body: JSON.stringify({ format, sourceFingerprint: report.sourceFingerprint }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        const text = (b as { error?: string; message?: string }).error ?? (b as { message?: string }).message ?? `HTTP ${res.status}`;
        if (res.status === 409) {
          setDirty(false); setStaleNotice(true);
          await qc.invalidateQueries({ queryKey });
          setMsg({ kind: "err", text: `Podatki so se spremenili. Pregled je razveljavljen; ponovno preglejte poročilo. (${text})` });
        } else setMsg({ kind: "err", text: res.status === 422 ? `Izvoz ni dovoljen: ${text}` : text });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
      let name = `ajpes-${year}.${format}`;
      if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
      setMsg({ kind: "ok", text: `Preneseno: ${name}` });
    } catch (e) { setMsg({ kind: "err", text: errMsg(e) }); } finally { setBusy(null); }
  }

  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !report) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 p-5 space-y-3">
        <p className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-destructive" />Poročila ni bilo mogoče naložiti: {errMsg(q.error)}</p>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Poskusi znova</Button>
      </div>
    );
  }

  const exportBlocked = !yearValid || dirty || !report.canExport || missingReg;
  const xmlBlocked = !yearValid || dirty || !report.canExportXml || missingReg;
  const xmlNote = !report.supportedXmlYears.includes(year) ? `XML je podprt samo za leto ${report.supportedXmlYears.join(", ")}.` : null;

  return (
    <div className="space-y-4">
      {staleNotice && (
        <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
          Knjižbe v glavni knjigi so se spremenile od zadnjega pregleda. Poročilo je treba ponovno pregledati in potrditi.
        </div>
      )}
      {missingReg && (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">Manjka matična številka podjetja. Dopolnite jo v nastavitvah podjetja, sicer končnega poročila ni mogoče izvoziti.</p>
      )}
      {report.issues.length > 0 && (
        <section aria-label="Usklajevanje" className="rounded-md border p-3 space-y-1.5">
          <h2 className="text-sm font-semibold">Usklajevanje in opozorila</h2>
          {report.issues.map((i, k) => (
            <div key={`${i.code}-${k}`} className={`text-sm flex gap-2 ${i.blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>{i.blocking && <Badge variant="destructive" className="mr-2">Blokira</Badge>}{i.message}</div>
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={report.reviewed && !dirty ? "default" : "secondary"}>
          {dirty ? "Neshranjene spremembe" : report.reviewed ? "Pregledano" : "Ni pregledano"}
        </Badge>
        <span className="text-xs text-muted-foreground">Revizija {report.revision}</span>
        {viewer && <span className="text-xs text-muted-foreground">Način samo za branje</span>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={!yearValid || viewer || !dirty || busy !== null} onClick={() => doSave(false)}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}Shrani osnutek
          </Button>
          <Button size="sm" disabled={!yearValid || viewer || busy !== null || (!dirty && blocking.length > 0) || (!dirty && report.reviewed)} onClick={() => doSave(true)}>
            {busy === "review" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}Shrani in potrdi pregled
          </Button>
        </div>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.kind === "err" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>{msg.text}</p>}

      <Tabs defaultValue="prep" className="space-y-4">
        <TabsList>
          <TabsTrigger value="prep">Priprava</TabsTrigger>
          <TabsTrigger value="manual">Ročni vnos AOP</TabsTrigger>
          <TabsTrigger value="preview">Predogled</TabsTrigger>
          <TabsTrigger value="export">Izvoz</TabsTrigger>
        </TabsList>

        <TabsContent value="prep" className="mt-0 space-y-6">
          <PrepEditor report={report} draft={draft} viewer={viewer} year={year} patch={patch} />
        </TabsContent>

        <TabsContent value="manual" className="mt-0">
          <ManualGrid report={report} draft={draft} viewer={viewer} year={year} patch={patch} />
        </TabsContent>

        <TabsContent value="preview" className="mt-0 space-y-6">
          <Statement title="Bilanca stanja" rows={report.balanceSheet} year={year} />
          <Statement title="Izkaz poslovnega izida" rows={report.incomeStatement} year={year} />
          <Explanation report={report} />
        </TabsContent>

        <TabsContent value="export" className="mt-0 space-y-3">
          {dirty && <p className="text-sm text-amber-700 dark:text-amber-400">Neshranjene spremembe. Shranite in potrdite pregled pred izvozom.</p>}
          {!dirty && !report.reviewed && <p className="text-sm text-muted-foreground">Poročilo še ni pregledano.</p>}
          {blocking.length > 0 && <p className="text-sm text-destructive">Izvoz blokirajo opozorila zgoraj.</p>}
          <div className="flex flex-wrap gap-2">
            {(["xlsx", "pdf"] as const).map((f) => (
              <Button key={f} variant="outline" disabled={exportBlocked || busy !== null} onClick={() => doExport(f)}>
                {busy === f ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}{f.toUpperCase()}
              </Button>
            ))}
            <Button variant="outline" disabled={xmlBlocked || busy !== null} onClick={() => doExport("xml")}>
              {busy === "xml" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}XML (AJPES)
            </Button>
          </div>
          {xmlNote && <p className="text-xs text-muted-foreground">{xmlNote}</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

