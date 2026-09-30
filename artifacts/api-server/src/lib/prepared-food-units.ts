const PORTION_ALIASES = new Set([
  "porcija", "porcije", "porc", "portion", "portions", "serving", "servings",
]);
const LEGACY_PORTION_UNITS = new Set(["h87", "kos", "kom", "pce", "ea"]);
const KILOGRAM_ALIASES = new Set(["kg", "kilogram", "kilograms", "kgm"]);
const LITER_ALIASES = new Set(["l", "liter", "liters", "litre", "litres", "ltr"]);

export type PreparedFoodUnitSemantic = "mass" | "volume" | "portion" | `unsupported:${string}`;

export function normalizePreparedFoodUnit(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim();
  const alias = normalized.toLocaleLowerCase("en");
  if (KILOGRAM_ALIASES.has(alias)) return "KGM";
  if (LITER_ALIASES.has(alias)) return "LTR";
  if (PORTION_ALIASES.has(alias)) return "H87";
  return normalized;
}

export function preparedFoodUnitSemantic(value: string | null | undefined): PreparedFoodUnitSemantic {
  const unit = normalizePreparedFoodUnit(value);
  if (unit === "KGM") return "mass";
  if (unit === "LTR") return "volume";
  if (unit == null || LEGACY_PORTION_UNITS.has(unit.toLocaleLowerCase("en"))) return "portion";
  return `unsupported:${unit}`;
}

export function preparedFoodUnitLabel(value: string | null | undefined): string {
  const unit = normalizePreparedFoodUnit(value);
  if (unit === "KGM") return "kg";
  if (unit === "LTR") return "l";
  if (unit == null || LEGACY_PORTION_UNITS.has(unit.toLocaleLowerCase("en"))) return "porcija";
  return unit;
}

export function isPreparedFoodBulkUnit(value: string | null | undefined): boolean {
  const semantic = preparedFoodUnitSemantic(value);
  return semantic === "mass" || semantic === "volume";
}

export function isSupportedPreparedFoodUnit(value: string | null | undefined): boolean {
  const unit = normalizePreparedFoodUnit(value);
  return unit == null
    || unit === "KGM"
    || unit === "LTR"
    || LEGACY_PORTION_UNITS.has(unit.toLocaleLowerCase("en"));
}

export function preparedFoodUnitRoleError(input: {
  mealType?: string | null;
  unit?: string | null;
  purchaseArticle?: boolean;
  salesArticle?: boolean;
  returnablePackaging?: boolean;
}): string | null {
  if (input.mealType === "prepared" && !isSupportedPreparedFoodUnit(input.unit)) {
    return "Pripravljena jed mora uporabljati enoto porcija, kg ali l.";
  }
  if (input.mealType === "prepared" && isPreparedFoodBulkUnit(input.unit)
    && (input.purchaseArticle || input.salesArticle || input.returnablePackaging)) {
    return "Pripravljena jed z mersko enoto kg ali l mora biti neprodajni in nenabavni polizdelek.";
  }
  return null;
}