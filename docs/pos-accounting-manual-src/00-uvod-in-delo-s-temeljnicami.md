# 0. Uvod in delo s temeljnicami POS Gostinstvo

## 0.1 Namen tega priročnika

Ta priročnik je samostojen računovodski priročnik za modul **POS Gostinstvo**. Namenjen je preverjanju računovodskega učinka podatkov, ki nastanejo pri prodaji, plačilu, vračilu, izdaji ali unovčitvi bona, nabavi, zalogi, porabi, dogodku, blagajniškem premiku in drugih vnosih v POS-u.

Priročnik ne predpostavlja, v katerem glavnem knjigovodskem programu se bo končna knjižba izvedla. Temeljnica, ki jo ustvari POS, je izvorni računovodski predlog z revizijsko sledjo. Računovodja jo lahko pregleda in potrdi v povezanem ERP-ju ali jo uporabi kot podlago za vnos oziroma uvoz v drug program. V obeh primerih veljajo enake kontrole:

* izvorni dokument mora biti določljiv;
* vsaka vrstica mora imeti konto, stran (D/K), znesek in opis;
* vsota debetnih vrstic mora biti enaka vsoti kreditnih vrstic;
* davčna stopnja in DDV-koda morata ustrezati izvorni vrstici;
* sprememba vira se popravi v POS-u, ne s prepisovanjem posledice v temeljnici;
* popravek že potrjene temeljnice se izvede s storno oziroma z ločenim računovodskim popravkom.

Številke kontov v primerih so **kontrolni primeri**. POS ne uporablja ene univerzalne kontne številke: konto je vezan na nastavitev poslovne enote in na kontni načrt družbe. V dejanskem postopku se vedno uporabi koda in naziv, ki sta prikazana v nastavitvah ter v vrstici ustvarjene temeljnice.

## 0.2 Zaslon modula in računovodska sled

Na pregledu modula si računovodja najprej določi:

1. **poslovno enoto** in poslovni datum;
2. ali preverja izvorne račune, prejemnice, zalogovne dogodke ali temeljnice;
3. obdobje, za katerega bo izvedel uskladitev;
4. ali je dogodek že sinhroniziran v računovodski del.

Na računovodski učinek lahko vplivajo naslednja področja POS-a:

| Področje vnosa | Primer dogodka | Kaj se preveri v računovodstvu |
|---|---|---|
| Mize, naročila in računi | dodajanje artikla, popust, zaključek računa | prihodek, DDV, način plačila, referenca računa |
| Blagajna in plačila | gotovina, kartica, drugo plačilo | debetni plačilni konto in uskladitev z izkupičkom |
| Darilni in drugi boni | izdaja, delno unovčenje, unovčenje, preklic | predplačilo oziroma terjatev in saldo bona |
| Študentski/pogodbeni obroki | subvencija ali pogodbena malica | terjatev, partner in prehodni konto |
| Napitnine | napitnina ob računu, izplačilo napitnine | obveznost do zaposlenih oziroma način poravnave |
| FURS in storno | potrjen račun, dobropis, storno, vračilo | povezava z izvirnim računom in nasprotne vrstice |
| Meni, artikli in kategorije | vrsta artikla, DDV-stopnja, kategorija | konto prihodka po vrsti in stopnji |
| Prejemnice in nabava | dobavitelj, količina, cena, DDV | zaloga ali strošek, vstopni DDV, obveznost |
| Začetna zaloga | otvoritveno stanje | otvoritveni konto in vrednost zaloge |
| Inventura in odpisi | višek, manjko, kalo, odpis | korekcija zaloge in ustrezen strošek |
| Normativi in pripravljena hrana | proizvodnja, poraba, odpad | prenos med zalogami, poraba ali odpis |
| Prenosi in dogodki | prenos med enotami, dogodek, vračilo | izvorna/ciljna enota, količina in vrednost |
| Blagajniški premiki | polog, dvig, izplačilo dobavitelju | blagajna, denar na poti, banka ali partner |
| Poročila in dnevni izkaz | zaključek dneva, pregled prometa | popolnost in uskladitev s temeljnico |
| Nastavitve knjiženja | privzeti konti in DDV-kode | ali je vsak potrebni konto nastavljen in dovoljen |

Vnos, ki je zgolj operativen in nima določene knjižne poti (na primer rezervacija brez računa), sam po sebi ne sme biti obravnavan kot prihodek ali terjatev. Računovodski dogodek nastane šele, ko ga poslovna logika potrdi oziroma ko je ustvarjen dokument, ki ga sinhronizacija podpira.

## 0.3 Od izvornega vnosa do temeljnice

Za vsak primer se uporablja naslednja sled:

**vnos v POS → izvorni dokument → sinhronizacija → osnutek temeljnice → pregled vrstic → potrditev/knjiženje → poročilo ali izvoz**.

Pri preverjanju si zabeležite najmanj:

* poslovno enoto in poslovni datum;
* številko računa, prejemnice, premika ali drugega dokumenta;
* uporabnika, ki je dogodek vnesel ali potrdil;
* referenco temeljnice;
* uporabljene konte in DDV-kode;
* status temeljnice in čas morebitne potrditve;
* povezavo na izvirnik in pri stornu povezavo na izvirni dogodek.

Sinhronizacija prodaje se lahko izvede za dan ali za zaključen mesec. Pri ročni dnevni sinhronizaciji se v **Temeljnice** izbere datum in pritisne **Sinhroniziraj**. Rezultat lahko vsebuje ustvarjene temeljnice in preskočene reference z razlogom. Preskok ni uspešno knjiženje: razlog je treba odpraviti in sinhronizacijo ponoviti.

Mesečna sinhronizacija se uporablja za zaključeno obdobje in združi podatke po pravilih nastavitev. Pred njo preverite, da so računi, vračila, prejemnice in drugi dogodki za mesec zaključeni. Če je bil dan že potrjen, mesečni postopek ne sme ustvariti dvojnega prihodka; morebitna razlika se rešuje z ločenim popravkom.

## 0.4 Statusi temeljnic

V seznamu **Temeljnice** so statusi prikazani kot:

| Status | Pomen | Dovoljeno ravnanje |
|---|---|---|
| **osnutek (draft)** | temeljnica je ustvarjena, vendar še ni potrjena | pregled, dopolnitev v skladu s pravili in priprava na knjiženje |
| **potrjena (posted)** | temeljnica je knjižena/potrjena v knjigi | ne prepisujte vrstic; popravek izvedite z reverzom ali ločenim dokumentom |
| **storno (reversed)** | učinek prvotne temeljnice je razveljavljen | preverite povezavo na izvirnik in nov popravljalni dokument |

Status osnutka ne pomeni, da je dogodek napačen. Pomeni, da mora računovodja opraviti kontrolni pregled. Status potrjene temeljnice tudi ne pomeni, da je izvorni račun pravilen: potrditi je treba, da se vsota, DDV, plačila in izvorna referenca ujemajo.

## 0.5 Pregled seznama in razširitev vrstice

1. Odprite **Temeljnice**.
2. V polji **Od** in **Do** vnesite celotno računovodsko obdobje; pri dnevnem pregledu vnesite isti datum v obe polji.
3. Izberite **Pokaži**.
4. Razvrstite pregled po datumu in referenci.
5. Pri vsaki vrstici preverite znesek in status.
6. Kliknite puščico temeljnice, da se prikažejo opis ter knjižne vrstice.
7. Primerjajte kodo in naziv konta, stran D/K, znesek in opis z izvorom.

Program pri seznamu vrne tudi naziv konta iz kontnega načrta. Računovodja zato ne sme preverjati samo prvih treh mest kode. Pomembna sta celotna aktivna sedemmestna koda in naziv, saj lahko dve enaki skupini vsebujeta različni analitiki.

## 0.6 Kontrola temeljnice

Za vsako temeljnico izvedite ta vrstni red:

1. **Identiteta:** referenca vsebuje oziroma nedvoumno kaže izvorni POS-dokument.
2. **Datum:** datum temeljnice je poslovni datum dogodka oziroma datum, določen z računovodsko politiko.
3. **Popolnost:** vsi relevantni računi in dokumenti obdobja so zajeti; preskočeni vnosi so raziskani.
4. **Struktura:** na vsaki vrstici sta konto in stran; konto je aktiven in dovoljuje knjiženje.
5. **D/K:** seštevek debetnih vrstic je enak seštevku kreditnih vrstic.
6. **DDV:** neto osnova, DDV in bruto znesek se ujemajo po stopnjah in DDV-kodah.
7. **Plačila:** seštevek načinov plačila je enak bruto znesku oziroma je razlika razložena z odprto terjatvijo, predplačilom ali prehodnim kontom.
8. **Partner:** pri terjatvi, obveznosti, subvenciji ali pogodbenem dogodku je določen pravi partner.
9. **Dimenzije:** stroškovno mesto, enota in projekt so preneseni, kadar jih zahteva konto ali poslovna politika.
10. **Duplikat:** ista POS-referenca ni že potrjena v drugem dokumentu.

Primer numerične kontrole:

| Stran | Konto (primer) | Naziv konta (primer) | Znesek EUR |
|---|---:|---|---:|
| D | 1000001 | Blagajna – enota 1 | 122,00 |
| K | 7609501 | Prihodki od storitev 9,5 % – enota 1 | 111,42 |
| K | 2609501 | Izhodni DDV 9,5 % – enota 1 | 10,58 |
|  |  | **Skupaj** | **122,00 = 122,00** |

Če seštevek ni enak, temeljnice ne potrjujte. Napaka je lahko posledica manjkajočega privzetega konta, neveljavne DDV-kode, zaokroževanja, preskočenega plačila ali poškodovanega/ročno spremenjenega vira.

## 0.7 Partnerji, DDV in dimenzije

Pri prihodku iz POS-a je partner lahko kupec, prejemnik subvencije ali pogodbeni naročnik. Pri nabavi je partner dobavitelj. Pri plačilu s kartico je lahko uporabljen prehodni oziroma kartični konto, vendar to ne pomeni, da je izdajatelj kartice samodejno pravilno določen partner.

V vrsticah preverite:

* **DDV-kodo** (5 %, 9,5 % ali 22 % oziroma drugo konfigurirano kodo);
* **DDV-osnovo in DDV-znesek**;
* **stroškovno mesto**, praviloma poslovno enoto;
* **projekt ali dogodek**, kadar ga izvorni dokument določa;
* **partnerja** pri terjatvah, obveznostih in subvencijah.

Če konto zahteva dimenzijo, manjkajoče dimenzije ne nadomeščajte z naključnim stroškovnim mestom. Temeljnico zadržite, dopolnite izvorni vnos ali nastavitev in ponovno ustvarite oziroma popravite osnutek v skladu z internim postopkom.

## 0.8 Izvoz in uporaba v drugi glavni knjigi

Pred izvozom oziroma ročnim prepisom v drugo glavno knjigo pripravite kontrolni seznam:

* referenca in datum dokumenta;
* konto-koda in polni naziv;
* D/K stran in znesek;
* opis vrstice;
* DDV-koda, osnova in znesek;
* partner, stroškovno mesto in projekt;
* status in povezava na izvorni POS-dokument.

Če ciljni program ne podpira vseh polj, ne zavrzite podatka brez dogovora z računovodskim vodjem. Referenco in izvorni ID shranite v opis ali pomožno polje, DDV in dimenzije pa v preslikovalno tabelo. Pred množičnim uvozom izvedite poskus z eno dnevno temeljnico in preverite, da je saldo ter da so davčna poročila enaka POS-predogledu.

Izvoz ni dovoljenje za spreminjanje izvornih zneskov. Preslikava konta v drugem programu mora biti dokumentirana, različna od nastavitev POS-a pa mora imeti jasno povezavo med izvornim in ciljnim kontom.

## 0.9 Revizijska sled in obdobja

Za revizijo hranite izvorni POS-dokument, predogled temeljnice, seznam preskočenih vnosov, izvoz oziroma uvoz in dokazilo o potrditvi. Pri ponovni sinhronizaciji preverite, ali je bil obstoječi osnutek osvežen ali zamenjan; potrjene temeljnice ne podvajajte ročno.

Pred zaklepanjem obdobja:

1. zaključite dnevne in mesečne postopke;
2. raziščite vse preskoke in opozorila;
3. uskladite promet po načinih plačila;
4. uskladite DDV po stopnjah;
5. uskladite zalogo in nabavne dokumente;
6. preverite storna, vračila in negativne salde bonov;
7. potrdite, da so temeljnice v pravem računovodskem obdobju.

Po zaklepanju obdobja ne spreminjajte datuma ali nastavitev zato, da bi se stari dogodek »prebil« v zaklenjeno obdobje. Uporabite dokumentiran popravek v odprtem obdobju, pri čemer se sklicujte na izvirno referenco in razlog popravka.

## 0.10 Popravki in robni primeri

**Napačen artikel ali DDV na še odprtem računu.** Popravite POS-vnos, ponovno izračunajte račun in sinhronizirajte osnutek. Ne popravljajte samo vrstice DDV v temeljnici.

**Račun je potrjen, nato je ugotovljena napaka.** Ustvarite storno oziroma dobropis po pravilih POS-a. Preverite, da ima popravek svojo referenco in nasprotne knjižne vrstice.

**Manjka konto.** Sinhronizacija lahko dogodek preskoči z razlogom. Nastavite ustrezen aktiven konto, preverite njegovo vrsto in dovoljenje za knjiženje, nato ponovite postopek. Manjkajočega konta ne nadomeščajte s poljubnim kontom samo zato, da se D/K izide.

**Ista temeljnica se pojavi dvakrat.** Primerjajte POS-referenco in status. Če je ena temeljnica že potrjena, druge ne potrjujte; preverite idempotentnost sinhronizacije in dokumentirajte ugotovitev.

**POS in glavna knjiga imata različne zneske.** Primerjajte izvorni račun, načine plačila, DDV po stopnjah, popuste, zaokroževanja in čas sinhronizacije. Razlike ne odpravljajte z neposredno spremembo salda.

**Ni računa, je pa operativni vnos.** Rezervacija, odprta miza ali nedokončano naročilo niso samodejno prihodek. Knjižite šele podprti in potrjeni računovodski dokument.

**Storno plačila pri več plačilih.** Preverite posamezne plačilne vrstice in status vsakega plačila. Ne razveljavite celotnega računa, če je razveljavljen samo en način plačila.

## 0.11 Kontrolni list pred potrditvijo

- [ ] Izvorni dokument je najden in shranjen.
- [ ] Referenca ni podvojena.
- [ ] Datum spada v odprto obdobje.
- [ ] Status je pravilen glede na fazo postopka.
- [ ] Vsi konti so aktivni, analitični in dovoljeni za knjiženje.
- [ ] Debet je enak kreditu.
- [ ] DDV po stopnjah in kodah se ujema z računom.
- [ ] Načini plačila se ujemajo z bruto zneskom.
- [ ] Partner, stroškovno mesto in projekt so pravilni.
- [ ] Storno oziroma popravek ima povezavo na izvirni dokument.
- [ ] Preskočeni dogodki imajo razložen in dokumentiran razlog.
- [ ] Izvoz ali prenos vsebuje tudi referenco za kasnejšo revizijo.
