ALTER TABLE enote
  ADD COLUMN IF NOT EXISTS hospitality_profile text NOT NULL DEFAULT 'restaurant',
  ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY[
    'tables','checkout','shifts','receipts','kitchen','bar','prepared_food',
    'plate_waste','menu','inventory','statistics','operational_reports',
    'realization','journals','cash_movements','hours','simulation','settings',
    'reservations','delivery','phone_orders','qr_menu','multi_course',
    'self_service','events','stock_transfers','deposits_tokens'
  ]::text[],
  ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_location text,
  ADD COLUMN IF NOT EXISTS parent_unit_id integer REFERENCES enote(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_from timestamptz,
  ADD COLUMN IF NOT EXISTS active_to timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_hospitality_profile_check') THEN
    ALTER TABLE enote ADD CONSTRAINT enote_hospitality_profile_check CHECK (
      hospitality_profile IN (
        'restaurant','inn','fine_dining','self_service','fast_food','bar',
        'cafe_pastry','tourist_farm','festival_society','event_stall',
        'catering_celebrations','food_truck','hotel_food_service'
      )
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_active_range_check') THEN
    ALTER TABLE enote ADD CONSTRAINT enote_active_range_check
      CHECK (active_from IS NULL OR active_to IS NULL OR active_to > active_from) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_service_mode_check') THEN
    ALTER TABLE enote ADD CONSTRAINT enote_service_mode_check CHECK (
      service_mode IN ('table_service','counter','self_service','mobile_event','catering','mixed')
    ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS enote_parent_unit_idx ON enote(parent_unit_id);