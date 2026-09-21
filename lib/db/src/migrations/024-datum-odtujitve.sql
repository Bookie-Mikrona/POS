-- 024-datum-odtujitve.sql
-- Doda datum_odtujitve in razlog_izlocitve na glavo osnovnih sredstev.
--
-- datum_odtujitve: datum prodaje/odtujitve/uničenja celotnega sredstva.
--   Amortizacija se preneha obračunavati s PRVIM DNEM MESECA odtujitve
--   (= zadnji mesec amortizacije je mesec pred odtujitvijo).
--   Primer: odtujitev 15.10.2026 → zadnji mesec = september → 9 mesecev (jan–sep).
--
-- razlog_izlocitve: besedilni razlog (prodaja/odpis/uničenje/…).

ALTER TABLE osnovna_sredstva
  ADD COLUMN IF NOT EXISTS datum_odtujitve date,
  ADD COLUMN IF NOT EXISTS razlog_izlocitve text;
