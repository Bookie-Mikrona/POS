-- ============================================================================
-- Migration 008: Tloris — pozicija mize (pos_x, pos_y)
-- Dodaja opcijska stolpca za koordinate mize na tlorisu prostora.
-- NULL pomeni, da pozicija ni nastavljena (prikaz v mreži kot prej).
-- ============================================================================

ALTER TABLE mize
  ADD COLUMN IF NOT EXISTS pos_x integer,
  ADD COLUMN IF NOT EXISTS pos_y integer;
