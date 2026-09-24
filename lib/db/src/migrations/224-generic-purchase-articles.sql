-- test-bootstrap: schema
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS je_skupinski_nabavni_artikel boolean NOT NULL DEFAULT false;

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_skupinski_nabavni_artikel_check'
                 AND conrelid = 'artikli'::regclass) THEN
    ALTER TABLE artikli
      ADD CONSTRAINT artikli_skupinski_nabavni_artikel_check
      CHECK (
        NOT je_skupinski_nabavni_artikel
        OR (
          nabavni_artikel = true
          AND prodajni_artikel = false
          AND enota_mere IS NOT NULL
          AND upper(btrim(enota_mere)) IN (
            'KOS', 'KOM', 'PCE', 'EA', 'H87',
            'KG', 'KGM', 'G', 'GRM',
            'L', 'LTR', 'ML', 'MLT',
            'M', 'MTR', 'M2', 'MTK', 'M3', 'MTQ',
            'KAR', 'CT', 'SKA', 'BX'
          )
        )
      );
  END IF;
END $constraint$;