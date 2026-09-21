-- 013-furs-vat-codes-new.sql
-- Doda manjkajoče FURS DDV kode:
--   PN5, PN95   — Nabava brez pravice do odbitka pri znižanih stopnjah (po vzoru PN22)
--   UVP95, UVP5 — Uvoz DDV plačan carini pri znižanih stopnjah (po vzoru UVP22)
--
-- Idempotentno: ON CONFLICT (code, valid_from) DO NOTHING

INSERT INTO vat_code (
  code, description, direction, rate,
  valid_from, valid_to,
  kir_base_field, kpr_base_field, kir_vat_field, kpr_vat_field,
  triggers_rp_o, triggers_pd_o, is_reverse_charge, is_import
) VALUES
-- Nabava brez pravice do odbitka — znižane stopnje
-- kpr_vat_field = NULL → isNonDeductible=true; DDV pristane v P17 prek vatDeductionPercent=0
('PN95', 'Nabava brez pravice do odbitka 9,5 %', 'IN',  9.50, '2025-07-01', NULL, NULL, 'P8', NULL, NULL, FALSE, FALSE, FALSE, FALSE),
('PN5',  'Nabava brez pravice do odbitka 5 %',   'IN',  5.00, '2025-07-01', NULL, NULL, 'P8', NULL, NULL, FALSE, FALSE, FALSE, FALSE),

-- Uvoz DDV plačan carini — znižane stopnje (kpr_vat_field nastavljeno → odbitni DDV)
('UVP95', 'Uvoz — DDV plačan carini 9,5 %', 'IN', 9.50, '2025-07-01', NULL, NULL, 'P8', NULL, 'P19', FALSE, FALSE, FALSE, TRUE),
('UVP5',  'Uvoz — DDV plačan carini 5 %',   'IN', 5.00, '2025-07-01', NULL, NULL, 'P8', NULL, 'P20', FALSE, FALSE, FALSE, TRUE)

ON CONFLICT (code, valid_from) DO NOTHING;
