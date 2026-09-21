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
// Uparjajo se SAMO običajni vhodni artikli tipa NABAVNI in
// NABAVNO_PRODAJNI. Povratna embalaža in samo PRODAJNI artikli imajo
// ločene poslovne tokove in ne smejo biti kandidati za vhodno postavko.
//
// Trigramsko iskanje gre prek db.execute(sql`...`), ker Drizzle nima
// zapisa za operator % in funkcijo similarity() iz pg_trgm.

import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { gtinNorm, netoPoRabatih, normalizirajNaziv } from './dto';
import {
  normalizirajNazivZaUparjanje,
  podobnostNormaliziranihNazivov,
} from './pametno-uparjanje';
import { expectedPurchaseVatRateForArticle } from './vat-code-resolver';

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
  /** false = artikel je deaktiviran; prikazan z opozorilom, a še vedno izbirljiv */
  aktiven: boolean;
  /** AI je kandidat predlagal za ročno potrditev; nikoli ne sproži samodejnega uparjanja. */
  aiPredlog?: boolean;
  aiRazlog?: string;
}

export interface UparjanjeVhod {
  enotaId: number;
  dobaviteljId: string;
  gtin?: string | null;
  sifra?: string | null;
  naziv: string;
  /** cena na eno enoto — razsodnik pri ujemanju po nazivu */
  cenaNaEnoto?: Decimal | null;
  /** true = kandidati so samo artikli povratne embalaže */
  povratnaEmbalaza?: boolean;
}

export function opozorilaVsebujejoKodo(opozorila: unknown, koda: string): boolean {
  let seznam: unknown = opozorila;
  if (typeof seznam === 'string') {
    try {
      seznam = JSON.parse(seznam);
    } catch {
      return false;
    }
  }
  return Array.isArray(seznam) && seznam.some((opozorilo: unknown) => (
    typeof opozorilo === 'object'
    && opozorilo !== null
    && 'koda' in opozorilo
    && opozorilo.koda === koda
  ));
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
    const { rows: vrstice } = await db.execute<{
      artikel_id: number;
      enot_v_paketu: string | null;
    }>(sql`
      SELECT a.id AS artikel_id, ad.enot_v_paketu
        FROM artikli a
        LEFT JOIN artikel_dobavitelj ad
               ON ad.artikel_id = a.id
              AND ad.dobavitelj_id = ${vhod.dobaviteljId}
              AND ad.enota_id = ${vhod.enotaId}
       WHERE a.enota_id = ${vhod.enotaId}
         AND a.nabavni_artikel
         AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
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
    const { rows: zadetki } = await db.execute<{
      artikel_id: number;
      enot_v_paketu: string;
    }>(sql`
      SELECT ad.artikel_id, ad.enot_v_paketu
        FROM artikel_dobavitelj ad
        JOIN artikli a ON a.id = ad.artikel_id
       WHERE ad.enota_id = ${vhod.enotaId}
         AND ad.dobavitelj_id = ${vhod.dobaviteljId}
         AND upper(btrim(ad.sifra_dobavitelja)) = upper(btrim(${sifra}))
         AND ad.aktivno
         AND a.nabavni_artikel
          AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
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

  // ---- 2.5 naučena preslikava po nazivu dobavitelja ------------------
  // Kadar dokument nima šifre/GTINa, a smo že enkrat ročno uparili
  // ta naziv tega dobavitelja → zaupamo preslikavi 100 %.
  if (vhod.naziv?.trim()) {
    const nazivNorm = normalizirajNazivZaUparjanje(vhod.naziv);
    const { rows: zadetki } = await db.execute<{
      artikel_id: number;
      enot_v_paketu: string;
    }>(sql`
      SELECT ad.artikel_id, ad.enot_v_paketu
        FROM artikel_dobavitelj ad
        JOIN artikli a ON a.id = ad.artikel_id
       WHERE ad.enota_id       = ${vhod.enotaId}
         AND ad.dobavitelj_id  = ${vhod.dobaviteljId}
         AND ad.naziv_norm     = ${nazivNorm}
         AND ad.sifra_dobavitelja IS NULL
         AND ad.gtin IS NULL
         AND ad.aktivno
         AND a.nabavni_artikel
          AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
       LIMIT 1
    `);

    if (zadetki.length) {
      return {
        artikelId: Number(zadetki[0].artikel_id),
        metoda: 'PODOBNOST_NAZIVA',
        zaupanje: 100,
        enotVPaketu: new Decimal(zadetki[0].enot_v_paketu),
        kandidati: [],
        samodejno: true,
      };
    }
  }

  // ---- 2.75 natančno ime artikla --------------------------------------
  // AI-predlog je lahko upravičeno ročen, natančno kanonično ujemanje
  // nabavnega artikla v isti enoti pa je deterministično. Dvojnikov ne
  // uparjamo samodejno, saj uporabnik mora izbrati pravega.
  if (vhod.naziv?.trim()) {
    const { rows: natancniZadetki } = await db.execute<{ artikel_id: number }>(sql`
      SELECT a.id AS artikel_id
        FROM artikli a
       WHERE a.enota_id = ${vhod.enotaId}
         AND a.nabavni_artikel
          AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
         AND (
           public.naziv_norm(a.ime) = public.naziv_norm(${vhod.naziv})
           OR public.naziv_norm(COALESCE(a.ime_za_nabavo, '')) = public.naziv_norm(${vhod.naziv})
         )
       ORDER BY a.id
       LIMIT 2
    `);
    if (natancniZadetki.length === 1) {
      return {
        artikelId: Number(natancniZadetki[0].artikel_id),
        metoda: 'PODOBNOST_NAZIVA',
        zaupanje: 100,
        enotVPaketu: null,
        kandidati: [],
        samodejno: true,
      };
    }
  }

  // ---- 3. podobnost naziva ----------------------------------------
  const sirsiKandidati = await poisciKandidate(db, vhod, nastavitve);
  const lokalniKandidati = sirsiKandidati
    .filter(kandidat => kandidat.ocena >= nastavitve.pragPodobnosti)
    .slice(0, 5);

  // Za ročno izbiro širše pokažemo še šibkejše podobne zadetke, vendar
  // dosledno samo nabavne in nabavno-prodajne artikle. Ta nabor se nikoli
  // ne uporabi brez uporabnikove potrditve.
  if (lokalniKandidati.length === 0) {
    const rocniKandidati = await poisciRocneKandidate(db, vhod);
    if (rocniKandidati.length > 0) {
      return {
        artikelId: rocniKandidati[0].artikelId,
        metoda: 'PODOBNOST_NAZIVA',
        zaupanje: Math.round(rocniKandidati[0].ocena * 10000) / 100,
        enotVPaketu: rocniKandidati[0].enotVPaketu
          ? new Decimal(rocniKandidati[0].enotVPaketu)
          : null,
        kandidati: rocniKandidati,
        samodejno: false,
      };
    }
  }

  // Uvoz ne čaka na dodaten modelski klic za vsako dvomljivo vrstico.
  // AI-predlog se zaradi varnosti nikoli ni uporabil za samodejno povezavo,
  // zato bi tukaj samo podaljšal stanje »Prepoznavam«. Deterministični
  // kandidati ostanejo prikazani za ročno potrditev.
  const kandidati = lokalniKandidati;

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

  // cenaPotrjuje === null = ni podatka za primerjavo (prvi uvoz, brez cene).
  // En sam kandidat na vrhu brez cenovnega nasprotja → avto-uparjanje je varno.
  // cenaPotrjuje === false = cena nasprotuje → zahteva ročno potrditev.
  //
  // jasnoNajboljsi: najboljši zadetek je JASNO boljši od drugega (ocena 2. < 70 %
  // ocene 1.). Npr. 100 % vs 56 % → varno samodejno; 80 % vs 76 % → zahteva ceno.
  //
  // Pri nabavnih artiklih zastavica aktiven določa prodajno razpoložljivost
  // in ne sme vplivati na prejemnice. Primerjamo vse nabavne kandidate.
  const drugiKandidatOcena = kandidati[1]?.ocena ?? 0;
  const jasnoNajboljsi =
    kandidati.length <= 1 ||
    drugiKandidatOcena < najboljsi.ocena * 0.70;

  const samodejno =
    zaupanje >= nastavitve.pragSamodejnega &&
    !najboljsi.aiPredlog &&
    cenaPotrjuje !== false &&
    (cenaPotrjuje === true || jasnoNajboljsi);

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
    aktiven: boolean;
  };

  const { rows: vrstice } = await db.execute<KandidatVrstica>(sql`
    WITH iskano AS (
      SELECT public.naziv_norm(${vhod.naziv}) AS n
    ),
    kandidati AS (
      SELECT
        a.id                       AS artikel_id,
        NULL::text                 AS sifra,
        a.ime                      AS naziv,
        a.enota_mere               AS osnovna_enota,
        ad.zadnja_cena_enota,
        ad.enot_v_paketu,
        (ad.znan_dobavitelj IS TRUE) AS znan_dobavitelj,
        a.aktiven                  AS aktiven,
        -- Uporabimo GREATEST vseh treh mer:
        --   similarity()           = simetrična (kaznuje dolge nazive)
        --   word_similarity(a→b)   = koliko šifranta je vsebovanega v dobavnici
        --   word_similarity(b→a)   = koliko dobavnice je vsebovane v šifrantu
        -- To pokriva tako krajše kot daljše nazive na dobavnici.
        -- ad2 zajame vse naučene nazive tega artikla (ne samo od tega dobavitelja).
        GREATEST(
          similarity(public.naziv_norm(a.ime), i.n),
          word_similarity(public.naziv_norm(a.ime), i.n),
          word_similarity(i.n, public.naziv_norm(a.ime)),
          COALESCE(MAX(ad2.sim_fwd), 0),
          COALESCE(MAX(ad2.sim_wrd_fwd), 0),
          COALESCE(MAX(ad2.sim_wrd_rev), 0)
        )                          AS sim
      FROM artikli a
      CROSS JOIN iskano i
      -- LATERAL: vzamemo samo eno (najnovejšo) vrstico za tega dobavitelja,
      -- da preprečimo podvajanje artiklov, ko ima artikel_dobavitelj več vrstic
      -- za isti par (artikel_id, dobavitelj_id) z različnimi naučenimi nazivi.
      LEFT JOIN LATERAL (
        SELECT
          ad1.zadnja_cena_enota,
          ad1.enot_v_paketu,
          TRUE AS znan_dobavitelj
        FROM artikel_dobavitelj ad1
        WHERE ad1.artikel_id    = a.id
          AND ad1.dobavitelj_id = ${vhod.dobaviteljId}
          AND ad1.enota_id      = ${vhod.enotaId}
          AND ad1.aktivno
        ORDER BY ad1.zadnji_prevzem DESC NULLS LAST, ad1.id DESC
        LIMIT 1
      ) ad ON TRUE
      -- ad2: vsi naučeni nazivi tega artikla (za uparjanje prek naučenih preslikav)
      LEFT JOIN LATERAL (
        SELECT
          similarity(ad2r.naziv_norm, i.n)      AS sim_fwd,
          word_similarity(ad2r.naziv_norm, i.n) AS sim_wrd_fwd,
          word_similarity(i.n, ad2r.naziv_norm) AS sim_wrd_rev
        FROM artikel_dobavitelj ad2r
        WHERE ad2r.artikel_id = a.id
          AND ad2r.enota_id   = ${vhod.enotaId}
          AND ad2r.naziv_norm IS NOT NULL
          AND (ad2r.naziv_norm % i.n OR ad2r.naziv_norm <% i.n OR i.n <% ad2r.naziv_norm)
      ) ad2 ON TRUE
      WHERE a.enota_id = ${vhod.enotaId}
        -- BOOKIE: nabavni artikli imajo nabavni_artikel = TRUE
        -- Neaktivni artikli se vključijo, a dobijo opozorilo v UI
        AND a.nabavni_artikel = TRUE
        AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
      GROUP BY a.id, a.ime, a.enota_mere, a.aktiven,
               ad.zadnja_cena_enota, ad.enot_v_paketu, ad.znan_dobavitelj, i.n
    ),
    ocenjeni AS (
      SELECT k.*,
        LEAST(1.0, k.sim
          -- ujemanje številčnih vrednosti v nazivu (0.5, 1.5, 330)
          -- +0.10 ko se ujemata, -0.08 ko OBE imeni vsebujeta števila ki se ne ujemajo
          -- (npr. "Servirni sladkor 1kg" vs dobavnica "3,6 kg" → kazen)
          + CASE
              WHEN (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                         regexp_matches(public.naziv_norm(k.naziv), '(\\d+\\.?\\d*)', 'g') m)
                   = (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                         regexp_matches(public.naziv_norm(${vhod.naziv}), '(\\d+\\.?\\d*)', 'g') m)
              THEN 0.10
              WHEN EXISTS (SELECT 1 FROM regexp_matches(public.naziv_norm(k.naziv),       '(\\d+\\.?\\d*)', 'g'))
               AND EXISTS (SELECT 1 FROM regexp_matches(public.naziv_norm(${vhod.naziv}), '(\\d+\\.?\\d*)', 'g'))
              THEN -0.08
              ELSE 0
            END
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
    SELECT artikel_id, sifra, naziv, osnovna_enota AS osnovna_enota, zadnja_cena_enota,
           enot_v_paketu, znan_dobavitelj, aktiven, round(ocena::numeric, 4) AS ocena
      FROM ocenjeni
     ORDER BY ocena DESC, znan_dobavitelj DESC
     LIMIT 20
  `);

  return (vrstice as unknown as KandidatVrstica[])
    .map((v) => ({
      artikelId: Number(v.artikel_id),
      sifra: v.sifra,
      naziv: v.naziv,
      osnovnaEnota: v.osnovna_enota,
      zadnjaCenaEnota: v.zadnja_cena_enota,
      enotVPaketu: v.enot_v_paketu,
      znanDobavitelj: v.znan_dobavitelj,
      aktiven: Boolean(v.aktiven),
      ocena: Math.max(Number(v.ocena), podobnostNormaliziranihNazivov(vhod.naziv, v.naziv)),
    }))
    .sort((a, b) =>
      b.ocena - a.ocena ||
      Number(b.znanDobavitelj) - Number(a.znanDobavitelj)
    );
}

/**
 * Pomoč pri prvem ročnem uparjanju: pokaže šibkejše nazivno podobne nabavne
 * zadetke iz iste enote. Rezultat se nikoli ne uporabi brez uporabnikove
 * potrditve.
 */
async function poisciRocneKandidate(db: Db, vhod: UparjanjeVhod): Promise<Kandidat[]> {
  type KandidatVrstica = {
    artikel_id: number;
    sifra: string | null;
    naziv: string;
    osnovna_enota: string | null;
    zadnja_cena_enota: string | null;
    enot_v_paketu: string | null;
    ocena: string;
    znan_dobavitelj: boolean;
    aktiven: boolean;
  };

  const { rows: vrstice } = await db.execute<KandidatVrstica>(sql`
    WITH iskano AS (
      SELECT public.naziv_norm(${vhod.naziv}) AS n
    )
    SELECT
      a.id AS artikel_id,
      NULL::text AS sifra,
      a.ime AS naziv,
      a.enota_mere AS osnovna_enota,
      NULL::numeric AS zadnja_cena_enota,
      NULL::numeric AS enot_v_paketu,
      GREATEST(
        similarity(public.naziv_norm(a.ime), i.n),
        word_similarity(public.naziv_norm(a.ime), i.n),
        word_similarity(i.n, public.naziv_norm(a.ime))
      ) AS ocena,
      FALSE AS znan_dobavitelj,
      a.aktiven AS aktiven
    FROM artikli a
    CROSS JOIN iskano i
    WHERE a.enota_id = ${vhod.enotaId}
      AND a.nabavni_artikel
      AND a.povratna_embalaza = ${!!vhod.povratnaEmbalaza}
    ORDER BY ocena DESC, a.ime ASC
    LIMIT 20
  `);

  return (vrstice as unknown as KandidatVrstica[])
    .map((v) => ({
      artikelId: Number(v.artikel_id),
      sifra: v.sifra,
      naziv: v.naziv,
      osnovnaEnota: v.osnovna_enota,
      zadnjaCenaEnota: v.zadnja_cena_enota,
      enotVPaketu: v.enot_v_paketu,
      znanDobavitelj: v.znan_dobavitelj,
      aktiven: Boolean(v.aktiven),
      ocena: Math.max(Number(v.ocena), podobnostNormaliziranihNazivov(vhod.naziv, v.naziv)),
    }))
    .filter(kandidat => kandidat.ocena >= 0.25)
    .slice(0, 5);
}

// =====================================================================
// Učenje — ročna potrditev postane trajna preslikava
// =====================================================================

export interface PotrditevVhod {
  enotaId: number;
  dobaviteljId: string;
  artikelId: number;
  postavkaId: number;
  uporabnikId: number;
  enotVPaketu: Decimal;
  /** izvorni podatki iz dokumenta */
  izvSifra: string | null;
  izvGtin: string | null;
  izvNaziv: string | null;
  izvCena: Decimal | null;
  /** enota iz dobavnice (npr. 'KOM', 'l') — za dopolnitev artikla, ki jo nima */
  izvEnota?: string | null;
  datumPrevzema: string;
  zapomni?: boolean;
}

async function uskladiDdvPostavkeZArtiklom(
  db: Db,
  postavkaId: number,
  artikelId: number,
): Promise<void> {
  const [artikel] = (await db.execute<{
    nabavna_ddv_stopnja: string | null;
    tax_category: string | null;
    added_sugar: boolean | null;
  }>(sql`
    SELECT nabavna_ddv_stopnja, tax_category, added_sugar
      FROM artikli
     WHERE id = ${artikelId}
     LIMIT 1
  `)).rows;
  if (!artikel) return;

  const stopnja = expectedPurchaseVatRateForArticle(
    artikel.nabavna_ddv_stopnja,
    artikel.tax_category,
    artikel.added_sugar,
  );
  if (!stopnja) return;

  const koda = `P${new Decimal(stopnja).toString().replace('.', '')}`;
  const [vatCode] = (await db.execute<{ id: string }>(sql`
    SELECT vc.id
      FROM vat_code vc
      JOIN prejemnice_postavke pp ON pp.id = ${postavkaId}
      JOIN prejemnice p ON p.id = pp.prejemnica_id
     WHERE vc.direction = 'IN'
       AND upper(vc.code) = ${koda}
       AND vc.valid_from <= p.datum
       AND (vc.valid_to IS NULL OR vc.valid_to >= p.datum)
     LIMIT 1
  `)).rows;

  await db.execute(sql`
    UPDATE prejemnice_postavke
       SET ddv_stopnja = ${stopnja},
           ddv_znesek = round(
             COALESCE(ddv_osnova, neto_znesek, skupaj, 0) * ${stopnja}::numeric / 100,
             2
           ),
           vat_code_id = ${vatCode?.id ?? null},
           opozorila = CASE
             WHEN ${vatCode?.id ?? null}::uuid IS NULL THEN opozorila
             ELSE COALESCE((
               SELECT jsonb_agg(opozorilo)
                 FROM jsonb_array_elements(COALESCE(opozorila::jsonb, '[]'::jsonb)) AS opozorilo
                WHERE opozorilo->>'koda' <> 'DDV021'
             ), '[]'::jsonb)::text
           END
     WHERE id = ${postavkaId}
  `);
}

export async function potrdiUparjanje(db: Db, v: PotrditevVhod): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE prejemnice_postavke
         SET artikel_id = ${v.artikelId},
             enot_v_paketu = ${v.enotVPaketu.toString()},
             uparjanje = 'ROCNO',
             uparjanje_zaupanje = 100
       WHERE id = ${v.postavkaId}
    `);
    await uskladiDdvPostavkeZArtiklom(tx, v.postavkaId, v.artikelId);

    if (v.zapomni === false) return;

    const gtin = gtinNorm(v.izvGtin);
    const sifraTrimmed = v.izvSifra?.trim() || null;

    const nazivTrimmed = v.izvNaziv?.trim() || null;
    const nazivNorm = normalizirajNazivZaUparjanje(nazivTrimmed);

    // Brez šifre, GTINa in naziva ne moremo ustvariti preslikave.
    if (!sifraTrimmed && !gtin && !nazivTrimmed) return;
    const cena = v.izvCena ? v.izvCena.toString() : null;

    if (sifraTrimmed) {
      // ---- Veja A: conflict po šifri dobavitelja --------------------
      await tx.execute(sql`
        INSERT INTO artikel_dobavitelj (
          enota_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
          naziv_dobavitelja, naziv_norm, enot_v_paketu, zadnja_cena_enota,
          zadnji_prevzem, st_prevzemov, potrdil_uporabnik, potrjeno_dne)
        VALUES (
          ${v.enotaId}, ${v.artikelId}, ${v.dobaviteljId},
          ${sifraTrimmed}, ${gtin},
          ${nazivTrimmed}, ${nazivNorm}, ${v.enotVPaketu.toString()}, ${cena},
          ${v.datumPrevzema}, 1, ${v.uporabnikId}, now())
        ON CONFLICT (enota_id, dobavitelj_id, sifra_dobavitelja)
          WHERE sifra_dobavitelja IS NOT NULL
        DO UPDATE SET
          artikel_id        = EXCLUDED.artikel_id,
          gtin              = COALESCE(EXCLUDED.gtin, artikel_dobavitelj.gtin),
          naziv_dobavitelja = EXCLUDED.naziv_dobavitelja,
          naziv_norm        = EXCLUDED.naziv_norm,
          enot_v_paketu     = EXCLUDED.enot_v_paketu,
          zadnja_cena_enota = EXCLUDED.zadnja_cena_enota,
          zadnji_prevzem    = EXCLUDED.zadnji_prevzem,
          st_prevzemov      = artikel_dobavitelj.st_prevzemov + 1,
          potrdil_uporabnik = EXCLUDED.potrdil_uporabnik,
          potrjeno_dne      = now(),
          aktivno           = true
      `);
    } else if (gtin) {
      // ---- Veja B: conflict po GTIN ---------------------------------
      await tx.execute(sql`
        INSERT INTO artikel_dobavitelj (
          enota_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
          naziv_dobavitelja, naziv_norm, enot_v_paketu, zadnja_cena_enota,
          zadnji_prevzem, st_prevzemov, potrdil_uporabnik, potrjeno_dne)
        VALUES (
          ${v.enotaId}, ${v.artikelId}, ${v.dobaviteljId},
          NULL, ${gtin},
          ${nazivTrimmed}, ${nazivNorm}, ${v.enotVPaketu.toString()}, ${cena},
          ${v.datumPrevzema}, 1, ${v.uporabnikId}, now())
        ON CONFLICT (enota_id, dobavitelj_id, gtin)
          WHERE gtin IS NOT NULL
        DO UPDATE SET
          artikel_id        = EXCLUDED.artikel_id,
          naziv_dobavitelja = COALESCE(EXCLUDED.naziv_dobavitelja, artikel_dobavitelj.naziv_dobavitelja),
          naziv_norm        = COALESCE(EXCLUDED.naziv_norm, artikel_dobavitelj.naziv_norm),
          enot_v_paketu     = EXCLUDED.enot_v_paketu,
          zadnja_cena_enota = EXCLUDED.zadnja_cena_enota,
          zadnji_prevzem    = EXCLUDED.zadnji_prevzem,
          st_prevzemov      = artikel_dobavitelj.st_prevzemov + 1,
          potrdil_uporabnik = EXCLUDED.potrdil_uporabnik,
          potrjeno_dne      = now(),
          aktivno           = true
      `);
    } else {
      // ---- Veja C: dobavitelj + kanonični naziv -------------------------
      // Naziv ni globalni ključ. Znotraj iste enote in dobavitelja pa je
      // ročno potrjena preslikava dovolj natančna in mora preživeti izbris
      // izvorne dobavnice.
      await tx.execute(sql`
        INSERT INTO artikel_dobavitelj (
          enota_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
          naziv_dobavitelja, naziv_norm, enot_v_paketu, zadnja_cena_enota,
          zadnji_prevzem, st_prevzemov, potrdil_uporabnik, potrjeno_dne)
        VALUES (
          ${v.enotaId}, ${v.artikelId}, ${v.dobaviteljId},
          NULL, NULL,
          ${nazivTrimmed}, ${nazivNorm}, ${v.enotVPaketu.toString()}, ${cena},
          ${v.datumPrevzema}, 1, ${v.uporabnikId}, now())
        ON CONFLICT (enota_id, dobavitelj_id, naziv_norm)
          WHERE sifra_dobavitelja IS NULL AND gtin IS NULL AND naziv_norm IS NOT NULL
        DO UPDATE SET
          artikel_id        = EXCLUDED.artikel_id,
          naziv_dobavitelja = EXCLUDED.naziv_dobavitelja,
          enot_v_paketu     = EXCLUDED.enot_v_paketu,
          zadnja_cena_enota = EXCLUDED.zadnja_cena_enota,
          zadnji_prevzem    = EXCLUDED.zadnji_prevzem,
          st_prevzemov      = artikel_dobavitelj.st_prevzemov + 1,
          potrdil_uporabnik = EXCLUDED.potrdil_uporabnik,
          potrjeno_dne      = now(),
          aktivno           = true
      `);
    }

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

    // Enoto mere zapiši na artikel, če je manjka — ne prepisujemo obstoječe.
    const izvEnotaNorm = v.izvEnota ? v.izvEnota.trim().toLowerCase() : null;
    if (izvEnotaNorm) {
      await tx.execute(sql`
        UPDATE artikli
           SET enota_mere = ${izvEnotaNorm}
         WHERE id = ${v.artikelId}
           AND enota_mere IS NULL
      `);
    }
  });

  // Revizijski zapis je neblokirna operacija — napaka tu ne sme razveljaviti uparjanja.
  try {
    await db.execute(sql`
      INSERT INTO uvoz_dnevnik (enota_id, prejemnica_id, uporabnik_id,
                                dogodek, podrobnosti)
      SELECT ${v.enotaId}, pp.prejemnica_id, ${v.uporabnikId},
             'UPARJANJE_POTRJENO',
             jsonb_build_object('postavka_id', ${v.postavkaId}::bigint,
                                'artikel_id', ${v.artikelId}::bigint)
        FROM prejemnice_postavke pp WHERE pp.id = ${v.postavkaId}
    `);
  } catch (logErr) {
    // Ne re-throwamo — glavno uparjanje je že committed.
    console.warn('[uvoz] uvoz_dnevnik INSERT spodletel:', logErr);
  }
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
  enotaId: number,
  prejemnicaId: number,
  nastavitve: UparjanjeNastavitve = PRIVZETE_NASTAVITVE,
): Promise<PaketniIzid> {
  const [glava] = (await db.execute<{ dobavitelj_id: string }>(sql`
    SELECT dobavitelj_id FROM prejemnice WHERE id = ${prejemnicaId}
  `)).rows;
  if (!glava) throw new Error(`Prejemnica ${prejemnicaId} ne obstaja.`);

  const { rows: postavke } = await db.execute<{
    id: number;
    izv_gtin: string | null;
    izv_sifra: string | null;
    izv_naziv: string | null;
    izv_cena: string | null;
    izv_kolicina: string | null;
    izv_enota: string | null;
    rabat_1_odst: string | null;
    rabat_2_odst: string | null;
    enot_v_paketu: string | null;
    opozorila: unknown;
  }>(sql`
    SELECT id, izv_gtin, izv_sifra, izv_naziv, izv_cena,
           izv_kolicina, izv_enota, rabat_1_odst, rabat_2_odst, enot_v_paketu,
           opozorila
      FROM prejemnice_postavke
     WHERE prejemnica_id = ${prejemnicaId} AND artikel_id IS NULL
     ORDER BY id
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
    const povratnaEmbalaza = opozorilaVsebujejoKodo(p.opozorila, 'EMB001');

    const izid = await upariPostavko(
      db,
      {
        enotaId,
        dobaviteljId: glava.dobavitelj_id,
        gtin: p.izv_gtin,
        sifra: p.izv_sifra,
        naziv: p.izv_naziv ?? '',
        cenaNaEnoto,
        povratnaEmbalaza,
      },
      nastavitve,
    );

    if (izid.samodejno && izid.artikelId) {
      // Koeficient iz artikel_dobavitelj prepisemo na postavko in hkrati
      // preračunamo kolicina ter cena_kos, da ostaneta konsistentna.
      //
      // Model: kolicina = izv_kolicina × enot_v_paketu  (inventarne enote)
      //        cena_kos = neto_cena_paket / enot_v_paketu  (neto/inventarna enota)
      //
      // Brez tega preračuna bi forma prikazala kolicina/nov_enot = napačna vrednost,
      // npr. 1 / 1.5 = 0.667 namesto 1 (kos Radenske 1,5 l).
      const enotVPaketuZapis = izid.enotVPaketu ?? new Decimal(p.enot_v_paketu ?? 1);
      const izvKolicina = new Decimal(p.izv_kolicina ?? 1);
      const novaKolicina = izvKolicina.mul(enotVPaketuZapis);

      // cena_kos = (izv_cena po rabatih) / enot_v_paketu
      // Če izv_cena ni znana, pustimo cena_kos kakršna je (ne posodabljamo).
      const cenaKosUpdate = p.izv_cena
        ? netoPoRabatih(p.izv_cena, p.rabat_1_odst ?? 0, p.rabat_2_odst ?? 0)
            .div(enotVPaketuZapis)
        : null;

      await db.execute(sql`
        UPDATE prejemnice_postavke
           SET artikel_id = ${izid.artikelId},
               enot_v_paketu = ${enotVPaketuZapis.toString()},
               kolicina      = ${novaKolicina.toString()},
               ${cenaKosUpdate ? sql`cena_kos = ${cenaKosUpdate.toString()},` : sql``}
               uparjanje = ${izid.metoda},
               uparjanje_zaupanje = ${izid.zaupanje},
               uparjanje_kandidati = ${JSON.stringify(izid.kandidati)}::jsonb
         WHERE id = ${p.id}
      `);
      await uskladiDdvPostavkeZArtiklom(db, p.id, izid.artikelId);

      // Enoto mere zapiši na artikel, če je manjka — ne prepisujemo obstoječe.
      const enotaNorm = p.izv_enota ? p.izv_enota.trim().toLowerCase() : null;
      if (enotaNorm) {
        await db.execute(sql`
          UPDATE artikli SET enota_mere = ${enotaNorm}
           WHERE id = ${izid.artikelId} AND enota_mere IS NULL
        `);
      }

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

  // BOOKIE: prejemnice nimajo stolpca status — uparjanje je razvidno
  // iz prisotnosti neuparjenih postavk (artikel_id IS NULL)

  return { uparjenih, dvomljivih, neuparjenih };
}
