import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadPosMonthlyInvoiceEslog, getPosMonthlyInvoiceBizbox, sendPosMonthlyInvoiceBizbox,
  checkPosMonthlyInvoiceBizbox, type PosMonthlyInvoiceBizbox } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const labels: Record<PosMonthlyInvoiceBizbox["state"], string> = {
  not_sent: "Ni oddan", sending: "Oddaja v teku", failed: "Prijava ni uspela",
  unknown: "Izid ni znan – preverite v bizBoxu", submitted: "Oddan",
  processing: "V obdelavi", delivered: "Dostavljen", rejected: "Zavrnjen",
};
function errorMessage(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || "Dejanja ni bilo mogoče izvesti.";
}
export function MonthlyInvoiceEdelivery({ id, number, recipient, request, scope }: {
  id: string; number: string; recipient: string; request: RequestInit; scope: readonly string[];
}) {
  const client = useQueryClient();
  const key = ["monthly-invoice-bizbox", id, ...scope];
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [xmlBusy, setXmlBusy] = useState(false);
  const status = useQuery({ queryKey: key, queryFn: ({ signal }) => getPosMonthlyInvoiceBizbox(id, { ...request, signal }),
    retry: false, staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 });
  const send = useMutation({
    mutationFn: () => sendPosMonthlyInvoiceBizbox(id, request),
    onSuccess: s => { client.setQueryData(key, s); setConfirm(false); setError(""); },
    onError: e => { setConfirm(false); setError(errorMessage(e)); void status.refetch(); },
  });
  const check = useMutation({
    mutationFn: () => checkPosMonthlyInvoiceBizbox(id, request),
    onSuccess: s => { client.setQueryData(key, s); setError(""); },
    onError: e => setError(errorMessage(e)),
  });
  const state = status.data?.state;
  const busy = send.isPending || check.isPending || xmlBusy;
  const canSend = state === "not_sent" || state === "failed";
  async function download() {
    setXmlBusy(true); setError("");
    try {
      const xml = await downloadPosMonthlyInvoiceEslog(id, request);
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url;
      a.download = `eracun-${number.replace(/[^\w.-]/g, "_")}.xml`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(errorMessage(e)); }
    finally { setXmlBusy(false); }
  }
  return <div className="w-full space-y-2 border-t pt-2" data-testid={`monthly-edelivery-${id}`}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={download} disabled={busy}>Prenesi e-SLOG</Button>
      <span aria-live="polite">bizBox: {state ? labels[state] : status.isError ? "Status ni na voljo" : "Nalagam…"}</span>
      {status.data?.environment && <span className="rounded bg-muted px-2 py-1">{status.data.environment === "test" ? "Testno okolje" : "Produkcija"}</span>}
      {canSend && <Button size="sm" variant="outline" onClick={() => { setConfirm(true); setError(""); }} disabled={busy}>
        {state === "failed" ? "Ponovi prijavo in oddajo" : "Pošlji prek bizBox"}
      </Button>}
      {!!status.data?.documentId && !["delivered", "rejected"].includes(state!) && <Button size="sm" variant="outline"
        onClick={() => check.mutate()} disabled={busy}>Preveri dostavo</Button>}
      {status.isError && <Button size="sm" variant="outline" onClick={() => status.refetch()}>Osveži status</Button>}
    </div>
    {status.data?.documentId && <p className="break-all text-xs text-muted-foreground">ID bizBox: {status.data.documentId}</p>}
    {status.data?.message && <p className="text-xs text-amber-800" role="status">{status.data.message}</p>}
    {state === "unknown" && <p className="break-all text-xs text-muted-foreground">Zunanja referenca: {status.data?.externalId}. Ponovno pošiljanje je blokirano.</p>}
    {confirm && canSend && <div className="space-y-2 rounded border border-orange-200 bg-orange-50 p-3 text-sm">
      <p>Pošljem račun <strong>{number}</strong> prejemniku <strong>{recipient}</strong> prek povezave bizBox,
        določene v nastavitvah aktivnega podjetja? To je zunanja oddaja že izdanega dokumenta. Testni račun se lahko pošlje samo v testno okolje.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => send.mutate()} disabled={busy}>{send.isPending ? "Pošiljam…" : "Potrdi oddajo"}</Button>
        <Button size="sm" variant="outline" onClick={() => setConfirm(false)} disabled={busy}>Prekliči</Button>
      </div>
    </div>}
    {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
  </div>;
}