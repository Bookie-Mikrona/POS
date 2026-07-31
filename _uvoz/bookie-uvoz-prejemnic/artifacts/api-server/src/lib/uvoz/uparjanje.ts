// artifacts/api-server/src/lib/uvoz/uparjanje.ts
//
// Uparjanje uvoženih postavk na artikle iz šifranta.
//
// Kaskada, prilagojena šifrantu BOOKIE:
//   1. GTIN                          — 100 %, ko bo polje napolnjeno
//   2. šifra dobavitelja (naučena)   — 100 %
//   3. podobnost naziva + cena       — 60–90 %, potrebna potrditev
//   4. brez zadetka                  — ročno
//
// Uparjajo se SAMO artikli tipa NABAVNI in NABAVNO_PRODAJNI. Artikli tipa
// PRODAJNI po definiciji šifranta niso na prejemnicah, kar hkrati močno
// zmanjša prostor kandidatov pri iskanju po nazivu.
//
// Trigramsko iskanje gre prek db.execute(sql`...`), ker Drizzle nima
// zapisa za operator % in funkcijo similarity() iz pg_trgm.

import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { gtinNorm } from './dto';

// Poizvedbe gredo dosledno prek db.execute(sql`...`), ne prek gradnika
// poizvedb. Razlog: stopnja 3 kaskade potrebuje similarity() in operator
// % iz pg_trgm, ki ju Drizzle ne pozna. Mešanje obeh pristopov v isti
// datoteki bi otežilo branje, hkrati pa bi uvoz sheme vezal to datoteko
// na paket lib/db in onemogočil samostojno preizkušanje.

// =====================================================================
// Tipi
// =====================================================================

export type UparjanjeMetoda =
  | 'GTIN'
  | 'SIFRA_DOBAVITELJA'
  | 'INTERNA_SIFRA'
  | 'PODOBNOST_NAZIVA'
  | 'ROCNO'
  | 'NOV_ARTIKEL';

export interface Kandidat {
  artikelId: number;
  sifra: string | null;
  naziv: string;
  osnovnaEnota: string | null;
  zadnjaCenaEnota: string | null;
  enotVPaketu: string | null;
  /** 0..1 */
  ocena: number;
  /** ali se artikel od tega dobavitelja že kupuje */
  znanDobavitelj: boolean;
}

export interface UparjanjeVhod {
  podjetjeId: number;
  dobaviteljId: number;
  gtin?: string | null;
  sifra?: string | null;
  naziv: string;
  /** cena na eno enoto — razsodnik pri ujemanju po nazivu */
  cenaNaEnoto?: Decimal | null;
}

export interface UparjanjeIzid {
  artikelId: number | null;
  metoda: UparjanjeMetoda | null;
  /** 0..100 */
  zaupanje: number;
  enotVPaketu: Decimal | null;
  kandidati: Kandidat[];
  /** ali sme sistem upariti brez človeka */
  samodejno: boolean;
}

export interface UparjanjeNastavitve {
  /** najnižja podobnost naziva, da se kandidat sploh ponudi */
  pragPodobnosti: number;
  /** najnižje zaupanje za samodejno uparjanje brez potrditve */
  pragSamodejnega: number;
  /** dovoljeno odstopanje cene, da cena potrdi ujemanje po nazivu */
  dovoljenoOdstopanjeCene: number;
}

export const PRIVZETE_NASTAVITVE: UparjanjeNastavitve = {
  pragPodobnosti: 0.55,
  pragSamodejnega: 90,
  dovoljenoOdstopanjeCene: 0.15,
};

type Db = PostgresJsDatabase<Record<string, unknown>>;

// =====================================================================
// Kaskada
// =====================================================================

export async function upariPostavko(
  db: Db,
  vhod: UparjanjeVhod,
  nastavitve: UparjanjeNastavitve = PRIVZETE_NASTAVITVE,
): Promise<UparjanjeIzid> {
  const gtin = gtinNorm(vhod.gtin ?? null);

  // ---- 1. GTIN ----------------------------------------------------
  if (gtin) {
    const vrstice = await db.execute<{
      artikel_id: number;
      enot_v_paketu: string | null;
    }>(sql`
      SELECT a.id AS artikel_id, ad.enot_v_paketu
        FROM artikli a
        LEFT JOIN artikel_dobavitelj ad
               ON ad.artikel_id = a.id
              AND ad.dobavitelj_id = ${vhod.dobaviteljId}
              AND ad.podjetje_id = ${vhod.podjetjeId}
       WHERE a.podjetje_id = ${vhod.podjetjeId}
         AND public.gtin_norm(a.gtin) = ${gtin}
       LIMIT 1
    `);
    if (vrstice.length) {
      return {
        artikelId: Number(vrstice[0].artikel_id),
        metoda: 'GTIN',
        zaupanje: 100,
        enotVPaketu: vrstice[0].enot_v_paketu
          ? new Decimal(vrstice[0].enot_v_paketu)
          : null,
        kandidati: [],
        samodejno: true,
      };
    }
  }

  // ---- 2. šifra dobavitelja (naučena preslikava) -------------------
  const sifra = vhod.sifra?.trim();
  if (sifra) {
    const zadetki = await db.execute<{
      artikel_id: number;
      enot_v_paketu: string;
    }>(sql`
      SELECT artikel_id, enot_v_paketu
        FROM artikel_dobavitelj
       WHERE podjetje_id = ${vhod.podjetjeId}
         AND dobavitelj_id = ${vhod.dobaviteljId}
         AND upper(btrim(sifra_dobavitelja)) = upper(btrim(${sifra}))
         AND aktivno
       LIMIT 1
    `);

    if (zadetki.length) {
      return {
        artikelId: Number(zadetki[0].artikel_id),
        metoda: 'SIFRA_DOBAVITELJA',
        zaupanje: 100,
        enotVPaketu: new Decimal(zadetki[0].enot_v_paketu),
        kandidati: [],
        samodejno: true,
      };
    }
  }

  // ---- 3. podobnost naziva ----------------------------------------
  const kandidati = await poisciKandidate(db, vhod, nastavitve);

  if (!kandidati.length) {
    return {
      artikelId: null, metoda: null, zaupanje: 0,
      enotVPaketu: null, kandidati: [], samodejno: false,
    };
  }

  const najboljsi = kandidati[0];
  const zaupanje = Math.round(najboljsi.ocena * 10000) / 100;

  // Cena je razsodnik. "Pivo svetlo 0,5 l" in "Pivo svetlo 0,33 l" se po
  // nazivu ujemata enako visoko kot pravilen zadetek s pripono pakiranja;
  // ločita ju samo ceni. Zato samodejno uparjanje zahteva OBOJE.
  const cenaPotrjuje = preveriCeno(
    vhod.cenaNaEnoto ?? null,
    najboljsi.zadnjaCenaEnota,
    nastavitve.dovoljenoOdstopanjeCene,
  );

  const samodejno = zaupanje >= nastavitve.pragSamodejnega && cenaPotrjuje === true;

  return {
    artikelId: najboljsi.artikelId,
    metoda: 'PODOBNOST_NAZIVA',
    zaupanje,
    enotVPaketu: najboljsi.enotVPaketu ? new Decimal(najboljsi.enotVPaketu) : null,
    kandidati,
    samodejno,
  };
}

/**
 * @returns true = cena potrjuje, false = cena nasprotuje,
 *          null = ni podatka za primerjavo (ne šteje kot potrditev)
 */
export function preveriCeno(
  nova: Decimal | null,
  zadnja: string | null,
  dovoljeno: number,
): boolean | null {
  if (!nova || !zadnja) return null;
  const z = new Decimal(zadnja);
  if (z.lte(0)) return null;
  return nova.minus(z).abs().div(z).lte(dovoljeno);
}

// =====================================================================
// Iskanje kandidatov (pg_trgm)
// =====================================================================

async function poisciKandidate(
  db: Db,
  vhod: UparjanjeVhod,
  n: UparjanjeNastavitve,
): Promise<Kandidat[]> {
  const cena = vhod.cenaNaEnoto ? vhod.cenaNaEnoto.toString() : null;

  // Tip vrstice navedemo posebej: db.execute vrne ovojnico, katere
  // element se ob .map() sicer izpelje kot any.
  type KandidatVrstica = {
    artikel_id: number;
    sifra: string | null;
    naziv: string;
    osnovna_enota: string | null;
    zadnja_cena_enota: string | null;
    enot_v_paketu: string | null;
    ocena: string;
    znan_dobavitelj: boolean;
  };

  const vrstice = await db.execute<KandidatVrstica>(sql`
    WITH iskano AS (
      SELECT public.naziv_norm(${vhod.naziv}) AS n
    ),
    kandidati AS (
      SELECT
        a.id                       AS artikel_id,
        a.sifra,
        a.naziv,
        a.osnovna_enota,
        ad.zadnja_cena_enota,
        ad.enot_v_paketu,
        (ad.id IS NOT NULL)        AS znan_dobavitelj,
        GREATEST(
          similarity(public.naziv_norm(a.naziv), i.n),
          COALESCE(MAX(similarity(ad2.naziv_norm, i.n)), 0)
        )                          AS sim
      FROM artikli a
      CROSS JOIN iskano i
      LEFT JOIN artikel_dobavitelj ad
             ON ad.artikel_id = a.id
            AND ad.dobavitelj_id = ${vhod.dobaviteljId}
            AND ad.podjetje_id = ${vhod.podjetjeId}
      LEFT JOIN artikel_dobavitelj ad2
             ON ad2.artikel_id = a.id
            AND ad2.podjetje_id = ${vhod.podjetjeId}
      WHERE a.podjetje_id = ${vhod.podjetjeId}
        AND a.aktiven
        -- artikli tipa PRODAJNI niso na prejemnicah
        AND a.tip IN ('NABAVNI', 'NABAVNO_PRODAJNI')
        AND (public.naziv_norm(a.naziv) % i.n OR ad2.naziv_norm % i.n)
      GROUP BY a.id, a.sifra, a.naziv, a.osnovna_enota,
               ad.id, ad.zadnja_cena_enota, ad.enot_v_paketu, i.n
    ),
    ocenjeni AS (
      SELECT k.*,
        LEAST(1.0, k.sim
          -- ujemanje številčnih vrednosti v nazivu (0.5, 1.5, 330)
          + CASE WHEN (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                       regexp_matches(public.naziv_norm(k.naziv), '(\\d+\\.?\\d*)', 'g') m)
                     = (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                       regexp_matches(public.naziv_norm(${vhod.naziv}), '(\\d+\\.?\\d*)', 'g') m)
                 THEN 0.10 ELSE 0 END
          -- artikel se od tega dobavitelja že kupuje
          + CASE WHEN k.znan_dobavitelj THEN 0.10 ELSE 0 END
          -- cena blizu zadnje nabavne
          + CASE WHEN ${cena}::numeric IS NOT NULL
                  AND k.zadnja_cena_enota IS NOT NULL
                  AND k.zadnja_cena_enota > 0
                  AND abs(${cena}::numeric - k.zadnja_cena_enota)
                      / k.zadnja_cena_enota < ${n.dovoljenoOdstopanjeCene}
                 THEN 0.05 ELSE 0 END
        ) AS ocena
      FROM kandidati k
    )
    SELECT artikel_id, sifra, naziv, osnovna_enota, zadnja_cena_enota,
           enot_v_paketu, znan_dobavitelj, round(ocena::numeric, 4) AS ocena
      FROM ocenjeni
     WHERE ocena >= ${n.pragPodobnosti}
     ORDER BY ocena DESC, znan_dobavitelj DESC
     LIMIT 5
  `);

  return (vrstice as unknown as KandidatVrstica[]).map((v) => ({
    artikelId: Number(v.artikel_id),
    sifra: v.sifra,
    naziv: v.naziv,
    osnovnaEnota: v.osnovna_enota,
    zadnjaCenaEnota: v.zadnja_cena_enota,
    enotVPaketu: v.enot_v_paketu,
    znanDobavitelj: v.znan_dobavitelj,
    ocena: Number(v.ocena),
  }));
}

// =====================================================================
// Učenje — ročna potrditev postane trajna preslikava
// =====================================================================

export interface PotrditevVhod {
  podjetjeId: number;
  dobaviteljId: number;
  artikelId: number;
  postavkaId: number;
  uporabnikId: number;
  enotVPaketu: Decimal;
  /** izvorni podatki iz dokumenta */
  izvSifra: string | null;
  izvGtin: string | null;
  izvNaziv: string | null;
  izvCena: Decimal | null;
  datumPrevzema: string;
  zapomni?: boolean;
}

export async function potrdiUparjanje(db: Db, v: PotrditevVhod): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE prejemnice_postavke
         SET artikel_id = ${v.artikelId},
             uparjanje = 'ROCNO',
             uparjanje_zaupanje = 100
       WHERE id = ${v.postavkaId}
    `);

    if (v.zapomni === false) return;

    const gtin = gtinNorm(v.izvGtin);
    const cena = v.izvCena ? v.izvCena.toString() : null;

    // ON CONFLICT po šifri dobavitelja; kadar šifre ni, po GTIN
    await tx.execute(sql`
      INSERT INTO artikel_dobavitelj (
        podjetje_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
        naziv_dobavitelja, enot_v_paketu, zadnja_cena_enota,
        zadnji_prevzem, st_prevzemov, potrdil_uporabnik, potrjeno_dne)
      VALUES (
        ${v.podjetjeId}, ${v.artikelId}, ${v.dobaviteljId},
        NULLIF(btrim(${v.izvSifra ?? ''}), ''), ${gtin},
        ${v.izvNaziv}, ${v.enotVPaketu.toString()}, ${cena},
        ${v.datumPrevzema}, 1, ${v.uporabnikId}, now())
      ON CONFLICT (podjetje_id, dobavitelj_id, sifra_dobavitelja)
        WHERE sifra_dobavitelja IS NOT NULL
      DO UPDATE SET
        artikel_id        = EXCLUDED.artikel_id,
        gtin              = COALESCE(EXCLUDED.gtin, artikel_dobavitelj.gtin),
        naziv_dobavitelja = EXCLUDED.naziv_dobavitelja,
        enot_v_paketu     = EXCLUDED.enot_v_paketu,
        zadnja_cena_enota = EXCLUDED.zadnja_cena_enota,
        zadnji_prevzem    = EXCLUDED.zadnji_prevzem,
        st_prevzemov      = artikel_dobavitelj.st_prevzemov + 1,
        potrdil_uporabnik = EXCLUDED.potrdil_uporabnik,
        potrjeno_dne      = now(),
        aktivno           = true
    `);

    // GTIN zapiši tudi na artikel, če ga še nima in če prestane kontrolo
    if (gtin) {
      await tx.execute(sql`
        UPDATE artikli
           SET gtin = ${gtin}
         WHERE id = ${v.artikelId}
           AND gtin IS NULL
           AND public.gtin_veljaven(${gtin})
      `);
    }

    await tx.execute(sql`
      INSERT INTO uvoz_dnevnik (podjetje_id, prejemnica_id, uporabnik_id,
                                dogodek, podrobnosti)
      SELECT ${v.podjetjeId}, pp.prejemnica_id, ${v.uporabnikId},
             'UPARJANJE_POTRJENO',
             jsonb_build_object('postavka_id', ${v.postavkaId},
                                'artikel_id', ${v.artikelId})
        FROM prejemnice_postavke pp WHERE pp.id = ${v.postavkaId}
    `);
  });
}

// =====================================================================
// Paketno uparjanje celotne prejemnice
// =====================================================================

export interface PaketniIzid {
  uparjenih: number;
  dvomljivih: number;
  neuparjenih: number;
}

export async function upariPrejemnico(
  db: Db,
  podjetjeId: number,
  prejemnicaId: number,
  nastavitve: UparjanjeNastavitve = PRIVZETE_NASTAVITVE,
): Promise<PaketniIzid> {
  const [glava] = await db.execute<{ dobavitelj_id: number; status: string }>(sql`
    SELECT dobavitelj_id, status FROM prejemnice WHERE id = ${prejemnicaId}
  `);
  if (!glava) throw new Error(`Prejemnica ${prejemnicaId} ne obstaja.`);

  const postavke = await db.execute<{
    id: number;
    izv_gtin: string | null;
    izv_sifra: string | null;
    izv_naziv: string | null;
    izv_cena: string | null;
    enot_v_paketu: string | null;
  }>(sql`
    SELECT id, izv_gtin, izv_sifra, izv_naziv, izv_cena, enot_v_paketu
      FROM prejemnice_postavke
     WHERE prejemnica_id = ${prejemnicaId} AND artikel_id IS NULL
     ORDER BY zap_st
  `);

  let uparjenih = 0;
  let dvomljivih = 0;
  let neuparjenih = 0;

  for (const p of postavke) {
    const enotVPaketu = p.enot_v_paketu ? new Decimal(p.enot_v_paketu) : new Decimal(1);
    const cenaNaEnoto =
      p.izv_cena && enotVPaketu.gt(0)
        ? new Decimal(p.izv_cena).div(enotVPaketu)
        : null;

    const izid = await upariPostavko(
      db,
      {
        podjetjeId,
        dobaviteljId: Number(glava.dobavitelj_id),
        gtin: p.izv_gtin,
        sifra: p.izv_sifra,
        naziv: p.izv_naziv ?? '',
        cenaNaEnoto,
      },
      nastavitve,
    );

    if (izid.samodejno && izid.artikelId) {
      await db.execute(sql`
        UPDATE prejemnice_postavke
           SET artikel_id = ${izid.artikelId},
               uparjanje = ${izid.metoda},
               uparjanje_zaupanje = ${izid.zaupanje},
               uparjanje_kandidati = ${JSON.stringify(izid.kandidati)}::jsonb
         WHERE id = ${p.id}
      `);
      uparjenih += 1;
    } else if (izid.kandidati.length) {
      await db.execute(sql`
        UPDATE prejemnice_postavke
           SET uparjanje_zaupanje = ${izid.zaupanje},
               uparjanje_kandidati = ${JSON.stringify(izid.kandidati)}::jsonb
         WHERE id = ${p.id}
      `);
      dvomljivih += 1;
    } else {
      neuparjenih += 1;
    }
  }

  await db.execute(sql`
    UPDATE prejemnice
       SET status = CASE
             WHEN EXISTS (SELECT 1 FROM prejemnice_postavke
                           WHERE prejemnica_id = ${prejemnicaId}
                             AND artikel_id IS NULL)
             THEN 'CAKA_NA_UPARJANJE' ELSE 'OSNUTEK' END
     WHERE id = ${prejemnicaId}
  `);

  return { uparjenih, dvomljivih, neuparjenih };
}
