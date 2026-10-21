-- test-bootstrap: schema
-- Prikazni znak »Spremljaj porcije« za novi prikaz menija. Ne vpliva na strežniško
-- preverjanje razpoložljivosti. Začetno stanje: vklopljeno za artikle, ki že zdaj
-- kažejo porcije (pripravljena/sestavljena hrana in pice). Zapolnitev teče samo ob
-- prvem dodajanju stolpca, zato ponovni zagon ne prepiše poznejših ročnih izbir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'artikli' AND column_name = 'spremljaj_porcije'
  ) THEN
    ALTER TABLE artikli ADD COLUMN spremljaj_porcije boolean NOT NULL DEFAULT false;
    UPDATE artikli SET spremljaj_porcije = true
    WHERE COALESCE(meal_type, 'ala_carte') <> 'ala_carte' OR je_pica = true;
  END IF;
END $$;
