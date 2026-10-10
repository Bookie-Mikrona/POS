<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5e5ea120d77c package=lite -->
# 08 Konec izmene, blagajniški premiki, poročila in POS→ERP

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-29b6d71c2c79 package=lite -->
## 1. Namen sklopa

Ta sklop zaključuje operativni dan: izmeno, blagajniške premike, X in Z
poročila, poslovni dan, operativna poročila in prenos temeljnic POS v ERP.

Nastavitve za artikle, KDS in plačila so predpogoj; vsakodnevno delo z njimi
je opisano v sklopih 05 do 07.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d313a53b91ba package=lite -->
## 2. Predpogoji pred koncem izmene

1. Vsi računi so zaključeni ali imajo znan razlog, zakaj niso.
2. Vsa neznana stanja terminalov so razrešena ali eskalirana.
3. FURS napake so pregledane in poslane v ponovni poskus, kadar je možno.
4. Vsi gotovinski premiki so evidentirani.
5. Vsi člani osebja so zaključili predaje naročil.
6. Za štetje gotovine imate mirno okolje in po potrebi pričo.
7. Ne zapirate tuje izmene brez pooblastila.

> **Opozorilo:** Zaprtje izmene ne popravlja napačnega računa, terminalskega
> plačila ali zalog. Te izjeme razrešite s sledljivim postopkom pred ali po
> zaprtju, nikoli s prikrivanjem razlike.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2c5d43596788 package=lite -->
## 3. Delovna izmena

Delovna izmena je pripisana uporabniku oziroma natakarskemu profilu in enoti.

Računi, izdani med izmeno, se prikažejo v njenem pregledu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-738de6604cd9 package=lite -->
### 3.1 Odpiranje izmene

1. Odprite **Izmene**.
2. Preverite prikaz enote in stroškovnega mesta.
3. Če enota ni določena, izmene ne odpirajte.
4. Odprite svojo izmeno.
5. Preverite, da se prikaže kot aktivna.
6. Preverite ime blagajne, če je prikazano.

Če profil ni vezan na natakarja, lahko sistem ponudi ročno izbiro. To je
izjemni postopek; skrbnik naj nato uredi povezavo profila.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-587031f5361b package=lite -->
### 3.2 Odmori

Pri svoji aktivni izmeni na strani **Izmene** izberite **Plačan odmor** ali
**Neplačan odmor**. POS zabeleži začetek in označi uporabnika **Na odmoru**.
Po vrnitvi uporabite **Zaključi odmor**. Med odprtim odmorom ni mogoče začeti
drugega odmora ali zapreti izmene. Vodja lahko trajanje in vrsto odmora
preveri v **Obračunu ur**; neplačani odmor se odšteje od efektivnih ur.
Predaja blagajne ni nadomestilo za evidenco odmora. Napačen zapis rešujte po
odobrenem kadrovskem postopku, ne z lažnim ponovnim odpiranjem izmene.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-43b1a420fffa package=lite -->
### 3.3 Zaključek izmene

1. Preverite število računov in promet na kartici izmene.
2. Izvedite štetje gotovine in evidentirajte nujne premike.
3. Izberite **Zaključi izmeno**.
4. Preglejte povzetek začetka, konca, trajanja, računov in prometa.
5. Zaprto izmeno po potrebi pošljite v potrditev.

Statusi zgodovine so osnutek, v potrditvi, potrjeno ali zavrnjeno. Zavrnjen
zapis zahteva popravek oziroma pojasnilo in ponovno pošiljanje v potrditev.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-41a179a9fda7 package=lite -->
## 4. Blagajniški premiki

Blagajniški premik evidentira fizični denar, ki ni neposredno plačilo računa.

Tipični primeri so prejem gotovine, gotovinsko plačilo dobavitelju,
polog na TRR, dvig z bančnega TRR in dejanski priliv na TRR.
Prenos denarja v sef ni bančni dvig in med ponujenimi vrstami nima
posebnega prenosa; uporabite odobreno evidenco predaje. Vračilo gostu
obravnavajte po postopku vračila računa, ne kot poljuben premik.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8c57d7232140 package=lite -->
### 4.1 Kdaj uporabiti premik

Uporabite premik, kadar denar vstopi v blagajno ali jo zapusti, vendar to ni
prodaja na računu, plačilo dobavitelju v drugem sistemu ali osebna izmenjava.

Ne uporabite premika za prikrivanje manjka ali viška. Najprej preštejte,
preverite račune in poiščite dejanski vzrok.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6a6c50fa37d4 package=lite -->
### 4.2 Vnos premika

1. Odprite **Blagajniški premiki**.
2. Preverite pravo enoto in blagajno.
3. Izberite vrsto: polog ali dvig, skladno z obrazcem.
4. Vnesite dejanski znesek.
5. Izberite oziroma vpišite jasen razlog.
6. Dodajte sklic ali opombo, kadar je zahtevan.
7. Preglejte smer in znesek.
8. Shranite osnutek; pripravljavec svojega premika ne more potrditi sam.
9. Druga pooblaščena oseba preveri dokazilo in potrdi premik. Preverite stanje **POTRJEN**.

Evidentirajte dejanski fizični dogodek, ne načrtovanega prenosa. Premike
za zaključevani poslovni dan vnesite in potrdite pred Z-poročilom.
Z-poročilo dan zaklene in onemogoči nove vnose za ta dan.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f8445d7095bc package=lite -->
### 4.3 Kontrola premika

1. Preverite, da je premik v zgodovini.
2. Primerjajte čas, znesek, vrsto in uporabnika.
3. Shranite dokazilo po internem postopku.
4. Ob koncu izmene vključite premik v pričakovano gotovino.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-426147c7411b package=lite -->
### 4.4 Napačen premik

1. Ne ustvarite prikritega nasprotnega premika brez pojasnila.
2. Zabeležite številko in napako.
3. Uporabite odobren korekcijski postopek.
4. Preverite končni učinek na blagajno in poročilo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-042db4c7bac0 package=lite -->
## 5. Štetje blagajne

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-89d50c75137d package=lite -->
### 5.1 Priprava

1. Zaprite blagajno za nove gotovinske prejemke, kadar postopek to zahteva.
2. Ločite menjalni denar, dnevni izkupiček in osebni denar.
3. Štejte bankovce in kovance po apoenih.
4. Denarja ne štejete skupaj z nezabeleženimi boni ali potrdili.
5. Uporabite obrazec oziroma zapis štetja, če ga določa enota.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-468868c8a849 package=lite -->
### 5.2 Uskladitev

1. Primerjajte prešteto gotovino s pričakovano gotovino.
2. Upoštevajte začetni polog in vse blagajniške premike.
3. Preverite gotovinske račune in vračila.
4. Ob razliki štejte še enkrat z drugo osebo, kadar je mogoče.
5. Preverite očitne napake v apoenih in smeri premikov.
6. Razliko evidentirajte oziroma eskalirajte po politiki podjetja.

Kartičnega prometa ne dodajajte v fizično gotovino. Kartica se usklajuje s
terminalskim poročilom, ne s predalom blagajne.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-bafbd82d2222 package=lite -->
## 6. X poročilo

X poročilo je vmesni operativni pregled prometa.

Ne zaključuje poslovnega dne in ne nadomešča Z poročila.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-4093f7f5ae32 package=lite -->
### 6.1 Uporaba

1. Odprite poročila oziroma dnevni izkaz.
2. Izberite pravilen datum, enoto in blagajno.
3. Izberite X poročilo oziroma vmesni pregled.
4. Preverite promet po plačilnih metodah.
5. Primerjajte gotovino s trenutnim štetjem.
6. Primerjajte kartice s terminalskim stanjem.
7. Razlike raziskujte pred zaključkom dneva.

X poročilo lahko izdate večkrat. Uporabite ga med menjavo osebja ali pred
vmesnim pologom, ne kot dokaz končnega zaprtja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-671489a385b8 package=lite -->
## 7. Z poročilo in poslovni dan

Z poročilo je zaključni izkaz poslovnega dne za izbrano blagajno oziroma
organizacijsko nastavitev.

Poslovni dan ni nujno enak koledarskemu dnevu, če enota posluje čez polnoč.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e77a9ae84265 package=lite -->
### 7.1 Pred Z poročilom

1. Preverite, ali so odprti računi in nejasna terminalska plačila.
2. Preverite FURS opozorila in neuspele registracije.
3. Zaključite oziroma evidentirajte blagajniške premike.
4. Izvedite končno štetje gotovine.
5. Pridobite terminalski zaključek, kadar ga zahteva ponudnik.
6. Preverite, da izbirate pravo enoto, blagajno in poslovni datum.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7ab529e43a2f package=lite -->
### 7.2 Izvedba Z poročila

1. Odprite dnevni izkaz oziroma Z poročila.
2. Izberite poslovni dan.
3. Preglejte število računov, vračil in storno dokumentov.
4. Preglejte promet po plačilnih metodah.
5. Preglejte gotovino, pologe in dvige.
6. Preglejte opozorila in odprte izjeme.
7. Potrdite Z poročilo samo, ko je pregled zaključen.
8. Natisnite oziroma arhivirajte poročilo po pravilih podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c5e74b55839e package=lite -->
### 7.3 Po Z poročilu

1. Preverite, da je poslovni dan označen kot zaključen.
2. Preverite morebitne račune brez EOR oziroma FURS napake.
3. Preverite pričakovano zaključeno stanje blagajne.
4. Denar predajte oziroma položite po internem postopku.
5. Ne izdajajte novih računov v že zaprti poslovni dan.

Če ugotovite napako po Z poročilu, ne odpirajte dneva samovoljno. Zabeležite
dejstva in uporabite postopek popravka oziroma eskalacije.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-9677c9a7f2d8 package=lite -->
## 8. Operativna poročila

Operativna poročila so namenjena vodenju izmene in nadzoru poslovanja.

Ne nadomeščajo računovodskih temeljnic ali zakonske hrambe dokumentov.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-349938de1dc6 package=lite -->
### 8.1 Izbira filtra

1. Odprite **Operativna poročila**.
2. Izberite obdobje.
3. Izberite enoto, blagajno ali uporabnika, kadar je na voljo.
4. Preverite časovni obseg pred branjem številk.
5. Uporabite isti filter pri primerjavi dveh poročil.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-874aca79ebdd package=lite -->
### 8.2 Ključni pregledi

Redno pregledujte:

1. realizacijo in število računov;
2. promet po načinu plačila;
3. prodajo po artiklih in kategorijah;
4. popuste, vračila in stornacije;
5. promet po natakarju oziroma izmeni;
6. odprta in zaključena naročila;
7. odpad ter porabo, kadar je vključena v poročilo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-54099a7f6dc3 package=lite -->
### 8.3 Interpretacija razlik

1. Najprej preverite filter obdobja in enoto.
2. Nato preverite, ali poročilo vključuje storne in vračila.
3. Ločite datum računa od datuma poslovnega dne, če se razlikujeta.
4. Primerjajte kartični promet s terminalskim poročilom.
5. Primerjajte gotovino z računi in blagajniškimi premiki.
6. Ne sklepajte o napaki ERP samo iz enega operativnega pogleda.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d88efc637790 package=lite -->
## 9. POS→ERP: temeljnice in prenos

POS→ERP prenaša poslovne dogodke v računovodsko obdelavo prek temeljnic oziroma
knjižb.

POS je izvor prodajnega dogodka; ERP je okolje za računovodsko obdelavo,
kontiranje in nadaljnje poročanje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1998857b0961 package=lite -->
### 9.1 Predpogoji prenosa

1. Poslovni dan je zaključen, če proces to zahteva.
2. Konti za temeljnice so nastavljeni in veljavni.
3. Enota ima pravilno povezavo s stroškovnim mestom.
4. Računi, plačila, storna in premiki imajo pregledano stanje.
5. Uporabnik ima pravico za pregled ali izvoz temeljnic.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-07a5d5da6edb package=lite -->
### 9.2 Pregled temeljnic

1. Odprite **Temeljnice** oziroma pregled POS→ERP.
2. Izberite obdobje in enoto.
3. Preverite vir dokumenta, datum in referenco.
4. Preverite bremena in dobropise.
5. Preverite konte, DDV in stroškovno mesto.
6. Preverite, da se zneski uravnotežijo.
7. Preglejte opozorila ali postavke brez ustreznega konta.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-deccff54a68e package=lite -->
### 9.3 Pošiljanje oziroma knjiženje

1. Izberite samo pregledane temeljnice.
2. Preverite, da istega obdobja ne pošiljate dvakrat.
3. Izvedite prenos po odobrenem postopku.
4. Počakajte na dokončni rezultat.
5. Preverite status prenosa za vsako temeljnico.
6. V ERP preverite prejeto referenco in zneske.
7. Arhivirajte dokaz prenosa po interni politiki.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e9cb701dce48 package=lite -->
### 9.4 Neuspešen prenos

1. Ne pošiljajte znova na slepo.
2. Zabeležite referenco temeljnice in sporočilo napake.
3. Preverite manjkajoči ali neustrezen konto.
4. Preverite enoto in stroškovno mesto.
5. Popravite nastavitev samo s pooblastilom.
6. Ponovno ustvarite oziroma pošljite samo neuspešni del po postopku.
7. Preverite, da ni nastal dvojni zapis v ERP.

Poročilo, ki ne more ustvariti veljavne temeljnice, ni rešeno z ročnim
ignoriranjem. Napaka mora ostati vidna do pravilne kontne obravnave.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d706fe542b46 package=lite -->
## 10. Končni kontrolni seznam

Pred dokončnim odhodom preverite:

1. morebitna evidenca odmora je urejena po odobrenem kadrovskem postopku;
2. izmena je zaprta in njen povzetek pregledan;
3. gotovina je prešteta in razlika pojasnjena;
4. vsak polog in dvig ima evidenco;
5. X poročilo je uporabljeno le kot vmesni pregled;
6. Z poročilo je izdelano za pravi poslovni dan;
7. FURS izjeme imajo določen naslednji korak;
8. operativna poročila imajo pravilen filter;
9. temeljnice POS→ERP so uravnotežene in uspešno prenesene;
10. neuspešni prenosi niso podvojeni in so eskalirani.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-01a0a02da61a package=lite -->
## 11. Zaslon izmene in odgovornost blagajne

Izmena pripada osebi, odgovornost blagajne pa pripada blagajni oziroma
registru. Ti dve stvari sta povezani, vendar nista vedno isti.

Natakar lahko dela v eni izmeni na več registrih, če to dovoljuje politika.

Več natakarjev lahko uporablja isti register, vendar mora predaja jasno
razmejiti odgovornost, čas in fizično gotovino.

Ne sklepajte, da je oseba, prijavljena na register, samodejno odgovorna za
celoten poslovni dan.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a7310cff4496 package=lite -->
### 11.1 Polja kartice izmene

| Polje | Pomen | Preverjanje |
|---|---|---|
| Uporabnik | Oseba, ki je odprla izmeno | Ne uporabljajte skupnega uporabnika. |
| Enota | Poslovna enota dela | Mora ustrezati dejanski lokaciji. |
| Register | Blagajna oziroma POS naprava | Ločite register od osebne izmene. |
| Začetek | Čas odprtja izmene | Preverite nenavadno zgodnje odprtje. |
| Konec | Čas zaključka | Odprta izmena nima končnega časa. |
| Odmor | Plačan ali neplačan odmor z začetkom in koncem | Preverite vrsto in odprtost odmora na osebni izmeni; predaje blagajne ne štejte kot odmor. |
| Računi | Število pripisanih računov | Primerjajte z dejavnostjo izmene. |
| Gotovina | Gotovinska plačila in premiki | Ne enačite je s kartičnim prometom. |
| Razlika | Pričakovano proti preštetemu | Zahteva ponovni pregled in razlog. |
| Status | Osnutek, odprto, v potrditvi, potrjeno ali zavrnjeno | Status določa naslednji dovoljen korak. |
| Opomba | Poslovna razlaga izjem | Pišite dejstva, reference in čas. |

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-780ffc73536e package=lite -->
### 11.2 Odpiranje izmene: podroben postopek

1. Prijavite se s svojo prijavo, ne s prijavo sodelavca.
2. Odprite **Izmene** in izberite **Nova izmena**.
3. Preverite enoto, register in poslovni dan.
4. Preštejte začetni menjalni denar po apoenih.
5. Vnesite začetno gotovino, če obrazec to zahteva.
6. Primerjajte začetni znesek z zapisom predhodne predaje.
7. Označite razliko pred začetkom prodaje, ne ob koncu izmene.
8. Potrdite odprtje in preverite status odprto.
9. Šele nato sprejemajte račune, za katere ste odgovorni.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-0a534ebf47d2 package=lite -->
### 11.3 Register brez osebne izmene

V nekaterih enotah je register odprt ves dan, osebne izmene pa se menjajo.

Pri taki ureditvi ne zapirajte registra ob vsaki menjavi osebe.

Zabeležite predajo: ura, predajalec, prevzemnik, šteta gotovina in odprte izjeme.

Vodja določi, ali se odgovornost deli po izmenah, uporabnikih ali registru.

Poročilo filtrirajte po pravilnem ključu; promet registra ni nujno promet osebe.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5b15a60efe9e package=lite -->
### 11.4 Osebna izmena brez lastnega predala

Če več oseb uporablja isti predal, naj se gotovina šteje ob predaji skupaj.

Osebna poročila uporabite za prodajo in aktivnost, ne kot dokaz osebnega
fizičnega primanjkljaja brez dogovorjene predaje.

Ne pripisujte razlike zadnji osebi samo zato, ker je zaključila register.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e236179cf025 package=lite -->
## 12. Odmori, predaja in odprta naročila

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-290e81bdc6a4 package=lite -->
### 12.1 Odmor

Odmor pomeni začasno prekinitev dela uporabnika, ne avtomatskega zaključka
njegove odgovornosti.

Pred odmorom preverite, ali lahko drug uporabnik prevzame odprta naročila.

Ne puščajte svoje prijave odklenjene na skupni napravi.

Na strani **Izmene** pri svoji aktivni izmeni izberite **Plačan odmor**
ali **Neplačan odmor** glede na dejanski dogovor. Ob vrnitvi kliknite
**Zaključi odmor**. Hkrati je dovoljen samo en odprt odmor; dokler je
odmor odprt, izmene ni mogoče zaključiti. Neplačani odmor zmanjša efektivne
ure, plačani pa ne.

Med odprtim odmorom natakar ni na voljo za pripis pri izdaji računa;
račun se lahko izda brez natakarja. To ni razlog za izmišljeno odjavo ali
odpiranje druge izmene. Če čas odmora ni pravilen ali je oseba pozabila
zaključiti odmor, zabeležite dejanski čas in predajte sledljiv popravek
vodji v **Obračun ur**. Ne ustvarjajte izmišljene nove izmene.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-552fc0b46a7a package=lite -->
### 12.2 Predaja med osebjem

| Predmet predaje | Predajalec preveri | Prevzemnik potrdi |
|---|---|---|
| Gotovina | Štetje po apoenih in zadnji premik | Prešteti znesek ter čas predaje. |
| Odprta naročila | Mizo, znesek, status in posebnost | Kdo nadaljuje strežbo. |
| Nejasno plačilo | Referenco, čas in terminal | Da plačilo ni sprejeto dvakrat. |
| Vračila | Odprte zahtevke in dovoljenja | Naslednji korak in odgovorno osebo. |
| Pologi | Dokazilo, znesek in sklic | Ali je fizični denar dejansko predan. |
| Izjeme FURS | Referenco in stanje poskusa | Ali je potrebna eskalacija. |

Predaja ni zgolj ustna informacija ob vratih.

Zapisan podatek mora omogočati, da naslednja oseba preveri stanje brez ugibanja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2959fe6a3ce3 package=lite -->
### 12.3 Odprta naročila

Odprto naročilo še ni zaključen račun in še ni nujno plačilo.

Pred zaključkom izmene preglejte vsa odprta naročila na svoji enoti.

Za vsako določite naslednji korak: zaključek, predaja, preklic po postopku
ali preiskava napake.

Ne zapirajte odprtega naročila z naključno plačilno metodo zato, da bi seznam
postal prazen.

Če gost odide brez plačila, uporabite postopek podjetja z razlogom in
odobritvijo, ne lažnega gotovinskega plačila.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-55491efc0f53 package=lite -->
### 12.4 Nejasna kartična plačila

Plačilo je nejasno, kadar terminal potrdi, POS ne potrdi, ali obratno.

Najprej preverite znesek, čas, zadnje štiri številke kartice, referenco
terminala in status računa.

Gosta ne bremenite drugič, dokler ne preverite prvega poskusa.

Če plačilo ni jasno do zaključka, ga označite, zabeležite dejstva in ga
predajte vodji po postopku enote.

Kartičnega izpiska ne nadomeščajte z domnevo, da je “verjetno uspelo”.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-ea209ee6897b package=lite -->
### 12.5 Primer predaje

Ana ob 15:00 preda register Borutu.

Preštejeta 180,00 EUR menjalnega denarja in 426,50 EUR dnevne gotovine.

Odprti sta mizi 4 in 12, pri mizi 12 pa je kartica v obdelavi.

Ana zapiše številko naročila, čas poskusa in referenco terminala.

Borut prevzame fizično gotovino in odprti naročili ter zabeleži čas predaje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8b9c5f126449 package=lite -->
## 13. Blagajniški pologi in dvigi

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5d309890712c package=lite -->
### 13.1 Razlika med pologom in dvigom

Polog poveča fizično gotovino v blagajni.

Dvig zmanjša fizično gotovino v blagajni.

Prodaja z gotovino ni polog.

Vračilo gotovine gostu ni samodejno dvig; sledi postopku vračila računa.

Premik vedno potrebuje poslovni razlog in sled.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1bfbf03f5a0d package=lite -->
### 13.2 Polja zaslona premika

| Polje | Navodilo |
|---|---|
| Enota | Izberite enoto fizične blagajne. |
| Register | Izberite predal, iz katerega denar potuje. |
| Vrsta | Polog ali dvig; pred potrditvijo preverite smer. |
| Znesek | Vpišite dejansko šteti znesek. |
| Razlog | Izberite natančen odobren razlog. |
| Sklic | Dodajte številko kuverte, sefa ali dokazila. |
| Opomba | Navedite dejstvo, čas in morebitno pričo. |
| Uporabnik | Preverite, da je prijavljen dejanski izvajalec. |
| Datum | Preverite poslovni dan, posebej okoli polnoči. |

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3771de8c1c6b package=lite -->
### 13.3 Polog menjalnega denarja

Polog menjalnega denarja opravite pred prodajo ali ob dokumentirani predaji.

Preštejte apoene in znesek vnesite enkrat.

Če je polog iz sefa, navedite sklic sefa ali kuverte po politiki enote.

Fizični denar položite v predal neposredno ob potrditvi.

Ne evidentirajte pologa, če denar ostane na mizi ali pri drugi osebi.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7e90f24a1031 package=lite -->
### 13.4 Dvig v sef ali banko

Pred dvigom preštejte denar s pričo, kadar je tako določeno.

Vnesite znesek, razlog in sklic kuverte oziroma pologa.

Denar takoj fizično odstranite iz predala.

Dokazilo o predaji hranite skupaj z dnevno dokumentacijo po pravilih podjetja.

Dvig v sef še ni bančni polog; ne poročajte ga kot banko brez dejanske predaje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c5497403e7ff package=lite -->
### 13.5 Napačen premik

Napačne smeri ne prikrivajte z novim premikom brez pojasnila.

Zapišite številko napačnega premika, čas, fizično stanje in pravilno stanje.

Odgovorna oseba uporabi korekcijski postopek, ki ohrani revizijsko sled.

Po korekciji preverite pričakovano gotovino, zgodovino premikov in dokazila.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e45a6002e1a3 package=lite -->
## 14. Pričakovana in prešteta gotovina

Pričakovana gotovina je sistemski izračun iz začetka, gotovinskih računov,
vračil in potrjenih premikov.

Prešteta gotovina je fizični znesek bankovcev in kovancev v predalu ob štetju.

Razlika je prešteta minus pričakovana gotovina, skladno z oznako na zaslonu.

Vedno preberite oznako predznaka, ne razlagajte minusa na pamet.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-02ce62ff0f03 package=lite -->
### 14.1 Formula

Pričakovano = začetna gotovina + gotovinske prodaje + pologi

minus vračila gotovine minus dvigi.

Kartice, nakazila, boni in drugi negotovinski načini niso fizična gotovina.

Če sistem prikazuje drugo formulo, upoštevajte njegovo poimenovanje in preverite
vključene tipe plačil v poročilu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b66d169f3a55 package=lite -->
### 14.2 Štetje po apoenih

1. Ločite menjalni denar od kuvert za dvig.
2. Ločite osebni denar, ki ne sodi v blagajno.
3. Preštejte bankovce po apoenih.
4. Preštejte kovance po apoenih.
5. Vnesite število kosov ali skupni znesek po pravilih obrazca.
6. Druga oseba naj ponovno prešteje pri pomembni razliki.
7. Primerjajte seštevek z vnesenim zneskom.
8. Šele nato potrdite štetje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-514978d4e9d8 package=lite -->
### 14.3 Primer uskladitve

Začetni menjalni denar je 150,00 EUR.

Gotovinski računi znašajo 620,00 EUR.

Polog menjalnega denarja je 50,00 EUR.

Dvig v sef znaša 500,00 EUR.

Vračilo gostu znaša 20,00 EUR.

Pričakovana gotovina je 300,00 EUR.

Če preštejete 297,00 EUR, je razlika 3,00 EUR manjka.

Pred evidentiranjem še enkrat preverite apoene, vračilo in smer dviga.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-96cff12a13d5 package=lite -->
### 14.4 Razlika

Razlika ni razlog za prilagajanje zneska štetja.

Ponovno štetje izvedite brez prejšnjega rezultata pred očmi, kadar je mogoče.

Preverite zadnje gotovinske račune, vračila in premike.

Preverite, ali kuverta z dvigom ni še vedno v predalu.

Zapišite ugotovljeni razlog ali dejstvo, da razlog še ni znan.

Vodja razreši razliko po internem pravilniku.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-99a97b1113a5 package=lite -->
## 15. Poslovni dan, časovni pas in X/Z poročila

Poslovni dan je obračunski rez POS, ne nujno koledarski dan.

Sistem uporablja časovni pas **Europe/Ljubljana**, kadar je tako nastavljeno
za poslovno enoto.

To pomeni, da se prehod poletnega in zimskega časa obravnava v lokalnem času.

Ne primerjajte UTC časa integracije z lokalnim časom računa brez pretvorbe.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7d7923ed6986 package=lite -->
### 15.1 Enota, ki dela čez polnoč

Vodja določi uro reza poslovnega dne skladno z nastavitvijo enote.

Račun ob 00:30 lahko pripada prejšnjemu poslovnemu dnevu, če se izmena še ni
zaključila po določenem rezu.

Pri poročilu preverite oznako poslovnega datuma, ne samo datum in uro računa.

Ne zaključujte dneva zgodaj samo zato, ker koledar pokaže polnoč.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-08cb36e315f2 package=lite -->
### 15.2 X poročilo

X poročilo je vmesni pogled in ga lahko ustvarite večkrat.

Ne zaklene prometa in ne pomeni zaključka poslovnega dne.

Uporabite ga za nadzor pred predajo, pred pologom ali med izmeno.

Na X poročilu preverite promet po plačilih, vračila, popuste in trenutno
pričakovano gotovino.

X poročilo označite s časom, če ga prilagate interni predaji.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-eed574c73660 package=lite -->
### 15.3 Z poročilo

Z poročilo je končni izkaz za poslovni dan oziroma blagajno po nastavitvi.

Pred izvedbo preverite odprta naročila, nejasna plačila, FURS izjeme in štetje.

Preverite enoto, register in poslovni datum na potrditvenem zaslonu.

Po potrditvi preverite številko poročila, status in arhivski izpis.

Z poročila ne izvajajte dvakrat zaradi počasnega odziva zaslona; najprej
preverite zgodovino in status prve zahteve.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f295f324cac9 package=lite -->
### 15.4 Dnevni izkaz

Dnevni izkaz združuje promet in pomembne zaključne informacije za izbrani rez.

Preverite obdobje, enoto, register, plačilne metode, storne in vračila.

Primerjajte gotovino z zapisom štetja in kartice s poročilom terminala.

Različna poročila se ujemajo šele, ko uporabljajo isti poslovni datum in filter.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b0a21d85d689 package=lite -->
## 16. Operativna poročila, filtri in izvoz

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6218105e9f76 package=lite -->
### 16.1 Pravilo filtra

Pred branjem številke povejte, kateri poslovni datum, enoto, register,
uporabnika in status poročilo vključuje.

Filter z “vse enote” ni primerljiv s filtrom posamezne enote.

Filter datuma računa ni vedno enak filtru poslovnega dne.

Pri primerjavi dveh poročil zapišite oba filtra.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3287027cab92 package=lite -->
### 16.2 Referenca poročil

| Poročilo | Vprašanje, na katero odgovarja | Obvezna kontrola |
|---|---|---|
| Promet po plačilih | Kako je bil promet poravnan | Isti poslovni datum in stornacije. |
| Prodaja po artiklih | Kaj je bilo prodano | Količina, neto/bruto in kategorija. |
| Popusti | Kdo in zakaj je znižal ceno | Pravice, razlog in referenca računa. |
| Vračila | Kaj je bilo vrnjeno | Povezava z izvirnim računom. |
| Odprta naročila | Kaj ni zaključeno | Naslednji odgovorni korak. |
| Izmene | Kdo je delal in kdaj | Osebna izmena proti registru. |
| Blagajna | Pričakovano in prešteto gotovino | Premiki, vračila in štetje. |
| Zalogovni odpad | Kje je nastala izguba | Artikel, razlog in obdobje. |

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2a6ddc06d641 package=lite -->
### 16.3 Izvoz

Pred izvozom nastavite enake filtre kot na pregledanem zaslonu.

Preverite obliko izvoza, decimalno ločilo in časovni pas, kadar so na voljo.

Ime datoteke naj vsebuje poročilo, poslovni datum, enoto in čas izvoza.

Izvoz ne spreminjajte ročno, če je namenjen računovodskemu usklajevanju.

Če ga je treba dopolniti, ohranite izvorno datoteko in ločite delovno kopijo.

Osebne podatke v izvozu obravnavajte skladno s pravicami in politiko podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5c3f8e7d4f5b package=lite -->
### 16.4 Razlaga odstopanj

Najprej preverite filter in časovni pas.

Nato preverite status dokumentov in vključena vračila.

Potem preverite, ali gre za operativno poročilo ali računovodski pogled.

Šele nato preverjajte integracijo POS–ERP.

Ena številka brez konteksta ni dokaz napake v sistemu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7070b65ad4f9 package=lite -->
## 17. POS–ERP: dnevni žurnal in kontiranje

POS ustvari prodajne dogodke; ERP jih prejme kot dnevne žurnale oziroma temeljnice
po nastavljeni integraciji.

Dnevni žurnal naj ima jasno referenco POS enote, poslovnega dne in prenosa.

Ne ustvarjajte ročnega ERP zapisa namesto neuspelega žurnala brez uskladitve
z računovodstvom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6f5862f8c195 package=lite -->
### 17.1 Pred pošiljanjem

1. Preverite, da je pravi poslovni dan zaključen.
2. Preverite status Z poročila, kadar ga proces zahteva.
3. Preverite odprte izjeme plačil, storne in vračila.
4. Preverite, da so konti in stroškovna mesta nastavljeni.
5. Preverite, da skupno breme ustreza skupnemu dobropisu.
6. Preverite, da en dan ni že uspešno prenesen.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a3027ea6311a package=lite -->
### 17.2 Polja žurnala

| Polje | Pomen | Kontrola |
|---|---|---|
| Poslovni datum | Datum obračunskega reza POS | Ujema se z Z/dnevnim izkazom. |
| Enota | Izvor prometa | Ujema se s stroškovnim mestom. |
| Referenca | Enolični identifikator prenosa | Uporabite ga pri podpori in ERP preverjanju. |
| Status | Čakanje, v obdelavi, uspešno ali neuspešno | Ne ponavljajte brez branja statusa. |
| Konto | Računovodska razvrstitev dogodka | Mora biti veljaven za vrsto knjižbe. |
| Stroškovno mesto | Organizacijska razporeditev | Mora ustrezati enoti oziroma pravilu. |
| DDV koda | Davčna obravnava | Primerjajte s prometom po stopnjah. |
| Bremeni | Debitna stran | Seštevek preverite na ravni žurnala. |
| Dobropisi | Kreditna stran | Seštevek mora uravnotežiti breme. |

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8ac211d53519 package=lite -->
### 17.3 Preslikava kontov

Preslikava določa, kateri konto prejme posamezno vrsto prometa.

Tipično ločuje gotovino, kartice, druge načine plačila, prihodek, DDV,
popuste, vračila in blagajniške premike po politiki podjetja.

Spremembo preslikave opravi samo pooblaščena oseba.

Pred spremembo zapišite staro pravilo, novo pravilo, datum veljavnosti in razlog.

Ne izberite “podobnega” konta samo zato, da bi prenos postal zelen.

Konto mora biti veljaven za vrsto knjižbe in računovodsko politiko podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2d0b46b67083 package=lite -->
### 17.4 Statusi in ponovni poskus

Status čakanje pomeni, da žurnal še ni poslan ali obdelan.

Status v obdelavi pomeni, da počakate na končni odgovor, ne da kliknete znova.

Status uspešno pomeni, da preverite referenco tudi v ERP.

Status neuspešno pomeni, da preberete konkretno napako in odpravite njen vzrok.

Ponovni poskus uporabite samo za določen neuspešen žurnal in šele po preverjanju,
da v ERP ni že nastal zapis z isto referenco.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-ebb6c20635db package=lite -->
### 17.5 Pogoste napake kontiranja

Manjkajoči konto zahteva nastavitev, ne ročnega ignoriranja vrstice.

Neveljaven tip konta zahteva izbiro pravilnega konta.

Manjkajoče stroškovno mesto zahteva preverjanje enote ali konfiguracije.

Neuravnotežen žurnal zahteva pregled izvornih vrstic, ne ročno spreminjanje seštevka.

Napačna DDV koda zahteva davčni pregled po postopku podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8303bdd9c512 package=lite -->
### 17.6 Uskladitev POS–ERP

1. Izberite isti poslovni datum in enoto v obeh sistemih.
2. Primerjajte referenco žurnala z ERP dokumentom.
3. Primerjajte skupni promet brez in z DDV po pravilih podjetja.
4. Primerjajte plačilne metode s pripadajočimi konti.
5. Primerjajte DDV po stopnjah oziroma kodah.
6. Primerjajte vračila, storne, popuste in premike.
7. Preverite uravnoteženost bremen in dobropisov.
8. Zabeležite rezultat ter odprte razlike.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8eb49a8c813b package=lite -->
### 17.7 Primer dnevnega prenosa

POS dnevni izkaz kaže 1.200,00 EUR gotovine in 2.800,00 EUR kartic.

Vračila znašajo 100,00 EUR, popusti pa so že vključeni v promet po pravilih poročila.

Računovodstvo primerja žurnal s pravilom, ki ga uporablja podjetje: bruto ali neto
prihodek, DDV ločeno in plačilna sredstva na ločenih kontih.

Ne seštevajte različnih osnov brez razumevanja, ali poročilo že vsebuje DDV,
vračila ali storne.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c97b259d14c6 package=lite -->
## 18. Odpravljanje težav

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1d7e64f8c24b package=lite -->
### 18.1 Izmene ni mogoče zapreti

Preverite odprta naročila.

Preverite, ali je zahtevano štetje gotovine.

Preverite nejasna plačila in zahtevana pojasnila.

Preberite sporočilo zaslona in zapišite referenco izjeme.

Ne odpirajte druge izmene za iste račune kot obvoz.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c2c69a5c714b package=lite -->
### 18.2 Gotovina se ne ujema

Ponovno preštejte po apoenih.

Preverite začetni znesek.

Preverite pologe, dvige, vračila in zadnje gotovinske račune.

Preverite, ali denar za polog ni v kuverti zunaj predala.

Zabeležite razliko in sledite eskalacijskemu postopku.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b611bdd0b4e4 package=lite -->
### 18.3 Kartice se ne ujemajo s terminalom

Primerjajte isto obdobje in isti terminal.

Preverite nejasne, zavrnjene in podvojene poskuse.

Preverite vračila kartic in zaključek terminala.

Ne popravljajte kartične razlike z gotovinskim premikom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1a8a2e60010e package=lite -->
### 18.4 Žurnal se ne prenese

Preverite status in referenco žurnala.

Preverite, ali ERP že vsebuje isto referenco.

Preberite napako za konto, DDV, stroškovno mesto ali povezavo.

Odpravite vzrok z osebo, ki ima pravico do nastavitve.

Ponovite samo neuspešni prenos in preverite rezultat.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-439a5822ddaf package=lite -->
## 19. Kontrolni seznami, vaje in preverjanje znanja

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f03ba1714d6f package=lite -->
### 19.1 Pred zaključkom izmene

- [ ] Osebna izmena in register sta pravilno določena.
- [ ] Morebitna evidenca odmora je urejena po odobrenem kadrovskem postopku.
- [ ] Odprta naročila imajo naslednji korak.
- [ ] Nejasna plačila imajo zapis in odgovorno osebo.
- [ ] Vsi pologi in dvigi imajo razlog ter dokazilo.
- [ ] Gotovina je prešteta po apoenih.
- [ ] Razlika je preverjena in pojasnjena oziroma eskalirana.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2e1577f3e458 package=lite -->
### 19.2 Pred Z poročilom

- [ ] Izbran je pravilen poslovni dan Europe/Ljubljana.
- [ ] Preverjeni so odprti računi in FURS izjeme.
- [ ] Preverjen je terminalski zaključek, kadar je potreben.
- [ ] Uporabljen je pravilen register in enota.
- [ ] X poročilo ni zamenjano z Z poročilom.
- [ ] Končno štetje gotovine je dokumentirano.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-19a3778fa9d6 package=lite -->
### 19.3 Pred POS–ERP prenosom

- [ ] Dnevni izkaz in žurnal uporabljata isti rez.
- [ ] Status ni že uspešno prenesen.
- [ ] Žurnal je uravnotežen.
- [ ] Konti, DDV kode in stroškovna mesta so veljavni.
- [ ] Referenca je pripravljena za preverjanje v ERP.
- [ ] Neuspeh ima odpravljeno konkretno napako.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1c518e2ab4e5 package=lite -->
### 19.4 Vaja: štetje

Začetna gotovina je 200,00 EUR.

Gotovinski promet je 480,00 EUR.

Dvig v sef je 500,00 EUR.

Vračilo v gotovini je 15,00 EUR.

Kolikšna je pričakovana gotovina?

Odgovor: 165,00 EUR.

Če je prešteto 170,00 EUR, ali razliko prikrijete z dvigom?

Odgovor: ne; razliko ponovno preverite in evidentirate po postopku.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c5255575cf29 package=lite -->
### 19.5 Vaja: odprto naročilo

Ob predaji je odprta miza s kartičnim plačilom brez jasnega odgovora terminala.

Katera dva dokumenta najprej primerjate?

Odgovor: status POS računa in referenco oziroma poročilo terminala.

Ali gosta samodejno ponovno bremenite?

Odgovor: ne; prvi poskus se mora najprej razjasniti.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a6268aa5f264 package=lite -->
### 19.6 Preverjanje znanja

1. Ali X poročilo zaključi poslovni dan?

Pravilni odgovor: ne; je vmesni operativni pregled.

2. Ali je polog gotovinska prodaja?

Pravilni odgovor: ne; je fizični premik denarja z razlogom.

3. Kaj pomeni status žurnala “v obdelavi”?

Pravilni odgovor: počakajte na končni odgovor in ne pošiljajte znova.

4. Ali lahko isti poslovni dan pred polnočjo in po njej pripadata istemu rezu?

Pravilni odgovor: da, kadar tako določa poslovni dan enote.

5. Kaj najprej preverite ob neuspelem ERP prenosu?

Pravilni odgovor: status, referenco in konkretno sporočilo napake.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-55fcb8ed59ef package=lite -->
## 20. Referenčni postopki po vlogah

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-36e908d3a7a9 package=lite -->
### 20.1 Natakar oziroma blagajnik

Odpre lastno izmeno na pravilni enoti.

Preveri začetni menjalni denar.

Zaklene prijavo pred predajo ali začasno odsotnostjo.

Ob predaji prešteje gotovino s prevzemnikom.

Označi odprta naročila in nejasna plačila.

Vnese samo dejanske pologe in dvige.

Ob koncu prešteje predal po apoenih.

Razlike ne prikriva z novim računom ali premikom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-eadfe49d8a50 package=lite -->
### 20.2 Vodja izmene

Preveri, kdo je odgovoren za register.

Odobri izjeme skladno s svojimi pravicami.

Preveri odprte račune in predaje; odmor se vodi po odobrenem kadrovskem postopku.

Preveri nepojasnjene blagajniške razlike.

Zagotovi dokazilo za polog oziroma dvig.

Preveri poslovni datum pred Z poročilom.

Razporedi odgovornost za nerešene izjeme.

Ne potrjuje dejstev, ki jih ni mogoče preveriti.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3281e80d4ee7 package=lite -->
### 20.3 Računovodstvo

Primerja dnevni izkaz in POS žurnal.

Preveri kontiranje po plačilnih metodah.

Preveri DDV kode in davčne osnove.

Preveri stroškovna mesta poslovnih enot.

Preveri uravnoteženost žurnala.

V ERP poišče referenco uspešnega prenosa.

Dokumentira uskladitev in odprte razlike.

Ne spreminja POS prometa brez sledljivega postopka.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-704019f70baa package=lite -->
### 20.4 Skrbnik nastavitev

Upravlja pravice, ne deli skupnih prijav.

Vzdržuje pravilne registre in poslovne enote.

Nastavi časovni pas Europe/Ljubljana.

Vzdržuje pravila za poslovni dan.

Vzdržuje preslikave kontov z odobritvijo.

Testira spremembo na odobren način.

Zapiše datum, razlog in lastnika spremembe.

Ne spreminja kontov zaradi enkratne razlike brez analize.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-fb1a776a2322 package=lite -->
## 21. Dodatni primeri uskladitve

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-aea3a77663df package=lite -->
### 21.1 Kartica in gotovina

Poročilo prikazuje 900,00 EUR kartic.

Terminal prikazuje 900,00 EUR za isti poslovni rez.

Kartice zato ne sodijo v fizično štetje predala.

Če predal vsebuje kartične potrdke, jih ne prištevajte gotovini.

Kartično razliko raziskujte na terminalu in v statusih plačil.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3622aa035fd4 package=lite -->
### 21.2 Pozni račun

Račun je izdan ob 00:10 po lokalnem času.

Poslovni dan enote se zaključi ob 02:00.

Račun lahko pripada prejšnjemu poslovnemu datumu.

V poročilu preverite poslovni datum, ne predpostavljajte koledarskega.

ERP žurnal primerjajte z istim poslovnim rezom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7890266cbb71 package=lite -->
### 21.3 Polog med izmeno

V predalu je zaradi varnosti preveč gotovine.

Dve pooblaščeni osebi preštejeta 700,00 EUR.

Blagajnik ustvari dvig v sef s sklicem kuverte.

Denar zapre v označeno kuverto in ga fizično preda.

Pričakovana gotovina se zmanjša za 700,00 EUR.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c81c48a9cd91 package=lite -->
### 21.4 Neuspešna integracija

Žurnal je neuspešen zaradi manjkajočega konta kartic.

Računovodstvo potrdi pravilen konto in datum veljavnosti.

Skrbnik popravi preslikavo po odobrenem postopku.

Uporabnik preveri, da ERP še nima iste reference.

Uporabnik ponovi samo neuspešni žurnal.

Po uspehu primerja znesek in referenco v obeh sistemih.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-489e19e48117 package=lite -->
## 22. Hitri vprašalnik pred zaključkom

Ali zaključujem svojo izmeno ali odgovornost registra?

Ali je morebitna evidenca odmora urejena po odobrenem kadrovskem postopku?

Ali imajo vse odprte mize imenovan naslednji korak?

Ali je nejasno plačilo zapisano z referenco?

Ali so vsi fizični premiki vneseni enkrat?

Ali je štetje izvedeno po apoenih?

Ali sta pričakovani in prešteti znesek jasno ločena?

Ali sem izbral pravi poslovni dan Europe/Ljubljana?

Ali je X poročilo le vmesni pregled?

Ali je Z poročilo že uspešno izvedeno?

Ali so filtri poročila zapisani?

Ali je POS žurnal uravnotežen?

Ali ERP že vsebuje isto referenco?

Ali neuspeh vsebuje konkreten naslednji korak?

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7e3c8066447f package=lite -->
## 23. Katalog zaslonov, polj in stanj

Ta katalog opisuje trenutno vedenje, razvidno iz POS zaslonov in storitev.

Imena gumbov se lahko razlikujejo glede na pravice uporabnika.

Katalog ni nadomestilo za pooblastila podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-da039eef6541 package=lite -->
### 23.1 Zaslon Izmene

Naslov zaslona je **Izmene**.

Uporabniški pogled je namenjen lastni izmeni.

Vodstveni pogled prikazuje vse izmene dostopne enote.

Kartica konteksta pokaže enoto, za katero se izmena odpira.

Kartica konteksta pokaže tudi stroškovno mesto.

Manjkajoča enota pomeni, da je odpiranje izmene onemogočeno.

Prikaz »ni nastavljeno« pri stroškovnem mestu ni isto kot manjkajoča enota.

Vodja naj manjkajoče stroškovno mesto odpravi pred računovodskim prenosom.

Gumb **Odpri izmeno** ustvari osebno delovno izmeno.

Ročna izbira natakarjevega profila je prikazana kot začasna možnost brez vezave profila.

Ročna izbira ni dokaz, da je identiteta uporabnika pravilno nastavljena.

Skrbnik naj po taki uporabi uredi vezavo uporabniškega in natakarskega profila.

Seznam aktivnih izmen pokaže ime natakarja.

Seznam aktivnih izmen označi lastno izmeno z oznako »jaz«.

Seznam lahko pokaže ime pripisane blagajne.

Polje **Začetek** je čas odprtja izmene.

Polje **Trajanje** je tekoče trajanje aktivne izmene.

Polje **Računi** šteje račune, pripisane izmeni.

Polje **Skupni promet** prikazuje skupni promet izmene.

Znesek prometa izmene ni fizično stanje predala.

Znesek prometa izmene ni nadomestilo za Z poročilo.

Plačani in neplačani odmor sta ločena zapisa pri aktivni izmeni. Pred
zapiranjem preverite, da je vsak začeti odmor zaključen: odprt odmor blokira
zaključek izmene. Aktivna izmena sama po sebi ni dokaz, da odmora ni bilo.

Po zaprtju se prikaže povzetek z začetkom in koncem.

Povzetek po zaprtju vsebuje trajanje.

Povzetek po zaprtju vsebuje število računov.

Povzetek po zaprtju vsebuje skupni promet.

Zgodovina osebnega pogleda vsebuje datum.

Zgodovina osebnega pogleda vsebuje začetek.

Zgodovina osebnega pogleda vsebuje konec.

Zgodovina osebnega pogleda vsebuje enoto oziroma blagajno, kadar sta znani.

Zgodovina osebnega pogleda vsebuje število računov in promet.

Zgodovina osebnega pogleda vsebuje stanje potrditve ur.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8d7192d80de1 package=lite -->
### 23.2 Statusi osebne izmene

`osnutek` pomeni zaprto izmeno, ki še ni poslana v potrditev.

`v_potrditvi` pomeni, da je izmena poslana v pregled.

`potrjeno` pomeni, da je potrditev zaključena.

`zavrnjeno` pomeni, da je pregledovalec zahteval popravek ali pojasnilo.

Zavrnjena izmena ni samodejno izbrisana.

Zavrnjena izmena zahteva sledljiv odgovor po internem postopku.

Uporabnik lahko pri lastnem `osnutku` uporabi **Pošlji v potrditev**.

Uporabnik lahko pri lastni `zavrnjeni` izmeni ponovno uporabi isti gumb.

Status potrditve ur ni status Z poročila.

Status potrditve ur ni status kartičnega plačila.

Status potrditve ur ni status FURS.

Aktivna izmena je določena s praznim časom konca.

Zaprta izmena ima zapisan čas konca.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-358736834218 package=lite -->
### 23.3 Osebna izmena in odgovornost registra

Osebna izmena odgovarja na vprašanje, kdo je delal.

Pripisana blagajna odgovarja na vprašanje, na katerem registru je uporabnik delal.

Z poročilo odgovarja na vprašanje, kaj se je zgodilo na posamezni blagajni v poslovnem dnevu.

Ena blagajna lahko skozi dan vključuje več osebnih izmen.

Ena osebna izmena je lahko vezana na blagajno, ki jo deli več oseb.

Promet osebne izmene se zato ne sme samodejno enačiti z dnevnim stanjem registra.

Štetje predala je odgovornost določene fizične blagajne.

Predaja predala mora določiti predajalca, prevzemnika in čas.

Predaja odprtih miz je odgovornost storitve, ne prenos denarja.

Predaja terminala je ločena od predaje gotovine.

Vodja določi, kdo sme zaključiti register oziroma poslovni dan.

Trenutni dnevni zaključek zahteva vlogo vodje ali administratorja.

Navaden uporabnik lahko izvaja X pregled le za svojo dodeljeno blagajno.

Če je uporabnik dodeljen drugi blagajni, sistem X pregled zavrne.

Če blagajna ne pripada enoti, sistem postopke zavrne.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-4973b6040dad package=lite -->
### 23.4 Zaslon Blagajniški premiki

Zaslon vsebuje seznam premikov za izbrani kontekst.

Seznam prikazuje čas premika.

Seznam prikazuje tip premika.

Seznam prikazuje znesek.

Seznam prikazuje stanje.

Seznam prikazuje opis in po potrebi opombo.

Seznam lahko prikaže povezanega dobavitelja.

Seznam razlikuje potrjen, osnutek in storniran zapis.

Zeleni status **POTRJEN** pomeni potrjen premik.

Jantarni status je namenjen zapisu, ki še ni potrjen.

Nevtralni status **STORNIRAN** kaže, da izvirnik ni več veljaven za novo obravnavo.

Storno se obravnava kot sledljiv nasprotni dogodek.

Storniranega premika ne popravljajte tako, da spreminjate fizično dokumentacijo brez zapisa.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3487713df45b package=lite -->
### 23.5 Tipi premikov

`IZPLACILO_DOBAVITELJU` je izplačilo dobavitelju iz gotovine.

Ta tip zahteva izbranega dobavitelja.

Pri uporabniškem opisu je prikazan računovodski namig D 220 / K 100.

`POLOG_GOTOVINE` je prejem gotovine oziroma menjalnega denarja.

Pri uporabniškem opisu je prikazan računovodski namig D 100 / K 109.

`DVIG_GOTOVINE` je **dvig z bančnega TRR**, ne odvzem iz predala.

Knjiženje je D 109 / K 110. Gotovino predala poveča šele ločen
prejem gotovine (`POLOG_GOTOVINE`, D 100 / K 109).

`POLOG_TRR` je polog gotovine na transakcijski račun.

Pri uporabniškem opisu je prikazan računovodski namig D 109 / K 100.

`PRILIV_TRR` je bančni priliv po predhodnem pologu, D 110 / K 109.
Vnesite ga na datum dejanskega priliva po bančnem dokazilu; ne spremeni
gotovine predala. Uskladite ga z obdelavo izpiska, da ne podvojite knjiženja.

Praktični primeri vseh petih vrst ter zaključek z menjalnim denarjem
so v razdelku **X- in Z-poročilo ter blagajniški premiki**.

`STORNO` ni tip za neposreden ročni izbor novega premika.

Storno nastane iz povezave z že potrjenim izvirnikom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-477135400c48 package=lite -->
### 23.6 Polja obrazca premika

Polje **Tip** določi poslovni pomen premika.

Polje **Znesek** vnesite kot pozitiven znesek v evrih.

Smer denarja izhaja iz tipa in ne iz negativnega predznaka.

Polje **Opis** mora pojasniti resnični poslovni razlog.

Polje **Opomba** je namenjeno dodatnemu kontekstu ali številki dokumenta.

Polje **Dobavitelj** je obvezno za izplačilo dobavitelju.

Polje **Scenarij pologa na TRR** je obvezno za `POLOG_TRR`.

Scenarij A pomeni, da menjalni denar ostane v blagajni.

Scenarij B pomeni, da je položen tudi menjalni denar.

Polje **Razlog izjeme 420 €** dokumentira izjemo pri gotovinskem plačilu dobavitelju.

Navodilo na zaslonu opozarja, da plačila nad 420 € potrebujejo dokumentiran razlog.

Če razloga ni, uporabite TRR v skladu z internimi pravili.

Ne vpisujte osebnih ali kartičnih podatkov, ki niso potrebni za dokaz premika.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-0e051293f1c8 package=lite -->
### 23.7 Zaslon X poročila

X poročilo je vmesni, nezaklenjeni posnetek izbranega poslovnega dne.

Za zahtevo je obvezen `blagajnaId`.

Poslovni datum se uporabniku prikaže kot **dd.mm.yyyy**. Če tehnična zahteva
uporablja tehnični ISO zapis, gre za notranji API-format; uporabniško polje ne sme
zahtevati ISO-zapisa.

Če datum ni podan, se uporabi trenutni poslovni datum enote.

X pokaže poslovni datum in identiteto blagajne.

X pokaže pričakovano gotovino.

X pokaže gotovinsko prodajo.

X pokaže promet dneva.

X pokaže skupni DDV.

X pokaže število računov.

X pokaže gotovino, kartice, bone, bone pica in negotovinska plačila.

X loči kartice SumUp od drugih kartic, kadar so podatki na voljo.

X pokaže napitnine.

X pokaže razčlenitev napitnin.

X pokaže že shranjeno uskladitev gotovine, če obstaja.

X pokaže blokade, ki bi preprečile Z zaključek.

X ne zaklene poslovnega dne.

X ne ponastavi grand totala.

X ne spremeni računov.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7c8c83194bfb package=lite -->
### 23.8 Polja uskladitve gotovine

Polje **Prešteta gotovina** je dejansko fizično preštet denar.

Polje **Pričakovana gotovina** se izračuna iz poslovnih dogodkov.

Polje **Razlika** je prešteta minus pričakovana gotovina.

Pozitivna razlika pomeni višek glede na izračun.

Negativna razlika pomeni manjko glede na izračun.

Polje **Razlog odstopanja** je obvezno, kadar razlika ni nič.

Polje **idempotencyKey** preprečuje, da bi isti zahtevek ustvaril več uskladitev.

Ponovljen zahtevek z istim ključem vrne obstoječi zapis.

Potrjena uskladitev brez razlike ima `confirmed = true`.

Uskladitev z razliko se lahko shrani le z razlago odstopanja.

Shranjena razlaga ni dokaz, da je vzrok že odpravljen.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b43e966bd6c9 package=lite -->
### 23.9 Zaslon zaključkov v operativnih poročilih

Poročilo **Zaključki blagajn** prikazuje rez po enoti, blagajni in poslovnem datumu.

Status `zaklenjeno` pomeni, da obstaja veljaven Z zapis.

Status `odklenjeno` pomeni, da je bil Z zapis odklenjen.

Status `blokirano` pomeni, da obstajajo pogoji, ki preprečujejo zaključek.

Status `nezakljuceno` pomeni, da za prikazani rez ni zaključka.

`manjka_uskladitev` pomeni, da fizična uskladitev gotovine ni shranjena.

`usklajeno` pomeni, da je prešteta gotovina enaka pričakovani.

`odstopanje` pomeni, da obstaja razlika z zapisanim razlogom.

Pri zapisu preverite številko Z, če je prisotna.

Pri zapisu preverite čas zaključka, če je prisoten.

Pri zapisu preverite grand total pred in po zaključku.

Pri zapisu preverite besedilo vsake blokade.

Blokada vsebuje tip, število in seznam konkretnih postavk.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6ec2c3229d31 package=lite -->
## 24. Delovni postopki: izmena, odmor in predaja

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7c9909ce5bec package=lite -->
### 24.1 Začetek osebne izmene

1. Prijavite se s svojim uporabniškim računom.

2. Odprite zaslon **Izmene**.

3. Preverite, da je prikazana prava enota.

4. Preverite prikaz stroškovnega mesta.

5. Preverite ime dodeljene blagajne, kadar je prikazano.

6. Ne odpirajte izmene, če je enota napačna ali prazna.

7. Ob manjkajoči enoti obvestite administratorja.

8. Ne rešujte manjkajoče enote z izbiro druge osebe.

9. Izberite **Odpri izmeno**.

10. Preverite, da se je vaša kartica pojavila med aktivnimi izmenami.

11. Preverite, da kartica kaže vaše ime.

12. Preverite začetni čas.

13. Če je prikazana napačna blagajna, takoj obvestite vodjo.

14. Ne izdajajte računov pod tujo odprto izmeno.

15. Če je ročna izbira profila nujna, jo zabeležite vodji.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6129e3b285d9 package=lite -->
### 24.2 Plačan in neplačan odmor

Pri aktivni izmeni na strani **Izmene** izberite **Plačan odmor** ali
**Neplačan odmor**. Ob vrnitvi izberite **Zaključi odmor** in preverite,
da oznaka **Na odmoru** ni več prikazana. Odprtega odmora ni dovoljeno
pustiti ob zaključevanju izmene; zapiranje je v tem primeru blokirano.

Pred začasno odsotnostjo zaklenite prijavo, predajte odprta naročila in
nejasne transakcije dogovorjenemu sodelavcu. Ne odpirajte druge izmene
namesto evidentiranja odmora. Nepravilnosti predajte vodji za sledljiv popravek.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-db51068129b0 package=lite -->
### 24.3 Predaja odprtih naročil

Predaja naročila ni zaprtje naročila.

Naročilo s statusom `odprto` je zapiralna blokada, kadar je v poslovnem intervalu.

Prevzemnik naj pregleda mizo, postavke in zahteve gosta.

Prevzemnik naj preveri, ali je bila naročilnica poslana v pripravo.

Predajalec naj pove, ali je gost že delno plačal.

Predajalec naj ne označi naročila kot zaključeno brez dejanske obravnave.

Pri predaji zapišite številko naročila.

Pri predaji zapišite številko ali ime mize.

Pri predaji zapišite osebo, ki prevzema.

Pri predaji zapišite čas predaje.

Pri predaji zapišite posebno obljubo gostu.

Pri predaji zapišite odprto reklamacijo ali popust.

Pri predaji zapišite stanje kuhinje, če je pomembno.

Vodja naj preveri predajo, kadar odhaja zadnja oseba izmene.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-13a1248d223f package=lite -->
### 24.4 Predaja gotovine in registra

Predajo predala izvedeta predajalec in prevzemnik skupaj.

Najprej preverita, kateri predal fizično štejeta.

Nato izvedeta štetje po apoenih.

Nato primerjata subtotal apoenov s pričakovanim stanjem.

Nato preverita premike, nastale od zadnjega štetja.

Nato preverita, ali je polog v sef dejansko predan.

Nato označita kuverto z datumom, blagajno in sklicem.

Nato podpišeta ali drugače evidentirata predajo po internem postopku.

Prevzemnik ne sme prevzeti zaprte kuverte brez znanega zneska.

Predajalec ne sme obdržati osebnega denarja v predalu.

Kartični potrdki niso gotovina.

Bonov ne prištevajte gotovini, razen če vaš dokumentiran postopek določa drugače.

Če se štetje ne ujema, razliko evidentirajte in ne prenašajte nejasnosti naprej.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f04846bda359 package=lite -->
### 24.5 Nejasno kartično plačilo

Nejasno plačilo pomeni, da rezultat terminalskega procesa ni potrjen.

Nejasno plačilo ni isto kot zavrnjeno plačilo.

Nejasno plačilo ni dovoljeno šteti kot gotovino.

Preverite znesek, čas in referenco terminala.

Preverite ponudnika in identifikator transakcije, če sta prikazana.

Preverite, ali je bil račun izdan ali je plačilo ostalo nedokončano.

Gostu ne zaračunajte drugič brez preveritve prve transakcije.

Zapišite, kdo je preverjanje prevzel.

Zapišite, kateri korak je naslednji.

V operativnih poročilih je nejasen kartični zapis prikazan ločeno.

Primer statusa iz poročila je `unknown`.

Primer napake je timeout pri preverjanju plačila.

Dokler zadeva ni razrešena, jo vključite v dnevno predajo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3db08c74596f package=lite -->
### 24.6 Zapiranje osebne izmene

Osebno izmeno zaprite šele po koncu svojega dela.

Pred zaprtjem uredite morebitno začasno odsotnost po odobrenem kadrovskem
postopku; POS ne potrjuje ločenega zaključevanja odmora.

Pred zaprtjem predajte odprte mize.

Pred zaprtjem predajte nejasna plačila.

Pred zaprtjem evidentirajte premik, če ste fizično predali denar.

Pred zaprtjem preverite, ali druga oseba prevzema register.

Izberite **Zaključi izmeno**.

Preverite prikazani povzetek.

Preverite število računov.

Preverite promet kot kontrolni podatek, ne kot štetje gotovine.

Po potrebi pošljite zaprto izmeno v potrditev.

Če vodja zavrne izmeno, ne spreminjajte zgodovine na pamet.

Dodajte zahtevano pojasnilo po pravilih podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-53949a695e46 package=lite -->
### 24.7 Priporočeni zapis predaje

Naslednji zapis je priporočilo, ne trditev o obstoječem čarovniku za predajo.

Datum in ura predaje: __________.

Enota: __________.

Blagajna oziroma predal: __________.

Predajalec: __________.

Prevzemnik: __________.

Prešteta gotovina: __________ EUR.

Številka kuverte ali sefa: __________.

Kartični terminal in zadnji pregled: __________.

Odprta naročila: __________.

Nejasna plačila: __________.

Odprte reklamacije: __________.

Razlika in razlog: __________.

Podpis oziroma potrditev predajalca: __________.

Podpis oziroma potrditev prevzemnika: __________.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-13922c819d40 package=lite -->
## 25. Gotovina: izračun, štetje in dokumentiranje

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-acfa87825673 package=lite -->
### 25.1 Trenutna formula pričakovane gotovine

Pričakovana gotovina izhaja iz nastavljenega menjalnega denarja.

Prišteje se gotovinska prodaja v poslovnem intervalu.

Prišteje se `POLOG_GOTOVINE`.

Odšteje se `IZPLACILO_DOBAVITELJU`.

Odšteje se `POLOG_TRR`.

Izračun uporablja potrjene premike.

Izračun ne vključuje premikov vrste `STORNO` kot navadnih premikov.

Zaprti oziroma stornirani računi niso vključeni v gotovinsko prodajo.

Pri deljenem plačilu se upošteva znesek gotovinskega dela.

Pri računu brez razčlenjenih zneskov se upošteva plačilna metoda računa.

Privzeti menjalni denar je 50 EUR, kadar posebna nastavitev ni najdena.

Privzeta vrednost je tehnični privzeti podatek.

Vodja naj preveri, ali je nastavitev menjalnega denarja za register pravilna.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-56809f11d72e package=lite -->
### 25.2 Delovni list štetja apoenov

Uporabite ločen list za vsak fizični predal.

Ne združujte dveh blagajn na istem listu.

Datum poslovnega dne: __________.

Čas štetja: __________.

Enota: __________.

Blagajna: __________.

Števec: __________.

Priča: __________.

500 EUR: količina ____ × 500 = ______ EUR.

200 EUR: količina ____ × 200 = ______ EUR.

100 EUR: količina ____ × 100 = ______ EUR.

50 EUR: količina ____ × 50 = ______ EUR.

20 EUR: količina ____ × 20 = ______ EUR.

10 EUR: količina ____ × 10 = ______ EUR.

5 EUR: količina ____ × 5 = ______ EUR.

2 EUR: količina ____ × 2 = ______ EUR.

1 EUR: količina ____ × 1 = ______ EUR.

0,50 EUR: količina ____ × 0,50 = ______ EUR.

0,20 EUR: količina ____ × 0,20 = ______ EUR.

0,10 EUR: količina ____ × 0,10 = ______ EUR.

0,05 EUR: količina ____ × 0,05 = ______ EUR.

0,02 EUR: količina ____ × 0,02 = ______ EUR.

0,01 EUR: količina ____ × 0,01 = ______ EUR.

Skupaj bankovci: ______ EUR.

Skupaj kovanci: ______ EUR.

Skupaj fizično: ______ EUR.

Pričakovano po X: ______ EUR.

Razlika: ______ EUR.

Razlog odstopanja: __________.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-26f1368e9e3d package=lite -->
### 25.3 Primer brez razlike

Menjalni denar znaša 100,00 EUR.

Gotovinska prodaja znaša 742,30 EUR.

Polog gotovine znaša 50,00 EUR.

Izplačilo dobavitelju znaša 20,00 EUR.

Polog na TRR znaša 600,00 EUR.

Pričakovano stanje je 272,30 EUR.

Fizično štetje da 272,30 EUR.

Razlika je 0,00 EUR.

Uskladitev lahko postane potrjena brez razloga odstopanja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1d0c9dd3ef37 package=lite -->
### 25.4 Primer manjka

Pričakovano stanje je 272,30 EUR.

Fizično štetje da 270,30 EUR.

Razlika je -2,00 EUR.

Najprej ponovno preštejte kovance.

Nato preverite vračila gostom.

Nato preverite zadnje gotovinske račune.

Nato preverite, ali je bil polog v sef pravilno evidentiran.

Nato preverite, ali je bil dvig dejansko izveden.

Če razlika ostane, shranite točno razlago.

Primer razlage je »Manjko 2,00 EUR po dvakratnem štetju; predano vodji.«

Ne uporabite opisa »napaka« brez zneska, časa in naslednjega ukrepa.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-77256e2932d6 package=lite -->
### 25.5 Primer viška

Pričakovano stanje je 272,30 EUR.

Fizično štetje da 277,30 EUR.

Razlika je +5,00 EUR.

Preverite, ali je bil prejem menjalnega denarja evidentiran.

Preverite, ali je kupec plačal več in drobiž ni bil vrnjen.

Preverite, ali je osebni denar pomotoma v predalu.

Ne ustvarite izmišljenega izplačila za izravnavo.

Ne spreminjajte preštetega zneska, da bi dosegli nič.

Zapišite višek in način predaje vodji.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-06309968e244 package=lite -->
### 25.6 Polog menjalnega denarja

Polog menjalnega denarja pomeni fizični prejem denarja v predal.

Izberite tip `POLOG_GOTOVINE`.

V opis napišite vir denarja.

Primer opisa je »Menjalni denar iz sefa, kuverta M-042«.

Preštejte prejeti denar pred vnosom.

Označite, kdo ga je predal.

Označite, katera blagajna ga je prejela.

Po potrditvi premik poveča pričakovano gotovino.
Začetnega menjalnega denarja, ki je že vključen v nastavitvi blagajne,
ne vnesite še enkrat kot dodaten prejem. Opis izvora denarja mora
ustrezati dejanskemu dogodku in računovodskemu postopku podjetja.

Polog ni prodaja.

Polog ne poveča prometa računa.

Polog ne sme prikrivati viška od prejšnje izmene.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a4e3415781dc package=lite -->
### 25.7 Dvig gotovine v sef

Odvzem gotovine v sef zmanjša fizično stanje predala, vendar ni isto
kot **Dvig z bančnega TRR**. Med petimi ponujenimi vrstami ni posebnega
prenosa v sef ali med dvema blagajnama. Ne izberite bančnega dviga
za tak dogodek; postopek evidence uskladite z vodjo in računovodstvom.

V opis vpišite razlog dviga.

V opombo vpišite številko kuverte ali zapisnika.

Denar preštejte pred zapiranjem kuverte.

Kuverto označite z zneskom, datumom in blagajno.

Prejemnik kuverte naj prevzem potrdi po internem postopku.

Če se dvig računa kot polog na TRR, uporabite ustrezen tip in scenarij.

Ne uporabljajte dviga kot splošne oznake za neznano porabo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f7136384dd86 package=lite -->
### 25.8 Polog na TRR

`POLOG_TRR` dokumentira premik gotovine iz blagajne proti banki.

Scenarij A ohrani menjalni denar v predalu.

Scenarij B pomeni, da je v polog vključen tudi menjalni denar.

Izberite scenarij, ki ustreza dejanskemu fizičnemu dejanju.

V opis vpišite datum banke oziroma sklic pologa.

Shranite bančno potrdilo po internem arhivskem postopku.

Polog na TRR zmanjša pričakovano gotovino.

Bančni izpisek ni sam po sebi dokaz, da je bil POS premik pravilno vnesen.

POS premik in bančni izpisek primerjajte po znesku, datumu in sklicu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-9edd47f386f0 package=lite -->
### 25.9 Izplačilo dobavitelju

Uporabite ga samo za dejansko gotovinsko plačilo dobavitelju.

Izberite pravilnega partnerja.

V opis vpišite številko računa ali dobavnice.

V opombo vpišite dokazilo o prevzemu.

Znesek mora ustrezati dejansko izročeni gotovini.

Plačilo nad 420 EUR zahteva dokumentiran razlog izjeme v obrazcu.

Kadar razlog ni ustrezen, plačilo izvedite prek TRR.

Potrjeno izplačilo zmanjša pričakovano gotovino.

Ne uporabite izplačila za napitnino ali osebno posojilo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d13200317d56 package=lite -->
### 25.10 Storno premika

Storno uporabite, kadar je potrjeni izvirnik poslovno napačen.

Ne brišite sledi potrjenega izvirnika.

Vodstvena vloga lahko iz seznama začne storno potrjenega premika.

Storno mora ostati vezan na izvirni premik.

Pred stornom preverite, ali denar še fizično obstaja oziroma kam je šel.

Po storniranju po potrebi ustvarite nov, pravilen premik.

V opombo novega premika navedite povezavo na napako in popravek.

Ne stornirajte pravilnega premika samo zato, ker se fizično štetje ne ujema.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-363fb0b91031 package=lite -->
## 26. Poslovni dan v časovnem pasu Europe/Ljubljana

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-baaae49efbad package=lite -->
### 26.1 Osnovno pravilo

POS uporablja časovni pas `Europe/Ljubljana`.

Privzeti začetek poslovnega dne je 04:00.

Enota lahko nastavi drug veljaven čas med 00:00 in 23:59.

Neveljavna nastavitev časa se obravnava kot privzeti čas 04:00.

Poslovni datum ni nujno koledarski datum.

Poslovni interval se začne na poslovni datum ob nastavljeni uri.

Poslovni interval se konča naslednji koledarski dan ob isti lokalni uri.

Za interval velja spodnja meja vključena.

Za interval velja zgornja meja izključena.

To pomeni `start <= čas < end`.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-105800112d17 package=lite -->
### 26.2 Primer pri začetku ob 04:00

Poslovni dan 10.06.2026 se začne 10.06.2026 ob 04:00 v Ljubljani.

Poslovni dan 10.06.2026 se konča 11.06.2026 ob 04:00 v Ljubljani.

Račun ob 10.06.2026 03:59 pripada poslovnemu dnevu 09.06.2026.

Račun ob 10.06.2026 04:00 pripada poslovnemu dnevu 10.06.2026.

Račun ob 11.06.2026 03:59 pripada poslovnemu dnevu 10.06.2026.

Račun ob 11.06.2026 04:00 pripada poslovnemu dnevu 11.06.2026.

Enako pravilo velja za blagajniški premik.

Enako pravilo velja za preverjanje odprtih naročil.

Enako pravilo velja za Z poročilo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-68d08c2a408d package=lite -->
### 26.3 Primer pri začetku ob 02:00

Enota ima nastavljen začetek dneva 02:00.

Račun ob 01:59 pripada prejšnjemu poslovnemu datumu.

Račun ob 02:00 pripada tekočemu poslovnemu datumu.

Nočna izmena se ne sme ravnati po datumu na stenski uri.

Poročilo vedno filtrirajte po poslovnem rezu, kadar preverjate Z.

ERP primerjavo izvedite z istim poslovnim datumom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-fe1779bff78e package=lite -->
### 26.4 Prehod na poletni čas

V noči na prehod na poletni čas lokalna ura preskoči naprej.

Lokalni interval poslovnega dne se izračuna v `Europe/Ljubljana`.

Zato je tak poslovni interval lahko dolg 23 ur.

Primer: začetek ob 04:00 po lokalnem času ostane 04:00.

Ne predpostavljajte, da ima vsak interval natančno 24 ur.

Za primerjavo uporabljajte meje intervala, ne števila ur.

Dogodek ob dejanskem časovnem žigu pripada eni sami lokalni meji.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5f9b5ce41329 package=lite -->
### 26.5 Prehod na zimski čas

V noči na prehod na zimski čas se lokalna ura ponovi.

Lokalni interval poslovnega dne je lahko dolg 25 ur.

Obe pojavitvi iste lokalne ure se obravnavata po dejanskem časovnem žigu.

Ne razvrščajte dogodkov samo po prikazu ure brez datuma in odmika.

Pri preiskavi uporabite številko računa, UTC čas in lokalni prikaz.

Za zaključek velja izračun strežnika v časovnem pasu enote.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-57bf77a10592 package=lite -->
### 26.6 Primer DST z začetkom ob 04:00

Na dan prehoda ob 02:00 se prehod zgodi pred začetkom poslovnega dne.

Poslovni rez ob 04:00 zato ostane nedvoumen.

Račun ob 01:30 se uvrsti po dejanskem lokalnem datumu in času.

Račun ob 03:30 na dan pomladnega preskoka lokalno ne obstaja.

Sistem ne potrebuje ročnega »zapolnjevanja« neobstoječe ure.

Na jesenski ponovitvi sta možna dva dogodka z lokalnim prikazom 02:30.

Oba dogodka ostaneta ločena po časovnem žigu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f73d314c5ea2 package=lite -->
### 26.7 Kako pravilno izbrati poročilni rez

Za X in Z izberite poslovni datum, ne čas tiskanja poročila.

Za nočni lokal preverite nastavljeni začetek dneva.

Za promet po koledarskem dnevu uporabljajte poročilo, ki to izrecno podpira.

Za dnevni zaključek ne združujte dveh poslovnih datumov.

Za mesečni ERP zbirnik preverite, kako podjetje obravnava poslovne datume ob meji meseca.

Primer: promet 1. maja ob 01:00 lahko pripada poslovnemu datumu 30. aprila.

Tak promet mora biti primerjan po enakem pravilu v POS in ERP.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-95cfaaf6b3a7 package=lite -->
## 27. X, Z in zapiralne blokade

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3699a47e56db package=lite -->
### 27.1 Razlika med X in Z

X je pregled trenutnega stanja.

Z je formalni zaklenjeni dnevni zaključek blagajne.

X lahko naredite večkrat.

Z za isti zaklenjeni poslovni dan ni mogoče narediti drugič.

X ne spremeni grand totala.

Z poveča grand total za promet dneva.

X vključuje trenutne podatke v trenutku zahteve.

Z shrani posnetek podatkov ob zaključku.

X pomaga pred štetjem.

Z zaključi poslovni rez po izpolnjenih pogojih.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c76bdc54fd0a package=lite -->
### 27.2 Kaj vsebuje Z posnetek

Z vsebuje številko Z.

Z vsebuje poslovni datum.

Z vsebuje osebo, ki je zaključila.

Z vsebuje grand total pred zaključkom.

Z vsebuje grand total po zaključku.

Z vsebuje promet dneva in skupni promet.

Z vsebuje DDV.

Z vsebuje število računov.

Z vsebuje zaporedno območje računov, kadar obstaja.

Z vsebuje gotovino, kartice in SumUp.

Z vsebuje bone, bone pica in negotovinska plačila.

Z vsebuje napitnine in njihovo razčlenitev.

Z vsebuje reprezentanco in lastno porabo.

Z vsebuje DDV po stopnjah.

Z vsebuje menjalni denar in gotovinsko prodajo.

Z vsebuje pologe gotovine, izplačila dobaviteljem in pologe TRR.

Z vsebuje izračunano stanje blagajne.

Z vsebuje izdajo in unovčitev darilnih bonov.

Z vsebuje SŠP subvencijo.

Z vsebuje število FURS potrjenih in nepotrjenih računov.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e74292627fdb package=lite -->
### 27.3 Trenutne blokade Z zaključka

`OPEN_SHIFTS` pomeni, da obstaja odprta izmena v poslovnem intervalu.

Zaprite navedene osebne izmene pred zaključkom.

`OCCUPIED_TABLES` pomeni, da so za trenutni poslovni dan mize zasedene.

Izpraznite ali pravilno predajte zasedene mize.

`OPEN_ORDERS` pomeni, da so naročila s statusom `odprto`.

Zaključite ali pravilno obravnavajte vsako navedeno naročilo.

`OPEN_PREPARED_FOOD` pomeni odprto dnevno evidenco pripravljene jedi.

Zaključite evidenco pripravljene hrane za navedeni poslovni datum.

`FURS_UNRESOLVED` pomeni račun v stanju `sending`, `unknown` ali `failed`.

Razrešite davčno potrjevanje pred Z.

`BUSINESS_FINALIZATION_PENDING` pomeni FURS potrjen račun brez poslovne finalizacije.

Dokončajte poslovno finalizacijo navedenega računa.

`OPEN_A_RECEIPTS` pomeni negotovinski A-račun z dnevi odloga nad nič.

Zaprite odprti A-račun po pravilih terjatev.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a0df4905d48a package=lite -->
### 27.4 Vrstni red odprave blokad

1. Preberite konkretna imena oziroma številke v seznamu blokad.

2. Ne ugibajte na podlagi skupnega števila.

3. Najprej razrešite odprta naročila in zasedene mize.

4. Nato zaključite osebne izmene, ki dejansko ne delajo več.

5. Nato preverite pripravljeno hrano.

6. Nato rešite FURS in poslovno finalizacijo računov.

7. Nato rešite odprte A-račune.

8. Nato osvežite X pregled in preverite, da je seznam blokad prazen.

9. Nato shranite uskladitev gotovine.

10. Šele nato izvedite Z.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-dcf2eccae5fb package=lite -->
### 27.5 Uskladitev kot ločen zapiralni pogoj

Z zahteva uskladitev gotovine za isto enoto, blagajno in poslovni datum.

Uskladitev brez razlike je dovolj, kadar je označena kot potrjena.

Uskladitev z razliko je dovoljena samo z nepraznim razlogom.

Razlog razlike ne odstrani potrebe po nadaljnji preiskavi.

Uskladitev ene blagajne ne odklene druge blagajne.

Uskladitev včerajšnjega dne ne velja za današnji dan.

Ponovno preštetje naj dobi nov dokumentiran postopek, ne prepisovanja starega dokaza.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b00bb68627b3 package=lite -->
### 27.6 Izvedba Z: trenutni postopek

Trenutna storitev ne predstavlja nujno posebnega uporabniškega »čarovnika« za zapiranje.

To je opis trenutnih strežniških pravil, ne trditev o obliki zaslona.

Vodja ali administrator izbere blagajno.

Vodja ali administrator navede poslovni datum, kadar ne zaključuje trenutnega.

Sistem preveri pripadnost blagajne enoti.

Sistem zaklene poslovni dan med preverjanjem in zapisom.

Sistem prepreči sočasen zaključek iste blagajne.

Sistem preveri, ali je dan že zaklenjen.

Sistem vrne konflikt, če je dan že zaklenjen.

Sistem vrne seznam blokad, če pogoji niso izpolnjeni.

Sistem preveri shranjeno uskladitev gotovine.

Sistem izdela posnetek in posodobi grand total.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3ea5bb65264b package=lite -->
### 27.7 Odklep Z poročila

Odklep zahteva vodjo ali administratorja.

Odklep zahteva neprazen razlog.

Odklep zapiše uporabnika, razlog in prejšnji grand total v revizijsko sled.

Odklep označi Z kot odklenjen.

Odklep obrne promet dneva iz grand totala.

Odklenjenega Z ne smete obravnavati kot veljavnega končnega zaključka.

Po odklepu popravite dejanski vzrok.

Po popravku izvedite ponovni zaključek.

Ponovni zaključek uporabi naslednjo številko Z za blagajno.

Ponovni zaključek znova nastavi grand total.

Odklep ni način za obhod blokad brez odprave vzroka.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1161b49407f6 package=lite -->
### 27.8 Primeri različnih dnevnih zaključkov

**Primer A: miren dan.**

Vse izmene so zaprte.

Ni odprtih naročil.

Gotovina se ujema.

FURS in finalizacija sta rešena.

Vodja izvede Z brez odstopanja.

**Primer B: gotovinski manjko.**

Vse poslovne blokade so odpravljene.

Prešteta gotovina je za 3,00 EUR nižja.

Blagajnik vnese razlog odstopanja.

Vodja preveri zapis in odgovornost.

Z je lahko izveden, če je razlog shranjen.

**Primer C: odprta miza ob 03:50.**

Pri začetku dneva ob 04:00 miza še pripada prejšnjemu poslovnemu dnevu.

Mizo je treba zaključiti ali ustrezno obravnavati pred Z prejšnjega dne.

Ne zapirajte dneva samo zato, ker se bliža polnoč.

**Primer D: FURS `unknown`.**

Račun obstaja, vendar potrditev ni jasna.

Sistem ga navede kot blokado.

Najprej razrešite stanje računa.

Šele potem izvedite uskladitev in Z.

**Primer E: A-račun z odlogom.**

Negotovinski račun z odprtimi dnevi odloga blokira Z.

Terjatev obravnavajte po dogovorjenem postopku.

Ne preoblikujte ga v gotovino zaradi zapiranja dneva.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c13bae678db7 package=lite -->
## 28. Operativna poročila: namen, filter, uskladitev in izvoz

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-accb1c263236 package=lite -->
### 28.1 Splošno pravilo filtrov

Operativna poročila uporabljajo polji **Od datuma** in **Do datuma**.

Po spremembi izberite **Prikaži**.

Vse kartice poročil prejmejo isti izbrani datumski razpon.

Datum filtra si zapišite na delovni list uskladitve.

Ne primerjajte kartice za en razpon s CSV izvozom za drug razpon.

Preverite, ali poročilo meri koledarski datum ali poslovni datum.

Zaključke blagajn interpretirajte po poslovnem datumu.

Pri čezpolnočnem delu navaden koledarski filter zahteva dodatno pozornost.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5689396cdd58 package=lite -->
### 28.2 Promet: skupni KPI

Namen je hiter pregled skupnega prometa, DDV in števila računov.

Filter je izbrani datum od–do.

Preverite `skupajPromet`.

Preverite `skupajDdv`.

Preverite `steviloRacunov`.

Promet primerjajte s seštevkom po enotah.

DDV primerjajte z DDV v Z posnetku za isti poslovni rez.

Število računov primerjajte z Z številom računov za eno blagajno in dan.

Pri več enotah ne primerjajte skupnega KPI z enim Z poročilom.

Za izvoz vključite razpon, enoto in čas izdelave v ime datoteke.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-0c6d879d834e package=lite -->
### 28.3 Promet po enotah

Namen je primerjava poslovnih enot.

Vrste vsebujejo enoto, promet, DDV in število računov.

Filter je skupni datum od–do.

Seštevek vseh enot mora ustrezati skupnemu prometu.

Seštevek DDV po enotah mora ustrezati skupnemu DDV.

Seštevek računov po enotah mora ustrezati skupnemu številu računov.

Odstopanje običajno pomeni drug filter, kasnejšo spremembo podatkov ali napačno primerjavo reza.

Pri izvozu naj bo enota samostojen stolpec.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-df55bebd866d package=lite -->
### 28.4 Promet po kategorijah

Namen je analiza prodajne strukture.

Vrste vsebujejo kategorijo, promet, osnovo, DDV, količino in število računov.

Filter je skupni datum od–do.

Promet po kategorijah primerjajte s skupnim prometom.

Osnova plus DDV po pravilnih stopnjah mora razumno pojasniti bruto promet.

Količina ni nujno število računov.

Ena izdaja računa lahko vsebuje več kategorij.

Kategorijski seštevek lahko zahteva posebno obravnavo popustov ali sestavljenih artiklov.

Izvoz uporabite za analizo marže, ne kot dokaz fizične gotovine.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-266cff23f33c package=standard -->
### 28.5 Promet po mizah

Namen je pregled prometa in obiska po mizi.

Vrste vsebujejo številko mize, ime mize, prostor, enoto, promet in račune.

Filter je skupni datum od–do.

Promet po mizah primerjajte s prometom po prostorih.

Miza brez prometa se praviloma ne pojavi med prometnimi vrstami.

Promet po mizah ni seznam trenutno zasedenih miz.

Odprta miza se preverja v zapiralnih blokadah.

Izvoz pomaga pri razporeditvi osebja in analizi zasedenosti.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c1bfc816219a package=lite -->
### 28.6 Promet po prostorih

Namen je primerjava terase, dvorane, bara ali drugega prostora.

Vrste vsebujejo prostor, enoto, promet in število računov.

Filter je skupni datum od–do.

Seštevek prostorov primerjajte s seštevkom miz.

Mize brez dodeljenega prostora lahko pojasnijo razliko.

Promet po prostoru ni dokaz, kdo je izdal račun.

Izvoz uporabite za organizacijo prostora in sezonsko analizo.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-3f32f519b65f package=lite -->
### 28.7 Promet po artiklih

Namen je pregled prodaje posameznih artiklov.

Vrste vsebujejo artikel, enoto, promet, količino in število računov.

Filter je skupni datum od–do.

Seštevek artiklov primerjajte s skupnim prometom ob upoštevanju pravil postavk.

Količino primerjajte z normativno porabo, ne z gotovino.

Nenavadno visoka količina lahko pomeni promocijo, napako vnosa ali spremembo cenika.

Izvoz je uporaben za nabavo in proizvodno planiranje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-553f3590f74c package=lite -->
### 28.8 Promet in napitnine po zaposlenem

Namen je pregled pripisa prometa in napitnin natakarju.

Vrste vsebujejo natakarja, enoto, promet, napitnino in število računov.

Filter je skupni datum od–do.

Promet zaposlenega primerjajte z njegovimi izmenami.

Ne pričakujte nujno popolnega ujemanja, če je prišlo do predaj.

Napitnina ni samodejno last osebe brez pravilnika podjetja.

Napitnino primerjajte z razčlenitvijo napitnin v X oziroma Z.

Izvoz uporabite kot vhod v interno delitev, ne kot samostojni obračun plače.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-0f03d2eb9b12 package=lite -->
### 28.9 Promet po načinu plačila

Namen je uskladitev prodaje s kanali plačila.

Vrste vsebujejo način in znesek ter število računov.

Filter je skupni datum od–do.

Gotovino primerjajte s pričakovano gotovino, ne neposredno z bruto prometom.

Kartice primerjajte s poročilom terminala za isti rez.

Bone primerjajte z evidenco bonov.

Negotovinska plačila primerjajte s terjatvami in odprtimi A-računi.

Deljena plačila zahtevajo preverjanje razčlenjenih zneskov na računu.

Izvoz naj vsebuje način plačila kot ločen stolpec.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-a7a47cdfb5e4 package=lite -->
### 28.10 Težave pri kartičnih plačilih

Namen je ločeno spremljanje neuspešnih in nejasnih kartičnih procesov.

Filter je skupni datum od–do.

Poročilo prikaže ponudnika, namen, status, znesek, napako in čas.

`unknown` pomeni »Nejasno (preveri)«.

Nejasnega zapisa ne označite kot neuspešnega brez dokazila.

Neuspešni zapis preverite glede na stanje računa in terminala.

Za uskladitev uporabite znesek, čas, ponudnika in referenco.

Izvoz uporabite za seznam odprtih raziskav.

Zaprite preiskavo z zapisanim izidom po internem postopku.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-6d22f2e712a5 package=lite -->
### 28.11 Težave pri davčnem potrjevanju FURS

Namen je pregled neuspešnih in nejasnih davčnih potrditev.

Filter je skupni datum od–do.

Poročilo pokaže račun, enoto, izid, napako in čas.

Primer neuspeha je napaka podpisa.

`failed`, `sending` in `unknown` so zapiralno pomembna stanja.

FURS napaka ni enaka kartični napaki.

Račun primerjajte po številki računa.

Pred Z razrešite navedene račune.

Izvoz uporabite za evidenco ponovnih poskusov in eskalacij.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-af63a0608033 package=lite -->
### 28.12 Zaključki blagajn

Namen je nadzor Z zaključkov in uskladitev gotovine.

Filter je skupni datum od–do.

Poročilo prikaže enoto, blagajno in poslovni datum.

Poročilo prikaže status zaključka.

Poročilo prikaže številko Z, kadar obstaja.

Poročilo prikaže promet in grand total, kadar obstajata.

Poročilo prikaže status gotovine in razlog odstopanja.

Poročilo prikaže blokade.

Zaklenjene zapise primerjajte z arhivom Z.

Odklenjene zapise obravnavajte kot odprto korektivno nalogo.

Izvoz je primeren za dnevni nadzor vodij.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d4c56c3ad360 package=extended -->
### 28.13 Dostave in zamude

Namen je nadzor poteka dostav.

Filter je skupni datum od–do.

Poročilo prikaže skupno število dostav.

Poročilo prikaže aktivne, zamujene, dostavljene in preklicane dostave.

Poročilo prikaže dostave brez roka.

Poročilo prikaže status po korakih procesa.

Statusi vključujejo `prejeto`, `potrjeno`, `v_pripravi` in `pripravljeno`.

Statusi vključujejo `prevzel_kurir`, `dostavljeno` in `preklicano`.

Zamuda je operativni signal, ne neposredno računovodsko stanje.

Izvoz uporabite za pogovor s kurirsko službo in izboljšanje rokov.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-4eaba2fbd501 package=lite -->
### 28.14 Normativna poraba

Namen je pregled porabe vhodnih artiklov po normativih.

Filter je skupni datum od–do.

Poročilo prikaže vrednost in število gibov.

Vrste vsebujejo vhodni artikel, mersko enoto, enoto, količino in vrednost.

Normativna poraba ni fizična inventura.

Normativno količino primerjajte s prodanimi artikli in recepturami.

Razlika do inventure zahteva preverjanje odpisa, prejema ali recepture.

Izvoz uporabite za nabavo in notranjo kontrolo porabe.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8c1d14ccca23 package=lite -->
### 28.15 Zaloge in inventurna odstopanja

Namen je pregled vrednosti zalog, kritičnih zalog, praznih zalog in odstopanj.

Filter je skupni datum od–do.

Poročilo prikaže vrednost zalog.

Poročilo prikaže število kritičnih in praznih stanj.

Poročilo prikaže inventurna odstopanja in njihovo vrednost.

Poročilo prikaže potrjene odpise pripravljene hrane.

`kriticna` zahteva nabavno ali operativno odločitev.

`prazna` pomeni ničelno zalogo po evidenci.

Negativna zaloga zahteva takojšnjo preiskavo prejema, izdaje ali popisa.

Inventurno odstopanje primerjajte s številko inventure in razlogom.

Izvoz uporabite za plan nabave in zapisnik inventure.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e2fa4d627888 package=lite -->
### 28.16 POS naprave

Namen je nadzor dosegljivosti in konfiguracije naprav.

Filter je skupni datum od–do.

Poročilo prikaže ime naprave in enoto.

Poročilo prikaže čas zadnje posodobitve.

Poročilo prikaže status naprave.

Poročilo prikaže stanje terminala in tiskalnika.

Tiskalnik je lahko `ni_dosegljiv`.

Tiskalnik je lahko `ni_nastavljen`.

Poročilo prikaže neuspešne in čakajoče tiskalne naloge.

Naprava z napako lahko pojasni zamudo, ne pa samodejno finančne razlike.

Izvoz uporabite za servisni seznam in dokaz eskalacije.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-30a168b41c42 package=standard -->
### 28.17 Čas priprave po kuhinji in točilnici

Namen je merjenje dejanske priprave po KDS postaji.

Filter je skupni datum od–do.

Poročilo prikaže skupno število nalogov.

Poročilo prikaže zaključene in aktivne naloge.

Poročilo prikaže povprečni čas v minutah.

Poročilo prikaže najkrajši in najdaljši čas.

Primer razmerja `18/20` pomeni 18 zaključenih od 20 nalogov.

Aktivni nalogi zahtevajo operativno predajo, če se dan zaključuje.

Poročilo ne nadomešča preveritve odprtih naročil.

Izvoz uporabite za razporeditev kapacitet in izboljšanje procesa.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-b25d16a9402a package=lite -->
## 29. POS–ERP: žurnali, preslikave in primerjava

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2d76fc456e1a package=lite -->
### 29.1 Kaj prenos trenutno omogoča

Pot `/temeljnice` vrne temeljnice podjetja za datum od–do.

Za poizvedbo sta obvezna parametra `od` in `do`.

V uporabniškem vmesniku uporabnik izbere datum v obliki **dd.mm.yyyy**.
Zaledna tehnična pot lahko datum serializira v tehničnem ISO zapisu; to je notranji
API-format in ni oblika, ki jo prikazujemo uporabniku.

Rezultat je brez predpomnjenja.

Vsaka temeljnica vsebuje datum knjiženja.

Vsaka temeljnica vsebuje referenco.

Vsaka temeljnica vsebuje opis.

Vsaka temeljnica vsebuje status.

Vsaka temeljnica vsebuje čas nastanka in čas knjiženja.

POS temeljnica lahko obstaja brez računovodskega obdobja. Obdobje in
GK knjižbo preverjajte pri izrecnem prenosu v glavno knjigo; sam arhiv
POS ne pomeni, da je dokument že prenesen ali knjižen.

Vsaka vrstica vsebuje konto, naziv, stran, znesek in opis.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-23326b3eed3a package=lite -->
### 29.2 Vrste zagona prenosa

Ročni dnevni prenos uporablja datum v poti `/temeljnice/sync/:datum`.

V vmesniku mora biti datum prikazan kot **dd.mm.yyyy**. Če tehnična pot
zahteva tehnični ISO zapis, pretvorbo izvede program oziroma skrbniški tehnični
postopek; uporabnik ne vpisuje ISO-datuma v uporabniško polje.

Ročni mesečni zbirnik uporablja pot `/temeljnice/sync-mesec/:mesec`.

Mesec se v uporabniškem vmesniku izbere kot mesec in leto. Tehnična pot lahko
uporabi `YYYY-MM`; uporabniku se obdobje prikaže opisno, na primer **junij
2026**, posamezni datumi pa vedno kot **dd.mm.yyyy**.

Mesečni zbirnik je namenjen že zaključenemu mesecu.

Dnevni prenos uporabljajte za pregled in pravočasno odpravo napak.

Mesečnega zbirnika ne uporabljajte kot nadomestilo za neurejene dnevne razlike.

Pred ročnim ponovnim zagonom preverite obstoječe reference.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f963a4a116c8 package=lite -->
### 29.3 Statusi žurnala

V POS seznamu ločite stanje arhivirane temeljnice in njen prenos v GK.
Pripravljena oziroma arhivirana POS temeljnica ni sama po sebi GK knjižba.

`createdAt` pove, kdaj je nastal zapis.

`postedAt` pove, kdaj je bil knjižen, kadar je knjižen.

Manjkajoč `postedAt` obravnavajte kot signal za preverjanje statusa.

Ne sklepajte iz samega datuma vnosa, da je žurnal knjižen.

<!-- pos-heading: id=pos-journals-independent-archive-export package=lite -->
### 29.4 Arhiv POS temeljnic, potrjen prenos v GK ter Excel/CSV

POS hrani svoje temeljnice v samostojnem arhivu. Za njihov nastanek,
pregled in izvoz ni treba odpirati računovodskih obdobij v ERP.
To je uporabno tudi, kadar poslovne knjige vodi zunanji računovodja.
Priprava POS temeljnice ni samodejna odobritev prenosa v glavno knjigo.

1. Odprite **Temeljnice** in preverite izbrano podjetje ter poslovno enoto.
2. Določite datum **od–do** in preglejte dokumente. V prikazu uporabite ime pripadajoče enote; interna oznaka, kot je E309, ni ime poslovne enote.
3. Odprite posamezno temeljnico in preverite datum, postavke, konte, debet in kredit ter stanje prenosa.
4. Če želite dokumente predati računovodji, kliknite **Izvozi Excel** ali **Izvozi CSV**. Izvoz uporabi izbrano datumsko obdobje; izbor za prenos v GK ni pogoj za izvoz.
5. Preverite preneseno datoteko. Excel vključuje povzetek in podrobne postavke; izvoz vsebuje podatke o enoti, kontih, zneskih in statusih. Izvoz datoteke ne prenese ali knjiži dokumentov v GK.
6. Samo če dokumente želite prenesti v interno GK, izberite pregledane POS temeljnice in kliknite **Prenesi izbrane POS temeljnice v GK**.
7. V oknu **Potrdi prenos v glavno knjigo** preverite izbor. **Prekliči** ne izvede prenosa; **Potrdi prenos v GK** je izrecna odobritev.
8. Po potrditvi preverite rezultat in stanje vsake temeljnice. Prenos v GK potrebuje ustrezno odprto računovodsko obdobje; arhiviranje in izvoz POS temeljnic ga ne potrebujeta.

Izvirna POS temeljnica ostane v arhivu tudi po prenosu. Ponovitev prenosa
istega dokumenta ne sme ustvariti podvojene GK temeljnice. Če prenos
spodleti ali ni ustreznega obdobja, preverite rezultat in predajte napako
računovodstvu; ne odpirajte obdobij samo zato, da bi omogočili pregled
POS arhiva, in ne izdelujte ročno nove temeljnice za že preneseni vir.

Status v ERP ni isto kot status Z poročila.

Status v ERP ni isto kot FURS stanje računa.

Status v ERP ni isto kot status blagajniškega premika.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-661feb6b3094 package=lite -->
### 29.4 Načelo dvostavnosti

Vsaka temeljnica mora imeti uravnotežen debet in kredit.

Seznam izračuna in prikaže skupni debet.

Pri pregledu ročno seštejte tudi kredit.

Vsota debeta mora biti enaka vsoti kredita.

Neuravnotežena temeljnica ni primerna za knjiženje.

Zaokrožitve dokumentirajte po računovodskih pravilih podjetja.

Ne dodajajte »izravnalnega« konta brez odobrene razlage.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2532451077df package=lite -->
### 29.5 Preslikava kontov: plačilni kanali

Gotovinska prodaja se praviloma primerja s kontom blagajne.

Kartična prodaja se praviloma primerja s prehodnim kontom kartic.

SumUp se lahko loči od drugih kartic, kadar preslikava to podpira.

Polog na TRR se primerja z bančnim oziroma prehodnim kontom.

Izplačilo dobavitelju se primerja z obveznostmi do dobavitelja in blagajno.

Negotovinska prodaja se lahko nanaša na terjatve.

Bon in bon pica zahtevata ločeno obravnavo, če sta ločena kanala v POS.

Darilni bon ob izdaji ni enak unovčitvi bona.

Napitnina zahteva konto po pravilniku podjetja.

Reprezentanca in lastna poraba zahtevata odobreno računovodsko obravnavo.

To so kontrolne kategorije, ne univerzalne številke kontov.

Konkretne številke kontov nastavite samo po kontnem načrtu podjetja.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-178af6b809ec package=lite -->
### 29.6 Preslikava DDV

Osnova in DDV morata biti ločena po uporabljeni stopnji.

Z posnetek vsebuje DDV po stopnjah kot osnovo in znesek DDV.

ERP žurnal primerjajte z isto razčlenitvijo.

Ne knjižite celotnega bruto prometa neposredno na DDV konto.

Za vsako stopnjo preverite osnovo.

Za vsako stopnjo preverite izračunani DDV.

Za vsako stopnjo preverite ustrezen konto izhodnega DDV.

Artikli s spremenjeno stopnjo zahtevajo pregled obdobja veljavnosti.

Razlika v DDV pogosto izvira iz drugega datuma, storniranega računa ali napačne preslikave.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-82b413c66a4b package=lite -->
### 29.7 Referenca in preprečevanje podvajanja

Referenca žurnala je ključ za primerjavo med POS in ERP.

Pred ponovnim prenosom poiščite isto referenco v ERP.

Preverite datum, opis in znesek obstoječega žurnala.

Če referenca obstaja in je znesek pravilen, ne ustvarjajte kopije.

Če referenca obstaja in je znesek napačen, začnite korektivni postopek.

Ne rešujte napačnega žurnala z nenadzorovanim drugim žurnalom istega dne.

V delovni list zapišite, kdo je preveril podvojitev.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8f4bd75ee331 package=lite -->
### 29.8 Ponovni poskus prenosa

Ponovni poskus je upravičen po odpravi konkretnega vzroka.

Primer vzroka je manjkajoč konto kartic.

Primer vzroka je zaprto računovodsko obdobje.

Primer vzroka je neusklajena DDV preslikava.

Primer vzroka je začasna komunikacijska napaka.

Pred ponovnim poskusom preverite, ali je ERP prejel del zapisa.

Preverite referenco.

Preverite število vrstic.

Preverite skupni debet in kredit.

Preverite status obdobja.

Po uspehu primerjajte izid s POS virom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-9ae99458df44 package=lite -->
### 29.9 Dnevni primer primerjave POS–ERP

Z za blagajno prikazuje promet dneva 1.000,00 EUR.

Z DDV po stopnjah prikazuje ustrezne osnove in DDV.

Plačilna razčlenitev prikazuje 300,00 EUR gotovine.

Plačilna razčlenitev prikazuje 650,00 EUR kartic.

Plačilna razčlenitev prikazuje 50,00 EUR bonov.

ERP žurnal mora imeti bruto prodajni učinek 1.000,00 EUR.

ERP vrstice plačilnih kanalov morajo pojasniti 1.000,00 EUR.

ERP DDV vrstice morajo pojasniti Z DDV.

ERP reference morajo nedvoumno povezati dan in vir.

Če kartice ne ustrezajo terminalu, najprej preverite terminalski rez.

Če gotovina ne ustreza X, preverite premike in štetje.

Če bruto promet ne ustreza, preverite datum poslovnega reza in storna.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f5b6a582cc58 package=lite -->
### 29.10 Dnevni kontrolni list prenosa

Podjetje: __________.

Enota: __________.

Blagajna: __________.

Poslovni datum: __________.

Z številka: __________.

Referenca ERP: __________.

Promet Z: __________ EUR.

Promet ERP: __________ EUR.

DDV Z: __________ EUR.

DDV ERP: __________ EUR.

Gotovina POS: __________ EUR.

Konto gotovine ERP: __________.

Kartice POS: __________ EUR.

Konto kartic ERP: __________.

Bon POS: __________ EUR.

Konto bonov ERP: __________.

Skupni debet ERP: __________ EUR.

Skupni kredit ERP: __________ EUR.

Status ERP: __________.

Preveril: __________.

Datum preveritve: __________.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-732507b11f40 package=lite -->
## 30. Vaje, izpiti in modelni odgovori

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-004d961a909a package=lite -->
### 30.1 Vaja: ločitev odgovornosti

Ana dela od 08:00 do 14:00 na glavni blagajni.

Bor dela od 12:00 do 20:00 na isti blagajni.

Ana ob 14:00 zapre svojo osebno izmeno.

Bor prevzame fizični predal s podpisanim zapisom.

Vprašanje: ali Ana z zaprtjem izmene zapre register?

Modelni odgovor: ne.

Ana zapre svojo osebno delovno izmeno.

Register ostane odgovornost skupnega fizičnega predala.

Z poročilo se izvede za blagajno in poslovni datum po vseh zapiralnih pogojih.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-93a2dec5a10e package=lite -->
### 30.2 Vaja: odprt odmor

Uporabnik je pri aktivni izmeni izbral **Neplačan odmor** in ga ob vrnitvi
pozabil zaključiti.

Ob koncu dela želi klikniti **Zaključi izmeno**.

Vprašanje: kaj se zgodi?

Modelni odgovor: POS prepreči zapiranje izmene, dokler je odmor odprt.
Uporabnik preveri dejanski čas vrnitve, zaključi odmor z gumbom
**Zaključi odmor** in šele nato ponovno preveri pogoje za zaprtje izmene.
Če čas odmora ni pravilen, zadevo predajte vodji za sledljiv popravek.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8e7443bf1ed3 package=lite -->
### 30.3 Vaja: pričakovana gotovina

Menjalni denar je 50,00 EUR.

Gotovinska prodaja je 400,00 EUR.

Polog gotovine je 100,00 EUR.

Izplačilo dobavitelju je 30,00 EUR.

Polog na TRR je 300,00 EUR.

Vprašanje: koliko je pričakovane gotovine?

Modelni odgovor: 220,00 EUR.

Izračun je 50 + 400 + 100 - 30 - 300.

Kartična prodaja v ta izračun ne sodi.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-013aa273fc58 package=lite -->
### 30.4 Vaja: manjko

X kaže pričakovano gotovino 220,00 EUR.

Prešteta gotovina je 215,00 EUR.

Vprašanje: kateri znesek vpišete kot preštet?

Modelni odgovor: 215,00 EUR.

Vprašanje: katera je razlika?

Modelni odgovor: -5,00 EUR.

Vprašanje: ali je razlog potreben?

Modelni odgovor: da, razlog odstopanja je obvezen.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-72b39ea3c9b4 package=lite -->
### 30.5 Vaja: meja poslovnega dne

Začetek poslovnega dne je 04:00.

Račun je izdan 12. julija ob 03:58 po Ljubljanskem času.

Vprašanje: kateri poslovni datum ima račun?

Modelni odgovor: 11. julij.

Račun je izdan 12. julija ob 04:00.

Vprašanje: kateri poslovni datum ima drugi račun?

Modelni odgovor: 12. julij.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-21b1eb9fcddc package=lite -->
### 30.6 Vaja: X ali Z

Vodja želi ob 22:00 preveriti stanje gotovine.

Še vedno so odprte mize.

Vprašanje: katero poročilo uporabi?

Modelni odgovor: X poročilo.

X je vmesni pregled in ne zaklene dneva.

Z bi preveril blokade in ga ob odprtih mizah ne bi bilo mogoče zaključiti.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-25e344de4027 package=lite -->
### 30.7 Vaja: blokada FURS

Na seznamu blokad je `FURS_UNRESOLVED`.

Navedena sta dva računa v stanju `failed`.

Vprašanje: ali lahko vodja zapiše razlog gotovinske razlike in nato izvede Z?

Modelni odgovor: ne.

Razlog gotovinske razlike rešuje samo pogoj uskladitve gotovine.

FURS blokada ostane ločen zapiralni pogoj.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c324e9147cee package=lite -->
### 30.8 Vaja: nejasna kartica

Terminal je po timeoutu vrnil nejasen rezultat za 42,50 EUR.

Gost pravi, da je banka znesek rezervirala.

Vprašanje: ali takoj znova bremenite kartico?

Modelni odgovor: ne brez preveritve.

Preverite ponudnika, čas, znesek in referenco.

Dogodek zapišite v predajo.

Nejasni kartični zapisi so vidni ločeno v operativnem poročilu.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-5606151e07cd package=lite -->
### 30.9 Vaja: odprto naročilo

Naročilo #87 je v statusu `odprto`.

Naročilo je nastalo znotraj poslovnega intervala.

Vprašanje: kaj bo storil Z zaključek?

Modelni odgovor: vrnil bo blokado `OPEN_ORDERS`.

Vodja mora naročilo zaključiti ali ga pravilno obravnavati.

Zaprtje osebne izmene samo po sebi ne odpravi naročila.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-e87298505637 package=lite -->
### 30.10 Vaja: storno premika

Potrjeno izplačilo dobavitelju je bilo pomotoma vneseno dvakrat.

Vprašanje: ali izbrišete en vnos?

Modelni odgovor: ne.

Za potrjeni izvirnik uporabite sledljiv storno po pooblastilu.

Nato preverite fizični denar in po potrebi ustvarite pravilen zapis.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d6f7b67606d8 package=lite -->
### 30.11 Vaja: polog na TRR

Blagajnik odnese 800,00 EUR na banko.

V predalu ostane 100,00 EUR menjalnega denarja.

Vprašanje: kateri scenarij pologa izbere?

Modelni odgovor: scenarij A.

Scenarij A pomeni, da menjalni denar ostane v blagajni.

V opis se vpiše sklic bančnega pologa.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-24e47a2a98de package=lite -->
### 30.12 Vaja: odklep Z

Z je že zaklenil dan.

Računovodstvo odkrije napačno nastavitev, ki zahteva korekcijo.

Vprašanje: kdo lahko odklene Z?

Modelni odgovor: vodja ali administrator.

Vprašanje: kaj je obvezno?

Modelni odgovor: neprazen razlog odklepa.

Vprašanje: kaj sledi?

Modelni odgovor: odprava vzroka in ponovni zaključek.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1182c24ea330 package=lite -->
### 30.13 Vaja: podvojen ERP prenos

Pri ročnem prenosu je povezava prekinjena.

Uporabnik ni prepričan, ali je ERP prejel žurnal.

Vprašanje: kaj preveri pred ponovitvijo?

Modelni odgovor: referenco, datum, opis, zneske in vrstice v ERP.

Če isti pravilen žurnal obstaja, ga ne prenese znova.

Če je prenos delno izveden, začne kontrolirani korektivni postopek.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-f9a27717c0da package=lite -->
### 30.14 Kratki izpit: trditve

Trditev: X poročilo zaklene poslovni dan.

Odgovor: napačno.

Trditev: Z zahteva uskladitev gotovine ali razlog odstopanja.

Odgovor: pravilno.

Trditev: `unknown` kartično stanje pomeni potrjeno plačilo.

Odgovor: napačno.

Trditev: Osebna izmena in Z poročilo merita isto odgovornost.

Odgovor: napačno.

Trditev: Pregledana POS izvedba ima potrjen gumb za začetek in konec odmora.

Odgovor: pravilno; na aktivni izmeni sta na voljo začetek plačanega ali
neplačanega odmora in gumb **Zaključi odmor**.

Trditev: FURS `failed` je lahko prezrt, če je gotovina usklajena.

Odgovor: napačno.

Trditev: Poslovni dan lahko pri začetku ob 04:00 vključuje račun ob 03:59 naslednjega jutra.

Odgovor: pravilno.

Trditev: ERP reference preverimo pred ponovnim prenosom.

Odgovor: pravilno.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-8111254fd57b package=lite -->
### 30.15 Ustni izpit: modelni odgovori

Vprašanje: zakaj štejemo po apoenih?

Modelni odgovor: da je fizični znesek preverljiv in je napako lažje najti.

Vprašanje: zakaj je razlog razlike obvezen?

Modelni odgovor: da razliko ne prikrijemo in da ostane sled naslednjega ukrepa.

Vprašanje: zakaj ločimo kartice od gotovine?

Modelni odgovor: ker kartica ne poveča fizičnega denarja v predalu.

Vprašanje: zakaj je poslovni datum pomemben?

Modelni odgovor: ker nočni promet lahko pripada prejšnjemu lokalnemu poslovnemu rezu.

Vprašanje: zakaj Z ni samo tisk poročila?

Modelni odgovor: ker zaklene dan, shrani posnetek in spremeni grand total.

Vprašanje: zakaj ne smemo ustvariti drugega ERP žurnala po timeoutu?

Modelni odgovor: ker lahko prvi žurnal že obstaja in bi podvojili knjiženje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-78d8d69600e0 package=lite -->
## 31. Priporočila za vodje in računovodstvo

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c6a5c69988c2 package=lite -->
### 31.1 Dnevni ritem vodje

Ob začetku dneva preverite, ali so prejšnji relevantni registri zaključeni.

Med dnevom preverite nejasna kartična plačila.

Med dnevom preverite FURS napake.

Pred koncem preverite odprte mize in naročila.

Pred Z preverite pripravljeno hrano.

Pred Z zahtevajte uskladitev za vsako blagajno.

Po Z arhivirajte številko Z in ključne priloge po internem pravilniku.

Po prenosu v ERP primerjajte reference.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-cf938b528631 package=lite -->
### 31.2 Dnevni ritem računovodstva

Najprej pridobite seznam zaklenjenih in odklenjenih zaključkov.

Nato preverite promet in DDV po poslovnem datumu.

Nato preverite plačilne kanale.

Nato preverite dnevne ERP žurnale.

Nato preverite uravnoteženost debeta in kredita.

Nato preverite račune DDV.

Nato preverite kartični prehodni konto proti terminalskim izpiskom.

Nato preverite blagajniški konto proti Z in uskladitvam.

Odstopanja zapišite z virom, zneskom, lastnikom in rokom.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-dd33652aa719 package=lite -->
### 31.3 Meja med trenutnim vedenjem in priporočilom

Trenutno vedenje Z preverja navedene blokade in uskladitev gotovine.

Trenutno vedenje omogoča odklep z obveznim razlogom za pooblaščeno vlogo.

Trenutno vedenje prikazuje operativna poročila za navedene filtre.

Trenutno vedenje omogoča dnevni in mesečni ročni zagon prenosa temeljnic.

Priporočeni podpisni list predaje je organizacijski ukrep.

Priporočena dvostranska priča pri večjem dvigu je organizacijski ukrep.

Priporočena dnevna tabela razlik je organizacijski ukrep.

Ne predstavljajte priporočila kot funkcijo, če je v uporabniškem vmesniku ni.

Ne predstavljajte domnevnega čarovnika za zapiranje kot trenutno implementirane funkcije.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-d2630ef3968c package=lite -->
## 32. Operativni postopek POS→ERP za skrbnika in računovodstvo

Ta postopek dopolnjuje tehnični opis iz poglavja 29. Uporabniški vmesnik lahko
prikaže nastavitve prenosa v POS, pregled temeljnic pa je lahko v zalednem ERP.
Če vloga nima zaslona za pregled ali knjiženje, uporabnik ne sme sklepati, da je
prenos izveden samo zato, ker je bila nastavitev shranjena.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-bc97f1bf2cc1 package=lite -->
### 32.1 Nastavitev pravil in urnika

Pooblaščeni skrbnik v nastavitvah preveri:

1. podjetje, enoto in obseg prenosa;
2. ali je vključen dnevni prenos, mesečni zbirnik ali oba;
3. pravilo za zaključene oziroma odprte poslovne dni;
4. računovodske konte za plačila, prihodke, DDV, bone, napitnine, zalogo,
   odpis, embalažo in druge vključene kategorije;
5. način obravnave neuspešnega prenosa in obvestil.

Shranjena nastavitev ni dokaz, da je bil žurnal ustvarjen ali knjižen. Po
spremembi zapišite čas, izvajalca, enoto in razlog spremembe.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-4c9427fbc207 package=lite -->
### 32.2 Dnevni prenos

1. Zaključite oziroma preverite poslovni dan **dd.mm.yyyy**.
2. Preverite, da so Z, FURS, kartična plačila in gotovinski premiki razrešeni.
3. Če uporabniški vmesnik ne ponuja ločenega dnevnega ukaza, uporabite **Ročno
   sinhronizacijo obsega** z istim datumom v poljih »Od« in »Do«. Obseg je
   omejen na največ 366 dni.
4. Shranite rezultat, referenco in status vsakega ustvarjenega oziroma
   preskočenega vnosa.
5. V ERP odprite nastali žurnal oziroma temeljnico, če je ta vloga uporabniku
   na voljo.
6. Preverite datum, referenco, opis, konto, debet, kredit, DDV in obdobje.
7. Če je v rezultatu preskočen vnos ali napaka, ne zaženite ponovitve na slepo; najprej odpravite
   navedeni vzrok in preverite, ali je del zapisa že nastal.

Dnevni prenos je namenjen hitremu odkrivanju manjkajočega konta, zaprtega
obdobja, napačne DDV-preslikave ali komunikacijske napake. Pri ponovitvi
uporabite isto referenco in preverite idempotentni rezultat.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-32a39dda0e02 package=lite -->
### 32.3 Mesečni zbirnik

Mesečni zbirnik uporabite šele, ko so vsi dnevi in enote v mesecu pregledani.
Mesečni postopek:

1. izberite mesec in leto;
2. preverite, da je mesec zaključen za vse vključene enote;
3. preglejte predogled obsega in opozorila;
4. zaženite zbirnik samo enkrat;
5. počakajte na končni status;
6. preverite število dni, enot, vrstic in skupni debet/kredit;
7. po koncu preverite, ali je žurnal ustvarjen ali knjižen.

Mesečni zbirnik ni popravek za neurejene dnevne razlike. Če manjka en dan,
ga najprej obravnavajte z dnevnim postopkom. Pri obsegu, daljšem od dovoljenega
razpona, uporabite več odobrenih intervalov in ohranite reference.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-2a548c341229 package=lite -->
### 32.4 Pregled in knjiženje žurnala

Za vsak žurnal preverite:

- status, čas nastanka in čas knjiženja;
- referenco POS in poslovni datum **dd.mm.yyyy**;
- konto, naziv konta, debet, kredit in opis;
- DDV osnovo in DDV po stopnji;
- plačilni kanal, napitnino, bone, storna in vračila;
- stroškovno mesto oziroma projekt, kadar ga konto zahteva;
- pripadajočo enoto in računovodsko obdobje.

Žurnal je primeren za knjiženje samo, če je debet enak kreditu, vsi obvezni
konte obstajajo in obdobje ni zaprto. Skupinski konto, konto napačnega tipa ali
konto z manjkajočo obvezno dimenzijo je napaka, ne razlog za ročno izravnavo.

Če uporabniški vmesnik ne prikaže ločenega pregleda POS-žurnala, preverjanje
izvedite v razpoložljivem ERP-seznamu temeljnic ali ga eskalirajte računovodski
vlogi. Priročnik ne predpostavlja zaslona, ki ga konkretna namestitev ne
prikazuje.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-545782414949 package=lite -->
### 32.5 Preslikava kontov in DDV

Pred prvo uporabo in po spremembi kontnega načrta preverite matriko:

| Skupina | Kontrola |
|---|---|
| Gotovina | konto blagajne se ujema z metodo gotovine |
| Kartice | ločen prehodni konto po ponudniku, kadar je tako nastavljeno |
| Negotovinsko | konto terjatve oziroma dogovorjena metoda |
| Darilni bon | izdaja/predplačilo je ločeno od unovčitve |
| Bon za pico | ločen kanal, kadar ga POS vodi ločeno |
| Napitnina | ločeno poročanje in konto po politiki podjetja |
| Prihodki | preslikava po vrsti artikla in DDV-stopnji |
| DDV | osnova in DDV sta ločena po uporabljeni stopnji |
| Zaloga/odpis | konto zaloge, strošek odpisa in povratna embalaža po nastavitvi |

Konkretnih številk kontov ne prepisujte iz primera drugega podjetja. Če konto
zahteva stroškovno mesto ali projekt, ga nastavite pred prenosom in preverite
uvoz. Opozorilo o neveljavnem kontu mora ostati vidno do izbire veljavnega
nadomestnega konta; zaprtje okna ni potrditev popravka.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-1aad1efe2d8b package=lite -->
### 32.6 Kontrolirana ponovitev in dokaz rezultata

Pri vsakem prenosu ločite **nastavitev**, **ustvarjanje osnutka** in
**knjiženje**. Shranjena nastavitev ali prikaz napredka sama po sebi ni
knjižba.

Za dnevni oziroma datumski razpon preverite rezultat tako:

1. zapišite enoto, datum oziroma razpon **dd.mm.yyyy**, izvajalca in čas;
2. zapišite referenco vsake ustvarjene temeljnice;
3. preštejte ustvarjene in preskočene dni oziroma temeljnice;
4. pri preskočenem vnosu zapišite prikazano referenco in razlog;
5. v seznamu temeljnic preverite, ali je isti vir že prisoten;
6. ponovite samo neuspešen ali preskočen del, po odpravi vzroka;
7. po ponovitvi preverite, da se je obstoječi zapis osvežil oziroma da je
   nastal samo en idempotentni rezultat.

Pri mesečnem zbirniku preverite še, da je mesec v celoti pretekel in da ima
enota nastavljeno mesečno frekvenco. Obstoječi osnutki izbranega meseca se
lahko nadomestijo, potrjene temeljnice pa se ne smejo brisati. Če samodejno
osveževanje ustvari samo osnutke, mora računovodja knjiženje pregledati in
izvesti z ločenim pooblaščenim dejanjem.

Če konkretna namestitev ne prikaže rezultata, reference ali seznama
preskočenih vnosov, prenosa ne označite kot uspešnega. Shranite razpoložljiv
tehnični odziv in zadevo predajte računovodski oziroma skrbniški vlogi.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-64f9da4de25c package=lite -->
## 33. Poročila, realizacija in zaključek gotovine

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-7b824d914ccf package=lite -->
### 33.1 Izbira pravega poročila

| Potreba | Uporabite |
|---|---|
| vmesna kontrola med dnevom | X poročilo |
| dokončni zaključek poslovnega dne | Z poročilo |
| seznam posameznih računov | Računi |
| razčlenitev prometa in plačil | Statistika oziroma Operativna poročila |
| promet po artiklih, natakarju ali kategoriji | Realizacija oziroma ustrezno operativno poročilo |
| računovodska sled | Temeljnice oziroma ERP žurnali |
| fizična gotovina | Blagajniški premiki in uskladitev blagajne |

Pred primerjavo shranite filtre: enota, blagajna, uporabnik, od–do, poslovni
datum in vključitev storna/vračil. Datum v prikazu je **dd.mm.yyyy**. Če se
filter po vrnitvi na stran ponastavi, ga ponovno preverite; ne primerjajte
poročil z različnimi filtri.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-c4c84f4e09ef package=lite -->
### 33.2 Realizacija in plačilne dimenzije

Pri realizaciji ločite:

- bruto in neto promet;
- gotovino, kartice, bone in negotovinska plačila;
- darilni bon in bon za pico;
- napitnino;
- storno, vračilo in popust;
- odprta in zaključena naročila;
- enoto, blagajno, natakarja in izmeno.

Če se realizacija razlikuje od Z, najprej preverite poslovni datum, filter,
storne, vračila in odprta naročila. Če se kartice razlikujejo, primerjajte
ponudnikov zaključek s kartičnim prehodnim kontom. Če se gotovina razlikuje,
preverite fizično štetje in blagajniške premike.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-45b6f63c6c6e package=lite -->
### 33.3 Storno in razveljavitev plačila

Storno računa, vračilo postavke in razveljavitev plačila niso isti postopki.
Pred izvedbo zabeležite račun, plačilo, znesek, razlog in uporabnika.

1. Poiščite izvorni račun v seznamu računov.
2. Preverite vsa plačila na računu, ne samo skupnega zneska.
3. Izberite odobren popravljalni postopek.
4. Po potrditvi preverite nov status računa, status posameznega plačila in čas
   razveljavitve.
5. Preverite kartični povratek pri ponudniku, kadar je plačilo kartično.
6. V poročilu in ERP-ju poiščite izvorno in razveljavitveno sled.

Če je razveljavljeno samo eno od več plačil, račun ni samodejno v celoti
storniran. Ne ustvarite novega računa, dokler ne preverite odprtega zneska in
stanja vseh plačil.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-0b428e4597de package=lite -->
### 33.4 Filtri, izvoz in uskladitev poročil

Pri vsakem poročilu zapišite uporabljene filtre:

| Filter oziroma dimenzija | Kontrola |
|---|---|
| Enota in blagajna | Ujemata se z enoto oziroma registrom, za katerega usklajujete podatke. |
| Uporabnik in izmena | Ne zamenjajte osebnega prometa s prometom registra. |
| Od–do in poslovni datum | Prikaz je **dd.mm.yyyy**; nočni promet preverite glede na pravilo poslovnega dne. |
| Artikli, kategorije in natakar | Enako merilo uporabite v obeh primerjanih poročilih. |
| Plačilni kanal | Ločite gotovino, kartice, bone, bon za pico in negotovinska plačila. |
| Storno, vračila in popusti | Zabeležite, ali so vključeni ali izključeni. |
| Odprta in zaključena naročila | Odprta naročila ne predstavljajo nujno zaključenega prometa. |

Pred izvozom preverite obdobje, enoto in obseg vrstic. Po izvozu primerjajte
vsaj število računov, bruto oziroma neto promet, DDV po stopnjah in vsote
plačil. Pri realizaciji dodatno primerjajte napitnine, darilne bone, bone za
pico, storne in vračila.

Če poročilo nima ločenega filtra ali izvoza v konkretni namestitvi, ga ne
nadomeščajte z ročnim seštevanjem nepovezanih zaslonov. Shranite uporabljene
filtre in izvoz razpoložljivega poročila, nato razliko predajte računovodstvu
z navedbo vira, datuma, zneska in odgovorne osebe.

<!-- pos-heading: id=pos-08-nastavitve-po-sklopih-45bdc1b8062c package=lite -->
## 34. Omejitve trenutno razpoložljivih funkcij

Javni profil, spletne rezervacije in prodaja darilnih bonov so na voljo prek
urejevalnika **Javna stran** (`/javna-stran`), če so profil in pripadajoče
storitve pravilno nastavljeni. Urejanje profila je dovoljeno vlogam
`admin`, `admin_enote` in `superadmin`; povezavo Stripe Connect za celotno
podjetje lahko upravlja samo `admin` ali `superadmin`.

Pred objavo preverite javni naslov profila, stikalo **Javno prikazan profil**,
odpiralni čas in datumske izjeme. Zavihek **Rezervacije** določa največje
število oseb na rezervacijo, dolžino termina ter kapaciteto termina. Razpoložljivost
je odvisna tudi od prostih miz ustrezne kapacitete in obstoječih rezervacij;
sprememba nastavitev ni nadomestilo za preverjanje v javnem prikazu.

V zavihku **Boni** določite aktivne izdelke, njihove vrednosti in prikazane
podatke. Spletni nakup je mogoč le, ko je javni profil aktiven, ponudba bona
aktivna in je Stripe Connect za podjetje pravilno povezan ter pripravljen za
plačila. Sama shranjena ponudba ali povezan račun še ne potrjujeta, da je
plačilo pripravljeno; pred objavo izvedite odobren preskus in preverite rezultat
v POS-u. Izklop javnega profila onemogoči javni dostop, rezervacije in nakupe
bonov. Notranji POS-postopek izdaje oziroma unovčenja bona in fizična plačila
ostajajo ločeni tokovi.
