-- test-bootstrap: schema
-- A pseudonymous QR device may assess each accepted QR order once.  Scores are
-- deliberately stored separately from orders so neither feedback nor consent
-- becomes part of the fiscal/order record.
CREATE TABLE IF NOT EXISTS qr_gost_povratne_informacije (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE RESTRICT,
  qr_naprava_id text NOT NULL,
  hrana_ocena integer NOT NULL,
  ambient_ocena integer NOT NULL,
  storitev_ocena integer NOT NULL,
  ocene_postavk jsonb,
  komentar text,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_gost_povratne_informacije_hrana_ocena_check
    CHECK (hrana_ocena BETWEEN 1 AND 5),
  CONSTRAINT qr_gost_povratne_informacije_ambient_ocena_check
    CHECK (ambient_ocena BETWEEN 1 AND 5),
  CONSTRAINT qr_gost_povratne_informacije_storitev_ocena_check
    CHECK (storitev_ocena BETWEEN 1 AND 5),
  CONSTRAINT qr_gost_povratne_informacije_ocene_postavk_object_check
    CHECK (ocene_postavk IS NULL OR jsonb_typeof(ocene_postavk) = 'object'),
  CONSTRAINT qr_gost_povratne_informacije_consent_version_check
    CHECK (length(btrim(consent_version)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_gost_povratne_informacije_narocilo
  ON qr_gost_povratne_informacije (narocilo_id);
-- This historical migration is re-run by the integrity bootstrap. A later
-- privacy migration removes qr_naprava_id, so only recreate the legacy index
-- while the legacy column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'qr_gost_povratne_informacije'
      AND column_name = 'qr_naprava_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS ix_qr_gost_povratne_informacije_enota_naprava_created
      ON qr_gost_povratne_informacije (enota_id, qr_naprava_id, created_at DESC);
  END IF;
END
$$;