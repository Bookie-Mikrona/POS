# Validacija, stanja dokumenta in trismerno usklajevanje

---

## 1. Diagram stanj

```
                    ┌──────────┐
   uvoz / vnos ────►│ OSNUTEK  │◄──────────────┐
                    └────┬─────┘               │
                         │ upari_prejem()      │ potrdi_uparjanje()
                         ▼                     │
              ┌──────────────────────┐         │
              │ CAKA_NA_UPARJANJE    │─────────┘
              └──────────────────────┘
                         │ vse postavke uparjene
                         ▼
              ┌──────────────────────┐  vir = OCR/LLM ali presežen prag
              │ CAKA_NA_POTRDITEV    │◄─────────────────────────
              └──────────┬───────────┘
                         │ potrdi()
                         ▼
                    ┌──────────┐         zavrni()      ┌───────────┐
                    │ POTRJENA │────────────────────►  │ ZAVRNJENA │
                    └────┬─────┘                       └───────────┘
                         │ knjizi()
                         ▼
                    ┌──────────┐         storno()      ┌────────────┐
                    │ KNJIZENA │────────────────────►  │ STORNIRANA │
                    └──────────┘                       └────────────┘
```

**Nepovratni prehodi:** `KNJIZENA` in `STORNIRANA` sta terminalna. Vsak popravek je nov dokument.

### Matrika dovoljenih prehodov

| Iz \ V | OSNUTEK | CAKA_UPAR | CAKA_POTR | POTRJENA | KNJIZENA | ZAVRNJENA | STORNIRANA |
|---|---|---|---|---|---|---|---|
| OSNUTEK | — | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| CAKA_UPAR | ✓ | — | ✓ | ✓ | ✗ | ✓ | ✗ |
| CAKA_POTR | ✓ | ✓ | — | ✓ | ✗ | ✓ | ✗ |
| POTRJENA | ✓ | ✗ | ✗ | — | ✓ | ✓ | ✗ |
| KNJIZENA | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✓ |
| ZAVRNJENA | ✓ | ✗ | ✗ | ✗ | ✗ | — | ✗ |
| STORNIRANA | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |

---

## 2. Katalog validacijskih pravil

Resnost: **B** = blokada (ni mogoče knjižiti), **O** = opozorilo (zahteva potrditev z ustrezno pravico), **I** = informativno.

### Raven zajema

| Koda | Pravilo | Resnost |
|---|---|---|
| `ZAJ001` | Datoteka je prazna ali nečitljiva | B |
| `ZAJ002` | Format ni prepoznan | B |
| `ZAJ003` | Enak SHA-256 že obdelan | B (PODVOJENO) |
| `ZAJ004` | XML ni skladen s shemo (XSD) | B |
| `ZAJ005` | Kršitev Schematron pravil (Peppol/EN 16931) | O |
| `ZAJ006` | Kodiranje ni bilo zanesljivo določeno | O |
| `ZAJ007` | Digitalni podpis neveljaven ali potekel | O |

### Raven dokumenta

| Koda | Pravilo | Resnost |
|---|---|---|
| `DOK001` | Dobavitelj ni v šifrantu → ponudi vpis iz PRS/AJPES po davčni | B |
| `DOK002` | Davčna številka ne prestane kontrole (MOD 11) | O |
| `DOK003` | Enaka št. dokumenta + dobavitelj + datum že obstaja | B |
| `DOK004` | `Σ postavk ≠ izv_skupaj` (toleranca 0,02 €) | B |
| `DOK005` | `Σ DDV ≠ izv_ddv` | O |
| `DOK006` | Datum dokumenta v prihodnosti | O |
| `DOK007` | Datum v zaprtem obračunskem obdobju | B |
| `DOK008` | Valuta ≠ EUR brez tečaja | B |
| `DOK009` | Naročilnica zahtevana (nastavitev), a je ni | B |
| `DOK010` | Dokument nima nobene postavke | B |
| `DOK011` | Prejemnik na dokumentu ni naša poslovna enota (GLN/davčna) | O |

### Raven postavke

| Koda | Pravilo | Resnost |
|---|---|---|
| `POS001` | Postavka ni uparjena na artikel | B |
| `POS002` | Zaupanje uparjanja pod pragom | O |
| `POS003` | Enota mere neznana ali ni pretvorbe v osnovno | B |
| `POS004` | Količina ≤ 0 | B |
| `POS005` | Cena ≤ 0 pri artiklu, ki ni promocijski | O |
| `POS006` | Odstopanje cene od zadnje nabavne > prag | O |
| `POS007` | `kolicina × cena ≠ vrednost_neto` (toleranca 0,02) | B |
| `POS008` | GTIN ne prestane kontrolne števke | O |
| `POS009a` | vstopna stopnja ≠ `artikli.nabavna_ddv_stopnja` | O |
| `POS009b` | vstopna stopnja ni veljavna (22 / 9,5 / 5 / 0) | B |
| `POS010` | Rok uporabe je pretekel | B |
| `POS011` | Do roka uporabe manj kot `min_dni_do_roka` | O |
| `POS012` | Artikel je neaktiven / ukinjen | O |
| `POS013` | Artikel ne pripada temu dobavitelju (ni v `artikel_dobavitelj`) | I |
| `POS014` | Zaloga bi po knjiženju postala negativna (pri dobropisu) | O |
| `POS015` | Faktor pretvorbe se razlikuje od zadnjič uporabljenega | O |
| `POS016` | Cena na enoto odstopa od povprečja skupine za > 50 % | I |

### Vstopni DDV ni izstopni DDV

**Popravek prvotne različice.** Pravilo `POS009` je preverjalo stopnjo z
dokumenta proti davčni kategoriji artikla. To je bilo napačno in bi
sprožalo lažna opozorila pri skoraj vsaki prejemnici.

Davčna kategorija artikla določa **izstopni** DDV, in to glede na način
strežbe. Da je hladna pijača za s seboj po liberalni razlagi obdavčena
z nižjo stopnjo, pomeni, da blago samo po sebi sodi v nižjo stopnjo;
višja stopnja pri mizi izhaja iz strežbe kot storitve.

```
Kavna zrna kupljena od dobavitelja   → vstopni DDV  nižja stopnja
Kava, postrežena pri mizi            → izstopni DDV višja stopnja
```

Zato obstaja ločeno polje `artikli.nabavna_ddv_stopnja`, ki se napolni
ob prvem prevzemu iz dokumenta in od takrat služi kot kontrola.

### Odstopanje cene — izračun

```sql
odstopanje_% = 100 * (nova_cena_em - zadnja_nab_cena) / NULLIF(zadnja_nab_cena, 0)
```

Primerjaj **na osnovno enoto**, nikoli na enoto dobavitelja. Če dobavitelj spremeni pakiranje iz 24 na 20 kosov v kartonu, je cena kartona videti nespremenjena, cena litra pa je zrasla za 20 %. To je edini način, da se taka sprememba opazi.

---

## 3. Trismerno usklajevanje (3-way match)

Najbolj donosen del modula. Primerja tri dokumente:

```
NAROČILNICA  ←→  PREJEMNICA  ←→  PREJETI RAČUN
  (kaj sem       (kaj sem       (kaj mi
   naročil)       dobil)         zaračunavajo)
```

### Kaj se primerja

| Primerjava | Vir 1 | Vir 2 | Toleranca | Ravnanje ob kršitvi |
|---|---|---|---|---|
| Cena | naročilnica | prejemnica | 0 % | opozorilo, sklic na dogovor |
| Cena | prejemnica | račun | 0,01 € | **reklamacija** |
| Količina | naročilnica | prejemnica | `prag_kolicine` | delna dobava ali višek |
| Količina | prejemnica | račun | 0 | **reklamacija** |
| Rabat | naročilnica/cenik | račun | 0 % | **reklamacija** — najpogostejša napaka dobaviteljev |
| Artikel | naročilnica | prejemnica | — | nadomestni artikel, zahteva potrditev |

```sql
CREATE OR REPLACE VIEW prevzem.v_trismerno_usklajevanje AS
SELECT
    p.id                        AS prejem_id,
    p.stevilka,
    p.dobavitelj_id,
    pp.zap_st,
    pp.artikel_id,
    np.kolicina                 AS kol_narocena,
    pp.kolicina_osnovna         AS kol_prejeta,
    rp.kolicina                 AS kol_zaracunana,
    np.cena                     AS cena_narocena,
    pp.nabavna_cena_em          AS cena_prejeta,
    rp.cena                     AS cena_zaracunana,
    round(pp.kolicina_osnovna - COALESCE(np.kolicina, pp.kolicina_osnovna), 6)
                                AS razlika_kolicine,
    round(COALESCE(rp.cena, pp.nabavna_cena_em) - pp.nabavna_cena_em, 6)
                                AS razlika_cene,
    round((COALESCE(rp.cena, pp.nabavna_cena_em) - pp.nabavna_cena_em)
          * pp.kolicina_osnovna, 2) AS financni_ucinek,
    CASE
      WHEN rp.id IS NULL THEN 'RACUN_MANJKA'
      WHEN np.id IS NULL THEN 'NAROCILNICA_MANJKA'
      WHEN abs(COALESCE(rp.cena,0) - pp.nabavna_cena_em) > 0.01 THEN 'ODSTOPANJE_CENE'
      WHEN abs(COALESCE(rp.kolicina,0) - pp.kolicina_osnovna) > 0.001 THEN 'ODSTOPANJE_KOLICINE'
      ELSE 'USKLAJENO'
    END AS status_uskladitve
FROM prejem p
JOIN prejem_postavka pp ON pp.prejem_id = p.id
LEFT JOIN narocilnica_postavka np ON np.id = pp.narocilnica_post_id
LEFT JOIN prejeti_racun_postavka rp ON rp.id = pp.racun_post_id
WHERE p.status = 'KNJIZENA';
```

### Poročilo za reklamacijo

Mesečni izpis, grupiran po dobavitelju, urejen po `financni_ucinek DESC`. V praksi razkrije:
- rabate, dogovorjene ustno, a nikoli aplicirane na račun,
- cene, ki se tiho dvignejo brez obvestila,
- zaračunane, a nedobavljene količine,
- podvojeno zaračunan prevoz.

To je edini del modula z neposredno merljivim donosom in ga je smiselno izpostaviti kot ločen zaslon, ne kot podstran prejemnice.

---

## 4. Delna dobava

Naročenih 10 kartonov, dobavljenih 6.

Možnosti (nastavitev na dobavitelju):

| Način | Ravnanje |
|---|---|
| **ODPRTO** | naročilnica ostane odprta za 4 kartone, čaka drugo dobavnico |
| **ZAPRI** | naročilnica se zapre, razlika se zabeleži kot nedobavljeno |
| **VPRASAJ** | uporabnik odloči ob prevzemu |

Pri gostinstvu je privzeto `ZAPRI` — sveže blago se ne dobavlja naknadno, naroči se znova.

```sql
-- Kumulativna prevzeta količina po postavki naročilnice
CREATE OR REPLACE VIEW prevzem.v_narocilnica_odprto AS
SELECT np.id, np.narocilnica_id, np.artikel_id,
       np.kolicina AS narocena,
       COALESCE(SUM(pp.kolicina_osnovna), 0) AS prevzeta,
       np.kolicina - COALESCE(SUM(pp.kolicina_osnovna), 0) AS odprta
  FROM narocilnica_postavka np
  LEFT JOIN prejem_postavka pp ON pp.narocilnica_post_id = np.id
  LEFT JOIN prejem p ON p.id = pp.prejem_id AND p.status = 'KNJIZENA'
 GROUP BY np.id, np.narocilnica_id, np.artikel_id, np.kolicina;
```

---

## 5. Pravice uporabnikov

| Pravica | Pomen |
|---|---|
| `PREVZEM_VNOS` | ustvari in ureja osnutek |
| `PREVZEM_UPARJANJE` | potrdi uparjanje artikla, ustvari preslikavo |
| `PREVZEM_NOV_ARTIKEL` | ustvari nov artikel iz prevzema |
| `PREVZEM_POTRDI` | prehod v POTRJENA |
| `PREVZEM_KNJIZI` | knjiženje v zalogo in GK |
| `PREVZEM_STORNO` | storniranje knjiženega |
| `PREVZEM_ODSTOPANJE_CENE` | potrditev preseženega praga cene |
| `PREVZEM_BREZ_NAROCILNICE` | prevzem brez sklica na naročilnico |
| `PREVZEM_NAZAJ_V_OBDOBJE` | knjiženje z datumom v preteklem obdobju |

**Ločitev nalog:** kdor prevzema blago (natakar, vodja izmene), praviloma nima pravice `PREVZEM_ODSTOPANJE_CENE`. Sicer se odstopanja tiho potrjujejo in kontrola nima učinka.

---

## 6. Obravnava opozoril

Opozorila se hranijo v `prejem_postavka.opozorila` kot JSONB:

```json
[
  { "koda": "POS006", "resnost": "O",
    "sporocilo": "Cena 1,85 €/L odstopa +12,4 % od zadnje (1,65 €/L)",
    "podatki": { "nova": 1.85, "zadnja": 1.65, "odstopanje": 12.4 },
    "potrdil_uporabnik": 42, "potrjeno_dne": "2026-07-29T09:14:22Z",
    "opomba": "Dvig cen pivovarne od 1. 7., potrjeno po telefonu" }
]
```

Pred knjiženjem se preveri:
```sql
-- ni sme obstajati nepotrjeno opozorilo resnosti B ali O
SELECT count(*) FROM prejem_postavka pp,
     jsonb_array_elements(pp.opozorila) o
 WHERE pp.prejem_id = $1
   AND o->>'resnost' IN ('B','O')
   AND o->>'potrdil_uporabnik' IS NULL;
```

Opomba ob potrditvi naj bo **obvezna** pri odstopanju cene. Šest mesecev kasneje je edini vir informacije, zakaj je bila cena sprejeta.

---

## 7. Obravnava novega artikla

Kadar postavke ni mogoče upariti, sta dve poti:

**A. Ustvari nov artikel** — zahteva vsaj: naziv, osnovna enota, davčna skupina, vrsta artikla, konto zaloge. Predlogo napolni iz podatkov dobavnice, uporabnik dopolni. Novo ustvarjen artikel dobi zastavico `nepopoln = true`, dokler ni določena prodajna cena ali normativ.

**B. Preslikaj na obstoječi zbirni artikel** — npr. "Ostalo — živila". Uporabno za enkratne nabave (dekoracija, sveče). Vendar pozor: če se to zlorablja, se food cost razgradi. Omeji z opozorilom, kadar delež zbirnih artiklov v prejemnici preseže npr. 10 % vrednosti.

**Nikoli ne dovoli knjiženja postavke brez artikla.** Vrednost bi šla v zalogo brez količinske sledi in inventura je ne bi mogla ujeti.
