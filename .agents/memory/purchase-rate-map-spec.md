---
name: Purchase rate map — spec za ERP prejemnice
description: Specifikacija DB-tabele in validacijske logike za pričakovano nabavno DDV stopnjo pri vnosu postavk prejemnice.
---

## DB tabela (prihodnja gradnja)

```sql
CREATE TABLE purchase_rate_map (
    kategorija      text NOT NULL,      -- davčna kategorija artikla
    dodani_sladkor  boolean,            -- NULL = ni pomembno
    vstopna_stopnja numeric(4,1) NOT NULL,
    velja_od        date NOT NULL,
    velja_do        date,
    PRIMARY KEY (kategorija, COALESCE(dodani_sladkor,false), velja_od)
);
```

Začetni podatki:
| kategorija    | dodani_sladkor | vstopna_stopnja | opomba                         |
|---------------|---------------|-----------------|--------------------------------|
| food          | —             | 9,5             | živila                         |
| cold_beverage | false         | 9,5             | Radenska, 100% sok             |
| cold_beverage | true          | 22,0            | kola, ledeni čaj (od 1.1.2025) |
| hot_beverage  | false         | 9,5             | kava, čaj, kakav, mleko        |
| hot_beverage  | true          | 22,0            | sladkani sirupi                |
| alcoholic     | —             | 22,0            |                                |
| food_drink    | —             | 9,5             | surovine so živila             |
| other         | —             | 22,0            | privzeto                       |

**Why:** Tabela (ne koda) omogoča posodobitev ob spremembi zakona z vnosom, ne s deployem.

## Validacijska logika ob vnosu postavke prejemnice

```
ob_vnosu_postavke(artikel, dobavitelj, datum_prejema, stopnja_z_racuna):
    pričakovana = purchase_rate_map(artikel.kategorija, artikel.dodani_sladkor,
                                    datum := datum_opravljene_dobave)  # NE datum vnosa!
    postavka.ddv = pričakovana   # privzeta vrednost

    če stopnja_z_racuna == pričakovana → ✓ brez opozorila
    sicer če dobavitelj.tip == 'mali_zavezanec' → ddv=0, brez odbitka
    sicer če dobavitelj.tip == 'pavšalist' → pavšalno_nadomestilo=8%, ni DDV
    sicer če dobavitelj.država != 'SI' → samoobdavčitev po pričakovani
    sicer → ⚠ opozorilo + [Zahtevaj popravek] [Potrdi z razlogom]
    potrjeno odstopanje → zapiši razlog + uporabnika (revizijska sled)
```

## Tri pravila, ki ne smejo biti pozabljena

1. **Datum dobave** (z računa), ne datum vnosa — za pravilno knjiženje ob zakonski spremembi
2. **Smer opozorila ni simetrična:**
   - dobaviteljev 22 % namesto 9,5 % → nevarno za kupca (FURS terja preveč odbitka)
   - dobaviteljev 9,5 % namesto 22 % → problem dobavitelja
   → opozorilo v obeh smereh, z različnim besedilom
3. **Nikoli ne primerjaj vstopne stopnje s prodajno kategorijo** — 9,5 % nabava pri »cold_beverage (22 % prodajno)« je pravilno stanje

## Migracija obstoječih podatkov

Enkratni ročni pregled šifranta: vsem artiklom v pijačnih kategorijah nastavi `dodani_sladkor`
po deklaracijah. Nato masovno preveri zadnje prejemnice proti novi preslikavi.

## Trenutno stanje (do implementacije)

`pricakovanaNabavnaDdv()` v `artifacts/pos/src/pages/Menu.tsx` je hardkodirana verzija iste
logike — pravilna, a bo ob zakonski spremembi zahtevala deploy. Ko bo ERP modul prejemnic
implementiran, jo nadomesti klic na `purchase_rate_map`.
