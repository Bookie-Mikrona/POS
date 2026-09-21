/**
 * Enoten prikaz mize s prostorom: »Miza 5 · Terasa«.
 * - miza z prostorom  → "{mizaIme|Miza N} · {prostorIme}"
 * - miza brez prostora → samo naziv mize (brez ločila)
 * - brez mize          → fallback (privzeto "Direktna prodaja")
 */
export function formatMizaProstor(
  n: { mizaIme?: string | null; mizaStevilka?: number | null; prostorIme?: string | null },
  fallback = "Direktna prodaja",
): string {
  const miza = n.mizaIme ?? (n.mizaStevilka != null ? `Miza ${n.mizaStevilka}` : null);
  if (miza == null) return fallback;
  return n.prostorIme ? `${miza} · ${n.prostorIme}` : miza;
}
