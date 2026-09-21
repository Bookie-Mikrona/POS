export type PreparedAllocationInput = {
  thawedQuantity: number;
  preparedQuantity: number;
  correctionQuantity: number;
  soldQuantity: number;
  frozenAtEndQuantity: number;
  thawedCostPerPortion: number;
  preparedCostPerPortion: number;
};

export type PreparedAllocation = {
  wasteQuantity: number;
  frozenFromThawed: number;
  frozenFromPrepared: number;
  wasteFromThawed: number;
  wasteFromPrepared: number;
  frozenCostPerPortion: number;
  preparedMaterialValue: number;
  remainingMaterialValue: number;
  wasteValue: number;
};

/**
 * The correction reconciles the computer quantity with the actual quantity in
 * the container. It therefore changes the corrected total, the maximum amount
 * that may be frozen, and physical waste.
 *
 * Only today's prepared quantity creates material cost. Waste reclassifies that
 * cost by the prepared cost per portion; thawing and correction create no new
 * cost. The transfer is capped at the full cost of today's prepared batch so
 * material cost can never become negative.
 */
export function allocatePreparedFood(input: PreparedAllocationInput): PreparedAllocation {
  const nonNegativeValues = [
    input.thawedQuantity,
    input.preparedQuantity,
    input.soldQuantity,
    input.frozenAtEndQuantity,
    input.thawedCostPerPortion,
    input.preparedCostPerPortion,
  ];
  if (!Number.isFinite(input.correctionQuantity)
    || nonNegativeValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Prepared-food quantities and costs must be non-negative finite numbers.");
  }
  const correctedTotal = input.thawedQuantity
    + input.preparedQuantity
    + input.correctionQuantity;
  if (correctedTotal < -1e-9) {
    throw new Error("Correction would make the total quantity negative.");
  }
  if (input.soldQuantity > correctedTotal + 1e-9) {
    throw new Error("Sold quantity exceeds the corrected total quantity.");
  }
  const physicalRemaining = Math.max(0, correctedTotal - input.soldQuantity);
  const wasteQuantity = physicalRemaining - input.frozenAtEndQuantity;
  if (wasteQuantity < -1e-9) throw new Error("Frozen-at-end quantity would make waste negative.");

  const frozenFromThawed = Math.min(input.thawedQuantity, input.frozenAtEndQuantity);
  const frozenFromPrepared = Math.min(
    input.preparedQuantity,
    input.frozenAtEndQuantity - frozenFromThawed,
  );
  const frozenValue = frozenFromThawed * input.thawedCostPerPortion
    + frozenFromPrepared * input.preparedCostPerPortion;
  const normalizedWasteQuantity = Math.max(0, wasteQuantity);
  const preparedMaterialValue = input.preparedQuantity * input.preparedCostPerPortion;
  const wasteFromPrepared = Math.min(input.preparedQuantity, normalizedWasteQuantity);
  const wasteValue = wasteFromPrepared * input.preparedCostPerPortion;
  return {
    wasteQuantity: normalizedWasteQuantity,
    frozenFromThawed,
    frozenFromPrepared,
    wasteFromThawed: Math.max(0, normalizedWasteQuantity - wasteFromPrepared),
    wasteFromPrepared,
    frozenCostPerPortion: input.frozenAtEndQuantity > 0 ? frozenValue / input.frozenAtEndQuantity : 0,
    preparedMaterialValue,
    remainingMaterialValue: preparedMaterialValue - wasteValue,
    wasteValue,
  };
}

export function preparedMaterialUnitCost(
  ingredients: Array<{ quantity: number; wac: number }>,
): number {
  return ingredients.reduce((total, ingredient) => {
    if (!Number.isFinite(ingredient.quantity) || !Number.isFinite(ingredient.wac)
      || ingredient.quantity < 0 || ingredient.wac < 0) {
      throw new Error("Ingredient quantity and WAC must be non-negative finite numbers.");
    }
    return total + ingredient.quantity * ingredient.wac;
  }, 0);
}