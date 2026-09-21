const VIVA_ACCOUNTS_BASE = "https://accounts.vivapayments.com";
const VIVA_ACCOUNTS_DEMO = "https://demo-accounts.vivapayments.com";
const VIVA_API_BASE = "https://api.vivapayments.com";
const VIVA_API_DEMO = "https://demo-api.vivapayments.com";
const VIVA_CHECKOUT_BASE = "https://www.vivapayments.com";
const VIVA_CHECKOUT_DEMO = "https://demo.vivapayments.com";
import { logger } from "./logger";

type CachedVivaToken = {
  token: string;
  expiresAt: number;
};

const vivaTokenCache = new Map<string, CachedVivaToken>();
const vivaTokenRequests = new Map<string, Promise<string>>();

async function pridobiToken(clientId: string, clientSecret: string, demo: boolean): Promise<string> {
  const cacheKey = `${demo ? "demo" : "prod"}:${clientId}:${clientSecret}`;
  const cached = vivaTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const pending = vivaTokenRequests.get(cacheKey);
  if (pending) return pending;

  const request = pridobiNovToken(clientId, clientSecret, demo, cacheKey);
  vivaTokenRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    vivaTokenRequests.delete(cacheKey);
  }
}

async function pridobiNovToken(
  clientId: string,
  clientSecret: string,
  demo: boolean,
  cacheKey: string,
): Promise<string> {
  const base = demo ? VIVA_ACCOUNTS_DEMO : VIVA_ACCOUNTS_BASE;
  const res = await fetch(`${base}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Wallet OAuth napaka: ${res.status} ${err}`);
  }
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Viva Wallet: OAuth odgovor ne vsebuje access_token");
  const expiresInMs = Math.max(60, Number(data.expires_in) || 3600) * 1000;
  vivaTokenCache.set(cacheKey, {
    token: data.access_token,
    // Žeton osvežimo najmanj minuto pred iztekom.
    expiresAt: Date.now() + Math.max(30_000, expiresInMs - 60_000),
  });
  return data.access_token;
}

/** Pripravi OAuth žeton pred odpiranjem Viva aplikacije, da callback ne čaka nanj. */
export async function pripraviVivaPovezavo(
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<void> {
  await pridobiToken(clientId, clientSecret, demo);
}

export async function ustvariNarocilo(
  znesekEur: number,
  referenca: string,
  sourceCode: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<string> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const znesekCenti = Math.round(znesekEur * 100);
  const res = await fetch(`${base}/checkout/v2/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount: znesekCenti,
      merchantTrns: referenca,
      customerTrns: `Narocilo ${referenca}`,
      sourceCode: sourceCode || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Wallet naročilo napaka: ${res.status} ${err}`);
  }
  const data = await res.json() as { orderCode?: string | number };
  if (!data.orderCode) throw new Error("Viva Wallet: odgovor ne vsebuje orderCode");
  return String(data.orderCode);
}

export async function preveriStatus(
  orderCode: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<VivaCheckoutStatus> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  let res: Response;
  try {
    res = await fetch(`${base}/api/orders/${encodeURIComponent(orderCode)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    logger.info({
      orderCode,
      httpStatus: null,
      stateId: null,
      result: "UNKNOWN",
    });
    return {
      status: "UNKNOWN",
      orderCode,
      vivaStateId: null,
      vivaHttpStatus: null,
      napaka: "Viva status trenutno ni dosegljiv; preverjanje se bo ponovilo.",
    };
  }

  if (!res.ok) {
    logger.info({
      orderCode,
      httpStatus: res.status,
      stateId: null,
      result: "UNKNOWN",
    });
    return {
      status: "UNKNOWN",
      orderCode,
      vivaStateId: null,
      vivaHttpStatus: res.status,
      napaka: `Viva status HTTP ${res.status}; preverjanje se bo ponovilo.`,
    };
  }

  let data: {
    StateId?: number;
    stateId?: number;
    IsCanceled?: boolean;
    isCanceled?: boolean;
    IsCancelled?: boolean;
    isCancelled?: boolean;
    TransactionId?: string | number;
    transactionId?: string | number;
    OrderCode?: string | number;
    orderCode?: string | number;
  };
  try {
    data = await res.json() as typeof data;
  } catch {
    logger.info({
      orderCode,
      httpStatus: res.status,
      stateId: null,
      result: "UNKNOWN",
    });
    return {
      status: "UNKNOWN",
      orderCode,
      vivaStateId: null,
      vivaHttpStatus: res.status,
      napaka: "Viva statusni odgovor še ni razpoložljiv; preverjanje se bo ponovilo.",
    };
  }

  const transactionId = toVivaIdentifier(data.TransactionId ?? data.transactionId);
  const returnedOrderCode = toVivaIdentifier(data.OrderCode ?? data.orderCode) ?? orderCode;
  const stateId = data.StateId ?? data.stateId;
  const isCanceled = data.IsCanceled ?? data.isCanceled ?? data.IsCancelled ?? data.isCancelled ?? false;

  // Diagnostika za demo: brez odgovornih teles, žetonov ali poverilnic.
  logger.info({
    orderCode: returnedOrderCode,
    httpStatus: res.status,
    stateId: stateId ?? null,
    result: stateId === 5 ? "PAID" : isCanceled ? "FAILED" : "PENDING",
  });

  // Pri Smart Checkoutu je 5 potrjeni plačani order. Neznani StateId nikoli
  // ne smemo obravnavati kot zavrnitev, ker bi se QR tok predčasno zaprl.
  if (stateId === 5) {
    return {
      status: "PAID",
      orderCode: returnedOrderCode,
      transactionId,
      vivaStateId: stateId,
      vivaHttpStatus: res.status,
    };
  }
  if (isCanceled) {
    return {
      status: "FAILED",
      orderCode: returnedOrderCode,
      transactionId,
      vivaStateId: stateId ?? null,
      vivaHttpStatus: res.status,
      napaka: "Viva naročilo je preklicano ali je poteklo.",
    };
  }
  return {
    status: "PENDING",
    orderCode: returnedOrderCode,
    transactionId,
    vivaStateId: stateId ?? null,
    vivaHttpStatus: res.status,
  };
}

export function smartCheckoutUrl(orderCode: string, demo: boolean): string {
  const base = demo ? VIVA_CHECKOUT_DEMO : VIVA_CHECKOUT_BASE;
  return `${base}/web/checkout?ref=${encodeURIComponent(orderCode)}`;
}

export async function posljiNaTerminal(
  znesekEur: number,
  sessionId: string,
  terminalId: string,
  merchantReference: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<void> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const znesekCenti = Math.round(znesekEur * 100);
  const res = await fetch(`${base}/ecr/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount: znesekCenti,
      sessionId,
      terminalId,
      merchantReference,
      customerTrns: merchantReference,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Terminal napaka: ${res.status} ${err}`);
  }
}

export interface TerminalStatusOdgovor {
  status: "PAID" | "PENDING" | "FAILED" | "UNKNOWN";
  napaka?: string;
  transactionId?: string | null;
  orderCode?: string | null;
}

export interface VivaCheckoutStatus {
  status: "PAID" | "PENDING" | "FAILED" | "UNKNOWN";
  transactionId?: string | null;
  orderCode?: string | null;
  vivaStateId?: number | null;
  vivaHttpStatus?: number | null;
  napaka?: string | null;
}

export interface VivaVerifiedTransaction {
  status: "PAID" | "FAILED" | "UNKNOWN";
  transactionId: string;
  amountCents: number | null;
  napaka?: string;
}

export async function preveriVivaTransakcijo(
  transactionId: string,
  expectedAmountCents: number,
  expectedMerchantReference: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<VivaVerifiedTransaction> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  let res: Response;
  try {
    res = await fetch(`${base}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { status: "UNKNOWN", transactionId, amountCents: null, napaka: "Viva transakcije trenutno ni mogoče preveriti." };
  }
  if (!res.ok) {
    return {
      status: res.status === 404 ? "UNKNOWN" : "UNKNOWN",
      transactionId,
      amountCents: null,
      napaka: `Viva preverjanje transakcije HTTP ${res.status}.`,
    };
  }
  let data: { amount?: number; statusId?: string; transactionId?: string; merchantTrns?: string; merchantReference?: string };
  try {
    data = await res.json() as typeof data;
  } catch {
    return { status: "UNKNOWN", transactionId, amountCents: null, napaka: "Viva je vrnila neveljaven statusni odgovor." };
  }
  const returnedId = toVivaIdentifier(data.transactionId) ?? transactionId;
  // Checkout v2 transaction detail vrača `amount` v glavni denarni enoti
  // (npr. 3 za 3,00 EUR), medtem ko Bookie attempt hrani pričakovani znesek
  // v centih. Pred primerjavo ga zato vedno pretvorimo v cente.
  const amountCents = Number.isFinite(data.amount) ? Math.round(Number(data.amount) * 100) : null;
  const merchantReference = toVivaIdentifier(data.merchantTrns ?? data.merchantReference);
  if (returnedId !== transactionId || amountCents !== expectedAmountCents || merchantReference !== expectedMerchantReference) {
    return { status: "FAILED", transactionId: returnedId, amountCents, napaka: "Viva transakcija ne ustreza pričakovanemu ID-ju ali znesku." };
  }
  if (data.statusId === "F") return { status: "PAID", transactionId: returnedId, amountCents };
  if (typeof data.statusId === "string" && data.statusId.trim()) {
    return { status: "FAILED", transactionId: returnedId, amountCents, napaka: `Viva status ${data.statusId}.` };
  }
  return { status: "UNKNOWN", transactionId: returnedId, amountCents, napaka: "Viva status transakcije še ni znan." };
}

/**
 * Merchant context je ločen od podatkov vračila, da se lahko pozneje doda ISV
 * pot s svojimi poverilnicami in endpointom brez spremembe klicateljev.
 */
export interface VivaMerchantRefundContext {
  model: "merchant";
  cashRegisterId: string;
}

export interface VivaTerminalRefundRequest {
  refundSessionId: string;
  parentSessionId: string;
  originalTransactionId: string | null;
  originalOrderCode: string | null;
  amountEur: number;
  terminalId: string;
  merchantReference: string;
  customerTrns: string;
  context: VivaMerchantRefundContext;
}

function toVivaIdentifier(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export async function preveriTerminalStatus(
  sessionId: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<TerminalStatusOdgovor> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const res = await fetch(`${base}/ecr/v1/transactions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { status: "UNKNOWN", napaka: `HTTP ${res.status}${errText ? `: status ni dosegljiv` : ""}` };
  }
  // statusId: 0/3=PENDING, 1=COMPLETED, 2/4/5=FAILED
  const data = await res.json() as {
    statusId?: number;
    StatusId?: number;
    statusMessage?: string;
    StatusMessage?: string;
    errorText?: string;
    ErrorText?: string;
    description?: string;
    Description?: string;
    transactionId?: string | number;
    TransactionId?: string | number;
    orderCode?: string | number;
    OrderCode?: string | number;
  };
  const statusId = data.statusId ?? data.StatusId;
  const transactionId = toVivaIdentifier(data.transactionId ?? data.TransactionId);
  const orderCode = toVivaIdentifier(data.orderCode ?? data.OrderCode);
  if (statusId === 1) return { status: "PAID", transactionId, orderCode };
  if ([2, 4, 5].includes(statusId ?? -1)) {
    const razlog = data.errorText ?? data.ErrorText
      ?? data.statusMessage ?? data.StatusMessage
      ?? data.description ?? data.Description
      ?? `statusId=${statusId}`;
    return { status: "FAILED", napaka: razlog, transactionId, orderCode };
  }
  return { status: "PENDING", transactionId, orderCode };
}

/**
 * Status plačila po ECR session ID-ju.
 *
 * To je ločeno od preveriTerminalStatus(), ki ga še uporablja obstoječi
 * refund polling tok na /ecr/v1/transactions/:id.
 */
export async function preveriVivaTerminalSessionStatus(
  sessionId: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<TerminalStatusOdgovor> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const res = await fetch(`${base}/ecr/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { status: "UNKNOWN", napaka: `HTTP ${res.status}${errText ? `: status ni dosegljiv` : ""}` };
  }

  const data = await res.json() as {
    statusId?: number;
    StatusId?: number;
    statusMessage?: string;
    StatusMessage?: string;
    errorText?: string;
    ErrorText?: string;
    description?: string;
    Description?: string;
    transactionId?: string | number;
    TransactionId?: string | number;
    orderCode?: string | number;
    OrderCode?: string | number;
  };
  const statusId = data.statusId ?? data.StatusId;
  const transactionId = toVivaIdentifier(data.transactionId ?? data.TransactionId);
  const orderCode = toVivaIdentifier(data.orderCode ?? data.OrderCode);
  if (statusId === 1) return { status: "PAID", transactionId, orderCode };
  if ([2, 4, 5].includes(statusId ?? -1)) {
    const razlog = data.errorText ?? data.ErrorText
      ?? data.statusMessage ?? data.StatusMessage
      ?? data.description ?? data.Description
      ?? `statusId=${statusId}`;
    return { status: "FAILED", napaka: razlog, transactionId, orderCode };
  }
  return { status: "PENDING", transactionId, orderCode };
}

export async function stornirajVivaTerminal(
  request: VivaTerminalRefundRequest,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<void> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const znesekCenti = Math.round(request.amountEur * 100);
  const originalReference = request.originalTransactionId ?? request.parentSessionId;
  const originalOrderSuffix = request.originalOrderCode
    ? `; ORDER:${request.originalOrderCode}`
    : "";

  // Cloud Terminal :refund dokumentacija zahteva parentSessionId originalne ECR
  // seje. transactionId/orderCode sta shranjena za sledljivost, vendar nista
  // veljavni zamenjavi za parentSessionId v merchant Cloud Terminal API-ju.
  // preveri v Viva demo: BOOKIE cashRegisterId mora biti sprejemljiv merchant ID.
  const res = await fetch(`${base}/ecr/v1/transactions:refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      sessionId: request.refundSessionId,
      parentSessionId: request.parentSessionId,
      terminalId: request.terminalId,
      cashRegisterId: request.context.cashRegisterId,
      amount: znesekCenti,
      currencyCode: 978,
      // merchantReference je dovoljeno prosto besedilo; ohrani še shranjena
      // Viva ID-ja za sledljivost pri usklajevanju merchantovih transakcij.
      merchantReference: `${request.merchantReference}; ORIG:${originalReference}${originalOrderSuffix}`,
      customerTrns: request.customerTrns,
      showTransactionResult: true,
      showReceipt: true,
      interappCallback: "finish",
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Terminal storno napaka: ${res.status} ${err}`);
  }
}
