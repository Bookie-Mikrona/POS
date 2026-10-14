-- Privzeta izbira modifikatorja in obvezen razrez pri vseh picah.
ALTER TABLE modifikatorji ADD COLUMN IF NOT EXISTS privzet boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  e record;
  sk integer;
BEGIN
  FOR e IN SELECT DISTINCT enota_id FROM artikli WHERE je_pica LOOP
    SELECT id INTO sk FROM modifikatorske_skupine WHERE enota_id = e.enota_id AND ime = 'Razrez' ORDER BY id LIMIT 1;
    IF sk IS NULL THEN
      INSERT INTO modifikatorske_skupine (enota_id, ime, obvezna, min_izbir, max_izbir, vrstni_red)
        VALUES (e.enota_id, 'Razrez', true, 1, 1, 0) RETURNING id INTO sk;
      INSERT INTO modifikatorji (skupina_id, ime, cena_dodatek, aktiven, vrstni_red)
        SELECT sk, v.ime, 0, true, v.ord FROM (VALUES
          ('Brez razreza', 0), ('Trikotni razrez (New York style)', 1), ('Kvadratni razrez (Party cut)', 2),
          ('Razrez na polovico', 3), ('Razrez na četrtino', 4)) AS v(ime, ord);
    ELSE
      UPDATE modifikatorske_skupine SET obvezna = true, min_izbir = 1, max_izbir = 1 WHERE id = sk;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM modifikatorji WHERE skupina_id = sk AND privzet) THEN
      UPDATE modifikatorji SET privzet = true
        WHERE id = (SELECT id FROM modifikatorji WHERE skupina_id = sk AND ime = 'Brez razreza' ORDER BY id LIMIT 1);
    END IF;
    INSERT INTO artikli_modifikatorske_skupine (artikel_id, skupina_id, vrstni_red)
      SELECT a.id, sk, 0 FROM artikli a
      WHERE a.enota_id = e.enota_id AND a.je_pica
      ON CONFLICT (artikel_id, skupina_id) DO NOTHING;
  END LOOP;
END $$;

-- Obvezna skupina »Priprava jajc« dobi privzeto izbiro, če je nima.
UPDATE modifikatorji m SET privzet = true
WHERE m.ime = 'Na oko'
  AND m.skupina_id IN (SELECT id FROM modifikatorske_skupine WHERE ime = 'Priprava jajc' AND obvezna)
  AND NOT EXISTS (SELECT 1 FROM modifikatorji x WHERE x.skupina_id = m.skupina_id AND x.privzet);
