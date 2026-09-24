-- Enkratna uskladitev razvojnega šifranta Križišče po migraciji 224.
-- Ni samodejna migracija in ni namenjena produkcijski bazi. Ohrani ID-je,
-- normative in zgodovinske zalogovne zapise obstoječih dveh artiklov.
-- Dobaviteljeva postavka na prejemnici ostane ločena, cilj zaloge pa je skupina.
DO $generic_krizisce$
BEGIN
  PERFORM pg_advisory_xact_lock(1315924557, 309);
  PERFORM id FROM artikli WHERE id IN (25450, 25466) AND enota_id=309 FOR UPDATE;
  IF (SELECT count(*) FROM artikli
      WHERE enota_id=309 AND id IN (25450,25466)
        AND aktiven AND nabavni_artikel AND NOT prodajni_artikel
        AND enota_mere IN ('kg','KGM')) <> 2
     OR NOT EXISTS (SELECT 1 FROM artikli WHERE id=25450 AND ime='Sezonska zelenjava')
     OR NOT EXISTS (SELECT 1 FROM artikli WHERE id=25466 AND ime='Sadje')
     OR EXISTS (SELECT 1 FROM artikli WHERE enota_id=309
                AND ime IN ('Sezonska zelenjava – mešano','Sezonsko sadje'))
  THEN RAISE EXCEPTION 'Šifrant Križišče se je spremenil; skupin ni dovoljeno samodejno prevezati'; END IF;

  UPDATE artikli SET
    ime='Sezonska zelenjava – mešano',
    ime_za_nabavo='Sezonska zelenjava – mešano',
    enota_mere='KGM',
    je_skupinski_nabavni_artikel=true
  WHERE id=25450 AND enota_id=309;

  UPDATE artikli SET
    ime='Sezonsko sadje',
    ime_za_nabavo='Sezonsko sadje',
    enota_mere='KGM',
    je_skupinski_nabavni_artikel=true
  WHERE id=25466 AND enota_id=309;
END $generic_krizisce$;