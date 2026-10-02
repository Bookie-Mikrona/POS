# 1. Oddelki, projekti in stroškovna mesta pri knjiženju

**Bookie ERP — priročnik za glavno knjigo**

**Obseg:** analitične oznake knjižb, njihovi šifranti, nastavitve kontov, ročni vnos temeljnice in analitično poročilo.

Primeri v poglavju so izmišljeni in namenjeni razlagi. Ne določajo organizacije ali kontiranja konkretnega podjetja.

## 1.1 Kaj so analitične dimenzije

Analitične dimenzije so dodatne oznake posamezne knjižbe. Z njimi razporedimo in pregledujemo poslovne dogodke po notranji organizaciji, odgovornosti ali konkretnem poslu.

Konto pove, **kaj knjižimo**: na primer strošek zunanje storitve, prihodek od prodaje, terjatev ali obveznost. Dimenzija pove, **kateremu delu poslovanja knjižba pripada**.

| Podatek na knjižbi | Vprašanje, na katero odgovarja | Ponazoritveni primer |
|---|---|---|
| Konto | Kaj je predmet knjiženja? | Strošek zunanjih storitev |
| Oddelek | Kateremu organizacijskemu delu pripada? | Razvoj |
| Stroškovno mesto | Kje oziroma pri kateri odgovorni enoti nastaja? | Poslovalnica Ljubljana |
| Projekt | Za kateri konkretni posel ali cilj nastaja? | Uvedba sistema — stranka A |
| Partner | S kom je nastala terjatev, obveznost ali drug poslovni odnos? | Dobavitelj storitve |

Dimenzije ne nadomestijo konta, poslovnega partnerja ali podatkov dokumenta. Projekt, poimenovan po stranki, ni nadomestilo za izbor partnerja.

Izbira dimenzije sama po sebi ne ustvari novega stroška, prihodka ali plačila in ne spremeni zneska knjižbe.

## 1.2 Oddelek: organizacijska pripadnost

Oddelek običajno predstavlja trajnejši organizacijski del podjetja, na primer razvoj, prodajo, podporo strankam, proizvodnjo ali upravo.

Uporabljamo ga, kadar želimo pregledovati pripadnost stroškov oziroma prihodkov posameznemu delu organizacije.

**Primer:** račun za oglaševanje knjižimo na ustrezni stroškovni konto in izberemo oddelek »Prodaja«. Stroškovni konto pove naravo izdatka; oddelek pove njegovo organizacijsko pripadnost.

Oddelek ni posamezni zaposleni in ni nujno poslovalnica. Pred začetkom uporabe določimo, kaj bo v podjetju pomenil, ter to razlago uporabljamo dosledno.

## 1.3 Projekt: konkreten posel ali cilj

Projekt združuje knjižbe, povezane z določenim poslom, naročilom, razvojem, investicijo ali drugim ciljem. Lahko traja nekaj dni ali več let.

Primeri:

- uvedba sistema pri določeni stranki,
- razvoj novega izdelka,
- izvedba dogodka,
- prenova poslovnega prostora,
- izvedba pogodbenega naročila.

Na isti projekt lahko vežemo različne vrste stroškov in prihodkov na različnih kontih. Na njem lahko sodeluje več oddelkov.

**Primer:** razvoj in podpora sodelujeta pri uvedbi sistema. Knjižbe obeh oddelkov označimo z istim projektom »Uvedba sistema — stranka A«, vsako pa z ustreznim oddelkom.

Zaključek poslovnega projekta ni isto kot zapiranje terjatve ali obveznosti. Deaktiviranje projekta ne pomeni plačila računa, storna knjižbe ali zaključka poslovnega leta.

## 1.4 Stroškovno mesto: ločen pogled na nastajanje stroškov

Stroškovno mesto je v aplikaciji samostojna dimenzija z lastnim šifrantom. Običajno označuje lokacijo, poslovalnico, dejavnost, proizvodno enoto ali drug jasno določen nosilec stroškov.

V manjšem podjetju se lahko vsebinsko prekriva z oddelkom. Če obe oznaki pomenita isto in ne prinašata različnih informacij, njuno podvajanje ni nujno koristno.

Pred uporabo se dogovorimo:

1. Kaj predstavlja oddelek?
2. Kaj predstavlja stroškovno mesto?
3. Kaj predstavlja projekt?
4. Pri katerih vrstah knjižb bomo posamezno oznako uporabljali?
5. Kdo preverja pravilnost razporeditve?

Posamezna vrstica lahko hkrati vsebuje **eno stroškovno mesto, en projekt in en oddelek**. Oznake se med seboj ne izključujejo.

Več pogledov ne pomeni več prometa: ista knjižba se lahko pojavi v pregledu projektov in v pregledu oddelkov. Seštevkov teh dveh pregledov zato ne seštevamo med seboj.

## 1.5 Priprava šifrantov

Pred odpiranjem oznak določimo preprosto pravilo kodiranja in jasne nazive. Kode naj omogočajo nedvoumno prepoznavanje; nazivi naj bodo razumljivi tudi uporabniku, ki oznake ni ustvaril.

Ponazoritveni primeri:

| Vrsta | Koda | Naziv |
|---|---|---|
| Oddelek | RAZ | Razvoj |
| Oddelek | POD | Podpora strankam |
| Projekt | PR-2026-001 | Uvedba sistema — stranka A |
| Projekt | PR-2026-002 | Prenova poslovnega prostora |

To niso obvezne kode ali predlagane nastavitve določenega podjetja. Koda in naziv ne določata konta ali davčne obravnave.

Oznake pripadajo aktivnemu podjetju. Pred urejanjem šifrantov in knjiženjem preverimo, katero podjetje je izbrano.

### Ustvarjanje oddelka ali projekta

1. V meniju odpremo **Dimenzije**.
2. Izberemo zavihek **Oddelki** ali **Projekti**.
3. Kliknemo **Nov Oddelek** oziroma **Nov Projekt**.
4. Vnesemo obvezno **Kodo** in **Naziv**.
5. Po potrebi dodamo **Opis**, ki pojasni namen in pravilo uporabe.
6. Potrdimo ustvarjanje in preverimo zapis v seznamu.

Pri ustvarjanju ima koda omejitev 20 znakov, naziv pa 200 znakov. Opis je neobvezen. Koda mora biti enolična znotraj ustreznega šifranta podjetja; ob podvojeni kodi program pokaže napako.

Stroškovna mesta urejamo na ločeni strani **Stroškovna mesta**, ne v zavihku oddelkov ali projektov.

### Urejanje in deaktiviranje

Pri urejanju projekta oziroma oddelka lahko spreminjamo naziv, opis in stanje **Aktivno**. Kode v obrazcu za urejanje ne spreminjamo.

Oznako, ki je ne bomo več uporabljali za nove knjižbe, deaktiviramo. Seznam na strani Dimenzije vključuje tudi neaktivne zapise, običajni izbirniki pri novih knjižbah pa jih ne ponujajo.

V uporabniškem vmesniku za projekte in oddelke ni postopka brisanja. Deaktiviranje ohrani obstoječe povezave knjižb; ne spremeni njihovih zneskov.

Ne preimenujemo zaključenega projekta v vsebinsko drug projekt samo zato, da bi ponovno uporabili zapis. Za nov posel ustvarimo novo oznako, staro pa po potrebi deaktiviramo.

## 1.6 Pravila na kontih: dovoljeno, obvezno in prepovedano

V **Kontnem planu** lahko za posamezni konto določimo pravila uporabe dimenzij.

### Stroškovno mesto

| Pravilo | Pomen za knjižbo na tem kontu |
|---|---|
| Prepovedano | Stroškovnega mesta na vrstici ne izberemo. |
| Dovoljeno | Stroškovno mesto lahko izberemo, ni pa obvezno. |
| Obvezno | Vrstica mora imeti izbrano stroškovno mesto. |

### Projekt

Stikalo **Zahteva projekt** določa, ali je projekt na knjižbi na tem kontu obvezen. Če zahteva ni vključena, je projekt neobvezen.

### Oddelek

Oddelek je trenutno neobvezen. Program nima nastavitve obveznega oddelka na kontu. Podjetje lahko določi interno pravilo njegove uporabe, vendar to ni isto kot programska blokada.

**Pomembno:** konto, ki zahteva projekt, lahko uporabimo šele, ko je na voljo ustrezen projekt. Zahteve ne izpolnjujemo z naključno izbrano oznako.

Pri ročnem vnosu program preverja manjkajoče zahtevane dimenzije in prepovedano stroškovno mesto ob shranjevanju. Pravila ponovno preveri tudi pri knjiženju osnutka. To poglavje ne potrjuje enakega vedenja vseh uvoznih ali samodejnih postopkov; njihove razporeditve je treba posebej pregledati.

## 1.7 Izbira dimenzij na temeljnici

Dimenzije izbiramo **na posamezni vrstici temeljnice**, ne enkrat za celotno temeljnico.

1. Odpremo vnos nove temeljnice na strani **Temeljnice**.
2. Vnesemo podatke glave in posamezne knjižbene vrstice po običajnem postopku.
3. Na vrstici izberemo ustrezni konto.
4. V sklopu **Dimenzije** izberemo ustrezno **Stroškovno mesto**, **Projekt** in/ali **Oddelek**.
5. Pri vsaki vrstici preverimo pravila izbranega konta.
6. Pred potrditvijo preverimo oznake, zneske in uravnoteženost celotne temeljnice.

Polji za stroškovno mesto in projekt se prikažeta, če obstajajo aktivne možnosti oziroma če konto dimenzijo zahteva. Oddelek se prikaže, ko obstaja možnost za izbiro.

Če polja ni, najprej preverimo ustrezni šifrant in aktivnost zapisov. To ni razlog, da bi knjižbo brez premisleka dodelili drugi vrsti dimenzije.

Na eni vrstici lahko izberemo samo eno oznako posamezne vrste. Ni izbire več projektov, oddelkov ali stroškovnih mest z odstotki znotraj iste vrstice.

## 1.8 Razdelitev zneska med več oddelkov ali projektov

Če en poslovni dogodek pripada več oznakam iste vrste, znesek razdelimo na več knjižbenih vrstic.

### Primer: razdelitev stroška zunanje storitve

Prejeti račun ima osnovo 1.000,00 EUR. Od tega 600,00 EUR pripada projektu uvedbe sistema, 400,00 EUR pa redni podpori.

Za prikaz celotne temeljnice predpostavimo 220,00 EUR DDV in pravico do celotnega odbitka. To je računska predpostavka primera, ne navodilo za davčno obravnavo konkretnega računa.

| Vrstica | Konto oziroma namen | Oddelek | Projekt | Debet EUR | Kredit EUR |
|---|---|---|---|---:|---:|
| 1 | Ustrezen konto stroškov zunanjih storitev | Razvoj | Uvedba sistema — stranka A | 600,00 | 0,00 |
| 2 | Isti stroškovni konto | Podpora strankam | Brez projekta | 400,00 | 0,00 |
| 3 | Ustrezen konto odbitnega DDV | Brez oznake | Brez projekta | 220,00 | 0,00 |
| 4 | Ustrezen konto obveznosti do dobavitelja; izbran dobavitelj | Brez oznake | Brez projekta | 0,00 | 1.220,00 |
| **Skupaj** | | | | **1.220,00** | **1.220,00** |

Primer predpostavlja, da pravila kontov dopuščajo prikazano razporeditev. Dejanske konte, partnerja, davčne podatke in morebitne zahtevane dimenzije določimo po listini in pravilih podjetja.

Rezultat:

- projekt uvedbe sistema ima 600,00 EUR pripisanega stroška;
- oddelek Razvoj ima 600,00 EUR pripisanega stroška;
- oddelek Podpora strankam ima 400,00 EUR pripisanega stroška;
- skupni strošek ostane 1.000,00 EUR;
- DDV in obveznost nista podvojena;
- temeljnica je uravnotežena.

Če tudi redna podpora sodi v drug projekt, na drugi vrstici izberemo ta projekt. Če isti znesek delimo med dve stroškovni mesti, uporabimo enako načelo več vrstic.

Pri razdelitvi po odstotkih najprej izračunamo zneske. Njihova vsota mora biti enaka izvirnemu razporejanemu znesku, tudi po zaokroževanju na cente.

**Napačno:** celotni strošek 1.000,00 EUR knjižimo dvakrat, enkrat na vsak projekt. To bi podvojilo strošek, ne izvedlo razdelitve.

## 1.9 Katere vrstice označujemo

Za spremljanje stroškov in prihodkov oznake praviloma dosledno uporabljamo na pripadajočih stroškovnih in prihodkovnih vrsticah.

Dimenzije na terjatvah, obveznostih ali drugih bilančnih kontih so lahko smiselne za drug analitični namen. Njihova uporaba mora biti dogovorjena in skladna s pravili kontov.

Ne označujemo avtomatično vseh nasprotnih vrstic, DDV in plačil z istim projektom samo zato, da bi izginilo opozorilo o neoznačenem prometu.

Če vse strani uravnotežene temeljnice pripišemo isti oznaki, je lahko njen skupni saldo nič. To ne pomeni, da projekt nima stroškov ali da je njegov poslovni rezultat nič.

Doslednost je pomembnejša od števila uporabljenih oznak. Podjetje naj določi, katere skupine kontov uporablja za posamezni analitični namen.

## 1.10 Analitično poročilo

### Prikaz poročila

1. V meniju odpremo **Analitika**.
2. Izberemo vrsto **Dimenzija**: **Stroškovna mesta**, **Projekti** ali **Oddelki**.
3. Določimo **Obdobje od** in **Obdobje do**.
4. Po potrebi izberemo **Konto**.
5. Kliknemo **Prikaži poročilo**.
6. Pregledamo seštevke in morebitno opozorilo o knjižbah brez dimenzije.
7. S klikom vrstice razširimo razčlenitev po kontih.

Na voljo so hitre izbire **Tekoče leto**, **Preteklo leto** in **Tekoči mesec**, izvoz CSV ter tisk.

Poročilo ponuja ločene preglede treh vrst dimenzij. Sam izbor vrste dimenzije ne predstavlja skupnega križnega poročila »projekt × oddelek«.

### Kaj pomeni obdobje

Poročilo uporablja datum temeljnice. Zato lahko drugačna datumska osnova pri drugem poročilu povzroči drugačen obseg postavk, čeprav sta vnesena enaka datuma.

Pred primerjavo z glavno knjigo ali drugim izpisom preverimo podjetje, obdobje, datumsko osnovo, izbrani konto in obseg knjiženih postavk.

### Katere temeljnice so vključene

Vključene so knjižene temeljnice, tudi tiste s statusom stornirane, da se upošteva ustrezna knjižbena sled. Osnutki niso vključeni. V tem poročilu uporabnik nima ločenega izbirnika statusa.

Osnutek zato ne postane del analitičnega prometa samo zato, ker že vsebuje projekt ali oddelek.

### Debet, kredit in saldo

Za vsako oznako poročilo izračuna debet, kredit in saldo:

**Saldo = debet − kredit.**

Saldo ni samodejno dobiček projekta. Njegov pomen je odvisen od vključenih kontov.

**Primer:** na projektu je 1.000,00 EUR stroškov v debetu in 1.500,00 EUR prihodkov v kreditu. Če pregled zajema samo te poslovno primerljive stroškovne in prihodkovne knjižbe, je saldo −500,00 EUR; razlika prihodkov nad stroški je 500,00 EUR.

Če so v istem seštevku tudi DDV, terjatve, obveznosti, plačila ali druge bilančne postavke, iz tega skupnega salda ne sklepamo neposredno o dobičku. Najprej pregledamo razčlenitev po kontih.

### Knjižbe brez izbrane dimenzije

V tabelo po oznakah so vključene le vrstice, ki imajo izbrano vrsto dimenzije. Promet brez te oznake je prikazan ločeno v opozorilu **Poročilo ni popolno — obstajajo knjižbe brez dimenzije**.

Opozorilo prikaže debet, kredit in neto saldo neoznačenih vrstic. Pregledamo vse tri podatke: neto saldo nič še ne pomeni, da ni neoznačenega prometa.

Opozorilo ni samo po sebi dokaz neuravnotežene temeljnice ali napačne davčne knjižbe. Pove, da izbrana analitična razporeditev ne zajema vseh vrstic izbranega obsega.

Možne razlage:

- oznaka je bila pomotoma izpuščena na strošku oziroma prihodku;
- vrstica pripada rednemu poslovanju brez projekta;
- bilančna ali DDV vrstica po dogovorjenem pravilu ne potrebuje te oznake;
- starejše ali uvožene knjižbe še nimajo analitične razporeditve.

V primeru iz razdelka 1.8 poročilo projektov ne zajame vrstice redne podpore brez projekta, poročilo oddelkov pa zajame obe stroškovni vrstici. DDV in obveznost ostaneta brez obeh oznak. Zato različna pokritost dveh pogledov ni nujno napaka.

Seštevki analitike so primerljivi s prometom glavne knjige šele ob enakem obsegu in ob upoštevanju neoznačenih vrstic.

## 1.11 Popravki in zaključevanje uporabe oznake

### Pred knjiženjem

Oznake preverimo pred potrditvijo knjiženja. Če je osnutek napačen, ga obravnavamo v postopku priprave; ne predpostavljamo, da obstaja neposredno urejanje vsakega osnutka. Če potreben popravek v njegovem vnosnem postopku ni mogoč, uporabimo predvideno odstranitev osnutka in pravilen ponovni vnos.

Pri tem upoštevamo izvor dokumenta in njegove povezave. Osnutka, ustvarjenega iz drugega modula, ne odstranjujemo brez preverjanja pripadajočega postopka.

### Po knjiženju

Poglavje ne predvideva neposrednega prepisovanja dimenzij že knjižene temeljnice. Za napačno knjiženo razporeditev uporabimo predvideni postopek storna in pravilne nove temeljnice.

Pred popravkom preverimo odprto obdobje, povezane listine, zapiranja in učinek na poročila. Storno celotne knjižbe in zgolj popravek povezave zapiranja sta različna postopka.

Deaktiviranje projekta ali oddelka ni način popravljanja napačne knjižbe.

### Po zaključku projekta

Pred deaktiviranjem preverimo, ali pričakujemo še pozne račune, dobropise ali druge knjižbe, ki mu pripadajo. Po potrebi ga začasno ohranimo aktivnega. Poznega stroška ne dodelimo drugemu projektu samo zato, ker je prvotni neaktiven.

## 1.12 Kontrolni seznami

### Pred začetkom uporabe

- [ ] Določen je različen namen oddelkov, projektov in stroškovnih mest.
- [ ] Šifranti pripadajo pravemu podjetju.
- [ ] Kode so nedvoumne, nazivi razumljivi, opisi pojasnjujejo uporabo.
- [ ] Določene so skupine kontov, ki jih želimo analitično spremljati.
- [ ] Zahteve na kontih so usklajene z razpoložljivimi aktivnimi oznakami.
- [ ] Dogovorjena je obravnava skupnih stroškov in zaokroževanja razdelitev.

### Pred knjiženjem temeljnice

- [ ] Konto, partner in znesek izhajajo iz prave listine.
- [ ] Izpolnjeni sta morebitni zahtevi po projektu in stroškovnem mestu.
- [ ] Prepovedano stroškovno mesto ni izbrano.
- [ ] Oddelek in projekt ustrezata dejanski pripadnosti vrstice.
- [ ] Razdeljeni zneski skupaj predstavljajo izvirni znesek brez podvojitve.
- [ ] Temeljnica je uravnotežena.
- [ ] DDV in nasprotne knjižbe niso podvojeni.

### Pri pregledu analitike

- [ ] Izbrani so pravo podjetje, vrsta dimenzije in obdobje.
- [ ] Preverjena sta konto oziroma kontni obseg in datumska osnova.
- [ ] Osnutki se ne pričakujejo v knjiženem prometu.
- [ ] Pregledana je razčlenitev po kontih.
- [ ] Preverjene so neoznačene vrstice, tudi kadar je njihov neto saldo nič.
- [ ] Skupni saldo ni brez preverjanja razglašen za dobiček projekta.
- [ ] Seštevki različnih dimenzijskih pogledov niso sešteti kot dodaten promet.

## 1.13 Pogosta vprašanja in težave

**Ali potrebujemo oddelke, če že uporabljamo stroškovna mesta?**  
Ne nujno. Uporabimo jih, če omogočajo drugačen, uporaben organizacijski pogled.

**Ali lahko ena knjižba hkrati pripada oddelku in projektu?**  
Da. Vsaka vrstica ima ločena polja za oddelek, projekt in stroškovno mesto.

**Ali lahko eno vrstico razdelimo na dva projekta z odstotki?**  
Ne neposredno. Izračunamo zneske in jih vnesemo na ločene vrstice.

**Zakaj projekt ni v izbirniku?**  
Preverimo aktivno podjetje, obstoj projekta in njegovo stanje Aktivno.

**Zakaj na vrstici ni polja za oddelek?**  
Preverimo, ali so v šifrantu oddelkov na voljo aktivne možnosti.

**Zakaj se temeljnica ne shrani?**  
Preberemo prikazano napako. Med možnimi vzroki so manjkajoče obvezno stroškovno mesto ali projekt oziroma prepovedano stroškovno mesto. Napaka ima lahko tudi drug vzrok, zato je ne odpravljamo z naključnimi oznakami.

**Zakaj strošek ni v analitičnem poročilu?**  
Preverimo, ali je temeljnica knjižena, ali datum temeljnice sodi v obdobje, ali ni izbran drug konto in ali ima stroškovna vrstica pravo vrsto dimenzije.

**Ali oddelek trenutno lahko določimo kot obvezen na kontu?**  
Ne. Njegovo uporabo zagotavljamo z internim pravilom in pregledom; projekt in stroškovno mesto imata opisane programske nastavitve.

**Ali lahko neoznačeno knjižbo v poročilu samodejno prerazporedimo?**  
To poglavje ne opisuje take funkcije. Analitično poročilo je namenjeno pregledu; popravek opravimo po ustreznem knjižbenem postopku.

**Ali deaktiviranje odstrani zgodovinske knjižbe?**  
Ne. Zapis ostane povezan z obstoječimi knjižbami, le za nove vnose ni običajna aktivna izbira.

**Ali program sam iz naziva projekta določi konto ali davčno obravnavo?**  
Ne. Dimenzija je analitična oznaka, ne pravilo za samodejno kontiranje ali DDV.