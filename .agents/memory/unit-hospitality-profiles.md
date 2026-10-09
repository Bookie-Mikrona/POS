---
name: Profili gostinskih enot
description: Pravila za profile, zmožnosti in začasne gostinske enote v POS-u.
---

Profil obrata je začetna predloga, ne trajna omejitev. Končni nabor funkcij se hrani ločeno na posamezni enoti in ga je mogoče ročno prilagoditi.

Spremembe privzetih profilov veljajo za nove enote; obstoječih enot ne usklajuj samodejno, tudi če njihova stara predloga ni skladna s POS paketi.

**Why:** Uporabnik izrecno zahteva popravke novih predlog brez sprememb obstoječih enot, strukture baze ali migracij.

**How to apply:** Posodobi strežniške in odjemalske predloge ter njihove opise in teste, ne izvajaj podatkovnih posodobitev.

Odvisnosti funkcij so poslovna pravila: dostava potrebuje telefonska naročila za naročnike, rezervacije potrebujejo mize, večhodni meniji pa kuhinjo. Stare nedosledne enote je dovoljeno urejati, če zahteva ne spreminja seznama funkcij.

**Why:** Uporabnik zahteva dosledne nove kombinacije, ne pa samodejnega spreminjanja obstoječih enot ali blokiranja njihovih drugih popravkov.

**How to apply:** Preveri končni seznam pri ustvarjanju in samo izrecno poslan seznam pri urejanju; pri napaki ne shrani ničesar in vrni uporabniku manjkajoče odvisnosti.

Sprotna opozorila odvisnosti v nastavitvah so informativna: ne vklapljajo funkcij samodejno in ne skrivajo gumba za shranjevanje. Strežniška validacija ostaja avtoritativna.

**Why:** Uporabnik želi razumljivo opozorilo že ob preklopu stikala, vendar mora izbira ostati njegova in neposredni API klici morajo ostati varovani.

**How to apply:** Strežnik in odjemalec uporabljata isto čisto politiko. Skupni odjemalski uvoz ne sme sprožiti povezave z bazo ali uvoziti strežniškega runtimea; uporabi namenski čisti vstop.

Premičnost sama po sebi ne pomeni začasnosti: food truck lahko deluje vse leto. Prva poslovna enota podjetja mora biti stalna tudi pri dogodkovnem profilu.

**Why:** Uporabnik je izrecno ločil celoletni food truck od časovno omejene prireditve; podjetje brez enot nima matične enote, na katero bi lahko vezalo prvo začasno enoto.

**How to apply:** Pri novih enotah uporabljaj ti poslovni pravili, ne spreminjaj obstoječih zapisov. Veselica in prireditvena stojnica pri nadaljnjih enotah ohranita začasno predlogo.

**Why:** Isto podjetje lahko hkrati upravlja restavracijo, bar, stojnico ali mobilno enoto, njihove potrebe pa se razlikujejo. Trdo kodiranje funkcij po profilu bi preprečilo legitimne izjeme.

**How to apply:** Navigacijo, neposredne poti in samostojne API-module vedno preverjaj proti zmožnostim aktivne enote. Obstoječe enote morajo ob migracijah ohraniti vse dosedanje funkcije.

Manjkajoč seznam zmožnosti mora odpovedati zaprto (brez dostopa), ne pomeniti »vse dovoljeno«. Menjava profila ne sme tiho prepisati ročnih prilagoditev; privzete vrednosti se ponovno uporabijo le z izrecno ponastavitvijo predloge.

**Why:** Profil je začetna predloga, dejanski seznam funkcij pa je varnostno in operativno pomembna nastavitev posamezne enote.

**How to apply:** API naj pri ustvarjanju uporabi strežniške privzete vrednosti profila. Odjemalec naj ohrani tudi namerno prazen seznam in naj brez prejetega seznama ne odpre nobene profilno varovane funkcije.

Strežniška politika POS poti mora odpovedati zaprto: vsaka poslovna pot ima zahtevano zmožnost, neznana pot se zavrne, administrativna izjema pa mora biti izrecna in dodatno varovana z lastno avtorizacijo.

**Why:** UI skrivanje ni varnostna meja; fail-open preslikava omogoči neposreden klic izklopljenega modula in pozabljene nove poti.

**How to apply:** Specifične pod-poti razreši pred splošnimi družinami poti (npr. dostava znotraj naročila). Superadmin bypass ostane izrecen.

Skrbnik podjetja in skrbnik enote morata lahko odpreti Nastavitve tudi brez zmožnosti `settings` ali še izbrane enote. Poslovni obrazci znotraj nastavitev ostanejo vezani na dejansko enoto in njene dovoljene funkcije.

**Why:** Nastavitve so potrebne za začetno vzpostavitev ali popravljanje manjkajoče enote. Če navigacija dovoli vstop, preverjanje neposredne poti pa ga zavrne, nastane zavajajoče opozorilo in uporabnik težko opravi začetno nastavitev.

**How to apply:** Administrativno izjemo uskladi med navigacijo in neposrednimi potmi, ne razširi je na poslovne funkcije. Brez enote prikaži navodilo za vzpostavitev namesto praznega obrazca za dodajanje miz.

Začasne in mobilne enote morajo imeti veljavno obdobje delovanja ter matično enoto istega podjetja; same sebi ne morejo biti matične. Ta pravila veljajo tudi kot DB-omejitve. Dogodkovna povezava določa obdobje in lokacijo.

**Why:** Delni ali zastareli dogodkovni podatki omogočijo začasno enoto zunaj dogodka oziroma jo napačno povežejo z drugim podjetjem.

**How to apply:** Validiraj končno združeno stanje tudi pri delnih posodobitvah. Spremembo obdobja dogodka prenesi na vse povezane začasne enote. Odklop dogodka enoto atomsko spremeni v navadno ter počisti matično enoto, datume in lokacijo; začasna enota brez teh polj ne sme obstajati.

Dovoljenje dogodkovnega osebja mora imeti pozitivno obdobje, ki je v celoti znotraj dogodka. Sprememba dogodka in njegovih dovoljenj je ena transakcija; DB preverjanje je odloženo do zaključka in ob vstavitvi dovoljenja zaklene dogodek.

**Why:** Zaporedni `CHECK` testi ne preprečijo sočasnega write-skew, kjer dovoljenje in dogodek vsak potrdita staro stanje ter skupaj pustita dostop zunaj dogodka.

**How to apply:** Ob spremembi začetka ali konca dogodka atomsko premakni vsa dovoljenja. Neposredni zapis naj gre skozi odloženi constraint trigger, ki serializira preverjanje na vrstici dogodka.

Preklican ali zaključen dogodek ne sme imeti nerevokiranega dovoljenja osebja. Terminalni status in revokacija sta ena transakcija; poznejša sprememba statusa ne sme samodejno oživiti starega dostopa.

**Why:** Časovno veljavno dovoljenje bi sicer ostalo uporabno do prvotnega konca tudi po predčasnem zaključku ali preklicu dogodka.

**How to apply:** Ob terminalnem statusu nastavi `revoked` samo še aktivnim dovoljenjem. Odloženi DB-trigger naj blokira terminalni dogodek z aktivnim dovoljenjem in novo aktivno dovoljenje na terminalnem dogodku.

Veljavni statusi dogodka imajo en skupen izvožen seznam za Drizzle tip in API-politiko, PostgreSQL pa mora imeti še dejanski validirani `CHECK`; TypeScript enum sam ne ščiti neposrednega SQL.

**Why:** Podvojeni seznami se lahko razidejo, Drizzle `text(..., { enum })` pa ne ustvari DB-omejitve in zato ni varnostna meja za uvoz.

**How to apply:** Iz skupnega seznama izpelji tip in API-validacijo. Migracija naj pred dodajanjem ali uskladitvijo `CHECK` najprej prešteje neznane stare vrednosti in ob njih odpove brez tihega popravka.

Enako pravilo velja za vrsto dogodka: `festival`, `wedding`, `catering`, `celebration`, `other` so en skupen seznam za Drizzle in API ter točen validirani PostgreSQL `CHECK`.

**Why:** Zgodovinska DB-omejitev je lahko pravilna, a če je Drizzle ne opisuje in API podvaja vrednosti, prihodnja sprememba povzroči drift med tremi plastmi.

**How to apply:** Pri uskladitveni migraciji primerjaj celotno normalizirano definicijo omejitve, ne le prisotnosti imen; manjkajočo ali permisivno omejitev po preflightu zamenjaj in migracijsko testiraj.

Pot `/events` je rezervirana za obstoječi SSE-kanal sprotnih POS-posodobitev; poslovna evidenca dogodkov uporablja `/pos-events`.

**Why:** Enaka pot za SSE in JSON CRUD povzroči, da Express vedno prestreže seznam dogodkov z odprtim SSE-odgovorom.

**How to apply:** Novih poslovnih API-jev ne registriraj na `/events`; ob spremembi poti uskladi OpenAPI in generirani odjemalec.