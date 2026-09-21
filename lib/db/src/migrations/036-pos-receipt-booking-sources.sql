-- 036: dokazna sled POS prejemnic v dnevni temeljnici za varno zapiranje 109.
CREATE TABLE IF NOT EXISTS pos_receipt_booking_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prejemnica_id integer NOT NULL REFERENCES prejemnice(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  net_amount numeric(14, 2) NOT NULL,
  CONSTRAINT pos_receipt_booking_sources_prejemnica_unique UNIQUE (prejemnica_id)
);