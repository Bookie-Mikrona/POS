-- QR meni Faza 1a: varna, ponovljiva migracija.
-- Obstoječe mize in artikli dobijo varne privzete vrednosti brez izpada.
ALTER TABLE mize
  ADD COLUMN IF NOT EXISTS qr_token text;

ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS je_alkohol boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_na_voljo boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mize_qr_token
  ON mize (qr_token);