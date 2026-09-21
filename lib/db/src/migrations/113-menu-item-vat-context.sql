ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS je_del_menija boolean NOT NULL DEFAULT false;

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS je_del_menija boolean NOT NULL DEFAULT false;
