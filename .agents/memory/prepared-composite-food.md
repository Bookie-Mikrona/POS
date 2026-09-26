---
name: Pripravljena in sestavljena hrana
description: Poslovna pravila za operativno zamrznjeno zalogo, sestavnice, porabo in kalo.
---

Pripravljena hrana ima operativno zamrznjeno zalogo brez lastnega konta glavne knjige. Dnevno zamrznjena količina pomeni količino, ki se ta dan vrne v zamrzovalnik, zato je novo stanje: prejšnje stanje − odmrznjeno + danes zamrznjeno. Ob zaključku se vse surovine za danes pripravljeno količino porabijo po normativu; odmrzovanje ne ustvari nove porabe.

**Why:** Zamrznjene porcije so že stroškovno porabljene ob pripravi. Ponovna poraba ob odmrzovanju bi strošek podvojila, zamenjava celotnega salda z dnevno zamrznjeno količino pa bi izbrisala nedotaknjene stare porcije.

**How to apply:** Kalo vrednoti po sledljivi ponderirani alokaciji in ga v POS→ERP temeljnici prenese s stroška materiala na ločen konto kala. Sestavljena hrana nima lastnega surovinskega normativa: à la carte komponente razširi do njihovih surovin, pripravljene komponente pa povečajo le dnevno prodajo pripravljene hrane.

Skupna fizična količina za prikaz zalog je nezamrznjena razpoložljiva količina + zamrznjeni saldo − odtajano v izbrani še odprti dnevni evidenci. Če je evidenca zaključena, je odtajano za ta prikaz 0.

**Why:** Odtajanje se od zamrznjenega salda odšteje šele ob zaključku evidence. Med odprto evidenco so iste porcije že vključene v nezamrznjeno razpoložljivost in še vedno v shranjenem zamrznjenem saldu; neposredno seštevanje bi jih štelo dvakrat.

**How to apply:** Fizični prikaz in prodajno razpoložljivost obravnavaj ločeno. Pri skupni zalogi od zamrznjenega salda odštej le odtajano iz evidence, ki je izbrana kot aktualna (tudi če je iz prejšnjega poslovnega dne); pravil prodaje s tem ne spreminjaj.

Letna začetna zaloga pripravljene hrane je samo operativni prenos zamrznjenih porcij iz prejšnjega leta in ne ustvarja začetne knjižbe ali temeljnice. Vneseni strošek na porcijo je nadomestna vrednost samo za kalo odtajanih starih porcij; nova priprava dobi strošek iz dejanske porabe surovin na dan priprave.

**Why:** Stare zamrznjene porcije so bile stroškovno obračunane že ob pripravi v prejšnjem letu, vendar brez njihovega prenesenega stroška kasneje ni mogoče ovrednotiti odtajanih porcij, ki se zavržejo brez nove priprave.

**How to apply:** Otvoritveni vnos spreminja le operativno količino in strošek zamrznjenih porcij. Pri zaključku dneva vrednoti stari odtajani del s prenesenim stroškom, danes pripravljeni del pa s stroškom današnjega normativa; otvoritev sama nikoli ne knjiži.

Razpoložljivost je v POS/QR prikazana na prodajni kartici artikla kot število porcij; dnevna evidenca je ne prikazuje kot dodatnega stolpca. Podatek je informativen, dokončno ga vedno preveri strežnik v serializirani transakciji. Poraba vključuje izbrane modifikatorje, faktor velikosti in zgodovinsko vrsto hrane z naročilne vrstice.

**Why:** Prikaz se lahko med sočasnimi naročili zastara, modifikator pa lahko porablja pripravljeno komponento tudi takrat, ko je osnovni artikel à la carte.

**How to apply:** Vsaka pot, ki poveča porabo, mora pred zapisom atomsko preveriti pozitivni prirast. Poznejša sprememba vrste artikla ne sme spreminjati porabe že prodanih vrstic. Razprodane artikle skrij, vendar nikoli ne zaupaj samo odjemalcu.

Če pripravljeno jed porablja izbirni modifikator, na prodajni kartici pokaži porcije po posamezni možnosti in jih ponovi v izbirniku; ne prikaži ene same »razpoložljivosti artikla« iz stanja neobveznih dodatkov.

**Why:** Gost lahko izbere različne dodatke ali nobenega. Minimum njihovih zalog ne pove, koliko osnovnih jedi je mogoče prodati, in bi lahko napačno označil artikel za razprodan.

**How to apply:** Število porcij modifikatorja računaj iz njegovih normativnih pripravljenih sestavin na istem stanju kot strežniško preverjanje. Pri kombinacijah in sočasnih naročilih ostane končna odločitev atomsko preverjanje ob shranitvi.

`prepared` opisuje način količinske evidence, ne poslovne vloge artikla. Pripravljena jed je lahko končna prodajna jed ali neprodajni polizdelek.

**Why:** Sam tip `prepared` ne loči ciganskega golaža, ki se lahko neposredno prodaja, od esence ali štruklja, ki sta le komponenti druge jedi.

**How to apply:** Kjer je treba ločiti končne jedi od polizdelkov, kombiniraj `mealType` z zastavico prodajnega artikla. Prodajni `prepared` je končna jed; neprodajni `prepared` je polizdelek.

Neprodajni in nenabavni živilski artikel tipa à la carte je lahko polizdelek z lastnim normativom surovin. Ne potrebuje prodajne cene ali pripravljene zamrznjene zaloge.

**Why:** Polizdelek, kot je paniran zrezek, nastaja sproti iz nabavnih surovin in je lahko sestavina sestavljene jedi, čeprav sam ni naprodaj. Brez njegovega normativa sestavljena jed ne more pravilno razširiti porabe do surovin.

**How to apply:** Urejevalnik recepta ne sme sklepati, da imajo normativ samo prodajni artikli; zgolj nabavnih artiklov pa zaradi tega ne obravnavaj kot polizdelkov z lastnim receptom.

Dnevna evidenca postane samo za vpogled takoj, ko obstaja evidenca novejšega datuma; ni je dovoljeno naknadno odpirati ali brisati. Potrjen zapisnik kala nespremenljivo zajame ves še neoddani kalo iz izbranega obdobja.

**Why:** Poznejše popravljanje starega dne bi porušilo sled med dnevnim obračunom, zamrznjeno zalogo in podpisanim zapisnikom. Delna ali dvojna oddaja bi pustila nejasen fizični saldo kala.

**How to apply:** Shranjevanje in zaključevanje dnevnih evidenc ter potrditev zapisnika morajo uporabljati isti serializacijski obseg poslovne enote. Potrditev uspe le, če se osnutek natančno ujema s trenutnim neoddanim saldom, nato ga v isti transakciji zniža na nič.

Dnevna evidenca je hkrati zgodovina: osnovni pogled kaže datume z vnosi, izbrani datum pa njegove artikle. Zadnji odprti datum ima skupni akciji za vse vrstice; kalo se razkrije šele po zaključku. Prodaja odprtega dne se vedno izračuna sproti po ljubljanskem poslovnem datumu.

**Why:** Ločen zgodovinski zavihek je podvajal isti podatek, posamezne akcije po vrsticah pa so oteževale zaključek celotnega dne. Shranjena prodana količina zastara, če prodaja nastane po odprtju evidence.

**How to apply:** Starejši datumi kažejo samo dejansko vnesene vrstice in so samo za ogled. Ob odprtju zadnjega dne pokaži vse pripravljene artikle ter trenutno zamrznjeno količino, ki jo je dovoljeno odtajati.

Zadnja še odprta dnevna evidenca ostane vir operativne razpoložljivosti tudi po prehodu koledarskega dne. Zaloga ne sme izginiti iz POS/QR samo zato, ker je ura prešla polnoč.

**Why:** Odprt dnevni vnos še ni prenesel preostanka v trajno zamrznjeno zalogo; omejitev na točen današnji datum bi zato začasno pokazala nič in skrila dejansko pripravljene porcije.

**How to apply:** Če za tekoči poslovni datum ni evidence, uporabi najnovejšo prejšnjo odprto evidenco in odštej prodajo od njenega datuma do tekočega dne. Evidenca tekočega dne ima vedno prednost; zaključena tekoča evidenca ostane zaprta za nadaljnjo prodajo.

Dnevna korekcija porcij je lahko pozitivna ali negativna in uskladi računalniško stanje z dejansko količino v posodi. Vstopa v Skupaj, razpoložljivo količino, največjo količino za zamrzovanje in fizični kalo. Sama ne predstavlja nove priprave in ne ustvari novega materialnega stroška.

**Why:** Zgostitev, izhlapevanje ali redčenje lahko spremenijo dejansko število porcij v posodi. Količinska evidenca mora slediti fizičnemu stanju, strošek pa še vedno izvira samo iz današnje priprave.

**How to apply:** Skupaj = odtajano + pripravljeno + korekcija. Na voljo = skupaj − prodano. Kalo = skupaj − prodano − zamrznjeno. Strošek kala = min(kalo, pripravljeno) × strošek ene pripravljene porcije; material + kalo vedno ostane celotni strošek priprave.

Zapisnik kala ima svojo nespremenljivo zaporedno številko znotraj poslovne enote; primarni ključ baze ni številka dokumenta. Izpis je strežniško ustvarjen A4 PDF.

**Why:** Zaporedje internih ID-jev vsebuje tudi izbrisane in testne zapise, zato lahko prvi dejanski dokument dobi nelogično številko.

**How to apply:** Novo številko rezerviraj pod zaklepom enote kot naslednjo številko zapisnika. V API poteh uporabljaj interni ID, uporabniku in na PDF-ju pa vedno pokaži številko zapisnika.

Finančni del zapisnika kala mora kot nespremenljiv zgodovinski posnetek hraniti lastno ceno na enoto in skupno vrednost vsake zapisnikove vrstice. Pri delno že oddanem kalu se vrednost preostanka izračuna sorazmerno.

**Why:** Poznejša sprememba cen sestavin ne sme spreminjati že izdanega dokumenta, finančna vrednost pa mora ustrezati dejanski količini, ki jo zajame konkretni zapisnik.

**How to apply:** Ceno enote izpelji iz zamrznjene vrednosti kala dnevne evidence; ob nastanku ali osvežitvi osnutka shrani ceno in vrednost na vrstico zapisnika. PDF izpiše oba podatka in skupno vrednost odpisa.

Pri PDFKit nogi mora biti absolutna koordinata tudi znotraj spodnjega roba dokumenta; koordinata pod robom lahko ob `doc.end()` ustvari prazno dodatno stran.

**Why:** PDFKit samodejno doda stran, ko absolutno postavljen tekst preseže spodnjo mejo strani.

**How to apply:** Nogo postavi nad `page.height - margin` in za PDF izpis preveri število strani, ne samo glave `%PDF-`.