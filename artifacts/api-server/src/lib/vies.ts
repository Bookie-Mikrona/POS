/**
 * VIES — EU VAT Information Exchange System
 * REST API: https://ec.europa.eu/taxation_customs/vies/rest-api/
 *
 * Javni API brez avtentikacije. Timeout 6 s; ob napaki vrne null (ne meče).
 */

/** ISO 3166-1 alpha-2 → slovensko ime države (EU + pogosti partnerji) */
const DRZAVE: Record<string, string> = {
  AT: 'Avstrija', BE: 'Belgija', BG: 'Bolgarija', CY: 'Ciper',
  CZ: 'Češka', DE: 'Nemčija', DK: 'Danska', EE: 'Estonija',
  ES: 'Španija', FI: 'Finska', FR: 'Francija', GR: 'Grčija',
  HR: 'Hrvaška', HU: 'Madžarska', IE: 'Irska', IT: 'Italija',
  LT: 'Litva', LU: 'Luksemburg', LV: 'Latvija', MT: 'Malta',
  NL: 'Nizozemska', PL: 'Poljska', PT: 'Portugalska', RO: 'Romunija',
  SE: 'Švedska', SI: 'Slovenija', SK: 'Slovaška',
  GB: 'Združeno kraljestvo', CH: 'Švica', NO: 'Norveška',
  US: 'ZDA', CN: 'Kitajska', JP: 'Japonska', TR: 'Turčija',
  RS: 'Srbija', BA: 'Bosna in Hercegovina', MK: 'Severna Makedonija',
};

export interface ViesIzid {
  veljaven: boolean;
  naziv: string | null;
  /** Polni naslov kot niz (fallback) */
  naslov: string | null;
  /** Strukturiran naslov iz viesApproximate (kadar ga VIES vrne) */
  ulica: string | null;
  postnaStevilka: string | null;
  kraj: string | null;
  /** Slovensko ime države */
  drzavaNaziv: string | null;
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
      viesApproximate?: {
        name?: string;
        street?: string;
        postalCode?: string;
        city?: string;
      };
    };

    const naziv =
      clean(data.traderName) ?? clean(data.viesApproximate?.name) ?? clean(data.name) ?? null;

    // Strukturiran naslov — prednostno viesApproximate
    const ulica        = clean(data.viesApproximate?.street) ?? null;
    const postnaStevilka = clean(data.viesApproximate?.postalCode) ?? null;
    const kraj         = clean(data.viesApproximate?.city) ?? null;

    // Polni naslov kot fallback
    const naslov =
      clean(data.traderAddress) ?? clean(data.address) ?? null;

    const drzavaNaziv = DRZAVE[kodaDrzave] ?? null;

    return {
      veljaven: data.isValid,
      naziv, naslov,
      ulica, postnaStevilka, kraj,
      drzavaNaziv,
      kodaDrzave, stDdv,
    };
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

/** Slovensko ime za ISO kodo države (npr. "DE" → "Nemčija") */
export function drzavaIzKode(koda?: string | null): string | null {
  if (!koda) return null;
  return DRZAVE[koda.toUpperCase()] ?? null;
}
