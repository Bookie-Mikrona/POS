# 05 Priprava, KDS, QR meni in telefonska naročila

## 1. Namen sklopa

Ta sklop vodi naročilo od oddaje do predaje gostu.

V njem uporabljate pripravo hrane, kuhinjski prikazovalnik KDS, QR meni in telefon.

Plačilo, fiskalizacija in račun so opisani v sklopu 06.

Zaloge in pripravljena hrana so opisane v sklopu 07.

## 2. Predpogoji

1. Uporabnik je prijavljen v pravo poslovno enoto in blagajno.
2. Za delo na blagajni je odprta lastna izmena.
3. Artikli imajo pravilno kategorijo, ceno in po potrebi postajo priprave.
4. KDS postaje in prikazovalniki so aktivni za isto enoto.
5. Vsak KDS zaslon ima določene postaje, ki jih spremlja.
6. Za QR naročila je aktiviran QR meni in objavljen veljaven QR identifikator.
7. Za telefonska naročila je urejen dostop do imenika naročnikov.
8. Za dostavo so vnaprej dogovorjeni način predaje, območje in strošek dostave.

> **Opozorilo:** Naročila pošljite v pripravo šele, ko so preverjeni artikel,
> količina, opombe in način predaje. Popravek že poslanega naročila zahteva
> usklajevanje s postajo priprave.

## 3. Pojmi in stanja

### 3.1 Naročilo

Naročilo je odprta košarica na mizi, za prevzem, dostavo ali QR gosta.

Naročilo ni račun. Račun nastane šele pri uspešno zaključenem plačilu.

### 3.2 KDS nalog

KDS nalog je posamezna postavka, usmerjena na postajo, na primer Kuhinja, Pica
ali Točilnica.

Postavka se na postajo usmeri po pravilih artikla oziroma kategorije.

Če pravila ni, je lahko prikazan znak preusmeritve na privzeto postajo.

Tak znak pomeni, da mora vodja preveriti nastavitev artikla; ne pomeni napake
pri pripravi.

### 3.3 HOLD in FIRE

**HOLD** pomeni zadržano postavko. Na zaslonu priprave še ni delovni nalog.

**FIRE** sprosti zadržani hod v aktivno pripravo.

Zadrževanje se uporablja pri večhodnem servisu, ne za opuščanje naročil.

### 3.4 BUMP in potrditev izdaje

Klik aktivne postavke na KDS jo označi kot pripravljeno (**Bumped**).

Če je omogočen modul izdaje, se po BUMP nalog še potrdi na zaslonu Izdaja.

Šele potrditev izdaje pomeni, da je bila jed predana natakarju oziroma gostu.

## 4. Oddaja običajnega naročila v pripravo

1. V prodajnem pogledu odprite mizo ali ustvarite novo naročilo.
2. Izberite artikle in preverite količine.
3. Dodajte opombo na raven postavke, kadar velja samo za eno jed.
4. Dodajte splošno opombo samo, kadar velja za celotno naročilo.
5. Preverite alergenska opozorila in posebne želje gosta.
6. Preverite, ali je naročilo za mizo, za prevzem ali dostavo.
7. Pritisnite dejanje za pošiljanje v pripravo.
8. Počakajte na potrditev, da je naročilo shranjeno.
9. Na KDS preverite, da je postavka prišla na pravilno postajo.

Če se nalog ne pojavi takoj, zaslon KDS podatke osvežuje približno vsakih
15 sekund. Ne oddajajte iste postavke drugič samo zaradi čakanja.

### 4.1 Če je bila izbrana napačna postavka

1. Preverite, ali je postavka že aktivna na KDS.
2. Če ni poslana, jo popravite v naročilu in nato pošljite.
3. Če je aktivna, kuhinjo takoj obvestite o spremembi.
4. Naročilo popravite z dovoljenim postopkom v POS.
5. Preverite KDS in končno vsebino naročila.

Nikoli ne nadomeščajte napačne jedi z neuradno ustno spremembo brez uskladitve
naročila. Podatki o pripravi, zalogi in računu morajo ostati enaki.

## 5. Delo na KDS

### 5.1 Izbira zaslona

1. Odprite **KDS** ali namenski pogled Kuhinja, Pica oziroma Točilnica.
2. Če je na napravi več prikazovalnikov, izberite pravilni zaslon.
3. Preverite oznake postaj pod naslovom zaslona.
4. Če piše, da zaslon nima naročnin, ga ne uporabljajte za pripravo.
5. Vodja naj v nastavitvah zaslonu dodeli ustrezne postaje.

KDS prikaže samo naloge postaj, ki jim je zaslon naročen.

### 5.2 Branje kartice naročila

Kartica prikazuje identifikacijo naročila, postavke, čas in opombe.

Prikazani so lahko število gostov, alergeni, sledi alergenov in splošna opomba.

Rumeni opozorilni znak označuje uporabo privzete postaje.

Barve časa so operativni signal:

| Barva | Starost odprte postavke |
| --- | --- |
| zelena | manj kot 10 minut |
| oranžna | 10 do 20 minut |
| rdeča | več kot 20 minut |

Čas ni dokaz o napaki; opozori ekipo, da preveri vrstni red in predajo.

### 5.3 Priprava in BUMP

1. Na kartici preberite artikel, količino, opombo in alergenska opozorila.
2. Pripravite samo tiste postavke, ki so na vaši postaji.
3. Pred BUMP preverite, da je jed dejansko pripravljena.
4. Kliknite aktivno postavko oziroma dejanje **BUMP**.
5. Preverite, da je postavka označena kot pripravljena.
6. Če je vključen zaslon Izdaja, počakajte na prevzem tam.

> **Opozorilo:** BUMP ne pomeni »začel sem pripravljati«. Pomeni
> »pripravljeno za naslednji korak«. Prezgoden BUMP lahko povzroči, da
> natakar predlaga izdajo jedi, ki še ni pripravljena.

### 5.4 Potrditev na zaslonu Izdaja

1. Odprite **Izdaja** na postaji predaje.
2. Poiščite pripravljeno naročilo po oznaki, mizi ali času.
3. Primerjajte jedi s kartico in oznako prevzema.
4. Predajte naročilo pravilnemu natakarju ali gostu.
5. Potrdite prevzem samo po fizični predaji.

Če izdaja ni omogočena, je BUMP zadnje stanje KDS naloga.

### 5.5 Izpad povezave ali napaka KDS

1. Ne klikajte večkrat iste postavke.
2. Zapišite številko naročila in postavko.
3. Preverite, ali je zaslon pokazal napako pri nalaganju.
4. Preverite povezavo naprave in nato osvežite prikaz.
5. Če stanje ni jasno, preverite naročilo na POS in se uskladite s kuhinjo.
6. Ponovitve BUMP ne izvajajte na pamet.

Sistem uporablja idempotentne zahteve, vendar fizična priprava ni samodejno
idempotentna. Zato najprej ugotovite dejansko stanje jedi.

## 6. Večhodna naročila

### 6.1 Razporeditev hodov

Hodi imajo številko in vrstni red strežbe.

Postavke brez hoda se obravnavajo kot običajne postavke.

V istem hodu so lahko jedi z več postaj, na primer kuhinja in točilnica.

1. Pri vnosu naročila dodelite jedi ustreznemu hodu.
2. Preverite, da so jed in spremljajoča pijača v predvidenem hodu.
3. Zadržite hode, ki ne smejo v pripravo takoj.
4. Pošljite naročilo.
5. Na KDS preverite vidni aktivni prvi hod.

### 6.2 FIRE naslednjega hoda

1. Preverite, da je prejšnji hod pripravljen oziroma izdan po dogovoru ekipe.
2. Na ustrezni kartici poiščite nadzor **FIRE** za naslednji hod.
3. Preverite številko hoda, preden potrdite.
4. Sprožite FIRE.
5. Preverite, da se hod pokaže kot aktiven na vseh potrebnih postajah.
6. Kuhinji povejte, če mora biti hitrost priprave posebna.

FIRE lahko sproži več povezanih nalog istega hoda. To je pričakovano: jed in
vino oziroma jedi na več postajah morajo ostati usklajeni.

### 6.3 Kaj preveriti pri HOLD

1. Preverite, da so zadržane samo postavke poznejšega hoda.
2. Ne pričakujte, da bo HOLD med aktivnimi delovnimi nalogi.
3. Ne označujte zadržane postavke kot pripravljene.
4. Ne pritiskajte FIRE, če gost še ni pripravljen na naslednji hod.
5. Ob spremembi zaporedja najprej uskladite servis in kuhinjo.

Če je FIRE poslan prehitro, obvestite postajo takoj. Stanja ne odpravljajte z
neformalnim brisanjem kartice; vodja naj uporabi dovoljen popravek naročila.

## 7. Postaje in usmerjanje

KDS podpira ločene postaje **Kuhinja**, **Pica** in **Točilnica**.

Postaja lahko na enem prikazovalniku deli prostor z drugo postajo ali ima
samostojen zaslon.

### 7.1 Pravilo za osebje

1. Kuhinja pripravlja le naloge Kuhinja.
2. Pica pripravlja le naloge Pica.
3. Točilnica pripravlja le naloge Bar oziroma Točilnica.
4. Osebje ne prestavlja nalog med postajami z ustnim dogovorom brez popravka.
5. Ob opozorilu fallback vodja preveri pravila artikla po koncu kritične priprave.

### 7.2 Prazna ali napačna vsebina zaslona

Če zaslon nima aktivnih nalogov, najprej preverite izbrani prikazovalnik in
njegove postaje. Če je naročilo usmerjeno na drugo postajo, ga ne pripravljajte
zgolj zato, ker ga vidite v POS.

Če se na kartici pojavi artikel, ki ga postaja ne more pripraviti, ga ne
označujte kot pripravljenega. Pokličite vodjo izmene za usmeritev.

## 8. QR meni

### 8.1 Namen QR identitete

QR koda odpira meni z identiteto lokacije oziroma mize.

Identiteta mora pripadati točni enoti in, kadar je uporabljena, točni mizi.

QR gosta ne preusmerjajte na splošno kodo druge enote, ker se lahko naročilo
odpre na napačni lokaciji.

### 8.2 Pred začetkom QR prodaje

1. V administraciji QR preverite, da je koda aktivna.
2. Preverite enoto, mizo oziroma predvideni kanal.
3. S telefonom preskusno odprite kodo.
4. Preverite, da se prikaže pravi meni in identiteta lokacije.
5. Preverite, da so artikli, ki jih želite prodajati, vidni v meniju.
6. Ne objavljajte preskusne kode na mizah.

### 8.3 QR naročilo gosta

1. Gost odpre QR kodo.
2. Izbere artikle in doda jasne opombe.
3. Gost potrdi oddajo v meniju.
4. Osebje preveri novo naročilo na POS oziroma KDS.
5. Kuhinja ga pripravi po običajnem postopku.
6. Pred predajo preverite identiteto mize ali oznako prevzema.

QR naročilo ni samodejno dokaz fizične prisotnosti gosta. Pri sporni mizi
preverite oznako na mizi in osebo, ki prevzema.

### 8.4 To Go v QR meniju

**To Go** pomeni prevzem za s seboj.

1. Gost izbere možnost To Go, kadar ne želi strežbe za mizo.
2. Osebje preveri, da je na naročilu jasno označen prevzem.
3. Pripravo opremite z oznako naročila, ne z imenom drugega gosta.
4. Pri izdaji primerjajte oznako, artikle in količino.
5. Ne odlagajte več To Go paketov brez ločljivih oznak.

Če gost spremeni To Go v strežbo na mizi, naj osebje pred pripravo uredi
pravilen kanal naročila in obvesti postajo.

### 8.5 Težava z QR naročilom

Če gost trdi, da je oddal naročilo, vi pa ga ne vidite:

1. Vprašajte za čas oddaje, artikle in oznako mize.
2. Preverite odprta naročila in KDS.
3. Ne ustvarjajte takoj dvojnega naročila.
4. Če oddaja ni uspela, naročilo vnesite na POS in jasno označite kanal.
5. Če obstaja, uporabite dokazilo gosta samo za identifikacijo, ne za sklep o plačilu.

## 9. Telefonska naročila

### 9.1 Iskanje naročnika

Telefonsko številko vnesite v običajni zapis, ki ga uporablja klicatelj.

Sistem jo normalizira za iskanje: presledki, vezaji in zapis države ne smejo
ustvarjati nove osebe, če gre za isto številko.

1. Odprite **Telefonski naročniki** ali začnite telefonsko naročilo.
2. Vnesite številko klicatelja.
3. Izberite najdenega naročnika, če se podatki ujemajo.
4. Potrdite ime in naslov z osebo na telefonu.
5. Če zapisa ni, ustvarite naročnika z normalno telefonsko številko.

Ne iščite po približno enakem imenu, kadar je na voljo telefon. Telefon je
ključ za preprečevanje podvojenih profilov.

### 9.2 Naročilo za prevzem

1. Izberite način **Prevzem**.
2. Izberite oziroma dodajte naročnika po telefonu.
3. Vnesite artikle, količine, opombe in dogovorjeni čas.
4. Ponovite naročilo klicatelju.
5. Pošljite v pripravo.
6. Paket označite z identifikacijo naročila in časom prevzema.
7. Ob prevzemu preverite osebo, vsebino in stanje plačila.

### 9.3 Naročilo za dostavo

1. Izberite način **Dostava**.
2. Poiščite naročnika po normalizirani telefonski številki.
3. Glasno potrdite naslov, zvonec, nadstropje in kontakt.
4. Vnesite artikle, opombe, čas in dogovor o plačilu.
5. Preverite strošek dostave, če ga poslovanje uporablja.
6. Pošljite naročilo v pripravo.
7. Ob predaji kurir preveri paket, naslov in način plačila.

Ne kopirajte starega naslova brez potrditve. Naročnik lahko z iste številke
naroča na drugo lokacijo.

### 9.4 Podvojeni profil ali številka

1. Ne ustvarite tretjega zapisa.
2. Primerjajte normalizirano številko, ime in zgodovino naročil.
3. Uporabite zapis, ki ima potrjene aktualne podatke.
4. Neskladje prijavite vodji za ureditev imenika.
5. Naročilo vedno dokončajte na enem, izbranem profilu.

## 10. Končne kontrole sklopa

Preden naročilo zapusti pripravo, preverite:

1. naročilo je v pravi enoti in pri pravilni mizi, prevzemu ali dostavi;
2. KDS nalogi so na pravilnih postajah;
3. HOLD hodi niso nenamerno ostali zadržani;
4. BUMP je uporabljen samo za pripravljene postavke;
5. izdane jedi so fizično predane ali jasno označene za predajo;
6. QR To Go paketi imajo nedvoumno oznako;
7. telefonski naročnik je izbran po pravilno normalizirani številki;
8. osebje ve, kdo prevzame oziroma dostavi naročilo.

Nato nadaljujte s plačilom in računom po sklopu 06.

## 11. Operativni model priprave

### 11.1 Tok podatkov in odgovornost

Prodajna oseba je odgovorna za pravilnost naročila pred pošiljanjem.
KDS ne popravlja cene, količine, alergena ali kanala predaje.
Kuhinjska oseba je odgovorna za dejansko pripravo prikazane postavke.
Oseba na izdaji je odgovorna za fizično ujemanje paketa in naročila.
Vodja izmene razrešuje neskladja med zasloni, POS in dejanskim stanjem.
Kurir potrdi predajo paketa, ne pa pravilnosti fiskalnega računa.
Gostova ustna sprememba postane veljavna šele po evidentiranju v POS.

| Korak | Vir resnice | Kdo potrdi | Kaj se ne sme sklepati |
| --- | --- | --- | --- |
| vnos | odprto naročilo POS | prodajno osebje | da je kuhinja že videla vrstico |
| pošiljanje | KDS nalog | POS/KDS | da je jed pripravljena |
| FIRE | dogodek sprostitve | strežba | da so vse postaje že končale |
| BUMP | čas `bumpedAt` | pripravljavec | da je gost jed prevzel |
| ACK | čas `ackAt` | izdaja/natakar | da je račun plačan |
| dostava | status dostave | kurir | da je plačilo pri kurirju uspešno |

### 11.2 Identifikatorji, ki jih osebje bere

Številka naročila poveže POS, KDS, izdajo in telefonski paket.
ID KDS naloga je tehnična sled ene postavke na eni postaji.
ID postavke razlikuje dve enaki jedi z različnima opombama.
ID postaje določa, kateri zaslon sme nalog obdelati.
Številka hoda določa vrstni red strežbe, ne čas priprave.
`pairingGroupId` poveže postavke istega QR večhodnega naročila.
Čas `ustvarjeno` je čas nastanka naloga.
Čas `aktiviranoAt` je čas materializacije oziroma FIRE.
Čas `bumpedAt` je dokaz potrditve priprave.
Čas `ackAt` je dokaz prevzema na izdaji.
Oznaka mize ni nadomestek za številko naročila pri To Go.
Ime telefonskega naročnika ni dovolj za identifikacijo dostave.

### 11.3 Minimalni ustni klic med vlogami

Natakar naj pove številko naročila, postajo, spremembo in želeni čas.
Primer: »Naročilo 184, pica, brez čebule, še ni v peči.«
Kuhinja naj ponovi kritični podatek, preden začne spremembo.
Primer: »184: brez čebule, potrjeno.«
Izdaja naj pri predaji pove oznako prevzema in število paketov.
Kurir naj ponovi naslovni identifikator, ne celotnih osebnih podatkov pred gosti.
Vodja naj odločitve o odpisu ali ponovni pripravi zapiše v dogovorjeni dnevnik.

## 12. Zasloni Kuhinja, Pice, Točilnica in Izdaja

### 12.1 Dostop in profil postaj

V navigaciji je Točilnica ločen pogled.
Kuhinja je namenjena postaji `kitchen`.
Pice so ločen pogled samo pri profilu ločenih kuhinje in pic.
Pri profilu združene kuhinje zaslon Kuhinja spremlja `kitchen` in `pizza`.
Ne sklepajte iz naslova zaslona, da vidi vse postaje.
Pred začetkom izmene preverite dejanske oznake naročenih postaj.
Zaslon brez naročnin ne sme postati improvizirana delovna čakalnica.
Administrator spremeni profil; kuhar ga ne spreminja sredi servisa.
Ob menjavi enote se znova preveri enota prijavljenega uporabnika.
Nalog iz druge enote ni razlog za pripravo ali BUMP.

### 12.2 Kuhinja

Kuhinja bere glavno jed, prilogo, stopnjo pečenja in alergenske opombe.
Kuhinja preveri, ali priloga pripada isti postavki ali drugi postaji.
Kuhinja ne pripravlja pice, če je nalog usmerjen na Pice.
Kuhinja označi BUMP šele, ko je celotna prikazana količina pripravljena.
Če je ena od treh enakih porcij nepopolna, se ne potrdi cele vrstice.
Oseba naj pokliče vodjo, kadar prikaz ne omogoča delnega zaključka zahtevanega dela.
Kuhinjski časovnik se uporablja za prioritetni pogovor, ne za kaznovanje osebja.
Rdeča kartica se najprej preveri glede časa FIRE in dogovorjenega časa dostave.
Kuhinjska opomba »alergen« se bere pred izborom sestavin.
Nejasno opombo je treba pojasniti s prodajno osebo, ne interpretirati.

### 12.3 Pice

Postaja Pice preveri velikost, testo, polovice, dodatke in opombo.
Pica z odstranjeno sestavino ni isto kot pica brez alergenske sledi.
Če gost navaja alergijo, osebje uporabi odobren alergen postopek lokala.
Čas pečenja ne upravičuje BUMP pred rezanjem oziroma pakiranjem, če to zahteva naročilo.
Za dostavo pica ostane označena do prevzema kurirja.
Za To Go pica dobi oznako naročila pred odložitvijo na polico.
Če peč odpove, Pice takoj sporoči pričakovano zamudo in prizadeta naročila.
Ne premikajte naloga na Kuhinjo zato, ker je tam prosta kapaciteta.
Vodja naj spremembo usmerjanja uredi sistemsko pred naslednjo prodajo.

### 12.4 Točilnica

Točilnica preveri volumen, temperaturo, dodatke in opombo brez ledu.
Pijača v prvem hodu se lahko aktivira prej kot zadržana glavna jed.
Točilnica ne čaka na Kuhinjo, razen če je servis izrecno usklajen po hodu.
Steklenica, kozarec in brezalkoholna različica so ločene postavke.
Pri več enakih pijačah se količina preveri pred pripravo.
Pijačo za dostavo zaprite in označite skladno s pravilom enote.
Pri manjkajočem artiklu Točilnica ne izbere samovoljnega nadomestka.
Natakar potrdi ponudbo nadomestka pri gostu in spremembo vnese v POS.

### 12.5 Izdaja

Izdaja je prehod med stanjem BUMP in fizičnim prevzemom.
Na izdaji se primerja številka naročila, vsebina, količina in kanal.
Za mizo se preveri miza oziroma natakar, ne glasen klic imena gosta.
Za To Go se preveri oznaka prevzema in število kosov paketa.
Za dostavo se preveri paket, kurir in naslovna oznaka.
ACK izvedite takoj po predaji, ne ob naslednjem praznem trenutku.
Če natakar prevzame samo del naročila, se to ustno označi kot delna predaja.
Sistemskega ACK ne uporabljajte kot zamenjavo za dejansko predajo.
Paket, ki čaka, naj bo fizično ločen od že potrjeno prevzetega paketa.

### 12.6 Kartica kot delovni dogovor

Kartica je namenjena izvedbi, ne pogajanju o ceni.
Splošna opomba velja za celotno naročilo, če ni drugače jasno zapisano.
Postavčna opomba velja samo za navedeni artikel.
Opombo se bere dobesedno in skupaj z artiklom, ki mu pripada.
Količina je del naloga tudi pri artiklu brez opombe.
Fallback opozorilo se zapiše za poznejšo nastavitev, ne odstrani ročno.
Različni hodi istega naročila niso samodejno isti časovni prioritetni razred.
Pri več postajah je treba preveriti, ali čaka spremljajoča postavka.

## 13. Usmerjanje in spremembe po pošiljanju

### 13.1 Pred spremembo

Ustavite fizično pripravo, kadar je to še mogoče.
Povejte številko naročila in točno postavko.
Ugotovite stanje: zadržano, aktivno, bumped ali ack.
Ugotovite dejansko stanje hrane: ni začeto, v delu, pripravljeno, predano.
Preverite, ali je sprememba zaradi napake osebja ali želje gosta.
Preverite vpliv na alergene, ceno, zalogo in čas.
Šele nato izvedite dovoljen popravek v naročilu.

### 13.2 Sprememba zadržane postavke

Zadržane postavke niso aktivni delovni nalogi.
Spremembo zadržanega hoda uredite v naročilu pred FIRE.
Preverite številko hoda po spremembi.
Preverite, da nova postavka ohrani pravilen kanal priprave.
Če se spremeni količina, pred FIRE glasno uskladite servis.
Če se spremeni postaja, preverite novo usmerjanje na KDS.
Nikoli ne pošiljajte starega in novega hoda z istim namenom brez pojasnila.

### 13.3 Sprememba aktivne postavke

Aktivna postavka lahko že povzroča porabo sestavin.
Prodajno osebje takoj pokliče postajo in navede stanje spremembe.
Postaja odgovori, ali lahko spremembo še izvede.
V POS se evidentira dovoljena sprememba po pravilih pravic.
Če je bila priprava že začeta, vodja določi nadaljnji postopek.
Ne ustvarite nove postavke, dokler ne veste, ali stara ostaja veljavna.
Preverite novo kartico na prizadeti postaji.
Preverite, da druga postaja ni ostala s staro spremljajočo postavko.

### 13.4 Sprememba po BUMP

BUMP pomeni, da je postaja pripravo že zaključila.
Najprej poiščite fizično jed oziroma pijačo.
Če še ni predana, jo ločite in označite »ne izdaj«.
Če je predana, natakar preveri pri gostu in vodja vodi reklamacijo.
POS popravek mora slediti odobrenemu postopku za odprto ali zaključeno prodajo.
Ne uporabite novega brezplačnega artikla kot prikritega popravka računa.
Odpis in ponovno pripravo dokumentirajte po internem pravilu.

### 13.5 Preklic

Preklic praznega odprtega telefonskega naročila je mogoč po pravilih POS.
Preklic z aktivnimi nalogi zahteva najprej stik z vsemi postajami.
Preklic z BUMP postavko zahteva preverjanje fizične predaje.
Preklic dostave zahteva stik s kurirjem, če je že odšel.
Preklic QR naročila ne sme izbrisati že pripravljene hrane brez sledi.
Pri že plačanem ali izdanem računu se uporablja postopek iz sklopa 06.
Razlog preklica naj bo dejanski: gost, nedosegljiv naslov, napaka ali zaloga.
»Samo da izgine s seznama« ni veljaven razlog.

### 13.6 Primer spremembe

Gost pri naročilu 184 spremeni margarito v vegetarijansko.
Pica potrdi, da testo še ni obloženo.
Natakar spremeni postavko v POS po dovoljenem postopku.
Pica na zaslonu preveri novo ime, dodatke in opombo.
Stare kartice ne označi kot pripravljene.
Če se pojavi dvojnik, se ustavi priprava in pokliče vodja.

## 14. Večhodni servis v praksi

### 14.1 Pred pošiljanjem

Prvi hod naj vsebuje postavke, ki jih gost želi takoj.
Poznejši hod naj vsebuje jedi, ki ne smejo v pripravo prezgodaj.
Pijača se dodeli v hod po dogovoru servisa, ne po navadi kuhinje.
Sladica ni samodejno HOLD, če jo gost želi takoj.
Enaka jed v dveh hodih mora biti označena z različnim hodom.
Pred pošiljanjem natakar glasno pregleda število hodov.

### 14.2 FIRE kontrola

FIRE izvajajte ob dogovorjenem trenutku strežbe.
Preverite `courseNumber`, ne samo položaja kartice.
Preverite, da `pairingGroupId` pripada izbranemu naročilu.
FIRE z istim namenom se ne ponavlja zaradi počasnega osveževanja.
Po FIRE počakajte na potrditev in nato preglejte postaje.
Če ena postaja hoda ne vidi, zapišite postajo in čas ter eskalirajte.
Ne sproščajte naslednjega hoda zato, da bi »ohranili tempo« brez gosta.

### 14.3 Sinhronizacija postaj

Kuhinja in Točilnica se pred velikim hodom dogovorita o ciljnem času.
Pice ob dolgem času pečenja sporočijo kuhinji, ne čakajo v tišini.
Natakar ob zamudi gostu poda realen čas, ne tehničnega ugibanja.
Izdaja ne ACK-a posamezne postaje kot da je cel hod zaključen.
Vodja uporabi številko naročila pri razreševanju zaporedja.

### 14.4 Vaja: štirje hodi

Vnesite aperitiv v prvi hod.
Vnesite predjed v prvi hod.
Vnesite glavno jed v drugi hod in jo označite HOLD.
Vnesite sladico v tretji hod in jo označite HOLD.
Po oddaji preverite, da sta aktivni samo postavki prvega hoda.
Po izdaji predjedi izvedite FIRE drugega hoda.
Po izdaji glavne jedi izvedite FIRE tretjega hoda.
Opišite, kateri zaslon vidi katero postavko.
Opišite, zakaj BUMP prvega hoda ne sprosti samodejno sladice.

## 15. KDS izpad, obnovitev in dokazovanje stanja

### 15.1 Znaki incidenta

Zaslon se ne osveži približno 15 sekund ali več.
Zaslon prikaže napako nalaganja.
Kartica izgine brez BUMP ali ACK.
POS kaže poslano naročilo, postaja pa ga ne vidi.
BUMP ostane na zaslonu po kliku brez potrditve.
Na dveh zaslonih se kaže neskladno stanje istega naročila.

### 15.2 Prvi odziv

Ne oddajajte istega naročila še enkrat.
Ne klikajte BUMP zaporedoma.
Zapišite številko naročila, nalog, postajo in čas.
Povejte vodji, ali je jed fizično začeta.
Ohranite kartico oziroma posnetek napake, če to dovoljuje politika.
Preverite lokalno omrežje in napajanje naprave.
Osvežite samo po zapisu dejanskega stanja.

### 15.3 Obnovitev po osvežitvi

Primerjajte seznam KDS s POS odprtimi naročili.
Za vsak sporni nalog preverite stanje `zadrzano`, `aktivno`, `bumped` ali `ack`.
Primerjajte čas aktivacije z dejanskim začetkom priprave.
Če je BUMP uspel, ne pripravljajte ponovno samo zato, ker osebje ni videlo potrditve.
Če BUMP ni uspel, vendar je jed pripravljena, vodja določi dokumentiran zaključek.
Če nalog manjka, ne izdelujte hrane samo po spominu brez povezave z naročilom.
Po obnovitvi obvestite strežbo o vseh potrjenih zamudah.

### 15.4 Idempotentnost ni fizična varovalka

Vsak BUMP in ACK uporablja ključ idempotentnosti.
Enak tehnični zahtevek ne bi smel ustvariti drugega dogodka.
To ne prepreči dveh fizično pripravljenih jedi.
Zato pred ponovitvijo dejanja preverite pult, peč in izdajo.
Ključa ne poskušajte ročno spreminjati, da bi obšli negotovo stanje.
Vodja zbira incidentno številko, ne pa osebnih ugibanj.

### 15.5 Incidentna vaja

Scenarij: internet izgine po BUMP pice 184.
Pica je na polici, natakar je še ni prevzel.
Osebje zapiše čas, številko 184 in oznako pice.
Ne pripravi druge pice.
Po obnovitvi preveri KDS zgodovino naloga.
Če je `bumpedAt` zapisan, pica čaka na izdajo.
Če ni zapisan, vodja vodi dovoljen zaključek in preveri, da se ne podvoji predaja.
Vaja je uspešna, če ekipa ne ustvari dodatne hrane ali dodatnega naloga.

## 16. QR meni, naprava in odprto naročilo

### 16.1 Kaj QR identiteta pomeni

QR identiteta poveže gosta z enoto in po potrebi mizo.
QR naprava ni osebni račun gosta.
Koda za mizo A1 ni koda za teraso B1.
Gost mora uporabljati kodo, ki je fizično na njegovi lokaciji.
QR meni lahko zahteva bližino lokala ali lokalni Wi-Fi.
Zunaj dovoljenega območja se gostu ne obljublja oddaje naročila.
Ne kopirajte QR povezave med enotami.

### 16.2 Predobjavna kontrola kode

Skenirajte fizično natisnjeno kodo.
Preverite prikazano ime enote.
Preverite identiteto mize oziroma kanala.
Preverite, da meni ni testni ali prazen.
Preverite vidnost artiklov in cen na dejanski napravi.
Preverite, da je naprava po testu odstranjena iz odprte košarice.
Ne uporabljajte zasebne QR slike kot nadomestek uradne oznake.

### 16.3 Oddaja QR naročila

Gost izbere artikle in potrdi vsebino v meniju.
Gost vpiše razumljivo opombo le, kadar jo lokal lahko izvede.
Po oddaji osebje poišče odprto naročilo po pravilnem kanalu.
Osebje preveri mizo, količino in opombe pred pripravo.
QR naročilo se v pripravo pošlje po istem nadzorovanem postopku kot POS naročilo.
Gostu ne obljubljajte plačilnega stanja samo na podlagi prikaza v brskalniku.
Račun in plačilo se obravnavata ločeno po sklopu 06.

### 16.4 Odprto naročilo QR gosta

Odprto QR naročilo je lahko dopolnjeno le po pravilih poslovanja.
Pred dodajanjem preverite, ali gre za isto mizo in isto skupino.
Ne združujte dveh miz samo zato, ker je priimek enak.
Ob prestavitvi gosta naj natakar najprej uredi pravilno mizo naročila.
Ob odhodu gosta brez zaključka vodja preveri dejansko porabo in pravila lokala.
QR identiteta ne nadomesti preverjanja prisotnosti gosta.

### 16.5 Klic natakarja iz QR

Zahtevek natakarju ima stanje `caka`, `potrjeno` ali `zakljuceno`.
`caka` pomeni, da gost zahteva pomoč, ne da je pomoč že na poti.
Natakar sprejme zahtevek in ga označi `potrjeno`.
Po obisku mize zahtevek označi `zakljuceno`.
Zahtevek vsebuje enoto, mizo, QR napravo in čase dogodkov.
Ne zapirajte zahtevka, ker ga je videl drug natakar.
Če gost znova kliče, preverite mizo in čas, preden sklepate o dvojniku.
Čakalna vrsta se osvežuje periodično; pri nujnem primeru uporabite običajni klic osebja.

### 16.6 QR To Go

To Go mora biti izbran pred pripravo, kadar je mogoče.
Paket dobi številko naročila in dogovorjeno oznako prevzema.
Ne pišite celotne telefonske številke na javno polico.
Ob prevzemu vprašajte za oznako in primerjajte artikle.
Če se gost predstavi z drugo oznako, preverite odprto naročilo, ne ugibajte.
Paket ne dobi ACK, dokler ga nekdo dejansko ne prevzame.

### 16.7 QR incidentna vaja

Gost pokaže zaslon »naročilo oddano«, POS pa naročila ne vidi.
Osebje zapiše čas, mizo in vsebino košarice.
Preveri odprta naročila in KDS po številki oziroma času.
Ne vnese novega naročila pred preveritvijo.
Če ga ni, vnese naročilo na POS z oznako QR incident.
Gostu pove, da se plačilo preverja ločeno.
Vodja preveri veljavnost QR kode in dosegljivost menija po incidentu.

## 17. Telefonski naročniki, klici in dostava

### 17.1 Normalizacija telefona

Telefon se išče po normalizirani vrednosti, ne po zapisu presledkov.
`041 123 456` in `041-123-456` naj predstavljata isto številko.
Zapis države se preveri skladno s pravili imenika.
Ne sklepajte, da sta dve različni mednarodni številki isti brez preveritve.
Normaliziran telefon je iskalni ključ, ne dokaz identitete osebe.
Ob klicu potrdite ime in naslov z govorjeno osebo.
Telefonske številke ne izgovarjajte na glas pred drugimi gosti.

### 17.2 CTI in ročni klic

CTI prikaz klicatelja je pomoč pri iskanju, ne samodejna potrditev naročnika.
Če CTI ponudi profil, potrdite ime in aktualni naslov.
Če CTI številke ne prepozna, številko vnesite ročno.
Če je klic skrit, ustvarite ali izberite profil po potrjenih podatkih.
Ne ustvarjajte profila samo iz nepreverjenega CTI imena.
Ob prekinitvi klica zapišite minimalne podatke in ponovno pokličite le po privolitvi oziroma politiki.

### 17.3 Polja telefonskega naročila

| Polje | Obvezno preverjanje | Primer |
| --- | --- | --- |
| telefon | normaliziran zapis in ujemanje | 041 123 456 |
| ime | potrditev klicatelja | Ana |
| izpolnitev | prevzem ali dostava | dostava |
| artikli | količina in opombe | 2 × vegetarijanska |
| čas | predvideni prevzem/dostava | 18:40 |
| naslov | ulica, številka, kraj | Cesta 1, Ljubljana |
| dostop | zvonec, nadstropje, navodilo | zvonec Novak |
| plačilo | le dogovorjeni način | kartica ob dostavi |
| strošek | če je nastavljen | 2,00 EUR |

### 17.4 Telefonski prevzem

Klicatelju ponovite artikle, količine in skupno število paketov.
Klicatelju povejte realen predvideni čas, ne samo čas začetka peke.
Vnesite prevzem kot kanal, ne kot dostavo brez naslova.
Po pošiljanju preverite KDS usmerjanje.
Paket označite z naročilom in časom.
Ob prihodu kupca preverite oznako, preden paket predate.
Plačilo in račun izvedite po sklopu 06.

### 17.5 Telefonska dostava

Naslov potrdite ob vsakem naročilu, tudi pri stalnem naročniku.
Potrdite kraj, kadar obstaja več enakih ulic.
Potrdite zvonec, vhod, nadstropje in varen kontakt.
Vnesite dogovorjeni čas dostave oziroma predvideno dostavo.
Preverite, ali sistem prikazuje strošek dostave.
Ne dodajajte stroška ustno brez postavke v naročilu.
Preverite način plačila pred odhodom kurirja.
Kurirju predajte samo paket z jasno oznako naročila.

### 17.6 Statusi dostave

`priprava` pomeni, da paket še ni pripravljen za kurirja.
`pripravljeno` pomeni, da izdaja lahko preda paket kurirju.
`na_poti` pomeni, da je kurir prevzel paket.
`dostavljeno` pomeni fizično predajo na potrjenem naslovu.
`preklicano` pomeni, da se dostava ne bo nadaljevala in zahteva razrešitev naročila.
Statusi se posodabljajo ob dejanskem dogodku, ne vnaprej zaradi videza.
Čas statusa je pomemben pri pritožbi gosta in pri usklajevanju z ekipo.

### 17.7 Neuspešna dostava

Kurir ne pušča paketa brez dogovorjene predaje.
Kurir poskusi stik po odobrenem postopku.
Kurir obvesti vodjo o nedosegljivem naslovu.
Vodja preveri telefonski kontakt in zapis navodil.
Ne označite `dostavljeno`, če paketa ni prejel upravičen prejemnik.
O nadaljnji prodaji, vračilu ali odpisu odloči odgovorna oseba.
Če je račun že izdan, se denarni del vodi po sledljivem postopku sklopa 06.

### 17.8 Podvojeni telefonski profil

Najprej primerjajte normaliziran telefon.
Nato primerjajte potrjeno ime in aktualni naslov.
Preglejte, ali gre za skupno družinsko ali poslovno številko.
Ne združujte profilov med klicem, če niste za to pooblaščeni.
Izberite en potrjen profil za tekoče naročilo.
Vodji posredujte oba zapisa in razlog za čiščenje.
Po združitvi preverite, da zgodovina ni razlog za pošiljanje na star naslov.

## 18. Dnevni kontrolni seznami

### 18.1 Pred začetkom priprave

- [ ] Prijavljena je prava enota.
- [ ] KDS zaslon ima napajanje in omrežje.
- [ ] Kuhinja vidi postajo Kuhinja.
- [ ] Pice vidijo postajo Pice, kadar je ločena.
- [ ] Točilnica vidi postajo Bar.
- [ ] Izdaja ve, kje so police za mize, To Go in dostavo.
- [ ] QR koda na vzorčni mizi odpre pravi meni.
- [ ] Telefonski imenik najde preizkusno številko skladno s pravicami.
- [ ] Ekipa pozna dežurnega vodjo izmene.

### 18.2 Med konico

- [ ] Prednost določamo po času, hodu in obljubljenem prevzemu.
- [ ] Rdeče kartice preverjamo, ne samo odkljukamo.
- [ ] Spremembe se najprej sporočijo postaji.
- [ ] BUMP pomeni pripravljeno.
- [ ] ACK pomeni predano.
- [ ] To Go paketi niso pomešani z dostavo.
- [ ] Telefonski naslov se potrdi ob vsakem klicu.
- [ ] Negotova stanja se zapišejo z uro.

### 18.3 Ob predaji izmene

- [ ] Preverjena so aktivna naročila.
- [ ] Preverjeni so HOLD hodi.
- [ ] Preverjeni so paketi, ki čakajo na prevzem.
- [ ] Preverjene so dostave na poti.
- [ ] Vodja prejme seznam KDS incidentov.
- [ ] Naslednja ekipa pozna zamude in posebne alergenske zahteve.

## 19. Vaje in preverjanje znanja

### 19.1 Vaja usmerjanja

Vnesite juho za Kuhinjo, pico za Pice in pivo za Točilnico.
Naročilo pošljite v pripravo.
Na vsakem zaslonu poiščite samo njemu namenjeno postavko.
Na kartici z fallback opozorilom opišite dejanje osebja.
Pravilni odgovor: priprava se ne preusmeri ustno; vodja preveri nastavitev.

### 19.2 Vaja spremembe

Aktivna pica dobi zahtevo »brez oliv«.
Pica pove, da oliv še ni dodala.
Opišite zaporedje od klica do pregleda nove kartice.
Navedite, zakaj se starega naloga ne sme BUMP-ati kot pripravljenega.

### 19.3 Vaja QR klica

Gost z mize 12 pritisne klic natakarja.
Katero stanje najprej vidi ekipa?
Pravilni odgovor: `caka`.
Katero stanje izbere natakar ob sprejemu?
Pravilni odgovor: `potrjeno`.
Katero stanje izbere po obisku?
Pravilni odgovor: `zakljuceno`.

### 19.4 Vaja telefona

Klicatelj poda številko `041-123-456`.
V imeniku obstaja zapis `041 123 456`.
Ali ustvarite nov profil?
Pravilni odgovor: ne; najprej uporabite normalizirano iskanje in potrdite podatke.
Kateri naslov uporabite?
Pravilni odgovor: naslov, ki ga klicatelj izrecno potrdi za to naročilo.

### 19.5 Kratek test

1. Kaj pomeni BUMP?
Odgovor: postavka je pripravljena za naslednji korak.
2. Kaj pomeni ACK?
Odgovor: fizični prevzem oziroma izdaja je potrjena.
3. Ali FIRE ponovimo, ker zaslon počasi osvežuje?
Odgovor: ne; najprej preverimo potrditev in stanje.
4. Ali QR dokazilo dokazuje plačilo?
Odgovor: ne; identificira oddajo, plačilo se preverja ločeno.
5. Ali CTI samodejno potrdi naslov?
Odgovor: ne; naslov se potrdi s klicateljem.
6. Kdo odloči o ponovni pripravi po BUMP?
Odgovor: vodja po preverjanju dejanske predaje in postopka.

## 20. Nastavitev postaj in servisne različice

### 20.1 Podatki postaje

Postaja ima enoto, ime, tip in status aktivnosti.
Tip je `kitchen`, `pizza` ali `bar`.
Ime zaslona je operativna oznaka, ne pravilo usmerjanja artiklov.
ID postaje je tehnična povezava med nalogom in zaslonom.
Postaja mora pripadati isti enoti kot naročilo.
Neaktivna postaja ne sme biti cilj za novo pripravo.
Zaslon je lahko naročen na eno ali več postaj.
Naročnina zaslona ne spreminja vrste postaje.

### 20.2 Pred odprtjem postaje

Vodja preveri napajanje zaslona.
Vodja preveri prijavo v pravo enoto.
Vodja preveri vidne postaje na zaslonu.
Vodja preveri čas naprave.
Vodja pošlje nadzorovano preskusno naročilo le po internem postopku.
Ekipa preveri, kam je usmerjena vsaka preskusna postavka.
Preskusno naročilo se odstrani samo po sledljivem testnem postopku.
Ne uporabljajte pravega gostovega naročila za preizkus postaje.

### 20.3 Ločena kuhinja in pice

Profil ločenih postaj prikazuje Kuhinjo ločeno od Pic.
Kuhinja vidi naloge tipa `kitchen`.
Pice vidijo naloge tipa `pizza`.
Točilnica vidi naloge tipa `bar`.
Pica ne postane kuhinjski nalog zaradi podobnega imena artikla.
Kuhinja ne prevzame pice brez sistemsko določene izjeme.
Vodja odpravi napačno kategorijo artikla po servisu.
Med servisom ekipa uporabi dogovorjeni ročni prenos samo s sledjo v naročilu.

### 20.4 Združena kuhinja in pice

Profil `bar_combined_kitchen` združi `kitchen` in `pizza` na pogledu Kuhinja.
Naslov zaslona ostane Kuhinja tudi, kadar prikazuje pico.
Osebje še vedno bere tip in vsebino postavke.
Združitev zaslona ne pomeni, da ena oseba odgovarja za vse naloge.
Vodja določi fizični vrstni red peči in kuhinjske linije.
Pri konici se naročila ne filtrirajo ustno; uporabljajo se vidne oznake in hodi.

### 20.5 Bar z ločeno pripravo hrane

Točilnica pripravi pijače in artikle, usmerjene na bar.
Kuhinja ne čaka na BUMP pijače, če hod zahteva samostojno predajo.
Natakar uskladi aperitiv z morebitno predjedjo.
Pijača za isto mizo ne dokazuje, da je glavna jed pripravljena.
Izdaja preveri vsebino paketa po postajah.
Pri dostavi se tekočine pakirajo po pravilih lokala, preden je nalog bumped.

### 20.6 Fallback usmerjanje

`uporabljenFallback` pomeni, da je bila uporabljena privzeta postaja.
To opozorilo ne pove, ali je izbrana postaja fizično pravilna.
Pripravljavec dokonča nalog le, če ga zna varno pripraviti.
Vodja zapiše artikel, kategorijo in dejansko postajo.
Administrator preveri pravilo artikla ali kategorije.
Popravek pravila se preskusi pred naslednjo konico.
Ne ponavljajte fallback opozorila z ustvarjanjem novega naročila.

## 21. Podroben časovni potek HOLD in FIRE

### 21.1 Stanja iste postavke

Postavka brez večhodne oznake lahko nastane kot aktivni nalog.
Postavka poznejšega hoda nastane kot `zadrzano`.
`zadrzano` nima časa `aktiviranoAt`, dokler ni sproščeno.
FIRE ustvari dogodek `sproscen`.
Po FIRE je nalog `aktivno`.
Aktivni nalog ima čas aktivacije.
BUMP ustvari dogodek `bump`.
Po BUMP je nalog `bumped`.
ACK ustvari dogodek `ack`.
Po ACK je nalog `ack`.

### 21.2 Časovnica dveh hodov

18:00 natakar ustvari naročilo 431.
18:01 pošlje predjed prvega hoda.
18:01 glavna jed drugega hoda ostane zadržana.
18:03 Točilnica BUMP-a aperitiv.
18:07 Kuhinja BUMP-a predjed.
18:08 Izdaja ACK-a prvi hod po predaji.
18:22 natakar preveri pripravljenost gosta.
18:22 natakar FIRE-a drugi hod.
18:22 Kuhinja in Pice prejmeta aktivne postavke drugega hoda.
18:38 postaje BUMP-ajo pripravljene postavke.
18:40 izdaja potrdi predajo.

### 21.3 Kaj FIRE ne naredi

FIRE ne zaključi računa.
FIRE ne spremeni cene postavke.
FIRE ne potrdi fizične predaje.
FIRE ne odpravi napačne postaje.
FIRE ne prekliče prejšnjega hoda.
FIRE ne zagotovi takojšnje priprave.
FIRE ne nadomesti telefonskega obvestila o posebni časovni zahtevi.

### 21.4 Kaj BUMP ne naredi

BUMP ne obvesti gosta samodejno.
BUMP ne potrdi plačila.
BUMP ne razveljavi HOLD drugih hodov.
BUMP ne pomeni, da je paket prevzel kurir.
BUMP ne pove, ali je jed na pravi mizi.
BUMP ne nadomesti preverjanja alergenske opombe.
BUMP ne izbriše dogodkovne zgodovine naloga.

### 21.5 Napačen FIRE

Natakar sproži sladico 20 minut prezgodaj.
Najprej takoj obvesti prizadeto postajo.
Postaja pove, ali priprave še ni začela.
Vodja odloči o dovoljenem popravku naročila.
Kartice se ne skrivajo ali brišejo ročno.
Natakar gostu poda realno informacijo o časovni spremembi.
Po incidentu ekipa preveri, zakaj je bil izbran napačen hod.

### 21.6 Hodi pri To Go in dostavi

Hodi pri To Go se uporabljajo le, kadar lokal res streže v zaporedju.
Za običajen enkratni prevzem se ne ustvarja umetnih hodov.
Pri dostavi FIRE upošteva čas pakiranja in odhoda kurirja.
Sladice se ne FIRE-ajo prezgodaj, če bi izgubile kakovost.
Kurirjev čas prevzema se sporoči izdaji in pripravi.
Hod ni nadomestek za status dostave.

## 22. QR poti gosta in robni primeri

### 22.1 Pot gosta za mizo

Gost skenira fizično QR oznako.
Meni vzpostavi identiteto QR naprave.
Gost vidi meni dostopen za to identiteto.
Gost doda artikle v košarico.
Gost preveri količino in opombe.
Gost odda naročilo.
Osebje preveri nastalo odprto naročilo.
Postaje prejmejo pripravo po pravilih naročila.
Natakar predaja po številki mize in vsebini.

### 22.2 Pot gosta To Go

Gost odpre QR meni.
Gost izbere To Go.
Gost izbere artikle.
Gost doda dovoljeno opombo.
Gost odda naročilo.
Izdaja pripravi oznako prevzema.
Gost pove oznako pri pultu.
Osebje primerja oznako, paket in naročilo.
Plačilo se preveri ločeno od same oddaje.

### 22.3 Pot gosta pri klicu natakarja

Gost izbere zahtevo za natakarja.
Sistem ustvari zahtevek v stanju `caka`.
Natakar odpre čakalno vrsto.
Natakar preveri številko mize in čas zahtevka.
Natakar označi zahtevek `potrjeno`.
Natakar obišče mizo.
Natakar označi zahtevek `zakljuceno`.
Če potrebuje gost nov obisk, ustvari nov zahtevek po običajni poti.

### 22.4 Neveljavna ali manjkajoča QR identiteta

Gostu povejte, da je treba skenirati fizično kodo na lokaciji.
Ne zahtevajte, da gost pošilja povezavo drugemu gostu.
Preverite, ali je koda poškodovana ali zamenjana.
Preverite enoto in mizo v administraciji.
Gostu po potrebi pomaga natakar z običajnim naročilom.
Ne pripenjajte naročila na približno podobno mizo.
Po incidentu zamenjajte neveljavno fizično oznako po postopku lokala.

### 22.5 GPS ali Wi-Fi omejitev

QR meni lahko zahteva bližino ali lokalni Wi-Fi.
Gostu ne svetujte obhoda omejitve prek posredovane povezave.
Preverite, ali je gost dejansko na lokaciji enote.
Če preverjanje ni dovoljeno, naročilo prevzame osebje po običajnem kanalu.
Omejitev varuje povezavo naročila s pravilno lokacijo.

### 22.6 Dvakrat kliknjena oddaja QR

Gost dvakrat pritisne oddajo zaradi počasnega telefona.
Osebje najprej poišče dve naročili po času in vsebini.
Ne pripravi obeh naročil, dokler ni stanje jasno.
Primerja identiteto mize, postavke in čas oddaje.
Vodja vodi dovoljen postopek za morebitni dvojnik.
Gostu se ne obljublja preklica plačila brez pregleda plačilnega stanja.

## 23. Telefonski in dostavni scenariji

### 23.1 Nov klicatelj

Operater vpraša za telefonsko številko.
Operater številko vnese v običajnem zapisu.
Sistem poišče normalizirano vrednost.
Če profila ni, operater pridobi ime.
Operater pridobi samo potrebni naslov in kontakt.
Operater izbere prevzem ali dostavo.
Operater ponovi artikle, količine in čas.
Operater pošlje pripravo po potrditvi klicatelja.

### 23.2 Stalni klicatelj z novim naslovom

Operater najde profil po telefonu.
Operater ne predpostavi starega naslova.
Operater vpraša, kam se dostavlja danes.
Operater vnese oziroma potrdi novi naslov.
Operater preveri zvonec in dostop.
Operater ponovi naslov brez nepotrebnega razkrivanja podatkov drugim.
Vodja uredi trajno spremembo profila po politiki zasebnosti.

### 23.3 Klic se prekine

Operater ne pošlje nepopolnega naročila v pripravo.
Operater zapiše, kaj je potrjeno in kaj manjka.
Operater preveri, ali politika dovoljuje povratni klic.
Pri povratnem klicu najprej potrdi identiteto in vsebino.
Če klica ni mogoče dokončati, naročilo ostane neoddano oziroma se prekliče sledljivo.
Ne ugibajte naslova, načina plačila ali količine.

### 23.4 Kurir prevzame paket

Izdaja preveri številko naročila.
Izdaja preveri število paketov in pijač.
Kurir preveri naslovno oznako.
Izdaja preda paket kurirju.
Šele nato se status spremeni na `na_poti`.
Kurir ne označi `dostavljeno` ob prevzemu iz lokala.
Kurir ob povratku poroča o neuspešni predaji.

### 23.5 Kurir dostavi

Kurir preveri hišno številko in dogovorjena navodila.
Kurir preveri, da je paket za pravo naročilo.
Kurir izvede dogovorjeni način plačila po pravilih enote.
Kurir fizično preda paket.
Status spremeni na `dostavljeno` šele po predaji.
Če je potrebna izjema, obvesti vodjo pred označitvijo statusa.

## 24. Trenerjev scenarij za zaseden servis

Trener razdeli udeležence na natakarja, kuhinjo, pico, bar, izdajo in kurirja.
Trener pripravi tri naročila za mizo, To Go in dostavo.
Prvo naročilo vsebuje dva hoda.
Drugo naročilo vsebuje alergensko opombo.
Tretje naročilo vsebuje spremembo naslova med pripravo.
Trener doda QR klic natakarja med aktivnim FIRE.
Udeleženci uporabljajo samo številke naročil pri komunikaciji.
Trener beleži vsak prezgoden BUMP in vsak manjkajoč ACK.
Po vaji ekipa primerja stanje POS, KDS, izdaje in dostave.
Uspeh pomeni, da ni podvojene priprave, napačne predaje ali nepojasnjenega stanja.

## 25. Ocenjena vaja 05

### Naloga

Vnesite QR To Go naročilo z dvema picama in pijačo.
Pici dodelite drugi hod HOLD.
Pijačo pošljite v prvi hod na Točilnico.
Sprejmite QR zahtevek natakarju za drugo mizo.
FIRE-ajte pici po predaji prvega hoda.
Simulirajte izpad po BUMP ene pice.
Obnovite prikaz brez ustvarjanja druge priprave.
Telefonskemu gostu nato ustvarite dostavo z novim naslovom.

### Merila ocene

Udeleženec prebere pravi kanal vsake postavke.
Udeleženec uporablja `caka`, `potrjeno`, `zakljuceno` v pravem zaporedju.
Udeleženec ne FIRE-a napačnega hoda.
Udeleženec zapiše številko in čas KDS incidenta.
Udeleženec potrdi naslov namesto kopiranja starega.
Udeleženec ne označi dostave kot končane pred fizično predajo.

## 26. Napredni operativni primeri priprave

### 26.1 Sočasni kanali

Miza 8, QR miza 9 in telefon lahko ustvarijo naloge v istem trenutku.
Kanal naročila ne spremeni pravila postaje priprave.
Kuhinja ne daje samodejne prednosti telefonu pred mizo.
Vodja določi prednost po obljubljenem času, hodu in stanju gosta.
QR To Go potrebuje oznako prevzema tudi med veliko konico.
Telefonska dostava potrebuje čas kurirja, ne le čas peke.
Natakar ob zamudi sporoči gostu realno oceno, ki jo potrdi postaja.

| Kanal | Prva identifikacija | Izdaja preveri | Tveganje konice |
| --- | --- | --- | --- |
| miza | številka mize/naročila | natakar in miza | predaja napačni mizi |
| QR pri mizi | QR miza/naročilo | miza in vsebina | dvojna oddaja gosta |
| QR To Go | oznaka naročila | oznaka in paket | zamenjana polica |
| telefon prevzem | telefon/naročilo | oznaka prevzema | enako ime gostov |
| telefon dostava | naročilo/kurir | paket in naslovna oznaka | prezgoden odhod |

### 26.2 Deljena odgovornost med zasloni

Bar potrdi samo svoje pijače.
Pice potrdi samo svoje pice.
Kuhinja potrdi samo svoje kuhinjske jedi.
Izdaja ne spreminja BUMP v imenu pripravljavca.
Natakar ne označi ACK, dokler paketa ni prevzel.
Vodja ne uporablja skupnega zaslona za ugibanje stanja drugih postaj.
Če postaja manjka, se najprej preveri nastavitev in nato fizična možnost priprave.

### 26.3 Manjkajoča KDS postaja

POS je poslal naročilo, na pričakovanem zaslonu pa ni kartice.
Operater preveri številko naročila in usmerjen tip artikla.
Vodja preveri, ali je postaja aktivna in pripada isti enoti.
Vodja preveri, ali je zaslon naročen na to postajo.
Ekipa ne pošlje istega naročila še enkrat.
Če je varno, vodja določi dokumentirano ročno pripravo za prizadeto postavko.
Po obnovi se preveri, ali se je prvotni nalog pojavil.
Če se pojavi, se prepreči druga fizična priprava.

### 26.4 Dokazi ob ponovni povezavi

Zapišite številko naročila.
Zapišite ID naloga, kadar je viden.
Zapišite postajo in čas izpada.
Zapišite dejansko stanje hrane.
Zapišite, ali je bil BUMP kliknjen.
Po povezavi preverite zgodovino dogodkov naloga.
Dogodek `materializiran` dokazuje nastanek naloga.
Dogodek `sproscen` dokazuje FIRE.
Dogodek `bump` dokazuje potrditev priprave.
Dogodek `ack` dokazuje prevzem.

### 26.5 Pozna kartica po ponovni povezavi

Kartica se lahko pokaže po osvežitvi zaslona.
Pozna kartica ni novo naročilo.
Ekipa primerja ID naloga in postavko z zapisom incidenta.
Če je jed že pripravljena, se ne začne znova.
Če je jed še nepripravljena, vodja določi prednost glede na obljubljeni čas.
Natakar dobi obvestilo o dejanski zamudi.

## 27. Časovno usklajevanje in pairing

### 27.1 Pairing skupina

`pairingGroupId` povezuje postavke istega večhodnega QR poteka.
Skupina pomaga prepoznati, katere postaje morajo dobiti isti sproščeni hod.
Ni identifikator gosta ali plačila.
Ne primerjajte pairing skupin različnih naročil.
Pred FIRE preverite naročilo, številko hoda in skupino.
Po FIRE preverite aktivne postavke na vseh zahtevanih postajah.

### 27.2 Časovni cilj hoda

Natakar določi želeni trenutek strežbe.
Kuhinja oceni čas priprave glavne jedi.
Pice sporočijo čas peči.
Bar oceni čas priprave pijače.
Izdaja uskladi končno sestavljanje.
Če ena postaja zamuja, se ne BUMP-a druge kot da je cel hod pripravljen.
Natakar odloči o predaji ločenih delov samo po dogovoru z gostom.

### 27.3 Zakasnjena jed

Kuhinja odkrije, da sestavine niso pripravljene.
Kuhinja navede številko naročila in realno zamudo.
Natakar obvesti gosta.
Vodja odloči o nadomestku samo po potrditvi gosta in evidenci v POS.
Stara postavka se ne pusti tiho v aktivnem stanju.
Nova postavka se ne naredi, dokler ni usklajen popravek.
Izdaja označi, ali je paket nepopoln ali čaka na jed.

### 27.4 Delna predaja

Gost želi pijačo takoj, glavna jed pa čaka.
Bar BUMP-a pijačo.
Natakar fizično prevzame pijačo.
Izdaja ne sklepa, da je glavna jed predana.
Kuhinja ohrani svojo aktivno postavko.
Natakar gostu razloži ločeno predajo.
Celotno naročilo se ne zaključi v pripravi samo zaradi prve predaje.

## 28. Dialogi vlog v konici

### 28.1 Sprememba pice

Natakar: »Naročilo 612, pica, brez gob; ali je še mogoče?«
Pice: »612 še ni v peči; spremembo lahko izvedemo.«
Natakar: »Spremembo vnašam v naročilo; preveri novo kartico.«
Pice: »Nova kartica potrjena.«
Vodja posreduje, če se pojavita stara in nova kartica.

### 28.2 Neviden nalog

Kuhinja: »Naročila 613 ne vidim na Kuhinji.«
Natakar: »Postavka je poslana kot kuhinjska; ne pošiljam znova.«
Vodja: »Preverjam postajo, zaslon in enoto; zapišite čas.«
Kuhinja: »Fizična priprava še ni začeta.«
Vodja: »Po obnovi preverimo prvotni nalog pred začetkom.«

### 28.3 Čakajoč kurir

Kurir: »Prevzem 614 čaka; odhod je ob 19:10.«
Izdaja: »Pica je bumped, pijača je še na Baru.«
Bar: »Pijača bo pripravljena čez dve minuti.«
Vodja: »Kurir ne prevzame nepopolnega paketa brez dogovora.«
Izdaja: »Status ostane priprava, dokler paket ni predan.«

## 29. Več naprav in varstvo naročila QR

Gost lahko odpre meni na več napravah.
Več naprav ne pomeni več miz.
Osebje preveri identiteto QR naprave in čas naročila.
Gostu ne dovolite, da zamenja mizo samo z deljenjem povezave.
Če dve napravi oddasta enako košarico, obravnavajte možnost dvojnika.
Pred pripravo primerjajte čas, postavke in mizo.
Klic natakarja z druge naprave se obravnava po mizi in času.
Zahtevek ne razkrije drugim gostom podatkov prve naprave.

## 30. Ocenjevalna rubrika priprave

| Merilo | 0 točk | 1 točka | 2 točki |
| --- | --- | --- | --- |
| usmerjanje | pripravi na napačni postaji | prepozna napako | preveri postajo in zaslon |
| HOLD/FIRE | sprosti napačen hod | potrebuje pomoč | preveri hod in pairing |
| BUMP/ACK | potrdi prezgodaj | popravi po opozorilu | potrdi po fizičnem dogodku |
| QR | ustvari dvojnik | prepozna možnost | preveri identiteto in čas |
| telefon | kopira star naslov | vpraša za naslov | potrdi vse dostavne podatke |
| incident | ponovi klik | zapiše del podatkov | primerja dogodke in fizično stanje |

Trener dodeli uspeh pri najmanj 10 od 12 točk.
Kritična napaka je dvojna priprava ali predaja napačnemu gostu.
Kritična napaka zahteva ponovitev vaje ne glede na skupni rezultat.

## 31. Paketi študij primerov za servis

### 31.1 Kavarna: hitra miza in QR dopolnitev

Ob 08:55 natakar odpre mizo 4 za kavo in rogljič.
Pijača se usmeri na Točilnico.
Rogljič se usmeri na svojo nastavljeno postajo.
Ob 08:57 gost z iste mize prek QR doda sok.
Natakar preveri, da QR identiteta pripada mizi 4.
Natakar ne združi naročila z mizo 5 zaradi podobnega časa.
Točilnica vidi nov nalog za sok.
Izdaja predaja sok pravilni mizi.
Opazovalec preveri, da QR dopolnitev ni ustvarila druge fizične mize.

### 31.2 Restavracija: tri postaje in dva hoda

Miza 21 naroči vino, predjed, pico in glavno jed.
Vino in predjed sta prvi hod.
Pica in glavna jed sta drugi hod HOLD.
Točilnica pripravi vino.
Kuhinja pripravi predjed.
Izdaja potrdi predajo prvega hoda.
Natakar ob pripravljenosti gostov FIRE-a drugi hod.
Pice in Kuhinja preverita isto številko hoda.
Izdaja ne potrdi drugega hoda, dokler nista predani obe komponenti po dogovoru.

### 31.3 Dostava: zamuda peči

Telefon naroči dve pici in pijačo za dostavo.
Operater potrdi naslov, zvonec, telefon in čas.
Kurirjev predvideni odhod je 19:00.
Pice ob 18:50 sporočijo desetminutno zamudo peči.
Vodja obvesti natakarja oziroma operaterja.
Operater gostu poda potrjeno novo oceno.
Bar pijače ne preda kurirju brez označenega paketa.
Izdaja preveri vse tri artikle pred predajo.
Status postane `na_poti` šele ob prevzemu kurirja.

### 31.4 Dogodek: serijski prevzem

Dogodek uporablja več To Go naročil v kratkem času.
Vsak paket dobi številko naročila in kratko oznako prevzema.
Izdaja razporedi pakete po jasnem fizičnem zaporedju.
Kuhinja BUMP-a samo dokončane pakete.
Bar ne odlaga pijač med pakete brez oznake.
Gost ob prevzemu pove oznako.
Osebje primerja oznako, številko in število paketov.
Opazovalec zabeleži vsako predajo brez preverjanja.

## 32. Obrazci predaje in primerjave stanj

### 32.1 Predajni zapis med izmenama

| Polje | Kaj se zapiše |
| --- | --- |
| čas predaje | dejanski čas |
| odprto naročilo | številka in kanal |
| KDS stanje | zadržano, aktivno, bumped ali ack |
| fizično stanje | ni začeto, v pripravi, na polici, predano |
| naslednje dejanje | FIRE, priprava, izdaja ali klic gosta |
| lastnik dejanja | vloga oziroma ime po internem pravilu |
| incident | čas, postaja in kratko dejstvo |

Predajni zapis ne vsebuje nepotrebnih osebnih podatkov gosta.
Naslednja ekipa najprej primerja zapis s POS in KDS.
Nejasno stanje se takoj potrdi pri osebi, ki je imela paket nazadnje.

### 32.2 Primerjava KDS, QR in telefona

| Vir | Primarni status | Kaj potrjuje | Kaj ne potrjuje |
| --- | --- | --- | --- |
| KDS | aktivno/bumped/ack | izvedba priprave | plačilo |
| QR naročilo | oddano | zahtevo gosta | fizično predajo |
| QR klic | caka/potrjeno/zakljuceno | servisni zahtevek | naročilo hrane |
| telefon | profil/naročilo | dogovorjene podatke | aktualni naslov brez potrditve |
| dostava | na_poti/dostavljeno | logistično predajo | fiskalni status |

### 32.3 Opazovalni seznam

- [ ] Udeleženec pred pripravo prebere kanal in številko naročila.
- [ ] Udeleženec pri spremembi najprej pokliče postajo.
- [ ] Udeleženec preveri fizično stanje pred ponovitvijo BUMP.
- [ ] Udeleženec uporabi FIRE samo za pravi hod.
- [ ] Udeleženec sprejme QR klic pred zaključkom.
- [ ] Udeleženec potrdi naslov telefonske dostave.
- [ ] Udeleženec predaja paket šele po primerjavi oznake.
- [ ] Udeleženec eskalira manjkajočo postajo brez dvojne oddaje.

## 33. Časovno vodene vaje

### 33.1 Vaja 90 sekund: FIRE

Trener pokaže naročilo s tremi hodi.
Udeleženec ima 90 sekund za identifikacijo naslednjega hoda.
Udeleženec pove številko naročila, hod in postaje.
Udeleženec navede, kaj bo preveril po FIRE.
Točka se ne dodeli, če udeleženec zamenja BUMP in ACK.

### 33.2 Vaja 120 sekund: manjkajoči zaslon

Trener skrije kartico s pričakovane postaje.
Udeleženec ima dve minuti za prvih pet dejanj.
Pričakovano: zapiše naročilo, postajo, čas in fizično stanje.
Pričakovano: preveri enoto, postajo in naročnino zaslona.
Kritična napaka je ponovno pošiljanje naročila brez preveritve.

### 33.3 Vaja 180 sekund: telefonska dostava

Trener poda stare podatke profila in nov naslov.
Udeleženec mora potrditi aktualni naslov.
Udeleženec mora izbrati dostavo in predvideni čas.
Udeleženec mora ponoviti artikle, strošek in plačilni dogovor.
Točke se odvzamejo za kopiranje starega naslova brez vprašanja.

## 34. Preverjanje kompetenc in utemeljitev

### Vprašanje 1

Zakaj se BUMP ne ponovi samo zato, ker se zaslon ni osvežil?
Odgovor: ker je lahko tehnični dogodek uspel, fizična jed pa je že pripravljena.
Utemeljitev: idempotentnost zahteve ne prepreči dvojne fizične priprave.

### Vprašanje 2

Kaj primerjate pred predajo QR To Go paketa?
Odgovor: oznako prevzema, številko naročila, artikle in količino.
Utemeljitev: QR oddaja ne dokazuje, kdo paket prevzema.

### Vprašanje 3

Kdaj je dostava `na_poti`?
Odgovor: po fizičnem prevzemu paketa kurirja.
Utemeljitev: pripravljena hrana na polici še ni na poti.

### Vprašanje 4

Kaj naredite z novim QR naročilom, ki je videti kot dvojnik?
Odgovor: primerjate mizo, čas, identiteto in postavke pred pripravo.
Utemeljitev: dvojni klik gosta ni razlog za dve pripravi.

### Vprašanje 5

Kaj je dokaz, da je gost prejel jed?
Odgovor: fizična predaja in ustrezen ACK, kadar je izdaja omogočena.
Utemeljitev: BUMP je dokaz priprave, ne predaje.

## 35. Banka trenerjevih vprašanj

### 35.1 KDS

Vprašanje: Kaj najprej preveriš pri praznem zaslonu?
Odgovor: enoto, postajo in naročnino zaslona.
Razlog: praznina ni dokaz, da naročila ni.
Vprašanje: Kdaj je kartica aktivna?
Odgovor: po materializaciji oziroma FIRE.
Razlog: HOLD še ni delovni nalog.
Vprašanje: Kaj zapišeš ob izpadu?
Odgovor: naročilo, postajo, čas in fizično stanje.
Razlog: to omogoča varno obnovitev.
Vprašanje: Kaj pomeni fallback?
Odgovor: uporabljena je privzeta postaja.
Razlog: konfiguracijo preveri vodja.

### 35.2 Izdaja

Vprašanje: Kdaj uporabiš ACK?
Odgovor: po fizični predaji.
Razlog: BUMP ni dokaz prevzema.
Vprašanje: Kaj preveriš pri To Go?
Odgovor: oznako, vsebino in količino.
Razlog: ime gosta ni zanesljiva oznaka.
Vprašanje: Kaj narediš z nepopolnim paketom?
Odgovor: ne predaš ga brez dogovora.
Razlog: manjkajoča postavka ostane sledljiva.
Vprašanje: Kdo potrdi kurirjev prevzem?
Odgovor: izdaja po fizični predaji.
Razlog: paket na polici ni na poti.

### 35.3 QR

Vprašanje: Kaj dokazuje QR oddaja?
Odgovor: zahtevo gosta.
Razlog: ne dokazuje plačila ali predaje.
Vprašanje: Kaj narediš pri dveh podobnih QR naročilih?
Odgovor: primerjaš mizo, čas in postavke.
Razlog: preprečiš dvojno pripravo.
Vprašanje: Kaj pomeni `potrjeno` pri klicu?
Odgovor: natakar je zahtevek sprejel.
Razlog: obisk še ni zaključen.
Vprašanje: Kaj pomeni `zakljuceno`?
Odgovor: servisni obisk je opravljen.
Razlog: gost lahko nato ustvari nov klic.

### 35.4 Telefon

Vprašanje: Zakaj se normalizira telefon?
Odgovor: da različen zapis ne ustvari dvojnika.
Razlog: presledki in vezaji niso identiteta.
Vprašanje: Ali CTI potrdi naslov?
Odgovor: ne.
Razlog: naslov se potrdi pri vsakem naročilu.
Vprašanje: Kaj preveriš pri dostavi?
Odgovor: naslov, dostop, čas in plačilni dogovor.
Razlog: prejšnji profil je lahko zastarel.
Vprašanje: Kdaj je dostava končana?
Odgovor: po fizični predaji.
Razlog: `na_poti` ni `dostavljeno`.

## 36. Zaključni primeri presoje

Primer: kuhinja BUMP-a jed, izdaja pa je ne najde.
Dejanje: preverite polico, naročilo in čas BUMP.
Utemeljitev: sistemsko stanje ne nadomesti fizičnega iskanja.

Primer: natakar želi FIRE po imenu gosta.
Dejanje: poiščite številko naročila in številko hoda.
Utemeljitev: ime ni varna povezava hoda.

Primer: QR gost zamenja mizo po oddaji.
Dejanje: pred pripravo uredite mizo po dovoljenem postopku.
Utemeljitev: fizična lokacija mora ostati pravilna.

Primer: telefon navede isti naslov, drug zvonec.
Dejanje: zapišite aktualni zvonec.
Utemeljitev: dostopni podatek je del uspešne predaje.

Primer: kurir želi prevzeti samo pice.
Dejanje: preverite, ali je ločena predaja dogovorjena.
Utemeljitev: manjkajoče pijače ne smejo ostati nepojasnjene.

Primer: dve postaji čakata druga na drugo.
Dejanje: vodja določi časovni cilj in lastnika naslednjega dejanja.
Utemeljitev: tišina podaljša zamudo.

Primer: postavka ima nejasno opombo.
Dejanje: vprašajte prodajno osebo pred pripravo.
Utemeljitev: ugibanje lahko povzroči alergensko napako.

Primer: zaslon po obnovi pokaže staro kartico.
Dejanje: primerjajte ID naloga in dogodke.
Utemeljitev: star prikaz ni samodejno nov nalog.

Primer: gost ne pozna To Go oznake.
Dejanje: preverite naročilo z dovoljenimi podatki.
Utemeljitev: paket se ne izda samo na podlagi približnega opisa.

Primer: prvi hod je predan, gost želi takoj sladico.
Dejanje: preverite pravi zadržani hod in FIRE.
Utemeljitev: vrstni red se spremeni sledljivo.

Primer: dostava je označena pripravljeno, kurir zamuja.
Dejanje: paket ostane ločen in status se ne spremeni.
Utemeljitev: pripravljenost ni fizični prevzem.

Primer: osebje želi preklicati aktivno jed brez klica kuhinji.
Dejanje: najprej obvestite postajo in preverite stanje.
Utemeljitev: aktivna priprava ima fizične posledice.

Primer: pica je pripravljena, vendar brez zahtevane oznake.
Dejanje: izdaja jo označi pred odlaganjem na prevzemno polico.
Utemeljitev: oznaka preprečuje napačno predajo v konici.