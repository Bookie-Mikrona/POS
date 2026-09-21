-- 022: Pravilo začetka amortizacije po SRS
-- Dodamo nastavitev podjetja za izbiro med dvema praviloma prvega meseca amortizacije:
--   'naslednji_dan'   … amortizacija se začne v mesecu, v katerega pade (datum_aktivacije + 1 dan)
--   'naslednji_mesec' … amortizacija se začne v mesecu PO mesecu aktivacije (+ 1 mesec)
-- Privzeto: 'naslednji_dan' (zakonsko pogostejše; nastavljivo per-company).

ALTER TABLE os_amortizacija_nastavitve
  ADD COLUMN pravilo_zacetka_amortizacije TEXT
    NOT NULL
    DEFAULT 'naslednji_dan'
    CHECK (pravilo_zacetka_amortizacije IN ('naslednji_dan', 'naslednji_mesec'));
