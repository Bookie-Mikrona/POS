/** Prag »Na izteku« (porcij); kasneje nastavljiv po enoti. */
export const PRAG_NA_IZTEKU = 5;

export type StanjeZaloge = "brez" | "ok" | "na_izteku" | "ni";

export interface ArtikelZaloga {
  spremljajPorcije?: boolean;
  availableQuantity?: number | null;
  availableBySize?: Partial<Record<string, number | null>>;
}

/** Največ porcij, ki jih je še mogoče prodati; null = ni izračunane omejitve. Samo prikaz obstoječega izračuna. */
export function razpolozljivePorcije(a: ArtikelZaloga): number | null {
  const velikosti = a.availableBySize ? Object.values(a.availableBySize) : [];
  if (velikosti.length > 0) {
    if (velikosti.some((v) => v == null)) return null;
    return Math.max(...(velikosti as number[]));
  }
  return a.availableQuantity ?? null;
}

export function stanjeZaloge(a: ArtikelZaloga, prag = PRAG_NA_IZTEKU): StanjeZaloge {
  if (!a.spremljajPorcije) return "brez";
  const n = razpolozljivePorcije(a);
  if (n == null) return "brez";
  if (n <= 0) return "ni";
  return n <= prag ? "na_izteku" : "ok";
}

/** »Vodja« je obstoječa vloga prijave (admin podjetja, admin enote, superadmin); nove vloge ni. */
export function jeVodja(vloga: string | null | undefined): boolean {
  return vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin";
}
