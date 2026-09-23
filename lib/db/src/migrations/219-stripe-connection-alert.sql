-- test-bootstrap: audit
-- Historical source record only. Do not execute during selective restoration.
CREATE TABLE IF NOT EXISTS stripe_connection_alerts (
  alert_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 0),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);