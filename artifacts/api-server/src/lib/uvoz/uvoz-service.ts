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
  dobaviteljId?: number | null;
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
      return format === 'XLSX' ? r.razcleniXlsx(raw, ime) : r.razcleni(raw, ime);
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
  dobaviteljId: number | null;
  vir: 'DAVCNA' | 'GLN' | 'EPOSTA' | 'PODAN' | null;
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
  enotaId: number,
  dob: DobaviteljIzid,
  dto: PrejemDTO,
): Promise<number | null> {
  if (dob.dobaviteljId) return dob.dobaviteljId;

  const pred = dob.predlogNovega;
  if (!pred) return null; // ni davčne niti e-naslova

  const jeSi8 = /^\d{8}$/.test(pred.davcna);
  const idZaDdv = jeSi8
    ? (dto.dobaviteljIdDdv ?? `SI${pred.davcna}`)
    : pred.davcna;
  const davcnaStevilka = jeSi8 ? pred.davcna : null;

  const vies = await preveriVies(idZaDdv);

  // Naziv: VIES > OCR > fallback
  const naziv = vies?.naziv ?? pred.naziv ?? `Uvoz ${pred.davcna}`;

  // Država
  const kodaDrzave = dto.dobaviteljDrzava ?? vies?.kodaDrzave ?? (jeSi8 ? 'SI' : null);
  const drzavaNaziv = vies?.drzavaNaziv ?? drzavaIzKode(kodaDrzave);

  // Naslov: VIES strukturiran > OCR > VIES polni niz
  const ulica           = vies?.ulica          ?? dto.dobaviteljUlica          ?? null;
  const postnaStevilka  = vies?.postnaStevilka  ?? dto.dobaviteljPostnaStevilka ?? null;
  const kraj            = vies?.kraj            ?? dto.dobaviteljKraj           ?? null;

  // Polni naslov (za `naslov` stolpec) — sestavi iz delov ali vzemi iz VIES
  const naslovDeli = [ulica, postnaStevilka && kraj ? `${postnaStevilka} ${kraj}` : (kraj ?? postnaStevilka)].filter(Boolean);
  const naslov = naslovDeli.length ? naslovDeli.join(', ') : (vies?.naslov ?? null);

  const [novDob] = (await db.execute<{ id: number }>(sql`
    INSERT INTO shranjeni_kupci (
      enota_id, naziv, davcna_stevilka, id_za_ddv,
      koda_drzave, drzava, naslov, ulica, postna_stevilka, kraj,
      zavezanec_ddv
    ) VALUES (
      ${enotaId}, ${naziv}, ${davcnaStevilka}, ${idZaDdv},
      ${kodaDrzave}, ${drzavaNaziv}, ${naslov}, ${ulica}, ${postnaStevilka}, ${kraj},
      true
    )
    RETURNING id
  `)).rows;
  return Number(novDob.id);
}

/**
 * Davčna številka iz razčlenjenega dokumenta ima PREDNOST pred naslovom
 * pošiljatelja. Računovodski servisi pošiljajo v imenu več dobaviteljev
 * z istega naslova; zanašanje na pošiljatelja bi vse te dobavnice
 * pripisalo napačnemu partnerju.
 */
export async function dolociDobavitelja(
  db: Db,
  enotaId: number,
  dto: PrejemDTO,
  posiljatelj?: string | null,
  podanId?: number | null,
): Promise<DobaviteljIzid> {
  if (podanId) return { dobaviteljId: podanId, vir: 'PODAN', predlogNovega: null };

  // BOOKIE: shranjeni_kupci (ne partnerji), stolpec davcna_stevilka
  if (dto.dobaviteljDavcna) {
    const [p] = (await db.execute<{ id: number }>(sql`
      SELECT id FROM shranjeni_kupci
       WHERE enota_id = ${enotaId}
         AND regexp_replace(coalesce(davcna_stevilka,''), '\D', '', 'g')
             = ${dto.dobaviteljDavcna}
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: Number(p.id), vir: 'DAVCNA', predlogNovega: null };

    // Dobavitelj ni v šifrantu — samodejno ustvari
    return {
      dobaviteljId: null,
      vir: null,
      predlogNovega: { davcna: dto.dobaviteljDavcna, naziv: dto.dobaviteljNaziv },
    };
  }

  // Tuji dobavitelj — poišči po id_za_ddv (npr. DE123456789)
  if (dto.dobaviteljIdDdv) {
    const idDdvNorm = dto.dobaviteljIdDdv.replace(/\s/g, '').toUpperCase();
    const [p] = (await db.execute<{ id: number }>(sql`
      SELECT id FROM shranjeni_kupci
       WHERE enota_id = ${enotaId}
         AND upper(regexp_replace(coalesce(id_za_ddv,''), '\s', '', 'g'))
             = ${idDdvNorm}
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: Number(p.id), vir: 'DAVCNA', predlogNovega: null };

    // Ni v šifrantu — samodejno ustvari
    return {
      dobaviteljId: null,
      vir: null,
      predlogNovega: { davcna: idDdvNorm, naziv: dto.dobaviteljNaziv },
    };
  }

  // GLN: BOOKIE shranjeni_kupci nima gln stolpca — preskočimo

  if (posiljatelj) {
    const naslov = posiljatelj.toLowerCase();
    const domena = naslov.split('@')[1] ?? '';
    const [p] = (await db.execute<{ partner_id: number }>(sql`
      SELECT partner_id FROM partner_eposta
       WHERE enota_id = ${enotaId}
         AND (lower(naslov) = ${naslov} OR lower(domena) = ${domena})
       ORDER BY (naslov IS NOT NULL) DESC
       LIMIT 1
    `)).rows;
    if (p) return { dobaviteljId: Number(p.partner_id), vir: 'EPOSTA', predlogNovega: null };
  }

  return { dobaviteljId: null, vir: null, predlogNovega: null };
}

// =====================================================================
// Ustvarjanje osnutka prejemnice
// =====================================================================

export interface OsnutekIzid {
  prejemnicaId: number;
  uparjenih: number;
  dvomljivih: number;
  neuparjenih: number;
}

export async function ustvariOsnutek(
  db: Db,
  opts: {
    enotaId: number;
    sejaId: string;
    dobaviteljId: number;
    dto: PrejemDTO;
    uporabnikId: number;
  },
): Promise<OsnutekIzid> {
  const { enotaId, sejaId, dobaviteljId, dto, uporabnikId } = opts;

  if (imaBlokado(dto)) {
    throw new Error(
      'Dokument vsebuje blokirne napake in ga ni mogoče uvoziti. ' +
      'Preglejte napake seje.',
    );
  }

  const prejemnicaId = await db.transaction(async (tx) => {
    // Stevilka: YYNNNNNN — enako kot ročna prejemnica
    const year = dto.datumDokumenta
      ? Number(dto.datumDokumenta.slice(0, 4))
      : new Date().getFullYear();
    const yy = String(year).slice(-2);
    const [seq] = (await tx.execute<{ next: string }>(sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next
        FROM prejemnice
       WHERE stevilka LIKE ${`${yy}%`}
         AND LENGTH(stevilka) = 8
         AND enota_id = ${enotaId}
    `)).rows;
    const stevilka = `${yy}${String(Number(seq?.next ?? 1)).padStart(6, '0')}`;

    // BOOKIE stolpci: enota_id, dobavitelj_id, datum, vrsta_cen, opomba,
    // st_dokumenta, datum_dokumenta, uvoz_seja_id (dodani z migracijo 0009)
    const [glava] = (await tx.execute<{ id: number }>(sql`
      INSERT INTO prejemnice (
        enota_id, dobavitelj_id, datum,
        vrsta_cen, opomba, stevilka,
        st_dokumenta, datum_dokumenta, uvoz_seja_id)
      VALUES (
        ${enotaId}, ${dobaviteljId},
        ${dto.datumDokumenta ?? sql`CURRENT_DATE`},
        ${dto.ceneBruto ? 'bruto' : 'neto'},
        ${dto.stDokumenta ? `Uvoz: ${dto.stDokumenta}` : 'Uvoz'},
        ${stevilka},
        ${dto.stDokumenta ?? null}, ${dto.datumDokumenta ?? null}, ${sejaId})
      RETURNING id
    `)).rows;

    for (const p of dto.postavke) {
      // Cena na enoto: dokument navaja ceno paketa, prejemnica pa vodi
      // oboje. Delimo šele tu, da ostane izvorni zapis nedotaknjen.
      const enotVPaketu = p.enotVPaketu.gt(0) ? p.enotVPaketu : new Decimal(1);
      const cenaPaket = netoPoRabatih(p.izvCena, p.rabat1Odst, p.rabat2Odst);
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
          rabat_1_odst, rabat_2_odst, opozorila)
        VALUES (
          ${glava.id},
          ${kolicinaEnot.toString()}, ${cenaEnota.toString()},
          ${skupaj.toString()}, ${enotVPaketu.toString()},
          ${p.izvGtin ?? null}, ${p.izvSifra ?? null}, ${p.izvNaziv ?? null},
          ${p.izvEnota ?? null}, ${p.izvKolicina.toString()}, ${p.izvCena.toString()},
          ${p.rabat1Odst.toString()}, ${p.rabat2Odst.toString()},
          ${JSON.stringify(p.opozorila)}::jsonb)
      `);
    }

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

  const izid = await upariPrejemnico(db, enotaId, prejemnicaId);
  return { prejemnicaId, ...izid };
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
}

export async function uvozi(
  db: Db,
  v: ZajemVhod & { uporabnikId: number; posiljatelj?: string | null },
): Promise<UvoziIzid> {
  const zajem = await zajemi(db, v);

  if (zajem.status === 'PODVOJENO') {
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

  const dto = await razcleniSejo(db, zajem.sejaId);
  if (dto.napake.some((n) => n.resnost === 'B')) {
    return { sejaId: zajem.sejaId, format: zajem.format, status: 'NAPAKA', napake: dto.napake };
  }

  const dob = await dolociDobavitelja(
    db, v.enotaId, dto, v.posiljatelj, v.dobaviteljId,
  );

  const dobaviteljId = await resolveOrCreateDobavitelja(db, v.enotaId, dob, dto);
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
  });

  return {
    sejaId: zajem.sejaId,
    format: zajem.format,
    status: 'OSNUTEK_USTVARJEN',
    napake: dto.napake,
    ...osnutek,
  };
}
