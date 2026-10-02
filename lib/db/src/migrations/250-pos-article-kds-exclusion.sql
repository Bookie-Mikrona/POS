-- test-bootstrap: schema
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS kds_izkljucen boolean NOT NULL DEFAULT false;