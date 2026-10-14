/** Predpona »Miza« se doda le, če ime mize z njo še ne začne (neobčutljivo na velikost črk). */
export function formatMizaLabel(ime: string | null | undefined, stevilka?: number | string | null): string {
  const name = ime?.trim();
  if (name) return /^miza(\s|$)/i.test(name) ? name : `Miza ${name}`;
  return stevilka != null && stevilka !== "" ? `Miza ${stevilka}` : "Miza";
}
