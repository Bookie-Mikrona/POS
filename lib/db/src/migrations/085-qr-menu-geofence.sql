ALTER TABLE enote
  ADD COLUMN IF NOT EXISTS qr_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS qr_longitude numeric(9, 6);

ALTER TABLE enote
  DROP CONSTRAINT IF EXISTS enote_qr_latitude_range,
  ADD CONSTRAINT enote_qr_latitude_range
    CHECK (qr_latitude IS NULL OR (qr_latitude >= -90 AND qr_latitude <= 90)),
  DROP CONSTRAINT IF EXISTS enote_qr_longitude_range,
  ADD CONSTRAINT enote_qr_longitude_range
    CHECK (qr_longitude IS NULL OR (qr_longitude >= -180 AND qr_longitude <= 180)),
  DROP CONSTRAINT IF EXISTS enote_qr_coordinates_pair,
  ADD CONSTRAINT enote_qr_coordinates_pair
    CHECK ((qr_latitude IS NULL) = (qr_longitude IS NULL));