-- test-bootstrap: schema
-- Politika »Obvezni dodatek za storitev« je izrecno omogočena na ravni podjetja.
-- Privzeto ostane izključena, da obstoječe POS namestitve ne dobijo novega
-- režima brez potrditve uporabnika.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS employer_controlled_tips_enabled boolean NOT NULL DEFAULT false;