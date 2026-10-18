-- test-bootstrap: audit
-- Starih zapisov ne dopolnjujemo s trenutnimi imeni, ki niso zgodovinski podatek.
ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS exported_by_name text;
