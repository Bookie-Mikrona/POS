-- 047: Z-poročilo — formalni zaklenjeni dnevni zaključek blagajne.
-- Grand Total (GT) per blagajna, zamrznjen posnetek, revizijska sled odklePov.

-- Kumulativni GT counter per blagajna (neponastavljiv)
ALTER TABLE blagajne
  ADD COLUMN IF NOT EXISTS grand_total numeric(14,2) NOT NULL DEFAULT 0;

-- Zamrznjen posnetek dnevnega zaključka
CREATE TABLE IF NOT EXISTS z_porocila (
  id                     serial PRIMARY KEY,
  company_id             uuid    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id               integer NOT NULL REFERENCES enote(id)    ON DELETE CASCADE,
  blagajna_id            integer NOT NULL REFERENCES blagajne(id) ON DELETE RESTRICT,
  poslovni_datum         date    NOT NULL,

  -- Zaporedna Z-številka (monotona per blagajna, nikoli ponastavi)
  z_stevilka             integer NOT NULL,

  -- Metapodatki zaključka
  zakljucen_ob           timestamptz NOT NULL DEFAULT now(),
  zakljucil_uporabnik    text    NOT NULL,

  -- Grand Total
  grand_total_prej       numeric(14,2) NOT NULL DEFAULT 0,
  grand_total_nov        numeric(14,2) NOT NULL DEFAULT 0,
  promet_dneva           numeric(14,2) NOT NULL DEFAULT 0,

  -- ── ZAMRZNJEN POSNETEK ─────────────────────────────────────
  skupaj_promet          numeric(14,2) NOT NULL DEFAULT 0,
  skupaj_ddv             numeric(14,2) NOT NULL DEFAULT 0,
  stevilo_racunov        integer       NOT NULL DEFAULT 0,
  od_zap                 text,
  do_zap                 text,

  -- Plačila po načinih
  gotovina               numeric(14,2) NOT NULL DEFAULT 0,
  kartica                numeric(14,2) NOT NULL DEFAULT 0,
  sumup                  numeric(14,2) NOT NULL DEFAULT 0,
  bon                    numeric(14,2) NOT NULL DEFAULT 0,
  bon_pica               numeric(14,2) NOT NULL DEFAULT 0,
  stevilo_bonov          integer       NOT NULL DEFAULT 0,
  negotovinsko           numeric(14,2) NOT NULL DEFAULT 0,
  reprezentanca          numeric(14,2) NOT NULL DEFAULT 0,
  lastna_poraba          numeric(14,2) NOT NULL DEFAULT 0,

  -- DDV po stopnjah (JSON array of {stopnja, ddvZnesek, osnova})
  ddv_po_stopnjah        jsonb         NOT NULL DEFAULT '[]',

  -- Blagajniški dnevnik
  menjalni_denar         numeric(14,2) NOT NULL DEFAULT 0,
  gotovinska_prodaja     numeric(14,2) NOT NULL DEFAULT 0,
  pologi_gotovine        numeric(14,2) NOT NULL DEFAULT 0,
  izplacila_dobaviteljem numeric(14,2) NOT NULL DEFAULT 0,
  pologi_trr             numeric(14,2) NOT NULL DEFAULT 0,
  stanje_blagajne        numeric(14,2) NOT NULL DEFAULT 0,

  -- Darilni boni (neobdavčljivo predplačilo ločeno od unovčitev)
  darilni_boni_izdaja    numeric(14,2) NOT NULL DEFAULT 0,
  darilni_boni_unovcitev numeric(14,2) NOT NULL DEFAULT 0,

  -- Študentska subvencija (terjatev do ZRSZ)
  ssp_subvencija         numeric(14,2) NOT NULL DEFAULT 0,

  -- FURS statistika
  furs_potrjeni          integer       NOT NULL DEFAULT 0,
  furs_nepotrjeni        integer       NOT NULL DEFAULT 0,

  -- Odklep: NULL = zaklenjen, NOT NULL = odklenjen za ponovni zaključek
  odklenjen_ob           timestamptz,
  odklenil_uporabnik     text,

  -- En aktiven Z per blagajna na dan
  CONSTRAINT z_porocila_unikat UNIQUE (enota_id, blagajna_id, poslovni_datum)
);

-- Revizijska sled odklePov (NEIZBRISNO — no CASCADE DELETE)
CREATE TABLE IF NOT EXISTS z_porocilo_odklepi (
  id                 serial      PRIMARY KEY,
  z_porocilo_id      integer     NOT NULL REFERENCES z_porocila(id) ON DELETE RESTRICT,
  odklenil_uporabnik text        NOT NULL,
  odklenjeno_ob      timestamptz NOT NULL DEFAULT now(),
  razlog             text        NOT NULL,
  gt_prej            numeric(14,2) NOT NULL,
  gt_po_ponovnem     numeric(14,2),
  CONSTRAINT z_porocilo_odklepi_razlog_check CHECK (length(trim(razlog)) > 0)
);

CREATE INDEX IF NOT EXISTS ix_z_porocila_enota_blagajna
  ON z_porocila(enota_id, blagajna_id);

CREATE INDEX IF NOT EXISTS ix_z_porocilo_odklepi_z_id
  ON z_porocilo_odklepi(z_porocilo_id);
