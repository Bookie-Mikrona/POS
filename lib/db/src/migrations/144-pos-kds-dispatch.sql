CREATE TABLE IF NOT EXISTS kds_izdaja_dogodki (
  id bigserial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE RESTRICT,
  tip text NOT NULL DEFAULT 'predano' CHECK (tip = 'predano'),
  idempotency_key text NOT NULL,
  actor_clerk_user_id text NOT NULL,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kds_izdaja_dogodki_narocilo_unique UNIQUE (narocilo_id),
  CONSTRAINT kds_izdaja_dogodki_enota_idempotency_unique UNIQUE (enota_id, idempotency_key)
);

-- Preserve the audit record even if an earlier version of this idempotent
-- migration created the order FK with ON DELETE CASCADE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kds_izdaja_dogodki_narocilo_id_fkey'
      AND conrelid = 'kds_izdaja_dogodki'::regclass
      AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE kds_izdaja_dogodki
      DROP CONSTRAINT kds_izdaja_dogodki_narocilo_id_fkey;
    ALTER TABLE kds_izdaja_dogodki
      ADD CONSTRAINT kds_izdaja_dogodki_narocilo_id_fkey
      FOREIGN KEY (narocilo_id) REFERENCES narocila(id) ON DELETE RESTRICT;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS ix_kds_izdaja_dogodki_enota_narocilo
  ON kds_izdaja_dogodki (enota_id, narocilo_id);

-- Both references are tenant scoped at write time by the routes. A trigger
-- closes the cross-tenant FK gap that PostgreSQL's single-column FKs cannot.
CREATE OR REPLACE FUNCTION preveri_kds_izdaja_dogodek_enota() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM narocila WHERE id = NEW.narocilo_id AND enota_id = NEW.enota_id) THEN
    RAISE EXCEPTION 'KDS dispatch event order must belong to its unit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS kds_izdaja_dogodek_enota ON kds_izdaja_dogodki;
CREATE TRIGGER kds_izdaja_dogodek_enota BEFORE INSERT OR UPDATE ON kds_izdaja_dogodki
  FOR EACH ROW EXECUTE FUNCTION preveri_kds_izdaja_dogodek_enota();

CREATE OR REPLACE FUNCTION prevent_kds_izdaja_dogodek_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kds dispatch events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS kds_izdaja_dogodki_append_only ON kds_izdaja_dogodki;
CREATE TRIGGER kds_izdaja_dogodki_append_only
  BEFORE UPDATE OR DELETE ON kds_izdaja_dogodki
  FOR EACH ROW EXECUTE FUNCTION prevent_kds_izdaja_dogodek_mutation();