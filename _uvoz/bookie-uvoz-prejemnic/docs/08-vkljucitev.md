# Vključitev v obstoječi projekt

Vrstni red ni poljuben — vsak korak je pogoj za naslednjega.

---

## 1. Kam gre kaj

Struktura tega paketa **že ustreza** strukturi projekta BOOKIE. Mapi
`lib/` in `artifacts/` se prelijeta v obstoječi projekt; nič se ne
prepiše, razen dveh datotek, ki ju je treba dopolniti ročno (točka 4).

```
lib/db/src/schema/pos/uvoz-prejemnic.ts        nova
lib/db/src/migrations/0009_uvoz_prejemnic.sql  nova

artifacts/api-server/src/lib/kripto.ts         nova
artifacts/api-server/src/lib/uvoz/             nova mapa, 8 datotek
artifacts/api-server/src/routes/pos/uvoz-prejemnic.ts  nova
artifacts/api-server/src/routes/pos/uvoz-profili.ts    nova
artifacts/api-server/src/scheduled/zajem.ts            nova

artifacts/web/src/pos/uvoz/                    nova mapa, 5 datotek
```

Mapi `docs/` in `tests/` sodita v repozitorij, ne v `src`.

---

## 2. Odvisnosti

```bash
npm i decimal.js zod papaparse xlsx iconv-lite fast-xml-parser multer
npm i imapflow mailparser
npm i -D @types/papaparse @types/multer @types/mailparser tsx
```

`drizzle-orm` in `typescript` sta že v projektu.

**Opozorilo glede XML.** Razčlenjevalnika uporabljata `fast-xml-parser`,
ki ne bere DTD in ne razrešuje zunanjih entitet. Za dokumente iz
e-poštnega predala je to nujno. Če ju zamenjate za `xml2js` ali
`libxmljs`, preverite nastavitve — predal je edini vhod, ki ga lahko
naslovi kdorkoli.

---

## 3. Migracija

```bash
npx drizzle-kit generate
```

Nato **ročno** prilepite v ustvarjeno datoteko:

| Razdelek iz `0009_uvoz_prejemnic.sql` | Kam | Zakaj |
|---|---|---|
| 1 — funkcije `f_unaccent`, `naziv_norm`, `gtin_*` | **pred** tabele | od njih visi generirani stolpec |
| 6 — GIN indeksi z `gin_trgm_ops` | na konec | Drizzle nima zapisa za operatorski razred |
| delni indeksi z `WHERE` | na konec | Drizzle jih ne generira |

Vse je v priloženi datoteki že na pravih mestih — najlažje je uporabiti
njo in preskočiti `drizzle-kit generate`.

```bash
npx drizzle-kit migrate
```

Preverite izpis na koncu migracije:

```
pg_trgm  : ok
unaccent : ok
naziv_norm("Čaj vrečka - Kamilica") = caj vrecka kamilica
podobnost testnega para = 0.750
```

Če razširitvi manjkata, glejte `07-replit.md`, razdelek 4 — kaskada
deluje tudi brez njiju, izgubi le tretjo stopnjo.

**Migracijo uveljavite v obeh zbirkah**, razvojni in produkcijski.

---

## 4. Dopolnite obstoječo shemo

V `lib/db/src/schema/pos/prejemnice.ts` dodajte stolpce, ki jih migracija
ustvari. Popoln seznam je v komentarju na koncu
`schema/pos/uvoz-prejemnic.ts`. Brez tega jih Drizzle ne vidi in tipi ne
bodo ustrezali bazi.

V `artikli.ts` dodajte `gtin` in `nabavna_ddv_stopnja`.

---

## 5. Registrirajte rute

```ts
// artifacts/api-server/src/routes/index.ts
import uvozPrejemnic from './pos/uvoz-prejemnic';
import uvozProfili from './pos/uvoz-profili';

app.use('/api/pos/uvoz', uvozPrejemnic);
app.use('/api/pos/uvoz', uvozProfili);
```

Rute pričakujejo, da obstajata `../../db` in
`../../middleware/avtorizacija` z izvozom `zahtevajPravico` ter tipom
`AvtoriziranRequest`. Če se imena razlikujejo, prilagodite uvoze.

---

## 6. Pravice

| Pravica | Kaj omogoča |
|---|---|
| `PREVZEM_VNOS` | nalog datoteke, pregled sej, uvozni profili |
| `PREVZEM_UPARJANJE` | potrditev uparjanja, uvoz cenika, preslikave |
| `PREVZEM_ODSTOPANJE_CENE` | potrditev preseženega praga cene |

**Ločitev nalog:** kdor prevzema blago, praviloma nima pravice
`PREVZEM_ODSTOPANJE_CENE`. Sicer se odstopanja tiho potrjujejo in
kontrola nima učinka.

---

## 7. Objave na Replitu

| Objava | Vrsta | Ukaz | Urnik |
|---|---|---|---|
| `pos-gostinstvo` | Autoscale | obstoječi | — |
| `pos-opravila` | Scheduled | `npx tsx artifacts/api-server/src/scheduled/zajem.ts` | vsakih 10 min |

Skrivnost `IMAP_ENC_KEY` v Replit Secrets, vsaj 32 znakov. Preverite jo
s `preveriKljuc()` iz `lib/kripto.ts`.

---

## 8. Zaporedje uvedbe pri stranki

| Korak | Kaj | Merilo, da je korak zaključen |
|---|---|---|
| 1 | Migracija v razvoju | izpis na koncu migracije je čist |
| 2 | Uvoz cenika za enega dobavitelja | nad 80 % vrstic uparjenih v predogledu |
| 3 | Uvozni profil za istega dobavitelja | živi predogled pokaže pravilne postavke |
| 4 | Ročni nalog ene dobavnice | osnutek se ujema z ročno vnesenim |
| 5 | Vzporedno delo teden dni | uvožene in ročne prejemnice se ujemajo |
| 6 | Predal deluje, razčlenitve še ni | vidite, kaj prihaja in v kakšnih oblikah |
| 7 | Razčlenitev, brez ustvarjanja osnutkov | teden dni brez blokirnih napak |
| 8 | Ustvarjanje osnutkov vklopljeno | — |
| 9 | Šele zdaj obvestite dobavitelje | — |

Koraka 2 in 3 sta pomembnejša, kot je videti. Brez preslikav je prva
dobavnica skoraj v celoti ročna: 40 postavk, 40 odločitev. Uvoz cenika
to opravi vnaprej.

---

## 9. Kar preveriti pred produkcijo

Mesta so v kodi označena z `⚠ PREVERI`.

**Imena tabel in stolpcev.** Migracija predpostavlja `prejemnice`,
`prejemnice_postavke`, `artikli`, `partnerji`, `podjetje_id`, `aktiven`,
`tip`, `cena_enota`, `kolicina_enot`, `enot_v_paketu`.

**Vrednosti tipa artikla.** Uparjanje filtrira po
`tip IN ('NABAVNI', 'NABAVNO_PRODAJNI')`.

**`CustomizationID` za e-SLOG 2.0** v `uvoz-service.ts`. Niz ni potrjen
iz uradne specifikacije. Vzemite ga iz prvega resničnega e-SLOG računa.

**Tabela `POTI` v `parser-eslog161.ts`.** Imena XML elementov niso
potrjena, kvalifikatorji so. Funkcija `izpisiZgradbo()` izpiše dejansko
drevo, da popravek ni ugibanje.

**Konti glavne knjige** v `03-izracun-in-knjizenje.md`. Navedeni so
tipični po enotnem kontnem okviru; potrdite jih z računovodjo stranke
pred prvim knjiženjem.

---

## 10. Odprta vprašanja

**V1.** Kljukica »Vsebuje dodan sladkor« — velja samo za izstopni DDV ali
tudi za vstopnega? Od tega je odvisno, ali je `nabavna_ddv_stopnja`
izpeljiva iz kategorije ali mora ostati samostojno polje.

**V2 — najpomembnejše.** Ali obstajajo normativi oziroma recepture?
Priročnik jih ne omenja. Če jih ni, se surovine razknjižijo šele ob
inventuri; zaloga je vmes knjižno napačna, razlike med teoretično in
dejansko porabo pa ni mogoče izračunati. V tem primeru prinaša
natančnejši uvoz manj koristi, kot bi jih prinesla uvedba normativov —
natančna nabavna cena se izplača šele, ko se prenese v ceno porcije.

**V3.** Kje se vodijo prejeti računi dobaviteljev? Od tega je odvisno,
ali je usklajevanje znotraj POS ali čez modula.

**V4.** Eno skladišče na enoto ali več (bar in kuhinja ločeno)?

**V5.** Ali ima prejemnica lastno številčenje?

**V6.** Kdo v praksi vnaša prejemnice — vodja enote ali osebje z vlogo
*Uporabnik*? Priročnik razdelka Zaloge ne veže na vlogo. Če so
prejemnice dostopne vsem, je kontrola odstopanja cen brez ločene pravice
neučinkovita.

---

## 11. Kaj ostaja neizvedeno

| Kaj | Ocena koristi |
|---|---|
| EDIFACT DESADV / INVOIC / PRICAT | odvisna od tega, ali ga kateri dobavitelj sploh pošilja |
| PDF s predlogo | verjetno visoka, a kakovost je odvisna od resničnih vzorcev |
| OCR skeniranih dokumentov | nizka, dokler PDF s predlogo ne deluje |
| Peppol Access Point | pripravljeno na ravni razčlenjevalnika, manjka prenos AS4 |

Pri PDF bi bilo pred pisanjem koristno imeti eno resnično dobavnico
dobavitelja, ki jih pošilja redno. Brez nje bi se predloge gradile na
ugibanju.
