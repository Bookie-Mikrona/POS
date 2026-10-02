import React, { useMemo, useState } from "react";
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

type Line = any;
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

  const { data: cps } = useListCounterparties(companyId, {}, { query: { enabled: !!companyId } as any });
  const { data: accs } = useListAccounts(companyId, {} as any, { query: { enabled: !!companyId } as any });

  const params = {
    partnerId: partnerId !== "all" ? partnerId : undefined,
    accountId: accountId !== "all" ? accountId : undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, openOnly, mode,
  };
  const ledger = useGetPartnerLedger(companyId, params, { query: { enabled: !!companyId } as any });
  const data = ledger.data as any;
  const lines: Line[] = data?.lines ?? [];
  const isDraft = mode === "drafts";

  const totals = useMemo(() => {
    let d = 0, c = 0, od = 0, oc = 0;
    for (const l of lines) { d += Number(l.debit); c += Number(l.credit); od += Number(l.openDebit); oc += Number(l.openCredit); }
    return { d, c, od, oc };
  }, [lines]);
  const lastBalance = data?.closingBalance;
  const selLines = lines.filter(l => selected.includes(l.lineId));

  async function reload() { await ledger.refetch(); }

  async function downloadPdf() {
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
          <p className="text-muted-foreground mt-1">Kronološki pregled vseh kontov partnerja, zapiranja in ponovna odpiranja postavk.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/saldakonti"><Button variant="outline">Saldakonti</Button></Link>
          <Link href="/promet-partnerjev"><Button variant="outline">Promet partnerjev</Button></Link>
          <Button onClick={downloadPdf} disabled={pdfBusy || !companyId}><FileDown className="h-4 w-4 mr-2" />{pdfBusy ? "Pripravljam..." : "PDF"}</Button>
        </div>
      </div>

      <div className="bg-card p-4 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Partner</Label>
          <Select value={partnerId} onValueChange={v => { setPartnerId(v); setSelected([]); }}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vsi partnerji</SelectItem>
              {(cps?.counterparties ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Konto</Label>
          <Select value={accountId} onValueChange={v => { setAccountId(v); setSelected([]); }}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vsi konti</SelectItem>
              {(accs?.accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Datum od</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Datum do (stanje na dan)</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Postavke</Label>
          <Select value={openOnly ? "open" : "all"} onValueChange={v => setOpenOnly(v === "open")}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vse postavke</SelectItem><SelectItem value="open">Samo odprte</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Vir knjižb</Label>
          <Select value={mode} onValueChange={v => { setMode(v as any); setSelected([]); }}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="posted">Knjižene postavke</SelectItem><SelectItem value="drafts">Osnutki (samo za ogled)</SelectItem></SelectContent></Select></div>
      </div>

      {isDraft && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pregled osnutkov - samo za ogled</AlertTitle>
          <AlertDescription>Prikazane so neknjižene postavke za primerjavo. Niso del računovodskega stanja, zapiranje in odpiranje sta onemogočena.</AlertDescription>
        </Alert>
      )}
      {openOnly && !isDraft && (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Filter odprtih postavk</AlertTitle>
          <AlertDescription>Filter skrije zaprte vrstice, vendar tekoči saldo še vedno izhaja iz celotnega izbranega toka.</AlertDescription></Alert>
      )}
      <p className="text-xs text-muted-foreground">Datum DUR: vir še ni potrjen, zato ni prikazan. Stolpec Datum DDV je davčni datum knjižbe. Zaporedje sledi datumu dokumenta; če manjka, datumu knjiženja.</p>
      {status && <Alert variant={status.startsWith("Uspeh") ? "default" : "destructive"}><AlertDescription>{status}</AlertDescription></Alert>}

      {canEdit && !isDraft && (
        <div className="flex items-center gap-3">
          <Button disabled={selected.length < 2} onClick={() => { setStatus(null); setSettleOpen(true); }}>
            <Link2 className="h-4 w-4 mr-2" />Zapri izbrane postavke ({selected.length})
          </Button>
          {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Počisti izbor</Button>}
        </div>
      )}

      {ledger.error ? (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle>
          <AlertDescription className="flex items-center gap-3">{errMsg(ledger.error)}<Button size="sm" variant="outline" onClick={() => ledger.refetch()}>Poskusi znova</Button></AlertDescription></Alert>
      ) : ledger.isLoading ? <Skeleton className="h-[400px] w-full" />
      : lines.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center bg-card"><h2 className="text-xl font-semibold mb-2">Ni postavk</h2>
          <p className="text-muted-foreground">Za izbrane filtre ni knjižb.{(data?.openingBalances ?? []).filter((o: any) => Number(o.balance) !== 0).map((o: any) => ` Začetno stanje ${o.accountCode}: ${fmt(o.balance)}.`).join("")}</p></div>
      ) : (
        <div className="border rounded-lg bg-card overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8" />
              <TableHead>Vrsta</TableHead><TableHead>Konto</TableHead><TableHead>Partner</TableHead><TableHead>Št. dok.</TableHead><TableHead>Temeljnica</TableHead><TableHead>Opis</TableHead>
              <TableHead>Dat. dok.</TableHead><TableHead title="Datum DDV ni potrjen kot vir; prikazan je Datum DDV.">Datum DDV</TableHead><TableHead>Zapad.</TableHead>
              <TableHead className="text-right">Debet</TableHead><TableHead className="text-right">Kredit</TableHead>
              <TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Odprt debet</TableHead><TableHead className="text-right">Odprt kredit</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {data && dateFrom && (data.openingBalances ?? []).map((o: any) => <TableRow key={o.accountId} className="bg-muted/30"><TableCell colSpan={12} className="font-medium">Začetno stanje pred {fmtDate(dateFrom)}: konto {o.accountCode} {o.accountName}</TableCell>
                <TableCell className="text-right font-medium">{fmt(o.balance)}</TableCell><TableCell colSpan={3} /></TableRow>)}
              {lines.map(l => (
                <TableRow key={l.lineId} data-state={selected.includes(l.lineId) ? "selected" : undefined}>
                  <TableCell>{canEdit && !isDraft && (Number(l.openDebit) > 0 || Number(l.openCredit) > 0) &&
                    <Checkbox checked={selected.includes(l.lineId)} onCheckedChange={c => setSelected(s => c ? [...s, l.lineId] : s.filter(x => x !== l.lineId))} />}</TableCell>
                  <TableCell>{l.documentType ?? "-"}{l.entryStatus !== "posted" && <Badge variant="outline" className="ml-1">{l.entryStatus === "draft" ? "osnutek" : "storno"}</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.accountCode}</TableCell>
                  <TableCell>{l.partnerName}</TableCell>
                  <TableCell>{l.documentNumber ?? "-"}</TableCell>
                  <TableCell><Link className="underline hover:text-primary" href={`/temeljnice?id=${encodeURIComponent(l.entryId)}`}>{l.reference ?? "Odpri temeljnico"}</Link></TableCell>
                  <TableCell className="max-w-[260px]">{l.description}</TableCell>
                  <TableCell>{fmtDate(l.documentDate ?? l.postingDate)}</TableCell>
                  <TableCell>{fmtDate(l.taxDate)}</TableCell>
                  <TableCell>{fmtDate(l.dueDate)}</TableCell>
                  <TableCell className="text-right">{fmt(l.debit)}</TableCell>
                  <TableCell className="text-right">{fmt(l.credit)}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(l.runningBalance)}</TableCell>
                  <TableCell className="text-right">{fmt(l.openDebit)}</TableCell>
                  <TableCell className="text-right">{fmt(l.openCredit)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setDetail(l)}>Zapiranja ({l.closings?.length ?? 0})</Button></TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                <TableCell colSpan={10} className="text-right">Skupaj prikazane vrstice:</TableCell>
                <TableCell className="text-right">{fmt(totals.d)}</TableCell><TableCell className="text-right">{fmt(totals.c)}</TableCell>
                <TableCell className="text-right">{fmt(lastBalance)}</TableCell>
                <TableCell className="text-right">{fmt(totals.od)}</TableCell><TableCell className="text-right">{fmt(totals.oc)}</TableCell><TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {detail && <DetailDialog line={lines.find(l => l.lineId === detail.lineId) ?? detail} onClose={() => setDetail(null)}
        companyId={companyId} canEdit={canEdit && !isDraft} reload={reload} setStatus={setStatus} />}
      <SettleDialog open={settleOpen} onClose={() => setSettleOpen(false)} lines={selLines} companyId={companyId}
        reload={async () => { await reload(); setSelected([]); }} setStatus={setStatus} />
    </div>
  );
}
