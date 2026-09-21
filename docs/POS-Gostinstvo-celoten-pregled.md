# POS Gostinstvo — celovit pregled modula

**Datum pregleda:** 6. september 2026  
**Različica dokumenta:** 1.0  
**Obseg:** POS spletni odjemalec, pripadajoče API-poti in storitve, podatkovni model, naprave, integracije, testi ter meja POS→ERP

## Vodstveni povzetek

POS Gostinstvo je obsežen in funkcionalno napreden sistem, ki pokriva skoraj celoten operativni tok gostinskega obrata: dostop, poslovne enote, blagajne, izmene, mize, rezervacije, naročila, pripravo, plačila, fiskalizacijo, zaloge, dogodke, poročila in povezavo z ERP.

Osnovne poslovne funkcije večinoma niso več glavna vrzel. Najpomembnejša odprta področja so zanesljivo okrevanje po nejasnih operacijah, varno zaključevanje izmene, enoten nadzor naprav in integracij, popolnejša revizijska sled ter dokazljiva uskladitev med POS in ERP.

Najbolj zreli deli so naročila in mize, KDS, pizza in večhodni meniji, terminalski poskusi, FURS/offline fiskalna infrastruktura, normativi, WAC, pripravljena hrana ter dogodkovne začasne enote.

## Kako brati poročilo

- **Narejeno** pomeni, da je funkcija razvidna iz trenutne kode, API-poti ali reprezentativnih testov.
- **Delno** pomeni, da osnovni tok obstaja, vendar ima pomembno omejitev, neenotno uporabniško obravnavo ali manjkajoč dokaz za kritični robni primer.
- **Manjka** pomeni, da v pregledanem modulu ni bila najdena prvovrstna uporabniška funkcija ali enoten proces.
- **Priporočilo** ni trditev, da trenutna funkcija ne deluje, temveč predlog za zmanjšanje poslovnega ali operativnega tveganja.

# 1. Dostop, podjetja, enote in vloge

## Narejeno

- Prijava in seja prek Clerk.
- Povezovanje prijavljenega uporabnika s POS uporabnikom.
- Izbira podjetja, poslovne enote in blagajne.
- Povezava uporabnika z natakarjem oziroma zaposlenim.
- Vloge administratorja, administratorja enote, uporabnika in super administratorja.
- Omejevanje navigacije in funkcij glede na zmožnosti enote.
- Strežniško preverjanje prijave, podjetja in poslovne enote.
- Zaščita več pregledanih poti pred dostopom do podatkov druge enote.
- Ponovna preveritev seje pri prehodnem odgovoru 401.
- Registracija naprave na aktivno poslovno enoto.
- Profili za restavracijo, gostilno, bar, kavarno, hitro prehrano, food truck, catering in dogodke.

## Delno oziroma tveganja

- Izbor enote in del nastavitev naprave se hrani lokalno. Pri hitrem preklopu enote lahko nekateri predpomnjeni podatki kratkotrajno ostanejo zastareli.
- Vse zapisovalne API-poti nimajo dokazano enake avtomatske matrike podjetje × enota × vloga × zmožnost.
- Pri nekaterih starejših zalogovnih poteh obstajajo rezervne vrednosti enote, ki jih je treba odstraniti ali strogo dokazati na nadrejeni poti.

## Manjka

- Centralni varnostni pregled vseh POS mutacij.
- Enotna avtomatska testna matrika za vse vloge in vse poslovne enote.
- Uporabniški pregled zavrnjenih ali sumljivih dostopov.

# 2. Prostori, tlorisi in mize

## Narejeno

- Ustvarjanje in urejanje prostorov.
- Ustvarjanje, urejanje in arhiviranje miz.
- Grafični urejevalnik in pregled tlorisa.
- Postavljanje in premikanje miz ter drugih elementov.
- Prikaz kapacitete in statusa mize.
- Odpiranje naročila na mizi.
- Več ločenih naročil na isti mizi.
- Sprostitev mize, ko nima odprtih naročil.
- QR-kode prostorov in miz.
- Zgodovina ter nespremenljivi posnetki pri rezervacijah.

## Delno oziroma tveganja

- Sočasno delo več naprav je podprto, vendar je potreben še širši test konfliktov med odpiranjem, premikanjem in zapiranjem naročila.
- Zastarel prikaz mize se lahko pojavi do naslednjega osveževanja oziroma pollinga.

## Priporočila

- Prikaz časa zadnje potrditve stanja mize.
- Jasno opozorilo, kadar je prikaz zastarel ali je strežnik zaznal konflikt.
- Testna matrika za dve ali več sočasnih naprav.

# 3. Rezervacije

## Narejeno

- Ustvarjanje, urejanje in preklic rezervacije.
- Vezava rezervacije na mizo.
- Podatki gosta, telefon in opomba.
- Datum, čas in število gostov.
- Označitev prihoda gosta.
- Začetek naročila iz rezervacije.
- Časovna opozorila pred rezervacijo.
- Blokada naročil v določenem časovnem oknu.
- Več rezervacij iste mize ob dovoljenem razmiku.
- Zgodovina in posnetki rezervacije.

## Delno

- Osnovni konflikti so obravnavani, manjka pa napredna optimizacija razporejanja.
- Ni celovite čakalne liste.
- Ni samodejnega sestavljanja več miz za večjo skupino.
- Ni naprednega predloga alternativne mize ali termina.

## Priporočila

- Čakalna lista z ocenjenim časom.
- Predlog alternativnih miz in terminov.
- Pravila za združevanje miz.
- Jasna obravnava no-show in poznega prihoda.

# 4. Naročila

## Narejeno

- Naročilo na mizi in neposredno naročilo brez mize.
- Telefonsko naročilo, osebni prevzem, dostava in QR-naročilo.
- Dodajanje, odstranjevanje in spreminjanje količine postavk.
- Opombe na postavki.
- Modifikatorji in dodatki.
- Razdelitev računa po gostih ali postavkah.
- Več računov iz istega naročila.
- Združevanje in premikanje naročil.
- Več ločenih naročil na isti mizi.
- Povezava naročila z natakarjem.
- Stanja priprave posamezne postavke.
- Lokalni outbox za del naročilnih operacij.

## Posebni tokovi

- Pizza velikosti in različne cene.
- Pizza dodatki, privzeti dodatki in razrez.
- Glasovni vnos pice.
- Večhodni meniji.
- Zaporedje hodov in sproščanje naslednjega hoda.
- Povezovanje vina s hodom.
- Oznaka To Go.
- Čas priprave in usmerjanje na delovno postajo.

## Delno oziroma tveganja

- Strategija idempotentnosti in obnove ni enotna za vse vrste sprememb naročila.
- Pri prekinitvi povezave uporabnik nima vedno enotnega odgovora, ali je bila operacija potrjena.
- Različni deli uporabljajo polling, predpomnilnik in outbox z različnimi pravili.

## Priporočila

- Enoten `operationId` za vse kritične spremembe naročila.
- Prikaz stanj lokalno, poslano, potrjeno, zavrnjeno in zahteva uskladitev.
- Centralni pogled neuspelih naročilnih operacij.

# 5. Telefonska naročila, naročniki, CTI in dostava

## Narejeno

- Vnos telefonskega naročila.
- Normalizacija telefonske številke.
- Iskanje in povezovanje obstoječega naročnika.
- Naslov ter podatki za dostavo.
- Osebni prevzem.
- Kurirji.
- Aktivne in zaključene dostave.
- Statusi ter zgodovina dostave.
- Preklic dostave.
- CTI nastavitve po poslovni enoti.
- MacroDroid vhodni klic in POS pojavno okno.

## Delno

- Celovita produkcijska deduplikacija več enakih CTI dogodkov ni dovolj dokazana.
- Ni enotnega pregleda nepopolnih telefonskih naročil in dostav, ki zahtevajo ukrep.
- Revizija spremembe naročnika ni povsod enako vidna.

## Priporočila

- CTI status, zadnji stik in testni klic.
- Deduplikacija dogodkov z enoličnim identifikatorjem.
- Operativni seznam nedokončanih dostav in naročil.

# 6. QR meni in QR naročila

## Narejeno

- Javni QR meni.
- QR-kode prostorov in miz.
- Kategorije, slike, različice, modifikatorji in alergeni.
- Košarica in oddaja naročila.
- Naročilo na mizi, prevzem in dostava, kadar je omogočena.
- QR napitnina.
- Klic natakarja.
- Prikaz QR gosta v POS-u.
- Ločevanje naročil različnih naprav.
- Validacija možnosti To Go.

## Delno

- Upravljanje javnih tokenov ni združeno v jasen življenjski cikel.
- Ni dovolj vidne zgodovine objav in možnosti povrnitve prejšnje različice menija.
- Produkcijski rate-limit in zaščita pred ponovitvijo oddaje zahtevata dodatno utrditev.
- Spletna GPS aktivacija je približevalna ovira in ni neponaredljiv dokaz lokacije.

## Manjka

- Centralni pregled aktivnih QR-tokenov.
- Enostavna rotacija in preklic tokena.
- Verzionirana objava ter atomski rollback celotnega menija.

# 7. KDS, kuhinja, pica, točilnica in izdaja

## Narejeno

- Ločene postaje za kuhinjo, pico, točilnico in izdajo.
- KDS profili.
- Prikazovalniki in mapiranja.
- Privzeta postaja.
- Nerazporejene postavke.
- Stanja priprave.
- ACK in BUMP.
- Zgodovina.
- Dispatch.
- Večhodni meniji.
- Idempotentno sproščanje naslednjega hoda.
- Časi priprave.
- Ločena barska vrsta za naročila pijač.

## Delno

- Ni enotnega uporabniškega centra za KDS/outbox recovery.
- Fizični staging več zaslonov, reconnect in dvojni ACK/BUMP niso dokazani za vse kombinacije.
- Izpad postaje zahteva bolj voden postopek preusmeritve.

## Priporočila

- Pregled čaka, poslano, podvojeno in zahteva ročno rešitev.
- Varen ponovni prenos.
- Preusmeritev na drugo postajo z revizijsko sledjo.
- Health-check in čas zadnjega stika vsakega zaslona.

# 8. Plačila in terminali

## Narejeno

- Gotovina.
- Kartica.
- Mešano plačilo.
- Darilni bon.
- Bon za pico.
- Študentska subvencija.
- Negotovinsko plačilo.
- Reprezentanca.
- Lastna poraba.
- Gotovinske in kartične napitnine.
- Preverjanje vsote razčlenjenih plačil.
- Payten, SumUp, Viva Smart, Viva Cloud, Viva Android in Viva Tap-to-Pay.
- Razvojna simulacija terminala.
- Trajni terminalski poskusi s stanji reserved, pending, completed, failed in unknown.
- Idempotency ključi in preprečevanje ponovne uporabe zaključenega poskusa.
- Recovery API za preverjanje nekaterih nejasnih poskusov.

## Delno

- Tehnično stanje nejasnega plačila obstaja, ni pa enotnega operativnega inboxa.
- Refundi niso dokazano enaki za vse ponudnike terminalov.
- Checkout je zelo velika komponenta, zato je kombinacije težje vzdrževati in testirati.

## Manjka

- Enoten pregled vseh nejasnih kartičnih izidov.
- Provider-neodvisen refund kontrakt.
- Voden postopek od nejasnega poskusa do računa, refunda ali ročne uskladitve.

# 9. Računi, storno in darilni boni

## Narejeno

- Izdaja in pregled računov.
- Ponatis.
- Povezava s plačili.
- Polni storno celotnega računa.
- Povezava storna z izvirnim računom.
- Storno napitnine.
- Fiskalna obravnava storna.
- Izdaja in zbirna evidenca darilnih bonov.
- Plačilo z darilnim bonom.

## Pomembne omejitve

- POS ne podpira delnega storna posamezne postavke ali količine.
- Popravek ene postavke zahteva storno celotnega računa in izdajo novega računa.
- Darilni bon nima individualnega serijskega identifikatorja in individualnega preostalega salda.
- Evidenca bonov je agregatna.

## Možne prihodnje funkcije

- Delni refund artikla ali zneska, če ga poslovni proces zahteva.
- Posamični ledger bonov z lastno kodo, saldom in zaščito pred dvojnim unovčenjem.

# 10. FURS in offline fiskalizacija

## Narejeno

- Poslovni prostori in blagajne.
- FURS certifikat.
- Priprava davčnih podatkov.
- EOR in ZOI.
- Testni, simulacijski in produkcijski način.
- Prikaz neuspešne fiskalizacije.
- Posamični in skupinski ponovni prenos.
- Offline čakalna vrsta.
- Nespremenljivo pravno jedro offline računa.
- Nov MessageID za vsak ponovni prenos.
- Ponatis brez ustvarjanja novega poslovnega računa.
- Strežniški worker in runner.

## Delno

- Potrebna je celovita produkcijska verifikacija offline→online.
- Dodatno je treba dokazati restart, backoff, duplicate ingest in končno povezavo račun–EOR/ZOI.
- Unknown stanje namerno zahteva ročno uskladitev, vendar uporabniški postopek ni dovolj centraliziran.

## Priporočila

- Enoten recovery center skupaj s plačili.
- Čas naslednjega poskusa in zgodovina vseh poskusov.
- Jasna prepoved drugega plačila ali novega računa pri nejasnem rezultatu.

# 11. Izmene, blagajne in zaključek dneva

## Narejeno

- Odpiranje in zapiranje izmene.
- Začetna gotovina.
- Povezava z zaposlenim.
- Odmori.
- Obračun ur.
- Nočne izmene in lokalni dnevi.
- Pologi in dvigi.
- Stanje blagajne.
- Štetje gotovine.
- Razlog za razliko.
- X-poročilo.
- Z-poročilo.
- Gostinski poslovni dan.

## Delno oziroma največja vrzel

Ni dovolj jasno dokazano, da zaključek izmene ali Z-poročilo vedno blokira:

- odprta naročila;
- neizdane račune;
- pending ali unknown terminalske poskuse;
- nepojasnjeno gotovinsko razliko;
- neoddano fiskalizacijo;
- neusklajene dogodkovne prenose ali vračila.

## Manjka

- Enoten zaključni kontrolni zaslon.
- Jasna razvrstitev varno, opozorilo in zaključek prepovedan.
- Nadzorovan override z razlogom in popolno revizijsko sledjo.

# 12. Meni, artikli, normativi in alergeni

## Narejeno

- Kategorije in artikli.
- Prodajni ter nabavni artikli.
- Merske enote.
- DDV kategorije.
- Cene in cene po velikosti.
- Happy Hour.
- Modifikatorji in dodatki.
- Slike, obrezovanje in verzioniranje slik.
- Vrstni red ter vključitev v meni.
- Čas priprave in tip artikla.
- Pizza velikosti.
- Normativi in normativi modifikatorjev.
- Sestavljeni izdelki.
- Pripravljena hrana.
- Alergeni, izvor, revizija in potrditev.

## Delno

- Zgodovina sprememb cen in normativov ni dovolj enotno predstavljena.
- Verzioniranje celotnega menija ni enako razvito kot verzioniranje slik.
- Sočasno urejanje istega artikla potrebuje bolj viden konfliktni postopek.

## Priporočila

- Verzije in odobritve normativov.
- Predogled vpliva spremembe na strošek in zalogo.
- Centralni pregled nepotrjenih alergenov.
- Objavljiva različica menija z rollbackom.

# 13. Zaloge, nabava in dokumenti

## Narejeno

- Pregled zaloge.
- Kartica artikla.
- Začetne zaloge.
- Drseča tehtana povprečna cena oziroma WAC.
- Prejemnice in dobavitelji.
- Ročni vnos.
- Uvoz CSV, XLSX, PDF in XML.
- OCR.
- Povezovanje dobaviteljev in artiklov.
- Profili dobaviteljev.
- Inventure.
- Izdajnice.
- Pripravljena in sestavljena hrana.
- Zamrznjena operativna količina pripravljene hrane.
- Odpis in odpad.
- Podpis zaposlenega in vodje.
- Ločena evidenca ostankov s krožnikov.

## Delno

- Kartica zaloge je omejena na 500 gibanj in nima dokazano popolne paginacije.
- WAC rekonstrukcija obstaja tehnično, ne pa kot voden uporabniški postopek.
- OCR in uvoz potrebujeta močnejšo idempotentnost, napredek in obnovo prekinjene seje.
- Splošne prilagoditve zaloge niso ločene v enoten modul z razlogi in odobritvami.

## Pomembna meja

Splošen prenos med poljubnimi skladišči ni prvovrstna POS funkcija. Prenosi z izvorno in ciljno enoto so izvedeni v okviru dogodkov in začasnih dogodkovnih enot. Izdajnica evidentira izhod iz zaloge in ne samodejnega prevzema v drugi enoti.

## Manjka

- Prvovrsten dokument vračila dobavitelju.
- Enotna taksonomija razlogov za manjko oziroma shrinkage.
- Paginacija in izvoz popolne kartice artikla.
- Tristransko ujemanje naročilo–dobavnica–račun.
- Enoten pregled inventura–WAC–ERP.

# 14. Pripravljena hrana in odpad

## Narejeno

- Dnevna evidenca pripravljene hrane.
- Odtajanje, priprava, prodaja in zamrznjena količina.
- Začetne količine.
- Strošek porcije.
- Poraba sestavin.
- Sestavljeni izdelki.
- Kalo in odpad.
- Razlog ter podpisa zaposlenega in vodje.
- Ločen modul ostankov s krožnikov.

## Delno

- Uporabnik mora dobro razumeti razliko med porabo, kalom, odpisom in ostanki s krožnikov.
- Manjka enoten vizualni prikaz učinka posamezne vrste evidence.

# 15. Dogodki in začasne enote

## Narejeno

- Načrtovanje dogodka.
- Lokacija, tip, čas in status.
- Povezana oziroma začasna poslovna enota.
- Izbor artiklov in osebja.
- Predogled priprave.
- Prenos zaloge na dogodek.
- Zgodovina izhodnih in povratnih dokumentov.
- Poraba, preostanek in vračilo.
- Integritetna enačba poslano = porabljeno + preostalo + vrnjeno.
- Omejitve sprememb zaključenih dokumentov.

## Delno

- Pregled izjem, delnih rezultatov in neusklajenih količin ni dovolj centraliziran.
- Zaključen dogodek z neurejeno zalogo potrebuje močnejše opozorilo.

## Priporočila

- Dogodkovni reconciliation center.
- Voden postopek za razliko.
- Povezava razlike z inventuro in ERP knjiženjem.

# 16. Poročila in POS→ERP

## Narejeno

- Promet po obdobju.
- Promet po natakarju, blagajni, artiklu in kategoriji.
- DDV poročila.
- Plačilna sredstva.
- Napitnine.
- Izmene in zaloge.
- Dogodki.
- X- in Z-poročilo.
- Operativna poročila.
- Dnevne POS→ERP temeljnice.
- Kontne nastavitve in DDV kode.
- Posebni mesečni zbirni dokumenti.

## Delno oziroma manjka

Ni enotnega pregleda, ki bi za vsak POS poslovni dogodek pokazal:

- kateri račun ali dokument je bil knjižen;
- katera temeljnica je nastala;
- ali manjka konto ali DDV koda;
- ali je knjiženje podvojeno;
- ali se promet in temeljnica ujemata;
- ali je zalogovni učinek pravilen;
- ali je varen ponovni poskus.

## Priporočilo

Vzpostaviti POS→ERP reconciliation center z enoličnim operation ID, statusom, razliko, razlogom in idempotentnim ponovnim poskusom.

# 17. Naprave, tiskalniki in integracije

## Narejeno

- Register naprav in trajni ID naprave.
- Vezava naprave na enoto.
- Terminalske nastavitve.
- ZCS Z92.
- NB80.
- NYX.
- QZ oziroma Windows tiskanje.
- Različne širine papirja in kodne strani.
- Bluetooth tiskanje na podprtih napravah.
- CTI in MacroDroid.
- KDS naprave.
- BizBox nastavitve.
- Viva Bridge APK.
- PWA manifest in cache.
- Offline fiskalna čakalna vrsta.

## Delno

- Posamezni mostovi imajo diagnostiko, ni pa enotnega health centra.
- Ni dovolj vidnega zadnjega kontakta in življenjskega cikla naprave.
- Neposreden uporabniški Bluetooth/USB discovery ni enotno podprt.
- BizBox status in zgodovina oddaj nista združena v skupen operativni pregled.

## Manjka

- Voden prvi zagon nove enote.
- Centralni health-check FURS, tiskalnikov, terminalov, KDS, CTI in BizBox.
- Seznam registriranih naprav z zadnjim kontaktom.
- Deaktivacija oziroma revokacija naprave.
- Popoln audit zaslon sprememb integracij.

# 18. Revizijska sled, varnost in zanesljivost

## Zreli elementi

- Namenski middleware za podjetje in poslovno enoto.
- IDOR in tenant testi za več občutljivih poti.
- Trajni kartični poskusi.
- Append-only zgodovina dogodkovnih prenosov.
- Offline fiskalna authority/provisioning arhitektura.
- Namenski KDS state in dispatch testi.

## Vrzeli

- Revizijska sled ni dokazano enotna za vse kritične mutacije.
- Manjka obvezni skupni zapis uporabnik + podjetje + enota + naprava + operationId + razlog.
- Recovery ni enoten med naročili, KDS, terminali, fiskalizacijo in zalogo.
- Frontend nima povsod jasnega prikaza, ali je bila operacija dejansko izvedena.
- Mobilnost in dostopnost nista sistematično testirani na vseh ključnih zaslonih.

# 19. Prednostni načrt

## P0 — preprečitev finančne ali operativne izgube

### 1. Center za nejasne izide plačil

Enoten pregled vseh pending in unknown terminalskih poskusov, z varnim preverjanjem stanja in prepovedjo novega plačila, dokler prejšnji izid ni razjasnjen.

### 2. Varen zaključek izmene in Z-poročila

Zaključek mora preveriti odprta naročila, neizdane račune, terminalske poskuse, gotovinsko razliko, FURS čakalno vrsto in neusklajena vračila.

### 3. Enoten kontekst podjetja in enote

Odstraniti implicitne rezervne enote ter za vse zapisovalne poti zahtevati eksplicitno podjetje, enoto in potrebno zmožnost.

### 4. POS→ERP uskladitev

Dodati pregled manjkajočih, podvojenih ali neusklajenih temeljnic ter varen idempotenten ponovni poskus.

## P1 — zanesljivost dela na lokaciji

1. Voden prvi zagon nove enote.
2. Centralni health-check naprav in integracij.
3. Upravljanje ter revokacija naprav.
4. QR token lifecycle in rate-limit.
5. Robustnejši OCR/uvoz z obnovo seje.
6. Paginacija celotne kartice zaloge.
7. Vračila dobavitelju.
8. Klasifikacija manjkov in zalogovnih prilagoditev.
9. Enoten audit dnevnik.
10. Provider-neodvisen refund kontrakt.

## P2 — preglednost in nadaljnja rast

1. Naprednejše rezervacije in čakalna lista.
2. Verzioniranje ter rollback QR menija.
3. Mobilna navigacija glede na vlogo.
4. Sistematični accessibility testi.
5. Razdelitev prevelike Checkout komponente.
6. Indikatorji časa zadnje potrditve.
7. Staging testi z realnimi napravami.
8. Zgodovina sprememb cen, normativov in alergenov.

# 20. Zaključna matrika

| Področje | Ocena | Glavna ugotovitev |
|---|---|---|
| Dostop in vloge | Narejeno | Zrel sistem vlog, enot in zmožnosti; potreben celovit route audit |
| Mize in tlorisi | Narejeno | Podprto realno gostinsko delo in več naročil na mizi |
| Rezervacije | Delno | Osnovni tok je dober; manjka čakalna lista in optimizacija |
| Naročila | Narejeno | Zelo širok tok z modifikatorji, pizzo in več hodi |
| Telefon in dostava | Narejeno/Delno | Funkcionalno podprto; CTI recovery potrebuje utrditev |
| QR meni | Delno | Naročanje deluje; token lifecycle in rollback še manjkata |
| KDS | Narejeno/Delno | Zrela logika; manjka centralni recovery in staging naprav |
| Plačila | Narejeno/Delno | Veliko providerjev; manjka enoten unknown-outcome center |
| Računi in storno | Narejeno | Podprt je polni storno, ne delni storno |
| Darilni boni | Delno | Agregatna evidenca brez posamičnih saldov |
| FURS | Narejeno/Delno | Močna offline osnova; potreben celovit produkcijski E2E dokaz |
| Izmene in Z | Delno | Manjka enoten zaključni guard |
| Meni in normativi | Narejeno | Funkcionalno zelo razvito |
| Zaloge in WAC | Narejeno/Delno | Širok modul; kartica 500 vrstic in OCR recovery sta omejitvi |
| Pripravljena hrana | Narejeno | Priprava, zamrznitev, kalo in plate waste so ločeni |
| Dogodki | Narejeno/Delno | Prenosi in vračila so zreli; manjka pregled izjem |
| Poročila | Narejeno | Velik nabor poročil |
| POS→ERP | Delno | Knjiženje obstaja; manjka enoten reconciliation center |
| Naprave | Delno | Veliko mostov; manjka lifecycle in skupni health-check |
| Audit | Delno | Prisoten v pomembnih delih, ne pa povsem enotno |

# Sklep

POS Gostinstvo je že produkcijsko širok sistem. Največja vrednost naslednje razvojne faze ne bo v dodajanju še več osnovnih zaslonov, temveč v povezovanju obstoječih funkcij v varne zaključene operativne tokove.

Prednost naj imajo finančna in operativna varovala: nejasna plačila, zaključek izmene, eksplicitni kontekst enote in POS→ERP uskladitev. Nato sledijo vodena nastavitev, health-check naprav, upravljanje naprav, robusten uvoz in enotna revizijska sled.

Ko bodo ta področja urejena, bo modul poleg široke funkcionalnosti dosegel tudi bistveno višjo raven operativne predvidljivosti, podpore in nadzora.