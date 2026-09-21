# POS Gostinstvo – fizični prevzem terminalov, tiskalnikov in izmene

## Namen

Ta protokol je namenjen fizičnemu prevzemu POS Gostinstvo na konkretni lokaciji.
Preverja povezavo med POS aplikacijo, plačilnim terminalom, tiskalnikom, FURS
postopkom, kuhinjo/točilnico, zalogo in zaključkom izmene.

Dokument je **testni zapisnik**, ne dokaz, da je bila naprava že preizkušena.
Test je uspešen šele, ko so pri konkretnem modelu in konkretni napravi vpisani
dejanski rezultati ter podpis odgovorne osebe.

## Pravila varnega testiranja

1. Pred testom določite, ali uporabljate testno ali produkcijsko okolje.
2. Produkcijska plačila izvajajte samo z odobrenim testnim zneskom in po dogovoru
   z odgovorno osebo. Če ponudnik nima testnega okolja, vnaprej določite postopek
   vračila oziroma storna.
3. Ne uporabljajte pravega PIN-a, ne zapisujte PAN-a in ne fotografirajte kartice.
   V zapisnik vnesite samo maskirano oznako, avtorizacijsko kodo ali referenco,
   kadar je to potrebno za uskladitev.
4. Pri nejasnem rezultatu kartičnega plačila kartice ne uporabite ponovno. Najprej
   preverite terminal, POS arhiv in status pri ponudniku.
5. Ne spreminjajte več nastavitev hkrati. Po vsaki spremembi ponovite samo test,
   ki je bil zaradi nje prizadet.
6. Fizični test ne sme potrditi napačnega davčnega ali računovodskega rezultata.
   Če se zneski ne ujemajo, ustavite test in zapišite razliko.

## Podatki testnega okolja

Izpolnite pred začetkom:

| Podatek | Vrednost |
|---|---|
| Datum in čas testa | |
| Lokacija oziroma enota | |
| Poslovni datum | |
| Blagajna | |
| POS naprava oziroma računalnik | |
| Uporabnik/tester | |
| Odgovorna oseba | |
| FURS okolje | testno / produkcijsko |
| Omrežje | Wi-Fi / Ethernet / mobilno / drugo |
| Različica POS aplikacije | |
| Različica mostu oziroma agenta | |

Za vsak fizični kos opreme vpišite ločeno vrstico:

| Vrsta | Proizvajalec in model | Serijska oznaka | Povezava | Testiran |
|---|---|---|---|---|
| Plačilni terminal | | | | |
| Tiskalnik računa | | | | |
| Kuhinjski tiskalnik/KDS | | | | |
| Windows tiskalni agent | | | | |
| Android tiskalni most | | | | |

## Predpogoji

- pravilna aktivna enota, blagajna in naprava;
- odprta testna izmena;
- testni artikel z znano ceno in znano DDV-kodo;
- vsaj en artikel, ki gre v kuhinjo, in en artikel, ki gre v točilnico;
- papir pravilne širine, zaprt pokrov in možnost varnega izklopa omrežja;
- pri kartičnih testih odobrena testna kartica ali dogovorjeno produkcijsko
  testno plačilo;
- pri FURS testu pravilen certifikat, poslovni prostor in elektronska naprava;
- dostop do arhiva računov, dnevnega izkaza, izmen, X- in Z-poročila.

Pred vsakim testom zabeležite številko testnega naročila. Če se izda račun,
zabeležite tudi številko računa. Testnih računov ne brišite.

## Tehnični predogled povezav

Pred plačilnim testom preverite konfiguracijo na **konkretni POS napravi**.
Nastavitev druge blagajne ali drugega terminala ni dokaz, da je ta naprava
pravilno povezana.

| Sklop | Kaj mora biti dosegljivo | Dodatna opomba |
|---|---|---|
| Payten | preverjanje povezave prek POS; nato plačilo | uporablja IP, vrata in čas čakanja naprave |
| SumUp | aktivna naprava, dostop in po potrebi serijska številka | status se preverja prek checkout identifikatorja |
| Viva Smart | aktivna konfiguracija in status naročila | zabeležite order code, ne skrivnosti |
| Viva POS terminal | aktiven terminal in preverljiv status | naprava mora imeti zahtevani terminalski ID |
| ZCS Z92 | `GET http://localhost:8090/status` | potrebuje oba nativna `.so` modula |
| NYX/NB80 most | `GET http://localhost:8090/status` oziroma port 8091 pri NB80 mostu | ZCS in NYX na istem portu ne smeta teči hkrati |
| Windows agent | heartbeat, prevzem naloge in ACK | tiskalnik je lokalno vezan na računalnik z agentom |

Pri mostu ne zadostuje, da se aplikacija zažene. Uspešen predogled pomeni, da
je most povezan s sistemskim tiskalniškim servisom in da fizični tiskalnik
sprejme testni izpis.

## Testni primeri

Status vsakega primera je lahko samo:

- **PASS** – pričakovani rezultat je dosežen in dokaz zapisan;
- **FAIL** – rezultat je napačen ali postopek ni dokončan;
- **BLOCKED** – test ga ni mogoče izvesti zaradi manjkajoče naprave, dostopa ali
  testnega okolja;
- **N/A** – funkcija na tej konkretni napravi ni predvidena, z razlogom.

### P0 – začetek dela in kontekst

| ID | Postopek | Pričakovani rezultat |
|---|---|---|
| P0.1 | Prijavite se s svojim uporabnikom | Prikažejo se prava enota, blagajna in dovoljenja |
| P0.2 | Preverite aktivno napravo in poslovni dan | POS uporablja konkretno testirano napravo in pravilen poslovni datum |
| P0.3 | Odprite izmeno in izberite natakarja | Izmena je odprta, uporabnik in blagajna sta sledljiva |
| P0.4 | Preverite začetni menjalni denar | Začetno stanje je zapisano ločeno od prodaje |

### P1 – naročilo, priprava in tisk kuhinje

1. Odprite naročilo na testni mizi.
2. Dodajte najmanj en kuhinjski in en barski artikel.
3. Pošljite naročilo v pripravo.
4. Preverite, da se vsaka postavka pojavi samo na pravilnem KDS-ju oziroma
   tiskalniku.
5. Spremenite količino ali dodajte opombo pred pripravo.
6. Preverite, da se sprememba ne podvoji in da kuhinja/točilnica vidi pravilen
   končni podatek.

**Pričakovano:** številka naročila, miza, artikel, količina in opomba so enaki
na POS-u in na delovnem izpisu. Dvojni klik ne ustvari dvojne priprave.

### P2 – gotovinsko plačilo in račun

1. Uporabite znan znesek, na primer 12,30 EUR.
2. Izberite **Gotovina** in vnesite prejetih 20,00 EUR, če obrazec to omogoča.
3. Preverite vračilo 7,70 EUR.
4. Izdajte račun.
5. Preverite številko računa, ZOI/EOR oziroma prikazano FURS stanje.
6. Preverite račun v arhivu, zalogovni gib, dnevni izkaz in pričakovano gotovino.

**Pričakovano:** račun je izdan samo enkrat, vračilo je pravilno, gotovina je
pripisana gotovinskemu kanalu, zaloga se je zmanjšala samo za zaračunane
postavke, FURS rezultat pa je v skladu z uporabljenim okoljem.

### P3 – Payten

1. Na isti napravi izvedite test povezave s terminalom.
2. Začnite kartično plačilo z natančnim zneskom naročila.
3. Na terminalu izvedite odobreno plačilo.
4. Preverite status `odobren`, avtorizacijsko kodo in referenco, če sta na voljo.
5. Dokončajte izdajo računa in preverite povezavo med računom in plačilnim
   poskusom.
6. Z odobreno testno kartico oziroma po dogovoru izvedite še zavrnitev.
7. Preverite, da zavrnjeno plačilo ne ustvari kartičnega računa.

**Pričakovano:** znesek na terminalu in POS-u je enak, odobritev ustvari en
račun, zavrnitev pa ne ustvari plačila oziroma računa kot kartično plačanega.

### P4 – SumUp

1. Začnite SumUp plačilo na konkretni napravi.
2. Preverite prikaz checkouta oziroma pošiljanje na serijsko številko terminala.
3. Preverite prehod `pending` v končni status pri ponudniku.
4. Ob `PAID` dokončajte izdajo računa.
5. Ob `FAILED` preverite, da račun ni označen kot plačan.
6. Ponovite zahtevo z istim identifikatorjem poskusa in preverite, da se ne
   ustvari drugi checkout ali druga bremenitev.

**Pričakovano:** isti checkout ostane vezan na isti plačilni poskus in isti
račun. Neuspešen ali nedokončan checkout ne spremeni računa v uspešno plačilo.

### P5 – Viva Smart in Viva POS terminal

Za vsako omogočeno Viva pot izvedite ločen test:

1. preverite konfiguracijo naprave;
2. ustvarite plačilni postopek;
3. izvedite odobreno plačilo;
4. preverite order code oziroma terminalsko sejo;
5. preverite končni status pri ponudniku;
6. dokončajte račun samo po potrjeni odobritvi;
7. izvedite zavrnitev ali preklic, če ga testno okolje omogoča.

**Pričakovano:** Smart in POS terminal se ne zamenjata, vsaka referenca je
vezana na svoj plačilni poskus, zavrnitev ali preklic pa ne ustvari uspešnega
kartičnega računa.

### P6 – nejasen rezultat in izpad povezave

Ta test je treba izvesti samo z odgovorno osebo in z vnaprej dogovorjenim
postopkom, ker lahko terminal dejansko bremeni kartico.

1. Začnite kartično plačilo.
2. Po pošiljanju zahtevka prekinite povezavo POS-a oziroma simulirajte timeout,
   ne da bi ponovno uporabili kartico.
3. Preverite stanje terminala in ponudnika.
4. Preverite POS zapis plačilnega poskusa.
5. Poskusite osvežiti oziroma preveriti isti plačilni postopek.

**Pričakovano:** stanje je označeno kot čakanje oziroma nejasno, kadar izida ni
mogoče dokazati. POS ne izvede nove bremenitve samo zato, ker se je spletni
prikaz končal z napako. Primer ostane sledljiv za ročno uskladitev.

Test je **FAIL**, če uporabniški tok pri nejasnem rezultatu ponudi tiho novo
bremenitev ali če ni mogoče najti prvotnega poskusa.

### P7 – kartična napitnina

Ta primer je **N/A**, če konkretni ponudnik, model terminala in nameščena
aplikacija ne potrjujejo vnosa napitnine na terminalu.

Če je funkcija potrjena:

1. ustvarite račun z osnovnim zneskom;
2. terminalu pošljite osnovni znesek po potrjenem postopku;
3. gost naj sam izbere napitnino na terminalu;
4. preverite eno skupno odobritev;
5. preverite ločen znesek napitnine, skupni znesek in referenco;
6. preverite račun, X/Z, evidenco napitnin in morebitno knjiženje.

**Pričakovano:** POS ne ugiba zneska napitnine, napitnina ni artikel in ni
prikazana kot kartična napitnina brez ločenega potrjenega rezultata terminala.

### P8 – tisk računa in dokumentov

Na vsakem fizičnem tiskalniku izvedite:

1. testni izpis z `č`, `š`, `ž`, znakom EUR, dolgim nazivom in decimalnim
   zneskom;
2. običajen račun z vrsticami artiklov;
3. QR oziroma FURS povezavo, kadar jo račun vsebuje;
4. ZOI oziroma črtno kodo, kadar jo račun vsebuje;
5. izpis na papirju pravilne širine;
6. ponovni klik oziroma ponovni klic iste tiskalne naloge;
7. test z odprtim pokrovom ali brez papirja, če je to varno;
8. retry po ponovni vzpostavitvi tiskalnika oziroma agenta.

**Pričakovano:**

- šumniki in EUR so pravilno berljivi;
- stolpci in decimalke so poravnani;
- QR in ZOI sta skenirljiva oziroma čitljiva;
- isti račun se zaradi ponovljenega klika ne natisne dvakrat brez izrecne
  uporabniške zahteve;
- napaka papirja ali pokrova se pokaže kot napaka, ne kot lažni uspeh;
- po odpravi napake se naloga nadaljuje po predvidenem retry postopku;
- pri Windows agentu je viden heartbeat in končni ACK;
- pri Android mostu je fizični izpis dokaz, da poleg HTTP statusa deluje tudi
  sistemski AIDL tiskalniški servis.

Posebej vpišite širino in model. Za 58 mm uporabljajte 32 stolpcev kot
referenčni test; ZCS Z92 ima lahko drugačno dejansko širino izpisa.

### P9 – storno, vračilo in ponovitev tiska

1. Na uspešno izdanem testnem računu izvedite predvideni postopek storna.
2. Pri kartičnem testu uporabite samo podprto in dogovorjeno vračilo.
3. Preverite nasprotni promet, FURS sled, zalogo in poročila.
4. Ponovno natisnite račun iz arhiva.
5. Preverite, da ponovni tisk ne ustvari nove prodaje, nove zaloge ali novega
   plačila.

**Pričakovano:** storno oziroma vračilo je nov sledljiv zapis, prvotni račun
ostane v zgodovini, ponovni tisk pa je samo tiskalna operacija.

### P10 – konec izmene, X in Z

1. Izvedite najmanj en gotovinski in en kartični test, če je kartični ponudnik
   v uporabi.
2. Dodajte testirano napitnino samo, če je način pri P7 potrjen.
3. Preverite X-poročilo brez zaključka dneva.
4. Preštejte fizično gotovino z drugo odgovorno osebo.
5. Primerjajte gotovino, kartice, bone, napitnine in blagajniške premike.
6. Zaključite izmeno.
7. Izvedite Z-zaključek šele, ko so razlike razjasnjene oziroma je razlog
   odstopanja pravilno zabeležen.
8. Preverite zaklep dneva in poskusite izvesti dejanje, ki mora biti po Z-zaključku
   blokirano.

**Pričakovano:** X ne zaklene dneva, Z ga zaklene, fizična gotovina se ujema s
pričakovanim stanjem ali ima sledljiv razlog odstopanja, skupni zneski v Z pa se
ujemajo z izdanimi računi in plačilnimi kanali.

## Kontrolna uskladitev po testu

Po koncu preverite iste testne primere na vseh relevantnih mestih:

| Kontrola | Pričakovano |
|---|---|
| Arhiv računov | vsak uspešen račun obstaja enkrat |
| Plačilni poskusi | vsak poskus ima končni ali jasno nejasen status |
| FURS | številka, ZOI/EOR in status so sledljivi |
| Zaloga | prodani artikli so porabljeni enkrat; storno ima nasprotni gib |
| Tiskalna vrsta | naloge imajo pravilen končni status in niso podvojene |
| X-poročilo | vmesni seštevek je skladen z računi |
| Z-poročilo | zaključek vsebuje prave blagajne in plačilne kanale |
| ERP temeljnica | če je sinhronizacija omogočena, je vir testnega prometa prepoznaven |

## Zapis posameznega primera

Kopirajte za vsak ID:

```text
ID:
Status: PASS / FAIL / BLOCKED / N/A
Čas začetka:
Čas konca:
Naročilo:
Račun:
Znesek:
Ponudnik oziroma tiskalnik:
Naprava/blagajna:
Pričakovani rezultat:
Dejanski rezultat:
Referenca oziroma avtorizacijska koda (brez občutljivih podatkov):
FURS rezultat:
Tiskalna naloga oziroma status:
Posnetek/fotografija izpisa brez podatkov kartice:
Opis odstopanja:
Naslednji ukrep:
Odgovorna oseba:
```

## Razvrstitev napak

- **P0 – blokada prevzema:** dvojna bremenitev, račun izdan brez potrjenega
  plačila, kartično plačilo brez sledljive reference, napačen FURS rezultat,
  napačen znesek v Z-poročilu ali izguba računa.
- **P1 – pomembna napaka:** terminal ali tiskalnik ne deluje v običajnem toku,
  račun se ne natisne, KDS napačno usmeri naročilo, retry povzroči podvojitev
  ali uskladitev zahteva ročni poseg.
- **P2 – manjša napaka:** poravnava, širina, besedilo ali uporabniško obvestilo
  je nepopolno, vendar denar, račun, FURS in sledljivost ostanejo pravilni.

P0 mora biti odpravljen pred uporabo. P1 mora imeti potrjen obvoz in rok
odprave. P2 je lahko sprejet samo z zapisanim dogovorom odgovorne osebe.

## Merilo za uspešen fizični prevzem

Prevzem konkretne konfiguracije je uspešen, ko:

- so P0.1–P0.4, P2, P3 oziroma P4/P5 glede na uporabljene ponudnike, P8 in P10
  uspešno zaključeni;
- ni odprte P0 napake;
- noben nejasen kartični rezultat ni bil rešen z novo slepo bremenitvijo;
- vsak fizični tiskalnik, ki je označen kot aktiven, ima dejanski berljiv izpis;
- so računi, plačilni poskusi, FURS, zaloga, tiskalna vrsta in X/Z medsebojno
  usklajeni;
- so vsi nedosegljivi ali nepreizkušeni sklopi označeni kot BLOCKED ali N/A z
  razlogom;
- odgovorna oseba podpiše zapisnik.

Podpis ni dovoljenje za uporabo nepreizkušene naprave. Če je naprava
BLOCKED, mora biti v nastavitvah onemogočena ali pa mora biti jasno določeno,
da se je v prometu ne uporablja.

## Zaključek in podpis

| Vloga | Ime | Datum | Podpis |
|---|---|---|---|
| Tester | | | |
| Vodja izmene | | | |
| Skrbnik POS/opreme | | | |
| Računovodstvo oziroma odgovorna oseba za FURS | | | |

**Končni status konfiguracije:** sprejeto / sprejeto z omejitvami / ni sprejeto

**Odprte napake in roki:**

| ID napake | Resnost | Opis | Začasni ukrep | Rok | Odgovorna oseba |
|---|---|---|---|---|---|
| | | | | | |
