import Decimal from "decimal.js";

export type DrainedYield = {
  brutoTezaG: string | null;
  netoTezaG: string | null;
  netoDelezOdst: string | null;
};

export type DrainedYieldAction = "inherit" | "set" | "clear";

export class DrainedYieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrainedYieldError";
  }
}

function decimalOrNull(value: unknown, fieldName: string): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const result = new Decimal(String(value).replace(",", "."));
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new DrainedYieldError(`${fieldName} mora biti veljavno število.`);
  }
}

/** Validate yield data and derive its percentage whenever both masses exist. */
export function normalizeDrainedYield(value: {
  brutoTezaG?: unknown;
  netoTezaG?: unknown;
  netoDelezOdst?: unknown;
}): DrainedYield {
  const gross = decimalOrNull(value.brutoTezaG, "Bruto teža");
  let net = decimalOrNull(value.netoTezaG, "Neto odcejena teža");
  let percent = decimalOrNull(value.netoDelezOdst, "Delež neto teže");

  if (gross && !gross.gt(0)) {
    throw new DrainedYieldError("Bruto teža mora biti večja od nič.");
  }
  if (net && !net.gt(0)) {
    throw new DrainedYieldError("Neto odcejena teža mora biti večja od nič.");
  }
  if (gross && net && net.gt(gross)) {
    throw new DrainedYieldError("Neto odcejena teža ne sme presegati bruto teže.");
  }
  if (gross && net) {
    const calculated = net.div(gross).mul(100);
    if (percent && percent.minus(calculated).abs().gt("0.01")) {
      throw new DrainedYieldError("Neto delež se ne ujema z bruto in neto težo.");
    }
    percent = calculated;
  }
  if (percent && (!percent.gt(0) || percent.gt(100))) {
    throw new DrainedYieldError("Neto delež mora biti večji od 0 in največ 100.");
  }
  if (gross && percent && !net) {
    net = gross.mul(percent).div(100);
  }
  return {
    brutoTezaG: gross?.toDecimalPlaces(3).toString() ?? null,
    netoTezaG: net?.toDecimalPlaces(3).toString() ?? null,
    netoDelezOdst: percent?.toDecimalPlaces(4).toString() ?? null,
  };
}

/**
 * Resolve line input without confusing a serialized null (usually "not set")
 * with an intentional reset. `set` snapshots exactly the supplied values;
 * `clear` explicitly disables yield; omitted/`inherit` uses article defaults.
 */
export function resolveDrainedYield(
  line: { brutoTezaG?: unknown; netoTezaG?: unknown; netoDelezOdst?: unknown },
  article: DrainedYield,
  previous?: DrainedYield | null,
  action?: DrainedYieldAction,
): DrainedYield {
  if (action === "clear") return normalizeDrainedYield({});
  if (action === "set") return normalizeDrainedYield(line);
  if (action === "inherit") return normalizeDrainedYield(article);
  const explicitGross = line.brutoTezaG != null;
  const explicitNet = line.netoTezaG != null;
  const explicitPercent = line.netoDelezOdst != null;
  const gross = explicitGross
    ? line.brutoTezaG
    : previous?.brutoTezaG ?? article.brutoTezaG;
  let net = explicitNet
    ? line.netoTezaG
    : previous?.netoTezaG ?? article.netoTezaG;
  let percent = explicitPercent
    ? line.netoDelezOdst
    : previous?.netoDelezOdst ?? article.netoDelezOdst;

  // Net mass and yield percentage are alternate ways to describe the same
  // value. If one is explicitly changed, derive the other instead of mixing
  // that override with a stale value from the previous snapshot/default.
  if (explicitNet && !explicitPercent) percent = null;
  if (explicitPercent && !explicitNet) net = null;
  if (explicitGross && !explicitNet && !explicitPercent) {
    if (percent != null) net = null;
    else percent = null;
  }

  return normalizeDrainedYield({
    brutoTezaG: gross,
    netoTezaG: net,
    netoDelezOdst: percent,
  });
}

function canonicalUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const value = unit.trim().toUpperCase().replace(/[.\s]/g, "");
  if (["KOM", "KOS", "KO", "PCE", "PCS", "EA", "H87"].includes(value)) return "each";
  if (["KG", "KGM", "KILOGRAM"].includes(value)) return "kg";
  if (["G", "GR", "GRM", "GRAM"].includes(value)) return "g";
  return null;
}

export function samePurchaseAndStockUnit(
  purchaseUnit: string | null | undefined,
  stockUnit: string | null | undefined,
): boolean {
  const purchase = canonicalUnit(purchaseUnit);
  const stock = canonicalUnit(stockUnit);
  if (purchase && stock) return purchase === stock;
  return Boolean(purchaseUnit && stockUnit
    && purchaseUnit.trim().toLowerCase() === stockUnit.trim().toLowerCase());
}

export function convertPurchasedQuantity(
  quantity: Decimal,
  fullLineCost: Decimal,
  sourceUnit: string | null | undefined,
  stockUnit: string | null | undefined,
  yieldData: DrainedYield,
): { quantity: Decimal; unitCost: Decimal } {
  if (!quantity.isFinite() || quantity.lt(0)) {
    throw new DrainedYieldError("Nabavna količina mora biti veljavno število, ki ni negativno.");
  }
  if (!fullLineCost.isFinite() || fullLineCost.lt(0)) {
    throw new DrainedYieldError("Skupna vrednost nabavne postavke mora biti veljavno število, ki ni negativno.");
  }
  if (quantity.isZero() && !fullLineCost.isZero()) {
    throw new DrainedYieldError("Postavka z vrednostjo mora imeti količino, večjo od nič.");
  }
  const percent = yieldData.netoDelezOdst ? new Decimal(yieldData.netoDelezOdst) : null;
  const netGrams = yieldData.netoTezaG ? new Decimal(yieldData.netoTezaG) : null;
  if (!percent && !netGrams) {
    return {
      quantity,
      unitCost: quantity.isZero() ? new Decimal(0) : fullLineCost.div(quantity),
    };
  }
  if (canonicalUnit(stockUnit) !== "kg") {
    throw new DrainedYieldError("Odcejena količina zahteva zalogovno enoto KGM/KG.");
  }
  const source = canonicalUnit(sourceUnit);
  if (source === "each") {
    if (!netGrams) {
      throw new DrainedYieldError("Za nabavo v kosih je potrebna neto odcejena teža v gramih.");
    }
    const stockQuantity = quantity.mul(netGrams).div(1000);
    if (!stockQuantity.gt(0)) throw new DrainedYieldError("Preračunana odcejena količina mora biti večja od nič.");
    return { quantity: stockQuantity, unitCost: fullLineCost.div(stockQuantity) };
  }
  if (source === "kg" || source === "g") {
    if (!percent) {
      throw new DrainedYieldError("Za nabavo v masi je potreben bruto/neto podatek ali neto delež.");
    }
    const scale = source === "g" ? new Decimal(1000) : new Decimal(1);
    const stockQuantity = quantity.mul(percent).div(100).div(scale);
    if (!stockQuantity.gt(0)) throw new DrainedYieldError("Preračunana odcejena količina mora biti večja od nič.");
    return { quantity: stockQuantity, unitCost: fullLineCost.div(stockQuantity) };
  }
  throw new DrainedYieldError("Enota nabave ni podprta za preračun odcejene mase.");
}