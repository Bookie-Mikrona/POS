import { Decimal } from "decimal.js";

type OcrPostavka = Record<string, unknown>;

function imaVrednost(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/**
 * Pri embalažni tabeli se podatki nikoli ne smejo prenesti na prejšnjo vrstico.
 * OCR zato najprej vrne tudi prazne vrstice, mi pa jih odstranimo šele tukaj.
 */
export function filtrirajPrazneOcrVrsticeEmbalaze(postavke: OcrPostavka[]): OcrPostavka[] {
  return postavke.filter((postavka) => {
    if (String(postavka.vrsticaTip ?? "").trim().toLowerCase() !== "embalaza") {
      return true;
    }

    const imaIdentiteto = imaVrednost(postavka.sifra) || imaVrednost(postavka.naziv);
    const imaLastenPodatek = [
      postavka.gtin,
      postavka.cena,
      postavka.prejetaKolicina,
      postavka.vrnjenaKolicina,
    ].some(imaVrednost);

    return imaIdentiteto && imaLastenPodatek;
  });
}

function decimalAliNull(value: unknown): Decimal | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Dobavnice lahko na isti vrstici embalaže izkazujejo ločeno prejeto in
 * vrnjeno količino. Za fizično sled ustvarimo dva prometa, ne le neto razlike.
 */
export function razsiriOcrPrometeEmbalaze(postavke: OcrPostavka[]): OcrPostavka[] {
  return filtrirajPrazneOcrVrsticeEmbalaze(postavke).flatMap((postavka) => {
    const prejeta = decimalAliNull(postavka.prejetaKolicina);
    const vrnjena = decimalAliNull(postavka.vrnjenaKolicina);
    const imaLocenaPrometa = prejeta !== null || vrnjena !== null;

    if (!imaLocenaPrometa) return [postavka];

    const prometi: OcrPostavka[] = [];
    if (prejeta?.gt(0)) {
      prometi.push({
        ...postavka,
        kolicina: prejeta.toString(),
      });
    }
    if (vrnjena?.gt(0)) {
      prometi.push({
        ...postavka,
        kolicina: vrnjena.negated().toString(),
        cena: "0",
        vrednost: "0",
        popust: null,
        davek: 0,
      });
    }
    return prometi;
  });
}