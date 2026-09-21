-- test-bootstrap: schema
-- Različica profila in vrstice profila sta snapshot vhod za avtomatske
-- dodelitve.  Sam allocation se nikoli ne preračuna ob spremembi profila.
CREATE TABLE IF NOT EXISTS tip_distribution_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tip_distribution_profiles_date_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS tip_distribution_profile_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES tip_distribution_profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  recipient_natakar_id integer NOT NULL REFERENCES natakari(id) ON DELETE RESTRICT,
  recipient_snapshot text NOT NULL,
  share_percent numeric(7,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tip_distribution_profile_entries_share_check
    CHECK (share_percent > 0 AND share_percent <= 100)
);

CREATE INDEX IF NOT EXISTS tip_distribution_profiles_unit_effective_idx
  ON tip_distribution_profiles(company_id, enota_id, effective_from);
CREATE INDEX IF NOT EXISTS tip_distribution_profile_entries_profile_idx
  ON tip_distribution_profile_entries(profile_id);

ALTER TABLE tip_allocations
  ADD COLUMN IF NOT EXISTS distribution_profile_id uuid
    REFERENCES tip_distribution_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS distribution_profile_entry_id uuid
    REFERENCES tip_distribution_profile_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS distribution_group text,
  ADD COLUMN IF NOT EXISTS distribution_share_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS distribution_profile_snapshot jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS tip_allocations_auto_profile_entry_unique
  ON tip_allocations(racun_id, distribution_profile_id, distribution_profile_entry_id)
  WHERE allocation_kind = 'auto' AND distribution_profile_entry_id IS NOT NULL;

-- Profile effective ranges are serialized and checked by the API.  This
-- constraint also prevents an unsafe overlap when two API writers race.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE tip_distribution_profiles
  DROP CONSTRAINT IF EXISTS tip_distribution_profiles_unit_no_overlap;
ALTER TABLE tip_distribution_profiles
  ADD CONSTRAINT tip_distribution_profiles_unit_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    enota_id WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  );