-- test-bootstrap: schema
-- Popravi samo neurejene artikle iz samodejnih predlog; ročnih sprememb
-- stopenj in že izdanih nabavnih listin se ne dotikamo.
UPDATE artikli
SET davek = 22, tax_category = 'other'
WHERE drobni_inventar = true
  AND drobni_inventar_predloga_kljuc IS NOT NULL
  AND davek = 0
  AND tax_category = 'food';