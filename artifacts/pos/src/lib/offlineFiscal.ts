/**
 * POS client for the one Bookie Fiscal Service protocol. The Windows service
 * owns the ledger and queue; IndexedDB and localStorage are safety projections.
 */
import contract from "../../../../fiscal-service/contract/bookie-fiscal-service-v1.json";

export const FISCAL_SERVICE_BASE_URL = contract.servers[0].url;
const MAX_BODY_BYTES = contract["x-authentication"].maxBodyBytes;
const PAIRING_KEY = "bookie.fiscal.v1.pairing";
const OPERATION_KEY = "bookie.fiscal.v1.operations";

export type OfflineFiscalState = "received" | "finalizing" | "pending" | "failed" | "unknown" | "needs_review" | "confirmed";
export type OfflineFiscalPrintState = "not_printed" | "printed" | "failed";

export interface FiscalCapability {
  service: "Bookie Local Gateway" | "Bookie Fiscal Service";
  protocolVersion: "1.0";
  baseUrl: typeof FISCAL_SERVICE_BASE_URL;
  ready: boolean;
  readinessProblems?: string[];
  envelopeFormat: "provisional" | "furs-v2";
  paymentMethods: ["cash"];
  maxBodyBytes: 65536;
  calendarPolicy: "SI-BUSINESS-DAY-V1";
  /** Required before ready may be true; provisioned identity is non-secret. */
  identity?: {
    deviceId: string;
    unitId: number;
    premiseId: number;
    premiseLabel: string;
    bIdentifier: string;
  };
}

export interface OfflineAuthorityBundle {
  schema: "bookie-offline-authority-v1";
  bundleId: string;
  server: { companyId: string; enotaId: number };
  scope: { deviceId: string; premiseId: number; bIdentifier: string };
  contract: { version: "furs-v2"; goldenAttestationSha256: string; authorityVersion: number };
  validity: { validFrom: string; validUntil: string; outageSubmissionBusinessDays: 2 };
  operator: { waiterId: number | null; name: string | null; taxNumber: string | null; shiftId: number | null };
  catalog: Array<{
    articleId: number; name: string; unitGross: string; vatRate: string; articleKind: string | null;
    inputArticleId: number | null; normativeQuantity: string | null; unitWac: string | null;
  }>;
  modifiers: Array<{
    modifierId: number; name: string; priceDelta: string; vatRate?: string | null;
    vatRule?: "own" | "inherit_parent";
    groupId?: number | null; articleIds?: number[];
    inputArticleId: number | null; normativeQuantity: string | null; unitWac: string | null;
  }>;
  policies: Record<string, unknown> & { paymentMethods: string[]; maxReceiptGross: string; maxLines: number };
  authority: { keyId: string; algorithm: "RSA-SHA256"; publicKeyPem: string };
  bundleSha256: string;
  signatureBase64: string;
}

export interface ProvisioningChallenge {
  challengeId: string;
  challenge: string;
  expiresAt: string;
}

export interface LocalProvisioningProof {
  challengeId: string;
  publicKeyPem: string;
  proofSignatureBase64: string;
  keyFingerprintSha256: string;
}

export interface ProvisioningBundle {
  schema: "bookie-offline-provisioning-v1";
  bundleId: string;
  version: number;
  device: {
    id: string; companyId: string; enotaId: number; poslovniProstorId: number;
    poslovniProstorOznaka: string; bIdentifier: string; publicKeyFingerprintSha256: string;
  };
  authority: { keyId: string; publicKeyPem: string; version: number; algorithm: "RSA-SHA256" };
  furs: { expectedCertificateFingerprint: string };
  pos: { allowedHttpsOrigins: string[] };
  sync: {
    httpsBaseUrl: string; ingestPath: string; statusPathTemplate: string;
    gatewayIngestPath?: string; gatewayStatusPath?: string;
    configPath: string; maxBodyBytes: number;
  };
  contract: { version: "furs-v2"; goldenAttestationSha256: string };
  authentication: Record<string, unknown>;
  revocation: { deviceVersion: number; minimumAcceptedVersion: number };
  validity: { validFrom: string; validUntil: string };
  payloadSha256: string;
  signatureBase64: string;
}

export interface FinalizationPlanTemplate {
  version: 2; source: "offline"; sourceOperationId: string;
  receiptContext: {
    companyId: string; enotaId: number; orderId: number | null;
    cloudOrderId: number | null; sourceOrderRef: string; isPartial: boolean;
  };
  soldLines: Array<{
    id: number; sourceLineRef?: string; cloudLineId?: number | null;
    articleId: number | null; modifierId: number | null; name: string;
    quantity: number; unitGross: number; gross: number; vatRate: number;
    normativeFactor: number | null; articleKind: string | null;
    note?: string | null; toGo?: boolean; courseNumber?: number | null; pairingGroupId?: string | null;
    parentCloudLineId?: number | null; parentSourceLineRef?: string | null;
  }>;
  cloudBaseline?: Array<{
    cloudLineId: number; articleId: number | null; modifierId: number | null;
    name?: string | null; quantity: number; unitGross: number; gross: number; vatRate: number;
    note?: string | null; toGo?: boolean; courseNumber?: number | null; pairingGroupId?: string | null;
    parentCloudLineId?: number | null; parentSourceLineRef?: string | null;
  }>;
  normativeSnapshot: Array<{ articleId: number; quantity: number }>;
  totals: { gross: number; net: number; vat: number; vatGroups: Array<{ rate: number; gross: number; vat: number }> };
  payment: {
    method: "gotovina"; cash: number; card: 0; voucher: 0; pizzaVoucher: 0; nonCash: 0;
    terminalReferenceReservationId: null; cardPaymentAttemptId: null; giftVoucherRedemption: 0;
  };
  operator: { waiterId: number | null; name: string | null; taxNumber: string | null; shiftId: number | null; actor: string };
  closure: {
    allLinesCovered: boolean; closeOrder: boolean; orderId: number | null;
    cloudOrderId: number | null; sourceOrderRef: string; tableId: number | string | null; clearTipAmount: boolean;
  };
  tip: { amount: 0; mode: null; policyId: null; feeAmount: 0; netAmount: 0 };
  stockMovements: Array<{ articleId: number; quantity: number; unitWac: number; value: number; note: string; effectiveAt: string }>;
  kds: { effects: Array<{ kind: string; lineId: number }> };
  accounting: { companyId: string; businessDate: string; syncAfterCommit: boolean };
  print: { receiptNumber: string; issuedAt: string; customerName: string | null; customerAddress: string | null; customerTaxNumber: string | null };
}

export interface CashIssueRequest {
  operationId: string;
  authorityBundle: OfflineAuthorityBundle;
  orderEventSnapshot: {
    orderId: number | null; cloudOrderId: number | null; sourceOrderRef: string;
    orderVersion: number | string; eventId: number | null;
    capturedAt: string; lineIds: number[];
  };
  finalizationPlanTemplate: FinalizationPlanTemplate;
  legalTimestamp: string;
  interruptionStartedAt: string;
}

export interface LegalInvoiceCore {
  envelopeVersion: "furs-v2";
  operationId: string;
  localReceiptId: string;
  authorityBundle: OfflineAuthorityBundle;
  finalizationPlan: Record<string, unknown> & {
    receipt: {
      localReceiptId: string; serverRacunId?: number; orderId: number | null;
      cloudOrderId: number | null; sourceOrderRef: string; legalNumber: string;
    };
  };
  finalizationPlanSha256: string;
  legalInvoice: Record<string, unknown> & { zoi: string };
  zoiSignatureBase64: string;
  certificateFingerprint: string;
  deviceKeyFingerprintSha256: string;
  deviceSignatureBase64: string;
}

export interface SealedEnvelope {
  operationId: string;
  deviceId: string;
  poslovniProstorId: number;
  poslovniProstorOznaka: string;
  bIdentifier: string;
  sequence: number;
  issuedAt: string;
  interruptionStartedAt: string;
  orderId: number | null;
  cloudOrderId: number | null;
  sourceOrderRef: string;
  operatorReference: string | null;
  paymentReference: string | null;
  paymentMethod: "cash";
  canonicalPayload: LegalInvoiceCore;
  payloadSha256: string;
  deviceSignature: string;
  signingPublicKeyFingerprintSha256: string;
}

export type ServerFursProjection = {
  fursState: OfflineFiscalState | "received_pending_review" | "sending" | "quarantined" | null;
  eor: string | null;
  attemptCount: number;
  lastError: string | null;
  [key: string]: unknown;
};

export type LocalReceiptProjection = {
  envelope: SealedEnvelope;
  printState: OfflineFiscalPrintState;
  bookieDeliveryState: OfflineFiscalState;
  serverFursProjection: ServerFursProjection;
  submissionDeadlineAt: string;
};

const BOOKIE_DELIVERY_STATES = new Set<OfflineFiscalState>([
  "received", "finalizing", "pending", "failed", "unknown", "needs_review", "confirmed",
]);
const SERVER_FURS_STATES = new Set<NonNullable<ServerFursProjection["fursState"]>>([
  "received", "finalizing", "pending", "failed", "unknown", "needs_review", "confirmed",
  "received_pending_review", "sending", "quarantined",
]);

export function validateLocalReceiptProjection(value: LocalReceiptProjection): void {
  const server = value?.serverFursProjection;
  if (!value?.envelope || !BOOKIE_DELIVERY_STATES.has(value.bookieDeliveryState) ||
      !server || !Object.prototype.hasOwnProperty.call(server, "fursState") ||
      server.fursState !== null && !SERVER_FURS_STATES.has(server.fursState) ||
      !Object.prototype.hasOwnProperty.call(server, "eor") ||
      !Number.isInteger(server.attemptCount) || server.attemptCount < 0 ||
      !Object.prototype.hasOwnProperty.call(server, "lastError") ||
      server.lastError !== null && typeof server.lastError !== "string") {
    throw new Error("Lokalna fiskalna vrsta nima veljavne skupne projekcije.");
  }
}

export interface SealedOfflineReceipt {
  operationId: string;
  envelope: SealedEnvelope;
  payloadSha256: string;
  number: string;
  zoi: string;
  eor?: string | null;
  printState: OfflineFiscalPrintState;
  fursState: OfflineFiscalState;
  submissionDeadlineAt?: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  attempts: number;
}

type Snapshot = { key: string; value: unknown; updatedAt: number; version: 1 };
type LocalOperation = {
  operationId: string;
  orderId: string | number;
  request: CashIssueRequest;
  state: "prepared" | "unknown" | "sealed";
  createdAt: number;
};

const DB = "bookie-pos-offline-fiscal";
const VERSION = 3;
const stores = ["snapshots", "localOrders", "sealedReceipts"] as const;
const text = new TextEncoder();
const activeIssues = new Map<string, Promise<SealedOfflineReceipt>>();

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots", { keyPath: "key" });
      if (!database.objectStoreNames.contains("localOrders")) database.createObjectStore("localOrders", { keyPath: "operationId" });
      if (!database.objectStoreNames.contains("sealedReceipts")) database.createObjectStore("sealedReceipts", { keyPath: "operationId" });
      if (!database.objectStoreNames.contains("gatewaySecrets")) database.createObjectStore("gatewaySecrets");
      // Remove obsolete stores only after their data has ceased to be authoritative.
      for (const name of ["orderEvents", "syncAttempts", "printIntents"]) {
        if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB ni na voljo."));
  });
}

async function read<T>(store: typeof stores[number], key: IDBValidKey): Promise<T | undefined> {
  const database = await db();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function all<T>(store: typeof stores[number]): Promise<T[]> {
  const database = await db();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function write(store: typeof stores[number], value: unknown): Promise<void> {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(store, "readwrite");
      transaction.objectStore(store).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function canonicalFiscalJson(value: unknown): string {
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new Error("Neveljavno število v fiskalnem zahtevku.");
  }
  if (value === undefined) throw new Error("undefined ni dovoljen v fiskalnem zahtevku.");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalFiscalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalFiscalJson(object[key])}`).join(",")}}`;
}

export async function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(text.encode(canonicalFiscalJson(value)));
}

/** RFC3339 timestamp with the legal Europe/Ljubljana offset, never UTC `Z`. */
export function legalLjubljanaTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const offset = part("timeZoneName").replace("GMT", "") || "+00:00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function readPairingCredentials(): { secret: string; clientId?: string } | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAIRING_KEY) ?? "null") as {
      secret?: string; clientId?: string; protocolVersion?: string
    } | null;
    return parsed?.protocolVersion === "1.0" && parsed.secret ? { secret: parsed.secret, clientId: parsed.clientId } : undefined;
  } catch { return undefined; }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function authenticatedFiscalHeaders(method: string, path: string, rawBody: string): Promise<Record<string, string>> {
  const credentials = readPairingCredentials();
  if (!credentials) throw new Error("Lokalna fiskalna storitev ni seznanjena. V nastavitvah vnesite enkratno kodo.");
  const secret = credentials.secret;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();
  const bodyHash = await sha256Hex(text.encode(rawBody));
  const input = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const normalizedSecret = secret.replace(/-/g, "+").replace(/_/g, "/");
  const rawSecret = Uint8Array.from(atob(normalizedSecret.padEnd(Math.ceil(normalizedSecret.length / 4) * 4, "=")), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", rawSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, text.encode(input));
  const signatureHex = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    "X-Bookie-Pairing": secret,
    "X-Bookie-Timestamp": timestamp,
    "X-Bookie-Nonce": nonce,
    "X-Bookie-Signature": signatureHex,
    ...(credentials.clientId ? { "X-Bookie-Client-Id": credentials.clientId } : {}),
  };
}

async function fiscalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const rawBody = typeof init.body === "string" ? init.body : "";
  if (text.encode(rawBody).byteLength > MAX_BODY_BYTES) throw new Error("Fiskalni zahtevek presega dovoljeno velikost.");
  const relativePath = path.replace(/^\/v1/, "");
  const headers = await authenticatedFiscalHeaders(method, `/v1${relativePath}`, rawBody);
  return fetch(`${FISCAL_SERVICE_BASE_URL}${relativePath}`, {
    ...init,
    method,
    cache: "no-store",
    headers: { ...(rawBody ? { "Content-Type": "application/json" } : {}), ...headers, ...(init.headers ?? {}) },
  });
}

export async function pairFiscalService(code: string, clientName: string): Promise<void> {
  const body = JSON.stringify({ code: code.trim(), clientName: clientName.trim() });
  const response = await fetch(`${FISCAL_SERVICE_BASE_URL}/pair`, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body,
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Enkratna koda ni veljavna, je potekla ali je že uporabljena." : await response.text());
  const result = await response.json() as { pairingSecret?: string; clientId?: string; contract?: string };
  if (!result.pairingSecret || result.contract !== "v1") throw new Error("Lokalna storitev je vrnila neveljaven odgovor seznanitve.");
  localStorage.setItem(PAIRING_KEY, JSON.stringify({
    secret: result.pairingSecret, clientId: result.clientId, protocolVersion: "1.0",
  }));
}

export function isFiscalServicePaired(): boolean { return Boolean(readPairingCredentials()); }
export function unpairFiscalService(): void { localStorage.removeItem(PAIRING_KEY); }

/**
 * Completes public-key registration without exposing either private key or
 * PKCS#12 material to the browser.
 */
export async function provisionWindowsFiscalService(input: {
  enotaId: number;
  poslovniProstorId: number;
  bIdentifier: string;
  expectedFursCertFingerprint: string;
  goldenAttestationSha256: string;
}): Promise<ProvisioningBundle> {
  const serverHeaders = { "Content-Type": "application/json", "X-Enota-Id": String(input.enotaId) };
  const challengeResponse = await fetch("/api/offline-fiscal/provisioning/challenges", {
    method: "POST", credentials: "include", headers: serverHeaders,
    body: JSON.stringify({ poslovniProstorId: input.poslovniProstorId }),
  });
  if (!challengeResponse.ok) throw new Error(await challengeResponse.text() || "Provisioning challenge ni uspel.");
  const challenge = await challengeResponse.json() as ProvisioningChallenge;
  const proofResponse = await fetch(`${FISCAL_SERVICE_BASE_URL}/provisioning/proof`, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, challenge: challenge.challenge }),
  });
  if (!proofResponse.ok) throw new Error(await proofResponse.text() || "Lokalni dokaz ključa ni uspel.");
  const proof = await proofResponse.json() as LocalProvisioningProof;
  if (proof.challengeId !== challenge.challengeId || /PRIVATE KEY/i.test(proof.publicKeyPem)) {
    throw new Error("Lokalna storitev je vrnila neveljaven javni dokaz.");
  }
  const registerResponse = await fetch("/api/offline-fiscal/provisioning/register", {
    method: "POST", credentials: "include", headers: serverHeaders,
    body: JSON.stringify({
      challengeId: proof.challengeId, publicKeyPem: proof.publicKeyPem,
      proofSignatureBase64: proof.proofSignatureBase64, platform: "windows",
      bIdentifier: input.bIdentifier,
      expectedFursCertFingerprint: input.expectedFursCertFingerprint,
      goldenAttestationSha256: input.goldenAttestationSha256,
    }),
  });
  if (!registerResponse.ok) throw new Error(await registerResponse.text() || "Registracija naprave ni uspela.");
  const bundle = await registerResponse.json() as ProvisioningBundle;
  const applyResponse = await fiscalFetch("/provisioning/install", {
    method: "POST", body: JSON.stringify(bundle),
  });
  if (!applyResponse.ok) throw new Error(await applyResponse.text() || "Lokalna namestitev provisioning bundle ni uspela.");
  return bundle;
}

export const LOCAL_FURS_CERTIFICATE_ADMIN_URL = `${FISCAL_SERVICE_BASE_URL}/admin/certificate`;

export function openLocalFursCertificateAdmin(): void {
  // The service-hosted page owns the PKCS#12/password fields. Never proxy them
  // through POS state, requests, telemetry, or cloud routes.
  window.open(LOCAL_FURS_CERTIFICATE_ADMIN_URL, "_blank", "noopener,noreferrer");
}

export async function cacheOfflineSnapshot(key: "unit" | "catalog" | "taxes" | "operator" | "device" | "authorityBundle", value: unknown): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  await write("snapshots", { key, value, updatedAt: Date.now(), version: 1 } satisfies Snapshot);
}

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const decoded = atob(body);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export async function validateOfflineAuthorityBundle(
  bundle: OfflineAuthorityBundle,
  identity?: FiscalCapability["identity"],
  at = new Date(),
): Promise<void> {
  if (bundle?.schema !== "bookie-offline-authority-v1" || bundle.contract?.version !== "furs-v2" ||
      bundle.authority?.algorithm !== "RSA-SHA256" || !/^[a-f0-9]{64}$/.test(bundle.bundleSha256)) {
    throw new Error("Authority bundle nima podprte oblike furs-v1.");
  }
  const validFrom = new Date(bundle.validity.validFrom);
  const validUntil = new Date(bundle.validity.validUntil);
  if (Number.isNaN(+validFrom) || Number.isNaN(+validUntil) || at < validFrom || at > validUntil) {
    throw new Error("Authority bundle še ni veljaven ali je potekel.");
  }
  if (identity && (bundle.scope.deviceId !== identity.deviceId || bundle.scope.premiseId !== identity.premiseId ||
      bundle.scope.bIdentifier !== identity.bIdentifier || bundle.server.enotaId !== identity.unitId)) {
    throw new Error("Authority bundle ne pripada tej enoti, prostoru in napravi.");
  }
  const { bundleSha256, signatureBase64, ...unsigned } = bundle;
  const canonical = canonicalFiscalJson(unsigned);
  if (await sha256Hex(text.encode(canonical)) !== bundleSha256) throw new Error("SHA-256 authority bundla se ne ujema.");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", pemBytes(bundle.authority.publicKeyPem), {
      name: "RSASSA-PKCS1-v1_5", hash: "SHA-256",
    }, false, ["verify"]);
  } catch { throw new Error("Javni ključ authority bundla ni veljaven."); }
  const signature = Uint8Array.from(atob(signatureBase64), char => char.charCodeAt(0));
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, text.encode(canonical))) {
    throw new Error("Podpis authority bundla ni veljaven.");
  }
  if (!bundle.policies.paymentMethods.includes("cash")) throw new Error("Authority bundle ne dovoljuje gotovine.");
}

export async function fetchAndCacheOfflineAuthorityBundle(input: {
  deviceId: string; waiterId: number; shiftId: number; identity: NonNullable<FiscalCapability["identity"]>;
  headers?: Record<string, string>;
}): Promise<OfflineAuthorityBundle> {
  const response = await fetch(`/api/pos/offline-fiscal/devices/${encodeURIComponent(input.deviceId)}/authority-bundles`, {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(input.headers ?? {}) },
    body: JSON.stringify({ waiterId: input.waiterId, shiftId: input.shiftId }),
  });
  if (!response.ok) throw new Error(await response.text() || "Authority bundla ni mogoče pridobiti.");
  const bundle = await response.json() as OfflineAuthorityBundle;
  await validateOfflineAuthorityBundle(bundle, input.identity);
  await cacheOfflineSnapshot("authorityBundle", bundle);
  return bundle;
}

export async function getValidOfflineAuthorityBundle(
  identity: NonNullable<FiscalCapability["identity"]>,
  waiterId: number,
  shiftId: number,
): Promise<OfflineAuthorityBundle> {
  const bundle = await getOfflineSnapshot<OfflineAuthorityBundle>("authorityBundle");
  if (!bundle) throw new Error("Ni shranjenega podpisanega authority bundla. Povežite POS s strežnikom.");
  await validateOfflineAuthorityBundle(bundle, identity);
  if (bundle.operator.waiterId !== waiterId || bundle.operator.shiftId !== shiftId) {
    throw new Error("Authority bundle ne pripada izbranemu operaterju in izmeni.");
  }
  return bundle;
}
export async function getOfflineSnapshot<T>(key: string): Promise<T | undefined> {
  return (await read<Snapshot>("snapshots", key))?.value as T | undefined;
}

export async function getCachedOfflineCapability(): Promise<FiscalCapability | undefined> {
  return getOfflineSnapshot<FiscalCapability>("device");
}

function validateCapability(value: FiscalCapability): string[] {
  const problems: string[] = [];
  if (!["Bookie Local Gateway", "Bookie Fiscal Service"].includes(value.service) ||
      value.protocolVersion !== "1.0" || value.baseUrl !== FISCAL_SERVICE_BASE_URL) problems.push("različica lokalnega protokola ni podprta");
  if (!value.ready) problems.push(...(value.readinessProblems?.length ? value.readinessProblems : ["storitev ni pripravljena"]));
  if (value.envelopeFormat !== "furs-v2") problems.push("format FURS ovoja je še začasen");
  if (!value.identity) problems.push("lokalna naprava nima provisionirane identitete");
  return [...new Set(problems)];
}

export async function discoverLocalFiscalCapability(): Promise<FiscalCapability | undefined> {
  try {
    const response = await fetch(`${FISCAL_SERVICE_BASE_URL}/capabilities`, { cache: "no-store" });
    if (!response.ok) return undefined;
    const capability = await response.json() as FiscalCapability;
    await cacheOfflineSnapshot("device", capability);
    return capability;
  } catch { return undefined; }
}

export async function checkLocalFiscalCapability(): Promise<{ capability?: FiscalCapability; reason?: string }> {
  try {
    const response = await fetch(`${FISCAL_SERVICE_BASE_URL}/capabilities`, { cache: "no-store" });
    if (!response.ok) return { reason: `Lokalna fiskalna storitev ni dosegljiva (${response.status}).` };
    const capability = await response.json() as FiscalCapability;
    const problems = validateCapability(capability);
    await cacheOfflineSnapshot("device", capability);
    return problems.length ? { capability, reason: problems.join("; ") } : { capability };
  } catch { return { reason: "Lokalna fiskalna storitev ni dosegljiva." }; }
}

function toReceipt(value: SealedEnvelope | LocalReceiptProjection): SealedOfflineReceipt {
  const projection = "envelope" in value ? value : undefined;
  const envelope = projection?.envelope ?? value as SealedEnvelope;
  const plan = envelope.canonicalPayload.finalizationPlan;
  return {
    operationId: envelope.operationId, envelope, payloadSha256: envelope.payloadSha256,
    number: plan.receipt.legalNumber, zoi: envelope.canonicalPayload.legalInvoice.zoi,
    eor: projection?.serverFursProjection?.eor ?? null,
    printState: projection?.printState ?? "not_printed",
    // Bookie delivery completion is not a FURS confirmation.
    fursState: normalizeServerFursState(projection?.serverFursProjection?.fursState),
    submissionDeadlineAt: projection?.submissionDeadlineAt,
    createdAt: Date.now(), updatedAt: Date.now(), attempts: 0,
  };
}

export function normalizeServerFursState(value: ServerFursProjection["fursState"] | undefined): OfflineFiscalState {
  if (value === "received_pending_review") return "received";
  if (value === "sending") return "finalizing";
  if (value === "quarantined") return "needs_review";
  return value ?? "pending";
}

export async function validateBoundaryEnvelope(envelope: SealedEnvelope): Promise<void> {
  const core = envelope?.canonicalPayload;
  const receipt = core?.finalizationPlan?.receipt;
  const cloudOrderId = receipt?.cloudOrderId ?? receipt?.orderId;
  const hasValidSourceRef = typeof receipt?.sourceOrderRef === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.sourceOrderRef);
  if (!core || core.envelopeVersion !== "furs-v2" || core.operationId !== envelope.operationId ||
      core.deviceSignatureBase64 !== envelope.deviceSignature ||
      core.deviceKeyFingerprintSha256 !== envelope.signingPublicKeyFingerprintSha256 ||
      await canonicalSha256(core) !== envelope.payloadSha256 ||
      (cloudOrderId == null ? !hasValidSourceRef : !Number.isSafeInteger(cloudOrderId))) {
    throw new Error("Lokalna storitev je vrnila neveljaven skupni fiskalni ovoj.");
  }
}

function readOperationSafetyMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(OPERATION_KEY) ?? "{}") as Record<string, string>; }
  catch { return {}; }
}

function operationKey(orderId: string | number): string {
  return `${typeof orderId === "number" ? "cloud" : "local"}:${String(orderId)}`;
}

function rememberOperation(orderId: string | number, operationId: string): void {
  localStorage.setItem(OPERATION_KEY, JSON.stringify({ ...readOperationSafetyMap(), [operationKey(orderId)]: operationId }));
}

export function isOfflineOrderLocked(orderId: string | number): boolean {
  return Boolean(readOperationSafetyMap()[operationKey(orderId)]);
}

/** Persist the idempotency boundary before any immutable plan is built or sent. */
export function reserveOfflineOperationId(orderId: string | number): string {
  const existing = readOperationSafetyMap()[operationKey(orderId)];
  if (existing) return existing;
  const operationId = crypto.randomUUID();
  rememberOperation(orderId, operationId);
  return operationId;
}

async function lookupReceipt(operationId: string): Promise<SealedOfflineReceipt | undefined> {
  const response = await fiscalFetch(`/receipts/${encodeURIComponent(operationId)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await response.text() || "Stanja fiskalne operacije ni mogoče preveriti.");
  const value = await response.json() as SealedEnvelope | LocalReceiptProjection;
  await validateBoundaryEnvelope("envelope" in value ? value.envelope : value);
  const receipt = toReceipt(value);
  await write("sealedReceipts", receipt);
  return receipt;
}

export class UnknownFiscalOutcomeError extends Error {
  constructor(public readonly operationId: string) {
    super(`Izid lokalne izdaje ni znan (${operationId}). Pred novim računom je obvezna uskladitev; zahtevek se ne bo samodejno ponovil.`);
  }
}

export async function issueOfflineCashReceipt(input: { orderId: string | number; request: CashIssueRequest }): Promise<SealedOfflineReceipt> {
  const remembered = readOperationSafetyMap()[operationKey(input.orderId)];
  const local = (await all<LocalOperation>("localOrders")).find(item => item.orderId === input.orderId);
  const operationId = remembered ?? local?.operationId ?? input.request.operationId;
  if (operationId !== input.request.operationId ||
      input.request.finalizationPlanTemplate.sourceOperationId !== operationId ||
      input.request.orderEventSnapshot.sourceOrderRef !== String(input.orderId)) {
    throw new Error("Operation ID, snapshot in finalization plan template se ne ujemajo.");
  }

  const sealed = await read<SealedOfflineReceipt>("sealedReceipts", operationId);
  if (sealed) return sealed;
  if (local?.state === "unknown" || (remembered && !local)) {
    const resolved = await lookupReceipt(operationId);
    if (resolved) return resolved;
    throw new UnknownFiscalOutcomeError(operationId);
  }
  const inFlight = activeIssues.get(operationId);
  if (inFlight) return inFlight;

  const checked = await checkLocalFiscalCapability();
  if (checked.reason) throw new Error(`Offline izdaja je blokirana: ${checked.reason}.`);
  rememberOperation(input.orderId, operationId); // durable before the issue request
  const request: CashIssueRequest = input.request;
  await write("localOrders", { operationId, orderId: input.orderId, request, state: "prepared", createdAt: Date.now() } satisfies LocalOperation);
  const task = (async () => {
    const rawBody = JSON.stringify(request);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fiscalFetch("/receipts/cash", { method: "POST", body: rawBody, signal: controller.signal });
      if (response.status === 409) throw new Error("operationId je bil uporabljen z drugačnim nespremenljivim zahtevkom.");
      if (!response.ok) throw new Error(await response.text() || "Lokalna fiskalna storitev računa ni izdala.");
      const value = await response.json() as SealedEnvelope | LocalReceiptProjection;
      const envelope = "envelope" in value ? value.envelope : value;
      await validateBoundaryEnvelope(envelope);
      if (envelope.operationId !== operationId || !envelope.canonicalPayload?.legalInvoice?.zoi)
        throw new Error("Lokalna storitev je vrnila neveljaven zapečaten ovoj.");
      const receipt = toReceipt(value);
      await write("sealedReceipts", receipt);
      await write("localOrders", { operationId, orderId: input.orderId, request, state: "sealed", createdAt: Date.now() } satisfies LocalOperation);
      return receipt;
    } catch (error) {
      // A response from the service is definitive. Transport failures are not.
      if (error instanceof TypeError || error instanceof DOMException) {
        await write("localOrders", { operationId, orderId: input.orderId, request, state: "unknown", createdAt: Date.now() } satisfies LocalOperation);
        try {
          const resolved = await lookupReceipt(operationId);
          if (resolved) return resolved;
        } catch { /* remains unknown; never POST again */ }
        throw new UnknownFiscalOutcomeError(operationId);
      }
      throw error;
    } finally { window.clearTimeout(timeout); }
  })();
  activeIssues.set(operationId, task);
  try { return await task; } finally { activeIssues.delete(operationId); }
}

/** Rebuild the browser projection from the service's authoritative queue. */
export async function recoverAuthoritativeFiscalQueue(): Promise<SealedOfflineReceipt[]> {
  const response = await fiscalFetch("/queue");
  if (!response.ok) throw new Error(await response.text() || "Lokalne fiskalne vrste ni mogoče prebrati.");
  const result = await response.json() as { items?: Array<SealedEnvelope | LocalReceiptProjection> };
  const receipts: SealedOfflineReceipt[] = [];
  for (const item of result.items ?? []) {
    const envelope: SealedEnvelope = "envelope" in item ? item.envelope : item;
    if ("envelope" in item) validateLocalReceiptProjection(item);
    await validateBoundaryEnvelope(envelope);
    const localReceipt = toReceipt(item);
    receipts.push(localReceipt);
    const receiptRef = envelope.canonicalPayload.finalizationPlan.receipt;
    rememberOperation(receiptRef.orderId ?? receiptRef.sourceOrderRef, envelope.operationId);
    await write("sealedReceipts", localReceipt);
  }
  return receipts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listSealedOfflineReceipts(): Promise<SealedOfflineReceipt[]> {
  if (isFiscalServicePaired()) {
    try { return await recoverAuthoritativeFiscalQueue(); } catch { /* show last projection while service is down */ }
  }
  return (await all<SealedOfflineReceipt>("sealedReceipts")).sort((a, b) => b.createdAt - a.createdAt);
}

/** Service syncs its exact durable envelopes; the browser never rebuilds one. */
export async function syncOfflineFiscalReceipts(): Promise<SealedOfflineReceipt[]> {
  const response = await fiscalFetch("/sync", { method: "POST", body: "" });
  if (response.status === 409) throw new Error("Neznan FURS izid zahteva ročno uskladitev; samodejna ponovitev ni dovoljena.");
  if (!response.ok && response.status !== 202) throw new Error(await response.text() || "Sinhronizacije ni mogoče zagnati.");
  return recoverAuthoritativeFiscalQueue();
}