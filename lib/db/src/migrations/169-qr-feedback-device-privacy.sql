-- test-bootstrap: privacy
-- The QR device token is required only before feedback submission to prove
-- ownership of the completed QR order. One-feedback-per-order is enforced by
-- ux_qr_gost_povratne_informacije_narocilo, so retaining the device token on
-- the immutable feedback row creates correlation risk without a security use.
DROP INDEX IF EXISTS ix_qr_gost_povratne_informacije_enota_naprava_created;

ALTER TABLE IF EXISTS qr_gost_povratne_informacije
  DROP COLUMN IF EXISTS qr_naprava_id;