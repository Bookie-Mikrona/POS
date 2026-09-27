-- test-bootstrap: schema
-- Popravi le stare, nespremenjene skupine samodejno ustvarjenih predlog.
-- Izvirni ključi, artikli, količine in nabavne listine ostanejo nespremenjeni.
UPDATE artikli
SET skupina = CASE
  WHEN drobni_inventar_predloga_kljuc IN (
    '01-espresso-skodelica-podstavek',
    '01-skodelica-podaljsana-kava-kapucino',
    '01-skodelica-caj-kakav'
  ) THEN '02 - Porcelan'
  WHEN drobni_inventar_predloga_kljuc IN (
    '02-deska-lesena-narezek-zar',
    '02-deska-kamnita-narezek-zar'
  ) THEN '05 - Kuhinjska orodja'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '01' THEN '01 - Steklovina'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '02' THEN '02 - Porcelan'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '03' THEN '03 - Jedilni pribor'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '04' THEN '04 - Kuhinjska posoda & GN'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '05' THEN '05 - Kuhinjska orodja'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '06' THEN '06 - Šank pripomočki'
  WHEN left(drobni_inventar_predloga_kljuc, 2) = '07' THEN '07 - Tekstil & Ostalo'
END
WHERE drobni_inventar = true
  AND drobni_inventar_predloga_kljuc IS NOT NULL
  AND skupina = CASE left(drobni_inventar_predloga_kljuc, 2)
    WHEN '01' THEN '01 Steklovina'
    WHEN '02' THEN '02 Porcelan/strežna posoda'
    WHEN '03' THEN '03 Jedilni pribor/namizni dodatki'
    WHEN '04' THEN '04 Kuhinjska posoda & GN'
    WHEN '05' THEN '05 Kuhinjska orodja'
    WHEN '06' THEN '06 Šank'
    WHEN '07' THEN '07 Tekstil & Ostalo'
  END;