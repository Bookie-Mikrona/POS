/**
 * Viva.com Terminal Android inter-app sale request.
 *
 * The browser form uses intent://pay/v1 with scheme=vivapayclient. Android
 * resolves that form as vivapayclient://pay/v1 and opens the Terminal app.
 */

export const VIVA_TERMINAL_PRODUCTION_PACKAGE = "com.vivawallet.spoc.payapp";
export const VIVA_TERMINAL_DEMO_PACKAGE = "com.vivawallet.spoc.payapp.demo";

// Android zahtevek Vivo odpre iz nameščenega Bridge APK-ja, zato mora appId
// označevati dejanski Android odjemalec in ne spletnega POS-a.
export const BOOKIE_VIVA_CLIENT_APP_ID = "com.bookievivabridge";

export interface VivaAndroidSaleIntentOptions {
  amountCents: number;
  clientTransactionId: string;
  callbackUrl: string;
  sourceCode?: string;
  demo: boolean;
}

interface BookieVivaBridgeState {
  v: 1;
  returnUrl: string;
  clientTransactionId: string;
}

function encodeBridgeState(state: BookieVivaBridgeState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildBookieVivaBridgeCallbackUrl(
  returnUrl: string,
  clientTransactionId: string,
): string {
  const parsedReturnUrl = new URL(returnUrl);
  if (parsedReturnUrl.protocol !== "https:" && parsedReturnUrl.hostname !== "localhost") {
    throw new Error("Viva bridge zahteva varen HTTPS povratni naslov.");
  }
  const state = encodeBridgeState({ v: 1, returnUrl: parsedReturnUrl.toString(), clientTransactionId });
  return `bookie-viva-bridge://result/${state}`;
}

export function buildBookieVivaBridgeLaunchUrl(
  vivaIntentUrl: string,
  callbackUrl: string,
): string {
  const state = new URL(callbackUrl).pathname.replace(/^\/+/, "");
  if (!state || !vivaIntentUrl.startsWith("intent://pay/v1")) {
    throw new Error("Neveljaven Viva Android plačilni zahtevek.");
  }
  return `bookie-viva-bridge://pay/${state}?target=${encodeURIComponent(vivaIntentUrl)}`;
}

export function buildVivaAndroidSaleIntent({
  amountCents,
  clientTransactionId,
  callbackUrl,
  sourceCode,
  demo,
}: VivaAndroidSaleIntentOptions): string {
  const normalizedSourceCode = sourceCode?.trim();
  if (normalizedSourceCode && !/^\d{1,10}$/.test(normalizedSourceCode)) {
    throw new Error("Viva sourceCode mora biti številčna koda.");
  }

  const params = new URLSearchParams({
    appId: BOOKIE_VIVA_CLIENT_APP_ID,
    action: "sale",
    clientTransactionId,
    amount: String(amountCents),
    paymentMethod: "CardPresent",
    show_receipt: "true",
    show_transaction_result: "true",
    show_rating: "false",
    callback: callbackUrl,
    ...(normalizedSourceCode ? { sourceCode: normalizedSourceCode } : {}),
  });
  const targetPackage = demo
    ? VIVA_TERMINAL_DEMO_PACKAGE
    : VIVA_TERMINAL_PRODUCTION_PACKAGE;
  const fallbackUrl = encodeURIComponent("https://www.vivawallet.com/");

  return `intent://pay/v1?${params.toString()}#Intent;scheme=vivapayclient;package=${targetPackage};S.browser_fallback_url=${fallbackUrl};end`;
}

export type VivaAndroidSaleCallback =
  | { kind: "approved"; transactionId: string | null }
  | { kind: "failed"; reason: string }
  | { kind: "missing" };

export function getVivaCallbackNarociloId(search: string): number | null {
  const params = new URLSearchParams(search);
  if (params.get("vivaTapToPay") !== "1" && params.get("vivaAndroid") !== "1") return null;
  const id = Number(params.get("narocilo"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isVivaAndroidSaleCallback(
  params: URLSearchParams,
  marker: "vivaAndroid" | "vivaTapToPay",
  hasStoredAttempt: boolean,
): boolean {
  if (params.get(marker) === "1") return true;
  if (!hasStoredAttempt) return false;
  return ["status", "vivaResult", "transactionId", "clientTransactionId", "errorCode"]
    .some((key) => params.has(key));
}

/**
 * Sprejme uradni Viva sale callback (`status=success`) in ohrani prejšnji
 * `vivaResult=ok|fail` kot združljivostno rezervo za že nameščene aplikacije.
 */
export function parseVivaAndroidSaleCallback(params: URLSearchParams): VivaAndroidSaleCallback {
  const officialStatus = params.get("status");
  const legacyResult = params.get("vivaResult");
  const transactionId = params.get("transactionId")?.trim() || null;

  if (officialStatus === "success" || legacyResult === "ok") {
    return { kind: "approved", transactionId };
  }

  // preveri v Viva demo: dokumentacija potrjuje status=success, ne opisuje pa
  // vseh nizov za zavrnjeno plačilo. Neuspešen/neznan vrnjen status je fail-safe.
  if (legacyResult === "fail" || (officialStatus !== null && officialStatus !== "success")) {
    return {
      kind: "failed",
      reason: params.get("message") ?? params.get("errorCode") ?? officialStatus ?? "neznan rezultat",
    };
  }

  return { kind: "missing" };
}