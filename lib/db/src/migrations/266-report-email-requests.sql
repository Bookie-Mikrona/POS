-- test-bootstrap: schema
-- No expiry: deleting PDF history must not permit a previously used SMTP key again.
CREATE TABLE IF NOT EXISTS report_email_requests (
  company_id uuid NOT NULL,
  request_key uuid NOT NULL,
  payload_hash text NOT NULL,
  exported_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, request_key)
);
