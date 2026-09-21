-- Povezava podjetniških DDV kod z verzioniranim globalnim FURS šifrantom.
-- Globalni vat_code je verzioniran po (code, valid_from), zato FK uporablja UUID.
ALTER TABLE vat_codes
  ADD COLUMN IF NOT EXISTS furs_code_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vat_codes_furs_code_id_fkey'
  ) THEN
    ALTER TABLE vat_codes
      ADD CONSTRAINT vat_codes_furs_code_id_fkey
      FOREIGN KEY (furs_code_id) REFERENCES vat_code(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_vat_codes_furs_code
  ON vat_codes (furs_code_id)
  WHERE furs_code_id IS NOT NULL;

-- Varno napolni le kode z enim samim natančnim kandidatom po kodi in stopnji.
-- Dvoumne smeri/verzije ostanejo NULL in jih računovodja izbere v UI.
UPDATE vat_codes AS company_code
SET furs_code_id = candidate.id
FROM (
  SELECT company_code_inner.id AS company_code_id, MIN(global_code.id::text)::uuid AS id
  FROM vat_codes AS company_code_inner
  JOIN vat_code AS global_code
    ON global_code.code = company_code_inner.code
   AND global_code.rate = company_code_inner.rate
  GROUP BY company_code_inner.id
  HAVING COUNT(*) = 1
) AS candidate
WHERE company_code.id = candidate.company_code_id
  AND company_code.furs_code_id IS NULL;

-- journal_entry_lines.vat_code_id že kaže na globalni vat_code.id.
-- Podjetniško izvorno kodo zato hranimo v ločenem, nedvoumnem stolpcu.
ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS company_vat_code_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_lines_company_vat_code_id_fkey'
  ) THEN
    ALTER TABLE journal_entry_lines
      ADD CONSTRAINT journal_entry_lines_company_vat_code_id_fkey
      FOREIGN KEY (company_vat_code_id) REFERENCES vat_codes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_journal_entry_lines_company_vat_code
  ON journal_entry_lines (company_vat_code_id)
  WHERE company_vat_code_id IS NOT NULL;