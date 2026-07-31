// artifacts/api-server/src/lib/uvoz/parser-csv.ts
//
// Razčlenjevalnik CSV in XLSX po profilu dobavitelja.
//
// Odvisnosti:
//   npm i papaparse xlsx iconv-lite decimal.js zod
//   npm i -D @types/papaparse
//
// Pokriva pasti, ki so se pokazale pri preizkusu:
//   - CP1250 (slovenski dobavitelji ga še vedno pošiljajo)
//   - vejica kot decimalno ločilo pri TREH decimalkah (5,476)
//   - zamik vrstic, če se prazne vrstice odstranijo pred indeksiranjem
//   - Excelova serijska številka datuma z izhodiščem 30.12.1899

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import iconv from 'iconv-lite';
import { Decimal } from 'decimal.js';

import {
  type Opozorilo,
  type Postavka,
  type PrejemDTO,
  dodajNapako,
  dodajOpozorilo,
  gtinNorm,
  gtinVeljaven,
  normalizirajEnoto,
  postavkaSchema,
  prazenDto,
  zaokrozi,
} from './dto';

// =====================================================================
// Konfiguracija profila
// =====================================================================

export interface StolpecPravilo {
  indeks: number;
  privzeto?: string | number;
  preslikava?: Record<string, string>;
}

export interface UvozProfilKonfig {
  kodiranje?: 'utf-8' | 'utf-8-sig' | 'cp1250' | 'utf-16le';
  locilo?: string;
  decimalnoLocilo?: ',' | '.';
  formatDatuma?: string;
  /** Iskanje vrstice glave po vsebini je zanesljivejše od fiksnega odmika. */
  glavaVsebuje?: string[];
  prvaVrsticaPodatkov?: number;
  list?: string;
  ceneBruto?: boolean;
  glavaDokumenta?: Record<
    string,
    | { vir: 'CELICA'; naslov: string }
    | { vir: 'IME_DATOTEKE'; regex: string }
    | { vir: 'ISKANJE'; vsebuje: string; regex: string }
  >;
  stolpci: {
    naziv: StolpecPravilo;
    kolicina: StolpecPravilo;
    cena: StolpecPravilo;
    sifra?: StolpecPravilo;
    gtin?: StolpecPravilo;
    enota?: StolpecPravilo;
    enotVPaketu?: StolpecPravilo;
    rabatOdst?: StolpecPravilo;
    rabat2Odst?: StolpecPravilo;
    ddv?: StolpecPravilo;
    vrednost?: StolpecPravilo;
  };
  preskociVrsticeKjer?: { stolpec: number; prazno?: boolean; vsebuje?: string };
  vrsticaVsote?: {
    prepoznajPo: { stolpec: number; vsebuje: string };
    stolpci?: Partial<Record<'izvOsnova' | 'izvDdv' | 'izvSkupaj', number>>;
  };
}

// =====================================================================
// Kodiranje
// =====================================================================

/** Bajti, ki v CP1250 pomenijo š ž Š Ž č Č in v UTF-8 ne nastopajo samostojno. */
const CP1250_SUMNIKI = new Set([0x9a, 0x9e, 0x8a, 0x8e, 0xe8, 0xc8]);

export function zaznajKodiranje(raw: Buffer): string {
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    return 'utf-8-sig';
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return 'utf-16le';

  // Veljaven UTF-8 skoraj nikoli ni naključje
  const vzorec = raw.subarray(0, 8192);
  const dekodiran = iconv.decode(vzorec, 'utf-8');
  if (!dekodiran.includes('\uFFFD')) return 'utf-8';

  if (vzorec.some((b) => CP1250_SUMNIKI.has(b))) return 'cp1250';
  return 'cp1250'; // privzeto za slovenski trg, ne latin-1
}

export function dekodiraj(raw: Buffer, kodiranje?: string): { besedilo: string; kodiranje: string } {
  const k = kodiranje ?? zaznajKodiranje(raw);
  const ime = k === 'utf-8-sig' ? 'utf-8' : k;
  let besedilo = iconv.decode(raw, ime);
  if (besedilo.charCodeAt(0) === 0xfeff) besedilo = besedilo.slice(1);
  return { besedilo, kodiranje: k };
}

// =====================================================================
// Ločilo
// =====================================================================

/**
 * Ločilo določi prevladujoče število polj, ne število pojavitev.
 *
 * Prejšnja različica je ocenjevala povprečje pojavitev minus odklon. Na
 * datoteki z uvodnimi vrsticami brez ločil je vejica (3 pojavitve v
 * decimalkah) prekašala podpičje (9 pojavitev v podatkovnih vrsticah),
 * ker odklon podpičja kaznuje bolj. Napaka se je skrila za privzeto
 * vrednostjo in se pokazala šele ob prevodu.
 *
 * Sedanji postopek: za vsakega kandidata razdeli vrstice, poišči
 * najpogostejše število polj, večje od 1, in oceni z zmnožkom
 * (število takih vrstic × število polj). Podatkovne vrstice imajo enako
 * število polj, uvodne pa ne — zato prevlada pravo ločilo.
 */
export function zaznajLocilo(besedilo: string): string {
  const vrstice = besedilo.split(/\r?\n/).filter((v) => v.trim()).slice(0, 30);
  if (!vrstice.length) return ';';

  let najboljse = ';';
  let najboljsaOcena = 0;

  for (const kandidat of [';', '\t', '|', ',']) {
    const steviloPolj = vrstice.map((v) => v.split(kandidat).length);
    const pogostost = new Map<number, number>();
    for (const n of steviloPolj) {
      if (n > 1) pogostost.set(n, (pogostost.get(n) ?? 0) + 1);
    }
    if (!pogostost.size) continue;

    let prevladujoce = 0;
    let vrstic = 0;
    for (const [polj, kolikokrat] of pogostost) {
      // ob izenačenju zmaga več polj — bolj razčlenjena vrstica
      if (kolikokrat > vrstic || (kolikokrat === vrstic && polj > prevladujoce)) {
        prevladujoce = polj;
        vrstic = kolikokrat;
      }
    }

    const ocena = vrstic * prevladujoce;
    if (ocena > najboljsaOcena) {
      najboljse = kandidat;
      najboljsaOcena = ocena;
    }
  }
  return najboljse;
}

// =====================================================================
// Števila
// =====================================================================

const JE_STEVILO = /^-?[\d\s.,'\u00a0]*\d$/;

/**
 * '1.234,56' -> 1234.56 ; '5,476' -> 5.476 ; '1.500' -> 1500
 *
 * Pravilo, ki ga NI dovoljeno uporabiti pri vejici: "tri števke za
 * ločilom pomenijo tisočico". Cene s tremi decimalkami so v tem sistemu
 * običajne (zaslon prejemnice kaže 5,476), zato bi tako pravilo ceno
 * pomnožilo s tisoč.
 */
export function vDecimal(vrednost: unknown, decimalno?: ',' | '.'): Decimal {
  if (vrednost === null || vrednost === undefined || vrednost === '') return new Decimal(0);
  if (vrednost instanceof Decimal) return vrednost;
  if (typeof vrednost === 'number') return new Decimal(vrednost);

  let s = String(vrednost)
    .trim()
    .replace(/[\s\u00a0']/g, '')
    .replace(/€|EUR/gi, '')
    .trim();
  if (!s || !JE_STEVILO.test(s)) return new Decimal(0);

  if (decimalno) {
    const tisocica = decimalno === ',' ? '.' : ',';
    return new Decimal(s.split(tisocica).join('').replace(decimalno, '.'));
  }

  const imaPiko = s.includes('.');
  const imaVejico = s.includes(',');

  if (!imaPiko && !imaVejico) return new Decimal(s);

  // oba prisotna -> zadnje je decimalno
  if (imaPiko && imaVejico) {
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? new Decimal(s.split('.').join('').replace(',', '.'))
      : new Decimal(s.split(',').join(''));
  }

  // samo vejica -> po slovenski konvenciji VEDNO decimalno ločilo
  if (imaVejico) return new Decimal(s.replace(',', '.'));

  // samo pika -> dvoumno; tri števke in en sam pojav = tisočica
  const zaPiko = s.length - s.lastIndexOf('.') - 1;
  const stPik = s.split('.').length - 1;
  if (zaPiko === 3 && stPik === 1 && s.replace('.', '').length > 3) {
    return new Decimal(s.replace('.', ''));
  }
  return new Decimal(s);
}

// =====================================================================
// Datumi
// =====================================================================

const OBLIKE: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/, (m) => iso(m[3], m[2], m[1])],
  [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => iso(m[3], m[2], m[1])],
  [/^(\d{4})(\d{2})(\d{2})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
  [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => iso(m[3], m[2], m[1])],
];

const iso = (l: string, m: string, d: string) =>
  `${l}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

export function vDatum(vrednost: unknown): string | null {
  if (vrednost === null || vrednost === undefined || vrednost === '') return null;
  if (vrednost instanceof Date) return vrednost.toISOString().slice(0, 10);

  // Excelova serijska številka: izhodišče 30.12.1899, ne 1.1.1900
  // (Lotus 1-2-3 je leto 1900 napačno štel za prestopno)
  if (typeof vrednost === 'number' && vrednost > 1 && vrednost < 100000) {
    const ms = Date.UTC(1899, 11, 30) + vrednost * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(vrednost).trim();
  for (const [re, pretvori] of OBLIKE) {
    const m = s.match(re);
    if (m) return pretvori(m);
  }
  return null;
}

// =====================================================================
// Razčlenjevalnik
// =====================================================================

export class CsvRazclenjevalnik {
  constructor(private readonly k: UvozProfilKonfig) {}

  razcleni(raw: Buffer, imeDatoteke = ''): PrejemDTO {
    const dto = prazenDto();
    const { besedilo, kodiranje } = dekodiraj(raw, this.k.kodiranje);

    if (kodiranje === 'cp1250' && !this.k.kodiranje) {
      dodajNapako(dto, 'ZAJ006', 'I', 'Kodiranje zaznano samodejno kot CP1250.', {
        kodiranje,
      });
    }

    const locilo = this.k.locilo ?? zaznajLocilo(besedilo);
    const rezultat = Papa.parse<string[]>(besedilo, {
      delimiter: locilo,
      skipEmptyLines: false, // NE preskoči — sicer se zamaknejo fiksni odmiki
      dynamicTyping: false,
    });

    const vrstice = rezultat.data;
    if (!vrstice.some((v) => v.some((c) => String(c).trim()))) {
      dodajNapako(dto, 'ZAJ001', 'B', 'Datoteka ne vsebuje podatkov.');
      return dto;
    }

    this.glava(dto, vrstice, imeDatoteke);
    this.postavke(dto, vrstice);
    this.dolociNetoBruto(dto);
    this.preveriVsote(dto);
    return dto;
  }

  /** XLSX: pretvori v matriko in uporabi isto pot. */
  razcleniXlsx(raw: Buffer, imeDatoteke = ''): PrejemDTO {
    const wb = XLSX.read(raw, { type: 'buffer', cellDates: true });
    const imeLista = this.k.list ?? wb.SheetNames[0];
    const ws = wb.Sheets[imeLista];
    const dto = prazenDto();
    if (!ws) {
      dodajNapako(dto, 'ZAJ010', 'B', `Lista "${imeLista}" ni v datoteki.`, {
        naVoljo: wb.SheetNames,
      });
      return dto;
    }
    // raw:false -> celice kot besedilo, da Excel ne uniči vodilnih ničel v GTIN
    const vrstice = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    this.glava(dto, vrstice, imeDatoteke);
    this.postavke(dto, vrstice);
    this.dolociNetoBruto(dto);
    this.preveriVsote(dto);
    return dto;
  }

  // ---------------- glava ----------------

  private glava(dto: PrejemDTO, vrstice: string[][], ime: string): void {
    for (const [polje, pravilo] of Object.entries(this.k.glavaDokumenta ?? {})) {
      let vrednost: string | null = null;

      if (pravilo.vir === 'CELICA') vrednost = this.celica(vrstice, pravilo.naslov);
      else if (pravilo.vir === 'IME_DATOTEKE')
        vrednost = ime.match(new RegExp(pravilo.regex))?.[1] ?? null;
      else vrednost = this.poisci(vrstice, pravilo.vsebuje, pravilo.regex);

      if (vrednost === null) continue;

      if (polje === 'stDokumenta' || polje === 'stDokumentaAlt')
        dto.stDokumenta ??= vrednost.trim();
      else if (polje === 'datum') dto.datumDokumenta = vDatum(vrednost);
      else if (polje === 'dobaviteljDavcna')
        dto.dobaviteljDavcna = vrednost.replace(/\D/g, '').slice(0, 8) || null;
    }

    if (!dto.stDokumenta) {
      dodajNapako(
        dto,
        'DOK012',
        'O',
        'Številke dobaviteljevega dokumenta ni bilo mogoče prebrati.',
      );
    }
  }

  /** Naslov 'B2' -> stolpec 1, vrstica 1 (oba indeksirana od nič). */
  private celica(vrstice: string[][], naslov: string): string | null {
    const m = naslov.toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    let stolpec = 0;
    for (const z of m[1]) stolpec = stolpec * 26 + (z.charCodeAt(0) - 64);
    stolpec -= 1;
    const vrstica = Number(m[2]) - 1;
    return vrstice[vrstica]?.[stolpec] ?? null;
  }

  private poisci(vrstice: string[][], igla: string, vzorec: string): string | null {
    const re = new RegExp(vzorec);
    for (const v of vrstice.slice(0, 30)) {
      const zdruzeno = v.join(' ');
      if (zdruzeno.toLowerCase().includes(igla.toLowerCase())) {
        const m = zdruzeno.match(re);
        if (m) return m[1] ?? m[0];
      }
    }
    return null;
  }

  // ---------------- postavke ----------------

  private najdiGlavo(vrstice: string[][]): number | null {
    const pricakovana = (this.k.glavaVsebuje ?? []).map((s) => s.toLowerCase());
    if (!pricakovana.length) return null;
    for (let i = 0; i < Math.min(vrstice.length, 40); i++) {
      const z = vrstice[i].join(' ').toLowerCase();
      if (pricakovana.every((p) => z.includes(p))) return i;
    }
    return null;
  }

  private postavke(dto: PrejemDTO, vrstice: string[][]): void {
    const glava = this.najdiGlavo(vrstice);
    const prva = glava !== null ? glava + 1 : (this.k.prvaVrsticaPodatkov ?? 2) - 1;
    const s = this.k.stolpci;
    const dec = this.k.decimalnoLocilo;

    let zap = 0;
    for (let i = prva; i < vrstice.length; i++) {
      const v = vrstice[i];
      if (!v || !v.some((c) => String(c).trim())) continue;

      if (this.jeVrsticaVsote(v)) {
        this.preberiVsoto(dto, v);
        continue;
      }
      if (this.preskoci(v)) continue;

      const naziv = String(this.polje(v, s.naziv) ?? '').trim();
      const kolicina = vDecimal(this.polje(v, s.kolicina), dec);
      if (!naziv || kolicina.isZero()) continue;

      zap += 1;
      const surovGtin = s.gtin ? this.polje(v, s.gtin) : null;
      const enotVPaketu = s.enotVPaketu ? vDecimal(this.polje(v, s.enotVPaketu), dec) : new Decimal(1);

      const p: Postavka = postavkaSchema.parse({
        zap,
        izvNaziv: naziv,
        izvKolicina: kolicina,
        izvCena: vDecimal(this.polje(v, s.cena), dec),
        izvGtin: gtinNorm(surovGtin as string | null),
        izvSifra: this.niz(s.sifra ? this.polje(v, s.sifra) : null),
        izvEnota: normalizirajEnoto(
          s.enota ? String(this.polje(v, s.enota) ?? '') : undefined,
        ) ?? null,
        izvVrednost: s.vrednost ? vDecimal(this.polje(v, s.vrednost), dec) : null,
        enotVPaketu: enotVPaketu.gt(0) ? enotVPaketu : new Decimal(1),
        rabat1Odst: s.rabatOdst ? vDecimal(this.polje(v, s.rabatOdst), dec) : new Decimal(0),
        rabat2Odst: s.rabat2Odst ? vDecimal(this.polje(v, s.rabat2Odst), dec) : new Decimal(0),
        ddvStopnja: s.ddv ? vDecimal(this.polje(v, s.ddv), dec) : null,
      });

      // GTIN, ki ga je Excel uničil (3.8388E+12), gtinNorm vrne null
      if (surovGtin && !p.izvGtin) {
        dodajOpozorilo(
          p,
          'POS008a',
          'O',
          'Črtna koda je bila v izvorni datoteki okrnjena in je neuporabna.',
          { surovo: String(surovGtin) },
        );
      } else if (p.izvGtin && !gtinVeljaven(p.izvGtin)) {
        dodajOpozorilo(p, 'POS008', 'O', 'Črtna koda ne prestane kontrolne števke.', {
          gtin: p.izvGtin,
        });
      }

      this.preveriPostavko(p);
      dto.postavke.push(p);
    }

    if (!dto.postavke.length) {
      dodajNapako(dto, 'DOK010', 'B', 'Dokument ne vsebuje nobene postavke.');
    }
  }

  private polje(v: string[], pravilo?: StolpecPravilo): unknown {
    if (!pravilo) return null;
    const surovo = v[pravilo.indeks];
    if (surovo === undefined || surovo === '') return pravilo.privzeto ?? null;
    if (pravilo.preslikava) {
      const k = String(surovo).trim().toLowerCase();
      return pravilo.preslikava[k] ?? surovo;
    }
    return surovo;
  }

  private niz(v: unknown): string | null {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s || null;
  }

  private preskoci(v: string[]): boolean {
    const p = this.k.preskociVrsticeKjer;
    if (!p) return false;
    const vrednost = String(v[p.stolpec] ?? '');
    if (p.prazno && !vrednost.trim()) return true;
    if (p.vsebuje && vrednost.toLowerCase().includes(p.vsebuje.toLowerCase())) return true;
    return false;
  }

  private jeVrsticaVsote(v: string[]): boolean {
    const p = this.k.vrsticaVsote;
    if (!p) return false;
    const vrednost = String(v[p.prepoznajPo.stolpec] ?? '');
    return vrednost.toLowerCase().includes(p.prepoznajPo.vsebuje.toLowerCase());
  }

  private preberiVsoto(dto: PrejemDTO, v: string[]): void {
    for (const [polje, idx] of Object.entries(this.k.vrsticaVsote?.stolpci ?? {})) {
      const d = vDecimal(v[idx as number], this.k.decimalnoLocilo);
      (dto as unknown as Record<string, Decimal>)[polje] = d;
    }
  }

  // ---------------- kontrole ----------------

  private preveriPostavko(p: Postavka): void {
    if (p.izvCena.lte(0)) {
      dodajOpozorilo(p, 'POS005', 'O', 'Cena je nič ali negativna.');
    }

    if (p.izvVrednost !== null && p.izvCena.gt(0)) {
      let izracun = p.izvKolicina.mul(p.izvCena);
      if (!p.rabat1Odst.isZero())
        izracun = izracun.mul(new Decimal(1).minus(p.rabat1Odst.div(100)));
      if (!p.rabat2Odst.isZero())
        izracun = izracun.mul(new Decimal(1).minus(p.rabat2Odst.div(100)));

      if (zaokrozi(izracun).minus(zaokrozi(p.izvVrednost)).abs().gt('0.02')) {
        dodajOpozorilo(
          p,
          'POS007',
          'B',
          'Količina × cena se ne ujema z vrednostjo postavke.',
          {
            izracunano: zaokrozi(izracun).toString(),
            naDokumentu: zaokrozi(p.izvVrednost).toString(),
          },
        );
      }
    }
  }

  /**
   * Če profil ne pove, primerja vsoto postavk z izkazano skupno vrednostjo.
   * Cash & Carry pošilja maloprodajne (bruto) cene.
   */
  private dolociNetoBruto(dto: PrejemDTO): void {
    if (this.k.ceneBruto !== undefined) {
      dto.ceneBruto = this.k.ceneBruto;
      return;
    }
    const vsota = dto.postavke.reduce(
      (a, p) => a.plus(p.izvKolicina.mul(p.izvCena)),
      new Decimal(0),
    );
    if (vsota.isZero() || dto.izvSkupaj === null) {
      dto.ceneBruto = false;
      return;
    }
    const razlika = vsota.minus(dto.izvSkupaj).abs().div(dto.izvSkupaj);
    dto.ceneBruto = razlika.lt('0.005');
    dodajNapako(
      dto,
      'ZAJ008',
      'I',
      `Cene zaznane kot ${dto.ceneBruto ? 'bruto' : 'neto'}.`,
      {
        vsotaPostavk: zaokrozi(vsota).toString(),
        skupajNaDokumentu: zaokrozi(dto.izvSkupaj).toString(),
      },
    );
  }

  private preveriVsote(dto: PrejemDTO): void {
    if (dto.izvSkupaj === null || !dto.postavke.length) return;
    const vsota = dto.postavke.reduce(
      (a, p) => a.plus(p.izvVrednost ?? p.izvKolicina.mul(p.izvCena)),
      new Decimal(0),
    );
    if (zaokrozi(vsota).minus(zaokrozi(dto.izvSkupaj)).abs().gt('0.02')) {
      dodajNapako(
        dto,
        'DOK004',
        'B',
        'Vsota postavk se ne ujema s skupno vrednostjo dokumenta.',
        {
          vsotaPostavk: zaokrozi(vsota).toString(),
          skupajNaDokumentu: zaokrozi(dto.izvSkupaj).toString(),
        },
      );
    }
  }
}

// =====================================================================
// Primer profila — Cash & Carry, maloprodajne cene
// =====================================================================

export const PROFIL_CASH_AND_CARRY: UvozProfilKonfig = {
  decimalnoLocilo: ',',
  ceneBruto: true,
  glavaVsebuje: ['naziv', 'kolicina', 'cena'],
  prvaVrsticaPodatkov: 6,
  glavaDokumenta: {
    stDokumenta: { vir: 'ISKANJE', vsebuje: 'Racun st', regex: 'Racun st\\.?\\s*([\\w\\-/]+)' },
    datum: { vir: 'ISKANJE', vsebuje: 'Datum', regex: '(\\d{2}\\.\\d{2}\\.\\d{4})' },
  },
  stolpci: {
    sifra: { indeks: 0 },
    gtin: { indeks: 1 },
    naziv: { indeks: 2 },
    enota: { indeks: 3, preslikava: { kom: 'KOS', kg: 'KG', l: 'L' } },
    enotVPaketu: { indeks: 4 },
    kolicina: { indeks: 5 },
    cena: { indeks: 6 },
    rabatOdst: { indeks: 7, privzeto: 0 },
    ddv: { indeks: 8 },
    vrednost: { indeks: 9 },
  },
  vrsticaVsote: {
    prepoznajPo: { stolpec: 2, vsebuje: 'SKUPAJ' },
    stolpci: { izvSkupaj: 9 },
  },
};
