import type { NormativItem } from "./kopiraj-normativ";

export type BatchIngredient = NormativItem & { yieldPercent: string };

/** Quantities use the ingredient's stock unit, never an inferred grams/kg conversion. */
export function calculateBatchNormative(
  ingredients: BatchIngredient[],
  portionsText: string,
): NormativItem[] {
  const number = (value: string) => {
    const text = value.trim().replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(text)) return NaN;
    return Number(text);
  };
  const portions = number(portionsText);
  if (!Number.isSafeInteger(portions) || portions < 1 || portions > 10000) {
    throw new Error("Število kosov mora biti celo število med 1 in 10.000.");
  }
  if (!ingredients.length) throw new Error("Najprej dodajte surovine v normativ.");
  return ingredients.map(({ yieldPercent, ...ingredient }, index) => {
    const quantity = number(ingredient.kolicina);
    const yieldValue = number(yieldPercent);
    if (!Number.isSafeInteger(ingredient.vhodniArtikelId) || ingredient.vhodniArtikelId < 1
      || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(yieldValue) || yieldValue <= 0 || yieldValue > 100) {
      throw new Error(`Vrstica ${index + 1}: izberite surovino, pozitivno količino in izkoristek nad 0 do 100 %.`);
    }
    const perPortion = Math.round((quantity / (yieldValue / 100) / portions + Number.EPSILON) * 10000) / 10000;
    if (!Number.isFinite(perPortion) || perPortion < 0.0001 || perPortion >= 1000000) {
      throw new Error(`Vrstica ${index + 1}: količina na kos je izven dovoljenega obsega. Preverite mersko enoto.`);
    }
    return { ...ingredient, kolicina: String(perPortion) };
  });
}