/**
 * Explicit Bookie Local Gateway client.
 *
 * This module is intentionally isolated from the existing fiscal authority.
 * It never intercepts global fetch calls and never chooses a fiscal authority
 * automatically.  An operator must configure a LAN URL and pair this device.
 */

const CONFIG_KEY = "bookie.local-gateway.config";
const MAX_BODY_BYTES = 64 * 1024;
const SECRET_DB = "bookie-pos-offline-fiscal";
const SECRET_STORE = "gatewaySecrets";
const ENABLED_KEY = "bookie.local-gateway.enabled";
const AUTHORITY_ENABLED_KEY = "bookie.local-gateway.authority-enabled";

export type GatewayConfig = {
  baseUrl: string;
  clientId: string;
  pairingSecret: string;
};

export type GatewayHealth = {
  service: "Bookie Local Gateway";
  status: string;
  lan: boolean;
  bind: string;
  port: number;
  pendingEventCount: number;
  checkpoint?: number;
  blockedReview?: { reviewId?: string; seq?: number; reason?: string };
  needsReview?: boolean;
  pendingLocalEvents?: number;
  hasOpenLocalOrders?: boolean;
  authorityEpoch?: number;
  authorityMode?: "CLOUD" | "GATEWAY";
  checkedAt: string;
  diagnosticTime: string;
  releaseGeneration?: number;
  deviceId?: string | null;
  tls?: { required: boolean; fingerprintSha256?: string | null };
};

export type GatewayAuthorityStatus = {
  companyId: string;
  enotaId: string;
  authorityMode: "CLOUD" | "GATEWAY";
  releaseGeneration: number;
  openLocalOrders: number;
  pendingEvents: number;
  unresolvedReviews: number;
  leasedJobs: number;
  inFlightFiscalJobs: number;
};

export type GatewayScope = { companyId: string; enotaId: number | string };
/** IDs crossing the gateway boundary are opaque strings (including UUIDs). */
export type EntityId = string;
export type GatewayOrderSnapshot = Record<string, unknown> & {
  orderId: EntityId;
  companyId: string;
  enotaId: number | string;
  status?: string;
  lines?: Array<Record<string, unknown>>;
  postavke?: Array<Record<string, unknown>>;
};

export function localOrderRoute(id: EntityId): string {
  return `local:${encodeURIComponent(id)}`;
}

export function parseLocalOrderRoute(value: string): EntityId | undefined {
  if (!value.startsWith("local:")) return undefined;
  const encoded = value.slice("local:".length);
  try {
    const id = decodeURIComponent(encoded);
    return id && !id.includes("/") ? id : undefined;
  } catch { return undefined; }
}
export type GatewayLease = {
  orderId: string;
  version: number;
  leaseId: string;
  fencingVersion: number;
  leaseUntil: string;
  ownerClientId?: string | null;
};

export class GatewayConflictError extends Error {
  readonly status = 409;
  readonly detail: unknown;
  constructor(detail: unknown) {
    super("Gateway ownership or version conflict.");
    this.name = "GatewayConflictError";
    this.detail = detail;
  }
}

type StoredConfig = Omit<GatewayConfig, "pairingSecret">;

export function normalizeGatewayBaseUrl(input: string, options: { allowLoopbackHttp?: boolean } = {}): string {
  const raw = input.trim();
  if (!raw) throw new Error("LAN gateway URL manjka.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("LAN gateway URL ni veljaven."); }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(options.allowLoopbackHttp && loopback && url.protocol === "http:")) {
    throw new Error("LAN gateway mora uporabljati HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "" &&
      url.pathname.replace(/\/+$/, "") !== "/v1") {
    throw new Error("LAN gateway URL mora biti host:port ali host:port/v1.");
  }
  url.pathname = "/v1";
  url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function gatewayEndpointUrl(baseUrl: string, path: string): string {
  const base = normalizeGatewayBaseUrl(baseUrl, { allowLoopbackHttp: true });
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function readConfigMetadata(): StoredConfig | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null") as StoredConfig | null;
    if (!value?.baseUrl || !value.clientId) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function openSecretDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECRET_DB, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SECRET_STORE)) request.result.createObjectStore(SECRET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Zaščiteni brskalniški pomnilnik ni na voljo."));
  });
}

async function readKey(clientId: string): Promise<CryptoKey | undefined> {
  if (!("indexedDB" in globalThis)) return undefined;
  const database = await openSecretDb();
  try {
    return await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const transaction = database.transaction(SECRET_STORE, "readwrite");
      const objectStore = transaction.objectStore(SECRET_STORE);
      const request = objectStore.get(clientId);
      let value: unknown;
      request.onsuccess = () => {
        value = request.result;
        if (typeof value === "string") objectStore.delete(clientId);
      };
      transaction.oncomplete = () => resolve(typeof CryptoKey !== "undefined" && value instanceof CryptoKey ? value : undefined);
      transaction.onerror = () => reject(transaction.error);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function writeKey(clientId: string, secret: string): Promise<void> {
  if (!("indexedDB" in globalThis)) throw new Error("Za pairing skrivnost je potreben IndexedDB.");
  const database = await openSecretDb();
  try {
    const key = await crypto.subtle.importKey("raw", base64Bytes(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SECRET_STORE, "readwrite");
      // A previous MVP stored a plaintext string. Delete it rather than
      // silently reusing or exposing it.
      transaction.objectStore(SECRET_STORE).put(key, clientId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export async function configureLocalGateway(config: GatewayConfig): Promise<void> {
  const baseUrl = normalizeGatewayBaseUrl(config.baseUrl, { allowLoopbackHttp: true });
  if (new TextEncoder().encode(config.pairingSecret).byteLength < 32) {
    throw new Error("Pairing skrivnost gatewaya je prekratka.");
  }
  const clientId = config.clientId.trim();
  if (!clientId) throw new Error("ID gateway odjemalca manjka.");
  await writeKey(clientId, config.pairingSecret);
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ baseUrl, clientId }));
}

export async function clearLocalGateway(): Promise<void> {
  const config = readConfigMetadata();
  localStorage.removeItem(CONFIG_KEY);
  if (config && "indexedDB" in globalThis) {
    const database = await openSecretDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SECRET_STORE, "readwrite");
        transaction.objectStore(SECRET_STORE).delete(config.clientId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }
}

export function getLocalGatewayConfig(): Omit<GatewayConfig, "pairingSecret"> | undefined {
  const config = readConfigMetadata();
  return config ? { baseUrl: config.baseUrl, clientId: config.clientId } : undefined;
}

export function isLocalGatewayEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1" && !!getLocalGatewayConfig();
}

export function setLocalGatewayAuthorityEnabled(enabled: boolean): void {
  if (enabled) localStorage.setItem(AUTHORITY_ENABLED_KEY, "1");
  else localStorage.removeItem(AUTHORITY_ENABLED_KEY);
}

export function isLocalGatewayAuthorityEnabled(): boolean {
  return localStorage.getItem(AUTHORITY_ENABLED_KEY) === "1" && isLocalGatewayEnabled();
}

export async function issueGatewayCashReceipt<T>(request: unknown): Promise<T> {
  if (!isLocalGatewayAuthorityEnabled()) throw new Error("Bookie Local Gateway ni managersko omogočen.");
  return gatewayFetch<T>("/receipts/cash", {
    method: "POST", body: JSON.stringify(request),
  });
}

export async function probeLocalGateway(baseUrl: string): Promise<GatewayHealth> {
  const url = gatewayEndpointUrl(baseUrl, "/gateway/health");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Bookie Local Gateway ni dosegljiv (${response.status}).`);
  return await response.json() as GatewayHealth;
}

export async function pairLocalGateway(baseUrl: string, code: string, clientName: string): Promise<Omit<GatewayConfig, "pairingSecret">> {
  const root = normalizeGatewayBaseUrl(baseUrl, { allowLoopbackHttp: true });
  const response = await fetch(`${root}/pair`, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), clientName: clientName.trim() }),
  });
  if (!response.ok) throw new Error(await response.text() || "Seznanitev z gatewayem ni uspela.");
  const result = await response.json() as { pairingSecret?: string; clientId?: string; contract?: string };
  if (!result.pairingSecret || !result.clientId || result.contract !== "v1") {
    throw new Error("Gateway je vrnil neveljaven odgovor seznanitve.");
  }
  const config = { baseUrl: root, clientId: result.clientId, pairingSecret: result.pairingSecret };
  await configureLocalGateway(config);
  return { baseUrl: config.baseUrl, clientId: config.clientId };
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function gatewaySignatureInput(method: string, path: string, timestamp: string, nonce: string, bodyHash: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash.toLowerCase()}`;
}

async function sha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function signedHeaders(config: GatewayConfig, key: CryptoKey, method: string, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();
  const bodyHash = await sha256(body);
  const input = gatewaySignatureInput(method, path, timestamp, nonce, bodyHash);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  const signatureHex = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    "Content-Type": "application/json", "X-Bookie-Client-Id": config.clientId,
    "X-Bookie-Timestamp": timestamp,
    "X-Bookie-Nonce": nonce, "X-Bookie-Body-SHA256": bodyHash,
    "X-Bookie-Signature": signatureHex,
  };
}

export async function gatewayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const metadata = readConfigMetadata();
  if (!metadata) throw new Error("Bookie Local Gateway ni konfiguriran ali seznanjen.");
  const key = await readKey(metadata.clientId);
  if (!key) throw new Error("Pairing ključ gatewaya ni na voljo v zaščitenem pomnilniku.");
  const config: GatewayConfig = { ...metadata, pairingSecret: "" };
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new Error("Gateway zahtevek presega dovoljeno velikost.");
  }
  const url = gatewayEndpointUrl(config.baseUrl, path);
  const parsed = new URL(url);
  const relativePath = parsed.pathname + (parsed.search || "");
  const headers = await signedHeaders(config, key, method, relativePath, body);
  const response = await fetch(url, { ...init, method, cache: "no-store", headers: { ...headers, ...(init.headers ?? {}) } });
  if (!response.ok) {
    const text = await response.text();
    let detail: unknown = text || `Gateway napaka (${response.status}).`;
    try { detail = text ? JSON.parse(text) : detail; } catch { /* plain text */ }
    if (response.status === 409) throw new GatewayConflictError(detail);
    const error = new Error(typeof detail === "string" ? detail : `Gateway napaka (${response.status}).`);
    Object.assign(error, { status: response.status, detail });
    throw error;
  }
  return await response.json() as T;
}

export async function checkLocalGateway(): Promise<{ online: boolean; health?: GatewayHealth; reason?: string }> {
  try {
    const health = await gatewayFetch<GatewayHealth>("/gateway/health");
    return { online: true, health };
  } catch (error) {
    return { online: false, reason: error instanceof Error ? error.message : "LAN gateway ni dosegljiv." };
  }
}

export async function releaseGatewayAuthority(scope: GatewayScope): Promise<GatewayAuthorityStatus> {
  return gatewayFetch<GatewayAuthorityStatus>("/gateway/authority/release", {
    method: "POST",
    body: JSON.stringify({ companyId: scope.companyId, enotaId: String(scope.enotaId) }),
  });
}

export async function getGatewayAuthorityStatus(scope: GatewayScope): Promise<GatewayAuthorityStatus> {
  return gatewayFetch<GatewayAuthorityStatus>(
    `/gateway/authority/status?companyId=${encodeURIComponent(scope.companyId)}&enotaId=${encodeURIComponent(String(scope.enotaId))}`,
  );
}

/** Cloud authority probe is deliberately separate from browser connectivity. */
export async function probeCloudApiReachability(path = "/api/healthz"): Promise<boolean> {
  try {
    const response = await fetch(path, { method: "GET", credentials: "include", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function pollLocalGatewayEvents(after = 0, limit = 100): Promise<{
  events: Array<Record<string, unknown>>; after: number; next: number;
}> {
  return gatewayFetch(`/gateway/events?after=${encodeURIComponent(after)}&limit=${encodeURIComponent(limit)}`);
}

export function offlineLanModeMessage(cloudOnline: boolean, gatewayOnline: boolean): string | undefined {
  if (!cloudOnline && gatewayOnline) {
    return "Offline LAN način: Bookie Local Gateway je dosegljiv. Podprte so samo gotovinske operacije; samodejni preklop fiskalne avtoritete ni dovoljen.";
  }
  return undefined;
}

/**
 * Explicit POS collaboration boundary.  Callers select this service only
 * from the supported POS surfaces; it never replaces fetch or cloud hooks.
 */
type GatewayPosService = {
  snapshot: () => Promise<{ scope: GatewayScope; orders: Array<Record<string, unknown>>;
    tables: Array<Record<string, unknown>>; kdsJobs: Array<Record<string, unknown>>; lastEventSeq: number }>;
  openOrder: (payload?: Record<string, unknown>) => Promise<GatewayLease & { projection: GatewayOrderSnapshot }>;
  acquireLease: (orderId: string, expectedVersion: number, leaseSeconds?: number,
    forceTransfer?: boolean, approvalCode?: string) => Promise<GatewayLease>;
  renewLease: (lease: GatewayLease, leaseSeconds?: number) => Promise<GatewayLease>;
  releaseLease: (lease: GatewayLease) => Promise<Record<string, unknown>>;
  replaceOrder: (snapshot: GatewayOrderSnapshot, lease: GatewayLease) =>
    Promise<{ orderId: string; version: number; projection: GatewayOrderSnapshot }>;
  prime: (tables: Array<Record<string, unknown>>, orders: Array<Record<string, unknown>>,
    managerConfirmed?: boolean) => Promise<Record<string, unknown>>;
  kds: (state?: string) => Promise<{ jobs: Array<Record<string, unknown>> }>;
  transitionKds: (jobId: string, transition: "claim" | "start" | "ready" | "complete" | "cancel",
    expectedVersion: number) => Promise<Record<string, unknown>>;
};
const gatewayServiceCache = new Map<string, GatewayPosService>();

export function gatewayPosService(scope: GatewayScope) {
  const cacheKey = `${scope.companyId}:${String(scope.enotaId)}`;
  const cached = gatewayServiceCache.get(cacheKey);
  if (cached) return cached;
  const scoped = (payload: Record<string, unknown> = {}) => ({
    ...payload, companyId: scope.companyId, enotaId: scope.enotaId,
  });
  const service = {
    snapshot: () => gatewayFetch<{
      scope: GatewayScope;
      orders: Array<Record<string, unknown>>;
      tables: Array<Record<string, unknown>>;
      kdsJobs: Array<Record<string, unknown>>;
      lastEventSeq: number;
    }>(`/gateway/v2/snapshot?companyId=${encodeURIComponent(scope.companyId)}&enotaId=${encodeURIComponent(String(scope.enotaId))}`),
    openOrder: (payload: Record<string, unknown> = {}) => gatewayFetch<GatewayLease & { projection: GatewayOrderSnapshot }>(
      "/gateway/v2/orders/open", { method: "POST", body: JSON.stringify(scoped({
        commandId: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: 0, payload,
      })) }),
    acquireLease: (orderId: string, expectedVersion: number, leaseSeconds = 120, forceTransfer = false,
                   approvalCode?: string) =>
      gatewayFetch<GatewayLease>(`/gateway/v2/orders/${encodeURIComponent(orderId)}/lease/acquire`, {
        method: "POST", body: JSON.stringify(scoped({
          commandId: crypto.randomUUID(), orderId, expectedVersion, leaseSeconds, forceTransfer, approvalCode,
        })),
      }),
    renewLease: (lease: GatewayLease, leaseSeconds = 120) =>
      gatewayFetch<GatewayLease>(`/gateway/v2/orders/${encodeURIComponent(lease.orderId)}/lease/renew`, {
        method: "POST", body: JSON.stringify(scoped({
          commandId: crypto.randomUUID(), ...lease, expectedVersion: lease.version, leaseSeconds,
        })),
      }),
    releaseLease: (lease: GatewayLease) =>
      gatewayFetch<Record<string, unknown>>(`/gateway/v2/orders/${encodeURIComponent(lease.orderId)}/lease/release`, {
        method: "POST", body: JSON.stringify(scoped({
          commandId: crypto.randomUUID(), ...lease, expectedVersion: lease.version,
        })),
      }),
    replaceOrder: (snapshot: GatewayOrderSnapshot, lease: GatewayLease) =>
      gatewayFetch<{ orderId: string; version: number; projection: GatewayOrderSnapshot }>(
        `/gateway/v2/orders/${encodeURIComponent(snapshot.orderId)}/snapshot`, {
          method: "POST", body: JSON.stringify(scoped({
            commandId: crypto.randomUUID(), orderId: snapshot.orderId, expectedVersion: lease.version,
            leaseId: lease.leaseId, fencingVersion: lease.fencingVersion, snapshot,
          })),
        }),
    prime: (tables: Array<Record<string, unknown>>, orders: Array<Record<string, unknown>>,
           managerConfirmed = false) => gatewayFetch<Record<string, unknown>>("/gateway/v2/prime", {
      method: "POST", body: JSON.stringify(scoped({
        commandId: crypto.randomUUID(), tables, orders, managerConfirmed,
      })),
    }),
    kds: (state?: string) => gatewayFetch<{ jobs: Array<Record<string, unknown>> }>(
      `/gateway/v2/kds?companyId=${encodeURIComponent(scope.companyId)}&enotaId=${encodeURIComponent(String(scope.enotaId))}${state ? `&state=${encodeURIComponent(state)}` : ""}`),
    transitionKds: (jobId: string, transition: "claim" | "start" | "ready" | "complete" | "cancel",
                    expectedVersion: number) => gatewayFetch<Record<string, unknown>>(
      `/gateway/v2/kds/${encodeURIComponent(jobId)}/${transition}`, {
        method: "POST", body: JSON.stringify(scoped({
          commandId: crypto.randomUUID(), operationId: crypto.randomUUID(), jobId, expectedVersion,
        })),
      }),
  };
  gatewayServiceCache.set(cacheKey, service);
  return service;
}