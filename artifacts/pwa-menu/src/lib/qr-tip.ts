export function parseQrTipInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return 0;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99_999_999.99) return null;
  return Math.round(parsed * 100) / 100;
}

export function formatQrTipInput(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export function calculateQrOrderTotal(orderSubtotal: number, tip: number): number {
  return Math.round((orderSubtotal + tip) * 100) / 100;
}

export function calculateQrReviewTotal(
  existingOrderSubtotal: number,
  cartSubtotal: number,
  tip: number,
): number {
  return calculateQrOrderTotal(existingOrderSubtotal + cartSubtotal, tip);
}