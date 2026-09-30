export type PreparedFoodUnit = "porcija" | "kg" | "l";

/** Resolve legacy e-SLOG portion units and new prepared-food base units. */
export function normalizePreparedFoodUnit(unit: string | null | undefined): PreparedFoodUnit {
  const normalized = unit?.trim().toLocaleLowerCase("sl");
  if (["kg", "kgm"].includes(normalized ?? "")) return "kg";
  if (["l", "ltr"].includes(normalized ?? "")) return "l";
  return "porcija";
}

export function preparedFoodUnitCode(unit: PreparedFoodUnit): string {
  return unit === "kg" ? "KGM" : unit === "l" ? "LTR" : "porcija";
}

export function preparedFoodUnitLabel(unit: string | null | undefined): PreparedFoodUnit {
  return normalizePreparedFoodUnit(unit);
}

export function formatPreparedFoodQuantity(value: number | string | null | undefined): string {
  const quantity = Number(value ?? 0);
  if (!Number.isFinite(quantity)) return "0";
  return new Intl.NumberFormat("sl-SI", {
    maximumFractionDigits: 4,
    useGrouping: false,
  }).format(quantity);
}

export function preparedFoodQuantityStep(unit: string | null | undefined): number {
  return normalizePreparedFoodUnit(unit) === "porcija" ? 1 : 0.1;
}

export function preparedFoodQuantityLargeStep(unit: string | null | undefined): number {
  return normalizePreparedFoodUnit(unit) === "porcija" ? 10 : 1;
}