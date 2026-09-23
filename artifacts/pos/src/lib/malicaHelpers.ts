export function isMalicaChoiceUnavailable(row: { enabled?: boolean; remainingQuantity?: number | null }): boolean {
  if (row.enabled === false) return true;
  if (row.remainingQuantity === 0) return true;
  return false;
}

export function isQuantityControlDisabledForPackage(row: { isMulticourseBundle?: boolean; pairingGroupId?: string | null }): boolean {
  if (row.isMulticourseBundle === true) return true;
  if (row.pairingGroupId != null) {
    const group = String(row.pairingGroupId);
    if (group.startsWith("malica:") || group.startsWith("daily-lunch:")) return true;
  }
  return false;
}
