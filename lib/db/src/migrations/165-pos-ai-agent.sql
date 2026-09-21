CREATE TABLE IF NOT EXISTS pos_ai_agent_audit (
  id bigserial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  naprava_id integer REFERENCES naprave(id) ON DELETE SET NULL,
  actor_natakar_id integer NOT NULL REFERENCES natakari(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_ai_agent_audit_enota_created_idx
  ON pos_ai_agent_audit(enota_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_ai_agent_memory (
  id bigserial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  actor_natakar_id integer NOT NULL REFERENCES natakari(id) ON DELETE RESTRICT,
  preference_key text NOT NULL,
  preference_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(enota_id, actor_natakar_id, preference_key)
);