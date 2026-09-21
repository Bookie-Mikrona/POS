-- FURS certifikat je odslej izključno na nivoju podjetja v tabeli companies.
-- Zasebni ključ je tam AES-256-GCM šifriran; legacy poti, gesla in PEM zapisi
-- ne smejo več ostati v poslovnih prostorih ali key-value nastavitvah.

ALTER TABLE poslovni_prostori DROP COLUMN IF EXISTS certifikat_pot;
ALTER TABLE poslovni_prostori DROP COLUMN IF EXISTS certifikat_geslo;

DELETE FROM nastavitve
WHERE kljuc IN ('certifikatPot', 'certifikatGeslo', 'certifikatPem', 'certifikatKljuc');