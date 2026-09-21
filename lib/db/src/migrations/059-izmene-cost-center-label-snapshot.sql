-- 059-izmene-cost-center-label-snapshot.sql
--
-- Izmena mora ohraniti oznako stroškovnega mesta, veljavno ob odprtju.
-- UUID ostane povezava za tehnično sledljivost, koda in naziv pa nista
-- odvisna od kasnejšega preimenovanja ali odstranitve šifranta.

ALTER TABLE izmene
  ADD COLUMN IF NOT EXISTS cost_center_code text,
  ADD COLUMN IF NOT EXISTS cost_center_name text;

-- Zamrzni tudi obstoječo zgodovino ob uvedbi migracije. Prejšnjih nazivov
-- pred uvedbo ne moremo rekonstruirati, lahko pa preprečimo vsako nadaljnjo
-- spremembo prikaza zaradi urejanja šifranta.
UPDATE izmene AS i
SET
  cost_center_code = COALESCE(i.cost_center_code, cc.code),
  cost_center_name = COALESCE(i.cost_center_name, cc.name)
FROM enote AS e, cost_centers AS cc
WHERE e.id = i.enota_id
  AND cc.id = i.cost_center_id
  AND cc.company_id = e.company_id
  AND i.cost_center_id IS NOT NULL
  AND (i.cost_center_code IS NULL OR i.cost_center_name IS NULL);