export function faktorNormativaModifikatorja(
  normativFaktor: number | string | null | undefined,
  cenaDodatek: number | string | null | undefined,
): number {
  return Number(cenaDodatek ?? 0) > 0 ? 1 : Number(normativFaktor ?? 1);
}