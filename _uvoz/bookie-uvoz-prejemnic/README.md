# Uvoz prejemnic — BOOKIE ERP / POS Gostinstvo

Modul, ki dobaviteljeve dobavnice in račune spremeni v osnutek prejemnice.

**Uvoz ne ustvari nove poti do zaloge.** Ustvari osnutek v isti tabeli,
ki jo polni obstoječi ročni vnos, in ga preda obstoječemu zaslonu
»Uredi prejemnico«. Vse za tem ostane nedotaknjeno.

```
datoteka ──► zajem ──► razčlenitev ──► uparjanje ──► OSNUTEK PREJEMNICE
   ▲                                        │              │
   │                                        ▼              ▼
e-pošta                              zaslon uparjanja   obstoječi zaslon
Peppol                               (samo neuparjene)  ──► F2 shrani
                                                             │
                                                             ▼
                                                          zaloga
```

---

## Kaj je notri

| Mapa | Vsebina |
|---|---|
| `docs/` | zasnova, odločitve, navodilo za uvedbo |
| `lib/db/src/` | Drizzle shema in migracija 0009 |
| `artifacts/api-server/src/lib/uvoz/` | razčlenjevalniki, uparjanje, storitve |
| `artifacts/api-server/src/routes/pos/` | rute Express |
| `artifacts/api-server/src/scheduled/` | urnikovano opravilo za Replit |
| `artifacts/web/src/pos/uvoz/` | zasloni React |
| `tests/` | 9 testnih sklopov, brez ogrodja |

### Podprti formati

| Format | Stanje | Datoteka |
|---|---|---|
| CSV, XLSX (profil po dobavitelju) | deluje | `parser-csv.ts` |
| e-SLOG 2.0, UBL 2.1, Peppol BIS | deluje | `parser-eslog.ts` |
| UN/CEFACT CII (D16B) | deluje | `parser-eslog.ts` |
| e-SLOG 1.6.1 | deluje, poti niso potrjene | `parser-eslog161.ts` |
| EDIFACT DESADV / INVOIC / PRICAT | **ni** | preslikave v `docs/02-formati.md` |
| PDF s predlogo, OCR | **ni** | zasnova v `docs/02-formati.md` |

---

## Namestitev

Dve poti, odvisno od tega, kaj počnete.

### A. Preizkus paketa samostojno (priporočeno najprej)

Razpakirajte kamor koli in v tej mapi:

```bash
npm install
npm test          # 9 sklopov, ne potrebuje zbirke
npm run typecheck
```

Testi ne potrebujejo podatkovne zbirke — preizkušajo razčlenitev,
pretvorbe in izračune, ne poizvedb.

`npm run typecheck` bo javil 8 napak oblike `Cannot find module '../../db'`
in podobno. **To je pričakovano** — ti moduli obstajajo šele v projektu
BOOKIE. Drugih napak ne sme biti.

### B. Vključitev v BOOKIE

**Priloženega `package.json` NE kopirajte v projekt** — povozil bi vaše
odvisnosti. Namesto tega prelijte le mapi `lib/` in `artifacts/`, nato v
korenu projekta:

```bash
npm i decimal.js zod papaparse iconv-lite fast-xml-parser multer
npm i imapflow mailparser
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm i -D @types/papaparse @types/multer @types/mailparser tsx
```

**SheetJS se namesti s CDN, ne z npm.** Paket `xlsx` na npm je obstal
pri 0.18.5 iz leta 2022 in ima dve nepopravljeni ranljivosti
(prototype pollution, ReDoS), popravljeni šele v 0.19.3 in 0.20.2, ki
ju na npm ni. Ta ukaz namesti 0.20.3 z uradnega vira SheetJS z
nespremenjenim vmesnikom.

Če v projektu že imate `drizzle-orm`, preverite različico: v izdajah
pred 0.45.2 obstaja vstavljanje SQL prek neustrezno ubežanih
identifikatorjev.

---

## Uvedba v projekt

Podroben vrstni red je v **`docs/08-vkljucitev.md`**. Na kratko:

1. **Migracija.** `drizzle-kit generate`, nato ročno prilepi razdelke 1
   in 6 iz `0009_uvoz_prejemnic.sql` — funkcije in GIN indekse, ki jih
   Drizzle ne zna ustvariti. Uveljavi v **obeh** zbirkah, razvojni in
   produkcijski.
2. **Dopolni obstoječo shemo** `prejemnice.ts` z novimi stolpci (seznam
   je v komentarju na koncu `uvoz-prejemnic.ts`).
3. **Registriraj rute** in dodaj pravice `PREVZEM_VNOS`,
   `PREVZEM_UPARJANJE`, `PREVZEM_ODSTOPANJE_CENE`.
4. **Objavi urnikovano opravilo** kot ločeno Scheduled objavo na Replitu.

---

## Kar je treba preveriti pred produkcijo

Mesta so v kodi označena z `⚠ PREVERI`.

| Kaj | Kje | Zakaj |
|---|---|---|
| Imena tabel in stolpcev | migracija 0009 | predpostavljena so `prejemnice`, `artikli`, `partnerji`, `podjetje_id` |
| Vrednosti tipa artikla | `uparjanje.ts` | filter `tip IN ('NABAVNI','NABAVNO_PRODAJNI')` |
| `CustomizationID` za e-SLOG 2.0 | `uvoz-service.ts` | niz ni potrjen iz uradne specifikacije |
| Poti elementov e-SLOG 1.6.1 | `parser-eslog161.ts`, tabela `POTI` | imena elementov niso potrjena |
| Konti glavne knjige | `docs/03-izracun-in-knjizenje.md` | potrdi z računovodjo stranke |
| Razširitvi `pg_trgm`, `unaccent` | izpis ob koncu migracije | brez njiju odpade tretja stopnja uparjanja |

---

## Tri pravila, ki se ponavljajo skozi celoten modul

**Cena se primerja na enoto, nikoli na paket.** Če dobavitelj zmanjša
karton s 24 na 20 kosov ob nespremenjeni ceni kartona, je to
20-odstotna podražitev, ki je na računu ni videti. Zato gre v preslikavo
cena enote, poročilo o odstopanjih primerja enote, sprememba pakiranja
pa dobi lastno vprašanje namesto tihega uparjanja.

**Naziv sam ne zadošča za uparjanje.** »Pivo svetlo 0,5 l« in »Pivo
svetlo 0,33 l« se ujemata enako visoko kot pravilen zadetek s pripono
pakiranja — po nazivu sta neločljiva, tudi s trigrami. Samodejno
uparjanje zato zahteva hkrati ujemanje nad pragom **in** ceno v okviru
15 %.

**Vstopni DDV ni izstopni DDV.** Kavna zrna se kupijo po nižji stopnji,
kava pri mizi se proda po višji, in oboje je pravilno. Polje
`artikli.nabavna_ddv_stopnja` je ločeno prav zato.

---

## Odprta vprašanja

Ta so ostala neodgovorjena in vplivajo na to, koliko koristi bo modul
prinesel. Podrobneje v `docs/08-vkljucitev.md`.

**Najpomembnejše: ali obstajajo normativi oziroma recepture?**
Priročnik jih ne omenja. Če jih ni, se surovine razknjižijo šele ob
inventuri; zaloga je vmes knjižno napačna in razlike med teoretično in
dejansko porabo ni mogoče izračunati. V tem primeru bi uvedba normativov
prinesla več kot nadaljnje delo na uvozu — natančna nabavna cena se
izplača šele takrat, ko se prenese v ceno porcije.

Ostala: obravnava dodanega sladkorja pri **vstopnem** DDV, kje se vodijo
prejeti računi dobaviteljev, eno ali več skladišč na enoto, ali ima
prejemnica lastno številčenje, kdo v praksi vnaša prejemnice.
