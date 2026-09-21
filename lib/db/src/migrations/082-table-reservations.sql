-- Ena aktivna podatkovna rezervacija na mizo.
-- Varno za ponovno izvajanje.
ALTER TABLE mize
  ADD COLUMN IF NOT EXISTS rezervacija_stranka_ime text,
  ADD COLUMN IF NOT EXISTS rezervacija_telefon text,
  ADD COLUMN IF NOT EXISTS rezervacija_opomba text,
  ADD COLUMN IF NOT EXISTS rezervacija_velja_do timestamptz;

-- Stari statusi "rezervirana" niso imeli podatkov in roka, zato jih ni mogoče
-- varno obravnavati kot veljavne rezervacije.
UPDATE mize
SET
  status = 'prosta',
  rezervacija_stranka_ime = NULL,
  rezervacija_telefon = NULL,
  rezervacija_opomba = NULL,
  rezervacija_velja_do = NULL
WHERE status = 'rezervirana'
  AND (
    rezervacija_stranka_ime IS NULL
    OR rezervacija_telefon IS NULL
    OR rezervacija_velja_do IS NULL
  );

CREATE INDEX IF NOT EXISTS ix_mize_rezervacija_velja_do
  ON mize (rezervacija_velja_do);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_mize_rezervacija_status_podatki'
  ) THEN
    ALTER TABLE mize
      ADD CONSTRAINT ck_mize_rezervacija_status_podatki
      CHECK (
        (
          status = 'rezervirana'
          AND rezervacija_stranka_ime IS NOT NULL
          AND btrim(rezervacija_stranka_ime) <> ''
          AND rezervacija_telefon IS NOT NULL
          AND btrim(rezervacija_telefon) <> ''
          AND rezervacija_velja_do IS NOT NULL
        )
        OR
        (
          status <> 'rezervirana'
          AND rezervacija_stranka_ime IS NULL
          AND rezervacija_telefon IS NULL
          AND rezervacija_opomba IS NULL
          AND rezervacija_velja_do IS NULL
        )
      );
  END IF;
END $$;