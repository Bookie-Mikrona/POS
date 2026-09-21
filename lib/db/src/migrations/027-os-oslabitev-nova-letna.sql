-- 027: Metoda oslabitve OS — nova letna amortizacija po SRS 1.35+
--
-- oslabitev_nova_doba_let:       Metoda 2 — uporabnik vpiše novo (krajšo) preostalo dobo (leta).
--                                NULL = Metoda 1 (doba ostane iz stopnje).
-- oslabitev_nova_letna_am_rac:   Preračunana nova letna amortizacija (nova knjižna / preostala doba).
--                                Shrani se ob vnosu oslabitve, engine jo prevzame za vsa naslednja leta.
--                                NULL = ni oslabitve ali ni veljavne nove letne AM.

ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD COLUMN oslabitev_nova_doba_let     INTEGER,
  ADD COLUMN oslabitev_nova_letna_am_rac NUMERIC(14,2);
