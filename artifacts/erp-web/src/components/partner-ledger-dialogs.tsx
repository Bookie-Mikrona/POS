import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useCreatePartnerSettlements, useReopenPartnerSettlement } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt, fmtDate, today } from "@/lib/partner-ledger-utils";

export function errMsg(e: any): string { return e?.data?.error ?? e?.message ?? "Neznana napaka"; }

const SOURCE_LABEL: Record<string, string> = {
  manual: "Ročno", "bookie-old-ar": "Zgodovinski prenos (kupci)", "bookie-old-ap": "Zgodovinski prenos (dobavitelji)", posted_payment_allocation: "Knjiženo plačilo", bank_statement: "Bančni izpisek",
};
const WARNING_LABEL: Record<string, string> = {
  POSTED_PAYMENT_GL_COUNTERPART_NOT_IN_IMPORTED_SCOPE: "Nasprotna knjižba plačila ni v preneseni glavni knjigi. Znesek je prikazan iz evidence plačila, nasprotna postavka ni izmišljena.",
};

export function DetailDialog({ line, onClose, companyId, canEdit, reload, setStatus }:
  { line: any; onClose: () => void; companyId: string; canEdit: boolean; reload: () => Promise<any>; setStatus: (s: string | null) => void }) {
  const reopen = useReopenPartnerSettlement();
  const [target, setTarget] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const closings: any[] = line.closings ?? [];

  function startReopen(c: any) {
    setTarget(c); setAmount(String(c.amount)); setDate(today()); setReason(""); setErr(null); setKey(crypto.randomUUID());
  }
  async function submit() {
    setErr(null);
    try {
      await reopen.mutateAsync({ companyId, id: encodeURIComponent(String(target.id)), data: { amount, effectiveDate: date, reason: reason.trim(), idempotencyKey: key } });
      await reload();
      setStatus("Uspeh: povezava je bila ponovno odprta, kartica je ponovno naložena.");
      setTarget(null); onClose();
    } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Podrobnosti zapiranja</DialogTitle>
          <DialogDescription>{line.partnerName} / {line.accountCode} / {line.documentType ?? ""} {line.documentNumber ?? ""} - debet {fmt(line.debit)}, kredit {fmt(line.credit)}, odprt debet {fmt(line.openDebit)}, odprt kredit {fmt(line.openCredit)}</DialogDescription>
        </DialogHeader>
        {closings.length === 0 ? <p className="text-muted-foreground">Za to postavko ni zapiranj.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Vir</TableHead><TableHead>Vrsta</TableHead><TableHead>Datum učinka</TableHead><TableHead className="text-right">Znesek</TableHead><TableHead>Nasprotna postavka</TableHead><TableHead>Razlog / revizija</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {closings.map((c, i) => (
                <TableRow key={c.id ?? i}>
                  <TableCell><Badge variant="outline">{SOURCE_LABEL[c.source] ?? c.source ?? "Zgodovinski prenos"}</Badge></TableCell>
                  <TableCell>{c.type === "reopen" ? "Odprtje" : c.type === "close" ? "Zapiranje" : (c.type ?? "-")}</TableCell>
                  <TableCell>{fmtDate(c.effectiveDate)}</TableCell>
                  <TableCell className="text-right">{fmt(c.amount)}</TableCell>
                  <TableCell className="text-xs">
                    {c.oppositeDocumentNumber && <div>{c.oppositeDocumentType}: {c.oppositeDocumentNumber}{c.oppositeDocumentDate ? ` (${fmtDate(c.oppositeDocumentDate)})` : ""}</div>}
                    {c.oppositeLineId ? <span className="font-mono">{String(c.oppositeLineId).slice(0, 8)}</span> : (
                      <span className="flex items-start gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />Ni nasprotne knjižbe</span>)}
                    {c.deduplicatedWith && <div className="text-muted-foreground mt-1">Podvojen zapis; upošteva se v: {SOURCE_LABEL[c.deduplicatedWith] ?? c.deduplicatedWith}</div>}
                    {c.warning && <div className="text-amber-700 mt-1 max-w-[260px]">{WARNING_LABEL[c.warning] ?? c.warning}</div>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">{c.reason ? <div><span className="text-muted-foreground">Razlog: </span>{c.reason}</div> : null}{c.actorId ? <div className="text-muted-foreground">Uporabnik {c.actorId}{c.createdAt ? `, ${fmtDate(c.createdAt)}` : ""}</div> : null}</TableCell>
                  <TableCell>{canEdit && c.type === "close" && c.id && !c.deduplicatedWith &&
                    <Button size="sm" variant="outline" onClick={() => startReopen(c)}>Odpri</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {target && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <h3 className="font-semibold">Ponovno odpiranje povezave (do {fmt(target.amount)})</h3>
            <p className="text-xs text-muted-foreground">Knjižbi ostaneta nespremenjeni; poveča se samo ostanek za razveljavljeni znesek.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Znesek</Label><Input value={amount} onChange={e => setAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Datum učinka</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Razlog (obvezno)</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
            </div>
            {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
            <div className="flex gap-2">
              <Button onClick={submit} disabled={reopen.isPending || !reason.trim() || !/^[0-9]+(\.[0-9]{1,2})?$/.test(amount) || !date}>{reopen.isPending ? "Odpiram..." : "Potrdi odprtje"}</Button>
              <Button variant="ghost" onClick={() => setTarget(null)}>Prekliči</Button>
            </div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Zapri</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Alloc = { source: string; target: string; amount: string };

export function SettleDialog({ open, onClose, lines, companyId, reload, setStatus }:
  { open: boolean; onClose: () => void; lines: any[]; companyId: string; reload: () => Promise<any>; setStatus: (s: string | null) => void }) {
  const create = useCreatePartnerSettlements();
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null); setReason(""); setDate(today()); setKey(crypto.randomUUID());
    const debit = lines.find(l => Number(l.openDebit) > 0);
    const credit = lines.find(l => Number(l.openCredit) > 0);
    setAllocs(debit && credit ? [{ source: debit.lineId, target: credit.lineId, amount: Math.min(Number(debit.openDebit), Number(credit.openCredit)).toFixed(2) }] : [{ source: "", target: "", amount: "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const byId = (id: string) => lines.find(l => l.lineId === id);
  const label = (l: any) => `${l.documentType ?? ""} ${l.documentNumber ?? l.description ?? ""} (${l.accountCode}, odprto ${fmt(Number(l.openDebit) > 0 ? l.openDebit : l.openCredit)})`;
  const avail = (l: any) => Number(l.openDebit) > 0 ? Number(l.openDebit) : Number(l.openCredit);
  const used = (id: string) => allocs.filter(a => a.source === id || a.target === id).reduce((s, a) => s + Number(a.amount || 0), 0);
  const overdrawn = lines.filter(l => used(l.lineId) > avail(l) + 0.001);
  const valid = allocs.length > 0 && overdrawn.length === 0 && !!date &&
    allocs.every(a => a.source && a.target && a.source !== a.target && /^[0-9]+(\.[0-9]{1,2})?$/.test(a.amount) && Number(a.amount) > 0);
  const upd = (i: number, patch: Partial<Alloc>) => setAllocs(a => a.map((x, j) => j === i ? { ...x, ...patch } : x));

  async function submit() {
    setErr(null);
    try {
      await create.mutateAsync({ companyId, data: {
        allocations: allocs.map(a => ({ sourceLineId: a.source, targetLineId: a.target, amount: a.amount })),
        effectiveDate: date, idempotencyKey: key, reason: reason.trim() || null } });
      await reload();
      setStatus("Uspeh: zapiranje je shranjeno, kartica je ponovno naložena.");
      onClose();
    } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Ročno zapiranje postavk</DialogTitle>
          <DialogDescription>Izberite pare postavk in zneske. Ena postavka lahko nastopa v več zapiranjih (delna plačila, eno plačilo več računov). Zapiranje velja znotraj istega partnerja in konta.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {allocs.map((a, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_110px_auto] gap-2 items-end">
              {(["source", "target"] as const).map(k => (
                <div key={k} className="space-y-1"><Label className="text-xs">{k === "source" ? "Postavka" : "Zapira z"}</Label>
                  <Select value={a[k]} onValueChange={v => upd(i, { [k]: v } as any)}><SelectTrigger><SelectValue placeholder="Izberi" /></SelectTrigger>
                    <SelectContent>{lines.map(l => <SelectItem key={l.lineId} value={l.lineId}>{label(l)}</SelectItem>)}</SelectContent></Select></div>
              ))}
              <div className="space-y-1"><Label className="text-xs">Znesek</Label><Input value={a.amount} onChange={e => upd(i, { amount: e.target.value })} /></div>
              <Button variant="ghost" size="sm" disabled={allocs.length === 1} onClick={() => setAllocs(x => x.filter((_, j) => j !== i))}>Odstrani</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setAllocs(x => [...x, { source: "", target: "", amount: "" }])}>Dodaj razdelitev</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Postavka</TableHead><TableHead className="text-right">Odprto pred</TableHead><TableHead className="text-right">Razporejeno</TableHead><TableHead className="text-right">Odprto po</TableHead></TableRow></TableHeader>
          <TableBody>{lines.map(l => (
            <TableRow key={l.lineId}><TableCell>{label(l)}</TableCell><TableCell className="text-right">{fmt(avail(l))}</TableCell>
              <TableCell className="text-right">{fmt(used(l.lineId))}</TableCell>
              <TableCell className={`text-right font-medium ${used(l.lineId) > avail(l) + 0.001 ? "text-destructive" : ""}`}>{fmt(avail(l) - used(l.lineId))}</TableCell></TableRow>))}</TableBody>
        </Table>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Datum učinka</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Opomba</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        {overdrawn.length > 0 && <Alert variant="destructive"><AlertDescription>Znesek presega odprti ostanek postavke.</AlertDescription></Alert>}
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>{create.isPending ? "Shranjujem..." : "Potrdi zapiranje"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
