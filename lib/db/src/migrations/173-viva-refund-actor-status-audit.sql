-- test-bootstrap: audit
ALTER TABLE viva_vracila
  ADD COLUMN IF NOT EXISTS actor_clerk_user_id text,
  ADD COLUMN IF NOT EXISTS actor_natakar_id integer,
  ADD COLUMN IF NOT EXISTS naprava_kljuc text;

CREATE TABLE IF NOT EXISTS viva_vracilo_status_prehodi (
  id serial PRIMARY KEY,
  viva_vracilo_id integer NOT NULL REFERENCES viva_vracila(id) ON DELETE CASCADE,
  enota_id integer NOT NULL,
  prejsnji_status text,
  novi_status text NOT NULL,
  napaka text,
  actor_clerk_user_id text,
  actor_natakar_id integer,
  naprava_kljuc text,
  provider_referenca text NOT NULL,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viva_vracilo_status_prehodi_prejsnji_status_check
    CHECK (prejsnji_status IS NULL OR prejsnji_status IN ('pending', 'unknown', 'paid', 'failed')),
  CONSTRAINT viva_vracilo_status_prehodi_novi_status_check
    CHECK (novi_status IN ('pending', 'unknown', 'paid', 'failed'))
);

CREATE INDEX IF NOT EXISTS viva_vracilo_status_prehodi_refund_created_idx
  ON viva_vracilo_status_prehodi (viva_vracilo_id, ustvarjeno);

CREATE INDEX IF NOT EXISTS viva_vracilo_status_prehodi_enota_created_idx
  ON viva_vracilo_status_prehodi (enota_id, ustvarjeno);

INSERT INTO viva_vracilo_status_prehodi (
  viva_vracilo_id,
  enota_id,
  prejsnji_status,
  novi_status,
  napaka,
  actor_clerk_user_id,
  actor_natakar_id,
  naprava_kljuc,
  provider_referenca,
  ustvarjeno
)
SELECT
  v.id,
  v.enota_id,
  NULL,
  v.status,
  v.napaka,
  v.actor_clerk_user_id,
  v.actor_natakar_id,
  v.naprava_kljuc,
  v.refund_session_id,
  v.ustvarjeno
FROM viva_vracila v
WHERE NOT EXISTS (
  SELECT 1
  FROM viva_vracilo_status_prehodi p
  WHERE p.viva_vracilo_id = v.id
);