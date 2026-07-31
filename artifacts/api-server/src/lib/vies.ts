/**
 * VIES — EU VAT Information Exchange System
 * REST API: https://ec.europa.eu/taxation_customs/vies/rest-api/
 *
 * Javni API brez avtentikacije. Timeout 6 s; ob napaki vrne null (ne meče).
 */

export interface ViesIzid {
  veljaven: boolean;
  naziv: string | null;
  naslov: string | null;
  kodaDrzave: string;
  stDdv: string; // brez predpone države
}

/**
 * Preveri EU VAT ID pri VIES.
 * @param idDdv  Celi VAT ID z državo, npr. "DE123456789" ali "SI12345678"
 * @returns ViesIzid ali null, če VIES ni dosegljiv / VAT ID ni EU format
 */
export async function preveriVies(idDdv: string): Promise<ViesIzid | null> {
  const norm = idDdv.replace(/\s/g, '').toUpperCase();
  const m = norm.match(/^([A-Z]{2})(.+)$/);
  if (!m) return null;
  const [, kodaDrzave, stDdv] = m;

  const url =
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${kodaDrzave}/vat/${stDdv}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      isValid: boolean;
      name?: string;
      address?: string;
      traderName?: string;
      traderAddress?: string;
    };

    const naziv =
      clean(data.traderName) ?? clean(data.name) ?? null;
    const naslov =
      clean(data.traderAddress) ?? clean(data.address) ?? null;

    return { veljaven: data.isValid, naziv, naslov, kodaDrzave, stDdv };
  } catch {
    return null; // timeout ali omrežna napaka — uvoz nadaljuje brez VIES
  }
}

/** Vrne null za "---" in prazne nize. */
function clean(s?: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  return t === '---' || t === '' ? null : t;
}
