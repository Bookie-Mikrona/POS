/**
 * DDV (davek na dodano vrednost) pomožne funkcije za frontend.
 *
 * Te funkcije zrcalijo strežniško logiko iz furs.ts in narocila.ts ter
 * omogočajo pisanje unit testov brez odvisnosti od strežnika.
 *
 * Algoritem zaokroževanja mora biti usklajen s strežniško stranjo —
 * vsaka sprememba tukaj mora biti reflected tudi na strežniku (in obratno).
 */

/**
 * Zaokroži število na 2 decimalni mesti (centno zaokroževanje).
 * Uporablja "round half away from zero" (standardno za denarne vrednosti).
 */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Izračuna DDV iz skupnega zneska z DDV (brez zaokroževanja).
 * Formula: znesek * stopnja / (100 + stopnja)
 * Primer: 12.20 EUR z 22% DDV → 12.20 * 22 / 122 = 2.20 EUR DDV
 */
export function izracunajDDV(znesek: number, stopnja: number): number {
  return (znesek * stopnja) / (100 + stopnja);
}

/**
 * Izračuna DDV, zaokrožen na 2 decimalni mesti.
 * Uporabljaj pri seštevanju DDV po postavkah, da preprečiš napake zaokroževanja.
 */
export function izracunajDDVZaokrozen(znesek: number, stopnja: number): number {
  return round2(izracunajDDV(znesek, stopnja));
}

export interface DdvNeskladjeRezultat {
  imaNeskladje: boolean;
  razlika: number;
}

export interface PostavkaZaDDV {
  kolicina: number;
  cenaKos: number;
  skupaj: number;
  davek: number;
}

/**
 * Preveri DDV neskladje v naročilu.
 *
 * Primerja DDV izračunan iz `skupaj` po postavkah (preprost način)
 * z DDV izračunanim po davčnih skupinah (usklajen z FURS SOAP algoritmom).
 * Razlika > 0.01 EUR pomeni neskladje, ki ga FURS zavrne z napako S003.
 *
 * Algoritem je usklajen z `izracunajDDVNeskladje` na strežniku (narocila.ts).
 *
 * @returns `{ imaNeskladje: false, razlika: 0 }` kadar ni neskladja,
 *          sicer `{ imaNeskladje: true, razlika: <EUR> }`
 */
export function preveriDDVNeskladje(
  postavke: PostavkaZaDDV[]
): DdvNeskladjeRezultat {
  if (postavke.length === 0) return { imaNeskladje: false, razlika: 0 };

  const ddv = round2(
    postavke.reduce(
      (acc, p) => acc + round2((p.skupaj * p.davek) / (100 + p.davek)),
      0
    )
  );

  const vatGroups = new Map<number, number>();
  for (const p of postavke) {
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    vatGroups.set(p.davek, (vatGroups.get(p.davek) ?? 0) + taxAmount);
  }
  const skupajDDVSkupin = round2(
    Array.from(vatGroups.values()).reduce((a, b) => a + b, 0)
  );
  const razlika = round2(Math.abs(skupajDDVSkupin - ddv));

  return { imaNeskladje: razlika > 0.01, razlika };
}
