import { formatEur } from "@/lib/formatEur";
import { useRef, useState } from "react";
import {
  getListFursAttemptsQueryKey,
  getListRacuniQueryKey,
  useListCardPaymentAttempts,
  useListFursAttempts,
  useRetryFursBatch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export type FursUiState = "pending" | "sending" | "confirmed" | "failed" | "unknown";

export function classifyFursReceipt(receipt: { status?: string | null; eor?: string | null; zoi?: string | null }): FursUiState {
  if (receipt.eor) return "confirmed";
  if (receipt.status === "napaka") return "failed";
  if (receipt.zoi) return "sending";
  return "unknown";
}

/** A synchronous lock for event handlers, before React can render disabled state. */
export function createRetryGuard() {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    release: () => { claimed = false; },
  };
}

const stateLabel: Record<FursUiState, string> = {
  pending: "Čaka",
  sending: "Pošiljanje",
  confirmed: "Potrjeno",
  failed: "Neuspelo",
  unknown: "Neznano",
};

const stateClass: Record<FursUiState, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800",
  sending: "border-blue-300 bg-blue-50 text-blue-800",
  confirmed: "border-green-300 bg-green-50 text-green-800",
  failed: "border-red-300 bg-red-50 text-red-800",
  unknown: "border-slate-300 bg-slate-50 text-slate-700",
};

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" }) : "—";
}

export function FursStateBadge({ state, testId }: { state: FursUiState; testId?: string }) {
  return <Badge data-testid={testId} variant="outline" className={stateClass[state]}>{stateLabel[state]}</Badge>;
}

export function ReliabilityPanels() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [fursOpen, setFursOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [fursState, setFursState] = useState<"" | FursUiState>("");
  const [provider, setProvider] = useState<"" | "payten" | "sumup" | "viva_smart" | "viva_terminal">("");
  const [cardStatus, setCardStatus] = useState<"" | "reserved" | "pending" | "completed" | "failed" | "unknown">("");
  const retrying = useRef(createRetryGuard());
  const [batchResult, setBatchResult] = useState<{ skupaj: number; uspesno: number; neuspesno: number; racuni: { id: number; stevilkaRacuna: string; uspeh: boolean; eor?: string | null; napaka?: string | null }[] } | null>(null);
  const fursParams = fursState ? { state: fursState } : undefined;
  const cardParams = {
    ...(provider ? { provider } : {}),
    ...(cardStatus ? { status: cardStatus } : {}),
  };
  const furs = useListFursAttempts(fursParams);
  const cards = useListCardPaymentAttempts(cardParams);
  const retry = useRetryFursBatch();
  const failedCount = furs.data?.items.filter(item => item.state === "failed").length ?? 0;

  function retryFailed() {
    // React state updates are asynchronous; this ref closes the same-tick double-click gap.
    if (retry.isPending || !retrying.current.claim()) return;
    retry.mutate(undefined, {
      onSuccess: (result) => {
        setBatchResult(result);
        queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFursAttemptsQueryKey() });
        toast({ title: "Ponovni poskus FURS zaključen", description: `Uspešno: ${result.uspesno}, neuspešno: ${result.neuspesno}.` });
      },
      onError: () => toast({ title: "Ponovni poskus ni uspel", description: "Preverite dnevnik FURS.", variant: "destructive" }),
      onSettled: () => { retrying.current.release(); },
    });
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="panel-payment-reliability">
      <Button type="button" variant="outline" size="sm" onClick={() => setFursOpen(true)} data-testid="button-open-furs-audit" className="gap-1.5">
        <Send className="h-3.5 w-3.5" /> FURS dnevnik
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setCardOpen(true)} data-testid="button-open-card-attempts" className="gap-1.5">
        <CreditCard className="h-3.5 w-3.5" /> Kartična plačila
      </Button>

      <Dialog open={fursOpen} onOpenChange={setFursOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>FURS revizijski dnevnik</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Stanje
              <select data-testid="select-furs-state" className="ml-2 h-9 rounded-md border bg-background px-2" value={fursState} onChange={e => setFursState(e.target.value as "" | FursUiState)}>
                <option value="">Vsa stanja</option>
                {Object.entries(stateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Button type="button" size="sm" onClick={retryFailed} disabled={retry.isPending || failedCount === 0} data-testid="button-retry-furs-batch" className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${retry.isPending ? "animate-spin" : ""}`} /> Ponovi neuspele za trenutno enoto
            </Button>
            <span className="text-xs text-muted-foreground">Ponovi vse upravičene neuspele račune enote, ne izbranih vrstic. Neznanih stanj ne ponavlja.</span>
          </div>
          {batchResult && <div data-testid="furs-batch-result" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
            Obdelano: {batchResult.skupaj}; uspešno: {batchResult.uspesno}; neuspešno: {batchResult.neuspesno}.
            <ul className="mt-1 list-disc pl-5">{batchResult.racuni.map(item => <li key={item.id}>{item.stevilkaRacuna}: {item.uspeh ? `potrjeno${item.eor ? ` (${item.eor})` : ""}` : item.napaka ?? "neuspelo"}</li>)}</ul>
          </div>}
          {furs.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Nalaganje dnevnika FURS…</p> : furs.data?.items.length ? (
            <div className="overflow-x-auto border rounded-md"><table className="w-full text-left text-xs">
              <thead className="bg-muted text-muted-foreground"><tr><th className="p-2">Račun</th><th>Stanje</th><th>ZOI / EOR</th><th>Poskusi</th><th>Zadnji akter</th><th>Napaka</th><th>Append-only poskusi</th></tr></thead>
              <tbody>{furs.data.items.map(item => <tr key={item.id} className="border-t align-top" data-testid={`furs-audit-row-${item.id}`}>
                <td className="p-2 font-mono">{item.stevilkaRacuna ?? `#${item.id}`}</td><td><FursStateBadge state={item.state} testId={`status-furs-${item.id}`} /></td>
                <td className="font-mono">{item.zoi ?? "—"}<br />{item.eor ?? "—"}</td><td>{item.attempts}</td><td>{item.retryActor ?? "—"}</td><td className="max-w-48 break-words text-red-700">{item.lastError ?? "—"}</td>
                <td className="p-2">{item.attemptLedger?.length ? <details><summary>{item.attemptLedger.length} zapisov</summary>{item.attemptLedger.map(log => <div key={log.id} className="mt-1 border-t pt-1"><span>{date(log.startedAt)} – {date(log.finishedAt)}</span><br /><span>{log.outcome ?? "v teku"} · {log.actor}</span>{log.rawError && <><br /><span className="text-red-700">{log.rawError}</span></>}</div>)}</details> : "—"}</td>
              </tr>)}</tbody>
            </table></div>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Za izbrano stanje ni zapisov FURS.</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={cardOpen} onOpenChange={setCardOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Zgodovina poskusov kartičnih plačil</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Ponudnik" data-testid="select-card-provider" className="h-9 rounded-md border bg-background px-2" value={provider} onChange={e => setProvider(e.target.value as typeof provider)}><option value="">Vsi ponudniki</option><option value="payten">Payten</option><option value="sumup">SumUp</option><option value="viva_smart">Viva Smart</option><option value="viva_terminal">Viva Terminal</option></select>
            <select aria-label="Status" data-testid="select-card-status" className="h-9 rounded-md border bg-background px-2" value={cardStatus} onChange={e => setCardStatus(e.target.value as typeof cardStatus)}><option value="">Vsi statusi</option>{["reserved", "pending", "completed", "failed", "unknown"].map(value => <option key={value} value={value}>{value}</option>)}</select>
          </div>
          {cards.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Nalaganje poskusov plačil…</p> : cards.data?.items.length ? <div className="overflow-x-auto border rounded-md"><table className="w-full text-left text-xs">
            <thead className="bg-muted text-muted-foreground"><tr><th className="p-2">Ponudnik / status</th><th>Znesek</th><th>Naročilo / račun</th><th>Referenca</th><th>Akter / naprava</th><th>Čas</th><th>Poskusi / napaka</th></tr></thead>
            <tbody>{cards.data.items.map(item => <tr key={item.id} className="border-t align-top" data-testid={`card-attempt-row-${item.id}`}><td className="p-2 font-medium">{item.provider}<br /><Badge variant="outline">{item.status}</Badge>{item.providerRawStatus && <div className="mt-1 text-muted-foreground">raw: {item.providerRawStatus}</div>}</td><td>{formatEur(Number(item.znesek))}</td><td>{item.narociloId ? `Naročilo #${item.narociloId}` : "—"}<br />{item.receiptId ? `Račun #${item.receiptId}` : "—"}</td><td className="font-mono break-all">{item.providerReferenca ?? "—"}</td><td>{item.actor ?? "—"}<br />{item.deviceKey ?? "—"}</td><td>{date(item.ustvarjeno)}<br />posodobljeno: {date(item.posodobljeno)}</td><td>{item.retryCount ?? 0}{item.napaka && <div className="mt-1 text-red-700">{item.napaka}</div>}</td></tr>)}</tbody>
          </table></div> : <p className="py-8 text-center text-sm text-muted-foreground">Za izbrane filtre ni kartičnih poskusov.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}