-- lib/db/src/migrations/0012_bizbox_polja.sql
--
-- Faza B: bizBox pošiljanje e-računov.
-- Tabeli racuni dodamo dve novi polji za sledenje oddaje prek bizBox
-- in razširimo CHECK constraint za e_racun_status z vrednostjo 'poslano'.
--
-- Migracija je idempotentna (ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT).

-- 1) Nova stolpca
ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS e_racun_poslano_dne   timestamptz,
  ADD COLUMN IF NOT EXISTS e_racun_bizbox_odgovor text;

-- 2) Razširi CHECK constraint z 'poslano'
--    Najprej odstranimo obstoječega (ime je privzeto generirano s strani PG),
--    nato dodamo novega.
ALTER TABLE racuni DROP CONSTRAINT IF EXISTS racuni_e_racun_status_check;
ALTER TABLE racuni
  ADD CONSTRAINT racuni_e_racun_status_check
    CHECK (e_racun_status IN ('pripravljen', 'poslan', 'poslano', 'napaka'));

-- Indeks za hitro iskanje računov z aktivnim e-računom (posodobi obstoječi)
DROP INDEX IF EXISTS ix_racuni_eracun_status;
CREATE INDEX IF NOT EXISTS ix_racuni_eracun_status
  ON racuni (e_racun_status)
  WHERE e_racun_status IS NOT NULL;
