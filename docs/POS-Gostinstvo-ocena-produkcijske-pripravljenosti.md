# POS Gostinstvo — ocena produkcijske pripravljenosti

**Datum ocene:** 6. september 2026  
**Namen:** odločitev o začetku produkcijskega dela in prehodu uporabnikov iz starega programa

## Končna ugotovitev

**Modul POS Gostinstvo je pripravljen za nadzorovan produkcijski pilot in postopni prehod uporabnikov.**

**Modul še ni pripravljen za nenaden množični prehod vseh uporabnikov in takojšnjo popolno opustitev starega programa.**

Priporočena odločitev je:

> Ena lokacija → dejanska oprema → več polnih produkcijskih izmen → dnevna finančna, FURS in ERP uskladitev → odprava ugotovljenih težav → postopna širitev.

## Povzetek ocene

POS Gostinstvo ni več prototip. Gre za obsežen sistem, ki podpira glavne gostinske procese od prijave in odprtja izmene do naročil, priprave, plačila, fiskalizacije, zalog, poročil in knjiženja v ERP.

Za pilotno uporabo je funkcionalno dovolj razvit. Pred množičnim prehodom pa je treba na dejanski lokaciji potrditi predvsem najobčutljivejše postopke: nejasne kartične rezultate, zaključek izmene, offline FURS, uskladitev POS→ERP in stabilnost fizičnih naprav.

## Ocena po področjih

| Področje | Ocena | Ugotovitev |
|---|---|---|
| Mize, naročila in rezervacije | Pripravljeno | Podprti so glavni gostinski delovni tokovi |
| Meni, modifikatorji, pice in hodi | Pripravljeno | Funkcionalno zelo razvit sklop |
| KDS in priprava | Pilot | Potrebna potrditev na dejanskih zaslonih in postajah |
| Gotovina in osnovna plačila | Pripravljeno | Osnovni plačilni tokovi so izvedeni |
| Kartični terminali | Pilot z nadzorom | Nejasen rezultat potrebuje voden operativni postopek |
| Računi in FURS | Pilot | Glavni tok obstaja, potrditi je treba izredne scenarije |
| Offline fiskalizacija | Produkcijska vaja | Pred prehodom je obvezna vaja izpada povezave |
| Zaloge, normativi in WAC | Pilot | Potrebna dnevna kontrola razlik v začetni fazi |
| Izmene in zaključek dneva | Dodatna varovala | Zaključna kontrola še ni dovolj enotna |
| POS→ERP | Dnevni nadzor | Knjiženje obstaja, manjka centralna uskladitev |
| Naprave in tiskalniki | Preverjanje po lokaciji | Vsako fizično kombinacijo je treba potrditi posebej |
| Množični prehod | Trenutno odsvetovan | Najprej je potreben uspešen pilot |

# 1. Zakaj je modul primeren za pilot

Modul podpira:

- prijavo, vloge, podjetja, poslovne enote in blagajne;
- izmene, zaposlene, odmore in blagajniške premike;
- tlorise, mize in rezervacije;
- več naročil na isti mizi;
- telefonska, QR, prevzemna in dostavna naročila;
- modifikatorje, pice in večhodne menije;
- kuhinjo, pico, točilnico in izdajo;
- gotovino, kartice, mešana plačila, napitnine in bone;
- račune, EOR/ZOI, FURS, ponatis in polni storno;
- artikle, normative, zaloge, prejemnice in inventure;
- pripravljeno hrano, dogodke in začasne enote;
- operativna poročila in POS→ERP temeljnice;
- več vrst tiskalnikov, terminalov in lokalnih mostov.

To pomeni, da modul lahko podpira resnično delo v gostinskem obratu. Preostale vrzeli so predvsem pri obravnavi izjem, nadzoru in obnovi po napaki.

# 2. Zakaj množični prehod še ni priporočljiv

## 2.1 Nejasen rezultat kartičnega plačila

Sistem tehnično beleži terminalske poskuse in pozna stanji pending ter unknown. Manjka pa enoten operativni zaslon, ki bi uporabniku nedvoumno povedal:

- ali je bila kartica bremenjena;
- ali sme varno ponoviti plačilo;
- ali lahko izda račun;
- ali mora počakati;
- ali je potreben refund;
- ali je primer namenjen ročni uskladitvi.

Pri množični uporabi lahko napačna odločitev povzroči dvojno bremenitev ali nepravilno povezan račun.

## 2.2 Zaključek izmene in dneva

Pred popolnim prehodom mora biti potrjeno, da zaključek izmene oziroma Z-poročila pravilno obravnava:

- odprta naročila;
- neizdane račune;
- pending in unknown terminalske poskuse;
- nepojasnjeno gotovinsko razliko;
- račune v FURS čakalni vrsti;
- neusklajene dogodkovne prenose ali vračila.

Posamezni podatki obstajajo, vendar še niso dokazano združeni v en varen zaključni postopek.

## 2.3 Offline FURS

Offline fiskalna infrastruktura obstaja. Pred opustitvijo starega programa je treba na dejanski lokaciji izvesti vajo:

1. prekiniti internetno povezavo;
2. izdati več računov;
3. ponovno vzpostaviti povezavo;
4. po potrebi ponovno zagnati napravo ali storitev;
5. preveriti odpošiljanje čakalne vrste;
6. preveriti EOR in ZOI;
7. preveriti ponatis brez nove fiskalne identitete.

## 2.4 POS→ERP uskladitev

Knjiženje v ERP obstaja, vendar manjka enoten pregled, ki bi hitro pokazal:

- račun brez temeljnice;
- podvojeno temeljnico;
- manjkajoči konto ali DDV kodo;
- razliko med prometom POS in ERP;
- napako pri zalogovnem učinku;
- ali je varen ponovni poskus.

Med pilotom je zato potreben dnevni ročni nadzor.

## 2.5 Fizične naprave

Vsaka produkcijska lokacija ima svojo kombinacijo terminala, tiskalnikov, omrežja, KDS zaslonov in lokalnih mostov. Na vsaki lokaciji je treba potrditi:

- tisk blagajniškega računa;
- tisk v kuhinji, piceriji in baru;
- pravilne širine ter šumnike;
- izpad in ponovno povezavo tiskalnika;
- kartični terminal;
- KDS zaslone;
- lokalni Android oziroma Windows most;
- rezervni postopek ob izpadu.

# 3. Priporočen prehod

## Faza 1 — interna simulacija

Na dejanski opremi je treba izvesti celoten simuliran poslovni dan:

1. odpiranje izmene;
2. gotovinsko plačilo;
3. kartično plačilo;
4. mešano plačilo;
5. delitev računa;
6. napitnina;
7. polni storno;
8. nejasen ali prekinjen terminalski poskus;
9. izpad interneta med fiskalizacijo;
10. izpad tiskalnika;
11. sprememba zaloge ali inventura;
12. zaključek izmene;
13. primerjava prometa, plačil, FURS in ERP.

## Faza 2 — pilot na eni lokaciji

Priporočeni pogoji:

- ena poslovna enota;
- ena blagajna oziroma omejeno število naprav;
- izkušeni uporabniki;
- najmanj 5 do 10 polnih delovnih dni;
- dnevna kontrola računov, kartic, gotovine, FURS in ERP;
- stari program ostane dostopen za vpogled;
- določena odgovorna oseba za reševanje incidentov.

Starega in novega programa ni priporočljivo vzporedno uporabljati za izdajanje računov na isti blagajni, razen če so pravila in številčenje vnaprej natančno določeni.

## Faza 3 — razširjeni pilot

Po uspešni prvi fazi:

- vključiti dodatno blagajno;
- vključiti vse KDS postaje in tiskalnike;
- vključiti QR in telefonska naročila;
- izvesti prometno obremenitev;
- preveriti več sočasnih uporabnikov;
- ponovno potrditi zaključek dneva in ERP.

## Faza 4 — postopni prehod

Prehod se izvede po poslovnih enotah. Za vsako enoto se pred produkcijskim začetkom izpolni in podpiše kontrolni seznam.

# 4. Pogoji za odločitev GO

Pilotna lokacija je pripravljena za produkcijsko delo, ko so izpolnjeni naslednji pogoji:

1. Uspešen test gotovinskega, kartičnega in mešanega plačila.
2. Uspešen test polnega storna.
3. Pisno in praktično potrjen postopek za nejasen terminalski rezultat.
4. Uspešna offline FURS vaja.
5. Uspešen tisk na vseh fizičnih tiskalnikih.
6. Potrjen zaključek izmene in Z-poročila.
7. Usklajeni promet, plačila, gotovina in ERP.
8. Potrjena otvoritvena stanja zaloge in blagajne.
9. Usposobljeno osebje.
10. Določena podpora v času prvih produkcijskih izmen.

# 5. Kontrolni seznam posamezne lokacije

## Poslovne nastavitve

- [ ] Podjetje in poslovna enota sta pravilna.
- [ ] Poslovni prostor FURS je registriran.
- [ ] Blagajne in številčenje računov so potrjeni.
- [ ] Davčne stopnje, cene in meni so preverjeni.
- [ ] Uporabniki, vloge in natakarji so pravilno povezani.

## Naprave

- [ ] POS naprava je registrirana na pravo enoto.
- [ ] Kartični terminal je preizkušen.
- [ ] Blagajniški tiskalnik je preizkušen.
- [ ] Kuhinjski, barski in pizza tiskalniki so preizkušeni.
- [ ] KDS zasloni prikazujejo pravilne postaje.
- [ ] Postopek ob izpadu naprave je znan osebju.

## Finance in FURS

- [ ] Gotovinsko plačilo je uspešno.
- [ ] Kartično plačilo je uspešno.
- [ ] Mešano plačilo je uspešno.
- [ ] Polni storno je uspešen.
- [ ] EOR in ZOI sta pravilno prikazana.
- [ ] Offline FURS vaja je uspešna.
- [ ] X- in Z-poročilo se ujemata s prometom.

## Zaloga in ERP

- [ ] Otvoritvene zaloge so potrjene.
- [ ] Normativi ključnih artiklov so preverjeni.
- [ ] Prejemnica in inventura sta preizkušeni.
- [ ] POS promet je pravilno knjižen v ERP.
- [ ] Razlike in manjkajoče temeljnice so pregledane.

## Organizacija prehoda

- [ ] Določen je datum prehoda.
- [ ] Določena je odgovorna oseba na lokaciji.
- [ ] Določena je tehnična podpora.
- [ ] Osebje je izvedlo praktično usposabljanje.
- [ ] Stari program ostane dostopen za vpogled.
- [ ] Pravila ob vrnitvi na rezervni postopek so dokumentirana.

# 6. Merila za širitev na naslednjo lokacijo

Prehod na naslednjo lokacijo je priporočljiv, ko pilot doseže:

- najmanj 5 do 10 polnih izmen brez izgubljenega računa;
- nič nepojasnjenih dvojnih kartičnih bremenitev;
- popolno uskladitev FURS računov;
- dnevno usklajen promet, plačila in gotovino;
- uspešno POS→ERP knjiženje ali jasno razložene razlike;
- stabilno tiskanje in KDS delovanje;
- uspešno obravnavo vsaj enega simuliranega izpada;
- potrjeno usposobljenost uporabnikov.

# Sklep

Odločitev ni »modul je nepripravljen«, temveč »modul je pripravljen za nadzorovan začetek, ne za nenadzorovan množični rez«.

Najvarnejši pristop je ena lokacija, dejanska oprema, več polnih izmen in vsakodnevna uskladitev. Če pilot uspe brez nepojasnjenih plačil, izgubljenih računov, FURS razlik ter POS→ERP odstopanj, je postopni prehod preostalih uporabnikov utemeljen.