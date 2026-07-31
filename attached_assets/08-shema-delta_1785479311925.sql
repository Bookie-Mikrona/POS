-- =====================================================================
--  UVOZ PREJEMNIC — MINIMALNA RAZŠIRITEV OBSTOJEČE SHEME
--  BOOKIE ERP / POS Gostinstvo
--
--  Načelo: samo dodajanje. Nobena obstoječa tabela se ne preimenuje,
--  noben obstoječi stolpec ne spremeni tipa. Vse novo je NULL-dopustno,
--  da obstoječi ročni vnos deluje nespremenjeno.
--
--  Imena obstoječih tabel in stolpcev so predpostavljena — pred zagonom
--  jih uskladi z dejansko shemo (glej oznake ⚠ PREVERI).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------
-- FAZA 0 — polja, ki so pogoj za vse ostalo
-- ---------------------------------------------------------------------

-- 0.1  Številka dobaviteljevega dokumenta kot strukturirano polje.
--      Doslej v prosti opombi: "(333, 03.01.2026)".
--      Brez tega ni zaznave podvojenega prevzema in ni povezave z računom.

ALTER TABLE prejemnica                                  -- ⚠ PREVERI ime
    ADD COLUMN IF NOT EXISTS st_dokumenta      TEXT,
    ADD COLUMN IF NOT EXISTS datum_dokumenta   DATE;

-- Enolično le, kadar je številka vpisana — obstoječi zapisi ostanejo veljavni.
CREATE UNIQUE INDEX IF NOT EXISTS ux_prejemnica_dokument
    ON prejemnica (podjetje_id, dobavitelj_id, st_dokumenta, datum_dokumenta)
    WHERE st_dokumenta IS NOT NULL;

-- Enkratna migracija obstoječih opomb oblike "(333, 03.01.2026)"
UPDATE prejemnica SET
    st_dokumenta = (regexp_match(opomba, '^\((\S+?),'))[1],
    datum_dokumenta = to_date((regexp_match(opomba, ',\s*(\d{2}\.\d{2}\.\d{4})\)'))[1],
                              'DD.MM.YYYY')
 WHERE st_dokumenta IS NULL
   AND opomba ~ '^\(\S+?,\s*\d{2}\.\d{2}\.\d{4}\)$';


-- 0.2  GTIN na artiklu. Ključ, ki deluje čez vse dobavitelje hkrati.

ALTER TABLE artikel                                      -- ⚠ PREVERI ime
    ADD COLUMN IF NOT EXISTS gtin TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_artikel_gtin
    ON artikel (podjetje_id, gtin) WHERE gtin IS NOT NULL;


-- 0.3  Nabavna (vstopna) stopnja DDV — LOČENA od prodajne kategorije.
--      Kavna zrna: nabava 9,5 %, prodaja kot topla pijača pri mizi 22 %.
--      Validacija uvoza primerja s tem poljem, NE s prodajno kategorijo.

ALTER TABLE artikel
    ADD COLUMN IF NOT EXISTS nabavna_ddv_stopnja NUMERIC(5,2);

COMMENT ON COLUMN artikel.nabavna_ddv_stopnja IS
  'Pričakovana stopnja DDV na prejemnici. Neodvisna od davčne kategorije,
   ki določa izstopni DDV glede na način strežbe (pri mizi / za s seboj).
   Napolni se ob prvem prevzemu iz dokumenta, nato služi kot kontrola.';


-- 0.4  Kontrola veljavnosti GTIN (uporabi pri uvozu in ročnem vnosu)

CREATE OR REPLACE FUNCTION gtin_veljaven(p_gtin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT; s INT := 0; i INT;
BEGIN
    IF p_gtin IS NULL OR p_gtin !~ '^\d+$'
       OR length(p_gtin) NOT IN (8,12,13,14) THEN RETURN FALSE; END IF;
    v := lpad(p_gtin, 14, '0');
    FOR i IN 1..13 LOOP
        s := s + substr(v,i,1)::INT * CASE WHEN (14-i) % 2 = 0 THEN 1 ELSE 3 END;
    END LOOP;
    RETURN ((10 - (s % 10)) % 10) = substr(v,14,1)::INT;
END $$;

CREATE OR REPLACE FUNCTION gtin_norm(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p ~ '^\d{8,14}$' THEN lpad(p, 14, '0') END $$;


-- ---------------------------------------------------------------------
-- FAZA 1 — preslikave artiklov dobavitelja (jedro uvoza)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artikel_dobavitelj (
    id                 BIGSERIAL PRIMARY KEY,
    podjetje_id        BIGINT NOT NULL,
    artikel_id         BIGINT NOT NULL REFERENCES artikel(id),
    dobavitelj_id      BIGINT NOT NULL REFERENCES partner(id),   -- ⚠ PREVERI

    sifra_dobavitelja  TEXT,
    gtin               TEXT,
    naziv_dobavitelja  TEXT,
    naziv_norm         TEXT GENERATED ALWAYS AS
                       (lower(unaccent(coalesce(naziv_dobavitelja,'')))) STORED,

    -- pakiranje, kot ga dobavlja TA dobavitelj
    enot_v_paketu      NUMERIC(18,6) NOT NULL DEFAULT 1,
    naziv_paketa       TEXT,                       -- 'karton', 'gajba', 'sod'

    zadnja_cena_paket  NUMERIC(15,6),
    zadnja_cena_enota  NUMERIC(15,6),
    zadnja_ddv_stopnja NUMERIC(5,2),
    zadnji_prevzem     DATE,
    st_prevzemov       INT NOT NULL DEFAULT 0,

    aktivno            BOOLEAN NOT NULL DEFAULT TRUE,
    potrdil_uporabnik  BIGINT,
    potrjeno_dne       TIMESTAMPTZ,

    CONSTRAINT uq_ad_sifra UNIQUE (podjetje_id, dobavitelj_id, sifra_dobavitelja),
    CONSTRAINT uq_ad_gtin  UNIQUE (podjetje_id, dobavitelj_id, gtin),
    CONSTRAINT ck_ad_kljuc CHECK (sifra_dobavitelja IS NOT NULL OR gtin IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_ad_naziv_trgm
    ON artikel_dobavitelj USING gin (naziv_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_ad_artikel
    ON artikel_dobavitelj (podjetje_id, artikel_id);

COMMENT ON TABLE artikel_dobavitelj IS
  'Učeča se preslikava. Vsaka ročna potrditev uparjanja zapiše zapis.
   Po nekaj prevzemih od istega dobavitelja je uvoz samodejen.';


-- Trajno pakiranje na artiklu (danes se paketni vnos 📦 ne shrani)
CREATE TABLE IF NOT EXISTS artikel_pakiranje (
    id             BIGSERIAL PRIMARY KEY,
    podjetje_id    BIGINT NOT NULL,
    artikel_id     BIGINT NOT NULL REFERENCES artikel(id),
    naziv          TEXT NOT NULL,              -- 'karton 6×1 l'
    enot_v_paketu  NUMERIC(18,6) NOT NULL,
    gtin           TEXT,
    privzeto       BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (enot_v_paketu > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pakiranje_privzeto
    ON artikel_pakiranje (podjetje_id, artikel_id) WHERE privzeto;


-- ---------------------------------------------------------------------
-- FAZA 2 — uvozne seje
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS uvoz_seja (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    podjetje_id    BIGINT NOT NULL,
    enota_id       BIGINT,
    kanal          TEXT NOT NULL,     -- ROCNI_NALOG | EPOSTA | PEPPOL | API
    format         TEXT,              -- CSV | XLSX | ESLOG_RACUN | ...
    profil_id      BIGINT,
    ime_datoteke   TEXT,
    sha256         BYTEA NOT NULL,
    vsebina        BYTEA,
    prejeto        TIMESTAMPTZ NOT NULL DEFAULT now(),
    obdelano       TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'PREJETO',
    razclenitev    JSONB,
    napake         JSONB,
    prejemnica_id  BIGINT REFERENCES prejemnica(id),
    CONSTRAINT uq_seja_hash UNIQUE (podjetje_id, sha256)
);

CREATE INDEX IF NOT EXISTS ix_seja_status
    ON uvoz_seja (podjetje_id, status, prejeto DESC);


CREATE TABLE IF NOT EXISTS uvoz_profil (
    id             BIGSERIAL PRIMARY KEY,
    podjetje_id    BIGINT NOT NULL,
    dobavitelj_id  BIGINT NOT NULL REFERENCES partner(id),
    naziv          TEXT NOT NULL,
    format         TEXT NOT NULL,
    cene_bruto     BOOLEAN NOT NULL DEFAULT FALSE,   -- ustreza preklopu na zaslonu
    prepoznava     JSONB NOT NULL DEFAULT '{}'::jsonb,
    konfiguracija  JSONB NOT NULL,
    aktivno        BOOLEAN NOT NULL DEFAULT TRUE,
    ustvarjeno     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_profil_dob
    ON uvoz_profil (podjetje_id, dobavitelj_id) WHERE aktivno;


-- ---------------------------------------------------------------------
-- FAZA 2 — razširitev postavke prejemnice
-- ---------------------------------------------------------------------

ALTER TABLE prejemnica_postavka                          -- ⚠ PREVERI ime
    -- izvorni podatki iz dokumenta, ohranjeni nespremenjeni
    ADD COLUMN IF NOT EXISTS izv_gtin            TEXT,
    ADD COLUMN IF NOT EXISTS izv_sifra           TEXT,
    ADD COLUMN IF NOT EXISTS izv_naziv           TEXT,
    ADD COLUMN IF NOT EXISTS izv_enota           TEXT,
    ADD COLUMN IF NOT EXISTS izv_kolicina        NUMERIC(18,6),
    ADD COLUMN IF NOT EXISTS izv_cena            NUMERIC(15,6),
    -- način in kakovost uparjanja
    ADD COLUMN IF NOT EXISTS uparjanje           TEXT,
    ADD COLUMN IF NOT EXISTS uparjanje_zaupanje  NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS uparjanje_kandidati JSONB,
    -- rabati (danes ne obstajajo)
    ADD COLUMN IF NOT EXISTS rabat_1_odst        NUMERIC(7,4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rabat_2_odst        NUMERIC(7,4) DEFAULT 0,
    -- opozorila validacije
    ADD COLUMN IF NOT EXISTS opozorila           JSONB;

CREATE INDEX IF NOT EXISTS ix_pp_neuparjeno
    ON prejemnica_postavka (prejemnica_id) WHERE artikel_id IS NULL;

-- Kaskadni rabati — 10 % in 5 % NISTA 15 %
CREATE OR REPLACE FUNCTION neto_po_rabatih(
    p_bruto NUMERIC, p_r1 NUMERIC, p_r2 NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT p_bruto * (1 - COALESCE(p_r1,0)/100) * (1 - COALESCE(p_r2,0)/100)
$$;


-- ---------------------------------------------------------------------
-- FAZA 1 — uparjanje
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION naziv_norm(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(lower(unaccent(coalesce(p,''))),
                              '(\d),(\d)', '\1.\2', 'g'),
               '[^a-z0-9. ]+', ' ', 'g'),
             '\s+', ' ', 'g')
$$;

/*
  Kaskada, prilagojena vašemu šifrantu:
    1. GTIN (ko bo polje napolnjeno)
    2. šifra dobavitelja iz naučene preslikave
    3. podobnost naziva, OMEJENO na tip NABAVNI / NABAVNO_PRODAJNI
  Artikli tipa PRODAJNI so izključeni — po vaši definiciji niso na prejemnicah.
*/

CREATE OR REPLACE FUNCTION upari_postavko(
    p_podjetje   BIGINT,
    p_dobavitelj BIGINT,
    p_gtin       TEXT,
    p_sifra      TEXT,
    p_naziv      TEXT,
    p_cena       NUMERIC DEFAULT NULL
) RETURNS TABLE (
    artikel_id BIGINT, metoda TEXT, zaupanje NUMERIC,
    enot_v_paketu NUMERIC, kandidati JSONB
) LANGUAGE plpgsql STABLE AS $$
DECLARE v_gtin TEXT := gtin_norm(p_gtin); v_kand JSONB;
BEGIN
    -- 1) GTIN
    IF v_gtin IS NOT NULL THEN
        RETURN QUERY
        SELECT a.id, 'GTIN'::TEXT, 100::NUMERIC,
               COALESCE(ad.enot_v_paketu, 1), NULL::JSONB
          FROM artikel a
          LEFT JOIN artikel_dobavitelj ad
                 ON ad.artikel_id = a.id AND ad.dobavitelj_id = p_dobavitelj
         WHERE a.podjetje_id = p_podjetje
           AND gtin_norm(a.gtin) = v_gtin
         LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- 2) šifra dobavitelja
    IF p_sifra IS NOT NULL AND btrim(p_sifra) <> '' THEN
        RETURN QUERY
        SELECT ad.artikel_id, 'SIFRA_DOBAVITELJA'::TEXT, 100::NUMERIC,
               ad.enot_v_paketu, NULL::JSONB
          FROM artikel_dobavitelj ad
         WHERE ad.podjetje_id = p_podjetje
           AND ad.dobavitelj_id = p_dobavitelj
           AND upper(btrim(ad.sifra_dobavitelja)) = upper(btrim(p_sifra))
           AND ad.aktivno
         LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- 3) podobnost naziva
    RETURN QUERY
    WITH k AS (
        SELECT a.id, a.naziv,
               LEAST(1.0,
                 GREATEST(
                   similarity(naziv_norm(a.naziv), naziv_norm(p_naziv)),
                   COALESCE(MAX(similarity(ad.naziv_norm, naziv_norm(p_naziv))), 0)
                 )
                 -- bonus: enake številčne vrednosti v nazivu (0.5, 1.5, 330)
                 + CASE WHEN (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                              regexp_matches(naziv_norm(a.naziv),'(\d+\.?\d*)','g') m)
                           = (SELECT array_agg(m[1] ORDER BY m[1]) FROM
                              regexp_matches(naziv_norm(p_naziv),'(\d+\.?\d*)','g') m)
                        THEN 0.10 ELSE 0 END
                 -- bonus: artikel se od tega dobavitelja že kupuje
                 + CASE WHEN bool_or(ad.dobavitelj_id = p_dobavitelj)
                        THEN 0.10 ELSE 0 END
               ) AS ocena,
               COALESCE(MAX(ad.enot_v_paketu) FILTER
                        (WHERE ad.dobavitelj_id = p_dobavitelj), 1) AS pak
          FROM artikel a
          LEFT JOIN artikel_dobavitelj ad ON ad.artikel_id = a.id
         WHERE a.podjetje_id = p_podjetje
           AND a.aktiven
           AND a.tip IN ('NABAVNI','NABAVNO_PRODAJNI')       -- ⚠ PREVERI vrednosti
           AND naziv_norm(a.naziv) % naziv_norm(p_naziv)
         GROUP BY a.id, a.naziv
    )
    SELECT k.id, 'PODOBNOST_NAZIVA'::TEXT, round(k.ocena*100, 2), k.pak,
           (SELECT jsonb_agg(jsonb_build_object(
                     'artikel_id', k2.id, 'naziv', k2.naziv,
                     'ocena', round(k2.ocena,3)) ORDER BY k2.ocena DESC)
              FROM (SELECT * FROM k ORDER BY ocena DESC LIMIT 5) k2)
      FROM k
     WHERE k.ocena >= 0.75
     ORDER BY k.ocena DESC
     LIMIT 1;

    IF FOUND THEN RETURN; END IF;

    -- brez zadetka: vrni samo kandidate za izbiro
    SELECT jsonb_agg(jsonb_build_object('artikel_id', a.id, 'naziv', a.naziv,
             'ocena', round(similarity(naziv_norm(a.naziv), naziv_norm(p_naziv))::numeric,3))
             ORDER BY similarity(naziv_norm(a.naziv), naziv_norm(p_naziv)) DESC)
      INTO v_kand
      FROM (SELECT id, naziv FROM artikel
             WHERE podjetje_id = p_podjetje AND aktiven
               AND tip IN ('NABAVNI','NABAVNO_PRODAJNI')
             ORDER BY similarity(naziv_norm(naziv), naziv_norm(p_naziv)) DESC
             LIMIT 5) a;

    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, 0::NUMERIC, NULL::NUMERIC,
                        COALESCE(v_kand, '[]'::jsonb);
END $$;


-- Učenje: ročna potrditev postane trajna preslikava
CREATE OR REPLACE FUNCTION potrdi_uparjanje(
    p_postavka_id BIGINT,
    p_artikel_id  BIGINT,
    p_enot_v_paketu NUMERIC,
    p_uporabnik   BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE post RECORD; pre RECORD;
BEGIN
    SELECT * INTO post FROM prejemnica_postavka WHERE id = p_postavka_id;
    SELECT * INTO pre  FROM prejemnica WHERE id = post.prejemnica_id;

    UPDATE prejemnica_postavka
       SET artikel_id = p_artikel_id,
           uparjanje = 'ROCNO',
           uparjanje_zaupanje = 100
     WHERE id = p_postavka_id;

    INSERT INTO artikel_dobavitelj (
        podjetje_id, artikel_id, dobavitelj_id, sifra_dobavitelja, gtin,
        naziv_dobavitelja, enot_v_paketu, zadnja_cena_enota,
        zadnji_prevzem, st_prevzemov, potrdil_uporabnik, potrjeno_dne)
    VALUES (
        pre.podjetje_id, p_artikel_id, pre.dobavitelj_id,
        NULLIF(btrim(post.izv_sifra),''), gtin_norm(post.izv_gtin),
        post.izv_naziv, COALESCE(p_enot_v_paketu,1), post.izv_cena,
        pre.datum, 1, p_uporabnik, now())
    ON CONFLICT (podjetje_id, dobavitelj_id, sifra_dobavitelja)
    DO UPDATE SET
        artikel_id        = EXCLUDED.artikel_id,
        gtin              = COALESCE(EXCLUDED.gtin, artikel_dobavitelj.gtin),
        enot_v_paketu     = EXCLUDED.enot_v_paketu,
        zadnja_cena_enota = EXCLUDED.zadnja_cena_enota,
        zadnji_prevzem    = EXCLUDED.zadnji_prevzem,
        st_prevzemov      = artikel_dobavitelj.st_prevzemov + 1,
        aktivno           = TRUE;

    -- GTIN zapiši tudi na artikel, če ga še nima
    UPDATE artikel
       SET gtin = gtin_norm(post.izv_gtin)
     WHERE id = p_artikel_id
       AND gtin IS NULL
       AND gtin_veljaven(post.izv_gtin);
END $$;


-- ---------------------------------------------------------------------
-- FAZA 4 — kontrola odstopanja cene
-- ---------------------------------------------------------------------

/*
  Primerja VEDNO na enoto, nikoli na paket.
  Sprememba pakiranja iz 6 na 4 kose pri nespremenjeni ceni kartona
  je 50-odstotna podražitev, ki je na ravni paketa ni videti.
*/

CREATE OR REPLACE VIEW v_odstopanja_cen AS
SELECT
    p.id                                   AS prejemnica_id,
    p.datum,
    p.st_dokumenta,
    d.naziv                                AS dobavitelj,
    a.naziv                                AS artikel,
    pp.cena_enota                          AS nova_cena,     -- ⚠ PREVERI ime
    ad.zadnja_cena_enota                   AS prejsnja_cena,
    round(100 * (pp.cena_enota - ad.zadnja_cena_enota)
          / NULLIF(ad.zadnja_cena_enota, 0), 2) AS odstopanje_odst,
    round((pp.cena_enota - ad.zadnja_cena_enota)
          * pp.kolicina_enot, 2)           AS financni_ucinek,
    ad.enot_v_paketu                       AS prejsnje_pakiranje,
    pp.enot_v_paketu                       AS novo_pakiranje,
    (ad.enot_v_paketu IS DISTINCT FROM pp.enot_v_paketu) AS pakiranje_spremenjeno
FROM prejemnica p
JOIN prejemnica_postavka pp ON pp.prejemnica_id = p.id
JOIN artikel a  ON a.id = pp.artikel_id
JOIN partner d  ON d.id = p.dobavitelj_id
LEFT JOIN artikel_dobavitelj ad
       ON ad.artikel_id = pp.artikel_id
      AND ad.dobavitelj_id = p.dobavitelj_id
WHERE ad.zadnja_cena_enota IS NOT NULL
  AND abs(pp.cena_enota - ad.zadnja_cena_enota)
      / NULLIF(ad.zadnja_cena_enota, 0) > 0.10;

COMMIT;

-- =====================================================================
--  PREVERI PRED ZAGONOM:
--    - imena tabel: prejemnica, prejemnica_postavka, artikel, partner
--    - imena stolpcev: podjetje_id, dobavitelj_id, aktiven, tip
--    - vrednosti tipa artikla: 'NABAVNI', 'NABAVNO_PRODAJNI'
--    - imena cenovnih stolpcev postavke: cena_enota, kolicina_enot,
--      enot_v_paketu (na zaslonu: 20 / 1 / 5,476 / 0,25)
-- =====================================================================
