-- Enkratni popravek SAMO razvojne enote Križišče (309); ni samodejna migracija.
-- Izvedeno 2026-09-24. Če je popravek že izveden, varovalo namenoma zavrne ponovitev.
-- Omaka ohrani zgodovinske zalogovne povezave; izgine iz aktivnega nabavnega
-- šifranta in iz normativov. Sadna in Pičiči ostaneta brez paradižnikove omake.
-- Osnovne količine so za normalno pico; za malo že velja sistemski faktor
-- (28 / 32)^2 = 0.765625.
DO $pizza_sauce$
DECLARE
  pelati_id integer;
  olje_id integer;
  sol_id integer;
  affected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1315924557, 309);
  PERFORM id FROM artikli WHERE enota_id = 309 AND je_pica FOR UPDATE;
  IF (SELECT count(*) FROM artikli WHERE enota_id=309 AND je_pica) <> 19
     OR (SELECT count(*) FROM normativi n JOIN artikli p ON p.id=n.artikel_id WHERE p.enota_id=309 AND p.je_pica AND n.vhodni_artikel_id=25443) <> 17
     OR (SELECT count(*) FROM normativi n JOIN artikli p ON p.id=n.artikel_id WHERE p.enota_id=309 AND p.je_pica AND n.vhodni_artikel_id=25447) <> 17
     OR (SELECT count(*) FROM normativi WHERE vhodni_artikel_id=25443) <> 17
     OR (SELECT count(*) FROM modifikator_normativi WHERE vhodni_artikel_id=25443) <> 1
     OR (SELECT count(*) FROM modifikator_normativi WHERE modifikator_id=7476) <> 1
     OR EXISTS (SELECT 1 FROM normativi n JOIN artikli p ON p.id=n.artikel_id WHERE p.enota_id=309 AND p.je_pica AND n.vhodni_artikel_id=25443 AND NOT EXISTS (SELECT 1 FROM normativi o WHERE o.artikel_id=p.id AND o.vhodni_artikel_id=25447))
     OR EXISTS (SELECT 1 FROM artikli WHERE enota_id=309 AND lower(ime) IN ('pelati', 'olje sončnično', 'sol', 'suhi origano'))
     OR NOT EXISTS (SELECT 1 FROM artikli WHERE id=25443 AND enota_id=309 AND ime='Omaka' AND nabavni_artikel AND NOT prodajni_artikel)
     OR NOT EXISTS (SELECT 1 FROM artikli WHERE id=25447 AND enota_id=309 AND ime='Origano' AND enota_mere='kg')
     OR EXISTS (SELECT 1 FROM zaloge WHERE artikel_id=25443 AND kolicina<>0)
  THEN RAISE EXCEPTION 'Stanje pic, sestavin ali omake se je spremenilo; popravek ni bil izveden'; END IF;

  INSERT INTO artikli (enota_id, ime, ime_za_nabavo, cena, davek, nabavna_ddv_stopnja, nabavni_artikel, prodajni_artikel, vrsta_artikla, enota_mere, tax_category)
  VALUES (309, 'Pelati', 'Pelati', 0, 9.50, 9.50, true, false, 'material', 'KGM', 'food') RETURNING id INTO pelati_id;
  INSERT INTO artikli (enota_id, ime, ime_za_nabavo, cena, davek, nabavna_ddv_stopnja, nabavni_artikel, prodajni_artikel, vrsta_artikla, enota_mere, tax_category)
  VALUES (309, 'Olje sončnično', 'Olje sončnično', 0, 9.50, 9.50, true, false, 'material', 'LTR', 'food') RETURNING id INTO olje_id;
  INSERT INTO artikli (enota_id, ime, ime_za_nabavo, cena, davek, nabavna_ddv_stopnja, nabavni_artikel, prodajni_artikel, vrsta_artikla, enota_mere, tax_category)
  VALUES (309, 'Sol', 'Sol', 0, 9.50, 9.50, true, false, 'material', 'KGM', 'food') RETURNING id INTO sol_id;

  UPDATE artikli SET ime='Suhi origano', ime_za_nabavo='Suhi origano', enota_mere='KGM', nabavna_ddv_stopnja=9.50 WHERE id=25447 AND enota_id=309;
  UPDATE normativi SET vhodni_artikel_id=pelati_id, kolicina=0.085 WHERE vhodni_artikel_id=25443;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 17 THEN RAISE EXCEPTION 'Pričakovanih 17 zamenjav omake, dejansko %', affected; END IF;
  UPDATE normativi SET kolicina=0.0005 WHERE vhodni_artikel_id=25447 AND artikel_id IN (SELECT id FROM artikli WHERE enota_id=309 AND je_pica);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 17 THEN RAISE EXCEPTION 'Pričakovanih 17 popravkov origana, dejansko %', affected; END IF;
  INSERT INTO normativi (artikel_id,vhodni_artikel_id,kolicina,vrstni_red)
    SELECT n.artikel_id,olje_id,0.003,100 FROM normativi n WHERE n.vhodni_artikel_id=pelati_id;
  INSERT INTO normativi (artikel_id,vhodni_artikel_id,kolicina,vrstni_red)
    SELECT n.artikel_id,sol_id,0.001,101 FROM normativi n WHERE n.vhodni_artikel_id=pelati_id;

  UPDATE modifikator_normativi SET vhodni_artikel_id=pelati_id, kolicina=0.085 WHERE modifikator_id=7476 AND vhodni_artikel_id=25443;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Normativ dodatka Omaka ni bil zamenjan'; END IF;
  INSERT INTO modifikator_normativi (modifikator_id,vhodni_artikel_id,kolicina,vrstni_red)
    VALUES (7476,olje_id,0.003,1),(7476,sol_id,0.001,2),(7476,25447,0.0005,3);

  UPDATE artikli SET normativ_revision=normativ_revision+1, alergeni_status='nepreverjeno', alergeni_verified_by=NULL, alergeni_verified_at=NULL
    WHERE id IN (SELECT n.artikel_id FROM normativi n WHERE n.vhodni_artikel_id=pelati_id) AND enota_id=309 AND je_pica;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 17 THEN RAISE EXCEPTION 'Revizija normativa ni bila osvežena pri vseh 17 picah'; END IF;
  UPDATE artikli SET aktiven=false, nabavni_artikel=false WHERE id=25443 AND enota_id=309;
  IF EXISTS (SELECT 1 FROM normativi WHERE vhodni_artikel_id=25443)
     OR EXISTS (SELECT 1 FROM modifikator_normativi WHERE vhodni_artikel_id=25443)
  THEN RAISE EXCEPTION 'Omaka je še vedno aktivna sestavina'; END IF;
END $pizza_sauce$;