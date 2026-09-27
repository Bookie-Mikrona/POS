-- test-bootstrap: schema
-- Izvorni artikel podizbire ni dodatna prodajna postavka.
ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS modifier_source_article_id integer;