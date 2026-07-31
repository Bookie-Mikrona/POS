// artifacts/api-server/src/lib/uvoz/cenik.ts
//
// Uvoz cenika dobavitelja.
//
// ZAKAJ JE TO PRVI KORAK PRI NOVEM DOBAVITELJU
// Brez preslikav je prva dobavnica skoraj v celoti ročna: 40 postavk,
// 40 odločitev. Cenik ima iste šifre in nazive kot dobavnice, zato en
// uvoz cenika napolni artikel_dobavitelj vnaprej in je prva dobavnica
// uparjena samodejno.
//
// Cenik NE spreminja zaloge in ne ustvarja prejemnice. Piše izključno
// v tabelo preslikav.

import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { gtinNorm, gtinVeljaven, normalizirajEnoto } from './dto';
import { dekodiraj, vDecimal, zaznajLocilo } from './parser-csv';
import { upariPostavko, type Kandidat, type UparjanjeNastavitve, PRIVZETE_NASTAVITVE } from './uparjanje';

type Db = PostgresJsDatabase<Record<string, unknown>>;

// =====================================================================
// Model vrstice cenika
// =====================================================================

export interface CenikVrstica {
  zap: number;
  sifra: string | null;
  gtin: string | null;
  naziv: string;
  enota: string | null;
  enotVPaketu: Decimal;
  cenaPaket: Decimal | null;
  cenaEnota: Decimal | null;
  ddvStopnja: Decimal | null;
}

export interface CenikProfil {
  kodiranje?: string;
  locilo?: string;
  decimalnoLocilo?: ',' | '.';
  glavaVsebuje?: string[];
  prvaVrsticaPodatkov?: number;
  list?: string;
  stolpci: {
    naziv: number;
    cena: number;
    sifra?: number;
    gtin?: number;
    enota?: number;
    enotVPaketu?: number;
    ddv?: number;
  };
}

// =====================================================================
// Razčlenitev
// =====================================================================

export function razcleniCenik(
  raw: Buffer,
  profil: CenikProfil,
  jeXlsx = false,
): { vrstice: CenikVrstica[]; napake: string[] } {
  const napake: string[] = [];
  let matrika: string[][];

  if (jeXlsx) {
    const wb = XLSX.read(raw, { type: 'buffer', cellDates: true });
    const imeLista = profil.list ?? wb.SheetNames[0];
    const ws = wb.Sheets[imeLista];
    if (!ws) return { vrstice: [], napake: [`Lista "${imeLista}" ni v datoteki.`] };
    // raw:false -> celice kot besedilo, sicer Excel poje vodilne ničle v GTIN
    matrika = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1, raw: false, defval: '', blankrows: true,
    });
  } else {
    const { besedilo } = dekodiraj(raw, profil.kodiranje);
    const locilo = profil.locilo ?? zaznajLocilo(besedilo);
    matrika = Papa.parse<string[]>(besedilo, {
      delimiter: locilo,
      skipEmptyLines: false,
      dynamicTyping: false,
    }).data;
  }

  // Iskanje glave po vsebini je zanesljivejše od fiksnega odmika —
  // dobavitelji radi dodajo uvodno vrstico brez obvestila.
  let prva = (profil.prvaVrsticaPodatkov ?? 2) - 1;
  const pricakovana = (profil.glavaVsebuje ?? []).map((s) => s.toLowerCase());
  if (pricakovana.length) {
    for (let i = 0; i < Math.min(matrika.length, 40); i++) {
      const z = matrika[i].join(' ').toLowerCase();
      if (pricakovana.every((p) => z.includes(p))) {
        prva = i + 1;
        break;
      }
    }
  }

  const s = profil.stolpci;
  const dec = profil.decimalnoLocilo;
  const vrstice: CenikVrstica[] = [];
  let zap = 0;

  for (let i = prva; i < matrika.length; i++) {
    const v = matrika[i];
    if (!v || !v.some((c) => String(c).trim())) continue;

    const naziv = String(v[s.naziv] ?? '').trim();
    if (!naziv) continue;

    const cena = vDecimal(v[s.cena], dec);
    if (cena.lte(0)) continue;

    zap += 1;

    let enotVPaketu = s.enotVPaketu !== undefined ? vDecimal(v[s.enotVPaketu], dec) : new Decimal(1);
    if (enotVPaketu.lte(0)) enotVPaketu = new Decimal(1);

    const surovGtin = s.gtin !== undefined ? v[s.gtin] : null;
    const gtin = gtinNorm(surovGtin);
    if (surovGtin && !gtin) {
      napake.push(`Vrstica ${i + 1}: črtna koda "${surovGtin}" je neuporabna.`);
    } else if (gtin && !gtinVeljaven(gtin)) {
      napake.push(`Vrstica ${i + 1}: črtna koda ${gtin} ne prestane kontrole.`);
    }

    vrstice.push({
      zap,
      sifra: s.sifra !== undefined ? (String(v[s.sifra] ?? '').trim() || null) : null,
      gtin: gtin && gtinVeljaven(gtin) ? gtin : null,
      naziv,
      enota: s.enota !== undefined
        ? (normalizirajEnoto(String(v[s.enota] ?? '')) ?? null) : null,
      enotVPaketu,
      cenaPaket: cena,
      cenaEnota: cena.div(enotVPaketu),
      ddvStopnja: s.ddv !== undefined ? vDecimal(v[s.ddv], dec) : null,
    });
  }

  if (!vrstice.length) napake.push('Cenik ne vsebuje nobene uporabne vrstice.');
  return { vrstice, napake };
}

// =====================================================================
// Predogled uparjanja
// =====================================================================

export interface CenikPredogledVrstica extends CenikVrstica {
  artikelId: number | null;
  artikelNaziv: string | null;
  metoda: string | null;
  zaupanje: number;
  samodejno: boolean;
  zeObstaja: boolean;
  kandidati: Kandidat[];
}

export interface CenikPredogled {
  vrstic: number;
  samodejno: number;
  zaPotrditev: number;
  brezZadetka: number;
  posodobitev: number;
  vrstice: CenikPredogledVrstica[];
  napake: string[];
}

/**
 * Predogled NE zapiše ničesar. Namenjen je temu, da uporabnik vidi,
 * koliko cenika se bo uparilo, preden se karkoli zgodi.
 *
 * Uvoz cenika brez predogleda je nevaren: napačna preslikava, ustvarjena
 * v svežnju, se tiho uporablja pri vseh naslednjih dobavnicah.
 */
export async function predogledCenika(
  db: Db,
  podjetjeId: number,
  dobaviteljId: number,
  vrstice: CenikVrstica[],
  nastavitve: UparjanjeNastavitve = PRIVZETE_NASTAVITVE,
): Promise<CenikPredogled> {
  const izid: CenikPredogledVrstica[] = [];
  let samodejno = 0;
  let zaPotrditev = 0;
  let brezZadetka = 0;
  let posodobitev = 0;

  for (const v of vrstice) {
    const u = await upariPostavko(
      db,
      {
        podjetjeId,
        dobaviteljId,
        gtin: v.gtin,
        sifra: v.sifra,
        naziv: v.naziv,
        cenaNaEnoto: v.cenaEnota,
      },
      nastavitve,
    );

    let artikelNaziv: string | null = null;
    let zeObstaja = false;

    if (u.artikelId) {
      const [a] = await db.execute<{ naziv: string }>(sql`
        SELECT naziv FROM artikli WHERE id = ${u.artikelId}
      `);
      artikelNaziv = a?.naziv ?? null;

      const [obst] = await db.execute<{ ena: number }>(sql`
        SELECT 1 AS ena FROM artikel_dobavitelj
         WHERE podjetje_id = ${podjetjeId}
           AND dobavitelj_id = ${dobaviteljId}
           AND artikel_id = ${u.artikelId}
         LIMIT 1
      `);
      zeObstaja = !!obst;
    }

    if (u.samodejno) {
      samodejno += 1;
      if (zeObstaja) posodobitev += 1;
    } else if (u.kandidati.length) zaPotrditev += 1;
    else brezZadetka += 1;

    izid.push({
      ...v,
      artikelId: u.artikelId,
      artikelNaziv,
      metoda: u.metoda,
      zaupanje: u.zaupanje,
      samodejno: u.samodejno,
      zeObstaja,
      kandidati: u.kandidati,
    });
  }

  return {
    vrstic: vrstice.length,
    samodejno,
    zaPotrditev,
    brezZadetka,
    posodobitev,
    vrstice: izid,
    napake: [],
  };
}

// =====================================================================
// Zapis preslikav
// =====================================================================

export interface CenikZapisIzid {
  ustvarjenih: number;
  posodobljenih: number;
  preskocenih: number;
}

export interface CenikZapisVrstica {
  artikelId: number;
  sifra: string | null;
  gtin: string | null;
  naziv: string;
  enota: string | null;
  enotVPaketu: Decimal;
  cenaEnota: Decimal | null;
  ddvStopnja: Decimal | null;
}

/**
 * Zapiše preslikave. Sprejme samo vrstice, ki jih je uporabnik potrdil
 * ali ki so bile uparjene samodejno — presoja o tem je v ruti, ne tu.
 *
 * Svežnji po 200 vrstic: na Replitu se dolg zahtevek pri Autoscale
 * objavi lahko prekine, cenik s 5.000 vrsticami pa ni redkost.
 */
export async function zapisiPreslikave(
  db: Db,
  podjetjeId: number,
  dobaviteljId: number,
  vrstice: CenikZapisVrstica[],
  uporabnikId: number,
  velikostSveznja = 200,
): Promise<CenikZapisIzid> {
  let ustvarjenih = 0;
  let posodobljenih = 0;
  let preskocenih = 0;

  for (let i = 0; i < vrstice.length; i += velikostSveznja) {
    const svezenj = vrstice.slice(i, i + velikostSveznja);

    await db.transaction(async (tx) => {
      for (const v of svezenj) {
        if (!v.sifra && !v.gtin) {
          // ck_ad_kljuc zahteva vsaj enega; brez obeh preslikave ni
          // mogoče uporabiti pri naslednji dobavnici.
          preskocenih += 1;
          continue;
        }

        const [r] = await tx.execute<{ je_nov: boolean }>(sql`
          INSERT INTO artikel_dobavitelj (
            podjetje_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
            naziv_dobavitelja, enot_v_paketu, zadnja_cena_enota,
            zadnja_ddv_stopnja, potrdil_uporabnik, potrjeno_dne)
          VALUES (
            ${podjetjeId}, ${v.artikelId}, ${dobaviteljId},
            ${v.sifra}, ${v.gtin}, ${v.naziv},
            ${v.enotVPaketu.toString()},
            ${v.cenaEnota?.toString() ?? null},
            ${v.ddvStopnja?.toString() ?? null},
            ${uporabnikId}, now())
          ON CONFLICT (podjetje_id, dobavitelj_id, sifra_dobavitelja)
            WHERE sifra_dobavitelja IS NOT NULL
          DO UPDATE SET
            artikel_id         = EXCLUDED.artikel_id,
            gtin               = COALESCE(EXCLUDED.gtin, artikel_dobavitelj.gtin),
            naziv_dobavitelja  = EXCLUDED.naziv_dobavitelja,
            enot_v_paketu      = EXCLUDED.enot_v_paketu,
            zadnja_cena_enota  = EXCLUDED.zadnja_cena_enota,
            zadnja_ddv_stopnja = EXCLUDED.zadnja_ddv_stopnja,
            aktivno            = true
          RETURNING (xmax = 0) AS je_nov
        `);

        if (r?.je_nov) ustvarjenih += 1;
        else posodobljenih += 1;

        // GTIN na artikel, če ga še nima. Ne prepisujemo obstoječega —
        // dobaviteljev cenik ni merodajen za artikel, ki ga že imamo.
        if (v.gtin) {
          await tx.execute(sql`
            UPDATE artikli SET gtin = ${v.gtin}
             WHERE id = ${v.artikelId}
               AND podjetje_id = ${podjetjeId}
               AND gtin IS NULL
               AND public.gtin_veljaven(${v.gtin})
          `);
        }

        // Nabavna stopnja DDV, če je artikel še nima.
        // Ta je LOČENA od prodajne davčne kategorije: kavna zrna se
        // kupijo po nižji stopnji, kava pri mizi se proda po višji.
        if (v.ddvStopnja) {
          await tx.execute(sql`
            UPDATE artikli SET nabavna_ddv_stopnja = ${v.ddvStopnja.toString()}
             WHERE id = ${v.artikelId}
               AND podjetje_id = ${podjetjeId}
               AND nabavna_ddv_stopnja IS NULL
          `);
        }
      }
    });
  }

  await db.execute(sql`
    INSERT INTO uvoz_dnevnik (podjetje_id, uporabnik_id, dogodek, podrobnosti)
    VALUES (${podjetjeId}, ${uporabnikId}, 'CENIK_UVOZEN',
            ${JSON.stringify({
              dobaviteljId, ustvarjenih, posodobljenih, preskocenih,
            })}::jsonb)
  `);

  return { ustvarjenih, posodobljenih, preskocenih };
}

// =====================================================================
// Zaznava oblike cenika
// =====================================================================

/**
 * Ceniki dobaviteljev nimajo standardne oblike. Ta funkcija ugane
 * preslikavo stolpcev iz vrstice glave, da uporabniku ni treba
 * začeti pri praznem obrazcu.
 *
 * Ugibanje je NAMENOMA razvidno v vmesniku — uporabnik potrdi ali
 * popravi. Tiho ugibanje bi pri ceniku pomenilo tiho napačne preslikave.
 *
 * Zakaj ocenjevanje in ne prvi zadetek: glava "Cena/pak" ustreza
 * vzorcu za ceno in za pakiranje hkrati. Pri prvem zadetku bi bila
 * dodelitev odvisna od vrstnega reda stolpcev. Zato se najprej oceni
 * vsak par stolpec–polje, nato se dodeli od najvišje ocene navzdol,
 * pri čemer se stolpec in polje porabita.
 */

type CenikPolje = keyof CenikProfil['stolpci'];

/** Vzorci z utežmi. Višja utež pomeni bolj zanesljivo ujemanje. */
const VZORCI: Record<CenikPolje, Array<[RegExp, number]>> = {
  sifra: [
    [/^(šifra|sifra|koda|id|art\.?\s*št\.?)$/i, 10],
    [/(šifra|sifra)\s*(artikla|izdelka)?/i, 8],
    [/\b(koda|code|sku)\b/i, 6],
  ],
  gtin: [
    [/^(ean|gtin|barcode)$/i, 10],
    [/\b(ean|gtin)\b/i, 9],
    [/(črtn|crtn|barcode|črtna\s*koda)/i, 8],
  ],
  naziv: [
    [/^(naziv|opis|artikel|izdelek|ime|name|description)$/i, 10],
    [/\b(naziv|opis|artikel|izdelek)\b/i, 8],
    [/\b(ime|name)\b/i, 5],
  ],
  enota: [
    [/^(em|me|enota|unit|uom)$/i, 10],
    [/\benota\s*mere\b/i, 9],
    [/\b(em|me)\b/i, 6],
  ],
  enotVPaketu: [
    [/^(pakiranje|pak|kos\/pak|v\s*paketu)$/i, 10],
    [/(kos|kom|enot)[^a-z]*(v|na|\/)[^a-z]*pak/i, 9],
    [/\bpakir/i, 7],
    [/\bpak\b/i, 5],
  ],
  cena: [
    [/^(cena|price|vrednost)$/i, 10],
    [/\bcena\b/i, 8],
    [/\bprice\b/i, 7],
    [/\bvrednost\b/i, 5],
  ],
  ddv: [
    [/^(ddv|vat|davek)$/i, 10],
    [/\bddv\b/i, 9],
    [/\b(vat|davek)\b/i, 7],
    [/\bstopnja\b/i, 5],
  ],
};

export function ugibajStolpce(glava: string[]): Partial<CenikProfil['stolpci']> {
  const ocene: Array<{ polje: CenikPolje; stolpec: number; ocena: number }> = [];

  glava.forEach((celica, i) => {
    const c = String(celica ?? '')
      .toLowerCase()
      .replace(/[_\-.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!c) return;

    for (const [polje, vzorci] of Object.entries(VZORCI) as Array<
      [CenikPolje, Array<[RegExp, number]>]
    >) {
      let najvisja = 0;
      for (const [vzorec, utez] of vzorci) {
        if (vzorec.test(c)) najvisja = Math.max(najvisja, utez);
      }
      if (najvisja > 0) ocene.push({ polje, stolpec: i, ocena: najvisja });
    }
  });

  ocene.sort((a, b) => b.ocena - a.ocena || a.stolpec - b.stolpec);

  const izid: Partial<CenikProfil['stolpci']> = {};
  const porabljeniStolpci = new Set<number>();
  const porabljenaPolja = new Set<CenikPolje>();

  for (const o of ocene) {
    if (porabljeniStolpci.has(o.stolpec) || porabljenaPolja.has(o.polje)) continue;
    izid[o.polje] = o.stolpec;
    porabljeniStolpci.add(o.stolpec);
    porabljenaPolja.add(o.polje);
  }

  return izid;
}
