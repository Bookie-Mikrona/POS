// artifacts/api-server/src/lib/uvoz/poisci-dobavitelja.ts
//
// Samodejno iskanje slovenskega dobavitelja po delnem nazivu in IBAN.
//
// Primarni vir  : ddv.inetis.com — iskalnik DDV zavezancev
//                 (FURS DDV register + AJPES TRR, datum 31.07.2026)
// Fallback      : DuckDuckGo Lite → bizi.si scrape
//
// Brez zunanjih API ključev — samo javno dostopni endpointi.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

export interface PodjetjePredlog {
  naziv:    string;
  davcna:   string; // 8 cifer, brez SI predpone
  naslov:   string | null;
  biziSlug: string; // prazen, če najdeno prek inetis
}

// ─────────────────────────────────────────────────────────────────────────────
// IBAN → lokalni TRR format (potrjeno 2026-07-31)
// SI56 AAAA BBBB BBBB BBB  →  AAAAA-BBBBBBBBBB
// ─────────────────────────────────────────────────────────────────────────────
function ibanVTrr(iban: string): string | null {
  const bban = iban.replace(/\s/g, '').toUpperCase();
  if (!bban.startsWith('SI56') || bban.length !== 19) return null;
  const digits = bban.slice(4); // 15 cifer
  return `${digits.slice(0, 5)}-${digits.slice(5)}`; // XXXXX-XXXXXXXXXX
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARNI VIR: ddv.inetis.com
// Tok: GET (pridobi ViewState + cookie) → POST (iskanje) → parse HTML
// ─────────────────────────────────────────────────────────────────────────────
async function iskajInetis(naziv: string, iban: string | null): Promise<PodjetjePredlog | null> {
  const base = 'https://ddv.inetis.com/Iskalnik.aspx';

  // 1. GET — session cookie + ViewState
  const getR = await fetch(base, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  const cookie = getR.headers.get('set-cookie')?.split(';')[0] ?? '';
  const getHtml = await getR.text();

  const vs    = getHtml.match(/id="__VIEWSTATE"\s+value="([^"]{10,})"/)?.[1] ?? '';
  const vsGen = getHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/)?.[1] ?? '';

  // 2. POST — iskanje po nazivu
  const postR = await fetch(base, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookie,
    },
    body: new URLSearchParams({
      '__VIEWSTATE':          vs,
      '__VIEWSTATEGENERATOR': vsGen,
      'ctl00$ContentPlaceHolder$txtIskalniNiz': naziv,
      'ctl00$ContentPlaceHolder$btnIskanje': 'Iskanje',
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  const html = await postR.text();

  // 3. Davčna: <span id="ctl00_ContentPlaceHolder_DavcnaStevilka">SI58843302</span>
  //    Vsebuje "SI" + 8 cifer — odstranimo predpono SI
  const ddvSpan = html.match(/id="ctl00_ContentPlaceHolder_DavcnaStevilka"[^>]*>(?:SI)?(\d{8})/);
  if (!ddvSpan) return null; // Ni natančnega zadetka ali ni DDV zavezanec

  const davcna = ddvSpan[1];

  // 4. Naziv: iz besedila (strip HTML)
  const txt = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  // Kratek naziv je zanesljivejši za šifrant (vsebuje d.o.o., s.p., ...)
  const kratkiMatch = txt.match(/Kratek naziv:\s*([^\n]{5,80}?)(?:\s+Naslov:|$)/i);
  const polniMatch  = txt.match(new RegExp(
    `(${naziv.split(/\s+/)[0]}[^\\d]{3,100}?)\\s+Kratek`, 'i',
  ));
  const naziv_final = kratkiMatch?.[1]?.trim()
    ?? polniMatch?.[1]?.trim().replace(/\s+$/, '')
    ?? naziv;

  // 5. Naslov
  const naslovMatch = txt.match(/Naslov:\s*([^\n]{3,80}?)(?:\s+DDV|\s+Dav[čc])/i);
  const naslov = naslovMatch?.[1]?.trim() ?? null;

  // 6. TRR-ji: XXXXX-XXXXXXXXXX — za IBAN validacijo
  const trrs = [...html.matchAll(/(\d{5}-\d{10})/g)].map(m => m[1]);

  // 7. IBAN validacija (opcijska — ne blokiramo če TRR seznam prazen)
  if (iban && trrs.length > 0) {
    const localTrr = ibanVTrr(iban);
    if (localTrr && !trrs.includes(localTrr)) {
      // IBAN ne ustreza nobenemu TRR-ju tega podjetja → napačen zadetek
      return null;
    }
  }

  return { naziv: naziv_final, davcna, naslov, biziSlug: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK: DuckDuckGo Lite → bizi.si scrape
// ─────────────────────────────────────────────────────────────────────────────
async function iskajBiziSlug(naziv: string): Promise<string | null> {
  const r = await fetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(naziv + ' site:bizi.si')}`,
    { headers: HEADERS, signal: AbortSignal.timeout(7000) },
  );
  if (!r.ok) return null;
  const html = await r.text();
  const matches = [...html.matchAll(
    /bizi\.si\/((?:[A-Z0-9][A-Z0-9\-]+-D-[A-Z]-[A-Z0-9\-]+)|(?:[A-Z0-9][A-Z0-9\-]{8,}))/gi,
  )];
  if (!matches.length) return null;
  const besede = naziv.split(/\s+/).map(w => w.toUpperCase());
  const hit = matches.find(m => besede.some(b => m[1].toUpperCase().includes(b))) ?? matches[0];
  return hit[1];
}

async function scraperBizi(slug: string, iban: string | null): Promise<PodjetjePredlog | null> {
  const r = await fetch(`https://www.bizi.si/${slug.toUpperCase()}/`, {
    headers: HEADERS, signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) return null;
  const html = await r.text();

  // Davčna: <div class="col-6 b-attr-value pl-1">58843302</div>
  const davcnaMatch = html.match(/Dav[čc]na[\s\S]{1,400}?b-attr-value[^>]*>\s*(\d{8})/);
  if (!davcnaMatch) return null;

  // Naziv iz <title>
  const nazivMatch = html.match(/<title>([^<|–\-]+)/i);
  const naziv = nazivMatch
    ? nazivMatch[1].trim().split(/\s+/).slice(0, -1).join(' ') // odreže "Bizi"
    : slug.replace(/-/g, ' ');

  // Naslov
  const naslovMatch = html.match(/Naslov[\s\S]{1,300}?b-attr-value[^>]*>\s*([^\n<]{5,80})/);

  // IBAN validacija prek bizi TRR strani
  if (iban) {
    const ibanNorm = iban.replace(/\s/g, '').toUpperCase();
    const trrR = await fetch(`https://www.bizi.si/${slug.toUpperCase()}/trr-in-blokade/`, {
      headers: HEADERS, signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (trrR?.ok) {
      const trrHtml = await trrR.text();
      if (!trrHtml.includes(ibanNorm)) return null;
    }
  }

  return {
    naziv:    naziv.trim(),
    davcna:   davcnaMatch[1],
    naslov:   naslovMatch?.[1]?.trim() ?? null,
    biziSlug: slug,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JAVNI VSTOPNI TOČKI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poišče slovensko podjetje po delnem nazivu in IBAN.
 *
 * 1. Primarno: ddv.inetis.com (FURS DDV + AJPES TRR, brez API ključa)
 * 2. Fallback:  DuckDuckGo Lite → bizi.si direktni fetch
 *
 * Vrne PodjetjePredlog (z davčno) ali null.
 */
export async function poisciDobaviteljaAI(
  naziv: string,
  iban:  string | null,
): Promise<PodjetjePredlog | null> {
  const trimNaziv = naziv?.trim() ?? '';
  if (trimNaziv.length < 3) return null;

  // Primarni vir: inetis
  try {
    const inetis = await iskajInetis(trimNaziv, iban);
    if (inetis) return inetis;
  } catch {
    /* timeout ali mrežna napaka — poskusimo fallback */
  }

  // Fallback: DDG + bizi.si
  try {
    const slug = await iskajBiziSlug(trimNaziv);
    if (!slug) return null;
    return await scraperBizi(slug, iban);
  } catch {
    return null;
  }
}
