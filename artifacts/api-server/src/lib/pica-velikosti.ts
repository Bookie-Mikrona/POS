export const PIZZA_VELIKOSTI = [
  { id: "mala", naziv: "Mala", key: "picaPremerMala" },
  { id: "normalna", naziv: "Normalna", key: "picaPremerNormalna" },
  { id: "druzinska", naziv: "Družinska", key: "picaPremerDruzinska" },
] as const;

export type PizzaVelikostId = typeof PIZZA_VELIKOSTI[number]["id"];

export type PizzaVelikost = {
  id: PizzaVelikostId;
  naziv: string;
  premerCm: number;
  normativFaktor: number;
};

/** Normalna je privzeta cena/velikost; če ni aktivna, uporabimo prvo aktivno. */
export function privzetaVelikostPice<T extends { id: PizzaVelikostId }>(velikosti: T[]): T | undefined {
  return velikosti.find((velikost) => velikost.id === "normalna") ?? velikosti[0];
}

type PizzaCeneArtikla = {
  cena: string | number;
  cenaMala?: string | number | null;
  cenaDruzinska?: string | number | null;
};

type PizzaHappyHourCeneArtikla = {
  happyHourCena?: string | number | null;
  happyHourCenaMala?: string | number | null;
  happyHourCenaDruzinska?: string | number | null;
};

/**
 * Vrne dejansko prodajno ceno izbrane velikosti. Osnovna cena artikla je
 * namenoma še vedno cena normalne velikosti, zato stari artikli ostanejo
 * združljivi, dokler nimajo aktivne dodatne velikosti.
 */
export function cenaPicePoVelikosti(
  artikel: PizzaCeneArtikla,
  velikost: PizzaVelikostId,
): number | null {
  const rawCenaVelikosti = velikost === "mala"
    ? artikel.cenaMala
    : velikost === "druzinska"
      ? artikel.cenaDruzinska
      : artikel.cena;
  // Stari artikli nimajo ločenih cen. Dokler jih skrbnik ne odpre in shrani,
  // jih pri prodaji varno ohranimo na osnovni ceni.
  const rawCena = rawCenaVelikosti ?? artikel.cena;
  if (rawCena === null || rawCena === undefined) return null;
  const cena = Number(rawCena);
  return Number.isFinite(cena) && cena >= 0 ? cena : null;
}

/**
 * Vrne Happy Hour ceno točno izbrane velikosti. Namenoma nima fallbacka na
 * normalno velikost, ker bi s tem malo ali družinsko pico prodali po napačni
 * promocijski ceni. Klicatelj ob null ohrani redno ceno izbrane velikosti.
 */
export function happyHourCenaPicePoVelikosti(
  artikel: PizzaHappyHourCeneArtikla,
  velikost: PizzaVelikostId,
): number | null {
  const rawCena = velikost === "mala"
    ? artikel.happyHourCenaMala
    : velikost === "druzinska"
      ? artikel.happyHourCenaDruzinska
      : artikel.happyHourCena;
  if (rawCena === null || rawCena === undefined) return null;
  const cena = Number(rawCena);
  return Number.isFinite(cena) && cena >= 0 ? cena : null;
}

/**
 * Normalna velikost ima vedno faktor 1. Če enota začasno uporablja samo
 * eno nenormalno velikost, je ta varno obravnavana kot normativna osnova.
 */
export function izracunajVelikostiPic(nastavitve: Record<string, string>): PizzaVelikost[] {
  const aktivne = PIZZA_VELIKOSTI
    .map((velikost) => ({
      ...velikost,
      premerCm: Number(nastavitve[velikost.key] ?? 0),
    }))
    .filter((velikost) => Number.isFinite(velikost.premerCm) && velikost.premerCm > 0);

  const normalna = aktivne.find((velikost) => velikost.id === "normalna") ?? aktivne[0];
  if (!normalna) return [];

  const normalnaPovrsina = 3.14 * (normalna.premerCm / 2) ** 2;
  return aktivne.map((velikost) => ({
    id: velikost.id,
    naziv: velikost.naziv,
    premerCm: velikost.premerCm,
    normativFaktor: velikost.id === normalna.id
      ? 1
      : Number((3.14 * (velikost.premerCm / 2) ** 2 / normalnaPovrsina).toFixed(6)),
  }));
}