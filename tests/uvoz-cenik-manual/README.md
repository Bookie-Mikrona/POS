# Ročni preizkus uvoza cenika — Faza 1

**Dobavitelj:** DAVIDOV HRAM d.o.o. Ljubno (id=23)
**Enota:** Privzeto (id=5)
**Testne datoteke:** v tej mapi

---

## Testne datoteke

| Datoteka | Format |
|---|---|
| `davidov-hram-cenik.csv` | CSV, ločilo `;`, decimalno `.`, kodiranje UTF-8 |
| `davidov-hram-cenik.xlsx` | Excel XLSX, list "Cenik" |

Obe datoteki imata **isto vsebino** — 8 vrstic, stolpci: `Naziv ; Cena ; DDV ; EnotVPaketu`

---

## Pričakovane vrednosti v predogledu

| Naziv na dobavnikovem ceniku | Artkel v šifrantu | Stara cena (€/enoto) | Nova cena (€/enoto) | Sprememba | Opomba |
|---|---|---|---|---|---|
| PIVO UNION SVETLO 0,5L STV | Pivo union svetlo 0,5l stek. | 1.0417 | **1.09** | **+4.6 %** | Podražitev |
| PIVO UNION SVETLO 0,33L STV | Pivo union svetlo 0,33l stek. | 0.8805 | **0.95** | **+7.9 %** | Podražitev |
| PIVO LAŠKO ZLATOROG 0,33L STV | Pivo laško zlatorog 0,33l stek. | 0.8805 | **0.8805** | **0 %** | Nespremenjeno |
| NEKT FRUCTAL ŠG BRESKEV 0,2L ST | Sok breskev 0,2l stek. | 0.6185 | **0.57** | **−7.8 %** | Znižanje |
| NEKT FRUCTAL ŠG JAGODA 0,2L ST | Sok jagoda 0,2l stek. | 0.6667 | **0.75** | **+12.5 %** | Podražitev |
| PELINKOVEC DANA 1L | Pelinkovec 1l | 8.1453 | **8.63** | **+6.0 %** | Podražitev (22 % DDV) |
| TRAVARICA DALMACIJAVINO 1L | Travarica 1l | 14.3555 | **13.92** | **−3.0 %** | Znižanje (22 % DDV) |
| ČOKOLADNI NAPITEK PREMIER 1L | — | — | — | — | **BREZ UJEMANJA** (preskoči) |

> Stara cena = `zadnja_cena_enota` iz `artikel_dobavitelj`; nova = cena v testni datoteki.

---

## Korak za korakom

### 1. Odpri uvoz cenika

V POS navigaciji (leva stranska vrstica) klikni **"Uvoz cenika"** (ikona Tag).

### 2. Izberi profil in dobavitelja

- Spustni seznam **Dobavitelj** → izberi **DAVIDOV HRAM d.o.o. Ljubno**
- Spustni seznam **Profil** → izberi:
  - za CSV: **Davidov Hram — testni cenik (CSV)**
  - za XLSX: **Davidov Hram — testni cenik (XLSX)**

### 3. Naloži datoteko

- Klikni gumb za izbiro datoteke
- Izberi `davidov-hram-cenik.csv` (ali `.xlsx`)
- Klikni **Predogled** (ali ekvivalentni gumb za prikaz ujemanj)

### 4. Preveri predogled

Predogled mora prikazati:
- **7 ujemanj** (samodejno ali z visoko zanesljivostjo — naziv se ujema z `naziv_dobavitelja` v `artikel_dobavitelj`)
- **1 vrstica brez ujemanja**: `ČOKOLADNI NAPITEK PREMIER 1L` — označena kot "ni ujemanja" ali rdeče
- Za vsak artikel: stara cena → nova cena → % razlika (prim. tabelo zgoraj)
- DDV 9.5 % za pive/sokove, 22 % za žganje

> ⚠️ **Pozor:** Če se ujema manj kot 7 artiklov — verjetno je profil izbran napačen ali je naziv v datoteki drugačen od `naziv_dobavitelja` v bazi.

### 5. Potrdi uvoz

Klikni **Potrdi** (ali **Uvozi**).  
Program ne ustvari prejemnice, ne spremi zaloge, ne ustvari novih artiklov.

### 6. Preveri rezultat

Po potrditvi preveri v bazi ali v POS vmesniku:

**a) Preverjanje v POS — šifrant artiklov / dobavniki:**
- Odpri artkel → Zaloge → preslikave za Davidov Hram
- `zadnja_cena_enota` se mora ujemati z novo ceno iz datoteke

**b) Preverjanje v bazi (SQL):**
```sql
SELECT ad.naziv_dobavitelja, ad.zadnja_cena_enota, ad.zadnja_ddv_stopnja, ad.zadnji_prevzem
FROM artikel_dobavitelj ad
WHERE ad.dobavitelj_id = 23 AND ad.enota_id = 5
ORDER BY ad.naziv_dobavitelja;
```

Pričakovano po uvozu:
| naziv_dobavitelja | zadnja_cena_enota |
|---|---|
| PIVO UNION SVETLO 0,5L STV | **1.09** |
| PIVO UNION SVETLO 0,33L STV | **0.95** |
| PIVO LAŠKO ZLATOROG 0,33L STV | **0.8805** |
| NEKT FRUCTAL ŠG BRESKEV 0,2L ST | **0.57** |
| NEKT FRUCTAL ŠG JAGODA 0,2L ST | **0.75** |
| PELINKOVEC DANA 1L | **8.63** |
| TRAVARICA DALMACIJAVINO 1L | **13.92** |

---

## Kaj NE sme biti po uvozu

- ❌ Nova vrstica v tabeli `prejemnice` — cenik ne ustvari dobavnice
- ❌ Sprememba v tabeli `zaloge` ali `zaloga_gibi` — zaloga ostane nespremenjena
- ❌ Nov artikel v tabeli `artikli` — `ČOKOLADNI NAPITEK PREMIER 1L` ni ustvarjen
- ❌ `ČOKOLADNI NAPITEK PREMIER 1L` v `artikel_dobavitelj` — brez ujemanja, preskočen

Kontrolni SQL:
```sql
-- Zaloge se niso spremenile (ni novih gibov)
SELECT COUNT(*) FROM zaloga_gibi WHERE created_at > NOW() - INTERVAL '5 minutes';

-- Ni novih prejemnic
SELECT COUNT(*) FROM prejemnice WHERE ustvarjeno > NOW() - INTERVAL '5 minutes';

-- Ni novih artiklov
SELECT COUNT(*) FROM artikli WHERE aktiven = true AND id > 111;
```

---

## Znaki napake

| Opazovano | Verjetni vzrok |
|---|---|
| 0 ujemanj v predogledu | Napačen profil (za XLSX izbran CSV profil ali obratno) |
| Profil ni v seznamu | Enota ni "Privzeto" — preveri, da si prijavljen na pravo enoto |
| `ČOKOLADNI NAPITEK PREMIER 1L` se ujame | Obstaja preslikava v bazi — preverite `artikel_dobavitelj` |
| Cena po uvozu ni nova | Uvoz je nakazal napako ali ni bil potrjen |
| Artikel brez DDV po uvozu | DDV stolpec ni bil pravilno razčlenjen — preverite, da profil kaže `ddv: 2` |

---

*Generirano: 2026-08-03 za razvojno okolje (enota Privzeto, id=5)*
