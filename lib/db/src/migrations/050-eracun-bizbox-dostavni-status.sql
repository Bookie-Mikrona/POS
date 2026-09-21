-- 050-eracun-bizbox-dostavni-status.sql
-- Dodamo stolpca za sledenje dostave dokumenta prek bizBox omrežja.
--
-- e_racun_bizbox_id  : document ID iz odgovora POST /documents (result = integer/int64)
--                      Shranjen kot text, ker int64 vrednosti presegajo JS Number.MAX_SAFE_INTEGER.
-- e_racun_bizbox_status : status dostave po stanju pri bizBox:
--                         oddano      = ZIP uspešno oddan, docId shranjen
--                         v_obdelavi  = bizBox ga ima, dostava v teku
--                         dostavljeno = prejemnik potrdil prejem
--                         zavrnjeno   = bizBox ali prejemnik zavrnil
--                         napaka      = napaka pri preverjanju

ALTER TABLE racuni ADD COLUMN IF NOT EXISTS e_racun_bizbox_id text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS e_racun_bizbox_status text
  CONSTRAINT racuni_e_racun_bizbox_status_check
  CHECK (e_racun_bizbox_status IN ('oddano','v_obdelavi','dostavljeno','zavrnjeno','napaka'));
