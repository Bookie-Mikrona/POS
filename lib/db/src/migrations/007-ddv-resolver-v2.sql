-- ============================================================================
-- Migration 007: DDV razreševalnik v2 — popravki pravil za pijače
-- Dodaja: sladkane hladne pijače (22 % povsod) + kategorija food_drink (9,5 % povsod)
-- Popravi: hladna pijača na mestu → 22 % (bilo napačno 9,5 %)
-- ============================================================================

-- ── 1. Sladkana hladna pijača — vedno 22 % (višja prioriteta) ────────────────
-- Brezalkoholne pijače z dodanim sladkorjem ali sladili so po FURS vedno 22 %,
-- ne glede na kanal (miza ali to-go). Edina izjema: pijača kot del menija (OOS).
INSERT INTO vat_rule (priority, supply_kind, tax_category, added_sugar, rate, configurable, label)
SELECT 5, NULL, 'cold_beverage', true, 22.00, false, 'Sladkana hladna pijača (vedno 22 %)'
WHERE NOT EXISTS (
  SELECT 1 FROM vat_rule WHERE label = 'Sladkana hladna pijača (vedno 22 %)'
);

-- ── 2. Popravi hladna pijača na mestu: 9,5 % → 22 % ─────────────────────────
-- Postrežena nesladkana hladna pijača za mizo je storitev strežbe → 22 %.
-- Pravilo za eat_in/cold_beverage je obstajalo z rate=9,5 %, kar je napačno.
UPDATE vat_rule
SET rate = 22.00
WHERE label = 'Hladna pijača na mestu'
  AND supply_kind = 'eat_in'
  AND tax_category = 'cold_beverage'
  AND rate = 9.50;

-- ── 3. Kategorija food_drink — 9,5 % v vsakem primeru ────────────────────────
-- „Napitki, ki se davčno štejejo za jed" po pojasnilu FURS:
-- gosta vroča čokolada (s priloženo žličko), smoothie, frappé kot jed, zamrznjeni jogurt.
-- Te dobijo 9,5 % tako za mizo kot to-go, ker gre za pripravo jedi, ne strežbo pijač.
INSERT INTO vat_rule (priority, supply_kind, tax_category, added_sugar, rate, configurable, label)
SELECT 10, NULL, 'food_drink', NULL, 9.50, false, 'Pijača-jed (vroča čokolada, smoothie, frappé)'
WHERE NOT EXISTS (
  SELECT 1 FROM vat_rule WHERE label = 'Pijača-jed (vroča čokolada, smoothie, frappé)'
);
