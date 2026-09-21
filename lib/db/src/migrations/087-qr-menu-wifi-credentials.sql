ALTER TABLE enote
  ADD COLUMN IF NOT EXISTS qr_wifi_ssid text,
  ADD COLUMN IF NOT EXISTS qr_wifi_password text;

ALTER TABLE enote
  DROP CONSTRAINT IF EXISTS enote_qr_wifi_ssid_length,
  ADD CONSTRAINT enote_qr_wifi_ssid_length
    CHECK (qr_wifi_ssid IS NULL OR char_length(qr_wifi_ssid) <= 64),
  DROP CONSTRAINT IF EXISTS enote_qr_wifi_password_length,
  ADD CONSTRAINT enote_qr_wifi_password_length
    CHECK (qr_wifi_password IS NULL OR char_length(qr_wifi_password) <= 128);