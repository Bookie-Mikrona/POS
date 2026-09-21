-- KORAK 5: company-scope frekvenca zbirnih POS temeljnic.
-- Prejšnji frekvenci sta interna podatka za varen preklop s 1. naslednjega meseca.
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS sales_booking_frequency varchar(10) NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS consumption_booking_frequency varchar(10) NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS frequency_effective_from date,
  ADD COLUMN IF NOT EXISTS sales_booking_frequency_previous varchar(10),
  ADD COLUMN IF NOT EXISTS consumption_booking_frequency_previous varchar(10);

ALTER TABLE pos_booking_settings
  DROP CONSTRAINT IF EXISTS pos_booking_settings_sales_booking_frequency_check;
ALTER TABLE pos_booking_settings
  ADD CONSTRAINT pos_booking_settings_sales_booking_frequency_check
  CHECK (sales_booking_frequency IN ('daily', 'monthly'));

ALTER TABLE pos_booking_settings
  DROP CONSTRAINT IF EXISTS pos_booking_settings_consumption_booking_frequency_check;
ALTER TABLE pos_booking_settings
  ADD CONSTRAINT pos_booking_settings_consumption_booking_frequency_check
  CHECK (consumption_booking_frequency IN ('daily', 'monthly'));

ALTER TABLE pos_booking_settings
  DROP CONSTRAINT IF EXISTS pos_booking_settings_sales_booking_frequency_previous_check;
ALTER TABLE pos_booking_settings
  ADD CONSTRAINT pos_booking_settings_sales_booking_frequency_previous_check
  CHECK (sales_booking_frequency_previous IS NULL OR sales_booking_frequency_previous IN ('daily', 'monthly'));

ALTER TABLE pos_booking_settings
  DROP CONSTRAINT IF EXISTS pos_booking_settings_consumption_booking_frequency_previous_check;
ALTER TABLE pos_booking_settings
  ADD CONSTRAINT pos_booking_settings_consumption_booking_frequency_previous_check
  CHECK (consumption_booking_frequency_previous IS NULL OR consumption_booking_frequency_previous IN ('daily', 'monthly'));