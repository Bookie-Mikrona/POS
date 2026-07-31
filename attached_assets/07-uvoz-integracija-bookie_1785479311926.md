# Uvoz prejemnic — predelano za BOOKIE ERP / POS Gostinstvo

Predelava specifikacije 01–06 glede na dejansko stanje sistema, kot ga opisuje priročnik v. 2.1 in zaslon ročnega vnosa.

**Vodilo:** uvoz ne ustvari nove poti do zaloge. Uvoz je samo drugačen način, kako se napolni **isti** obrazec prejemnice, ki že obstaja. Vse, kar se zgodi po shranjevanju, ostane nedotaknjeno.

```
       ┌──────────────────────────────────────┐
       │  OBSTOJEČE — se ne spreminja         │
datoteka →│ UVOZNI SLOJ │→ prejemnica → zaloga → izdajnice/inventura
       │  NOVO                                │
       └──────────────────────────────────────┘
```

---

## 1. Uskladitev s specifikacijo 01–06

| Iz specifikacije | Stanje v BOOKIE | Ravnanje |
|---|---|---|
| `artikel`, osnovna enota | obstaja, s tipi Prodajni / Nabavni / Nabavno-prodajni | **uporabi obstoječega**, ne dodajaj |
| `partner` z AJPES | obstaja, hitri vnos po davčni | uporabi; gumb `+` na prejemnici je že prava pot |
| `prejem` + `prejem_postavka` | obstaja (zaslon »Uredi prejemnico«) | **razširi z nekaj polji**, ne nadomeščaj |
| `zaloga_promet` | obstaja (prejemnice, izdajnice, inventura, otvoritvene) | uporabi |
| `artikel_pakiranje` | delno — paketni vnos 📦 je ad hoc na vrstici, se ne shrani | dodaj trajno hrambo |
| `artikel_dobavitelj` (preslikave) | **ne obstaja** | **dodaj — to je jedro uvoza** |
| `uvoz_seja` | ne obstaja | dodaj |
| Rabati | ne obstajajo | dodaj (2 polji) |
| Odvisni stroški nabave | ne obstajajo | faza 3, neobvezno |
| Lot / rok uporabe | ne obstajata | faza 3 |
| Naročilnica | **ne obstaja** | trismerno usklajevanje odpade → dvosmerno |
| Prejeti račun | ni v POS | glej vprašanje V3 |
| Več skladišč | ni razvidno | glej vprašanje V4 |

**Posledica:** obseg dela je bistveno manjši, kot sem prvotno predvidel. Približno dve tretjini dokumenta 01 sta odveč. Ostane troje: preslikave artiklov, uvozne seje in nekaj polj na prejemnici.

---

## 2. Ključna ugotovitev: vstopni DDV ni izstopni DDV

To je najpomembnejši popravek moje prvotne specifikacije. Pravilo `POS009` (»DDV stopnja ≠ davčna skupina artikla → opozorilo«) je bilo **napačno** in bi v vašem sistemu sprožalo lažna opozorila pri skoraj vsaki prejemnici.

Vaša tabela davčnih kategorij določa **izstopni** DDV ob prodaji, in sicer glede na način strežbe:

| Kategorija | Pri mizi | Za s seboj (liberalno) |
|---|---|---|
| `hot_beverage` | 22 % | 9,5 % |
| `cold_beverage` | 22 % | 9,5 % |

Da je strežba iste hladne pijače za s seboj obdavčena z 9,5 %, pomeni, da **blago samo po sebi** sodi v nižjo stopnjo. Višja stopnja pri mizi izhaja iz strežbe kot storitve, ne iz narave blaga.

Zato velja:

```
Kavna zrna kupljena od dobavitelja      → vstopni DDV  9,5 %
Kava, postrežena pri mizi               → izstopni DDV 22 %
Kava za s seboj (liberalno)             → izstopni DDV  9,5 %
```

Prejemnica pravilno izkazuje 9,5 %, artikel pa ima kategorijo `hot_beverage` (22 %). To **ni** napaka in ne sme sprožiti opozorila.

### Kaj namesto tega

Uvedi na artiklu **ločeno polje `nabavna_davcna_stopnja`** (pričakovana vstopna stopnja), neodvisno od prodajne kategorije. Validacija uvoza primerja dokument s tem poljem, ne s prodajno kategorijo.

```sql
ALTER TABLE artikel ADD COLUMN nabavna_ddv_stopnja NUMERIC(5,2);
```

Privzeta vrednost ob prvem prevzemu se prevzame iz dokumenta in se od takrat uporablja za kontrolo. Če se naslednjič razlikuje, je to smiselno opozorilo — dobavitelj je spremenil obravnavo ali pa je artikel napačno uparjen.

Popravljeno pravilo:

> **`POS009a`** — vstopna stopnja iz dokumenta ≠ `artikel.nabavna_ddv_stopnja` → opozorilo (O).
> **`POS009b`** — vstopna stopnja iz dokumenta ni ena od veljavnih (22 / 9,5 / 5 / 0) → blokada (B).

**Vprašanje za preverbo:** kljukica »Vsebuje dodan sladkor« postavi izstopno stopnjo na 22 %. Ali je pri teh pijačah tudi **nabavna** stopnja 22 %, ali ostane 9,5 %? Od odgovora je odvisno, ali lahko `nabavna_ddv_stopnja` izpeljem iz kategorije ali mora biti vedno samostojno polje. (Glej V1.)

---

## 3. Uparjanje, prilagojeno vašemu šifrantu

Kaskada iz dokumenta 03 ostane, z dvema spremembama.

### 3.1 Filter po tipu artikla

Uparjajo se **samo** artikli tipa `Nabavni` in `Nabavno-prodajni`. Artikli tipa `Prodajni` so po vaši lastni definiciji izključeni s prejemnic.

```sql
AND a.tip IN ('NABAVNI', 'NABAVNO_PRODAJNI')
```

To hkrati močno zmanjša prostor kandidatov pri iskanju po podobnosti naziva in dvigne natančnost. Pica *Margherita* (prodajni) ne bo nikoli tekmovala z *moko tip 500* (nabavni).

### 3.2 Ni GTIN — kaskada se skrajša

V šifrantu ni polja za črtno kodo, zato prve dve stopnji odpadeta. Delujoča kaskada:

| Stopnja | Ključ | Zaupanje |
|---|---|---|
| 1 | `dobavitelj_id` + šifra dobavitelja (naučeno) | 100 % |
| 2 | podobnost naziva (trigram, filtrirano po tipu) | 60–85 % |
| 3 | ročno | — |

**Priporočam, da dodate polje GTIN na artikel.** Brez njega je edini zanesljiv ključ šifra dobavitelja, kar pomeni, da se za vsakega dobavitelja učite od začetka. Z GTIN se isti izdelek prepozna pri Tušu, Metru in pivovarni hkrati.

```sql
ALTER TABLE artikel ADD COLUMN gtin TEXT;
CREATE UNIQUE INDEX ux_artikel_gtin ON artikel (podjetje_id, gtin) WHERE gtin IS NOT NULL;
```

Polnjenje ni ročno delo: ob prvi ročni potrditvi uparjanja se GTIN iz dokumenta zapiše samodejno.

### 3.3 Zagon brez zgodovine

Ker preslikav še ni, bo prva prejemnica vsakega dobavitelja skoraj v celoti ročna. Dve poti za pospešitev:

**A. Uvoz cenika.** Tuš Cash&Carry, Metro in večji distributerji dajo cenik v Excelu. Enkraten uvoz napolni preslikave vnaprej in prva dobavnica je uparjena avtomatsko.

**B. Retroaktivno učenje iz obstoječih prejemnic.** Če imate v bazi že ročno vnesene prejemnice, iz njih ni mogoče izpeljati šifer dobavitelja (teh ni v vnosu), lahko pa se izpelje **kombinacija dobavitelj + artikel + tipična cena**. To zoži seznam kandidatov ob uvozu na artikle, ki jih od tega dobavitelja dejansko kupujete. Poceni izboljšava, ki takoj dvigne uspešnost samodejnega uparjanja.

---

## 4. Preslikava v paketni vnos 📦

Vaš paketni vnos že ima točno pravo strukturo:

```
5 kartonov × 6 steklenic po 3,60 €/karton = 30 steklenic po 0,60 €
```

Uvoz mora to napolniti, ne obiti. Preslikava iz vhodnih formatov:

| Vhod | → paketi | → enot/paket | → cena |
|---|---|---|---|
| e-SLOG: `InvoicedQuantity` = 5, `unitCode` = `CT` | 5 | iz `artikel_dobavitelj.faktor_pretvorbe` | `PriceAmount` |
| e-SLOG: `unitCode` = `H87` (kos) | 1 | količina | cena/kos |
| CSV z ločenim stolpcem pakiranja | stolpec | stolpec | stolpec |
| EDIFACT `PAC+5++CT` + `QTY+12:30:PCE` | 5 | 30 / 5 = 6 | iz `PRI` |

Če faktor ni znan, uvoz **ne ugiba**: postavka se uvozi kot 1 paket × *n* enot in se označi z opozorilom `POS015a` (»pakiranje ni določeno«). Uporabnik ga popravi enkrat, sistem si ga zapomni.

**Past, ki jo je treba pokriti:** dobavitelj spremeni pakiranje iz 6 na 4 steklenice v kartonu. Cena kartona ostane enaka, cena steklenice zraste za 50 %. Če se faktor jemlje iz zapomnjene preslikave in ne iz dokumenta, tega ni videti. Zato: **kadar dokument navaja število enot v paketu, ima prednost pred zapomnjenim faktorjem**, in če se razlikujeta, sproži opozorilo.

---

## 5. Neto / Bruto — samodejna nastavitev preklopa

Vaš preklop na ravni dokumenta je pravilna zasnova. Uvoz ga nastavi sam:

| Format | Privzeto | Utemeljitev |
|---|---|---|
| e-SLOG 2.0, UBL, CII, Peppol | **Neto** | EN 16931 zahteva neto osnove postavk |
| EDIFACT INVOIC | **Neto** | `MOA+203` je neto vrednost postavke |
| CSV / XLSX | iz profila dobavitelja | Cash&Carry pošilja bruto, veletrgovci neto |
| PDF / OCR | iz profila, sicer vpraša | ni zanesljivo določljivo |

Zaznava za CSV brez profila: če `Σ(količina × cena) ≈ prikazana skupna vrednost z DDV`, gre za bruto. Toleranca 0,5 %.

**Opozorilo glede zaokroževanja.** Kot sem omenil ob zaslonu: pri preklopu na bruto se neto računa nazaj iz bruto. Če se vmesni rezultat zaokroži pred množenjem s količino, nastane sistematična razlika. V uvozu je to nevarnejše kot pri ročnem vnosu, ker gre skozi hkrati na stotine postavk. Vmesne vrednosti hrani na šest decimalk, zaokroži šele znesek postavke.

---

## 6. Dvosmerno usklajevanje namesto trismernega

Ker naročilnic ni, odpade primerjava z naročilom. Ostane primerjava, ki je v gostinstvu tako ali tako najbolj donosna:

```
PREJEMNICA (kaj sem dobil)  ←→  RAČUN DOBAVITELJA (kaj mi zaračunavajo)
```

Priročnik že predpisuje pravo navado — korak 6 pri vnosu prejemnice: *»Preverite znesek skupaj bruto in ga primerjajte z računom dobavitelja.«* To je ročno dvosmerno usklajevanje na ravni celotnega dokumenta.

Uvoz to premakne na raven **postavke** in ga avtomatizira. Ker je vhodni dokument pogosto sam račun, se primerjava lahko izvede takoj:

| Primerjava | Vir | Ravnanje |
|---|---|---|
| Cena postavke proti zadnji nabavni | `artikel.zadnja_nabavna_cena` (že obstaja — prednapolnjuje vnos) | opozorilo nad pragom |
| Skupna vrednost dokumenta proti vsoti postavk | znotraj dokumenta | blokada |
| Cena na osnovno enoto proti prejšnji dobavi | zgodovina | opozorilo |

Polje »zadnja nabavna cena«, ki že obstaja za prednapolnjevanje vnosa, s tem dobi drugo, dragocenejšo vlogo: postane referenca za odkrivanje tihih podražitev.

---

## 7. Odprto vprašanje: kako se surovine porabijo

Priročnik omenja tri načine zmanjšanja zaloge: **izdajnice** (kalo, lom, notranja postrežba, reklamacija, odpis), **inventuro** in prodajo. Normativov oziroma receptur nikjer ne omenja.

Če normativov res ni, se surovine razknjižujejo šele ob inventuri. To pomeni:

- Zaloga moke, mesa in kavnih zrn je med dvema inventurama knjižno napačna.
- Razlike med teoretično in dejansko porabo ni mogoče izračunati.
- Kazalnik food cost je izračunljiv samo za obdobje med inventurama.

To ni napaka uvoza in ga ne blokira — uvoz deluje enako. Vendar spremeni **prioriteto**: če normativov ni, prinaša natančnejši uvoz prejemnic manj koristi, kot bi jih prinesla uvedba normativov. Vrednost natančne nabavne cene se pokaže šele takrat, ko se ta cena prenese v ceno porcije.

Če normativi obstajajo, a niso dokumentirani, prosim potrdi — to spremeni priporočilo glede zaokroževanja in enot (glej V2).

---

## 8. Predelan načrt izvedbe

| Faza | Obseg | Delo | Učinek |
|---|---|---|---|
| **0** | Št. dokumenta kot polje, GTIN na artikel, `nabavna_ddv_stopnja` | majhno | omogoči vse ostalo |
| **1** | Preslikave `artikel_dobavitelj` + uvoz cenika iz Excela | srednje | prvi resnični prihranek |
| **2** | Uvoz CSV/XLSX s profilom po dobavitelju, ročni nalog datoteke | srednje | pokrije Cash&Carry in veletrgovce |
| **3** | e-SLOG 2.0 eRačun + namenski predal IMAP | srednje | dobavitelji z e-računom |
| **4** | Rabati, kontrola odstopanja cen, poročilo za reklamacijo | majhno | merljiv donos |
| **5** | UBL / CII / Peppol, EDIFACT | večje | priprava na obveznost B2B 1. 1. 2028 |
| **6** | Lot in rok uporabe, odvisni stroški, PDF/OCR | večje | po potrebi |

Fazi 0 in 1 sta pogoj za vse ostalo in sta skupaj manjši od enega tedna dela. Predlagam, da se začne tam, ne pri parserjih.

---

## 9. Vprašanja, ki jih moram razrešiti pred nadaljevanjem

**V1.** Kljukica »Vsebuje dodan sladkor« — velja samo za izstopni DDV, ali tudi za vstopnega? Od tega je odvisno, ali je `nabavna_ddv_stopnja` izpeljiva ali mora biti samostojno polje.

**V2.** Ali obstajajo normativi oziroma recepture, ki jih priročnik ne omenja? Če da, v kateri enoti so zapisani (dl, g, kos) in ali je enota vezana na artikel.

**V3.** Prejeti računi dobaviteljev — ali jih vodi BOOKIE ERP v ločenem modulu, ali se prejemnica knjiži tudi kot obveznost? To določa, ali je usklajevanje znotraj POS ali čez modula.

**V4.** Ali obstaja več skladišč na poslovno enoto (npr. bar in kuhinja ločeno), ali eno na enoto?

**V5.** Ali ima prejemnica lastno številčenje, ali je identificirana samo z datumom in dobaviteljem? Trenutni zaslon kaže številko dokumenta samo kot prosto besedilo v opombi.

**V6.** Kdo v praksi vnaša prejemnice — vodja enote ali osebje z vlogo *Uporabnik*? Priročnik razdelka Zaloge ne veže na vlogo, kar pomeni, da so prejemnice dostopne vsem. Če drži, je kontrola odstopanja cen brez ločene pravice neučinkovita.
