-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS viva_refund_alert_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  overdue_hours integer NOT NULL DEFAULT 24,
  critical_hours integer NOT NULL DEFAULT 72,
  CONSTRAINT viva_refund_alert_thresholds CHECK (
    overdue_hours >= 1 AND critical_hours > overdue_hours AND critical_hours <= 8760
  )
);
CREATE TABLE IF NOT EXISTS viva_refund_alerts (
  id serial PRIMARY KEY,
  refund_id integer NOT NULL REFERENCES viva_vracila(id),
  threshold text NOT NULL,
  threshold_hours integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT viva_refund_alert_once_per_threshold UNIQUE (refund_id, threshold),
  CONSTRAINT viva_refund_alert_threshold CHECK (threshold IN ('overdue', 'critical'))
);
CREATE INDEX IF NOT EXISTS viva_refund_alerts_active_idx
  ON viva_refund_alerts(refund_id) WHERE closed_at IS NULL;

-- The scheduler locks the refund row before inserting alerts. The resolving
-- UPDATE takes the same row lock, so no active alert can appear after resolution.
CREATE OR REPLACE FUNCTION close_viva_refund_alerts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('paid', 'failed') THEN
    UPDATE viva_refund_alerts SET closed_at = now()
      WHERE refund_id = NEW.id AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS viva_refund_alert_resolution ON viva_vracila;
CREATE TRIGGER viva_refund_alert_resolution AFTER UPDATE OF status ON viva_vracila
FOR EACH ROW EXECUTE FUNCTION close_viva_refund_alerts();
