// artifacts/api-server/src/lib/uvoz/uvoz-service.ts
//
// Povezovalni sloj med zajemom in obstoječo prejemnico.
//
// Tok:
//   zajem -> razpoznava -> seja -> razčlenitev -> dobavitelj -> osnutek -> uparjanje
//
// Uvoz NE ustvari nove poti do zaloge. Ustvari osnutek prejemnice v isti
// tabeli, ki jo polni ročni vnos, in ga preda obstoječemu zaslonu.

import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { preveriVies, drzavaIzKode } from '../vies.js';
import { poisciNaInetis, zaznajVrsto, type TrrPostavka } from '../inetis.js';

import {
  type PrejemDTO,
  imaBlokado,
  netoPoRabatih,
  prazenDto,
  dodajNapako,
} from './dto';
import { CsvRazclenjevalnik, type UvozProfilKonfig } from './parser-csv';
import { razcleniXml, zaznajOblikoXml } from './parser-eslog';
import { razcleniEslog161 } from './parser-eslog161';
import { upariPrejemnico } from './uparjanje';
import { getSimDatumOrNow } from '../sim-datum';
import { artikliTable, embalazniPrometiTable, zalogaGibiTable } from '@workspace/db';
import { recomputeZaloge } from '../pos-zaloge-utils';
import { resolveInputVatCode, type InputVatCodeCandidate } from './vat-code-resolver';
import { toUneceUnitCode } from '../received-invoice-eslog';
import { claimPurchaseSourceDocument } from '../purchaseSourceDocuments';
import { appendStockMovementReversals } from '../stockMovementHistory';
import { packagingMovementKindForQuantity } from '../packagingMovementKind';
import { normalizeIncomingPaymentMethod } from '../posReceiptBooking';

type Db = PostgresJsDatabase<Record<string, unknown>>;

// =====================================================================
// Zaznava formata
// =====================================================================

export type UvozFormat =
  | 'ESLOG_2_0_RACUN' | 'ESLOG_2_0_DOBAVNICA' | 'ESLOG_1_6_1'
  | 'UBL_2_1_INVOICE' | 'UBL_2_1_DESPATCH' | 'CII_D16B'
  | 'EDIFACT_DESADV' | 'EDIFACT_INVOIC' | 'EDIFACT_PRICAT'
  | 'CSV' | 'XLSX' | 'JSON_LASTNI' | 'XML_LASTNI'
  | 'PDF_PREDLOGA' | 'PDF_OCR' | 'BREZ';

const ZIP_PODPIS = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_PODPIS = Buffer.from('%PDF');

/**
 * Nizi v cbc:CustomizationID, po katerih se e-SLOG 2.0 loči od
 * navadnega UBL oziroma Peppola.
 *
 * ⚠ PREVERI Z RESNIČNIM DOKUMENTOM. Točnega niza nisem potrdil iz
 * uradne specifikacije, zato je seznam namenoma širok in ohlapen.
 * Vzemi CustomizationID iz prvega resničnega e-SLOG računa in ga
 * dopiši sem — dokler tega ni, se dokumenti razvrstijo kot UBL.
 *
 * Napačna razvrstitev NE pokvari razčlenitve: e-SLOG 2.0, Peppol BIS
 * in navadni UBL uporabljajo isti razčlenjevalnik. Vpliva le na
 * poročanje in na izbiro pravil Schematron pri validaciji.
 */
const ESLOG_OZNAKE = [
  'eslog',
  'gzs.si',
  'mju.gov.si',
] as const;

type UblProfil = 'ESLOG' | 'PEPPOL' | 'UBL';

export function zaznajProfilUbl(xml: string): UblProfil {
  const cid = xml.match(/<(?:[\w.-]+:)?CustomizationID[^>]*>([^<]*)</i)?.[1] ?? '';
  const nizko = cid.toLowerCase();
  if (ESLOG_OZNAKE.some((o) => nizko.includes(o))) return 'ESLOG';
  if (nizko.includes('peppol.eu')) return 'PEPPOL';
  return 'UBL';
}

/**
 * Vrstni red preverjanja je pomemben. Prvi zadetek zmaga.
 * Priponka datoteke se uporabi šele kot zadnji namig — dobavitelji
 * pošiljajo XML s priponko .txt in CSV s priponko .xls.
 */
export function zaznajFormat(raw: Buffer, imeDatoteke = ''): UvozFormat {
  // 1. ZIP: XLSX ali ovojnica
  if (raw.subarray(0, 4).equals(ZIP_PODPIS)) {
    const vzorec = raw.subarray(0, Math.min(raw.length, 4096)).toString('latin1');
    if (vzorec.includes('[Content_Types].xml') && vzorec.includes('xl/')) return 'XLSX';
    return 'XLSX'; // ovojnico razpakira zajem, ne razpoznava
  }

  // 2. PDF
  if (raw.subarray(0, 4).equals(PDF_PODPIS)) {
    // Besedilna plast se ugotovi šele ob razčlenitvi; privzamemo predlogo.
    return 'PDF_PREDLOGA';
  }

  const zacetek = raw.subarray(0, Math.min(raw.length, 8192)).toString('utf-8');
  const zacetekTrim = zacetek.replace(/^[\s\uFEFF]+/, '');

  // 3. XML
  if (zacetekTrim.startsWith('<?xml') || zacetekTrim.startsWith('<')) {
    const korenIme = zacetekTrim.match(/<(?:[\w.-]+:)?([\w.-]+)[\s>]/)?.[1];
    const profil = zaznajProfilUbl(zacetek);
    switch (zaznajOblikoXml(korenIme ?? '')) {
      case 'UBL_INVOICE':
        return profil === 'ESLOG' ? 'ESLOG_2_0_RACUN' : 'UBL_2_1_INVOICE';
      case 'UBL_CREDITNOTE':
        return 'UBL_2_1_INVOICE';
      case 'UBL_DESPATCH':
        return profil === 'ESLOG' ? 'ESLOG_2_0_DOBAVNICA' : 'UBL_2_1_DESPATCH';
      case 'CII':      return 'CII_D16B';
      case 'ESLOG_161': return 'ESLOG_1_6_1';
      default:          return 'XML_LASTNI';
    }
  }

  // 4. EDIFACT
  if (/^(UNA|UNB)/.test(zacetekTrim)) {
    if (/UNH\+[^+]*\+DESADV/.test(zacetek)) return 'EDIFACT_DESADV';
    if (/UNH\+[^+]*\+INVOIC/.test(zacetek)) return 'EDIFACT_INVOIC';
    if (/UNH\+[^+]*\+PRICAT/.test(zacetek)) return 'EDIFACT_PRICAT';
    return 'EDIFACT_INVOIC';
  }

  // 5. JSON
  if (/^[[{]/.test(zacetekTrim)) return 'JSON_LASTNI';

  // 6. Besedilo z ločili
  if (/[;,\t|]/.test(zacetekTrim.split('\n').slice(0, 20).join('\n'))) return 'CSV';

  // 7. Zadnji namig: priponka
  const priponka = imeDatoteke.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (priponka === 'csv' || priponka === 'txt') return 'CSV';
  if (priponka === 'xlsx' || priponka === 'xls') return 'XLSX';

  return 'BREZ';
}

// =====================================================================
// Zajem: ustvarjanje seje z zaščito pred podvojitvijo
// =====================================================================

export interface ZajemVhod {
  enotaId: number;
  kanal: 'ROCNI_NALOG' | 'NADZOROVANA_MAPA' | 'EPOSTA' | 'PEPPOL' | 'API_DOBAVITELJ';
  raw: Buffer;
  imeDatoteke?: string;
  mimeTip?: string;
  dobaviteljId?: string | null;
  metapodatki?: Record<string, unknown>;
}

export interface ZajemIzid {
  sejaId: string;
  status: 'PREJETO' | 'PODVOJENO';
  format: UvozFormat;
  /** pri podvojitvi: sklic na prvotno sejo in morebitno prejemnico */
  obstojecaSejaId?: string;
  obstojecaPrejemnicaId?: number | null;
}

/** Prag, nad katerim gre izvirnik v objektno hrambo namesto v zbirko. */
const PRAG_HRAMBE_V_ZBIRKI = 2 * 1024 * 1024;

export async function zajemi(db: Db, v: ZajemVhod): Promise<ZajemIzid> {
  const sha256 = createHash('sha256').update(v.raw).digest('hex');
  const format = zaznajFormat(v.raw, v.imeDatoteke ?? '');

  // Idempotenca zajema: ista datoteka po katerem koli kanalu se obdela enkrat.
  const { rows: obstojeca } = await db.execute<{ id: string; prejemnica_id: number | null }>(sql`
    SELECT id, prejemnica_id FROM uvoz_seja
     WHERE enota_id = ${v.enotaId} AND sha256 = ${sha256}
     LIMIT 1
  `);

  if (obstojeca.length) {
    return {
      sejaId: obstojeca[0].id,
      status: 'PODVOJENO',
      format,
      obstojecaSejaId: obstojeca[0].id,
      obstojecaPrejemnicaId: obstojeca[0].prejemnica_id,
    };
  }

  const vZbirko = v.raw.length <= PRAG_HRAMBE_V_ZBIRKI;

  const [seja] = (await db.execute<{ id: string }>(sql`
    INSERT INTO uvoz_seja (
      enota_id, kanal, format, ime_datoteke, mime_tip,
      velikost_b, sha256, vsebina, metapodatki, status)
    VALUES (
      ${v.enotaId}, ${v.kanal}, ${format},
      ${v.imeDatoteke ?? null}, ${v.mimeTip ?? null}, ${v.raw.length},
      ${sha256}, ${vZbirko ? v.raw : null},
      ${JSON.stringify(v.metapodatki ?? {})}::jsonb, 'PREJETO')
    RETURNING id
  `)).rows;

  return { sejaId: seja.id, status: 'PREJETO', format };
}

// =====================================================================
// Razčlenitev seje
// =====================================================================

export async function razcleniSejo(db: Db, sejaId: string): Promise<PrejemDTO> {
  const [seja] = (await db.execute<{
    enota_id: number;
    format: UvozFormat;
    ime_datoteke: string | null;
    vsebina: Buffer | null;
    profil_id: number | null;
    metapodatki: Record<string, unknown> | null;
  }>(sql`
    SELECT enota_id, format, ime_datoteke, vsebina, profil_id, metapodatki
      FROM uvoz_seja WHERE id = ${sejaId}
  `)).rows;

  if (!seja) throw new Error(`Uvozna seja ${sejaId} ne obstaja.`);
  if (!seja.vsebina) throw new Error(`Seja ${sejaId} nima shranjenega izvirnika.`);

  await db.execute(sql`
    UPDATE uvoz_seja SET status = 'V_OBDELAVI' WHERE id = ${sejaId}
  `);

  let dto: PrejemDTO;
  try {
    dto = await razcleni(db, seja.enota_id, seja.format, seja.vsebina,
                         seja.ime_datoteke ?? '', seja.profil_id);
  } catch (e) {
    dto = prazenDto();
    dodajNapako(dto, 'ZAJ011', 'B',
      `Napaka pri razčlenitvi: ${(e as Error).message}`);
  }

  const status = dto.napake.some((n) => n.resnost === 'B')
    ? 'NAPAKA_RAZCLENITVE'
    : 'RAZCLENJENO';

  await db.execute(sql`
    UPDATE uvoz_seja
       SET status = ${status},
           razclenitev = ${JSON.stringify(dto, zamenjajDecimal)}::jsonb,
           napake = ${JSON.stringify(dto.napake)}::jsonb,
           obdelano = now()
     WHERE id = ${sejaId}
  `);

  return dto;
}

/** Decimal v JSON kot niz — number bi izgubil natančnost. */
function zamenjajDecimal(_kljuc: string, vrednost: unknown): unknown {
  return vrednost instanceof Decimal ? vrednost.toString() : vrednost;
}

async function razcleni(
  db: Db,
  enotaId: number,
  format: UvozFormat,
  raw: Buffer,
  ime: string,
  profilId: number | null,
): Promise<PrejemDTO> {
  switch (format) {
    case 'ESLOG_1_6_1':
      return razcleniEslog161(raw);

    case 'ESLOG_2_0_RACUN':
    case 'ESLOG_2_0_DOBAVNICA':
    case 'UBL_2_1_INVOICE':
    case 'UBL_2_1_DESPATCH':
    case 'CII_D16B':
      return razcleniXml(raw);

    case 'CSV':
    case 'XLSX': {
      const konfig = await naloziProfil(db, enotaId, profilId);
      if (!konfig) {
        const dto = prazenDto();
        dodajNapako(dto, 'ZAJ012', 'B',
          'Za tega dobavitelja ni uvoznega profila. Nastavite ga v ' +
          'Nastavitve → Uvozni profili, nato ponovite obdelavo.');
        return dto;
      }
      const r = new CsvRazclenjevalnik(konfig);
      return format === 'XLSX' ? await r.razcleniXlsx(raw, ime) : r.razcleni(raw, ime);
    }

    default: {
      const dto = prazenDto();
      dodajNapako(dto, 'ZAJ002', 'B',
        `Format ${format} še ni podprt.`);
      return dto;
    }
  }
}

async function naloziProfil(
  db: Db, enotaId: number, profilId: number | null,
): Promise<UvozProfilKonfig | null> {
  if (!profilId) return null;
  const [p] = (await db.execute<{ konfiguracija: UvozProfilKonfig; cene_bruto: boolean }>(sql`
    SELECT konfiguracija, cene_bruto FROM uvoz_profil
     WHERE id = ${profilId} AND enota_id = ${enotaId} AND aktivno
  `)).rows;
  if (!p) return null;
  return { ...p.konfiguracija, ceneBruto: p.cene_bruto };
}

// =====================================================================
// Določitev dobavitelja
// =====================================================================

export interface DobaviteljIzid {
  dobaviteljId: string | null;
  vir: 'DAVCNA' | 'MATICNA' | 'IBAN' | 'IME' | 'IME_IBAN' | 'GLN' | 'EPOSTA' | 'PODAN' | null;
  predlogNovega: { davcna: string; naziv: string | null } | null;
}

/**
 * Poišče ali samodejno ustvari dobavitelja na podlagi OCR podatkov.
 * - Če je že v šifrantu → vrne obstoječi ID.
 * - Če ima davčno/VAT ID → pokliče VIES, vstavi v shranjeni_kupci, vrne novi ID.
 * - Če ni nobenih identifikatorjev → vrne null (klic mora vrniti 422).
 */
export async function resolveOrCreateDobavitelja(
  db: Db,
  companyId: string,
  dob: DobaviteljIzid,
  dto: PrejemDTO,
): Promise<string | null> {
  if (dob.dobaviteljId) return dob.dobaviteljId;

  const pred = dob.predlogNovega;
  if (!pred) return null; // ni davčne niti e-naslova

  const jeSi8 = /^\d{8}$/.test(pred.davcna);
  const idZaDdv = jeSi8
    ? (dto.dobaviteljIdDdv ?? `SI${pred.davcna}`)
    : pred.davcna;
  const davcnaStevilka = jeSi8 ? pred.davcna : null;

  // Za slovenske partnerje: Inetis vzporedno z VIES (Inetis ima matično, TRR, kratki naziv)
  const [vies, inetis] = await Promise.all([
    preveriVies(idZaDdv),
    jeSi8 ? poisciNaInetis(pred.davcna) : Promise.resolve(null),
  ]);

  const viesPotrjen =
    vies?.veljaven === true
    && vies.stDdv.replace(/\D/g, "") === idZaDdv.replace(/^[A-Z]{2}/i, "").replace(/\D/g, "");
  if (!inetis && !viesPotrjen) {
    return null;
  }

  // Naziv: Inetis > VIES > OCR > fallback
  const naziv = inetis?.naziv || vies?.naziv || pred.naziv || `Uvoz ${pred.davcna}`;
  const kratkiNaziv = inetis?.kratkiNaziv ?? null;

  // Država
  const kodaDrzave = dto.dobaviteljDrzava ?? vies?.kodaDrzave ?? (jeSi8 ? 'SI' : null);
  const drzavaNaziv = vies?.drzavaNaziv ?? drzavaIzKode(kodaDrzave);

  // Naslov: Inetis > VIES > OCR
  const ulica          = inetis?.ulica          ?? vies?.ulica          ?? dto.dobaviteljUlica          ?? null;
  const postnaStevilka = inetis?.postnaStevilka  ?? vies?.postnaStevilka  ?? dto.dobaviteljPostnaStevilka ?? null;
  const kraj           = inetis?.kraj            ?? vies?.kraj            ?? dto.dobaviteljKraj           ?? null;
  const naslovDeli = [ulica, postnaStevilka && kraj ? `${postnaStevilka} ${kraj}` : (kraj ?? postnaStevilka)].filter(Boolean);
  const naslov = naslovDeli.length ? naslovDeli.join(', ') : (inetis?.naslov ?? vies?.naslov ?? null);

  // TRR: Inetis seznam kot osnova + OCR IBAN kot dopolnitev (če ga ni v Inetis seznamu)
  const inetisIbani = new Set((inetis?.trr ?? []).map(t => t.iban.replace(/\s/g, '').toUpperCase()));
  const ocrIban = (dto.dobaviteljIban ?? '').replace(/\s/g, '').toUpperCase();
  const trrji: TrrPostavka[] = [
    ...(inetis?.trr ?? []).map(t =>
      t.iban.replace(/\s/g, '').toUpperCase().startsWith('SI5601')
        ? { ...t, bic: 'BSLJSI2X' }
        : t,
    ),
    ...(ocrIban && !inetisIbani.has(ocrIban)
      ? [{ iban: ocrIban, bic: dto.dobaviteljBic ?? '' }]
      : []),
  ];
  const trrJson = trrji.length > 0 ? JSON.stringify(trrji) : null;

  // Matična, vrsta, DDV
  const maticnaStevilka = inetis?.maticnaStevilka ?? dto.dobaviteljMaticna ?? null;
  const vrstaPartnerja  = zaznajVrsto(naziv, inetis?.zavezanecDdv ?? null, maticnaStevilka);
  const zavezanecDdv    = inetis?.zavezanecDdv ?? true;
  const idZaDdvZapis    = inetis?.idZaDdv ?? idZaDdv;

  const email   = dto.dobaviteljEmail   ?? null;
  const telefon = dto.dobaviteljTelefon ?? null;

  // Najprej preveri ali že obstaja (po davčni ali id_za_ddv)
  const obstojecResult = await db.execute<{ id: string }>(sql`
    SELECT id FROM counterparties
    WHERE company_id = ${companyId}
      AND (
        (${davcnaStevilka}::text IS NOT NULL AND tax_id = ${davcnaStevilka})
        OR (${idZaDdvZapis}::text IS NOT NULL AND id_za_ddv = ${idZaDdvZapis})
      )
    LIMIT 1
  `);
  if (obstojecResult.rows.length > 0) {
    return String(obstojecResult.rows[0]!.id);
  }

  const [novDob] = (await db.execute<{ id: string }>(sql`
    INSERT INTO counterparties (
      company_id, type, name, kratki_naziv, tax_id, id_za_ddv,
      koda_drzave, country, address, ulica, post_code, city,
      vat_payer, registration_number, vrsta_partnerja, email, phone, trr, iban,
      stevilo_upor, zadnja_uporaba
    ) VALUES (
      ${companyId}, 'both', ${naziv}, ${kratkiNaziv}, ${davcnaStevilka}, ${idZaDdvZapis},
      ${kodaDrzave}, ${drzavaNaziv}, ${naslov}, ${ulica}, ${postnaStevilka}, ${kraj},
      ${zavezanecDdv}, ${maticnaStevilka}, ${vrstaPartnerja}, ${email}, ${telefon},
      ${trrJson}::jsonb,
      CASE WHEN ${trrJson}::jsonb IS NOT NULL AND jsonb_array_length(${trrJson}::jsonb) > 0
           THEN ${trrJson}::jsonb -> 0 ->> 'iban' ELSE NULL END,
      1, NOW()
    )
     ON CONFLICT DO NOTHING
    RETURNING id
  `)).rows;
  if (!novDob) {
    const [sočasnoUstvarjen] = (await db.execute<{ id: string }>(sql`
      SELECT id FROM counterparties
       WHERE company_id = ${companyId}
         AND (
           (${davcnaStevilka}::text IS NOT NULL
             AND regexp_replace(coalesce(tax_id, ''), '\D', '', 'g')
                 = regexp_replace(${davcnaStevilka}, '\D', '', 'g'))
           OR (${idZaDdvZapis}::text IS NOT NULL
             AND upper(regexp_replace(coalesce(id_za_ddv, ''), '\s', '', 'g'))
                 = upper(regexp_replace(${idZaDdvZapis}, '\s', '', 'g')))
         )
       LIMIT 1
    `)).rows;
    return sočasnoUstvarjen ? String(sočasnoUstvarjen.id) : null;
  }
  return String(novDob.id);
}

/**
 * Davčna številka iz razčlenjenega dokumenta ima PREDNOST pred naslovom
 * pošiljatelja. Računovodski servisi pošiljajo v imenu več dobaviteljev
 * z istega naslova; zanašanje na pošiljatelja bi vse te dobavnice
 * pripisalo napačnemu partnerju.
 */
export async function dolociDobavitelja(
  db: Db,
  companyId: string,
  dto: PrejemDTO,
  posiljatelj?: string | null,
  podanId?: string | null,
): Promise<DobaviteljIzid> {
  if (podanId) return { dobaviteljId: podanId, vir: 'PODAN', predlogNovega: null };

  let predlogNovega: DobaviteljIzid["predlogNovega"] = null;

  // Skupen šifrant partnerjev (counterparties, company-scope)
  if (dto.dobaviteljDavcna) {
    const [p] = (await db.execute<{ id: string }>(sql`
      SELECT id FROM counterparties
       WHERE company_id = ${companyId}
         AND regexp_replace(coalesce(tax_id,''), '\D', '', 'g')
             = ${dto.dobaviteljDavcna}
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: String(p.id), vir: 'DAVCNA', predlogNovega: null };

    // OCR-davčna je lahko napačno prebrana matična. Pred ustvarjanjem
    // nadaljuj še z matično, IBAN-om in nazivom.
    predlogNovega = { davcna: dto.dobaviteljDavcna, naziv: dto.dobaviteljNaziv };
  }

  // Tuji dobavitelj — poišči po id_za_ddv (npr. DE123456789)
  if (dto.dobaviteljIdDdv) {
    const idDdvNorm = dto.dobaviteljIdDdv.replace(/\s/g, '').toUpperCase();
    const [p] = (await db.execute<{ id: string }>(sql`
      SELECT id FROM counterparties
       WHERE company_id = ${companyId}
         AND upper(regexp_replace(coalesce(id_za_ddv,''), '\s', '', 'g'))
             = ${idDdvNorm}
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: String(p.id), vir: 'DAVCNA', predlogNovega: null };

    predlogNovega ??= { davcna: idDdvNorm, naziv: dto.dobaviteljNaziv };
  }

  // GLN: BOOKIE shranjeni_kupci nima gln stolpca — preskočimo

  // Matična številka: zanesljiv enolični identifikator podjetja
  if (dto.dobaviteljMaticna) {
    const maticnaNorm = dto.dobaviteljMaticna.replace(/\D/g, '');
    if (maticnaNorm) {
      const [p] = (await db.execute<{ id: string }>(sql`
        SELECT id FROM counterparties
         WHERE company_id = ${companyId}
           AND regexp_replace(coalesce(registration_number,''), '\D', '', 'g') = ${maticnaNorm}
         LIMIT 1
      `)).rows;
      if (p) return { dobaviteljId: String(p.id), vir: 'MATICNA', predlogNovega: null };
    }
  }

  // IBAN/TRR: zanesljiv identifikator bančnega računa
  // Kadar je IBAN v šifrantu enolično prisoten → samodejno
  const ibanNorm = (dto.dobaviteljIban ?? '').replace(/\s/g, '').toUpperCase();
  if (ibanNorm) {
    const { rows: ibanZadetki } = await db.execute<{ id: string }>(sql`
      SELECT id FROM counterparties
       WHERE company_id = ${companyId}
         AND (
           upper(replace(coalesce(iban,''), ' ', '')) = ${ibanNorm}
           OR (trr IS NOT NULL AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(trr) AS t
              WHERE upper(replace(t->>'iban', ' ', '')) = ${ibanNorm}
           ))
         )
       LIMIT 2
    `);
    if (ibanZadetki.length === 1) {
      return { dobaviteljId: String(ibanZadetki[0].id), vir: 'IBAN', predlogNovega: null };
    }
  }

  // Ime-fallback:
  // Primerja OCR naziv z OBEMA: dolgim (name) IN kratkim (kratki_naziv) nazivom.
  // Vzame NAJVEČJO similarity od obeh (GREATEST), prag ostaja 0.75.
  // - natanko 1 visoko-podoben zadetek → samodejno
  // - več zadetkov + se IBAN ujema z enim → samodejno
  // - sicer → MANJKA_DOBAVITELJ picker
  if (dto.dobaviteljNaziv) {
    const imeNorm = dto.dobaviteljNaziv.trim();
    const { rows: imeZadetki } = await db.execute<{ id: string }>(sql`
      SELECT id
        FROM counterparties
       WHERE company_id = ${companyId}
         AND GREATEST(
               similarity(lower(name), lower(${imeNorm})),
               similarity(lower(COALESCE(kratki_naziv, '')), lower(${imeNorm}))
             ) > 0.75
       ORDER BY GREATEST(
                  similarity(lower(name), lower(${imeNorm})),
                  similarity(lower(COALESCE(kratki_naziv, '')), lower(${imeNorm}))
                ) DESC
       LIMIT 10
    `);
    if (imeZadetki.length === 1) {
      return { dobaviteljId: String(imeZadetki[0].id), vir: 'IME', predlogNovega: null };
    }
    if (imeZadetki.length > 1 && ibanNorm) {
      const imeIds = imeZadetki.map((r: { id: string }) => r.id);
      const [p] = (await db.execute<{ id: string }>(sql`
        SELECT id FROM counterparties
         WHERE company_id = ${companyId}
           AND id = ANY(${imeIds}::uuid[])
           AND (
             upper(replace(coalesce(iban,''), ' ', '')) = ${ibanNorm}
             OR (trr IS NOT NULL AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(trr) AS t
                WHERE upper(replace(t->>'iban', ' ', '')) = ${ibanNorm}
             ))
           )
         LIMIT 1
      `)).rows;
      if (p) return { dobaviteljId: String(p.id), vir: 'IME_IBAN', predlogNovega: null };
    }
  }

  if (posiljatelj) {
    const naslov = posiljatelj.toLowerCase();
    const domena = naslov.split('@')[1] ?? '';
    const [p] = (await db.execute<{ partner_id: string }>(sql`
      SELECT partner_id FROM partner_eposta
       WHERE (lower(naslov) = ${naslov} OR lower(domena) = ${domena})
         AND partner_id IN (
           SELECT id FROM counterparties WHERE company_id = ${companyId}
         )
       ORDER BY (naslov IS NOT NULL) DESC
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: String(p.partner_id), vir: 'EPOSTA', predlogNovega: null };
  }

  return { dobaviteljId: null, vir: null, predlogNovega };
}

// =====================================================================
// Ustvarjanje osnutka prejemnice
// =====================================================================

export interface OsnutekIzid {
  prejemnicaId: number;
  vrstaDokumenta: PrejemDTO["vrstaDokumenta"];
  datumZapadlosti: string | null;
  dobaviteljIban: string | null;
  dobaviteljBic: string | null;
  placilniNacin: string | null;
  placilniModel: string | null;
  placilniSklic: string | null;
  placilniNamen: string | null;
  uparjenih: number;
  dvomljivih: number;
  neuparjenih: number;
}

/** Vržemo, ko dokument s to kombinacijo (enota, dobavitelj, st_dokumenta, datum) že obstaja. */
export class DuplicatePrejemnicaError extends Error {
  constructor(public readonly obstojeciId: number) {
    super(`Dokument je bil že uvožen (prejemnica #${obstojeciId}).`);
    this.name = 'DuplicatePrejemnicaError';
  }
}

export async function ustvariOsnutek(
  db: Db,
  opts: {
    enotaId: number;
    sejaId: string;
    dobaviteljId: string;
    dto: PrejemDTO;
    uporabnikId: number;
    /** Clerk actor, kadar tok teče iz avtentificirane zahteve; ozadni zajem ga nima. */
    actorSnapshot?: string | null;
  },
): Promise<OsnutekIzid> {
  const { enotaId, sejaId, dobaviteljId, dto, uporabnikId, actorSnapshot } = opts;

  if (imaBlokado(dto)) {
    throw new Error(
      'Dokument vsebuje blokirne napake in ga ni mogoče uvoziti. ' +
      'Preglejte napake seje.',
    );
  }

  // Datum prejema = danes ali simulacijski datum (NE datum na dokumentu)
  const datumPrejema = await getSimDatumOrNow(enotaId);
  const datumPrejemaStr = datumPrejema.toISOString().slice(0, 10); // YYYY-MM-DD
  const vatCodes = (await db.execute<InputVatCodeCandidate>(sql`
    SELECT id, code, rate
      FROM vat_code
     WHERE direction = 'IN'
       AND valid_from <= ${datumPrejemaStr}
       AND (valid_to IS NULL OR valid_to >= ${datumPrejemaStr})
  `)).rows;

  let prejemnicaId: number;
  try {
    prejemnicaId = await db.transaction(async (tx) => {
    // Stevilka: YYNNNNNN — po letu prejema (ne letu dokumenta)
    const yy = String(datumPrejema.getFullYear()).slice(-2);
    const [seq] = (await tx.execute<{ next: string }>(sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next
        FROM prejemnice
       WHERE stevilka LIKE ${`${yy}%`}
         AND LENGTH(stevilka) = 8
         AND enota_id = ${enotaId}
    `)).rows;
    const stevilka = `${yy}${String(Number(seq?.next ?? 1)).padStart(6, '0')}`;

    // datum       = datum prejema (danes / sim datum)
    // datum_dokumenta = datum na skeniranem dokumentu (dobavnica)
    // Snapshot je del dokumenta, ne živi pogled na partnerja/podjetje.
    const [snapshotSource] = (await tx.execute<{
      company_id: string;
      company_name: string; company_tax_id: string; company_vat_id: string | null;
      company_address: string | null; company_street: string | null; company_country: string | null;
      supplier_name: string | null; supplier_tax_id: string | null; supplier_vat_id: string | null;
      supplier_registration: string | null; supplier_address: string | null; supplier_street: string | null;
      supplier_post_code: string | null; supplier_city: string | null; supplier_country: string | null;
      supplier_iban: string | null; supplier_trr: unknown;
    }>(sql`
      SELECT c.id AS company_id, c.naziv AS company_name, c.podjetje_davcna AS company_tax_id, c.id_za_ddv AS company_vat_id,
             c.naslov AS company_address, c.ulica AS company_street, COALESCE(c.koda_drzave, c.drzava) AS company_country,
             cp.name AS supplier_name, cp.tax_id AS supplier_tax_id, cp.id_za_ddv AS supplier_vat_id,
             cp.registration_number AS supplier_registration, cp.address AS supplier_address, cp.ulica AS supplier_street,
             cp.post_code AS supplier_post_code, cp.city AS supplier_city, COALESCE(cp.koda_drzave, cp.country) AS supplier_country,
             cp.iban AS supplier_iban, cp.trr AS supplier_trr
        FROM enote e
        JOIN companies c ON c.id = e.company_id
        LEFT JOIN counterparties cp ON cp.id = ${dobaviteljId} AND cp.company_id = c.id
       WHERE e.id = ${enotaId}
       LIMIT 1
    `)).rows;
    if (!snapshotSource) throw new Error(`Enota ${enotaId} nima podjetja za dokumentni snapshot.`);
    const [sessionSource] = (await tx.execute<{ sha256: string }>(sql`
      SELECT sha256 FROM uvoz_seja WHERE id = ${sejaId} FOR UPDATE
    `)).rows;
    const sourceKind = dto.vrstaDokumenta === "DOBAVNICA"
      ? "delivery_note"
      : dto.vrstaDokumenta === "DOBROPIS"
        ? "credit_note"
        : dto.vrstaDokumenta === "BREMEPIS"
          ? "debit_note"
          : "invoice";
    const sourceDocumentId = await claimPurchaseSourceDocument(tx, {
      companyId: snapshotSource.company_id,
      counterpartyId: dobaviteljId,
      kind: sourceKind,
      documentNumber: dto.stDokumenta,
      documentDate: dto.datumDokumenta,
      currency: dto.valuta,
      contentSha256: sessionSource?.sha256,
    });
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${sourceDocumentId}))
    `);
    const existingErpReceipt = await tx.execute(sql`
      SELECT id FROM goods_receipts
       WHERE source_document_id = ${sourceDocumentId}
       LIMIT 1
    `);
    if (existingErpReceipt.rows[0]) {
      throw new Error("Ta listina je že finančno zajeta kot ERP prejemnica.");
    }
    const existingFinalInvoice = await tx.execute(sql`
      SELECT id FROM invoices
       WHERE source_document_id = ${sourceDocumentId}
         AND status <> 'draft'
       LIMIT 1
    `);
    if (existingFinalInvoice.rows[0]) {
      throw new Error("Ta listina je že finančno zajeta kot prejeti račun.");
    }
    const trr = Array.isArray(snapshotSource.supplier_trr) ? snapshotSource.supplier_trr[0] as { iban?: unknown; bic?: unknown } | undefined : undefined;
    const supplierIban = dto.dobaviteljIban ?? snapshotSource.supplier_iban ?? (typeof trr?.iban === "string" ? trr.iban : null);
    const supplierBic = dto.dobaviteljBic ?? (typeof trr?.bic === "string" ? trr.bic : null);
    const dependentCosts = dto.odvisniStroski.reduce((total, cost) => total.plus(cost.znesek), new Decimal(0));
    const brutoSkupaj = dto.izvSkupaj
      ?? (dto.izvOsnova && dto.izvDdv ? dto.izvOsnova.plus(dto.izvDdv).plus(dependentCosts) : null);
    const [glava] = (await tx.execute<{ id: number }>(sql`
      INSERT INTO prejemnice (
        enota_id, dobavitelj_id, datum,
        vrsta_cen, opomba, stevilka,
        st_dokumenta, datum_dokumenta, uvoz_seja_id,
        valuta, datum_zapadlosti, ddv_osnova, ddv_znesek,
        vrsta_dokumenta, datum_dobave, datum_opravljene_storitve, bruto_skupaj,
         placilni_nacin, placano_z_gotovino, placilni_model, placilni_sklic, placilni_namen,
        dobavitelj_naziv, dobavitelj_davcna, dobavitelj_id_ddv, dobavitelj_maticna,
        dobavitelj_ulica, dobavitelj_posta, dobavitelj_kraj, dobavitelj_drzava, dobavitelj_iban, dobavitelj_bic,
        prejemnik_naziv, prejemnik_davcna, prejemnik_id_ddv, prejemnik_naslov, prejemnik_drzava, snapshot_zajet,
        source_document_id)
      VALUES (
        ${enotaId}, ${dobaviteljId},
        ${datumPrejemaStr},
        ${dto.ceneBruto ? 'bruto' : 'neto'},
        ${dto.stDokumenta ? `Uvoz: ${dto.stDokumenta}` : 'Uvoz'},
        ${stevilka},
        ${dto.stDokumenta ?? null}, ${dto.datumDokumenta ?? null}, ${sejaId},
        ${dto.valuta}, ${dto.datumZapadlosti ?? null},
        ${dto.izvOsnova?.toString() ?? null}, ${dto.izvDdv?.toString() ?? null},
        ${dto.vrstaDokumenta}, ${dto.datumDobave ?? null}, ${dto.datumOpravljeneStoritve ?? null},
        ${brutoSkupaj?.toString() ?? null},
         ${dto.placilniNacin ?? null},
         ${normalizeIncomingPaymentMethod(dto.placilniNacin) === "cash"},
         ${dto.placilniModel ?? null},
        ${dto.placilniSklic ?? null}, ${dto.placilniNamen ?? null},
        ${dto.dobaviteljNaziv ?? snapshotSource.supplier_name}, ${dto.dobaviteljDavcna ?? snapshotSource.supplier_tax_id},
        ${dto.dobaviteljIdDdv ?? snapshotSource.supplier_vat_id}, ${dto.dobaviteljMaticna ?? snapshotSource.supplier_registration},
        ${dto.dobaviteljUlica ?? snapshotSource.supplier_street ?? snapshotSource.supplier_address},
        ${dto.dobaviteljPostnaStevilka ?? snapshotSource.supplier_post_code}, ${dto.dobaviteljKraj ?? snapshotSource.supplier_city},
        ${dto.dobaviteljDrzava ?? snapshotSource.supplier_country}, ${supplierIban}, ${supplierBic},
        ${snapshotSource.company_name}, ${snapshotSource.company_tax_id}, ${snapshotSource.company_vat_id},
        ${snapshotSource.company_address ?? snapshotSource.company_street}, ${snapshotSource.company_country}, now(),
        ${sourceDocumentId})
      RETURNING id
    `)).rows;

    for (const p of dto.postavke) {
       const preslikavaDdv = resolveInputVatCode(
         vatCodes,
         p.ddvKoda ?? p.ddvKategorija,
         p.ddvStopnja?.toString() ?? null,
       );
       const vatCodeId = preslikavaDdv.kind === 'matched' ? preslikavaDdv.vatCodeId : null;
       if (preslikavaDdv.kind !== 'matched' && (p.ddvKoda || p.ddvKategorija || p.ddvStopnja)) {
         p.opozorila.push({
           koda: 'DDV021',
           resnost: 'O',
           sporocilo: preslikavaDdv.kind === 'ambiguous'
             ? `DDV kode ni mogoče enolično preslikati (${preslikavaDdv.candidateCount} veljavnih vhodnih kod).`
             : 'Za uvozno DDV kodo oziroma stopnjo ni veljavne vhodne DDV kode.',
         });
       }
      // Cena na enoto: dokument navaja ceno paketa, prejemnica pa vodi
      // oboje. Delimo šele tu, da ostane izvorni zapis nedotaknjen.
      const enotVPaketu = p.enotVPaketu.gt(0) ? p.enotVPaketu : new Decimal(1);
      // Pri UBL/e-SLOG/CII je cena že neto — rabat ne sme biti odbitan še enkrat.
      const cenaPaket = p.rabatVkljucenVCeni
        ? p.izvCena
        : netoPoRabatih(p.izvCena, p.rabat1Odst, p.rabat2Odst);
      const cenaEnota = cenaPaket.div(enotVPaketu);
      const kolicinaEnot = p.izvKolicina.mul(enotVPaketu);

      // BOOKIE stolpci: kolicina (enote), cena_kos, skupaj
      // artikel_id NULL je dovoljen po migraciji 0009 (DROP NOT NULL)
      const skupaj = cenaPaket.mul(p.izvKolicina);
      await tx.execute(sql`
        INSERT INTO prejemnice_postavke (
          prejemnica_id,
          kolicina, cena_kos, skupaj, enot_v_paketu,
          izv_gtin, izv_sifra, izv_naziv, izv_enota, izv_kolicina, izv_cena,
           rabat_1_odst, rabat_2_odst, opozorila,
             ddv_stopnja, ddv_osnova, ddv_znesek, vat_code_id, vrstica_tip,
             enota_mere, neto_cena, neto_znesek, ddv_kategorija)
        VALUES (
          ${glava.id},
          ${kolicinaEnot.toString()}, ${cenaEnota.toString()},
          ${skupaj.toString()}, ${enotVPaketu.toString()},
          ${p.izvGtin ?? null}, ${p.izvSifra ?? null}, ${p.izvNaziv ?? null},
          ${p.izvEnota ?? null}, ${p.izvKolicina.toString()}, ${p.izvCena.toString()},
          ${p.rabat1Odst.toString()}, ${p.rabat2Odst.toString()},
           ${JSON.stringify(p.opozorila)}::jsonb,
           ${p.ddvStopnja?.toString() ?? null},
           ${(p.ddvOsnova ?? p.izvVrednost ?? skupaj).toString()},
           ${(p.ddvZnesek ?? (p.ddvStopnja ? (p.ddvOsnova ?? p.izvVrednost ?? skupaj).mul(p.ddvStopnja).div(100) : null))?.toString() ?? null},
            ${vatCodeId},
            ${p.vrsticaTip},
            ${toUneceUnitCode(p.izvEnota)}, ${cenaEnota.toString()}, ${skupaj.toString()}, ${p.ddvKategorija ?? null})
      `);
    }

     for (const strosek of dto.odvisniStroski) {
       await tx.execute(sql`
         INSERT INTO prejemnice_odvisni_stroski (
           prejemnica_id, naziv, znesek, ddv_stopnja, obravnava)
         VALUES (
           ${glava.id},
           ${strosek.razlog ?? strosek.vrsta},
           ${strosek.znesek.toString()},
           ${strosek.ddvStopnja?.toString() ?? null},
           ${strosek.obravnava})
       `);
     }

    // Posodobi skupaj_vrednost na glavi (seštevek vseh postavk)
    await tx.execute(sql`
      UPDATE prejemnice
         SET skupaj_vrednost = (
           SELECT COALESCE(SUM(skupaj), 0)
             FROM prejemnice_postavke
            WHERE prejemnica_id = ${glava.id}
         )
       WHERE id = ${glava.id}
    `);

    await tx.execute(sql`
      UPDATE uvoz_seja
         SET prejemnica_id = ${glava.id}, status = 'OBDELANO'
       WHERE id = ${sejaId}
    `);

    await tx.execute(sql`
      INSERT INTO uvoz_dnevnik (enota_id, seja_id, prejemnica_id,
                                uporabnik_id, dogodek, podrobnosti)
      VALUES (${enotaId}, ${sejaId}, ${glava.id}, ${uporabnikId},
              'OSNUTEK_USTVARJEN',
              ${JSON.stringify({
                postavk: dto.postavke.length,
                stDokumenta: dto.stDokumenta,
                ceneBruto: dto.ceneBruto,
              })}::jsonb)
    `);

    return Number(glava.id);
  });
  } catch (e: unknown) {
    // Unique constraint uq_prejemnica_dokument (enota_id, dobavitelj_id, st_dokumenta, datum_dokumenta)
    // Drizzle's _DrizzleQueryError embeds the pg error message but doesn't expose cause.code reliably.
    const msg = (e as any)?.message ?? '';
    const causeCode = (e as any)?.cause?.code ?? (e as any)?.code ?? '';
    if (
      causeCode === '23505'
      || causeCode === 'LEGACY_PURCHASE_SOURCE_CONFLICT'
      || msg.includes('uq_prejemnica_dokument')
      || msg.includes('prejemnice_source_document_unique')
    ) {
      const [obs] = (await db.execute<{ id: number }>(sql`
        SELECT p.id
          FROM prejemnice p
          JOIN enote e ON e.id = p.enota_id
         WHERE e.company_id = (
                 SELECT company_id FROM enote WHERE id = ${enotaId}
               )
           AND p.dobavitelj_id = ${dobaviteljId}
           AND regexp_replace(upper(p.st_dokumenta), '[^[:alnum:]]', '', 'g')
               = regexp_replace(upper(${dto.stDokumenta ?? ''}), '[^[:alnum:]]', '', 'g')
         LIMIT 1
      `)).rows;
      throw new DuplicatePrejemnicaError(obs ? Number(obs.id) : 0);
    }
    throw e;
  }

  const izid = await upariPrejemnico(db, enotaId, prejemnicaId!);

  return {
    prejemnicaId: prejemnicaId!,
    vrstaDokumenta: dto.vrstaDokumenta,
    datumZapadlosti: dto.datumZapadlosti,
    dobaviteljIban: dto.dobaviteljIban,
    dobaviteljBic: dto.dobaviteljBic,
    placilniNacin: dto.placilniNacin,
    placilniModel: dto.placilniModel,
    placilniSklic: dto.placilniSklic,
    placilniNamen: dto.placilniNamen,
    ...izid,
  };
}

/**
 * Vpiše zaloga_gibi za vse uparjene postavke uvožene prejemnice in
 * posodobi zaloge.kolicina / povprecna_cena.
 *
 * Append-only: obstoječe gibe za to prejemnico stornira, nato ustvari
 * nove. Izvirne knjižbe in njihovi actor snapshoti ostanejo nespremenjeni.
 *
 * Kliče se:
 *  1. Ob nastanku osnutka (ustvariOsnutek) — za 100 % samodejno uparjanje.
 *  2. Ob ročnem uparjanju v UparjanjeDialog (/postavke/:id/upari).
 *  3. Ob ponovnem auto-matchu (/prejemnice/:id/uparjanje).
 *
 * Izvozi se, da ga routes/pos/uvoz-prejemnic.ts ne podvaja logike.
 */
export async function knjizalogaGibiZaUvozPrejemnico(
  db: Db,
  prejemnicaId: number,
  actorSnapshot: string | null,
): Promise<void> {
  // Serialize every reconciliation of the same imported receipt. Some callers
  // already hold this lock, but keeping it here protects all current and future
  // entry points from racing reversal selection and replacement insertion.
  await db.execute(sql`
    SELECT id
      FROM prejemnice
     WHERE id = ${prejemnicaId}
     FOR UPDATE
  `);

  const { rows: postavke } = await db.execute<{
    id: number;
    artikel_id: number | null;
    vrstica_tip: string;
    kolicina: string;
    cena_kos: string;
    opomba: string | null;
    datum: Date;
    enota_id: number;
    dobavitelj_id: string | null;
    povratna_embalaza: boolean;
    depozitna_vrednost: string | null;
  }>(sql`
    SELECT
      pp.id, pp.artikel_id, pp.kolicina, pp.cena_kos,
      p.opomba, p.datum, p.enota_id, p.dobavitelj_id,
      a.povratna_embalaza, a.depozitna_vrednost, pp.vrstica_tip
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      JOIN artikli a ON a.id = pp.artikel_id
     WHERE pp.prejemnica_id = ${prejemnicaId}
       AND pp.artikel_id IS NOT NULL
       AND pp.vrstica_tip = 'zaloga'
  `);

  // Stare gibe ohrani in jih razveljavi, tudi če po novem ni nič uparjeno.
  const reversedArtikelIds = await appendStockMovementReversals(db as any, {
    referenceId: prejemnicaId,
    sourceSnapshots: ['uvoz-prejemnica', 'prejemnica'],
    actorSnapshot,
    reversalSourceSnapshot: 'uvoz-prejemnica_reversal',
    note: 'Storno uskladitve uvožene prejemnice',
    legacyKind: 'prejemnica',
  });

  for (const p of postavke) {
    const vrednost = new Decimal(p.kolicina).mul(p.cena_kos);
    await db.insert(zalogaGibiTable).values({
      artikelId:  p.artikel_id,
      tip:        'prejemnica',
      kolicina:   p.kolicina,
      cenaKos:    p.cena_kos,
      vrednost:   vrednost.toString(),
      opomba:     p.opomba ?? null,
      referencaId: prejemnicaId,
      actorSnapshot,
      effectiveAtSnapshot: p.datum instanceof Date ? p.datum : new Date(p.datum),
      sourceSnapshot: 'uvoz-prejemnica',
    });
  }

  // Povratna embalaža je ločena fizična evidenca. Najprej append-only
  // razveljavimo trenutno veljavne prejeme te prejemnice, nato zapišemo
  // aktualno uparjene postavke. Tako ponovljeno uparjanje ne ustvari dvojnikov.
  const { rows: receiptLineRows } = await db.execute<{ id: number }>(sql`
    SELECT id
      FROM prejemnice_postavke
     WHERE prejemnica_id = ${prejemnicaId}
  `);
  const packagingLineIds = receiptLineRows.map((p: { id: number }) => p.id);
  if (packagingLineIds.length > 0) {
    const { rows: activePackaging } = await db.execute<{
      id: number;
      enota_id: number;
      artikel_id: number;
      dobavitelj_id: string | null;
      kolicina: string;
      depozitna_vrednost: string | null;
      prejemnica_postavka_id: number;
      vrsta: 'prejem' | 'vracilo';
    }>(sql`
      SELECT ep.id, ep.enota_id, ep.artikel_id, ep.dobavitelj_id,
             ep.kolicina, ep.depozitna_vrednost, ep.prejemnica_postavka_id, ep.vrsta
        FROM embalazni_prometi ep
       WHERE ep.prejemnica_postavka_id IN (${sql.join(packagingLineIds.map((id: number) => sql`${id}`), sql`, `)})
         AND NOT EXISTS (
           SELECT 1 FROM embalazni_prometi reversal
            WHERE reversal.reversal_of_id = ep.id
         )
    `);
    for (const movement of activePackaging) {
      await db.insert(embalazniPrometiTable).values({
        enotaId: movement.enota_id,
        artikelId: movement.artikel_id,
        dobaviteljId: movement.dobavitelj_id,
        kolicina: String(-Number(movement.kolicina)),
        depozitnaVrednost: movement.depozitna_vrednost,
        prejemnicaPostavkaId: movement.prejemnica_postavka_id,
        vrsta: movement.vrsta === 'prejem' ? 'vracilo' : 'prejem',
        opomba: 'Storno uskladitve uvožene prejemnice',
        reversalOfId: movement.id,
        actorSnapshot,
      });
    }
  }

  for (const p of postavke) {
    if (!p.povratna_embalaza || new Decimal(p.kolicina).isZero()) continue;
    const ciljnaVrsta = packagingMovementKindForQuantity(p.kolicina);
    const { rows: currentPackaging } = await db.execute<{ id: number; vrsta: string }>(sql`
      SELECT ep.id, ep.vrsta
        FROM embalazni_prometi ep
       WHERE ep.prejemnica_postavka_id = ${p.id}
         AND NOT EXISTS (
           SELECT 1 FROM embalazni_prometi reversal
            WHERE reversal.reversal_of_id = ep.id
         )
       ORDER BY ep.id DESC
       LIMIT 1
    `);
    if (currentPackaging[0]?.vrsta === ciljnaVrsta) continue;
    await db.insert(embalazniPrometiTable).values({
      enotaId: p.enota_id,
      artikelId: p.artikel_id,
      dobaviteljId: p.dobavitelj_id,
      kolicina: p.kolicina,
      depozitnaVrednost: p.depozitna_vrednost,
      prejemnicaPostavkaId: p.id,
      vrsta: ciljnaVrsta,
      reversalOfId: currentPackaging[0]?.id ?? null,
      actorSnapshot,
      datum: p.datum instanceof Date ? p.datum : new Date(p.datum),
    });
  }

  const artikelIds = [...new Set([
    ...reversedArtikelIds,
    ...postavke.map((p: { artikel_id: number }) => p.artikel_id),
  ])];
  await recomputeZaloge(artikelIds, db as any);
}

// =====================================================================
// Celoten tok v enem klicu
// =====================================================================

export interface UvoziIzid extends Partial<OsnutekIzid> {
  sejaId: string;
  format: UvozFormat;
  status: 'OSNUTEK_USTVARJEN' | 'PODVOJENO' | 'NAPAKA' | 'MANJKA_DOBAVITELJ';
  napake: PrejemDTO['napake'];
  predlogDobavitelja?: DobaviteljIzid['predlogNovega'];
  dobaviteljId?: string | null;
  dobaviteljNazivOcr?: string | null;
}

export async function uvozi(
  db: Db,
  v: ZajemVhod & {
    uporabnikId: number;
    actorSnapshot?: string | null;
    posiljatelj?: string | null;
  },
): Promise<UvoziIzid> {
  const zajem = await zajemi(db, v);

  if (zajem.status === 'PODVOJENO') {
    // Blokira samo, če je obstoječa seja dejansko ustvarila prejemnico.
    // Če prejšnji poskus ni uspel do konca (prejemnica_id = NULL, npr. padel
    // pri razčlenjevanju ali iskanju dobavitelja), dovolimo ponoven uvoz iste
    // datoteke — seja se bo nadaljevala z obstoječim sejaId.
    // S tem uskladimo CSV/e-SLOG pot z že obstoječo logiko PDF poti.
    if (zajem.obstojecaPrejemnicaId != null) {
      return {
        sejaId: zajem.sejaId,
        format: zajem.format,
        status: 'PODVOJENO',
        napake: [
          {
            koda: 'ZAJ003',
            resnost: 'B',
            sporocilo: 'Ta dokument je bil že uvožen.',
            podatki: {
              sejaId: zajem.obstojecaSejaId,
              prejemnicaId: zajem.obstojecaPrejemnicaId,
            },
          },
        ],
        prejemnicaId: zajem.obstojecaPrejemnicaId ?? undefined,
      };
    }
    // Obstoječa seja nima prejemnice → nadaljujemo z njenim sejaId.
    // razcleniSejo bo prepisala status iz NAPAKA_RAZCLENITVE v RAZCLENJENO
    // (ali spet v NAPAKA_RAZCLENITVE, če se napaka ponovi).
  }

  // Za CSV/XLSX: če seja nima profil_id in je dobaviteljId znan,
  // poiščemo aktiven profil za tega dobavitelja in ga nastavimo na seji.
  // S tem rešimo ZAJ012 brez ročnega koraka v UI.
  if ((zajem.format === 'CSV' || zajem.format === 'XLSX') && v.dobaviteljId) {
    const { rows: profilVrstice } = await db.execute<{ id: number }>(sql`
      SELECT id FROM uvoz_profil
       WHERE enota_id      = ${v.enotaId}
         AND dobavitelj_id = ${v.dobaviteljId}
         AND format::text  = ${zajem.format}
         AND aktivno
       LIMIT 1
    `);
    if (profilVrstice[0]) {
      await db.execute(sql`
        UPDATE uvoz_seja
           SET profil_id = ${profilVrstice[0].id}
         WHERE id = ${zajem.sejaId}
           AND profil_id IS NULL
      `);
    }
  }

  const dto = await razcleniSejo(db, zajem.sejaId);
  if (dto.napake.some((n) => n.resnost === 'B')) {
    return { sejaId: zajem.sejaId, format: zajem.format, status: 'NAPAKA', napake: dto.napake };
  }

  // Pridobi companyId iz enotaId za skupen šifrant partnerjev
  const [enotaZaCompany] = (await db.execute<{ company_id: string }>(sql`
    SELECT company_id FROM enote WHERE id = ${v.enotaId} LIMIT 1
  `)).rows;
  const companyIdZaUvoz = enotaZaCompany?.company_id ?? '';

  const dob = await dolociDobavitelja(
    db, companyIdZaUvoz, dto, v.posiljatelj, v.dobaviteljId,
  );

  const dobaviteljId = await resolveOrCreateDobavitelja(db, companyIdZaUvoz, dob, dto);
  if (!dobaviteljId) {
    return {
      sejaId: zajem.sejaId,
      format: zajem.format,
      status: 'MANJKA_DOBAVITELJ',
      napake: [{
        koda: 'DOK001',
        resnost: 'B',
        sporocilo: 'Dobavitelja ni bilo mogoče določiti iz dokumenta.',
      }],
      predlogDobavitelja: null,
    };
  }

  const osnutek = await ustvariOsnutek(db, {
    enotaId: v.enotaId,
    sejaId: zajem.sejaId,
    dobaviteljId: dobaviteljId!,
    dto,
    uporabnikId: v.uporabnikId,
    actorSnapshot: v.actorSnapshot ?? null,
  });

  return {
    sejaId: zajem.sejaId,
    format: zajem.format,
    status: 'OSNUTEK_USTVARJEN',
    napake: dto.napake,
    dobaviteljId,
    dobaviteljNazivOcr: dto.dobaviteljNaziv,
    ...osnutek,
  };
}
