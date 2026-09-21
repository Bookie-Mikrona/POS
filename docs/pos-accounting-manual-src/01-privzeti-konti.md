# Privzeti konti POS → temeljnice

## Namen poglavja

To je samostojno računovodsko poglavje za nastavitev in kontrolo avtomatskega
knjiženja modula POS Gostinstvo. **Primeri številk in imen kontov so
nastavljivi primeri**; program ne vpisuje konta po številki, temveč shrani
UUID iz kontnega načrta izbranega podjetja. Pred uporabo je treba vsako
številko in naziv primerjati s kartico konta v konkretnem podjetju. Nazivi,
opisani v nadaljevanju, so računovodska vloga konta, ne nadomestilo za
kontni načrt podjetja.

Pri vsakem kontu preverite tudi:

* ali je konto aktiven in dovoljuje knjiženje (`allowsPosting`);
* tip konta (sredstvo, obveznost, kapital, prihodek ali strošek);
* vedenje DDV (brez DDV, izstopni DDV ali vstopni DDV);
* ali zahteva partnerja, stroškovno mesto ali projekt;
* ali je skupinski konto. Na skupinski konto se temeljnica ne sme knjižiti.

*Slika 1: pot do nastavitev. Slika mora pri končnem zajemu prikazati zavihek
Nastavitve → Konti za temeljnice in podjetje, za katerega se nastavitve
shranjujejo.*

## 1. Kje se konti nastavijo

1. Prijavite se v POS in izberite pravilno podjetje oziroma poslovno enoto.
2. Odprite **Nastavitve**.
3. Izberite zavihek **Konti za temeljnice**.
4. Kliknite **Odpri nastavitve knjiženja**. Program odpre zaslon
   **Konti za temeljnice** (`/konti-za-temeljnice`).
5. Izberite konto iz kontnega načrta; ne vpisujte samo številke v opisu.
6. Shranite nastavitve in nato v predogledu temeljnice preverite konto,
   naziv, stran (D/K), DDV in dimenzije.

V uporabniškem vmesniku je nastavitev dosegljiva samo administratorju
podjetja. API preveri tudi vlogo POS administratorja oziroma računovodsko
pravico; uporabnik brez pravice prejme napako 403. Nastavitev velja na ravni
podjetja, zato jo je treba preveriti za vsako podjetje posebej. Poslovna
enota lahko doda stroškovno mesto, ki se pri POS→ERP knjiženju prenese na
vrstice.

*Slika 2: prikaz vnosov plačilnih, prihodkovnih in DDV kontov. Pri zajemu
zaslona mora biti vidna oznaka vsakega polja in izbrani naziv konta.*

## 2. Kako program izbira konto

Vsak zapis nastavitev ima eno polje na podjetje. Prazna vrednost pomeni
`NULL`, ne pa samodejnega konta. Pri prodaji program najprej razdeli promet
po plačilu, nato po vrsti artikla, kategoriji in stopnji DDV. Prihodkovni
konto je zato kombinacija:

`kategorija → splošni prihodek → vrsta artikla × stopnja DDV`.

Preslikava kategorije ima prvo prednost. Če je ni, trenutno izvedena logika
uporabi `revenueAccountId`, kadar je ta nastavljen, in šele nato podrobni konto
za vrsto artikla in stopnjo DDV. Zato splošnega prihodkovnega konta pri novi
nastavitvi ne izpolnite, če želite razčlenitev po vrsti in stopnji; nastavljen
splošni konto bi jo preglasil. Vstopni DDV uporablja
ločeni konto po stopnji, nato splošni `inputVatAccountId`. Stari splošni
konti so samo združljivostni fallback za stare nastavitve; pri novi
namestitvi jih ne uporabljajte kot zamenjavo za manjkajočo analitiko.

Pomembno: če je znesek posamezne vrste plačila nič, njegov manjkajoči konto
ne ustavi drugih vrst. Če je znesek pozitiven ali negativen in obvezni konto
manjka, se konkretna zbirna temeljnica preskoči z razložljivim razlogom.
Program ne sme ustvariti delne temeljnice, ki bi prikazala samo del prometa.

## 3. Popis vseh nastavitev

### 3.1 Plačila in prehodni konti — Temeljnica 1

| Polje v nastavitvah | Kdaj se uporabi | Primer konta in preverjen računovodski naziv | Zahteva in kontrola |
|---|---|---|---|
| **Konto blagajne** (`cashAccountId`) | gotovinsko plačilo računa; tudi gotovinski prejem pri izdaji darilnega bona in poravnava napitnine | `1000110` — *Blagajna – gotovina* (primer analitike konta denarnih sredstev) | Ob gotovinskem znesku obvezno; konto mora biti sredstvo in denarno sredstvo. |
| **Konto TRR** (`bankAccountId`) | bančna stran pri poravnavi napitnin; bančni prenos po kontu denarja na poti | `1100110` — *Denarna sredstva na transakcijskem računu (TRR)*; standardni 4-mestni plan preverjeno navaja `3100` z nazivom *Denarna sredstva na transakcijskem računu (TRR)* | Ob bančni poravnavi obvezno; ne uporabljajte konta kartičnega terminala. |
| **Denar na poti** (`cashInTransitAccountId`) | prenosi med blagajno in TRR; ni prodajni prihodek in ni DDV | `1090000` — *Denar na poti* | Ob prenosu obvezno; tip sredstva. |
| **Konto POS terminala/kartic** (`cardAccountId`) | kartična plačila prodaje, izdaje darilnega bona, kartične napitnine in kartična provizija | `1000120` — *Terjatve do kartičnega procesorja / POS terminal* | Ob kartičnem prometu obvezno; konto ne sme biti prihodek. |
| **Obveznost za napitnine** (`tipsLiabilityAccountId`) | napitnina za tuj račun (neposredno osebju ali sklad) | `2850110` — *Obveznosti do zaposlenih za napitnine* | Ob napitnini za osebje obvezno; tip obveznost. |
| **Prihodki napitnin** (`tipsRevenueAccountId`) | napitnina pod nadzorom delodajalca | `7690110` — *Prihodki od napitnin* | Če ni nastavljen, koda uporabi prihodek storitev 22 %, nato stari splošni prihodek; to fallback vedenje je treba pred knjiženjem potrditi. |
| **DDV napitnin** (`tipsVatAccountId`) | izhodni DDV napitnine pod nadzorom delodajalca | `2600122` — *Obveznosti za izstopni DDV 22 %* | Vrstica DDV se v izračunu poveča; konto mora biti izhodni DDV. |
| **Strošek kartične provizije napitnin** (`tipsCardFeeExpenseAccountId`) | kadar je provizija napitnine strošek delodajalca | `4190110` — *Stroški bančnih in kartičnih storitev* | Ob proviziji obvezno skupaj s kartičnim kontom. |
| **Konto bonov za pico** (`voucherAccountId`) | unovčitev bona za pico | `1650210` — *Terjatve za bone za pico* | Ločen je od darilnega bona; ob znesku bona obvezno. |
| **Konto predplačil/darilnih bonov** (`advancePaymentsAccountId`) | izdaja darilnega bona (K darilo) in unovčitev (D predplačilo) | `2300110` — *Prejeta predplačila za darilne bone* | Ob izdaji ali unovčitvi obvezno; tip obveznost. |
| **Ostala negotovinska plačila** (`otherPaymentAccountId`) | Sodexo, TRR kupca in druga plačila brez gotovine/kartice | `1650310` — *Druge kratkoročne terjatve* | Ob takem plačilu obvezno; partner se doda, kadar ga vir vsebuje. |
| **Prehodna terjatev pogodbenih malic** (`contractReceivableTransitAccountId`) | pogodbena malica do mesečnega A-računa | `1650410` — *Prehodne terjatve za pogodbene malice* | Ob pogodbeni malici obvezno; mesečni A-račun jo zapre na terjatev do kupca. |
| **Terjatev za študentske bone** (`subsidyReceivableAccountId`) | subvencionirani študentski bon | `1650000` — *Terjatve do države za subvencije* | Ob subvenciji obvezna skupaj s partnerjem `subsidyCounterpartyId`; program izrecno preveri oboje. |
| **Partner subvencije** (`subsidyCounterpartyId`) | analitika terjatve za študentske bone | *MDDSZ/ŠOS* — naziv partnerja v šifrantu | Brez partnerja se prodajna temeljnica preskoči, tudi če je konto nastavljen. |

*Slika 3: polja za prejemnice, vstopni DDV, nabavo in porabo. Pri zajemu naj
bo jasno razvidna razlika med zalogo in stroškom.*

### 3.2 Prihodki in izhodni DDV — Temeljnica 1

| Polje | Poraba | Primer konta — preverjen naziv vloge |
|---|---|---|
| `revenueMaterial95AccountId` | hrana/material z DDV 9,5 % | `7620110` — *Prihodki od prodaje materiala – 9,5 %* |
| `revenueMaterial22AccountId` | material z DDV 22 % | `7620210` — *Prihodki od prodaje materiala – 22 %* |
| `revenueMaterial5AccountId` | material z DDV 5 % | `7620010` — *Prihodki od prodaje materiala – 5 %* |
| `revenueGoods22AccountId` | blago z DDV 22 % | `7620310` — *Prihodki od prodaje trgovskega blaga – 22 %* |
| `revenueGoods95AccountId` | blago z DDV 9,5 % | `7620320` — *Prihodki od prodaje trgovskega blaga – 9,5 %* |
| `revenueGoods5AccountId` | blago z DDV 5 % | `7620300` — *Prihodki od prodaje trgovskega blaga – 5 %* |
| `revenueService22AccountId` | storitev z DDV 22 % | `7600110` — *Prihodki od prodaje storitev – 22 %* |
| `revenueService95AccountId` | storitev z DDV 9,5 % | `7600210` — *Prihodki od prodaje storitev – 9,5 %* |
| `revenueService5AccountId` | storitev z DDV 5 % | `7600010` — *Prihodki od prodaje storitev – 5 %* |
| `revenueServiceAccountId` | stari skupni prihodek storitev | `7600000` — *Prihodki od prodaje storitev – stari skupni fallback* | Samo migracija; ne uporabljajte za novo preslikavo. |
| `revenueAccountId` | stari splošni prihodek | `7600000` — *Prihodki od prodaje proizvodov na domačem trgu* (standardni plan vsebuje `7600` s tem nazivom) | Če je nastavljen, ima trenutno prednost pred konti vrsta × DDV; pri novi razčlenjeni nastavitvi ga pustite praznega. |
| `vat95AccountId` | izhodni DDV 9,5 % | `2600195` — *Obveznosti za izstopni DDV 9,5 %* |
| `vat5AccountId` | izhodni DDV 5 % | `2600005` — *Obveznosti za izstopni DDV 5 %* |
| `vat22AccountId` | izhodni DDV 22 % | `2600122` — *Obveznosti za izstopni DDV 22 %* |
| `vatLiabilityAccountId` | stari splošni izhodni DDV | `2600000` — *Obveznosti za izstopni DDV – stari fallback* | Samo stare migrirane nastavitve. |

Prihodkovni konto lahko preglasi preslikava **Nastavitve → Konti za
temeljnice → Prihodki po kategorijah**. Preslikava mora pripadati istemu
podjetju; podvojena kategorija, kategorija drugega podjetja ali neveljaven
UUID se zavrne. Če za kategorijo ni preslikave, se najprej uporabi
`revenueAccountId`, če je nastavljen, sicer kombinacija vrste artikla in DDV.
Za 0 % oziroma neznano stopnjo je treba izrecno določiti
poslovno pravilo; program pri materialu uporablja nastavitev materiala 9,5 %
kot združljivostno rešitev, kar mora računovodja preveriti.

*Slika 4: vsaka kategorija ima lahko svoj prihodkovni konto. Primer je
ponazoritev; številka in naziv sta vedno podatka kartice konta podjetja.*

### 3.3 Prejemnice, zaloge in vstopni DDV — Temeljnica 2

| Polje | Dogodek | Primer konta in naziv |
|---|---|---|
| `inventoryMaterialAccountId` | material/surovine na prejemnici | `3100110` — *Zaloga surovin in materiala* |
| `inventoryGoodsAccountId` | trgovsko blago na prejemnici | `6600110` — *Zaloga trgovskega blaga* |
| `inventoryAccountId` | stari splošni konto zalog | `3100000` — *Zaloga – stari fallback* |
| `payablesAccountId` | obveznost do dobavitelja | `2200110` — *Kratkoročne obveznosti do dobaviteljev* |
| `returnablePackagingAccountId` | povratna embalaža/depozit | `3107000` — *Zaloga povratne embalaže* |
| `nabavaObracunAccountId` | prehodni konto obračuna nabave | `3000110` — *Obračun nabave materiala in blaga*; izvedba zahteva razred 300 |
| `inputVatAccountId` | vstopni DDV, če stopnja nima ločenega konta | `1600000` — *Terjatve za vstopni DDV – splošni fallback* |
| `inputVat22AccountId` | vstopni DDV 22 % | `1600122` — *Terjatve za vstopni DDV 22 %* |
| `inputVat95AccountId` | vstopni DDV 9,5 % | `1600195` — *Terjatve za vstopni DDV 9,5 %* |
| `inputVat5AccountId` | vstopni DDV 5 % | `1600005` — *Terjatve za vstopni DDV 5 %* |
| `otherCostsAccountId` | strošek, ki se ne kapitalizira v zalogo | `4190210` — *Drugi stroški nabave* |
| `rawMaterialExpenseAccountId` | neposredni strošek surovin pri uvozu | `4000110` — *Stroški porabljenega materiala* |
| `inboundFreightExpenseAccountId` | prevozna storitev pri nabavi | `4190310` — *Stroški prevoznih storitev pri nabavi* |

Za vstopni DDV program najprej išče stopnji ustrezen konto (`inputVat22`,
`inputVat95`, `inputVat5`), nato `inputVatAccountId`. To ni dovoljenje za
knjiženje DDV na izhodni konto: kartica mora imeti `taxBehavior=input_vat`.
Pri mešani prejemnici se vsaka stopnja obračuna ločeno.

### 3.4 Poraba, lastna poraba in odpis

| Polje | Dogodek | Primer konta in naziv |
|---|---|---|
| `cogsMaterialAccountId` | poraba materiala po normativu | `4000110` — *Stroški porabljenega materiala* |
| `cogsGoodsAccountId` | nabavna vrednost prodanega blaga | `7020110` — *Nabavna vrednost prodanega blaga* |
| `cogsAccountId` | stari splošni strošek porabe | `4000000` — *Stroški porabe – stari fallback* |
| `kirArAccountId` | terjatev kupca pri KIR oziroma brezplačnem računu | `1200110` — *Kratkoročne terjatve do kupcev* |
| `lastnaPorabaAccountId` | strošek lastne porabe | `4830110` — *Odhodki lastne porabe* |
| `reprezentancaAccountId` | strošek reprezentance | `4861000` — *Stroški reprezentance* |
| `wasteAccountId` | vrednost kala pri pripravljeni hrani | `4090110` — *Odhodki kala in odpisa* |
| `openingBalanceAccountId` | kredit otvoritvene temeljnice začetne zaloge | `9900000` — *Otvoritveni konto bilance* |

Zamrznjena pripravljena porcija sama po sebi ne ustvari GL temeljnice.
Knjiženje nastane pri porabi oziroma pri vrednotenem kalu. `kirArAccountId`
je obvezen za ustvarjanje KIR zapisa; brez njega je KIR preskočen, tudi če je
prodajna temeljnica sicer možna.

## 4. Frekvenca in čas uporabe kontov

Na dnu zaslona nastavite:

* **Frekvenca knjiženja prodaje**: `daily` (dnevno, privzeto) ali `monthly`
  (mesečno);
* **Frekvenca knjiženja porabe**: `monthly` (privzeto) ali `daily`;
* sprememba frekvence se lahko uveljavi s prvim dnem naslednjega meseca.

Pri dnevni prodaji nastane referenca `POS:PRODAJA:YYYY-MM-DD:E{id}`.
Pri mesečnem načinu dnevni sinhronizacijski klic ne sme izdelati dodatne
prodajne temeljnice. Ob ponovnem zagonu se obstoječi osnutek z isto
referenco obnovi, ne podvoji. Pri ročnem ponavljanju sinhronizacije preverite
referenco, status in obdobje.

## 5. Delovni primer: nastavitev in prodajna temeljnica

Nastavimo (vsi konti so **konfigurabilni primeri**) blagajno `1000110`,
kartice `1000120`, prihodke storitev 22 % `7600110` in izhodni DDV 22 %
`2600122`. V POS vnesemo račun: storitev 100,00 EUR bruto, kartica, DDV
22 %.

Neto = 100 / 1,22 = 81,97 EUR; DDV = 18,03 EUR.

| D/K | Konto | Naziv konta | Znesek EUR | Vir/pomen |
|---|---:|---|---:|---|
| D | 1000120 | Terjatve do kartičnega procesorja / POS terminal | 100,00 | način plačila kartica |
| K | 7600110 | Prihodki od prodaje storitev – 22 % | 81,97 | vrsta storitve in DDV |
| K | 2600122 | Obveznosti za izstopni DDV 22 % | 18,03 | DDV skupina |
|  |  | **Kontrola** | **D = K = 100,00** |  |

Če ima kategorija izrecno preslikavo na `7620310`, se namesto `7600110`
uporabi preslikani konto. Če `cardAccountId` manjka, se celotna prodajna
temeljnica ne ustvari; račun ostane izdan, vendar mora računovodja odpraviti
nastavitev in ponovno sprožiti sinhronizacijo.

## 6. Robni primeri in odziv računovodje

### Napačen tip konta

Če je za blagajno izbran prihodek ali za DDV izbran strošek, nastavitev
tehnično lahko vsebuje veljaven UUID, vendar je ekonomsko napačna. Pred
potrditvijo odprite kartico in preverite tip, `allowsPosting`, DDV vedenje in
dimenzije. Napačnega konta ne rešujte z ročnim preknjiževanjem brez sledenja
izvirnemu POS računu.

### Konto je izbrisan, deaktiviran ali skupinski

Brisanje konta nastavitvi nastavi referenco na `NULL`; osnutek nato vrne
razlog, na primer *konto blagajne ni nastavljen*. Deaktiviran ali skupinski
konto je treba zamenjati z aktivnim analitičnim kontom, ki dovoljuje
knjiženje. Ne izbirajte nadrejenega konta samo zato, ker se številka ujema.

### Manjka le ena DDV stopnja

Računi z drugo stopnjo lahko nastanejo, vendar se zbirna temeljnica preskoči,
če zanjo manjka prihodkovni ali DDV konto. To posebej preverite pri 5 %,
9,5 % in 22 % ter pri mešanem računu. `inputVatAccountId` je fallback za
vstopni DDV, ne za izhodni DDV.

### Manjka subvencijski partner

Pri študentskem bonu mora biti nastavljen konto terjatve in partner
MDDSZ/ŠOS. Če manjka katerikoli od njiju, se prodaja preskoči z razlogom,
ki omenja oba podatka. Partnerja ne zamenjajte s splošnim kupcem.

### Negativen saldo darilnih bonov

`warnGiftVoucherNegative` je opozorilo, privzeto nastavljeno na `true`.
Opozorilo ne sme biti razumljeno kot dovoljenje za izmišljeno izdajo bona.
Preverite izdaje, unovčitve, stornacije in datum. Izdaja knjiži D plačilo /
K predplačila; unovčitev knjiži D predplačila, prihodek in DDV pa pripadata
prodaji.

### Napačno podvojena kategorija

API zavrne podvojeno preslikavo, kategorijo drugega podjetja ali neveljaven
UUID. Po popravku ponovno preberite seznam kategorij in preverite, da se
vsaka kategorija uporablja pri pravi enoti.

### Obvezna analitika

Če konto zahteva partnerja, stroškovno mesto ali projekt, mora biti podatek
prisoten v vrstici. Stroškovno mesto poslovne enote se lahko prenese v
temeljnico; preverite ga pri vsaki enoti. Če ni ustrezne analitike, temeljnice
ne potrjujte na silo — najprej popravite konto ali konfiguracijo enote.

## 7. Kontrolni seznam pred prvo uporabo

* [ ] Izbrano je pravo podjetje in prava poslovna enota.
* [ ] Konti za gotovino, kartice, TRR in denar na poti so aktivna sredstva.
* [ ] Konti za bone in subvencije imajo pravilno terjatveno/obveznostno
      naravo; darilni bon in bon za pico sta ločena.
* [ ] Za vsako kombinacijo material/blago/storitev × 5/9,5/22 je določen
      prihodkovni konto ali dokumentirano pravilo.
* [ ] Za vse tri izhodne stopnje so nastavljeni DDV konti.
* [ ] Prejemnice imajo konta zalog, dobaviteljev, vstopnega DDV in
      prehodnega obračuna nabave.
* [ ] Vstopni DDV po stopnjah ima prednost pred splošnim fallbackom.
* [ ] COGS materiala in blaga sta ločena, če je tako urejen kontni načrt.
* [ ] Nastavljeni so konti lastne porabe, reprezentance, kala in začetne
      zaloge, če se ti tokovi uporabljajo.
* [ ] Za KIR je določen konto terjatev kupcev in ustrezne FURS DDV kode.
* [ ] Vsaka kategorija ima največ eno preslikavo in pripada temu podjetju.
* [ ] Konti dovoljujejo knjiženje ter ne zahtevajo manjkajočih dimenzij.
* [ ] Izbrana frekvenca prodaje in porabe je zapisana v računovodski
      dokumentaciji.
* [ ] Testni račun z gotovino, kartico, mešanim DDV in stornom ima
      uravnoteženo temeljnico.
* [ ] Preverjena je referenca `POS:PRODAJA`, da ponovni sync ne podvaja
      knjižbe.

## 8. Kontrolni zapis po spremembi konta

Ob vsaki spremembi kontnega načrta shranite datum, staro in novo kartico,
razlog spremembe, uporabnika, datum uveljavitve in rezultat testne
temeljnice. Sprememba privzetega konta ne sme retroaktivno prepisati že
potrjenih temeljnic. Za pretekli datum naj računovodja najprej pregleda
osnutke, jih popravi z ustreznim postopkom in šele nato ponovno zažene
sinhronizacijo. Vedno morata veljati:

`vsota D = vsota K` in `znesek POS = plačilni D = prihodki brez DDV + DDV`.
