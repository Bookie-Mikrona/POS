import { formatDatum, formatCasovniZig } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2, RefreshCw, Upload } from "lucide-react";
import {
  useGetAjpesAnnualHistory,
  useRequestAjpesEvidenceUpload,
  useRecordAjpesSubmission,
  getGetAjpesAnnualHistoryQueryKey,
  getDownloadAjpesAnnualArchiveUrl,
  getDownloadAjpesSubmissionEvidenceUrl,
  customFetch,
  type AjpesAnnualExport,
  type AjpesSubmission,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { errMsg } from "./ajpes-annual-report-model";

const PAGE = 50;
const MAX_BYTES = 10 * 1024 * 1024;
const MIMES = ["application/pdf", "image/png", "image/jpeg"] as const;
type Mime = (typeof MIMES)[number];
type Outcome = "submitted" | "accepted" | "rejected";
export const ATTEST_TEXT = "Potrjujem, da dokazilo velja za izbrani izvoz in da je rezultat dejansko naveden na dokazilu.";
const PURPOSE: Record<string, string> = { review: "Pregled (ni za oddajo)", statistics: "Statistika", publication: "Objava", combined: "Statistika in objava" };
const OUTCOME: Record<string, string> = { submitted: "Oddano (ročno)", accepted: "Sprejeto (po dokazilu)", rejected: "Zavrnjeno (po dokazilu)" };
const fmtDT = formatCasovniZig;
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(n / 1024))} KiB`);

export const historyPrefix = (companyId: string, year: number) => `/api/companies/${companyId}/reports/ajpes/${year}/history`;

async function saveBlob(url: string, fallback: string) {
  const blob = await customFetch<Blob>(url, { method: "GET", responseType: "blob" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = fallback; a.click(); URL.revokeObjectURL(u);
}

export function AjpesAnnualHistoryTab({ companyId, year, viewer, dirty }: { companyId: string; year: number; viewer: boolean; dirty?: boolean }) {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const q = useGetAjpesAnnualHistory(companyId, year, params, {
    query: { queryKey: getGetAjpesAnnualHistoryQueryKey(companyId, year, params), staleTime: 0, refetchOnMount: "always" },
  });
  const h = q.data;
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);

  const expById = useMemo(() => new Map((h?.exports ?? []).map((e) => [e.id, e])), [h]);
  const superseded = useMemo(() => new Set((h?.submissions ?? []).map((s) => s.supersedesId).filter(Boolean) as string[]), [h]);

  async function dl(kind: "e" | "s", id: string, name: string) {
    setDlBusy(id); setDlErr(null);
    try {
      await saveBlob(kind === "e" ? getDownloadAjpesAnnualArchiveUrl(companyId, year, id) : getDownloadAjpesSubmissionEvidenceUrl(companyId, year, id), name);
    } catch (e) { setDlErr(`Prenos ni uspel: ${errMsg(e)}`); } finally { setDlBusy(null); }
  }

  if (q.isLoading) return <div className="space-y-2" data-testid="history-loading"><Skeleton className="h-8 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError || !h) {
    return (
      <div role="alert" data-testid="history-error" className="rounded-md border border-destructive/40 p-5 space-y-3">
        <p className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-destructive" />Zgodovine izvozov ni bilo mogoče naložiti: {errMsg(q.error)}</p>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Poskusi znova</Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-hidden">
      <p className="text-xs text-muted-foreground" data-testid="history-disclaimer">
        Arhiv hrani nespremenljive izvirne datoteke izvozov. Dokazila o oddaji se vnašajo ročno; Bookie ne oddaja pri AJPES, stanja ne preverja pri AJPES in ne preverja digitalnega podpisa. Dokazilo ne spreminja nastavitev poročila.
      </p>
      {dirty && <p className="text-xs text-amber-700 dark:text-amber-400">Osnutek poročila ima neshranjene spremembe; ostanejo ohranjene med ogledom arhiva.</p>}
      {dlErr && <p role="alert" className="text-sm text-destructive">{dlErr}</p>}

      <section className="space-y-2" aria-label="Arhiv izvozov">
        <h2 className="text-sm font-semibold">Arhiv izvozov</h2>
        {h.exports.length === 0 ? (
          <div data-testid="history-empty-exports" className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Za leto {year} še ni arhiviranih izvozov. Izvoz v zavihku Izvoz se po uspehu shrani tu.</div>
        ) : (
          <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border">
            <table>
              <thead><tr><th>Datum</th><th>Datoteka</th><th>Namen</th><th>Revizija</th><th>Vsebina</th><th>SHA-256</th><th /></tr></thead>
              <tbody>
                {h.exports.map((e) => {
                  const cur = e.fingerprint === h.currentFingerprint;
                  return (
                    <tr key={e.id} data-testid={`row-export-${e.id}`}>
                      <td className="whitespace-nowrap">{fmtDT(e.createdAt)}<div className="text-xs text-muted-foreground">{e.createdBy}</div></td>
                      <td>{e.filename}<div className="text-xs text-muted-foreground">{e.format.toUpperCase()} · {fmtSize(e.byteSize)}</div>
                        <div className="text-xs text-muted-foreground max-w-xs truncate" title={e.rulesVersion}>Pravila: {e.rulesVersion}</div>
                      </td>
                      <td>{PURPOSE[e.purpose] ?? e.purpose}{e.publicationReviewed && <div className="text-xs text-muted-foreground">besedila potrjena</div>}</td>
                      <td>{e.revision}</td>
                      <td>
                        <Badge variant={cur ? "default" : "secondary"} title={e.fingerprint} data-testid={`badge-export-fp-${e.id}`}>{cur ? "Trenutno poročilo" : "Starejša revizija"}</Badge>
                      </td>
                      <td className="font-mono text-xs" title={e.sha256}>{e.sha256.slice(0, 12)}</td>
                      <td className="text-right">
                        <Button size="sm" variant="outline" data-testid={`button-download-export-${e.id}`} disabled={dlBusy !== null} onClick={() => dl("e", e.id, e.filename)}>
                          {dlBusy === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}<span className="ml-1.5">Izvirnik</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-label="Dokazila o oddaji">
        <h2 className="text-sm font-semibold">Ročno vnesena dokazila o oddaji</h2>
        {h.submissions.length === 0 ? (
          <div data-testid="history-empty-submissions" className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Dokazil še ni. Vnos je dnevnik ročnih zapisov, ne potrditev AJPES.</div>
        ) : (
          <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border">
            <table>
              <thead><tr><th>Vnos</th><th>Izvoz</th><th>Izid po dokazilu</th><th>Datum oddaje</th><th>Sklic</th><th>Stanje</th><th /></tr></thead>
              <tbody>
                {h.submissions.map((s) => {
                  const ex = expById.get(s.exportId);
                  const cur = ex ? ex.fingerprint === h.currentFingerprint : null;
                  return (
                    <tr key={s.id} data-testid={`row-submission-${s.id}`}>
                      <td className="whitespace-nowrap">{fmtDT(s.recordedAt)}<div className="text-xs text-muted-foreground">{s.recordedBy}</div></td>
                      <td>{ex ? ex.filename : <span className="text-muted-foreground">Izvoz na drugi strani</span>}</td>
                      <td>{OUTCOME[s.outcome]}{s.note && <div className="text-xs text-muted-foreground max-w-xs truncate" title={s.note}>{s.note}</div>}</td>
                      <td>{formatDatum(s.submittedOn)}</td>
                      <td>{s.reference}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {cur === null ? <Badge variant="secondary">Izvoz ni na tej strani</Badge> : <Badge variant={cur ? "default" : "secondary"} data-testid={`badge-sub-fp-${s.id}`}>{cur ? "Velja za trenutno poročilo" : "Velja za starejšo revizijo"}</Badge>}
                          {superseded.has(s.id) && <Badge variant="outline">Nadomeščen</Badge>}
                          {s.supersedesId && <Badge variant="outline">Popravek</Badge>}
                        </div>
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="outline" data-testid={`button-download-receipt-${s.id}`} disabled={dlBusy !== null} onClick={() => dl("s", s.id, s.filename)}>
                          {dlBusy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}<span className="ml-1.5">Dokazilo</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" data-testid="button-history-prev" disabled={offset === 0 || q.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prejšnja</Button>
        <Button size="sm" variant="outline" data-testid="button-history-next" disabled={h.nextOffset === null || q.isFetching} onClick={() => h.nextOffset !== null && setOffset(h.nextOffset)}>Naslednja</Button>
        <span className="text-xs text-muted-foreground">Zapisi {offset + 1}+ (po {PAGE} na stran)</span>
      </div>

      {viewer ? (
        <p data-testid="history-viewer-note" className="text-xs text-muted-foreground">Način samo za branje: pregled in prenos sta mogoča, vnos dokazil ne.</p>
      ) : (
        <EvidenceForm
          key={`${companyId}:${year}`}
          companyId={companyId} year={year}
          currentFingerprint={h.currentFingerprint} exports={h.exports} submissions={h.submissions} superseded={superseded}
          onRecorded={async () => { setOffset(0); await qc.invalidateQueries({ queryKey: [historyPrefix(companyId, year)] }); }}
        />
      )}
    </div>
  );
}

function EvidenceForm({ companyId, year, currentFingerprint, exports, submissions, superseded, onRecorded }: {
  companyId: string; year: number; currentFingerprint: string; exports: AjpesAnnualExport[]; submissions: AjpesSubmission[]; superseded: Set<string>; onRecorded: () => Promise<void>;
}) {
  const reserve = useRequestAjpesEvidenceUpload();
  const record = useRecordAjpesSubmission();
  const eligible = exports.filter((e) => e.purpose !== "review");
  const [exportId, setExportId] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("submitted");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [supersedesId, setSupersedesId] = useState("");
  const [attested, setAttested] = useState(false);
  const [frozen, setFrozen] = useState<{ uploadId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setAttested(false); setFrozen(null); setMsg(null); };
  const prev = submissions.filter((s) => s.exportId === exportId && !superseded.has(s.id));
  useEffect(() => { if (supersedesId && !prev.some((p) => p.id === supersedesId)) { setSupersedesId(""); setAttested(false); setFrozen(null); } }, [exportId, supersedesId, prev]);

  const fileErr = file && (!MIMES.includes(file.type as Mime) ? "Dovoljeni so PDF, PNG in JPEG." : file.size > MAX_BYTES ? "Datoteka je večja od 10 MiB." : file.size < 1 ? "Datoteka je prazna." : null);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const ready = !!exportId && !!file && !fileErr && dateOk && reference.trim().length > 0 && (outcome !== "rejected" || note.trim().length > 0) && attested;
  const [fileInputKey, setFileInputKey] = useState(0);

  async function submit() {
    if (!ready || !file) return;
    setBusy(true); setMsg(null);
    try {
      let uploadId = frozen ? frozen.uploadId : null;
      if (!uploadId) {
        const r = await reserve.mutateAsync({ companyId, year, data: { exportId, filename: file.name.slice(0, 180), mime: file.type as Mime, byteSize: file.size } });
        const put = await fetch(r.uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error(`Nalaganje datoteke ni uspelo (HTTP ${put.status}).`);
        uploadId = r.id;
        setFrozen({ uploadId });
      }
      await record.mutateAsync({ companyId, year, data: { uploadId, outcome, submittedOn: date, reference: reference.trim(), note, attested: true, supersedesId: supersedesId || null } });
      setFrozen(null); setAttested(false); setFile(null); setFileInputKey((k) => k + 1); setExportId(""); setReference(""); setNote(""); setDate(""); setSupersedesId(""); setOutcome("submitted");
      await onRecorded();
      setMsg({ kind: "ok", text: "Dokazilo je shranjeno v arhiv. Zapis je dodan in ga ni mogoče spremeniti ali izbrisati." });
    } catch (e) {
      if ((e as { status?: number })?.status === 410) setFrozen(null);
      setMsg({ kind: "err", text: `${errMsg(e)}${frozen ? " Datoteka je že naložena; ponovni poskus je brez novega nalaganja." : ""}` });
    } finally { setBusy(false); }
  }
 

  return (
    <section className="rounded-md border p-4 space-y-3" aria-label="Nov vnos dokazila" data-testid="evidence-form">
      <h2 className="text-sm font-semibold">Nov ročni vnos dokazila</h2>
      {eligible.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-eligible">Ni izvoza, za katerega bi lahko vnesli dokazilo. Izvozi z namenom Pregled niso predmet oddaje.</p>
      ) : (
        <fieldset disabled={busy} data-testid="evidence-fields" className="grid gap-3 md:grid-cols-2 min-w-0 border-0 p-0 m-0 [&>label]:min-w-0 [&_select]:min-w-0 [&_select]:max-w-full">
          <label className="text-xs space-y-1 md:col-span-2">Izvoz
            <select data-testid="select-export" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={exportId} onChange={(e) => edit(setExportId)(e.target.value)}>
              <option value="">Izberite izvoz</option>
              {eligible.map((e) => <option key={e.id} value={e.id}>{fmtDT(e.createdAt)} · {e.filename} · rev. {e.revision} · {PURPOSE[e.purpose]} · {e.sha256.slice(0, 8)} · {e.fingerprint === currentFingerprint ? "trenutno" : "starejše"}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1">Izid po dokazilu
            <select data-testid="select-outcome" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={outcome} onChange={(e) => edit(setOutcome)(e.target.value as Outcome)}>
              {Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1">Datum oddaje
            <Input data-testid="input-date" type="date" value={date} onChange={(e) => edit(setDate)(e.target.value)} />
          </label>
          <label className="text-xs space-y-1">Sklic (največ 250 znakov)
            <Input data-testid="input-reference" maxLength={250} value={reference} onChange={(e) => edit(setReference)(e.target.value)} />
          </label>
          <label className="text-xs space-y-1">Dokazilo (PDF, PNG, JPEG, do 10 MiB)
            <Input key={fileInputKey} data-testid="input-file" type="file" accept={MIMES.join(",")} onChange={(e) => edit(setFile)(e.target.files?.[0] ?? null)} />
            {fileErr && <span role="alert" className="text-destructive">{fileErr}</span>}
          </label>
          <label className="text-xs space-y-1 md:col-span-2">Opomba{outcome === "rejected" ? " (obvezen razlog zavrnitve)" : ""}
            <textarea data-testid="input-note" maxLength={4000} className="w-full rounded-md border bg-background p-2 text-sm min-h-16" value={note} onChange={(e) => edit(setNote)(e.target.value)} />
          </label>
          {prev.length > 0 && (
            <label className="text-xs space-y-1 md:col-span-2">Nadomesti prejšnji vpis
              <select data-testid="select-supersedes" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={supersedesId} onChange={(e) => edit(setSupersedesId)(e.target.value)}>
                <option value="">Ne nadomešča</option>
                {prev.map((p) => <option key={p.id} value={p.id}>{formatDatum(p.submittedOn)} · {OUTCOME[p.outcome]} · {p.reference}</option>)}
              </select>
              <span className="text-muted-foreground">Prejšnji vpis ostane v arhivu; popravek je nov zapis.</span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input data-testid="check-attest" type="checkbox" className="mt-1" checked={attested} onChange={(e) => { setAttested(e.target.checked); setMsg(null); }} />
            <span>{ATTEST_TEXT}</span>
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <Button data-testid="button-record" disabled={!ready || busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}{frozen ? "Ponovi shranjevanje vnosa" : "Shrani dokazilo"}
            </Button>
            {frozen && <span className="text-xs text-muted-foreground">Datoteka je že naložena.</span>}
          </div>
        </fieldset>
      )}
      {msg && <p role="status" data-testid="evidence-msg" className={`text-sm ${msg.kind === "err" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>{msg.text}</p>}
    </section>
  );
}
