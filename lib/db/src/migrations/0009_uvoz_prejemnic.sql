-- lib/db/src/migrations/0009_uvoz_prejemnic.sql
--
-- Modul uvoza prejemnic — BOOKIE prilagojena različica.
--
-- Prilagoditve od Claudovega izvornika:
--   - podjetje_id → enota_id (BOOKIE tenant ključ)
--   - REFERENCES partnerji(id) → REFERENCES shranjeni_kupci(id)
--   - bigserial → serial (integer)
--   - ix_artikel_naziv_trgm: naziv → ime (BOOKIE ime stolpec)
--
-- POMEMBNO: te migracije ni mogoče v celoti pridobiti z `drizzle-kit
-- generate`. Razdelka 1 in 6 (funkcije, GIN indeksi z operatorskim
-- razredom, delni indeksi) je treba dodati ročno.
--
-- Migracija je idempotentna in varna za ponovni zagon.

-- =====================================================================
-- 1. RAZŠIRITVE IN NESPREMENLJIVE FUNKCIJE
--    (mora biti pred tabelo artikel_dobavitelj)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() je STABLE, generirani stolpci in funkcionalni indeksi pa
-- zahtevajo IMMUTABLE. Ovojnica je edini način. Notranji klic MORA biti
-- imenovan s shemo, ker se izrazi v indeksih vrednotijo z omejenim
-- search_path.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

COMMENT ON FUNCTION public.f_unaccent(text) IS
  'Nespremenljiva ovojnica okrog unaccent. Ob spremembi slovarja unaccent
   je treba odvisne indekse ponovno zgraditi (REINDEX).';

-- Normalizacija naziva za primerjavo:
--   "Čaj vrečka - Kamilica 20/1" -> "caj vrecka kamilica 20 1"
--   "Pivo svetlo 0,5 L"          -> "pivo svetlo 0.5 l"
CREATE OR REPLACE FUNCTION public.naziv_norm(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(lower(public.f_unaccent(coalesce($1,''))),
                              '(\d),(\d)', '\1.\2', 'g'),
               '[^a-z0-9. ]+', ' ', 'g'),
             '\s+', ' ', 'g')
$$;

-- Kontrolna števka GTIN po GS1 modulo 10.
-- Uteži 3,1,3,1... od PRVE števke, ko je koda poravnana na 14 mest.
CREATE OR REPLACE FUNCTION public.gtin_veljaven(p_gtin text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; vsota int := 0; i int;
BEGIN
    IF p_gtin IS NULL THEN RETURN false; END IF;
    s := regexp_replace(p_gtin, '\D', '', 'g');
    IF length(s) NOT IN (8, 12, 13, 14) THEN RETURN false; END IF;
    s := lpad(s, 14, '0');
    FOR i IN 1..13 LOOP
        vsota := vsota + substr(s, i, 1)::int
                 * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END;
    END LOOP;
    RETURN ((10 - vsota % 10) % 10) = substr(s, 14, 1)::int;
END $$;

CREATE OR REPLACE FUNCTION public.gtin_norm(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
             WHEN length(regexp_replace(coalesce($1,''), '\D', '', 'g'))
                  BETWEEN 8 AND 14
             THEN lpad(regexp_replace($1, '\D', '', 'g'), 14, '0')
           END
$$;

-- Kaskadni rabati: 10 % in 5 % nista 15 %.
CREATE OR REPLACE FUNCTION public.neto_po_rabatih(
    p_bruto numeric, p_r1 numeric, p_r2 numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT p_bruto * (1 - coalesce(p_r1,0)/100) * (1 - coalesce(p_r2,0)/100)
$$;


-- =====================================================================
-- 2. NAŠTEVNI TIPI
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE uvoz_kanal AS ENUM (
    'ROCNI_NALOG','NADZOROVANA_MAPA','EPOSTA','PEPPOL',
    'API_DOBAVITELJ','FOTOAPARAT','ROCNI_VNOS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE uvoz_format AS ENUM (
    'ESLOG_2_0_RACUN','ESLOG_2_0_DOBAVNICA','ESLOG_1_6_1',
    'UBL_2_1_INVOICE','UBL_2_1_DESPATCH','CII_D16B',
    'EDIFACT_DESADV','EDIFACT_INVOIC','EDIFACT_PRICAT',
    'CSV','XLSX','JSON_LASTNI','XML_LASTNI',
    'PDF_PREDLOGA','PDF_OCR','BREZ');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE uvoz_status AS ENUM (
    'PREJETO','V_OBDELAVI','RAZCLENJENO','NAPAKA_RAZCLENITVE',
    'PODVOJENO','OBDELANO','ZAVRZENO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE uparjanje_metoda AS ENUM (
    'GTIN','SIFRA_DOBAVITELJA','INTERNA_SIFRA',
    'PODOBNOST_NAZIVA','ROCNO','NOV_ARTIKEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =====================================================================
-- 3. NOVI STOLPCI NA OBSTOJEČIH TABELAH
-- =====================================================================

-- Številka dobaviteljevega dokumenta kot strukturirano polje.
-- Doslej v prosti opombi: "(333, 03.01.2026)".
ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS st_dokumenta    text,
  ADD COLUMN IF NOT EXISTS datum_dokumenta date,
  ADD COLUMN IF NOT EXISTS uvoz_seja_id    uuid;

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS izv_gtin            text,
  ADD COLUMN IF NOT EXISTS izv_sifra           text,
  ADD COLUMN IF NOT EXISTS izv_naziv           text,
  ADD COLUMN IF NOT EXISTS izv_enota           text,
  ADD COLUMN IF NOT EXISTS izv_kolicina        numeric(18,6),
  ADD COLUMN IF NOT EXISTS izv_cena            numeric(15,6),
  ADD COLUMN IF NOT EXISTS uparjanje           uparjanje_metoda,
  ADD COLUMN IF NOT EXISTS uparjanje_zaupanje  numeric(5,2),
  ADD COLUMN IF NOT EXISTS uparjanje_kandidati jsonb,
  ADD COLUMN IF NOT EXISTS rabat_1_odst        numeric(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rabat_2_odst        numeric(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opozorila           jsonb;

-- artikel_id dovoli NULL za uvozne osnutke (se zapolni pri uparjanju)
ALTER TABLE prejemnice_postavke
  ALTER COLUMN artikel_id DROP NOT NULL;

-- Črtna koda in NABAVNA stopnja DDV na artiklu.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS gtin                text,
  ADD COLUMN IF NOT EXISTS nabavna_ddv_stopnja numeric(5,2);

COMMENT ON COLUMN artikli.nabavna_ddv_stopnja IS
  'Pričakovana stopnja DDV na prejemnici. Neodvisna od prodajne davčne
   kategorije (davek). Napolni se ob prvem prevzemu iz dokumenta.';


-- =====================================================================
-- 4. NOVE TABELE
-- =====================================================================

CREATE TABLE IF NOT EXISTS artikel_dobavitelj (
    id                  serial PRIMARY KEY,
    enota_id            integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    artikel_id          integer NOT NULL REFERENCES artikli(id),
    dobavitelj_id       integer NOT NULL REFERENCES shranjeni_kupci(id),
    sifra_dobavitelja   text,
    gtin                text,
    naziv_dobavitelja   text,
    naziv_norm          text GENERATED ALWAYS AS
                        (public.naziv_norm(naziv_dobavitelja)) STORED,
    enot_v_paketu       numeric(18,6) NOT NULL DEFAULT 1,
    naziv_paketa        text,
    zadnja_cena_paket   numeric(15,6),
    zadnja_cena_enota   numeric(15,6),
    zadnja_ddv_stopnja  numeric(5,2),
    zadnji_prevzem      date,
    st_prevzemov        integer NOT NULL DEFAULT 0,
    aktivno             boolean NOT NULL DEFAULT true,
    potrdil_uporabnik   integer,
    potrjeno_dne        timestamptz,
    CONSTRAINT ck_ad_kljuc CHECK (sifra_dobavitelja IS NOT NULL OR gtin IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS artikel_pakiranje (
    id             serial PRIMARY KEY,
    enota_id       integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    artikel_id     integer NOT NULL REFERENCES artikli(id) ON DELETE CASCADE,
    naziv          text NOT NULL,
    enot_v_paketu  numeric(18,6) NOT NULL CHECK (enot_v_paketu > 0),
    gtin           text,
    privzeto       boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS uvoz_seja (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enota_id       integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    kanal          uvoz_kanal NOT NULL,
    format         uvoz_format,
    profil_id      integer,
    ime_datoteke   text,
    mime_tip       text,
    velikost_b     integer,
    sha256         text NOT NULL,
    vsebina        bytea,
    vsebina_kljuc  text,
    prejeto        timestamptz NOT NULL DEFAULT now(),
    obdelano       timestamptz,
    status         uvoz_status NOT NULL DEFAULT 'PREJETO',
    razclenitev    jsonb,
    napake         jsonb,
    metapodatki    jsonb,
    prejemnica_id  integer REFERENCES prejemnice(id),
    prvotna_seja_id uuid
);

CREATE TABLE IF NOT EXISTS uvoz_profil (
    id             serial PRIMARY KEY,
    enota_id       integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    dobavitelj_id  integer NOT NULL REFERENCES shranjeni_kupci(id),
    naziv          text NOT NULL,
    format         uvoz_format NOT NULL,
    cene_bruto     boolean NOT NULL DEFAULT false,
    prepoznava     jsonb NOT NULL DEFAULT '{}'::jsonb,
    konfiguracija  jsonb NOT NULL,
    aktivno        boolean NOT NULL DEFAULT true,
    ustvarjeno     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uvoz_predal (
    id               serial PRIMARY KEY,
    enota_id         integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    streznik         text NOT NULL,
    vrata            integer NOT NULL DEFAULT 993,
    uporabnisko_ime  text NOT NULL,
    geslo_sifrirano  text NOT NULL,
    mapa             text NOT NULL DEFAULT 'INBOX',
    mapa_obdelano    text DEFAULT 'Obdelano',
    mapa_karantena   text DEFAULT 'Karantena',
    uporabi_tls      boolean NOT NULL DEFAULT true,
    aktivno          boolean NOT NULL DEFAULT true,
    zadnja_povezava  timestamptz,
    zadnja_napaka    text
);

CREATE TABLE IF NOT EXISTS partner_eposta (
    id               serial PRIMARY KEY,
    enota_id         integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
    partner_id       integer NOT NULL REFERENCES shranjeni_kupci(id) ON DELETE CASCADE,
    naslov           text,
    domena           text,
    zaupanja_vreden  boolean NOT NULL DEFAULT false,
    dodal_uporabnik  integer,
    dodano           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_pe_kljuc CHECK (naslov IS NOT NULL OR domena IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS uvoz_dnevnik (
    id             serial PRIMARY KEY,
    enota_id       integer NOT NULL,
    seja_id        uuid,
    prejemnica_id  integer,
    cas            timestamptz NOT NULL DEFAULT now(),
    uporabnik_id   integer,
    dogodek        text NOT NULL,
    podrobnosti    jsonb
);


-- =====================================================================
-- 5. ENOLIČNI IN DELNI INDEKSI
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_sifra
    ON artikel_dobavitelj (enota_id, dobavitelj_id, sifra_dobavitelja)
    WHERE sifra_dobavitelja IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_gtin
    ON artikel_dobavitelj (enota_id, dobavitelj_id, gtin)
    WHERE gtin IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_ad_artikel
    ON artikel_dobavitelj (enota_id, artikel_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pakiranje_privzeto
    ON artikel_pakiranje (enota_id, artikel_id) WHERE privzeto;

CREATE UNIQUE INDEX IF NOT EXISTS uq_seja_hash
    ON uvoz_seja (enota_id, sha256);

CREATE INDEX IF NOT EXISTS ix_seja_status
    ON uvoz_seja (enota_id, status, prejeto DESC);

CREATE INDEX IF NOT EXISTS ix_profil_dobavitelj
    ON uvoz_profil (enota_id, dobavitelj_id) WHERE aktivno;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pe_naslov
    ON partner_eposta (enota_id, lower(naslov)) WHERE naslov IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_dnevnik_prejemnica
    ON uvoz_dnevnik (prejemnica_id, cas DESC);

-- Poslovna zaščita pred dvojnim prevzemom iste dobavnice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prejemnica_dokument
    ON prejemnice (enota_id, dobavitelj_id, st_dokumenta, datum_dokumenta)
    WHERE st_dokumenta IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_artikel_gtin
    ON artikli (enota_id, gtin) WHERE gtin IS NOT NULL;

-- Delni indeks za neuparjene postavke (iskanje čakajočih)
CREATE INDEX IF NOT EXISTS ix_pp_neuparjeno
    ON prejemnice_postavke (prejemnica_id) WHERE artikel_id IS NULL;


-- =====================================================================
-- 6. TRIGRAMSKI INDEKSI
--    Drizzle nima zapisa za operatorski razred — samo ročno.
-- =====================================================================

CREATE INDEX IF NOT EXISTS ix_ad_naziv_trgm
    ON artikel_dobavitelj USING gin (naziv_norm gin_trgm_ops);

-- BOOKIE: stolpec se imenuje "ime", ne "naziv"
CREATE INDEX IF NOT EXISTS ix_artikel_naziv_trgm
    ON artikli USING gin (public.naziv_norm(ime) gin_trgm_ops);


-- =====================================================================
-- 7. ENKRATNA MIGRACIJA OBSTOJEČIH OPOMB
--    "(333, 03.01.2026)" -> st_dokumenta='333', datum_dokumenta=2026-01-03
-- =====================================================================

UPDATE prejemnice SET
    st_dokumenta = (regexp_match(opomba, '^\((\S+?),'))[1],
    datum_dokumenta = to_date(
        (regexp_match(opomba, ',\s*(\d{2}\.\d{2}\.\d{4})\)'))[1], 'DD.MM.YYYY')
 WHERE st_dokumenta IS NULL
   AND opomba ~ '^\(\S+?,\s*\d{2}\.\d{2}\.\d{4}\)$';


-- =====================================================================
-- 8. PREVERBA PO MIGRACIJI
-- =====================================================================

DO $$
DECLARE v_trgm boolean; v_unacc boolean; v_sim numeric;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm')  INTO v_trgm;
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='unaccent') INTO v_unacc;
    RAISE NOTICE 'pg_trgm  : %', CASE WHEN v_trgm  THEN 'ok' ELSE 'MANJKA' END;
    RAISE NOTICE 'unaccent : %', CASE WHEN v_unacc THEN 'ok' ELSE 'MANJKA' END;
    RAISE NOTICE 'naziv_norm("Čaj vrečka - Kamilica") = %',
                 public.naziv_norm('Čaj vrečka - Kamilica');
    IF v_trgm THEN
        SELECT round(similarity(public.naziv_norm('Caj vrecka - Kamilica 20/1'),
                                public.naziv_norm('Čaj vrečka - Kamilica'))::numeric, 3)
          INTO v_sim;
        RAISE NOTICE 'podobnost testnega para = %', v_sim;
    END IF;
END $$;
