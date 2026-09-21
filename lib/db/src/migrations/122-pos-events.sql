CREATE TABLE IF NOT EXISTS pos_events (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  location text NOT NULL,
  customer_name text,
  customer_contact text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_events_type_check CHECK (type IN ('festival','wedding','catering','celebration','other')),
  CONSTRAINT pos_events_status_check CHECK (status IN ('planned','active','closed','cancelled')),
  CONSTRAINT pos_events_period_check CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS pos_event_units (
  event_id integer NOT NULL REFERENCES pos_events(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, enota_id)
);

CREATE INDEX IF NOT EXISTS ix_pos_events_unit_start ON pos_events(enota_id, starts_at);
CREATE INDEX IF NOT EXISTS ix_pos_events_status ON pos_events(status);
CREATE INDEX IF NOT EXISTS ix_pos_event_units_unit ON pos_event_units(enota_id);