-- KDS v2 is additive.  Snapshot whether a unit already had stations before
-- provisioning, so legacy installations stay custom and receive no displays.
ALTER TABLE kds_postaje ADD COLUMN IF NOT EXISTS tip text NOT NULL DEFAULT 'custom'
  CHECK (tip IN ('bar', 'kitchen', 'pizza', 'dispatch', 'custom'));
ALTER TABLE kds_nalogi ADD COLUMN IF NOT EXISTS uporabljen_fallback boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS kds_nastavitve (
  enota_id integer PRIMARY KEY REFERENCES enote(id) ON DELETE CASCADE,
  profil text NOT NULL DEFAULT 'bar_combined_kitchen' CHECK (profil IN ('bar_combined_kitchen','bar_separate_kitchen_pizza','custom')),
  fallback_postaja_id integer REFERENCES kds_postaje(id) ON DELETE SET NULL,
  dispatch_omogocen boolean NOT NULL DEFAULT false, posodobljeno timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kds_prikazovalniki (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  ime text NOT NULL, aktiven boolean NOT NULL DEFAULT true, vrstni_red integer NOT NULL DEFAULT 0,
  ustvarjeno timestamptz NOT NULL DEFAULT now(), CONSTRAINT kds_prikazovalniki_ime_enota_unique UNIQUE (enota_id, ime)
);
CREATE TABLE IF NOT EXISTS kds_prikazovalnik_narocnine (
  id serial PRIMARY KEY, prikazovalnik_id integer NOT NULL REFERENCES kds_prikazovalniki(id) ON DELETE CASCADE,
  postaja_id integer NOT NULL REFERENCES kds_postaje(id) ON DELETE CASCADE, ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kds_prikazovalnik_narocnine_unique UNIQUE (prikazovalnik_id, postaja_id)
);
INSERT INTO kds_nastavitve (enota_id, profil, fallback_postaja_id)
SELECT e.id,
  CASE WHEN EXISTS (SELECT 1 FROM kds_postaje p WHERE p.enota_id = e.id) THEN 'custom' ELSE 'bar_combined_kitchen' END,
  (SELECT p.id FROM kds_postaje p WHERE p.enota_id = e.id ORDER BY p.vrstni_red, p.id LIMIT 1)
FROM enote e ON CONFLICT (enota_id) DO NOTHING;
-- A legacy unit's first station remains its fallback even if it had been
-- disabled; reactivate it so the fallback invariant is immediately true.
UPDATE kds_postaje p SET aktivna = true
FROM kds_nastavitve n
WHERE n.enota_id = p.enota_id AND n.profil = 'custom' AND n.fallback_postaja_id = p.id;
-- Only configurations created as standard are provisioned here.
INSERT INTO kds_postaje (enota_id, ime, tip, vrstni_red)
SELECT n.enota_id, v.ime, v.tip, v.vrstni_red FROM kds_nastavitve n
CROSS JOIN (VALUES ('Bar','bar',0),('Kuhinja','kitchen',1),('Pica','pizza',2)) AS v(ime,tip,vrstni_red)
WHERE n.profil = 'bar_combined_kitchen'
ON CONFLICT (enota_id, ime) DO NOTHING;
-- New units always have an active Kitchen fallback, never the Bar lane.
UPDATE kds_nastavitve n SET fallback_postaja_id = p.id
FROM kds_postaje p WHERE p.enota_id = n.enota_id AND p.tip = 'kitchen' AND p.aktivna
  AND n.profil = 'bar_combined_kitchen';
INSERT INTO kds_prikazovalniki (enota_id, ime, vrstni_red)
SELECT n.enota_id, v.ime, v.vrstni_red FROM kds_nastavitve n
CROSS JOIN (VALUES ('Bar',0),('Kuhinja',1)) AS v(ime,vrstni_red)
WHERE n.profil = 'bar_combined_kitchen'
ON CONFLICT (enota_id, ime) DO NOTHING;
INSERT INTO kds_prikazovalnik_narocnine (prikazovalnik_id, postaja_id)
SELECT d.id, p.id FROM kds_nastavitve n
JOIN kds_prikazovalniki d ON d.enota_id = n.enota_id
JOIN kds_postaje p ON p.enota_id = n.enota_id
WHERE n.profil = 'bar_combined_kitchen'
  AND ((d.ime = 'Bar' AND p.tip = 'bar') OR (d.ime = 'Kuhinja' AND p.tip IN ('kitchen','pizza')))
ON CONFLICT DO NOTHING;