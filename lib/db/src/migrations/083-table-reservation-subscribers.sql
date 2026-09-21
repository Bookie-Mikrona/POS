-- Aktivno rezervacijo mize poveži s telefonskim naročnikom.
-- Varno za ponovno izvajanje.
ALTER TABLE mize
  ADD COLUMN IF NOT EXISTS rezervacija_narocnik_id integer;

-- Obstoječe veljavne rezervacije poveži z imenikom, kadar je mogoče
-- telefonsko številko varno normalizirati.
WITH normalizirane AS (
  SELECT
    m.id AS miza_id,
    m.enota_id,
    m.rezervacija_stranka_ime AS ime,
    m.rezervacija_telefon AS telefon,
    CASE
      WHEN regexp_replace(m.rezervacija_telefon, '\D', '', 'g') LIKE '00386%'
        THEN substring(regexp_replace(m.rezervacija_telefon, '\D', '', 'g') FROM 6)
      WHEN regexp_replace(m.rezervacija_telefon, '\D', '', 'g') LIKE '386%'
        THEN substring(regexp_replace(m.rezervacija_telefon, '\D', '', 'g') FROM 4)
      WHEN regexp_replace(m.rezervacija_telefon, '\D', '', 'g') LIKE '0%'
        THEN substring(regexp_replace(m.rezervacija_telefon, '\D', '', 'g') FROM 2)
      ELSE regexp_replace(m.rezervacija_telefon, '\D', '', 'g')
    END AS nacionalna
  FROM mize m
  WHERE m.status = 'rezervirana'
    AND m.rezervacija_narocnik_id IS NULL
),
veljavne AS (
  SELECT *, '+386' || nacionalna AS telefon_normaliziran
  FROM normalizirane
  WHERE nacionalna ~ '^[0-9]{8}$'
),
vstavljeni AS (
  INSERT INTO narocniki (
    enota_id, ime, telefon, telefon_normaliziran,
    stevilo_narocil, ustvarjeno, posodobljeno
  )
  SELECT DISTINCT ON (enota_id, telefon_normaliziran)
    enota_id, ime, telefon, telefon_normaliziran, 0, now(), now()
  FROM veljavne
  ORDER BY enota_id, telefon_normaliziran, miza_id
  ON CONFLICT (enota_id, telefon_normaliziran) DO NOTHING
  RETURNING id
)
UPDATE mize m
SET rezervacija_narocnik_id = n.id
FROM veljavne v
JOIN narocniki n
  ON n.enota_id = v.enota_id
 AND n.telefon_normaliziran = v.telefon_normaliziran
WHERE m.id = v.miza_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_mize_rezervacija_narocnik'
  ) THEN
    ALTER TABLE mize
      ADD CONSTRAINT fk_mize_rezervacija_narocnik
      FOREIGN KEY (rezervacija_narocnik_id)
      REFERENCES narocniki(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Razširi obstoječo omejitev: neaktivna rezervacija ne sme ohraniti povezave
-- do telefonskega naročnika.
ALTER TABLE mize
  DROP CONSTRAINT IF EXISTS ck_mize_rezervacija_status_podatki;

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
      AND rezervacija_narocnik_id IS NULL
      AND rezervacija_stranka_ime IS NULL
      AND rezervacija_telefon IS NULL
      AND rezervacija_opomba IS NULL
      AND rezervacija_velja_do IS NULL
    )
  );