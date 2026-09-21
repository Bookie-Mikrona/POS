-- Development simulated POS card provider.  Kept idempotent for test and
-- post-merge runners; application code additionally denies it in production.
ALTER TABLE pos_karticna_placila_attempt
  DROP CONSTRAINT IF EXISTS pos_karticna_placila_attempt_provider_check;
ALTER TABLE pos_karticna_placila_attempt
  ADD CONSTRAINT pos_karticna_placila_attempt_provider_check
  CHECK (provider IN ('payten', 'sumup', 'viva_smart', 'viva_terminal', 'simulacija'));