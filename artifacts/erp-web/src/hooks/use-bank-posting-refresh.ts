import { useEffect, useRef } from "react";
import { getPaymentStatuses } from "@workspace/api-client-react";

/** Read only requested, explicitly posted IDs in company-scoped bounded batches. */
export async function postedPaymentIds(companyId: string, paymentIds: string[], signal?: AbortSignal): Promise<Set<string>> {
  const ids = [...new Set(paymentIds)];
  const posted = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    signal?.throwIfAborted();
    const batch = ids.slice(offset, offset + 500);
    const result = await getPaymentStatuses(companyId, { paymentIds: batch }, { signal, cache: "no-store" });
    signal?.throwIfAborted();
    for (const payment of result.payments) {
      if (payment.status === "posted" && batch.includes(payment.id)) posted.add(payment.id);
    }
  }
  return posted;
}

/** Check only the unresolved payments, never the full payment history. */
export function useBankPostingRefresh(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  paymentIds: string[],
  onPosted: (paymentIds: Set<string>) => void,
) {
  const idsKey = JSON.stringify([...new Set(paymentIds)].sort());
  const checkedRef = useRef<{ userId: string; companyId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    if (!userId || !companyId || !ids.length) {
      checkedRef.current = null;
      return;
    }
    let disposed = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const posted = await postedPaymentIds(companyId, ids, request.signal);
        if (!disposed && !request.signal.aborted) {
          checkedRef.current = { userId, companyId, ids: new Set(ids) };
          if (posted.size) onPosted(posted);
        }
      } catch {
        // An unavailable status is not evidence that posting succeeded.
      }
    };
    const checked = checkedRef.current;
    // Clearing the confirmed IDs is not a new check: do not immediately send
    // another batch for the remaining drafts. Focus/visibility still refresh.
    if (!checked || checked.userId !== userId || checked.companyId !== companyId ||
        ids.some(id => !checked.ids.has(id))) void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId, companyId, idsKey, onPosted]);
}
