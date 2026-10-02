-- test-bootstrap: schema
-- Reporting inputs only. Does not modify the general ledger or fiscal records.
CREATE TABLE IF NOT EXISTS annual_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  settings jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  reviewed_fingerprint text,
  reviewed_by text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annual_reports_year_check CHECK (year BETWEEN 2000 AND 2100),
  CONSTRAINT annual_reports_revision_check CHECK (revision > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS annual_reports_company_year_unique ON annual_reports(company_id, year);