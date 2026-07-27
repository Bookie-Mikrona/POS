-- ============================================================================
-- Seed 001: Globalni FURS šifrant DDV kod (veljavno od 1. 7. 2025)
-- Spec: ERP 3. del, razdelek C.1 — DDV_KIR_KPR_1.xsd v1.3
--
-- Idempotentno: ON CONFLICT (code, valid_from) DO NOTHING
-- Nikoli ne briši ali posodabljaj obstoječih vrstic.
-- Za spremembo stopnje/mapiranja dodaj novo vrstico z novim valid_from.
-- ============================================================================

INSERT INTO vat_code (
    code, description, direction, rate, valid_from,
    kir_base_field, kpr_base_field, kir_vat_field, kpr_vat_field,
    triggers_rp_o, rp_o_column, is_reverse_charge, is_import
) VALUES

-- ════════════════════════════════════════════════════════════════════════════
-- IZDANA STRAN  direction = 'OUT'  →  KIR
-- ════════════════════════════════════════════════════════════════════════════

-- Domača prodaja (standardna + znižani stopnji)
('S22',      'Domača prodaja 22 %',                              'OUT', 22.00, '2025-07-01', 'P7',  NULL,  'P14', NULL,  FALSE, NULL,  FALSE, FALSE),
('S95',      'Domača prodaja 9,5 %',                             'OUT',  9.50, '2025-07-01', 'P7',  NULL,  'P15', NULL,  FALSE, NULL,  FALSE, FALSE),
('S5',       'Domača prodaja 5 %',                               'OUT',  5.00, '2025-07-01', 'P7',  NULL,  'P16', NULL,  FALSE, NULL,  FALSE, FALSE),

-- Domača dobava 76.a člen — kupec obračuna DDV
('S76A',     'Domača dobava — obrnjena obveznost 76.a člen',     'OUT',  0.00, '2025-07-01', 'P8',  NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Oproščeno brez pravice do odbitka (42. člen)
('SOP',      'Oproščena dobava brez pravice do odbitka (42.čl)', 'OUT',  0.00, '2025-07-01', 'P9',  NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Dobava blaga v EU (46. člen) → RP-O A3
('SEU-B',    'Dobava blaga v EU (46. čl.)',                      'OUT',  0.00, '2025-07-01', 'P10', NULL,  NULL,  NULL,  TRUE,  'A3',  FALSE, FALSE),

-- Tristranska dobava v EU → RP-O A3
('SEU-TR',   'Tristranska dobava v EU',                          'OUT',  0.00, '2025-07-01', 'P11', NULL,  NULL,  NULL,  TRUE,  'A3',  FALSE, FALSE),

-- Storitev v EU po 25. členu → RP-O B3
('SEU-S',    'Storitev v EU po 25. čl.',                         'OUT',  0.00, '2025-07-01', 'P27', NULL,  NULL,  NULL,  TRUE,  'B3',  FALSE, FALSE),

-- Prodaja blaga na daljavo (brez OSS)
('SDIST',    'Prodaja blaga na daljavo (brez OSS)',              'OUT',  0.00, '2025-07-01', 'P12', NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Dobava blaga z montažo/instaliranjem v EU
('SMONT',    'Dobava z montažo/instaliranjem v EU',              'OUT',  0.00, '2025-07-01', 'P13', NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Izvoz (52. člen)
('SEX',      'Izvoz (52. čl.)',                                  'OUT',  0.00, '2025-07-01', 'P7',  NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- OSS dobave in storitve zunaj SI
('SOSS',     'OSS dobave in storitve zunaj SI',                  'OUT',  0.00, '2025-07-01', 'P27', NULL,  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- ════════════════════════════════════════════════════════════════════════════
-- PREJETA STRAN  direction = 'IN'  →  KPR (+ pri samoobdavčitvi tudi KIR)
-- ════════════════════════════════════════════════════════════════════════════

-- Domača nabava
('P22',      'Domača nabava 22 %',                               'IN',  22.00, '2025-07-01', NULL,  'P8',  NULL,  'P18', FALSE, NULL,  FALSE, FALSE),
('P95',      'Domača nabava 9,5 %',                              'IN',   9.50, '2025-07-01', NULL,  'P8',  NULL,  'P19', FALSE, NULL,  FALSE, FALSE),
('P5',       'Domača nabava 5 %',                                'IN',   5.00, '2025-07-01', NULL,  'P8',  NULL,  'P20', FALSE, NULL,  FALSE, FALSE),

-- Nabava brez pravice do odbitka (DDV → KPR P17)
('PN22',     'Nabava brez pravice do odbitka 22 %',              'IN',  22.00, '2025-07-01', NULL,  'P8',  NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Domača obrnjena obveznost 76.a — RC (generira par OUT+IN v vat_ledger)
-- KIR DDV: P23/P24/P25 (samoobdavčitev 76.a)
('RC76A-22', 'Domača obrnjena obveznost 76.a — 22 %',            'IN',  22.00, '2025-07-01', NULL,  'P9',  'P23', 'P18', FALSE, NULL,  TRUE,  FALSE),
('RC76A-95', 'Domača obrnjena obveznost 76.a — 9,5 %',           'IN',   9.50, '2025-07-01', NULL,  'P9',  'P24', 'P19', FALSE, NULL,  TRUE,  FALSE),
('RC76A-5',  'Domača obrnjena obveznost 76.a — 5 %',             'IN',   5.00, '2025-07-01', NULL,  'P9',  'P25', 'P20', FALSE, NULL,  TRUE,  FALSE),

-- Pridobitev blaga iz EU — RC (generira par OUT+IN)
-- POZOR: KIR DDV = P17/P19/P21 (pridobitev blaga EU) — NE P23/P24/P25!
('EUB22',    'Pridobitev blaga iz EU 22 %',                      'IN',  22.00, '2025-07-01', NULL,  'P10', 'P17', 'P18', FALSE, NULL,  TRUE,  FALSE),
('EUB95',    'Pridobitev blaga iz EU 9,5 %',                     'IN',   9.50, '2025-07-01', NULL,  'P10', 'P19', 'P19', FALSE, NULL,  TRUE,  FALSE),
('EUB5',     'Pridobitev blaga iz EU 5 %',                       'IN',   5.00, '2025-07-01', NULL,  'P10', 'P21', 'P20', FALSE, NULL,  TRUE,  FALSE),

-- Storitve iz EU 25. člen — RC (generira par OUT+IN)
-- POZOR: KIR DDV = P18/P20/P22 (prejete storitve EU) — NE P23/P24/P25!
-- To je pogosta napaka razvijalcev — storitve 25. čl. niso enake 76.a!
('EUS22',    'Storitev iz EU (25. čl.) 22 %',                    'IN',  22.00, '2025-07-01', NULL,  'P11', 'P18', 'P18', FALSE, NULL,  TRUE,  FALSE),
('EUS95',    'Storitev iz EU (25. čl.) 9,5 %',                   'IN',   9.50, '2025-07-01', NULL,  'P11', 'P20', 'P19', FALSE, NULL,  TRUE,  FALSE),
('EUS5',     'Storitev iz EU (25. čl.) 5 %',                     'IN',   5.00, '2025-07-01', NULL,  'P11', 'P22', 'P20', FALSE, NULL,  TRUE,  FALSE),

-- Storitve iz tretjih držav — RC (generira par OUT+IN)
('TS22',     'Storitev iz tretjih držav 22 %',                   'IN',  22.00, '2025-07-01', NULL,  'P8',  'P23', 'P18', FALSE, NULL,  TRUE,  FALSE),
('TS95',     'Storitev iz tretjih držav 9,5 %',                  'IN',   9.50, '2025-07-01', NULL,  'P8',  'P24', 'P19', FALSE, NULL,  TRUE,  FALSE),
('TS5',      'Storitev iz tretjih držav 5 %',                    'IN',   5.00, '2025-07-01', NULL,  'P8',  'P25', 'P20', FALSE, NULL,  TRUE,  FALSE),

-- Uvoz — obračunski DDV 77. člen — RC (generira par OUT+IN)
-- POZOR: vsi uvozi KIR DDV gre skupaj v P26 (ne ločeno po stopnjah)
('UV22',     'Uvoz — obračunski DDV 77. čl. 22 %',               'IN',  22.00, '2025-07-01', NULL,  'P8',  'P26', 'P18', FALSE, NULL,  TRUE,  TRUE),
('UV95',     'Uvoz — obračunski DDV 77. čl. 9,5 %',              'IN',   9.50, '2025-07-01', NULL,  'P8',  'P26', 'P19', FALSE, NULL,  TRUE,  TRUE),
('UV5',      'Uvoz — obračunski DDV 77. čl. 5 %',                'IN',   5.00, '2025-07-01', NULL,  'P8',  'P26', 'P20', FALSE, NULL,  TRUE,  TRUE),

-- Uvoz — DDV plačan carini (ni samoobdavčitev, ni para v vat_ledger)
('UVP22',    'Uvoz — DDV plačan carini 22 %',                    'IN',  22.00, '2025-07-01', NULL,  'P8',  NULL,  'P18', FALSE, NULL,  FALSE, TRUE),

-- Oproščena nabava / pridobitev / uvoz
('POP',      'Oproščena nabava / pridobitev / uvoz',             'IN',   0.00, '2025-07-01', NULL,  'P14', NULL,  NULL,  FALSE, NULL,  FALSE, FALSE),

-- Pavšalno nadomestilo 8 % (odkup od pavšalistov)
-- Osnova v P8; nadomestilo v KPR P21
('PAV8',     'Pavšalno nadomestilo 8 % (odkup od pavšalistov)',  'IN',   8.00, '2025-07-01', NULL,  'P8',  NULL,  'P21', FALSE, NULL,  FALSE, FALSE)

ON CONFLICT (code, valid_from) DO NOTHING;
