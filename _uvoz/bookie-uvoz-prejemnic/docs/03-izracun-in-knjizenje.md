# Izračun nabavne vrednosti in knjiženje

---

## 1. Vrstni red izračuna (kaskada)

Vrstni red ni poljuben. Vsak korak deluje na rezultatu prejšnjega.

```
 1. cena_bruto × kolicina_prevzem              = bruto vrednost
 2. − rabat_1 (% od bruto)                     ─┐
 3. − rabat_2 (% od preostanka po rabatu 1)     ├─ kaskadni rabati
 4. − rabat_3 (% od preostanka po rabatu 2)    ─┘
    = vrednost_neto                            ← osnova za DDV
 5. + trošarina                                 (če je izkazana ločeno)
 6. + okoljska dajatev / embalažnina
 7. + razporejeni odvisni stroški nabave
    = nabavna_vrednost                          ← vrednost, ki gre v zalogo
 8. nabavna_cena_em = nabavna_vrednost / kolicina_osnovna
 9. ddv_znesek = vrednost_neto × ddv_stopnja / 100
```

### Kaskadni rabati — pogosta napaka

Rabata 10 % in 5 % **nista** 15 %:

```
100,00 → −10 % → 90,00 → −5 % → 85,50     (kaskadno, pravilno)
100,00 → −15 %          → 85,00           (seštevanje, napačno)
```

Razlika 0,50 € na 100 € je 0,5 % marže. Pri letnem prometu 300.000 € gostinskega lokala je to 1.500 €.

```sql
CREATE OR REPLACE FUNCTION prevzem.neto_po_rabatih(
    p_bruto NUMERIC, p_r1 NUMERIC, p_r2 NUMERIC, p_r3 NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT p_bruto
         * (1 - COALESCE(p_r1,0)/100)
         * (1 - COALESCE(p_r2,0)/100)
         * (1 - COALESCE(p_r3,0)/100)
$$;
```

---

## 2. Razporeditev odvisnih stroškov nabave

Prevoz, carina, manipulacija in zavarovanje so del nabavne vrednosti zaloge, ne strošek obdobja.

| Metoda | Formula | Kdaj |
|---|---|---|
| **VREDNOST** (privzeto) | `delež = vrednost_neto_postavke / Σ vrednost_neto` | mešana dobava, večina primerov |
| **MASA** | `delež = masa_postavke / Σ masa` | prevoz zaračunan po teži |
| **KOLICINA** | `delež = kolicina_osnovna / Σ kolicina_osnovna` | homogeno blago |
| **ROCNO** | uporabnik vpiše znesek po postavki | carina po tarifnih številkah |

```sql
CREATE OR REPLACE FUNCTION prevzem.razporedi_stroske(p_prejem_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_skupaj NUMERIC;
    v_metoda razporeditev_stroskov;
    v_osnova NUMERIC;
    v_razporejeno NUMERIC := 0;
    v_zadnja BIGINT;
BEGIN
    SELECT razpored_stroskov INTO v_metoda FROM prejem WHERE id = p_prejem_id;

    SELECT COALESCE(SUM(znesek),0) INTO v_skupaj
      FROM prejem_odvisni_strosek WHERE prejem_id = p_prejem_id;

    IF v_skupaj = 0 THEN
        UPDATE prejem_postavka SET odvisni_stroski = 0 WHERE prejem_id = p_prejem_id;
        RETURN;
    END IF;

    SELECT SUM(CASE v_metoda
                 WHEN 'VREDNOST' THEN vrednost_neto
                 WHEN 'MASA'     THEN COALESCE(kolicina_masa, kolicina_osnovna)
                 WHEN 'KOLICINA' THEN kolicina_osnovna END)
      INTO v_osnova
      FROM prejem_postavka WHERE prejem_id = p_prejem_id;

    -- razporedi z zaokroževanjem
    UPDATE prejem_postavka pp SET odvisni_stroski = round(
        v_skupaj * (CASE v_metoda
                      WHEN 'VREDNOST' THEN pp.vrednost_neto
                      WHEN 'MASA'     THEN COALESCE(pp.kolicina_masa, pp.kolicina_osnovna)
                      WHEN 'KOLICINA' THEN pp.kolicina_osnovna END) / NULLIF(v_osnova,0), 4)
     WHERE pp.prejem_id = p_prejem_id;

    -- razlika zaradi zaokroževanja gre na postavko z največjo vrednostjo
    SELECT COALESCE(SUM(odvisni_stroski),0) INTO v_razporejeno
      FROM prejem_postavka WHERE prejem_id = p_prejem_id;

    IF v_razporejeno <> v_skupaj THEN
        SELECT id INTO v_zadnja FROM prejem_postavka
         WHERE prejem_id = p_prejem_id ORDER BY vrednost_neto DESC LIMIT 1;
        UPDATE prejem_postavka
           SET odvisni_stroski = odvisni_stroski + (v_skupaj - v_razporejeno)
         WHERE id = v_zadnja;
    END IF;
END $$;
```

**Pravilo zaokroževanja:** razporedi vse razen zadnje postavke, ostanek pripiši postavki z največjo vrednostjo. Tako je vsota vedno točna in razlika relativno najmanjša.

---

## 3. Delovni primer

Dobavnica: pivovarna, 3 postavke, prevoz 15 € razporejen po vrednosti.

| # | Artikel | Kol. | EM | Faktor | Osn. kol. | Bruto/EM | R1 | R2 |
|---|---|---|---|---|---|---|---|---|
| 1 | Pivo svetlo 0,5 l | 10 | KAR | 12 (L) | 120 L | 21,60/KAR | 8 % | 2 % |
| 2 | Pivo temno 0,5 l | 4 | KAR | 12 (L) | 48 L | 23,00/KAR | 8 % | — |
| 3 | Sok pomaranča 1 l | 24 | KOS | 1 (L) | 24 L | 1,15/KOS | 5 % | — |

**Postavka 1**
```
bruto            = 10 × 21,60                     = 216,00
po rabatu 1 (8%) = 216,00 × 0,92                  = 198,72
po rabatu 2 (2%) = 198,72 × 0,98                  = 194,7456 → 194,75
vrednost_neto                                     = 194,75
```

**Postavka 2**
```
bruto = 4 × 23,00 = 92,00 ; × 0,92                = 84,64
```

**Postavka 3**
```
bruto = 24 × 1,15 = 27,60 ; × 0,95                = 26,22
```

**Razporeditev prevoza 15,00 € po vrednosti**
```
Σ vrednost_neto = 194,75 + 84,64 + 26,22          = 305,61

post. 1: 15,00 × 194,75 / 305,61                  =  9,5595 →  9,5595
post. 2: 15,00 ×  84,64 / 305,61                  =  4,1546 →  4,1546
post. 3: 15,00 ×  26,22 / 305,61                  =  1,2870 →  1,2870
Σ = 15,0011 ≠ 15,00 → razlika −0,0011 na postavko 1
post. 1 popravljeno                               =  9,5584
```

**Nabavne vrednosti in cene na osnovno enoto**
```
post. 1: 194,75 + 9,5584 = 204,3084 → 204,31 / 120 L = 1,702570 €/L
post. 2:  84,64 + 4,1546 =  88,7946 →  88,79 /  48 L = 1,849888 €/L
post. 3:  26,22 + 1,2870 =  27,5070 →  27,51 /  24 L = 1,146125 €/L
```

**Opomba:** `nabavna_cena_em` hrani **6 decimalk**. Pri normativu 3 dl pива je razlika med 1,7026 in 1,702570 zanemarljiva na porcijo, a se pri 50.000 porcijah letno sešteje v napako ~10 €. Ne zaokrožuj prezgodaj.

**DDV** (stopnja se prevzame iz dokumenta in validira proti davčni skupini artikla)
```
osnova za DDV = vrednost_neto (BREZ odvisnih stroškov, ti so na svojem računu)
post. 1: 194,75 × 22 % = 42,845 → 42,85
```

Odvisni strošek prevoza ima **svoj** DDV na računu prevoznika. V nabavno vrednost zaloge vstopi neto znesek prevoza, DDV od prevoza se odbije ločeno.

---

## 4. Vrednotenje zaloge

### Drseče povprečje (priporočeno za gostinstvo)

```
nova_vrednost   = stara_vrednost + nabavna_vrednost_prejema
nova_kolicina   = stara_kolicina + kolicina_osnovna
nova_povpr_cena = nova_vrednost / nova_kolicina        (če nova_kolicina > 0)
```

```sql
CREATE OR REPLACE FUNCTION prevzem.prejmi_na_zalogo(
    p_tenant UUID, p_skladisce BIGINT, p_artikel BIGINT,
    p_kolicina NUMERIC, p_vrednost NUMERIC,
    p_dok_tip TEXT, p_dok_id BIGINT, p_post_id BIGINT,
    p_datum DATE, p_lot TEXT DEFAULT NULL, p_rok DATE DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_kol NUMERIC; v_vred NUMERIC; v_cena NUMERIC; v_id BIGINT;
BEGIN
    -- zaklep vrstice stanja prepreči tekmovalne posodobitve
    INSERT INTO zaloga_stanje (tenant_id, skladisce_id, artikel_id)
    VALUES (p_tenant, p_skladisce, p_artikel)
    ON CONFLICT DO NOTHING;

    SELECT kolicina, vrednost INTO v_kol, v_vred
      FROM zaloga_stanje
     WHERE tenant_id = p_tenant AND skladisce_id = p_skladisce
       AND artikel_id = p_artikel
       FOR UPDATE;

    v_kol  := v_kol + p_kolicina;
    v_vred := v_vred + p_vrednost;
    v_cena := CASE WHEN v_kol <> 0 THEN v_vred / v_kol ELSE 0 END;

    INSERT INTO zaloga_promet (
        tenant_id, skladisce_id, artikel_id, datum, vrsta,
        dokument_tip, dokument_id, postavka_id,
        kolicina, cena_em, vrednost,
        saldo_kolicina, saldo_vrednost, saldo_povpr_cena, lot, rok_uporabe)
    VALUES (
        p_tenant, p_skladisce, p_artikel, p_datum, 'PREJEM',
        p_dok_tip, p_dok_id, p_post_id,
        p_kolicina, p_vrednost / NULLIF(p_kolicina,0), p_vrednost,
        v_kol, v_vred, v_cena, p_lot, p_rok)
    RETURNING id INTO v_id;

    UPDATE zaloga_stanje SET
        kolicina = v_kol, vrednost = v_vred, povpr_cena = v_cena,
        zadnja_nab_cena = p_vrednost / NULLIF(p_kolicina,0),
        zadnji_prejem = p_datum, posodobljeno = now()
     WHERE tenant_id = p_tenant AND skladisce_id = p_skladisce
       AND artikel_id = p_artikel;

    -- šarža za FEFO
    IF p_lot IS NOT NULL OR p_rok IS NOT NULL THEN
        INSERT INTO zaloga_sarza (tenant_id, skladisce_id, artikel_id, lot,
                                  rok_uporabe, kolicina, cena_em, prejem_post_id)
        VALUES (p_tenant, p_skladisce, p_artikel, COALESCE(p_lot,'-'),
                p_rok, p_kolicina, p_vrednost / NULLIF(p_kolicina,0), p_post_id)
        ON CONFLICT (tenant_id, skladisce_id, artikel_id, lot, rok_uporabe)
        DO UPDATE SET
            cena_em = (zaloga_sarza.kolicina * zaloga_sarza.cena_em + p_vrednost)
                      / NULLIF(zaloga_sarza.kolicina + p_kolicina, 0),
            kolicina = zaloga_sarza.kolicina + p_kolicina;
    END IF;

    RETURN v_id;
END $$;
```

### Kdaj FIFO / FEFO namesto povprečja

| Situacija | Metoda |
|---|---|
| Pijača, suha živila, dolg rok | drseče povprečje |
| Sveže meso, ribe, mlečni izdelki | **FEFO** — sledljivost je zakonska zahteva (HACCP), ne le računovodska odločitev |
| Vino z letniki kot ločeni artikli | povprečje po artiklu (letnik = svoj artikel) |

Sistem naj podpira obe metodi hkrati, nastavljivo **na ravni artikla**, ne globalno.

---

## 5. Knjiženje v glavno knjigo

### Konti

Konti so **nastavljivi po tenantu**, ker se kontni načrti razlikujejo. Spodaj so tipični po enotnem kontnem okviru; obvezno potrdi z računovodjo stranke pred aktivacijo.

| Namen | Tipičen konto | Opomba |
|---|---|---|
| Obračun nabave materiala | 300 | vmesni konto, se zapre |
| Zaloge materiala (živila) | 310 | surovine za normative |
| Obračun nabave trgovskega blaga | 600 | |
| Zaloge trgovskega blaga | 650 / 660 | pijača za nadaljnjo prodajo |
| Zaloge embalaže / drobnega inventarja | 320 | |
| Terjatve za vstopni DDV | 160 | ločeni analitični konti po stopnji |
| Obveznosti do dobaviteljev v državi | 220 | saldakonti po partnerju |
| Obveznosti do dobaviteljev v EU | 221 | pridobitve blaga |
| Obveznost za obračunani DDV | 260 | pri samoobdavčitvi |
| Stroški materiala | 400 | pri neposrednem odpisu |
| Nabavna vrednost prodanega blaga | 702 | ob razknjižbi |

### Vzorec knjižbe — domači dobavitelj, standardna stopnja

Prejemnica iz razdelka 3, skupaj: neto 305,61 + prevoz 15,00, DDV 22 %.

| Konto | Opis | Debet | Kredit |
|---|---|---|---|
| 310 | Zaloge materiala | 320,61 | |
| 160 | Terjatve za vstopni DDV 22 % | 70,53 | |
| 220 | Obveznosti do dobavitelja (blago) | | 372,85 |
| 220 | Obveznosti do prevoznika | | 18,29 |

```
Kontrola: 320,61 + 70,53 = 391,14
          372,85 + 18,29 = 391,14  ✓
```

DDV: blago 305,61 × 22 % = 67,23; prevoz 15,00 × 22 % = 3,30; skupaj 70,53.

### Vzorec — pridobitev blaga iz EU (samoobdavčitev)

Dobavitelj iz Avstrije, 1.000 € brez DDV, blago 22 %.

| Konto | Opis | Debet | Kredit |
|---|---|---|---|
| 310 | Zaloge materiala | 1.000,00 | |
| 160 | Terjatve za vstopni DDV | 220,00 | |
| 221 | Obveznosti do dobavitelja v EU | | 1.000,00 |
| 260 | Obveznost za obračunani DDV | | 220,00 |

Vpis v evidence gre **na obe strani** — v knjigo izdanih in knjigo prejetih računov. Če se to izpusti, obračun ne bo skladen s podatki, ki jih FURS prejme prek transakcijskega poročanja KIR/KPR. Kodo `AE`/`K` iz e-računa je zato treba obravnavati kot sprožilec ločene logike, ne kot 0 %.

### Vzorec — dobropis (naknadni rabat, vračilo)

Obrni predznake, ne knjiži nove prejemnice z negativnimi zneski v isti serijski številčnik. Uporabi ločen tip dokumenta `PREJEM_DOBROPIS`, ki se sklicuje na izvorno prejemnico. Zaloga se zmanjša po **takratni** nabavni ceni, ne po trenutni povprečni — sicer nastane fiktivna razlika v ceni.

---

## 6. Storniranje

Knjižene prejemnice se ne popravlja. Storno ustvari:

1. Nov zapis `prejem` s statusom `KNJIZENA`, `storno_prejem_id` → izvirnik.
2. Zrcalne zapise v `zaloga_promet` z nasprotnim predznakom in **ceno iz izvornega prometa**, ne trenutno povprečno.
3. Stornirno temeljnico z obrnjenimi stranmi.
4. Izvirnik dobi status `STORNIRANA`.

```sql
UPDATE zaloga_promet SET storno_od_id = <izvorni_id> WHERE id = <novi_id>;
```

Če je bila zaloga med prevzemom in stornom že porabljena, storno povzroči negativno zalogo. To je dopustno stanje — ne blokiraj ga, ampak ga izpiši v poročilo za popravek inventure.

---

## 7. Povezava z normativi in razknjižba

```
prejemnica  → zaloga surovin
POS prodaja → normativ jedi → razknjižba surovin po povpr. ceni ali FEFO
kalo        → ločen dokument odpisa
inventura   → uskladitev, razlika na 720/762 (manko/višek)
```

Pogoj: enota v normativu mora biti združljiva z osnovno enoto artikla. Če je artikel v litrih, normativ pa v decilitrih, mora obstajati pretvorba `DL → L` (obstaja prek `enota_mere.faktor_na_si`).

**Kalo ločuj od porabe po normativu.** Če se oboje knjiži kot izdaja, razlike med teoretično in dejansko porabo ni mogoče analizirati, kar je edini uporaben pokazatelj nadzora nad stroški hrane v gostinstvu.

```
food cost % = (začetna zaloga + prevzemi − končna zaloga) / prihodek od hrane
```

Ta kazalnik je smiseln samo, če so prevzemi vrednostno pravilni. Vse zgoraj opisano obstaja zato, da je ta ulomek verodostojen.
