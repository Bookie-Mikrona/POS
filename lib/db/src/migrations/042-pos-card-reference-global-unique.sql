-- Izvorni ID SumUp/Viva je globalen; obseg mora biti enak zaščitnima
-- indeksoma na računih, sicer bi druga družba lahko prišla do FURS pred
-- poznejšo napako globalne omejitve računa.

DROP INDEX IF EXISTS pos_karticna_placila_reference_unique;
CREATE UNIQUE INDEX pos_karticna_placila_reference_unique
  ON pos_karticna_placila_reference (provider, referenca);