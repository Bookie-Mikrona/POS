import { useCallback, useEffect, useState } from "react";
import { getEnotaId } from "@workspace/api-client-react";
import { listOrderOutbox, replayOrderOutbox, type OrderOutboxOperation } from "@/lib/orderOutbox";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";

export function useOrderOutbox() {
  const [operations, setOperations] = useState<OrderOutboxOperation[]>([]);
  const gateway = useGatewayOfflineContext();
  const refresh = useCallback(() => { void listOrderOutbox().then(setOperations).catch(() => setOperations([])); }, []);
  const sync = useCallback(async () => {
    if (!gateway.cloudHealthy) return;
    const enotaId = getEnotaId();
    const headers: Record<string, string> = {};
    if (enotaId) headers["X-Enota-Id"] = enotaId;
    setOperations(await replayOrderOutbox(headers));
  }, [gateway.cloudHealthy]);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => void sync(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh, sync]);
  return { operations, refresh, sync, online: gateway.cloudHealthy };
}

/** Explicit name used by POS shells that surface synchronization state. */
export const usePosOutboxSync = useOrderOutbox;