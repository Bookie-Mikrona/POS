import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import {
  isLocalFiscalServiceEnabled,
  listSealedOfflineReceipts,
  syncOfflineFiscalReceipts,
  type SealedOfflineReceipt,
} from "@/lib/offlineFiscal";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";

export function OfflineFiscalQueueStatus() {
  const [receipts, setReceipts] = useState<SealedOfflineReceipt[]>([]);
  const [error, setError] = useState<string>();
  const gateway = useGatewayOfflineContext();
  const enabled = isLocalFiscalServiceEnabled();
  const refresh = useCallback(() => {
    if (!enabled) {
      setReceipts([]);
      setError(undefined);
      return;
    }
    void listSealedOfflineReceipts().then(setReceipts).catch(() => setReceipts([]));
  }, [enabled]);
  const sync = useCallback(async () => {
    if (!enabled || !gateway.cloudHealthy) return;
    try {
      setReceipts(await syncOfflineFiscalReceipts());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sinhronizacija ni uspela.");
      refresh();
    }
  }, [enabled, refresh, gateway.cloudHealthy]);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(() => void sync(), 15_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh, sync]);
  if (!enabled) return null;
  const open = receipts.filter(receipt => receipt.fursState !== "confirmed");
  if (!open.length && !error) return null;
  const overdue = open.some(receipt => receipt.submissionDeadlineAt && new Date(receipt.submissionDeadlineAt) < new Date());
  const unknown = open.some(receipt => receipt.fursState === "unknown");
  const counts = (["received", "finalizing", "pending", "failed", "unknown", "confirmed"] as const)
    .map(state => [state, receipts.filter(receipt => receipt.fursState === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${state}: ${count}`)
    .join(" · ");
  const eorCount = receipts.filter(receipt => Boolean(receipt.eor)).length;
  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm border-b ${overdue || unknown ? "bg-red-50 border-red-200 text-red-900" : "bg-amber-50 border-amber-200 text-amber-900"}`} data-testid="offline-fiscal-pending">
      {!gateway.cloudHealthy ? <CloudOff className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="flex-1 font-medium">
        {error ?? (unknown ? "Offline račun zahteva ročno uskladitev; samodejna ponovitev ni dovoljena." : `${open.length} offline gotovinskih računov čaka na prenos${overdue ? " (rok je potekel)" : ""}.`)}
        {!error && counts && <span className="ml-2 font-normal">({counts})</span>}
        {!error && eorCount > 0 && <span className="ml-2 font-normal">EOR: {eorCount}</span>}
      </span>
      {gateway.cloudHealthy && !unknown && (
        <button type="button" onClick={() => void sync()} className="text-xs font-medium underline underline-offset-2">
          <RefreshCw className="mr-1 inline h-3 w-3" />Prenesi
        </button>
      )}
    </div>
  );
}