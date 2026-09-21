-- 0011_profil_tip.sql
--
-- Doda polje 'tip' na tabelo uvoz_profil.
-- Vrednosti: 'PREJEMNICA' (za uvoz dobavnic) ali 'CENIK' (za uvoz cenika).
-- Obstoječi profili samodejno dobijo vrednost 'PREJEMNICA'.
--
-- Migracija je idempotentna: ADD COLUMN IF NOT EXISTS ne vrže napake
-- pri ponovnem zagonu.

ALTER TABLE uvoz_profil
  ADD COLUMN IF NOT EXISTS tip text NOT NULL DEFAULT 'PREJEMNICA';

-- CHECK constraint (idempotentno prek bloka DO)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_profil_tip'
       AND conrelid = 'uvoz_profil'::regclass
  ) THEN
    ALTER TABLE uvoz_profil
      ADD CONSTRAINT ck_profil_tip CHECK (tip IN ('PREJEMNICA', 'CENIK'));
  END IF;
END $$;
