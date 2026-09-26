/**
 * Rules shared by the Malice price-management route and its focused tests.
 * sortOrder 4 is the highest-priced group and must be scheduled first.
 */
export function requiresHigherGroupConfirmation(
  sortOrder: number,
  previousPriceCents: number | null,
  nextPriceCents: number,
  higherGroupPriceAtDate: number | null,
): boolean {
  return nextPriceCents > (previousPriceCents ?? 0)
    && sortOrder < 4
    && higherGroupPriceAtDate === null;
}

export function isFutureBusinessDate(candidate: string, currentBusinessDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && candidate > currentBusinessDate;
}

/** An initial group price may establish a historical starting point; later changes must be future-dated. */
export function isAllowedGroupPriceDate(candidate: string, currentBusinessDate: string, hasExistingPrice: boolean): boolean {
  return !hasExistingPrice || isFutureBusinessDate(candidate, currentBusinessDate);
}

/** Remaining configured portions; null configuration means unlimited. */
export function remainingQuantity(configured: number | null, sold: number): number | null {
  if (configured === null) return null;
  return Math.max(0, configured - Math.max(0, sold));
}

/** Cancelled orders are never consumption for Malica quotas. */
export function consumesMalicaQuantity(orderStatus: string): boolean {
  return orderStatus !== "preklicano";
}

export type MalicaPairingComposition = { soup: boolean; main: boolean; dessert: boolean };
export function encodeMalicaPairingGroup(composition: MalicaPairingComposition, id: string): string {
  return `malica:s${composition.soup ? 1 : 0}m${composition.main ? 1 : 0}d${composition.dessert ? 1 : 0}:${id}`;
}
export function parseMalicaPairingGroup(value: string): MalicaPairingComposition | null {
  const match = /^malica:s([01])m([01])d([01]):/.exec(value);
  return match ? { soup: match[1] === "1", main: match[2] === "1", dessert: match[3] === "1" } : null;
}