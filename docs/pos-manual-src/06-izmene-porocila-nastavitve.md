<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5dbd05388542 package=lite -->
# 06 Plačilo, račun, FURS in tisk

Postopki spodaj veljajo le za vključene funkcije aktivne enote in njenega
paketa POS. Zlasti prodaja in unovčenje darilnih bonov nista omogočena
samodejno v vsakem lokalu. Če ustrezni gumb ali način plačila manjka,
preverite funkcijo darilnih bonov ter uporabniško vlogo po poglavju 09;
ne uporabljajte drugega načina plačila kot nadomestka za unovčenje bona.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-29b6d71c2c79 package=lite -->
## 1. Namen sklopa

Ta sklop opisuje zaključek prodaje: plačilo, izdajo računa, davčno potrjevanje
FURS, tisk, ponatis in storno.

Izmeno odprete in zaprete po sklopu 08. Naročilo in priprava sta v sklopu 05.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-23755ca2defc package=lite -->
## 2. Predpogoji

1. Uporabnik je prijavljen v pravilno enoto in blagajno.
2. Za blagajniško delo je odprta izmena, kadar jo enota zahteva.
3. Naročilo vsebuje pravilne artikle, količine, popuste in kanal predaje.
4. Nastavljeni so dovoljeni načini plačila.
5. Terminal je povezan in pripravljen, če se uporablja kartica.
6. Tiskalnik oziroma tiskalniški most je dosegljiv, če tiskate lokalno.
7. Certifikat FURS je veljaven, kadar se posluje v produkcijskem načinu.

> **Opozorilo:** Računa, ki je že fiskaliziran, ne »popravljajte« z novim
> neuradnim računom. Uporabite dovoljen postopek storna oziroma vračila.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f29fa827ab3f package=lite -->
## 3. Pregled pred plačilom

1. Odprite naročilo in primerjajte postavke z naročilom gosta.
2. Preverite cene, količine, popust in zaokroževanje.
3. Preverite, ali naročilo pripada pravi mizi, prevzemu ali dostavi.
4. Preverite, ali so vsi potrebni hodi poslani v pripravo.
5. Potrdite skupni znesek z gostom.
6. Šele nato izberite **Plačilo**.

Ne spreminjajte postavk, medtem ko terminal že obdeluje plačilo. Najprej
zaključite ali razrešite stanje terminala.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5b50afec97f0 package=lite -->
## 4. Načini plačila

Na voljo so samo načini, ki jih je za enoto omogočil skrbnik.

Običajno so to gotovina, kartica oziroma terminal in drugi konfigurirani načini.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-39a5aa78fea2 package=lite -->
### 4.1 Gotovina

1. Izberite **Gotovina**.
2. Vnesite prejeti znesek, če ga POS zahteva.
3. Povejte gostu izračunano vračilo.
4. Preštejte vračilo in ga izročite.
5. Dokončajte plačilo.
6. Preverite uspešno izdani račun in predajte izvod gostu.

Gotovinskega plačila ne zaključujte, če je blagajna fizično nedosegljiva ali
če poslovanje deluje v režimu, ki gotovine ne dovoljuje brez povezave.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-60134bb8b52e package=lite -->
### 4.2 Kartica oziroma terminal

1. Izberite kartico ali terminalski način plačila.
2. Preverite znesek na POS in na terminalu.
3. Gost izvede plačilo na terminalu.
4. Počakajte na dokončni odgovor terminala.
5. Ne ponavljajte transakcije, če se odgovor izgubi.
6. Ko POS pokaže uspeh, zaključite račun.
7. Gostu izročite račun in morebitno potrdilo terminala.

Znesek na terminalu mora biti enak znesku izbrane plačilne postavke, ne nujno
celotnemu računu pri deljenem plačilu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-69dbfc28d041 package=lite -->
### 4.3 Drugi dovoljeni načini

1. Izberite samo dejansko prejeti način.
2. Preverite morebitno referenco ali dokazilo po pravilih enote.
3. Dokončajte plačilo.
4. Na računu preverite prikaz načina plačila.

Ne uporabljajte drugega načina samo zato, da bi račun zaključili hitreje.
Razlika oteži uskladitev prometa in blagajne.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-45c6b576fa50 package=lite -->
## 5. Deljeno plačilo

Deljeno plačilo razdeli znesek enega naročila na več plačilnih postavk.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-e6448cf01a92 package=lite -->
### 5.1 Postopek

1. Na zaslonu plačila izberite delitev plačila.
2. Vnesite prvi znesek in izberite njegov način plačila.
3. Potrdite prvo plačilo samo po dejanskem prejemu.
4. Preverite preostanek.
5. Dodajte naslednje plačilo z zneskom in načinom.
6. Ponovite do ničelnega preostanka.
7. Šele pri ničelnem preostanku zaključite račun.
8. Preverite, da račun prikazuje vse načine in zneske.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4be8193712e8 package=lite -->
### 5.2 Dve osebi, ločeni postavki

Če gostje plačajo različne jedi, najprej pravilno razdelite postavke oziroma
ustvarite ločena naročila po veljavnem postopku. Delitev zneska ne popravi
napačne razdelitve jedi, napitnin ali popustov.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5738fa9e584a package=lite -->
### 5.3 Napaka pri deljenem plačilu

1. Ustavite postopek pred zaključkom računa.
2. Zapišite že potrjeni znesek in način.
3. Ne obremenite kartice ponovno brez preverjanja terminala.
4. Preverite stanje plačil na naročilu.
5. Nadaljujte samo z neplačanim preostankom.
6. Če je račun že izdan, uporabite storno ali vračilo po pravilih.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1a33442f256d package=lite -->
## 6. Neznano stanje terminala

Neznano stanje nastopi, ko terminal pokaže uspeh, POS pa nima potrditve, ali
ko POS čaka, terminal pa je prekinil povezavo.

To stanje ni samodejno zavrnitev.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-459555e92073 package=lite -->
### 6.1 Obvezen postopek

1. Ne pritisnite plačila znova.
2. Gostu povejte, da preverjate stanje transakcije.
3. Na terminalu preverite končni prikaz, potrdilo ali zgodovino.
4. V POS preverite, ali je plačilo že evidentirano.
5. Primerjajte znesek, čas in referenco transakcije.
6. Če je bilo plačilo odobreno, dokončajte obnovitev po prikazanem postopku.
7. Če je bilo zavrnjeno, začnite novo plačilo šele po jasni zavrnitvi.
8. Če stanja ni mogoče dokazati, pokličite vodjo oziroma podporo terminala.

> **Opozorilo:** Neznano stanje obravnavajte kot možno uspešno bremenitev.
> Dvojna obremenitev gosta je hujša od nekajminutnega čakanja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-34166363600e package=lite -->
### 6.2 Plačilna obnovitev

Ko POS ponudi obnovitev, preverite podatke pred potrditvijo.

1. Izberite pravilen odprti račun oziroma naročilo.
2. Preverite znesek in terminalsko referenco.
3. Potrdite obnovitev le za isto transakcijo.
4. Po uspehu preverite eno samo plačilno postavko.
5. Natisnite račun šele po dokončnem stanju.

Če obnovitev ni na voljo, ne ustvarjajte nadomestnega kartičnega plačila.
Eskalirajte s časom, zneskom, blagajno in terminalsko referenco.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-13ba35e21236 package=lite -->
## 7. Omejitve pri delu brez povezave

POS lahko ima posebej določen režim dela brez povezave in lokalno pooblastilo.

Uporabljajte ga samo, kadar sistem jasno pokaže, da je za to napravo omogočen.

1. Ne domnevajte, da je offline način na voljo.
2. Upoštevajte opozorilo POS o omejitvah plačil.
3. Gotovine ne sprejemajte v offline režimu, kadar jo POS izrecno omeji.
4. Ne obhajajte omejitve z izbiro napačnega plačilnega načina.
5. Po vrnitvi povezave preverite uspešno sinhronizacijo računov.

Offline omejitev ščiti sledljivost računov in fiskalno obdelavo. Če sistem
gotovine ne dovoli, z gostom dogovorite dovoljen alternativni način ali
odložite zaključek skladno s poslovnim pravilom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-679db8ed3790 package=lite -->
## 8. Izdaja in davčno potrjevanje računa

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a75dfe444f53 package=lite -->
### 8.1 Običajen potek

1. Zaključite plačilo.
2. POS ustvari račun.
3. Sistem pripravi podatke za FURS.
4. Ob uspešni registraciji račun prejme EOR.
5. Račun vsebuje zahtevane identifikacijske podatke.
6. Račun natisnite ali predajte po izbranem načinu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c781d5eba652 package=lite -->
### 8.2 EOR in ZOI

**ZOI** je zaščitna oznaka izdajatelja.

**EOR** je enkratna identifikacijska oznaka odgovora FURS.

Na uspešno potrjenem računu preverite, da sta prikazana pravilna identifikatorja,
kadar sta za konkreten režim zahtevana.

Odsotnost EOR pri računu v produkciji pomeni, da je potrebna preveritev stanja,
ne pa samodejno, da račun ne obstaja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d62a942c2527 package=lite -->
### 8.3 FURS napaka in ponovni poskus

Če POS pokaže, da račun ni registriran pri FURS:

1. Računa ne izdajajte drugič.
2. Zabeležite številko računa, čas in sporočilo napake.
3. Preverite, ali je prikazan status napake oziroma manjkajoč EOR.
4. Po vzpostavitvi povezave uporabite dejanje **FURS retry**, če je na voljo.
5. Počakajte na rezultat ponovnega pošiljanja.
6. Preverite, da je račun dobil EOR oziroma da ni več označen kot napaka.
7. Če ponovni poskus ne uspe, obvestite odgovorno osebo s podatki računa.

Ponovni poskus pošlje obstoječi račun. Ne ustvarja nove prodaje in ne rešuje
napačne vsebine računa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-110fd4de30a7 package=lite -->
### 8.4 Potek certifikata

Opozorilo o poteku certifikata zahteva takojšnje ukrepanje skrbnika.

Blagajnik ne nalaga certifikata na lastno pobudo. Pred izdajo nadaljnjih računov
obvesti odgovorno osebo in ravna po internem postopku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c1a37202f993 package=lite -->
## 9. Tisk računa

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-11d04ae4a7ab package=lite -->
### 9.1 Prvi tisk

1. Po uspešnem zaključku počakajte na status uspešno izdanega računa.
2. Izberite tisk, kadar se ne sproži samodejno.
3. Preverite pravi tiskalnik.
4. Preverite, ali je na izpisu številka računa, znesek in identifikatorji.
5. Izvod predajte gostu oziroma ga priložite paketu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8fe942094c0b package=lite -->
### 9.2 Napaka tiskalnika

1. Ne zaključujte novega plačila.
2. Preverite papir, pokrov, napajanje in povezavo tiskalnika.
3. Preverite, ali lokalni tiskalniški most deluje.
4. Odpravite fizično napako.
5. Uporabite **Ponatis** obstoječega računa.
6. Primerjajte številko ponatisa z računom na zaslonu.

Tiskovna napaka ne pomeni, da račun ni izdan. Ponatis nikoli ni nov račun.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-43b330e9f510 package=lite -->
### 9.3 Ponatis

1. Odprite evidenco računov.
2. Poiščite račun po številki, času ali znesku.
3. Preverite, da ste odprli pravi račun.
4. Izberite ponatis.
5. Preverite uspeh tiskanja.
6. Izvod označite oziroma obravnavajte skladno z internimi pravili.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1c103e7480cf package=lite -->
## 10. Storno in vračilo

Storno spremeni že izdan račun samo prek sledljivega postopka.

Uporablja se za upravičeno odpravo že zaključenega prometa, ne za popravljanje
odprte košarice.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8eb1a655959c package=lite -->
### 10.1 Pred stornom

1. Poiščite izvirni račun v evidenci.
2. Preverite številko, datum, znesek, plačilo in razlog.
3. Preverite, ali je treba razveljaviti celoten izvirni račun.
   POS podpira storno celotnega računa, ne izbire posameznih vrstic ali količin.
   Če je bila napačna le ena postavka, se najprej stornira celotni izvirnik,
   nato se po dovoljenem postopku ustvari in izda nov, pravilen račun.
4. Preverite pravice uporabnika in interno odobritev.
5. Ne izvajajte storna samo zato, ker je tisk slab.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-9b9af1d3e453 package=lite -->
### 10.2 Izvedba

1. Odprite pravi izvirni račun.
2. Izberite dejanje storno oziroma vračilo.
3. Preverite, da storno zajema celoten znesek in vse postavke izvirnega računa.
4. Vnesite resničen razlog po politiki podjetja.
5. Preverite znesek celotnega računa pred potrditvijo.
6. Potrdite storno.
7. Preverite, da je ustvarjen sledljiv storno dokument za celoten izvirnik.
8. Če je potreben popravek, ustvarite novo pravilno naročilo in ga zaključite
   kot novo prodajo po običajnem postopku.
9. Gostu vrnite denar le z dovoljenim in evidentiranim postopkom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a558b5b21662 package=lite -->
### 10.3 Po stornu

1. Preverite povezavo storno dokumenta z izvirnim računom.
2. Preverite fiskalni status dokumenta.
3. Natisnite dokument, če je zahtevan.
4. Preverite vpliv na plačilni način in poročila.
5. Če je bil artikel vrnjen, nadaljujte s postopkom zaloge iz sklopa 07.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-b0cd2b6574e7 package=lite -->
## 11. Končne kontrole sklopa

Pred odhodom gosta oziroma predajo paketa preverite:

1. skupni znesek je pravilen;
2. vsak deljeni znesek je prejet samo enkrat;
3. stanje terminala je znano;
4. račun je izdan enkrat;
5. FURS napaka je zabeležena in poslana v ponovni poskus, kadar je potreben;
6. EOR in ZOI sta preverjena skladno z režimom;
7. gost je prejel račun oziroma je račun priložen naročilu;
8. storno je izveden samo prek sledljivega dokumenta.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-563f4beb8309 package=lite -->
## 12. Zaslon plačila: branje, polja in blokade

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-bd01fd09a510 package=lite -->
### 12.1 Kaj preveriti na postavitvi

Zaslon plačila vedno pripada trenutno izbranemu odprtemu naročilu.
V glavi preverite številko naročila, mizo oziroma kanal in poslovno enoto.
V seznamu postavk preverite količino, popust, DDV in skupni bruto znesek.
V območju plačil preverite že dodane plačilne vrstice.
Preostanek je znesek, ki še ni pokrit z veljavnimi plačilnimi vrsticami.
Gumb za izdajo ne sme biti uporabljen, dokler preostanek ni pravilen.
Povzetek gotovine kaže prejeti znesek in vračilo, kadar je vnos omogočen.
Kartični del kaže znesek, ponudnika in stanje poskusa.
Posebna plačila odprite samo, kadar jih enota dejansko podpira.
Stanje »v obdelavi« je blokada za spreminjanje naročila in nov poskus plačila.

| Podatek | Pomen | Kontrola uporabnika |
| --- | --- | --- |
| skupni znesek | obveznost naročila | primerjaj z naročilom gosta |
| plačano | potrjene plačilne vrstice | ne sklepaj iz klika gumba |
| preostanek | znesek za nadaljnje plačilo | mora biti nič pred izdajo |
| način | evidenčni način plačila | mora ustrezati dejanskemu prejemu |
| napitnina | dodatno plačilo gosta | potrdi z gostom pred terminalom |
| referenca | sled terminala ali nakazila | preveri čas in znesek |
| status | potek terminalskega poskusa | ne zamenjaj neznanega z zavrnitvijo |

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-18e40837fcfa package=lite -->
### 12.2 Zaporedje, ki prepreči napake

Najprej zaklenite dogovor z gostom o znesku.
Nato določite, ali bo en sam ali več plačilnih načinov.
Pri kartici najprej nastavite točen kartični del zneska.
Pri gotovini najprej preštejte prejeti denar.
Pri darilnem bonu preverite, ali je za enoto omogočena skupna evidenca bonov
ali pa gre za individualni spletni bon s kodo; pred potrditvijo preverite
ustrezno stanje in omejitve iz razdelka **Darilni bon oziroma darilna kartica**.
Pri TRR najprej preverite, ali je način za to enoto omogočen.
Šele po potrditvi posamezne vrstice dodajte naslednjo vrstico.
Računa ne izdate za znesek, ki je zgolj obljubljen.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-69fa50173ce8 package=lite -->
### 12.3 Stanja plačilne vrstice

`predlagano` pomeni, da je uporabnik izbral znesek, ne da je denar prejet.
`v_obdelavi` pomeni, da terminal ali ponudnik še vrača končni odgovor.
`potrjeno` pomeni, da se vrstica všteva v plačano vrednost.
`zavrnjeno` pomeni, da denar ni potrjen in vrstica ne sme zapreti računa.
`neznano` pomeni, da je treba najprej opraviti obnovitev oziroma uskladitev.
`preklicano` pomeni, da poskus ni veljavna plačilna vrstica.
Uporabnik ne sme prepisovati stanja z izbiro drugega načina.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-87ca4f5099bc package=lite -->
## 13. Podprti načini plačila in njihove kontrole

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-88f0bf58acc6 package=lite -->
### 13.1 Gotovina

Gotovina je fizično prejeta valuta, ne kasnejša obljuba gosta.
Vnesite prejeti znesek, če blagajna uporablja vnos prejete gotovine.
POS izračuna vračilo iz razlike med prejetim zneskom in gotovinskim delom.
Vračilo preštejte pred gostom in ga evidentirajte samo enkrat.
Pri mešanem plačilu je gotovinski del lahko manjši od skupnega računa.
Primer: račun 23,50 EUR; kartica 20,00 EUR; gotovina 3,50 EUR.
Ne evidentirajte 23,50 EUR gotovine, če gost kartico plača za 20,00 EUR.
Ne uporabljajte gotovine namesto kartice, kadar terminalski rezultat ni znan.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-318a7169c31f package=lite -->
### 13.2 Kartica

Kartica je podprta samo prek nastavljenega terminalskega toka.
Znesek na terminalu mora ustrezati trenutno izbranemu kartičnemu delu.
Gost potrdi plačilo na terminalu, ne na zaslonu POS namesto terminala.
Uspešen pisk ni sam po sebi dovolj; počakajte na končni status.
Terminalski listek ni razlog za novo bremenitev, če POS še čaka.
Pri delitvi mora vsak kartični poskus imeti svoj znesek in sled.
Kartice ne uporabljajte za izdajo gotovinskega vračila brez dovoljenega postopka.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-74cc71e3646b package=extended -->
### 13.3 Darilni bon oziroma darilna kartica

POS razlikuje dva toka darilnega bona; pred plačilom izberite pravega:

* **Stari boni (skupna evidenca)** nimajo individualne kode ali stanja po
  posameznem bonu. Na plačilnem zaslonu preverite prikazano skupno odprto
  vrednost in znesek, ki ga želite pokriti. Preostanek računa lahko pokrijete
  z drugim dovoljenim načinom, tudi s kartico.
* **Spletni bon s kodo** je individualni bon z lastno kodo, stanjem in
  morebitnim datumom veljavnosti. V načinu plačila **Bon** izberite
  **Spletni bon s kodo**, nato kodo skenirajte s kamero/2D-čitalnikom ali jo
  vnesite in pritisnite **Preveri**. Nadaljujte samo, ko POS prikaže veljaven
  status in dobroimetje; znesek bona ne sme preseči neporabljenega dobroimetja
  niti preostanka računa. Individualni spletni bon lahko pokrije cel račun ali
  njegov del, vendar je morebitno doplačilo v tem toku dovoljeno samo z
  gotovino, ne s kartico. Če koda ali stanje ni potrjeno, bona ne evidentirajte
  kot plačila.

Javna stran lahko omogoča preverjanje stanja individualnega bona; to je samo
informativni pregled, ne unovčitev. Unovčitev posameznega bona se opravi v POS-u
po zgornjem postopku.

Izdaja na plačilnem zaslonu POS-a ostaja ločen postopek za splošni bon iz
skupne evidence: v dialogu **Izdaja darilnega bona** se določi znesek in
gotovina ali kartica. To ni izdaja individualnega bona s kodo. Spletni
individualni boni se prodajajo po postopku **Spletna prodaja individualnega
bona in Stripe**. Bon za pico in
subvencionirana prehrana ostajata ločena toka. Če sistem bon zavrne ali je izid
plačila oziroma računa neznan, ne ustvarjajte nadomestnega plačila; najprej
preverite isto evidenco, račun in plačilni poskus.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-adb8d5d01893 package=extended -->
### 13.4 Bon za pico in drugi namenski boni

Namenski bon velja samo za artikle in pogoje, ki jih določi enota.
Bon za pico se v poročilih vodi ločeno od splošnega darilnega bona, kadar je omogočen.
Natakar pred potrditvijo preveri, ali izbrani artikli izpolnjujejo pogoj bona.
Preostanek, ki ga bon ne pokrije, se plača z veljavnim dodatnim načinom.
Ne pretvarjajte namenskega bona v gotovino.
Ne uporabljajte splošnega načina »bon«, kadar je za pico nastavljen ločen način.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-65b77a6f21cf package=lite -->
### 13.5 Subvencionirana prehrana

Subvencijo uporabite samo, če jo konfiguracija enote in pogodbeni tok podpirata.
Pred potrditvijo preverite upravičenost, znesek subvencije in doplačilo gosta.
Subvencija ni popust, ki ga blagajnik prosto vnese.
Če preverjanje upravičenosti ni uspešno, ne zaključite računa kot subvencioniranega.
Doplačilo se evidentira kot ločena plačilna vrstica z dejanskim načinom.
Primer: obrok 8,90 EUR; subvencija 3,80 EUR; kartica 5,10 EUR.
Evidenca mora ločiti vrednost subvencije od kartičnega ali gotovinskega doplačila.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-751a66651a7a package=lite -->
### 13.6 Odloženo plačilo in reprezentanca

Odloženo plačilo je dovoljeno le, če ga enota izrecno omogoča in uporabnik ima pravico.
Izberite pravi subjekt oziroma razlog, če obrazec to zahteva.
Odloženo ne pomeni »gost bo morda prišel kasneje«.
Pred potrditvijo preverite, kdo prevzema obveznost in katera referenca jo povezuje.
Reprezentanca je evidenčni poslovni razlog, ne prikrito zasebno plačilo.
Ne izberite reprezentance zato, da bi zaprli odprto naročilo brez denarja.
Vodja redno preverja odprte odložene obveznosti po internem postopku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-406452117625 package=lite -->
### 13.7 TRR oziroma negotovinsko nakazilo

TRR uporabite samo za dejansko dogovorjeno nakazilo in kadar je način na voljo.
Vnesite zahtevano referenco, sklic ali dokument, če ga obrazec zahteva.
Nakazilo v pripravi ni enako prejetemu nakazilu, razen če politika to izrecno določa.
Ne izberite TRR namesto kartice ob izpadu terminala brez odobritve.
V poročilih se TRR lahko prikaže kot negotovinsko ločeno od kartic.
Primer: poslovna stranka predloži potrjen sklic; operater ga preveri in evidentira po pravilih enote.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0826ece3c4fc package=lite -->
### 13.8 Lastna poraba in posebni promet

Lastna poraba je poseben evidenčni tok, kadar ga enota omogoča.
Uporabnik izbere samo dejanski in odobren razlog.
Lastna poraba ne sme prikrivati napake artikla, reklamacije ali neplačanega obroka.
Če način ni na voljo, uporabnik ne išče obvoza z napačnim plačilom.
Za vprašanje o davčni obravnavi se obrne na odgovorno osebo, ne ugiba na blagajni.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0b260bbfaf73 package=lite -->
## 14. Delni računi, delitev postavk in mešana plačila

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8002293fe13b package=lite -->
### 14.1 Delitev ni vedno enaka

Delitev po osebah pomeni, da najprej razporedite postavke.
Delitev po znesku pomeni, da ostane vsebina naročila ista, plačil je več.
Delni račun pomeni dovoljeni ločen dokument za izbrani del prometa.
Mešano plačilo pomeni več načinov na istem računu.
Preden izberete funkcijo, vprašajte gosta, ali želi ločene račune ali samo več načinov.
Napačna izbira lahko spremeni prikaz artiklov, popustov in napitnine.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-017188f12c5e package=lite -->
### 14.2 Delitev postavk

Najprej določite, katere postavke pripadajo posameznemu gostu.
Pri skupni jedi se z gostom dogovorite o dovoljenem načinu delitve.
Popust pripišite pravilnemu delu, ne samovoljno prvemu računu.
Napitnino dodajte po razdelitvi, če jo plača samo ena oseba.
Preverite, da nobena postavka ne ostane dvakrat ali brez prejemnika.
Šele nato vsako nastalo naročilo zaključite po običajnem postopku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c9b375eb6d01 package=lite -->
### 14.3 Mešana plačila

Primer: račun znaša 47,60 EUR.
Gost želi 30,00 EUR s kartico in 17,60 EUR z gotovino.
Najprej nastavite kartico na 30,00 EUR.
Po uspešni kartici preverite preostanek 17,60 EUR.
Nato sprejmite gotovino za 17,60 EUR oziroma vnesite prejeti znesek.
Pred izdajo preverite, da je plačano 47,60 EUR in preostanek 0,00 EUR.
Na računu preverite obe plačilni vrstici.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-986414ede426 package=lite -->
### 14.4 Delno potrjen kartični poskus

Če prva kartica uspe za 20,00 EUR, to je veljavno plačilo.
Ne stornirajte je samo zato, ker druga kartica za preostanek ni uspela.
Preostanek se izračuna iz uspešno potrjenih 20,00 EUR.
Z gostom se dogovorite za drug dovoljeni način samo za preostanek.
Če je prvi poskus neznan, ne obravnavajte 20,00 EUR kot prosti preostanek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4fa290240f6d package=lite -->
### 14.5 Kontrolni seznam delitve

- [ ] Gost je povedal, ali želi ločene račune ali delitev plačila.
- [ ] Postavke so razdeljene pred plačilom, kadar je to potrebno.
- [ ] Popusti niso podvojeni.
- [ ] Kartični znesek ustreza samo kartičnemu delu.
- [ ] Gotovina pokriva samo preostanek.
- [ ] Za stari bon znesek ne presega skupne odprte evidence; za spletni bon s
      kodo ne presega preverjenega individualnega dobroimetja.
- [ ] Končni preostanek je 0,00 EUR.
- [ ] Na računu so vsi dejanski načini.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-84ad85a945b6 package=lite -->
## 15. Napitnina

Napitnina je prostovoljna odločitev gosta.
Znesek napitnine vedno jasno ponovite gostu pred potrditvijo.
Pri terminalu preverite, ali terminal prikazuje skupni znesek s napitnino.
Napitnina ni nadomestilo za različno vračilo.
Pri deljenem plačilu določite, katera oseba daje napitnino.
Primer: račun 18,00 EUR, gost odobri kartico 20,00 EUR; napitnina je 2,00 EUR.
Če gost spremeni odločitev pred zaključkom, popravite pred zagonom terminala.
Po uspešni bremenitvi se napitnine ne zmanjšuje z novim neuradnim plačilom.
V poročilih je napitnina ločen podatek, zato mora biti evidentirana pravilno.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-6b135892121a package=lite -->
## 16. Terminalski ponudniki in varna obnovitev

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-6a5b31150607 package=lite -->
### 16.1 Izbrani terminal

Aktivni terminal določa konfiguracija in prednostna veriga naprave.
Strojni Payten TCP ima lahko prednost pred drugimi nastavitvami.
Payten Android se uporablja, kadar je za napravo aktiven ustrezen tok.
Viva Cloud oziroma Viva terminal uporablja svoj potrditveni tok.
Viva Android terminal in Viva Tap to Pay se vrneta v POS prek povratne povezave.
SumUp lahko uporablja terminal ali QR potek glede na konfiguracijo.
Simulacija ni produkcijski dokaz plačila.
Blagajnik uporablja ponudnika, ki ga POS ponudi; ne izbira ga po videzu terminala.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-612513da81ae package=lite -->
### 16.2 Idempotentni poskus

Kartični poskus ima identifikator plačilnega poskusa.
Ta identifikator veže ponudnika, naročilo in znesek.
Enak poskus se ob obnovitvi preverja, ne ustvarja kot novo plačilo.
Ne osvežujte strani z namenom, da bi dobili nov poskus za isti znesek.
Ne zaganjajte drugega terminala za isti znesek, dokler prvi ni znan.
Če POS pokaže obnovljiv poskus, preverite isti ponudnik, naročilo in znesek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-be7f5e8eb10e package=lite -->
### 16.3 Neznan rezultat: odločitev

Terminal lahko kaže plačano, POS pa čaka na odgovor.
POS lahko kaže napako, terminal pa nima jasnega zaključka.
Oba primera sta `neznano`, dokler se ne preveri status.
Najprej ustavite ponavljanje klikov.
Nato zabeležite čas, znesek, ponudnika in vidno referenco.
Preverite zgodovino terminala oziroma statusni zahtevek v POS.
Če odgovor potrdi plačilo, uporabite obnovitev istega poskusa.
Če odgovor potrdi zavrnitev, šele nato začnite nov poskus.
Če odgovora ni, predajte primer podpori brez druge bremenitve.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-280e369c637c package=extended -->
### 16.4 Primer SumUp QR

Gost skenira QR in zaključi plačilo na svojem telefonu.
POS čaka na status zaključka.
Ne ustvarite kartičnega poskusa na drugem terminalu.
Če status ostane neznan, preverite isti `checkoutId` oziroma prikazan poskus.
Šele potrjeni status omogoča izdajo računa.
Neuspešen oziroma potekel QR se obravnava kot zavrnitev šele po jasnem statusu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-e7568c666517 package=lite -->
### 16.5 Primer Viva povratne povezave

POS zažene Viva Android ali Tap to Pay in čaka na povratek.
Uporabnik se po plačilu vrne v isti tok POS.
Povratni podatek mora pripadati istemu naročilu.
Če se aplikacija zapre, ponovno odprite plačilo in preverite obnovljiv poskus.
Ne začnite nove prodaje, dokler ni preverjeno stanje prejšnjega.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-601cddb4544f package=lite -->
### 16.6 Incidentni obrazec za terminal

Zapišite številko naročila.
Zapišite točen znesek.
Zapišite ponudnika terminala.
Zapišite čas začetka in čas vidnega rezultata.
Zapišite referenco oziroma `paymentAttemptId`, če je prikazan.
Zapišite, kaj kaže terminal in kaj kaže POS.
Ne zapisujte PIN-a, celotne številke kartice ali občutljivih podatkov gosta.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-63dc9e9d65dc package=lite -->
## 17. Delo brez povezave

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-9d16fb13e06e package=lite -->
### 17.1 Kaj pomeni omejeni režim

Offline režim ni splošno dovoljenje za običajno prodajo brez nadzora.
Na voljo je samo napravi in postopku, ki ga sistem izrecno označi.
Lokalno ustvarjen zapis se mora po povezavi sinhronizirati in fiskalno obdelati.
Uporabnik ne spremeni načina plačila zato, da bi premagal varnostno blokado.
Če POS blokira gotovino offline, je ta omejitev obvezna.
Če terminal nima povezave, kartica ni samodejno dovoljena offline.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c39d1ff2989f package=lite -->
### 17.2 Pred odločitvijo

Preverite, ali je izgubljena povezava POS, terminala ali obeh.
Preverite prikazano opozorilo in dovoljene možnosti.
Povejte gostu, da je potreben dovoljen alternativni postopek.
Ne ustvarite ročnega računa zunaj sistema kot nadomestek brez navodila odgovorne osebe.
Vodji posredujte število prizadetih naročil in čas začetka izpada.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-89acf2d042d1 package=lite -->
### 17.3 Po vrnitvi povezave

Ne izdajajte istih računov drugič.
Preverite čakalno vrsto oziroma stanje sinhronizacije.
Preverite, kateri računi nimajo EOR ali imajo status napake.
Uporabite FURS retry samo za obstoječe račune.
Primerjajte število offline računov z dejanskim seznamom naročil.
Eskalirajte vsak zapis, ki ostane v negotovem stanju.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-19068038910a package=lite -->
## 18. FURS: podatki, stanja in ponovni poskus

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-48bf171c4c6d package=lite -->
### 18.1 Kaj sistem hrani

Račun ima lastno številko in čas izdaje.
ZOI je zaščitna oznaka izdajatelja za konkretni račun.
EOR je oznaka, ki jo vrne FURS po uspešni potrditvi.
Status FURS pove, ali je pošiljanje potrjeno, v teku ali neuspešno.
FURS odgovor je povezan z obstoječim računom, ne z novim klikom izdaje.
Certifikat podjetja mora biti veljaven za produkcijsko fiskalizacijo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-29af314630eb package=lite -->
### 18.2 Interpretacija stanj

`potrjeno` pomeni, da je račun prejel EOR.
`sending` pomeni, da se zahtevek obdeluje in se ne ponavlja ročno.
`napaka` pomeni, da je treba preveriti razlog in postopek retry.
Manjkajoč EOR na nestorniranem produkcijskem računu zahteva pregled.
`storniran` ni kandidat za splošni opozorilni seznam manjkajočega EOR na enak način kot aktiven račun.
`testni` se obravnava skladno s testnim režimom in ni dokaz produkcijske registracije.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-fbc302f8b031 package=lite -->
### 18.3 FURS retry

Retry začnite po vrnitvi povezave ali po odpravi potrjenega vzroka.
Pred retry zapišite seznam številk računov, ki so prizadete.
Uporabite dejanje **FURS retry**, kadar je na voljo.
Sistem ponovno pošlje obstoječi fiskalni zapis.
Po zaključku preverite število uspešnih in neuspešnih računov.
Za vsak uspešen primer preverite EOR oziroma odstranitev oznake napake.
Za neuspešen primer shranite sporočilo in ga posredujte odgovorni osebi.
Ne izdajajte nadomestnega računa, ker retry še traja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1e39631c205c package=lite -->
### 18.4 Certifikat

Opozorilo o poteku certifikata se obravnava pred dejanskim potekom.
Skrbnik pripravi in naloži nov certifikat po odobrenem varnostnem postopku.
Blagajnik ne deli certifikata, ključa ali gesla prek klepeta.
Po menjavi odgovorna oseba preveri veljavnost in produkcijsko nastavitev.
Če certifikat manjka, se izpad eskalira pred nadaljnjimi izdajami.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-214fc7d79cf1 package=lite -->
### 18.5 FURS vaja

Račun št. 184/2025 je izdan, vendar nima EOR in prikazuje napako.
Ali izdate nov račun?
Pravilni odgovor: ne.
Katere podatke zapišete?
Pravilni odgovor: številko, čas, sporočilo napake in stanje.
Kaj naredite ob vrnitvi povezave?
Pravilni odgovor: retry obstoječega računa in pregled rezultata.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-27b96306b76c package=lite -->
## 19. Tisk, elektronska predaja in BizBox

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a7b07222c283 package=lite -->
### 19.1 Tiskalni tok

Tisk se izvede šele, ko obstaja uspešno izdan račun.
Lokalni tiskalniški most mora biti dosegljiv za lokalni tisk.
Pred prvim tiskom preverite izbran fizični tiskalnik.
Papir, pokrov, napajanje in povezava so ločene fizične kontrole.
Ne klikajte plačila znova, kadar je težava samo tisk.
Ne uporabljajte tiskovne napake kot razloga za storno.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a11d4339ec96 package=lite -->
### 19.2 Ponatis

Ponatis se začne v evidenci obstoječih računov.
Iščite po številki računa, času, znesku ali drugem dovoljenem kriteriju.
Pred klikom primerjajte poslovno enoto in znesek.
Ponatis ima isti vsebinski račun; ne ustvarja nove prodaje.
Če tiskalnik natisne več kopij, to ni več računov.
Priročnik enote določa, kako se kopija označi oziroma preda gostu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d46fe0cd5c00 package=lite -->
### 19.3 E-račun in BizBox

E-račun je elektronska predaja dokumenta po konfiguriranem poslovnem toku.
BizBox uporabite samo, kadar je partner in kanal ustrezno nastavljen.
Pred pošiljanjem preverite prejemnika, identifikator partnerja in dokument.
Ne pošiljajte e-računa na podlagi podobnega imena prejemnika.
Status oddaje ni isto kot dokaz prejema ali plačila, razen če integracija izrecno tako določa.
Napako e-računa dokumentirajte z ID dokumenta, časom in sporočilom.
Tisk gostove kopije in pošiljanje e-računa sta ločena postopka.
Fiskalni račun se ne izdaja ponovno zato, ker BizBox predaja odpove.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c2dce1ec39e2 package=lite -->
## 20. Storno, vračilo in kartično povračilo

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0e124cbdd0e6 package=lite -->
### 20.1 Izbira pravilnega postopka

Odprto, še neizdano naročilo popravite po postopku naročila.
Izdani račun popravljate samo s sledljivim stornom oziroma vračilom.
Celotni storno zajame ves prvotni dokument.
POS ne podpira delnega storna po izbranih postavkah ali količinah.
Če je popravek le dela vsebine, se stornira celotni izvirni račun in se po
stornu ustvari novo naročilo z dejansko pravilno vsebino ter izda nov račun.
Vračilo denarja mora imeti odobritev, razlog in sled do izvirnega računa.
Storno ne izbriše zgodovine izvirnega računa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-eb1e8e8a90cb package=lite -->
### 20.2 Primer popravka ene postavke

Gost vrne eno pijačo z računa, ki vsebuje tri pijače.
Poiščite izvirni račun.
Ne iščite izbire ene pijače ali količine ena: taka funkcija ni podprta.
Stornirajte celoten izvirni račun po odobrenem postopku.
Vnesite dejanski razlog vračila.
Potrdite dokument in preverite povezavo z izvirnikom.
Za promet, ki po popravku ostane veljaven, ustvarite novo naročilo z dvema
pravilnima pijačama in ga zaključite kot nov račun.
Vračilo plačila izvedite samo z dovoljenim plačilnim postopkom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-db8431ff9692 package=lite -->
### 20.3 Kartično vračilo

Za kartični račun, pri katerem POS prikaže voden tok za vračilo Viva, sta
terminalsko vračilo in fiskalni storno ločena koraka:

1. Odprite izvirni račun v **Računih** in preverite znesek, plačilo ter
   referenco izvirne transakcije.
2. Zaženite vračilo v prikazanem toku in počakajte na končni status terminala.
3. Fiskalni storno izvedite šele, ko je terminalsko vračilo potrjeno kot
   **plačano**; nato preverite povezavo storna z izvirnim računom.
4. Če vračilo ostane **v čakanju**, počakajte na status. Če je izid
   **neznan**, postopek ustavite in naj odgovorna oseba ročno preveri terminal
   oziroma ponudnika. Vračila ne ponavljajte in fiskalnega storna še ne izvedite.
5. Preverite zgodovino vračil. Če kartični račun ni v tem toku Viva, uporabite
   samo postopek, ki ga POS dejansko ponudi za ta način plačila.

Ne sprožite nove prodaje z negativnim zneskom kot neuradno rešitev; fiskalni
storno ne nadomesti povračila pri ponudniku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-63410587c4ff package=lite -->
## 21. Povezava s poročili brez zaključevanja izmene

Plačilne vrste se v realizaciji prikazujejo po načinu, na primer gotovina, kartica, TRR in bon.
Napitnina se vodi ločeno, kadar jo poročilo podpira.
Darilni bon in bon za pico sta lahko ločeni kategoriji.
Storno je v evidenci označen in povezan z izvirnikom.
X in Z poročila ter fizično zapiranje izmene so obravnavani v sklopu 08.
V tem sklopu preverjamo le, da je posamezni račun pravilno izdan in sledljiv.
Ne uporabljajte dnevnega poročila kot zamenjavo za takojšnje razreševanje neznanega terminalskega stanja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-82f3e850afd4 package=lite -->
## 22. Incidentne vaje in preverjanje znanja

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5df438e95caf package=lite -->
### 22.1 Dvojni klik kartice

Gost je kartico prislonil, povezava POS se prekine, uporabnik pa želi znova klikniti.
Pravilno dejanje je ustaviti nov poskus.
Preverite terminal, znesek, čas in referenco.
Uporabite obnovitev istega poskusa, kadar je na voljo.
Nov poskus začnite samo po jasni zavrnitvi.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-601c5155d4c5 package=lite -->
### 22.2 Papirja ni

Račun je uspešno izdan, tiskalnik pa nima papirja.
Pravilno dejanje je odpraviti papir in narediti ponatis.
Napačno dejanje je znova zaračunati gostu.
Napačno dejanje je storno samo zaradi manjkajočega izpisa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a2746b1f22a8 package=lite -->
### 22.3 Mešano plačilo

Račun je 60,00 EUR.
Prikazana skupna odprta evidenca bonov omogoča pokritje 25,00 EUR, gost pa
uporabi kartico za preostanek.
Kolikšen je kartični znesek?
Pravilni odgovor: 35,00 EUR, če je bon veljaven in unovčen.
Kaj preverite pred izdajo?
Pravilni odgovor: obe potrjeni vrstici in preostanek 0,00 EUR.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-35c75d535a32 package=lite -->
### 22.4 FURS izpad

FURS retry pokaže dva uspešna in en neuspešen račun.
Kaj preverite pri uspešnih?
Pravilni odgovor: EOR oziroma status potrditve.
Kaj naredite pri neuspešnem?
Pravilni odgovor: zabeležite napako in eskalirate obstoječi račun.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-77b71e7317bf package=lite -->
### 22.5 Zaključni kontrolni seznam

- [ ] Naročilo in znesek sta potrjena z gostom.
- [ ] Izbrani način ustreza dejanskemu prejemu.
- [ ] Vsak terminalski poskus ima znano stanje.
- [ ] Delitve ne podvajajo postavk ali popustov.
- [ ] Napitnina je potrjena z gostom.
- [ ] Bon, subvencija, TRR ali odloženo plačilo so uporabljeni samo ob omogočenem toku.
- [ ] Račun je izdan enkrat.
- [ ] FURS status je pregledan in morebitna napaka ima sled.
- [ ] Tiskovna napaka je rešena s ponatisom.
- [ ] Storno je povezan z izvirnim računom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-e6213e988da1 package=lite -->
## 23. Zaslonske kontrole po korakih

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-09f97c6adc4e package=lite -->
### 23.1 Glava računa

Preverite poslovno enoto pred vsakim zaključkom.
Preverite blagajno, kadar je prikazana.
Preverite številko naročila pred izbiro plačila.
Preverite mizo, prevzem ali dostavo.
Preverite, ali je naročilo še odprto.
Preverite, da ne urejate druge kartice gosta.
Ne menjajte naročila med terminalskim poskusom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c4d6f3cc8297 package=lite -->
### 23.2 Seznam postavk

Vsaka vrstica vsebuje artikel in količino.
Cena vrstice mora ustrezati potrjenemu naročilu.
Popust preverite pred plačilom.
Spremembo artikla opravite pred zagonom terminala.
Postavka brez priprave ni razlog za spremembo plačila.
Ne uporabljajte plačilnega zaslona za popravljanje alergenske opombe.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-67c5074810ff package=lite -->
### 23.3 Območje zneskov

Skupaj je celotni bruto znesek.
Plačano je vsota potrjenih plačilnih vrstic.
Preostanek je razlika med skupaj in plačano.
Vračilo je razlika prejete gotovine in gotovinskega dela.
Napitnina se preveri ločeno od osnovnega računa.
Negativen preostanek je opozorilo za pregled, ne razlog za izdajo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-54ffbbca7058 package=lite -->
### 23.4 Gumbi in njihove meje

Gumb gotovina ne potrdi prejetega denarja samodejno.
Gumb kartica začne ponudnikov tok.
Gumb delitev ne razporedi artiklov brez uporabnikove izbire.
Gumb izdaja ustvari račun samo po veljavnih plačilih.
Gumb ponatis ne ustvarja računa.
Gumb FURS retry ne spreminja vsebine računa.
Gumb storno ne izbriše izvirnika.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-75d6e592abdd package=lite -->
## 24. Plačilne kombinacije: primeri odločanja

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-64ca1bfaa6cc package=lite -->
### 24.1 Gotovina in kartica

Račun 12,40 EUR.
Gost da 10,00 EUR gotovine.
Preostanek je 2,40 EUR.
Kartico obremenite za 2,40 EUR.
Ne vnesite 12,40 EUR na terminal.
Račun mora prikazati oba načina.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-066835da618a package=extended -->
### 24.2 Kartica in stari bon iz skupne evidence

Račun 50,00 EUR.
Prikazana skupna evidenca starih bonov omogoča kritje 18,00 EUR.
Kartica pokriva 32,00 EUR.
Na plačilnem zaslonu izberite **Stari boni (skupna evidenca)** in preverite
odprto vrednost; po potrditvi te vrstice zaženite kartico za preostanek.
Tega primera ne uporabite za **Spletni bon s kodo**: individualni spletni bon
se ne sme združiti s kartičnim doplačilom. Zanj glejte razdelek 46.2.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d4d245a47797 package=lite -->
### 24.3 Subvencija in gotovina

Obrok znaša 9,50 EUR.
Sistem potrdi subvencijo 4,00 EUR.
Gost plača 5,50 EUR gotovine.
Potrdite subvencijo po njenem toku.
Preštejte gotovinski del.
Preverite ločeni vrstici pred izdajo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-9c58d6ea6319 package=lite -->
### 24.4 TRR in kartica

TRR se uporablja samo ob dovoljenem poslovnem dogovoru.
Če TRR pokrije 100,00 EUR od 130,00 EUR, kartica pokrije 30,00 EUR.
Vnesite zahtevano referenco TRR.
Ne zamenjajte nedokazanega nakazila s potrjenim plačilom.
Kartico začnite samo za preostanek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-03cfc93c56d5 package=lite -->
### 24.5 Odloženo in nič drugega

Odloženo plačilo lahko zapre račun le, če je način omogočen.
Preverite partnerja oziroma nosilca obveznosti.
Preverite pooblastilo uporabnika.
Zapišite zahtevano referenco.
Ne dodajajte gotovinske vrstice, če gotovine ni bilo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4d88809fb593 package=extended -->
### 24.6 Bon in vračilo

Bon ne daje samodejne pravice do gotovinskega vračila.
Pri vračilu poiščite izvirni dokument.
Preverite uporabljeni način plačila.
Uporabite odobren postopek vračila za bon.
Ne ustvarite novega bona brez sledljive povezave, če tega tok ne predvideva.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-65240e158fd9 package=lite -->
### 24.7 Napitnina pri delitvi

Dve osebi delita račun 40,00 EUR.
Prva plača kartico 20,00 EUR brez napitnine.
Druga plača kartico 23,00 EUR.
Napitnina druge osebe je 3,00 EUR.
Ne porazdelite napitnine samodejno na obe kartici.
Pred potrditvijo ponovite oba zneska.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-84c2c3d092ac package=lite -->
## 25. Matrika terminalskih stanj

| Ponudnik/tok | Začetek | Potrjeno | Neznano | Naslednje dejanje |
| --- | --- | --- | --- | --- |
| Payten TCP | POS pošlje znesek | odgovor terminala | prekinjen odgovor | preveri isti poskus |
| Payten Android | zunanji Android tok | potrjen povratek | aplikacija se ne vrne | odpri obnovitev |
| Viva Cloud | zahtevek terminalu | plačan status | čakanje ali časovna omejitev | preveri status |
| Viva Android | intent in povratna povezava | veljaven callback | povratek manjka | ne začni nove prodaje |
| Viva Tap to Pay | SoftPOS tok | uspešen callback | aplikacija prekinjena | preveri isti identifikator |
| SumUp terminal | plačilni poskus | completed | recovery required | preveri `paymentAttemptId` |
| SumUp QR | checkout QR | completed | pending/unknown | preveri `checkoutId` |

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-de9d183444c8 package=lite -->
### 25.1 Skupna pravila matrike

`completed` pomeni, da je lahko plačilo potrjeno v POS.
`pending` pomeni, da uporabnik čaka ali preveri status istega poskusa.
`failed` pomeni zavrnitev samo, kadar jo ponudnik jasno vrne.
`unknown` zahteva uskladitev in prepoved nove bremenitve.
`recovery required` je navodilo za obnovitev, ne za ponovni klik plačila.
Referenca ponudnika se primerja z naročilom in zneskom.
Različen znesek pomeni, da se poskus ne pripiše samodejno.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-37c9d6a536aa package=lite -->
### 25.2 Payten Android

Pred zagonom preverite, da je Android terminal pravi za enoto.
POS začne plačilni tok z izbranim zneskom.
Gost plača na terminalu.
POS pričakuje potrditveni povratek.
Če povratka ni, ne predpostavite zavrnitve.
Preverite potrditveni tok istega plačila.
Šele nato nadaljujte z izdajo ali z novim načinom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-691ece9e2546 package=lite -->
### 25.3 Viva Cloud in Smart terminal

Viva zahtevek pripada istemu naročilu.
Znesek na napravi mora biti enak znesku POS.
Če stanje ostane PENDING, počakajte oziroma preverite status.
Če stanje postane PAID, POS nadaljuje z izdajo.
Če stanje postane FAILED, račun ni plačan s to vrstico.
Časovna omejitev ne pomeni samodejne zavrnitve brez statusa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-964472ee5182 package=lite -->
### 25.4 SumUp

SumUp plačilo ima poskus in checkout.
POS hrani poskus za obnovitev istega naročila in zneska.
Če POS javi neznano stanje, ne ustvarite drugega poskusa.
Če je serial nastavljen, se uporabi terminalski potek.
Brez seriala je lahko prikazan QR checkout.
Gostovo plačilo QR počaka na potrjen status.
Račun se ne izda, dokler status ni dokončen.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-75b740525d9f package=lite -->
## 26. Časovnice napak in obnovitev

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-ba5c4a493f1a package=lite -->
### 26.1 Izgubljen odgovor terminala

10:02 POS začne kartico za 24,90 EUR.
10:02 terminal pokaže odobreno.
10:03 POS pokaže napako povezave.
10:03 blagajnik ne klikne kartice drugič.
10:04 blagajnik zabeleži znesek in referenco.
10:04 blagajnik preveri terminalski status.
10:05 POS obnovi isti uspešni poskus.
10:05 račun se izda enkrat.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-ff48d496bc2b package=lite -->
### 26.2 FURS po izdaji

10:10 račun nastane po uspešnem plačilu.
10:10 ZOI je del fiskalnega zapisa.
10:10 pošiljanje FURS se začne.
10:11 povezava FURS odpove.
10:11 račun ostane obstoječi račun z oznako napake.
10:30 povezava se vrne.
10:31 odgovorna oseba zažene retry.
10:31 FURS vrne EOR za isti račun.
10:32 osebje preveri EOR in status.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a5746797b525 package=lite -->
### 26.3 Napačen retry

Blagajnik vidi manjkajoč EOR.
Blagajnik ustvari nov račun iste vsebine.
To je napačno, ker lahko podvoji prodajo.
Pravilno je poiskati izvirni račun.
Pravilno je preveriti njegov fiskalni status.
Pravilno je uporabiti retry obstoječega zapisa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8226a793610c package=lite -->
### 26.4 Offline časovnica

11:00 naprava pokaže omejen offline režim.
11:01 blagajnik prebere dovoljene načine.
11:02 sistem blokira nedovoljeni gotovinski tok.
11:03 blagajnik ne izbere lažnega TRR načina.
11:20 povezava se vrne.
11:21 blagajnik pregleda sinhronizacijo.
11:22 odgovorna oseba pregleda račune brez EOR.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f31eca768147 package=lite -->
## 27. Račun: vsebina in predaja

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-2a9bc681a1c6 package=lite -->
### 27.1 Kontrola pred predajo

Preverite številko računa.
Preverite datum in čas.
Preverite skupni znesek.
Preverite načine in zneske plačila.
Preverite ZOI in EOR skladno z režimom.
Preverite oznako storna, kadar gre za storno dokument.
Preverite, da gost dobi pravi izvod.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-82d768c2a40f package=lite -->
### 27.2 Račun za prevzem

Račun priložite pravemu paketu.
Številko računa ne zamenjajte z oznako To Go.
Gostu povejte, kje prevzame paket.
Tiskovna težava ne zadrži statusa plačila.
Ponatis poiščite po obstoječem računu.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-7662faddcdd5 package=extended -->
### 27.3 Račun za dostavo

Račun se priloži paketu ali preda po nastavljenem načinu.
Kurir preveri, da račun pripada naročilu.
Kurir ne zamenjuje fiskalnega računa s svojim dostavnim seznamom.
Če gost zahteva kopijo, se uporabi dovoljen ponatis ali elektronski tok.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1534d3e09688 package=lite -->
### 27.4 Elektronska predaja

Prejemnik e-računa mora biti pravilno določen.
BizBox kanal se uporabi samo pri nastavljeni integraciji.
Preverite partnerjev identifikator pred pošiljanjem.
Ne izmišljajte e-naslova ali identifikatorja partnerja.
Napaka predaje ne spremeni že izdanega računa.
Napako eskalirajte z ID dokumenta in časom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-648d9bdd1128 package=lite -->
## 28. Vloge pri plačilu in reklamaciji

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8660a7950bfc package=lite -->
### 28.1 Blagajnik

Blagajnik potrdi znesek in dejanski način.
Blagajnik varuje gosta pred dvojno bremenitvijo.
Blagajnik ne razkriva občutljivih kartičnih podatkov.
Blagajnik evidentira incidentne podatke.
Blagajnik eskalira negotova stanja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-3c7070d7d4c5 package=lite -->
### 28.2 Vodja izmene

Vodja odobri postopke, ki zahtevajo pravico.
Vodja uskladi terminal, tisk in FURS incident.
Vodja preveri, da se ne izda nadomestni podvojeni račun.
Vodja presodi upravičenost storna in vračila.
Vodja preda odprte incidente naslednji odgovorni osebi.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-fdf033a209d7 package=lite -->
### 28.3 Kurir oziroma natakar

Kurir ne potrjuje plačila, ki ga ni videl.
Natakar ne spreminja računa med kartičnim tokom.
Oseba na izdaji priloži pravi račun pravemu paketu.
Vsak član ekipe takoj sporoči izgubljeno potrdilo ali dvojni tisk.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0d538dede327 package=lite -->
## 29. Trenerjevi skripti in ocenjevanje

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-6a017bc4f9ad package=lite -->
### 29.1 Skript: neznana kartica

Trener reče: »Terminal kaže uspeh, POS pa čaka.«
Udeleženec mora ustaviti ponovni klik.
Udeleženec mora navesti znesek, čas in referenco.
Udeleženec mora izbrati obnovitev istega poskusa.
Trener oceni kot neuspeh vsak nov kartični poskus pred preverjanjem.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d3039d9065e4 package=lite -->
### 29.2 Skript: deljeni račun

Trener pripravi račun 76,00 EUR.
Prvi gost uporabi bon 20,00 EUR.
Drugi gost uporabi kartico 30,00 EUR.
Tretji gost da 26,00 EUR gotovine.
Udeleženec mora pravilno izračunati vsak preostanek.
Udeleženec mora pred izdajo pokazati preostanek 0,00 EUR.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-ef07bce04eae package=lite -->
### 29.3 Skript: ponatis

Trener odstrani papir po uspešni izdaji.
Udeleženec ne sme znova zaračunati.
Udeleženec preveri tiskalnik.
Udeleženec poišče izvirni račun.
Udeleženec izvede ponatis.
Udeleženec razloži, zakaj ponatis ni nov račun.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4957abc1c162 package=lite -->
### 29.4 Skript: popravek že izdanega računa

Trener pokaže račun s tremi artikli.
Gost vrača en artikel.
Udeleženec pove, da POS ne omogoča izbire ene vrstice ali količine za storno.
Udeleženec izbere storno celotnega izvirnega računa in navede razlog.
Udeleženec preveri povezavo z izvirnikom.
Udeleženec navede, da se nato ustvari novo naročilo s pravilno vsebino in da
se plačilno vračilo izvede le po dovoljenem toku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-228da9f92819 package=lite -->
### 29.5 Odgovorna navodila za ocenjevanje

Pravilen odgovor vedno začne z identifikacijo izvirnega naročila ali računa.
Pravilen odgovor pri neznanem stanju vedno prepove novo bremenitev.
Pravilen odgovor pri FURS vedno ohrani isti račun.
Pravilen odgovor pri tisku vedno uporabi ponatis.
Pravilen odgovor pri storno vedno ohrani sled do izvirnika.
Pravilen odgovor pri offline vedno upošteva vidne omejitve POS.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-fad0b39e72cd package=lite -->
## 30. Redki, vendar pomembni plačilni primeri

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f0bbc60b8ba0 package=lite -->
### 30.1 Že delno plačano naročilo

Odprite isto naročilo, ne novega naročila.
Preglejte potrjene plačilne vrstice.
Preverite njihov znesek, način in referenco.
Izračunajte preostanek iz prikaza POS.
Ne ponovite že potrjene kartične vrstice.
Dodajte le dovoljeni način za preostanek.
Račun izdate šele, ko preostanek doseže nič.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d9ce9d722075 package=lite -->
### 30.2 Kartica uspe, izdaja pa odpove

Kartično plačilo je lahko uspešno, čeprav izdaja računa še ni zaključena.
Ne bremenite gosta drugič.
Ohranite isti `paymentAttemptId`.
Preverite, ali POS ponuja dokončanje iste izdaje.
Zapišite naročilo, znesek, ponudnika in čas.
Če račun obstaja, preverite FURS in tisk ločeno.
Če račun ne obstaja, eskalirajte z dokazom uspešne bremenitve.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-58f322fb1e77 package=lite -->
### 30.3 Preklop terminala

Terminala ne menjajte med aktivnim poskusom.
Najprej razrešite stanje prvega ponudnika.
Če prvi ponudnik jasno vrne zavrnitev, lahko izberete drugi dovoljeni tok.
Novi ponudnik začne nov poskus samo za neplačani znesek.
V evidenci incidenta navedite oba ponudnika in razlog preklopa.
Ne razlagajte novega terminala kot avtomatičen dokaz prve zavrnitve.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-496ff58320fe package=lite -->
### 30.4 Pozen callback ponudnika

Povratni klic se lahko vrne po ponovnem odprtju POS.
Callback mora pripadati istemu naročilu.
Callback mora pripadati istemu poskusu oziroma znesku.
Ne pripišite poznega uspeha drugemu naročilu z enakim zneskom.
Če je bil račun medtem pravilno razrešen, vodja pregleda morebitno neskladje.
Uporabnik ne izvaja ročnega dvojnega knjiženja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8206229dcc31 package=lite -->
### 30.5 Delno plačilo in storno

Pred stornom preverite vse uporabljene načine plačila.
Tudi če je bila napaka le v delu računa, storno v POS razveljavi celoten račun.
Vodja določi dovoljeni tok vračila skladno s politiko in ponudnikom.
Vračilo ohrani povezavo z izvirnim računom in razlogom.
Če mora del prometa ostati prodan, se po celotnem storno izda nov pravilen
račun za dejansko pravilno vsebino.
Ne izplačajte gotovine iz navade, če je bil promet kartični ali bon.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-206fec9d4304 package=lite -->
## 31. Fiskalna čakalna vrsta in administrativne meje

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-116cc9ffe69d package=lite -->
### 31.1 Kaj osebje sme narediti

Blagajnik prebere status računa.
Blagajnik zapiše številko, čas in vidno napako.
Blagajnik uporabi ponovni poskus, kadar je dovoljen v uporabniškem vmesniku.
Blagajnik preveri, ali je EOR prispel.
Blagajnik ne ureja certifikatnega ključa.
Blagajnik ne spreminja surovega odgovora FURS.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-577f4992d1d9 package=lite -->
### 31.2 Kaj opravi skrbnik

Skrbnik preveri veljavnost certifikata.
Skrbnik preveri konfiguracijo fiskalizacije.
Skrbnik pregleda tehnično napako in surov odgovor po pravicah.
Skrbnik ne spreminja izvirnega računa, da bi popravil odgovor FURS.
Skrbnik eskalira nejasne odzive s celotno sledjo dokumenta.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-2512ae7034e1 package=lite -->
### 31.3 Dokazi v offline vrsti

Offline zapis ima identiteto računa.
Offline zapis hrani ZOI in fiskalno stanje.
Ponovitev uporablja isti nespremenljivi fiskalni zapis.
Uspešen odziv doda EOR.
Neuspešen odziv ohrani razlog za pregled.
Ponovitev ni nova prodaja.
Ročno brisanje zapisa ni operativni postopek blagajnika.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0b821410fca1 package=lite -->
### 31.4 Stanja odziva FURS

| Stanje | Pomen za blagajnika | Dovoljeno dejanje |
| --- | --- | --- |
| sending | pošiljanje še teče | počakaj in ne izdaj ponovno |
| confirmed/EOR | FURS je potrdil račun | preveri identifikator |
| napaka | prenos ni potrjen | zapiši in retry po postopku |
| replay | obstoječi poskus se ponovi | ne ustvarjaj novega računa |
| storniran | dokument je sledljivo razveljavljen | preveri povezavo z izvirnikom |

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-e3bb94f89d66 package=lite -->
## 32. Tiskalni most in kopije

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a49c0fe624df package=lite -->
### 32.1 Most odpove po izdaji

Račun lahko obstaja, če lokalni tiskalniški most ni dosegljiv.
Najprej preverite status izdaje na POS.
Nato preverite napajanje in povezavo tiskalnika.
Nato preverite lokalni most po navodilu podpore.
Ko je fizična napaka odpravljena, izberite ponatis.
Ne ustvarite novega računa.
Ne izvajajte storna samo zaradi izpisa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-316bb8b6fae8 package=lite -->
### 32.2 Več natisnjenih kopij

Več fizičnih kopij ne pomeni več fiskalnih računov.
Vsaka kopija mora biti obravnavana skladno s politiko enote.
Gostu predajte pravo kopijo.
Ne mešajte kopije druge mize z računom prve mize.
Če je kopija napačnega računa izpostavljena, ravnajte po postopku varstva podatkov.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-910a640b56ea package=lite -->
### 32.3 Nepravilen tiskalnik

Preverite ime tiskalnika pred tiskom.
Če račun odide na kuhinjski tiskalnik, račun ni neizdan.
Poiščite isti račun v evidenci.
Natisnite dovoljeno kopijo na pravi napravi.
Vodji sporočite konfiguracijsko napako po konici.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-78f36e02e6cb package=lite -->
## 33. BizBox in e-račun: primeri

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4badd98332dc package=lite -->
### 33.1 Pravilna priprava

Partner je izbran po potrjenem identifikatorju.
Dokument je pravilen izvirni račun oziroma dovoljen dokument.
BizBox kanal je omogočen za partnerja.
Prejemnik in reference so pregledani pred oddajo.
Osebje zabeleži uspeh ali napako predaje.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f793f3aef8fa package=lite -->
### 33.2 Napačen partner

Ime partnerja je podobno, identifikator pa se ne ujema.
Ne pošiljajte dokumenta.
Preverite identifikator pri odgovorni osebi.
Ne popravljajte izdanega računa s spreminjanjem prejemnika brez dovoljenega postopka.
Če je dokument že poslan napačnemu kanalu, takoj eskalirajte z ID dokumenta.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-108995300b5a package=lite -->
### 33.3 BizBox ni dosegljiv

Fiskalni račun ostane obstoječ dokument.
Napaka BizBox ni FURS napaka.
Ne pošiljajte novega fiskalnega računa.
Zapišite kanal, čas in sporočilo.
Ponovite elektronsko predajo samo po dovoljenem integracijskem postopku.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-13c4a57fab41 package=lite -->
## 34. Primeri storna in vračila

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5bd18924fadd package=lite -->
### 34.1 Celotni storno

Gostu je bil izdan napačen celoten račun.
Poiščite izvirni račun po številki.
Preverite, da račun res pripada dogodku.
Izberite celotni storno.
Vnesite dejanski razlog.
Preverite nov sledljiv dokument.
Preverite fiskalni status storna.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5d1c8b8c08f7 package=lite -->
### 34.2 Popravek računa, kjer je napačna ena količina

Izvirnik vsebuje tri enake sladice.
Gost vrne eno sladico.
POS nima delnega storna količine ena.
Izberite storno celotnega izvirnega računa, torej vseh treh sladic.
Preverite, da povezava kaže na izvirnik.
Nato odprite novo naročilo z dvema pravilnima sladicama in ga po potrebi
zaključite z novim računom.
Vračilo izvede pooblaščena oseba z dovoljenim načinom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-85b64aa6e91f package=lite -->
### 34.3 Reklamacija po kartici

Najprej preverite izvirno kartično plačilo.
Nato preverite, ali je potreben storno računa, vračilo ali oba postopka.
Ne dajajte gotovine, če pravila zahtevajo kartično povračilo.
Pri neznanem rezultatu povračila ne poženite drugega povračila.
Zapišite referenco prvotne bremenitve in povračila.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f24b5df44d9f package=lite -->
## 35. Ocenjena zaključna vaja plačila

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-cdf772731727 package=lite -->
### Primer

Naročilo znaša 84,00 EUR.
Gost uporabi subvencijo 4,00 EUR, bon 20,00 EUR in kartico za preostanek.
Terminal pokaže uspeh za kartico, POS pa izgubi povezavo.
Po obnovitvi je račun izdan, tiskalnik pa je brez papirja.
FURS odgovor je začasno v stanju napaka.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-973ed417cbbd package=lite -->
### Pričakovani odgovori

Preostanek po subvenciji in bonu je 60,00 EUR.
Kartični poskus se ne ponovi brez preveritve istega poskusa.
Po uspešni obnovitvi račun ostane en sam.
Papir se odpravi in uporabi ponatis.
Za FURS se zapiše račun in napaka.
Po vrnitvi povezave se uporabi retry obstoječega računa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-922ef26c0c34 package=lite -->
### Točkovanje

2 točki za pravilni izračun 60,00 EUR.
2 točki za prepoved nove kartične bremenitve.
2 točki za pravilen ponatis.
2 točki za ohranitev istega računa pri FURS.
2 točki za razlikovanje BizBox, tisk in FURS incidenta.
Uspeh je najmanj 8 od 10 točk.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5aa53c062832 package=lite -->
## 36. Paketi študij primerov za zaključek prodaje

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-ea127e91749e package=standard -->
### 36.1 Miza z delitvijo po artiklih

Miza naroči dve glavni jedi in skupno steklenico vode.
Gostova najprej določita, katere postavke pripadajo komu.
Skupna voda se razdeli samo po dogovorjenem dovoljenem postopku.
Prvi račun se plača z gotovino.
Drugi račun se plača s kartico.
Blagajnik preveri, da popust ni dvakrat uporabljen.
Vsak račun se izda enkrat za svoj preostanek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-fd61736c2e52 package=lite -->
### 36.2 Prevzem z bonom in napitnino

To Go račun je 28,00 EUR.
Skupna odprta evidenca darilnih bonov omogoča pokritje 10,00 EUR.
Gost želi kartico 20,00 EUR.
Blagajnik potrdi, da je 2,00 EUR napitnine vključeno v kartični znesek.
Bon in kartica sta ločeni potrjeni vrstici.
Preostanek osnovnega računa je nič.
Račun jasno pokaže uporabljena načina in napitnino po konfiguraciji.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0acb734b3460 package=extended -->
### 36.3 Poslovna dostava s TRR

Poslovni naročnik uporablja odobren TRR tok.
Operater preveri partnerja in zahtevano referenco.
TRR pokrije dogovorjeni del računa.
Preostanek se lahko plača z drugim dovoljenim načinom.
Neizkazano nakazilo se ne označi kot potrjeno brez pravila enote.
Račun se ne podvaja, če partner kasneje vpraša po kopiji.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8a1f138c394c package=lite -->
### 36.4 Kartica, pozni odgovor in tisk

Kartica za 19,80 EUR na terminalu uspe.
POS izgubi odgovor in pokaže neznano stanje.
Blagajnik preveri isti poskus.
Obnovitev potrdi plačilo.
Račun se uspešno izda.
Lokalni tiskalniški most odpove.
Blagajnik odpravi most in izvede ponatis istega računa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-02cafb35b3fc package=lite -->
## 37. Matrika združljivosti metod

| Prvi način | Drugi način | Dovoljena logika | Kritična kontrola |
| --- | --- | --- | --- |
| gotovina | kartica | pokrij preostanek | terminal dobi samo preostanek |
| bon | kartica | bon nato preostanek | preveri skupno odprto evidenco bonov |
| subvencija | gotovina | subvencija plus doplačilo | preveri upravičenost |
| TRR | kartica | odobren del plus preostanek | preveri referenco TRR |
| odloženo | brez drugega | le ob pravici | preveri nosilca obveznosti |
| kartica | kartica | drugi poskus le po jasni zavrnitvi prvega | neznanega ne ponovi |
| kartica | gotovina | gotovina šele po zavrnjeni/razrešeni kartici | brez dvojne obremenitve |
| bon | gotovina | bon plus preostanek | bon ni gotovinsko vračilo |

Tabela ne razveljavlja omejitev posamezne konfiguracije enote.
Če način ni prikazan, ga uporabnik ne more nadomestiti z drugim imenom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-c00bed004504 package=lite -->
## 38. Delovni list obnovitve

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f1d418f10b24 package=lite -->
### 38.1 Podatki, ki jih izpolnite

Številka naročila: __________.
Številka računa, če obstaja: __________.
Znesek poskusa: __________.
Ponudnik terminala: __________.
Čas začetka: __________.
Vidni rezultat terminala: __________.
Stanje POS: __________.
Referenca oziroma identifikator poskusa: __________.
Naslednje dovoljeno dejanje: __________.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-6241b568523a package=lite -->
### 38.2 Odločitveni pregled

Ali terminal jasno kaže zavrnitev?
Če da, lahko preverite neplačani preostanek.
Ali terminal ali ponudnik kaže uspeh?
Če da, uporabite obnovitev istega poskusa.
Ali je rezultat neznan?
Če da, ne začnite nove bremenitve.
Ali račun že obstaja?
Če da, preverite ločeno FURS in tisk.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-bd7b366b0711 package=lite -->
## 39. Dokazni seznami incidentov

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-e31a7b9ed88c package=lite -->
### 39.1 Terminal

- [ ] naročilo in znesek sta zapisana;
- [ ] ponudnik in čas sta zapisana;
- [ ] referenca je zapisana, če je prikazana;
- [ ] uporabnik ni ponovil neznanega poskusa;
- [ ] obnovitev se nanaša na isti poskus.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f1d367cf6414 package=lite -->
### 39.2 FURS in offline

- [ ] izvirna številka računa je zapisana;
- [ ] ZOI/EOR status je pregledan;
- [ ] sporočilo napake je shranjeno po politiki;
- [ ] retry se izvaja nad obstoječim računom;
- [ ] certifikata ali surovega odgovora ne ureja nepooblaščena oseba.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-070f57082103 package=lite -->
### 39.3 Tisk

- [ ] status izdaje je preverjen pred posegom v tisk;
- [ ] preverjeni so papir, pokrov, napajanje in povezava;
- [ ] preverjen je tiskalniški most;
- [ ] izbran je ponatis izvirnega računa;
- [ ] ni ustvarjeno novo plačilo ali nov račun.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8d1ba728bc3e package=lite -->
## 40. Dialogi blagajnika in vodje

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-898bdfb99694 package=lite -->
### 40.1 Neznana Viva transakcija

Blagajnik: »Viva terminal kaže plačano, POS čaka.«
Vodja: »Ne začenjaj nove kartice; zapiši znesek in čas.«
Blagajnik: »Preverjam isti status in identifikator.«
Vodja: »Če je potrjeno, dokončaj isti račun; če ni, eskaliraj.«

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-54f9c227a1bc package=lite -->
### 40.2 FURS brez EOR

Blagajnik: »Račun obstaja, EOR pa manjka in kaže napako.«
Vodja: »Ne izdajaj novega računa.«
Blagajnik: »Zapisal sem številko in sporočilo.«
Vodja: »Po povezavi izvedemo retry obstoječega računa.«

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-0a4bb34272c6 package=lite -->
### 40.3 Napačen tisk

Blagajnik: »Račun se je natisnil na napačni napravi.«
Vodja: »Račun je že izdan; poišči ga v evidenci.«
Blagajnik: »Izvedem ponatis na pravilnem tiskalniku.«
Vodja: »Po konici prijavi nastavitev mostu.«

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-338ff81e7100 package=lite -->
## 41. Časovno vodene incidentne vaje

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4130c08dfe16 package=lite -->
### 41.1 Vaja 60 sekund: terminal

Trener pokaže `unknown` po kartici.
Udeleženec ima minuto za prvo odločitev.
Pravilen prvi stavek je prepoved nove bremenitve.
Udeleženec navede znesek, ponudnika, čas in referenco.
Kritična napaka je izbor gotovine brez razrešitve kartice.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-d343a4a1811a package=lite -->
### 41.2 Vaja 90 sekund: FURS

Trener pokaže izdan račun brez EOR.
Udeleženec ima 90 sekund za razlago postopka.
Mora ohraniti številko izvirnega računa.
Mora navesti retry po odpravi vzroka.
Ne sme predlagati nove izdaje.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5d3cf446e917 package=lite -->
### 41.3 Vaja 120 sekund: storno

Trener pokaže račun s tremi postavkami.
Gost vrača eno postavko.
Udeleženec mora pojasniti, da izbira posamezne količine ni na voljo.
Udeleženec mora izbrati storno celotnega računa in navesti razlog.
Udeleženec mora navesti povezavo z izvirnikom.
Udeleženec mora razlikovati storno dokument od ponatisa in nato opisati nov
pravilen račun za postavke, ki po popravku ostanejo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-ddd725b46a71 package=lite -->
## 42. Kompetenčna vprašanja in utemeljitve

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-5b4d4b6971c4 package=lite -->
### Vprašanje 1

Zakaj kartičnega poskusa v stanju `unknown` ne ponovimo?
Odgovor: gost je lahko že obremenjen.
Utemeljitev: najprej se preveri in obnovi isti identifikator poskusa.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1deb90b8cd50 package=lite -->
### Vprašanje 2

Kaj naredite, če tisk odpove po uspešni izdaji?
Odgovor: odpravite tisk in uporabite ponatis.
Utemeljitev: izdaja računa in fizični tisk sta ločena koraka.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-06abcdfad659 package=lite -->
### Vprašanje 3

Kaj naredite pri manjkajočem EOR?
Odgovor: preverite status in retry obstoječega računa.
Utemeljitev: nov račun bi lahko podvojil promet.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-91048c3f1863 package=lite -->
### Vprašanje 4

Ali lahko bon pokrije del računa in kartica preostanek?
Odgovor: da, kadar sta oba načina omogočena in bon potrjen.
Utemeljitev: kartični znesek je samo dejanski preostanek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-b50e807d93bd package=lite -->
### Vprašanje 5

Kaj dokazuje BizBox napaka?
Odgovor: težavo elektronske predaje, ne neobstoja fiskalnega računa.
Utemeljitev: elektronska predaja, tisk in FURS so ločeni tokovi.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4abb4a0e8924 package=lite -->
## 43. Banka trenerjevih vprašanj za blagajno

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a091a0964c69 package=lite -->
### 43.1 Plačilni zaslon

Vprašanje: Kaj pomeni preostanek?
Odgovor: še nepokriti del računa.
Razlog: izdaja čaka na pravilen ničelni preostanek.
Vprašanje: Kdaj spremeniš postavko?
Odgovor: pred terminalskim tokom.
Razlog: med obdelavo se naročilo ne spreminja.
Vprašanje: Kaj preveriš pred izdajo?
Odgovor: znesek, potrjene vrstice in preostanek.
Razlog: klik plačila ni prejem denarja.
Vprašanje: Kaj pomeni potrjena vrstica?
Odgovor: dejansko evidentirano plačilo.
Razlog: všteva se v plačano vrednost.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4f477b3abc4f package=lite -->
### 43.2 Mešana plačila

Vprašanje: Račun je 30, bon 12. Koliko kartica?
Odgovor: 18 EUR.
Razlog: kartica pokrije samo preostanek.
Vprašanje: Ali gotovina nadomesti neznano kartico?
Odgovor: ne.
Razlog: kartica je lahko že uspešna.
Vprašanje: Kdaj razdeliš postavke?
Odgovor: ko gostje želijo ločene račune.
Razlog: delitev zneska ne spremeni lastništva jedi.
Vprašanje: Kdo določi napitnino?
Odgovor: gost.
Razlog: napitnina ni samodejno vračilo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-8a1b12b4df9c package=lite -->
### 43.3 Terminal

Vprašanje: Kaj je prvi korak pri `unknown`?
Odgovor: prepovej nov poskus.
Razlog: zaščiti gosta pred dvojno bremenitvijo.
Vprašanje: Kaj primerjaš pri obnovitvi?
Odgovor: ponudnika, naročilo, znesek in identifikator.
Razlog: obnovitev velja za isti poskus.
Vprašanje: Kdaj preklopiš ponudnika?
Odgovor: po jasni razrešitvi prvega toka.
Razlog: pozni callback je lahko uspešen.
Vprašanje: Kaj je `pending`?
Odgovor: stanje, ki še nima končnega rezultata.
Razlog: ne pomeni zavrnitve.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-798f1e9ec44e package=lite -->
### 43.4 FURS

Vprašanje: Kaj je ZOI?
Odgovor: zaščitna oznaka izdajatelja.
Razlog: je del fiskalne sledljivosti.
Vprašanje: Kaj je EOR?
Odgovor: identifikator uspešnega odgovora FURS.
Razlog: preverja se pri potrjenem računu.
Vprašanje: Kaj narediš brez EOR?
Odgovor: preveriš status in retry istega računa.
Razlog: nov račun podvoji prodajo.
Vprašanje: Kdo ureja certifikat?
Odgovor: pooblaščeni skrbnik.
Razlog: blagajnik ne upravlja ključev.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-cda2398a8d53 package=lite -->
### 43.5 Tisk in dokumenti

Vprašanje: Kaj narediš ob praznem papirju?
Odgovor: odpraviš papir in ponatisneš.
Razlog: tiskovna napaka ne izniči računa.
Vprašanje: Ali ponatis ustvarja prodajo?
Odgovor: ne.
Razlog: uporablja isti izvirni račun.
Vprašanje: Kaj pomeni BizBox napaka?
Odgovor: elektronska predaja ni uspela.
Razlog: fiskalni račun lahko še vedno obstaja.
Vprašanje: Kaj ohrani storno?
Odgovor: povezavo z izvirnikom.
Razlog: sledljivost ni brisanje zgodovine.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-48d34d92ef2d package=lite -->
## 44. Zaključni primeri presoje

Primer: gost da 50 EUR za račun 43 EUR.
Dejanje: vnesite prejeti znesek in preverite vračilo 7 EUR.
Utemeljitev: vračilo se ne ugiba.

Primer: prvi kartični poskus je `pending`.
Dejanje: ne zaženite druge kartice.
Utemeljitev: končni rezultat še ni znan.

Primer: terminal zavrne kartico za 12 EUR.
Dejanje: preverite zavrnitev in nato ponudite drug dovoljeni način.
Utemeljitev: jasna zavrnitev sprosti neplačani preostanek.

Primer: skupna odprta evidenca bonov je manjša od računa.
Dejanje: bon pokrije prikazani dovoljeni del, plača pa se samo preostanek.
Utemeljitev: pri starem bonu uporabite skupno evidenco; spletni bon s kodo ima
ločeno individualno preverjanje stanja.

Primer: subvencija ni potrjena.
Dejanje: ne zaključite računa kot subvencioniranega.
Utemeljitev: subvencija ni ročni popust.

Primer: POS pokaže plačano, račun pa nima EOR.
Dejanje: račun ostane isti; preverite FURS status.
Utemeljitev: plačilo in fiskalni odgovor sta ločena.

Primer: FURS retry uspe po izpadu.
Dejanje: preverite EOR na obstoječem računu.
Utemeljitev: retry ne naredi nove izdaje.

Primer: tiskalnik natisne dve kopiji.
Dejanje: ne stornirajte računa.
Utemeljitev: fizični kopiji nista dve prodaji.

Primer: BizBox kanal zavrne prejemnika.
Dejanje: eskalirajte partnerja in ID dokumenta.
Utemeljitev: ne izdajajte novega fiskalnega računa.

Primer: gost vrne eno od dveh postavk.
Dejanje: stornirajte celotni izvirni račun in nato ustvarite novo pravilno
naročilo samo za postavko, ki po popravku ostane.
Utemeljitev: POS ne podpira delnega storna; oba dokumenta ostaneta sledljiva.

Primer: kartično vračilo ima neznan rezultat.
Dejanje: preverite isti povračilni poskus.
Utemeljitev: tudi vračilo se ne sme podvojiti.

Primer: uporabnik želi nastaviti TRR ob izpadu terminala.
Dejanje: preverite, ali je TRR dejansko dovoljen in dogovorjen.
Utemeljitev: napačen način pokvari evidenco prometa.

Primer: manager zahteva surov FURS odgovor.
Dejanje: obravnavate ga po administrativnih pravicah.
Utemeljitev: blagajnik ne spreminja tehničnih zapisov.

Primer: račun je že izdan, tiskalni most ni dosegljiv.
Dejanje: odpravite most in naredite ponatis.
Utemeljitev: stanje izdaje ostaja uspešno.

Primer: kupec zahteva kopijo že izdanega računa.
Dejanje: poiščite izvirnik in uporabite ponatis.
Utemeljitev: kopija ne sproži novega plačila.

Primer: preostanek ni nič.
Dejanje: računa še ne izdate.
Utemeljitev: preveriti je treba plačilne vrstice.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-83d83250b914 package=lite -->
## 45. Izdaja 8.3: zanesljiva obnova plačil

To poglavje določa enoten postopek za kartični poskus, pri katerem odgovor
terminala, ponudnika ali POS-a ni takoj jasen. **Neznano** ni enako
**zavrnjeno** in ni enako **uspešno**.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a02223889287 package=lite -->
### 45.1 Enoten postopek pred ponovitvijo

1. Zaklenite nov poskus za isti znesek in ne klikajte plačila ponovno.
2. Zapišite številko naročila, znesek, čas, ponudnika in prikazano referenco.
3. V POS-u odprite obnovljive plačilne poskuse oziroma panel za uskladitev.
4. Izberite samo poskus z istim naročilom, zneskom in ponudnikom.
5. Preverite rezultat pri ponudniku ali na terminalu.
6. Če je rezultat **uspešen**, nadaljujte z istim plačilnim poskusom in izdajo
   računa.
7. Če je rezultat **zavrnitve**, odklenite nov poskus samo za neplačani znesek.
8. Če rezultat ostane **neznan**, ga ne prekrijte z novim plačilom; primer
   predajte vodji oziroma podpori z zabeleženimi podatki.

Ponovitev je dovoljena samo kot preverjanje oziroma nadaljevanje istega
idempotentnega poskusa. Nov ključ oziroma nov terminal za isti znesek lahko
povzroči dvojno bremenitev.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f0050300f5cc package=lite -->
### 45.2 Razlike med ponudniki

| Ponudnik oziroma tok | Kaj preveri blagajnik | Varen naslednji korak |
|---|---|---|
| Payten TCP | odgovor istega terminala in referenco poskusa | preveri isti poskus; ne zaganjaj drugega terminala |
| Payten Android | povratek iz Android toka in stanje rezerviranega poskusa | odpri obnovitev istega naročila |
| Viva Cloud | stanje zahtevka in znesek na terminalu | pri `PENDING` počakaj oziroma preveri status; pri `PAID` nadaljuj |
| Viva Android | veljaven povratek v POS | ob prekinitvi odpri isti plačilni poskus |
| Viva Tap to Pay | povratni podatek SoftPOS-a in identifikator | preveri isti identifikator; ne ustvari nove prodaje |
| SumUp terminal | `paymentAttemptId` in terminalsko stanje | uskladi isti poskus pred ponovitvijo |
| SumUp QR | `checkoutId` in status QR plačila | pri `pending` ali `unknown` počakaj oziroma preveri isti checkout |

Simulacija ali demo način Viva je lahko uporaben za preskus uporabniškega toka,
ni pa dokaz produkcijskega plačila. Blagajnik uporablja ponudnika, ki ga POS
ponudi za izbrano napravo; ponudnika ne zamenja ročno samo zato, ker je prvi tok
počasen.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-25bf1b0d0857 package=extended -->
## 46. Darilni bon: izdaja, unovčitev in neuspešno plačilo

POS ima ločeno izdajo in unovčitev splošnega bona iz skupne evidence, javna
stran pa lahko prodaja individualne spletne bone. Ne mešajte teh evidenc:

* izdaja na POS-u ustvari plačan splošni bon iz skupne evidence;
* spletni nakup ustvari individualni bon s kodo, stanjem in lastno sledjo gibanj;
* unovčitev posamezne vrste mora biti evidentirana v ustreznem toku.

Bon za pico oziroma subvencionirana prehrana sta ločena toka in se ne smeta
evidentirati kot splošni darilni bon.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a3714408dd41 package=extended -->
### 46.1 Izdaja bona na POS-u

1. Na plačilnem zaslonu odprite dialog **Izdaja darilnega bona**.
2. Vnesite znesek med 0,01 EUR in 10.000,00 EUR z največ dvema decimalnima
   mestoma.
3. Izberite samo gotovino ali kartico; kartična izdaja je podprta samo, kadar
   POS za ta namen zažene preverljiv SumUp tok. Če ta tok ni na voljo, kartice
   ne nadomestite z drugim terminalom ali načinom plačila.
4. Pri gotovini preštejte prejeti znesek in preverite vračilo.
5. Pri kartici POS najprej rezervira izdajo in zažene preverljiv SumUp tok,
   kadar je kartica vezana na SumUp napravo.
6. Pred fiskalizacijo preverite, da ponudnik potrjuje isti znesek in isto
   terminalsko referenco.
7. Potrdite izdajo šele po uspešnem plačilu in preverite številko oziroma dokaz
   bona.

Če kartično plačilo ni potrjeno, se izdaja ne fiskalizira. Ne izdajajte bona
ročno in ne ponavljajte kartice brez preverjanja obstoječe rezervacije izdaje.
Enak idempotentni ključ vrne isti rezultat; drugačen ključ z istimi podatki lahko
ustvari novo izdajo in je zato prepovedan.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-dfafef0492fe package=extended -->
### 46.2 Unovčitev bona

Za stari bon iz skupne evidence:

1. Na plačilnem zaslonu izberite **Bon**, nato **Stari boni (skupna evidenca)**.
2. Preverite trenutno skupno odprto vrednost in vnesite samo znesek, ki ga
   želite pokriti.
3. Pri delnem plačilu preverite preostanek in ga pokrijte z drugim dovoljenim
   načinom; pri tem toku je lahko tudi kartica.
4. Pred izdajo preverite, da je preostanek 0,00 EUR in da so na računu
   prikazane vse plačilne vrstice.

Za bon, kupljen po spletni poti, izberite **Bon → Spletni bon s kodo**.
Skenirajte ali vnesite kodo in nadaljujte šele po uspešnem preverjanju statusa
in dobroimetja. Uporabite individualni znesek do višine računa. Če bon ne
pokrije celotnega računa, POS v tem toku dovoljuje samo gotovinsko doplačilo.
Kartično doplačilo je blokirano, ker sistem ne zagotavlja trajne rezervacije
bona pred morebitno kartično bremenitvijo. Če bon pokrije cel račun, kartični
tok ni potreben. Po izdaji računa preverite končni status in stanje bona; pri
neznanem izidu ne ponovite plačila ali ne ustvarite drugega računa, dokler vodja
ne uskladi istega poskusa.

Skupna evidenca starih bonov ne predstavlja individualnega stanja posameznega
bona. Pri celotnem kritju stare evidence se kartični tok ne zažene. Nobena od
teh evidenc ne omogoča samodejnega gotovinskega vračila; vračilo vežite na
izvirni račun in odobren postopek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-46-3-stripe-voucher package=extended -->
### 46.3 Spletna prodaja individualnega bona in Stripe

Spletni nakup je ločen od izdaje bona na plačilnem zaslonu POS-a in od QR
naročila. Skrbnik javne ponudbe naj preveri:

1. v POS-u odprite **Javna stran** (`/javna-stran`) za pravo poslovno enoto;
2. v zavihku **Splošno in kontakt** vključite **Javno prikazan profil**;
3. v zavihku **Darilni boni** uredite aktivne bone in njihove aktivne vrednosti
   ter shranite nastavitve;
4. administrator podjetja oziroma superadministrator v kartici
   **Stripe Connect** preveri povezavo in, če je treba, izbere
   **Poveži Stripe račun**
   oziroma **Nadaljuj nastavitev** ter dokonča podatke v Stripe;
5. spletna prodaja je na voljo šele, ko POS prikaže, da je račun povezan in
   pripravljen za plačila, kar vključuje oddane podatke, omogočeno sprejemanje
   plačil in izplačila. Sama povezava ali začeto preverjanje Stripe še ne
   pomenita, da je plačilo omogočeno.

Urejanje javnega profila je na voljo vlogam **admin**, **admin_enote** in
**superadmin**. Povezava Stripe je na ravni podjetja; kartico Connect lahko
upravlja **admin** ali **superadmin**, ne administrator posamezne enote.
Gost na javni strani Bookie Obiski izbere objavljen bon in vrednost, vnese
podatke kupca ter nadaljuje na Stripe Checkout. Če profil ni aktiven, ni
aktivnih ponudb ali račun Stripe ni pripravljen, spletni nakup ni na voljo;
gosta usmerite na enoto in ne obljubite spletnega plačila.

Po Stripe potrditvi strežniški webhook ustvari individualni bon za vsako
kupljeno enoto in ga pošlje na e-poštni naslov kupca, ki ga je vnesel gost.
Stran po plačilu ločeno prikazuje status nakupa in dostave: `open` pomeni, da
plačilo še ni potrjeno; `expired` pomeni, da je Checkout seja potekla; samo
`complete` pomeni, da je sistem plačilo potrdil. Pred novim poskusom po
potekli seji preverite, da za isto naročilo ni že potrjenega plačila.
Dostava je lahko še `pending` ali `sending`, lahko je `failed` in predvidena
za ponovni poskus, ali `sent`. `Sent` pomeni, da je SMTP sprejel sporočilo za
odpošiljanje; ni dokaz, da je prispelo v prejemnikov nabiralnik. Zato gostu ne
obljubite prejema samo na podlagi tega statusa. Ob težavi naj kupec preveri
vneseni e-poštni naslov in mapo z neželeno pošto ter ohrani povezavo s
plačilno sejo. Ne začnite novega plačila, dokler statusa obstoječe seje ne
preverite.

Uporabnik z vlogo **admin**, **admin_enote** ali **superadmin** lahko v **Javna
stran → Darilni boni** pregleda opozorila o dostavi in Stripe plačila za ročno
uskladitev. Če je dostava neuspešna, uporabite prikazano ponovno pošiljanje šele
po pregledu istega nakupa. Ročna rešitev Stripe pregleda zgolj zabeleži
obravnavo in sama ne ustvari bona ali spremeni dobroimetja; neskladnega plačila
zato ne označite kot urejenega, dokler ni dejansko usklajeno. Ob neznanem
statusu plačila, manjkajočem bonu ali nejasnem izidu kontaktirajte odgovorno
osebo; ne izdajajte bona ročno in ne ponavljajte bremenitve.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-4bf68e5c2525 package=lite -->
## 47. Politika napitnin in računovodska sled

Napitnina je ločen znesek in ni prodaja artikla. Ne povečuje osnovice računa,
DDV ali fiskalnega zneska. Pri plačilnem toku preverite:

1. ali je za podjetje in enoto veljavna politika napitnin;
2. ali politika velja na datum in čas plačila;
3. kateri način zajema je dovoljen za gotovino, kartico ali mešano plačilo;
4. ali je gost pred potrditvijo videl in potrdil znesek;
5. kateremu profilu oziroma prejemniku se napitnina razporedi.

Pri kartici se lahko napitnina pošlje v terminalskem znesku, vendar mora biti
osnovni račun in napitnina v POS-u shranjena ločeno. Pri gotovini se napitnina
ne sme skriti v ceni artikla ali v vračilu. Pri mešanem plačilu zabeležite,
katera oseba in kateri plačilni del vsebujeta napitnino.

Napitnina se prikazuje ločeno v realizaciji, Z-poročilu in računovodskem
zapiranju, kadar je ta dimenzija za enoto omogočena. Razveljavitev ali storno
plačila mora razveljaviti tudi pripadajočo razporeditev napitnine; ne popravljajte
je z neuradnim negativnim artiklom. Pri celotnem plačilu z darilnim bonom
napitnina ni dovoljena, razen če konfiguracija izrecno pokaže drugačen podprt
tok.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-48aca0d07427 package=lite -->
## 48. Offline fiskalni tok: naprava, vrsta in uskladitev

Offline fiskalni tok ni splošno dovoljenje za delo brez povezave. Skrbnik mora
pred uporabo:

1. registrirati napravo in jo povezati s pravilnim podjetjem, enoto in blagajno;
2. pridobiti veljaven **authority bundle** z operatorjem, katalogom, DDV,
   dovoljenimi načini in omejitvami zneskov;
3. napravo aktivirati samo za čas in obseg, ki ga dovoljuje politika;
4. določiti, ali je vir `CLOUD_OFFLINE` ali lokalni prehod `GATEWAY`;
5. preveriti, da so lokalni prehod, ura naprave in dovoljenje dosegljivi.

Blagajnik sme offline izdati samo račun, ki ga naprava in authority bundle
izrecno dovolita. Po izdaji se shrani lokalni dokaz s svojim operacijskim
ključem; isti račun se ne sme ročno ponovno vnesti.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a0841fedff6a package=lite -->
### 48.1 Po vrnitvi povezave

Skrbnik v administrativnem panelu pregleda offline vrsto in za vsak zapis izvede
ustrezen korak:

* **ingest** sprejme lokalni zapis v strežniško vrsto;
* **retry** ponovno pošlje zapis, ki ga je dovoljeno ponovno poslati;
* **reconcile** primerja lokalni dokaz, strežniški zapis in odgovor FURS;
* **claim** prevzame nerešen zapis v obravnavo odgovorne osebe;
* **revoke** prekliče napravo ali authority bundle, kadar ni več zaupanja v
  napravo.

Vrsta se ne šteje za prazno samo zato, ker je uporabniški zaslon zaprt. Za
zaključek preverite število sprejetih, potrjenih, neuspešnih in nerešenih
zapisov, EOR pri potrjenih računih ter razlog pri vsakem neuspešnem zapisu.
Konflikta ne rešujte z novim računom; najprej uskladite isti operacijski ključ.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-a52cb8a93fbb package=lite -->
## 49. FURS, tisk in dokumenti po izdaji

Pri vsakem računu ločite:

* **potrjeno** – FURS je vrnil EOR;
* **v obdelavi** – zahtevek še teče in se ne ponavlja ročno;
* **neznano** – prenos ali odgovor ni zanesljivo zaključen;
* **neuspešno** – sistem je shranil razlog in dovoljuje obravnavo oziroma retry;
* **stornirano** – izvirni račun ima sledljiv popravek in ni navaden kandidat za
  ponovno izdajo.

FURS retry vedno uporablja obstoječi račun, njegovo vsebino in izvirni
identifikator. Pred retry zapišite številke prizadetih računov, po retry pa
preverite EOR, število uspešnih in neuspešnih zapisov. Manjkajoči EOR ni
samodejno dokaz, da računa ni; pri neznanem stanju je potreben pregled.

Napaka tiskalnika, lokalnega mostu ali BizBoxa ne pomeni, da račun ni izdan.
Najprej preverite številko računa, fiskalni status, papir, pokrov, napajanje,
izbrani tiskalnik, širino 32/58 mm in povezavo mostu. Nato uporabite **Ponatis**.
Ponatis ne ustvarja novega računa, novo plačilo ali storno samo zaradi slabega
izpisa pa sta napačna.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-78e171442613 package=lite -->
## 50. Storno, vračilo in pregled plačil

POS podpira sledljiv popravek celotnega izdanega računa. Posamezne postavke ali
količine se ne stornirajo neposredno. Pri delnem vsebinskem popravku:

1. poiščite izvirni račun;
2. preverite vsa plačila, napitnino, FURS status in razlog;
3. izvedite celotni storno z dovoljenjem;
4. preverite povezavo storno dokumenta z izvirnikom;
5. za veljavni preostali promet ustvarite nov pravilen račun;
6. vračilo izvedite po prvotnem oziroma dovoljenem plačilnem toku.

Pri več plačilih je treba ločeno preveriti status vsake plačilne vrstice. Če je
razveljavljena samo ena vrstica, račun ni samodejno v celoti plačan niti v celoti
neplačan. V računovodskem pregledu mora biti razvidno, katera vrstica je bila
razveljavljena, kdaj, kdo jo je razveljavil in na kateri izvirni račun se nanaša.
Kartično vračilo uporabite prek ponudnika, ki je sprejel izvirno bremenitev;
ne nadomestite ga z novo prodajo z negativnim zneskom.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-27625fdccff3 package=lite -->
## 51. X- in Z-poročilo ter blagajniški premiki

**X-poročilo** je vmesni pregled brez zapiranja blagajniške izmene. Uporabite
ga za kontrolo prometa, načinov plačila, napitnin, bonov, storna in pričakovane
gotovine. Večkratni X ne spremeni prometa in ne sme biti uporabljen kot dokaz,
da je izmena zaključena.

Pred **Z-poročilom** vodja:

1. preveri vse odprte oziroma neusklajene plačilne poskuse;
2. pregleda gotovino, kartice, bone, TRR, napitnine, storna in vračila;
3. pred izdajo Z vnese dejanske blagajniške premike z opisom in dokazilom;
4. zagotovi, da druga pooblaščena oseba premike potrdi in da imajo stanje **POTRJEN**, ne le **OSNUTEK**;
5. potrdi Z-poročilo šele po uskladitvi pričakovanega in dejanskega stanja;
6. po zaključku preveri številko Z, datum poslovanja in rezultat prenosa.

Polog in dvig nista nadomestilo za popravek napačnega plačila. Storno
blagajniškega premika ohrani izvirni premik in revizijsko sled; ne brišite ga in
ne ustvarjajte nasprotnega premika brez dovoljenja. Pri razliki zapišite
pričakovani znesek, dejanski znesek, razliko, razlog in odgovorno osebo.

**Katera blagajna?** Premik pripada izbrani blagajni trenutne enote,
na primer PP001-B001. Pred vnosom preverite enoto, blagajno in poslovni
datum. Gotovine različnih blagajn ne združujte. Poslovni dan lahko glede
na nastavitve enote sega čez polnoč.

**Pred ali po Z-poročilu?** Premik, ki se nanaša na gotovino tega
poslovnega dne, vnesite in dajte v potrditev **pred Z-poročilom**.
Osnutek še ne spremeni teoretičnega stanja in ni zajet kot potrjen premik.
Po Z-poročilu je dan zaklenjen; nov vnos za ta dan je zavrnjen.
Pozabljeni premik sporočite vodji in uporabite dovoljen postopek odklepa,
popravka in ponovnega zaključka. Ne vnašajte lažnega datuma samo zato,
da bi obšli zaklep.

**Pet vrst premikov in praktični primeri**

Konti spodaj so računovodski namigi iz izbirnika: D pomeni debet,
K kredit. Dejanski analitični konti sledijo nastavitvam podjetja.

| Vrsta premika | Praktični primer | Knjiženje in učinek na gotovino blagajne |
| --- | --- | --- |
| Izplačilo dobavitelju | Dobavitelju kruha iz predala plačate 85,00 EUR. Izberite dobavitelja oziroma povezan prejeti račun in shranite dokazilo. | D 220 / K 100; gotovina se zmanjša za 85,00 EUR. |
| Prejem gotovine / menjalni denar | Po predhodnem dvigu z banke v predal dejansko prejmete dodatnih 200,00 EUR. | D 100 / K 109; gotovina se poveča za 200,00 EUR. |
| Dvig z bančnega TRR | Na banki dvignete 200,00 EUR, ki jih šele nesete v lokal. | D 109 / K 110; gotovina predala se še ne spremeni. Ko denar prejme blagajna, ločeno evidentirajte prejem gotovine. |
| Polog gotovine na TRR | Iz predala vzamete 600,00 EUR izkupička za polog na banko. | D 109 / K 100; gotovina se zmanjša za 600,00 EUR, znesek je do bančne potrditve na poti. |
| Bančni priliv po pologu | Na bančnem izpisku je potrjen predhodni polog 600,00 EUR. | D 110 / K 109; zapre se denar na poti, gotovina predala se ne spremeni. |

Bančno stopnjo vnesite na datum dejanskega bančnega dogodka. To je lahko
isti ali poznejši dan, ne nujno naslednji delovni dan. Z računovodstvom
uskladite obdelavo izpiska, da istega dviga ali priliva ne knjižite dvakrat.
Premik ni prodaja, ne nadomešča računa in sam po sebi ne dokazuje pravilno
zaprtega prejetega računa.

**Menjalni denar ne sme biti upoštevan dvakrat.** Teoretično stanje že
vključuje menjalni denar iz nastavitev blagajne. Če je začetnih 50,00 EUR
že zajetih v tej nastavitvi, jih ne vnesite še kot dodatni prejem 50,00 EUR.
Prejem gotovine uporabite za dejanski dodatni vnos denarja glede na že
upoštevano osnovo. Lastnikov vložek ni samodejno bančni dvig; izvor in
pravilno knjiženje mora določiti računovodstvo.

**Polog na TRR: scenarij A ali B**

- **A — menjalni denar ostane:** v predalu je 650,00 EUR, od tega
  50,00 EUR nastavljenega menjalnega denarja. Položite 600,00 EUR;
  po potrditvi ostane pričakovanih 50,00 EUR. Program zavrne polog,
  ki bi posegel v nastavljeni menjalni denar.
- **B — položen je tudi menjalni denar:** iz istega predala položite
  vseh 650,00 EUR; po potrditvi ostane pričakovanih 0,00 EUR.
  Pred naslednjim poslovnim dnem preverite dejansko začetno gotovino
  in nastavitev menjalnega denarja.

**Izplačila dobaviteljem in 420,00 EUR.** Program pri potrditvi preveri
posamezno plačilo in dnevni seštevek plačil istemu dobavitelju.
Če znesek preseže 420,00 EUR, zahteva dokumentiran razlog izjeme.
Primer: plačili 250,00 EUR in 200,00 EUR istemu dobavitelju isti dan skupaj
presežeta prag. Sam vpis razloga ne pomeni, da je gotovinsko plačilo
zakonito; upravičenost preverite z računovodstvom, sicer uporabite TRR.

**Praktično zaporedje zaključka**

1. Preverite enoto in blagajno, na primer PP001-B001, ter poslovni datum.
2. Zaključite plačila in preštejte gotovino; ne popravljajte manjka z izmišljenim premikom.
3. Če gotovino dejansko odvajate na banko, vnesite **Polog na TRR**, znesek in scenarij A ali B.
4. Shranite osnutek. Druga pooblaščena oseba ga mora potrditi; pripravljavec svojega premika ne more potrditi sam.
5. Preverite stanje **POTRJEN** in ponovno primerjajte teoretično stanje s preostankom v predalu.
6. Izdajte Z-poročilo šele po uskladitvi. Poznejši bančni priliv evidentirajte ločeno na njegov dejanski datum.

Pričakovana gotovina je nastavljeni menjalni denar + gotovinska prodaja
+ potrjeni prejemi gotovine − potrjena izplačila dobaviteljem − potrjeni
pologi na TRR. Dvig z bančnega TRR in bančni priliv ne spreminjata
fizične gotovine predala. Podrobnejša navodila so v sklopu
**Konec izmene, blagajniški premiki, poročila in POS→ERP**.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-f4775e72353d package=extended -->
## 52. Meje spletnih plačil in rezervacij

Javna stran Bookie Obiski je ločen kanal od QR menija. Če je profil enote
aktiven, omogoča javno rezervacijo miz; oddaja rezervacije preveri urnik,
kapaciteto in prosto mizo ter ustvari povezano rezervacijo v evidenci POS miz.
Gostu se po uspešni oddaji prikaže potrditev in povezava za upravljanje
rezervacije. Osebje preveri zapis v POS-u pod **Rezervacije miz**. Rezervacija
ni naročilo ali plačilo in je ne obravnavajte kot oddan QR račun.

Javna stran lahko ponuja tudi spletni nakup individualnih darilnih bonov prek
Stripe Checkout. Prodaja je pogojena z aktivnim javnim profilom, objavljenimi
aktivnimi vrednostmi bonov ter povezanim in za plačila pripravljenim Stripe
računom podjetja. Stripe Connect na **Javna stran** lahko poveže administrator
podjetja ali superadministrator; administrator enote lahko ureja profil in
ponudbo, ne pa povezave podjetja. Če povezava ni pripravljena, kupec ne more
zaključiti spletnega nakupa. To je ločeno od izdaje splošnega bona na POS-u in
od POS fiskalnega toka.

Stripe plačilo in dostava bona sta različna statusa: `open` ni potrjeno plačilo;
`complete` potrjuje, da je sistem obdelal plačano sejo. `pending`, `sending` ali
`failed` pomeni, da e-poštno odpošiljanje še ni potrjeno oziroma potrebuje
ponovni poskus; `sent` pomeni samo, da je SMTP sprejel sporočilo za
odpošiljanje, ne pa dokaz prejema v nabiralniku. Pri neznanem rezultatu
preverite obstoječo sejo in administrativna opozorila za Stripe/dostavo. Ne
ponavljajte bremenitve, ne izdajajte bona ročno in ne obljubljajte prejema,
dokler stanje ni razjasnjeno. Ročno označenje Stripe pregleda kot rešenega samo
zabeleži obravnavo; ne izda bona in ne spremeni njegovega stanja.

QR meni ostaja javni kanal za ogled menija, naročilo, klic natakarja, napitnino
in morebitno povratno informacijo. QR oddaja naročila sama po sebi ni dokaz
plačila. Gostujoči QR pomočnik ne sprejema rezervacij, spletnih nakupov ali
plačil; gost za to uporabi objavljeno stran enote. Za postopek spletnega bona
glejte razdelek **Spletna prodaja individualnega bona in Stripe**, za POS
unovčitev pa razdelek **Darilni bon: izdaja, unovčitev in neuspešno plačilo**.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-224d27a50bfd package=lite -->
## 53. Računovodski pregled sprememb plačil in storna računa

Ta postopek uporablja vodja izmene, administrator ali računovodja, kadar je
treba razložiti popravek računa, več plačil, razveljavitev plačil ali vračilo.
Namen pregleda je ugotoviti dejansko stanje brez novega plačila, brisanja
izvirnika ali sklepanja samo iz skupnega zneska.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-faaf93b72948 package=lite -->
### 53.1 Predpogoji in dokazila

Pripravite:

* številko izvirnega računa oziroma ID računa;
* poslovno enoto, blagajno in poslovni datum v obliki **dd.mm.yyyy**;
* vlogo, ki dovoljuje pregled oziroma razveljavitev;
* razlog za popravek in, kadar gre za kartico, referenco ponudnika ali
  `paymentAttemptId`;
* odprto računovodsko obdobje, kadar se razveljavlja že knjiženo plačilo.

Če je kateri od teh podatkov neznan, najprej poiščite izvirni zapis v seznamu
računov oziroma plačil. Ne ustvarjajte novega računa, da bi dobili drug ID za
isti dogodek.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-9addc8f15f93 package=lite -->
### 53.2 Pregled avtoritativnega zapisa

1. Odprite račun oziroma plačilo, ki je predmet poizvedbe. Če v vaši vlogi
   ločen zaslon za pregled ni viden, uporabite razpoložljivi seznam računov ali
   plačil in ID zapisa predajte računovodji oziroma skrbniku; ne ugibajte
   imena gumba ali statusa.
2. Zapišite številko računa, izvirni ID, poslovni datum, čas zapisa, enoto,
   blagajno in trenutni status računa.
3. Preglejte vsako plačilno vrstico posebej: znesek, način, status, referenco
   ponudnika, čas in povezavo na izvirni račun.
4. Ločite stanje **potrjeno**, **v obdelavi**, **neznano** in
   **razveljavljeno**. Klik na plačilo ali zapis v naročilu ni dokaz, da je
   denar prejet.
5. Primerjajte vsoto veljavnih plačil s skupnim zneskom računa. Napitnino,
   darilni bon, kartico in gotovino obravnavajte kot ločene evidence.

Pri več plačilih razveljavitev ene vrstice ne pomeni, da je celoten račun
plačan ali neplačan. Po razveljavitvi ene vrstice ponovno preverite preostanek
in vse druge vrstice. Če je katera vrstica še vedno **v obdelavi** ali
**neznana**, jo najprej razrešite po postopku za obnovo plačil; ne dodajajte
novega plačila na slepo.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-593801d81c53 package=lite -->
### 53.3 Razveljavitev že knjiženega plačila

V pregledani računovodski izvedbi je razveljavitev plačila dovoljena samo
pooblaščenemu računovodji ali lastniku in samo za plačilo s statusom
**knjiženo**. Postopek je:

1. Odprite zapis plačila in preverite njegove poravnave z računi.
2. Preverite, da ciljno računovodsko obdobje ni zaklenjeno.
3. Izberite razveljavitev samo, če je izvirno plačilo napačno ali ga je treba
   uradno obrniti; vnesite razlog.
4. Izberite odprto ciljno obdobje, kadar program to zahteva, in potrdite
   razveljavitev.
5. Po potrditvi preverite, da je nastal povezani storno knjižni zapis, da so
   poravnave sproščene in da je izvirno plačilo še vedno vidno.
6. Zabeležite status, čas, izvajalca, razlog in ID povezane temeljnice.

Razveljavitev ne sme izbrisati izvirnega plačila. Če je obdobje zaklenjeno,
plačilo ni knjiženo ali program ne vrne potrditve, postopka ne ponavljajte z
drugim zapisom. Shranite ID in sporočilo napake ter zadevo predate osebi, ki
lahko odpre oziroma določi pravilno obdobje.

Če uporabniški vmesnik ne pokaže statusa, časa ali izvajalca razveljavitve,
tega podatka ne nadomestite z ročnim vnosom. Za uradni dokaz uporabite
povezani revizijski zapis oziroma temeljnico, ki jo mora preveriti
računovodja ali skrbnik.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-fc330fa8ef7e package=lite -->
### 53.4 Celotni storno računa in popravek ene postavke

Celotni storno se uporablja za že izdani račun, kadar je treba razveljaviti
celoten dokument. Pred potrditvijo:

1. preverite izvirni račun, vsa plačila, FURS status in razlog;
2. zagotovite zahtevano odobritev;
3. izvedite celotni storno, ne brisanja računa;
4. preverite, da ima storno svojo številko in povezavo na izvirnik;
5. preverite fiskalni rezultat storna in stanje plačil;
6. če del prometa ostane veljaven, ustvarite novo naročilo in nov račun samo
   za pravilno vsebino.

Ločen popravek ene postavke ali količine v izdanem računu ni potrjen kot
samostojen POS postopek. Zato ne iščite ali izmišljajte gumba za delni storno:
uporabite celotni storno in nov pravilen račun po postopku iz tega poglavja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-54a5c07bce4e package=lite -->
### 53.5 Vračilo in kartično povračilo

Pri vračilu:

1. preverite, ali je vračilo odobreno in na kateri račun se nanaša;
2. uporabite prvotni oziroma za to plačilo dovoljen način vračila;
3. pri kartici uporabite ponudnika, ki je sprejel izvirno bremenitev, in
   shranite referenco povračila;
4. pri neznanem rezultatu povračila preverite isti poskus oziroma referenco,
   preden ga ponovite;
5. preverite, da sta vračilo in morebitna razveljavitev vidna ločeno od
   izvirne prodaje.

Ne izvajajte vračila z novo negativno prodajo, ne izdajajte novega računa
namesto povračila in ne vračajte kartičnega zneska z gotovino, če to ni
izrecno dovoljen postopek ponudnika oziroma podjetja.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-cc81fc79ac5d package=lite -->
### 53.6 Poslovni učinek in varna kontrola po postopku

Po razveljavitvi plačila ali stornu mora računovodja preveriti:

* da izvirni račun in izvirno plačilo ostaneta vidna;
* da je storno oziroma razveljavitev povezana z izvirnikom;
* da so poravnave in odprti znesek preračunani;
* da se knjižbe v glavni knjigi ujemajo z učinkom popravka;
* da so FURS, kartično povračilo, gotovina, bon in napitnina obravnavani
  ločeno;
* da so razlog, čas, izvajalec in uporabljena referenca dokazljivi.

Če se prikaz računa, plačila in temeljnice ne ujema, primer ostane odprt.
Ne popravljajte ga z dodatnim plačilom, nasprotnim pologom ali ročnim
spreminjanjem zneska brez odobrenega računovodskega postopka.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-1e2e962a1c72 package=lite -->
## 54. Predaja izvornih dokumentov računovodstvu

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-2846e287831e package=lite -->
### 54.1 Izdani računi in popravki

Zaključen in fiskalno potrjen račun je izvorni dokument za računovodstvo,
vendar operativno poročilo POS ni davčna evidenca. Pri predaji morajo ostati
povezani številka računa, datum izdaje oziroma davčni datum, DDV-koda, osnova,
DDV, bruto znesek, način plačila, status in povezava na storno oziroma
dobropis. Odprta miza, rezervacija, nedokončano naročilo ali odpad niso
izdani račun in se v KIR ne smejo vključiti kot prihodek.

Pri stornu ali vračilu ne ustvarite novega navideznega računa. Uporabite
odobren postopek in shranite povezavo izvirni račun → KIR-vrstica →
nasprotni dokument. Fiskalna potrditev je dokaz izvornega računa, ne dokaz,
da je bila davčna evidenca že pripravljena ali oddana.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-3279682fef0c package=lite -->
### 54.2 Prejeti računi in dobaviteljski popravki

Prejeti dobaviteljski `RACUN`, `DOBROPIS` ali `BREMEPIS` mora pred potrditvijo
vsebovati dobavitelja, številko listine, datum listine, datum prejema oziroma
davčni datum, DDV-kodo, osnovo, DDV, odbitnost in povezavo na popravek ali
izvirnik. Prejemnica brez računa je lahko samo zalogovni dokument; ne
predstavljajte je kot že obdelan prejeti račun. Pri dobropisu in bremepisu preverite,
da se učinek ne podvoji v zalogi, obveznosti ali DDV.

Predaja računovodstvu mora vsebovati izvorno listino, povezano temeljnico
oziroma status prenosa ter morebitno zavrnitev ali manjkajočo preslikavo.

**Davčne evidence so del modula Glavna knjiga, ne POS Gostinstvo.**
Pregled KIR/KPR, uskladitev z glavno knjigo, davčni XML izvoz in postopek
oddaje v eDavke so opisani v priročniku za glavno knjigo, poglavje
»Davčne evidence«. POS pripravi izvorne podatke; njihova predaja še ne
pomeni knjiženja, pravilnosti davčne evidence ali uspešne davčne oddaje.

<!-- pos-heading: id=pos-06-izmene-porocila-nastavitve-56eb44cda046 package=lite -->
### 54.3 Kontrolni seznam pred predajo

- [ ] Predani so vsi zaključeni računi, storna in vračila ter povezave na izvirnike.
- [ ] Predani so prejeti računi in popravki; dobavnice brez računa so jasno ločene.
- [ ] Pri izvornih dokumentih so preverjeni datum, partner, DDV-koda, osnova in DDV.
- [ ] Shranjeni so rezultat prenosa, reference in morebitne napake.
- [ ] Računovodja nadaljuje obdelavo davčnih evidenc v modulu Glavna knjiga.

<!-- pos-heading: id=pos-02-monthly-contract-invoices package=lite -->
## 55. Mesečni račun pogodbeni firmi za malice

Vodja enote ali administrator odpre **Računi → Mesečni računi**. Postopek
je namenjen tudi gostincu, ki mu poslovne knjige vodi zunanji računovodja:
ne zahteva računovodskih obdobij, kontov ali temeljnic v Bookie ERP.

1. Preverite aktivno podjetje in enoto ter pogodbeni cenik izbrane firme.
2. Izberite zaključen poslovni mesec in pogodbeno firmo.
3. Kliknite **Pripravi predogled**. Preverite specifikacijo, dnevne račune, osnovo, DDV in skupni znesek.
4. Preverite datum izdaje in rok plačila, ki izhaja iz pogojev partnerja.
5. Po izrecni potrditvi izdajte mesečni račun.
6. V arhivu **Izdani mesečni računi** prenesite PDF za firmo in zunanjega računovodjo. PDF vsebuje specifikacijo pogodbenih postavk ter prilogo z dnevnimi POS računi.

V predogled pridejo samo še neobračunani, nestornirani negotovinski računi
izbrane firme in aktivne enote. Firma mora imeti pogodbeni cenik te enote.
Datum računa sledi gostinskemu poslovnemu dnevu. Odprtega poslovnega meseca
ni mogoče obračunati.

Številka se določi samodejno v ločeni seriji **M-POS-leto-zaporedna številka**.
Izdani računi ostanejo v arhivu tudi po ponovnem odprtju programa. PDF
uporablja podatke in cene ob izdaji; poznejša sprememba partnerja ne spremeni
že izdanega dokumenta.

Isti dnevni račun ne more biti ponovno obračunan niti v POS niti v ERP
zbirniku. Mesečni račun ne ustvarja nove prodaje, novega DDV, temeljnice ali
novega FURS zahtevka. Firma plača mesečni račun, ne še enkrat vseh njegovih
dnevnih računov.

Testni dokument je označen **TESTNI DOKUMENT – NI ZA PLAČILO**. Testnih in
dejanskih računov ni dovoljeno združiti. Račune z neuspelim FURS pošiljanjem
je treba najprej urediti.

Izdane listine ne popravljajte z brisanjem ali prepisovanjem. Samostojni
storno dnevnega računa, ki je že v mesečnem računu, je blokiran, ker bi
znesek za plačilo na mesečnem računu ostal napačen. Popravek zahteva
dobropis mesečnega dokumenta; ta poseben postopek še ni del tega obrazca.

<!-- pos-heading: id=pos-02-monthly-contract-eslog-bizbox package=lite -->
### 55.1 Prenos e-SLOG in oddaja prek bizBox

1. Odprite **Računi → Mesečni računi** in v arhivu **Izdani mesečni računi** poiščite dokument.
2. Za elektronsko datoteko kliknite **Prenesi e-SLOG**. Shranite preneseni XML; sam prenos ne pomeni oddaje prejemniku.
3. Za oddajo preverite povezavo aktivnega podjetja v **Nastavitve → bizBox**. Preverite pošiljatelja, testno oziroma produkcijsko okolje ter podatke in e-naslov prejemnika.
4. Pri dokumentu kliknite **Pošlji prek bizBox**. V potrditvi preverite številko računa in prejemnika. **Prekliči** zapre potrditev brez oddaje.
5. Kliknite **Potrdi oddajo** in počakajte na rezultat. Oddaja uporablja povezavo tega podjetja, ne skupnega nadomestnega računa.
6. Če ima dokument ID bizBox in dostava še ni zaključena, kliknite **Preveri dostavo**.

XML je v izvornem formatu e-SLOG 2.0 in uporablja isto številko, datum, rok
plačila, podatke partnerja in zneske kot izdani PDF. Vključuje reference na
dnevne račune in ohrani njihove zneske DDV ter zaokrožitve. Sprememba
partnerja po izdaji ne spremeni dokumenta. Prenos in oddaja ne ustvarita
novega mesečnega računa, prodaje, DDV, temeljnice ali FURS zahtevka.

Testni dokument se lahko odda samo v **testno okolje** bizBox; pošiljanje
v produkcijo je blokirano. Za že oddani dokument preverjajte dostavo z
istim računom bizBox in okoljem, prek katerih je bil oddan.

<!-- pos-heading: id=pos-monthly-contract-delivery-states package=lite -->
### 55.2 Stanja oddaje in varno nadaljevanje

| Stanje v arhivu | Pomen in naslednji korak |
| --- | --- |
| Ni oddan | Dokument še ni oddan. Preverite nastavitve in uporabite Pošlji prek bizBox. |
| Oddaja v teku | Oddaja poteka. Počakajte; ne odpirajte nove oddaje istega dokumenta. |
| Prijava ni uspela | Dokument ni bil poslan. Popravite nastavitve in uporabite Ponovi prijavo in oddajo. |
| Oddan | Ponudnik je vrnil ID dokumenta; to še ni potrjena dostava. Kliknite Preveri dostavo. |
| V obdelavi | Dostava še ni potrjena. Pozneje ponovno uporabite Preveri dostavo, ne nove oddaje. |
| Dostavljen | Ponudnik je izrecno potrdil dostavo. Nova oddaja ni potrebna. |
| Zavrnjen | Razlog preverite v portalu bizBox. Samodejna ponovna oddaja ni dovoljena. |
| Izid ni znan – preverite v bizBoxu | Po zunanji referenci preverite, ali je ponudnik dokument sprejel. Ponovno pošiljanje je blokirano. |

Pri nejasnem izidu si zabeležite številko mesečnega računa, zunanjo referenco,
okolje in morebitni ID bizBox. Izpad povezave ne pomeni, da ponudnik dokumenta
ni sprejel. Ne izdajajte nadomestnega mesečnega računa in ne pošiljajte XML
po drugi poti, dokler izid ni usklajen pri ponudniku.

Če stanje ni dostopno, uporabite **Osveži status**. To osveži shranjeno stanje
v programu; **Preveri dostavo** je ločen klic za preverjanje pri ponudniku.
Ob napaki preverjanja zadnje shranjeno stanje ostane nespremenjeno.

<!-- pos-heading: id=pos-monthly-contract-handover-checklist package=lite -->
### 55.3 Kontrola pred predajo firmi in računovodstvu

- [ ] Podjetje, enota, firma in zaključen poslovni mesec so pravilni.
- [ ] Dnevni računi in specifikacija se ujemajo z osnovo, DDV in skupnim zneskom.
- [ ] Datum izdaje, rok plačila in podatki partnerja so preverjeni.
- [ ] PDF in e-SLOG pripadata isti številki mesečnega računa.
- [ ] Firma ne prejme dveh zahtevkov za plačilo istega prometa.
- [ ] Pri bizBox je zabeleženo dejansko stanje; Oddan ni zamenjan z Dostavljen.
- [ ] Testni dokument ni namenjen plačilu in ni oddan v produkcijsko okolje.

<!-- pos-heading: id=pos-current-togo-print-projection package=lite -->
## 56. To Go embalaža in prikaz dodatkov na tiskanem računu

Pri To Go preverite, da je način omogočen za izbrani artikel in da ima
embalaža pravilno povezavo na jed. Na tiskanem računu se lahko cena
embalaže z enako DDV stopnjo prišteje prikazani ceni glavne postavke.
Naziv embalaže ostane informativen; zneska ne prištevajte še drugič.
Glavna jed je lahko označena **To-Go**.

To je samo način prikaza. Embalaža ostaja ločena zalogovna in računovodska
postavka; njen DDV in poraba se ne izbrišeta. Drugi plačljivi dodatki in
njihove podizbire se ne spremenijo v brezplačne vrstice.

Pri različnih DDV stopnjah jedi in embalaže mora biti davčna razlika
ohranjena. Če izvoz zavrne združitev, preverite podatke; ne spreminjajte
stopnje zgolj zato, da bi izvoz uspel. Pri preizkusu tiskanja primerjajte
celoten znesek računa, dodatke in embalažo z že izdanim dokumentom.
Ponovni tisk ne ustvari nove prodaje ali novega računa.
