-- test-bootstrap: schema
-- Polizdelki niso prodajni, nabavni ali povratna embalaža in nimajo računovodske vrste.
BEGIN;

ALTER TABLE artikli ALTER COLUMN vrsta_artikla DROP NOT NULL;

UPDATE artikli
SET vrsta_artikla = NULL
WHERE nabavni_artikel = false
  AND prodajni_artikel = false
  AND povratna_embalaza = false
  AND vrsta_artikla IS NOT NULL;

COMMIT;