ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS furs_state text NOT NULL DEFAULT 'pending'
    CHECK (furs_state IN ('pending', 'sending', 'confirmed', 'failed', 'unknown')),
  ADD COLUMN IF NOT EXISTS furs_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS furs_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS furs_last_error text,
  ADD COLUMN IF NOT EXISTS furs_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS furs_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS furs_claimed_by text,
  ADD COLUMN IF NOT EXISTS request_hash text;

UPDATE racuni
SET furs_state = CASE
  WHEN eor IS NOT NULL AND btrim(eor) <> '' THEN 'confirmed'
  -- Pri zgodovinskih napakah ni zanesljivega podatka, ali je FURS zahtevek
  -- sprejel, odgovor pa se je izgubil. Varneje je zahtevati ročno uskladitev.
  WHEN status = 'napaka' THEN 'unknown'
  ELSE 'pending'
END
WHERE furs_state = 'pending';

CREATE TABLE IF NOT EXISTS furs_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  racun_id integer NOT NULL REFERENCES racuni(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL,
  request_hash text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('confirmed', 'failed', 'unknown')),
  raw_response text,
  raw_error text,
  actor text NOT NULL
);

CREATE INDEX IF NOT EXISTS furs_attempts_racun_started_idx ON furs_attempts(racun_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS furs_attempts_attempt_id_unique ON furs_attempts(attempt_id);
CREATE INDEX IF NOT EXISTS racuni_furs_failed_retry_idx
  ON racuni(enota_id, ustvarjeno) WHERE furs_state = 'failed' AND request_hash IS NOT NULL;