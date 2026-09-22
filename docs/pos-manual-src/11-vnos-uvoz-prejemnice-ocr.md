<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-d38b37b11951 package=lite -->
# 11 Odpravljanje težav in izredni primeri

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-59495d2a5252 package=lite -->
## 1. Varen odziv

Simptom ni dokaz vzroka.
Najprej ustavite ponavljanje dejanja, nato preverite zapis in šele potem ukrepajte.
Ne brišite dokumentov, naročil ali dnevnikov, da bi »počistili« napako.
Zapišite čas, enoto, uporabnika, napravo, številko dokumenta in vidno sporočilo.

| Simptom | Pomen | Varen ukrep |
|---|---|---|
| gumb se vrti | rezultat ni znan | počakajte, nato preverite arhiv |
| zaslon javi napako | dejanje morda ni uspelo | preberite sporočilo in preverite stanje |
| zapis manjka v pogledu | lahko je filter ali druga enota | preverite kontekst in iskanje |
| naprava ne odgovarja | lokalna povezava je lahko prekinjena | ne ustvarjajte nadomestnih dokumentov |

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bd994e8183cc package=lite -->
## 2. Brez povezave ali sinhronizacija

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-57f3bfe83f06 package=lite -->
### Simptom

POS se ne nalaga, spremembe ostanejo v čakanju, naprava je brez povezave ali podatki med napravami niso enaki.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8033facd5e62 package=lite -->
### Pomen

Lahko gre za lokalno omrežje, prijavno sejo, strežnik ali še nedokončano sinhronizacijo.
Ni dovoljeno sklepati, da se vnos ni shranil samo zato, ker ga trenutno ne vidite.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-618514689089 package=lite -->
### Varen ukrep

1. Ne ponavljajte vnosa ali plačila.
2. Preverite povezavo naprave in ali je prijava še veljavna.
3. Po ponovni povezavi poiščite naročilo oziroma dokument po času, številki in znesku.
4. Primerjajte stanje na enem zaupanja vrednem pogledu.
5. Če je rezultat nejasen, predajte vodji z zbranimi podatki.

Ne čistite predpomnilnika, ne nameščajte programov in ne menjajte enote brez odobritve.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-918b83d49722 package=lite -->
## 3. Terminal: neznan rezultat

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c9b7de8c671e package=lite -->
### Simptom

Terminal pokaže odobritev, zavrnitev ali časovno omejitev, POS pa čaka, javi napako ali ne prikaže plačila.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f11a6dda3f67 package=lite -->
### Pomen

Plačilo je lahko že odobreno, tudi če POS odgovora ni prejel.
Drugi poskus lahko gosta bremeni dvakrat.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-69ca08634742 package=lite -->
### Varen ukrep

1. Ne zaženite druge transakcije in ne zahtevajte druge kartice.
2. Zapišite čas, znesek, terminal, ponudnika in referenco s potrdila, če obstaja.
3. V POS-u preverite naročilo, plačilo in arhiv računov.
4. Preverite stanje na terminalu oziroma po odobrenem postopku ponudnika.
5. Če stanje ni potrjeno, predajte blagajniku ali vodji.
6. Gostu povejte, da plačilo preverjate; ne trdite, da je neuspešno.

**Nikoli ne plačajte dvakrat zaradi nejasnega rezultata terminala.**
Podrobni tok plačila in preverjanja računa je v 06.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0faef2812ce0 package=lite -->
## 4. FURS ali potrdilo

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2172257e6be1 package=lite -->
### Simptom

Račun pokaže fiskalno napako, manjka EOR, potrdilo je poteklo ali je zavrnjena povezava.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ba4d6d090cdb package=lite -->
### Pomen

Vzrok je lahko potrdilo, konfiguracija blagajne, dosegljivost storitve ali poslovni podatek.
Ne kaže nujno na neizdan račun.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-9b32887d449f package=lite -->
### Varen ukrep

1. Preverite številko računa in njegovo stanje v arhivu.
2. Preberite celotno sporočilo ter zapišite čas in enoto.
3. Ne izdajajte istega računa ponovno.
4. Uporabite odobren postopek za motnje fiskalizacije iz 06.
5. Administratorju predajte podatke brez datoteke potrdila in brez gesla.

Potrdila, zasebnega ključa in gesla ne pošiljajte podpori v klepetu ali posnetku zaslona.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1c57255d68d0 package=lite -->
## 5. Tiskalni most ali tiskalnik

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bf9271e47290 package=lite -->
### Simptom

Račun, kuhinjski listek ali poročilo se ne natisne, čaka ali pride na napačen tiskalnik.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-18942249e9e0 package=lite -->
### Pomen

Dokument je lahko veljavno ustvarjen; napaka je lahko v mostu, omrežju, papirju ali usmerjanju.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-06fd694dadeb package=lite -->
### Varen ukrep

1. Najprej preverite, ali dokument obstaja v POS-u.
2. Preverite papir, napajanje in prikaz povezave tiskalnika.
3. Preverite, ali je most aktiven na določeni napravi.
4. Ne izdajajte novega računa zaradi manjkajočega tiska.
5. Uporabite ponatis oziroma odobreno alternativo šele po preverjanju.
6. Napačno usmerjanje predajte administratorju.

Nastavitev mostov je v 09, izdaja računa in tisk pa v 06.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-47a9790362ed package=lite -->
## 6. Zastarela enota ali blagajna

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f486a2d55a23 package=lite -->
### Simptom

Manjkajo mize, številčenje ni pričakovano, naročilo se ne vidi v pripravi ali je prikazana stara enota oziroma blagajna.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-7d1e3e32ba34 package=lite -->
### Pomen

Naprava, uporabnik ali filter lahko uporablja napačen poslovni kontekst.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1a0f52475213 package=lite -->
### Varen ukrep

1. Ustavite vnos pred plačilom.
2. Preverite podjetje, enoto, blagajno, izmeno in poslovni datum.
3. Ne ustvarjajte nove mize ali nadomestnega računa.
4. Preverite iskanje v pravilni enoti.
5. Če je enota zaprta ali zastarela, obvestite vodjo oziroma administratorja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-cae5009477b4 package=extended -->
## 7. Rezervacija blokira mizo

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8e72a5f2d7c0 package=lite -->
### Simptom

Miza je zasedena ali blokirana, gost pa je ni prevzel oziroma je rezervacija napačna.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-03e134aec4dc package=lite -->
### Pomen

Miza je lahko vezana na aktivno rezervacijo, odprto naročilo ali pravilo razporeditve.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ea0bcac7d116 package=lite -->
### Varen ukrep

1. Preverite rezervacijo, čas, ime in stanje mize.
2. Preverite odprta naročila na isti mizi.
3. Ne odpirajte nove fizične mize za prikritje konflikta.
4. Spremembo rezervacije naj potrdi pooblaščena oseba.
5. Gostu dodelite drugo mizo le po dogovoru z vodjo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-fbb814376ac3 package=standard -->
## 8. KDS, kuhinja ali bar

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ae2849ec2ecc package=standard -->
### Simptom

Postavka se ne prikaže, je prikazana dvakrat, ima napačno opombo ali se stanje ne posodobi.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e0f80dbc07b4 package=standard -->
### Pomen

Naročilo je lahko neoddano, filtrirano, usmerjeno drugam ali sinhronizirano z zamikom.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e435b9a77078 package=standard -->
### Varen ukrep

1. Preverite številko naročila in postavko v POS-u.
2. Preverite pravilen pripravljalni pogled in filter.
3. Natakar in priprava uskladita dejansko stanje neposredno.
4. Ne pripravljajte dveh porcij samo po dveh prikazih brez preverjanja.
5. Ne označujte postavke pripravljene, če ni pripravljena.
6. Ob ponavljanju predajte vodji s časom in številko naročila.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a72e15efb72b package=lite -->
## 9. Zaloga, prejemnica in OCR

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ad0ebf9c1006 package=lite -->
### Simptom

Zaloga je negativna, prejemnica nima smisla, OCR napačno prebere dobavitelja, artikel, količino, ceno ali DDV.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-169e9c894ddc package=lite -->
### Pomen

OCR razbere dokument in pripravi predlog; ne potrdi poslovne resničnosti.
Razlika je lahko v pakiranju, enoti mere, datumu, dvojnem dokumentu ali povezavi artikla.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bcba9aeef14d package=lite -->
### Varen ukrep

1. Primerjajte sliko oziroma izvirnik z glavo in postavkami.
2. Preverite dobavitelja, številko, datum, vrsto dokumenta in duplikat.
3. Preverite artikel, pakiranje, enoto mere, količino, ceno, DDV in seštevek.
4. Ne potrjujte dokumenta z neznanim ujemanjem.
5. Popravite samo preverjene podatke ali shranite osnutek za odgovorno osebo.
6. Po potrditvi preverite učinek na zalogo.

Podrobni vnos in uvoz sta v 07.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a293742848b3 package=lite -->
## 10. Napaka dostopa

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-6147a1c67680 package=lite -->
### Simptom

Prijava ne uspe, manjka gumb, uporabnik ne vidi enote ali je seja potekla.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-338bd7d01639 package=lite -->
### Pomen

Vzrok so lahko napačna prijava, potek seje, vloga, dodelitev enote ali povezava.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f2d0139abfcd package=lite -->
### Varen ukrep

1. Uporabite svoj račun in preberite sporočilo.
2. Preverite povezavo ter se po potrebi znova prijavite.
3. Po prijavi preverite, ali je bil prejšnji vnos že shranjen.
4. Ne uporabljajte računa sodelavca in ne ugibajte gesla.
5. Vodji predajte zahtevo za pravico; administrator preveri profil po 09.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-06acb3f455ba package=lite -->
## 11. Podpora brez skrivnosti

Zahtevek naj vsebuje:

1. datum in čas;
2. podjetje, enoto in blagajno;
3. vlogo uporabnika in vrsto naprave;
4. korake tik pred napako;
5. točno besedilo sporočila;
6. številko naročila, računa ali dokumenta, kadar obstaja;
7. ali je bil rezultat preverjen v arhivu, na terminalu ali na tiskalniku.

Ne pošiljajte gesel, PIN-ov, sejnih žetonov, zasebnih ključev, datotek potrdil ali celotnih podatkov kartic.
Posnetek zaslona pred pošiljanjem preglejte in prikrijte osebne oziroma plačilne podatke.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ca6f236b87fa package=lite -->
## 12. Kdaj ustaviti in eskalirati

Takoj eskalirajte sum dvojnega plačila, nejasen fiskalni dokument, sum nepooblaščenega dostopa, izgubo naprave, napačno enoto pri izdanem računu ali ponavljajočo se izgubo sinhronizacije.
Ne spreminjajte dokazov in ne obljubljajte roka za odpravo, ki ga ne morete potrditi.
Vodja skrbi za operativno odločitev; administrator za konfiguracijo; podpora za tehnično diagnozo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e92568d5ce6b package=lite -->
## 13. Kako brati kartice incidentov

Vsaka kartica spodaj je namenjena prvemu varnemu odzivu.
Ne nadomešča pooblastil, internega akta ali postopka ponudnika plačil.
Beseda »ustavite« pomeni: ne izvajajte iste potrditve še enkrat.
Beseda »preverite« pomeni: poiščite obstoječi zapis, ne sklepajte iz videza gumba.
Beseda »eskalirajte« pomeni: predajte primer vodji, administratorju ali podpori z dokazi.

Za vsak primer zapišite naslednje podatke:

- čas začetka in čas zadnjega poskusa;
- podjetje, enoto, blagajno in poslovni datum;
- uporabniško vlogo, ne pa gesla uporabnika;
- vrsto naprave, njen prikazani naziv in omrežni način;
- številko naročila, računa, rezervacije ali dokumenta;
- natančen znesek, kadar je pomemben;
- celotno vidno sporočilo in korake pred njim;
- že izvedene varne korake in njihov rezultat.

Ne vključujte PIN-a, številke kartice, gesla, žetona seje, zasebnega ključa ali datoteke potrdila.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f3a5369c3422 package=lite -->
## 14. Dostop, seja in poslovni kontekst

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-9a692ff56ce7 package=lite -->
### 14.1 Prijava se vrne na začetni zaslon

**Simptom.** Po prijavi se zaslon znova odpre za prijavo ali se seja takoj izteče.

**Verjetni pomen.** Povezava ni stabilna, ura naprave je napačna ali seja ni bila ustvarjena.

**Dokazi.** Zapišite čas, besedilo obvestila, vrsto povezave in ali se to zgodi tudi na drugi odobreni napravi.

**Varni koraki.**

1. Ustavite ponavljajoče prijave za trenutek.
2. Preverite, ali naprava kaže povezavo in pravilen čas.
3. Zaprite samo aplikacijo oziroma zavihek po lokalnem postopku.
4. Znova se prijavite s svojim računom.
5. Pred novim vnosom preverite, ali je bil prejšnji vnos že shranjen.

**Ustavite in eskalirajte.** Takoj ob ponavljanju na več uporabnikih ali ob opozorilu o blokiranem računu.

**Prepovedano.** Ne ugibajte gesel, ne uporabljajte računa sodelavca in ne brišite podatkov brskalnika brez odobritve.

**Za podporo.** Vloga, enota, čas, besedilo napake, vrsta naprave in ali je težava skupna.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ec2d9b8c1387 package=lite -->
### 14.2 Manjka gumb ali pogled

**Simptom.** Uporabnik vidi naročila, ne vidi pa plačila, zaloge, poročila ali nastavitve.

**Verjetni pomen.** Gre za vlogo, dodelitev enote, stanje izmene ali napačen delovni pogled.

**Dokazi.** Primerjajte prikazano podjetje, enoto, blagajno in profil z razporedom dela.

**Varni koraki.**

1. Ne iščite obvoda z drugim računom.
2. Osvežite pogled le po preverjanju, da ni odprtega nepotrjenega vnosa.
3. Preverite pravilno enoto in izmeno.
4. Vodji predajte zahtevo z opisom potrebnega opravila.
5. Administrator naj pravico spremeni po odobrenem postopku.

**Ustavite in eskalirajte.** Če je dostop nenadoma širši od pričakovanega ali če manjka pravica za fiskalno kritično opravilo med servisom.

**Prepovedano.** Ne delite prijave in ne spreminjajte lastne vloge.

**Za podporo.** Uporabniška vloga, pričakovani pogled, dejanski pogled, enota in čas.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a5664b148b9a package=lite -->
### 14.3 Napačna enota, blagajna ali poslovni datum

**Simptom.** Mize, računi, cene ali številčenje niso pričakovani.

**Verjetni pomen.** Naprava je v napačnem poslovnem kontekstu; to ni dokaz, da podatkov ni.

**Dokazi.** Posnetek glave zaslona brez osebnih podatkov, prikazan datum, enota, blagajna in izmena.

**Varni koraki.**

1. Ne dodajajte artiklov in ne začnite plačila.
2. Preverite kontekst v glavi aplikacije.
3. Poiščite naročilo v pravilni enoti po številki in času.
4. Obvestite vodjo, preden zamenjate delovni kontekst.
5. Po spremembi preverite, da je odprto pravo naročilo.

**Ustavite in eskalirajte.** Če je bil račun že izdan v napačni enoti ali blagajni.

**Prepovedano.** Ne ustvarjajte nadomestne mize, računa ali izmišljene izmene.

**Za podporo.** Stari in pričakovani kontekst, številka dokumenta ter čas.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-fd944eefbfca package=lite -->
### 14.4 Sum zlorabe ali izgubljena naprava

**Simptom.** Vidni so neznani vnosi, neznana prijava ali manjkajoča prijavljena naprava.

**Verjetni pomen.** Lahko gre za deljeno sejo, napačno dodelitev ali varnostni incident.

**Dokazi.** Čas, naprava, uporabnik, vidna dejanja in fotografija inventarne oznake, če jo politika dovoljuje.

**Varni koraki.**

1. Napravo zaklenite oziroma fizično zavarujte, če je na voljo.
2. Ne pregledujte ali spreminjajte sumljivih zapisov.
3. Takoj obvestite vodjo in skrbnika dostopa.
4. Uporabite drugo odobreno napravo samo po navodilu vodje.
5. Zapišite vse osebe, ki so imele dostop do območja.

**Ustavite in eskalirajte.** Vedno; ob sumu na plačilne ali osebne podatke brez odlašanja.

**Prepovedano.** Ne poskušajte sami »izslediti« uporabnika in ne pošiljajte posnetkov z občutljivimi podatki.

**Za podporo.** Minimalni časovni okvir, naprava, enota, vrsta suma in kontakt vodje.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-da209f1a4202 package=lite -->
## 15. Omrežje, realni čas in čakalna vrsta

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-70e2d0f6a45d package=lite -->
### 15.1 Sprememba ostane v čakanju

**Simptom.** Ikona sinhronizacije čaka, drug zaslon spremembe ne vidi ali se prikaz ne osveži.

**Verjetni pomen.** Vnos je lahko lokalno sprejet, oddan v čakalno vrsto ali neuspešen.

**Dokazi.** Čas potrditve, identifikator naročila, vidno stanje čakalne vrste in stanje povezave.

**Varni koraki.**

1. Ne pritiskajte potrditve drugič.
2. Ohranite napravo vključeno in povezano.
3. Preverite, ali se zapis pokaže v arhivu ali na izvorni napravi.
4. Po vrnitvi povezave počakajte na zaključen status.
5. Primerjajte količino, znesek in čas z enim zaupanja vrednim zapisom.

**Ustavite in eskalirajte.** Če čakanje raste, če so prizadeta plačila ali če se vrstica po povezavi spremeni v napako.

**Prepovedano.** Ne odstranjujte aplikacije, ne čistite predpomnilnika in ne izdelujte kopije dokumenta.

**Za podporo.** Število čakajočih dejanj, časi, vrsta dejanja in stanje omrežja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-d034c71511b3 package=lite -->
### 15.2 Dve napravi kažeta različno stanje

**Simptom.** Natakar vidi naročilo, KDS ali blagajna pa ga ne vidi oziroma vidi drugo stanje.

**Verjetni pomen.** Zamuda realnega časa, filter, druga enota ali nepopolna sinhronizacija.

**Dokazi.** Primerjajte isto številko naročila, isto enoto, čas osvežitve in filter na obeh napravah.

**Varni koraki.**

1. Določite eno osebo za preverjanje zapisa.
2. Ne dodajajte enake postavke kot nadomestilo.
3. Preverite filter, postajo priprave in poslovni kontekst.
4. Kuhinji sporočite dejansko potrjeno stanje naročila.
5. Označite primer za predajo, če razlika ostane.

**Ustavite in eskalirajte.** Če razlika vpliva na plačilo, alergene, pripravo ali več naročil.

**Prepovedano.** Ne potrjujte BUMP-a za naročilo, ki ga niste preverili.

**Za podporo.** Obe napravi, zaslona, filtra, čas osvežitve in številka naročila.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1cfd461ce2d6 package=lite -->
### 15.3 Aplikacija se vrti ali prikaže prazno stran

**Simptom.** Gumb ostane onemogočen, vrtilnik ne izgine ali seznam nenadoma nima vrstic.

**Verjetni pomen.** Rezultat zadnje zahteve ni znan; prazen seznam je lahko filter ali nedosegljiva storitev.

**Dokazi.** Zadnje dejanje, čas klika, naslov pogleda in ali se je prikaz spremenil po tem.

**Varni koraki.**

1. Ne klikajte istega gumba znova.
2. Počakajte razumen lokalno določen čas.
3. Preverite arhiv oziroma iskanje po ključu dejanja.
4. Če ni odprtega osnutka, znova odprite pogled.
5. Če dejanje ostane nejasno, predajte primer.

**Ustavite in eskalirajte.** Če je zadnje dejanje plačilo, izdaja računa, potrditev prejemnice ali sprememba zaloge.

**Prepovedano.** Ne osvežujte na slepo med plačilom in ne zapirajte naprave, dokler ni zabeležen čas.

**Za podporo.** URL ni potreben; zadostujejo modul, dejanje, čas, identifikator in sporočilo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-259ffb6867d9 package=extended -->
## 16. Naročila, mize in rezervacije

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-43418f688575 package=lite -->
### 16.1 Naročilo se po oddaji ne prikaže

**Simptom.** Natakar je oddal naročilo, priprava ga ne prejme.

**Verjetni pomen.** Naročilo je lahko v osnutku, na HOLD, na drugi postaji ali v čakalni vrsti.

**Dokazi.** Številka naročila, stanje postavke, čas oddaje, izbrani hod in ciljna postaja.

**Varni koraki.**

1. Odprite obstoječe naročilo.
2. Preverite status vsake postavke.
3. Preverite HOLD/FIRE in usmerjanje.
4. Kuhinji ustno sporočite samo potrjene postavke.
5. Ponovno oddajte le postavko, za katero zapis dokazuje, da ni bila oddana.

**Ustavite in eskalirajte.** Če sta status POS in KDS neusklajena ali če gre za alergensko kritično naročilo.

**Prepovedano.** Ne ustvarjajte novega naročila z vsemi istimi artikli.

**Za podporo.** Naročilo, postavke, postaja, časi in prikaz statusa.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bfb68715d079 package=standard -->
### 16.2 Miza je nepričakovano zasedena

**Simptom.** Sistem ne dovoli odpreti mize ali pokaže neznano odprto naročilo.

**Verjetni pomen.** Miza je vezana na drugo naročilo, rezervacijo ali fizično prejšnjo skupino.

**Dokazi.** Številka odprtega naročila, stanje plačila, rezervacija, ime odgovornega natakarja in čas.

**Varni koraki.**

1. Ne premikajte naročila brez preverjanja.
2. Povprašajte ekipo, ali je skupina še prisotna.
3. Preverite rezervacijo in odprta naročila.
4. Vodja odobri spremembo mize ali rezervacije.
5. Po spremembi potrdite, da se je premaknila prava skupina.

**Ustavite in eskalirajte.** Če je na mizi nejasno plačilo ali izdan račun.

**Prepovedano.** Ne uporabljajte sosednje fizične mize kot prikrite zamenjave brez zapisa.

**Za podporo.** Oznaka mize, naročilo, rezervacija, čas in uporabnik.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e9cdf207cd8e package=extended -->
### 16.3 Rezervacija ima napačen čas ali gosta

**Simptom.** Gost ni pričakovan, rezervacija blokira mizo ali podatki ne ustrezajo pogovoru.

**Verjetni pomen.** Napaka vnosa, podvojitev ali sprememba še ni potrjena.

**Dokazi.** Identifikator rezervacije, dogovorjeni čas, število oseb in vir potrditve.

**Varni koraki.**

1. Ne brišite rezervacije.
2. Preverite zgodovino komunikacije po internem postopku.
3. Pokličite gosta le po odobrenem kontaktnem podatku.
4. Vodja odobri sprostitev ali spremembo.
5. Zapišite razlog spremembe.

**Ustavite in eskalirajte.** Če sprememba posega v drugo aktivno skupino ali osebne podatke.

**Prepovedano.** Ne prepisujte imena gosta z imenom naslednjega gosta.

**Za podporo.** Čas, identifikator, stanje mize in neobčutljiv opis neskladja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0d2ed239ecf5 package=standard -->
## 17. KDS, priprava in izdaja

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-53113515a130 package=standard -->
### 17.1 KDS kaže podvojeno postavko

**Simptom.** Kuhinja vidi dve enaki postavki ali dve kartici istega naročila.

**Verjetni pomen.** Lahko gre za dejansko količino dve, podvojeno oddajo ali dva pogleda iste postaje.

**Dokazi.** Primerjajte količino v POS-u, čas oddaje, številko naročila in identifikator postavke.

**Varni koraki.**

1. Ne pripravite samodejno dveh porcij.
2. Kuhar zadrži drugo pripravo.
3. Natakar preveri naročilo pri gostu in v POS-u.
4. Pripravite dodatno porcijo le ob potrjeni količini dve.
5. Napačno oddajo uredi po odobrenem postopku in obvesti pripravo.

**Ustavite in eskalirajte.** Če je ena postavka že izdana ali je sprememba po računu.

**Prepovedano.** Ne brišite KDS kartice, da bi izginila težava.

**Za podporo.** Naročilo, postavka, količina, časi in postaja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-23d3d1d7a2b4 package=standard -->
### 17.2 Napačna opomba ali alergen na KDS

**Simptom.** Priprava prejme drugo opombo, manjka modifikator ali je alergen nejasen.

**Verjetni pomen.** Podatek je morda izbran napačno, ni bil oddan ali ni pravilno usmerjen.

**Dokazi.** Primerjajte naročilo v POS-u, prikaz KDS in dejansko verbalno potrditev gosta.

**Varni koraki.**

1. Ustavite pripravo sporne jedi.
2. Natakar preveri naročilo in gosta, kadar je mogoče.
3. Ne ugibajte o alergenu.
4. Uporabite odobren postopek za popravek naročila.
5. Kuhinji sporočite potrjeno novo stanje neposredno.

**Ustavite in eskalirajte.** Vedno, kadar alergenski podatek manjka, je protisloven ali bi lahko vplival na varnost gosta.

**Prepovedano.** Ne odstranjujte alergenske opombe zaradi hitrejše priprave.

**Za podporo.** Naročilo, artikel, prikaza POS/KDS, čas in brez zdravstvenih podrobnosti gosta.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1ce50f673c17 package=standard -->
### 17.3 BUMP je bil pritisnjen prezgodaj

**Simptom.** Kartica izgine, jed pa ni pripravljena ali izdana.

**Verjetni pomen.** Stanje na KDS ne predstavlja več dejanske stopnje priprave.

**Dokazi.** Naročilo, postaja, čas BUMP-a, dejansko stanje jedi in oseba, ki je delala na postaji.

**Varni koraki.**

1. Takoj obvestite natakarja.
2. Ne označujte nove kartice kot nadomestilo brez preverjanja.
3. Zabeležite dejansko stanje.
4. Vodja določi, ali je potreben ponoven nalog po odobrenem postopku.
5. Gostu podajte preverjeno informacijo o čakanju.

**Ustavite in eskalirajte.** Če se to ponavlja, če je jed izdana napačni mizi ali če je alergen sporen.

**Prepovedano.** Ne spreminjajte časa priprave za prikrivanje zamude.

**Za podporo.** Postaja, naročilo, čas, stanje in morebitna napaka zaslona.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-7ed4674c337d package=lite -->
## 18. Plačilni terminali in neznana stanja

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8a132fe29b75 package=lite -->
### 18.1 Terminal odobri, POS pa javi napako

**Simptom.** Terminal izpiše odobritev, POS plačila ne pokaže.

**Verjetni pomen.** Kartica je lahko bremenjena; integracijski odgovor ni nujno dosegel POS-a.

**Dokazi.** Terminalska referenca, čas, znesek, identifikator terminala in stanje naročila.

**Varni koraki.**

1. Ne začnite druge kartične transakcije.
2. Ne zahtevajte druge kartice.
3. Shranite potrdilo po internem postopku.
4. Preverite plačilo v POS arhivu in na terminalu.
5. Predajte nejasen primer blagajniku ali vodji.

**Ustavite in eskalirajte.** Dokler se stanje ne razreši; takoj, če gost navaja bremenitev.

**Prepovedano.** Ne označite plačila kot gotovino brez dejanskega prejema gotovine.

**Za podporo.** Znesek, čas, terminal, referenca in naročilo; nikoli polni podatki kartice.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-df057760403e package=lite -->
### 18.2 Terminal zavrne, POS pa kaže plačano

**Simptom.** Potrdilo terminala navaja zavrnitev, naročilo pa je zaključeno.

**Verjetni pomen.** Stanja sta v konfliktu in zahtevata preverjanje pri pooblaščenem blagajniku.

**Dokazi.** Oba prikaza, čas, znesek, terminalska referenca in račun.

**Varni koraki.**

1. Ne izvajajte nove transakcije.
2. Ne vračajte denarja na pamet.
3. Zadržite naročilo za preverjanje po lokalnem postopku.
4. Blagajnik preveri arhiv plačil in terminalski dnevnik.
5. Vodja odobri naslednje dejanje do gosta.

**Ustavite in eskalirajte.** Vedno pred zapiranjem računa ali koncem izmene.

**Prepovedano.** Ne stornoirajte računa samo zato, da bi poravnali prikaz.

**Za podporo.** Račun, znesek, čas, terminal in referenca.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bdcf410086f9 package=lite -->
### 18.3 Terminal je nedosegljiv

**Simptom.** POS terminala ne najde, terminal nima signala ali se povezava prekine pred začetkom.

**Verjetni pomen.** Lokalna povezava, napajanje, ponudnik ali napačna dodelitev terminala.

**Dokazi.** Ali se je transakcija sploh začela, stanje terminala, napajanje in enota.

**Varni koraki.**

1. Preden izberete drugo plačilno pot, preverite, da transakcija ni začeta.
2. Preverite napajanje in lokalno povezavo brez posega v nastavitve.
3. Uporabite drugo odobreno plačilno možnost le po jasnem rezultatu.
4. O težavi obvestite vodjo.
5. Zabeležite prizadete račune.

**Ustavite in eskalirajte.** Če terminal kaže obdelavo, tudi brez odziva POS-a.

**Prepovedano.** Ne izklapljajte terminala med transakcijo in ne menjajte ponudniških nastavitev.

**Za podporo.** Terminal, enota, čas, ali je bilo plačilo začeto in vidno sporočilo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-39bd95c2d324 package=lite -->
## 19. FURS, potrdilo in delo ob motnji

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-dfee66ab92cb package=lite -->
### 19.1 Manjka EOR ali fiskalni status

**Simptom.** Račun nima pričakovanega statusa oziroma EOR ali pokaže fiskalno opozorilo.

**Verjetni pomen.** Račun lahko obstaja, potrjevanje pa je v čakanju, zavrnjeno ali zahteva postopek motnje.

**Dokazi.** Številka računa, čas izdaje, ZOI/EOR kadar sta prikazana, celotno sporočilo in poslovni datum.

**Varni koraki.**

1. Ne izdajajte istega računa znova.
2. Preverite arhiv in status dokumenta.
3. Sledite odobrenemu postopku motnje iz poglavja 06.
4. Zapišite razpon prizadetih računov.
5. Administratorju predajte napako brez potrdila ali gesla.

**Ustavite in eskalirajte.** Ob ponavljajoči zavrnitvi, napačni identiteti blagajne ali nejasnem računu.

**Prepovedano.** Ne spreminjajte številčenja, datuma ali certifikata med servisom.

**Za podporo.** Račun, čas, enota, blagajna, besedilo in neobčutljiv status.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-525a804fae3a package=lite -->
### 19.2 Potrdilo je poteklo ali ni dostopno

**Simptom.** Sistem javlja napako potrdila, preverjanje identitete ali zavrnjeno povezavo.

**Verjetni pomen.** Potrdilo je lahko poteklo, napačno dodeljeno ali njegova storitev ni dosegljiva.

**Dokazi.** Besedilo napake, čas, enota, blagajna in datum poteka, če je prikazan.

**Varni koraki.**

1. Ne nalagajte druge datoteke potrdila sami.
2. Ne kopirajte potrdila na drugo napravo.
3. Uporabite potrjeni postopek dela ob motnji.
4. Obvestite administratorja, odgovornega za potrdila.
5. Zabeležite račune, ki potrebujejo poznejšo kontrolo.

**Ustavite in eskalirajte.** Vedno; posebej pred iztekom ali ob sumu kompromitacije.

**Prepovedano.** Ne pošiljajte datoteke, ključa ali gesla po e-pošti, klepetu ali posnetku zaslona.

**Za podporo.** Samo status, čas, enota in prikazano sporočilo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-65c80e0d39d3 package=lite -->
### 19.3 Delo brez internetne povezave

**Simptom.** Povezava do zunanje storitve ni dosegljiva, lokalni POS pa še deluje.

**Verjetni pomen.** Možne so omejitve glede izdaje, potrjevanja in poznejše sinhronizacije.

**Dokazi.** Čas začetka motnje, obseg prizadetih naprav in status računov.

**Varni koraki.**

1. Vodja potrdi začetek postopka motnje.
2. Uporabljajte samo dovoljeni način dela.
3. Dokumente izdajajte enkrat in ohranite sled.
4. Po povezavi preverite vsak prizadeti dokument v arhivu.
5. Zaključite incident šele po uskladitvi.

**Ustavite in eskalirajte.** Če lokalno stanje ni jasno, če številčenje odstopa ali če postopek motnje ni odobren.

**Prepovedano.** Ne uporabljajte zasebnih dostopnih točk ali neuradnih aplikacij za prenos podatkov.

**Za podporo.** Časovni razpon, enote, število dokumentov in stanje uskladitve.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-80f0fe4807aa package=lite -->
## 20. Tisk, tiskalni most in usmerjanje

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-72d118657d54 package=lite -->
### 20.1 Račun obstaja, tisk pa manjka

**Simptom.** Račun je v arhivu, fizičnega izpisa ni.

**Verjetni pomen.** Fiskalni ali poslovni dokument ni zato neveljaven; lahko je težava papir, naprava, most ali čakalna vrsta.

**Dokazi.** Številka računa, ciljni tiskalnik, čas, stanje papirja in morebitna čakalna vrsta.

**Varni koraki.**

1. Ne izdajte novega računa.
2. Preverite papir, pokrov, napajanje in povezavo.
3. Preverite, ali je izbran pravi tiskalnik.
4. Uporabite ponatis le za obstoječi račun.
5. Gostu pojasnite, da preverjate izpis, ne da izdajate novega dokumenta.

**Ustavite in eskalirajte.** Če je tisk več računov zapored neuspešen ali če je izpis napačnega računa.

**Prepovedano.** Ne spreminjajte števca računov in ne tiskajte testnega računa kot prodaje.

**Za podporo.** Račun, ciljni tiskalnik, čas, stanje mostu in opis izpisa.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0d537a48a2ea package=standard -->
### 20.2 Kuhinjski listek gre na napačno postajo

**Simptom.** Bar prejme kuhinjsko postavko, kuhinja ne prejme ničesar ali se listek natisne dvakrat.

**Verjetni pomen.** Usmerjanje artikla, postaje ali mostu je napačno oziroma podvojeno.

**Dokazi.** Artikel, kategorija, naročilo, pričakovana postaja, dejanska postaja in čas.

**Varni koraki.**

1. Priprava preveri naročilo pred pripravo.
2. Natakar ne odda celotnega naročila ponovno.
3. Vodja poskrbi za varno ročno komunikacijo za posamezno naročilo.
4. Administrator preveri usmerjanje izven vrhunca, kadar je mogoče.
5. Po popravku preizkusite s testnim postopkom, ne s pravim naročilom.

**Ustavite in eskalirajte.** Če napačno usmerjanje vpliva na alergene ali več naročil.

**Prepovedano.** Ne spreminjajte kategorij artiklov med aktivno pripravo brez odobritve.

**Za podporo.** Artikel, naročilo, obe postaji, most in čas.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-37823913e19b package=extended -->
## 21. QR, CTI, telefon in dostava

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-12ea461d61cc package=extended -->
### 21.1 QR naročilo se ne pojavi

**Simptom.** Gost odda QR naročilo, osebje ga ne vidi.

**Verjetni pomen.** Naročilo je lahko nedokončano, v drugem statusu, vezano na drugo mizo ali čaka na sinhronizacijo.

**Dokazi.** Čas gosta, identifikator mize/QR, znesek če je potrjen in status na gostovem zaslonu brez osebnih podatkov.

**Varni koraki.**

1. Ne zahtevajte, da gost takoj naroči znova.
2. Preverite naročila po času, mizi in statusu.
3. Preverite pravilno enoto in QR identiteto.
4. Gostu povejte, da preverjate obstoječe naročilo.
5. Novo naročilo ustvarite šele po dokazani odsotnosti prvega.

**Ustavite in eskalirajte.** Če je povezano s spletnim plačilom ali če se pojavi več enakih naročil.

**Prepovedano.** Ne uporabljajte gostovih plačilnih podatkov za iskanje.

**Za podporo.** Čas, QR/miza, status, naročilo in opis brez podatkov gosta.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-4c185bc37e12 package=lite -->
### 21.2 CTI ne prikaže klicatelja

**Simptom.** Ob dohodnem klicu se profil ne odpre ali se odpre napačen profil.

**Verjetni pomen.** Povezava telefona, format številke ali podvojeni kontakt je neustrezen.

**Dokazi.** Čas klica, številka v maskirani obliki, prikazani profil in rezultat ročnega iskanja.

**Varni koraki.**

1. Ne potrjujte identitete samo po prikazu CTI.
2. Gostu preverjeno ponovite ime, naslov in naročilo po internem postopku.
3. Poiščite profil ročno z dovoljenimi podatki.
4. Podvojitev označite za kasnejše čiščenje.
5. Naročilo zabeležite le v potrjeni profil.

**Ustavite in eskalirajte.** Če se prikazujejo tuji osebni podatki ali če je napačen profil že prejel naročilo.

**Prepovedano.** Ne združujte profilov na pamet in ne narekujte celih kontaktnih podatkov na odprtem prostoru.

**Za podporo.** Čas, ponudnik/linija, maskirana številka in opis nepravilnega ujemanja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bc2555914484 package=extended -->
### 21.3 Dostava ima nejasen naslov ali status

**Simptom.** Voznik, kuhinja in POS imajo različen status; naslov ni popoln ali je naročilo podvojeno.

**Verjetni pomen.** Gre za komunikacijsko napako, dvojni kontakt ali nedokončano posodobitev.

**Dokazi.** Naročilo, čas, potrjeni naslov po politiki, način plačila in status predaje.

**Varni koraki.**

1. Ne pošiljajte druge dostave brez preverjanja.
2. Pokličite kontakt po odobrenem postopku.
3. Preverite, katero naročilo je povezano z voznikom.
4. Vodja potrdi spremembo naslova ali preklic.
5. Zabeležite dejanski čas predaje.

**Ustavite in eskalirajte.** Ob nejasnem plačilu, sporu gosta ali razkritju napačnega naslova.

**Prepovedano.** Ne prepisujte naslova iz druge stranke in ne delite kontakta voznika izven postopka.

**Za podporo.** Naročilo, čas, status in maskiran opis problema.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2d4400f0a38b package=lite -->
## 22. Meni, recepture in alergeni

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-7b9af29c6dff package=lite -->
### 22.1 Artikel ni viden ali ima napačno ceno

**Simptom.** Artikel manjka v prodaji, je v napačni kategoriji ali pokaže nepričakovano ceno.

**Verjetni pomen.** Artikel je neaktiven, ni dodeljen enoti, sprememba še ni objavljena ali je kontekst napačen.

**Dokazi.** Naziv artikla, enota, kategorija, pričakovana cena, prikazana cena in čas spremembe.

**Varni koraki.**

1. Ne ustvarjajte nadomestnega artikla med servisom.
2. Ne zaračunajte drugega artikla kot prikrite zamenjave.
3. Vodja potrdi začasno prodajno odločitev.
4. Administrator preveri objavo in dodelitev.
5. Po popravku preverite prodajni pogled v pravi enoti.

**Ustavite in eskalirajte.** Če je bila napačna cena že zaračunana ali če vpliva na alergene.

**Prepovedano.** Ne urejajte cen in davčnih nastavitev brez pooblastila.

**Za podporo.** Artikel, enota, pričakovano/dejansko, čas in uporabniška vloga.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2670fe081ba2 package=lite -->
### 22.2 Receptura ali zaloga artikla ni logična

**Simptom.** Poraba je previsoka, sestavina manjka ali se zaloga ob prodaji ne spremeni pričakovano.

**Verjetni pomen.** Receptura, enota mere, pakiranje ali povezava artikla je lahko napačna.

**Dokazi.** Artikel, receptura, količina prodaje, pričakovana in dejanska sprememba zaloge.

**Varni koraki.**

1. Ne popravljajte zgodovine prodaje.
2. Preverite fizično stanje in enoto mere.
3. Označite razliko za odgovorno osebo.
4. Spremembo recepture naredite šele po potrditvi.
5. Po spremembi opravite kontrolno prodajo v dogovorjenem okolju.

**Ustavite in eskalirajte.** Če gre za množično napačno porabo, negativne zaloge ali alergen.

**Prepovedano.** Ne nastavljajte količine na nič samo za lep prikaz.

**Za podporo.** Artikel, enota mere, obdobje, sprememba in primer dokumenta.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-eba1fc395cf2 package=lite -->
### 22.3 Alergenski podatek manjka ali se ne ujema

**Simptom.** Prodajni pogled, predogled ali KDS ne kaže pričakovanega alergena.

**Verjetni pomen.** Vir podatka, dedovanje iz recepture ali ročna potrditev ni popolna.

**Dokazi.** Artikel, receptura, vidni alergeni v vseh pogledih in datum zadnje spremembe.

**Varni koraki.**

1. Ne zagotavljajte gostu, da je jed varna brez potrditve.
2. Ustavite prodajo sporne artikla, če politika to zahteva.
3. Preverite podatke pri odgovorni osebi za ponudbo.
4. Jasno označite začasno omejitev ekipi.
5. Po odobrenem popravku preverite prodajni in pripravljalni prikaz.

**Ustavite in eskalirajte.** Vedno pri nejasnosti, ki bi lahko vplivala na zdravje gosta.

**Prepovedano.** Ne ugibajte in ne odstranjujte opozorila zaradi hitrejšega naročanja.

**Za podporo.** Artikel, enota, prikazi in čas; ne zdravstvenih podatkov gosta.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-32084f88cbaf package=extended -->
## 23. Zaloga, OCR, uvoz in dogodki

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1fb7a339db4f package=extended -->
### 23.1 OCR napačno prebere glavo dokumenta

**Simptom.** Dobavitelj, številka, datum, valuta ali DDV niso pravilni.

**Verjetni pomen.** OCR je predlog in je napačno razbral sliko ali predlogo dokumenta.

**Dokazi.** Izvirnik, predlog OCR, številka dokumenta, dobavitelj in datum.

**Varni koraki.**

1. Ne potrjujte dokumenta.
2. Primerjajte vsak podatek z izvirnikom.
3. Popravite samo razločno preverjen podatek.
4. Preverite duplikat po dobavitelju, številki in datumu.
5. Shranite osnutek, če podatek ni preverljiv.

**Ustavite in eskalirajte.** Če izvirnik ni čitljiv, če gre za že potrjen dokument ali če seštevek ne ustreza.

**Prepovedano.** Ne domnevajte DDV, valute ali datuma po prejšnji prejemnici.

**Za podporo.** Maskiran primer, tip datoteke, čas uvoza in polja z neskladjem.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-3bea6fac2f7b package=extended -->
### 23.2 OCR napačno prebere postavko ali pakiranje

**Simptom.** Artikel, EAN, količina, enota mere, nabavna cena ali popust ne ustrezajo dobavi.

**Verjetni pomen.** Prepoznava ni poslovno ujemanje; lahko je zamenjala stolpec, enoto ali artikel.

**Dokazi.** Vrstica izvirnika, predlagana povezava, pakiranje, količina, cena in seštevek.

**Varni koraki.**

1. Ne potrjujte ujemanja brez fizičnega pregleda.
2. Preverite osnovno enoto in količino pakiranja.
3. Ne ustvarjajte novega artikla, če obstaja možen obstoječi.
4. Nezdružljivo vrstico pustite nepovezano za odgovorno osebo.
5. Po potrditvi preverite učinek na zalogo in vrednost.

**Ustavite in eskalirajte.** Če bi uvoz ustvaril veliko zalogovno ali vrednostno razliko.

**Prepovedano.** Ne kopirajte cene iz drugega dobavitelja brez potrditve.

**Za podporo.** Dokument, vrstica, predlog, pričakovano ujemanje in enota mere.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-3873f710f1b4 package=extended -->
### 23.3 Uvoz se zdi podvojen

**Simptom.** Ista dobavnica ali prejemnica se pojavi dvakrat oziroma zaloga naraste dvakrat.

**Verjetni pomen.** Drugi poskus je lahko ustvaril osnutek, čakalno dejanje ali dejanski duplikat.

**Dokazi.** Dobavitelj, številka dokumenta, datum, znesek, čas obeh zapisov in stanja.

**Varni koraki.**

1. Ne potrjujte nobenega dodatnega osnutka.
2. Ne brišite zapisov, dokler ne določite pravega.
3. Preverite zgodovino dokumentov in učinek na zalogo.
4. Odgovorna oseba odobri storniranje oziroma popravek po postopku.
5. Zapišite, kateri zapis je izviren.

**Ustavite in eskalirajte.** Če je katerikoli dokument že potrjen ali prenesen naprej.

**Prepovedano.** Ne »izravnavajte« z negativno prejemnico brez odobritve.

**Za podporo.** Oba identifikatorja, časi, stanja in učinki na zalogo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-92fa6aba87b1 package=extended -->
### 23.4 Dogodek ali pripravljena hrana ni usklajena

**Simptom.** Plan, pripravljena količina, poraba ali dejansko stanje za dogodek ne ustrezajo.

**Verjetni pomen.** Sprememba obsega, časovne točke ali dokumentiranja porabe ni zaključena.

**Dokazi.** Dogodek, datum, plan, dejanska količina, dokumenti porabe in odgovorna oseba.

**Varni koraki.**

1. Ločite fizično štetje od sistemskega popravka.
2. Ne zapirajte dogodka, dokler razlika ni pojasnjena.
3. Zabeležite odpad, vrnitev in neprodano količino po postopku.
4. Vodja potrdi odstopanje.
5. Skladiščnik preveri naslednjo zalogovno potezo.

**Ustavite in eskalirajte.** Če je razlika pomembna, ponavljajoča ali vpliva na računovodski prenos.

**Prepovedano.** Ne pripisujte razlike »dogodku« brez dokumentiranega razloga.

**Za podporo.** Dogodek, obdobje, artikli, količine in stanja dokumentov.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2a1e7b545899 package=lite -->
## 24. Poročila in POS→ERP

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-cd22205fc1c8 package=lite -->
### 24.1 Poročilo se ne ujema s pričakovanjem

**Simptom.** Promet, DDV, plačila ali količine so drugačni od ročne ocene.

**Verjetni pomen.** Pogosto gre za datum, enoto, filter, status dokumenta ali čas zaključka izmene.

**Dokazi.** Ime poročila, obdobje, filtri, enota, čas izdelave in primerjava z virom.

**Varni koraki.**

1. Ne popravljajte prodaje, da bi poročilo ustrezalo.
2. Preverite poslovni datum in časovni interval.
3. Preverite vključene enote, blagajne in statuse.
4. Primerjajte z arhivom dokumentov, ne samo z gotovino.
5. Razliko predajte vodji z izračunom.

**Ustavite in eskalirajte.** Če gre za zaključen obračun, davčni podatek ali nerazložljivo razliko.

**Prepovedano.** Ne izvažajte občutljivih poročil na zasebne naprave.

**Za podporo.** Poročilo, filtri, obdobje, pričakovano/dejansko in vzorčni dokumenti.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-acbc7f08f8e8 package=lite -->
### 24.2 POS→ERP prenos manjka ali je podvojen

**Simptom.** Temeljnica, račun ali zalogovni dokument ni v ERP oziroma se pojavi večkrat.

**Verjetni pomen.** Prenos čaka, je zavrnjen, je filtriran ali je bil ponovno zagnan.

**Dokazi.** Obdobje, enota, identifikator prenosa, status, število dokumentov in ERP referenca.

**Varni koraki.**

1. Ne zaganjajte prenosa ponovno na slepo.
2. Preverite, ali je paket že uspešno obdelan.
3. Preverite napako in manjkajoči poslovni podatek.
4. Računovodstvo in administrator uskladita izvirni sistem.
5. Ponovitev izvede pooblaščena oseba z zabeleženim razlogom.

**Ustavite in eskalirajte.** Ob podvojenih knjižbah, zaklenjenem obdobju ali nejasni davčni posledici.

**Prepovedano.** Ne brišite ERP knjižb kot tehnični popravek brez računovodske odobritve.

**Za podporo.** Paket, obdobje, status, ERP referenca, napaka in brez poverilnic.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-bd6ab7f7bbc5 package=lite -->
## 25. Vaje za incidente

Vaje se izvajajo na odobrenem učnem okolju ali z vnaprej določenim nenevarnim scenarijem.
Ne izvajajte vaje z dejanskim plačilom, dejanskim potrdilom ali brisanjem podatkov.
Vodja določi opazovalca, časovno omejitev in merilo uspeha.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-86f93c771cf9 package=lite -->
### 25.1 Vaja: neznano kartično plačilo

**Scenarij.** Terminal pokaže odobritev, POS pa ostane v čakanju.

**Naloga osebja.**

1. Ustavi drugi poskus.
2. Zapiše znesek, čas, terminal in referenco.
3. Preveri naročilo in arhiv.
4. Jasno pove gostu, da se stanje preverja.
5. Preda primer po poti eskalacije.

**Uspeh.** Nihče ne začne druge transakcije in predaja ne vsebuje podatkov kartice.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-5921269eccaa package=lite -->
### 25.2 Vaja: izguba povezave med servisom

**Scenarij.** Dve napravi kažeta različno stanje naročila.

**Naloga osebja.**

1. Določi en zaupanja vreden vir preverjanja.
2. Ne ustvarja nadomestnega naročila.
3. Kuhinji poda le potrjeno navodilo.
4. Označi čase in prizadeta naročila.
5. Po vrnitvi povezave uskladi stanja.

**Uspeh.** Ni dvojne priprave in vsako odstopanje ima lastnika.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1fb8f6946971 package=lite -->
### 25.3 Vaja: fiskalno opozorilo

**Scenarij.** Račun pokaže manjkajoč fiskalni status.

**Naloga osebja.**

1. Ne izdaja drugega računa.
2. Poišče obstoječi račun.
3. Uporabi odobren postopek motnje.
4. Ne deli potrdila ali gesla.
5. Vodi seznam prizadetih dokumentov.

**Uspeh.** Računi niso podvojeni, seznam je popoln in skrivnosti niso razkrite.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c54d260c59b7 package=lite -->
### 25.4 Vaja: napačno OCR ujemanje

**Scenarij.** OCR predlaga napačno pakiranje in trikrat višjo količino.

**Naloga osebja.**

1. Primerja izvirnik in vrstico.
2. Preveri enoto mere in pakiranje.
3. Pusti nejasno vrstico nepotrjeno.
4. Označi primer za skladiščnika.
5. Po potrditvi preveri zalogovni učinek.

**Uspeh.** Ne pride do potrditve na podlagi samega OCR predloga.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-7bac9d4db8cc package=lite -->
## 26. Pregled po incidentu

Pregled opravite po stabilizaciji, ne sredi odpravljanja posledic.
Namen ni iskanje krivca, temveč obnovitev pravilnega stanja in preprečitev ponovitve.

Zapis pregleda vsebuje:

1. kratek naslov in klasifikacijo incidenta;
2. začetek, zaznavo, stabilizacijo in zaključek;
3. prizadete enote, naprave in poslovne dokumente;
4. dejstva, ki so potrjena, in odprte neznanke;
5. odločitev glede gostov, plačil, računov in priprave;
6. uporabljene varne korake in odstopanja od postopka;
7. uskladitev zaloge, poročil in prenosa, kadar velja;
8. lastnika korektivnega ukrepa in rok;
9. potrebo po usposabljanju ali spremembi navodila;
10. potrditev vodje, da so dokazi shranjeni po politiki.

Ne vključujte nepotrebnih osebnih ali plačilnih podatkov.
Posnetke zaslona omejite na nujni del in jih hranite po pravilih podjetja.
Če vzrok ni potrjen, ga označite kot domnevo in ne kot dejstvo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-57a85adf2682 package=lite -->
## 27. Operativna pravila pred posegom

Vsak poseg ima lastnika, čas začetka in določeno mejo, kdaj se ustavi.
Prvi dokaz je zapis sistema, ne spomin gosta ali sodelavca.
Drugi dokaz je neodvisen vir: terminal, tisk, KDS, arhiv ali ponudnik.
Tretji dokaz je časovno ujemanje med obema viroma.
Posnetek zaslona je dokaz prikaza, ne dokaz uspešno zaključene transakcije.
Ura naprave je lahko napačna; pri razhajanju uporabite čas strežniškega zapisa.
Ne spreminjajte dveh spremenljivk hkrati, na primer omrežja in nastavitev tiskalnika.
Ne delajte popravka, dokler niste prepoznali poslovnega dokumenta, ki ga popravljate.
Če je gost pred vami, ločite skrb za gosta od potrjevanja dejstva v sistemu.
Gostu povejte rok naslednje posodobitve, ne domnevnega izida.
Za denar, davčni dokument in alergen velja strožji stop: ne ugibajte.
Za pripravo hrane velja stop, ko bi napačno navodilo povzročilo ponovno pripravo.
Za osebne podatke velja najmanjši potreben obseg zbiranja dokazov.
Podpora potrebuje identifikatorje; ne potrebuje gesla, PIN-a ali številke kartice.
Ponovni klik ni postopek obnove.
Osvežitev zaslona ni dokaz, da strežnik ni prejel zahteve.
Odjava ni rešitev za neznano plačilo ali odprto naročilo.
Brisanje lokalnih podatkov se ne uporablja kot prva pomoč.
Nadomestni račun, naročilo ali prejemnica nastane samo po dokazani odsotnosti izvirnika.
Vodja potrdi vsak ročni obvod, ki vpliva na denar, zalogo ali pripravo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ee35c4b62b42 package=lite -->
### 27.1 Minimalni paket eskalacije

Zapišite enoto, blagajno, napravo in prijavljenega uporabnika.
Zapišite poslovni datum ter čas začetka in zadnjega varnega stanja.
Zapišite ID naročila, računa, rezervacije ali uvoza, če je viden.
Zapišite znesek in valuto brez podatkov o plačilnem sredstvu gosta.
Zapišite točno besedilo napake in korak, na katerem se je pojavila.
Dodajte, ali se težava ponovi na drugi napravi iste enote.
Dodajte, ali vpliva na en primer ali na vse uporabnike.
Dodajte varne korake, ki so bili že izvedeni, in njihov rezultat.
Dodajte povezavo ali identifikator terminalskega potrdila brez občutljivih številk.
Dodajte številko računa in fiskalni status, kadar gre za izdajo računa.
Dodajte fotografijo izvirne prejemnice samo skozi odobren kanal.
Ne pošiljajte celotne baze, izvoza strank ali zasebnega ključa.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-024c8aa3c1c8 package=lite -->
## 28. Triage matrika: nujnost in meja ukrepanja

| Razred | Primer | Takoj ustavi | Dovoljen prvi korak | Lastnik |
|---|---|---|---|---|
| P1 | neznano kartično breme | novo plačilo | preverjanje reference | vodja in plačilna podpora |
| P1 | napačen ali manjkajoč alergen | izdajo/pripravo artikla | umik artikla iz prodaje | vodja izmene |
| P1 | širša fiskalna nedosegljivost | podvajanje računov | odobren offline postopek | blagajnik in administrator |
| P1 | sum zlorabe seje | uporabo računa | odjava in prijava incidenta | skrbnik dostopa |
| P2 | KDS ne prejme novega naročila | ponovno oddajo | preverjanje ID-ja naročila | vodja kuhinje |
| P2 | tisk računa manjka | novo izdajo računa | iskanje in ponatis | blagajnik |
| P2 | QR naročilo ni vidno | ročni dvojnik | preverjanje statusa QR naročila | vodja servisa |
| P2 | OCR spremeni količino | potrditev prejemnice | primerjava z izvirnikom | skladiščnik |
| P3 | manjka pogled ali gumb | spremembo pravic | preverjanje vloge/konteksta | administrator |
| P3 | poročilo odstopa | ročni popravek poročila | preverjanje filtrov | računovodstvo |

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f745bde8abc9 package=lite -->
### 28.1 Odločitev »rezultat ni znan«

Rezultat je neznan, kadar zahteva odide, odgovor pa ni zanesljivo prikazan.
Rezultat ni neznan samo zato, ker uporabnik ni videl potrditvenega obvestila.
Najprej iščite po stabilnem identifikatorju, nato po času in znesku.
Pri računu je stabilen identifikator številka računa ali ID računa.
Pri plačilu je stabilen identifikator poskus plačila oziroma referenca ponudnika.
Pri naročilu je stabilen identifikator ID naročila, ne ime mize.
Pri OCR je stabilen identifikator uvoz oziroma izvirna datoteka.
Če najdete zaključen izvirnik, ga ne ustvarite znova.
Če najdete nedokončan izvirnik, nadaljujte samo po njegovem stanju.
Če po preverjanju ni dokaza, da je izvirnik nastal, odločitev potrdi vodja.
V zapisnik dodajte, kje ste iskali in v katerem času.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a3d0b1fb599d package=lite -->
## 29. Dostop, seja in kontekst: incidentne kartice

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-489876b77da1 package=lite -->
### 29.1 Seja se izteče med oddajo

**Dokazi po prednosti:** strežniški zapis naročila, arhiv, nato lokalni prikaz in spomin uporabnika.
**Takoj ustavite:** drugi klik Oddaj, plačilo in preklop na drugo blagajno.
**Varna obnova:** prijavite se znova v isti enoti in poiščite naročilo po času ter mizi.
**Uskladitev:** primerjajte postavke, opombe, status priprave in morebitni račun.
**Eskalacija:** uporabnik, enota, naprava, čas poteka seje, URL pogled in ID naročila.
**Prepovedano:** deliti prijavno povezavo, uporabljati račun sodelavca ali brisati piškotke na slepo.
**Po incidentu:** preverite, ali je bila zahteva enkrat sprejeta in ali se je odjava pravilno pokazala.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b6866f5f46fe package=lite -->
### 29.2 Napačna aktivna enota

**Dokazi po prednosti:** prikazan poslovni kontekst, ID enote na zapisu, nato naziv v glavi zaslona.
**Takoj ustavite:** izdajo računa, premik mize, spremembo menija in uvoz zaloge.
**Varna obnova:** preklopite na pravilno enoto in ponovno samo preberite isti dokument.
**Uskladitev:** potrdite, da noben dokument ni nastal v napačni enoti.
**Eskalacija:** obe enoti, blagajna, uporabnik, čas ter morebitni ustvarjeni ID.
**Prepovedano:** prepisovati podatke med enotama kot nadomestilo za napačen kontekst.
**Po incidentu:** vodja preveri privzeto dodelitev uporabnika in naprave.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-5e8225f11616 package=lite -->
### 29.3 Napačna blagajna ali naprava

**Dokazi po prednosti:** nastavitev aktivne blagajne, številka računa in naprava, ki je zahtevo poslala.
**Takoj ustavite:** fiskalizacijo pod domnevo, da bo številčenje pozneje popravljeno.
**Varna obnova:** dokument najprej poiščite; nato administrator potrdi pravilno dodelitev.
**Uskladitev:** primerjajte številčenje, poslovni prostor in blagajno na ustvarjenih računih.
**Eskalacija:** ID naprave, ID blagajne, poslovni prostor, številke prizadetih računov.
**Prepovedano:** ročno spreminjati številke računov ali uporabljati drugo blagajno za isti nejasni račun.
**Po incidentu:** preverite, da lokalno izbrana blagajna ni v sporu z dodelitvijo uporabnika.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c140e18557a7 package=lite -->
### 29.4 Manjka dovoljenje

**Dokazi po prednosti:** strežniški odgovor prepovedano, dodeljena vloga, nato manjkajoči gumb.
**Takoj ustavite:** poskuse prek drugega uporabnika in ponavljajoče se prijave.
**Varna obnova:** administrator preveri najmanjšo potrebno pravico za dejansko nalogo.
**Uskladitev:** po spremembi preverite dostop z lastnim računom uporabnika.
**Eskalacija:** uporabnik, zahtevana funkcija, enota, vloga in poslovni razlog.
**Prepovedano:** deliti geslo, trajno dodeliti skrbniških pravic ali obiti potrditev.
**Po incidentu:** preverite revizijsko sled spremembe pravic.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2694e0c55359 package=lite -->
## 30. Realtime, predpomnilnik in čakalne vrste

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-988ae602d4e9 package=extended -->
### 30.1 Dogodek v realnem času manjka

**Dokazi po prednosti:** strežniško stanje zapisa, osvežen poizvedbeni pogled, nato indikator povezave.
**Takoj ustavite:** ponovno oddajo naročila samo zato, ker druga naprava ni zazvonila.
**Varna obnova:** na prizadeti napravi osvežite pogled in poiščite obstoječi ID.
**Uskladitev:** preverite, da KDS, servis in arhiv kažejo enak status naročila.
**Eskalacija:** enota, naprava, čas, ID naročila in ali je manjkalo samo obvestilo.
**Prepovedano:** spreminjati status naročila po spominu ali ročno ustvariti kopijo.
**Po incidentu:** preverite dostavo naslednjega testnega dogodka v odobrenem okolju.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0fc20892c204 package=lite -->
### 30.2 Lokalna sprememba čaka

**Dokazi po prednosti:** zapis v strežniku po povezavi, status čakalne vrste, nato prikaz gumba.
**Takoj ustavite:** zapiranje brskalnika, čiščenje podatkov in isto dejanje na drugi napravi.
**Varna obnova:** vzpostavite povezavo, počakajte na zaključek in nato preiščite arhiv.
**Uskladitev:** preštejte enkratne postavke, ne števila klikov uporabnika.
**Eskalacija:** čas nastanka, tip dejanja, stanje povezave, naprava in rezultat po vrnitvi omrežja.
**Prepovedano:** izklopiti napravo med aktivnim pošiljanjem ali brisati lokalno čakalno vrsto.
**Po incidentu:** zabeležite, ali je sistem zahtevo izvedel ničkrat ali enkrat.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2317bbae2445 package=lite -->
### 30.3 Konflikt dveh naprav

**Dokazi po prednosti:** zadnja strežniška različica, čas sprememb, nato prikaza obeh naprav.
**Takoj ustavite:** sočasne spremembe iste mize, naročila ali rezervacije.
**Varna obnova:** določite eno napravo za branje in enega lastnika nadaljnjega koraka.
**Uskladitev:** primerjajte postavke, status, opombe, plačila in pripravo po ID-ju.
**Eskalacija:** oba ID-ja naprav, oba uporabnika, vrstni red dejanj in časi.
**Prepovedano:** izbrati starejši prikaz, ker je videti bolj znan.
**Po incidentu:** ekipa potrdi, katera različica je bila avtoritativna.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-325c71186712 package=extended -->
## 31. Mize, naročila in rezervacije

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-dae3587d6fbc package=standard -->
### 31.1 Miza je zasedena brez gosta

**Dokazi po prednosti:** odprto naročilo na mizi, aktivna rezervacija, nato prikaz načrta miz.
**Takoj ustavite:** odpiranje novega naročila na isti mizi in sproščanje na pamet.
**Varna obnova:** odprite najdeni zapis in preverite status, uporabnika ter čas.
**Uskladitev:** povežite fizično mizo z enim digitalnim naročilom ali rezervacijo.
**Eskalacija:** miza, ID naročila/rezervacije, čas, enota, zadnji uporabnik.
**Prepovedano:** brisati naročilo, da bi ikona mize postala prosta.
**Po incidentu:** preverite samodejno sproščanje potečenih rezervacij in pravilen čas.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f6f0275285db package=extended -->
### 31.2 Rezervacija blokira po odhodu gosta

**Dokazi po prednosti:** status in končni čas rezervacije, načrt mize, nato ustno potrdilo osebja.
**Takoj ustavite:** sedenje novega gosta na drugo mizo samo zaradi nepreverjenega bloka.
**Varna obnova:** vodja preveri, ali je rezervacija potekla ali je vezana na odprto naročilo.
**Uskladitev:** potrdite, da sprostitev ne prekine naročila dejanskega gosta.
**Eskalacija:** ID rezervacije, miza, načrtovani čas, dejanski prihod/odhod, uporabnik.
**Prepovedano:** spreminjati čas rezervacije brez razloga ali ustvariti navideznega gosta.
**Po incidentu:** preverite, ali je bila ura enote pravilna.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-239401d8a432 package=standard -->
### 31.3 Premik naročila med mizami

**Dokazi po prednosti:** izvorna in ciljna miza na strežniškem naročilu, nato prikaz tlorisa.
**Takoj ustavite:** več zaporednih premikov, kadar rezultat prvega ni znan.
**Varna obnova:** poiščite naročilo po ID-ju in izvedite največ en potrjen premik.
**Uskladitev:** kuhinja, račun in tloris morajo kazati isto mizo.
**Eskalacija:** ID naročila, obe mizi, čas, naprava in kdo je zahteval premik.
**Prepovedano:** podvojiti postavke na ciljni mizi namesto premika.
**Po incidentu:** preverite opombe in delitve računa, če obstajajo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-f9f7bb394780 package=standard -->
## 32. KDS in priprava

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-23bcd04e9f95 package=standard -->
### 32.1 KDS ne prikaže naročila

**Dokazi po prednosti:** strežniški status oddaje, KDS čakalna vrsta, nato natisnjen listek.
**Takoj ustavite:** drugo oddajo istih postavk in ročno pripravo brez identifikatorja.
**Varna obnova:** kuhinji posredujte ID in potrjene postavke; nato preverite KDS osvežitev.
**Uskladitev:** vsaka postavka mora biti enkrat v pripravi ali jasno preklicana.
**Eskalacija:** postaja KDS, ID naročila, čas oddaje, postavke in povezava naprave.
**Prepovedano:** BUMP na drugem naročilu, da bi »sprostili« zaslon.
**Po incidentu:** preverite, da naslednje naročilo prispe brez ročnega posega.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8271077b1742 package=standard -->
### 32.2 KDS pokaže podvojitev

**Dokazi po prednosti:** ID postavke in dogodki oddaje, nato vizualni seznam KDS.
**Takoj ustavite:** pripravo obeh kopij in ponovno oddajo iz POS-a.
**Varna obnova:** določite, katera postavka je veljavna po ID-ju in statusu.
**Uskladitev:** zabeležite, ali je bila dodatna jed pripravljena, zavržena ali predana gostu.
**Eskalacija:** ID naročila, ID postavke, postaja, časi prikaza in statusi.
**Prepovedano:** odstraniti dokaz o dvojniku ali tiho prilagoditi zalogo.
**Po incidentu:** preverite, ali je bil sprožilec ponovni klik ali zakasnjen prikaz.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-af8cd3ffa81b package=standard -->
### 32.3 Prezgodnji BUMP

**Dokazi po prednosti:** status postavke v KDS, čas BUMP in zapis priprave.
**Takoj ustavite:** nov BUMP in izdajo postavke brez preverjanja.
**Varna obnova:** poiščite postavko po ID-ju in jo vrnite v dogovorjen proces priprave.
**Uskladitev:** servis dobi jasen status: v pripravi, pripravljeno ali za ponovno pripravo.
**Eskalacija:** postaja, ID postavke, uporabnik, čas in vpliv na gosta.
**Prepovedano:** označiti pripravljeno samo zato, da je zaslon prazen.
**Po incidentu:** vodja pregleda, ali je bila potrebna ponovna priprava in njen strošek.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b932c15e86da package=standard -->
### 32.4 Alergen ali opomba na KDS ni pravilna

**Dokazi po prednosti:** potrjena postavka naročila, konfiguracija artikla, nato KDS prikaz.
**Takoj ustavite:** pripravo in predajo jedi; pri alergenu ustavite tudi izdajo.
**Varna obnova:** vodja potrdi pravilno specifikacijo z gostom ali izvorno postavko.
**Uskladitev:** POS, KDS in osebje morajo imeti enako, izrecno navodilo.
**Eskalacija:** ID naročila/postavke, alergen ali opomba, postaja in faza priprave.
**Prepovedano:** predvidevati, da »brez« pomeni enako kot privzeta receptura.
**Po incidentu:** preverite, ali je sprememba menija potrebna pred nadaljnjo prodajo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-305dd66bc891 package=extended -->
## 33. Plačila, ponudniki terminalov in boni

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-789a77bf4085 package=extended -->
### 33.1 Odobreno na terminalu, neznano v POS-u

**Dokazi po prednosti:** referenca ponudnika in terminalski izpis, nato evidenca poskusa plačila in račun.
**Takoj ustavite:** drugo kartično bremenitev, drugo kartico in izdajo novega računa.
**Varna obnova:** preverite isti poskus po referenci pri odobrenem ponudniku.
**Uskladitev:** znesek, valuta, čas, terminal, namen in račun se morajo ujemati.
**Eskalacija:** ponudnik, terminal ID, referenca, znesek, čas, ID naročila/računa.
**Prepovedano:** zahtevati PAN, CVV, PIN ali fotografijo kartice.
**Po incidentu:** gost prejme le potrjeno razlago in po potrebi uradni dokaz ponudnika.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-81cc9d21560d package=extended -->
### 33.2 Zavrnjeno na terminalu, plačano v POS-u

**Dokazi po prednosti:** stanje ponudnika, evidence poskusa, nato prikaz POS-a.
**Takoj ustavite:** predajo blaga kot plačanega in ročno označevanje drugega načina plačila.
**Varna obnova:** vodja zbere referenco in preveri dokončno stanje pri ponudniku.
**Uskladitev:** račun sme ostati plačan samo ob potrjenem uspehu plačilnega poskusa.
**Eskalacija:** terminal, ponudnik, referenca, znesek, čas, račun in vidni statusi.
**Prepovedano:** stornirati račun zato, da bi prikaz ustrezal terminalu.
**Po incidentu:** preverite, ali je POS prejel zakasnjen odgovor.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8b1a7e15b492 package=extended -->
### 33.3 Terminal ni dosegljiv

**Dokazi po prednosti:** zdravstveni prikaz ponudnika, lokalna povezava terminala, nato napaka POS-a.
**Takoj ustavite:** zaporedne zahteve in menjavo ponudnika sredi istega poskusa.
**Varna obnova:** zaključite ali razjasnite odprti poskus, šele nato uporabite odobren alternativni način.
**Uskladitev:** vsak alternativni znesek mora biti vezan na isti račun brez dvojnega bremenjenja.
**Eskalacija:** ponudnik, terminal ID, omrežni status, čas, znesek in odprti poskus.
**Prepovedano:** znova zaganjati terminal med transakcijo ali spreminjati konfiguracijo brez skrbnika.
**Po incidentu:** vodja primerja terminalski dnevni seštevek z evidenco POS.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-af737451a177 package=extended -->
### 33.4 Mešano plačilo

**Dokazi po prednosti:** razčlenitev računa, terminalski uspeh za kartični del, nato prikaz skupnega zneska.
**Takoj ustavite:** spremembo deležev po odobritvi kartice brez dokumentirane korekcije.
**Varna obnova:** preverite, kateri del je dokončen in kateri del ostaja za plačilo.
**Uskladitev:** vsota gotovine, kartice, bona in napitnine mora dati točen znesek računa.
**Eskalacija:** račun, vsi načini, zneski, reference in vrstni red poskusov.
**Prepovedano:** zaokrožiti razliko z neoznačeno gotovino ali ustvariti drugi račun.
**Po incidentu:** preverite, da poročilo po načinu plačila vsebuje vsak del enkrat.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-57ce8e78a1a8 package=extended -->
### 33.5 Darilni bon: agregatno stanje

Večnamenski darilni bon se obravnava kot agregat izdaje in unovčitev, ne kot samostojen »popravljen« kupon.
Pri sumu napake najprej preverite izdajo bona, vse zabeležene unovčitve in odprto stanje.
**Dokazi po prednosti:** evidenca izdaje, gibanja bona, račun unovčitve, nato izjava gosta.
**Takoj ustavite:** ponovno unovčitev, ročno povečevanje stanja in izdajo nadomestnega bona.
**Varna obnova:** znesek preverite v centih in obravnavajte primer prek odobrene evidence gibanj.
**Uskladitev:** izdani znesek minus potrjene unovčitve mora dati prikazano odprto stanje.
**Eskalacija:** identifikator izdaje, računi unovčitev, zneski, časi in opozorilo sistema.
**Prepovedano:** obravnavati bon za pico kot večnamenski bon ali združevati njuni evidenci.
**Prepovedano:** popravljati posamezne vrstice mimo agregatne evidence bona.
**Po incidentu:** računovodstvo potrdi, da ni presežka unovčitev nad evidentirano izdajo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-341c14d0558e package=extended -->
### 33.6 Storno računa

Storno se izvaja kot polni storno veljavnega računa, ne kot delno brisanje postavk že izdanega računa.
**Dokazi po prednosti:** izvirni račun, njegov fiskalni status, plačila in razlog storna.
**Takoj ustavite:** delni storno, ročno spreminjanje vrstic izdanega računa in izdajo podobnega računa.
**Varna obnova:** vodja potrdi, da je potreben polni storno, nato uporabi odobren tok.
**Uskladitev:** storno mora kazati povezavo z izvirnikom in celoten znesek izvirnika.
**Eskalacija:** številka/ID izvirnika, razlog, čas, uporabnik, plačila in fiskalni status.
**Prepovedano:** stornirati samo artikle, popust ali napitnino na že izdanem računu.
**Po incidentu:** preverite poročila, zalogovni učinek in odprta plačila obeh dokumentov.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-92f1ee88679b package=lite -->
## 34. FURS, številčenje in offline vrsta

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-6b68eba2cde3 package=lite -->
### 34.1 Račun nima potrjenega EOR

**Dokazi po prednosti:** fiskalni status računa, poskus oddaje, nato natisnjeno potrdilo.
**Takoj ustavite:** ponovno izdajo iste prodaje in ročno spreminjanje številke računa.
**Varna obnova:** poiščite obstoječi račun in uporabite predpisani postopek ponovnega pošiljanja.
**Uskladitev:** za vsak prizadeti račun zabeležite status, čas poskusa in končni odgovor.
**Eskalacija:** račun, poslovni prostor, blagajna, čas, napaka in stanje povezave.
**Prepovedano:** pošiljati certifikata, zasebnega ključa ali gesla za potrdilo.
**Po incidentu:** preverite, da je offline vrsta prazna šele po potrjenih odgovorih.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a1b49702de0e package=lite -->
### 34.2 Fiskalna vrsta se ne prazni

**Dokazi po prednosti:** seznam čakajočih računov, posamezni statusi poskusov, nato skupni indikator.
**Takoj ustavite:** ročno ponovno ustvarjanje čakajočih računov.
**Varna obnova:** zagotovite povezavo in sprožite samo odobreno ponavljanje vrste.
**Uskladitev:** število čakalnih zapisov pred in po postopku primerjajte po ID-jih.
**Eskalacija:** število zapisov, prvi/zadnji račun, obdobje, napaka in certifikatni status brez skrivnosti.
**Prepovedano:** brisati vrsto, preurejati vrstni red ali menjati poslovni datum.
**Po incidentu:** naključno preverite EOR za prvi, srednji in zadnji prizadeti račun.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ca1446c2a318 package=lite -->
### 34.2A Opozorilni pas za ponovni prenos

Če POS prikaže opozorilni pas za neuspešne FURS prenose, najprej preberite
število prizadetih računov. Pritisnite ponovni prenos samo enkrat in počakajte
na rezultat obstoječih zapisov.

Uspešno število pomeni račune, za katere je program prejel potrjen odgovor;
ne pomeni dovoljenja za ponovno izdajo prodaje. Po zaključku preverite EOR na
prizadetih računih in da je offline vrsta prazna. Če del zapisov ostane
neuspešnih, zabeležite njihove identifikatorje in prikazano napako ter primer
predajte odgovorni osebi.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e776f6fca1d6 package=lite -->
### 34.3 Potrdilo ni veljavno

**Dokazi po prednosti:** sporočilo validacije, datum veljavnosti konfiguracije, nato indikator povezave.
**Takoj ustavite:** menjavo potrdila na produkciji brez pooblaščenca.
**Varna obnova:** skrbnik preveri veljavnost in namesti odobreno potrdilo po politiki podjetja.
**Uskladitev:** po popravku preverite en nov, zakonito izdan primer in prej čakajoče zapise.
**Eskalacija:** enota, poslovni prostor, čas, koda napake in datum veljavnosti.
**Prepovedano:** pošiljati datoteko potrdila po e-pošti ali zapisati geslo v zahtevek.
**Po incidentu:** dokumentirajte lastnika in datum naslednjega preverjanja veljavnosti.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-5cee593c1108 package=lite -->
## 35. Tiskalni mostovi in fizični izpisi

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ae0b155bdf78 package=lite -->
### 35.1 Račun je ustvarjen, izpis manjka

**Dokazi po prednosti:** arhiv računa, status tiskalnega opravila, nato papirni pladenj.
**Takoj ustavite:** novo izdajo računa in ponovno plačilo.
**Varna obnova:** uporabite ponatis obstoječega računa po potrditvi številke.
**Uskladitev:** preverite, da ponatis nosi isti dokument in ne ustvari nove prodaje.
**Eskalacija:** račun, tiskalnik, most, naprava, čas in vidna napaka.
**Prepovedano:** ročno sestaviti »račun« na list papirja kot nadomestek uradnega dokumenta.
**Po incidentu:** preverite papir, napajanje, omrežje in pravilno dodelitev tiskalnika.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c67086894227 package=standard -->
### 35.2 Kuhinjski tisk gre drugam

**Dokazi po prednosti:** usmeritev artikla/postaje, ID tiskalnega opravila, nato fizični listek.
**Takoj ustavite:** ponovno oddajo, dokler kuhinja ne potrdi, kaj je prejela.
**Varna obnova:** pravilni postaji posredujte enkratno potrjeno naročilo z ID-jem.
**Uskladitev:** primerjajte KDS, kuhinjski listek in naročilo po postavkah.
**Eskalacija:** artikel, ciljna postaja, dejanska postaja, naprava, čas in ID naročila.
**Prepovedano:** spreminjati globalno usmeritev med obratovanjem brez odobritve.
**Po incidentu:** administrator preveri pravila usmerjanja in testira neprodukcijski primer.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-37fdc4d3441b package=lite -->
### 35.3 Most ni aktiven

**Dokazi po prednosti:** stanje mostu na določeni napravi, dosegljivost tiskalnika, nato POS obvestilo.
**Takoj ustavite:** namestitev neodobrenega gonilnika in spremembo omrežnih nastavitev.
**Varna obnova:** usposobljena oseba preveri, ali je pravi most zagnan na pravi napravi.
**Uskladitev:** izberite en obstoječi dokument za varen ponatis, ne novo prodajo.
**Eskalacija:** naprava mostu, tiskalnik, enota, verzija mostu, čas in napaka.
**Prepovedano:** uporabljati skupni račun naprave za dostop do produkcijskih nastavitev.
**Po incidentu:** preverite ločeno račun, kuhinjo in poročilo, če imajo različne usmeritve.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2efbfc7af3f8 package=extended -->
## 36. QR, CTI, telefon in dostava

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-aafa1f1b46be package=extended -->
### 36.1 QR naročilo ni vidno v POS-u

**Dokazi po prednosti:** strežniški zapis QR naročila, status oddaje, nato zaslon gosta.
**Takoj ustavite:** ročno naročilo z istimi postavkami brez iskanja po času in kontaktu.
**Varna obnova:** preverite status naročila in gostu potrdite samo najdeni rezultat.
**Uskladitev:** QR naročilo mora biti enkrat dodeljeno mizi, prevzemu ali dostavi.
**Eskalacija:** čas, enota, ID QR naročila, status, naprava in anonimiziran kontaktni podatek.
**Prepovedano:** zahtevati od gosta ponovno plačilo zaradi neosveženega pogleda.
**Po incidentu:** preverite, ali je šlo za neuspešno oddajo ali le zamudo prikaza.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-6771471c24e2 package=extended -->
### 36.2 QR meni pokaže napačno ceno

**Dokazi po prednosti:** aktivna cena artikla v pravilni enoti, čas veljavnosti, nato predpomnjeni zaslon.
**Takoj ustavite:** sprejem naročila z nejasno ceno in spreminjanje cene brez pooblastila.
**Varna obnova:** vodja potrdi veljavno ceno ter gostu jasno pove, katera cena velja.
**Uskladitev:** QR meni, POS in račun uporabijo isto konfiguracijo za isti poslovni trenutek.
**Eskalacija:** artikel, enota, prikazana/veljavna cena, čas in posnetek brez osebnih podatkov.
**Prepovedano:** ročno dodati neoznačen popust, da bi prikrili razhajanje.
**Po incidentu:** preverite predpomnjenje na drugi napravi in nastavitev cenika.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-390d32ec2795 package=lite -->
### 36.3 CTI ne prepozna klicatelja

**Dokazi po prednosti:** CTI dogodek, čas klica, nato ročni podatek klicatelja.
**Takoj ustavite:** izbiro prve podobne stranke in razkritje preteklih naročil.
**Varna obnova:** identiteto potrdite z najmanjšim potrebnim podatkom in ustvarite nov zapis le po potrebi.
**Uskladitev:** telefonsko naročilo se veže na pravilnega gosta brez združevanja profilov na domnevo.
**Eskalacija:** čas, kanal, anonimizirana številka po politiki, naprava in CTI status.
**Prepovedano:** zapisovati celotne osebne podatke v prosto opombo incidenta.
**Po incidentu:** preverite dovoljenja CTI in ujemanje časovnega pasu.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-acfb2ef50a53 package=extended -->
### 36.4 Dostavni naslov je nejasen

**Dokazi po prednosti:** potrjen naslov gosta, zapis naročila, nato opomba dostavljavca.
**Takoj ustavite:** odpošiljanje na domnevni naslov in spremembo načina plačila.
**Varna obnova:** gost izrecno potrdi naslov, kontakt in navodilo za predajo.
**Uskladitev:** dostava, račun, kontakt in status naročila vsebujejo isto potrjeno destinacijo.
**Eskalacija:** ID naročila, čas, status, minimalni kontaktni podatki in opis nejasnosti.
**Prepovedano:** deliti naslov z neudeleženimi osebami ali kopirati ga v javni klepet.
**Po incidentu:** preverite, ali je bila dostava zadržana, dostavljena ali vrnjena.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b68db12912e1 package=lite -->
## 37. Meni, recepture in alergeni

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0988c08f3ba9 package=lite -->
### 37.1 Artikel manjka na prodajnem zaslonu

**Dokazi po prednosti:** aktivnost artikla za enoto/kanal, kategorija, nato lokalni filter zaslona.
**Takoj ustavite:** ustvarjanje nadomestnega artikla z isto ceno.
**Varna obnova:** administrator preveri razpoložljivost, časovni režim in pravilen kontekst enote.
**Uskladitev:** artikel se po popravku pokaže le tam, kjer je odobren za prodajo.
**Eskalacija:** artikel, enota, kanal, kategorija, čas in uporabnik.
**Prepovedano:** spreminjati ceno ali DDV zato, da bi artikel postal viden.
**Po incidentu:** preverite QR meni, POS in dostavni kanal ločeno.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-255bed8d463c package=lite -->
### 37.2 Cena ali DDV ni pravilen

**Dokazi po prednosti:** veljavni cenik in davčna nastavitev, nato predogled naročila in račun.
**Takoj ustavite:** izdajo računa, če znesek ali DDV ni potrjen.
**Varna obnova:** pooblaščena oseba popravi konfiguracijo pred naslednjo prodajo.
**Uskladitev:** preverite bruto, neto, DDV in zaokrožitev na testnem neprodukcijskem primeru.
**Eskalacija:** artikel, cenik, enota, prikazani znesek, pričakovani znesek in čas.
**Prepovedano:** uporabiti polni ali delni storno kot nadomestilo za popravljanje cenika.
**Po incidentu:** računovodstvo pregleda interval prizadetih računov po pravilih korekcije.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-53eeb9b7052f package=lite -->
### 37.3 Receptura porablja napačno zalogo

**Dokazi po prednosti:** receptura, merska enota, potrjena prodaja, nato zalogovni dogodek.
**Takoj ustavite:** množično prodajo artikla in ročno masovno prilagoditev zaloge.
**Varna obnova:** skladiščnik potrdi pravilno sestavino, faktor in enoto mere.
**Uskladitev:** ena prodana enota artikla mora povzročiti pričakovano porabo sestavin.
**Eskalacija:** artikel, receptura, sestavina, enote, količina, obdobje in primer računa.
**Prepovedano:** spreminjati zgodovinske prodaje ali prepisovati porabe brez revizijske sledi.
**Po incidentu:** izvedite odobreno inventurno uskladitev z razlogom.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-35aeb6a72411 package=lite -->
### 37.4 Alergen v meniju ni potrjen

**Dokazi po prednosti:** potrjena specifikacija dobavitelja/recepture, nastavitev alergena, nato prikaz menija.
**Takoj ustavite:** prodajo artikla kot alergensko varnega in objavo domnevne oznake.
**Varna obnova:** artikel začasno umaknite ali označite po odobritvi odgovorne osebe.
**Uskladitev:** POS, QR meni, KDS in osebje uporabljajo isto potrjeno oznako.
**Eskalacija:** artikel, alergen, vir potrditve, enota, kanal in faza prodaje.
**Prepovedano:** ugibati po imenu jedi ali obljubiti gostu odsotnost alergena brez dokaza.
**Po incidentu:** dokumentirajte vir podatka in datum naslednje revizije.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b02dca4bc7c6 package=extended -->
## 38. Prejemnice, OCR, zaloga in dogodki

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-3887b4b291ca package=extended -->
### 38.1 OCR napačno prebere dobavitelja ali številko

**Dokazi po prednosti:** izvirni dokument, vidno OCR polje, nato prejšnje evidence dobavitelja.
**Takoj ustavite:** potrditev glave dokumenta in ustvarjanje novega dobavitelja na podlagi predloga.
**Varna obnova:** ročno preberite številko, datum, dobavitelja in davčne podatke z izvirnika.
**Uskladitev:** en izvirnik ima eno prejemnico in en sledljiv vir priloge.
**Eskalacija:** ID uvoza, izvirnik, napačno/popravljeno polje, uporabnik in čas.
**Prepovedano:** obrezati ali prepisati izvirnik, da bi se OCR »ujemal«.
**Po incidentu:** označite, ali gre za napako branja ali napačno ujemanje obstoječega partnerja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-1b42ccb76876 package=extended -->
### 38.2 OCR napačno prebere pakiranje

**Dokazi po prednosti:** vrstica izvirnika, enota na dobavnici, artikel in pretvorbeni faktor.
**Takoj ustavite:** potrditev količine, če pakiranje in osnovna enota nista jasna.
**Varna obnova:** preverite količino paketov, vsebino paketa in ciljno mersko enoto.
**Uskladitev:** prejem v zalogi ustreza fizično prejetemu številu osnovnih enot.
**Eskalacija:** uvoz, vrstica, artikel, izvirna enota, predlagana enota in faktor.
**Prepovedano:** uporabiti desetkratnik kot »verjeten« popravek brez dokumenta.
**Po incidentu:** preverite negativne ali nenavadno visoke zaloge prizadete sestavine.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c34e6adaa1f5 package=extended -->
### 38.3 Uvoz je morda podvojen

**Dokazi po prednosti:** identifikator dokumenta, dobavitelj, datum, znesek in obstoječa prejemnica.
**Takoj ustavite:** drugi uvoz iste datoteke in ročni prejem enake zaloge.
**Varna obnova:** poiščite dokument po več ključih ter primerjajte vrstice, ne samo naslov.
**Uskladitev:** fizična dobava, ena prejemnica in zalogovni dogodki morajo biti v razmerju ena proti ena.
**Eskalacija:** oba ID-ja uvoza/prejemnice, izvirnik, časi, uporabniki in primerjava vrstic.
**Prepovedano:** brisati domnevni dvojnik brez ugotovitve, kateri zapis je knjigovodsko veljaven.
**Po incidentu:** računovodstvo in skladišče potrdita popravek po odobrenem postopku.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-91d7dc93f2d6 package=extended -->
### 38.4 Dogodek porabe ni logičen

**Dokazi po prednosti:** dogodek zaloge, vzročni dokument, receptura in čas prodaje/priprave.
**Takoj ustavite:** množično ročno korekcijo in izključitev sledenja dogodkom.
**Varna obnova:** določite, ali gre za prejem, prodajo, odpis, inventuro ali napako mapiranja.
**Uskladitev:** vsak popravek ima razlog, lastnika, količino, enoto in revizijsko sled.
**Eskalacija:** ID dogodka, artikel, skladišče, količina, enota, vzročni ID in čas.
**Prepovedano:** združiti več vzrokov v en nepojasnjen odpis.
**Po incidentu:** preverite razpoložljivost menija, če zaloga določa prodajnost artikla.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-587a88cc5a67 package=lite -->
## 39. Poročila in POS→ERP

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b15a920bffed package=lite -->
### 39.1 Poročilo odstopa od dnevnega seštevka

**Dokazi po prednosti:** uporabljeni filtri, poslovni datum, enota/blagajna, nato izvoz vrstic.
**Takoj ustavite:** ročni popravek poročila in sklepanje, da so računi izgubljeni.
**Varna obnova:** ponovite pregled z dokumentiranimi filtri in primerjajte osnovne dokumente.
**Uskladitev:** ločite izdan račun, storno, način plačila, napitnino in darilni bon.
**Eskalacija:** ime poročila, filtri, čas izvoza, pričakovani/dejanski znesek in vzorčni ID-ji.
**Prepovedano:** primerjati različna poslovna datuma kot isti interval.
**Po incidentu:** vodja shrani uporabljeno definicijo seštevka za revizijo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-fa7ac6040876 package=lite -->
### 39.2 POS→ERP prenos manjka

**Dokazi po prednosti:** status prenosa, izvorni POS dokument, nato ERP pogled.
**Takoj ustavite:** ročni vnos iste knjižbe v ERP brez preverjanja idempotentnosti.
**Varna obnova:** poiščite izvorni dokument in prenos po identifikatorju ter stanju.
**Uskladitev:** vsak POS dokument je v ERP prisoten največ enkrat ali ima jasno napako prenosa.
**Eskalacija:** POS ID, ERP ID če obstaja, obdobje, status, napaka in enota.
**Prepovedano:** ponavljati celoten izvoz samo zato, ker manjka en dokument.
**Po incidentu:** preverite zaporedne dokumente pred in po manjkajočem primeru.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-609f5a3cd973 package=lite -->
### 39.3 POS→ERP prenos je podvojen

**Dokazi po prednosti:** idempotentni ključ/povezava dokumentov, ERP knjižbe, nato skupni zneski.
**Takoj ustavite:** novo pošiljanje in brisanje ERP zapisa brez računovodske odobritve.
**Varna obnova:** računovodstvo označi kanonični izvor in uporabi sledljiv postopek razveljavitve.
**Uskladitev:** POS izvirnik, ERP cilj in morebitna korekcija tvorijo sledljivo verigo.
**Eskalacija:** vsi ID-ji, zneski, konti, časi, statusi in dokaz podvajanja.
**Prepovedano:** znižati znesek na enem zapisu brez povezane korektivne listine.
**Po incidentu:** ponovno izračunajte poročilo za prizadeto obdobje.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ae2b925b1380 package=lite -->
## 40. Simulacije za vodeno usposabljanje

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-da55b5ae334d package=lite -->
### 40.1 Simulacija: seja poteče pri oddaji naročila

**Izhodišče:** natakar odda naročilo, zaslon zahteva novo prijavo.
**Pravilna odločitev:** ne odda ponovno, prijavi se in poišče naročilo po času ter mizi.
**Dokaz uspeha:** obstaja največ eno naročilo z zahtevanimi postavkami.
**Napačna odločitev:** odpre novo naročilo, ker prejšnjega takoj ne vidi.
**Razlaga:** potek seje ne pove, ali je strežnik zahtevo že sprejel.
**Ocena:** kandidat dobi točko le, če navede stop pogoj in vir preverjanja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-05121e25a06b package=lite -->
### 40.2 Simulacija: dvojni KDS prikaz

**Izhodišče:** kuhar vidi dve enaki postavki na isti postaji.
**Pravilna odločitev:** ustavi drugo pripravo in preveri ID postavke ter dogodke oddaje.
**Dokaz uspeha:** pripravljena je samo potrjena postavka, dvojnik ostane dokumentiran.
**Napačna odločitev:** pripravi obe jedi in pozneje izbriše eno vrstico.
**Razlaga:** vizualna podobnost ni dokaz, da gre za dve veljavni naročili.
**Ocena:** kandidat mora navesti uskladitev s servisom in zalogo.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2a99d75a0861 package=lite -->
### 40.3 Simulacija: bon in kartica

**Izhodišče:** gost plača del z večnamenskim bonom, kartični del pa ima časovno omejitev.
**Pravilna odločitev:** bon obravnava po agregatni evidenci, kartice ne ponovi brez reference.
**Dokaz uspeha:** vsota vseh potrjenih delov je točno znesek računa.
**Napačna odločitev:** izda nov bon za razliko ali ponovno obremeni kartico.
**Razlaga:** bon in terminalski poskus imata ločeni sledi ter ločene stop pogoje.
**Ocena:** kandidat mora našteti izdajo, gibanja bona in terminalsko referenco.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-c4dfb00ca22e package=lite -->
### 40.4 Simulacija: fiskalni izpad

**Izhodišče:** trije računi čakajo na fiskalno potrditev.
**Pravilna odločitev:** vodi seznam obstoječih računov in uporabi odobreno offline vrsto.
**Dokaz uspeha:** po obnovi ima vsak izvirni račun potrjen končni status.
**Napačna odločitev:** račune ponovno izda z novimi številkami.
**Razlaga:** številčenje in pravna sled pripadata izvirnemu dokumentu.
**Ocena:** kandidat ne sme predlagati pošiljanja certifikata podpori.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-5b776a256cc9 package=lite -->
### 40.5 Simulacija: OCR desetkratnik

**Izhodišče:** OCR spremeni 6 paketov po 12 kosov v 720 kosov.
**Pravilna odločitev:** ustavi potrditev in loči pakete od osnovnih enot na izvirniku.
**Dokaz uspeha:** zalogovni dogodek je 72 osnovnih enot z dokumentiranim faktorjem.
**Napačna odločitev:** potrdi 720 in pozneje popravi stanje z odpisom.
**Razlaga:** odpis ne popravi napačne poslovne sledi prejemnice.
**Ocena:** kandidat mora povedati, kdaj eskalira skladiščniku.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-28022182efa6 package=lite -->
## 41. Matrika kakovosti podpore

| Slab odgovor | Zakaj ni dovolj | Kakovosten odgovor |
|---|---|---|
| »Poskusite še enkrat.« | lahko podvoji denar ali naročilo | »Ne ponavljajte; poiščite ID in čas, nato preverite arhiv.« |
| »Terminal je verjetno zavrnil.« | domneva brez ponudnika | »Zapišite referenco; dokončni status preverite pri ponudniku.« |
| »Stornirajte postavko.« | krši pravilo polnega storna | »Izdani račun se obravnava s polnim stornom po odobritvi.« |
| »Bonu dodajte razliko.« | obide agregat gibanj | »Preverite izdajo in vse unovčitve bona pred kakršnim koli ukrepom.« |
| »OCR je dovolj dober.« | OCR ni dokaz izvirnika | »Potrdite glavo, količino, enoto in pakiranje proti izvirniku.« |
| »Samo osvežite KDS.« | ne varuje pred dvojno pripravo | »Najprej ustavite drugo pripravo in preverite ID postavke.« |
| »Pošljite certifikat.« | razkriva skrivnost | »Pošljite kodo napake, čas in status, ne potrdila ali gesla.« |
| »V ERP vnesite ročno.« | lahko podvoji knjižbo | »Najprej preverite status prenosa in identifikator dokumenta.« |

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-b3e5abd56a4f package=lite -->
### 41.1 Kontrolna vprašanja za dežurnega

Kateri zapis je avtoritativni vir za ta tip incidenta?
Ali je rezultat res neznan ali samo ni prikazan na tej napravi?
Katero dejanje bi ob ponovitvi ustvarilo dvojnik?
Kateri dokument je pravno ali finančno vezan na izvirnik?
Ali obstaja tveganje za alergen, dvojno breme ali napačno pripravo?
Kateri najmanjši podatek potrebuje naslednja stopnja podpore?
Ali je bila uporabljena pravilna enota, blagajna in poslovni datum?
Ali uskladitev pokriva tudi fizični svet: kuhinjo, papir, terminal ali zalogo?
Kdo potrdi, da je incident zaključen?
Kateri post-incidentni pregled prepreči ponovitev?

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-0852933bcce7 package=lite -->
## 42. Končna praktična ocena

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-9ec5c153fb60 package=lite -->
### Primer A: natakar vidi vrtenje po plačilu

Pravilni vrstni red je: ustavi ponovitev, zapiši referenco, preveri račun in ponudnika.
Racionala je, da odobritev terminala lahko obstaja brez odgovora POS-a.
Nepravilen odgovor je zahteva po drugi kartici pred preverjanjem prvega poskusa.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-88c6a782096f package=lite -->
### Primer B: račun je natisnjen, EOR pa manjka

Pravilni vrstni red je: poišči izvirni račun, zapiši fiskalni status, uporabi vrsto.
Racionala je, da tisk ne dokazuje dokončne fiskalne potrditve.
Nepravilen odgovor je izdaja novega računa z enakim zneskom.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e27aed131af7 package=lite -->
### Primer C: gost zahteva odstranitev ene postavke z že izdanega računa

Pravilni odgovor je: ne delni storno; vodja preveri potrebo po polnem stornu izvirnika.
Racionala je, da se že izdani račun ne popravlja z brisanjem posamezne vrstice.
Nepravilen odgovor je sprememba artikla, popusta ali napitnine v obstoječem računu.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-65d3f0d1504a package=extended -->
### Primer D: stanje darilnega bona ni pričakovano

Pravilni odgovor je: preveri izdajo in vse unovčitve kot agregat gibanj.
Racionala je, da posamezna ročna korekcija lahko prikrije presežek unovčitev.
Nepravilen odgovor je izdaja novega bona ali ročno povečanje salda.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a0e3e8f7e097 package=lite -->
### Merilo zaključka

Incident je zaključen šele, ko je rezultat dokazan, ne le ko opozorilo izgine.
Zaključek vsebuje uskladitev prizadetih dokumentov, denarja, priprave ali zaloge.
Zaključek vsebuje lastnika odprtega korektivnega ukrepa, če vzrok ni odpravljen.
Zaključek ne vsebuje skrivnosti, nepotrebnih osebnih podatkov ali domnev kot dejstev.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-e3acc0923cce package=lite -->
## 43. Odločitvene kartice za zaključevanje incidentov

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-80765a23e31b package=lite -->
### 43.1 Kartica: ali je naročilo res izgubljeno?

Preverite strežniški seznam naročil v pravilni enoti.
Preverite iskanje po ID-ju, času, mizi in znesku.
Preverite, ali je naročilo vidno samo na KDS ali samo v arhivu.
Če obstaja, ga ne ustvarite znova.
Če ne obstaja, zapišite dokaz iskanja pred ustvarjanjem nadomestnega naročila.
Če obstaja delno, vodja določi nadaljevanje na izvirnem zapisu.
Za novo naročilo ponovno potrdite postavke z gostom.
Po odločitvi preverite, da kuhinja ni prejela obeh različic.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-416146a54783 package=lite -->
### 43.2 Kartica: ali je račun veljavno izdan?

Preverite številko računa in status v arhivu.
Preverite povezavo računa z naročilom in plačilom.
Preverite fiskalni status posebej od stanja tiska.
Obstoječega računa ne zamenjajte z novim zaradi manjkajočega papirja.
Če je izdan, se morebitna korekcija vodi po odobrenem toku.
Če je fiskalni odgovor v čakanju, ostane izvirnik predmet uskladitve.
Če je račun storniran, preverite povezavo s celotnim izvirnikom.
Po zaključku preverite številčenje in poročilo prizadetega obdobja.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-4ccbde667285 package=lite -->
### 43.3 Kartica: ali je plačilo dokončno?

Preverite identiteto plačilnega poskusa in njegov namen.
Preverite referenco pri terminalu oziroma ponudniku.
Preverite povezavo uspešnega poskusa z enim računom.
Časovna omejitev ni dokaz zavrnitve.
Odobritev na terminalu ni razlog za drugi poskus.
Zavrnjeni poskus ni razlog za ročno označitev kot plačano.
Pri mešanem plačilu preverite vsak del in skupni seštevek.
Po zaključku preverite dnevni seštevek ponudnika proti POS evidenci.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-2f3a1ec277b3 package=lite -->
### 43.4 Kartica: ali je priprava varna?

Preverite ID postavke, status KDS in aktualno opombo.
Preverite alergen proti potrjeni konfiguraciji, ne proti spominu.
Če je status nejasen, ustavite predajo gostu.
Če je kuhinja že pripravila izdelek, zabeležite dejanski fizični izid.
Ne pripravljajte dvojnika, dokler ni določena veljavna postavka.
Ne BUMP-ajte drugega naročila zaradi praznega zaslona.
Vodja potrdi ponovno pripravo, kadar je vpliv na alergene ali kakovost.
Po zaključku sta KDS in servis seznanjena z enim končnim statusom.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a7fe5cf7b75a package=lite -->
### 43.5 Kartica: ali je zalogovni popravek upravičen?

Preverite izvirno prejemnico, prodajo ali inventurni zapis.
Preverite artikel, skladišče, količino in mersko enoto.
Preverite, ali je razlog napaka OCR, recepture ali fizična razlika.
Ne uporabljajte odpisa za prikrivanje napake uvoza.
Ne potrjujte OCR vrstice brez primerjave z izvirnikom.
Vsak popravek potrebuje sledljiv razlog in odgovorno osebo.
Pri podvojenem uvozu najprej določite veljavni dokument.
Po zaključku preverite razpoložljivost artikla in porabo recepture.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-8224e62e2fcb package=lite -->
### 43.6 Kartica: ali je ERP usklajen?

Preverite izvorni POS dokument in enolični identifikator prenosa.
Preverite stanje prenosa pred ročnim delom v ERP.
Preverite, ali ERP zapis predstavlja izvirnik ali sledljivo korekcijo.
Manjkajoča vrstica ni dovoljenje za ponoven celotni izvoz.
Podvojena knjižba ni dovoljenje za tiho brisanje.
Računovodstvo potrdi izbrani korektivni dokument.
Primerjajte znesek, obdobje, konto in enoto med sistemoma.
Po zaključku ponovno preverite sosednje dokumente v zaporedju.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-6ac702509eb0 package=lite -->
## 44. Predaja izmene med odprtim incidentom

Odhajajoči uporabnik preda dejstva, ne razlage brez dokazov.
Preda seznam odprtih naročil, računov, plačil in fiskalnih čakanj.
Preda identifikatorje, čase in izvedene varne korake.
Preda, kaj je prepovedano ponoviti do potrditve.
Prevzemnik potrdi razumevanje z branjem ID-jev, ne le z besedo »v redu«.
Vodja določi enega lastnika za vsak nejasen denarni primer.
Kuhinja prejme ločeno, jasno stanje vseh naročil v pripravi.
Računovodstvo prejme le preverjene podatke o fiskalnih ali ERP odstopanjih.
Osebni podatki se pri predaji omejijo na nujni operativni obseg.
Predaja se zaključi z naslednjim časom preverjanja in potjo eskalacije.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-235a47de286c package=lite -->
## 45. Redni vnos prejemnice brez OCR

OCR ni predpogoj za prejemnico in ni dokaz pravilnosti. Pri ročnem vnosu:

1. izberite pravilno podjetje, enoto in skladišče;
2. izberite dobavitelja ali ga pred potrditvijo preverite;
3. vnesite številko dokumenta in datum v obliki **dd.mm.yyyy**;
4. primerjajte artikel, pakiranje, enoto mere in količino z izvirnikom;
5. preverite nabavno ceno, DDV, rabat in kontrolni seštevek;
6. preverite, ali za istega dobavitelja in številko dokumenta že obstaja zapis;
7. shranite osnutek, kadar katera vrstica ni preverljiva;
8. potrdite šele po pregledu celotnega dokumenta;
9. po potrditvi preverite učinek na zalogo in morebitno WAC vrednost;
10. zapišite razlog in lastnika vsake izjeme.

Če uporabniški vmesnik za določeno vrsto dokumenta ne pokaže OCR uvoza, uporabite
ta ročni postopek. Ne predpostavljajte, da obstaja ločen OCR gumb, če ga v vaši
vlogi in enoti ne vidite.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-a2f5ee90bae8 package=lite -->
## 46. Čakalna vrsta offline fiskalizacije

Offline delo je dovoljeno samo na napravi z vnaprej dodeljenim in aktivnim
pooblastilom. Administrator pred uporabo preveri napravo, veljavnost pooblastila,
enoto in datum. Blagajnik ne aktivira offline načina sam.

Po vrnitvi povezave administrator oziroma pooblaščena oseba:

1. pregleda število čakajočih dokumentov in njihov fiskalni status;
2. loči potrjene, neuspele in neznane prenose;
3. izvede prenos oziroma ingest samo po odobrenem postopku;
4. pri konfliktu pregleda izvirni dokument, ZOI/EOR in identiteto poskusa;
5. ponovno poskusi samo dokument, za katerega je to dovoljeno;
6. prevzame nerešeni zapis v obravnavo, če sistem zahteva claim;
7. preveri, da je čakalna vrsta prazna šele po potrjenih odgovorih;
8. zapiše čas, napravo, obseg in rezultat.

Napaka ali transportno neznan status ni dovoljenje za novo izdajo računa.
Pri nejasnem stanju ne brišite čakalne vrste in ne uporabljajte druge blagajne
kot obvoda.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-227a1ca2e8ef package=lite -->
## 47. Kartično plačilo: izterjava neznanega poskusa

Pri neznanem rezultatu najprej poiščite kandidate plačilnega poskusa po
identifikatorju naročila, času, znesku, terminalu in ponudniku. Izberite
avtoritativni poskus šele po primerjavi POS-a in ponudnika. Nato:

- potrjeni poskus povežite z enim računom;
- zavrnjeni poskus pustite zavrnjen;
- transportno neznan poskus predajte vodji oziroma ponudniku;
- pri mešanem plačilu preverite vsak del in skupni seštevek;
- ne ponovite bremenitve samo zato, ker se zaslon vrti;
- po zaključku primerjajte dnevni seštevek ponudnika s POS evidenco.

Različni ponudniki imajo lahko različne statuse in časovne omejitve. Navodilo za
Payten, SumUp, Viva ali Tap-to-Pay uporabite samo, če je ta ponudnik dejansko
vezan na napravo. Viva demo ni dokaz produkcijskega plačila.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-7b82e895ab87 package=lite -->
## 48. Vidnost omejitev spletnih funkcij

Javni QR meni omogoča naročanje, klic natakarja in druge opisane QR funkcije,
vendar ni spletna rezervacijska platforma. V trenutni izvedbi ni javne internetne
rezervacije, spletnega nakupa darilnega bona ali Stripe plačila. Če se v podpori
pojavi zahteva za te funkcije, jo zabeležite kot zahtevo za razvoj oziroma
integracijo, ne kot incident obstoječega POS-postopka.

<!-- pos-heading: id=pos-11-vnos-uvoz-prejemnice-ocr-ef8d1b709949 package=lite -->
## 49. Vir za KPR pri prejetem računu

Po potrditvi prejetega `RACUN` preverite dobavitelja, številko in datum listine,
datum prejema, DDV-kodo, osnovo, DDV in odbitnost. Prejemnica brez računa je
lahko samo zalogovni vir in ne popoln zapis knjige prejetih računov (KPR).
`DOBROPIS` in `BREMEPIS` morata imeti povezavo na izvirni račun ter preverjen
učinek na zalogo, obveznost in DDV. Če manjka podatek ali povezava, dokument
zadržite in ga ne predajte kot popoln KPR.
