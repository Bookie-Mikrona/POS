const SUMUP_BASE = "https://api.sumup.com";

interface SumUpCheckout {
  id: string;
  checkout_reference: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
}

async function getMerchantEmail(apiKey: string): Promise<string> {
  const res = await fetch(`${SUMUP_BASE}/v0.1/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`SumUp /me napaka: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { personal_details?: { email?: string }; email?: string };
  const email = data.personal_details?.email ?? data.email;
  if (!email) throw new Error("SumUp: ni mogoče pridobiti e-poštnega naslova trgovca");
  return email;
}

export async function ustvariCheckout(
  znesekEur: number,
  referenca: string,
  apiKey: string,
): Promise<string> {
  const merchantEmail = await getMerchantEmail(apiKey);
  const res = await fetch(`${SUMUP_BASE}/v0.1/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      checkout_reference: referenca,
      amount: znesekEur,
      currency: "EUR",
      pay_to_email: merchantEmail,
      description: `Narocilo ${referenca}`,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`SumUp checkout napaka: ${res.status} ${err}`);
  }
  const checkout = await res.json() as SumUpCheckout;
  return checkout.id;
}

export async function posredujNaTerminal(
  checkoutId: string,
  serial: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch(
    `${SUMUP_BASE}/v0.1/terminals/${encodeURIComponent(serial)}/checkout`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ checkout: { id: checkoutId } }),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`SumUp terminal push napaka: ${res.status} ${err}`);
  }
}

export async function preveriStatus(
  checkoutId: string,
  apiKey: string,
): Promise<"PAID" | "PENDING" | "FAILED"> {
  const res = await fetch(
    `${SUMUP_BASE}/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) return "FAILED";
  const checkout = await res.json() as SumUpCheckout;
  if (checkout.status === "PAID") return "PAID";
  if (checkout.status === "FAILED" || checkout.status === "EXPIRED" || checkout.status === "CANCELLED") {
    return "FAILED";
  }
  return "PENDING";
}
