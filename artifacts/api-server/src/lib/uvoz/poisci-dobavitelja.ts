// artifacts/api-server/src/lib/uvoz/poisci-dobavitelja.ts
//
// Samodejno iskanje slovenskega dobavitelja po delnem nazivu in IBAN.
// Tok: DuckDuckGo Lite → bizi.si URL → scrape davčne → VIES preveri
//
// Nobena zunanja API ključ ni potrebna — samo javno dostopni endpointi.

const DDG_LITE = 'https://lite.duckduckgo.com/lite/';
const BIZI_BASE = 'https://www.bizi.si';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

export interface PodjetjePredlog {
  naziv:     string;
  davcna:    string; // 8 cifer, brez SI
  naslov:    string | null;
  biziSlug:  string;
}

/**
 * Išče bizi.si slug prek DuckDuckGo Lite (brez API ključa, brez JavaScript).
 * Vrne slug prvega relevantnega zadetka ali null.
 */
async function iskajBiziSlug(naziv: string): Promise<string | null> {
  const q = `${naziv} site:bizi.si`;
  const r = await fetch(`${DDG_LITE}?q=${encodeURIComponent(q)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) return null;
  const html = await r.text();

  // DDG Lite vrne bizi.si URL-je v besedilu (brez protokola)
  // Vzorec: bizi.si/NAZIV-D-O-O-KRAJ ali bizi.si/NAZIV-D-O-O
  const matches = [
    ...html.matchAll(/bizi\.si\/((?:[A-Z0-9][A-Z0-9\-]+-D-[A-Z]-[A-Z0-9\-]+)|(?:[A-Z0-9][A-Z0-9\-]{8,}))/gi),
  ];
  if (matches.length === 0) return null;

  // Vzamemo prvi zadetek, ki vsebuje del naziva (primer: "DAVIDOV" → DAVIDOV-HRAM-...)
  const besede = naziv.split(/\s+/).map(w => w.toUpperCase());
  const relevanten = matches.find(m =>
    besede.some(b => m[1].toUpperCase().includes(b))
  ) ?? matches[0];

  return relevanten[1];
}

/**
 * Scrape-a bizi.si stran podjetja in vrne davčno številko + naziv + naslov.
 * HTML struktura (potrjena 2026-07):
 *   <div class="col-6 b-attr-name">Davčna številka&nbsp;SI:</div>
 *   <div class="col-6 b-attr-value pl-1">
 *       58843302
 */
async function scraperBiziPodjetje(slug: string): Promise<PodjetjePredlog | null> {
  const url = `${BIZI_BASE}/${slug.toUpperCase()}/`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(7000) });
  if (!r.ok) return null;
  const html = await r.text();

  // Davčna: poiščemo sekcijo "Davčna" in vzamemo naslednjo b-attr-value vrednost
  const davcnaMatch = html.match(
    /Dav[čc]na[\s\S]{1,400}?b-attr-value[^>]*>\s*(\d{8})/
  );
  if (!davcnaMatch) return null;
  const davcna = davcnaMatch[1];

  // Naziv: iz <title> pred prvim ' - ' ali '|'
  const nazivMatch = html.match(/<title>([^<|–\-]+)/i);
  const naziv = nazivMatch
    ? nazivMatch[1].trim().replace(/\s+\S+$/, '').trim() // odreže zadnjo besedo (ki je pogosto Bizi)
    : slug.replace(/-/g, ' ');

  // Naslov: iz sekcije "Naslov"
  const naslovMatch = html.match(
    /Naslov[\s\S]{1,300}?b-attr-value[^>]*>\s*([^\n<]{5,80})/
  );

  return {
    naziv:    naziv.replace(/\s+$/, ''),
    davcna,
    naslov:   naslovMatch?.[1]?.trim() ?? null,
    biziSlug: slug,
  };
}

/**
 * Validira, ali IBAN OCR-ja se ujema s TRR-ji na bizi.si strani.
 * Vrne true, če ujemanje ali ni IBAN-a za primerjavo.
 */
async function validiraiIban(slug: string, iban: string | null): Promise<boolean> {
  if (!iban) return true; // Brez IBAN-a: ne zavračamo

  const ibanNorm = iban.replace(/\s/g, '').toUpperCase();
  try {
    const r = await fetch(`${BIZI_BASE}/${slug.toUpperCase()}/trr-in-blokade/`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return true; // Pri napaki ne zavrnemo
    const html = await r.text();
    return html.includes(ibanNorm);
  } catch {
    return true; // Timeout ali napaka omrežja: ne zavrnemo
  }
}

/**
 * Glavna funkcija: poišče slovensko podjetje po delnem nazivu + IBAN.
 * Vrne PodjetjePredlog (z davčno) ali null, če zadetka ni.
 *
 * Tok:
 *   1. DDG Lite search → bizi.si URL slug
 *   2. bizi.si scrape → davčna + naziv + naslov
 *   3. IBAN validacija (cross-check z TRR stranjo)
 */
export async function poisciDobaviteljaAI(
  naziv: string,
  iban:  string | null,
): Promise<PodjetjePredlog | null> {
  const trimNaziv = naziv?.trim() ?? '';
  if (trimNaziv.length < 3) return null;

  try {
    const slug = await iskajBiziSlug(trimNaziv);
    if (!slug) return null;

    const podjetje = await scraperBiziPodjetje(slug);
    if (!podjetje) return null;

    // Cross-check IBAN z bizi.si TRR stranjo
    const ibanUjema = await validiraiIban(slug, iban);
    if (!ibanUjema) return null; // IBAN ne ustreza — napačno podjetje

    return podjetje;
  } catch {
    return null; // Mrežna napaka ali timeout — tiho pademo nazaj na picker
  }
}
