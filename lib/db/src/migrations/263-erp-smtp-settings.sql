-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS erp_smtp_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  host text NOT NULL,
  port integer NOT NULL CHECK (port IN (465, 587)),
  smtp_user text NOT NULL,
  password_encrypted text NOT NULL,
  smtp_from text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
