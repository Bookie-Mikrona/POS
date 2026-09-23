export type MalicaPackageRow = {
  id: number;
  pairingGroupId: string | null;
  packageStatus: "active" | "cancelled";
  racunId: number | null;
};

/** Resolves a parent or KDS child to the complete live Malica package. */
export function resolveMalicaPackageRows(
  rows: MalicaPackageRow[],
  requestedId: number,
): MalicaPackageRow[] {
  const requested = rows.find((row) => row.id === requestedId);
  if (!requested?.pairingGroupId?.startsWith("malica:")) return [];
  return rows.filter((row) => row.pairingGroupId === requested.pairingGroupId);
}

export function isPackageAlreadyCancelled(rows: MalicaPackageRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.packageStatus === "cancelled");
}

export function packageHasBilledRow(rows: MalicaPackageRow[]): boolean {
  return rows.some((row) => row.racunId != null);
}

/** Cancelled package rows are excluded from physical daily availability. */
export function countLiveMalicaQuantity(
  rows: Array<{ packageStatus: "active" | "cancelled"; quantity: number }>,
): number {
  return rows
    .filter((row) => row.packageStatus === "active")
    .reduce((sum, row) => sum + row.quantity, 0);
}