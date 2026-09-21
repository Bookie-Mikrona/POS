-- Naloga #138: Samodejno nastavi DDV kode na POS→ERP dnevnih temeljnicah
--
-- DDV vrstice v POS→ERP temeljnicah niso imele vatCodeId → vat_ledger je bil
-- prazen za ves POS promet. Rešitev: dve novi FK polji v pos_booking_settings
-- ki kažeta na globalni vat_code šifrant.
--
-- Računovodja izbere:
--   vat95_vat_code_id  → DDV koda za 9,5 % izhodni DDV (npr. SI-25-K za KIR)
--   vat22_vat_code_id  → DDV koda za 22 % izhodni DDV
-- Ko sta obe nastavljeni, insertEntry() nastavi vatCodeId na DDV vrstici
-- in ta vrstica bo ob potrditvi temeljnice ustvarila vat_ledger zapis.

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS vat95_vat_code_id uuid
    REFERENCES vat_code(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vat22_vat_code_id uuid
    REFERENCES vat_code(id) ON DELETE SET NULL;

COMMENT ON COLUMN pos_booking_settings.vat95_vat_code_id IS
  'FURS DDV koda za izhodni DDV 9,5 % (KIR). '
  'Če je NULL, DDV vrstica nima vatCodeId → ne gre v vat_ledger.';

COMMENT ON COLUMN pos_booking_settings.vat22_vat_code_id IS
  'FURS DDV koda za izhodni DDV 22 % (KIR). '
  'Če je NULL, DDV vrstica nima vatCodeId → ne gre v vat_ledger.';
