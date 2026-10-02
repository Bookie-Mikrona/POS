import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, FileDown, Link2 } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetPartnerLedger, useListCounterparties, useListAccounts,
  getPartnerLedgerPdf,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DetailDialog, SettleDialog, errMsg } from "@/components/partner-ledger-dialogs";
import { downloadBlob, fmt, fmtDate, today } from "@/lib/partner-ledger-utils";
import { PartnerLedgerPartnerSelect } from "@/components/partner-ledger-partner-select";
import "./kartica-partnerja.css";

type Line = any;
const DOC_LABELS: Record<string, string> = { issued: "Izdani račun", received: "Prejeti račun", issued_invoice: "Izdani račun", received_invoice: "Prejeti račun", payment: "Plačilo", bank_statement: "Bančni izpisek", manual: "Ročni vnos" };
const docLabel = (t?: string | null) => (t ? DOC_LABELS[t] ?? t : "-");
export default function KarticaPartnerja() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const canEdit = activeCompany?.role !== "viewer";
  const params0 = new URLSearchParams(window.location.search);

  const [partnerId, setPartnerId] = useState(params0.get("partnerId") ?? "all");
  const [accountId, setAccountId] = useState(params0.get("accountId") ?? "all");
  const [dateFrom, setDateFrom] = useState(params0.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(params0.get("dateTo") ?? today());
  const [openOnly, setOpenOnly] = useState(false);
  const [mode, setMode] = useState<"posted" | "drafts">("posted");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Line | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const filterCompany = useRef(companyId);

  useEffect(() => {
    if (filterCompany.current && filterCompany.current !== companyId) {
      setPartnerId("all"); setAccountId("all"); setAppliedKey(null);
    }
    filterCompany.current = companyId;
  }, [companyId]);

  const { data: cps } = useListCounterparties(companyId, {}, { query: { enabled: !!companyId } as any });
  const { data: accs } = useListAccounts(companyId, {} as any, { query: { enabled: !!companyId } as any });
  const saldakontoAccounts = (accs?.accounts ?? []).filter(account =>
    account.isOpenItem && account.allowsPosting !== false && account.isActive !== false);
  const validAccount = saldakontoAccounts.some(account => account.id === accountId);

  const params = {
    partnerId: partnerId !== "all" ? partnerId : "",
    accountId: accountId !== "all" ? accountId : "",
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, openOnly, mode,
  };
  const filterKey = JSON.stringify([companyId, params]);
  const filtersReady = !!companyId && partnerId !== "all" && validAccount && !!dateTo && (!dateFrom || dateFrom <= dateTo);
  const showReport = filtersReady && appliedKey === filterKey;
  const ledger = useGetPartnerLedger(companyId, params, {
    query: { enabled: showReport, retry: false, refetchOnWindowFocus: false } as any,
  });
  const data = showReport ? ledger.data as any : undefined;
  const lines: Line[] = data?.lines ?? [];
  const displayLines = useMemo(() => [...lines].reverse(), [lines]);
  const isDraft = mode === "drafts";

  const totals = useMemo(() => {
    let d = 0, c = 0, od = 0, oc = 0;
    for (const l of lines) { d += Number(l.debit); c += Number(l.credit); od += Number(l.openDebit); oc += Number(l.openCredit); }
    return { d, c, od, oc };
  }, [lines]);
  const lastBalance = data?.closingBalance;
  const selLines = lines.filter(l => selected.includes(l.lineId));

  useEffect(() => {
    setSelected([]); setDetail(null); setSettleOpen(false); setStatus(null);
  }, [filterKey]);

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    if (!filtersReady) return;
    if (showReport) void ledger.refetch();
    else setAppliedKey(filterKey);
  }

  function showAllEntries() {
    if (!filtersReady) return;
    setOpenOnly(false);
    setAppliedKey(JSON.stringify([companyId, { ...params, openOnly: false }]));
  }

  async function reload() { if (showReport) await ledger.refetch(); }

  async function downloadPdf() {
    if (!showReport || !data) return;
    setPdfBusy(true); setStatus(null);
    try {
      const blob = await getPartnerLedgerPdf(companyId, params as any);
      downloadBlob(blob, `kartica-partnerja-${dateTo || today()}.pdf`);
    } catch (e) { setStatus("PDF ni bilo mogoče prenesti: " + errMsg(e)); }
    setPdfBusy(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kartica partnerja</h1>
          <p className="text-muted-foreground mt-1">Kronološki pregled izbranega partnerja in konta, zapiranja in ponovna odpiranja postavk.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/saldakonti"><Button variant="outline">Saldakonti</Button></Link>
          <Link href="/promet-partnerjev"><Button variant="outline">Promet partnerjev</Button></Link>
          <Button onClick={downloadPdf} disabled={pdfBusy || !showReport || !data || ledger.isFetching}><FileDown className="h-4 w-4 mr-2" />{pdfBusy ? "Pripravljam..." : "PDF"}</Button>
        </div>
      </div>

      <form onSubmit={applyFilters} className="bg-card p-4 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
        <div className="space-y-1.5"><Label htmlFor="partner-filter" className="text-xs text-muted-foreground">Poslovni partner</Label>
          <PartnerLedgerPartnerSelect key={companyId} partners={cps?.counterparties ?? []}
            value={partnerId} onChange={v => { setPartnerId(v); setSelected([]); }} /></div>
        <div className="space-y-1.5"><Label htmlFor="account-filter" className="text-xs text-muted-foreground">Konto</Label>
          <Select value={validAccount ? accountId : "all"} onValueChange={v => { setAccountId(v); setSelected([]); }}><SelectTrigger id="account-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Izberite konto</SelectItem>
              {saldakontoAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Datum od</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Datum do (stanje na dan)</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="items-filter" className="text-xs text-muted-foreground">Postavke</Label>
          <Select value={openOnly ? "open" : "all"} onValueChange={v => setOpenOnly(v === "open")}><SelectTrigger id="items-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vse postavke</SelectItem><SelectItem value="open">Samo odprte</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Vir knjižb</Label>
          <Select value={mode} onValueChange={v => { setMode(v as any); setSelected([]); }}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="posted">Knjižene postavke</SelectItem><SelectItem value="drafts">Osnutki (samo za ogled)</SelectItem></SelectContent></Select></div>
        <Button type="submit" disabled={!filtersReady || (showReport && ledger.isFetching)}>Prikaži kartico</Button>
      </form>

      {isDraft && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pregled osnutkov - samo za ogled</AlertTitle>
          <AlertDescription>Prikazane so neknjižene postavke za primerjavo. Niso del računovodskega stanja, zapiranje in odpiranje sta onemogočena.</AlertDescription>
        </Alert>
      )}
      {openOnly && !isDraft && (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Filter odprtih postavk</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>Prikazane so samo odprte postavke. Zaprte vrstice so skrite, tekoči saldo pa izhaja iz celotnega izbranega toka.</span>
            <Button type="button" size="sm" variant="outline" disabled={!filtersReady} onClick={showAllEntries}>Prikaži vse postavke</Button>
          </AlertDescription></Alert>
      )}
      <p className="text-xs text-muted-foreground">Datum DUR, datum knjiženja, datum DDV in celoten opis so v podrobnostih postavke. DUR je prikazan samo iz potrjenega izvornega podatka. Postavke so prikazane od najnovejših do najstarejših po datumu dokumenta; če manjka, po datumu knjiženja. Tekoči saldo ostaja izračunan v prvotnem kronološkem zaporedju.</p>
      {showReport && data && lines.length > 0 && (
        <div className="bg-card border rounded-lg p-3 text-sm flex flex-wrap gap-x-8 gap-y-1" data-testid="ledger-header">
          <div><span className="text-muted-foreground">Partner: </span><b>{(cps?.counterparties ?? []).find((c: any) => c.id === partnerId)?.name ?? lines[0].partnerName}</b></div>
          <div><span className="text-muted-foreground">Konto: </span><b>{saldakontoAccounts.find(a => a.id === accountId)?.code} {saldakontoAccounts.find(a => a.id === accountId)?.name}</b></div>
        </div>
      )}
      {status && <Alert variant={status.startsWith("Uspeh") ? "default" : "destructive"}><AlertDescription>{status}</AlertDescription></Alert>}

      {showReport && canEdit && !isDraft && (
        <div className="flex items-center gap-3">
          <Button disabled={selected.length < 2} onClick={() => { setStatus(null); setSettleOpen(true); }}>
            <Link2 className="h-4 w-4 mr-2" />Zapri izbrane postavke ({selected.length})
          </Button>
          {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Počisti izbor</Button>}
        </div>
      )}

      {!showReport ? (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Najprej določite filtre</AlertTitle>
          <AlertDescription>Izberite poslovnega partnerja, konto in veljavno obdobje, nato kliknite »Prikaži kartico«. Do takrat se postavke ne nalagajo.</AlertDescription></Alert>
      ) : ledger.error ? (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle>
          <AlertDescription className="flex items-center gap-3">{errMsg(ledger.error)}<Button size="sm" variant="outline" onClick={() => ledger.refetch()}>Poskusi znova</Button></AlertDescription></Alert>
      ) : ledger.isLoading ? <Skeleton className="h-[400px] w-full" />
      : lines.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center bg-card"><h2 className="text-xl font-semibold mb-2">Ni postavk</h2>
          <p className="text-muted-foreground">Za izbrane filtre ni knjižb.{(data?.openingBalances ?? []).filter((o: any) => Number(o.balance) !== 0).map((o: any) => ` Začetno stanje ${o.accountCode}: ${fmt(o.balance)}.`).join("")}</p></div>
      ) : (
        <div className="min-w-0 border rounded-lg bg-card overflow-x-auto">
          <Table data-testid="partner-ledger-table" className="partner-ledger-table w-full min-w-[640px] table-fixed">
            <colgroup>{[4, 9, 8, 6, 10, 10, 8, 8, 9, 8, 8, 12].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <TableHeader><TableRow>
              <TableHead className="w-8" />
              <TableHead>Vrsta dokumenta</TableHead><TableHead>Št. dok.</TableHead><TableHead>Temeljnica</TableHead>
              <TableHead className="whitespace-nowrap">Dat. dok.</TableHead><TableHead className="whitespace-nowrap">Zapad.</TableHead>
              <TableHead className="text-right">Debet</TableHead><TableHead className="text-right">Kredit</TableHead>
              <TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Odprt debet</TableHead><TableHead className="text-right">Odprt kredit</TableHead><TableHead>Podrobnosti</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {displayLines.map(l => (
                <TableRow key={l.lineId} data-state={selected.includes(l.lineId) ? "selected" : undefined}>
                  <TableCell>{canEdit && !isDraft && (Number(l.openDebit) > 0 || Number(l.openCredit) > 0) &&
                    <Checkbox checked={selected.includes(l.lineId)} onCheckedChange={c => setSelected(s => c ? [...s, l.lineId] : s.filter(x => x !== l.lineId))} />}</TableCell>
                  <TableCell className="break-words">{docLabel(l.documentType)}{l.entryStatus !== "posted" && <Badge variant="outline" className="mt-1 max-w-full whitespace-normal px-1 text-[10px]">{l.entryStatus === "draft" ? "osnutek" : "storno"}</Badge>}</TableCell>
                  <TableCell className="break-all">{l.originalDocumentNumber ?? l.documentNumber ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap"><Link className="underline hover:text-primary" title={l.reference ?? undefined} href={`/temeljnice?id=${encodeURIComponent(l.entryId)}`}>Odpri</Link></TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(l.documentDate ?? l.postingDate).replace(/\s/g, "")}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(l.dueDate).replace(/\s/g, "")}</TableCell>
                  <TableCell className="text-right break-all tabular-nums">{fmt(l.debit)}</TableCell>
                  <TableCell className="text-right break-all tabular-nums">{fmt(l.credit)}</TableCell>
                  <TableCell className="text-right font-medium break-all tabular-nums">{fmt(l.runningBalance)}</TableCell>
                  <TableCell className="text-right break-all tabular-nums">{fmt(l.openDebit)}</TableCell>
                  <TableCell className="text-right break-all tabular-nums">{fmt(l.openCredit)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" className="h-auto w-full whitespace-normal px-1 py-1 text-[11px] leading-tight" onClick={() => setDetail(l)}>Podrobnosti / Zapiranja ({l.closings?.length ?? 0})</Button></TableCell>
                </TableRow>
              ))}
              {data && (data.openingBalances ?? []).filter((o: any) => dateFrom || Number(o.balance) !== 0).map((o: any) => <TableRow key={o.accountId} className="bg-muted/30"><TableCell colSpan={8} className="font-medium">Začetno stanje iz razpoložljive zgodovine{dateFrom ? ` do ${fmtDate(dateFrom)}` : ""}: konto {o.accountCode} {o.accountName}</TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{fmt(o.balance)}</TableCell><TableCell colSpan={3} /></TableRow>)}
              <TableRow className="bg-muted/50 font-bold hover:bg-muted/50 [&>td]:break-all [&>td]:tabular-nums">
                <TableCell colSpan={6} className="text-right">Skupaj prikazane vrstice:</TableCell>
                <TableCell className="text-right">{fmt(totals.d)}</TableCell><TableCell className="text-right">{fmt(totals.c)}</TableCell>
                <TableCell className="text-right">{fmt(lastBalance)}</TableCell>
                <TableCell className="text-right">{fmt(totals.od)}</TableCell><TableCell className="text-right">{fmt(totals.oc)}</TableCell><TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {showReport && detail && <DetailDialog line={lines.find(l => l.lineId === detail.lineId) ?? detail} onClose={() => setDetail(null)}
        companyId={companyId} canEdit={canEdit && !isDraft} reload={reload} setStatus={setStatus} />}
      <SettleDialog open={showReport && settleOpen} onClose={() => setSettleOpen(false)} lines={selLines} companyId={companyId}
        reload={async () => { await reload(); setSelected([]); }} setStatus={setStatus} />
    </div>
  );
}
