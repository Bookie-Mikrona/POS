# 03 · Nabava, zaloga in drugi računovodsko pomembni dogodki

## Namen in pravilo branja

To poglavje je namenjeno računovodskemu pregledu vseh POS-vnosov, ki niso
prodajni račun. Opisuje **dejansko vedenje trenutne izvedbe**. POS konto ni
fiksna številka: v temeljnico se vedno zapiše konto, ki je nastavljen v
`Nastavitve → Računovodstvo → POS konti` oziroma pri kategoriji/artiklu.
Sedemmestne številke v tabelah so zato **kontrolni primeri** (7-mestna
analitika), ki jih je treba pred uvozom zamenjati z dejanskimi kodami podjetja.
Naziv konta pa mora ostati usklajen z dejanskim kontnim načrtom.

Vsi zneski v primerih so v EUR. Temeljnica je pravilna samo, če je
`vsota D = vsota K`, obdobje je odprto, konti so aktivni in dovoljujejo
knjiženje, zahtevani partner/stroškovno mesto pa sta prisotna.

> **Pomembno – zaloga ni avtomatično glavna knjiga.** Prejemnica, inventura,
> začetna zaloga, prenos, pripravljena hrana in odpad pogosto najprej ustvarijo
> operativni gib zaloge. V GL se prenesejo samo tokovi, za katere obstaja
> računovodski predogled oziroma klic knjiženja. Če je pri primeru izrecno
> napisano »brez GL«, ne tvorite umetne temeljnice samo zato, ker se je stanje
> zaloge spremenilo.

## 1. Skupni postopek za vsak neprodajni dogodek

1. Izberite pravilno poslovno enoto in poslovni datum.
2. V POS odprite ustrezen vnos (najpogosteje `Zaloge`, `Prejemnice`,
   `Inventura`, `Začetne zaloge`, `Pripravljena hrana`, `Odpadki s krožnikov`
   ali `Blagajna → Premiki`).
3. Pred shranjevanjem preverite artikel, mersko enoto, količino, nabavno ceno,
   stopnjo DDV, vrsto dokumenta, dobavitelja in sklic.
4. Po shranitvi oziroma potrditvi prejemnice program pri POS sinhronizaciji
   samodejno pripravi osnutek temeljnice. Če je za konkretno vrsto dokumenta
   na voljo predogled, ga uporabite kot dodatno kontrolo.
5. Osnutek pregledate in knjižite na zaslonu **Temeljnice** šele po odpravi
   vseh blokirnih napak. Operativna potrditev prejemnice ali blagajniškega
   premika ni isto kot knjiženje osnutka v glavno knjigo.
6. V GL preverite številko temeljnice, izvorni POS ID, partnerja, dimenzije in
   obdobje. Pri uvozu v drug program preverite, da se isti izvorni dokument ne
   uvozi dvakrat.

### Zaslon za pregled dokumenta


Računovodja mora ločiti **vnos dokumenta**, **operativni gib zaloge** in
**osnutek temeljnice**. POS sinhronizacija pripravi osnutek s statusom `draft`;
šele ločeno knjiženje na zaslonu **Temeljnice** ga spremeni v `posted`.

## 2. Prejemnica: podprte vrste dokumentov

POS uporablja vrednosti `RACUN`, `DOBAVNICA`, `DOBROPIS` in `BREMEPIS`.
»Kombinirana dobavnica/račun« v praksi vnesite kot račun z vsemi fizično
prejetimi vrsticami; če ima podjetje ločen postopek za dobavnico in poznejši
račun, prvo vnesite kot dobavnico, drugo pa kot račun z ustreznim sklicem.
Ne ustvarite dveh zalogovnih prejemov za isti prevzem.

### 2.1 Račun dobavitelja (RACUN)

**Vnos:** `Zaloge → Nova prejemnica`; izberite dobavitelja, datum in vrsto
`Račun`; za vsako vrstico izberite artikel, količino, ceno brez DDV, popust,
stopnjo DDV in `Obravnava: zaloga` ali `strošek`; dodajte številko dokumenta in
shranite in potrdite dokument. Nato na zaslonu **Temeljnice** preglejte
samodejno ustvarjeni osnutek ter ga ločeno poknjižite.

**Primer:** moka 100 kg × 2,00 = 200,00 neto, DDV 9,5 % = 19,00, skupaj
219,00. Kontrolni konti: 3101000 *Zaloga surovin*, 1600950 *Vstopni DDV
9,5 %*, 2201000 *Dobavitelji*.

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3101000 | Zaloga surovin | D | 200,00 |
| 1600950 | Vstopni DDV 9,5 % | D | 19,00 |
| 2201000 | Dobavitelji – dobavitelj X | K | 219,00 |
| **Skupaj** |  | **D = K** | **219,00** |

**Porabljeni privzeti podatki:** konto zaloge oziroma stroška kategorije,
konto vstopnega DDV za stopnjo (ali splošni vhodni DDV), konto obveznosti
dobaviteljev, dobavitelj/partner in stroškovno mesto poslovne enote.

### 2.2 Dobavnica brez računa (DOBAVNICA)

**Vnos:** enak kot pri računu, vendar izberite `Dobavnica` in vnesite samo
dejansko prejeto blago. Pred potrditvijo preverite, ali je za podjetje
nastavljeno začasno konto prejetega blaga oziroma ali dobavnica ostane samo
operativni dokument.

Če predogled knjiženja dobavnico blokira ali prikaže samo zalogovni gib, je
to pričakovano: ne ustvarjajte obveznosti do dobavitelja brez računa.
Kadar je za dobavnico omogočeno vmesno knjiženje, je kontrolni primer:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3101000 | Zaloga surovin | D | 200,00 |
| 3001000 | Obračun nabave materiala in blaga | K | 200,00 |

**Robni primer:** poznejši račun mora imeti sklic na dobavnico in ne sme
ponovno povečati količine. Če izvedba ne ponuja povezave ali predogleda,
dobavnico vodite brez GL in račun knjižite kot edini finančni dokument.

### 2.3 Kombinirana dobavnica/račun

**Vnos:** `Nova prejemnica → Vrsta dokumenta: Račun`; v opombo vpišite
»dobavnica + račun«, vnesite dokumentno številko in vse vrstice. To je en
prevzem, en gib zaloge in ena obveznost.

Primer 100,00 neto pri 22 % DDV:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3102000 | Zaloga pijače | D | 100,00 |
| 1602200 | Vstopni DDV 22 % | D | 22,00 |
| 2201000 | Dobavitelji | K | 122,00 |

### 2.4 Dobropis dobavitelja (DOBROPIS)

Vrsta dokumenta obstaja v operativnem vnosu, vendar trenutna samodejna tvorba
temeljnice ne podpira pravilnega negativnega dobropisa: zahteva pozitivne neto
zneske, dokumente, ki niso `RACUN`, pa vodi prek konta 300. Zato
**dobropisa ne potrdite kot samodejno računovodsko temeljnico**.

Za vračilo 10 kosov pijače po 5,00 neto in DDV 22 % je pravilna ročna
računovodska politika naslednja:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 2201000 | Dobavitelji | D | 61,00 |
| 3102000 | Zaloga pijače | K | 50,00 |
| 1602200 | Vstopni DDV 22 % | K | 11,00 |

To je **ročni kontrolni primer**, ne rezultat trenutne POS sinhronizacije.
Operativno vračilo zaloge in povratne embalaže evidentirajte samo enkrat,
računovodski dobropis pa vnesite po potrjeni interni poti z referenco na
prvotni račun.

### 2.5 Breme-pis (BREMEPIS)

Vrsta `Breme-pis` je operativno na voljo, vendar trenutna tvorba prejemniških
temeljnic vseh dokumentov, ki niso `RACUN`, ne obravnava kot običajne
obveznosti do dobavitelja. Breme-pis zato knjižite samo po ročni
računovodski kontroli; ne predstavljajte predogleda prek konta 300 kot
končno obveznost do dobavitelja.

## 3. DDV na nabavnih vrsticah

### 3.1 Odbitni DDV

Na vrstici izberite veljavno vhodno FURS DDV-kodo, ki velja na datum
dokumenta. Predogled uporablja konto vstopnega DDV za 5 %, 9,5 %, 22 % ali
drug veljaven vhodni razred, kakor ga določa nastavitev. Za primer 50,00
neto pri 5 %:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3103000 | Zaloga hrane | D | 50,00 |
| 1600500 | Vstopni DDV 5 % | D | 2,50 |
| 2201000 | Dobavitelji | K | 52,50 |

### 3.2 Neodbitni DDV

Pri neodbitnem DDV znesek davka ne sme biti na kontu 160. Trenutna samodejna
tvorba prejemniške temeljnice podpira običajen domači odbitni vstopni DDV,
ne pa knjiženja bruto vrednosti za neodbitni režim. Take prejemnice ne
potrdite v samodejni knjižni poti; uporabite ročni računovodski postopek.

Primer 100,00 + 22,00 neodbitnega DDV, zaloga je bruto:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3104000 | Zaloga z neodbitnim DDV | D | 122,00 |
| 2201000 | Dobavitelji | K | 122,00 |

Če je neodbitni del strošek, je ročni kontrolni primer:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4207000 | Strošek z neodbitnim DDV | D | 122,00 |
| 2201000 | Dobavitelji | K | 122,00 |

Obe tabeli sta računovodska politika za ročni vnos, ne samodejni rezultat POS.

### 3.3 Mešane stopnje na istem dokumentu

Vnesite vsako stopnjo kot ločeno vrstico. Primer: 100,00 pri 9,5 % in
50,00 pri 22 %:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3101000 | Zaloga hrane | D | 100,00 |
| 3102000 | Zaloga pijače | D | 50,00 |
| 1600950 | Vstopni DDV 9,5 % | D | 9,50 |
| 1602200 | Vstopni DDV 22 % | D | 11,00 |
| 2201000 | Dobavitelji | K | 170,50 |

**Napaka:** vnos ene skupne DDV stopnje za dokument z dvema stopnjama.
Sistem lahko zahteva popravek, sicer je predogled davčno napačen in ga ne
uvažajte v GL.


## 4. Odvisni stroški, embalaža in kavcija

### 4.1 Odvisni strošek

V prejemnici odprite `Odvisni stroški`, dodajte naziv, znesek, DDV stopnjo in
izberite `Obravnava: zaloga` ali `strošek`. Pri obravnavi `zaloga` se znesek
pripiše nabavni vrednosti; pri `strošek` se knjiži na stroškovni konto.

Primer prevoz 20,00 + 4,40 DDV, obravnava strošek:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4491000 | Strošek prevoza | D | 20,00 |
| 1602200 | Vstopni DDV 22 % | D | 4,40 |
| 2201000 | Dobavitelji | K | 24,40 |

### 4.2 Povratna embalaža in depozit

Pri artiklu mora biti označeno `Povratna embalaža` in vpisana depozitna
vrednost. Prejemnica ustvari zapis v evidenci `embalažni promet` in zalogovni
gib; računovodski učinek je odvisen od tega, ali je depozit na dokumentu
zaračunan in kako je nastavljen konto embalaže/obveznosti.

Kontrolni primer: 20 zabojev × 3,00 depozita, 60,00, brez DDV v primeru
depozitne obveznosti:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 1291000 | Terjatev za povratno embalažo | D | 60,00 |
| 2201000 | Dobavitelji | K | 60,00 |

Če depozit ni na računu ali ni nastavljen GL-konto, **ne tvorite te
temeljnice**; preverite le evidenco embalažnega prometa.

### 4.3 Vračilo embalaže

`Zaloge → Embalaža → Vračilo embalaže`; izberite dobavitelja, artikel in
količino. Vračilo zmanjša evidenco embalaže. Pri spremembi prejemnice v
dobropis se nasprotni gib ustvari samodejno; ročni drugi vnos bi podvojil
vračilo.

### 4.4 Razbita, uničena ali drugače nevračljiva embalaža

Razbitja ne evidentirajte kot vračilo dobavitelju. Pri razbitju morata biti
usklajena dva ločena podatka:

1. **dejanska zaloga** se zmanjša za število uničenih kosov;
2. **saldo vračljive embalaže pri konkretnem dobavitelju** se zmanjša za isto
   količino z razlogom `razbitje` oziroma `uničenje`, vendar se obveznost do
   dobavitelja ne zmanjša, ker dobavitelj embalaže ni prejel.

Primer: od 20 zabojev z depozitno vrednostjo 3,00 EUR sta se 2 zaboja razbila.
Dobavitelju je mogoče vrniti 18 zabojev, 2 zaboja oziroma 6,00 EUR pa sta
odpis.

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4802000 | Strošek uničene povratne embalaže | D | 6,00 |
| 3107000 | Zaloga povratne embalaže | K | 6,00 |

Pri tem dogodku ni vrstice D na kontu 220, saj se obveznost do dobavitelja ne
zmanjša in dobavitelj ne izda dobropisa za uničena kosa. Obveznost se pozneje
poravna po običajnem postopku. Če dobavitelj kljub temu prizna delni dobropis,
se dobropis knjiži samo za dejansko priznano količino in se odpis za isti del
ne sme podvojiti.

Uporabite namensko funkcijo **Odpis povratne embalaže**. Izberite dobavitelja,
artikel, pozitivno količino, razlog (`razbitje`, `uničenje` ali
`nevračljivo`) in po potrebi opombo. Program v eni transakciji:

1. zmanjša dejansko zalogo;
2. zmanjša saldo vračljive embalaže pri izbranem dobavitelju;
3. pri pozitivni zgodovinski depozitni vrednosti ustvari osnutek temeljnice
   D nastavljeni strošek odpisa / K 3107000; pri vrednosti 0,00 EUR knjižne
   temeljnice ne ustvari;
4. ohrani konto 220 nespremenjen;
5. shrani razlog, zgodovinsko depozitno vrednost, izvajalca in enolični ključ
   operacije.

Odpis ne sme preseči niti fizične zaloge niti salda pri izbranem dobavitelju.
Po primeru z 20 zaboji in 2 razbitima kosoma morata tako fizična zaloga kot
dobaviteljski saldo pokazati 18 kosov, osnutek temeljnice pa 6,00 EUR odpisa.

## 5. Začetna zaloga

**Vnos:** `Zaloge → Začetne zaloge → Nova`; izberite leto, datum, artikel,
količino in ceno na enoto; dodajte opombo in shranite. Za isto enoto in leto
je dovoljen samo en dokument. Sistem ustvari operativni gib tipa
`inventura` in pokliče knjiženje začetne zaloge, če so za podjetje nastavljeni
ustrezni konti.

Primer: 40 kg mesa × 8,00 = 320,00:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3105000 | Začetna zaloga surovin | D | 320,00 |
| 9001000 | Začetno stanje kapitala/izravnava | K | 320,00 |

Konto 9001000 je zgolj kontrolna ponazoritev. V podjetju ga določite po
politiki otvoritvenih knjižb; POS ne sme samovoljno ustvariti začetnega
kapitala.

**Robni primeri:** druga začetna zaloga za isto leto je zavrnjena; sprememba
postavk razveljavi stare gibe z nasprotnimi gibanji in ponovno izračuna
zalogo; prazna postavka ni dovoljena.


## 6. Inventura: višek in manjko

**Vnos:** `Zaloge → Inventure → Nova`; vnesite datum, opombo in dejansko
prešteto količino. POS primerja `najdeno` s stanjem ob 23:59:59 na datum
inventure. Cena se vzame iz stanja oziroma zadnje prejemnice.

### 6.1 Inventurni višek

Primer: knjigovodsko 10 kg, najdeno 12 kg, cena 5,00; višek 10,00.

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3101000 | Zaloga surovin | D | 10,00 |
| 7901000 | Inventurni prihodki/viški | K | 10,00 |

### 6.2 Inventurni manjko

Primer: knjigovodsko 10 kg, najdeno 8 kg; manjko 10,00.

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4901000 | Inventurni manjki | D | 10,00 |
| 3101000 | Zaloga surovin | K | 10,00 |

Če POS za inventuro ne ponudi računovodskega predogleda oziroma kontov
manjka/viška, vnos vpliva samo na operativno zalogo. Takrat razliko poknjižite
v GL po internem kontnem načrtu in hranite inventurni zapisnik kot prilogo.

**Robni primeri:** negativna razlika ni prodaja; inventura z napačnim datumom
lahko zajame napačne prejeme/prodaje; popravek inventure ustvari nasprotne
gibe, zato ne popravljajte z novo »izravnalno« inventuro.


## 7. Odpis, odpad in kalo

### 7.1 Odpis surovin oziroma blaga

Če je na zaslonu `Zaloge → Odpis` omogočen odpis, izberite artikel, količino,
ceno in razlog. To je operativno zmanjšanje zaloge. Primer 3 kg × 4,00 =
12,00:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4802000 | Strošek kala/odpisa | D | 12,00 |
| 3101000 | Zaloga surovin | K | 12,00 |

Če odpis nima GL predogleda, je zgornja tabela le računovodska politika za
ročni vnos v GL, ne samodejni POS rezultat.

### 7.2 Kalo pripravljene hrane

V `Pripravljena hrana` zaključite dnevno evidenco, vnesite količino kala in
nato `Odpadki → Nov zapis kala`. Obvezni so razlog, oseba, ki je kalo
ugotovila/predala, in odgovorna oseba. Potrditev ustvari podpisan zapisnik
PDF; ne ustvarja sama po sebi prodaje ali DDV.


## 8. Pripravljena hrana: proizvodnja, odtajanje, zamrzovanje in popravki

`Pripravljena hrana` vodi dnevni ledger: odtaljena količina, pripravljena
količina, popravek, prodana količina, zamrznjena končna količina in odpad.
Strošek porcije se izračuna iz normativov in vhodnih artiklov.

### 8.1 Proizvodnja

Vnesite datum, pripravljeno količino in artikel vrste `prepared`; zaključite
dnevno evidenco. Če je normativ 2 kg surovin po 5,00 za 10 porcij, je vrednost
100,00. Operativno se poraba surovin in razpoložljivost pripravljene hrane
posodobita. Samodejni GL prenos proizvodnje ni ustvarjen, razen če je v
predogledu podjetja izrecno prikazan.

**Računovodska kontrolna knjižba, če jo podjetje vodi ročno:**

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3106000 | Zaloga pripravljene hrane | D | 100,00 |
| 3101000 | Zaloga surovin | K | 100,00 |

### 8.2 Odtajanje in zamrzovanje

Vnesite količine v dnevni evidenci. Odtajanje in zamrzovanje sta spremembi
operativne razpoložljivosti (tudi stroška na porcijo), ne finančna dogodka.
**Brez GL temeljnice.** Ne knjižite DDV in ne ustvarjajte prihodka.

### 8.3 Popravek

Popravek dovoljeno vnesite samo na zadnjo odprto dnevno evidenco. Pri
urejanju prejšnjega zapisa sistem zahteva popravek zadnjega odprtega zapisa;
starih gibov ne brišite neposredno.

### 8.4 Odpad pripravljene hrane

Dnevni odpad se vključi v pregled kala; po potrditvi zapisnika je operativno
razviden odpis. Če ni GL predogleda, je brez samodejne temeljnice. Za ročni
primer 10 porcij × 2,00 = 20,00 uporabite interno potrjen konto odpisa:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4802000 | Kalo pripravljene hrane | D | 20,00 |
| 3106000 | Zaloga pripravljene hrane | K | 20,00 |


## 9. Odpadki s krožnikov

`Odpadki s krožnikov → Nov zapis`: izberite datum, artikel/porcijo, količino,
razlog in opombo; shranite. Ta evidenca je ločena od storniranega računa in
od ločenega kala pripravljene hrane. V trenutni izvedbi vpliva na operativno
evidenco in poročila, ne pa neposredno na GL.

**Ne knjižite:**

* odpada kot negativne prodaje ali dobropisa;
* DDV popravka, če gostu ni bil izdan račun za odpad;
* zmanjšanja blagajne.

Če notranja politika zahteva finančni odpis 6,00:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 4802100 | Odpad s krožnikov | D | 6,00 |
| 3106000 | Zaloga pripravljene hrane | K | 6,00 |

To je ročni GL primer, ne samodejna POS temeljnica.


## 10. Prenosi zaloge in dogodki

### 10.1 Prenos med enotami/skladišči

`Zaloge → Prenosi → Nov prenos`: izberite izvor, cilj, artikel, količino in
datum; potrdite izdajni in prevzemni del. Prenos spremeni količino po enotah,
ne skupne vrednosti podjetja. Če enote uporabljajo ločene GL kontrole:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 3101100 | Zaloga – enota A | K | 100,00 |
| 3101200 | Zaloga – enota B | D | 100,00 |

Pri istem kontu in skupnem skladišču je učinek v GL nič; hranite samo
operativni prenos.

### 10.2 Prenos na dogodek in vračilo z dogodka

Na `Dogodki` ustvarite dogodek, uporabite zavihek `Prenosi`, določite smer,
artikel in količino. Vračilo vnesite kot nasprotni prenos in se sklicujte na
izvorni prenos. Prenos ni prodaja, nima DDV in ne sme ustvariti prihodka.


**Robni primer:** delno vračilo 6 od 10 kosov mora pustiti odprt saldo 4
kosov; ne vnesite celotnega vračila in ga nato popravite z drugo inventuro.
Če diagnostika dogodka pokaže manjkajočo sled, ustavite in ne knjižite ročne
temeljnice brez potrditve količine.

## 11. Vračila dobavitelju in kupcu

Vračilo dobavitelju je v POS podprto skozi `DOBROPIS` oziroma spremembo
prejemnice; uporablja nasprotne zalogovne in embalažne gibe. To ni vračilo
kupcu in ne stornira prodajnega računa.

Vračilo kupcu/izdaja dobropisa spada med prodajne tokove in je dokumentirano
v poglavju o prodaji; tukaj ga ne podvajamo. Če uporabnik v nabavni prejemnici
izbere kupca namesto dobavitelja, vnos zavrnite.

## 12. Blagajniški pologi, dvigi in izplačila

Blagajniški premiki imajo neposreden GL učinek. Odprite
`Blagajna → Premiki`, izberite blagajno, poslovni datum, tip, znesek, partner
(pri izplačilu dobavitelju) in po potrebi prejeti račun; potrdite.
Implementirani tipi so `IZPLAČILO_DOBAVITELJU`, `POLOG_GOTOVINE`,
`DVIG_GOTOVINE`, `POLOG_TRR` in `PRILIV_TRR`. Storno ustvari nasprotne vrstice.

### 12.1 Izplačilo dobavitelju iz blagajne

Primer 150,00, dobavitelj je obvezen, če konto zahteva partnerja:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 2201000 | Dobavitelji – dobavitelj X | D | 150,00 |
| 1001000 | Blagajna | K | 150,00 |

### 12.2 Polog gotovine v blagajno (`POLOG_GOTOVINE`)

Ta tip pomeni prihod gotovine v blagajno iz denarja na poti. Primer 500,00:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 1001000 | Blagajna | D | 500,00 |
| 1091000 | Denar na poti | K | 500,00 |

### 12.3 Dvig gotovine z banke (`DVIG_GOTOVINE`)

POS knjiži vmesni korak; primer 300,00:

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 1091000 | Denar na poti | D | 300,00 |
| 1101000 | TRR | K | 300,00 |

To je bančna stopnja dviga. Pri dejanskem prejemu gotovine v blagajno sledi
ločeni `POLOG_GOTOVINE`: `D 1001000 / K 1091000`.

### 12.4 Polog TRR in priliv TRR

`POLOG_TRR` iz blagajne: `D 1091000 / K 1001000`. Ko banka potrdi priliv,
`PRILIV_TRR` knjiži `D 1101000 / K 1091000`. Vedno uporabljajte ločena konta 109 in 110; sistem
zavrne nastavitev, kjer je TRR konto 109 ali sta konta enaka.


**Robni primeri in kontrole:** znesek mora biti pozitiven, največ 2 decimalni
mesti; uporabnik sme uporabljati samo dodeljeno blagajno; obdobje mora biti
odprto; izplačilo brez partnerja/prejetega računa je zavrnjeno, kadar konto
zahteva partnerja; manjkajoč ali neproknjižljiv konto ustavi knjiženje.

## 13. Kartice, bančno kliring-konto in uskladitev

Kartična prodaja je del prodajnega dnevnega knjiženja: POS jo knjiži na
nastavljeni kartični konto. Bančni priliv kartičnega procesorja se v glavni
knjigi uskladi prek klirinškega konta.

Primer kartične prodaje 122,00 in naknadnega priliva 120,17, provizija 1,83:

**POS dnevna temeljnica:**

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 1092000 | Kartični kliring | D | 122,00 |
| 7602200 | Prihodki od prodaje | K | 100,00 |
| 2602200 | Izhodni DDV 22 % | K | 22,00 |

**Bančni izpisek:**

| Konto | Naziv | D/K | Znesek |
|---|---|---:|---:|
| 1101000 | TRR | D | 120,17 |
| 4199000 | Provizija procesorja | D | 1,83 |
| 1092000 | Kartični kliring | K | 122,00 |

Konta 1092000 in 1101000 sta kontrolna primera; dejanski kartični konto je
nastavljen v POS nastavitvah. Ne knjižite bančnega priliva ponovno kot
prihodek.


## 14. Operativni dogodki in njihova knjižna pot

Pri vsakem dogodku preverite konkretni knjižni vir. Celotnega toka vračila
embalaže ali dobropisa ne označujte kot »brez GL«: finančne vrstice dobropisa,
fizično vračilo in odpis embalaže imajo različne knjižne poti.

| Vnos | Učinek POS | Neposredni GL |
|---|---|---|
| odtajanje/zamrzovanje pripravljene hrane | razpoložljivost in strošek porcije | brez temeljnice |
| priprava po normativu | poraba/razpoložljivost zaloge | brez samodejne temeljnice |
| odpad s krožnikov | evidenca odpada in poročilo | brez temeljnice |
| prenos med enotami z istim kontom | premik količine | brez neto učinka |
| vračilo embalaže z depozitom | embalažni promet in zmanjšanje zaloge | osnutek D 220 / K 3107000 |
| vračilo embalaže brez finančne vrednosti | embalažni promet in zmanjšanje zaloge | brez zneskovne temeljnice |
| odpis uničene povratne embalaže | zmanjšanje zaloge in dobaviteljskega salda | pri pozitivni vrednosti osnutek D strošek odpisa / K 3107000; pri 0,00 EUR brez zneskovne temeljnice |
| dobropis z embalažnimi vrsticami | finančne vrstice dobropisa in ločena uskladitev embalaže | preverite dejansko ustvarjeni osnutek; fizičnega učinka ne podvojite |
| inventura brez nastavljenih kontov | popravek zaloge | brez temeljnice |

Čisti operativni dogodki brez knjižnega vira niso napake. Računovodja mora pri
izvozu ločiti operativne priloge od dejanskih knjižb in pri dobropisih posebej
preveriti, da embalažni učinek ni zajet dvakrat.

## 15. Robni primeri, ki jih mora računovodja zavrniti

* isti račun je vnesen kot dobavnica in ponovno kot račun, brez povezave;
* DDV-koda ni vhodna, ni veljavna na datum ali se stopnja ne ujema z vrstico;
* dokument vsebuje mešanice 9,5 % in 22 %, vnesena pa je ena stopnja;
* neodbitni DDV je pomotoma knjižen na 160;
* dobropis ima pozitiven prejem blaga;
* vračilo embalaže je vneseno dvakrat (ročno in kot samodejni storno);
* začetna zaloga za leto že obstaja;
* inventura je datirana pred prejemnico, ki jo je računovodja že vključil;
* prenos na dogodek je vrnjen v celoti namesto delno;
* izplačilo dobavitelju nima partnerja ali je partner iz druge družbe;
* denar na poti in TRR uporabljata isti konto;
* računovodsko obdobje je zaprto;
* konto je skupinski, neaktiven, brez dovoljenja knjiženja ali zahteva
  stroškovno mesto, ki ga enota nima;
* ob neuspehu knjiženja je bil operativni dokument vseeno potrjen brez
  zabeleženega razloga.


## 16. Kontrolni seznam pred prenosom v glavno knjigo

1. Seštevek vsake temeljnice je uravnotežen.
2. Vsak vir ima POS ID, datum, poslovno enoto in uporabnika.
3. Prejemnice so razvrščene po `RACUN`, `DOBAVNICA`, `DOBROPIS`,
   `BREMEPIS`.
4. Pri računih so dobavitelj, številka računa, DDV-koda in partner skladni.
5. Preverjene so vse stopnje DDV in odbitnost.
6. Zaloga, embalaža, inventura in odpisi so usklajeni z operativnimi poročili.
7. Pri blagajni se stanje ujema z X-poročilom; gotovina, pologi in izplačila
   niso ponovno zajeti v prodajnem dnevniku.
8. Kartični kliring, denar na poti in bančni izpisek imajo odprte postavke
   samo za dejanske razlike.
9. Robni primer je označen kot samodejna temeljnica, ročna temeljnica ali
   brez GL učinka.
10. Pri uvozu v drug program uporabite stabilen ključ `(company, enota,
    sourceType, sourceId)` in zavrnite podvojitev.
