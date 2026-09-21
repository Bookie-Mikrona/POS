-- test-bootstrap: audit
ALTER TABLE pos_actor_audit
  ADD COLUMN IF NOT EXISTS actor_clerk_user_id text;

-- Stare recovery vrstice so Clerk ID dobile iz strežniškega request konteksta,
-- vendar v JSON metadata. Prenesemo samo ta ozko določen, zaupanja vreden primer.
UPDATE pos_actor_audit
SET actor_clerk_user_id = NULLIF(metadata->>'actorUserId', ''),
    metadata = metadata - 'actorUserId'
WHERE action = 'card_payment_recovery_selected'
  AND actor_clerk_user_id IS NULL
  AND jsonb_typeof(metadata->'actorUserId') = 'string';

CREATE INDEX IF NOT EXISTS pos_actor_audit_enota_clerk_created_idx
  ON pos_actor_audit (enota_id, actor_clerk_user_id, created_at DESC);

COMMENT ON COLUMN pos_actor_audit.actor_clerk_user_id IS
  'Authenticated Clerk user who performed the action; waiter actor remains in natakar_id.';