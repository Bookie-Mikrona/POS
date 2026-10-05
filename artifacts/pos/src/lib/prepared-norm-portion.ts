/** Stored recipes are per kg/l; only the editor uses a normal-portion basis. */
export function preparedNormPortionFactor(bulk: boolean, smallUnitQuantity: string): number {
  const value = Number(smallUnitQuantity.replace(",", ".")) / 1000;
  return bulk && Number.isFinite(value) && value > 0 ? value : 1;
}

export function portionNormQuantity(baseQuantity: number, factor: number): string {
  return Number((baseQuantity * factor).toPrecision(12)).toString();
}

export function baseNormQuantity(portionQuantity: number, factor: number): number {
  return Number((portionQuantity / factor).toPrecision(12));
}
