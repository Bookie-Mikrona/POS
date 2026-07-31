# Zajem prek namenskega e-poštnega predala

V praksi pokrije največ dokumentov z najmanj dela, ker dobaviteljem ni
treba spremeniti ničesar — pošiljajo tja, kamor že pošiljajo.

---

## 1. Zakaj ta kanal pred ostalimi

| Kanal | Kaj mora storiti dobavitelj | Kaj morate storiti vi |
|---|---|---|
| Nalog datoteke | nič | prenesti prilogo, jo naložiti |
| **E-poštni predal** | **spremeniti naslov prejemnika** | **nič** |
| Peppol / e-pot | vključiti se v omrežje | vključiti se, plačati posrednika |
| API dobavitelja | ponuditi vmesnik | razviti odjemalca za vsakega |

Sprememba naslova prejemnika je edina zahteva, ki jo je mogoče
dobavitelju sporočiti v enem stavku.

Predlagan naslov: `prevzem@vasadomena.si`, ali z ločnico po enotah
`prevzem.terasa@…`, kar samodejno določi poslovalnico.

---

## 2. Urnik namesto trajne povezave

**Predelava prvotne zasnove.** Prva različica je predpostavljala trajno
povezavo IMAP IDLE. Na Replitu to ni izvedljivo: Autoscale objava se ob
mirovanju skrči na nič strežnikov, zato procesa, ki bi povezavo držal,
preprosto ni.

| Pot | Cena | Ocena |
|---|---|---|
| **Scheduled Deployment, vsakih 10 min** | najnižja | **izbrano** |
| Reserved VM v načinu background worker | fiksna mesečna | drago za to nalogo |
| Webhook dobavitelja | brez | redko izvedljivo |

Dobavnica ni sporočilo v realnem času. Prispe zjutraj, prevzame se ob
dostavi, knjiži se čez dan. Zamik desetih minut ne pomeni ničesar,
fiksni mesečni strošek pa.

### Kaj urnik zahteva dodatno

**Svetovalni zaklep.** Če se prejšnji zagon zavleče, se naslednji začne,
preden prvi konča. Enoličnost SHA-256 bi dvojno obdelavo sicer ujela, a
šele po nepotrebnem delu — in pri premikanju sporočil v mapo Obdelano bi
nastala zmeda.

```sql
SELECT pg_try_advisory_lock(hashtext('zajem_eposta:' || :predal_id));
```

Če vrne `false`, zagon takoj konča. **Brez sporočila o napaki** — to je
normalno stanje, ne motnja. `pg_advisory_lock` se sprosti sam ob koncu
seje, tudi ob sesutju.

**Omejitev na zagon.** Največ 25 sporočil, da opravilo konča pred
naslednjim zagonom. Zaostanek se pobere sam.

---

## 3. Prepoznava dobavitelja

Vrstni red, prvi zadetek zmaga:

| # | Ključ | Zanesljivost |
|---|---|---|
| 1 | **davčna številka iz razčlenjenega dokumenta** | **najvišja** |
| 2 | GLN iz dokumenta | visoka |
| 3 | točen naslov pošiljatelja | srednja |
| 4 | domena pošiljatelja | nizka |

**Ključna odločitev:** davčna številka iz dokumenta ima prednost pred
naslovom pošiljatelja. Računovodski servisi in posredniki pošiljajo v
imenu več dobaviteljev z istega naslova; zanašanje na pošiljatelja bi
vse te dobavnice pripisalo napačnemu partnerju.

Pravi vrstni red je torej: **najprej razčleni, potem določi
dobavitelja.** Naslov pošiljatelja odloča le o tem, ali sporočilo sploh
obdelati.

Če dobavitelja ni v šifrantu, uvoz vrne predlog z davčno številko —
obstoječi gumb `+` na prejemnici ga poišče v AJPES.

---

## 4. Varnostna pravila

Predal je edini vhod v sistem, ki ga lahko naslovi kdorkoli. Zato velja
strožji režim kot pri nalogu datoteke.

### Obvezno

- **Sprejmi samo znane pošiljatelje.** Neznani gredo v karanteno, ne v
  obdelavo. Karantena je mapa, ki jo uporabnik pregleda; z enim klikom
  doda pošiljatelja med znane in sprejme dokument.
- **Omejitev velikosti:** priloga nad 20 MB v karanteno. Dobavnica z
  2.000 postavkami ima nekaj sto kilobajtov.
- **Bela lista pripon:** `.xml`, `.csv`, `.txt`, `.xlsx`, `.xls`, `.pdf`,
  `.edi`, `.json`, `.zip`. Vse drugo se zavrže brez obdelave.
- **XML brez zunanjih entitet.** `fast-xml-parser` ne bere DTD in ne
  razrešuje entitet; `processEntities` je poleg tega izrecno izklopljen.
  Če ga zamenjate za drug razčlenjevalnik, preverite nastavitve — sicer
  lahko poslani dokument prebere datoteke s strežnika.
- **Makri se ne izvedejo.** `.xlsm` se bere samo kot podatki; če
  knjižnica podpira izračun formul, ga izklopite.
- **ZIP ena raven.** ZIP v ZIP-u se zavrne. Razmerje stiskanja nad 100×
  se zavrne.

### Česa sistem ne sme storiti

- **ne odgovarja** na sporočila iz karantene — s tem bi neznanemu
  pošiljatelju potrdil obstoj predala,
- **ne sledi povezavam** iz vsebine sporočila,
- **ne knjiži samodejno**, ne glede na to, kako popolno je uparjanje.

Zadnja točka je najpomembnejša. Uvoz iz e-pošte vedno konča v osnutku.

---

## 5. Podvojitve

Isti dokument pogosto pride dvakrat: kot XML in kot PDF v istem
sporočilu, ali kot ponovno poslano sporočilo dan kasneje.

**Tehnična zaščita:** `uvoz_seja.sha256` je enoličen na podjetje.
**Poslovna zaščita:** enoličen indeks na dobavitelja, številko in datum
dokumenta.

Kadar sporočilo vsebuje več prilog, se obdelajo po prednosti:
XML → EDIFACT → CSV → XLSX → PDF. Ko je dokument uspešno razčlenjen iz
XML, se PDF istega računa zavrne kot podvojitev.

---

## 6. Odgovarjanje pošiljatelju

Privzeto **izklopljeno**. Dva razloga:

- Samodejni odgovori na naslove računovodskih servisov sprožajo njihove
  samodejne odgovore. Nastane zanka.
- Odgovor »dokument prejet« si dobavitelj lahko razlaga kot potrditev
  prevzema in strinjanje s cenami. Tega niste želeli povedati.

Če ga vseeno vklopite, naj bo besedilo nevtralno: potrditev prejema
datoteke, izrecno brez potrditve vsebine, in brez zneskov.

---

## 7. Obveščanje

Namesto dobavitelju obveščaj **svoje** ljudi, zbirno in ne po
dokumentih.

| Dogodek | Kje |
|---|---|
| Uvožena prejemnica čaka na uparjanje | števec ob meniju Zaloge |
| Dokument v karanteni | dnevni povzetek |
| Napaka razčlenitve | v aplikaciji + e-pošta skrbniku |
| Odstopanje cene nad pragom | ob odprtju prejemnice |

Obvestilo za vsak prejeti dokument ustvari šum, ki ga ljudje po tednu
dni nehajo brati.

**Nadzor delovanja:** če `uvoz_predal.zadnja_povezava` zaostaja za več
kot dve uri, obvesti skrbnika. Tiho odpovedan urnik je nevarnejši od
glasne napake — dobavnice se kopičijo, opazi pa se šele, ko zmanjka
zaloge.

---

## 8. Sporočila se premikajo, ne brišejo

Obdelana sporočila gredo v mapo `Obdelano`, neznana v `Karantena`. Ne
brisati in ne označiti le kot prebrana.

Mapa `Obdelano` je edini način, da se pri težavi ugotovi, kaj je sistem
videl in kdaj.

---

## 9. Zaporedje uvedbe

Vrstni red ni pretirana previdnost. Ko dobavitelji začnejo pošiljati na
nov naslov, se povratek k staremu ne zgodi hitro, napake v razčlenitvi
pa se pokažejo šele pri raznolikosti resničnih dokumentov.

1. Predal deluje, sporočila se premikajo v `Obdelano`, **razčlenitve še
   ni**. Preveri, ali kaj sploh prihaja in v kakšnih oblikah.
2. Razčlenitev vklopljena, rezultat se **samo beleži**, prejemnice se ne
   ustvarjajo. Teden dni. Primerjaj z ročno vnesenimi.
3. Ustvarjanje osnutkov vklopljeno.
4. **Šele nato** obvesti dobavitelje o novem naslovu.
