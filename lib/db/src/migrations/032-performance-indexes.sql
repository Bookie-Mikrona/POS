-- 032: Performance indeksi za vroče POS tabele
-- Diagnostika pokazala: fetchPostavke in /narocila/aktivna delata seq scan
-- brez indeksov → ~N+1 klicev × seq scan = bottleneck pri vsakem dodajanju artikla

-- postavke.narocilo_id: fetchPostavke se kliče 10–15× na artikel add
CREATE INDEX IF NOT EXISTS ix_postavke_narocilo_id ON postavke(narocilo_id);

-- narocila(enota_id, status): GET /narocila/aktivna filtrira po obeh
CREATE INDEX IF NOT EXISTS ix_narocila_enota_status ON narocila(enota_id, status);

-- artikli(enota_id, aktiven): GET /artikli vedno filtrira po enoti in aktivnosti
CREATE INDEX IF NOT EXISTS ix_artikli_enota_aktiven ON artikli(enota_id, aktiven);

-- blagajne(enota_id): admin in BlagajnaSwitcher lookup
CREATE INDEX IF NOT EXISTS ix_blagajne_enota_id ON blagajne(enota_id);
