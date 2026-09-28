type MealType = "ala_carte" | "prepared" | "composite";

/** Pizza recipes have the same meal classification as other composite dishes. */
export function mealTypeForArticleSave(
  mealType: MealType,
  isSemiPrepared: boolean,
  preparationType: "pica" | "hrana" | "pijaca" | null,
  isPizza: boolean,
): MealType {
  return isSemiPrepared || preparationType === "hrana" || isPizza
    ? mealType
    : "ala_carte";
}