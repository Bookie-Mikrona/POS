-- test-bootstrap: schema
-- Private file bytes remain in App Storage. No journal/fiscal data is altered.
CREATE TABLE IF NOT EXISTS annual_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL CONSTRAINT annual_report_exports_year CHECK (year BETWEEN 2000 AND 2100),
  format text NOT NULL CONSTRAINT annual_report_exports_format CHECK (format IN ('pdf','xlsx','xml','publication-pdf')),
  purpose text NOT NULL CONSTRAINT annual_report_exports_purpose CHECK (purpose IN ('review','statistics','publication','combined')),
  revision integer NOT NULL, fingerprint text NOT NULL, rules_version text NOT NULL,
  publication_reviewed boolean NOT NULL, snapshot jsonb NOT NULL,
  object_path text NOT NULL, sha256 text NOT NULL, byte_size integer NOT NULL CONSTRAINT annual_report_exports_size CHECK (byte_size > 0),
  filename text NOT NULL, mime text NOT NULL, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annual_report_exports_scope ON annual_report_exports(company_id, year, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS annual_report_exports_id_scope ON annual_report_exports(id, company_id, year);
CREATE TABLE IF NOT EXISTS annual_report_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, year integer NOT NULL, export_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CONSTRAINT annual_report_submissions_state CHECK (state IN ('pending','recorded')),
  staging_path text NOT NULL, object_path text, filename text NOT NULL, mime text NOT NULL,
  byte_size integer NOT NULL CONSTRAINT annual_report_submissions_size CHECK (byte_size BETWEEN 1 AND 10485760), sha256 text,
  outcome text CONSTRAINT annual_report_submissions_outcome CHECK (outcome IN ('submitted','accepted','rejected')),
  submitted_on date, reference text, note text, supersedes_id uuid,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), recorded_at timestamptz,
  CONSTRAINT annual_submission_export_scope FOREIGN KEY (export_id, company_id, year)
    REFERENCES annual_report_exports(id, company_id, year) ON DELETE CASCADE,
  CONSTRAINT annual_report_submissions_complete CHECK (state <> 'recorded' OR (
    object_path IS NOT NULL AND sha256 IS NOT NULL AND outcome IS NOT NULL
    AND submitted_on IS NOT NULL AND reference IS NOT NULL AND recorded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS annual_report_submissions_scope ON annual_report_submissions(company_id, year);
CREATE UNIQUE INDEX IF NOT EXISTS annual_report_submissions_id_export ON annual_report_submissions(id, export_id);
CREATE UNIQUE INDEX IF NOT EXISTS annual_report_submissions_supersedes ON annual_report_submissions(supersedes_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'annual_submission_correction_scope'
    AND conrelid = 'annual_report_submissions'::regclass) THEN
    ALTER TABLE annual_report_submissions ADD CONSTRAINT annual_submission_correction_scope
      FOREIGN KEY (supersedes_id, export_id) REFERENCES annual_report_submissions(id, export_id);
  END IF;
END $$;
-- Align an early development copy's implicit check names without changing data.
DO $$ DECLARE p text[]; BEGIN
  FOREACH p SLICE 1 IN ARRAY ARRAY[
    ['annual_report_exports','annual_report_exports_year_check','annual_report_exports_year'],
    ['annual_report_exports','annual_report_exports_format_check','annual_report_exports_format'],
    ['annual_report_exports','annual_report_exports_purpose_check','annual_report_exports_purpose'],
    ['annual_report_exports','annual_report_exports_byte_size_check','annual_report_exports_size'],
    ['annual_report_submissions','annual_report_submissions_state_check','annual_report_submissions_state'],
    ['annual_report_submissions','annual_report_submissions_outcome_check','annual_report_submissions_outcome'],
    ['annual_report_submissions','annual_report_submissions_byte_size_check','annual_report_submissions_size']
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p[1]::regclass AND conname = p[2])
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p[1]::regclass AND conname = p[3]) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', p[1], p[2], p[3]);
    END IF;
  END LOOP;
END $$;