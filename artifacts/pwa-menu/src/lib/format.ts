/**
 * Skupni formatter zneskov v QR meniju: slovenski zapis z decimalno vejico,
 * piko kot ločilom tisočic in presledkom pred €. Izpis je namenoma ročen, da
 * ni odvisen od ICU okolja (znak minus, 4-mestna števila brez ločila).
 */
export function formatEur(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const cents = Math.round(Math.abs(safe) * 100);
  const euros = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = (cents % 100).toString().padStart(2, '0');
  const negative = safe < 0 && cents > 0;
  return `${negative ? '-' : ''}${euros},${rest} €`;
}

/** Predpona »Miza« se doda samo, če ime mize z njo še ne začne. */
export function formatTableLabel(naziv: string | null | undefined, stevilka: number | string): string {
  const name = naziv?.trim();
  if (!name) return `Miza ${stevilka}`;
  return /^miza(\s|$)/i.test(name) ? name : `Miza ${name}`;
}
