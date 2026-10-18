import { createElement, type ReactNode, useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  checkLocalGateway,
  getLocalGatewayConfig,
  gatewayPosService,
  GatewayConflictError,
  isLocalGatewayAuthorityEnabled,
  probeCloudApiReachability,
  type GatewayLease,
  type GatewayHealth,
  type GatewayOrderSnapshot,
  type GatewayScope,
} from "@/lib/gatewayClient";

export type GatewayAuthority = "CLOUD" | "GATEWAY";
export type GatewayOfflineState = {
  scope: GatewayScope | null;
  mode: "cloud" | "gateway";
  effectiveAuthority: GatewayAuthority;
  enabled: boolean;
  healthy: boolean;
  cloudHealthy: boolean;
  snapshot: { orders: Array<Record<string, unknown>>; tables: Array<Record<string, unknown>>;
    kdsJobs: Array<Record<string, unknown>>; lastEventSeq: number } | null;
  watermark: number;
  pendingEventCount: number;
  pendingLocalEvents: number;
  cloudBlocked: boolean;
  blockedReview?: GatewayHealth["blockedReview"];
  primed: boolean;
  primeVersion: number;
  pinnedOrderIds: ReadonlySet<string>;
  error?: string;
};

const empty: GatewayOfflineState = {
  scope: null, mode: "cloud", effectiveAuthority: "CLOUD", enabled: false,
  healthy: false, cloudHealthy: true, snapshot: null, watermark: 0,
  pendingEventCount: 0, pendingLocalEvents: 0, primed: false, primeVersion: 0,
  pinnedOrderIds: new Set(), cloudBlocked: false,
};
let state = empty;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pollingScope: GatewayScope | null = null;
let scopeGeneration = 0;
type AuthorityLatch = { authority: GatewayAuthority; releasePending: boolean };
const latchKey = (scope: GatewayScope) => `bookie.gateway.authority.${scope.companyId}.${scope.enotaId}`;
const readLatch = (scope: GatewayScope): AuthorityLatch | null => {
  try { const raw = localStorage.getItem(latchKey(scope)); return raw ? JSON.parse(raw) as AuthorityLatch : null; } catch { return null; }
};
const writeLatch = (scope: GatewayScope, latch: AuthorityLatch) => {
  try { localStorage.setItem(latchKey(scope), JSON.stringify(latch)); } catch { /* storage is optional */ }
};
const clearLatch = (scope: GatewayScope) => { try { localStorage.removeItem(latchKey(scope)); } catch { /* noop */ } };
export function gatewayAuthorityLatched(scope: GatewayScope): boolean {
  return readLatch(scope)?.authority === "GATEWAY";
}
export function latchGatewayAuthority(scope: GatewayScope): void {
  writeLatch(scope, { authority: "GATEWAY", releasePending: false });
}
/** Only a verified gateway release may call this function. */
export function clearGatewayAuthorityLatch(scope: GatewayScope): void {
  clearLatch(scope);
}
type LatestProjection = { version: number; projection: GatewayOrderSnapshot };
const latestProjections = new Map<string, LatestProjection>();
const writeQueues = new Map<string, Promise<unknown>>();
const emit = () => listeners.forEach(listener => listener());
const setState = (patch: Partial<GatewayOfflineState>) => { state = { ...state, ...patch }; emit(); };
export type GatewayScopeToken = { companyId: string; enotaId: string; generation: number };
export function captureCurrentScopeToken(): GatewayScopeToken {
  return { companyId: String(state.scope?.companyId ?? ""), enotaId: String(state.scope?.enotaId ?? ""), generation: scopeGeneration };
}
export function isCurrent(token: GatewayScopeToken): boolean {
  return token.generation === scopeGeneration &&
    token.companyId === String(state.scope?.companyId ?? "") &&
    token.enotaId === String(state.scope?.enotaId ?? "");
}
function staleScopeError(): Error { return new Error("Gateway operacija je zastarela zaradi menjave poslovne enote."); }

export function normalizeLatestProjection(order: Record<string, unknown>): LatestProjection {
  const raw = order;
  const source = raw.projection && typeof raw.projection === "object"
    ? raw.projection as GatewayOrderSnapshot : raw as GatewayOrderSnapshot;
  const rawCloudOrderId = source.cloudOrderId ?? raw.cloudOrderId;
  const projection = {
    ...source,
    orderId: String(source.orderId ?? raw.orderId),
    cloudOrderId: rawCloudOrderId == null || !Number.isFinite(Number(rawCloudOrderId))
      ? null : Number(rawCloudOrderId),
  } as GatewayOrderSnapshot;
  return { version: Number(raw.version ?? 0), projection };
}

export function selectEffectiveAuthority(input: {
  enabled: boolean; cloudHealthy: boolean; gatewayHealthy: boolean;
  pinnedOrderIds?: ReadonlySet<string>;
  hasOpenLocalOrders?: boolean; pendingLocalEvents?: number;
  authorityMode?: GatewayAuthority;
}): GatewayAuthority {
  if (input.enabled && input.gatewayHealthy &&
      (input.authorityMode === "GATEWAY" || input.hasOpenLocalOrders || (input.pendingLocalEvents ?? 0) > 0 ||
       !!input.pinnedOrderIds?.size)) return "GATEWAY";
  return input.enabled && !input.cloudHealthy && input.gatewayHealthy ? "GATEWAY" : "CLOUD";
}

function scopeFor(user: { companyId?: string; enotaId?: number } | null | undefined): GatewayScope | null {
  return user?.companyId && user.enotaId != null ? { companyId: user.companyId, enotaId: user.enotaId } : null;
}

export function configureScope(scope: GatewayScope | null): void {
  scopeGeneration++;
  pollingScope = scope;
  latestProjections.clear(); writeQueues.clear();
  const paired = !!scope && !!getLocalGatewayConfig();
  const latched = !!scope && gatewayAuthorityLatched(scope);
  state = {
    ...empty, scope, enabled: isLocalGatewayAuthorityEnabled(),
    effectiveAuthority: paired || latched ? "GATEWAY" : "CLOUD",
    mode: paired || latched ? "gateway" : "cloud",
    cloudBlocked: paired || latched,
  };
  emit();
}

async function poll(scope: GatewayScope, generation = scopeGeneration): Promise<void> {
  const current = () => generation === scopeGeneration && pollingScope?.companyId === scope.companyId &&
    String(pollingScope.enotaId) === String(scope.enotaId);
  const latch = readLatch(scope);
  const enabled = isLocalGatewayAuthorityEnabled();
  const paired = !!getLocalGatewayConfig();
  if (!paired) {
    const latched = gatewayAuthorityLatched(scope);
    if (current()) setState({ enabled: false, healthy: false, mode: latched ? "gateway" : "cloud",
      effectiveAuthority: latched ? "GATEWAY" : "CLOUD", cloudBlocked: latched,
      error: latched ? "Gateway pairing manjka; varnostna zapora ostaja aktivna." : undefined });
    return;
  }
  const [cloudHealthy, gateway] = await Promise.all([probeCloudApiReachability(), checkLocalGateway()]);
  if (!current()) return;
  if (!gateway.online) {
    latchGatewayAuthority(scope);
    const sticky = true;
    setState({ enabled: true, healthy: false, cloudHealthy, mode: sticky ? "gateway" : "cloud",
      effectiveAuthority: sticky ? "GATEWAY" : "CLOUD", cloudBlocked: sticky,
      error: sticky ? "LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano" : gateway.reason });
    return;
  }
  const confirmedAuthority = gateway.health?.authorityMode;
  if (confirmedAuthority !== "CLOUD" && confirmedAuthority !== "GATEWAY") {
    latchGatewayAuthority(scope);
    setState({ enabled, healthy: false, cloudHealthy, mode: "gateway", effectiveAuthority: "GATEWAY",
      cloudBlocked: true, error: "LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano" });
    return;
  }
  if (!enabled && confirmedAuthority === "GATEWAY") {
    writeLatch(scope, { authority: "GATEWAY", releasePending: false });
    setState({ enabled: false, healthy: true, cloudHealthy, mode: "gateway", effectiveAuthority: "GATEWAY",
      cloudBlocked: true, error: "LAN gateway je aktiven; vklopite ga za nadaljevanje." });
    return;
  }
  try {
    const snapshot = await gatewayPosService(scope).snapshot();
    if (!current()) return;
    for (const order of snapshot.orders) {
      const normalized = normalizeLatestProjection(order as Record<string, unknown>);
      latestProjections.set(String(normalized.projection.orderId), normalized);
    }
    snapshot.orders = snapshot.orders.map(order => {
      const normalized = normalizeLatestProjection(order as Record<string, unknown>);
      return { ...order, orderId: String(order.orderId ?? normalized.projection.orderId),
        projection: normalized.projection };
    });
    const pendingLocalEvents = gateway.health?.pendingEventCount ?? 0;
    // Cloud is always preferred while healthy. GATEWAY is entered only after
    // an explicit enabled setting and a confirmed cloud health failure.
    const gatewayAuthority = selectEffectiveAuthority({
      enabled, cloudHealthy, gatewayHealthy: true, pinnedOrderIds: state.pinnedOrderIds,
      hasOpenLocalOrders: gateway.health?.hasOpenLocalOrders ??
        snapshot.orders.some(order => String((order as any).state ?? "").toUpperCase() === "OPEN"),
      pendingLocalEvents: gateway.health?.pendingLocalEvents ?? pendingLocalEvents,
      authorityMode: gateway.health?.authorityMode,
    });
    const confirmed = gateway.health?.authorityMode;
    if (confirmed === "GATEWAY") latchGatewayAuthority(scope);
    const sticky = gatewayAuthorityLatched(scope);
    setState({
      enabled: true, healthy: true, cloudHealthy, snapshot, watermark: snapshot.lastEventSeq,
      pendingEventCount: pendingLocalEvents, pendingLocalEvents,
      blockedReview: gateway.health?.blockedReview,
      effectiveAuthority: sticky ? "GATEWAY" : gatewayAuthority,
      mode: sticky || gatewayAuthority === "GATEWAY" ? "gateway" : "cloud",
      cloudBlocked: sticky,
      error: undefined,
    });
  } catch (error) {
    if (!current()) return;
    const sticky = readLatch(scope)?.authority === "GATEWAY";
    setState({ enabled: true, healthy: false, cloudHealthy, mode: sticky ? "gateway" : "cloud",
      effectiveAuthority: sticky ? "GATEWAY" : "CLOUD", cloudBlocked: sticky,
      error: sticky ? "LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano" :
        (error instanceof Error ? error.message : "Gateway ni dosegljiv.") });
  }
}

export function GatewayOfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const scope = scopeFor(user);
  useLayoutEffect(() => { configureScope(scope); }, [scope?.companyId, scope?.enotaId]);
  useEffect(() => {
    if (!scope) return;
    void poll(scope, scopeGeneration);
    if (!pollTimer) pollTimer = setInterval(() => {
      if (pollingScope) void poll(pollingScope, scopeGeneration);
    }, 3000);
    return () => {
      // The provider is mounted once in App. Do not let a page unmount stop it.
      if (pollingScope?.companyId === scope.companyId && String(pollingScope.enotaId) === String(scope.enotaId)) {
        pollingScope = null;
      }
    };
  }, [scope?.companyId, scope?.enotaId]);
  return createElement("div", { style: { display: "contents" } }, children);
}

function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function useGatewayOfflineContext() {
  const current = useSyncExternalStore(subscribe, () => state, () => empty);
  const scope = current.scope;
  const service = scope ? gatewayPosService(scope) : null;
  const pinOrder = useCallback((orderId: string, token?: GatewayScopeToken) => {
    if (token && !isCurrent(token)) return;
    const pinned = new Set(state.pinnedOrderIds); pinned.add(orderId);
    setState({ pinnedOrderIds: pinned });
  }, []);
  const unpinOrder = useCallback((orderId: string, token?: GatewayScopeToken) => {
    if (token && !isCurrent(token)) return;
    const pinned = new Set(state.pinnedOrderIds); pinned.delete(orderId);
    setState({ pinnedOrderIds: pinned });
  }, []);
  const prime = useCallback(async (tables: Array<Record<string, unknown>>, orders: Array<Record<string, unknown>>,
                                  managerConfirmed = false) => {
    const token = captureCurrentScopeToken();
    if (!service || state.primed || state.pendingLocalEvents > 0 && !managerConfirmed) return;
    const result = await service.prime(tables, orders, managerConfirmed);
    if (!isCurrent(token)) throw staleScopeError();
    setState({ primed: true, primeVersion: state.watermark, pendingLocalEvents: 0 });
    return result;
  }, [service]);
  const openOrder = useCallback(async (payload: Record<string, unknown>) => {
    const token = captureCurrentScopeToken();
    if (!service) throw new Error("POS scope ni na voljo.");
    if (state.cloudBlocked && !state.healthy) throw new Error("LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano");
    const result = await service.openOrder(payload);
    if (!isCurrent(token)) throw staleScopeError();
    latestProjections.set(String(result.orderId), {
      version: result.version, projection: result.projection as unknown as GatewayOrderSnapshot,
    });
    pinOrder(String(result.orderId), token);
    setState({ snapshot: state.snapshot ? { ...state.snapshot,
      orders: [...state.snapshot.orders, { orderId: result.orderId, version: result.version,
        projection: result.projection, state: "OPEN" }] } : state.snapshot });
    return result;
  }, [service, pinOrder]);
  const replaceOrder = useCallback(async (
    reducer: (snapshot: GatewayOrderSnapshot) => GatewayOrderSnapshot,
    lease: GatewayLease,
  ) => {
    const token = captureCurrentScopeToken();
    if (!service) throw new Error("POS scope ni na voljo.");
    if (state.cloudBlocked && !state.healthy) throw new Error("LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano");
    const orderId = String(lease.orderId);
    const previous = writeQueues.get(orderId) ?? Promise.resolve();
    const task = previous.then(async () => {
      if (!isCurrent(token)) throw staleScopeError();
      const latest = latestProjections.get(orderId) ?? (() => {
        const wrapper = state.snapshot?.orders.find(order => String(order.orderId) === orderId);
        if (!wrapper) return undefined;
        return normalizeLatestProjection(wrapper as Record<string, unknown>);
      })();
      if (!latest) throw new Error("Gateway projekcija naročila ni na voljo.");
      const result = await service.replaceOrder(reducer(latest.projection), {
        ...lease, version: latest.version,
      });
      if (!isCurrent(token)) throw staleScopeError();
      latestProjections.set(orderId, {
        version: result.version, projection: result.projection as unknown as GatewayOrderSnapshot,
      });
       pinOrder(orderId, token);
      setState({ snapshot: state.snapshot ? { ...state.snapshot,
        orders: state.snapshot.orders.map(order => String(order.orderId) === orderId
          ? { ...order, version: result.version, projection: result.projection } : order) } : state.snapshot });
      return result;
    });
    writeQueues.set(orderId, task.catch(() => undefined));
    void task.finally(() => {
      if (writeQueues.get(orderId) === task && isCurrent(token)) writeQueues.delete(orderId);
    });
    return task;
  }, [service, pinOrder]);
  const acquireLease = useCallback(async (orderId: string, version: number, leaseSeconds = 120,
                                    forceTransfer = false, approvalCode?: string) => {
    const token = captureCurrentScopeToken();
    if (!service) throw new Error("POS scope ni na voljo.");
    if (state.cloudBlocked && !state.healthy) throw new Error("LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano");
    const result = await service.acquireLease(orderId, version, leaseSeconds, forceTransfer, approvalCode);
    if (!isCurrent(token)) throw staleScopeError();
    return result;
  }, [service]);
  const releaseLease = useCallback(async (lease: GatewayLease) => {
    const token = captureCurrentScopeToken();
    if (!service) throw new Error("POS scope ni na voljo.");
    if (state.cloudBlocked && !state.healthy) throw new Error("LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano");
    const result = await service.releaseLease(lease);
    if (!isCurrent(token)) throw staleScopeError();
    return result;
  }, [service]);
  const renewLease = useCallback(async (lease: GatewayLease, leaseSeconds = 120) => {
    const token = captureCurrentScopeToken();
    if (!service) throw new Error("POS scope ni na voljo.");
    if (state.cloudBlocked && !state.healthy) throw new Error("LAN gateway ni dosegljiv; cloud zapisovanje ostaja blokirano");
    const result = await service.renewLease(lease, leaseSeconds);
    if (!isCurrent(token)) throw staleScopeError();
    return result;
  }, [service]);
  const authorityForOrder = useCallback((orderId: string): GatewayAuthority =>
    state.pinnedOrderIds.has(orderId) ? "GATEWAY" : state.effectiveAuthority, []);
  return { ...current, openOrder, replaceOrder, acquireLease, renewLease, releaseLease, prime, pinOrder, unpinOrder,
    authorityForOrder, isConflict: (error: unknown) => error instanceof GatewayConflictError };
}

export type GatewayOfflineContext = ReturnType<typeof useGatewayOfflineContext>;