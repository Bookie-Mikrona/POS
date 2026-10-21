/**
 * Privzeti šifranti za novo gostinsko enoto. Osnova so artikli enote Križišče (brez drobnega inventarja),
 * dopolnjeni z dodatnimi artikli Bookie, ki jih Križišče nima. Podatki so v privzeti-sifranti-podatki.ts.
 * Cene so okvirne (z DDV) in jih enota po uvozu uredi sama. Alergeni in modifikatorji se ne prenesejo.
 */
import { PRIVZETI_PODATKI } from "./privzeti-sifranti-podatki";

export type PrivzetaDavcnaKategorija = "food" | "food_drink" | "hot_beverage" | "cold_beverage" | "alcoholic" | "other";
export type NormativVrstica = readonly [kljuc: string, kolicina: number];
/** S = nabavni artikel, P = polizdelek, R = pripravljena jed (ni v prodaji), A = prodajni artikel. */
export type VlogaArtikla = "S" | "P" | "R" | "A";

export type PrivzetaKategorija = {
  kljuc: string; ime: string; barva: string; tip: "hrana" | "pijaca" | null; oddelek: string; red: number;
};

export type PrivzetiArtikel = {
  kljuc: string; ime: string; vloga: VlogaArtikla; kat: string | null; cena: number;
  tax: PrivzetaDavcnaKategorija; sladkor: boolean; alkohol: boolean; enota: string | null; vrsta: string | null;
  nab: boolean; meal: "ala_carte" | "prepared" | "composite"; priprava: string | null; opis: string | null;
  imeZaNabavo: string | null; pica: boolean; cenaMala: number | null; toGo: boolean; toGoArtikli: string[];
  qr: boolean; sp: boolean; malica: string; batch: number | null; nabDdv: number | null; red: number;
  normativ: NormativVrstica[]; izvor: "krizisce" | "bookie";
};

export type PrivzetiPodatki = {
  kategorije: PrivzetaKategorija[];
  artikli: PrivzetiArtikel[];
  pizza: { normal: string; small: string; family: string };
};

export const PRIVZETE_KATEGORIJE: PrivzetaKategorija[] = PRIVZETI_PODATKI.kategorije;
export const PRIVZETI_VSI: PrivzetiArtikel[] = PRIVZETI_PODATKI.artikli;
export const PRIVZETA_PIZZA = PRIVZETI_PODATKI.pizza;
/** Artikli, ki jih uporabnik izbere (prodajni). Ostalo se uvozi kot odvisnost. */
export const PRIVZETI_ARTIKLI: PrivzetiArtikel[] = PRIVZETI_VSI.filter((a) => a.vloga === "A");
/** Pripravljene jedi (malice), ki jih ne uporablja noben prodajni artikel: izbirne samostojno. */
export const PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE: PrivzetiArtikel[] = (() => {
  const uporabljene = new Set(PRIVZETI_VSI.flatMap((a) => a.normativ.map(([k]) => k)));
  return PRIVZETI_VSI.filter((a) => a.vloga === "R" && !uporabljene.has(a.kljuc));
})();
export const PRIVZETI_PO_KLJUCU = new Map(PRIVZETI_VSI.map((a) => [a.kljuc, a]));
