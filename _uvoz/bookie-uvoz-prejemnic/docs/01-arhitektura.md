# Arhitektura modula

---

## 1. Vodilo

Uvoz ne uvaja druge poti do zaloge. Uvaja drug način, kako se napolni
**isti** obrazec prejemnice, ki že obstaja.

```
       ┌────────────────────────────────────────────────┐
       │  NOVO                                          │
datoteka →│  zajem → razčlenitev → uparjanje → osnutek  │
       └────────────────────────┬───────────────────────┘
                                ▼
       ┌────────────────────────────────────────────────┐
       │  OBSTOJEČE — nespremenjeno                     │
       │  zaslon »Uredi prejemnico« → F2 → zaloga       │
       │  izdajnice · inventura · otvoritvene zaloge    │
       └────────────────────────────────────────────────┘
```

Posledica te odločitve: knjiženje, vrednotenje zaloge in razknjižba
ostanejo nedotaknjeni. Modul lahko odpove, ne da bi karkoli pokvaril —
najslabši izid je, da uporabnik prejemnico vnese ročno, kot doslej.

---

## 2. Cevovod

```
ZAJEM ──► RAZPOZNAVA ──► RAZČLENITEV ──► DOBAVITELJ ──► OSNUTEK ──► UPARJANJE
  │            │              │              │             │            │
kanal      format      parser po formatu   davčna     prejemnice   kaskada
                                          številka                     │
  │                                                                    ▼
  └─► uvoz_seja (izvirnik + SHA-256)                          zaslon uparjanja
      nespremenjen, ponovno obdeljiv                          (samo neuparjene)
```

**Izvirna datoteka se shrani nespremenjena** skupaj s SHA-256 odtisom.
Vsaka nadaljnja obdelava je ponovljiva iz izvirnika — to je nujno za
revizijsko sled in za ponovno obdelavo po popravku uvoznega profila.

**SHA-256 je enoličen na podjetje.** Ista datoteka po katerem koli
kanalu se obdela enkrat. Ločeno velja poslovna zaščita: enak dobavitelj,
številka in datum dokumenta se ne moreta prevzeti dvakrat, tudi če
prideta v dveh različnih datotekah (XML in PDF istega računa).

---

## 3. Kanonični model

Vsak razčlenjevalnik vrne isti `PrejemDTO`. Nič za njim ne ve, iz
katerega formata je dokument prišel.

```
CSV/XLSX ──┐
e-SLOG 2.0 ├──► PrejemDTO ──► uparjanje ──► osnutek prejemnice
UBL/Peppol ├──►              (isti tok ne glede na izvor)
CII        ├──►
e-SLOG 1.6.1─┘
```

Denarni zneski in količine so `Decimal`, **nikoli** `number`. Cena 5,476
v dvojiški plavajoči vejici ni 5,476, razlika pa se v zalogi sešteje.

---

## 4. Kaskada uparjanja

| Stopnja | Ključ | Zaupanje | Ravnanje |
|---|---|---|---|
| 1 | GTIN (poravnan na 14 mest) | 100 % | samodejno |
| 2 | `dobavitelj_id` + šifra dobavitelja | 100 % | samodejno |
| 3 | podobnost naziva (`pg_trgm`) **in** cena v okviru 15 % | 60–95 % | samodejno nad pragom |
| 4 | brez zadetka | — | ročno |

**Cena je nujen drugi razsodnik pri stopnji 3.** Preizkus je pokazal, da
»Pivo svetlo 0,5 l« in »Pivo svetlo 0,33 l« dosežeta enako oceno kot
pravilen zadetek s pripono pakiranja. Po nazivu sta neločljiva.

**Učenje.** Vsaka ročna potrditev zapiše trajno preslikavo v
`artikel_dobavitelj`. Po nekaj prevzemih od istega dobavitelja je uvoz
praktično popolnoma samodejen. Uvoz cenika ta korak preskoči in napolni
preslikave vnaprej.

Uparjajo se **samo** artikli tipa `NABAVNI` in `NABAVNO_PRODAJNI`.
Artikli tipa `PRODAJNI` so po definiciji šifranta izključeni s
prejemnic, kar hkrati močno zmanjša prostor kandidatov.

---

## 5. Kanali zajema

| Kanal | Stanje | Objava |
|---|---|---|
| Ročni nalog datoteke | deluje | Autoscale, znotraj zahtevka |
| Namenski predal IMAP | deluje | **Scheduled**, vsakih 10 min |
| Peppol Access Point | pripravljeno (isti razčlenjevalnik) | — |
| API dobavitelja | ni | — |

IMAP teče kot urnikovano opravilo, ne kot trajna povezava IDLE. Razlog
in posledice so v `07-replit.md`.

---

## 6. Kaj se hrani kje

| Podatek | Kje | Zakaj |
|---|---|---|
| Izvirna datoteka do 2 MB | `uvoz_seja.vsebina` (BYTEA) | datotečni sistem pri Autoscale objavi je minljiv |
| Izvirna datoteka nad 2 MB | Replit App Storage, ključ v zbirki | 20 GB zbirke ne gre trošiti za skenirane PDF |
| Razčlenjen DTO | `uvoz_seja.razclenitev` (JSONB) | primerjava po ponovni obdelavi |
| Naučene preslikave | `artikel_dobavitelj` | jedro avtomatizacije |
| Geslo predala | zbirka, šifrirano AES-GCM | ključ je v Replit Secrets, geslo ne more biti |

---

## 7. Kaj modul namenoma ne počne

**Ne knjiži samodejno.** Uvoz vedno konča v osnutku, ki ga potrdi človek.
Samodejno knjiženje iz e-pošte bi pomenilo, da lahko kdorkoli, ki pozna
naslov znanega dobavitelja, spremeni zalogo.

**Ne ugiba tiho.** Kjer sistem ne more biti gotov — pakiranje se je
spremenilo, naziv se ujema le delno, cena odstopa — vpraša. Tiho ugibanje
pri preslikavah pomeni napake, ki se odkrijejo šele ob inventuri, več
mesecev kasneje.

**Ne popravlja izvornih podatkov.** Polja `izv_*` na postavki ostanejo
taka, kot so prišla. Razrešene vrednosti so v ločenih poljih. Ko čez pol
leta nekdo vpraša, zakaj je cena taka, je izvirnik še tam.
