-- test-bootstrap: schema
-- Kanonizacija zapisov enot nabavnih artiklov. Količine, cene, normativi,
-- zgodovinske postavke prejemnic in zalogovni gibi ostanejo nespremenjeni.
-- Neznanih ali neenakovrednih enot ne pretvarjamo.
UPDATE artikli
SET enota_mere = CASE upper(btrim(enota_mere))
  WHEN 'KOS' THEN 'H87'
  WHEN 'KOM' THEN 'H87'
  WHEN 'PCE' THEN 'H87'
  WHEN 'EA' THEN 'H87'
  WHEN 'KG' THEN 'KGM'
  WHEN 'G' THEN 'GRM'
  WHEN 'L' THEN 'LTR'
  WHEN 'ML' THEN 'MLT'
  WHEN 'M' THEN 'MTR'
  WHEN 'M2' THEN 'MTK'
  WHEN 'M3' THEN 'MTQ'
  WHEN 'KAR' THEN 'CT'
  WHEN 'SKA' THEN 'BX'
END
WHERE nabavni_artikel = true
  AND upper(btrim(enota_mere)) IN (
    'KOS', 'KOM', 'PCE', 'EA', 'KG', 'G', 'L', 'ML',
    'M', 'M2', 'M3', 'KAR', 'SKA'
  );