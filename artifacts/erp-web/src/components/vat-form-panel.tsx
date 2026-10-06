import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetVatFormPreview,
  useExportVatForm,
  type VatFormCorrection,
  type VatFormExportInput,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

export type VatFormKind = "DDV-O" | "RP-O" | "PD-O";
type Mode = "mesecno" | "trimesecno";

const TITLES: Record<VatFormKind, string> = {
  "DDV-O": "Obračun DDV (DDV-O)",
  "RP-O": "Rekapitulacija (RP-O)",
  "PD-O": "Podatki o dobavah (PD-O)",
};
const CORR_COLS: Record<VatFormKind, string[]> = {
  "DDV-O": [],
  "RP-O": ["B3", "B4", "B5", "B6", "B7"],
  "PD-O": ["B3"],
};
const MONTHS = ["Januar", "Februar", "Marec", "April", "Maj", "Junij", "Julij", "Avgust", "September", "Oktober", "November", "December"];

interface CorrRow {
  key: number;
  year: string;
  month: string;
  country: string;
  vatId: string;
  values: Record<string, string>;
}

function validateRow(r: CorrRow, cols: string[]): string | null {
  const y = Number(r.year), m = Number(r.month);
  if (!Number.isInteger(y) || y < 2020 || y > 2099) return "Leto popravka mora biti med 2020 in 2099.";
  if (!Number.isInteger(m) || m < 1 || m > 12) return "Mesec popravka mora biti med 1 in 12.";
  if (!/^[A-Za-z]{2}$/.test(r.country.trim())) return "Koda države mora imeti 2 črki.";
  if (!r.vatId.trim()) return "Vnesite identifikacijsko številko za DDV.";
  for (const c of cols) if (!/^-?\d+$/.test((r.values[c] ?? "").trim())) return `Polje ${c} mora biti celo število v EUR (nadomestna vrednost).`;
  if (cols.length > 1 && cols.some(c => Number(r.values[c]) < 0)) return "RP-O zahteva nenegativne nove skupne vrednosti, ne razlik.";
  return null;
}

export function VatFormPanel({ form }: { form: VatFormKind }) {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const isViewer = activeCompany?.role === "viewer";
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() === 0 ? 12 : now.getMonth()));
  const [quarter, setQuarter] = useState("1");
  const [ddvMode, setDdvMode] = useState<Mode | "">("");
  const [refund, setRefund] = useState(false);
  const [dp, setDp] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [rows, setRows] = useState<CorrRow[]>([]);
  const [confirmedSig, setConfirmedSig] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedInfo, setExportedInfo] = useState<string | null>(null);
  const keyRef = useRef(0);

  const mode: Mode | "" = form === "DDV-O" ? ddvMode : "mesecno";
  const yearNum = Number(year);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 2020 && yearNum <= 2099;
  const period = mode === "trimesecno" ? `07${String(Number(quarter) * 3).padStart(2, "0")}` : `07${month.padStart(2, "0")}`;
  const cols = CORR_COLS[form];
  const ready = !!companyId && yearOk && mode !== "";

  const params = { form, year: yearNum, period, periodMode: (mode || "mesecno") as Mode };
  const q = useGetVatFormPreview(companyId, params, {
    query: {
      enabled: ready,
      queryKey: ["vat-form-preview", companyId, form, yearNum, period, mode],
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      // A proxy's brief 502 must not turn a fresh source check into a stale export.
      // Retry only the read-only preview; the export mutation itself is never replayed.
      retry: (failureCount: number, error: unknown) => failureCount < 1 &&
        typeof error === "object" && error !== null && "status" in error &&
        error.status === 502,
      retryDelay: 300,
    } as any,
  });
  const preview = q.data && q.data.companyId === companyId && q.data.form === form && q.data.year === yearNum && q.data.period === period && q.data.periodMode === mode ? q.data : undefined;

  const rowErrors = rows.map((r) => validateRow(r, cols) ??
    (Number(r.year) * 12 + Number(r.month) >= yearNum * 12 + Number(month)
      ? "Popravek mora biti za pretekli koledarski mesec."
      : null));
  const corrections: VatFormCorrection[] = rows.map((r) => ({
    year: Number(r.year), month: Number(r.month), countryCode: r.country.trim().toUpperCase(), vatId: r.vatId.trim(),
    values: Object.fromEntries(cols.map((c) => [c, (r.values[c] ?? "").trim()])),
  }));
  const sig = JSON.stringify({ companyId, form, yearNum, period, mode, h: preview?.snapshotHash, refund, dp, contactName, contactPhone, corrections: form === "DDV-O" ? [] : corrections });
  const confirmed = confirmedSig === sig;
  useEffect(() => { setExportError(null); setExportedInfo(null); }, [companyId, form, yearNum, period, mode]);

  const exportMut = useExportVatForm();
  const ctxRef = useRef({ companyId, period, mode, year: yearNum });
  ctxRef.current = { companyId, period, mode, year: yearNum };

  const hasBlockingRow = rowErrors.some(Boolean);
  const canExport = !!preview?.canExport && confirmed && !isViewer && !hasBlockingRow && !exportMut.isPending && !q.isFetching;

  const doExport = async () => {
    if (!preview || !mode || !canExport) return;
    setExportError(null); setExportedInfo(null);
    const req = { companyId, year: yearNum, period, mode };
    const fresh = await q.refetch();
    if (fresh.error || !fresh.data) { setExportError("Osvežitev predogleda ni uspela. Izvoz ni bil izveden."); return; }
    if (ctxRef.current.companyId !== req.companyId || ctxRef.current.period !== req.period ||
        ctxRef.current.mode !== req.mode || ctxRef.current.year !== req.year) {
      setExportError("Podjetje ali obdobje se je med pregledom spremenilo. Izvoz ni bil izveden."); return;
    }
    if (fresh.data.snapshotHash !== preview.snapshotHash) { setConfirmedSig(null); setExportError("Podatki so se medtem spremenili. Preglejte nov predogled in znova potrdite."); return; }
    const data: VatFormExportInput = {
      form, year: yearNum, period, periodMode: mode, previewHash: preview.snapshotHash, confirmed: true,
      contactName: contactName.trim() || undefined, contactPhone: contactPhone.trim() || undefined,
      ...(form === "DDV-O" ? { refund, deductionProportion: dp } : corrections.length ? { corrections } : {}),
    };
    try {
      const res = await exportMut.mutateAsync({ companyId: req.companyId, data });
      const c = ctxRef.current;
      if (c.companyId !== req.companyId || c.period !== req.period || c.mode !== req.mode || c.year !== req.year) {
        setExportError("Podjetje ali obdobje se je med izvozom spremenilo. Datoteka ni bila prenesena."); return;
      }
      const url = URL.createObjectURL(new Blob([res.xml], { type: "application/xml" }));
      const a = document.createElement("a");
      a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportedInfo(`${res.filename} (SHA-256: ${res.sha256})`);
    } catch (e: any) {
      setExportError(e?.message || "Izvoz ni uspel.");
    }
  };

  const partnerCols = useMemo(() => {
    const s = new Set<string>();
    preview?.partners.forEach((p) => Object.keys(p.values).forEach((k) => s.add(k)));
    return Array.from(s).sort();
  }, [preview]);

  const updateRow = (key: number, patch: Partial<CorrRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => rs.length >= 200 ? rs : [...rs, { key: ++keyRef.current, year: year, month: "1", country: "", vatId: "", values: {} }]);

  if (!activeCompany) return <div className="text-center py-12 border rounded-lg bg-card text-muted-foreground">Izberite podjetje.</div>;

  const errMsg = (q.error as any)?.message as string | undefined;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{TITLES[form]}</h2>
        <p className="text-sm text-muted-foreground" data-testid={`text-company-${form}`}>Podjetje: <span className="font-medium text-foreground">{activeCompany.naziv}</span></p>
      </div>

      {isViewer && (
        <Alert data-testid={`alert-viewer-${form}`}><AlertCircle className="h-4 w-4" /><AlertTitle>Samo pregled</AlertTitle>
          <AlertDescription>Z vlogo bralca lahko predogled pregledujete, XML pa lahko izvozijo samo uporabniki z višjimi pravicami.</AlertDescription></Alert>
      )}

      <div className="flex flex-wrap gap-4 items-end bg-card p-4 rounded-lg border shadow-sm">
        <div className="space-y-1.5 w-[110px]">
          <Label className="text-xs text-muted-foreground">Leto</Label>
          <Input data-testid={`input-year-${form}`} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        {form === "DDV-O" && (
          <div className="space-y-1.5 w-[190px]">
            <Label className="text-xs text-muted-foreground">Tip obdobja</Label>
            <Select value={ddvMode} onValueChange={(v) => setDdvMode(v as Mode)}>
              <SelectTrigger data-testid="select-period-mode"><SelectValue placeholder="Izberite mesečno/kvartalno" /></SelectTrigger>
              <SelectContent><SelectItem value="mesecno">Mesečno</SelectItem><SelectItem value="trimesecno">Četrtletno</SelectItem></SelectContent>
            </Select>
          </div>
        )}
        {mode === "trimesecno" ? (
          <div className="space-y-1.5 w-[190px]">
            <Label className="text-xs text-muted-foreground">Četrtletje</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger data-testid={`select-quarter-${form}`}><SelectValue /></SelectTrigger>
              <SelectContent>{["1. četrtletje", "2. četrtletje", "3. četrtletje", "4. četrtletje"].map((l, i) => <SelectItem key={i} value={String(i + 1)}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5 w-[190px]">
            <Label className="text-xs text-muted-foreground">Mesec{form !== "DDV-O" ? " (vedno mesečno)" : ""}</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger data-testid={`select-month-${form}`}><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((l, i) => <SelectItem key={i} value={String(i + 1)}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <Button variant="outline" onClick={() => q.refetch()} disabled={!ready || q.isFetching} data-testid={`button-refresh-${form}`}>
          <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />Osveži predogled
        </Button>
      </div>

      {!yearOk && <p className="text-sm text-destructive">Leto mora biti med 2020 in 2099.</p>}
      {form === "DDV-O" && !ddvMode && <div className="text-center py-10 border rounded-lg bg-card text-muted-foreground">Izberite mesečno ali četrtletno obdobje za prikaz predogleda.</div>}

      {ready && q.isLoading && <Skeleton className="h-[320px] w-full" />}
      {ready && q.error && (
        <Alert variant="destructive" data-testid={`alert-error-${form}`}><AlertCircle className="h-4 w-4" /><AlertTitle>Predogleda ni mogoče naložiti</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4"><span>{errMsg || "Napaka pri nalaganju."}</span>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>Poskusi znova</Button></AlertDescription></Alert>
      )}

      {ready && preview && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">Obdobje: {preview.periodFrom} do {preview.periodTo}</Badge>
            <Badge variant="outline">Vrstic: {preview.rowCount}</Badge>
            <Badge variant={preview.canExport ? "secondary" : "destructive"}>{preview.canExport ? "Izvoz mogoč" : "Izvoz blokiran"}</Badge>
            <span className="text-xs text-muted-foreground font-mono">Posnetek: {preview.snapshotHash.slice(0, 12)}</span>
          </div>
          {preview.notice && <Alert><AlertDescription data-testid={`text-notice-${form}`}>{preview.notice}</AlertDescription></Alert>}

          {preview.issues.length > 0 && (
            <div className="border rounded-lg bg-card divide-y" data-testid={`list-issues-${form}`}>
              {preview.issues.map((i, n) => (
                <div key={n} className="flex items-start gap-3 p-3 text-sm">
                  <Badge variant={i.severity === "ERROR" ? "destructive" : "outline"}>{i.severity === "ERROR" ? "Napaka" : "Opozorilo"}</Badge>
                  <span className="flex-1">{i.message}</span>
                  {i.documentNo && <span className="font-mono text-xs text-muted-foreground">{i.documentNo}</span>}
                </div>
              ))}
            </div>
          )}

          {preview.fields.length > 0 && (
            <div className="border rounded-lg bg-card overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead className="w-24">Polje</TableHead><TableHead>Opis</TableHead><TableHead className="text-right">Vrednost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {preview.fields.map((f) => (
                    <TableRow key={f.code}><TableCell className="font-mono text-xs">{f.code}</TableCell><TableCell>{f.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.value}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {preview.partners.length > 0 && (
            <div className="border rounded-lg bg-card overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Država</TableHead><TableHead>ID za DDV</TableHead><TableHead>Partner</TableHead>
                  {partnerCols.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {preview.partners.map((p, n) => (
                    <TableRow key={`${p.countryCode}${p.vatId}${n}`}><TableCell>{p.countryCode}</TableCell><TableCell className="font-mono text-xs">{p.vatId}</TableCell><TableCell>{p.name}</TableCell>
                      {partnerCols.map((c) => <TableCell key={c} className="text-right tabular-nums">{p.values[c] ?? ""}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {preview.fields.length === 0 && preview.partners.length === 0 && <div className="text-center py-8 border rounded-lg bg-card text-muted-foreground">Za izbrano obdobje ni podatkov.</div>}

          <div className="border rounded-lg bg-card p-4 space-y-4">
            <h3 className="font-medium">Podatki za izvoz</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Kontaktna oseba</Label>
                <Input data-testid={`input-contact-name-${form}`} value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={isViewer} /></div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Telefon</Label>
                <Input data-testid={`input-contact-phone-${form}`} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={isViewer} /></div>
            </div>
            {form === "DDV-O" && (
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} disabled={isViewer} data-testid="check-refund" />Zahtevam vračilo presežka DDV</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dp} onChange={(e) => setDp(e.target.checked)} disabled={isViewer} data-testid="check-deduction-proportion" />Uporabljen je odbitni delež (odbdelež)</label>
              </div>
            )}

            {form !== "DDV-O" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium">Popravki prejšnjih obdobij (neobvezno)</h4>
                    <p className="text-xs text-muted-foreground">Vnesite nadomestne skupne zneske v celih EUR, ne razlike. Popravki, ki jih knjige ne podpirajo, bodo zavrnjeni na strežniku.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={addRow} disabled={isViewer || rows.length >= 200} data-testid={`button-add-correction-${form}`}><Plus className="mr-1 h-4 w-4" />Dodaj</Button>
                </div>
                {rows.map((r, idx) => (
                  <div key={r.key} className="border rounded-md p-3 space-y-2" data-testid={`row-correction-${idx}`}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Input placeholder="Leto" value={r.year} onChange={(e) => updateRow(r.key, { year: e.target.value })} disabled={isViewer} />
                      <Input placeholder="Mesec (1-12)" value={r.month} onChange={(e) => updateRow(r.key, { month: e.target.value })} disabled={isViewer} />
                      <Input placeholder="Država (SI)" maxLength={2} value={r.country} onChange={(e) => updateRow(r.key, { country: e.target.value })} disabled={isViewer} />
                      <Input placeholder="ID za DDV" value={r.vatId} onChange={(e) => updateRow(r.key, { vatId: e.target.value })} disabled={isViewer} />
                    </div>
                    <div className="flex flex-wrap gap-2 items-end">
                      {cols.map((c) => (
                        <div key={c} className="w-24 space-y-1"><Label className="text-xs text-muted-foreground">{c} (EUR)</Label>
                          <Input value={r.values[c] ?? ""} onChange={(e) => updateRow(r.key, { values: { ...r.values, [c]: e.target.value } })} disabled={isViewer} /></div>
                      ))}
                      <Button size="icon" variant="ghost" className="ml-auto" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={isViewer} aria-label="Odstrani popravek"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    {rowErrors[idx] && <p className="text-xs text-destructive">{rowErrors[idx]}</p>}
                  </div>
                ))}
              </div>
            )}

            <label className="flex items-start gap-2 text-sm border-t pt-4">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmedSig(e.target.checked ? sig : null)} disabled={isViewer || !preview.canExport || hasBlockingRow} data-testid={`check-confirm-${form}`} />
              <span>Pregledal(a) sem predogled, izbrane možnosti, kontaktne podatke{form !== "DDV-O" ? " in popravke" : ""} ter potrjujem izvoz XML. Potrditev velja samo za ta posnetek podatkov.</span>
            </label>

            {exportError && <Alert variant="destructive" data-testid={`alert-export-error-${form}`}><AlertCircle className="h-4 w-4" /><AlertDescription>{exportError}</AlertDescription></Alert>}
            {exportedInfo && <Alert data-testid={`alert-exported-${form}`}><AlertDescription>Datoteka je prenesena: {exportedInfo}. To je samo izvoz za nalaganje v eDavke; ne pomeni, da je obrazec oddan.</AlertDescription></Alert>}

            <div className="flex items-center gap-3">
              <Button onClick={doExport} disabled={!canExport} data-testid={`button-export-${form}`}>
                {exportMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Prenesi XML
              </Button>
              <span className="text-xs text-muted-foreground">Izvoz ni oddaja obrazca davčnemu organu.</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
