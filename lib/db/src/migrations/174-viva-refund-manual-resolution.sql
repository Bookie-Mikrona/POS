-- test-bootstrap: integrity
ALTER TABLE viva_vracilo_status_prehodi
  ADD COLUMN IF NOT EXISTS vir text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS razlog text,
  ADD COLUMN IF NOT EXISTS dokaz_referenca text;

UPDATE viva_vracilo_status_prehodi
SET vir = CASE
  WHEN prejsnji_status IS NULL AND novi_status = 'pending' THEN 'reservation'
  WHEN novi_status = 'unknown' THEN 'provider_error'
  ELSE 'provider'
END
WHERE vir = 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'viva_vracilo_status_prehodi_vir_check'
      AND conrelid = 'viva_vracilo_status_prehodi'::regclass
  ) THEN
    ALTER TABLE viva_vracilo_status_prehodi
      ADD CONSTRAINT viva_vracilo_status_prehodi_vir_check
      CHECK (vir IN ('reservation', 'provider', 'provider_error', 'manual', 'legacy'));
  END IF;
END $$;