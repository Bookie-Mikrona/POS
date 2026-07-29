-- ============================================================================
-- Migration 006: DDV razreševalnik — nova polja in vat_rule tabela
-- Dodaja: taxCategory, addedSugar, knCode (artikli); toGo (narocila);
--         appliedRuleId (postavke); addedSugar (modifikatorji); vat_rule tabela
-- ============================================================================

-- ── 1. artikli — nova DDV polja ───────────────────────────────────────────────
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS tax_category TEXT NOT NULL DEFAULT 'food',
  ADD COLUMN IF NOT EXISTS added_sugar  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kn_code      TEXT;

-- OPOMBA: Obstoječe vrstice ostanejo tax_category='food' (privzeto).
-- Davčna kategorija se nastavi ročno po artiklu prek Menu → Uredi artikel → DDV kategorija.
-- Samodejno prerazvrščanje po davčni stopnji ni varno (alkohol in topla pijača imata oba 22%).

-- ── 2. modifikatorji — dodan sladkor ─────────────────────────────────────────
ALTER TABLE modifikatorji
  ADD COLUMN IF NOT EXISTS added_sugar BOOLEAN NOT NULL DEFAULT false;

-- ── 3. narocila — to_go zastavica ────────────────────────────────────────────
ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS to_go BOOLEAN NOT NULL DEFAULT false;

-- ── 4. postavke — applied_rule_id (revizijska sled) ──────────────────────────
ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS applied_rule_id INTEGER;

-- ── 5. vat_rule — tabela DDV pravil ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vat_rule (
  id           SERIAL PRIMARY KEY,
  priority     INTEGER NOT NULL DEFAULT 100,
  supply_kind  TEXT,
  tax_category TEXT,
  added_sugar  BOOLEAN,
  rate         NUMERIC(5,2) NOT NULL,
  configurable BOOLEAN NOT NULL DEFAULT false,
  label        TEXT NOT NULL
);

-- ── 6. Privzeta pravila (INSERT only if empty) ────────────────────────────────
INSERT INTO vat_rule (priority, supply_kind, tax_category, added_sugar, rate, configurable, label)
SELECT * FROM (VALUES
  (10, 'eat_in',  'food',          NULL::boolean,  9.50, false, 'Hrana na mestu'),
  (10, 'to_go',   'food',          NULL::boolean,  9.50, false, 'Hrana za s seboj'),
  (10, 'eat_in',  'hot_beverage',  NULL::boolean, 22.00, false, 'Topla pijača na mestu'),
  (20, 'to_go',   'hot_beverage',  true,          22.00, false, 'Topla pijača za s seboj (s sladkorjem)'),
  (30, 'to_go',   'hot_beverage',  false,          9.50, true,  'Topla pijača za s seboj (brez sladkorja) — liberalno'),
  (35, 'to_go',   'hot_beverage',  false,         22.00, false, 'Topla pijača za s seboj (brez sladkorja) — konservativno'),
  (10, 'eat_in',  'cold_beverage', NULL::boolean,  9.50, false, 'Hladna pijača na mestu'),
  (10, 'to_go',   'cold_beverage', NULL::boolean,  9.50, false, 'Hladna pijača za s seboj'),
  (10, NULL,      'alcoholic',     NULL::boolean, 22.00, false, 'Alkoholna pijača')
) AS defaults(priority, supply_kind, tax_category, added_sugar, rate, configurable, label)
WHERE NOT EXISTS (SELECT 1 FROM vat_rule LIMIT 1);
