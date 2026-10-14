/**
 * Skupni slovenski zapis zneskov: decimalna vejica, pika kot ločilo tisočic,
 * presledek pred €. Izpis je ročen, da ni odvisen od ICU okolja.
 */
export function formatEur(value: number | string | null | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const cents = Math.round(Math.abs(safe) * 100);
  const euros = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (cents % 100).toString().padStart(2, "0");
  return `${safe < 0 && cents > 0 ? "-" : ""}${euros},${rest} €`;
}
