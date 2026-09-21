-- 023-os-obracun-pravilo.sql
-- Glavi obračuna doda:
--   pravilo_zacetka_amortizacije  — pravilo, ki je bilo veljavno ob zagonu obračuna
--   vhodni_podpis                 — SHA-256 hash vhodnih podatkov (pravilo + doknjižbe)
-- Oba stolpca sta nullable → NULL za obstoječe zapise (ne sproži opozorila zastarelosti).

ALTER TABLE os_amortizacija_obracun
  ADD COLUMN IF NOT EXISTS pravilo_zacetka_amortizacije TEXT,
  ADD COLUMN IF NOT EXISTS vhodni_podpis TEXT;
