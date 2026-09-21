ALTER TABLE enote
  ADD COLUMN IF NOT EXISTS qr_wifi_networks text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE enote
  DROP CONSTRAINT IF EXISTS enote_qr_wifi_networks_limit,
  ADD CONSTRAINT enote_qr_wifi_networks_limit
    CHECK (cardinality(qr_wifi_networks) <= 20);