<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c678dfc890c9 package=extended -->
# 07 Zaloge, prejemnice, OCR, pripravljena hrana, odpad in dogodki

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-29b6d71c2c79 package=lite -->
## 1. Namen sklopa

Ta sklop opisuje evidentiranje zalog in proizvodnih dogodkov.

Obsega začetne zaloge, WAC, prejemnice, uvoz in OCR, prenose, inventuro,
pripravljeno oziroma sestavljeno hrano, odpadke s krožnikov in dogodke.

Plačilo ter račun sta v sklopu 06. Zaključek izmene je v sklopu 08.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-23755ca2defc package=lite -->
## 2. Predpogoji

1. Delate v pravilni poslovni enoti in skladišču.
2. Imate pravico za zaloge oziroma proizvodnjo.
3. Artikli, merske enote in stopnje DDV so pravilno urejeni.
4. Pred začetnim stanjem so preverjene dejanske količine.
5. Dobavitelj in prejemnica so pripravljeni pred uvozom dokumenta.
6. Za pripravljeno hrano obstaja receptura oziroma normativ.
7. Za inventuro sta določen datum popisa in odgovorna oseba; v POS preverite
   pravo poslovno enoto.

> **Opozorilo:** Zaloga ni preglednica za približne popravke. Vsako
> spremembo evidentirajte z dokumentom, ki pojasni izvor, količino in datum.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-222526ae0f22 package=lite -->
## 3. WAC in vrednotenje zaloge

WAC pomeni tehtano povprečno nabavno ceno.

Pri prejemu se količina in nabavna vrednost vključita v novo povprečno ceno.

WAC se uporablja za vrednotenje izdaj, porabe, odpadov in pripravljene hrane,
kadar je tako nastavljeno.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2230ce8143aa package=lite -->
### 3.1 Praktična posledica

1. Nabavna cena na prejemnici mora biti pravilna pred potrditvijo.
2. Ne popravljajte prejemnice z novim izmišljeno enakim dokumentom.
3. Popravek naj izvede odgovorna oseba s sledljivim dokumentom.
4. Pred izrednimi odpisi preverite vpliv na vrednost zaloge.

WAC ni prodajna cena. Popust za gosta ne spreminja WAC artikla.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-17b9d65489d7 package=lite -->
## 4. Začetne zaloge

Začetna zaloga se vnese ob začetku uporabe skladišča ali ob dogovorjenem
prehodu na sistem.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c5d0ac4d7fe5 package=lite -->
### 4.1 Pred vnosom

1. Določite datum in uro reza.
2. Zaustavite sočasne prejeme, prenose in inventure za isti rez.
3. Preštejte dejanske količine po artiklih in merskih enotah.
4. Zberite veljavne nabavne vrednosti oziroma WAC po navodilu računovodstva.
5. Preverite, da artikel pripada pravemu skladišču.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a1bcabf35954 package=lite -->
### 4.2 Vnos

1. Odprite **Zaloge → Začetne zaloge** v pravilni aktivni enoti.
2. Pred izbiro artikla izberite obseg **Material** ali **Drobni inventar**
   ter datum reza oziroma leto v prikazanem obrazcu.
3. Dodajte artikel.
4. Vnesite količino v pravilni merski enoti.
5. Pri **Materialu** preverite nabavno ceno in vrednost. Pri
   **Drobnem inventarju** vnesite samo količine; cenovni in vrednostni stolpci se za
   ta obseg ne uporabljajo.
6. Ponovite za vse artikle.
7. Preglejte ničelne, negativne in nenavadno velike količine.
8. Potrdite dokument samo po skupnem pregledu.

Preklop obsega loči živilski material od količinske evidence kozarcev,
krožnikov in podobnih predmetov. Pred potrditvijo preverite obseg še enkrat.
Pri letnem prenosu je datum dokumenta 1. januar, dejanska časovna meja pa je
začetna ura poslovnega dne enote (privzeto 04:00). Promet in poraba 1. januarja
pred to uro, vključno z novoletno zabavo, še pripadata starem letu. Zato sistem
začetnih zalog novega leta ne dovoli ustvariti ali spremeniti pred to uro, število
v prenosu pa naj izhaja iz stanja po zadnjem poslovnem dnevu starega leta.
Uvoz predlog artiklov sam po sebi ni začetna zaloga; dejansko količino
vnesite ločeno in je ne podvojite, če že obstaja prejemnica istega blaga.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5897b04ceff3 package=lite -->
### 4.3 Kontrola po vnosu

1. Odprite kartico vsaj treh reprezentativnih artiklov.
2. Primerjajte količino in vrednost s popisom.
3. Preverite skupno vrednost skladišča.
4. Dokument shranite kot osnovo za revizijsko sled.

Začetnega stanja ne vnašajte ponovno, če po potrditvi odkrijete napako.
Uporabite popravek po navodilu odgovorne osebe.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3ad322f01507 package=lite -->
## 5. Prejemnica

Prejemnica evidentira prevzem blaga v zalogo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7f7c48654d6f package=lite -->
### 5.0 Zaslon prejemnice: pomen polj

| Polje | Kaj vnesete | Kontrola pred potrditvijo |
|---|---|---|
| Poslovna enota | Enoto, ki je blago dejansko prevzela | Ne kopirajte enote z računa dobavitelja. |
| Skladišče | Fizično lokacijo prevzema | Hladilnica, bar ali centralno skladišče niso zamenljivi. |
| Datum dokumenta | Datum dobaviteljeve listine | Ne zamenjajte ga z datumom vnosa. |
| Datum prejema | Dan fizičnega prevzema | Pomemben je za kartico in časovni rez. |
| Dobavitelj | Pogodbenega oziroma dejanskega dobavitelja | Ujemati se mora z listino in davčnimi podatki. |
| Številka dokumenta | Originalno številko dobaviteljevega dokumenta | Ista številka pri istem dobavitelju zahteva pregled duplikata. |
| Valuta | Valuto dobaviteljeve listine, kjer jo obrazec podpira | Preverite pravilno pretvorbo in zaokrožitev. |
| Opomba | Kratko pojasnilo posebnosti prevzema | Vpišite manjkajoče, poškodovano ali poznejšo dobavo. |
| Artikel | Interni zalogovni artikel | Ne izberite podobnega prodajnega artikla brez zalogovne povezave. |
| Količina | Dejansko prevzeto količino | Primerjajte s štetjem, ne samo z dobavnico. |
| Enota | Enoto s fizične dobave | Karton, kilogram in kos niso medsebojno zamenljivi. |
| Pakiranje | Število enot v paketu | Preverite pretvorbo v osnovno skladiščno enoto. |
| Cena | Nabavno ceno po dogovoru | Preverite, ali je cena brez DDV. |
| Rabat | Rabat vrstice ali dokumenta | Razlikujte odstotni rabat in že znižano ceno. |
| DDV | Stopnjo z dobaviteljeve listine | Stopnja mora ustrezati vrsti nabave in nastavitvi artikla. |
| Neto | Izračunano neto vrednost | Količina krat cena minus rabat mora biti smiselna. |
| DDV znesek | Izračun sistema | Primerjajte ga s seštevkom listine ob odstopanju. |
| Bruto | Končni znesek vrstice | Vsota vrstic mora po pravilih zaokroževanja ustrezati dokumentu. |

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5e074c45ce34 package=lite -->
### 5.5 Pravilo štirih primerjav

Pred potrditvijo primerjajte fizično blago z dobavnico.

Nato primerjajte dobavnico z računom oziroma elektronskim dokumentom.

Potem primerjajte račun s pripravljeno prejemnico v POS.

Nazadnje primerjajte seštevke, DDV in število vrstic.

Če katerakoli primerjava ni uspešna, ostane dokument v osnutku.

Osnutek ni potrdilo o prevzemu in ne spremeni razpoložljive zaloge.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-4c83bcbb270f package=lite -->
## 5A. Kartica artikla in sledljivost zaloge

Kartica artikla je časovni zapis vseh potrjenih sprememb za posamezen artikel
v posameznem skladišču.

Ne kaže samo trenutne količine, temveč pojasnjuje, kako je količina nastala.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d8b1a47ea62b package=lite -->
### 5A.1 Branje kartice

1. Odprite **Zaloge > Artikli** in izberite artikel.
2. Izberite pravo skladišče; skupni pogled lahko skriva lokalno pomanjkanje.
3. Nastavite obdobje, ki vključuje datum vprašljive spremembe.
4. Preglejte začetno stanje obdobja.
5. Preglejte vsak vhod: začetna zaloga, prejemnica, prenos ali vračilo.
6. Preglejte vsak izhod: prodaja, poraba, prenos, odpis ali inventurni popravek.
7. Odprite referenco dokumenta, ne sklepajte samo iz opisa vrstice.
8. Primerjajte količino po dogodku z naslednjim fizičnim štetjem.
9. Pri vrednostnem odstopanju preverite WAC pred in po prejemu.
10. Izvoz kartice označite z artiklom, skladiščem in časom priprave.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-59b5fb0c4ede package=lite -->
### 5A.2 Stolpci kartice

| Stolpec | Pomen | Kaj iščete |
|---|---|---|
| Datum | Poslovni datum dogodka | Dogodke izven izbranega reza ali napačnega dne. |
| Čas vnosa | Čas nastanka zapisa | Pozne vnose, ki zahtevajo pojasnilo. |
| Tip | Vrsta skladiščnega dokumenta | Ali je sprememba poslovno pravilno klasificirana. |
| Referenca | Številka izvornega dokumenta | Sled do prejemnice, prenosa, inventure ali odpisa. |
| Vhod | Količina, ki poveča zalogo | Ali se ujema s fizičnim prevzemom. |
| Izhod | Količina, ki zmanjša zalogo | Ali obstaja odobren razlog zanjo. |
| Stanje | Količina po knjiženju | Negativne ali nepričakovane količine. |
| Vrednost | Vrednost spremembe | Nenavadne vrednosti pri majhnih količinah. |
| WAC | Povprečna cena po dogodku | Skok po napačni ceni ali pakiranju. |
| Uporabnik | Izvajalec ali potrjevalec | Kdo lahko pojasni zapis. |

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-13330e5339ff package=lite -->
### 5A.3 Kartica ni nadomestek za popis

Kartica je evidenca sistema, popis pa ugotovitev dejanskega stanja.

Ujemanje kartice in popisa je cilj kontrole, ne predpostavka.

Če kartica kaže deset kilogramov, v hladilnici pa je osem kilogramov,
popišite osem in raziskujte razliko.

Ne spreminjajte kartice neposredno zato, da bi bila podobna štetju.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f88cbc8e149b package=lite -->
### 5A.4 Primer WAC

V skladišču je 10 kg kave po WAC 12,00 EUR/kg.

Vrednost pred prejemom je zato 120,00 EUR.

Prejmete 5 kg po 15,00 EUR/kg oziroma za 75,00 EUR.

Po prejemu je količina 15 kg in vrednost 195,00 EUR.

Novi WAC je 13,00 EUR/kg.

Izdaja 2 kg nato vrednoti zalogo s 26,00 EUR, če sistem uporablja WAC.

Dobaviteljeva zadnja cena 15,00 EUR ni samodejno cena izdaje.

Prodajna cena espressa pri tem izračunu ni pomembna.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-80b9e36e6458 package=lite -->
### 5A.5 Primer opozorila WAC

Če je na računu cena 150,00 EUR namesto 15,00 EUR, je posledica večja
od napačne vrstice.

WAC se lahko skokovito poveča in vpliva na poznejše odpise ter porabo.

Dokument ustavite v osnutku, preverite decimalno mesto in pakiranje.

Po potrditvi uporabljajte samo odobren korekcijski dokument.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2d85b54d4bb1 package=lite -->
## 5B. Artikli, enote, pakiranja in cene

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-61bfa34584e1 package=lite -->
### 5B.1 Osnovna enota

Za vsak zalogovni artikel določite osnovno enoto, v kateri sistem vodi stanje.

Pri mleku je lahko osnovna enota liter.

Pri mesu je lahko osnovna enota kilogram.

Pri konzervah je lahko osnovna enota kos.

Pri pijači je lahko osnovna enota steklenica ali liter, vendar naj bo izbira
dosledna skozi prevzem, recepturo, prenos in inventuro.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0e2bc6aa8fcd package=lite -->
### 5B.2 Pakiranje

Pakiranje pove, koliko osnovnih enot vsebuje nabavna enota.

Primer: karton vsebuje 24 steklenic po 0,33 l.

Če artikel vodi zalogo v steklenicah, en karton pomeni 24 kosov.

Če artikel vodi zalogo v litrih, en karton pomeni 7,92 l.

Ne vnesite količine 24 in pakiranja 24, če obrazec pričakuje samo eno
od teh dveh vrednosti.

Pred prvim prevzemom naredite test na enem paketu in preverite kartico.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d3f6e1173b84 package=lite -->
### 5B.3 Pretvorbe

| Nabavna navedba | Možna osnovna enota | Potrebna nastavitev |
|---|---|---|
| 6 × 1 l | liter | Karton je šest litrov. |
| 12 × 0,5 l | liter | Karton je šest litrov. |
| 10 kg | kilogram | Vnos 10 kilogramov brez dodatne pretvorbe. |
| 20 × 250 g | kilogram | Karton je pet kilogramov. |
| 24 kos | kos | Karton je 24 kosov. |
| 1 zaboj | steklenica | Zaboj mora imeti določeno število steklenic. |

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9c20c9364763 package=lite -->
### 5B.4 Cena pakiranja

Cena na dokumentu je lahko cena kartona, kosa ali osnovne enote.

Pred potrditvijo ugotovite, katero ceno zahteva vrstica prejemnice.

Če je cena kartona 48,00 EUR za 24 steklenic, je cena steklenice 2,00 EUR.

Če sistem pričakuje ceno osnovne enote, ne vpišite 48,00 EUR ob količini 24.

Tak vnos bi zalogo ovrednotil na 1.152,00 EUR namesto 48,00 EUR.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-6f856db0fc64 package=lite -->
### 5B.5 Nabavna, prodajna in davčna cena

Nabavna cena je podlaga za vrednotenje zaloge.

Prodajna cena je podlaga za račun gostu.

Stopnja DDV določa davčni prikaz prodaje oziroma nabave po nastavitvah.

Rabat dobavitelja znižuje nabavno vrednost po pravilih dokumenta.

Popust gostu spreminja promet računa, ne količine zaloge in ne WAC.

Ne uporabljajte popusta na POS računu za popravljanje nabavne cene.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-710000b5237d package=lite -->
### 5B.6 DDV na prejemnici

Preverite, ali dobaviteljeva cena predstavlja neto ali bruto znesek.

Preverite, ali je DDV vrstični ali dokumentni podatek.

Mešan dokument z različnimi stopnjami DDV preglejte po vrsticah.

Ne prepisujte ene stopnje na vse vrstice zgolj zaradi hitrejšega vnosa.

Pri dvomu primerjajte neto, DDV in bruto seštevek z originalom.

Davčno obravnavo spremeni samo pooblaščena oseba.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-6df772cf660f package=lite -->
## 5C. OCR, kamera in uvoz dokumentov

OCR in uvoz predlagata podatke; ne potrjujeta resničnosti prevzema.

Odgovornost za potrjeni dokument ostane pri osebi, ki ga pregleda.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-503aaeb66574 package=lite -->
### 5C.1 Fotografiranje dokumenta

1. Položite dokument na ravno, dobro osvetljeno podlago.
2. Posnemite cel dokument, vključno z glavo in končnimi seštevki.
3. Izogibajte se bleščanju, senci, pregibom in prekritim robovom.
4. Preverite ostrino številke dokumenta, količin in cen.
5. Pri več straneh posnemite vsako stran v pravilnem vrstnem redu.
6. Če je dokument nečitljiv, uporabite originalni PDF ali ročni vnos.
7. Fotografije ne obdelujte tako, da bi se spremenili podatki listine.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1e27e51385fb package=lite -->
### 5C.2 OCR pregled po poljih

| OCR predlog | Obvezno preverjanje |
|---|---|
| Dobavitelj | Naziv, identifikator in podobno imenovani dobavitelji. |
| Številka računa | Ničle, črke O, pomišljaje in predpono. |
| Datum | Datum računa v primerjavi z datumom prejema. |
| Artikel | Ali opis res označuje kupljeni artikel. |
| Količina | Decimalno vejico, maso in število paketov. |
| Cena | Valuto, neto/bruto oznako in decimalno mesto. |
| DDV | Stopnjo vsake skupine in skupni DDV. |
| Skupaj | Neto, DDV, bruto in morebitni depozit embalaže. |

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-795f0beaef09 package=lite -->
### 5C.3 Uvoz datoteke

Uvozite samo datoteko iz zaupanja vrednega vira.

Pred uvozom preverite, za katero poslovno enoto in skladišče velja dokument.

Izberite predlogo uvoza, ki ustreza stolpcem dobavitelja.

Predogled uvoza primerjajte s številom vrstic v izvorni datoteki.

Zavrnjene vrstice ne izginejo: preberite razlog in jih obravnavajte.

Če uvoz vsebuje samo zavrnjene ali ničelne vrstice, ga ne potrdite.

Po uvozu shranite izvorno datoteko skladno s politiko hrambe.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-318d539e7047 package=lite -->
### 5C.4 Ujemanje dobavitelja

Samodejni predlog dobavitelja sprejmite le ob jasnem ujemanju.

Preverite naziv, davčno številko oziroma drug stabilen identifikator.

Podobno ime ni dokaz, da gre za isto pravno osebo.

Različne poslovalnice iste skupine so lahko različni dobavitelji v evidenci.

Če dobavitelja ni, ga ustvari ali odobri oseba z ustrezno pravico.

Ne izberite prvega zadetka samo zato, da bi nadaljevali z OCR.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a4110450dc9c package=lite -->
### 5C.5 Ujemanje artikla

Predlagani artikel primerjajte z dobaviteljevo šifro, EAN, opisom in pakiranjem.

Enak naziv z drugo gramature ni nujno isti zalogovni artikel.

Primer: “smetana 1 l” in “smetana 0,5 l” nista zamenljivi vrstici.

Če artikel še ne obstaja, ga ne vežite samovoljno na podoben artikel.

Ustvarite zahtevek za novi artikel ali počakajte na odobreno šifro.

Potrdite trajno povezavo dobaviteljeva šifra–artikel le po pregledu prvega
in naslednjega dokumenta.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b255976633b0 package=lite -->
### 5C.6 Neznana embalaža

Ustavite vrstico, kadar OCR prebere artikel, vendar ne pakiranja.

Iz dokumenta razberite število kosov, volumen ali maso na paket.

Vnesite pravilno pretvorbo pred potrditvijo.

Če podatka ni na dokumentu, preverite specifikacijo dobavitelja.

Nikoli ne domnevajte, da sta karton in zaboj enake velikosti.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-41d112385908 package=lite -->
### 5C.6A Povratna embalaža: vračilo ali odpis

Pri povratni embalaži vedno ločite dva dogodka:

* **Vračilo embalaže** uporabite samo, ko embalažo dejansko prejme dobavitelj.
  Program zmanjša fizično zalogo in saldo pri dobavitelju. Pri pozitivni
  depozitni vrednosti pripravi osnutek D 220 / K 3107000.
* **Odpis povratne embalaže** uporabite za razbito, uničeno ali drugače
  nevračljivo embalažo. Dobavitelja, artikel in pozitivno količino izberete v
  prejemnicah v razdelku **Odpis povratne embalaže**, nato določite razlog in
  po potrebi dodate opombo.

Odpis v eni operaciji zmanjša fizično zalogo in saldo pri izbranem dobavitelju.
Učinek je odvisen od dogodka in zgodovinske depozitne vrednosti:

| Dogodek | Fizična zaloga | Saldo dobavitelja | Temeljnica pri pozitivni vrednosti | Učinek na 220 | Vrednost 0,00 EUR |
|---|---:|---:|---|---|---|
| Vračilo dobavitelju | zmanjša | zmanjša | D 220 / K 3107000 | zmanjša obveznost | brez temeljnice |
| Odpis | zmanjša | zmanjša | D strošek odpisa / K 3107000 | brez spremembe | brez temeljnice |

Pred potrditvijo primerjajte prikazani saldo dobavitelja, skupno fizično zalogo
in količino odpisa. Program ne dovoli količine, ki bi presegla katerega koli od
obeh razpoložljivih saldov. Če zahteva po prekinitvi povezave nima jasnega
izida, ne ustvarite novega dogodka z drugačnim podatkom; najprej osvežite
bilanco, saj ponovitev iste operacije ne sme zaloge zmanjšati dvakrat.

Če program količino zavrne, osvežite bilanco in ponovno preverite oba salda.
Ne spreminjajte količine ali operacije samo zato, da bi obšli opozorilo. Enaka
ponovljena operacija vrne že evidentirani rezultat; zahteva z istim ključem in
drugačnimi podatki je zavrnjena.

Primer: pri dobavitelju je evidentiranih 20 zabojev, dva sta se razbila,
depozitna vrednost pa je 3,00 EUR. Vnesite odpis 2 kosov z razlogom
**Razbitje**. Po potrditvi morata dobaviteljski saldo in fizična zaloga
pokazati 18 kosov, osnutek temeljnice pa 6,00 EUR:

| Konto (primer) | D/K | Znesek |
|---|---:|---:|
| 4802000 Strošek uničene povratne embalaže | D | 6,00 |
| 3107000 Zaloga povratne embalaže | K | 6,00 |

Pred uporabo v **Nastavitve → Računovodstvo → POS konti** preverite:

* **Zaloga povratne embalaže** je nastavljena na aktivni proknjižljivi konto
  3107000;
* **Strošek odpisa povratne embalaže** je nastavljen na aktivni proknjižljivi
  konto razreda 4.

Številka 4802000 v primeru je ponazoritev; uporabite konto iz kontnega načrta
podjetja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-55c8b4bd3823 package=lite -->
### 5C.6B Dobropis za že vrnjeno povratno embalažo

Dobropis dobavitelja za embalažo, ki ste jo že fizično vrnili, ni novo vračilo.
V prejemnicah odprite razdelek **Dobropisi — povratna embalaža**, izberite
dobropis in ustrezno evidentirano vračilo ter vnesite samo še nepovezano
količino.

Po potrditvi program poveže dobropis z dokazom fizičnega vračila. Ne ustvari
nove temeljnice in ne zmanjša zaloge ali dobaviteljskega salda še enkrat.
Delno povezovanje je dovoljeno do preostale količine na obeh straneh.

Če ste izbrali napačno vračilo ali količino, uporabite **Razveljavi**. Popravek
ohrani revizijsko sled; ne ponavljajte fizičnega vračila in ne brišite
izvornega dobropisa.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-ad30d51fd555 package=lite -->
### 5C.7 Kontrolni seštevki uvoza

Število uvoženih vrstic primerjajte s številom vrstic listine.

Seštevek količin primerjajte po enotah, ne samo po številu vrstic.

Neto seštevek primerjajte z neto seštevkom listine.

DDV primerjajte po stopnjah, kadar jih je več.

Bruto seštevek primerjajte po dovoljenem pravilu zaokrožitve.

Rabat in vračljivo embalažo obravnavajte ločeno, če tako določa nastavitev.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-cc86837a8914 package=lite -->
### 5C.8 Duplikati

Sistem lahko opozori na enako številko dokumenta, dobavitelja, datum ali znesek.

Opozorilo pomeni “preverite”, ne “potrdite kljub temu”.

Odprite obstoječi dokument in primerjajte številko, vrstice ter status.

Enaka številka pri dobropisu ali drugi seriji lahko zahteva dodatno razlago.

Če gre za dejanski duplikat, nove prejemnice ne potrdite.

Če ne gre za duplikat, v opombo zapišite razlog in nadaljujte samo z dovoljenjem.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-155fd9cd321e package=lite -->
### 5C.9 Ničelne vrstice

Vrstica s količino nič ne poveča zaloge in običajno nima poslovnega smisla.

Pred potrditvijo jo odstranite ali popravite.

Če dokument vsebuje brezplačno postavko, vnesite dejansko količino in ničelno
ceno le, kadar to dovoljuje postopek.

Ničelne vrstice ne uporabljajte za komentar ali ločevanje skupin.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-51b5c90e110e package=lite -->
### 5C.10 Pogoste OCR napake

Črka O se lahko prebere kot številka 0.

Število 1 se lahko prebere kot črka I.

Decimalna vejica lahko izgine ali se spremeni v piko.

Minus pri dobropisu lahko manjka.

Šifra artikla se lahko zamenja zaradi slabe ločljivosti.

Opis se lahko prelomi čez dve vrstici in ustvari napačen artikel.

Končni seštevek se lahko prepozna kot dodatna vrstica artikla.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-dbffee741e35 package=extended -->
## 5D. Prenosi zaloge za dogodke

POS podpira prenos zaloge v okviru modula **Dogodki**, ko se blago pošlje v
začasno dogodkovno enoto in se po dogodku evidentira porabljena, preostala ter
vrnjena količina. To ni splošni prenos med poljubnimi skladišči, barom ali
kuhinjo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0543e55ccd2a package=extended -->
### 5D.1 Pošiljanje zaloge na dogodek

1. Odprite pravi dogodek in preverite njegovo začasno enoto.
2. Preverite izvorno enoto, iz katere se zaloga dejansko odpremi.
3. Dodajte samo artikle in količine, ki fizično odhajajo na dogodek.
4. Količine vnesite v merskih enotah, ki jih uporablja izbrani artikel.
5. Pred potrditvijo primerjajte seznam z dejansko pripravljeno pošiljko.
6. Potrdite prenos v okviru dogodka.
7. Preverite, da je prenos prikazan v zgodovini izbranega dogodka.

Splošnega prenosa med običajnimi skladišči ta postopek ne nadomešča. Če premik
ni povezan z dogodkom, uporabite drug odobren zalogovni dokument ali primer
predajte odgovorni osebi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-179d47d3ec04 package=extended -->
### 5D.2 Poraba, preostanek in vračilo

Po dogodku mora veljati:

**poslano = porabljeno + preostalo + vrnjeno**.

1. Preverite fizični preostanek v začasni enoti.
2. Primerjajte prodajo in drugo evidentirano porabo dogodka.
3. Pripravite vračilo samo za količino, ki se fizično vrača.
4. Vračilo potrdite v okviru istega dogodka in izvirnega prenosa.
5. Preverite, da vrnjena količina ne presega preostale dogodkovne količine.
6. Odstopanje ustavite in raziščite; ne izravnavajte ga z izmišljenim prenosom.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f964e9579db4 package=extended -->
### 5D.3 Prenos ni rešitev za manjko

Dogodkovnega prenosa ne ustvarjajte zato, da bi odstranili negativno stanje v
redni enoti. Najprej preverite zamujeni prejem, prodajo, recepturo, dogodkovno
porabo, vračilo in inventuro.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-81589b43118b package=lite -->
## 5E. Inventura in prilagoditve

Inventura je organiziran popis dejanskih količin na določen datum in uro.

Prilagoditev je sledljiv dokument, ki uredi ugotovljeno razliko po odobritvi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a742320d8547 package=lite -->
### 5E.1 Priprava inventure

1. Določite poslovno enoto, datum popisa in odgovorno osebo. V POS-u je
   inventura vezana na izbrano enoto; obrazec inventure nima izbire skladišča.
2. Ustavite ali jasno časovno ločite prejeme, prenose in proizvodnjo.
3. Za fizično štetje pripravite popisne liste po lokacijah, ne samo po
   abecedi artiklov. Lokacije zabeležite v svojem popisnem postopku.
4. Označite že preštete police, hladilnike in zamrzovalnike.
5. Ločite prodajno blago, vračila, poškodovano blago in tuje blago.
6. Določite način štetja odprte embalaže.
7. Zagotovite drugo štetje za vrednostno ali količinsko pomembne artikle.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-e6e0016e6a88 package=lite -->
### 5E.2 Štetje

Štejte fizično stanje, ne pričakovanega stanja s kartice.

Vpišite količino v enoti popisnega lista.

Ne zaokrožujte odprtih količin, če recepture uporabljajo decimalne enote.

Prazne embalaže ne štejte kot polne zaloge.

Blago s pretečenim rokom ločite in označite za odločitev o odpisu.

Neznan artikel fotografirajte ali zapišite tako, da ga je mogoče pozneje določiti.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-ecbb019dded9 package=lite -->
### 5E.3 Vnos in odobritev

1. Odprite **Zaloge → Inventure** v pravi poslovni enoti in preverite datum.
2. Vnesite fizično preštete količine ali uporabite OCR za izpolnjen popisni
   list; OCR-predloge pred potrditvijo ročno preverite.
3. Preglejte velike razlike po količini in vrednosti.
4. Primerjajte z nedavnimi prejemi, prenosi in proizvodnjo.
5. Dodajte razlog, kadar politika zahteva obrazložitev.
6. Pred shranjevanjem opravi pregled odgovorna oseba.
7. Izberite **Potrdi inventuro** šele po zaključenem pregledu: s potrditvijo
   se inventura shrani in takoj ustvari inventurni popravek zaloge. To ni
   pošiljanje v ločen status »v pregledu«.
8. Preverite kartico in seznam inventur po potrditvi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-108978817813 package=lite -->
### 5E.4 Razlogi za razliko

Razlika je lahko zamujen prejem.

Razlika je lahko nepravilno pakiranje na prejemnici.

Razlika je lahko neknjižen prenos.

Razlika je lahko nepopolna receptura.

Razlika je lahko pokvarjeno ali odpadno blago.

Razlika je lahko kraja ali napačno ravnanje.

Razlika je lahko napaka pri prvem ali drugem štetju.

Razlog zapišite na podlagi preverjanja, ne ugibanja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f663a02d2819 package=lite -->
### 5E.5 Negativne zaloge

Negativno stanje pomeni, da je sistem zabeležil več izhodov kot vhodov.

Ne predstavlja fizičnega dokaza, da je zaloga negativna.

Najprej preverite časovni red dokumentov.

Nato preverite enote in pretvorbe.

Če je artikel sodeloval na dogodku, preverite poslano, porabljeno, preostalo in
vrnjeno količino v zgodovini tega dogodka.

Preverite, ali prodajni artikel porablja pravi zalogovni artikel.

Ne popravljajte negativnega stanja z izmišljeno prejemnico.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1cd7539ea75c package=standard -->
## 5F. Pripravljena in sestavljena hrana

Pripravljena hrana nastane, ko se surovine pretvorijo v zalogovni izdelek.

Sestavljena hrana oziroma kompozit lahko vsebuje več sestavin in izkoristek.

Prodajni artikel ni samodejno tudi zalogovni polizdelek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d0bcfcb70dc7 package=standard -->
### 5F.1 Receptura

Receptura določa vhodne sestavine, njihove količine in izhod.

Za vsako sestavino preverite artikel, enoto in normativno količino.

Za izhod določite količino, enoto in pričakovani izkoristek.

Voda, olje, začimbe in embalaža naj bodo vključeni, kadar so materialno pomembni
in jih politika podjetja spremlja.

Receptura mora odražati dejanski postopek, ne idealnega recepta iz kuharice.

Spremembo recepture datirajte in odobrite pred uporabo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8e587249d6b9 package=lite -->
### 5F.2 Dnevna evidenca pripravljene hrane

Namenska stran **Pripravljena hrana** uporablja **Dnevno evidenco** po
poslovnem datumu, ne splošnega proizvodnega naloga z izbiro skladišča
surovin in izdelka.

1. Šele po začetni uri poslovnega dne 1. januarja in ko so vse dnevne evidence
   starega leta zaključene (vključno z novoletno zabavo), v zavihku **Začetna zaloga (Letna)**
   preverite leto, začetno število porcij in strošek na porcijo ter izberite
   **Shrani vse**. To je operativna osnova za vrednotenje kala, ne začetna
   računovodska knjižba. Prenos prevzame zadnjo zamrznjeno količino in strošek na
   porcijo starega leta, ne porabi sestavin še enkrat in ne ustvari knjižbe. Če
   prenos zavrne sporočilo o nezaključeni evidenci ali prezgodnji uri, najprej
   odpravite vzrok in ga nato ponovite z gumbom **Ponovno preveri**. Po prvem zaključenem dnevu leta začetne zaloge za to
   leto ni več mogoče spreminjati.
2. V zavihku **Dnevna evidenca** izberite datum. Za vsak artikel vnesite
   odtajano in dejansko novo pripravljeno količino, po potrebi korekcijo ter
   dejansko količino, ki je ob koncu ostala zamrznjena.
3. Preverite prodano količino, ki jo sistem prikaže, ter izračun kala. Negativni
   kalo je treba razjasniti; dnevne evidence ne zaključujte z nepojasnjenim
   izračunom.
4. Izberite **Shrani vse**, dokler so podatki še odprti. Nato uporabite
   **Zaključi vse** in pred potrditvijo preglejte prikazani kalo. Zaključene
   vrstice so samo za ogled.
5. Ob zaključku sistem porabi sestavine po normativu za novo pripravljeno
   količino ter uskladi odtajano in ob koncu zamrznjeno količino. Po zaključku
   preverite kartice zaloge sestavin in zapisnik kala v zavihku **Zapisniki
   kala**.

Shranjevanje dnevnih vnosov samo po sebi še ni potrditev porabe. Ne ustvarjajte
vzporednega ročnega proizvodnega naloga za isto pripravo, saj bi lahko podvojili
porabo sestavin.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2c5d25cf6cbc package=standard -->
### 5F.3 Primer juhe

Receptura za 20 litrov juhe porabi 4 kg zelenjave, 1 kg mesa in 20 litrov osnove.

Če kuhinja pripravi 18 litrov, ne potrdite samodejno 20 litrov.

Vnesite dejanski izhod in preverite, ali je preostanek pojasnjen z izkoristkom,
odpadom ali napačnim merjenjem.

Če se je del juhe razlil, ga evidentirajte kot odpad po pravilnem razlogu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8c75098d6fcf package=standard -->
### 5F.4 Zamrznjena operativna zaloga

Zamrznjena operativna zaloga je stanje pripravljene hrane za redno delo.
Fizično je lahko shranjena v ločenem zamrzovalniku, vendar POS tega ne
obravnava kot splošen prenos med skladišči.

Zamrznjeno količino evidentirajte v postopku pripravljene hrane.

Odtajanje ne pomeni samodejnega odpisa.

Količino odtajenega blaga spremljajte v istem operativnem postopku pripravljene
hrane, ne z ročnim zmanjšanjem brez razloga.

Pretečen, poškodovan ali temperaturno sporen izdelek obravnavajte kot odpad
po odobritvi in s konkretnim razlogom.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1afb8e6c1fbe package=standard -->
### 5F.5 Sestavljeni izdelki in prodaja

Če prodaja jed porablja sestavine neposredno, mora normativ povezati prodajno
jed z zalogovnimi artikli.

Če prodaja porablja pripravljen polizdelek, pred prodajo preverite, da je
pripravljena količina zabeležena v dnevni evidenci in da prodajni normativ
porablja pravi polizdelek. Poraba surovin za novo pripravo nastane ob zaključku
dnevne evidence; za isto količino ne ustvarjajte še ročnega naloga.

Ne uporabljajte obeh poti hkrati, razen če je receptura namenoma tako sestavljena.

Dvojna poraba napihne strošek in povzroči navidezni manko.

Manjkajoča povezava povzroči prodajo brez porabe in navidezni presežek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3ed06203a7e9 package=standard -->
## 5G. Odpad, krčenje in odpad s krožnikov

Odpad je dokumentirana izguba zaloge, ki ni prodaja in ni prenos.

Krčenje oziroma shrinkage je širši izraz za nepojasnjene ali operativne izgube.

Odpad s krožnikov je hrana, vrnjena po strežbi ali ostanek po gostu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1c95203195b5 package=standard -->
### 5G.1 Kategorije odpada

| Kategorija | Primer | Obvezen podatek |
|---|---|---|
| Pokvarjeno | Pretečen mlečni izdelek | Količina, rok in razlog. |
| Poškodovano | Razbita steklenica | Količina, okoliščina in izvajalec. |
| Priprava | Zažgana omaka | Sestavina ali polizdelek ter vzrok. |
| Krožnik | Neprodani ostanek po gostu | Jed, ocena količine in razlog, kjer je znan. |
| Vračilo | Napačno pripravljena jed | Povezava z naročilom, če obstaja. |
| Temperatura | Prekinjena hladna veriga | Artikel, količina in odločitev odgovorne osebe. |
| Inventurna razlika | Neugotovljen manko pri popisu | Popis, pregled in odobritev. |

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-de2a0ca163aa package=standard -->
### 5G.2 Postopek odpada

1. Ustavite uporabo artikla, če je kakovost ali varnost vprašljiva.
2. Izberite pravo skladišče in artikel.
3. Vnesite dejansko količino in pravilno enoto.
4. Izberite najnatančnejši razlog.
5. Dodajte opombo z dejstvi, ne osebnih ocen.
6. Dodajte dokazilo ali fotografijo, kadar postopek to zahteva.
7. Pridobite odobritev nadrejenega pri določeni meji.
8. Potrdite dokument in fizično odstranite blago skladno s pravili.
9. Preglejte vpliv na kartico in poročilo odpada.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-283d868ea585 package=standard -->
### 5G.3 Odpad s krožnikov

Odpad s krožnikov ne zamenjujte s stornom računa.

Storno ureja prodajni dokument, odpad pa fizično porabo ali zavrženo hrano.

Če gost vrne neustrezno jed in se izda dobropis, evidentirajte oba dogodka,
kadar je bila jed dejansko pripravljena.

Količino ocenite po dogovorjeni metodi: delež porcije, teža ali standardna mera.

Metodo uporabljajte dosledno, da so poročila primerljiva.

Ne beležite osebnih podatkov gosta v opombo odpada.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0a71566374fb package=standard -->
### 5G.4 Analiza krčenja

Primerjajte odpad po artiklu, kategoriji, izmeni in obdobju.

Velik skok preverite proti spremembi recepture, dobavi, temperaturi ali dogodku.

Odpad ne prikrivajte s prilagoditvijo inventure brez razloga.

Inventurna razlika in odpad naj ostaneta ločena, dokler vzrok ni potrjen.

Vodja določi korektivni ukrep: usposabljanje, naročanje, skladiščenje ali nadzor.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-cf413753b64b package=extended -->
## 5H. Dogodki, pogostitve in uskladitev

Dogodek je načrtovana ali izredna poraba, ki jo je treba ločiti od redne prodaje.

Primeri so degustacija, interna pogostitev, promocija, catering in zaprta družba.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9be43daed644 package=extended -->
### 5H.1 Pred dogodkom

1. Določite naročnika, datum, enoto in odgovorno osebo.
2. Določite, ali se poraba zaračuna, knjiži interno ali sledi pogodbi.
3. Pripravite seznam artiklov, jedi ali predvidenih porcij.
4. Določite skladišče izdaje in morebitne prenose na lokacijo.
5. Določite način evidentiranja vračil in neporabljenega blaga.
6. Preverite, da so cene, DDV in popusti urejeni na prodajni strani, kadar se zaračunava.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-febbfa8cb80c package=extended -->
### 5H.2 Med dogodkom

Evidentirajte dodatno izdano blago z referenco dogodka, kadar postopek to omogoča.

Ločite prodano blago od degustacijskega, internega in odpadnega blaga.

Ne uporabljajte splošnega odpisa kot bližnjice za neobračunano strežbo.

Za odprte pakete določite osebo, ki bo po dogodku preverila preostanek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-71737d3c56fc package=extended -->
### 5H.3 Po dogodku

1. Preštejte vračljivo in neporabljeno blago.
2. Prenesite ga nazaj v pravo skladišče, če je fizično vrnjeno.
3. Evidentirajte dejansko pripravljeno hrano in ostanek.
4. Evidentirajte odpad ločeno od vračila.
5. Primerjajte porabo z načrtovanim številom porcij.
6. Primerjajte zaračunano prodajo z dogovorom oziroma ponudbo.
7. Zapišite odstopanja in odgovorno osebo za nadaljnji ukrep.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7babdbf303e3 package=extended -->
### 5H.4 Primer uskladitve cateringa

Za dogodek je iz skladišča izdanih 60 steklenic vode.

Po dogodku se 12 neodprtih steklenic vrne v centralno skladišče.

Šest steklenic je evidentiranih kot degustacija.

Dve sta poškodovani in se evidentirata kot odpad.

Preostalih 40 mora imeti razlago v prodaji oziroma pogodbeno evidentirani porabi.

Če razlage ni, ne ustvarite samodejne inventurne prilagoditve brez pregleda.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-4b926d964a71 package=lite -->
## 5I. Vloge in dovoljenja

| Vloga | Običajna opravila | Česa ne potrjuje brez pooblastila |
|---|---|---|
| Skladiščnik | Prevzem, popis, priprava osnutka | Sprememb cen, končnih odpisov in izrednih razlik. |
| Kuhinja | Sporočanje dejanske priprave in odpada vodji | Potrditve dnevne evidence ali inventurne prilagoditve brez ustreznih POS pravic. |
| Vodja izmene | Pregled, potrjevanje v okviru pravic | Nastavitev enot, WAC pravil in davčnih podatkov. |
| Nabava | Dobavitelji, cenovne kontrole, uvoz | Fizičnega prevzema, ki ga ni opravila. |
| Računovodstvo | Vrednostne kontrole in uskladitve | Izmišljene fizične količine. |
| Skrbnik | Nastavitve in dostopi | Poslovnih potrditev namesto odgovorne osebe. |

Uporabnik potrjuje samo dokumente, za katere lahko potrdi dejanska dejstva.

Skupna prijava ali prevzem tuje prijave zmanjšuje sledljivost in ni dovoljen.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5a135d11294c package=lite -->
## 5J. Odpravljanje težav

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b765d98f1261 package=lite -->
### 5J.1 Artikel ni na voljo v prejemnici

Preverite, ali iščete po internem nazivu, šifri ali črtni kodi.

Preverite poslovno enoto in dostop do artikla.

Preverite, ali je artikel arhiviran ali omejen na drugo skladišče.

Ne nadomestite ga s podobnim artiklom brez potrjene povezave.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5e25a79a808a package=lite -->
### 5J.2 Cena se zdi previsoka

Preverite decimalno mesto.

Preverite valuto.

Preverite, ali je cena kartona namesto cene enote.

Preverite, ali je znesek bruto namesto neto.

Primerjajte z listino in prejšnjo potrjeno prejemnico.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8a73a748a5f3 package=lite -->
### 5J.3 OCR je ustvaril podvojene vrstice

Primerjajte vrstico z originalnim dokumentom.

Obdržite eno pravilno vrstico in odstranite napačni predlog v osnutku.

Preverite, da skupna količina po popravku ustreza listini.

Ne potrjujte obeh vrstic zato, ker je skupni znesek “približno” pravilen.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1601e55e01e0 package=lite -->
### 5J.4 Inventura ne pojasni razlike

Ponovno preverite največje vrednostne artikle.

Preverite dogodke od zadnje uspešne inventure.

Preverite spremembe receptur in pakiranj.

Preverite neodobrene osnutke prejemnic in prenosov.

Eskalirajte razliko z dokumentiranimi ugotovitvami.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0445d3bc5e1a package=lite -->
## 5K. Kontrolni seznami, vaje in preverjanje znanja

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d1a368f3d57a package=lite -->
### 5K.1 Kontrolni seznam pred potrditvijo prejemnice

- [ ] Prava enota in skladišče sta izbrana.
- [ ] Dobavitelj in številka dokumenta sta preverjena.
- [ ] Fizično prevzete količine ustrezajo vrsticam.
- [ ] Enote in pakiranja so pravilno pretvorjena.
- [ ] Cene, rabati in DDV ustrezajo listini.
- [ ] Ni podvojenih, ničelnih ali neznanih vrstic.
- [ ] Neto, DDV in bruto seštevki so pojasnjeni.
- [ ] OCR predlogi so pregledani, ne samo sprejeti.
- [ ] Dokument ima opombo o posebnostih.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c60be91e5705 package=lite -->
### 5K.2 Kontrolni seznam inventure

- [ ] Rez in skladišče sta jasna.
- [ ] Sočasni premiki so zaustavljeni ali časovno ločeni.
- [ ] Odprta embalaža je šteta po dogovorjeni metodi.
- [ ] Poškodovano in pretečeno blago je ločeno.
- [ ] Velike razlike imajo preverjen razlog.
- [ ] Prilagoditve so odobrene in sledljive.
- [ ] Kartice po potrditvi kažejo pričakovano stanje.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-31e7f10e696e package=lite -->
### 5K.3 Vaja: prevzem pijače

Dobavitelj pripelje dva kartona po 24 steklenic po 0,33 l.

Račun navaja 96,00 EUR neto in ustrezni DDV.

Skladišče vodi artikel v steklenicah.

Koliko osnovnih enot prevzamete?

Katero ceno na steklenico preverite pred potrditvijo?

Kateri trije seštevki morajo ustrezati računu?

Odgovor: 48 steklenic, 2,00 EUR neto na steklenico, neto/DDV/bruto seštevek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8fb57b5ab0cb package=lite -->
### 5K.4 Vaja: dogodek

Na degustacijo je prenesenih 30 kosov izdelka.

Po dogodku se 8 kosov vrne, 4 so porabljeni za degustacijo, 1 je poškodovan.

Kje poiščete razlago za preostalih 17 kosov?

Odgovor: v zaračunani prodaji ali odobreni pogodbeni porabi dogodka.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-26ff4ed54a0c package=lite -->
### 5K.5 Preverjanje znanja

1. Ali OCR potrdi prejemnico brez pregleda uporabnika?

Pravilni odgovor: ne; OCR zgolj predlaga podatke.

2. Ali prodajni popust spremeni WAC?

Pravilni odgovor: ne; WAC določa nabavna evidenca.

3. Kaj storite ob ničelni vrstici?

Pravilni odgovor: odstranite ali popravite jo, razen dovoljenega posebnega primera.

4. Kdaj je v POS-u dovoljen prenos, opisan v tem poglavju?

Pravilni odgovor: v okviru dogodka oziroma začasne dogodkovne enote. Ne gre za
splošen prenos med poljubnimi skladišči.

5. Ali se ostanek s krožnika evidentira kot storno računa?

Pravilni odgovor: ne; prodajni popravek in fizični odpad sta ločena dogodka.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-bf8007a6cc2b package=lite -->
### 5K.6 Dnevni nadzor zaloge

Vodja pregleda nepotrjene prejemnice pred koncem delovnega dne.

Vodja pregleda negativna stanja po skladiščih.

Vodja pregleda odpise z razlogom “drugo”.

Vodja pregleda nenavadne spremembe WAC.

Vodja pregleda dogodkovne prenose in osnutke vračil, ki še niso zaključeni.

Vodja pregleda pripravljeno hrano brez ustrezne porabe sestavin.

Vodja pregleda dogodke z nepojasnjenim preostankom.

Za vsako izjemo določi lastnika in rok razrešitve.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d175cac54ddb package=lite -->
### 5K.7 Mesečna uskladitev

Primerjajte knjigovodsko zalogo z zadnjo odobreno inventuro.

Primerjajte skupno vrednost po skladiščih z dogovorjenim poročilom.

Preglejte deset vrednostno največjih prejemnic.

Preglejte artikle z največjo količinsko razliko.

Preglejte artikle z največ odpada po vrednosti.

Preglejte spremembe pakiranj in receptur v obdobju.

Preglejte nove trajne povezave OCR artiklov.

Dokumentirajte ugotovitve in odobrene ukrepe.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-270e5e55b0e1 package=lite -->
### 5K.8 Hitri vprašalnik za prevzemnika

Ali sem prevzel blago ali le prepisal račun?

Ali je številka dokumenta že v sistemu?

Ali je količina v isti enoti kot fizično blago?

Ali cena pomeni karton, kos ali kilogram?

Ali je rabat že v ceni ali ga moram vnesti?

Ali se neto, DDV in bruto seštevek ujemajo?

Ali sem preveril vsak OCR predlog?

Ali lahko pozneje pokažem izvorni dokument?

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-42379175d1a5 package=lite -->
### 5.1 Ročni vnos prejemnice

1. Odprite **Zaloge** in izberite novo prejemnico.
2. Izberite dobavitelja, skladišče in datum dokumenta.
3. Vnesite številko dobaviteljevega dokumenta.
4. Dodajte artikle.
5. Za vsak artikel preverite količino, enoto, ceno in DDV.
6. Primerjajte vrstice s fizično dobavo.
7. Preverite skupne zneske in morebitne rabate.
8. Shranite osnutek, če pregled še ni končan.
9. Potrdite prejemnico šele po dejanskem prevzemu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-bb363fe6627e package=lite -->
### 5.2 Delna dobava

V prejemnico vnesite dejansko prevzete količine, ne količin z naročilnice.

Manjkajoče blago ostane odprto pri dobavitelju oziroma se uredi z naknadnim
dokumentom. Ne ustvarjajte prejemnice za blago, ki ga ni v skladišču.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-e0d78743c8e5 package=lite -->
### 5.3 Napaka pred potrditvijo

1. Popravite vrstico, količino ali ceno v osnutku.
2. Ponovno primerjajte s dokumentom dobavitelja.
3. Preverite, da niste dodali istega artikla dvakrat.
4. Šele nato potrdite.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8e7b17ce2dd0 package=lite -->
### 5.4 Napaka po potrditvi

1. Ne brišite sledi z neformalnim nasprotnim vnosom.
2. Zabeležite številko prejemnice in razliko.
3. Odgovorna oseba naj izvede popravek z dovoljenim dokumentom.
4. Preverite novo stanje in WAC artikla.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7c7dcd849817 package=lite -->
## 6. Uvoz prejemnice in OCR

OCR iz dokumenta predlaga podatke; ni potrditev pravilnosti.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-221f8888f075 package=lite -->
### 6.1 Postopek OCR

1. Naložite čitljiv izvirnik dokumenta.
2. Izberite uvoz prejemnice.
3. Počakajte na obdelavo OCR.
4. Preverite dobavitelja, številko, datum in valuto.
5. Preverite vsako vrstico: artikel, količino, enoto, ceno in DDV.
6. Uparite neprepoznane vrstice z obstoječim artiklom ali jih uredite po postopku.
7. Preverite skupni znesek z izvirnikom.
8. Potrdite šele po ročnem pregledu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-86a546e1bdf8 package=lite -->
### 6.2 Podvojeni dokument

Sistem lahko opozori, da je dokument že uvožen.

1. Ustavite potrditev.
2. Poiščite obstoječo prejemnico po dobavitelju, številki in datumu.
3. Primerjajte znesek in vrstice.
4. Če gre za isti dokument, ne uvažajte ponovno.
5. Če gre res za drugačen dokument z enako številko, dokumentirajte razlog in
   uporabite odobren postopek odgovorne osebe.

Opozorila o duplikatu ne prezrite zaradi podobnega imena datoteke.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5271427d73e5 package=lite -->
### 6.3 Nič vrstic po OCR

Če OCR vrne nič vrstic:

1. Ne potrjujte prazne prejemnice.
2. Preverite, ali je bila naložena prava stran dokumenta.
3. Preverite berljivost, zasuk in popolnost slike.
4. Poskusite z boljšim izvirnikom, kadar je na voljo.
5. Če OCR še vedno ne prepozna vrstic, prejemnico vnesite ročno.
6. Primerjajte ročni vnos z izvirnikom.

Prazna obdelava ni dokaz, da dokument nima postavk.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-81789569be93 package=lite -->
### 6.4 Napačna povezava artikla

1. Ne sprejmite predlaganega artikla samo zaradi podobnega naziva.
2. Preverite šifro, mersko enoto in nabavno ceno.
3. Izberite pravilen obstoječi artikel.
4. Če artikel manjka, ga ustvarite samo s pooblastilom in pravilnimi podatki.
5. Preverite, da se nova vrstica ne podvoji.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-bda27484fcc9 package=extended -->
## 7. Dogodkovni prenosi in vračila

Ta postopek velja samo za začasno enoto, ustvarjeno v modulu **Dogodki**.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-6505359b3219 package=extended -->
### 7.1 Priprava in pošiljanje

1. Odprite dogodek, za katerega pripravljate zalogo.
2. Preverite začasno dogodkovno enoto in izvorno redno enoto.
3. Dodajte dejansko pripravljene artikle in količine.
4. Primerjajte vnos s fizično pošiljko.
5. Potrdite prenos v okviru dogodka.
6. Preverite zapis prenosa v zgodovini dogodka.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9511cb8ef460 package=extended -->
### 7.2 Zaključek in vračilo

1. Po koncu dogodka preverite prodano oziroma porabljeno količino.
2. Preštejte fizični preostanek.
3. Evidentirajte vračilo na izvirnem dogodkovnem prenosu.
4. Potrdite samo količino, ki se je fizično vrnila.
5. Preverite enačbo poslano = porabljeno + preostalo + vrnjeno.
6. Če enačba ne drži, primer ustavite in preglejte zgodovino dogodka.

Dogodkovnega prenosa ne uporabljajte za odpad, redno porabo, prodajo ali
poljuben premik med običajnimi skladišči.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-237e65aeff63 package=lite -->
## 8. Inventura

Inventura primerja knjižno in dejansko stanje.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-12c1e53cb09a package=lite -->
### 8.1 Priprava

1. Določite poslovno enoto in datum popisa. Obrazec POS inventure nima izbire
   skladišča; ločite fizične lokacije na popisnem listu.
2. Določite ekipo popisa in območja.
3. Zabeležite, ali so prodaja in prejmi med štetjem omejeni.
4. Uredite artikle po lokacijah.
5. Pripravite merske enote in pretvorbe.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a748dd64c90a package=lite -->
### 8.2 Štetje in potrditev

1. Odprite novo inventuro v pravi poslovni enoti in preverite datum.
2. Vnesite dejansko preštete količine.
3. Obrazec ob odprtju predizpolni količine s knjižnim stanjem. Vsako vrednost
   zato primerjajte s fizičnim štetjem in jo po potrebi prepišite; predizpolnjena
   številka ni opravljeno štetje.
4. Preglejte odstopanja po količini in vrednosti.
5. Ponovno preštejte pomembna ali nenavadna odstopanja.
6. Dodajte obrazložitev, kadar je zahtevana.
7. Odgovorna oseba naj še enkrat pregleda vse vrstice, nato pritisnite
   **Potrdi inventuro**.
8. Potrditev takoj shrani inventuro in uskladitvene premike; vmesni shranjeni
   osnutek oziroma ločeno stanje »v pregledu« ni na voljo. Preverite stanje na
   karticah artiklov.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a93be55043db package=lite -->
### 8.3 Obnova po napaki

Če opazite napačno mersko enoto ali poslovno enoto pred potrditvijo, inventuro
popravite. Po potrditvi ne začnite nove inventure samo zato, da bi skrili
napako; uporabite sledljiv korekcijski postopek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-inventura-ocr-review-4fc23ad71b80 package=lite -->
### 8.4 Popisni list in OCR inventure

Na zavihku **Zaloge → Inventure** lahko prenesete ločena PDF-popisna lista za
material in drobni inventar. V obrazcu **Nova inventura** lahko naložite
izpolnjen popisni list v obliki PDF, JPG ali PNG (do 20 MB). Datoteka se
uporabi za OCR-predlog; ni samostojna inventura in se inventuri pripne šele ob
potrditvi.

1. Pred nalaganjem izberite pravi obseg: **Material** ali **Drobni inventar**.
   Pri materialu je začetni prikaz **Samo normativni**; izberite **Vsi
   materiali**, če popis vključuje tudi materiale zunaj normativov.
2. Naložite čitljiv, izpolnjen popisni list. OCR lahko prebere datum, natisnjeni
   ID oziroma naziv, enoto, dejansko količino ter pri materialu tudi ročno
   vpisano nabavno ceno.
3. Predlog se vpiše v obrazec, ne potrdi samodejno. Primerjajte vse postavke z
   izvirnikom in dejanskim štetjem. Neujemajoče se ali dvoumne vrstice so
   navedene za ročno preverjanje; neprepoznane številčne vrednosti ostanejo
   prazne.
4. Pri ujemanju preverite tudi mersko enoto. Sistem uparja natisnjeni ID ali
   natančen naziv skupaj z enoto; ne sprejemajte podobnega naziva kot dokaz
   pravilnega artikla.
5. Pri drobnem inventarju preverite količine; cenovni in vrednostni stolpci se
   za ta obseg ne uporabljajo.
6. Pred potrditvijo preverite izbrani datum in opombo. Datum iz OCR je samo
   predlog. Pregledana vsebina ostane v odprtem obrazcu; če obrazec zaprete
   pred potrditvijo, inventura ni shranjena.

Iskanje samo skrije vrstice v prikazu; ne zoži seznama, ki ga obrazec shrani.
Obseg in filter pa določata, katera skupina vrstic je vključena. Shranijo se
izbrane vrstice z vneseno količino, ne pa sam filter ali oznaka obsega. Pri ročnem
vnosu ne pustite predizpolnjene knjižne količine, če je niste dejansko prešteli.

Ko kliknete **Potrdi inventuro**, POS ustvari potrjeno inventuro z inventurnimi
gibi za razlike. Inventura je časovno zabeležena ob koncu izbranega
koledarskega dne po UTC (23.59.59 UTC), ne ob koncu dneva po ljubljanskem
času. V Sloveniji to pomeni 00.59.59 oziroma 01.59.59 naslednjega dne;
pred potrditvijo preverite premike okoli meje dneva in morebitna odstopanja
predajte vodji v uskladitev. To ni osnutek za poznejšo
odobritev: večji popravek pred potrditvijo preverite in odobrite interno.
Po shranitvi se dokument prikaže na seznamu inventur; če je bila priponka
shranjena, jo lahko s seznama prenesete. Sprememba datuma ali postavk oziroma
brisanje potrjene inventure spremeni gibanja zalog, zato tak poseg izvedite
samo po odobritvi in po njem preverite kartico artikla.

**Drobni inventar se vodi samo količinsko:** v inventuri nima nabavne cene in
vrednostnega odstopanja; inventurni premik ne ustvari dodatne GL knjižbe. To ne
nadomesti obravnave dejanskega nakupa: nakup se na prejemnici vnese po
dobaviteljevi ceni in se obravnava kot strošek. Inventura ne sme še enkrat
knjižiti nabavne vrednosti ali ustvariti dodatnega računovodskega stroška.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-fba2cf2aedad package=standard -->
## 9. Pripravljena in sestavljena hrana

Pripravljena hrana nastane iz sestavin po recepturi oziroma normativu.

Sestavljen artikel je prodajni ali proizvodni rezultat več sestavin.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-00b759db02bb package=standard -->
### 9.1 Pred proizvodnjo

1. Preverite, da je receptura aktualna in odobrena.
2. Preverite sestavine, količine in merske enote.
3. Preverite alergene in sledi alergenov.
4. Preverite razpoložljivost sestavin.
5. Določite dejansko proizvedeno količino.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-76ae36a3c3ae package=standard -->
### 9.2 Evidentiranje priprave

1. Odprite **Pripravljena hrana**.
2. Izberite recepturo oziroma sestavljen artikel.
3. Vnesite datum, skladišče in proizvedeno količino.
4. Preverite predlagano porabo sestavin.
5. Prilagodite samo dejanske, dovoljene razlike.
6. Potrdite izdelavo.
7. Preverite zmanjšanje sestavin in povečanje pripravljenega artikla.
8. Preverite vrednotenje proizvedenega artikla.

Ne evidentirajte proizvodnje za jed, ki ni bila narejena. Tudi če je receptura
pravilna, bi tak vnos popačil zalogo in strošek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d153aa3273df package=standard -->
### 9.3 Napaka pri recepturi

1. Ustavite potrditev, če količine ali sestavine niso pravilne.
2. Ne nadomeščajte napačne sestavine z opombo.
3. Popravite normativ po pooblaščenem postopku.
4. Nato ponovno pripravite proizvodni vnos.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-308b5f650d13 package=standard -->
## 10. Odpad in odpadki s krožnikov

Odpad je dejanska izguba zaloge. Razlog mora biti resničen in sledljiv.

Odpadki s krožnikov se evidentirajo ločeno, kadar poslovanje spremlja vračila
hrane po strežbi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-74a10009edec package=standard -->
### 10.1 Evidentiranje odpada

1. Odprite ustrezni obrazec za odpad.
2. Izberite artikel oziroma pripravljeno hrano.
3. Vnesite dejansko količino in mersko enoto.
4. Izberite resničen razlog, na primer kvar, poškodba ali napačna priprava.
5. Vnesite opombo, kadar je potrebna.
6. Potrdite odgovorno evidentiranje.
7. Preverite vpliv na zalogo in vrednost.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f69d4c84ddc4 package=standard -->
### 10.2 Odpad s krožnika

1. Odprite **Odpadki s krožnikov**.
2. Izberite datum, artikel ali obrok po razpoložljivem obrazcu.
3. Vnesite izmerjeno ali dogovorjeno količino.
4. Dodajte razlog oziroma okoliščino, če jo politika zahteva.
5. Shranite zapis.
6. Preglejte trend ob koncu obdobja, ne samo posamezni vnos.

Ne evidentirajte odpada s krožnika kot prodajo, inventurni manjko ali prenos.
Pravilna vrsta dogodka omogoča analizo porabe in zavržkov.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3c09926d0532 package=extended -->
## 11. Dogodki

Dogodki povezujejo prodajo, pripravo in načrtovanje posebne priložnosti.

Primeri so pogostitev, rezervirani dogodek ali vnaprej načrtovan servis.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3f64df19995a package=extended -->
### 11.1 Postopek

1. Odprite **Dogodki**.
2. Vnesite naziv, datum, enoto in odgovorno osebo.
3. Vnesite pričakovano število gostov in posebne zahteve.
4. Povežite ustrezne artikle, meni ali naročila po ponujenih možnostih.
5. Preverite alergene, hode in čas priprave.
6. Potrdite podatke z organizatorjem.
7. Na dan dogodka preverite pripravo, izdajo in dejanske količine.

Dogodek ni nadomestek za račun, prejemnico ali inventuro. Vsak poslovni učinek
ostane evidentiran v svojem ustreznem postopku.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a3cc670ab94e package=lite -->
## 12. Končne kontrole sklopa

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-587816d56fab package=lite -->
## 13. Referenčni potek po zaslonih in dokazilih

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9e825299b417 package=lite -->
### 13.1 Kako brati ta referenčni potek

Ta razdelek je delovni postopek za osebo, ki prejema blago, vodi zalogo in zaključuje dogodek.

Uporabljajte ga skupaj z dejanskim dokumentom dobavitelja.

OCR predlog, samodejno ujemanje in predizpolnjena cena niso dokaz pravilnosti.

Dokaz pravilnosti so fizično prevzeto blago, dokument in preverjene vrstice pred knjiženjem.

Ne potrjujte zato, ker seštevek na zaslonu »izgleda približno prav«.

Vsaka sprememba količine, enote, pakiranja, cene, popusta ali DDV spremeni vrednost zaloge.

Vsaka sprememba artikla spremeni, kateri artikel bo povečal zalogo in katera kartica bo sledljiva.

Za vsak primer spodaj zapišite številko dokumenta, datum in ime osebe, ki je preverila odstopanje.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a8ddd3f788bc package=lite -->
### 13.2 Zaslon Zaloge: zavihki in osnovno branje

Na strani **Zaloge** so ločeni pregledi zaloge, prejemnic, izdajnic, inventur in začetnih zalog.

Pregled zaloge uporabite za preverjanje trenutnega knjižnega stanja, ne kot nadomestilo za fizično štetje.

V vrstici artikla preverite naziv, enoto, količino in vrednost, preden odprete dokument, ki jo je spremenil.

Kartica artikla prikazuje sled gibanj; oznaka **Prejemnica** pomeni povečanje zaloge.

Oznaka **Poraba** pomeni zmanjšanje zaloge zaradi porabe.

Oznaka **Izdajnica** pomeni izhod iz ene enote oziroma skladišča.

Oznaka **Inventura** pomeni uskladitev knjižnega in ugotovljenega stanja.

Če je oznaka gibanja nejasna, dokumenta ne popravljajte na slepo; najprej odprite izvorno listino.

Iskalnik uporabite po nazivu artikla, kadar preverjate, ali je bil isti artikel vnesen pod podobnim imenom.

Ne sklepajte, da sta »Paradižnik« in »Paradižnik kg« enak artikel brez preverjene osnovne enote.

Vrednost kartice je odvisna od nabavne vrednosti, zato prodajna cena ni merilo za kontrolo prejemnice.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-e14a548226f5 package=lite -->
### 13.3 Obrazec ročne prejemnice: glava dokumenta

Novo prejemnico začnite šele, ko imate dobavnico ali račun in poznate dejansko prevzeto količino.

V polju dobavitelja poiščite po dolgem nazivu, kratkem nazivu ali davčni številki.

Izbrani dobavitelj je zaklenjen za neposredno tipkanje; za zamenjavo ga odprite in izberite drugega.

Tipka Escape med odprtim izbirnikom povrne predhodno izbiro in ne zapre obrazca.

Tipka Delete ali Backspace na izbranem dobavitelju odstrani izbiro dobavitelja.

Če iskanje ne vrne zadetka, najprej preverite davčno številko na listini.

Novega dobavitelja ne ustvarite samo zato, ker je OCR napačno prebral eno črko v nazivu.

Datum dokumenta vnesite v obliki **dd.mm.yyyy** (na primer **09.06.2026**).

Pri vnosu samo dneva in meseca sistem dopolni trenutno leto; preverite ga ob prehodu leta.

Številka dokumenta naj se ujema z dobavnico oziroma računom, ne z interno številko naročila.

Dobavnica in račun z isto številko nista nujno isti dokument; preverite vrsto listine in dobavitelja.

Datum prejema uporabite po dejanskem poslovnem dogodku, kadar se razlikuje od datuma izdaje dokumenta.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-02ed5dd9c0e2 package=lite -->
### 13.4 Obrazec ročne prejemnice: stolpci vrstice

Vsaka vrstica ima artikel, količino, ceno na kos oziroma osnovno enoto, enote v paketu, popust in DDV.

Artikel določa kartico zaloge, osnovno enoto in poznejšo porabo v normativih.

Količina pomeni število pakiranj ali vnosnih enot, kadar je uporabljeno polje »Enot v paketu«.

Cena na kos mora biti interpretirana skupaj z enotami v paketu in oznako neto oziroma bruto.

Polje »Enot v paketu« pove, koliko osnovnih enot vsebuje eno prejeto pakiranje.

Popust preverite kot odstotek z dokumenta in ne kot ročno preračunano zmanjšanje količine.

DDV izberite med 22 %, 9,5 %, 5 % ali 0 %, kadar to ustreza dokumentu in artiklu.

DDV 0 % ni splošna rešitev za neznano stopnjo; uporabite ga le, če listina res kaže oprostitev.

Gumb za odstranjevanje vrstice odstrani samo osnutek vrstice pred shranjevanjem; preverite, ali ni šlo za dejansko dobavljeno blago.

Gumb za alergene odpre podatke o alergenih in deklaraciji za konkretno prejemno vrstico.

Oranžen znak pri alergenih pomeni nepreverjen status; ne razlagajte ga kot potrditev odsotnosti alergenov.

Rdeča pika ob znaku pomeni, da so navedeni alergeni ali sledi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-735b2d333b9e package=lite -->
### 13.5 Pakiranja in osnovne enote: obvezna preveritev

Artikel z osnovno enoto **kg** vodite v kilogramih, tudi če dobavitelj zaračuna zaboj.

Artikel z osnovno enoto **l** vodite v litrih, tudi če dobavitelj zaračuna steklenice.

Artikel z osnovno enoto **kom** vodite v kosih, kadar normativ porablja posamezen kos.

Pakiranje 24 steklenic po 0,33 l ni 24 l, temveč 7,92 l.

Če sistemski artikel uporablja litre, v »Enot v paketu« vnesite 7,92 za zaboj 24 × 0,33 l.

Če sistemski artikel uporablja kose, v »Enot v paketu« za zaboj 24 steklenic vnesite 24.

Cena paketa ni cena osnovne enote, če paket vsebuje več kot eno enoto.

Cena osnovne enote pri paketu 24 kosov za 24,00 EUR neto je 1,00 EUR na kos.

Cena osnovne enote pri paketu 6 kg za 30,00 EUR neto je 5,00 EUR na kg.

Ne spreminjajte osnovne enote ob vsakem novem dobavitelju; s tem bi porušili zgodovino artikla.

Če je pakiranje trajno drugačno, preverite artikel in ujemanje dobaviteljeve postavke, ne le trenutne prejemnice.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a35f26417bb1 package=lite -->
### 13.6 Popust, DDV in odvisni stroški

Popust zmanjša nabavno vrednost vrstice pred vrednotenjem zaloge.

Količina se zaradi odstotnega popusta ne spremeni.

Prevoz, zavarovanje in podobne postavke so odvisni oziroma ostali stroški.

Pri vsakem odvisnem strošku vnesite naziv, znesek, DDV stopnjo in obravnavo.

Obravnava **Vrednost zaloge** pomeni, da strošek poveča vrednost zaloge.

Obravnava **Ločen strošek** pomeni, da strošek ni del vrednosti zaloge.

Prevoz ne sme samodejno povečati zaloge, če ga podjetje evidentira kot ločen strošek.

Pri strošku preverite, ali je znesek neto ali bruto, preden določite DDV.

Ne podvajajte popusta: ne znižajte cene ročno in hkrati ne vnesite še odstotka popusta.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5d78800399f1 package=lite -->
### 13.7 WAC: formula in vrstni red kontrole

WAC pomeni tehtano povprečno nabavno ceno zaloge artikla.

Pri običajnem primeru je WAC = (stara količina × stari WAC + nova količina × nova neto cena na osnovno enoto) / (stara količina + nova količina).

Najprej vedno pretvorite paket v osnovno enoto.

Nato preverite, ali je cena neto.

Nato uporabite popust.

Šele nato računajte vrednost novega prejema.

WAC ni povprečje dveh cen brez upoštevanja količin.

WAC ni prodajna cena.

WAC se ne izračuna iz bruto cene, če je zaloga vrednotena neto.

Če je shranjena nabavna cena označena kot bruto, jo sistem za neto primerjavo deli z (1 + DDV/100).

Pri 22 % se bruto 12,20 EUR pretvori v neto 10,00 EUR.

Pri 9,5 % se bruto 10,95 EUR pretvori v neto 10,00 EUR.

Pri 5 % se bruto 10,50 EUR pretvori v neto 10,00 EUR.

Za zaokroževanje ne spreminjajte količine; ločite zaokrožitev prikaza od dejanske enote.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-56176ca4df29 package=lite -->
### 13.8 Delovni list WAC 1: enaki kosi

Začetno stanje je 10 kosov s WAC 2,00 EUR.

Začetna vrednost je 10 × 2,00 = 20,00 EUR.

Prejem je 5 kosov po 3,00 EUR neto.

Vrednost prejema je 5 × 3,00 = 15,00 EUR.

Skupna količina je 15 kosov.

Skupna vrednost je 35,00 EUR.

Novi WAC je 35,00 / 15 = 2,3333 EUR na kos pred prikaznim zaokroževanjem.

Napačen odgovor 2,50 EUR nastane iz navadnega povprečja 2,00 in 3,00.

Ta odgovor je napačen, ker je bilo starih kosov dvakrat več kot novih.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3c7941da7c15 package=lite -->
### 13.9 Delovni list WAC 2: paket s popustom

Na zalogi je 20 kosov s WAC 1,50 EUR.

Začetna vrednost je 30,00 EUR.

Prejet je en paket 12 kosov za 24,00 EUR neto.

Dobavitelj prizna 10 % popust.

Neto vrednost paketa po popustu je 24,00 × 0,90 = 21,60 EUR.

Neto cena enega kosa je 21,60 / 12 = 1,80 EUR.

Nova količina je 32 kosov.

Nova vrednost je 30,00 + 21,60 = 51,60 EUR.

Novi WAC je 51,60 / 32 = 1,6125 EUR.

Vnos 24,00 kot cena na kos bi vrednost zaloge povečal za 288,00 EUR in je očitno napačen.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-ec549f66ea5d package=lite -->
### 13.10 Delovni list WAC 3: kilogrami

Na zalogi je 8 kg moke s WAC 0,90 EUR/kg.

Začetna vrednost je 7,20 EUR.

Prejetih je 6 kg moke po 1,20 EUR/kg neto.

Vrednost prejema je 7,20 EUR.

Skupna količina je 14 kg.

Skupna vrednost je 14,40 EUR.

Novi WAC je 14,40 / 14 = 1,028571 EUR/kg.

Če dobavitelj zaračuna 6-kg vrečo za 7,20 EUR, cena na kg ostane 1,20 EUR/kg.

Če bi vnesli 7,20 kot ceno na kg, bi šest kilogramov ovrednotili na 43,20 EUR.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-26cac7f63682 package=lite -->
### 13.11 Delovni list WAC 4: bruto dokument

Na zalogi je 10 l olja s WAC 4,00 EUR/l neto.

Prejete so 4 l po 6,10 EUR bruto na liter pri 22 % DDV.

Neto cena novega litra je 6,10 / 1,22 = 5,00 EUR.

Začetna vrednost je 40,00 EUR.

Vrednost prejema je 4 × 5,00 = 20,00 EUR.

Skupna vrednost je 60,00 EUR.

Skupna količina je 14 l.

Novi WAC je 60,00 / 14 = 4,285714 EUR/l.

Uporaba bruto 6,10 kot neto cene bi neupravičeno vključila DDV v vrednost zaloge.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1f0c40d26221 package=lite -->
### 13.12 Delovni list WAC 5: ničelno začetno stanje

Začetna količina artikla je 0.

Začetne vrednosti zato ni mogoče deliti z obstoječo količino.

Prejetih je 18 kosov po 2,40 EUR neto.

Nova vrednost je 43,20 EUR.

Novi WAC je 43,20 / 18 = 2,40 EUR.

Pri ničelni začetni količini WAC prevzame dejansko neto ceno novega prejema.

Če je količina nič, vendar kartica kaže vrednost, napake ne popravljajte z novo prejemnico.

Najprej preverite zgodovino inventure, prejemnic in porab.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-fd0d40222859 package=lite -->
### 13.13 Delovni list WAC 6: odvisni strošek zaloge

Na zalogi je 50 kosov s WAC 1,00 EUR.

Prejetih je 50 kosov po 1,20 EUR neto.

Vrednost blaga prejema je 60,00 EUR.

Prevoz 10,00 EUR je označen kot **Vrednost zaloge**.

Vrednost novega prejema za ta delovni list je 70,00 EUR.

Skupna vrednost je 50,00 + 70,00 = 120,00 EUR.

Skupna količina je 100 kosov.

Novi WAC je 1,20 EUR na kos.

Če je isti prevoz označen kot **Ločen strošek**, novi WAC znaša 110,00 / 100 = 1,10 EUR.

Odločitev o obravnavi prevoza zato dokumentirajte ob prejemu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c4bc79003039 package=lite -->
### 13.14 Ročni prevzem: primer 1, pijača v zabojih

Dobavnica navaja 3 zaboje po 24 steklenic.

Artikel v sistemu je »Mineralna voda 0,5 l« v enoti kom.

Fizično preštejte tri zaprte zaboje.

V količino vnesite 3, kadar količina pomeni število paketov.

V enote v paketu vnesite 24.

Vnesite neto ceno zaboja oziroma ustrezno ceno, ki jo zahteva obrazec, po preverjeni interpretaciji.

Preverite, da končni prejem poveča zalogo za 72 kosov in ne za 3 kose.

Če je eden zaboj odprt s 23 steklenicami, ne potrjujte 3 × 24 brez zapisa odstopanja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-20feb9be9e20 package=lite -->
### 13.15 Ročni prevzem: primer 2, sir v kilogramih

Dobavitelj dobavi dve hlebci s tehtano maso 2,35 kg in 2,48 kg.

Artikel je v enoti kg.

Skupna dejanska količina je 4,83 kg.

Cena na kg se prepiše iz dokumenta.

Ne vnašajte količine 2 z enotami v paketu 2,415, če dokument in postopek zahtevata neposredno maso.

Natančnost mase ohranite do mere, ki jo dovoljuje dokument in artikel.

Če dobavnica navaja 4,90 kg, tehtanje pa 4,83 kg, ustavite prevzem in uskladite razliko z dobaviteljem.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-48d2f657eb2a package=lite -->
### 13.16 Ročni prevzem: primer 3, delna dobava

Naročilo je vsebovalo 10 kg mesa, dobavitelj pa pripelje 8 kg.

Prejemnica predstavlja dejanski prevzem, zato vnesite 8 kg.

Ne vnašajte naročenih 10 kg z upanjem, da bosta manjkajoča 2 kg prišla pozneje.

Manjkajočo količino zapišite na listino oziroma reklamaciji po internem postopku.

Kasnejša dobava 2 kg dobi svojo sledljivo prejemnico oziroma ustrezen dokument.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-23a792ee9add package=lite -->
### 13.17 Ročni prevzem: primer 4, brezplačni dodatek

Dobavitelj pošlje 10 kosov, na računu pa zaračuna 9 kosov.

Fizična količina je 10 kosov.

Vrednost je vrednost, ki jo dejansko nosi dokument.

Ne povečujte količine na devet samo zato, da bi cena na kos ostala enaka.

Pred vnosom razjasnite, ali je deseti kos rabat v blagu, promocijski dodatek ali napaka dokumenta.

Razlaga mora biti sledljiva v opombi oziroma dokazilu dobavitelja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2f4023f24cb6 package=lite -->
### 13.18 Ročni prevzem: primer 5, vračilo dobavitelju

Po potrditvi ugotovite, da so trije kosi poškodovani in jih vrnete.

Ne brišite potrjene prejemnice, ker bi izgubili sled izvirnega prevzema.

Dokumentirajte vračilo z ustreznim negativnim oziroma izhodnim postopkom, ki ga uporablja podjetje.

Povežite dokazilo o vračilu z izvirnim dokumentom.

Preverite kartico artikla pred in po vračilu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1aa489d2fbb9 package=lite -->
### 13.19 OCR: izbira načina zajema

Dialog **Uvozi dobavnico** ima načine Datoteka, Kamera in Skeniraj.

Datoteka podpira CSV, XLSX, XML oziroma e-SLOG in PDF.

Kamera pošlje fotografijo v OCR.

Skeniraj uporablja lokalni Windows HP scanner bridge, kadar je dosegljiv.

Pri nedosegljivem bridgeu ne predpostavljajte, da je dokument poslan; preverite prikaz napake.

Skeniranje uporablja 300 DPI, sivinski zajem in PNG, kadar je sproženo prek bridgea.

Fotografija se za obdelavo zmanjša največ na 1600 × 2000 slikovnih pik.

Zmanjšana slika ni razlog, da preskočite ročni pregled številk.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-781f0184525e package=lite -->
### 13.20 OCR: fotografija, ki jo je mogoče preveriti

Dokument položite ravno in zajemite vse štiri robove.

Ne prekrivajte številke dokumenta, datuma ali skupnega zneska s prstom.

Preprečite bleščanje nad stolpcem količine in cene.

Pri večstranski dobavnici zajemite vse strani po postopku, ki ga podpira dokumentni tok.

Fotografija z odrezanim desnim stolpcem ni primerna za samodejno potrditev DDV ali zneska.

Ne uporabljajte slike zaslona s stisnjenim besedilom, če imate izvirni PDF.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0b4dd8b643e2 package=lite -->
### 13.21 OCR: datoteka in profil uvoza

Za CSV ali XLSX najprej izberite dobavitelja.

Izbira dobavitelja je potrebna, ker je uvozni profil vezan na dobavitelja.

Če profil za izbrani format ne obstaja, sistem jasno usmeri v Nastavitve → Uvozni profili.

Ne preimenujte datoteke v drugo končnico, da bi obšli manjkajoči profil.

PDF, XML in e-SLOG se pošljejo neposredno brez predizbire dobavitelja v tem koraku.

Datoteko hranite kot dokazilo po pravilih podjetja, tudi če je uvoz uspel.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-efa34732eca9 package=lite -->
### 13.22 OCR: pregled rezultata pred povezovanjem

Po uspešnem zajemu sistem ustvari osnutek prejemnice, ne dokončne knjižbe.

Samodejno prepoznane postavke so preštete v sporočilu o uspehu.

Nepovezane postavke odprejo zaslon za povezovanje.

Na zaslonu preverite dobavitelja, številko dokumenta, datum in oznako, ali so cene bruto.

Oznaka bruto zahteva poseben pregled cen, preden ocenjujete WAC.

Če ni nepovezanih postavk, uvoz vseeno preide v predogled knjiženja.

Samodejna prepoznava ne pomeni, da so pakiranje, popust in DDV brez napake.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5cdfc8b96be5 package=lite -->
### 13.23 OCR: ujemanje dobavitelja

Kadar OCR ne najde dobavitelja, se odpre iskanje v šifrantu partnerjev.

Iskanje po obstoječih partnerjih začne vračati zadetke pri vsaj dveh znakih.

Preverite dolgi naziv, kratki naziv in davčno številko.

Izbira partnerja nadaljuje uvoz osnutka z izbranim dobaviteljem.

Novega dobavitelja ustvarite samo po pregledu OCR podatkov.

Obvezno polje pri dodajanju novega partnerja je dolgi naziv.

Pri vnosu partnerja so na voljo kratki naziv, naslov, poštna številka, kraj, država in koda države.

Na voljo so tudi zavezanec za DDV, davčna številka, ID za DDV, matična številka, TRR, e-pošta in telefon.

TRR dodajte le, kadar ima veljaven IBAN; prazen TRR se ne shrani.

Če davčna številka po normalizaciji že obstaja, sistem izbere obstoječega partnerja namesto ustvarjanja dvojnika.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b40a1d953413 package=lite -->
### 13.24 OCR: obogatitev novega dobavitelja

Pri razpoložljivi davčni številki se podatki najprej iščejo po davčni številki.

Če davčne ni, se lahko išče po nazivu z najmanj tremi znaki.

Če iskanje po nazivu vrne več zadetkov, izberite pravnega subjekta po nazivu, davčni številki in kraju.

Če samodejni priklic ne uspe, obrazec vsebuje surove OCR podatke za ročno dopolnitev.

OCR davčna številka je predlog in jo primerjajte z listino.

Ne shranjujte napačnega partnerja samo zato, da bi dokončali uvoz.

Napačen partner oteži iskanje prejemnic in prihodnje samodejno ujemanje.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-691a7f0c7262 package=lite -->
### 13.25 OCR: ujemanje artikla

Za vsak neujeti nabavni naziv najprej iščite po imenu za nabavo oziroma imenu artikla.

Seznam kandidatov je omejen na prvih 25 zadetkov, zato uporabite dovolj značilen del naziva.

Izberite artikel šele po primerjavi osnovne enote na artiklu in enote na dokumentu.

Vnesite oziroma potrdite enote v paketu za dobaviteljevo postavko.

Možnost zapomnitve ujemanja uporabite le, če je naziv, embalaža in enota pri dobavitelju stabilna.

Ne zapomnite povezave »Voda 0,5« z artiklom 1,5 l samo zato, ker sta oba voda.

Če primernega artikla ni, odprite ustvarjanje novega artikla.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-afe1258ac760 package=lite -->
### 13.26 OCR: nov artikel iz neujemane postavke

Pri novem artiklu vnesite naziv in ime za nabavo.

Ime za nabavo naj bo dovolj podobno dobaviteljevemu nazivu, da ga bo mogoče pozneje najti.

Novi artikel je nabavni artikel.

Če bo tudi prodajni, izberite tip NABAVNO_PRODAJNI in dopolnite prodajne podatke.

Osnovna enota se prenese v artikel in jo preverite pred shranjevanjem.

Za prodajni artikel se določi ustrezna DDV stopnja, cena, kategorija in aktivnost.

Normativne vrstice so veljavne le za pozitivno količino in veljaven vhodni artikel.

Po ustvarjanju se novi artikel samodejno poveže s trenutno uvozno vrstico.

Pakiranje se pri tem vzame iz novega artikla, če je vneseno, sicer iz OCR vrstice.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-de3c22e3271d package=lite -->
### 13.27 OCR: duplikat dokumenta

Status 409 pomeni, da je sistem zaznal že uvoženo dobavnico oziroma sliko.

Če sistem pokaže ID obstoječe prejemnice, odprite ta dokument in ga primerjajte z listino.

Ne nalagajte iste slike ponovno pod drugim imenom.

Ne ustvarite ročne prejemnice za isti dokument, dokler ne preverite zaznanega dvojnika.

Če sta dokumenta res ločena, zapišite razlikovalni podatek in zahtevajte razjasnitev po odgovornem postopku.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d748cf2594a6 package=lite -->
### 13.28 OCR: ničelne in preskočene vrstice

Vrstica s količino nič ne poveča fizične zaloge.

Pred potrditvijo ugotovite, ali je ničelna vrstica samo informativna, rabat ali OCR napaka.

Ne povezujte ničelne vrstice z rednim artiklom samo zato, da seznam nepovezanih vrstic izgine.

Če OCR preskoči vrstico, jo poiščite na izvirniku in ugotovite razlog.

Vrstica brez cene zahteva preveritev dokumenta; cena 0 ni privzeta rešitev.

Vrstica brez količine zahteva preveritev enote, pakiranja ali zajema.

Če ostane le nič vrstic, ne zaključujte procesa kot uspešnega prevzema.

Zabeležite, da zaloga ni bila povečana, in opravite ročni prevzem, če je blago dejansko prispelo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-12fae5809f6b package=lite -->
### 13.29 OCR: primer 6, popolnoma samodejni uvoz

PDF vsebuje dobavitelja, številko dokumenta, datum in tri znane artikle.

Naložite PDF v načinu Datoteka.

Sistem ustvari osnutek in poroča, da so tri postavke samodejno prepoznane.

Odprite predogled knjiženja.

Primerjajte tri količine, pakiranja, neto oziroma bruto cene in DDV z PDF.

Potrdite knjiženje šele po tej primerjavi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8bedf4acd6ac package=lite -->
### 13.30 OCR: primer 7, neznan dobavitelj

Fotografija dobro prebere naziv, vendar partner ni v šifrantu.

V iskalnik vpišite vsaj dva znaka in preverite obstoječe zadetke.

Če ga ni, odprite dodajanje iz OCR podatkov.

Primerjajte predlagano davčno številko z glavo dobavnice.

Dodajte partnerja in nadaljujte uvoz.

Pred knjiženjem ponovno preverite, da se prejemnica nanaša na novoustanovljenega partnerja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-44f2b9e986ce package=lite -->
### 13.31 OCR: primer 8, dva podobna artikla

OCR prebere »Coca-Cola 0,5«.

V šifrantu sta »Coca-Cola 0,5 l PET« in »Coca-Cola Zero 0,5 l PET«.

Ne izberite prvega kandidata po imenu.

Preverite oznako na dokumentu in fizični embalaži.

Uparite pravi okus.

Pakiranje potrdite ločeno, saj pravilno ime še ne zagotavlja pravilne količine.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3c3b69d60d70 package=lite -->
### 13.32 OCR: primer 9, branje decimalke

Dokument navaja 1,25 kg, OCR pa prebere 125 kg.

Primerjajte količino s fizično maso in z vrednostjo vrstice.

125 kg po isti ceni bi navadno povzročilo nesorazmerno visok znesek.

Popravite količino v osnutku po izvirniku.

Ne popravljajte cene navzdol, da bi prikrili napačno količino.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9f3d1b3a608a package=lite -->
### 13.33 OCR: primer 10, račun z bruto cenami

OCR označi, da so cene bruto.

Dobavitelj navaja 12,20 EUR z 22 % DDV.

Za WAC preverite neto ekvivalent 10,00 EUR.

Ne primerjajte 12,20 z obstoječim neto WAC 10,00 kot da bi šlo za podražitev.

Znesek DDV ostane davčna informacija, ne nabavna vrednost zaloge.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f9988237e62e package=lite -->
### 13.34 Inventura: namen in priprava

Inventura primerja dejansko najdeno stanje s knjižnim stanjem.

Ne začnite štetja, če med štetjem ne morete nadzorovati prodaje, prevzemov in prenosov.

Določite trenutek preseka in ga zapišite.

Ločite artikle po skladišču oziroma poslovni enoti.

Odprta pakiranja štejte v osnovni enoti.

Tehtane artikle tehtajte, ne ocenjujte jih po občutku.

Poškodovano blago ločite od prodajnega blaga in ga ne prikrivajte v običajni količini.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d8df85b91265 package=lite -->
### 13.35 Inventura: polja in odločitev

V vrstici inventure izberite artikel.

Polje »Število najdeno« pomeni fizično ugotovljeno količino.

Polje cena na kos oziroma enoto mora ustrezati vrednotenju popisa, kadar ga obrazec zahteva.

Knjižno stanje je podlaga za razliko, ne navodilo, koliko morate napisati.

Če najdete manj, ne prilagodite fizičnega števila knjižnemu samo zato, da bo razlika nič.

Če najdete več, preverite neknjižen prevzem, prenos ali napačno enoto pred potrditvijo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-6ded41e9c96f package=lite -->
### 13.36 Inventura: primer 11, manjko zaradi neknjižene porabe

Knjižno stanje moke je 20 kg.

Fizično stanje je 16 kg.

Razlika je −4 kg.

Pred potrditvijo preverite prodajo, normative, pripravo, izdajnico in morebitne odprte prejemnice.

Če je bilo 4 kg pravilno porabljenih za pripravo, ne označite avtomatično kraje ali odpada.

Ko je razlog potrjen, izvedite inventurno uskladitev skladno z odgovornostmi.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b94a0686b8e7 package=lite -->
### 13.37 Inventura: primer 12, presežek zaradi pakiranja

Knjižno stanje je 24 kosov, fizično pa preštejete en zaboj 24 in šest posameznih kosov.

Dejansko stanje je 30 kosov.

Razlika je +6 kosov.

Preverite, ali je bil prejem šestih kosov vnesen kot 0,25 zaboja ali je ostal neknjižen.

Ne vnašajte 1,25 zaboja, če sistemski artikel uporablja kose.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8240f1188bed package=lite -->
### 13.38 Inventura: popravek po napaki

Po potrjeni inventuri ne spreminjajte zgodovine s ponovnim vnosom istega števila brez razloga.

Najprej določite, ali je bila napačna fizična številka, enota, cena ali izbor artikla.

Dokumentirajte razlog in povezavo z izvirno inventuro.

Preverite novo gibanje na kartici artikla.

Če napaka vpliva na več artiklov, pripravite seznam pred izvedbo korekcij.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-67b4737f26dd package=lite -->
### 13.39 Negativna zaloga: raziskava, ne hitra rešitev

Negativna zaloga pomeni, da je evidenca izdala oziroma porabila več, kot je imela na voljo.

Ne odpravljajte negativnega stanja z izmišljeno prejemnico.

Preverite datum in količino začetne zaloge.

Preverite ali je prejemnica ostala osnutek oziroma ni bila knjižena.

Preverite pakiranje uvozne vrstice.

Preverite izdajnico ter morebitni dogodkovni prenos in vračilo.

Preverite normativ artikla in prodajo, ki sta lahko porabila napačno enoto.

Ko najdete vzrok, popravite izvorni poslovni dogodek po dovoljenem postopku.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-97a304a21584 package=lite -->
### 13.40 Začetne zaloge: primer 13

Ob začetku uporabe sistema je v skladišču 48 pločevink.

Artikel je v enoti kom.

V začetno zalogo vnesite količino 48.

Cena na kos je dokumentirana začetna nabavna cena, ne trenutna prodajna cena.

Če začetno stanje prihaja iz popisa, hranite popisni list kot dokazilo.

Po vnosu preverite kartico artikla in skupno količino.

Ne vnesite začetne zaloge še enkrat, če prejemnica istega blaga že obstaja.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-36d1a6290c49 package=lite -->
### 13.41 Izdajnica: izhod brez ciljnega prevzema

Izdajnica evidentira izhod zaloge iz izbrane enote. Ne ustvarja prejemnega
dokumenta v drugi enoti in je zato ne predstavljajte kot splošen prenos med
skladišči.

Pred potrditvijo preverite enoto izdaje, artikel, dejansko količino in poslovni
razlog. Pri odprti embalaži uporabite osnovno mersko enoto, ne zaokroženega
števila paketov.

Če mora blago na začasno dogodkovno enoto, uporabite prenos znotraj modula
**Dogodki**, ne običajne izdajnice.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0097fcb7dc2b package=extended -->
### 13.42 Dogodkovni prenos: primer 14, terenski bar

Začasna dogodkovna enota potrebuje 18 steklenic iz matične enote.

Artikel uporablja enoto kom.

Prenos pripravite v odprtem dogodku in vnesite 18 kosov.

Pred potrditvijo primerjajte količino z dejansko pripravljeno pošiljko.

V zgodovini istega dogodka preverite izhodni dokument in stanje začasne enote.

Ne vnašajte 0,75 zaboja, kadar se zaloga vodi v kosih.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-4e1e47516142 package=extended -->
### 13.43 Dogodkovni prenos: primer 15, odprt sod

V glavni enoti je 12 l odprte pijače.

Za dogodek prenesete 3,5 l.

Artikel je v litrih.

Vnesite 3,5 l.

Ne pretvarjajte 3,5 l v »en del soda«, ker takšna enota ni sledljiva normativom.

Po dogodku preostanek izmerite v litrih za povratni prenos.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-44bfd10ff3e4 package=extended -->
### 13.44 Dogodkovni prenos: primer 16, prenos ni manjko

Ob popisu matična enota ne najde 10 kosov, ker so na začasni enoti aktivnega
dogodka.

Če zgodovina dogodka kaže izhodni prenos, je fizična razlika po lokaciji
pojasnjena.

Ne knjižite inventurnega manjka v matični enoti in hkrati ne prezrite aktivnega
dogodkovnega prenosa.

Najprej preverite zgodovino dogodka in začasno enoto.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-a31c4d3ab94d package=extended -->
### 13.45 Dogodki: statusi

Dogodek ima status Načrtovan, Aktiven, Zaključen ali Preklican.

Načrtovan dogodek je primeren za pripravo pred začetkom.

Aktiven dogodek predstavlja trenutno izvedbo.

Zaključen dogodek omogoča postopek vračila preostale zaloge.

Preklican dogodek ni razlog za brisanje sledljivih dokumentov, ki so že nastali.

Aktivnega ali zaključenega dogodka ni mogoče preprosto izbrisati; najprej ga prekličite, kadar je to poslovno pravilno.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-6da1d1cf232f package=extended -->
### 13.46 Dogodki: polja obrazca

Naziv dogodka je obvezen in naj omogoča enolično prepoznavo.

Vrste so Veselica oziroma prireditev, Poroka, Catering, Drugo slavje in Drug dogodek.

Začetek in konec sta obvezna lokalna datum in čas.

Lokacija je obvezna.

Naročnik in kontakt sta neobvezna, vendar koristna za uskladitev cateringa.

Status določa življenjsko fazo dogodka.

Opombe uporabite za operativne okoliščine, ne za prikrivanje količinskih razlik.

Povezane poslovne enote določite s potrditvenimi polji.

Začasna enota je v seznamu posebej označena.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-278a07adefb5 package=extended -->
### 13.47 Dogodki: priprava začasne enote

Gumb **Pripravi enoto** je na voljo za dogodek, ki ni zaključen ali preklican.

Najprej izberite začasno enoto.

Nato označite artikle, ki bodo na voljo na dogodku.

Za vsak izbrani artikel vnesite količino med 0 in razpoložljivo zalogo.

Pri količini preverite prikaz »na zalogi« ob artiklu.

Izberete lahko osebje z začasnim dostopom.

Klik **Prikaži predogled prenosa** ne izvede še končnega prenosa.

Predogled pokaže kategorije, artikle, normative, skupine modifikatorjev, modifikatorje in osebje.

Predogled pokaže skupno začetno količino in vrednost zaloge.

Opozorila v predogledu rešite pred potrditvijo priprave.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0bb9a4dbfc5f package=extended -->
### 13.48 Dogodki: ponovni klik in idempotentnost

Če je enota za dogodek že pripravljena, ponovni klik ne sme podvojiti cenika, osebja ali zaloge.

Sporočilo »Enota je že pripravljena« pomeni, da sistem uporablja obstoječo pripravo.

To ne pomeni, da je količina na dogodku samodejno usklajena s fizičnim stanjem.

Za dodatno zalogo izvedite sledljiv postopek prenosa, ne ponavljajte priprave v upanju na dodaten prenos.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0550ae32bb91 package=extended -->
### 13.49 Dogodki: zgodovina prenosov

Gumb **Prenosi** odpre zgodovino za izbrani dogodek.

Vsak dokument ima smer Izhodni ali Povratni.

Dokument ima status Zaključen, Osnutek ali Preklican.

Prikazana sta izvorna in ciljna enota.

Prikazani so čas nastanka in oseba, ki je dokument ustvarila.

V vrstici so artikel, količina, cena na enoto in vrednost.

Pri izhodnem dokumentu so dodatno prikazani porabljeno, preostalo in vrnjeno.

V oklepaju ob vrnjenem je lahko načrtovana količina osnutka.

Skupaj dokumenta prikazuje skupno količino in skupno vrednost.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b29b37a4cd11 package=extended -->
### 13.50 Dogodki: primer 17, predogled pred veselico

Dogodek je Načrtovan in ima povezano začasno enoto.

Izberete 100 kosov pijače in 20 kg hrane.

Predogled opozori, da je za en artikel na voljo le 80 kosov.

Ne potrdite priprave z željo, da bo sistem dovolil minus.

Spremenite količino na največ razpoložljivo ali uredite dokazljiv dodatni prevzem.

Šele predogled brez nerešenega opozorila je podlaga za potrditev.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-febacbe5d715 package=extended -->
### 13.51 Dogodki: primer 18, uskladitev po cateringu

Na dogodek je bilo prenesenih 40 steklenic.

Zgodovina kaže 28 porabljenih in 12 preostalih.

Fizično preštejete 10 neodprtih steklenic in 2 odprti, vendar še uporabni enoti.

Če artikel uporablja kose, je preostanek 12 kosov.

Pripravite povratni prenos za 12 kosov po pravilnem postopku.

Ne označite dveh odprtih kosov kot odpad samo zaradi odprte embalaže.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0e459e028fe6 package=extended -->
### 13.52 Dogodki: primer 19, zaključen dogodek

Dogodek dobi status Zaključen.

Odprite **Vrni zalogo**.

Sistem prikaže sledljive osnutke povratnih prenosov.

Za osnutek izberite **Potrdi vračilo**.

Po potrditvi preverite, da dokument kaže status zaključen.

Preverite matično enoto in kartico artikla.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-619a6520d11c package=standard -->
### 13.53 Pripravljena hrana: namen dnevne evidence

Zaslon **Pripravljena hrana** vodi dnevno evidenco artiklov z operativnim načinom Pripravljena hrana.

Ni namenjen ročnemu popravljanju običajne surovinske zaloge.

Dnevno evidenco odprete za posamezen datum.

Seznam datumov loči dneve, kjer so vse vrstice zaključene, od odprtih dni.

Leto lahko spremenite za pregled zgodovine.

Če ni takih artiklov, zaslon izrecno pokaže, da ni artiklov z nastavljenim operativnim načinom.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b24134e24b75 package=standard -->
### 13.54 Pripravljena hrana: stolpci

Stolpec Artikel pokaže naziv pripravljenega artikla.

Odtajano je količina, vzeta iz zamrznjene zaloge za uporabo.

Pripravljeno je novo pripravljena količina.

Korekcija je lahko pozitivna ali negativna in usklajuje računalniško stanje z dejansko količino v posodi.

Skupaj je seštevek odtajanega, pripravljenega in korekcije.

Prodano je prodana količina za datum.

Zamrznjeno je količina ob koncu dneva, vrnjena v zamrznjeno stanje.

Kalo je izračunana razlika po zaključku.

Stanje je Odprto, Samo ogled ali Zaključeno.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-755585813f87 package=standard -->
### 13.55 Pripravljena hrana: upravljalni gumbi

Pri odprti vrstici uporabite +10, −10, +1 in −1 ob vsakem količinskem polju.

Odtajano, pripravljeno in zamrznjeno ne dovolijo zmanjšanja pod nič prek gumbov.

Korekcija dovoljuje tudi negativno vrednost.

Gumb **Shrani vse** shrani odprte evidence za izbrani dan.

Gumb **Zaključi vse** odpre potrditveni pregled kala.

Zaključka ne morete sprožiti, kadar je izračunano kalo pri kateri odprti vrstici negativno.

Zaključena vrstica je nepovratna in se prikazuje samo za ogled.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-aeaa1bc096f9 package=standard -->
### 13.56 Pripravljena hrana: formula kala

Skupaj = odtajano + pripravljeno + korekcija.

Kalo = skupaj − prodano − zamrznjeno.

Formula ne uporablja začetne zaloge neposredno v stolpcu skupaj.

Negativno kalo pomeni, da ste navedli več prodanega in zamrznjenega, kot je bilo razpoložljivo po vnosih.

Negativnega kala ne rešujte s prisilnim zaključkom; gumb je zato onemogočen.

Preverite prodano, zamrznjeno, odtajano, pripravljeno in korekcijo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7c6b8e604fdb package=standard -->
### 13.57 Pripravljena hrana: primer 20, dnevna juha

Odtajano je 0 porcij.

Pripravljeno je 40 porcij.

Korekcija je 0.

Prodano je 31 porcij.

Zamrznjeno je 4 porcije.

Kalo je 40 − 31 − 4 = 5 porcij.

Pred zaključkom preverite, ali pet porcij pomeni dejansko kalo in ne pozabljeno prodajo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1e5e9e78b3b9 package=standard -->
### 13.58 Pripravljena hrana: primer 21, odtajanje in zamrzovanje

Odtajate 12 porcij že pripravljene hrane.

Sveže pripravite 8 porcij.

Korekcija je −1 porcija, ker je posoda dejansko manjša od računalniškega stanja.

Skupaj je 12 + 8 − 1 = 19 porcij.

Prodano je 14 porcij.

Ob koncu zamrznete 3 porcije.

Kalo je 19 − 14 − 3 = 2 porciji.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b067708af42a package=standard -->
### 13.59 Pripravljena hrana: primer 22, negativno kalo

Pripravljeno je 10 porcij.

Prodano je 9 porcij.

Zamrznjeno je 3 porcije.

Kalo bi bilo 10 − 9 − 3 = −2 porciji.

To je nemogoče brez dodatnega vira količine.

Preverite, ali ste izpustili odtajanje 2 porcij ali napačno vnesli zamrznjeno količino.

Dokler ni formula nenegativna, ne zaključujte evidence.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c01cfb60b849 package=standard -->
### 13.60 Pripravljena hrana: sestavljeni izdelki

Sestavljeni kulinarični izdelek ima normativ iz drugih kulinaričnih artiklov.

Normativ določa vhodni artikel in pozitivno količino.

Prodaja sestavljenega izdelka vpliva na porabo vhodnih artiklov po recepturi.

Pred prodajo preverite, da normativ uporablja pravi artikel in pravo osnovno enoto.

Receptura 0,2 kg mesa ni enaka recepturi 0,2 kosa mesa.

Če sestavljeni izdelek uporablja pripravljeno hrano, ločite njegovo prodajo od dnevnega kala pripravljene hrane.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-61c3f59f8614 package=standard -->
### 13.61 Pripravljena hrana: primer 23, napačna receptura

Normativ sendviča vsebuje 1 kg sira namesto 0,1 kg.

Ena prodaja bi povzročila desetkratno porabo.

Ne popravljajte posledice z umetno prejemnico sira.

Ustavite uporabo napačne recepture.

Popravite normativ po pooblaščenem postopku.

Preverite obdobje, v katerem je bila receptura uporabljena, in dokumentirajte potrebne uskladitve.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d747c16ae377 package=standard -->
### 13.62 Odpad pripravljene hrane in odpad s krožnikov nista isto

Kalo pripravljene hrane nastane iz dnevne formule pripravljene, odtajane, korekcije, prodanega in zamrznjenega.

Odpad s krožnikov je ločena interna evidenca biološko razgradljivih kuhinjskih odpadkov.

Odpad s krožnikov ne vpliva na zalogo.

Odpad s krožnikov ne vpliva na prodajo.

Odpad s krožnikov ne vpliva na normative.

Odpad s krožnikov ne vpliva na pripravljeno hrano ali njeno kalo.

Odpad s krožnikov ne vpliva na računovodstvo v tem modulu.

Ne vnašajte ostankov gostov v kalo pripravljene hrane samo zato, da bi dosegli večjo številko odpada.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-34d2cacb3123 package=standard -->
### 13.63 Odpad s krožnikov: glava zaslona

Zaslon prikazuje podjetje, aktivno poslovno enoto in kodo 20 01 08.

Obdobje določite z datumom od in datumom do.

Datum od mora biti pred datumom do ali enak.

Pri neveljavnem obdobju se podatki ne nalagajo kot veljaven pregled.

Gumb **Izvoz (CSV)** izvozi podatke iz izbranega obdobja.

CSV poimenujte oziroma shranite tako, da je povezava z obdobjem jasna.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-ba70f90b638e package=standard -->
### 13.64 Odpad s krožnikov: tri kartice povzetka

Kartica »Nastalo v izbranem obdobju« pokaže vsoto dnevnih vnosov v kg.

Kartica »Oddano in popravki« pokaže neto oddano količino v kg.

Kartica »Razlika v izbranem obdobju« pokaže razliko med nastalim in oddanim.

Razlika ni samodejno napaka; lahko predstavlja količino, ki še ni bila oddana.

Negativno razliko raziskujte, saj lahko pomeni napačno oddajo ali popravek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-b4e1b25bfcbf package=standard -->
### 13.65 Odpad s krožnikov: dnevni vnos

Zavihek **Dnevni vnosi odpadkov** vsebuje obrazec Nov dnevni vnos.

Datum vnosa je obvezen.

Količina se vodi v kilogramih.

Količina mora biti večja od 0.

Opomba je neobvezna.

Vnos podpira gumbe −1, −0,1, +0,1 in +1 kg.

Ročni decimalni vnos se prikaže v kilogramih.

Gumb **Shrani dnevni vnos** po uspehu počisti količino in opombo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f3c74010edd9 package=standard -->
### 13.66 Odpad s krožnikov: tabela dnevnih vnosov

Tabela prikazuje Datum, Količino v kg, Opombo in osebo, ki je vnos ustvarila.

Če opombe ni, tabela pokaže pomišljaj.

Če v obdobju ni vnosov, zaslon to izrecno pove.

Vnesel je sledljiv podatek; ne uporabljajte ga za ugibanje, temveč za razjasnitev z osebo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1c761bdec4f8 package=standard -->
### 13.67 Odpad s krožnikov: oddaja prevzemniku

Zavihek **Oddaja prevzemnikom** vsebuje obrazec Evidentiraj oddajo.

Datum oddaje je obvezen.

Količina oddaje mora biti večja od 0.

Naziv prevzemnika je obvezen.

Številka evidenčnega lista je neobvezna.

Opomba je neobvezna.

Tip zapisa pri novi oddaji je Oddaja.

Gumb **Zabeleži oddajo** shrani sledljivo oddajo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-86ab1083bb75 package=standard -->
### 13.68 Odpad s krožnikov: popravki oddaje

Popravek ustvarite z gumbom **Popravek** ob izvirni oddaji.

Popravek ne izbriše izvirne oddaje.

Privzeta količina popravka je negativna originalna količina.

Negativna vrednost zmanjša oddano količino oziroma stornira del oddaje.

Količina popravka ne sme biti 0.

Datum popravka je obvezen.

Opomba oziroma razlog popravka je obvezen.

Popravek ohrani povezavo z ID izvirne oddaje.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-41ed3073ed98 package=standard -->
### 13.69 Odpad s krožnikov: tabela oddaj

Tabela prikazuje Datum, Tip, Količino, Prevzemnika oziroma evidenčni list, Opombo in Akcijo.

Tip je Oddaja ali Popravek.

Popravek je prikazan z drugačno oznako.

Negativen popravek je vizualno poudarjen kot zmanjšanje.

Gumb z dokumentom odpre A4 PDF za konkreten zapis.

PDF ni dokaz, da je bila količina fizično prevzeta; dokazilo primerjajte s prevzemnikom in evidenčnim listom.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d3ff456665c9 package=standard -->
### 13.70 Odpad s krožnikov: primer 24, dnevni ostanki

Po večerji stehtate 3,40 kg ostankov s krožnikov.

Izberete poslovni datum izmene.

Vnesete 3,40 kg.

V opombo napišete »Povečan ostanek zaradi dogodka«, če je to dejansko pojasnilo.

Shranite dnevni vnos.

Ne zmanjšate zaloge posamezne jedi, ker ta modul tega ne počne.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5914b955f46b package=standard -->
### 13.71 Odpad s krožnikov: primer 25, delni popravek oddaje

Oddaja je bila vnesena kot 20,00 kg.

Prevzemnik potrdi, da je dejansko prevzel 18,50 kg.

Odprite popravek izvirne oddaje.

Vnesite −1,50 kg.

V opombo zapišite razlog in sklic na dokazilo.

Neto oddano bo 18,50 kg, izvirni zapis pa ostane v sledljivosti.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-584c8bfd3de6 package=lite -->
### 13.72 Revizijska obnova: splošno pravilo

Napake po knjiženju popravljajte z novim sledljivim dogodkom, kadar izvirnika ni dovoljeno brisati.

Ne uporabljajte nove prejemnice za prikrivanje porabe, manjka, prenosa ali napačne recepture.

Ne uporabljajte inventure za prikrivanje nepreverjene OCR napake.

Pred korekcijo izvozite oziroma zapišite stanje kartice in izvorne dokumente.

V opombi uporabite dejanski razlog, datum in povezavo z izvirnikom.

Po korekciji preverite količino, vrednost in sled gibanj.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8df6afef378c package=lite -->
### 13.73 Revizijska obnova: primer 26, napačen artikel pri OCR

OCR vrstico mleka povežete s smetano.

Napako odkrijete po knjiženju.

Najprej določite obseg: količina, cena, datum, dobavitelj in vpliv na porabo.

Ne prepišite samo naziva v poročilu.

Izvedite popravek po sledljivem procesu, ki obrne napačno gibanje in evidentira pravilnega.

Preverite kartici mleka in smetane.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-342c9dcdb0e7 package=lite -->
### 13.74 Revizijska obnova: primer 27, podvojena fotografija

Ista dobavnica je fotografirana dvakrat.

Drugi OCR vrne opozorilo o duplikatu.

Odprite obstoječo prejemnico po prikazanem ID.

Primerjajte številko dokumenta, dobavitelja, datum in vrstice.

Če je enaka, drugega uvoza ne nadaljujte.

Če ni enaka, zberite dokaz o razliki in razjasnite zaznavo duplikata.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f162011c05c3 package=lite -->
### 13.75 Revizijska obnova: primer 28, napačen datum dokumenta

Prejemnica je vnesena z datumom naslednjega meseca.

Količina je pravilna, časovna sled pa ni.

Preverite, ali je dokument že vplival na zaključena obdobja oziroma poročila.

Uporabite dovoljen popravljalni postopek in ohranite povezavo z izvirnim dokumentom.

Ne ustvarjajte druge enake prejemnice s pravilnim datumom brez obravnave prve.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-538f71270174 package=lite -->
### 13.76 Revizijska obnova: primer 29, izgubljena povezava med paketom in artiklom

Dobavitelj spremeni embalažo iz 12 na 10 kosov.

Staro shranjeno ujemanje bi lahko še naprej predlagalo 12.

Pri prvem novem dokumentu preverite enote v paketu na uvozni vrstici.

Ne sprejmite predloga samo zato, ker je artikel pravilno prepoznan.

Popravite povezavo oziroma pakiranje po postopku ujemanja.

Preverite učinek na količino in WAC.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-dfcb951131bb package=lite -->
### 13.77 Kontrolni list pred knjiženjem prejemnice

[ ] Dobavitelj je preverjen po nazivu in po potrebi davčni številki.

[ ] Številka dokumenta je prepisana brez izpuščenih znakov.

[ ] Datum dokumenta je preverjen, posebej okoli novega leta.

[ ] Fizična količina se ujema s prejemno količino.

[ ] Osnovna enota artikla se ujema z načinom vodenja zaloge.

[ ] Enote v paketu se ujemajo z embalažo.

[ ] Cena je pravilno razumljena kot neto ali bruto.

[ ] Popust je uporabljen samo enkrat.

[ ] DDV stopnja se ujema z dokumentom.

[ ] Odvisni stroški imajo pravilno obravnavo.

[ ] Vsaka OCR vrstica je povezana s pravim artiklom.

[ ] Ni nerazloženih ničelnih ali preskočenih vrstic.

[ ] Ni nerazrešenega opozorila o duplikatu.

[ ] Predogled knjiženja se ujema z listino.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-62e32a55f10e package=lite -->
### 13.78 Kontrolni list po knjiženju

[ ] Prejemnica je vidna v seznamu dokumentov.

[ ] Kartica pravilnega artikla kaže prejem.

[ ] Količina se je povečala za pričakovano osnovno enoto.

[ ] WAC je smiseln glede na staro zalogo in novo neto ceno.

[ ] Dobavitelj je pravilen.

[ ] Dokument ni podvojen.

[ ] Dokazilo je shranjeno po internem postopku.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-05b19687fb13 package=extended -->
### 13.79 Kontrolni list pred zaključkom dogodka

[ ] Dogodek ima pravilen status.

[ ] Zgodovina prenosov je pregledana.

[ ] Za vsak izhodni dokument sta preverjena porabljeno in preostalo.

[ ] Fizični preostanek je preštet v osnovnih enotah.

[ ] Povratni osnutki ustrezajo dejanskim preostankom.

[ ] Vračilo je potrjeno le za dejansko vrnjeno zalogo.

[ ] Odpad in manjko nista prikrita kot vračilo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f5965e783853 package=lite -->
### 13.80 Kontrolni list dnevne pripravljene hrane

[ ] Odtajana količina se ujema s porabljeno zamrznjeno zalogo.

[ ] Pripravljena količina je podprta s proizvodnim zapisom.

[ ] Korekcija ima dejanski razlog.

[ ] Prodana količina je preverjena.

[ ] Zamrznjena količina je fizično preverjena.

[ ] Kalo je nenegativno.

[ ] Pred zaključkom je pregledana potrditvena tabela.

[ ] Zaključen dan se ne uporablja za prikrivanje naslednjega dne.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-997867e32eb0 package=lite -->
### 13.81 Kratek praktični izpit 1: pakiranje

Naloga: prejemate dva zaboja po 24 kosov, artikel pa je v kosih.

Vprašanje: koliko kosov mora povečati zaloga?

Odgovor: 48 kosov.

Utemeljitev: dva paketa pomnožimo s 24 osnovnimi enotami v paketu.

Napačen odgovor 2 prezre pakiranje.

Napačen odgovor 24 prezre drugi zaboj.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-47d90887b57e package=lite -->
### 13.82 Kratek praktični izpit 2: bruto cena

Naloga: bruto cena je 10,50 EUR pri 5 % DDV.

Vprašanje: kolikšna je neto cena za WAC?

Odgovor: 10,00 EUR.

Utemeljitev: 10,50 / 1,05 = 10,00.

Napačen odgovor 10,50 bi DDV vključil v vrednost zaloge.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c55e44e8f80b package=lite -->
### 13.83 Kratek praktični izpit 3: popust

Naloga: deset kosov po 4,00 EUR neto ima 25 % popust.

Vprašanje: kolikšna je vrednost prejema po popustu?

Odgovor: 30,00 EUR.

Utemeljitev: 10 × 4,00 × 0,75 = 30,00.

Napačen odgovor 40,00 prezre popust.

Napačen odgovor 37,50 uporabi napačen odstotek.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2b717ee294b4 package=lite -->
### 13.84 Kratek praktični izpit 4: WAC

Naloga: 10 kosov s WAC 2,00 EUR in 10 novih kosov po 4,00 EUR.

Vprašanje: novi WAC?

Odgovor: 3,00 EUR.

Utemeljitev: skupna vrednost 20,00 + 40,00 je 60,00 EUR za 20 kosov.

V tem posebnem primeru je navadno povprečje slučajno enako, ker sta količini enaki.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5a36b99e2408 package=lite -->
### 13.85 Kratek praktični izpit 5: WAC z neenakimi količinami

Naloga: 30 kosov s WAC 2,00 EUR in 10 novih kosov po 5,00 EUR.

Vprašanje: novi WAC?

Odgovor: 2,75 EUR.

Utemeljitev: (30 × 2,00 + 10 × 5,00) / 40 = 110,00 / 40.

Napačen odgovor 3,50 je neuteženo povprečje cen.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3ace50ac4d08 package=lite -->
### 13.86 Kratek praktični izpit 6: OCR dobavitelj

Naloga: OCR ne prepozna dobavitelja.

Vprašanje: kaj naredite pred ustvarjanjem novega partnerja?

Odgovor: iščete po nazivu, kratkem nazivu in davčni številki.

Utemeljitev: preprečite dvojnik partnerja in napačno zgodovino dokumentov.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7a2dc472375f package=lite -->
### 13.87 Kratek praktični izpit 7: OCR artikel

Naloga: OCR predlaga artikel z enakim imenom, vendar drugo prostornino.

Vprašanje: ali ga sprejmete?

Odgovor: ne, preverite osnovno enoto, prostornino in pakiranje.

Utemeljitev: podobno ime ni dovolj za pravilno zalogo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-0806af55e298 package=lite -->
### 13.88 Kratek praktični izpit 8: ničelna vrstica

Naloga: OCR prebere vrstico količina 0.

Vprašanje: ali jo uparite samo za dokončanje uvoza?

Odgovor: ne.

Utemeljitev: najprej ugotovite, ali gre za informativno vrstico, rabat ali OCR napako.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-2a9bbc9b1c09 package=lite -->
### 13.89 Kratek praktični izpit 9: delna dobava

Naloga: naročeno je 12 kg, dostavljeno 9 kg.

Vprašanje: katero količino knjižite?

Odgovor: 9 kg.

Utemeljitev: prejemnica evidentira dejanski prevzem.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7cfd5f8c4726 package=lite -->
### 13.90 Kratek praktični izpit 10: inventura

Naloga: knjižno je 50 kosov, najdenih 47.

Vprašanje: kakšna je inventurna razlika?

Odgovor: −3 kosi.

Utemeljitev: dejansko minus knjižno je 47 − 50.

Nato preverite vzrok, ne sklepajte samodejno o odpadu.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-169a49e2f6e7 package=lite -->
### 13.91 Kratek praktični izpit 11: prenos

Naloga: v matični enoti prenesete 15 kosov na dogodek.

Vprašanje: ali je to prodaja?

Odgovor: ne, to je sledljiv prenos med enotama.

Utemeljitev: skupna količina organizacije se s prenosom ne sme zmanjšati.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9332ff59932c package=extended -->
### 13.92 Kratek praktični izpit 12: dogodek

Naloga: predogled dogodka opozori na nezadostno zalogo.

Vprašanje: ali potrdite prenos?

Odgovor: ne, zmanjšate količino ali uredite dejanski razpoložljivi vir.

Utemeljitev: opozorilo preprečuje neizvedljiv prenos.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-cef189ebe0ed package=standard -->
### 13.93 Kratek praktični izpit 13: pripravljena hrana

Naloga: odtajano 5, pripravljeno 20, korekcija −2, prodano 18, zamrznjeno 3.

Vprašanje: kolikšno je kalo?

Odgovor: 2.

Utemeljitev: 5 + 20 − 2 − 18 − 3 = 2.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-3a3da14d96aa package=lite -->
### 13.94 Kratek praktični izpit 14: negativno kalo

Naloga: skupaj 10, prodano 8, zamrznjeno 4.

Vprašanje: ali lahko zaključite dan?

Odgovor: ne.

Utemeljitev: kalo je −2 in zahteva popravek vhodnih podatkov.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-215bc387d570 package=standard -->
### 13.95 Kratek praktični izpit 15: odpad s krožnikov

Naloga: gostje pustijo 2,2 kg ostankov.

Vprašanje: ali vnos zmanjša zalogo pripravljene hrane?

Odgovor: ne.

Utemeljitev: modul odpadkov s krožnikov je neodvisna interna evidenca.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-8171c0f555bb package=lite -->
### 13.96 Kratek praktični izpit 16: popravek oddaje

Naloga: oddaja 9 kg je za 1 kg previsoka.

Vprašanje: kakšen popravek vnesete?

Odgovor: −1 kg, povezan z izvirno oddajo.

Utemeljitev: negativni popravek zmanjša neto oddano količino in ohrani sled.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5199d7c75c2d package=lite -->
### 13.97 Kratek praktični izpit 17: duplikat

Naloga: uvoz vrne 409 in ID prejemnice.

Vprašanje: kaj je prvi korak?

Odgovor: odprete obstoječo prejemnico in jo primerjate z listino.

Utemeljitev: ponoven uvoz lahko podvoji zalogo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-1740f8ce5a49 package=lite -->
### 13.98 Kratek praktični izpit 18: nova embalaža

Naloga: dobavitelj preide z 12 na 10 kosov v paketu.

Vprašanje: kaj pregledate?

Odgovor: enote v paketu pri ujemanju in vpliv na količino.

Utemeljitev: staro zapomnjeno ujemanje lahko vsebuje staro embalažo.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-170d07f99c17 package=lite -->
### 13.99 Kratek praktični izpit 19: prevoz

Naloga: prevoz 15 EUR naj poveča vrednost zaloge.

Vprašanje: katero obravnavo izberete?

Odgovor: Vrednost zaloge.

Utemeljitev: ta nastavitev vključuje strošek v vrednotenje zaloge.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-9d7ce635c12d package=lite -->
### 13.100 Kratek praktični izpit 20: ločen strošek

Naloga: računovodska politika prevoz vodi ločeno od zaloge.

Vprašanje: katero obravnavo izberete?

Odgovor: Ločen strošek.

Utemeljitev: prevoz ne sme neupravičeno povečati WAC.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-5ca31744c60c package=lite -->
### 13.101 Zaključna praktična vaja: celoten tok

Prejmete PDF dobavnice za dva zaboja pijače, 5 kg mesa in eno ničelno promocijsko vrstico.

Najprej preverite fizično blago in dokument.

PDF naložite prek načina Datoteka.

Preverite dobavitelja, številko dokumenta, datum in ali so cene bruto.

Pri pijači preverite število kosov v zaboju.

Pri mesu preverite kilogram in ceno na kg.

Ničelne promocijske vrstice ne uparite brez razlage.

Preverite popust, DDV in odvisne stroške.

Odprite predogled knjiženja.

Potrdite šele, ko se količine in vrednosti ujemajo z listino.

Po knjiženju preverite kartico pijače in kartico mesa.

Naslednji dan prenesite del pijače na dogodek.

Po dogodku preštejte preostanek in potrdite povratni prenos.

Ostanke s krožnikov stehtajte in jih vnesite v ločeni modul.

Ta zadnji vnos ne spreminja zaloge pijače, mesa ali pripravljene hrane.

1. Začetne zaloge imajo preverjen datum, količino in vrednost.
2. Vsaka prejemnica ima dobavitelja, dokument in pregledane vrstice.
3. OCR predlogi so ročno preverjeni.
4. Duplikati niso potrjeni.
5. Prazne OCR vrstice niso potrjene.
6. Prenosi imajo pravilni izvor in cilj.
7. Inventurna odstopanja so prešteta in obrazložena.
8. Pripravljena hrana porabi resnične sestavine po recepturi.
9. Odpad ima resničen razlog in količino.
10. Dogodek ne nadomešča drugih finančnih ali zalogovnih dokumentov.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-25db0c730d52 package=lite -->
## 14. Normalni vnos prejemnice in kontrola zaloge

To poglavje opisuje normalen tok. Odpravljanje OCR-napak, podvojenih listin in
popravljanje že knjiženih dogodkov je opisano v poglavju 13.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-cf3e3ab87887 package=lite -->
### 14.1 Ročna prejemnica

Pred vnosom pripravite izvirno dobavnico ali račun. Preverite dobavitelja,
številko listine, datum dokumenta, datum prejema, valuto, bruto oziroma neto
cene in uporabljene stopnje DDV.

1. Odprite **Prejemnice** in izberite **Nova prejemnica**.
2. Izberite dobavitelja iz obstoječega šifranta. Ne ustvarjajte novega
   dobavitelja zaradi napačno prebranega naziva.
3. Vnesite številko dokumenta ter datum dokumenta v obliki **dd.mm.yyyy**.
4. Dodajte artikel, količino, osnovno enoto, ceno, popust, DDV in število enot
   v paketu, kadar je prejeto pakiranje.
5. Pri povratni embalaži izberite dobavitelja, vrsto embalaže in količino;
   vračilo in odpis nista ista operacija.
6. Primerjajte neto, DDV in bruto seštevek z izvirno listino.
7. Odprite predogled zalogovnega in računovodskega učinka.
8. Prejemnico potrdite šele, ko se ujemajo dobavitelj, dokument, količine,
   enote, cene in DDV.

Potrditev prejemnice poveča zalogo in ustvari sled gibanja. Ne potrjujte
nepopolne vrstice samo zato, da bi zaključili uvoz. Če je dokument že uvožen,
odprite obstoječo prejemnico po prikazanem ID-ju; ne ustvarjajte druge enake
prejemnice.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-7d2c496d4283 package=lite -->
### 14.2 Začetna zaloga, inventura in kartica zaloge

Začetno zalogo uporabite samo pri vzpostavitvi ali odobreni korekciji začetnega
stanja. Pred vnosom določite poslovno enoto, datum stanja, artikel, osnovno
enoto, količino in vrednost.

1. Odprite **Zaloge → Začetna zaloga**.
2. Preverite, da je izbrana prava enota in poslovni datum **dd.mm.yyyy**.
3. Vnesite artikel in dejansko količino v osnovni enoti.
4. Vnesite nabavno vrednost oziroma vrednost po odobreni računovodski politiki.
5. Shranite predogled in preverite, ali se začetno gibanje pojavi na kartici.
6. Potrdite samo enkrat; ponovitev iste operacije mora vrniti že evidentiran
   rezultat, ne ustvariti novega gibanja.

Pri inventuri najprej določite rez, preštejte fizično stanje in šele nato
vnesite razliko. Kartico zaloge uporabite za preverjanje vseh gibanj: začetne
zaloge, prejemnic, porabe po normativu, odpisov, dogodkov in prenosov.
Inventure ne uporabljajte za skrivanje nepreverjene napake prejemnice ali
normativa.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-dfe9fff0f507 package=lite -->
### 14.3 Nabavna vrednost in WAC

WAC oziroma tehtano povprečno nabavno vrednost preverjajte po potrjeni
prejemnici, ne po prodajni ceni. V kontroli primerjajte:

- začetno količino in vrednost,
- novo prejeto količino in vrednost,
- popust, DDV ter strošek prevoza,
- novo količino in novo nabavno vrednost na kartici.

Če se WAC ne ujema z odobreno politiko, ustavite nadaljnjo porabo. Preverite
vrsto stroška prevoza, enote v paketu, bruto/neto razlago in ali je bil dokument
že knjižen. Ne popravljajte WAC-a z novo prejemnico brez povezave z izvorno
listino. Ponovni izračun je skrbniško oziroma servisno dejanje; uporabnik ga
ne sme izvajati kot nadomestilo za popravek napačnega dokumenta.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-c4c25559ced7 package=standard -->
### 14.4 Pripravljena in sestavljena hrana

Pri pripravljeni hrani ločite pripravo, razpoložljivost, prodajo, zamrzovanje,
odtajanje, korekcijo in odpad. Pred izdajo preverite, da je količina za prodajo
razpoložljiva; prodajna razpoložljivost ne pomeni samodejnega povečanja zaloge.

1. Odprite modul pripravljene hrane in izberite artikel oziroma recepturo.
2. Vnesite dejansko pripravljeno količino in enoto.
3. Preverite porabo sestavin po veljavnem normativu.
4. Pri odtajanju oziroma zamrzovanju uporabite namenski dogodek in opombo.
5. Pred objavo preverite razpoložljivost v POS-u in QR meniju.
6. Pri prodaji preverite, da je poraba sestavin vezana na pravo recepturo.

Če je razpoložljivost negativna ali se sestavine ne ujemajo, ne popravljajte
stanja z ročnim povečanjem. Preverite recepturo, začetno zalogo, prejemnice,
porabo in dogodek priprave.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-d858aed654e1 package=standard -->
### 14.5 Odpad s krožnikov

Odpad s krožnikov je ločena interna evidenca. Vnesite artikel oziroma skupino,
dejansko količino, enoto, razlog in datum **dd.mm.yyyy**. Ta vnos sam po sebi
ne zmanjša zaloge pripravljene hrane in ne nadomešča odpisa zaloge.

Če mora odpad vplivati na zalogo, izvedite odobren zalogovni odpis z ločenim
razlogom. Pred potrditvijo preverite, ali uporabniški vmesnik prikazuje samo
evidenco odpada ali tudi zalogovni učinek; če učinek ni prikazan, ga ne
domnevajte.

<!-- pos-heading: id=pos-07-zacetek-dela-dostop-f30476d09571 package=extended -->
### 14.6 Dogodki in prenosi med enotami

Dogodek uporabite za planirano porabo ali razporeditev zaloge za dogodek.
Prenos uporabite za dejansko premikanje zaloge med dovoljenim izvorom in ciljem.

1. Izberite **Dogodki** ali **Prenosi**.
2. Določite izvorno enoto/skladišče, ciljno enoto/skladišče, datum **dd.mm.yyyy**
   in odgovorno osebo.
3. Dodajte artikle v osnovni enoti in preverite razpoložljivo zalogo izvora.
4. Odprite predogled; opozorilo o nezadostni zalogi je razlog za ustavitev.
5. Potrdite oddajo oziroma prenos in shranite referenco.
6. Ciljna enota naj po prejemu preveri količine ter potrdi prejem.

Isti prenos se zaradi ponovnega klika ne sme izvesti dvakrat. Če je status
neznan, najprej poiščite isto referenco in preverite gibanje na izvoru ter
cilju. Ne ustvarjajte novega dogodka z drugačnimi količinami samo zato, da bi
obšli opozorilo.

<!-- pos-heading: id=pos-current-prepared-quantities-costing package=standard -->
## Pripravljena hrana: merska osnova, dejanska poraba in zaključek

V dnevni evidenci pripravljene hrane vsaka vrstica pokaže svojo osnovno
enoto: **porcija**, **kg** ali **l**. Odtajano, pripravljeno, korekcije,
zamrznjeno in kalo vnašajte v isti osnovi. Za kg/l so dovoljene decimalne
količine; gumbi za manjši korak spreminjajo količino za **0,1**, za večji
korak pa za **1**. Pri porcijah sta koraka **1** in **10**.

1. Izberite pravi poslovni dan in preverite osnovno enoto vsake jedi.
2. Vnesite dejansko odtajano in pripravljeno količino. Odtajanje je omejeno z razpoložljivo zamrznjeno zalogo.
3. Pri pripravi odprite **Poraba artiklov** ter primerjajte predlagane surovine z dejansko porabo. Preverite merske enote in evidentirajte odstopanja, ne dodatne prodaje.
4. Spremembe shranite z **Shrani vse** in ponovno preverite vsote ter prodane količine.
5. Ob zaključku vnesite dejansko zamrznjeno količino. Oznaka **Vse** uporabi vso še razpoložljivo količino za zamrzovanje; uporabite jo samo, če je to fizično res.
6. Pred zaključkom preverite izračun kala. Negativno kalo pomeni neskladje, ki ga je treba urediti, ne dovoljene dodatne zaloge.

Osnovna kontrola je: **odtajano + pripravljeno + korekcija − prodano −
zamrznjeno = kalo**. Pri polizdelku upoštevajte tudi dejansko porabo v
sestavljenih jedeh, ki se evidentira prek normativa. Priprava porabi surovine;
prodaja pripravljene jedi jih ne sme porabiti še enkrat.

Zamrznjeno in nezamrznjeno stanje preverjajte ločeno. Strošek priprave in
njegova razporeditev na porabljeno, preostalo oziroma kalo ni nova nabava.
Ob odstopanju preverite zapis dejanske porabe in dnevno evidenco, ne
spreminjajte starega normativa samo zato, da bi se ena dnevna vsota ujemala.

<!-- pos-heading: id=pos-current-import-vat-fx-review package=lite -->
## Uvoz prejemnice: dobavitelj, DDV in tuja valuta

Po OCR ali e-SLOG prepoznavi preverite dobavitelja iz šifranta, državo,
davčno identifikacijo, vrsto listine, datum in izvorne zneske.
Predlagana razvrstitev ni potrjena računovodska odločitev.
Slovenska sedemmestna matična številka in desetmestni zapis sedeža s
končnico **000** lahko označujeta isto identiteto; druge končnice ne pomenijo
samodejno istega sedeža. Enako ime samo po sebi ni dokaz istega dobavitelja.

Pri nabavi iz tujine razlikujte domači DDV, oprostitev in samoobdavčitev.
Prodajna davčna kategorija artikla ne določa samodejno pravilne nabavne
DDV-kode. Če se država ali DDV-identifikator izbranega dobavitelja ne ujema
z izvirnikom, najprej razrešite opozorilo in ne potrjujte napačnega partnerja.

Pri tuji valuti ohranite izvorno valuto in zneske ter preverite datum,
tečaj in EUR osnove oziroma DDV. Če so EUR osnove in DDV potrjeni ločeno,
jih ne izračunavajte še enkrat iz zaokrožene cene na kos. Izvorna cena,
tečaj in računovodski znesek imajo različne vloge.
Če so podatki nepopolni ali neskladni, računovodski pregled opravite pred
potrditvijo; izvoz ali OCR ne nadomestita izvorne listine.

<!-- pos-heading: id=pos-current-import-fixed-asset-review package=lite -->
## e-SLOG z možnim osnovnim sredstvom

Če uvoz odpre **Računovodski pregled možnih osnovnih sredstev**, ne potrjujte
teh vrstic kot običajno gostinsko materialno prejemnico.

1. Izberite preverjenega dobavitelja iz šifranta in primerjajte izvorni e-SLOG.
2. Za vsako prikazano vrstico preverite razvrstitev **Drugo osnovno sredstvo** ali **Nepremičnina**.
3. Računovodja mora pregledati izvorno listino, dobavitelja in davčno obravnavo ter izrecno potrditi prikazano izjavo.
4. Kliknite **Potrdi in ustvari ERP osnutek** samo po opravljenem pregledu in preverite nastali osnutek ERP prejetega računa.

Opozorilo ni samodejna razvrstitev ali knjižba. Potrditev tega posebnega
postopka pripravi ERP prejeti račun; ne pomeni samodejnega odprtja registra
osnovnih sredstev, obračuna amortizacije ali fizičnega prejema gostinske
zaloge. Če poslovne knjige vodi zunanji izvajalec, uskladite predajo z njim
in ne odpirajte interne glavne knjige zgolj zaradi opozorila uvoza.
