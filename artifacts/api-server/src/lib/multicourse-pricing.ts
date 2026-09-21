export function splitMulticourseGross(totalGross: number, foodPricePercent: number) {
  if (!Number.isFinite(totalGross) || totalGross < 0) throw new Error("Cena menija ni veljavna.");
  if (!Number.isFinite(foodPricePercent) || foodPricePercent < 0 || foodPricePercent > 100) {
    throw new Error("Delež hrane mora biti med 0 in 100.");
  }
  const total = Math.round((totalGross + Number.EPSILON) * 100) / 100;
  const foodGross = Math.round((total * foodPricePercent / 100 + Number.EPSILON) * 100) / 100;
  return { foodGross, wineGross: Math.round((total - foodGross + Number.EPSILON) * 100) / 100 };
}