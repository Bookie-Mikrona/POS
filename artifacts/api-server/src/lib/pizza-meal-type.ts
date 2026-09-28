type MealType = "ala_carte" | "prepared" | "composite";

// The pizza editor does not offer a meal-type control. A stale or incomplete
// client must not change the operational classification during an ordinary edit.
export function mealTypeForPizzaUpdate(
  requested: MealType | undefined,
  existing: MealType,
  wasPizza: boolean,
  isPizza: boolean,
): MealType | undefined {
  if (!isPizza) return requested;
  return wasPizza ? existing : "composite";
}