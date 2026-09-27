export function faktorNormativaModifikatorja(
  normativFaktor: number | string | null | undefined,
  cenaDodatek: number | string | null | undefined,
  jeGnezdeniModifikator = false,
): number {
  if (jeGnezdeniModifikator) return Number(normativFaktor ?? 1);
  return Number(cenaDodatek ?? 0) > 0 ? 1 : Number(normativFaktor ?? 1);
}

export function faktorNormativaPodModifikatorja(
  sourceNormQuantity: number,
  parentNormFactor: number | string | null | undefined,
): number {
  return sourceNormQuantity * Number(parentNormFactor ?? 1);
}