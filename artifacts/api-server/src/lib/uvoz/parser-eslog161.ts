// artifacts/api-server/src/lib/uvoz/parser-eslog161.ts
//
// e-SLOG 1.6.1 — starejši slovenski standard e-računa.
//
// Zgradba je EDIFACT-podobna, ovita v XML: podatki niso poimenovani,
// ampak označeni s kvalifikatorji. "Datum" ni element <Datum>, ampak
// <DatumiRacuna> z <VrstaDatuma>137</VrstaDatuma>. Brez šifranta
// kvalifikatorjev dokumenta ni mogoče brati.
//
// ⚠ IMENA ELEMENTOV NISO POTRJENA IZ URADNE SPECIFIKACIJE.
//    Kvalifikatorji (137, 47, AAA, 203, SE, BY) so kode UNCL/EDIFACT in
//    so zanesljivi. Imena XML elementov pa sem povzel po strukturi, ki
//    je v obtoku, in jih NISEM preveril proti uradni shemi.
//
//    Zato so vse poti zbrane v tabeli POTI na enem mestu. Ob prvem
//    resničnem dokumentu odprite datoteko, primerjajte in popravite —
//    kode drugod v datoteki ni treba spreminjati.
//
//    Če se dokument ne razčleni, funkcija vrne diagnostiko z dejansko
//    zgradbo XML, da je popravek mogoč brez ugibanja.

import { XMLParser } from 'fast-xml-parser';
import { Decimal } from 'decimal.js';

import {
  type Postavka,
  type PrejemDTO,
  UNECE_ENOTE,
  dodajNapako,
  dodajOpozorilo,
  gtinNorm,
  gtinVeljaven,
  postavkaSchema,
  prazenDto,
  zaokrozi,
} from './dto';

// =====================================================================
// Poti do elementov — edino mesto, ki ga je treba popraviti
// =====================================================================

export const POTI = {
  koren: 'Racun',
  glava: 'RacunGlava',
  stevilka: ['RacunSt', 'StevilkaDokumenta'],
  datumi: 'DatumiRacuna',
  datumVrsta: 'VrstaDatuma',
  datumVrednost: 'DatumRacuna',
  partner: 'PartnerRacuna',
  partnerVrsta: 'VrstaPartnerja',
  partnerNaziv: ['NazivPartnerja', 'Naziv'],
  partnerDavcna: 'DavcnaStevilka',
  partnerMaticna: 'MaticnaStevilka',
  partnerGln: 'GLN',
  valuta: 'ValutaRacuna',

  postavka: 'RacunPostavka',
  postavkaSt: 'StevilkaPostavke',
  postavkaArtikel: 'PostavkaArtikel',
  artikelSifra: 'SifraArtikla',
  artikelEan: 'EanArtikla',
  artikelNaziv: 'NazivArtikla',

  kolicine: 'PostavkaKolicina',
  kolicinaVrsta: 'VrstaKolicine',
  kolicinaVrednost: 'Kolicina',
  kolicinaEnota: 'EnotaMere',

  cene: 'PostavkaCena',
  cenaVrsta: 'VrstaCene',
  cenaVrednost: 'Cena',
  cenaOsnova: 'OsnovnaKolicina',

  zneski: 'PostavkaZnesek',
  znesekVrsta: 'VrstaZneska',
  znesekVrednost: 'Znesek',

  odstotki: 'PostavkaOdstotek',
  odstotekVrsta: 'VrstaOdstotka',
  odstotekVrednost: 'Odstotek',

  davki: 'PostavkaDavek',
  davekOdstotek: 'OdstotekDavka',

  povzetek: 'RacunPovzetek',
  povzetekZneski: 'PovzetekZnesek',
} as const;

// =====================================================================
// Kvalifikatorji — te kode so zanesljive (UNCL/EDIFACT)
// =====================================================================

/** UNCL2005 — vrste datumov */
export const DATUM = {
  DOKUMENTA: '137',
  ODPREME: '11',
  DOBAVE: '35',
  ZAPADLOSTI: '13',
  ROK_UPORABE: '361',
  OBDOBJE_OD: '167',
  OBDOBJE_DO: '168',
} as const;

/** UNCL6063 — vrste količin */
export const KOLICINA = {
  ZARACUNANA: '47',
  DOBAVLJENA: '12',
  NAROCENA: '21',
  V_PAKETU: '52',
} as const;

/** UNCL5125 — vrste cen */
export const CENA = {
  NETO: 'AAA',
  BRUTO: 'AAB',
  KATALOSKA: 'AAE',
} as const;

/** UNCL5025 — vrste zneskov */
export const ZNESEK = {
  POSTAVKA_NETO: '203',
  SKUPAJ_BREZ_DDV: '79',
  DDV: '124',
  SKUPAJ_Z_DDV: '77',
  ZA_PLACILO: '9',
  RABAT: '204',
  DAJATVE: '23',
} as const;

/** UNCL5245 — vrste odstotkov */
export const ODSTOTEK = {
  RABAT: '1',
  DAVEK: '3',
} as const;

/** UNCL3035 — vloge partnerjev */
export const PARTNER = {
  PRODAJALEC: 'SE',
  KUPEC: 'BY',
  PREJEMNIK: 'DP',
  IZDAJATELJ: 'II',
  PLACNIK: 'PE',
} as const;

// =====================================================================
// Razčlenjevalnik
// =====================================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});

type Vozel = Record<string, unknown> | undefined;

const seznam = (v: unknown): unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

function txt(v: unknown, kljuc?: string | readonly string[]): string | null {
  let t: unknown = v;
  if (kljuc) {
    for (const k of typeof kljuc === 'string' ? [kljuc] : kljuc) {
      if (t === null || t === undefined || typeof t !== 'object') return null;
      t = (t as Record<string, unknown>)[k];
    }
  }
  if (t === null || t === undefined) return null;
  if (typeof t === 'object') {
    const b = (t as Record<string, unknown>)['#text'];
    return b === undefined ? null : String(b).trim() || null;
  }
  const s = String(t).trim();
  return s || null;
}

function dec(v: unknown, kljuc?: string | readonly string[]): Decimal | null {
  const s = txt(v, kljuc);
  if (s === null) return null;
  try {
    // 1.6.1 dovoljuje vejico kot decimalno ločilo
    const d = new Decimal(s.replace(/\s/g, '').replace(',', '.'));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Poišče vrednost po kvalifikatorju.
 *
 * Vzorec, ki se v 1.6.1 ponavlja povsod:
 *   <DatumiRacuna>
 *     <VrstaDatuma>137</VrstaDatuma>
 *     <DatumRacuna>2026-01-03</DatumRacuna>
 *   </DatumiRacuna>
 */
function poKvalifikatorju(
  vozli: unknown,
  poljeVrste: string,
  iskanaVrsta: string,
  poljeVrednosti: string,
): string | null {
  for (const v of seznam(vozli)) {
    if (txt(v, poljeVrste) === iskanaVrsta) {
      const r = txt(v, poljeVrednosti);
      if (r !== null) return r;
    }
  }
  return null;
}

function decPoKvalifikatorju(
  vozli: unknown,
  poljeVrste: string,
  iskanaVrsta: string,
  poljeVrednosti: string,
): Decimal | null {
  const s = poKvalifikatorju(vozli, poljeVrste, iskanaVrsta, poljeVrednosti);
  if (s === null) return null;
  try {
    const d = new Decimal(s.replace(/\s/g, '').replace(',', '.'));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** e-SLOG 1.6.1 datumi: 'YYYY-MM-DD' ali 'YYYYMMDD' */
function vDatum(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return null;
}

// =====================================================================
// Vstop
// =====================================================================

export function razcleniEslog161(xml: Buffer | string): PrejemDTO {
  const dto = prazenDto();
  let drevo: Record<string, unknown>;

  try {
    drevo = parser.parse(typeof xml === 'string' ? xml : xml.toString('utf-8'));
  } catch (e) {
    dodajNapako(dto, 'ZAJ004', 'B', `Datoteka ni veljaven XML: ${(e as Error).message}`);
    return dto;
  }

  const koren = drevo[POTI.koren] as Vozel;
  if (!koren) {
    dodajNapako(dto, 'ZAJ002', 'B',
      `Korenskega elementa <${POTI.koren}> ni.`,
      { najdeniElementi: Object.keys(drevo).filter((k) => !k.startsWith('?')) });
    return dto;
  }

  const glava = (koren[POTI.glava] ?? koren) as Vozel;

  // ---- dokument ----
  dto.stDokumenta = txt(glava, POTI.stevilka);
  dto.datumDokumenta = vDatum(
    poKvalifikatorju(glava?.[POTI.datumi], POTI.datumVrsta,
                     DATUM.DOKUMENTA, POTI.datumVrednost),
  );
  dto.valuta = txt(glava, POTI.valuta) ?? 'EUR';
  dto.vrstaDokumenta = 'RACUN';
  dto.ceneBruto = false;

  // ---- dobavitelj ----
  let najden = false;
  for (const p of seznam(glava?.[POTI.partner])) {
    if (txt(p, POTI.partnerVrsta) !== PARTNER.PRODAJALEC) continue;
    najden = true;
    dto.dobaviteljNaziv = txt(p, POTI.partnerNaziv) ?? txt(p, 'Naziv');
    dto.dobaviteljGln = txt(p, POTI.partnerGln);
    const davcna = txt(p, POTI.partnerDavcna);
    if (davcna) {
      const cifre = davcna.replace(/\D/g, '');
      dto.dobaviteljDavcna = cifre.length >= 8 ? cifre.slice(-8) : null;
      dto.dobaviteljIdDdv = /^SI/i.test(davcna) ? davcna.toUpperCase() : null;
    }
    break;
  }

  if (!najden) {
    dodajNapako(dto, 'DOK001', 'B',
      `Partnerja z vlogo ${PARTNER.PRODAJALEC} (prodajalec) v dokumentu ni.`,
      { diagnostika: diagnostikaPartnerjev(glava) });
  }

  // ---- postavke ----
  const postavke = seznam(koren[POTI.postavka]);
  postavke.forEach((v, i) => razcleniPostavko(v, i, dto));

  if (!dto.postavke.length) {
    dodajNapako(dto, 'DOK010', 'B',
      `Postavk (<${POTI.postavka}>) v dokumentu ni.`,
      { diagnostika: Object.keys(koren) });
    return dto;
  }

  // ---- povzetek ----
  const povzetek = koren[POTI.povzetek] as Vozel;
  const zneski = povzetek?.[POTI.povzetekZneski] ?? povzetek?.[POTI.zneski];
  dto.izvOsnova = decPoKvalifikatorju(
    zneski, POTI.znesekVrsta, ZNESEK.SKUPAJ_BREZ_DDV, POTI.znesekVrednost);
  dto.izvDdv = decPoKvalifikatorju(
    zneski, POTI.znesekVrsta, ZNESEK.DDV, POTI.znesekVrednost);
  dto.izvSkupaj = decPoKvalifikatorju(
    zneski, POTI.znesekVrsta, ZNESEK.SKUPAJ_Z_DDV, POTI.znesekVrednost);

  preveriVsote(dto);
  return dto;
}

function razcleniPostavko(v: unknown, i: number, dto: PrejemDTO): void {
  const artikel = (v as Vozel)?.[POTI.postavkaArtikel] ?? v;

  const kolicine = (v as Vozel)?.[POTI.kolicine];
  // Zaračunana količina ima prednost; dobavljena je rezerva.
  const kolicina =
    decPoKvalifikatorju(kolicine, POTI.kolicinaVrsta,
                        KOLICINA.ZARACUNANA, POTI.kolicinaVrednost) ??
    decPoKvalifikatorju(kolicine, POTI.kolicinaVrsta,
                        KOLICINA.DOBAVLJENA, POTI.kolicinaVrednost) ??
    new Decimal(0);

  // Enota je zapisana ob količini, ne na postavki.
  let enotaKoda: string | null = null;
  for (const k of seznam(kolicine)) {
    const vrsta = txt(k, POTI.kolicinaVrsta);
    if (vrsta === KOLICINA.ZARACUNANA || vrsta === KOLICINA.DOBAVLJENA) {
      enotaKoda = txt(k, POTI.kolicinaEnota);
      if (enotaKoda) break;
    }
  }

  const cene = (v as Vozel)?.[POTI.cene];
  const cenaNeto =
    decPoKvalifikatorju(cene, POTI.cenaVrsta, CENA.NETO, POTI.cenaVrednost);
  const cenaBruto =
    decPoKvalifikatorju(cene, POTI.cenaVrsta, CENA.BRUTO, POTI.cenaVrednost);

  // Enaka past kot pri UBL BaseQuantity: cena je lahko za več enot.
  let osnovnaKol = new Decimal(1);
  for (const c of seznam(cene)) {
    if (txt(c, POTI.cenaVrsta) === CENA.NETO) {
      const o = dec(c, POTI.cenaOsnova);
      if (o && o.gt(0)) osnovnaKol = o;
      break;
    }
  }

  const zneski = (v as Vozel)?.[POTI.zneski];
  const vrednost = decPoKvalifikatorju(
    zneski, POTI.znesekVrsta, ZNESEK.POSTAVKA_NETO, POTI.znesekVrednost);

  const odstotki = (v as Vozel)?.[POTI.odstotki];
  const rabat = decPoKvalifikatorju(
    odstotki, POTI.odstotekVrsta, ODSTOTEK.RABAT, POTI.odstotekVrednost);

  const ddv =
    decPoKvalifikatorju(odstotki, POTI.odstotekVrsta,
                        ODSTOTEK.DAVEK, POTI.odstotekVrednost) ??
    dec((v as Vozel)?.[POTI.davki], POTI.davekOdstotek);

  const cenaOsnovna = cenaNeto ?? cenaBruto ?? new Decimal(0);

  const p: Postavka = postavkaSchema.parse({
    zap: Number(txt(v, POTI.postavkaSt) ?? i + 1) || i + 1,
    izvNaziv: txt(artikel, POTI.artikelNaziv) ?? '(brez naziva)',
    izvKolicina: kolicina,
    izvCena: cenaOsnovna.div(osnovnaKol),
    izvEnota: enotaKoda ? (UNECE_ENOTE[enotaKoda] ?? enotaKoda) : null,
    izvGtin: gtinNorm(txt(artikel, POTI.artikelEan)),
    izvSifra: txt(artikel, POTI.artikelSifra),
    izvVrednost: vrednost,
    rabat1Odst: rabat ?? new Decimal(0),
    ddvStopnja: ddv,
    rokUporabe: vDatum(
      poKvalifikatorju((v as Vozel)?.[POTI.datumi], POTI.datumVrsta,
                       DATUM.ROK_UPORABE, POTI.datumVrednost),
    ),
  });

  if (!osnovnaKol.eq(1)) {
    dodajOpozorilo(p, 'POS017', 'I',
      `Cena na dokumentu velja za ${osnovnaKol} enot; preračunana na eno enoto.`,
      { cenaNaDokumentu: cenaOsnovna.toString(),
        osnovnaKolicina: osnovnaKol.toString() });
  }

  if (cenaNeto === null && cenaBruto !== null) {
    dodajOpozorilo(p, 'POS019', 'O',
      `Neto cene (${CENA.NETO}) ni; uporabljena je bruto cena (${CENA.BRUTO}). ` +
      'Preverite, ali je rabat že upoštevan.');
  }

  if (p.izvGtin && !gtinVeljaven(p.izvGtin)) {
    dodajOpozorilo(p, 'POS008', 'O', 'Črtna koda ne prestane kontrolne števke.',
      { gtin: p.izvGtin });
  }

  if (p.izvVrednost !== null && p.izvCena.gt(0)) {
    let izracun = p.izvKolicina.mul(p.izvCena);
    if (!p.rabat1Odst.isZero()) {
      izracun = izracun.mul(new Decimal(1).minus(p.rabat1Odst.div(100)));
    }
    if (zaokrozi(izracun).minus(zaokrozi(p.izvVrednost)).abs().gt('0.02')) {
      dodajOpozorilo(p, 'POS007', 'B',
        'Količina × cena se ne ujema z vrednostjo postavke.',
        { izracunano: zaokrozi(izracun).toString(),
          naDokumentu: zaokrozi(p.izvVrednost).toString() });
    }
  }

  dto.postavke.push(p);
}

function preveriVsote(dto: PrejemDTO): void {
  if (dto.izvOsnova === null) return;
  const vsota = dto.postavke.reduce(
    (a, p) => a.plus(p.izvVrednost ?? p.izvKolicina.mul(p.izvCena)),
    new Decimal(0),
  );
  if (zaokrozi(vsota).minus(zaokrozi(dto.izvOsnova)).abs().gt('0.02')) {
    dodajNapako(dto, 'DOK004', 'B',
      'Vsota postavk se ne ujema z davčno osnovo dokumenta.',
      { vsotaPostavk: zaokrozi(vsota).toString(),
        osnovaNaDokumentu: zaokrozi(dto.izvOsnova).toString() });
  }
}

// =====================================================================
// Diagnostika
// =====================================================================

/**
 * Kadar se dokument ne razčleni, vrne dejansko zgradbo, da je popravek
 * tabele POTI mogoč brez ugibanja. Brez tega je odpravljanje napake pri
 * nepotrjeni shemi zelo zamudno.
 */
function diagnostikaPartnerjev(glava: Vozel): unknown {
  const p = seznam(glava?.[POTI.partner]);
  if (!p.length) {
    return { sporocilo: `Elementa <${POTI.partner}> ni`, najdeni: Object.keys(glava ?? {}) };
  }
  return p.map((x) => ({
    vloga: txt(x, POTI.partnerVrsta),
    polja: typeof x === 'object' && x ? Object.keys(x) : [],
  }));
}

/**
 * Izpiše drevo elementov do dane globine. Uporabi pri prvem resničnem
 * dokumentu, da se tabela POTI popravi enkrat in za vselej.
 */
export function izpisiZgradbo(xml: Buffer | string, globina = 4): string {
  const drevo = parser.parse(typeof xml === 'string' ? xml : xml.toString('utf-8'));
  const vrstice: string[] = [];

  const hodi = (v: unknown, pot: string, g: number) => {
    if (g > globina || v === null || v === undefined) return;
    if (typeof v !== 'object') {
      vrstice.push(`${pot} = ${String(v).slice(0, 40)}`);
      return;
    }
    if (Array.isArray(v)) {
      vrstice.push(`${pot}[] (${v.length})`);
      if (v.length) hodi(v[0], `${pot}[0]`, g + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('@') || k === '#text') continue;
      hodi(x, pot ? `${pot}/${k}` : k, g + 1);
    }
  };

  hodi(drevo, '', 0);
  return vrstice.join('\n');
}
