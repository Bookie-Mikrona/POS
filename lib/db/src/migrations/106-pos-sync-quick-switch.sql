-- Durable server acknowledgement ledger.  A unique operation id makes replay
-- safe even when the client loses the response after a committed write.
CREATE TABLE IF NOT EXISTS pos_sync_operations (
  operation_id uuid PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  checksum text NOT NULL,
  method text NOT NULL DEFAULT '',
  path text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('processing', 'applied', 'rejected', 'needs_review')),
  response_status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pos_sync_operations ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT '';
ALTER TABLE pos_sync_operations ADD COLUMN IF NOT EXISTS path text NOT NULL DEFAULT '';
ALTER TABLE pos_sync_operations ADD COLUMN IF NOT EXISTS response_status integer;
ALTER TABLE pos_sync_operations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pos_sync_operations DROP CONSTRAINT IF EXISTS pos_sync_operations_status_check;
ALTER TABLE pos_sync_operations ADD CONSTRAINT pos_sync_operations_status_check
  CHECK (status IN ('processing', 'applied', 'rejected', 'needs_review'));
CREATE INDEX IF NOT EXISTS pos_sync_operations_enota_created_idx
  ON pos_sync_operations(enota_id, created_at DESC);

-- PIN is intentionally a one-way hash; never persist a cleartext quick-switch
-- PIN.  Lock state is server-owned so changing browser/device cannot bypass it.
ALTER TABLE natakari ADD COLUMN IF NOT EXISTS pos_pin_hash text;
ALTER TABLE natakari ADD COLUMN IF NOT EXISTS pos_pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE natakari ADD COLUMN IF NOT EXISTS pos_pin_locked_until timestamptz;
CREATE TABLE IF NOT EXISTS pos_actor_audit (
  id bigserial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  natakar_id integer REFERENCES natakari(id) ON DELETE SET NULL,
  actor_user_id integer,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);