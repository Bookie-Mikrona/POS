-- 033: STM (stroškovno mesto) na POS poslovnih enotah
-- Nullable, brez FK constraint — mehka referenca, obstoječe enote ostanejo veljavne.
-- Company-scope preverba se izvaja v API (POST/PUT /api/enote).
ALTER TABLE enote ADD COLUMN IF NOT EXISTS cost_center_id uuid;
