import { useEffect } from "react";

/** Check only the unresolved payments, never the full payment history. */
export function useBankPostingRefresh(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  paymentIds: string[],
  onPosted: (paymentIds: Set<string>) => void,
) {
  const idsKey = JSON.stringify([...new Set(paymentIds)].sort());
  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    if (!userId || !companyId || !ids.length) return;
    let disposed = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const posted = new Set<string>();
      // Sequential requests bound concurrency to one; a later focus supersedes
      // this pass even if the transport does not honour cancellation.
      for (const id of ids) {
        try {
          const response = await fetch(`/api/companies/${companyId}/payments/${id}`, {
            signal: request.signal,
            cache: "no-store",
          });
          if (disposed || request.signal.aborted) return;
          if (!response.ok) continue;
          const payment = await response.json();
          if (payment.id === id && payment.status === "posted") posted.add(id);
        } catch {
          // An unavailable status is not evidence that posting succeeded.
        }
        if (disposed || request.signal.aborted) return;
      }
      if (!disposed && !request.signal.aborted && posted.size) onPosted(posted);
    };
    void refresh();
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
