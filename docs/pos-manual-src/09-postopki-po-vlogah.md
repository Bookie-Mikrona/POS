<!-- pos-heading: id=pos-09-postopki-po-vlogah-42b3ccb656c5 package=lite -->
# 09 Nastavitve, naprave, uporabniki in varnost

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d362a39a2a64 package=lite -->
## 1. Namen in meja tega poglavja

To je sklic za skrbnike, ne navodilo za vsakodnevno strežbo.
Delovne tokove opisujejo poglavja 01–08: dostop v 01, začetek izmene v 02, naročila v 03, meni v 04, pripravo v 05, plačila v 06, zalogo v 07 in zaključek dneva v 08.
To poglavje je osrednje mesto za nastavitve, naprave, uporabnike in varnost.

Spremembo izvaja samo oseba z ustrezno vlogo.
Nastavitve vedno spreminjajte v pravilnem podjetju in enoti.
Pred shranitvijo preberite obseg spremembe in po shranitvi preverite rezultat.
Ne uporabljajte skupnih uporabniških računov.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-ddfd67304389 package=lite -->
## 2. Uporabniške vloge, delo in zmožnosti

V POS-u je `vloga` polje uporabniškega računa, ne seznam nazivov delovnih mest.
Skrbniški vmesnik in API za uporabnike razlikujeta vloge `admin`,
`admin_enote` in `uporabnik`; `superadmin` je posebna skrbniška vloga.
Uporabniški račun `uporabnik` se veže na enoto. `admin_enote` je omejen na
dodeljeno enoto, `admin` upravlja uporabnike v okviru podjetja, `superadmin`
pa ima sistemski skrbniški dostop.

Natakar, kuhar, natakarica pri šanku, blagajnik, skladiščnik in vodja izmene
so opisi dela oziroma operativne odgovornosti v tem priročniku, ne ločene
vrednosti uporabniške vloge v POS-u. Zlasti zapis natakarja v zavihku
»Natakarji« je operativni zapis osebe za izmene in hitro menjavo identitete;
ni sam po sebi uporabniški račun ali dokaz, da ima oseba pravico do vseh
funkcij natakarja. POS PIN za hitro menjavo nastavi administrator, hitra
menjava pa zahteva veljavno izmeno natakarja v aktivni enoti.

Dejanski dostop do funkcije je odvisen od vloge računa, dodeljene enote ter
zmožnosti te enote in paketa POS. Seznam zmožnosti enote (na primer zaloge,
meni, KDS, računi ali nastavitve) ne predstavlja profilov delovnih mest.
Vloga sama po sebi tudi ne pomeni, da je določena blagajna, terminal ali
fizična naprava dodeljena uporabniku. Dodeljujte samo tiste pravice in
poslovne kontekste, ki so potrebni za delo; ne ustvarjajte fiktivnih profilov
»kuhinja«, »blagajnik« ali »skladiščnik«, če jih uporabniški vmesnik ne ponuja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-4817760c8418 package=lite -->
## 3. Uporabniki in dostop

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e1f0000e4ea5 package=lite -->
### 3.1 Ustvarjanje uporabnika

1. Preverite identiteto osebe in potrebo po dostopu.
2. Izberite dejansko uporabniško vlogo in zahtevano enoto. Vloge ne izbirajte
   po nazivu delovnega mesta.
3. Preverite zmožnosti izbrane enote in paketa; ne obljubite dostopa do
   posamezne naprave ali blagajne, če nastavitev tega ne prikazuje.
4. Uporabnika povabite oziroma nastavite začetni dostop po varnem internem postopku.
5. Oseba se prijavi sama in preveri prikaz svoje enote.
6. Zabeležite odobritev, datum in skrbnika spremembe.

Gesla, potrditvenih kod in sejnih povezav ne pošiljajte v skupinski klepet.
Ne vpisujte jih v komentarje, posnetke zaslona ali zahteve podpori.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f264de757ef1 package=lite -->
### 3.2 Sprememba in ukinitev

Ob menjavi dela najprej pregledajte aktivne vloge in naprave.
Odstranite dostop, ki ga oseba ne potrebuje več.
Ob odhodu dostop ukinite takoj, ne ob naslednjem mesečnem pregledu.
Ne brišite zgodovinskih zapisov, naročil ali revizijske sledi uporabnika.
Če je uporabnik zaklenjen, preverite razlog; ne ustvarjajte dvojnega računa.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9164cc1f5fd1 package=lite -->
### 3.3 Redni pregled

Enkrat mesečno primerjajte aktivne uporabnike s kadrovsko evidenco.
Preglejte administratorske, blagajniške in zalogovne pravice posebej.
Preverite uporabnike brez aktivnosti in račune nekdanjih sodelavcev.
Odstopanje dokumentirajte ter ga odpravi pooblaščeni skrbnik.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-7ad28d5961ed package=lite -->
## 4. Enote, blagajne in terminali

Enota je poslovni kontekst prodaje.
Blagajna je evidenčno prodajno mesto v tej enoti.
Terminal je plačilna naprava; ni nadomestek za blagajno.

Pred začetkom dela preverite:

1. pravilno podjetje;
2. pravilno enoto;
3. pravilno blagajno;
4. poslovni datum in odprto izmeno;
5. dodelitev terminala;
6. dosegljivost tiskanja, če je predvideno.

Blagajne ali enote ne menjajte sredi plačilnega postopka.
Ne ustvarjajte nadomestne blagajne zato, ker obstoječe ne vidite.
Če je enota zastarela ali ni več aktivna, ustavite prodajo na njej in obvestite skrbnika.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-1651582da1ab package=lite -->
## 5. Tiskalni mostovi in tiskalniki

Tiskalni most povezuje POS z lokalnim tiskalnikom.
Most naj teče na določeni, vzdrževani napravi z zanesljivo povezavo.
Naprava ne sme prehajati v spanje med obratovanjem.

Za vsak tiskalnik določite:

| Podatek | Preverjanje |
|---|---|
| Namen | račun, kuhinja, bar ali poročilo |
| Enota | ujema se z lokacijo tiskalnika |
| Most | aktiven in povezan |
| Omrežje | tiskalnik je dosegljiv |
| Papir | pravilna rola in čitljiv izpis |
| Preskus | en kontrolni izpis po spremembi |

Ne spreminjajte hkrati naprave, mostu in usmerjanja tiskanja.
Najprej zabeležite trenutno stanje, nato spremenite eno plast in preskusite.
Če tisk ne uspe, najprej preverite, ali je dokument že izdan; ponatis ni nova izdaja.
Podrobni postopki tiskanja so v poglavju 06, izredni primeri pa v 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-72b835b1166e package=lite -->
## 6. FURS in digitalno potrdilo

Fiskalna konfiguracija je občutljiva nastavitev.
Digitalno potrdilo in njegovo geslo obravnavajte kot zaupna podatka.
Potrdila ne pošiljajte podpori, po e-pošti ali v klepetu, razen po odobrenem varnem postopku.

Pred uporabo preverite:

1. podjetje in davčne podatke;
2. pravilno poslovno enoto in oznako blagajne;
3. veljavnost potrdila;
4. pooblaščeno osebo za namestitev oziroma obnovo;
5. preskus samo po internem postopku.

Pred potekom potrdila načrtujte obnovo.
Ob napaki ne menjajte potrdila na pamet in ne izdajajte podvojenega računa.
Račun, EOR in napake preverjajte po postopku iz poglavja 06.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a914cc6ce1b7 package=extended -->
## 7. QR, CTI in druge integracije

QR meni, CTI/telefon, ERP, terminal in dostava so ločeni integracijski tokovi.
Za vsakega določite lastnika, enoto, namen, način preverjanja in stik za eskalacijo.

| Integracija | Preverite pred vklopom | Ne počnite |
|---|---|---|
| QR meni | meni, cene, razpoložljivost, kanal naročila | ne objavite nepreverjenega menija |
| CTI | številko, uporabnika, dovoljenja, test klica | ne razkrivajte podatkov klicalca |
| Terminal | dodelitev, ponudnika, referenco transakcije | ne ponavljajte nejasnega plačila |
| ERP | podjetje, kontiranje, obdobje, stanje prenosa | ne knjižite istega izvoza dvakrat |
| Tiskalni most | cilj, omrežje, preskusni izpis | ne preusmerjajte vseh tiskov brez preskusa |

Žetone, ključe in poverilnice integracij hrani samo za to določen upravljavec.
V navodilih, izvozih in zahtevkih uporabljajte oznake, ne skrivnosti.
Po spremembi preverite en reprezentativen, neobčutljiv primer.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f02ac68c4a35 package=lite -->
## 8. Varen vrstni red konfiguracije

Konfiguracijo izvajajte izven največje gneče.
Če sprememba vpliva na prodajo, obvestite vodjo izmene pred začetkom.

1. Določite namen, obseg, odgovorno osebo in možnost povrnitve.
2. Preverite podjetje, enoto, aktivnost izmene in odprta naročila.
3. Zabeležite trenutno vrednost ali naredite odobren zapis spremembe.
4. Najprej uredite osnovne podatke in pravice.
5. Nato nastavite enoto, blagajno, napravo ali integracijo.
6. Šele nato spremenite usmerjanje tiskanja, QR ali avtomatizacijo.
7. Shranite eno smiselno spremembo.
8. Izvedite omejen preskus in preverite dejanski rezultat.
9. Zapišite datum, izvajalca, učinek in morebitno nadaljnje delo.
10. Šele potem sprostite spremembo za redno uporabo.

Pri cenah, davkih, fiskalizaciji, plačilih in kontiranju naj spremembo pregleda druga pooblaščena oseba, kadar to določa interni pravilnik.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9a08c0f6befa package=lite -->
## 9. Prepovedani bližnjici

Ne delite prijave.
Ne izklapljajte varnosti zaradi hitre rešitve.
Ne uporabljajte produkcijskih skrivnosti v preskusih.
Ne brišite dokumentov, da bi prikrili napačno nastavitev.
Ne ponavljajte kartične transakcije, kadar rezultat ni potrjen.
Ne spreminjajte FURS podatkov med odprtim prodajnim tokom.
Ne nameščajte neznanih programov na napravo tiskalnega mostu.
Ne pošiljajte baz, celotnih izvozov ali potrdil podpori brez odobritve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-14bf06727fe5 package=lite -->
## 10. Predaja skrbniku ali podpori

V zahtevek vključite datum in čas, podjetje/enoto, uporabniško vlogo, napravo, dejanje, vidno sporočilo in številko dokumenta, kadar obstaja.
Dodajte, ali je bil rezultat preverjen v arhivu oziroma na terminalu.
Ne dodajajte gesel, PIN-ov, zasebnih ključev, celotnih številk kartic ali sejnih žetonov.
Pri incidentu najprej zaščitite delo gostov in revizijsko sled, nato zbirajte podatke.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-26677a9796f0 package=lite -->
## 11. Sklici

Za dostop glejte 01.
Za začetek izmene in delovno okolje glejte 02.
Za plačila, FURS in tisk glejte 06.
Za QR, telefon in pripravo glejte 05.
Za zaloge in dokumente glejte 07.
Za konec izmene, poročila in POS→ERP glejte 08.
Za simptome in varne ukrepe glejte 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-4173684e4a33 package=lite -->
## 12. Varen vrstni red konfiguracije

Konfiguracija je nadzorovana sprememba, ne zbir naključnih stikal.
Izvajajte jo izven največje obremenitve.
Med nedokončanim plačilom ne spreminjajte ničesar.
Med odprtim fiskalnim postopkom ne menjajte konteksta.
Za vsako spremembo določite lastnika, razlog in čas.
Zapišite trenutno vrednost pred spremembo.
Zapišite pričakovani rezultat preskusa.
Zapišite način varne vrnitve.

1. Preverite podjetje in pravne podatke.
2. Preverite ali ustvarite enoto.
3. Določite poslovni prostor.
4. Določite register oziroma blagajno.
5. Določite naprave in njihove lastnike.
6. Določite uporabniške vloge, dodeljene enote in omejitve zmožnosti.
7. Povežite tiskalne poti.
8. Povežite terminal in ponudnika.
9. Nastavite FURS ter QR javni prikaz.
10. Vključite CTI, ERP ali BizBox.
11. Izvedite omejen preskus.
12. Spremljajte prvi dejanski servis.

Ne ustvarjajte nove enote zaradi težave s tiskom.
Ne ustvarjajte nove blagajne zaradi zaklenjene izmene.
Ne menjajte terminala sredi plačila.
Ne vključujte integracije pred preverjanjem izvornih podatkov.
Spremenite eno logično skupino nastavitev naenkrat.
Po shranitvi nastavitev znova odprite in preverite.
Ne klikajte shranjevanja večkrat.
Ne urejajte iste nastavitve v dveh brskalnikih.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a6badbc79332 package=lite -->
## 13. Organizacijski objekti

Podjetje je pravna meja podatkov.
Enota je operativna lokacija prodaje.
Poslovni prostor je fiskalno določen kraj.
Register je identiteta prodajnega mesta.
Naprava je fizični odjemalec ali periferija.
Miza je točka strežbe in ni blagajna.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-848a236fbdef package=lite -->
### 13.1 Podjetje

- Preverite uradno ime podjetja.
- Preverite davčno identifikacijo.
- Preverite naslov in odgovorno osebo.
- Preverite časovni pas poslovanja.
- Preverite valuto in davčna pravila.
- Preverite aktivne enote.
- Preverite lastnike integracij.
- Preverite administratorske uporabnike.
- Preverite veljavnost ključnih potrdil.
- Preverite, katero podjetje je izbrano na zaslonu.

Spremembo pravnih podatkov uskladite z računovodstvom.
Zgodovinskih podjetij ne brišite zaradi krajšega seznama.
Po spremembi pravnih podatkov preverite vzorčni dokument.
Neaktivnost nastavite šele po zaključku obveznosti.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-bc0ff46cca9d package=lite -->
### 13.2 Enota

- Uporabite nedvoumno ime enote.
- Vnesite fizično prepoznavno lokacijo.
- Določite aktivno stanje.
- Določite odgovornega vodjo.
- Določite dovoljene uporabnike.
- Določite povezane registre.
- Določite pripravljalne poti.
- Določite povezane terminale.
- Določite skladiščni kontekst.
- Določite kontakt za nujni poseg.

Pred aktivacijo preverite prikaz menija iz 04.
Pred aktivacijo preverite usposobljenost osebja.
Pred deaktivacijo zaključite izmene.
Pred deaktivacijo preverite odprta naročila.
Pred deaktivacijo preverite nedokončana plačila.
Ne uporabite enote kot nadomestek za posameznega natakarja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-829d70eca196 package=lite -->
### 13.3 Poslovni prostor

- Potrdite identifikator prostora.
- Potrdite fizični naslov prostora.
- Potrdite povezavo s pravilno enoto.
- Potrdite fiskalni status.
- Potrdite datum začetka uporabe.
- Potrdite odgovorno osebo.
- Potrdite, da ne gre za testni prostor.
- Potrdite skladnost z uradnimi evidencami.
- Potrdite dokumentacijo odobritve.
- Potrdite potrebo za dejansko prodajo.

Ne uporabite identifikatorja zaprte lokacije za novo lokacijo.
Ne predpostavljajte, da sprememba naslova velja v vseh povezavah.
Če je fiskalna posledica nejasna, ustavite prodajo in eskalirajte.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d063742e1d8a package=lite -->
### 13.4 Register in blagajna

- Izberite pripadajoče podjetje.
- Izberite pripadajočo enoto.
- Izberite pripadajoči poslovni prostor.
- Vnesite jasno ime registra.
- Preverite oznako registra.
- Določite uporabo gotovine.
- Določite dovoljene uporabnike.
- Določite tisk računa.
- Določite terminal.
- Določite način začetka izmene.

Register ima lastno zgodovino in odgovornost.
Pri zamenjavi tablice ohranite register, če prodajno mesto ostaja isto.
Ne ustvarite novega registra za obvoz napake.
Za odprtje in zaključek izmene glejte 02 in 08.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-91b4b0a6e8bd package=standard -->
### 13.5 Mize in območja

- Ime območja naj opisuje fizični prostor.
- Številka mize naj bo enolična v enoti.
- Načrt primerjajte s fizičnim prostorom.
- Ne uporabite iste oznake za teraso in notranjost.
- Za prevzem določite ločeno oznako.
- Za dostavo uporabite odobren tok.
- Ne ustvarjajte lažnih miz za začasne račune.
- Ne skrivajte odprtega naročila z zapiranjem mize.
- Spremembe območij izvajajte izven strežbe.
- Po spremembi preverite prenos naročila.

Za naročila in mize glejte 03.
Za meni glejte 04.
Za pripravljalne oznake glejte 05.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e79b4ff3e3c8 package=lite -->
## 14. Uporabniki, vloge in dostop

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d2c21f7b01bb package=lite -->
### 14.1 Najmanjše pravice

Nosilci v tabeli so delovne odgovornosti, ne uporabniške vloge, ki bi jih
skrbnik izbral pri ustvarjanju računa. Dejanski dostop preverite glede na
uporabniško vlogo in zmožnosti enote.

| Zmožnost | Običajni nosilec | Preverjanje |
|---|---|---|
| Mize in naročila | natakar | test naročila |
| Priprava | kuhinja/bar | test prikaza |
| Plačilo | blagajnik | test računa |
| Prejem blaga | skladiščnik | test dokumenta |
| Lokalni nadzor | vodja izmene | pregled enote |
| Meni in poročila | manager | pregled vpliva |
| Uporabniki | administrator | pregled pravic |
| FURS in integracije | pooblaščen administrator | kontrolni zapis |

Pravica za pregled ni pravica za spremembo.
Pravica za spremembo ni pravica za brisanje.
Pravica za ponatis ni pravica za novo izdajo računa.
Pravica za terminal ni pravica za ponovni bremenitveni poskus.
Pravica za zalogo ni pravica za fiskalne nastavitve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-71b1a1bb5a49 package=lite -->
### 14.2 Dodelitev

1. Prejmite zahtevo z razlogom in odobritvijo.
2. Preverite identiteto osebe.
3. Preverite delovno mesto in enoto.
4. Izberite dejansko uporabniško vlogo in dodeljeno enoto, ki ustrezata
   potrebnemu dostopu.
5. Ne ustvarjajte nadomestne vloge za naziv delovnega mesta; dokumentirajte
   morebitno izjemo po internem postopku.
6. Nastavite datum začetka in poteka, kjer je mogoče.
7. Povežite samo dovoljene enote.
8. Odstranite stare nepotrebne vloge.
9. Uporabnika seznanite z osebnim dostopom.
10. Zapišite izvajalca in rezultat.

Ne dodeljujte administratorja zaradi vrste gostov.
Ne dodeljujte pravic prek računa odsotnega sodelavca.
Ne uporabljajte skupnega računa za izmensko delo.
Začasnemu dostopu določite datum ukinitve.
Ob odhodu osebe dostop ukinite takoj.
Zgodovinskih zapisov uporabnika ne brišite.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-8e5cae4e6da3 package=lite -->
### 14.3 Redni pregledi

Tedensko preglejte nove administratorje.
Tedensko preglejte potekle začasne pravice.
Mesečno primerjajte uporabnike s kadrovsko evidenco.
Mesečno preglejte račune brez aktivnosti.
Mesečno preglejte dostop nekdanjih sodelavcev.
Četrtletno preglejte občutljive zmožnosti.
Četrtletno preglejte lastnike integracij.
Vsako odstopanje dobi lastnika in rok odprave.
Dokaz pregleda hranite po pravilniku.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-966ea2e12405 package=lite -->
## 15. Tiskalniki, ZCS, NB80, NYX in Bluetooth

Za vsak izhod določite primarno in odobreno rezervno pot.
Račun ne sme samodejno pristati na kuhinjskem tiskalniku.
Kuhinjski listek ne sme pristati na tiskalniku računov.
Barni izhod usmerite v pravi bar.
Pizza izhod usmerite na pizza postajo.
Poročilni tisk ne sme ovirati priprave.

| Izhod | Primarni cilj | Lastnik |
|---|---|---|
| Račun | blagajniški tiskalnik | blagajnik |
| Kuhinja | kuhinjski tiskalnik ali KDS | kuhinja |
| Bar | barski tiskalnik ali KDS | bar |
| Pizza | pizza postaja | vodja kuhinje |
| Poročilo | pisarniška pot | manager |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9d4ddb5391b3 package=lite -->
### 15.1 Skupna priprava

- Napravo postavite na suho stabilno mesto.
- Označite jo s sistemskim imenom in lokacijo.
- Preverite stabilno napajanje.
- Preverite omrežno povezavo.
- Preverite dovolj papirja.
- Preverite čitljivost po menjavi role.
- Onemogočite neželeno spanje gostitelja mostu.
- Zaščitite nastavitve gostitelja.
- Ne nameščajte neodobrenih programov.
- Ne uporabite zasebnega računa zaposlenega za most.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-09d8ce92f973 package=lite -->
### 15.2 ZCS

ZCS uporabljajte na evidentirani podprti napravi.
Mostu dodelite tehničnega lastnika.
Pred servisom preverite status povezave.
V POS-u preverite pravo enoto.
V POS-u preverite pravo vrsto izhoda.
Po spremembi naredite en kontrolni izpis.
Ne pošiljajte serije preskusov v živo kuhinjo.
Ob nedosegljivosti zberite ime naprave, čas in status.
Ne spreminjajte vseh tiskalnikov hkrati.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-2e4a5d0807ae package=lite -->
### 15.3 NB80 in NYX

NB80 označite z območjem uporabe.
Preverite napajanje in omrežje NB80.
Preverite pravilno rolo in zaprt pokrov.
Preverite čitljiv in poravnan izpis.
Ne menjajte IP-naslova brez zapisa stare vrednosti.
NYX evidentirajte z lokacijo in serijsko oznako.
NYX povežite s pravilnim mostom.
Preskusite iz POS-a, ne le iz operacijskega sistema.
Preverite, da izpis ni podvojen drugje.
Po menjavi naprave posodobite evidenco sredstev.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-b234325de823 package=lite -->
### 15.4 Bluetooth mostovi

Bluetooth uporabite le, kadar je to odobrena rešitev.
Most postavite blizu določene naprave.
Seznanite točno določen tiskalnik.
Ne parite iz osebnega telefona zaposlenega.
Preverite obnovitev povezave po zagonu.
Preverite, da druga naprava ne prevzame povezave.
Most fizično zaščitite pred dostopom gostov.
Zapišite identifikator mostu po internem pravilu.
Pri nestabilnosti uporabite odobreno rezervno pot.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6b134e3491ff package=lite -->
### 15.5 Preskus tiskanja

1. Izberite preskus brez gostove obveznosti.
2. Preverite podjetje in enoto.
3. Sprožite en kontrolni izhod.
4. Preverite ciljno napravo.
5. Preverite čas, vsebino in čitljivost.
6. Preverite, da se izhod ni podvojil.
7. Preverite neprizadetost drugih izhodov.
8. Zapišite rezultat in obvestite lastnika.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e126db1a897f package=lite -->
## 16. Terminali in ponudniki

POS vodi račun in stanje plačila.
Terminal izvaja kartično transakcijo pri ponudniku.
Ponudnik vrne rezultat in referenco.
En sam zaslon ni dovoljšen dokaz uspeha.
Pri neskladju ne ponavljajte bremenitve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-62d091d9bc34 package=lite -->
### 16.1 Pred seznanjanjem

- Potrdite ponudnika terminala.
- Potrdite serijsko oznako terminala.
- Potrdite enoto in register.
- Potrdite omrežno dostopnost.
- Potrdite pooblaščenca za povezavo.
- Potrdite, da plačilo ni v teku.
- Potrdite, da druga naprava ni povezana.
- Zapišite staro povezavo za vrnitev.
- Pripravite odobren preskus.
- Obvestite blagajnika o posegu.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-3ddca9d1ee65 package=lite -->
### 16.2 Seznanjanje in menjava

1. Odprite nastavitve pravega registra.
2. Izberite podprtega ponudnika.
3. Vnesite le zahtevane podatke.
4. Skrivnosti ne zapišite v zahtevek ali posnetek zaslona.
5. Potrdite povezavo enkrat.
6. Počakajte na jasen status.
7. Izvedite odobren preskus.
8. Preverite referenco in rezultat.
9. Zapišite čas, izvajalca in napravo.
10. Potrdite, da stara naprava ne prejema zahtev.

Pri nejasnem rezultatu zapišite čas, znesek, naročilo in referenco.
Preverite POS in nato ponudnika po odobreni poti.
Ne ustvarite novega računa za prikritje nejasnega plačila.
Za plačilni postopek glejte 06.
Za incident glejte 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6977730afbde package=extended -->
## 17. FURS, QR, CTI, ERP in BizBox

<!-- pos-heading: id=pos-09-postopki-po-vlogah-0e130c8c4465 package=extended -->
### 17.1 FURS

FURS potrdilo je občutljiv poslovni element.
Dostop omejite na pooblaščene skrbnike.
Potrdila ne pošiljajte po klepetu ali e-pošti.
Zasebnega ključa ne vključujte v posnetke zaslona.
Pred uvozom preverite podjetje in veljavnost.
Pred zamenjavo zapišite stanje starega potrdila.
Po uvozu preverite status brez razkrivanja skrivnosti.
Spremljajte rok veljavnosti.
Ob sumu kompromitacije takoj eskalirajte.
Fiskalne napake rešujte po postopku iz 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a9185b6f5def package=extended -->
### 17.2 QR in CTI

QR koda mora voditi na pravilno javno vsebino.
Pred objavo preverite enoto, jezik in meni.
Preverite cene, alergene in razpoložljivost.
Preverite delovanje z običajnim telefonom gosta.
Ne objavite povezave do administracije.
Ne tiskajte nove kode pred potrditvijo vsebine.

Zaključena zgodovina QR naprav se hrani največ 30 dni. Če jo potrebujete za
reševanje reklamacije ali podpornega primera, pravočasno shranite dovoljeni
izvoz oziroma nujne identifikatorje. Ne pričakujte, da bo po poteku tega roka
zgodovina naprave še na voljo.
Za QR in telefonska naročila glejte 05.
CTI povežite le z odobrenimi številkami in ponudnikom.
Ne zapisujte podatkov kartice v opombo klica.
Preverite, v katero enoto nastane telefonsko naročilo.
Preverite ročni postopek ob izpadu telefonije.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6d7eb9563d06 package=extended -->
### 17.3 ERP in BizBox

Določite vir resnice za vsak podatek.
Določite smer prenosa za artikle, račune in partnerje.
Določite pogostost prenosa.
Določite lastnika zavrnjenih zapisov.
Ne spreminjajte šifer artiklov brez uskladitve z 04 in 07.
Ne brišite neuspelega prenosa brez razloga.
Ne predpostavljajte, da integracija pomeni varnostno kopijo.
Po spremembi izvedite kontrolni prenos.
Preverite, da se dokument ni prenesel dvakrat.
Za zaključni prenos in poročila glejte 08.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-7d30b72d5e43 package=lite -->
## 18. Seje, predpomnilnik, varnost in revizija

Seja pripada uporabniku, ne napravi.
Ob odhodu napravo zaklenite ali se odjavite.
Ne delite aktivne seje.
Ne shranjujte gesel na skupnem odjemalcu.
Ne puščajte administracije odprte na blagajni.
Ob poteku seje se prijavite znova.
Pred nadaljevanjem preverite enoto.
Za dostop glejte 01.

Predpomnilnik lahko po spremembi kaže star prikaz.
Najprej preverite, ali je sprememba shranjena.
Nato osvežite po odobrenem postopku.
Ne naredite iste spremembe znova zaradi starega prikaza.
Preverite stanje na drugem pooblaščenem odjemalcu.
Ob različnih stanjih ustavite množično urejanje.

Revizijska sled beleži kdo, kaj, kdaj in v katerem kontekstu.
Ne brišite uporabnika zaradi obstoječih zgodovinskih zapisov.
Ob stornu zapišite dejanski razlog.
Ob administrativni spremembi zapišite poslovni razlog.
Ne spreminjajte časa naprave za prilagoditev zapisa.
Vpogled v revizijo omejite na pooblaščene osebe.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-045f2e9c9a8b package=lite -->
## 19. Kopije, zdravje in vrnitev

Varnostna kopija ni isto kot izvoz poročila.
Določite obseg, pogostost, hrambo in lastnika kopije.
Ne hranite edine kopije na isti napravi kot izvor.
Določite postopek obnovitvenega preskusa.
Določite, kdo sme zahtevati obnovitev.
Obnovitve ne izvajajte v produkciji brez odobritve.
Po obnovitvi ne podvajajte integracijskih prenosov.

Pred odprtjem preverite enote, registre, terminale in tisk.
Preverite papir, napajanje in pripravljalne prikaze.
Preverite opozorila integracij in veljavnost potrdil.
Med servisom spremljajte tiskalne vrste in terminalske napake.
Spremljajte prekinjene seje in neuspele prenose.
Po spremembi preverite shranjeno vrednost in revizijsko sled.

Če preskus ne uspe, ustavite nadaljnje posege.
Zaščitite naročila, račune in plačila.
Obvestite vodjo prizadete enote.
Uporabite zapisano predhodno vrednost.
Vrnite samo prizadeto logično skupino.
Preskusite kritični tok v pravilni enoti.
Zapišite razlog, čas in izvajalca vrnitve.
Za incident uporabite poglavje 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-dc8e58ddb443 package=lite -->
## 20. Katalog zaslonov, polj in stanj

Ta katalog opisuje vidne sklope trenutnih nastavitev.
Ime zavihka ni dovoljenje za spremembo.
Razpoložljivost zavihka je odvisna od vloge.
Pred urejanjem vedno preverite izbrano enoto.
Če polja ne vidite, ne iščite obvoda z drugim računom.
Za dostop in vloge je avtoritativno poglavje 01.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-cad506feb355 package=standard -->
### 20.1 Zavihek Mize

Zavihek vsebuje upravljanje prostorov in miz.
Prostor je npr. Notranjost ali Terasa.
Polje »Ime prostora« določa naziv območja.
Gumb »Dodaj« ustvari prostor šele po veljavnem vnosu.
Prostor preverite v seznamu pred dodeljevanjem miz.
Miza mora pripadati razumljivemu prostoru.
Ime ali številka mize ne sme zamenjati druge aktivne mize.
Sprememba prostora vpliva na prikaz strežbe.
Spremembo načrta opravite med mirnim obdobjem.
Po spremembi preverite naročilo iz 03.

Stanje brez prostorov pomeni, da območij še ni mogoče izbrati.
Stanje praznega imena ne sme ustvariti prostora.
Stanje podvojene oznake zahteva pregled pred shranitvijo.
Stanje odprte mize zahteva predajo, ne brisanja.
Stanje nevidne mize zahteva preverjanje filtra in enote.
Stanje napačnega prostora zahteva varen prenos po 03.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-2d47a8738d58 package=lite -->
### 20.2 Zavihek Natakarji

Zavihek »Natakarji« upravlja operativne zapise natakarjev, ne pa uporabniških
vlog `admin`, `admin_enote` ali `uporabnik`. Zapis natakarja se uporablja v
operativnem delu in pri izmeni; ni enakovreden Clerk/POS uporabniškemu računu.
Administrator lahko natakarju nastavi POS PIN za hitro menjavo. PIN naj ne
nadomesti individualnega računa za skrbniške ali druge funkcije.

Pred uporabo hitre menjave preverite osebo in aktivno enoto ter zagotovite, da
ima natakar odprto izmeno. Če izmena ni odprta, POS hitre menjave ne sprejme.
Zaklenjenega uporabniškega računa ne obidite z novim natakarjevim zapisom ali
PIN-om. Prisotnost natakarja v tem zavihku ne podeli pravic za blagajno,
nastavitve ali drugo uporabniško funkcijo; te so odvisne od računa, enote in
zmožnosti.
Za življenjski cikel dostopa glejte 01 in 14.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-59f52bf03f27 package=extended -->
### 20.3 Zavihek Dostava

Zavihek določa operativne nastavitve dostavnega toka.
Pred spremembo določite lastnika dostavnega procesa.
Preverite razliko med prevzemom in dostavo.
Preverite, kam se pošlje naročilo iz dostave.
Preverite, kateri tiskalnik oziroma KDS prejme nalogo.
Preverite, kdo prejme naročilo ob predaji vozniku.
Ne spreminjajte dostavnega toka med aktivnimi naročili.
Po spremembi izvedite neprodukcijski scenarij.
Za telefonsko naročilo glejte 05.
Za račun in plačilo dostave glejte 06.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e95e125b927e package=standard -->
### 20.4 Zavihek KDS

KDS je pripravljalni prikaz, ne dokaz plačila.
Profil KDS določa, katere postaje vidijo naloge.
Kuhinjski profil lahko vključuje bar glede na konfiguracijo.
Pred spremembo profila preglejte aktivne naloge.
Preverite, da naloga ne izgine med postajami.
Preverite, da se ne pokaže dvakrat brez poslovnega razloga.
Preverite zaporedje in stanje nalog.
Preverite, katera postaja označi pripravljeno.
Ne uporabite KDS profila kot rešitev za napačen artikel.
Za tok priprave glejte 05.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e308c98f0371 package=lite -->
### 20.5 Zavihek Enote

Zavihek Enote je namenjen upravljanju operativnih lokacij.
Pred dodajanjem preverite, da enota ne obstaja.
Naziv enote naj bo razumljiv osebju.
Izbrana enota vpliva na registre in naprave.
Administrativna sprememba enote lahko vpliva na dostop.
Preverite dodeljene blagajne po ustvarjanju enote.
Preverite vidnost menija v novi enoti.
Preverite KDS in tiskalne poti.
Preverite terminale, kadar se uporabljajo.
Ne deaktivirajte enote z odprtim delom.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-fc73cff4571d package=lite -->
### 20.6 Zavihek Knjiženje

Zavihek Knjiženje je namenjen administrativni vlogi.
Vpliva na povezavo poslovnih dokumentov in poročanja.
Pred spremembo preverite obdobje in podjetje.
Pred spremembo preverite odprte prenose.
Ne spreminjajte kontiranja po občutku med servisom.
Za zaključne dokumente glejte 08.
Za zalogovne dokumente glejte 07.
Za praktični postopek računovodje glejte **DEL X: Hitri postopki po vlogah**, poglavje **20 Računovodja**.
Spremembo dokumentirajte z razlogom in odobritvijo.
Po spremembi izvedite omejen kontrolni prenos.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a04d292101f5 package=lite -->
### 20.7 Zavihek Nastavitve

Zavihek združuje splošne in napravam povezane nastavitve.
Vidnost posameznih kartic določa vloga in stanje sistema.
Nastavitve se ne obravnavajo kot en sam paket.
Vsako kartico preverite glede podjetja, enote in naprave.
Polje, ki sprejme vrednost, še ne pomeni poslovne pravilnosti.
Sporočilo o uspehu ni nadomestilo za operativni preskus.
Napaka pri shranitvi pomeni, da ne domnevate nove vrednosti.
Po napaki znova odprite kartico in preverite dejansko stanje.
Za varno zaporedje glejte 12.
Za vrnitev glejte 19.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f63151294a44 package=lite -->
### 20.8 Zavihek Varnostne kopije

Zavihek je viden samo superadministratorju.
To ni dovoljenje za nedokumentirano obnovitev.
Pred izdelavo ali pregledom določite obseg podatkov.
Pred obnovitvijo določite posledico za novejše zapise.
Preverite, kdo odobri obnovitev.
Preverite, kje se hrani dokaz uspeha.
Preverite, ali se izvoz obravnava kot občutljiv podatek.
Ne prenašajte kopij na osebne naprave.
Ne pošiljajte kopije podpori brez odobritve.
Za načela kopij glejte 19.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e94b35d30fc6 package=lite -->
### 20.9 Moj profil

Moj profil služi uporabniku, ne skupini.
Uporabnik preveri svoje ime in dovoljeni kontekst.
Uporabnik ne spreminja podatkov druge osebe.
Če je dostop napačen, se prijavi vodji ali administratorju.
Če geslo ni ustrezno, uporabi varen postopek iz 01.
Začasno geslo ne sodi v klepet ali zapisek ob napravi.
Kopiranje gesla v odložišče obravnavajte kot občutljivo dejanje.
Po uporabi občutljiv podatek odstranite iz odložišča, kjer je mogoče.
Ne posredujte zaslona profila z osebnimi podatki.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-51c53c1f4420 package=lite -->
### 20.10 Glasovni ukazi

Glasovni ukazi so pomoč pri vnosu, ne samostojna potrditev.
Pred uporabo preverite, kdo sliši delovni prostor.
Ne izgovarjajte občutljivih podatkov.
Preverite prepoznani ukaz pred izvršitvijo.
Sinonim je pomoč pri prepoznavi, ne nova postavka menija.
Spremembo sinonima preskusite na neprodukcijskem primeru.
Ne spreminjajte sinonimov sredi hrupnega servisa.
Če prepoznava ni zanesljiva, uporabite običajni vnos.
Za naročila glejte 03.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-0b53d27e79d8 package=lite -->
## 21. Polja naprav in njihovi pomeni

<!-- pos-heading: id=pos-09-postopki-po-vlogah-ee80fe1d4d96 package=lite -->
### 21.1 Identiteta naprave

Ime naprave omogoča prepoznavo v seznamu.
Ime naj pove tip in fizično lokacijo.
Serijska oznaka razlikuje podobne naprave.
Enota določa poslovni kontekst naprave.
Register določa prodajno mesto terminala.
Most določa lokalno pot do tiskalnika.
Tip naprave določa dovoljen način povezave.
Aktivno stanje določa, ali se naprava uporablja.
Lastnik naprave določa prvi operativni kontakt.
Datum menjave omogoča sled spremembe.

Ne uporabljajte imena »nov tiskalnik«.
Ne uporabljajte istega imena za dve napravi.
Ne spreminjajte identitete zato, da prikrijete napako.
Po fizični menjavi posodobite evidenco in preskus.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6f1d3e28f745 package=lite -->
### 21.2 Širina tiskalnika

Nastavitev širine vpliva na izbrano pot tiskanja.
Podprte širine so odvisne od konkretne naprave in mostu.
V trenutni implementaciji se 32 mm in 58 mm lahko obravnavata kot ZCS pot.
Širina 80 mm lahko izbere NB80 pot, kadar je most dosegljiv.
Širina 30 mm je lahko NB80 58-mm konfiguracija.
Če sta potrebna mostova nedosegljiva, sistem zahteva ponovni poskus.
Za mostno napravo se ne preklopi tiho na Bluetooth seznam.
Čisti BLE tiskalnik brez mosta lahko ponudi izbiro naprave.
Pred spremembo širine zapišite prejšnjo vrednost.
Po spremembi preverite dejanski izpis, ne le obvestilo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-c7f6d855400b package=lite -->
### 21.3 Kodna stran in znaki

Kodna stran določa, kako tiskalnik prejme znake.
Možnosti lahko vključujejo OEM 852.
Možnosti lahko vključujejo WPC1250.
Možnosti lahko vključujejo transliteracijo brez šumnikov.
Možnosti lahko vključujejo slikovni izpis.
Možnosti lahko vključujejo Windows-1250.
Izbor naredite zaradi preverjenega rezultata na ciljni napravi.
Ne spreminjajte kodne strani zaradi enega nepreverjenega simptoma.
Preskus vključuje šumnike, številke in običajne postavke.
Če je izpis nečitljiv, ohranite dokaz in eskalirajte po 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-66a1ec38f7bc package=lite -->
### 21.4 Ime tiskalnika agenta

Ime tiskalnika agenta mora ustrezati lokalno nameščenemu cilju.
Pred vnosom ga prepišite iz preverjene lokalne konfiguracije.
Preverite velike in male črke, presledke in podobna imena.
Ne vnesite imena tiskalnika iz druge enote.
Ne uporabite privzetega sistemskega tiskalnika brez preskusa.
Po shranitvi preverite, da agent vidi isti cilj.
Po preskusu preverite, da se naloga ne tiska drugje.
Če ime ni dosegljivo, ne ustvarite nadomestne blagajne.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-0572085671ed package=lite -->
## 22. Diagnostične matrike naprav

| Simptom | Najprej preverite | Ne naredite | Naslednji korak |
|---|---|---|---|
| ZCS ne tiska | most in širino | BLE obvoda | ponovni poskus mostu |
| NB80 ne tiska | NB80 most in 80/30 mm | menjave vseh nastavitev | zabeležite status |
| NYX ne tiska | cilj in agent | sistemskega ponatisovanja | preskus POS poti |
| BLE ni viden | parjenje in bližino | osebnega telefona | odobrena ponovna povezava |
| Čudni znaki | kodno stran | ročnega spreminjanja računa | preskus znakov |
| Dvojni izpis | poti in most | novega naročila | ustavite konfiguracijo |
| Počasna vrsta | napajanje in povezavo | serije ponovitev | eskalacija 11 |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-97c71eabb3b5 package=lite -->
### 22.1 ZCS diagnostika

Ali je ZCS most dosegljiv?
Če da, preverite širino in ciljni izpis.
Če ne, uporabite ponovni poskus mostu.
Ali je naprava konfigurirana kot mostna?
Če da, ne izbirajte BLE spustnega seznama kot obvoda.
Ali je širina 32 ali 58 mm?
Če da, preverite ZCS pot.
Ali je tisk uspel po ponovnem poskusu?
Če da, dokumentirajte kratko nedosegljivost.
Če ne, zberite status, čas in napravo za 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-5b86121e93f9 package=lite -->
### 22.2 NB80 diagnostika

Ali je NB80 most dosegljiv?
Če da, preverite pot NB80.
Ali je nastavljena širina 80 mm ali ustrezna 30-mm konfiguracija?
Če da, opravite en kontrolni izpis.
Če ne, ne sklepajte samo po fizični širini papirja.
Ali je papir pravilno vstavljen in pokrov zaprt?
Če ne, popravite fizično stanje in ponovno preverite.
Ali se naloga kopiči?
Če da, ne pošiljajte novih preskusnih serij.
Zberite stanje mostu in eskalirajte.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-46f8fe2a92c6 package=lite -->
### 22.3 NYX diagnostika

Preverite, ali je NYX evidentiran na pravi lokaciji.
Preverite napajanje in lokalno povezavo.
Preverite izbrano ime tiskalnika agenta.
Preverite, ali POS pošilja na pravi izhod.
Preverite dejanski POS preskus.
Ne zadostuje samo uspešen preskus operacijskega sistema.
Preverite, ali izpis ni usmerjen na drugo napravo.
Preverite kodno stran, kadar so znaki napačni.
Zapišite čas, napravo in primer izpisa.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-4d2bda85fcbe package=lite -->
### 22.4 Bluetooth diagnostika

Preverite, ali je tiskalnik napolnjen in v bližini.
Preverite, ali je seznanjen s pravim mostom.
Preverite, ali ga ne uporablja druga naprava.
Preverite dovoljenja Bluetooth na gostitelju.
Ne razdružujte vseh naprav hkrati.
Ne seznanjajte z osebnim telefonom.
Po ponovnem parjenju izvedite en preskus.
Če povezava ostaja nestabilna, preklop odobri vodja in incident gre v 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-be00be5b2e4b package=lite -->
## 23. Odvisnosti nastavitev in načrti sprememb

Tabela ne nadomešča postopka v poglavju 09.
Uporablja se pred odobritvijo spremembe.
»Predpogoj« pomeni, kaj mora biti preverjeno.
»Rezultat« pomeni, kaj mora biti vidno po preskusu.
»Vrnitev« pomeni najmanjši varen obseg povrnitve.

| Družina | Predpogoj | Rezultat | Vrnitev |
|---|---|---|---|
| Podjetje | odobritev odgovorne osebe | pravni podatki preverjeni | prejšnja odobrena vrednost |
| Enota | določena lokacija in vodja | vidni pravilni registri | deaktivacija nove enote |
| Poslovni prostor | fiskalni pregled | pravilen fiskalni kontekst | vrnitev pred objavo |
| Register | enota in prostor | pravilen prodajni kontekst | prejšnja dodelitev |
| Mize | potrjen fizični načrt | pravilna strežba | prejšnji načrt |
| Meni | poslovna odobritev | pravilen artikel in cena | prejšnja različica |
| KDS | določene postaje | naloga prispe enkrat | prejšnja pot |
| Tisk | most in cilj dosegljiva | čitljiv en izpis | prejšnji cilj |
| Terminal | brez plačila v teku | potrjen preskus ponudnika | stara dodelitev |
| FURS | pooblaščenec in veljavnost | zdrav fiskalni status | odobrena prejšnja konfiguracija |
| QR | potrjena javna vsebina | pravilen javni prikaz | prejšnja objava |
| CTI | pravilen ponudnik in enota | pravilen prihod klica | prejšnja vezava |
| ERP | dogovorjena preslikava | en kontrolni prenos | zaustavitev novega toka |
| BizBox | potrjen dokumentni obseg | status oddaje preverjen | ne podvajajte pošiljanja |
| Uporabniki | odobritev in identiteta | najmanjše pravice | odstranitev nove pravice |
| Kopije | lastnik in obseg | dokaz pregleda kopije | brez samovoljne obnove |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-3ec1a1c3b4a8 package=lite -->
### 23.1 Podjetje in več enot

Primer: podjetje upravlja kavarno in restavracijo.
Obe enoti lahko uporabljata isti poslovni okvir.
Vsaka enota mora imeti jasno operativno ime.
Vsaka enota mora imeti svojega odgovornega vodjo.
Register kavarne ne sme po pomoti prodajati v kontekstu restavracije.
Natakar kavarne ne potrebuje dostopa do menija restavracije, če tam ne dela.
Tiskalnik kuhinje restavracije ne sme prejemati nalog kavarne brez izrecne odločitve.
Terminal se dodeli registru, ne neformalno »lokaciji«.
Poročilo vedno preverite po podjetju, enoti in obdobju.
Spremembo skupne nastavitve obravnavajte kot spremembo vseh enot.

Primer: vodja začasno dela v drugi enoti.
Najprej odobrite časovno omejen dostop.
Nato dodelite samo zahtevano enoto.
Nato preverite, da ostale občutljive pravice ostanejo omejene.
Po zaključku začasne naloge dostop odstranite.
Zapis odobritve ohranite za revizijo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6caa81fb88d9 package=lite -->
### 23.2 Sposobnosti in scenariji

| Scenarij | Potrebna sposobnost | Ne potrebujete |
|---|---|---|
| Natakar odpre mizo | naročila v lastni enoti | administracije naprave |
| Kuhinja vidi nalogo | pripravljalna postaja | plačilnega dostopa |
| Blagajnik zaključi račun | plačilo na registru | urejanja uporabnikov |
| Skladiščnik potrdi prejem | zalogovni dokument | FURS potrdila |
| Vodja pregleda izjemo | nadzor enote | sistemskega skrbništva |
| Manager odobri spremembo | poslovni nadzor | zasebnega ključa |
| Administrator poveže most | nastavitve naprave | delo v tuji seji |
| Računovodja preveri prenos | poročila in integracija | spremembe KDS |

Primer: blagajnik prosi za administratorski dostop zaradi tiskalnika.
Vodja najprej preveri, ali je potrebna le operativna pomoč.
Administrator preveri most po postopku naprave.
Blagajnik ne dobi višje pravice samo zaradi nujnosti.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-b45046411c09 package=lite -->
## 24. Načrt uvajanja naprav

<!-- pos-heading: id=pos-09-postopki-po-vlogah-73c258163153 package=lite -->
### 24.1 Pred dostavo

- Določite enoto in register naprave.
- Določite namen izhoda.
- Določite primarno in rezervno pot.
- Določite tehničnega in operativnega lastnika.
- Preverite napajanje in fizično mesto.
- Preverite žično ali brezžično omrežje.
- Preverite oznako naprave.
- Pripravite zapis serijske oznake.
- Pripravite okno za preskus.
- Obvestite prizadeto osebje.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-04abeaebc722 package=lite -->
### 24.2 Namestitev ZCS

ZCS namestite na določeni vzdrževani gostiteljski napravi.
Gostitelj naj med obratovanjem ne preide v spanje.
Gostitelj naj ne uporablja osebnega prijavnega računa zaposlenega.
Preverite lokalno povezavo tiskalnika.
Preverite dosegljivost mostu iz POS poti.
Nastavite preverjeno širino za ciljni tiskalnik.
Po shranitvi izvedite en kontrolni izpis.
Preverite, da izpis doseže pravo pripravljalnico.
Označite napravo z imenom mostu in lokacijo.
Zapišite rezultat uvajanja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-54da6e3c795d package=lite -->
### 24.3 Namestitev NB80

NB80 namestite z označenim napajanjem in ciljem.
Preverite rolo, pokrov in čitljivost mehanike.
Preverite povezavo NB80 mostu.
Preverite širino, ki jo uporablja konfiguracija.
Pri 80 mm preverite NB80 pot.
Pri podprti 30-mm konfiguraciji preverite NB80 pot.
Ne sklepajte, da je vsak ožji papir BLE naprava.
Po preskusu preverite, da ni dvojnega izpisa.
Zapišite status in fizično lokacijo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-1fbcf68e0daf package=lite -->
### 24.4 Namestitev NYX

NYX dodelite določenemu cilju in enoti.
Preverite lokalno ime tiskalnika agenta.
Preverite pravilen fizični priključek.
Preverite napajanje pred konfiguracijskim posegom.
Preverite kodno stran z realnimi šumniki.
Preverite izpis iz POS, ne le lokalnega testa.
Preverite, da se izpis ne pojavi na drugem cilju.
Ob uspehu zapišite primer preskusa.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-011d742f81b9 package=lite -->
### 24.5 Namestitev Bluetooth

Bluetooth uporabite le za potrjen primer uporabe.
Preverite doseg med mostom in tiskalnikom.
Preverite napolnjenost ali napajanje naprave.
Odstranite stara neodobrena parjenja le po postopku.
Povežite samo en jasno označen cilj.
Preverite obnovitev po ponovnem zagonu.
Preverite, da osebni telefoni niso del poti.
Za nestabilno povezavo določite rezervni operativni postopek.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-008808349fd2 package=lite -->
### 24.6 Omrežje, spanje in energija

Omrežje preverite pred obtoževanjem aplikacije.
Preverite kabel, stikalo in oznako priključka.
Preverite Wi-Fi samo, če je to odobrena pot.
Preverite, ali se je gostitelj prebudil po spanju.
Preverite, ali posodobitev sistema ni spremenila izbrane naprave.
Preverite, ali tiskalnik po izpadu elektrike spet doseže most.
Ne izklapljajte naprave med aktivno tiskalno vrsto.
Ne skrivajte kabla tako, da ga osebje lahko nehote iztakne.
Ne uporabljajte razdelilca brez ustreznega napajanja.
Vsako ponavljajočo se težavo z energijo predajte vzdrževanju.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6ee29a17dfaf package=lite -->
## 25. Terminali in ponudniki: meje incidenta

Ponudnik je odgovoren za obdelavo terminalske transakcije.
POS je odgovoren za pravilno evidentiranje poslovnega toka.
Blagajnik je odgovoren, da ne ponavlja nejasnega poskusa.
Vodja je odgovoren za operativno odločitev in eskalacijo.
Administrator je odgovoren za konfiguracijo, ne za ugibanje statusa plačila.
Računovodstvo preverja posledice v poročilih po 08.

| Primer | Prvi lastnik | Dokaz | Meja posega |
|---|---|---|---|
| Terminal ne reagira | blagajnik | čas in register | ne ponovi plačila |
| Napačen register terminala | administrator | dodelitev naprave | brez plačil v teku |
| Zavrnjena kartica | blagajnik | sporočilo terminala | brez razlage vzroka gostu |
| Uspeh le na terminalu | vodja/ponudnik | referenca | brez nove bremenitve |
| Uspeh le v POS | vodja/ponudnik | naročilo in čas | brez nove izdaje |
| Izpad ponudnika | vodja | obseg enot | postopek iz 11 |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d55e0e5975af package=extended -->
## 26. Življenjski cikel FURS, QR, CTI in integracij

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9a158f8b4e22 package=extended -->
### 26.1 FURS potrdilo

Načrtujte pregled veljavnosti pred potekom.
Odgovorno osebo določite pred nastankom nuje.
Novo potrdilo pridobite po uradnem postopku podjetja.
Pred uvozom preverite pravo podjetje.
Pred uvozom zagotovite, da občutljiva datoteka ni v skupni mapi.
Po uvozu preverite status brez izpisa skrivnosti.
Med prehodom ne spreminjajte drugih fiskalnih nastavitev.
Po preverjanju dokumentirajte datum, izvajalca in stanje.
Starega materiala ne razkrivajte ali pošiljajte po klepetu.
Ob napaki uporabite incidentni postopek 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d4da06c9cdfa package=extended -->
### 26.2 QR objava

Lastnik menija potrdi vsebino pred objavo.
Administrator preveri javni naslov in enoto.
Operativni lastnik preveri izkušnjo na telefonu gosta.
Preverite, da QR ne vodi v administrativni zaslon.
Preverite, da prikaz ne vsebuje testnih artiklov.
Preverite, da se sprememba iz 04 pravilno odrazi.
PDF ali tisk QR kod ustvarite šele po potrditvi.
Rotacijo QR kod dokumentirajte z razlogom in obsegom.
Ne rotirajte kod med aktivnim dogodkom brez nuje.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-b284d9f53585 package=extended -->
### 26.3 CTI po enoti

CTI žeton oziroma povezava je vezan na odobrenega ponudnika in enoto.
Ne kopirajte žetona med enotami za hitro rešitev.
Pred vklopom potrdite, katera številka pripada enoti.
Preverite, kdo vidi pojavno okno dohodnega klica.
Preverite, kam se ustvari naročilo.
Preverite ročni postopek ob nedosegljivosti CTI.
Žetona ne vpisujte v zahtevek, dokument ali posnetek zaslona.
Ob menjavi ponudnika prekličite staro povezavo po odobritvi.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-8165478d0f31 package=extended -->
### 26.4 ERP in BizBox zdravje

Za vsak prenos določite poslovni vir resnice.
Za vsak prenos določite tehničnega lastnika.
Za vsak prenos določite obdobje pregleda.
Preverite vrsto dokumentov pred množičnim vklopom.
Preverite preslikavo enote in oznak.
Preverite, ali je kontrolni dokument prispel enkrat.
Zavrnjeni zapis ohranite do razjasnitve.
Ne ponovno pošiljajte celotnega obdobja zaradi ene napake.
Po odpravi preverite obseg in preprečite podvojitev.
Za poročila uporabite 08.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-dc715c27e4fc package=lite -->
## 27. Periodične odgovornosti

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f514765a4669 package=lite -->
### 27.1 Mesečni administrativni pregled

- Preglejte aktivne administratorje.
- Preglejte začasne dostope.
- Preglejte uporabnike brez aktivnosti.
- Preglejte naprave brez lastnika.
- Preglejte naprave z nejasnim imenom.
- Preglejte poteke FURS potrdil.
- Preglejte neuspele integracijske prenose.
- Preglejte ponavljajoče se tiskalne incidente.
- Preglejte dokumentirane vrnitve sprememb.
- Določite lastnika vsake odprte točke.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-650b910df568 package=lite -->
### 27.2 Letni pregled

- Potrdite lastništvo vseh enot.
- Potrdite lastništvo vseh registrov.
- Potrdite seznam tiskalnikov in mostov.
- Potrdite seznam terminalov in ponudnikov.
- Potrdite CTI in QR javne povezave.
- Potrdite integracijske odgovornosti.
- Potrdite načrt kopij in obnovitveni preskus.
- Potrdite administrativno usposobljenost.
- Potrdite kontaktno pot za incidente.
- Zapišite odobritev in načrt izboljšav.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-8062f62aafdb package=lite -->
## 28. Predloga zahtevka in administrativne laboratorijske vaje

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f0bdc8c05dbc package=lite -->
### 28.1 Zahtevek za spremembo

Navedite poslovni razlog.
Navedite podjetje in enoto.
Navedite prizadete uporabnike in naprave.
Navedite trenutno in želeno stanje.
Navedite odobritelja.
Navedite preskusni scenarij.
Navedite načrt vrnitve.
Navedite čas izvedbe.
Navedite komunikacijo osebju.
Navedite lastnika po izvedbi.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-2992fc1c6d73 package=lite -->
### 28.2 Lab: nova tiskalna pot

Naloga: dodelite nov tiskalnik pravilni enoti.
Udeleženec navede register, most, širino in cilj.
Udeleženec zapiše prejšnjo vrednost.
Udeleženec izvede en kontrolni izpis.
Udeleženec preveri, da se izpis ne podvaja.
Udeleženec zapiše rezultat in vrnitev.
Uspeh: brez ustvarjanja nove enote ali blagajne.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-310b2379a36c package=lite -->
### 28.3 Lab: potek FURS potrdila

Naloga: pripravite načrt zamenjave potrdila.
Udeleženec navede pooblaščenca in rok.
Udeleženec zaščiti občutljivo datoteko.
Udeleženec preveri podjetje pred uvozom.
Udeleženec opiše preverjanje statusa.
Udeleženec opiše eskalacijo ob neuspehu.
Uspeh: skrivnost ni vključena v dokumentacijo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a3c3864df65d package=lite -->
### 28.4 Lab: napačna pravica

Naloga: blagajnik vidi administrativni zavihek.
Udeleženec preveri identiteto, vlogo in enoto.
Udeleženec odstrani samo nepotrebno pravico.
Udeleženec preveri, da plačilna pravica ostane pravilna.
Udeleženec zapiše odobritev in rezultat.
Uspeh: ni ustvarjen nov uporabnik in sled ostane ohranjena.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-e59651c55ece package=lite -->
## 29. Komisijski paket in pravilo dokazov

To poglavje dopolnjuje uvajanje iz 12, naprave iz 15, terminale iz 16 in integracije iz 17.
Uporablja se pred prvim rednim servisom, ob odprtju nove enote in po pomembni zamenjavi poti.
Komisija ne potrjuje nastavitve po spominu.
Komisija potrjuje opazovan rezultat, zapis vira in osebo, ki je preverila rezultat.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-93126c0a6c66 package=lite -->
### 29.1 Naslovnica paketa

| Polje | Vpiše se | Dokaz |
|---|---|---|
| Oznaka uvajanja | interna enolična oznaka | zahtevek spremembe |
| Podjetje | uradni naziv, ne okrajšava | odobren poslovni podatek |
| Enota | operativno ime in lokacija | seznam enot |
| Datum in čas okna | začetek in konec | koledar posega |
| Obseg | novi objekt, menjava ali ponovni prevzem | odobrena zahteva |
| Operativni lastnik | vodja enote | potrditev lastnika |
| Tehnični lastnik | skrbnik naprave ali integracije | kontaktni seznam |
| Odobritelj | oseba z ustrezno odgovornostjo | odobritev pred posegom |
| Izvajalec | oseba, ki je dejanje izvedla | podpis oziroma interni zapis |
| Priča preskusa | oseba, ki je videla rezultat | podpis oziroma interni zapis |
| Načrt vrnitve | najmanjši povratni korak | zapis pred spremembo |
| Odločitev | sprejeto, pogojno sprejeto ali zavrnjeno | zaključek komisije |

Dokaz naj vsebuje časovni žig, vendar ne vsebuje skrivnosti.
Posnetek zaslona prikrije osebne in poverilniške podatke.
Fotografija tiskalnika ni dokaz pravilnega usmerjanja brez oznake preskusnega primera.
Uspešen lokalni test ni dokaz uspeha iz POS-a.
Uspešen prikaz v POS-u ni dokaz, da je naprava izpis dejansko prejela.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-ec5af63f33e1 package=lite -->
### 29.2 Minimalni dokazni komplet

1. Shranite odobreno zahtevo in obseg.
2. Shranite zapis stare vrednosti pred posegom.
3. Shranite identiteto podjetja, enote in registra preskusa.
4. Shranite oznako uporabljene naprave brez občutljivih podatkov.
5. Shranite čas začetka in konca preskusa.
6. Shranite rezultat posameznega preskusnega koraka.
7. Shranite izid negativnega preskusa, kjer je zahtevan.
8. Shranite odločitev o sprejemu ali vrnitvi.
9. Shranite izvajalca, pregledovalca in lastnika odprte točke.
10. Shranite rok za odpravo pogojno sprejetega odstopanja.

Ne uporabite produkcijskega plačila samo za pridobitev dokaza.
Ne ustvarite računa, če interni postopek za preskus tega ne dovoljuje.
Kadar je za dokaz potreben poslovni dokument, upoštevajte postopke iz 06 in 08.
Kadar rezultat ni jasen, paket označite kot neizpolnjen.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-67ad235676dd package=lite -->
## 30. Delovni list odvisnosti podjetja, enote, prostora in registra

Izpolnite en list za vsak register, ki se daje v redno uporabo.
Polja v tem listu so kontrolna vprašanja; niso navodilo za izmišljanje novih oznak.
V stolpec »vir« zapišite, od kod je bila vrednost preverjena.
V stolpec »izid« zapišite DA, NE ali NI V OBSEGU.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-4a1a39dbeac3 package=lite -->
### 30.1 Podjetje: polje za poljem

| Polje oziroma odvisnost | Preverjanje | Vir | Izid | Pregledal |
|---|---|---|---|---|
| Izbrano podjetje | ime se ujema z odobreno zahtevo | vidni kontekst |  |  |
| Uradni naziv | ni zamenjan z imenom lokala | poslovni podatki |  |  |
| Davčna identifikacija | ujema se z odobrenim zapisom | računovodstvo |  |  |
| Naslov podjetja | ni naslov poslovnega prostora po pomoti | poslovni podatki |  |  |
| Časovni pas | poslovni datum je smiseln za lokacijo | kontrolni prikaz |  |  |
| Davčna pravila | potrdi računovodstvo | odobritev |  |  |
| FURS odgovorna oseba | dosegljiv kontakt je določen | kontaktni seznam |  |  |
| FURS potrdilo | veljavnost je preverjena brez razkritja | status potrdila |  |  |
| Lastnik ERP prenosa | določena je odgovorna oseba | integracijski seznam |  |  |
| Lastnik BizBox toka | določena je odgovorna oseba | integracijski seznam |  |  |
| Administratorji | seznam je pregledan po najmanjših pravicah | pregled dostopa |  |  |
| Aktivne enote | nova enota ni zamenjana s podobno imenovano | seznam enot |  |  |

Če davčna identifikacija ni potrjena, ne začnite fiskalnega preskusa.
Če je potrdilo tik pred potekom, naj komisija ne označi uvajanja kot dokončnega brez načrta rotacije.
Če ni določen lastnik toka, integracije ne sprejmite v produkcijsko uporabo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-03db912c2455 package=lite -->
### 30.2 Enota: polje za poljem

| Polje oziroma odvisnost | Preverjanje | Vir | Izid | Pregledal |
|---|---|---|---|---|
| Ime enote | osebje jo prepozna brez dodatne razlage | seznam enot |  |  |
| Opis enote | opis ne zamenja druge lokacije | zapis enote |  |  |
| Aktivnost enote | aktivna je samo pred načrtovanim začetkom | zapis enote |  |  |
| Fizična lokacija | ujema se z dejanskim mestom dela | ogled lokacije |  |  |
| Vodja enote | ve, kdo odloča ob incidentu | kontaktni seznam |  |  |
| Registri enote | vidni so samo predvideni registri | seznam registrov |  |  |
| Mize in območja | prikaz ustreza fizičnemu prostoru | ogled in 03 |  |  |
| Meni | dovoljen nabor je pravilen za enoto | preskus iz 04 |  |  |
| KDS oziroma priprava | naloga doseže pravo postajo | preskus iz 05 |  |  |
| Tiskalne poti | cilji so določeni za to enoto | evidenca naprav |  |  |
| Terminali | dodelitve niso prevzete iz druge enote | evidenca terminalov |  |  |
| QR javna vsebina | javni naslov pripada tej enoti | preskus telefona |  |  |
| CTI številka | klic prispe v pravo enoto | test klica |  |  |

Sprememba imena enote ne popravi napačne dodelitve registra.
Sprememba enote ne sme postati nadomestek za omejevanje posameznega uporabnika.
Če se lokacija in zapis enote ne ujemata, zadržite sprejem.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-a602ea57d979 package=lite -->
### 30.3 Poslovni prostor: polje za poljem

| Polje oziroma odvisnost | Preverjanje | Vir | Izid | Pregledal |
|---|---|---|---|---|
| Oznaka prostora | enolična je v fiskalnem kontekstu | odobren zapis |  |  |
| Povezana enota | ni izbrana sosednja ali arhivska enota | povezava enote |  |  |
| Naslov prostora | fizično se ujema z odobreno lokacijo | uradni vir |  |  |
| Tip prostora | ustreza odobrenemu načinu uporabe | odobrena zahteva |  |  |
| Začetek uporabe | datum je usklajen z odprtjem | načrt odprtja |  |  |
| Fiskalni način | preskusni, produkcijski ali simulacijski način je razločen | prikaz nastavitve |  |  |
| FURS status | rezultat registracije je pregledan po postopku | odgovor postopka |  |  |
| Odgovorna oseba | ve, kdo vodi fiskalno eskalacijo | kontaktni seznam |  |  |
| Zaprti prostor | ni uporabljen za nove račune | status prostora |  |  |
| Dokument odobritve | dostopen je brez skrivnosti | evidenca odobritev |  |  |

Prostora, ki je zaprt pri FURS, ne uporabljajte za preskus nove prodaje.
Zapiranje poslovnega prostora je nepreklicno dejanje pri FURS; komisija ga ne izvaja kot navaden test.
Če uradna evidenca in lokalni zapis nista usklajena, predajte primer po 11.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-cb4890b5deae package=lite -->
### 30.4 Register in naprava: polje za poljem

| Polje oziroma odvisnost | Preverjanje | Vir | Izid | Pregledal |
|---|---|---|---|---|
| Ime registra | razumljivo razlikuje prodajno mesto | seznam registrov |  |  |
| Oznaka registra | ujema se s fiskalnim in operativnim zapisom | odobrena zahteva |  |  |
| Podjetje registra | enako kot naslovnica paketa | prikaz konteksta |  |  |
| Enota registra | enako kot delovni list enote | prikaz konteksta |  |  |
| Poslovni prostor | pravilno povezan pred fiskalnim tokom | povezava registra |  |  |
| Uporaba gotovine | potrjena po operativnem pravilniku | nastavitev registra |  |  |
| Začetek izmene | postopek pozna blagajnik | vaja iz 02 |  |  |
| Računski izhod | cilj računa je določen | tiskalni list |  |  |
| Terminal | enolično dodeljen temu registru | terminalski list |  |  |
| Delovna naprava | ime in fizična oznaka se ujemata | inventar naprave |  |  |
| Širina tiskalnika | ustreza izbrani mostni poti | nastavitev naprave |  |  |
| Kodna stran | preverjena s šumniki na cilju | dokaz izpisa |  |  |
| Aktivnost naprave | aktivna je šele po sprejemu | evidenca naprave |  |  |

Register ne sme biti povezan z neznanim poslovnim prostorom.
Naprava ni dokaz identitete registra samo zato, ker stoji ob njem.
Če je terminal dodeljen drugemu registru, ga ne prepišite med odprtim plačilom.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d0d878cd4c2e package=lite -->
## 31. Prevzemni protokoli tiskalnih mostov

Za vsak protokol izvedite en nadzorovan preskus iz 15.5.
Preskus mora preveriti pravilen cilj, čitljivost, enkratnost in neprizadetost drugega cilja.
V zapis ne vključujte celotnih podatkov gosta ali občutljivih številk dokumenta.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-ab96bc139d83 package=lite -->
### 31.1 ZCS Z92 most

| Korak | Kriterij sprejema | Dokaz |
|---|---|---|
| Identiteta | evidentirana je naprava ZCS in fizična lokacija | inventarna oznaka |
| Most | APK je dosegljiv na lokalni poti | status mostu |
| Pripravljenost | status ne zamenja dosegljivosti s pripravljenostjo tiskalnika | zapis stanja |
| Enota | preskus se izvaja v pravilni enoti | vidni kontekst |
| Register | izbran je predvideni register | vidni kontekst |
| Pot | naprava uporablja ZCS pot, ne BLE obvoda | nastavitev in opazovanje |
| Širina | preverjena je konfigurirana širina | nastavitev naprave |
| Besedilo | izpis vsebuje običajne znake in šumnike | kontrolni izpis |
| QR oziroma ZOI | grafični zaključek je cel in ne prekine besedila | kontrolni izpis |
| Enkratnost | nastane samo en izpis | opazovanje pri napravi |
| Cilj | izpis ne prispe na kuhinjo ali bar | pregled drugih ciljev |
| Vrnitev | zapisana je prejšnja odobrena pot | zapis pred posegom |

Pri izvirnem ZCS poteku se lahko besedilo in grafični zaključek obdelata ločeno.
Zato ne sklepajte o napaki, dokler ni zaključeno predvideno tiskalno opravilo.
Če most ni dosegljiv, ne nastavite iste naprave kot generični Bluetooth tiskalnik brez odobrene spremembe.
Če most odgovori, tiskalnik pa ni pripravljen, to zapišite kot neuspešen prevzem, ne kot uspeh mostu.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-8e262e9b63d6 package=lite -->
### 31.2 NB80 oziroma NYX most

| Korak | Kriterij sprejema | Dokaz |
|---|---|---|
| Identiteta | evidentirani so model, serijska oznaka in lokacija | inventarna oznaka |
| Napajanje | napajanje in pokrov sta preverjena | ogled naprave |
| Most | dosegljivost mostu je potrjena | status mostu |
| Model poti | za NYX/NB80 je izbrana pravilna pot | nastavitev naprave |
| Širina | potrjena je 80-mm ali odobrena 30-mm konfiguracija | nastavitev in izpis |
| Ime cilja | lokalno ime tiskalnika je prepisano iz preverjene konfiguracije | zapis cilja |
| Znaki | šumniki so čitljivi na dejanskem izpisu | kontrolni izpis |
| Poravnava | širina ne odreže zneskov ali zaključnih vrstic | kontrolni izpis |
| Usmerjanje | račun prispe na blagajniški cilj | opazovanje |
| Izolacija | drug tiskalnik ne prejme kopije | pregled drugih ciljev |
| Ponovni zagon | po odobrenem ponovnem zagonu je pot spet na voljo | zapis preskusa |
| Vrnitev | znana je prejšnja konfiguracija širine in cilja | zapis pred posegom |

Fizična 80-mm rola sama po sebi ne dokazuje pravilne konfiguracije.
Pri 30-mm konfiguraciji preverite dejanski rezultat, ne zgolj ime tiskalnika.
Ne spreminjajte hkrati imena cilja, širine in kodne strani.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-0c6480f08b8c package=lite -->
### 31.3 BtTiskalniMost in starejša oznaka Q10

| Korak | Kriterij sprejema | Dokaz |
|---|---|---|
| Tip mostu | status označuje BT oziroma starejšo oznako Q10 | status mostu |
| Združljivost | dokumentiran je podprti tiskalnik in njegova širina | inventar |
| Stolpci | izpis je prilagojen BT poti in ni stisnjen | kontrolni izpis |
| Širina | 58-mm in 80-mm rezultat sta ocenjena po dejanskem papirju | kontrolni izpis |
| Grafika | QR oziroma slika ne prekrije besedila | kontrolni izpis |
| Cilj | izpis nastane na označenem BT tiskalniku | opazovanje |
| Povezava | tiskalnik ni povezan z osebnim telefonom | pregled povezave |
| Obnovitev | po dovoljeni prekinitvi se povezava obnovi ali je določena rezerva | zapis preskusa |
| Dvojni poskus | drugi zahtevek med aktivnim tiskanjem ni razlog za dvojni izpis | opazovanje postopka |
| Vrnitev | določena je odobrena rezervna pot | operativni načrt |

Oznaki »bt« in »q10« pomenita BT tiskalni most, ne nujno dve različni napravi.
Ne sprejmite poti samo zato, ker most prepozna tiskalnik; preverite tudi rezultat računa.
Če je povezava nestabilna, označite prevzem kot pogojen in določite lastnika ter rok.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-962ddc62f0c7 package=lite -->
### 31.4 Čisti Web Bluetooth, Web Serial in omrežni tisk

| Družina | Dodatni kriterij | Dokaz |
|---|---|---|
| Web Bluetooth | brskalnik podpira Bluetooth in izbrana naprava je podprta | prikaz stanja |
| Web Bluetooth | shranjena je le odobrena naprava istega delovnega odjemalca | evidenca naprave |
| Web Bluetooth | po osvežitvi je preverjen dovoljen ponovni priklop | nadzorovan preskus |
| Web Serial | uporabljen je podprt Chrome ali Edge | zapis okolja |
| Web Serial | vrata so izbrana na evidentiranem odjemalcu | evidenca naprave |
| Web Serial | po ponovnem odprtju se preveri samo odobrena vrata | nadzorovan preskus |
| Omrežni tisk | naslov cilja je odobren in vezan na pravo napravo | evidenca omrežja |
| Omrežni tisk | izpis uspe iz POS poti, ne le iz omrežnega orodja | kontrolni izpis |
| Vse tri družine | dokumentirana je varna rezervna pot | načrt vrnitve |

Čisti Bluetooth in serijski tisk sta odvisna od dovoljenj brskalnika na konkretnem odjemalcu.
Ne štejte izbire v brskalniku za skupno nastavitev celotne enote.
Omrežnega naslova ne kopirajte iz druge enote brez preverjene fizične oznake cilja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-05d3666e0729 package=lite -->
## 32. Dokazi o komisijskem prevzemu terminala

Podprte družine nastavitev terminalov so Payten, SumUp in Viva.
Komisija ne zapisuje PIN-ov, skrivnosti, polnih številk kartic ali poverilnic ponudnika.
Dokaz uspeha sestavljata rezultat na terminalu in ustrezen rezultat v POS-u.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-1082a96d6d72 package=lite -->
### 32.1 Skupni list terminala

| Polje | Vrednost | Vir | Pregledal |
|---|---|---|---|
| Ponudnik |  | odobrena pogodba |  |
| Model terminala |  | inventar |  |
| Serijska oznaka |  | nalepka oziroma ponudnik |  |
| Enota |  | delovni list 30.2 |  |
| Register |  | delovni list 30.4 |  |
| Fizična lokacija |  | ogled |  |
| Omrežna pot |  | odobrena evidenca |  |
| Lastnik pri ponudniku |  | kontaktni seznam |  |
| Operativni lastnik |  | kontaktni seznam |  |
| Prejšnja dodelitev |  | zapis pred posegom |  |
| Rezervni postopek |  | postopek iz 06 oziroma 11 |  |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d151ff8b21bb package=lite -->
### 32.2 Payten: prevzem

1. Potrdite, da terminal pripada pravemu ponudniku in podjetju.
2. Potrdite serijsko oznako z inventarjem.
3. Potrdite dodelitev pravi enoti in registru.
4. Potrdite odobren IP-naslov oziroma omrežni podatek, kadar se uporablja.
5. Potrdite odobrena vrata in časovno omejitev, kadar sta nastavljena.
6. Potrdite, da ni plačila v teku.
7. Potrdite, da drug register terminala ne uporablja.
8. Izvedite odobren preskus po postopku ponudnika.
9. Primerjajte čas preskusa na terminalu in v POS-u.
10. Zapišite referenco v dovoljeni, neobčutljivi obliki.
11. Potrdite, da stara dodelitev ne prejema novih zahtev.
12. Podpišite sprejem ali opišite odstopanje.

Ne sklepajte, da dosegljiv IP pomeni uspešno kartično transakcijo.
Ne spreminjajte vrat med preskusom, če rezultat še ni pojasnjen.
Ob neusklajenem rezultatu ne izvedite druge bremenitve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-142b87036608 package=lite -->
### 32.3 SumUp: prevzem

1. Potrdite, da je serijska oznaka terminala pravilna.
2. Potrdite, da je izbrani terminal namenjen temu registru.
3. Potrdite aktivnost SumUp konfiguracije na pravilni napravi.
4. Potrdite, da je omrežna povezava terminala pripravljena.
5. Potrdite, da ni odprtega ali nejasnega poskusa plačila.
6. Izvedite odobren preskusni primer.
7. Preverite jasno dokončan rezultat na terminalu.
8. Preverite ustrezno stanje v POS-u.
9. Primerjajte čas in dovoljeno referenco obeh strani.
10. Preverite, da drug terminal ni prejel zahteve.
11. Zapišite ponudnikov kontakt za razreševanje neskladja.
12. Zapišite staro dodelitev za morebitno vrnitev.

SumUp terminala ne zamenjajte samo zato, ker gostu poteče čakanje.
Če se POS in terminal razlikujeta, zaščitite dokaz in eskalirajte po 11.
Ne uporabljajte istega preskusnega rezultata kot dokaz za drug register.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-afc63c0905a4 package=lite -->
### 32.4 Viva: prevzem

1. Potrdite identifikator Viva terminala.
2. Potrdite, ali se uporablja terminalski ali Android tok.
3. Potrdite aktivnost izbranega Viva toka na pravilni napravi.
4. Potrdite demo način samo, kadar je izrecno odobren za preskus.
5. Jasno označite, ali dokaz izvira iz demo ali produkcijskega okolja.
6. Potrdite enoto in register pred preskusom.
7. Izvedite en odobren preskus v pravilnem okolju.
8. Preverite jasen končni status na terminalu oziroma Android toku.
9. Preverite ustrezno stanje v POS-u.
10. Zapišite čas, izvajalca in dovoljeno referenco.
11. Preverite, da demo nastavitev ne ostane neopaženo v produkcijskem prevzemu.
12. Odločite o sprejemu šele po pregledu obeh strani.

Demo rezultat ni dokaz produkcijske pripravljenosti.
Produkcijskega okolja ne uporabljajte za neodobreni preizkus.
Ob menjavi Viva toka znova opravite celoten list terminala.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-fc0e69b37654 package=lite -->
## 33. Vaja rotacije FURS potrdila

Vajo izvedite pred potekom in v odobrenem oknu.
Vaja ni dovoljenje za pošiljanje potrdila ali njegovega gesla po e-pošti.
Namen vaje je dokazati pripravljenost oseb, dokazov in varne vrnitve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-fb2d14a5ef7d package=lite -->
### 33.1 Pripravljalni zapis

| Kontrolna točka | Izid | Dokaz |
|---|---|---|
| Rok veljavnosti starega potrdila je pregledan |  | status brez skrivnosti |
| Določen je pooblaščen izvajalec |  | odobritev |
| Določen je neodvisen pregledovalec |  | koledar oziroma zapis |
| Pravo podjetje je identificirano |  | vidni kontekst |
| Odobren je čas brez aktivnega fiskalnega toka |  | načrt posega |
| Lokacija občutljive datoteke je varna |  | interni postopek |
| Načrtovana je komunikacija vodji enote |  | obvestilo |
| Staro stanje je zapisano |  | zapis pred posegom |
| Znana je pot eskalacije |  | kontaktni seznam |
| Načrt vrnitve ne zahteva razkritja skrivnosti |  | načrt vrnitve |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-48a39acafc0f package=lite -->
### 33.2 Potek vaje

1. Preberite obseg in odobritev.
2. Potrdite, da ni odprtega računa ali fiskalnega postopka, ki bi ga poseg prizadel.
3. Potrdite podjetje, ne samo trenutno odprto enoto.
4. Preverite veljavnost obstoječega potrdila brez kopiranja njegove vsebine.
5. Preverite identiteto pripravljene zamenjave po varnem internem postopku.
6. Zapišite čas začetka vaje.
7. Izvedite predvideni uvoz oziroma zamenjavo samo v odobrenem obsegu.
8. Preverite prikaz statusa brez zajema skrivnosti.
9. Preverite, da drugih fiskalnih nastavitev niste spremenili.
10. Izvedite samo odobren kontrolni korak iz 06.
11. Zapišite čas konca in izid.
12. Preverite, ali je potrebna vrnitev.
13. Če je potrebna vrnitev, uporabite samo vnaprej zapisano prejšnje stanje.
14. Obvestite operativnega lastnika o rezultatu.
15. Določite datum naslednjega pregleda veljavnosti.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-96499e6ba00a package=lite -->
### 33.3 Negativni scenariji vaje

| Scenarij | Pričakovan varen odziv | Dokaz |
|---|---|---|
| Izbrano je napačno podjetje | ustavite pred uvozom | zapis prekinitve |
| Datoteka je v skupni mapi | ne nadaljujte, uporabite varen postopek | zapis odstopanja |
| Veljavnost novega materiala ni potrjena | ne aktivirajte ga | zapis odstopanja |
| Status po posegu ni jasen | ne izdajajte dodatnega preskusa | eskalacija |
| Uporabnik zahteva geslo v zahtevek | zavrnite vpis skrivnosti | očiščen zahtevek |
| V teku je fiskalni tok | prestavite okno | zapis časa |
| Potrebna je sprememba drugih polj | ločite zahtevek in preskus | nova zahteva |

Vaja je uspešna, če je mogoče dokazati pravilen postopek brez razkritja potrdila.
Vaja ni uspešna, če je status nejasen, četudi ni vidne napake.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9f53ba30b95b package=lite -->
## 34. Kontrolni seznam za začetek delovanja integracij

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f87194f58954 package=lite -->
### 34.1 QR meni

| Preverjanje | Sprejemni kriterij | Dokaz |
|---|---|---|
| Javni naslov | vodi na javni meni, ne v administracijo | preskus telefona |
| Enota | prikazuje pravo enoto | preskus telefona |
| Jezik | prikaz je razumljiv predvidenim gostom | preskus telefona |
| Artikli | ni testnih ali ukinjenih artiklov | primerjava z 04 |
| Cene | ustrezajo potrjenemu meniju | primerjava z 04 |
| Alergeni | vidni so v predvidenem prikazu | preskus telefona |
| Razpoložljivost | nedostopen artikel ni ponujen kot naročljiv | preskus telefona |
| Lokacija QR | omejitev lokacije, kadar je uporabljena, je preverjena na mestu | preskus na lokaciji |
| Naročilo | gre v pravo enoto in pripravo | preskus iz 05 |
| Vrnitev | znana je prejšnja javna objava | zapis pred objavo |

QR kode ne tiskajte množično pred sprejemom javnega naslova.
Ne uporabljajte administratorskega telefona kot edinega dokaza javnega prikaza.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-245b7da9afb4 package=lite -->
### 34.2 CTI

| Preverjanje | Sprejemni kriterij | Dokaz |
|---|---|---|
| Ponudnik | ustreza odobrenemu ponudniku | integracijski seznam |
| Številka | pripada pravi enoti | odobren seznam številk |
| Prejemnik | pojavno okno vidi dovoljen uporabnik | test klica |
| Enota | klic ne ustvari naročila v drugi enoti | test klica |
| Podatki | prikaz ne razkriva nepotrebnih podatkov | opazovanje |
| Ročni postopek | osebje zna sprejeti klic ob izpadu | kratka vaja |
| Žeton | ni prikazan v dokazih | pregled paketa |
| Vrnitev | stara povezava je znana ali je tok ustavljen | zapis spremembe |

Testni klic naj uporablja odobren neobčutljiv primer.
CTI ne daje pravice uporabniku, da vidi vse podatke drugih enot.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-adfbacbf8de3 package=lite -->
### 34.3 BizBox

| Preverjanje | Sprejemni kriterij | Dokaz |
|---|---|---|
| Obseg dokumentov | jasno je, katere vrste se pošiljajo | odobrena specifikacija |
| Podjetje | prejemnik in izdajatelj ustrezata podjetju | kontrolni dokument |
| Enota | oznaka enote se pravilno preslika | kontrolni dokument |
| Enkratnost | kontrolni dokument je oddan enkrat | status oddaje |
| Status | uspeh ali zavrnitev je preverjen v dogovorjenem viru | zapis statusa |
| Zavrnitev | zavrnjeni zapis ostane sledljiv | evidenca izjem |
| Lastnik | določen je lastnik za zavrnitve | kontaktni seznam |
| Ponovitev | ponovitev je odobrena in omejena na konkreten dokument | odobritev |
| Vrnitev | nov tok se lahko ustavi brez brisanja zgodovine | načrt vrnitve |

BizBox uspeh ne nadomešča računovodskega pregleda vsebine.
Celotnega obdobja ne pošiljajte znova zaradi enega samega nejasnega statusa.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-40627bbc9813 package=lite -->
### 34.4 ERP

| Preverjanje | Sprejemni kriterij | Dokaz |
|---|---|---|
| Vir resnice | določen je za vsak prenesen podatek | specifikacija |
| Smer | jasno je, ali podatek prihaja v POS ali gre iz POS | specifikacija |
| Artikli | šifre niso tiho prepisane | kontrolni primer |
| Partnerji | preslikava ne ustvari napačnega partnerja | kontrolni primer |
| Računi | izbran je pravilen dokumentni obseg | kontrolni primer |
| Obdobje | prenos pokriva odobreno obdobje | zapis prenosa |
| Kontiranje | pregleda ga računovodstvo | odobritev |
| Enota | lokacija ni zamenjana v preslikavi | kontrolni primer |
| Enkratnost | dokument se pojavi enkrat | primerjava virov |
| Izjeme | zavrnitve imajo lastnika in rok | evidenca izjem |
| Vrnitev | nov avtomatski tok se lahko zaustavi | načrt vrnitve |

ERP prenos ni nadomestek za varnostno kopijo.
Če preslikava ni potrjena, ne razširite preskusa na množico dokumentov.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f005f6eb0d33 package=lite -->
## 35. Negativni preskusi več enot in zmožnosti

Negativni preskus dokazuje, da sistem pravilno zavrne nedovoljen dostop.
Uporabite namenske račune oziroma odobren nadzorovan čas.
Ne izvajajte negativnega preskusa s tujo prijavo ali z deljenjem gesla.

| Primer | Nastavitev pred preskusom | Pričakovan rezultat | Dokaz |
|---|---|---|---|
| Natakar enote A odpre enoto B | dovoljena je samo enota A | enota B ni na voljo za delo | zapis uporabniškega pogleda |
| Blagajnik A vidi register B | dodeljen je samo register A | register B ni uporaben | zapis uporabniškega pogleda |
| Kuhinja spremeni plačilo | ima pripravljalno vlogo | plačilni tok ni dovoljen | nadzorovan poskus |
| Blagajnik ureja uporabnike | nima administratorske zmožnosti | administrativni poseg ni na voljo | nadzorovan poskus |
| Skladiščnik nalaga FURS potrdilo | nima fiskalne zmožnosti | občutljivo dejanje ni na voljo | nadzorovan poskus |
| Vodja začasno dela v B | ima časovno omejeno B | vidi B samo v odobrenem obdobju | zapis dodelitve |
| Potekla začasna pravica | datum poteka je dosežen | dostop je odstranjen | pregled pravic |
| CTI enote A sproži B | številka je vezana na A | naročilo ne gre v B | test klica |
| QR enote A pokaže B | javni naslov je A | vsebina in naročilo ostaneta A | preskus telefona |
| Tisk A prispe na B | poti sta ločeni | B ne prejme izpisa | opazovanje ciljev |
| Terminal A uporabi B | terminal je dodeljen A | B ne prejme zahteve | terminalski zapis |
| ERP prenos A knjiži B | preslikava je enotna | kontrola pokaže pravo enoto | primerjava virov |

Vsak neuspel negativni preskus je blokada za sprejem, dokler ni odpravljen ali izrecno sprejet kot tveganje.
Po negativnem preskusu odstranite ali povrnite začasno uporabljeno testno dodelitev.
Ne zamenjujte nevidnega gumba z dokazom pravilno omejenega strežniškega dostopa; zabeležite opazovani obseg.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-eb39510397c5 package=lite -->
## 36. Predlogi evidenc naprav in vzdrževanja

<!-- pos-heading: id=pos-09-postopki-po-vlogah-40dfc3bc58eb package=lite -->
### 36.1 Inventar naprave

| Polje | Vrednost |
|---|---|
| Inventarna oznaka |  |
| Tip naprave |  |
| Proizvajalec in model |  |
| Serijska oznaka |  |
| Ime v sistemu |  |
| Podjetje |  |
| Enota |  |
| Register, če obstaja |  |
| Poslovni namen |  |
| Fizična lokacija |  |
| Most oziroma pot povezave |  |
| Širina papirja, če obstaja |  |
| Kodna stran, če obstaja |  |
| Omrežna oznaka brez skrivnosti |  |
| Tehnični lastnik |  |
| Operativni lastnik |  |
| Datum namestitve |  |
| Datum zadnjega uspešnega preskusa |  |
| Datum naslednjega pregleda |  |
| Odobrena rezervna pot |  |
| Status |  |

Inventarna oznaka na napravi naj se ujema z zapisom.
Serijske oznake ne nadomeščajte z vzdevkom osebja.
Pri odstranitvi naprave ohranite zgodovino in zapišite datum, razlog ter nadomestilo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-01adc3d0a0ec package=lite -->
### 36.2 Zapis vzdrževanja

| Polje | Vrednost |
|---|---|
| Datum in čas |  |
| Naprava oziroma integracija |  |
| Podjetje in enota |  |
| Register, če obstaja |  |
| Razlog posega |  |
| Simptom pred posegom |  |
| Stanje pred posegom |  |
| Izvedena sprememba |  |
| Izvajalec |  |
| Odobritelj |  |
| Preskusni primer |  |
| Rezultat preskusa |  |
| Neprizadeti cilji |  |
| Vrnitev potrebna |  |
| Vrnitev izvedena |  |
| Odprta točka in lastnik |  |
| Naslednji pregled |  |

Zapis vzdrževanja ne vsebuje dostopnih kod ali zasebnih ključev.
Če je bila naprava zamenjana, posodobite inventar in ne samo zapis vzdrževanja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-7df512af3173 package=lite -->
### 36.3 Dnevni pregled operativne naprave

| Kontrola | DA | NE | Opomba |
|---|---|---|---|
| Naprava je fizično označena |  |  |  |
| Napajanje je stabilno |  |  |  |
| Papir oziroma potrošni material je na voljo |  |  |  |
| Pokrov tiskalnika je zaprt |  |  |  |
| Gostitelj mostu ni v spanju |  |  |  |
| Prava enota je vidna |  |  |  |
| Pravi register je v uporabi |  |  |  |
| Terminal je na pravem mestu |  |  |  |
| Rezervni postopek je znan |  |  |  |
| Odprte napake so predane vodji |  |  |  |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-9f83c475427d package=lite -->
## 37. Dokaz varne vrnitve

Vrnitev ni brisanje dokazov ali ustvarjanje novega objekta.
Vrnitev pomeni omejeno povrnitev zadnje odobrene logične skupine.
Pred vrnitvijo preverite, da ni aktivnega plačila, fiskalnega toka ali tiskalne vrste, ki bi jo poseg prekinil.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-995abdbae270 package=lite -->
### 37.1 List vrnitve

| Polje | Vrednost |
|---|---|
| Oznaka prvotne spremembe |  |
| Razlog vrnitve |  |
| Podjetje |  |
| Enota |  |
| Register oziroma naprava |  |
| Čas odločitve |  |
| Odločevalec |  |
| Prejšnja odobrena vrednost |  |
| Obseg vrnitve |  |
| Potrjeno brez aktivnega plačila |  |
| Potrjeno brez nejasnega terminalskega rezultata |  |
| Potrjeno brez aktivnega fiskalnega posega |  |
| Izvajalec vrnitve |  |
| Kontrolni preskus po vrnitvi |  |
| Rezultat |  |
| Obvestilo osebju |  |
| Odprta nadaljnja naloga |  |

<!-- pos-heading: id=pos-09-postopki-po-vlogah-55124a625051 package=lite -->
### 37.2 Primeri ustrezne vrnitve

| Sprememba | Varna vrnitev | Dokaz po vrnitvi |
|---|---|---|
| Napačen cilj tiskanja | vrnite prejšnji potrjeni cilj | en izpis na pravem cilju |
| Napačna širina | vrnite prejšnjo širino | čitljiv kontrolni izpis |
| Napačna dodelitev terminala | vrnite staro dodelitev po razjasnitvi plačil | brez zahtev na napačnem terminalu |
| Neuspešna QR objava | vrnite prejšnjo potrjeno objavo | javni preskus telefona |
| Napačna CTI vezava | vrnite prejšnjo vezavo ali ustavite nov tok | test klica v pravi enoti |
| ERP napaka | zaustavite nov avtomatski tok, ne brišite dokumentov | evidenca neobdelanih izjem |
| BizBox napaka | zadržite ponovitev in ohranite status zavrnitve | sledljiv zapis |
| Preširoka pravica | odstranite samo novo nepotrebno zmožnost | negativni preskus |

Ne vrnite celotnega obdobja ERP zaradi ene nejasne vrstice.
Ne izbrišite poslovnega prostora kot način vrnitve fiskalne spremembe.
Ne ponovite terminalske transakcije kot način preverjanja vrnitve.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f484b7d20c63 package=lite -->
## 38. Administrativne laboratorijske vaje z vzorčnimi odgovori

<!-- pos-heading: id=pos-09-postopki-po-vlogah-f8ce5d9773c6 package=lite -->
### 38.1 Lab: nov register v drugi enoti

Primer: podjetje odpre teraso v enoti B, administrator pa trenutno dela v enoti A.
Naloga: pripravite dokazni paket brez zamenjave konteksta A in B.

Vzorčni odgovor:

1. Na naslovnico zapišem podjetje in enoto B.
2. Potrdim, da je enota B aktivna in ima odgovornega vodjo.
3. Preverim poslovni prostor, ki pripada B.
4. Register povežem s podjetjem, B in pravilnim prostorom.
5. Napravo označim z lokacijo terase in registrom B.
6. Terminal dodelim samo registru B.
7. Natisnem en kontrolni izpis v B.
8. Izvedem negativni preskus, da natakar A ne uporablja registra B.
9. Zapišem prejšnje stanje in rezervno pot.
10. Sprejem podpišem šele po pregledu vodje B.

Napačen odgovor je kopiranje registra A in domneva, da se bodo vse povezave same prilagodile.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-d76d9e4b098e package=lite -->
### 38.2 Lab: ZCS most po menjavi tablice

Primer: ZCS tablica ostane na istem registru, zamenjana pa je fizična naprava.
Naloga: dokažite, da ni nastal nov register in da QR zaključek ne prekine računa.

Vzorčni odgovor:

1. Ohranjen register preverim po imenu in oznaki.
2. V inventar vpišem novo serijsko oznako naprave.
3. Preverim dosegljivost lokalnega ZCS mostu.
4. Preverim, da je izbrana ZCS pot.
5. Zapišem širino pred in po posegu.
6. Izvedem en odobren kontrolni izpis z besedilom in šumniki.
7. Preverim celoten grafični zaključek, kadar obstaja.
8. Preverim, da izpis ni prišel v kuhinjo.
9. Preverim, da je nastal samo en izpis.
10. V zapis vzdrževanja dodam izvajalca in izid.

Napačen odgovor je ustvarjanje nove blagajne zato, ker nova tablica še nima lokalnih nastavitev.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-ec9ff3759036 package=lite -->
### 38.3 Lab: Viva demo nastavitev pred odprtjem

Primer: izvajalec je med pripravo uporabil Viva demo način.
Naloga: odločite, kateri dokaz manjka za produkcijski sprejem.

Vzorčni odgovor:

1. Demo rezultat označim kot dokaz konfiguracijskega preskusa.
2. Ne označim ga kot dokaz produkcijskega plačila.
3. Preverim identifikator terminala in register.
4. Preverim, ali je predviden terminalski ali Android tok.
5. Določim odobren produkcijski preskus po pravilih ponudnika.
6. Pred preskusom potrdim, da ni aktivnega plačila.
7. Primerjam jasen rezultat terminala in POS-a.
8. Zapišem dovoljeno referenco in čas.
9. Preverim, da drug register ni prejel zahteve.
10. Šele nato odstranim odprto točko iz prevzemnega paketa.

Napačen odgovor je sklep, da demo uspeh pomeni uspeh pri ponudniku v produkciji.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-b3a3c6c3bf96 package=lite -->
### 38.4 Lab: ERP dokument je prispel dvakrat

Primer: računovodstvo vidi dva zapisa za isti kontrolni dokument.
Naloga: zaščitite dokaz in preprečite širjenje napake.

Vzorčni odgovor:

1. Ustavim nadaljnje množično pošiljanje, če je to v mojem odobrenem obsegu.
2. Ne brišem nobenega zapisa.
3. Zapišem podjetje, enoto, obdobje in oznako kontrolnega dokumenta.
4. Primerjam vir resnice POS z ERP zapisoma.
5. Preverim status obeh prenosov.
6. Določim lastnika izjeme.
7. Ne pošljem celotnega obdobja znova.
8. Pripravim omejen popravek, ki ga odobri računovodstvo.
9. Po popravku preverim enkratnost istega dokumenta.
10. Zapišem zaključek in morebitni vpliv na poročilo iz 08.

Napačen odgovor je brisanje enega ERP zapisa brez revizijske sledi.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-13a89f5a459b package=lite -->
### 38.5 Lab: CTI naročilo pristane v napačni enoti

Primer: testni dohodni klic za enoto A ustvari naročilo v B.
Naloga: navedite varen odziv.

Vzorčni odgovor:

1. Označim CTI prevzem kot neuspešen.
2. Ne izvajam novih testnih klicev v produkcijskem tempu.
3. Zapišem številko oziroma njen dovoljeni identifikator, čas in obe enoti.
4. Preverim odobreno vezavo številke na enoto A.
5. Preverim, kdo vidi pojavno okno.
6. Ohraním zapis napačno ustvarjenega testnega primera po postopku.
7. Vezavo popravim samo z odobritvijo.
8. Izvedem en nov nadzorovan test.
9. Izvedem negativni test, da A ne ustvarja več naročila v B.
10. Zapišem ročni postopek, ki ga osebje uporablja do popravka.

Napačen odgovor je kopiranje CTI žetona iz B v A brez pregleda ponudnika in enote.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-2cb50ad1074b package=lite -->
## 39. POS PIN in hitra menjava identitete

POS PIN je namenjen hitri izbiri natakarja na skupni POS napravi. Ni nadomestilo
za administratorsko prijavo in ni dovoljenje za uporabo računa druge osebe.

Administrator pred dodelitvijo:

1. preveri podjetje in enoto;
2. potrdi, da oseba dejansko dela na tej napravi;
3. nastavi osebni POS PIN dolžine 4–12 številk;
4. preveri, da PIN ni enak javno znanemu ali drugemu uporabniškemu PIN-u;
5. zapiše dodelitev in pooblaščenega izvajalca;
6. izvede en nadzorovan preizkus prijave in menjave;
7. po potrebi določi datum preklica.

Natakar na skupni napravi izbere svojo identiteto in vnese svoj PIN. Pred vnosom
preveri enoto, blagajno, izmeno in prikazano ime. Po koncu dela se odjavi oziroma
izvede menjavo po lokalnem postopku. PIN-a ne narekuje sodelavcu in ga ne
uporablja za administratorske nastavitve.

Ob napačnem ali pozabljenem PIN-u ne ugibajte in ne ustvarjajte novega uporabnika.
Vodja preveri identiteto, administrator pa PIN ponastavi ali prekliče po
odobrenem postopku. Vsaka hitra menjava mora ostati v revizijski sledi z
uporabnikom, časom, enoto in napravo.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-59821f38d5e0 package=lite -->
## 40. Obseg naprave in prednost nastavitev

Naprava lahko vidi samo dovoljene mize. Prazen seznam dovoljenih miz pomeni
»vse mize«, ne pa »nobene mize«. Pred servisom preverite, ali prikaz ustreza
fizičnemu območju naprave.

Pri tiskanju in terminalu velja naslednji vrstni red:

1. izrecno vezana nastavitev naprave;
2. splošna prednostna nastavitev enote;
3. odobrena rezervna pot, kadar jo določa lokalni postopek.

Če je napravi izrecno vezan tiskalnik ali terminal, ga ne preglasite z naključno
izbiro druge naprave. Pri spremembi zapišite staro in novo vezavo ter izvedite
en kontrolni preskus. Kodna stran mora ohraniti šumnike in znak EUR; če jih
izpis ne prikaže pravilno, ustavite objavo in uporabite postopek za tiskalni
incident iz 11.

Nastavitve praga glasovnega prepoznavanja in AI na napravi so pomožne nastavitve.
Ne spreminjajo pravic uporabnika in ne smejo samodejno potrditi plačila, fiskalnega
dokumenta ali alergenskega podatka.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-c55c860b7f83 package=lite -->
## 41. Dokaz revizije in varno zapiranje incidenta

Revizijski zapis mora omogočiti odgovor na vprašanja: kdo je dejanje izvedel,
kdaj, v katerem podjetju/enoti/blagajni, na kateri napravi, nad katerim zapisom
in s kakšnim rezultatom. Pri hitri menjavi, spremembi naprave, spremembi pravic,
stornu, ponovnem poskusu prenosa ali obnovi integracije ne zadošča splošna
opomba »urejeno«.

Pri predaji podpore uporabite najmanjši potreben obseg:

- datum in čas v obliki **dd.mm.yyyy** ter lokalni čas;
- enoto, blagajno, napravo in uporabniško vlogo;
- identifikator naročila, računa ali prenosa;
- vidno sporočilo in že preverjene varne korake;
- lastnika naslednjega koraka in čas ponovne kontrole.

Ne vključujte PIN-a, gesla, sejnega žetona, zasebnega ključa, datoteke potrdila
ali celotne številke kartice. Če je naprava izgubljena ali obstaja sum
nepooblaščenega dostopa, najprej omejite dostop in ohranite sled; ne popravljajte
ali brišite zapisov zaradi videza.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-8af3c7184fdf package=lite -->
## 42. Meje podprtih ponudnikov in funkcij

Konfiguracijska možnost še ni dokaz, da je ponudnik v posamezni namestitvi
aktiviran. Payten, SumUp in Viva so opisane podprte integracijske poti, vendar
administrator pred produkcijo preveri dejansko pogodbo, napravo, enoto in
odobren preskus.

Viva **demo način** je namenjen samo konfiguracijskemu ali učnemu preskusu.
Uspešen demo rezultat ni dokaz produkcijskega plačila. Produkcijski prevzem
mora imeti ločen dokaz ponudnika, identifikator terminala, register, čas in
jasen rezultat v POS-u.

Urejevalnik javnega profila je na poti **Javna stran** (`/javna-stran`).
Vloge `admin`, `admin_enote` in `superadmin` lahko urejajo profil enote,
odpiralni čas in izjeme, omejitve spletnih rezervacij ter katalog bonov.
Spletna rezervacija je odvisna od aktivnega profila, odpiralnega časa, omejitev
rezervacij in razpoložljive mize. Pred objavo preverite dejanski javni prikaz.

Stripe Connect je vezan na podjetje, zato njegovo stanje in povezavo upravljata
le `admin` in `superadmin`; `admin_enote` lahko uredi profil enote, ne more pa
samostojno povezati računa podjetja. Spletni nakup bona je na voljo le ob
aktivnem profilu, aktivni ponudbi in pripravljenem Stripe računu (vključno z
omogočenimi plačili in izplačili). Pred produkcijsko objavo dokumentirajte
preskus; demo ali konfiguracijski prikaz ne dokazuje uspešnega plačila.
Notranja POS-izdaja in unovčenje bona sta ločena postopka.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-fd99bbf396dd package=lite -->
## 43. Skrbniški kontrolni seznam pred objavo spremembe

- [ ] Potrjeno je pravo podjetje, enota, blagajna in naprava.
- [ ] Sprememba ima poslovni razlog, odobritelja in lastnika.
- [ ] Zapisana je trenutna vrednost in načrt varne vrnitve.
- [ ] Ni odprtega plačila, fiskalnega postopka ali množičnega prenosa.
- [ ] Preverjene so pravice in obseg naprav.
- [ ] Izveden je en omejen preskus z dejanskim pričakovanim rezultatom.
- [ ] Pri ponudniku je ločen demo dokaz od produkcijskega dokaza.
- [ ] Revizijska sled vsebuje čas v obliki dd.mm.yyyy, izvajalca in rezultat.
- [ ] Osebje je obveščeno o vplivu in začasnih omejitvah.
- [ ] Neimplementirane funkcije niso predstavljene kot aktivne.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-3be0eef779fa package=lite -->
## 44. Preizkus vezave naprave, terminala, tiskalnika in mostu

Pred spremembo zapišite podjetje, enoto, napravo, trenutno vezavo terminala,
tiskalnika in lokalnega mostu ter osebo, ki je spremembo odobrila. Če vaša
vloga ne vidi nastavitev naprave, ne uporabljajte administratorskega računa;
zahtevo predajte skrbniku.

V kartici oziroma nastavitvah naprave, ki so v vaši namestitvi na voljo:

1. preverite, da naprava pripada pravi enoti in fizičnemu območju;
2. preverite dovoljene mize; prazen seznam pomeni vse mize;
3. preverite izrecno vezan tiskalnik in terminal;
4. preverite, ali lokalni most teče na določeni napravi;
5. shranite eno spremembo in izvedite kontrolni izpis;
6. pri terminalu preverite identifikator, ponudnika in rezultat testnega toka;
7. preverite šumnike in znak EUR na izpisu;
8. zabeležite dejanski rezultat in novo vezavo.

Prednost ima izrecna vezava naprave, nato splošna prednost enote in šele nato
odobrena rezervna pot. Konfiguracijska možnost sama po sebi ni dokaz, da je
terminal ali ponudnik v produkciji aktiven.

Če kontrolni izpis, most ali terminal odpove:

1. ustavite spremembo in preverite, ali je dokument že izdan;
2. pri nejasnem plačilu ne ponavljajte transakcije;
3. preverite omrežje, stanje mostu, cilj tiskalnika in identifikator terminala;
4. vrnite prejšnjo vezavo samo, če je to varno in je rezultat plačila znan;
5. zabeležite čas, napravo, staro in novo vezavo ter sporočilo;
6. eskalirajte po poglavju 11, če rezultat ostane nejasen.

Ne menjajte naprave, mostu in usmerjanja tiskanja hkrati, ker tako ni mogoče
ugotoviti vzroka napake. Preskus ne sme spreminjati prodajnega, fiskalnega ali
zalogovnega stanja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-4d82dab3736d package=lite -->
## 45. Uporabnik, vloga, enota in pravice

<!-- pos-heading: id=pos-09-postopki-po-vlogah-6e9d8f36e1d6 package=lite -->
### 45.1 Ustvarjanje in sprememba

Pred ustvarjanjem preverite identiteto osebe, podjetje, enoto in potrebno
uporabniško vlogo. Ustvarite uporabnika samo v skrbniškem zaslonu, ki ga vaša
vloga dejansko vidi. Naprave preverite kot konfiguracijo enote oziroma
registra, ne kot osebno dovoljenje uporabniškega računa, razen če določen
zaslon izrecno navaja drugače. Če konkretnega obrazca ali pravice ni, postopek
ustavite in zahtevo predajte administratorju; ne uporabljajte neposrednega
vpisa v bazo.

Po shranitvi:

1. preverite, da je uporabnik vezan na pravo podjetje in enoto;
2. preverite shranjeno vlogo in dodeljeno enoto ter ustrezno zmožnost funkcij;
3. preverite, da uporabnik vidi samo potrebne funkcije;
4. izvedite omejen preizkus brez produkcijskega plačila;
5. zapišite odobritelja, datum v obliki **dd.mm.yyyy** in izvajalca.

Spremembo izvedite v najmanjšem potrebnem obsegu. Vloga ni naziv delovnega
mesta. Konfiguracija terminala na blagajni ne daje uporabniku pravice do
ponovnega bremenitvenega poskusa ali administratorskih nastavitev.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-066a8c3b8443 package=lite -->
### 45.2 Ukinitev oziroma varen odvzem dostopa

Ob odhodu ali spremembi dela:

1. preverite aktivno uporabniško vlogo, dodeljeno enoto in uporabo hitre
   menjave natakarja;
2. odvzemite nepotreben dostop oziroma deaktivirajte račun po odobritvi;
3. prekličite POS PIN oziroma hitro menjavo, če je bila dodeljena;
4. preverite, da uporabnik ne more več začeti nove seje;
5. ohranite zgodovinske račune, naročila in revizijske zapise;
6. zapišite izvajalca, datum **dd.mm.yyyy**, razlog in rezultat preverjanja.

Uporabnika ne brišite samo zato, da bi skrili star zapis, in ne ustvarjajte
dvojnega računa za obhod zaklepa. Če je odvzem dostopa neuspešen, omejite
nadaljnje delo, zabeležite napako in obvestite administratorja.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-de051c02514d package=lite -->
## 46. Pregled revizijske sledi

Revizijski zapis mora omogočiti najmanj pregled akterja, časa, podjetja,
enote, naprave, zapisa, dejanja in rezultata. Pri hitri menjavi, spremembi
pravic, spremembi naprave, AI dejanju, stornu ali ponovnem poskusu prenosa
ne zadošča splošna opomba »urejeno«.

Kadar vaš uporabniški vmesnik ponuja zgodovino oziroma revizijo na podrobnosti
zapisa:

1. odprite zapis v pravilni enoti;
2. filtrirajte po datumu **dd.mm.yyyy**, akterju, dejanju ali rezultatu,
   če so ti filtri prikazani;
3. primerjajte čas in identifikator s primarnim zapisom;
4. shranite dovoljeno poročilo oziroma izvoz po internem postopku;
5. preverite, da izvoz ne vsebuje PIN-ov, gesel, sejnih žetonov ali celotnih
   številk kartic;
6. zapišite, kdo je pregled opravil in do kdaj mora biti zadeva ponovno
   preverjena.

V pregledani izvedbi ni potrjenega enotnega skrbniškega zaslona, ki bi
omogočal poljuben filter, izvoz in nastavitev hrambe vseh revizijskih zapisov.
Nekateri tokovi imajo lastno zgodovino oziroma revizijski prikaz, drugi pa
zapis shranijo strežniško. Če zahtevanega filtra ali izvoza ne vidite, ne
sklepajte, da zapis ne obstaja, in ne posegajte neposredno v bazo; zahtevajte
pooblaščen izpis oziroma podporni postopek.

Splošna doba hrambe revizije v POS-u ni s tem priročnikom določena. Uporabite
odobreno politiko podjetja in zakonske roke. Revizijskih zapisov ne brišite
zaradi popravka napačnega podatka; popravek mora ustvariti novo sled.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-c4973d825f23 package=lite -->
## 47. Končna kontrola skrbniške spremembe

- [ ] Sprememba je izvedena v pravem podjetju in enoti; preverjena je tudi
      naprava, če jo sprememba zadeva.
- [ ] Uporabniška vloga in dodeljena enota ustrezata potrebnemu delu.
- [ ] Ob odvzemu dostopa so odstranjene nepotrebne vezave; POS PIN za hitro
      menjavo je preklican, kadar je bil dodeljen.
- [ ] Izveden je omejen preskus brez ponavljanja plačila.
- [ ] Tiskalnik, most, terminal in kodna stran so preverjeni ločeno.
- [ ] Zabeleženi so akter, čas, dejanje in rezultat.
- [ ] Če potreben revizijski prikaz ni na voljo, je odprt pooblaščen zahtevek,
      ne neposreden popravek baze.

<!-- pos-heading: id=pos-09-postopki-po-vlogah-verified-routes-7f0c6a21d9b4 package=lite -->
## 48. Trenutni vstopni zasloni in meje dostopa

V POS-u so trenutno vidne poti `/nastavitve`, `/meni` in `/zaloge`; podstrani
KDS so `/kuhinja`, `/pice` in `/tocilnica`. Zavihek Nastavitve uporablja
`/nastavitve?tab=...`; nepodprta ali nedovoljena izbira se vrne na varen
privzeti zavihek. Vidnost zavihka ni dokaz pravice za vsak posamezen API
postopek.

Na strežniški strani se dostop do mnogih funkcij dodatno preveri glede na
uporabniško vlogo, podjetje in aktivno enoto. Funkcija je lahko nedostopna,
če je zmožnost izklopljena za enoto ali je paket POS ne vključuje. Če
uporabnik zavihka ali podatkov ne vidi, najprej preverite račun, aktivno
enoto, zmožnosti enote in sporočilo o napaki. Ne preizkušajte dostopa z
računom sodelavca.

Naprava v POS-u ima identiteto oziroma zapis konfiguracije (na primer
terminal ali tiskalnik); to ni isto kot uporabniška vloga in pregledani tokovi
ne kažejo splošnega pravila, po katerem bi se vsaki osebi dodeljevala
posamezna fizična naprava. Uporabnikovo delo omejujejo račun, enota in
zmožnosti funkcij. Ne sklepajte, da je naprava dovoljena ali povezana samo
zato, ker je konfigurirana v Nastavitvah.

Preverjene poti API za povezane postopke:

| Namen | Pot API | Opomba |
|---|---|---|
| uporabniki POS na ravni podjetja | `/api/pos/admin/podjetja/:companyId/uporabniki` | `GET`, `POST`, `PUT`, `DELETE`; administrativni dostop |
| predloge drobnega inventarja | `/api/artikli/drobni-inventar-predloge` | `GET` vrne predloge; `POST` jih uvozi v trenutno enoto |
| nalaganje datoteke za inventurni OCR | `/api/inventure/upload-url` | dovoljen PDF/JPEG/PNG do 20 MB |
| branje popisnega lista OCR | `/api/inventure/ocr` | obseg `material` ali `drobni`; rezultat je predlog, ne potrjena inventura |
| priložen dokument inventure | `/api/inventure/:id/document` | dokument obstoječe inventure |
| hitra menjava natakarja | `/api/quick-switch/switch` | zahteva veljaven PIN in odprto izmeno v aktivni enoti |

Pot API ne obide uporabniške avtorizacije, izbire enote ali validacije podatkov.
Pri napaki shranite vidno sporočilo, pot zaslona, enoto, čas in identifikator
dokumenta, če obstaja; ne poskušajte ponavljati poslovnega dejanja na slepo.

<!-- pos-heading: id=pos-current-platform-unit-context package=lite -->
## Platformni dostop, operativna enota in osveževanje

Platformna prijava skrbnika brez aktivne POS enote ni operativna prijava
v posamezno gostinsko enoto. V platformnem pogledu ne nastavljajte e-pošte,
blagajne, KDS ali drugih podatkov enote. Za e-pošto uporabite operativno
POS prijavo v pravi enoti in **Nastavitve → E-pošta**; te nastavitve niso
e-poštne nastavitve celotne platforme.

Po menjavi uporabnika, podjetja ali enote preverite glavo programa in
počakajte na osvežitev. Stara naročila, dogodki KDS, opozorila in nastavitve
prejšnje enote niso dokaz trenutnega stanja. Če povezava ne deluje,
preverite seznam in aktivni kontekst pred novim poslovnim dejanjem.
Obnovljena povezava ponovno uskladi podatke; ponavljanje ukaza pa lahko
pomeni novo naročilo, zato ga ne uporabljajte namesto osvežitve.

Pri odprtem naročilu oziroma pogovornem oknu lahko obvestila osvežujejo
ozadje. Preverite, da izbrane velikosti, modifikatorji in vnesene količine
ostanejo pravilni. Če se pojavi opozorilo ali zavrnitev, najprej primerjajte
shranjene postavke in stanje priprave ter šele nato nadaljujte.
