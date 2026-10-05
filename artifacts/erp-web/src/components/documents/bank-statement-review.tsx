import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Landmark, Loader2 } from "lucide-react";
import {
  useConfirmBankDocument,
  useListAccounts,
  useListCounterparties,
  useListPeriods,
  getListDocumentsQueryKey,
  getGetDocumentQueryKey,
  getListJournalEntriesQueryKey,
  getListInvoicesQueryKey,
  type DocumentRecord,
  type ScannedBankDraftResult,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const eur = new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" });
const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("sl-SI");
};
const day = (s: string) => s.slice(0, 10);
const selectCls = "h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs disabled:opacity-60";
const INVALIDATE = ["invoice", "journal", "bank", "document"];

export function BankStatementReview({ doc }: { doc: DocumentRecord }) {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const queryClient = useQueryClient();
  const confirm = useConfirmBankDocument();
  const enabled = { query: { enabled: !!companyId } as any };
  const { data: accData } = useListAccounts(companyId, { includeInactive: false }, enabled);
  const { data: perData } = useListPeriods(companyId, enabled);
  const { data: cpData } = useListCounterparties(companyId, { includeInactive: false }, enabled);

  const st = doc.bankStatement;
  const txs = st?.transactions ?? [];
  const accounts = accData?.accounts ?? [];
  const partners = cpData?.counterparties ?? [];
  const postable = useMemo(() => accounts.filter(a => a.isActive && a.allowsPosting), [accounts]);
  const bankAccounts = useMemo(() => postable.filter(a => a.code.startsWith("110")), [postable]);
  const dates = [...txs.map(t => day(t.bookingDate)), ...(st?.statementDate ? [day(st.statementDate)] : [])];
  const periods = useMemo(() => (perData?.periods ?? []).filter(p =>
    p.status === "open" && dates.every(d => day(p.startDate) <= d && d <= day(p.endDate))), [perData, dates.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestedPeriod = (doc.confirmedData as any)?.suggestedPeriodId as string | undefined;

  const [bankId, setBankId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [partner, setPartner] = useState<Record<string, string | null>>({});
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<ScannedBankDraftResult | null>(null);

  const bank = bankId ?? (bankAccounts.length === 1 ? bankAccounts[0].id : "");
  const period = periodId ?? (periods.length === 1 ? periods[0].id
    : periods.find(p => p.id === suggestedPeriod)?.id ?? "");
  const unique = (prefix: string) => {
    const m = postable.filter(a => a.code.startsWith(prefix));
    return m.length === 1 ? m[0].id : "";
  };
  const counterOf = (id: string, amount: number) => counter[id] ?? unique(amount >= 0 ? "120" : "220");
  const partnerOf = (id: string, sug?: string | null) =>
    id in partner ? partner[id] : sug && partners.some(p => p.id === sug) ? sug : null;

  const saved = result ?? (doc.bankStatementDraft as ScannedBankDraftResult | null | undefined) ?? null;
  const blocked = activeCompany?.role === "viewer" || doc.status === "rejected"
    || (doc.status === "confirmed" && !doc.linkedInvoiceId);
  const errors = st?.errors ?? [];
  const rows = txs.map(t => {
    const cId = counterOf(t.transactionId, t.amount);
    const acc = accounts.find(a => a.id === cId);
    const pId = partnerOf(t.transactionId, t.suggestedCounterpartyId);
    return { t, cId, pId, missing: !cId || (!!acc?.requiresPartner && !pId) };
  });
  const needsReplace = !!doc.linkedInvoiceId;
  const ready = !!st && !!bank && !!period && txs.length > 0 && errors.length === 0 && !blocked
    && rows.every(r => !r.missing) && (!needsReplace || replace) && !confirm.isPending;

  const submit = () => {
    if (!ready) return;
    confirm.mutate({ companyId, id: doc.id, data: {
      periodId: period, bankAccountId: bank, replaceDraftInvoice: needsReplace && replace,
      transactions: rows.map(r => ({ transactionId: r.t.transactionId, counterAccountId: r.cId, counterpartyId: r.pId })),
    } }, { onSuccess: res => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(companyId) });
      queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(companyId, doc.id) });
      queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey(companyId) });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey(companyId) });
      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string"
        && q.queryKey[0].includes(companyId) && INVALIDATE.some(k => (q.queryKey[0] as string).includes(k)) });
    } });
  };

  if (!st) return null;
  const err = confirm.error as any;
  return (
    <section className="rounded-xl border bg-background p-4 space-y-4 min-w-0" data-testid="bank-statement-review">
      <header className="flex items-start gap-3">
        <Landmark className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0">
          <h3 className="font-semibold">Bančni izpisek {st.statementNumber ?? ""} · {fmtDate(st.statementDate)}</h3>
          <p className="text-xs text-muted-foreground break-all">{st.sourceIban} · {st.currency}</p>
        </div>
        <dl className="ml-auto grid grid-cols-2 gap-x-4 text-xs text-right shrink-0">
          <dt className="text-muted-foreground">Začetno stanje</dt><dt className="text-muted-foreground">Končno stanje</dt>
          <dd className="font-mono tabular-nums font-medium">{st.openingBalance === undefined ? "Ni prepoznano" : eur.format(st.openingBalance)}</dd>
          <dd className="font-mono tabular-nums font-medium">{st.closingBalance === undefined ? "Ni prepoznano" : eur.format(st.closingBalance)}</dd>
        </dl>
      </header>

      <Alert>
        <AlertDescription className="text-xs">
          Potrditev ustvari samo osnutek temeljnice. Nič se ne knjiži samodejno, računi se ne zapirajo samodejno,
          navadna plačila pa so zunaj DDV.
        </AlertDescription>
      </Alert>

      {errors.length > 0 && (
        <Alert variant="destructive" data-testid="bank-statement-errors">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Izpisek vsebuje napake, potrditev ni mogoča</AlertTitle>
          <AlertDescription><ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <label className="space-y-1"><span className="font-medium">Bančni konto (110…)</span>
          <select className={selectCls} value={bank} disabled={blocked} onChange={e => setBankId(e.target.value)} data-testid="select-bank-account">
            <option value="">{bankAccounts.length ? "Izberite konto" : "Ni ustreznega konta"}</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select></label>
        <label className="space-y-1"><span className="font-medium">Odprto obdobje (vsi datumi izpiska)</span>
          <select className={selectCls} value={period} disabled={blocked} onChange={e => setPeriodId(e.target.value)} data-testid="select-period">
            <option value="">{periods.length ? "Izberite obdobje" : "Ni odprtega obdobja za vse datume"}</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({fmtDate(p.startDate)} – {fmtDate(p.endDate)})</option>)}
          </select></label>
      </div>

      <div className="rounded-lg border divide-y">
        {rows.map(({ t, cId, pId, missing }) => {
          const acc = accounts.find(a => a.id === cId);
          return (
            <div key={t.transactionId} className="grid grid-cols-[5.5rem_minmax(0,1fr)_7rem] gap-2 p-2 text-xs items-center" data-testid={`row-tx-${t.transactionId}`}>
              <span>{fmtDate(t.bookingDate)}</span>
              <div className="min-w-0">
                <p className="truncate" title={t.description}>{t.description}</p>
                <p className="truncate text-muted-foreground">{[t.counterpartyName, t.counterpartyIban, t.reference].filter(Boolean).join(" · ")}</p>
              </div>
              <span className={`text-right font-mono tabular-nums font-medium ${t.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{eur.format(t.amount)}</span>
              <select className={`${selectCls} col-span-full ${!cId ? "border-amber-500" : ""}`} value={cId} disabled={blocked}
                onChange={e => setCounter(c => ({ ...c, [t.transactionId]: e.target.value }))} aria-label="Protikonto">
                <option value="">Protikonto…</option>
                {postable.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
              <select className={`${selectCls} col-span-full ${acc?.requiresPartner && !pId ? "border-amber-500" : ""}`} value={pId ?? ""} disabled={blocked}
                onChange={e => setPartner(p => ({ ...p, [t.transactionId]: e.target.value || null }))} aria-label="Partner">
                <option value="">{acc?.requiresPartner ? "Partner (obvezen)" : "Brez partnerja"}</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {missing && <span className="col-span-full text-amber-700">Manjka protikonto ali obvezni partner.</span>}
            </div>
          );
        })}
      </div>

      {needsReplace && !blocked && (
        <label className="flex items-start gap-2 text-xs rounded-md border border-amber-300 bg-amber-50 p-2">
          <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} className="mt-0.5" data-testid="checkbox-replace-invoice" />
          Dovoljujem, da osnutek bančnega izpiska nadomesti napačno ustvarjen neknjižen račun, povezan s tem dokumentom.
        </label>
      )}

      {err && <Alert variant="destructive" data-testid="bank-statement-server-error"><AlertDescription>{err?.data?.error ?? err?.message ?? "Potrditev ni uspela."}</AlertDescription></Alert>}

      {saved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="bank-statement-saved">
          <CheckCircle2 className="h-4 w-4" />
          <span>Osnutek temeljnice je shranjen (neknjižen).</span>
          <Link href={`/temeljnice?id=${saved.journalEntryId}`} className="underline font-medium">Odpri temeljnico</Link>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" disabled={!ready} onClick={submit} data-testid="button-confirm-bank">
            {confirm.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Ustvari osnutek temeljnice
          </Button>
        </div>
      )}
    </section>
  );
}
