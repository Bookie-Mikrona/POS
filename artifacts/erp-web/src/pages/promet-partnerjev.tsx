import React, { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, FileDown } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useGetPartnerTurnover, useListCounterparties, useListAccounts, getPartnerTurnoverPdf } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadBlob, fmt, today } from "@/lib/partner-ledger-utils";

export default function PrometPartnerjev() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const [dateFrom, setDateFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [dateTo, setDateTo] = useState(today());
  const [partnerId, setPartnerId] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const { data: cps } = useListCounterparties(companyId, {}, { query: { enabled: !!companyId } as any });
  const { data: accs } = useListAccounts(companyId, {} as any, { query: { enabled: !!companyId } as any });
  const params = { dateFrom, dateTo, partnerId: partnerId !== "all" ? partnerId : undefined, accountId: accountId !== "all" ? accountId : undefined, openOnly };
  const q = useGetPartnerTurnover(companyId, params, { query: { enabled: !!companyId && !!dateFrom && !!dateTo } as any });
  const data = q.data as any;
  const rows: any[] = data?.rows ?? [];
  const accountTotals: any[] = data?.accountTotals ?? [];
  const totals = data?.totals ?? {};

  async function pdf() {
    setBusy(true); setPdfErr(null);
    try { downloadBlob(await getPartnerTurnoverPdf(companyId, params as any), `promet-partnerjev-${dateFrom}_${dateTo}.pdf`); }
    catch (e: any) { setPdfErr("PDF ni bilo mogoče prenesti: " + (e?.data?.error ?? e?.message ?? "")); }
    setBusy(false);
  }
  const cardLink = (r: any) => `/kartica-partnerja?partnerId=${encodeURIComponent(r.partnerId)}&accountId=${encodeURIComponent(r.accountId)}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Promet partnerjev</h1>
          <p className="text-muted-foreground mt-1">Zbirni promet po kontih in partnerjih. Saldo obdobja in odprti ostanki se računajo ločeno.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/kartica-partnerja"><Button variant="outline">Kartica partnerja</Button></Link>
          <Button onClick={pdf} disabled={busy || !companyId}><FileDown className="h-4 w-4 mr-2" />{busy ? "Pripravljam..." : "PDF"}</Button>
        </div>
      </div>
      <div className="bg-card p-4 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Od</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Do</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Konto</Label>
          <Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vsi konti</SelectItem>{(accs?.accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Partner</Label>
          <Select value={partnerId} onValueChange={setPartnerId}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vsi partnerji</SelectItem>{(cps?.counterparties ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Postavke</Label>
          <Select value={openOnly ? "open" : "all"} onValueChange={v => setOpenOnly(v === "open")}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Vsi</SelectItem><SelectItem value="open">Samo z odprtimi postavkami</SelectItem></SelectContent></Select></div>
      </div>
      <p className="text-xs text-muted-foreground">Prikazane so samo knjižene postavke. Osnutki niso vključeni.</p>
      {pdfErr && <Alert variant="destructive"><AlertDescription>{pdfErr}</AlertDescription></Alert>}
      {q.error ? (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Napaka</AlertTitle>
          <AlertDescription className="flex items-center gap-3">{(q.error as any)?.data?.error ?? "Prometa ni bilo mogoče naložiti."}<Button size="sm" variant="outline" onClick={() => q.refetch()}>Poskusi znova</Button></AlertDescription></Alert>
      ) : q.isLoading ? <Skeleton className="h-[400px] w-full" />
      : rows.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center bg-card"><h2 className="text-xl font-semibold mb-2">Ni prometa</h2><p className="text-muted-foreground">Za izbrane filtre ni knjižb partnerjev.</p></div>
      ) : (
        <div className="border rounded-lg bg-card overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Šifra</TableHead><TableHead>Partner</TableHead><TableHead>Kraj</TableHead>
              <TableHead className="text-right">Debet obdobja</TableHead><TableHead className="text-right">Kredit obdobja</TableHead><TableHead className="text-right">Saldo obdobja</TableHead>
              <TableHead className="text-right">Odprt debet</TableHead><TableHead className="text-right">Odprt kredit</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {accountTotals.map(at => (
                <React.Fragment key={at.accountId}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={9} className="font-semibold">Konto {at.accountCode} {at.accountName}</TableCell></TableRow>
                  {rows.filter(r => r.accountId === at.accountId).map(r => (
                    <TableRow key={`${r.accountId}-${r.partnerId}`}>
                      <TableCell>{r.partnerCode ?? "-"}</TableCell><TableCell className="font-medium">{r.partnerName}</TableCell>
                      <TableCell>{r.partnerCity ?? "-"}</TableCell>
                      <TableCell className="text-right">{fmt(r.debit)}</TableCell><TableCell className="text-right">{fmt(r.credit)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(r.periodBalance)}</TableCell>
                      <TableCell className="text-right">{fmt(r.openDebit)}</TableCell><TableCell className="text-right">{fmt(r.openCredit)}</TableCell>
                      <TableCell><Link href={cardLink(r)}><Button size="sm" variant="ghost">Kartica</Button></Link></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold hover:bg-transparent"><TableCell colSpan={3} className="text-right">Skupaj konto {at.accountCode}:</TableCell>
                    <TableCell className="text-right">{fmt(at.debit)}</TableCell><TableCell className="text-right">{fmt(at.credit)}</TableCell><TableCell className="text-right">{fmt(at.periodBalance)}</TableCell>
                    <TableCell className="text-right">{fmt(at.openDebit)}</TableCell><TableCell className="text-right">{fmt(at.openCredit)}</TableCell><TableCell /></TableRow>
                </React.Fragment>
              ))}
              <TableRow className="bg-muted/50 font-bold hover:bg-muted/50"><TableCell colSpan={3} className="text-right">SKUPAJ:</TableCell>
                <TableCell className="text-right">{fmt(totals.debit)}</TableCell><TableCell className="text-right">{fmt(totals.credit)}</TableCell><TableCell className="text-right">{fmt(totals.periodBalance)}</TableCell>
                <TableCell className="text-right">{fmt(totals.openDebit)}</TableCell><TableCell className="text-right">{fmt(totals.openCredit)}</TableCell><TableCell /></TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      {data?.remainderSemantics && <p className="text-xs text-muted-foreground">{data.remainderSemantics}</p>}
    </div>
  );
}
