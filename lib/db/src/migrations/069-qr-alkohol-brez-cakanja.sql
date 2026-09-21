-- QR alkohol se odslej takoj posreduje v pripravo. Zgodovinske čakalne
-- postavke normaliziramo, da jih noben starejši pogled ne pusti visečih.
UPDATE postavke
SET status_potrditve = 'potrjeno'
WHERE status_potrditve = 'caka_potrditev';