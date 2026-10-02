# Osnutek implementacije: kartice partnerjev, zapiranje postavk in bančna plačila

Datum: 2. 10. 2026  
Produkt: Bookie ERP  
Status: osnutek za uskladitev in izvedbo; ni dovoljenje za spreminjanje finančnih podatkov.

### Referenčne priloge

- `attached_assets/image_1790915047937.png` — kartica partnerja in ročno zapiranje/odpiranje.
- `attached_assets/Promet_par_naz_1790915556254.PDF` — zbirni promet po partnerjih.
- `attached_assets/kpz(1)_1790915948557.PDF` — kartica STEPHANY.
- `attached_assets/kpz_1790915948557.PDF` — kartica OBČINA LAŠKO.
- `attached_assets/image_1790916351591.png` — priprava plačil, prazna tabela.
- `attached_assets/image_1790916951538.png` — priprava plačil z odprtimi postavkami iz prejšnjih let.

## 1. Namen in obseg

Novi program mora omogočiti delo, dokazljivost in izpise, prikazane v uporabnikovem starem programu:

1. Kronološko kartico poslovnega partnerja na vseh kontih.
2. Vpogled v dokumente in zneske, ki posamezno postavko zapirajo.
3. Ročno popolno ali delno zapiranje ter ponovno odpiranje postavk.
4. Zbirni promet po partnerjih, ločeno s saldom obdobja in odprtimi ostanki.
5. Pripravo polnih ali delnih plačil dobaviteljem z izbranega TRR.
6. Enoten XML paket za ročni uvoz v spletno banko.
7. Pravilno upoštevanje prenesenih zgodovinskih podatkov in zapiranj.

Dopolnitve AJPES/FURS iz predhodnega pregleda so navedene v ločenem razvojnem sklopu, da ne zadržujejo izvedbe teh funkcionalnosti.

## 2. Referenca in nespremenljiva pravila

- Vsi podatki in izpisi, ki jih je uporabnik predložil in potrdil, so preverjeno pravilna referenca.
- Neskladja se rešujejo v prenosu, preslikavah, obsegu prikaza ali izračunih novega programa; izvirnih podatkov se ne prilagaja novemu prikazu.
- Ne ustvarjamo umetnih izravnav, ne knjižimo osnutkov samodejno in ne spreminjamo produkcije.
- Celotna stara zgodovina in trenutno preneseno obdobje nista enak obseg. Primerjava mora jasno navesti oba obsega.
- Letne otvoritve niso tekoči promet. Seštevanje otvoritev več let skupaj s prometom ne sme podvojiti salda.
- Ponovno odpiranje je sprememba povezave zapiranja, ne storno plačila ali knjižbe.
- Priprava paketa, izvoz XML in uvoz v banko niso dokaz izvedenega plačila.
- Aktivno poslovno leto ne sme skriti še odprtih postavk iz prejšnjih let.
- Računovodski prikaz privzeto vključuje knjižene postavke. Osnutki imajo ločen, jasno označen pregled in niso podlaga za izvedbo plačil.
- Model in izpisi morajo veljati za vsako podjetje, ne samo za Mikrono.

## 3. Kartica poslovnega partnerja

### Filtri in prikaz

- Podjetje, partner, konto, datum od–do in samo odprte/vse postavke.
- Izbor konta ni omejen na 120 in 220: kartica je na voljo za vse konte s knjižbami partnerja.
- Privzeti vrstni red je datum dokumenta, znotraj istega dne pa stabilen izvorni vrstni red postavk.
- Vmesni saldo se računa nad celotnim izbranim tokom; filter odprtih postavk ne sme potiho spremeniti računovodskega salda v saldo vidnih vrstic.
- Pri obdobju, ki se začne po začetku zgodovine, se prikažeta začetno stanje in gibanje v obdobju brez podvajanja otvoritev.
- Knjižbe imajo povezavo do temeljnice oziroma izvornega dokumenta.

### Stolpci kartice

Vrsta dokumenta, številka temeljnice, številka dokumenta, opis knjižbe, datum dokumenta, datum DUR, datum zapadlosti, debet, kredit, tekoči saldo in odprti ostanek.

Datum DUR se prikaže po preverjeni preslikavi iz starega vira. Manjkajočih ali očitno neveljavnih datumov se ne izmišlja.

### Podrobnosti zapiranja

Ob izbiri postavke se prikažejo vse njene povezave:

- leto, vrsta, temeljnica in številka nasprotnega dokumenta;
- datum dokumenta in datum učinka zapiranja;
- znesek posameznega zapiranja;
- izvor povezave: ročno, bančni izpisek ali zgodovinski prenos;
- stanje povezave in revizijska sled ponovnega odpiranja.

Vpogled je omogočen tudi z nasprotne strani: pri plačilu vidimo vse postavke, ki jih plačilo zapira.

### Izvoz in tisk

PDF je obvezen. XLSX je predlagan dodatni izvoz za preverjanje in nadaljnjo obdelavo.

PDF mora vsebovati glavo podjetja, partnerja, konto, obdobje, uporabljene filtre, postavke, večvrstične povezave zapiranja in končne seštevke. Glave se ponavljajo na nadaljevalnih straneh; dolgi nazivi in reference se ne odrežejo. Zaslon in izvoz uporabljata isti izračun.

## 4. Ročno zapiranje in ponovno odpiranje

### Podprti primeri

- En račun, eno plačilo.
- En račun, več delnih plačil.
- Eno plačilo, več računov.
- Delno zapiranje s poljubno določenim zneskom do razpoložljivega ostanka.
- Ustrezne druge knjižene postavke, ne samo računi in bančna plačila: dobropisi, poboti in prenesene povezave.

### Postopek zapiranja

Uporabnik označi postavke, določi razdelitev zneskov, datum učinka in po potrebi opombo. Pred potrditvijo vidi ostanke pred in po zapiranju.

Predlagano začetno pravilo je zapiranje znotraj istega podjetja, partnerja in konta. Zapiranje preko različnih kontov ni samodejno dovoljeno: potrebuje ustrezno računovodsko preknjižbo oziroma posebej potrjeno poslovno pravilo. Pri negativnih in storniranih postavkah se upošteva dejanski učinek knjižbe, ne samo oznaka debet/kredit.

### Postopek odpiranja

Uporabnik izbere konkretno povezavo in jo v celoti ali delno razveljavi z razlogom. Knjižbi ostaneta nespremenjeni. Ostanek se poveča samo za dejansko razveljavljeni znesek.

### Varovala

- Znesek mora biti pozitiven in ne sme preseči razpoložljivih ostankov.
- Ni povezovanja različnih podjetij.
- Zapiranje in ponovno odpiranje sta atomska: sočasna uporabnika ne moreta porabiti istega ostanka.
- Ponovljena zahteva ne ustvari podvojenega zapiranja.
- Stare povezave se ne brišejo; ohranijo se kdo, kdaj, datum učinka, znesek in razlog spremembe.
- Za zaprta obdobja velja obstoječa politika zaklepanja in pooblastil. Popravki zgodovinske evidence ne smejo tiho spremeniti že zaključenih poročil.

## 5. Zbirni promet po partnerjih

### Filtri in stolpci

Obdobje od–do, konto ali več kontov, partner ali vsi partnerji ter samo odprti/vsi.

Izpis je razdeljen po kontih. Vrstica vsebuje šifro partnerja, naziv, kraj, debet obdobja, kredit obdobja, saldo obdobja in odprti ostanek. Na voljo so seštevki po kontu in skupni seštevki.

### Računska pravila

- Saldo obdobja je debet obdobja minus kredit obdobja.
- Odprti ostanek se računa iz posameznih postavk in njihovih zapiranj, ne iz salda ali njegove absolutne vrednosti.
- Ničelni saldo ne pomeni, da ni odprtih postavk.
- Za zgodovinski datum se ne vključijo poznejše knjižbe ali poznejši učinki zapiranj.
- Odprte debetne in kreditne postavke se vodijo ločeno; samodejno netiranje ne nadomesti dejanskega zapiranja.
- Pred izvedbo končnega stolpca »Ostanek« se z izvirno logiko starega programa potrdi natančno predznakovno in časovno pravilo, zlasti za istočasno odprte postavke obeh strani. Pravilnosti uporabnikovih izpisov se ne postavlja pod vprašaj.
- Negativna knjižba, ki je bila med prenosom normalizirana na nasprotno stran, ohrani izvorno predstavitev za primerjalni izpis. Neto saldo in bruto stolpci se preverjajo ločeno.

PDF sledi uporabnikovi referenci; XLSX je predlagan dodatni izvoz. Iz vrstice je omogočen prehod na kartico istega partnerja in konta.

## 6. Priprava plačil dobaviteljem

### Izbor in tabela

Uporabnik izbere izvorni TRR, datum izvedbe in po potrebi mejo zapadlosti. Privzeto vidi odprte obveznosti vseh dobaviteljev, tudi iz prejšnjih let, razvrščene po zapadlosti.

Stolpci:

- datum zapadlosti in datum dokumenta;
- vrsta in številka temeljnice ter številka dokumenta;
- šifra in naziv partnerja;
- ciljni IBAN in plačilni podatki oziroma jasna možnost njihovega pregleda;
- koda namena, namen, model in sklic;
- odprti znesek;
- znesek predlaganega plačila;
- oznaka vključitve v paket.

Zapadle in nezapadle postavke se razlikujejo z oznako in barvo. Omogočena sta posamezni in skupinski izbor ter ročni vnos delnega zneska.

### Seštevki in kritje

Ločeno prikažemo:

1. Vsoto vseh prikazanih odprtih obveznosti.
2. Vsoto obveznosti, zapadlih do izbranega datuma.
3. Vsoto izbranih plačilnih zneskov za prenos.
4. Zadnje zanesljivo evidentirano stanje konkretnega TRR, datum tega stanja in opozorilo o morebitni zastarelosti.

Kritje se ne računa iz salda konta 110x. Uporabi se evidenca bančnih izpiskov in nadaljnjih transakcij brez dvojnega štetja. Program ne trdi, da gre za živo stanje banke.

Pred shranjevanjem in izvozom strežnik ponovno preveri ostanke, dovoljenja, ciljne IBAN-e, zneske, že pripravljene naloge in evidentirano kritje.

## 7. Paketni XML za banko

- Ena datoteka za vse naloge iz potrjenega paketa, z izbranim izvornim TRR.
- Izvoz ne sme uporabiti prvega TRR podjetja namesto izbranega računa.
- Vsak nalog ohrani svoj znesek, prejemnika, ciljni IBAN, datum izvedbe in pravilne plačilne reference.
- Različni prejemniki in ciljni IBAN-i pomenijo ločene bančne transakcije znotraj istega paketa.
- Združevanje več računov v en nalog je dovoljeno le pri združljivih bančnih navodilih; sicer ostanejo ločeni nalogi.
- Konkretna banka oziroma njen uvozni profil določa sprejeto različico XML, obvezna polja in strukturirani sklic. Sedanje različice pain.001 se ne razglasi za ustrezno vsem bankam brez preverjanja.
- Pred prenosom se pokažeta število nalogov in kontrolna vsota.
- Priprava celotnega paketa je atomska; napaka enega naloga ne sme pustiti neopaženega delno pripravljenega paketa.
- Paket ima identifikator, nespremenljiv posnetek potrjenih navodil, zgodovino izvozov in možnost ponovnega prenosa iste vsebine.
- Ponovni prenos obstoječega XML ne ustvari novih nalogov. Program opozori na možnost ponovnega uvoza v banko.
- Postavke, že vključene v drug aktiven paket, se jasno označijo in zaščitijo pred nenamernim ponovnim plačilom.

### Življenjski cikel

Osnutek → potrjen za izvoz → izvožen. Izveden, zavrnjen, delno izveden ali preklican je ločeno stanje na ravni naloga, določeno na podlagi dejanske bančne izvedbe.

Ob uvozu izpiska se transakcija poveže z nalogom in ustreznimi knjižbami. Šele tedaj se evidentira izvedeno plačilo in zapiranje; delna izvedba zapre samo izvedeni znesek.

Preklic neizvedenega naloga ne stornira denarne knjižbe. Razveljavitev dejansko izvedenega plačila ostaja ločen računovodski postopek.

## 8. Podatkovna in programska zasnova

Obstoječe modele se razširi, ne nadomesti z nepovezanim vzporednim sistemom.

### Enotna evidenca postavk in zapiranj

- Osnova kartice je knjižbena postavka glavne knjige; račun in bančna transakcija sta povezani izvorni listini.
- Povezava zapiranja povezuje dve konkretni postavki in določen znesek ter datum učinka.
- Evidenca podpira več povezav na obeh straneh in sled razveljavitev.
- Zgodovinske povezave se preslikajo z ohranjenimi izvornimi identifikatorji. Dvosmerno zapisano staro povezavo se upošteva samo enkrat.
- Pri povezavi na postavko zunaj prenesenega obsega se pokaže ohranjena izvorna referenca, ne izmisli manjkajoče knjižbe.
- Za stare prejete račune brez računskih vrstic se uporabi preverjen finančni znesek oziroma povezana knjižba, ne ničelni znesek zaradi praznega seznama vrstic.
- Obstoječa zapiranja plačil, zgodovinska zapiranja kupcev in dobaviteljev ter bančne povezave se uskladijo brez dvojnega štetja.
- Prehod na enotni model mora imeti primerjalni izračun in varno ponovno izvajanje; ne sme sam spremeniti plačanosti dokumentov.

### Skupni izračun

Kartica, zbirni promet, odprte postavke, starostna analiza in priprava plačil uporabljajo isti preverjeni izračun odprtosti na datum.

Denarni zneski se računajo decimalno. Vmesni saldo, odprti ostanki, datum dokumenta in datum učinka zapiranja imajo ločeno semantiko.

### Dostop in varnost

Vsi vpogledi, izvozi in spremembe so omejeni na aktivno podjetje. Bralna vloga ne zapira postavk in ne ustvarja plačilnih paketov; računovodja in lastnik delujeta skladno z obstoječimi pooblastili.

## 9. Uskladitev razvojnih podatkov Mikrone

Pred potrditvijo novega izračuna izvedemo ponovljiv, samo bralni primerjalni pregled. Spremembe finančnih podatkov imajo ločen pregled in odobritev.

### STEPHANY, konto 1200000

Pravilna stara referenca:

- Kartica celotne zgodovine: debet 11.599,90 EUR, kredit 11.534,91 EUR, saldo 64,99 EUR, odprti ostanek 65,00 EUR.
- Račun 000134 z dne 7. 8. 2025: 61,00 EUR, zapiranje 57,00 EUR, ostanek 4,00 EUR.
- Račun 000125 z dne 10. 9. 2026: odprto 61,00 EUR.
- Plačilo 61,00 EUR z dne 10. 9. 2026, bančna temeljnica 000128, zapira račun 000110.

V pregledanem razvojnem posnetku zadnje navedeno plačilo ni bilo prisotno. Pred dopolnitvijo je treba preveriti njegov izvorni zapis in povezavo; ne ustvariti plačila iz ugibanja ali ga podvojiti.

Primerjava celotne stare zgodovine je mogoča šele z ustreznim obsegom podatkov. Za trenutno preneseno obdobje preverjamo postavke ločeno od letnih otvoritev.

### OBČINA LAŠKO, konto 2200000

Pravilna stara referenca:

- Kartica celotne zgodovine: debet in kredit po 2.042,88 EUR, saldo in ostanek 0,00 EUR.
- V pregledanem obsegu 2020–2026 se vse referenčne postavke ujemajo s prenesenimi knjižbami.
- Zapiranja iz leta 2026 vključujejo tudi plačilo računa iz leta 2025.

Ničelni ostanek mora biti rezultat preverjenih zapiranj, ne posledica manjkajočih računskih vrstic.

### Osnutki in knjiženje

Postavke leta 2026 so bile ob pregledu osnutki. Zanje uvedemo primerjalni vpogled, ne samodejnega knjiženja. Stanje se pred dejansko izvedbo ponovno preveri.

## 10. Predlagani vrstni red izvedbe

### Faza 1 — zanesljivi podatki in izračun

Preslikava zapiranj, zgodovinski datum, ločitev otvoritev/prometa, zneski starih prejetih računov, primerjalni pregled in razrešitev manjkajočega zapisa. Brez samodejnih posegov v knjižbe.

### Faza 2 — kartica in ročna zapiranja

Kronološki vpogled, podrobnosti povezav, ročno delno/popolno zapiranje, ponovno odpiranje, revizijska sled in obvezni PDF.

### Faza 3 — zbirni promet

Skupine po kontih in partnerjih, saldo obdobja, preverjeni odprti ostanki, PDF in predlagani XLSX ter povezava na kartico.

### Faza 4 — priprava plačil in paketni XML

Tabela vseh odprtih obveznosti, delni zneski, pravilni TRR, atomski paket, preprečevanje podvajanja, preverjanje XML in preizkus uvoza za izbrano banko.

### Faza 5 — bančna izvedba

Povezovanje bančnega izpiska s paketom, delne izvedbe, zavrnitve in pravilno zapiranje brez podvajanja knjižb.

## 11. Merila sprejema

- Kartica na zaslonu in PDF kažeta iste postavke, povezave in seštevke.
- Vsota izvlečenih referenčnih vrstic se ujema s seštevki starega PDF-ja.
- Več delnih plačil zapira en račun; eno plačilo pravilno zapira več računov.
- Ponovno odpiranje konkretne povezave ne spremeni knjižb in ne odpira nepovezanih poravnav.
- Zgodovinski pregled pred poznejšim plačilom pokaže takrat še odprto postavko.
- Poznejše ponovno odpiranje ne spremeni tiho predhodnega časovnega stanja.
- Ničelni saldo ne skrije dejansko odprtih postavk.
- Otvoritve se ne podvojijo pri večletnem prikazu.
- Pretekle še odprte obveznosti so vključene v pripravo plačil.
- Dva sočasna uporabnika ne moreta preveč zapreti iste postavke.
- Bralna vloga in uporabnik drugega podjetja ne moreta spremeniti ali izvoziti tujih plačil.
- XML uporablja izbrani izvorni TRR ter točno izbrane zneske in prejemnike.
- Več dobaviteljev se izvozi z eno datoteko; neuspel paket ne pusti tihih delnih rezultatov.
- Izvoz ne zapre računa; ponovni prenos ne podvoji nalogov.
- Prejeta bančna transakcija se ne knjiži in ne zapre dvakrat.
- Za podprto banko je potrjena skladnost XML in preizkušen uvoz.
- Primerjalne reference Mikrone dosežejo pričakovano stanje v enakem obsegu in na enak datum.

## 12. Ločen sklop AJPES/FURS in dokumentacija za banke

Ta sklop povzema predhodni pregled; pred izvedbo vsakega obrazca je treba preveriti aktualni letnik in dejansko obveznost podjetja.

### AJPES

- Besedilna pojasnila oziroma predpisana mikro razkritja.
- Predlog in sprejeta razporeditev dobička oziroma obravnavanje izgube.
- Opredelitve in izjave za pravilno predložitev.
- Preverjena podpora aktualnemu letniku XML; trenutna potrjena podpora je 2025.
- Pogojno: denarni tokovi, gibanje kapitala, poslovno/revizorjevo poročilo, konsolidacija, SFR in ČPPS.

### FURS

- Celovit DDPO z davčnimi prilagoditvami, olajšavami, izgubami, prilogami in izvozom.
- Dokončanje DDV-O XML.
- KIR/KPR: ustrezna uvozna embalaža datotek in hranjenje dokazil o oddaji ter sprejemu.
- Pogojno: RP-O, PD-O, REK-O in obračun plač; DDD-DDD/OPSV za ustrezne uporabnike ter posebni režimi.
- Ročni uvoz v eDavke ostaja dopusten postopek; neposredna oddaja ni pogoj za prvi razvojni sklop.

### Dokumentacija za poslovne banke

- Preverjeni zgodovinski saldi in starostne analize terjatev/obveznosti.
- Paket obstoječih letnih/medletnih izkazov in bruto bilance.
- Pogojno glede na pogodbo: pregled kreditov/lizingov, načrti denarnih tokov, poslovni/investicijski načrti in finančne zaveze.
- Bančni plačilni XML ni isto kot paket dokumentacije za kreditno presojo.

## 13. Odločitve pred izvedbo

1. Ciljna banka oziroma banke in njihov potrjeni uvozni XML profil.
2. Natančna stara semantika zbirnega »Ostanka«, časovnega preseka in datuma DUR.
3. Ali poleg zapiranja na istem kontu potrebujemo posebej opredeljen postopek med različnimi konti.
4. Dovoljen obseg dopolnitve zgodovinskih podatkov in ločena odločitev o knjiženju osnutkov.
5. Prednostni obseg AJPES/FURS glede na ciljne vrste podjetij; pogojnih obrazcev ne uvajamo kot obveznost vseh uporabnikov.

Te odločitve ne preprečujejo priprave podatkovnega izračuna in vmesnika kartice, preprečujejo pa samovoljno spreminjanje finančnih podatkov oziroma razglasitev nepreverjene združljivosti z bankami.