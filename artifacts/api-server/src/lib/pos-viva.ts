const VIVA_ACCOUNTS_BASE = "https://accounts.vivapayments.com";
const VIVA_ACCOUNTS_DEMO = "https://demo-accounts.vivapayments.com";
const VIVA_API_BASE = "https://api.vivapayments.com";
const VIVA_API_DEMO = "https://demo-api.vivapayments.com";
const VIVA_CHECKOUT_BASE = "https://www.vivapayments.com";
const VIVA_CHECKOUT_DEMO = "https://demo.vivapayments.com";

async function pridobiToken(clientId: string, clientSecret: string, demo: boolean): Promise<string> {
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
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Viva Wallet: OAuth odgovor ne vsebuje access_token");
  return data.access_token;
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
): Promise<"PAID" | "PENDING" | "FAILED"> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const res = await fetch(`${base}/api/orders/${encodeURIComponent(orderCode)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return "FAILED";
  // StateId integer: 5=CHARGED/PAID, 1/2/4/7/8=FAILED, ostalo=PENDING
  const data = await res.json() as { StateId?: number };
  if (data.StateId === 5) return "PAID";
  if ([1, 2, 4, 7, 8].includes(data.StateId ?? -1)) return "FAILED";
  return "PENDING";
}

export function smartCheckoutUrl(orderCode: string, demo: boolean): string {
  const base = demo ? VIVA_CHECKOUT_DEMO : VIVA_CHECKOUT_BASE;
  return `${base}/web/checkout?ref=${encodeURIComponent(orderCode)}`;
}

export async function posljiNaTerminal(
  znesekEur: number,
  sessionId: string,
  terminalId: string,
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
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Terminal napaka: ${res.status} ${err}`);
  }
}

export interface TerminalStatusOdgovor {
  status: "PAID" | "PENDING" | "FAILED";
  napaka?: string;
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
    return { status: "FAILED", napaka: `HTTP ${res.status}${errText ? `: ${errText}` : ""}` };
  }
  // statusId: 0/3=PENDING, 1=COMPLETED, 2/4/5=FAILED
  const data = await res.json() as { statusId?: number; statusMessage?: string; errorText?: string; description?: string };
  if (data.statusId === 1) return { status: "PAID" };
  if ([2, 4, 5].includes(data.statusId ?? -1)) {
    const razlog = data.errorText ?? data.statusMessage ?? data.description ?? `statusId=${data.statusId}`;
    return { status: "FAILED", napaka: razlog };
  }
  return { status: "PENDING" };
}

export async function stornirajVivaTerminal(
  znesekEur: number,
  refundSessionId: string,
  identifikator: string,
  terminalId: string,
  clientId: string,
  clientSecret: string,
  demo: boolean,
): Promise<void> {
  const token = await pridobiToken(clientId, clientSecret, demo);
  const base = demo ? VIVA_API_DEMO : VIVA_API_BASE;
  const znesekCenti = Math.round(znesekEur * 100);
  const res = await fetch(`${base}/ecr/v1/transactions/${encodeURIComponent(identifikator)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount: znesekCenti,
      sessionId: refundSessionId,
      terminalId,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Viva Terminal storno napaka: ${res.status} ${err}`);
  }
}
