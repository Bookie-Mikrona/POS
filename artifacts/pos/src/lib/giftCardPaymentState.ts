export type GiftCardPaymentStatus = "pending" | "unknown" | "completed";

export interface GiftCardPaymentState {
  idempotencyKey: string;
  amountCents: number;
  attemptId?: string;
  status: GiftCardPaymentStatus;
}

export function giftCardPaymentStorageKey(unitId: string | null, deviceKey?: string | null): string {
  return `pos_gift_card_payment:${unitId ?? "unknown"}:${deviceKey ?? "unknown"}`;
}

export function readGiftCardPaymentState(
  storage: Pick<Storage, "getItem">,
  unitId: string | null,
  deviceKey?: string | null,
): GiftCardPaymentState | null {
  try {
    const raw = storage.getItem(giftCardPaymentStorageKey(unitId, deviceKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GiftCardPaymentState>;
    if (
      typeof value.idempotencyKey !== "string"
      || !/^[A-Za-z0-9_-]{16,128}$/.test(value.idempotencyKey)
      || !Number.isInteger(value.amountCents)
      || value.amountCents! <= 0
      || !["pending", "unknown", "completed"].includes(value.status ?? "")
      || (value.attemptId != null && typeof value.attemptId !== "string")
    ) return null;
    return value as GiftCardPaymentState;
  } catch {
    return null;
  }
}

export function writeGiftCardPaymentState(
  storage: Pick<Storage, "setItem">,
  unitId: string | null,
  deviceKey: string | null | undefined,
  state: GiftCardPaymentState,
): void {
  storage.setItem(giftCardPaymentStorageKey(unitId, deviceKey), JSON.stringify(state));
}

export function clearGiftCardPaymentState(
  storage: Pick<Storage, "removeItem">,
  unitId: string | null,
  deviceKey?: string | null,
): void {
  storage.removeItem(giftCardPaymentStorageKey(unitId, deviceKey));
}

export function buildGiftSumupPayBody(state: Pick<GiftCardPaymentState, "idempotencyKey" | "amountCents">) {
  return {
    purpose: "gift_voucher" as const,
    znesek: state.amountCents / 100,
    paymentAttemptId: state.idempotencyKey,
  };
}

export function buildCardGiftIssuancePayment(
  state: Pick<GiftCardPaymentState, "idempotencyKey" | "amountCents" | "attemptId">,
) {
  if (!state.attemptId) throw new Error("Manjka kanonični UUID plačilnega poskusa.");
  return {
    znesek: state.amountCents / 100,
    idempotencyKey: state.idempotencyKey,
    paymentAttemptId: state.attemptId,
  };
}