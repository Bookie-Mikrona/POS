<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-db4d48092685 package=extended -->
# 05 Priprava, KDS, QR meni in telefonska naročila

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-29b6d71c2c79 package=lite -->
## 1. Namen sklopa

Ta sklop vodi naročilo od oddaje do predaje gostu.

V njem uporabljate pripravo hrane, kuhinjski prikazovalnik KDS, QR meni in telefon.

Plačilo, fiskalizacija in račun so opisani v sklopu 06.

Zaloge in pripravljena hrana so opisane v sklopu 07.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-23755ca2defc package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-742367c57bac package=lite -->
## 3. Pojmi in stanja

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e980f946e5d2 package=lite -->
### 3.1 Naročilo

Naročilo je odprta košarica na mizi, za prevzem, dostavo ali QR gosta.

Naročilo ni račun. Račun nastane šele pri uspešno zaključenem plačilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c1fd77414bf7 package=lite -->
### 3.2 KDS nalog

KDS nalog je posamezna postavka, usmerjena na postajo, na primer Kuhinja, Pica
ali Točilnica.

Postavka se na postajo usmeri po pravilih artikla oziroma kategorije.

Če pravila ni, je lahko prikazan znak preusmeritve na privzeto postajo.

Tak znak pomeni, da mora vodja preveriti nastavitev artikla; ne pomeni napake
pri pripravi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-2331d1c205ab package=lite -->
### 3.3 HOLD in FIRE

**HOLD** pomeni zadržano postavko. Na zaslonu priprave še ni delovni nalog.

**FIRE** sprosti zadržani hod v aktivno pripravo.

Zadrževanje se uporablja pri večhodnem servisu, ne za opuščanje naročil.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8b8c88f77444 package=lite -->
### 3.4 BUMP in potrditev izdaje

Klik aktivne postavke na KDS jo označi kot pripravljeno (**Bumped**).

Če je omogočen modul izdaje, se po BUMP nalog še potrdi na zaslonu Izdaja.

Šele potrditev izdaje pomeni, da je bila jed predana natakarju oziroma gostu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8af5fafe9855 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e5a78a8806b6 package=lite -->
### 4.1 Če je bila izbrana napačna postavka

1. Preverite, ali je postavka že aktivna na KDS.
2. Če ni poslana, jo popravite v naročilu in nato pošljite.
3. Če je aktivna, kuhinjo takoj obvestite o spremembi.
4. Naročilo popravite z dovoljenim postopkom v POS.
5. Preverite KDS in končno vsebino naročila.

Nikoli ne nadomeščajte napačne jedi z neuradno ustno spremembo brez uskladitve
naročila. Podatki o pripravi, zalogi in računu morajo ostati enaki.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-7b264ec7c338 package=standard -->
## 5. Delo na KDS

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a677d7c145c7 package=standard -->
### 5.1 Izbira zaslona

1. Odprite **KDS** ali namenski pogled Kuhinja, Pica oziroma Točilnica.
2. Če je na napravi več prikazovalnikov, izberite pravilni zaslon.
3. Preverite oznake postaj pod naslovom zaslona.
4. Če piše, da zaslon nima naročnin, ga ne uporabljajte za pripravo.
5. Vodja naj v nastavitvah zaslonu dodeli ustrezne postaje.

KDS prikaže samo naloge postaj, ki jim je zaslon naročen.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f2cb7bfe7bb3 package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-76192533740b package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-aed63d8d22b5 package=standard -->
### 5.4 Potrditev na zaslonu Izdaja

1. Odprite **Izdaja** na postaji predaje.
2. Poiščite pripravljeno naročilo po oznaki, mizi ali času.
3. Primerjajte jedi s kartico in oznako prevzema.
4. Predajte naročilo pravilnemu natakarju ali gostu.
5. Potrdite prevzem samo po fizični predaji.

Če izdaja ni omogočena, je BUMP zadnje stanje KDS naloga.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-fc3de9397505 package=standard -->
### 5.5 Izpad povezave ali napaka KDS

1. Ne klikajte večkrat iste postavke.
2. Zapišite številko naročila in postavko.
3. Preverite, ali je zaslon pokazal napako pri nalaganju.
4. Preverite povezavo naprave in nato osvežite prikaz.
5. Če stanje ni jasno, preverite naročilo na POS in se uskladite s kuhinjo.
6. Ponovitve BUMP ne izvajajte na pamet.

Sistem uporablja idempotentne zahteve, vendar fizična priprava ni samodejno
idempotentna. Zato najprej ugotovite dejansko stanje jedi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-2de5b2b1c97e package=extended -->
## 6. Večhodna naročila

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-d4325fcfe8f4 package=extended -->
### 6.1 Razporeditev hodov

Hodi imajo številko in vrstni red strežbe.

Postavke brez hoda se obravnavajo kot običajne postavke.

V istem hodu so lahko jedi z več postaj, na primer kuhinja in točilnica.

1. Pri vnosu naročila dodelite jedi ustreznemu hodu.
2. Preverite, da so jed in spremljajoča pijača v predvidenem hodu.
3. Zadržite hode, ki ne smejo v pripravo takoj.
4. Pošljite naročilo.
5. Na KDS preverite vidni aktivni prvi hod.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-779358b65ff8 package=extended -->
### 6.2 FIRE naslednjega hoda

1. Preverite, da je prejšnji hod pripravljen oziroma izdan po dogovoru ekipe.
2. Na ustrezni kartici poiščite nadzor **FIRE** za naslednji hod.
3. Preverite številko hoda, preden potrdite.
4. Sprožite FIRE.
5. Preverite, da se hod pokaže kot aktiven na vseh potrebnih postajah.
6. Kuhinji povejte, če mora biti hitrost priprave posebna.

FIRE lahko sproži več povezanih nalog istega hoda. To je pričakovano: jed in
vino oziroma jedi na več postajah morajo ostati usklajeni.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e07846d6754e package=extended -->
### 6.3 Kaj preveriti pri HOLD

1. Preverite, da so zadržane samo postavke poznejšega hoda.
2. Ne pričakujte, da bo HOLD med aktivnimi delovnimi nalogi.
3. Ne označujte zadržane postavke kot pripravljene.
4. Ne pritiskajte FIRE, če gost še ni pripravljen na naslednji hod.
5. Ob spremembi zaporedja najprej uskladite servis in kuhinjo.

Če je FIRE poslan prehitro, obvestite postajo takoj. Stanja ne odpravljajte z
neformalnim brisanjem kartice; vodja naj uporabi dovoljen popravek naročila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b956682d1cab package=lite -->
## 7. Postaje in usmerjanje

KDS podpira ločene postaje **Kuhinja**, **Pica** in **Točilnica**.

Postaja lahko na enem prikazovalniku deli prostor z drugo postajo ali ima
samostojen zaslon.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-37e5359d4569 package=lite -->
### 7.1 Pravilo za osebje

1. Kuhinja pripravlja le naloge Kuhinja.
2. Pica pripravlja le naloge Pica.
3. Točilnica pripravlja le naloge Bar oziroma Točilnica.
4. Osebje ne prestavlja nalog med postajami z ustnim dogovorom brez popravka.
5. Ob opozorilu fallback vodja preveri pravila artikla po koncu kritične priprave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-4d2269c8d78b package=lite -->
### 7.2 Prazna ali napačna vsebina zaslona

Če zaslon nima aktivnih nalogov, najprej preverite izbrani prikazovalnik in
njegove postaje. Če je naročilo usmerjeno na drugo postajo, ga ne pripravljajte
zgolj zato, ker ga vidite v POS.

Če se na kartici pojavi artikel, ki ga postaja ne more pripraviti, ga ne
označujte kot pripravljenega. Pokličite vodjo izmene za usmeritev.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8955a4fce643 package=extended -->
## 8. QR meni

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-880e0b1a1008 package=extended -->
### 8.1 Namen QR identitete

QR koda odpira meni z identiteto lokacije oziroma mize.

Identiteta mora pripadati točni enoti in, kadar je uporabljena, točni mizi.

QR gosta ne preusmerjajte na splošno kodo druge enote, ker se lahko naročilo
odpre na napačni lokaciji.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-32824a937b66 package=extended -->
### 8.2 Pred začetkom QR prodaje

1. V administraciji QR preverite, da je koda aktivna.
2. Preverite enoto, mizo oziroma predvideni kanal.
3. S telefonom preskusno odprite kodo.
4. Preverite, da se prikaže pravi meni in identiteta lokacije.
5. Preverite, da so artikli, ki jih želite prodajati, vidni v meniju.
6. Ne objavljajte preskusne kode na mizah.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-eb7c370aadfb package=extended -->
### 8.3 QR naročilo gosta

1. Gost odpre QR kodo.
2. Izbere artikle in doda jasne opombe.
3. Gost potrdi oddajo v meniju.
4. Osebje preveri novo naročilo na POS oziroma KDS.
5. Kuhinja ga pripravi po običajnem postopku.
6. Pred predajo preverite identiteto mize ali oznako prevzema.

QR naročilo ni samodejno dokaz fizične prisotnosti gosta. Pri sporni mizi
preverite oznako na mizi in osebo, ki prevzema.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9720878c5a76 package=extended -->
### 8.4 To Go v QR meniju

**To Go** pomeni prevzem za s seboj.

1. Gost izbere možnost To Go, kadar ne želi strežbe za mizo.
2. Osebje preveri, da je na naročilu jasno označen prevzem.
3. Pripravo opremite z oznako naročila, ne z imenom drugega gosta.
4. Pri izdaji primerjajte oznako, artikle in količino.
5. Ne odlagajte več To Go paketov brez ločljivih oznak.

Če gost spremeni To Go v strežbo na mizi, naj osebje pred pripravo uredi
pravilen kanal naročila in obvesti postajo.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-00b1448023e0 package=extended -->
### 8.5 Težava z QR naročilom

Če gost trdi, da je oddal naročilo, vi pa ga ne vidite:

1. Vprašajte za čas oddaje, artikle in oznako mize.
2. Preverite odprta naročila in KDS.
3. Ne ustvarjajte takoj dvojnega naročila.
4. Če oddaja ni uspela, naročilo vnesite na POS in jasno označite kanal.
5. Če obstaja, uporabite dokazilo gosta samo za identifikacijo, ne za sklep o plačilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-24815dae921b package=standard -->
## 9. Telefonska naročila

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-4e4b766c2326 package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-97f15dc35da3 package=standard -->
### 9.2 Naročilo za prevzem

1. Izberite način **Prevzem**.
2. Izberite oziroma dodajte naročnika po telefonu.
3. Vnesite artikle, količine, opombe in dogovorjeni čas.
4. Ponovite naročilo klicatelju.
5. Pošljite v pripravo.
6. Paket označite z identifikacijo naročila in časom prevzema.
7. Ob prevzemu preverite osebo, vsebino in stanje plačila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e3af64ac499e package=extended -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-65f14205bbc9 package=standard -->
### 9.4 Podvojeni profil ali številka

1. Ne ustvarite tretjega zapisa.
2. Primerjajte normalizirano številko, ime in zgodovino naročil.
3. Uporabite zapis, ki ima potrjene aktualne podatke.
4. Neskladje prijavite vodji za ureditev imenika.
5. Naročilo vedno dokončajte na enem, izbranem profilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3f3e2820ec5f package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ab35b7aa5def package=lite -->
## 11. Operativni model priprave

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-79c1a067b544 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0162d1660f77 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-7c3d76e4f487 package=lite -->
### 11.3 Minimalni ustni klic med vlogami

Natakar naj pove številko naročila, postajo, spremembo in želeni čas.
Primer: »Naročilo 184, pica, brez čebule, še ni v peči.«
Kuhinja naj ponovi kritični podatek, preden začne spremembo.
Primer: »184: brez čebule, potrjeno.«
Izdaja naj pri predaji pove oznako prevzema in število paketov.
Kurir naj ponovi naslovni identifikator, ne celotnih osebnih podatkov pred gosti.
Vodja naj odločitve o odpisu ali ponovni pripravi zapiše v dogovorjeni dnevnik.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-6c4054850a01 package=standard -->
## 12. Zasloni Kuhinja, Pice, Točilnica in Izdaja

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-10c996715b6c package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-98b5255f8a94 package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ee8bab7ec94d package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a92fd42d1bbb package=standard -->
### 12.4 Točilnica

Točilnica preveri volumen, temperaturo, dodatke in opombo brez ledu.
Pijača v prvem hodu se lahko aktivira prej kot zadržana glavna jed.
Točilnica ne čaka na Kuhinjo, razen če je servis izrecno usklajen po hodu.
Steklenica, kozarec in brezalkoholna različica so ločene postavke.
Pri več enakih pijačah se količina preveri pred pripravo.
Pijačo za dostavo zaprite in označite skladno s pravilom enote.
Pri manjkajočem artiklu Točilnica ne izbere samovoljnega nadomestka.
Natakar potrdi ponudbo nadomestka pri gostu in spremembo vnese v POS.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-2c65b1897f93 package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-252e24ca92b3 package=standard -->
### 12.6 Kartica kot delovni dogovor

Kartica je namenjena izvedbi, ne pogajanju o ceni.
Splošna opomba velja za celotno naročilo, če ni drugače jasno zapisano.
Postavčna opomba velja samo za navedeni artikel.
Opombo se bere dobesedno in skupaj z artiklom, ki mu pripada.
Količina je del naloga tudi pri artiklu brez opombe.
Fallback opozorilo se zapiše za poznejšo nastavitev, ne odstrani ročno.
Različni hodi istega naročila niso samodejno isti časovni prioritetni razred.
Pri več postajah je treba preveriti, ali čaka spremljajoča postavka.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-bc4c0cc342c2 package=lite -->
## 13. Usmerjanje in spremembe po pošiljanju

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3856ed011961 package=lite -->
### 13.1 Pred spremembo

Ustavite fizično pripravo, kadar je to še mogoče.
Povejte številko naročila in točno postavko.
Ugotovite stanje: zadržano, aktivno, bumped ali ack.
Ugotovite dejansko stanje hrane: ni začeto, v delu, pripravljeno, predano.
Preverite, ali je sprememba zaradi napake osebja ali želje gosta.
Preverite vpliv na alergene, ceno, zalogo in čas.
Šele nato izvedite dovoljen popravek v naročilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9a7b7daae645 package=lite -->
### 13.2 Sprememba zadržane postavke

Zadržane postavke niso aktivni delovni nalogi.
Spremembo zadržanega hoda uredite v naročilu pred FIRE.
Preverite številko hoda po spremembi.
Preverite, da nova postavka ohrani pravilen kanal priprave.
Če se spremeni količina, pred FIRE glasno uskladite servis.
Če se spremeni postaja, preverite novo usmerjanje na KDS.
Nikoli ne pošiljajte starega in novega hoda z istim namenom brez pojasnila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-757b54427ad5 package=lite -->
### 13.3 Sprememba aktivne postavke

Aktivna postavka lahko že povzroča porabo sestavin.
Prodajno osebje takoj pokliče postajo in navede stanje spremembe.
Postaja odgovori, ali lahko spremembo še izvede.
V POS se evidentira dovoljena sprememba po pravilih pravic.
Če je bila priprava že začeta, vodja določi nadaljnji postopek.
Ne ustvarite nove postavke, dokler ne veste, ali stara ostaja veljavna.
Preverite novo kartico na prizadeti postaji.
Preverite, da druga postaja ni ostala s staro spremljajočo postavko.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-79d5f4646565 package=lite -->
### 13.4 Sprememba po BUMP

BUMP pomeni, da je postaja pripravo že zaključila.
Najprej poiščite fizično jed oziroma pijačo.
Če še ni predana, jo ločite in označite »ne izdaj«.
Če je predana, natakar preveri pri gostu in vodja vodi reklamacijo.
POS popravek mora slediti odobrenemu postopku za odprto ali zaključeno prodajo.
Ne uporabite novega brezplačnega artikla kot prikritega popravka računa.
Odpis in ponovno pripravo dokumentirajte po internem pravilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-025b8a2fe491 package=lite -->
### 13.5 Preklic

Preklic praznega odprtega telefonskega naročila je mogoč po pravilih POS.
Preklic z aktivnimi nalogi zahteva najprej stik z vsemi postajami.
Preklic z BUMP postavko zahteva preverjanje fizične predaje.
Preklic dostave zahteva stik s kurirjem, če je že odšel.
Preklic QR naročila ne sme izbrisati že pripravljene hrane brez sledi.
Pri že plačanem ali izdanem računu se uporablja postopek iz sklopa 06.
Razlog preklica naj bo dejanski: gost, nedosegljiv naslov, napaka ali zaloga.
»Samo da izgine s seznama« ni veljaven razlog.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c0625ae49bcf package=lite -->
### 13.6 Primer spremembe

Gost pri naročilu 184 spremeni margarito v vegetarijansko.
Pica potrdi, da testo še ni obloženo.
Natakar spremeni postavko v POS po dovoljenem postopku.
Pica na zaslonu preveri novo ime, dodatke in opombo.
Stare kartice ne označi kot pripravljene.
Če se pojavi dvojnik, se ustavi priprava in pokliče vodja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-7a68e1411010 package=extended -->
## 14. Večhodni servis v praksi

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ca00427a46d4 package=extended -->
### 14.1 Pred pošiljanjem

Prvi hod naj vsebuje postavke, ki jih gost želi takoj.
Poznejši hod naj vsebuje jedi, ki ne smejo v pripravo prezgodaj.
Pijača se dodeli v hod po dogovoru servisa, ne po navadi kuhinje.
Sladica ni samodejno HOLD, če jo gost želi takoj.
Enaka jed v dveh hodih mora biti označena z različnim hodom.
Pred pošiljanjem natakar glasno pregleda število hodov.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-13608eb9195b package=extended -->
### 14.2 FIRE kontrola

FIRE izvajajte ob dogovorjenem trenutku strežbe.
Preverite `courseNumber`, ne samo položaja kartice.
Preverite, da `pairingGroupId` pripada izbranemu naročilu.
FIRE z istim namenom se ne ponavlja zaradi počasnega osveževanja.
Po FIRE počakajte na potrditev in nato preglejte postaje.
Če ena postaja hoda ne vidi, zapišite postajo in čas ter eskalirajte.
Ne sproščajte naslednjega hoda zato, da bi »ohranili tempo« brez gosta.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-197427062191 package=extended -->
### 14.3 Sinhronizacija postaj

Kuhinja in Točilnica se pred velikim hodom dogovorita o ciljnem času.
Pice ob dolgem času pečenja sporočijo kuhinji, ne čakajo v tišini.
Natakar ob zamudi gostu poda realen čas, ne tehničnega ugibanja.
Izdaja ne ACK-a posamezne postaje kot da je cel hod zaključen.
Vodja uporabi številko naročila pri razreševanju zaporedja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0a322bc72c88 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-6ba9ea5123dd package=standard -->
## 15. KDS izpad, obnovitev in dokazovanje stanja

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-cf2f829f9726 package=standard -->
### 15.1 Znaki incidenta

Zaslon se ne osveži približno 15 sekund ali več.
Zaslon prikaže napako nalaganja.
Kartica izgine brez BUMP ali ACK.
POS kaže poslano naročilo, postaja pa ga ne vidi.
BUMP ostane na zaslonu po kliku brez potrditve.
Na dveh zaslonih se kaže neskladno stanje istega naročila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-bfdb089fc279 package=standard -->
### 15.2 Prvi odziv

Ne oddajajte istega naročila še enkrat.
Ne klikajte BUMP zaporedoma.
Zapišite številko naročila, nalog, postajo in čas.
Povejte vodji, ali je jed fizično začeta.
Ohranite kartico oziroma posnetek napake, če to dovoljuje politika.
Preverite lokalno omrežje in napajanje naprave.
Osvežite samo po zapisu dejanskega stanja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b3704e1be971 package=standard -->
### 15.3 Obnovitev po osvežitvi

Primerjajte seznam KDS s POS odprtimi naročili.
Za vsak sporni nalog preverite stanje `zadrzano`, `aktivno`, `bumped` ali `ack`.
Primerjajte čas aktivacije z dejanskim začetkom priprave.
Če je BUMP uspel, ne pripravljajte ponovno samo zato, ker osebje ni videlo potrditve.
Če BUMP ni uspel, vendar je jed pripravljena, vodja določi dokumentiran zaključek.
Če nalog manjka, ne izdelujte hrane samo po spominu brez povezave z naročilom.
Po obnovitvi obvestite strežbo o vseh potrjenih zamudah.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-825a8d90514a package=standard -->
### 15.4 Idempotentnost ni fizična varovalka

Vsak BUMP in ACK uporablja ključ idempotentnosti.
Enak tehnični zahtevek ne bi smel ustvariti drugega dogodka.
To ne prepreči dveh fizično pripravljenih jedi.
Zato pred ponovitvijo dejanja preverite pult, peč in izdajo.
Ključa ne poskušajte ročno spreminjati, da bi obšli negotovo stanje.
Vodja zbira incidentno številko, ne pa osebnih ugibanj.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f7955db2f420 package=lite -->
### 15.5 Incidentna vaja

Scenarij: internet izgine po BUMP pice 184.
Pica je na polici, natakar je še ni prevzel.
Osebje zapiše čas, številko 184 in oznako pice.
Ne pripravi druge pice.
Po obnovitvi preveri KDS zgodovino naloga.
Če je `bumpedAt` zapisan, pica čaka na izdajo.
Če ni zapisan, vodja vodi dovoljen zaključek in preveri, da se ne podvoji predaja.
Vaja je uspešna, če ekipa ne ustvari dodatne hrane ali dodatnega naloga.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9bb4485b4523 package=extended -->
## 16. QR meni, naprava in odprto naročilo

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-4c8814212f23 package=extended -->
### 16.1 Kaj QR identiteta pomeni

QR identiteta poveže gosta z enoto in po potrebi mizo.
QR naprava ni osebni račun gosta.
Koda za mizo A1 ni koda za teraso B1.
Gost mora uporabljati kodo, ki je fizično na njegovi lokaciji.
QR meni lahko zahteva bližino lokala ali lokalni Wi-Fi.
Zunaj dovoljenega območja se gostu ne obljublja oddaje naročila.
Ne kopirajte QR povezave med enotami.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-beaf8ea13f99 package=extended -->
### 16.2 Predobjavna kontrola kode

Skenirajte fizično natisnjeno kodo.
Preverite prikazano ime enote.
Preverite identiteto mize oziroma kanala.
Preverite, da meni ni testni ali prazen.
Preverite vidnost artiklov in cen na dejanski napravi.
Preverite, da je naprava po testu odstranjena iz odprte košarice.
Ne uporabljajte zasebne QR slike kot nadomestek uradne oznake.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c874bfe3bf1e package=extended -->
### 16.3 Oddaja QR naročila

Gost izbere artikle in potrdi vsebino v meniju.
Gost vpiše razumljivo opombo le, kadar jo lokal lahko izvede.
Po oddaji osebje poišče odprto naročilo po pravilnem kanalu.
Osebje preveri mizo, količino in opombe pred pripravo.
QR naročilo se v pripravo pošlje po istem nadzorovanem postopku kot POS naročilo.
Gostu ne obljubljajte plačilnega stanja samo na podlagi prikaza v brskalniku.
Račun in plačilo se obravnavata ločeno po sklopu 06.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b0b075eb5534 package=extended -->
### 16.4 Odprto naročilo QR gosta

Odprto QR naročilo je lahko dopolnjeno le po pravilih poslovanja.
Pred dodajanjem preverite, ali gre za isto mizo in isto skupino.
Ne združujte dveh miz samo zato, ker je priimek enak.
Ob prestavitvi gosta naj natakar najprej uredi pravilno mizo naročila.
Ob odhodu gosta brez zaključka vodja preveri dejansko porabo in pravila lokala.
QR identiteta ne nadomesti preverjanja prisotnosti gosta.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-bafe2381702a package=extended -->
### 16.5 Klic natakarja iz QR

Zahtevek natakarju ima stanje `caka`, `potrjeno` ali `zakljuceno`.
`caka` pomeni, da gost zahteva pomoč, ne da je pomoč že na poti.
Natakar sprejme zahtevek in ga označi `potrjeno`.
Po obisku mize zahtevek označi `zakljuceno`.
Zahtevek vsebuje enoto, mizo, QR napravo in čase dogodkov.
Ne zapirajte zahtevka, ker ga je videl drug natakar.
Če gost znova kliče, preverite mizo in čas, preden sklepate o dvojniku.
Čakalna vrsta se osvežuje periodično; pri nujnem primeru uporabite običajni klic osebja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-6aad5aa38080 package=extended -->
### 16.6 QR To Go

To Go mora biti izbran pred pripravo, kadar je mogoče.
Paket dobi številko naročila in dogovorjeno oznako prevzema.
Ne pišite celotne telefonske številke na javno polico.
Ob prevzemu vprašajte za oznako in primerjajte artikle.
Če se gost predstavi z drugo oznako, preverite odprto naročilo, ne ugibajte.
Paket ne dobi ACK, dokler ga nekdo dejansko ne prevzame.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ef6168242074 package=lite -->
### 16.7 QR incidentna vaja

Gost pokaže zaslon »naročilo oddano«, POS pa naročila ne vidi.
Osebje zapiše čas, mizo in vsebino košarice.
Preveri odprta naročila in KDS po številki oziroma času.
Ne vnese novega naročila pred preveritvijo.
Če ga ni, vnese naročilo na POS z oznako QR incident.
Gostu pove, da se plačilo preverja ločeno.
Vodja preveri veljavnost QR kode in dosegljivost menija po incidentu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e3bf74d18107 package=extended -->
## 17. Telefonski naročniki, klici in dostava

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8ff6cb8b717c package=standard -->
### 17.1 Normalizacija telefona

Telefon se išče po normalizirani vrednosti, ne po zapisu presledkov.
`041 123 456` in `041-123-456` naj predstavljata isto številko.
Zapis države se preveri skladno s pravili imenika.
Ne sklepajte, da sta dve različni mednarodni številki isti brez preveritve.
Normaliziran telefon je iskalni ključ, ne dokaz identitete osebe.
Ob klicu potrdite ime in naslov z govorjeno osebo.
Telefonske številke ne izgovarjajte na glas pred drugimi gosti.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f9bc61cd0d5a package=lite -->
### 17.2 CTI in ročni klic

CTI prikaz klicatelja je pomoč pri iskanju, ne samodejna potrditev naročnika.
Če CTI ponudi profil, potrdite ime in aktualni naslov.
Če CTI številke ne prepozna, številko vnesite ročno.
Če je klic skrit, ustvarite ali izberite profil po potrjenih podatkih.
Ne ustvarjajte profila samo iz nepreverjenega CTI imena.
Ob prekinitvi klica zapišite minimalne podatke in ponovno pokličite le po privolitvi oziroma politiki.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-7fa5770834e7 package=standard -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-fc384f8a442b package=standard -->
### 17.4 Telefonski prevzem

Klicatelju ponovite artikle, količine in skupno število paketov.
Klicatelju povejte realen predvideni čas, ne samo čas začetka peke.
Vnesite prevzem kot kanal, ne kot dostavo brez naslova.
Po pošiljanju preverite KDS usmerjanje.
Paket označite z naročilom in časom.
Ob prihodu kupca preverite oznako, preden paket predate.
Plačilo in račun izvedite po sklopu 06.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8148e9083433 package=extended -->
### 17.5 Telefonska dostava

Naslov potrdite ob vsakem naročilu, tudi pri stalnem naročniku.
Potrdite kraj, kadar obstaja več enakih ulic.
Potrdite zvonec, vhod, nadstropje in varen kontakt.
Vnesite dogovorjeni čas dostave oziroma predvideno dostavo.
Preverite, ali sistem prikazuje strošek dostave.
Ne dodajajte stroška ustno brez postavke v naročilu.
Preverite način plačila pred odhodom kurirja.
Kurirju predajte samo paket z jasno oznako naročila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-69ee3e26c2fc package=extended -->
### 17.6 Statusi dostave

`priprava` pomeni, da paket še ni pripravljen za kurirja.
`pripravljeno` pomeni, da izdaja lahko preda paket kurirju.
`na_poti` pomeni, da je kurir prevzel paket.
`dostavljeno` pomeni fizično predajo na potrjenem naslovu.
`preklicano` pomeni, da se dostava ne bo nadaljevala in zahteva razrešitev naročila.
Statusi se posodabljajo ob dejanskem dogodku, ne vnaprej zaradi videza.
Čas statusa je pomemben pri pritožbi gosta in pri usklajevanju z ekipo.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-5ad48a786da2 package=extended -->
### 17.7 Neuspešna dostava

Kurir ne pušča paketa brez dogovorjene predaje.
Kurir poskusi stik po odobrenem postopku.
Kurir obvesti vodjo o nedosegljivem naslovu.
Vodja preveri telefonski kontakt in zapis navodil.
Ne označite `dostavljeno`, če paketa ni prejel upravičen prejemnik.
O nadaljnji prodaji, vračilu ali odpisu odloči odgovorna oseba.
Če je račun že izdan, se denarni del vodi po sledljivem postopku sklopa 06.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0dfc28329fd6 package=standard -->
### 17.8 Podvojeni telefonski profil

Najprej primerjajte normaliziran telefon.
Nato primerjajte potrjeno ime in aktualni naslov.
Preglejte, ali gre za skupno družinsko ali poslovno številko.
Ne združujte profilov med klicem, če niste za to pooblaščeni.
Izberite en potrjen profil za tekoče naročilo.
Vodji posredujte oba zapisa in razlog za čiščenje.
Po združitvi preverite, da zgodovina ni razlog za pošiljanje na star naslov.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-36b0aef43f10 package=lite -->
## 18. Dnevni kontrolni seznami

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8696c9fe3c12 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-1c5e876a4996 package=lite -->
### 18.2 Med konico

- [ ] Prednost določamo po času, hodu in obljubljenem prevzemu.
- [ ] Rdeče kartice preverjamo, ne samo odkljukamo.
- [ ] Spremembe se najprej sporočijo postaji.
- [ ] BUMP pomeni pripravljeno.
- [ ] ACK pomeni predano.
- [ ] To Go paketi niso pomešani z dostavo.
- [ ] Telefonski naslov se potrdi ob vsakem klicu.
- [ ] Negotova stanja se zapišejo z uro.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3ef35d0dc1d3 package=lite -->
### 18.3 Ob predaji izmene

- [ ] Preverjena so aktivna naročila.
- [ ] Preverjeni so HOLD hodi.
- [ ] Preverjeni so paketi, ki čakajo na prevzem.
- [ ] Preverjene so dostave na poti.
- [ ] Vodja prejme seznam KDS incidentov.
- [ ] Naslednja ekipa pozna zamude in posebne alergenske zahteve.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0287c254dee9 package=lite -->
## 19. Vaje in preverjanje znanja

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b81d5c4a8cef package=lite -->
### 19.1 Vaja usmerjanja

Vnesite juho za Kuhinjo, pico za Pice in pivo za Točilnico.
Naročilo pošljite v pripravo.
Na vsakem zaslonu poiščite samo njemu namenjeno postavko.
Na kartici z fallback opozorilom opišite dejanje osebja.
Pravilni odgovor: priprava se ne preusmeri ustno; vodja preveri nastavitev.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-760c42e193a9 package=lite -->
### 19.2 Vaja spremembe

Aktivna pica dobi zahtevo »brez oliv«.
Pica pove, da oliv še ni dodala.
Opišite zaporedje od klica do pregleda nove kartice.
Navedite, zakaj se starega naloga ne sme BUMP-ati kot pripravljenega.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-341ee32a9995 package=lite -->
### 19.3 Vaja QR klica

Gost z mize 12 pritisne klic natakarja.
Katero stanje najprej vidi ekipa?
Pravilni odgovor: `caka`.
Katero stanje izbere natakar ob sprejemu?
Pravilni odgovor: `potrjeno`.
Katero stanje izbere po obisku?
Pravilni odgovor: `zakljuceno`.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9d1d2a81885d package=lite -->
### 19.4 Vaja telefona

Klicatelj poda številko `041-123-456`.
V imeniku obstaja zapis `041 123 456`.
Ali ustvarite nov profil?
Pravilni odgovor: ne; najprej uporabite normalizirano iskanje in potrdite podatke.
Kateri naslov uporabite?
Pravilni odgovor: naslov, ki ga klicatelj izrecno potrdi za to naročilo.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-11d153a291f6 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9b75636262d2 package=lite -->
## 20. Nastavitev postaj in servisne različice

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-d4d535cdf9d4 package=lite -->
### 20.1 Podatki postaje

Postaja ima enoto, ime, tip in status aktivnosti.
Tip je `kitchen`, `pizza` ali `bar`.
Ime zaslona je operativna oznaka, ne pravilo usmerjanja artiklov.
ID postaje je tehnična povezava med nalogom in zaslonom.
Postaja mora pripadati isti enoti kot naročilo.
Neaktivna postaja ne sme biti cilj za novo pripravo.
Zaslon je lahko naročen na eno ali več postaj.
Naročnina zaslona ne spreminja vrste postaje.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ef0fec8f3450 package=lite -->
### 20.2 Pred odprtjem postaje

Vodja preveri napajanje zaslona.
Vodja preveri prijavo v pravo enoto.
Vodja preveri vidne postaje na zaslonu.
Vodja preveri čas naprave.
Vodja pošlje nadzorovano preskusno naročilo le po internem postopku.
Ekipa preveri, kam je usmerjena vsaka preskusna postavka.
Preskusno naročilo se odstrani samo po sledljivem testnem postopku.
Ne uporabljajte pravega gostovega naročila za preizkus postaje.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-053343462404 package=standard -->
### 20.3 Ločena kuhinja in pice

Profil ločenih postaj prikazuje Kuhinjo ločeno od Pic.
Kuhinja vidi naloge tipa `kitchen`.
Pice vidijo naloge tipa `pizza`.
Točilnica vidi naloge tipa `bar`.
Pica ne postane kuhinjski nalog zaradi podobnega imena artikla.
Kuhinja ne prevzame pice brez sistemsko določene izjeme.
Vodja odpravi napačno kategorijo artikla po servisu.
Med servisom ekipa uporabi dogovorjeni ročni prenos samo s sledjo v naročilu.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8f6d468a1ed5 package=standard -->
### 20.4 Združena kuhinja in pice

Profil `bar_combined_kitchen` združi `kitchen` in `pizza` na pogledu Kuhinja.
Naslov zaslona ostane Kuhinja tudi, kadar prikazuje pico.
Osebje še vedno bere tip in vsebino postavke.
Združitev zaslona ne pomeni, da ena oseba odgovarja za vse naloge.
Vodja določi fizični vrstni red peči in kuhinjske linije.
Pri konici se naročila ne filtrirajo ustno; uporabljajo se vidne oznake in hodi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e610daa84076 package=lite -->
### 20.5 Bar z ločeno pripravo hrane

Točilnica pripravi pijače in artikle, usmerjene na bar.
Kuhinja ne čaka na BUMP pijače, če hod zahteva samostojno predajo.
Natakar uskladi aperitiv z morebitno predjedjo.
Pijača za isto mizo ne dokazuje, da je glavna jed pripravljena.
Izdaja preveri vsebino paketa po postajah.
Pri dostavi se tekočine pakirajo po pravilih lokala, preden je nalog bumped.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-d0c342d7e9fb package=lite -->
### 20.6 Fallback usmerjanje

`uporabljenFallback` pomeni, da je bila uporabljena privzeta postaja.
To opozorilo ne pove, ali je izbrana postaja fizično pravilna.
Pripravljavec dokonča nalog le, če ga zna varno pripraviti.
Vodja zapiše artikel, kategorijo in dejansko postajo.
Administrator preveri pravilo artikla ali kategorije.
Popravek pravila se preskusi pred naslednjo konico.
Ne ponavljajte fallback opozorila z ustvarjanjem novega naročila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-db8ab494197e package=lite -->
## 21. Podroben časovni potek HOLD in FIRE

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a4ac3133f2e0 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9a48bf642771 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-aad3c7c6fe14 package=lite -->
### 21.3 Kaj FIRE ne naredi

FIRE ne zaključi računa.
FIRE ne spremeni cene postavke.
FIRE ne potrdi fizične predaje.
FIRE ne odpravi napačne postaje.
FIRE ne prekliče prejšnjega hoda.
FIRE ne zagotovi takojšnje priprave.
FIRE ne nadomesti telefonskega obvestila o posebni časovni zahtevi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0e17f679b730 package=lite -->
### 21.4 Kaj BUMP ne naredi

BUMP ne obvesti gosta samodejno.
BUMP ne potrdi plačila.
BUMP ne razveljavi HOLD drugih hodov.
BUMP ne pomeni, da je paket prevzel kurir.
BUMP ne pove, ali je jed na pravi mizi.
BUMP ne nadomesti preverjanja alergenske opombe.
BUMP ne izbriše dogodkovne zgodovine naloga.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c035524489f6 package=lite -->
### 21.5 Napačen FIRE

Natakar sproži sladico 20 minut prezgodaj.
Najprej takoj obvesti prizadeto postajo.
Postaja pove, ali priprave še ni začela.
Vodja odloči o dovoljenem popravku naročila.
Kartice se ne skrivajo ali brišejo ročno.
Natakar gostu poda realno informacijo o časovni spremembi.
Po incidentu ekipa preveri, zakaj je bil izbran napačen hod.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f39bda0f753e package=extended -->
### 21.6 Hodi pri To Go in dostavi

Hodi pri To Go se uporabljajo le, kadar lokal res streže v zaporedju.
Za običajen enkratni prevzem se ne ustvarja umetnih hodov.
Pri dostavi FIRE upošteva čas pakiranja in odhoda kurirja.
Sladice se ne FIRE-ajo prezgodaj, če bi izgubile kakovost.
Kurirjev čas prevzema se sporoči izdaji in pripravi.
Hod ni nadomestek za status dostave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e99c93caac67 package=extended -->
## 22. QR poti gosta in robni primeri

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-36c5880fab75 package=extended -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a8fdb5eefad9 package=extended -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-64a681a098bf package=extended -->
### 22.3 Pot gosta pri klicu natakarja

Gost izbere zahtevo za natakarja.
Sistem ustvari zahtevek v stanju `caka`.
Natakar odpre čakalno vrsto.
Natakar preveri številko mize in čas zahtevka.
Natakar označi zahtevek `potrjeno`.
Natakar obišče mizo.
Natakar označi zahtevek `zakljuceno`.
Če potrebuje gost nov obisk, ustvari nov zahtevek po običajni poti.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0a78e1813380 package=extended -->
### 22.4 Neveljavna ali manjkajoča QR identiteta

Gostu povejte, da je treba skenirati fizično kodo na lokaciji.
Ne zahtevajte, da gost pošilja povezavo drugemu gostu.
Preverite, ali je koda poškodovana ali zamenjana.
Preverite enoto in mizo v administraciji.
Gostu po potrebi pomaga natakar z običajnim naročilom.
Ne pripenjajte naročila na približno podobno mizo.
Po incidentu zamenjajte neveljavno fizično oznako po postopku lokala.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-268df61c7b8d package=extended -->
### 22.5 GPS ali Wi-Fi omejitev

QR meni lahko zahteva bližino ali lokalni Wi-Fi.
Gostu ne svetujte obhoda omejitve prek posredovane povezave.
Preverite, ali je gost dejansko na lokaciji enote.
Če preverjanje ni dovoljeno, naročilo prevzame osebje po običajnem kanalu.
Omejitev varuje povezavo naročila s pravilno lokacijo.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-5e6fd73a630d package=extended -->
### 22.6 Dvakrat kliknjena oddaja QR

Gost dvakrat pritisne oddajo zaradi počasnega telefona.
Osebje najprej poišče dve naročili po času in vsebini.
Ne pripravi obeh naročil, dokler ni stanje jasno.
Primerja identiteto mize, postavke in čas oddaje.
Vodja vodi dovoljen postopek za morebitni dvojnik.
Gostu se ne obljublja preklica plačila brez pregleda plačilnega stanja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-382c5bd6fa2c package=lite -->
## 23. Telefonski in dostavni scenariji

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3dccc7d74e74 package=lite -->
### 23.1 Nov klicatelj

Operater vpraša za telefonsko številko.
Operater številko vnese v običajnem zapisu.
Sistem poišče normalizirano vrednost.
Če profila ni, operater pridobi ime.
Operater pridobi samo potrebni naslov in kontakt.
Operater izbere prevzem ali dostavo.
Operater ponovi artikle, količine in čas.
Operater pošlje pripravo po potrditvi klicatelja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3e094ff38a9e package=lite -->
### 23.2 Stalni klicatelj z novim naslovom

Operater najde profil po telefonu.
Operater ne predpostavi starega naslova.
Operater vpraša, kam se dostavlja danes.
Operater vnese oziroma potrdi novi naslov.
Operater preveri zvonec in dostop.
Operater ponovi naslov brez nepotrebnega razkrivanja podatkov drugim.
Vodja uredi trajno spremembo profila po politiki zasebnosti.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b38ee59d057f package=lite -->
### 23.3 Klic se prekine

Operater ne pošlje nepopolnega naročila v pripravo.
Operater zapiše, kaj je potrjeno in kaj manjka.
Operater preveri, ali politika dovoljuje povratni klic.
Pri povratnem klicu najprej potrdi identiteto in vsebino.
Če klica ni mogoče dokončati, naročilo ostane neoddano oziroma se prekliče sledljivo.
Ne ugibajte naslova, načina plačila ali količine.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b8eb53dcb516 package=lite -->
### 23.4 Kurir prevzame paket

Izdaja preveri številko naročila.
Izdaja preveri število paketov in pijač.
Kurir preveri naslovno oznako.
Izdaja preda paket kurirju.
Šele nato se status spremeni na `na_poti`.
Kurir ne označi `dostavljeno` ob prevzemu iz lokala.
Kurir ob povratku poroča o neuspešni predaji.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-3e4dbf75eb7c package=lite -->
### 23.5 Kurir dostavi

Kurir preveri hišno številko in dogovorjena navodila.
Kurir preveri, da je paket za pravo naročilo.
Kurir izvede dogovorjeni način plačila po pravilih enote.
Kurir fizično preda paket.
Status spremeni na `dostavljeno` šele po predaji.
Če je potrebna izjema, obvesti vodjo pred označitvijo statusa.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9335cba76a86 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-81c6efcfb51d package=lite -->
## 25. Ocenjena vaja 05

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-01a1fc9af54a package=lite -->
### Naloga

Vnesite QR To Go naročilo z dvema picama in pijačo.
Pici dodelite drugi hod HOLD.
Pijačo pošljite v prvi hod na Točilnico.
Sprejmite QR zahtevek natakarju za drugo mizo.
FIRE-ajte pici po predaji prvega hoda.
Simulirajte izpad po BUMP ene pice.
Obnovite prikaz brez ustvarjanja druge priprave.
Telefonskemu gostu nato ustvarite dostavo z novim naslovom.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c1d320b98815 package=lite -->
### Merila ocene

Udeleženec prebere pravi kanal vsake postavke.
Udeleženec uporablja `caka`, `potrjeno`, `zakljuceno` v pravem zaporedju.
Udeleženec ne FIRE-a napačnega hoda.
Udeleženec zapiše številko in čas KDS incidenta.
Udeleženec potrdi naslov namesto kopiranja starega.
Udeleženec ne označi dostave kot končane pred fizično predajo.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-149b058c362b package=lite -->
## 26. Napredni operativni primeri priprave

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-4bd265aab6f2 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-86f1acf35252 package=lite -->
### 26.2 Deljena odgovornost med zasloni

Bar potrdi samo svoje pijače.
Pice potrdi samo svoje pice.
Kuhinja potrdi samo svoje kuhinjske jedi.
Izdaja ne spreminja BUMP v imenu pripravljavca.
Natakar ne označi ACK, dokler paketa ni prevzel.
Vodja ne uporablja skupnega zaslona za ugibanje stanja drugih postaj.
Če postaja manjka, se najprej preveri nastavitev in nato fizična možnost priprave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-940e59e8db6a package=standard -->
### 26.3 Manjkajoča KDS postaja

POS je poslal naročilo, na pričakovanem zaslonu pa ni kartice.
Operater preveri številko naročila in usmerjen tip artikla.
Vodja preveri, ali je postaja aktivna in pripada isti enoti.
Vodja preveri, ali je zaslon naročen na to postajo.
Ekipa ne pošlje istega naročila še enkrat.
Če je varno, vodja določi dokumentirano ročno pripravo za prizadeto postavko.
Po obnovi se preveri, ali se je prvotni nalog pojavil.
Če se pojavi, se prepreči druga fizična priprava.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-471cc2c6fa3a package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-c852471418ba package=lite -->
### 26.5 Pozna kartica po ponovni povezavi

Kartica se lahko pokaže po osvežitvi zaslona.
Pozna kartica ni novo naročilo.
Ekipa primerja ID naloga in postavko z zapisom incidenta.
Če je jed že pripravljena, se ne začne znova.
Če je jed še nepripravljena, vodja določi prednost glede na obljubljeni čas.
Natakar dobi obvestilo o dejanski zamudi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f481ea4a1c02 package=lite -->
## 27. Časovno usklajevanje in pairing

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-fa553a904ec1 package=lite -->
### 27.1 Pairing skupina

`pairingGroupId` povezuje postavke istega večhodnega QR poteka.
Skupina pomaga prepoznati, katere postaje morajo dobiti isti sproščeni hod.
Ni identifikator gosta ali plačila.
Ne primerjajte pairing skupin različnih naročil.
Pred FIRE preverite naročilo, številko hoda in skupino.
Po FIRE preverite aktivne postavke na vseh zahtevanih postajah.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-dbbb3182d08f package=lite -->
### 27.2 Časovni cilj hoda

Natakar določi želeni trenutek strežbe.
Kuhinja oceni čas priprave glavne jedi.
Pice sporočijo čas peči.
Bar oceni čas priprave pijače.
Izdaja uskladi končno sestavljanje.
Če ena postaja zamuja, se ne BUMP-a druge kot da je cel hod pripravljen.
Natakar odloči o predaji ločenih delov samo po dogovoru z gostom.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a4e77a090edc package=lite -->
### 27.3 Zakasnjena jed

Kuhinja odkrije, da sestavine niso pripravljene.
Kuhinja navede številko naročila in realno zamudo.
Natakar obvesti gosta.
Vodja odloči o nadomestku samo po potrditvi gosta in evidenci v POS.
Stara postavka se ne pusti tiho v aktivnem stanju.
Nova postavka se ne naredi, dokler ni usklajen popravek.
Izdaja označi, ali je paket nepopoln ali čaka na jed.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a5198e123ea4 package=lite -->
### 27.4 Delna predaja

Gost želi pijačo takoj, glavna jed pa čaka.
Bar BUMP-a pijačo.
Natakar fizično prevzame pijačo.
Izdaja ne sklepa, da je glavna jed predana.
Kuhinja ohrani svojo aktivno postavko.
Natakar gostu razloži ločeno predajo.
Celotno naročilo se ne zaključi v pripravi samo zaradi prve predaje.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-fb5686f263c0 package=lite -->
## 28. Dialogi vlog v konici

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-293f1fef0f1a package=lite -->
### 28.1 Sprememba pice

Natakar: »Naročilo 612, pica, brez gob; ali je še mogoče?«
Pice: »612 še ni v peči; spremembo lahko izvedemo.«
Natakar: »Spremembo vnašam v naročilo; preveri novo kartico.«
Pice: »Nova kartica potrjena.«
Vodja posreduje, če se pojavita stara in nova kartica.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0e9de2cdfe71 package=lite -->
### 28.2 Neviden nalog

Kuhinja: »Naročila 613 ne vidim na Kuhinji.«
Natakar: »Postavka je poslana kot kuhinjska; ne pošiljam znova.«
Vodja: »Preverjam postajo, zaslon in enoto; zapišite čas.«
Kuhinja: »Fizična priprava še ni začeta.«
Vodja: »Po obnovi preverimo prvotni nalog pred začetkom.«

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-eb4c06f3840e package=lite -->
### 28.3 Čakajoč kurir

Kurir: »Prevzem 614 čaka; odhod je ob 19:10.«
Izdaja: »Pica je bumped, pijača je še na Baru.«
Bar: »Pijača bo pripravljena čez dve minuti.«
Vodja: »Kurir ne prevzame nepopolnega paketa brez dogovora.«
Izdaja: »Status ostane priprava, dokler paket ni predan.«

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a86ec2eca074 package=extended -->
## 29. Več naprav in varstvo naročila QR

Gost lahko odpre meni na več napravah.
Več naprav ne pomeni več miz.
Osebje preveri identiteto QR naprave in čas naročila.
Gostu ne dovolite, da zamenja mizo samo z deljenjem povezave.
Če dve napravi oddasta enako košarico, obravnavajte možnost dvojnika.
Pred pripravo primerjajte čas, postavke in mizo.
Klic natakarja z druge naprave se obravnava po mizi in času.
Zahtevek ne razkrije drugim gostom podatkov prve naprave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e828e17e87ba package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-977d2fa4191c package=lite -->
## 31. Paketi študij primerov za servis

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e662ef97cf8a package=extended -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a03dbedfa2b8 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b5790dfe349f package=extended -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-99159977311f package=extended -->
### 31.4 Dogodek: serijski prevzem

Dogodek uporablja več To Go naročil v kratkem času.
Vsak paket dobi številko naročila in kratko oznako prevzema.
Izdaja razporedi pakete po jasnem fizičnem zaporedju.
Kuhinja BUMP-a samo dokončane pakete.
Bar ne odlaga pijač med pakete brez oznake.
Gost ob prevzemu pove oznako.
Osebje primerja oznako, številko in število paketov.
Opazovalec zabeleži vsako predajo brez preverjanja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0385845ae366 package=lite -->
## 32. Obrazci predaje in primerjave stanj

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-0f8ddeef367e package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-cf93b31b4108 package=extended -->
### 32.2 Primerjava KDS, QR in telefona

| Vir | Primarni status | Kaj potrjuje | Kaj ne potrjuje |
| --- | --- | --- | --- |
| KDS | aktivno/bumped/ack | izvedba priprave | plačilo |
| QR naročilo | oddano | zahtevo gosta | fizično predajo |
| QR klic | caka/potrjeno/zakljuceno | servisni zahtevek | naročilo hrane |
| telefon | profil/naročilo | dogovorjene podatke | aktualni naslov brez potrditve |
| dostava | na_poti/dostavljeno | logistično predajo | fiskalni status |

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-8e31b1c998ca package=lite -->
### 32.3 Opazovalni seznam

- [ ] Udeleženec pred pripravo prebere kanal in številko naročila.
- [ ] Udeleženec pri spremembi najprej pokliče postajo.
- [ ] Udeleženec preveri fizično stanje pred ponovitvijo BUMP.
- [ ] Udeleženec uporabi FIRE samo za pravi hod.
- [ ] Udeleženec sprejme QR klic pred zaključkom.
- [ ] Udeleženec potrdi naslov telefonske dostave.
- [ ] Udeleženec predaja paket šele po primerjavi oznake.
- [ ] Udeleženec eskalira manjkajočo postajo brez dvojne oddaje.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ad53368b1281 package=lite -->
## 33. Časovno vodene vaje

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-81d50c3d7ade package=lite -->
### 33.1 Vaja 90 sekund: FIRE

Trener pokaže naročilo s tremi hodi.
Udeleženec ima 90 sekund za identifikacijo naslednjega hoda.
Udeleženec pove številko naročila, hod in postaje.
Udeleženec navede, kaj bo preveril po FIRE.
Točka se ne dodeli, če udeleženec zamenja BUMP in ACK.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-455c217721e6 package=lite -->
### 33.2 Vaja 120 sekund: manjkajoči zaslon

Trener skrije kartico s pričakovane postaje.
Udeleženec ima dve minuti za prvih pet dejanj.
Pričakovano: zapiše naročilo, postajo, čas in fizično stanje.
Pričakovano: preveri enoto, postajo in naročnino zaslona.
Kritična napaka je ponovno pošiljanje naročila brez preveritve.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b3f2efa70183 package=lite -->
### 33.3 Vaja 180 sekund: telefonska dostava

Trener poda stare podatke profila in nov naslov.
Udeleženec mora potrditi aktualni naslov.
Udeleženec mora izbrati dostavo in predvideni čas.
Udeleženec mora ponoviti artikle, strošek in plačilni dogovor.
Točke se odvzamejo za kopiranje starega naslova brez vprašanja.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-942f06441bc4 package=lite -->
## 34. Preverjanje kompetenc in utemeljitev

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-9c51755a93be package=lite -->
### Vprašanje 1

Zakaj se BUMP ne ponovi samo zato, ker se zaslon ni osvežil?
Odgovor: ker je lahko tehnični dogodek uspel, fizična jed pa je že pripravljena.
Utemeljitev: idempotentnost zahteve ne prepreči dvojne fizične priprave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-7e2a4a22f97e package=lite -->
### Vprašanje 2

Kaj primerjate pred predajo QR To Go paketa?
Odgovor: oznako prevzema, številko naročila, artikle in količino.
Utemeljitev: QR oddaja ne dokazuje, kdo paket prevzema.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-64f0e011cc73 package=lite -->
### Vprašanje 3

Kdaj je dostava `na_poti`?
Odgovor: po fizičnem prevzemu paketa kurirja.
Utemeljitev: pripravljena hrana na polici še ni na poti.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-64c8647b0f39 package=lite -->
### Vprašanje 4

Kaj naredite z novim QR naročilom, ki je videti kot dvojnik?
Odgovor: primerjate mizo, čas, identiteto in postavke pred pripravo.
Utemeljitev: dvojni klik gosta ni razlog za dve pripravi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-b0c075176046 package=lite -->
### Vprašanje 5

Kaj je dokaz, da je gost prejel jed?
Odgovor: fizična predaja in ustrezen ACK, kadar je izdaja omogočena.
Utemeljitev: BUMP je dokaz priprave, ne predaje.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-38a444f27fa3 package=lite -->
## 35. Banka trenerjevih vprašanj

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a8e1d3f6caad package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-d19e7a342343 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-99806d7976f5 package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-e29f593991ac package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-f90bc3e4d13d package=lite -->
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

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-a8ca3fdc7cde package=extended -->
## 37. QR zgodovina, povratne informacije in pomoč gostu

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-dc21a7f7c280 package=extended -->
### 37.1 Zgodovina naročil na napravi gosta

Zgodovina je vezana na isto QR napravo oziroma brskalnik, ne na osebni račun
gosta. Gost jo lahko odpre samo po uspešni aktivaciji QR lokacije in po
izrecni izbiri **Vklopi zgodovino**.

Privzeto je zgodovina izklopljena. Če gost soglasja ne izbere oziroma pošlje
`historyOptIn=false`, strežnik vrne prazno zgodovino. Osebje zato ne sme
sklepati, da je gostova prejšnja vsebina naročil vidna ali da jo lahko poišče
po imenu gosta.

Zgodovina prikazuje povzetke naročil na tej napravi, na primer stanje, čas
nastanka in število postavk. Ne uporablja se kot dokaz plačila, identitete gosta
ali fizičnega prevzema. Pri izgubljeni oziroma potekli QR seji mora gost QR
znova odpreti in lokacijo ponovno potrditi.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-ecaa2356fd83 package=extended -->
### 37.2 Gostujoči AI pomočnik

Gostujoči pomočnik je na voljo samo v aktiviranem QR meniju in samo, kadar je
za enoto vključena nastavitev **qrAiAsistentAktiven**. Če nastavitev ni
vključena, gostu ne obljubljajte AI pomoči; uporabite običajni klic natakarja.

Pomočnik lahko odgovarja o:

- artiklih, cenah in razpoložljivosti,
- vinih in drugih podatkih, ki so v javnem meniju,
- trenutni čakalni dobi oziroma aktivnih pripravljalnih nalogih,
- povzetku zgodovine, vendar samo po izrecnem soglasju za zgodovino.

Pomočnik ni kanal za rezervacijo mize, spletni nakup bona, plačilo ali
spremembo naročila. Ne sme izmišljati artikla, cene, razpoložljivosti ali
čakalnega časa. Pri neznanem vprašanju mora uporabiti varni odgovor in gosta
usmeriti k natakarju.

Pri tehnični napaki, potekli lokacijski seji ali izklopljenem pomočniku:

1. gostu povejte, da pomočnik trenutno ni na voljo;
2. ne zahtevajte ponavljanja osebnih podatkov v javnem klepetu;
3. za servis uporabite **Pokliči natakarja**;
4. naročilo vnesite ali popravite v POS po običajnem postopku.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-034ba1ab9843 package=extended -->
### 37.3 Klic natakarja

Klic natakarja ni naročilo in ni dokaz, da je natakar že obiskal mizo.

1. Gost pritisne **Pokliči natakarja**.
2. Sistem ustvari zahtevek v stanju `caka`.
3. Natakar preveri enoto, mizo, QR napravo in čas zahtevka.
4. Po sprejemu označi zahtevek `potrjeno`.
5. Po dejanskem obisku mize označi zahtevek `zakljuceno`.

Če je zahtevek že odprt, ponovni klik ne ustvarja novega obiska. Če gost
ponovno potrebuje pomoč po zaključku, ustvari nov zahtevek. Pri nujni zadevi
uporabite običajni klic osebja, ker periodično osveževanje čakalne vrste ni
zagotovilo takojšnje obravnave.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-dc7f7eb187b1 package=extended -->
### 37.4 Povratna informacija po zaključenem naročilu

Povratna informacija je mogoča šele, ko je QR naročilo zaključeno, in samo za
napravo, ki je naročilo ustvarila. Za eno naročilo je dovoljena največ ena
oddaja.

Gost lahko oceni:

- hrano in pijačo,
- ambient,
- postrežbo,
- posamezne postavke, kadar jih želi oceniti,
- neobvezni komentar.

Pred oddajo mora izbrati soglasje, da lokal oceno anonimno obdela za izboljšanje
storitev. Soglasje ni dokaz plačila in ne spremeni naročila, računa ali
fiskalizacije.

Če naročilo še ni zaključeno, če QR seja ni več veljavna, če ocena pripada
drugemu naročilu ali je bila že oddana, sistem oddajo zavrne. Osebje ne
ustvarja povratne informacije namesto gosta in ne poskuša ponoviti oddaje z
drugim QR identifikatorjem.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-6636bb5f8fa5 package=extended -->
### 37.5 Česa javni QR meni ne podpira

Javni QR meni podpira pregled ponudbe, QR naročilo, To Go, klic natakarja,
ločeno QR napitnino, povratno informacijo in – če je vklopljen – omejenega
gostujočega AI pomočnika. Ne podpira pa:

- javne internetne rezervacije miz,
- spletnega nakupa darilnega bona,
- Stripe Checkout oziroma Stripe spletnega plačila.

Če gost zahteva eno od teh funkcij, mu ne obljubljajte izvedbe prek QR menija.
Uporabite potrjen notranji POS postopek ali povejte, da funkcija trenutno ni
na voljo. Plačilo in fiskalizacija QR naročila se še vedno obravnavata po
sklopu 06; oddaja QR naročila sama po sebi ni dokaz plačila.

<!-- pos-heading: id=pos-05-pripravljena-hrana-qr-telefon-337eca592841 package=extended -->
### 37.6 Kontrola pred objavo QR menija

- [ ] QR koda je vezana na pravo enoto in po potrebi pravo mizo.
- [ ] Poskusna aktivacija je izvedena z dejanskim telefonom.
- [ ] Testno naročilo je ločeno od naročila gosta in sledljivo odstranjeno.
- [ ] To Go ima jasen kanal in oznako prevzema.
- [ ] Klic natakarja se pojavi v stanju `caka`.
- [ ] Zgodovina je privzeto izklopljena in zahteva izrecno soglasje.
- [ ] Gostujoči AI je objavljen samo, če je nastavitev za enoto vključena.
- [ ] Povratna informacija je vidna šele po zaključenem naročilu.
- [ ] Gostu niso obljubljene internetne rezervacije, spletni boni ali Stripe.
