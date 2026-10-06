import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Package, Settings2 } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { CompanyBankSuggestion } from "@/components/company-bank-suggestion";
import {
  useListPaymentBatches,
  useGetPaymentBatch,
  useCreatePaymentBatch,
  useResolvePaymentBatchInstructions,
  getGetPaymentBatchQueryKey,
  getListPaymentsQueryKey,
  useListPayments,
  useListBankStatementAccounts,
  useSetBankAccountMetadata,
  exportPaymentBatchSepaXml,
  getListPaymentBatchesQueryKey,
  getListBankStatementAccountsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BATCH_STATUS: Record<string, string> = {
  ready: "Pripravljen (ni izvožen)",
  exported: "Izvožen v XML (ni dokaz izvedbe)",
  partially_executed: "Delno izveden",
  executed: "Izveden",
  rejected: "Zavrnjen",
  cancelled: "Preklican",
};

const fmt = (v: string | number) => (typeof v === "string" ? parseFloat(v) : v).toFixed(2);
const errMsg = (e: any, fb: string) => e?.data?.error ?? e?.message ?? fb;

export function PaymentBatchesPanel() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const canEdit = activeCompany?.role !== "viewer";
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useListPaymentBatches(companyId, { query: { enabled: !!companyId } as any });
  const { data: accData } = useListBankStatementAccounts(companyId, { query: { enabled: !!companyId } as any });
  const batches = data?.batches ?? [];
  const bankAccounts = accData?.bankAccounts ?? [];
  const accLabel = (id: string) => {
    const a = bankAccounts.find(x => x.id === id);
    const d = accData?.bankDetails.find(x => x.bankAccountId === id);
    return a ? `${a.code} ${a.name}${d ? ` - ${d.iban}` : ""}` : id.slice(0, 8);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Paket združi shranjene osnutke izplačil z izbranega TRR v eno XML datoteko. Priprava paketa in izvoz XML
          plačila ne izvedeta in ne zapreta računov; to se zgodi šele z uvozom bančnega izpiska.
        </p>
        {canEdit && (
          <Button onClick={() => setCreateOpen(true)}><Package className="mr-2 h-4 w-4" />Nov paket</Button>
        )}
      </div>

      <BankMetadataSettings companyId={companyId} canEdit={canEdit} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Paketov ni bilo mogoče naložiti. <Button variant="link" className="p-0 h-auto" onClick={() => refetch()}>Poskusi znova</Button></AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : batches.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center bg-card text-muted-foreground">Ni pripravljenih paketov.</div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Izvedba</TableHead>
                <TableHead>Izvorni TRR</TableHead>
                <TableHead className="text-right">Nalogov</TableHead>
                <TableHead className="text-right">Kontrolna vsota</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Izvoz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map(b => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(b.id)}>
                  <TableCell>{new Date(b.executionDate).toLocaleDateString("sl-SI")}</TableCell>
                  <TableCell className="text-sm">{accLabel(b.bankAccountId)}</TableCell>
                  <TableCell className="text-right">{b.transactionCount}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(b.controlSum)}</TableCell>
                  <TableCell><Badge variant="outline">{BATCH_STATUS[b.status] ?? b.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{b.exportedAt ? new Date(b.exportedAt).toLocaleString("sl-SI") : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {createOpen && <CreateBatchDialog companyId={companyId} onClose={() => setCreateOpen(false)} onCreated={id => { setCreateOpen(false); setDetailId(id); }} />}
      {detailId && <BatchDetailDialog companyId={companyId} batchId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function BankMetadataSettings({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useListBankStatementAccounts(companyId, { query: { enabled: !!companyId } as any });
  const save = useSetBankAccountMetadata();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const accounts = data?.bankAccounts ?? [];

  const pick = (id: string) => {
    setAccountId(id);
    const d = data?.bankDetails.find(x => x.bankAccountId === id);
    setIban(d?.iban ?? "");
    setBic(d?.bic ?? "");
    setErr(null);
  };
  const submit = () => {
    setErr(null);
    save.mutate(
      { companyId, bankAccountId: accountId, data: { iban: iban.replace(/\s+/g, "").toUpperCase(), bic: bic.trim() ? bic.trim().toUpperCase() : null, sepaProfile: "pain.001.001.03" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBankStatementAccountsQueryKey(companyId) });
          setOpen(false);
        },
        onError: (e: any) => setErr(errMsg(e, "Shranjevanje ni uspelo")),
      },
    );
  };

  return (
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Izvorni TRR (IBAN) po analitičnih bančnih kontih</h3>
        {canEdit && <Button variant="outline" size="sm" onClick={() => { setOpen(true); pick(accounts[0]?.id ?? ""); }}><Settings2 className="mr-1.5 h-3 w-3" />Uredi</Button>}
      </div>
      <div className="grid gap-1 text-sm">
        {accounts.length === 0 && <span className="text-muted-foreground">Ni bančnih kontov.</span>}
        {accounts.map(a => {
          const d = data?.bankDetails.find(x => x.bankAccountId === a.id);
          return (
            <div key={a.id} className="flex flex-wrap justify-between gap-2">
              <span>{a.code} {a.name}</span>
              <span className={d ? "font-mono" : "text-destructive"}>{d ? `${d.iban}${d.bic ? ` / ${d.bic}` : ""}` : "IBAN ni določen"}</span>
            </div>
          );
        })}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>IBAN bančnega konta</DialogTitle>
            <DialogDescription>Profil XML: pain.001.001.03. Skladnost z vašo banko preverite pred uporabo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Konto</Label>
              <Select value={accountId} onValueChange={pick}>
                <SelectTrigger><SelectValue placeholder="Izberite konto" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>IBAN</Label><Input value={iban} onChange={e => setIban(e.target.value)} placeholder="SI56..." /></div>
            <div className="space-y-2"><Label>BIC (neobvezno)</Label><Input value={bic} onChange={e => setBic(e.target.value)} /></div>
            <CompanyBankSuggestion
              companyId={companyId}
              accountCode={accounts.find(a => a.id === accountId)?.code}
              hasSavedMetadata={!!data?.bankDetails.find(d => d.bankAccountId === accountId)}
              draftEmpty={!iban && !bic}
              onSelect={(suggestedIban, suggestedBic) => { setIban(suggestedIban); setBic(suggestedBic); }}
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Prekliči</Button>
            <Button onClick={submit} disabled={!accountId || !iban || save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateBatchDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const keyRef = useRef(crypto.randomUUID());
  const [bankAccountId, setBankAccountId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const create = useCreatePaymentBatch();

  const { data: accData } = useListBankStatementAccounts(companyId, {});
  const { data: payData, isLoading } = useListPayments(companyId, { direction: "outbound", status: "draft" } as any);
  const drafts = useMemo(() => payData?.payments ?? [], [payData]);
  const hasIban = !!accData?.bankDetails.find(d => d.bankAccountId === bankAccountId);
  const sum = drafts.filter(p => selected.has(p.id)).reduce((s, p) => s + parseFloat(p.amount), 0);
  const total = drafts.reduce((s, p) => s + parseFloat(p.amount), 0);

  const toggle = (id: string, on: boolean) =>
    setSelected(cur => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });

  const submit = () => {
    setErr(null);
    create.mutate(
      { companyId, data: { bankAccountId, paymentIds: [...selected], idempotencyKey: keyRef.current } },
      {
        onSuccess: r => {
          queryClient.invalidateQueries({ queryKey: getListPaymentBatchesQueryKey(companyId) });
          onCreated(r.batch.id);
        },
        onError: (e: any) => setErr(errMsg(e, "Paketa ni bilo mogoče ustvariti. Noben nalog ni bil pripravljen.")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nov paket plačil</DialogTitle>
          <DialogDescription>Izberite izvorni TRR in shranjene osnutke izplačil. Paket se ustvari atomsko: vse ali nič.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Izvorni TRR</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="Izberite konto" /></SelectTrigger>
              <SelectContent>
                {(accData?.bankAccounts ?? []).map(a => {
                  const d = accData?.bankDetails.find(x => x.bankAccountId === a.id);
                  return <SelectItem key={a.id} value={a.id}>{a.code} {a.name} - {d?.iban ?? "IBAN ni določen"}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            {bankAccountId && !hasIban && <p className="text-xs text-destructive">Za ta konto najprej določite IBAN.</p>}
          </div>

          {isLoading ? <Skeleton className="h-32 w-full" /> : drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ni osnutkov izplačil. Najprej ustvarite izplačila v zavihku Izplačila.</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selected.size === drafts.length}
                        onCheckedChange={c => setSelected(c ? new Set(drafts.map(p => p.id)) : new Set())}
                      />
                    </TableHead>
                    <TableHead>Datum izvedbe</TableHead>
                    <TableHead>Prejemnik</TableHead>
                    <TableHead>Sklic</TableHead>
                    <TableHead className="text-right">Znesek</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drafts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={c => toggle(p.id, !!c)} /></TableCell>
                      <TableCell>{new Date(p.paymentDate).toLocaleDateString("sl-SI")}</TableCell>
                      <TableCell>{p.counterpartyName}</TableCell>
                      <TableCell className="text-muted-foreground">{p.reference || "-"}</TableCell>
                      <TableCell className="text-right">{fmt(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap gap-6 text-sm">
            <span>Vsi osnutki: <b>{fmt(total)}</b></span>
            <span>Izbrano ({selected.size}): <b>{fmt(sum)}</b></span>
          </div>
          {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={submit} disabled={!bankAccountId || !hasIban || selected.size === 0 || create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ustvari paket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDetailDialog({ companyId, batchId, onClose }: { companyId: string; batchId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useGetPaymentBatch(companyId, batchId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    if (data?.exportedAt && !window.confirm("Ta XML je bil že izvožen. Ponovni uvoz v banko lahko podvoji plačila. Nadaljujem s prenosom?")) return;
    setBusy(true);
    setErr(null);
    try {
      const xml = await exportPaymentBatchSepaXml(companyId, batchId);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SEPA-paket-${batchId.slice(0, 8)}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: getListPaymentBatchesQueryKey(companyId) });
      refetch();
    } catch (e: any) {
      setErr(errMsg(e, "XML ni bilo mogoče prenesti."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paket plačil</DialogTitle>
          <DialogDescription>Nespremenljiv posnetek potrjenih navodil.</DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-40 w-full" /> : error || !data ? (
          <Alert variant="destructive"><AlertDescription>Paketa ni bilo mogoče naložiti.</AlertDescription></Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Status: <Badge variant="outline">{BATCH_STATUS[data.status] ?? data.status}</Badge></span>
              <span>Nalogov: <b>{data.transactionCount}</b></span>
              <span>Kontrolna vsota: <b>{fmt(data.controlSum)}</b></span>
              <span>Izvedba: <b>{new Date(data.executionDate ?? "").toLocaleDateString("sl-SI")}</b></span>
            </div>
            {data.status === "exported" || data.exportedAt ? (
              <Alert><AlertDescription>XML je bil izvožen. To ni dokaz izvedbe: plačilo se evidentira šele ob uvozu bančnega izpiska.</AlertDescription></Alert>
            ) : null}
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prejemnik</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead>Model / sklic</TableHead>
                    <TableHead>Namen</TableHead>
                    <TableHead className="text-right">Znesek</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map(i => (
                    <TableRow key={i.paymentId}>
                      <TableCell>{i.instruction.creditorName}</TableCell>
                      <TableCell className="font-mono text-xs">{i.instruction.creditorIban}</TableCell>
                      <TableCell className="text-xs">{[i.instruction.model, i.instruction.reference].filter(Boolean).join(" ") || "-"}</TableCell>
                      <TableCell className="text-xs">{i.instruction.purpose || "-"}</TableCell>
                      <TableCell className="text-right">{fmt(i.instruction.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <LifecycleSection companyId={companyId} batchId={batchId} data={data} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
          <Button onClick={download} disabled={!data || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Prenesi XML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BatchDetailData = Awaited<ReturnType<typeof import("@workspace/api-client-react").getPaymentBatch>>;

function LifecycleSection({ companyId, batchId, data }: { companyId: string; batchId: string; data: BatchDetailData }) {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const resolve = useResolvePaymentBatchInstructions();
  const [action, setAction] = useState<"cancel" | "reject">("cancel");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const partial = data.status === "partially_executed";
  const resolvable = data.status === "ready" || data.status === "exported" || partial;
  const eligible = data.items.filter(i => (i.lifecycleStatus ?? "ready") === "ready");
  const canEdit = activeCompany?.role !== "viewer";

  const run = (confirmExportedRisk: boolean) => {
    setErr(null);
    resolve.mutate(
      {
        companyId,
        batchId,
        data: {
          action,
          reason: reason.trim(),
          ...(partial ? { paymentIds: [...selected] } : {}),
          ...(confirmExportedRisk ? { confirmExportedRisk: true } : {}),
        },
      },
      {
        onSuccess: r => {
          setRiskWarning(null);
          setSelected(new Set());
          setDone(`${r.status === "rejected" ? "Zavrnjeno" : "Preklicano"}. Sproščenih osnutkov za ponovno pripravo: ${r.releasedForRepackaging.length}. Denarna knjižba ni bila stornirana.`);
          queryClient.invalidateQueries({ queryKey: getGetPaymentBatchQueryKey(companyId, batchId) });
          queryClient.invalidateQueries({ queryKey: getListPaymentBatchesQueryKey(companyId) });
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey(companyId) });
        },
        onError: (e: any) => {
          if (e?.status === 409 && e?.data?.confirmationRequired) {
            setRiskWarning(e.data.warning ?? e.data.error ?? "Datoteka je bila izvožena in jo je banka morda že prejela.");
            return;
          }
          setErr(errMsg(e, "Operacija ni uspela."));
        },
      },
    );
  };

  if (!resolvable && !done) {
    const resolved = data.items.filter(i => i.resolutionReason);
    return resolved.length === 0 ? null : (
      <div className="text-xs text-muted-foreground space-y-1">
        {resolved.map(i => <div key={i.paymentId}>{i.instruction.creditorName}: {i.lifecycleStatus} - {i.resolutionReason}</div>)}
      </div>
    );
  }
  if (!canEdit) return null;

  return (
    <div className="border rounded-md p-4 space-y-3">
      <h4 className="text-sm font-semibold">Preklic ali zavrnitev neizvedenih nalogov</h4>
      <p className="text-xs text-muted-foreground">
        Izvedeni nalogi se ne spremenijo. Denarne knjižbe se ne stornirajo; razveljavitev izvedenega plačila je ločen postopek.
        Navodila in revizijska sled ostanejo.
      </p>
      {done && <Alert><AlertDescription>{done}</AlertDescription></Alert>}
      {resolvable && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Dejanje</Label>
              <Select value={action} onValueChange={v => setAction(v as "cancel" | "reject")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cancel">Prekliči (banka naloga ni prejela)</SelectItem>
                  <SelectItem value="reject">Zavrni (banka je zavrnila)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Razlog</Label>
              <Textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />
            </div>
          </div>
          {partial && (
            <div className="space-y-1">
              <Label>Izberite neizvedene naloge</Label>
              {eligible.length === 0 && <p className="text-xs text-muted-foreground">Ni neizvedenih nalogov.</p>}
              {eligible.map(i => (
                <label key={i.paymentId} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.has(i.paymentId)} onCheckedChange={c => setSelected(cur => { const n = new Set(cur); if (c) n.add(i.paymentId); else n.delete(i.paymentId); return n; })} />
                  {i.instruction.creditorName} - {fmt(i.instruction.amount)}
                </label>
              ))}
            </div>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
          {riskWarning && (
            <Alert variant="destructive">
              <AlertTitle>Potrebna potrditev</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{riskWarning}</p>
                <Button size="sm" variant="destructive" onClick={() => run(true)} disabled={resolve.isPending}>
                  Razumem tveganje, nadaljuj
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            onClick={() => run(false)}
            disabled={!reason.trim() || resolve.isPending || (partial && selected.size === 0)}
          >
            {resolve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === "cancel" ? "Prekliči naloge" : "Zavrni naloge"}
          </Button>
        </>
      )}
    </div>
  );
}
