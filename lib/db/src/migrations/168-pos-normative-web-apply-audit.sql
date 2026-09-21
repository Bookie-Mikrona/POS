-- test-bootstrap: audit
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS normativ_revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS pos_normative_change_audit (
  id bigserial PRIMARY KEY,
  enota_id integer NOT NULL,
  artikel_id integer NOT NULL,
  normativ_row_id integer NOT NULL,
  ingredient_id integer NOT NULL,
  actor_clerk_user_id text NOT NULL,
  actor_natakar_id integer,
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_quantity numeric(10,4) NOT NULL,
  new_quantity numeric(10,4) NOT NULL,
  unit text NOT NULL,
  source_url text NOT NULL,
  source_title text NOT NULL,
  comparison_generated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pos_normative_change_audit_article_time_idx
  ON pos_normative_change_audit (artikel_id, changed_at DESC);
CREATE OR REPLACE FUNCTION prevent_pos_normative_change_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pos_normative_change_audit is append-only';
END;
$$;
DROP TRIGGER IF EXISTS pos_normative_change_audit_append_only ON pos_normative_change_audit;
CREATE TRIGGER pos_normative_change_audit_append_only
BEFORE UPDATE OR DELETE ON pos_normative_change_audit
FOR EACH ROW EXECUTE FUNCTION prevent_pos_normative_change_audit_mutation();