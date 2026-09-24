-- test-bootstrap: schema
-- Durable offboarding case records and append-only audit history.
-- target_company_id intentionally has no FK: cases survive company deletion.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS company_offboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_company_id uuid NOT NULL,
  company_name_snapshot text NOT NULL,
  shared_backup_retain_until date NOT NULL,
  status text NOT NULL DEFAULT 'pending_export',
  archive_sha256 text,
  archive_verified_at timestamptz,
  receipt_acknowledged_at timestamptz,
  receipt_acknowledgement text,
  receipt_actor_id text,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_offboarding_cases_status_check
    CHECK (status IN ('pending_export', 'export_verified', 'acknowledged')),
  CONSTRAINT company_offboarding_cases_archive_sha256_check
    CHECK (archive_sha256 IS NULL OR archive_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT company_offboarding_cases_receipt_fields_check
    CHECK (
      (receipt_acknowledged_at IS NULL AND receipt_acknowledgement IS NULL AND receipt_actor_id IS NULL)
      OR
      (receipt_acknowledged_at IS NOT NULL AND receipt_acknowledgement IS NOT NULL AND receipt_actor_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS company_offboarding_cases_company_created_idx
  ON company_offboarding_cases (target_company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_offboarding_case_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES company_offboarding_cases(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_id text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_offboarding_case_audit_event_type_check
    CHECK (event_type IN ('case_created', 'archive_verified', 'receipt_acknowledged'))
);

CREATE INDEX IF NOT EXISTS company_offboarding_case_audit_events_case_created_idx
  ON company_offboarding_case_audit_events (case_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_company_offboarding_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company offboarding audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS company_offboarding_audit_events_immutable
  ON company_offboarding_case_audit_events;
CREATE TRIGGER company_offboarding_audit_events_immutable
  BEFORE UPDATE OR DELETE ON company_offboarding_case_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_company_offboarding_audit_mutation();