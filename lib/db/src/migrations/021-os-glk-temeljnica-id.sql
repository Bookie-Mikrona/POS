-- 021 — Poveži OS obračun z GLK osnutkom temeljnice
-- Dodamo glk_temeljnica_id na os_amortizacija_obracun:
--   NULL  → GLK osnutek še ni bil ustvarjen (OS-only podjetje ali obračun pred 3a)
--   UUID  → FK na journal_entries.id (draft osnutek za to leto)

ALTER TABLE os_amortizacija_obracun
  ADD COLUMN IF NOT EXISTS glk_temeljnica_id UUID
    REFERENCES journal_entries(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN os_amortizacija_obracun.glk_temeljnica_id IS
  'FK na journal_entries.id: draft osnutek temeljnice v GLK za to leto (NULL = OS-only ali brez GLK modula)';
