# 01 Dostop in priprava sistema

## 1. Namen, meje poglavja in odgovornost

To poglavje opisuje varen dostop do POS Gostinstvo in preverjanje delovnega konteksta.

Namenjeno je natakarjem, vodjem enot, administratorjem enot in skrbnikom sistema.

Ne opisuje sprejema naročil, zaključevanja računov ali postopka odprtja izmene.

En sam avtoritativni postopek za odprtje izmene je v poglavju 02.

Uporabnik odgovarja, da pred delom preveri svojo identiteto, podjetje, enoto, blagajno in napravo.

Sistem ne sme nadomestiti presoje, ali oznake na zaslonu ustrezajo prostoru, v katerem uporabnik stoji.

Če kateri koli podatek ni jasen, je varen ukrep ustavitev pred prvim poslovnim vnosom.

### 1.1 Delovni kontekst

**Podjetje** je poslovni subjekt, pod katerim se vodijo uporabniki, nastavitve in evidence.

**Enota** je poslovalnica podjetja.

**Blagajna** je prodajno oziroma evidenčno mesto v enoti.

**Poslovni prostor** je oznaka, vezana na blagajno in fiskalni kontekst.

**Naprava** je brskalnik oziroma delovna naprava, ki se ob uporabi prijavi s svojim ključem.

**Miza** je del tlorisa aktivne enote.

**Seja** povezuje prijavo v prijavni storitvi in dostop do POS podatkov.

Vsi ti podatki so različni.

Pravilno podjetje ne dokazuje pravilne enote.

Pravilna enota ne dokazuje pravilne blagajne.

Pravilna blagajna ne pomeni, da naprava vidi vse mize.

### 1.2 Minimalni predpogoji

Uporabnik mora imeti aktiven račun.

Račun mora biti povezan z veljavno uporabniško vlogo v POS.

Vloga mora imeti dodeljeno podjetje.

Za delo na prodajnem mestu morata biti dodeljeni enota in blagajna oziroma dovoljena izbira.

Naprava potrebuje povezavo, kadar mora pridobiti sejo, kontekst ali podatke.

Na fizičnem mestu morajo biti pripravljeni predpisani tiskalnik in plačilni terminal, če se uporabljata.

Tloris, artikli in prostori morajo biti urejeni pred prvim naročilom v novi enoti.

### 1.3 Kaj ni dokaz pripravljenosti

Odprt zavihek v brskalniku ni dokaz prijavljenega pravega uporabnika.

Ime lokala v naslovu strani ni dokaz izbrane enote.

Vidna miza ni dokaz, da je miza dovoljena tej napravi.

Uspešno tiskanje starega potrdila ni dokaz povezave trenutnega terminala.

Prikaz prejšnjega uporabnika ni dovoljenje za delo v njegovem imenu.

Samodejno obnovljen zaslon po osvežitvi ni dokaz, da je nedokončano dejanje shranjeno.

## 2. Prijava in življenjski cikel seje

### 2.1 Prijavni tok

POS uporablja prijavno storitev Clerk.

Uporabnik se prijavi s svojim službenim računom in predpisanim načinom preverjanja identitete.

Po uspešni prijavi POS pridobi prijavni žeton.

Nato POS zahteva podatke o svojem uporabniku.

Ti podatki določijo vlogo, podjetje, enoto, blagajno, natakarja in dovoljene enote.

Dokler se ti podatki nalagajo, uporabnik ne sme sklepati, da je pripravljen za prodajo.

Če prijavna storitev potrdi identiteto, POS pa uporabnika zavrne, prijava v POS ni veljavna.

### 2.2 Kaj uporabnik vidi

Med nalaganjem je stanje prijave še v preverjanju.

Po uspešnem preverjanju je POS pripravljen za uporabo.

Ob odjavi je uporabnik vrnjen na prijavni vstop.

Ob nepooblaščenem dostopu POS zahteva ponovno preverjanje identitete.

Ob prepovedanem dostopu ima identiteta sejo, vendar zanjo ni veljavne POS-dodelitve.

Ob napaki dostopa ni dovoljeno nadaljevati z domnevo, da bo kasnejši klik popravil stanje.

### 2.3 Varna prijava

1. Odprite uradni naslov POS Gostinstvo na odobreni napravi.
2. Preverite, da ne uporabljate zasebnega ali neznanega brskalniškega profila.
3. Vnesite svoje prijavne podatke.
4. Dokončajte dodatno preverjanje, kadar ga zahteva prijavna storitev.
5. Počakajte, da se naloži POS in stranska navigacija.
6. Preverite prikaz uporabnika.
7. Preverite podjetje, enoto in blagajno.
8. Šele nato odprite delovni zaslon.

Gesla ne zapisujte ob blagajni.

Gesla ne delite s sodelavcem, tudi kadar je gneča.

Brskalnik ne sme shraniti gesla na napravi, ki jo uporablja več oseb.

### 2.4 Neuspešna prijava

| Znak | Verjeten pomen | Varen ukrep |
|---|---|---|
| Prijavna stran zavrne podatke | napačen podatek ali zaklenjen račun | preverite identifikator; po več poskusih se obrnite na skrbnika |
| Prijava uspe, POS pa ostane brez vsebine | podatki o POS-vlogi se še nalagajo ali niso dosegljivi | počakajte kratek čas; ne odpirajte več zavihkov |
| Prijava uspe, nato sledi zavrnitev | račun nima veljavne POS-dodelitve | skrbniku sporočite ime uporabnika in prikazano stanje |
| Prijava se ponavlja v krogu | težava seje ali brskalniških podatkov | zaprite zasebne zavihke, odjavite se in uporabite odobreni profil |
| Prikaže se drug uporabnik | v napravi je ostala tuja seja | takoj se odjavite; ne odpirajte miz |

Pri prijavi ne ugibajte množice različic gesla.

Zaporedni neuspešni poskusi lahko sprožijo zaščito računa.

Skrbniku posredujte čas, napravo in točno besedilo opozorila.

Ne posredujte gesla ali prijavnega žetona.

### 2.5 Obnova žetona in zahteva 401

Prijavna storitev lahko žeton seje obnovi brez uporabnikovega posega.

POS zato za običajne zahteve uporablja obstoječi žeton.

Ob odgovoru, da dostop ni potrjen, POS poskusi pridobiti svež žeton in preveri identiteto.

Če je odgovor prehoden, se aktivni podatki ponovno naložijo.

Če je dostop potrjeno zavrnjen, POS odstrani podatke uporabnika in predpomnjene poizvedbe.

Omrežna napaka sama po sebi ne pomeni odjave.

Zato se odprt obrazec ob prehodni napaki ne sme šteti za izgubljen ali potrjen.

Uporabnik preveri njegov dejanski rezultat, preden dejanje ponovi.

### 2.6 Iztek seje med delom

Če POS zahteva ponovno prijavo, ustavite nadaljnje klike.

Zapišite številko mize, naročila ali računa, ki je bil odprt.

Ponovno se prijavite s svojim računom.

Preverite celoten kontekst, ker se lahko po prijavi naloži druga shranjena izbira.

Odprite evidenco ali mizo in poiščite rezultat zadnjega dejanja.

Dejanja ne ponovite samo zato, ker prejšnji zaslon ni več viden.

Pri plačilu posebej preverite, ali je bil račun že ustvarjen ali je plačilni terminal že sprejel znesek.

### 2.7 Odjava

Odjava prek uporabniškega menija odstrani lokalno izbiro enote.

Odjava prekine tudi sejo prijavne storitve.

Po odjavi POS uporabnika vrne na glavni prijavni naslov.

Na skupni napravi se odjavite ob vsakem odhodu od pulta.

Zaklep zaslona ni zamenjava za odjavo, kadar lahko napravo uporabi druga oseba.

Pred odjavo zaključite ali varno predajte odprte postopke v skladu z delovnimi pravili.

## 3. Zaslon, navigacija in stanja

### 3.1 Orientacija po prijavi

Stranska navigacija je osnovni zemljevid POS.

Na večjih zaslonih prikazuje glavne module in podatke uporabnika.

Na manjših zaslonih so dodatne možnosti v meniju »Več«.

Spodnja oziroma glavna navigacija praviloma vsebuje Mize, Blagajna, Izmene in Računi.

Viden seznam ni obljuba, da je posamezna funkcija dovoljena za trenutno enoto.

### 3.2 Pomen glavnih zaslonov

| Zaslon | Namen | Preverjanje pred uporabo |
|---|---|---|
| Mize | pregled tlorisa in odprtih miz | enota in prostor ustrezata fizičnemu lokalu |
| Blagajna | blagajniško delo | izbrana je prevzeta blagajna |
| Izmene | pregled in vodenje izmen | uporabnik pozna status izmene |
| Računi | iskanje in pregled računov | filtri se nanašajo na pravo enoto |
| Kuhinja | delovni nalogi kuhinje | kuhinjska postaja ustreza organizaciji enote |
| Točilnica | nalogi za pijačo | zaslon ni zamenjan s kuhinjo |
| Izdaja | predaja pripravljene hrane | funkcija je v enoti omogočena |
| Nastavitve | administrativna ureditev | spremembe izvaja pooblaščena oseba |

Naslov brskalnika se prilagodi trenutno odprtemu modulu.

Naslov je pomoč pri orientaciji, ne pa nadomestilo za kontrolo poslovnega konteksta.

### 3.3 Stanja nalaganja

Prazen prostor med nalaganjem ne pomeni, da ni podatkov.

Vrteči se kazalnik pomeni, da zahteva še ni končana.

Onemogočen gumb pomeni, da POS preprečuje nedovoljen ali nepopoln korak.

Opozorilni trak zahteva branje, preden uporabnik nadaljuje.

Uspešno obvestilo potrjuje posamezno dejanje, ne celotne pripravljenosti za delo.

Rdeče obvestilo je razlog za preverjanje posledice, ne ukaz za takojšnje ponavljanje klika.

### 3.4 Funkcije, odvisne od profila enote

Enota ima profil gostinske dejavnosti in nabor omogočenih funkcij.

Zato se lahko navigacija med enotama razlikuje.

Primeri dodatnih modulov so pripravljena hrana, odpadki s krožnikov, zaloge, rezervacije in dogodki.

Ločena stran za pice se prikaže samo pri ustreznem profilu kuhinjskih postaj.

Stran Izdaja se prikaže, kadar je v enoti omogočeno usmerjanje priprave.

Če uporabnik ročno odpre pot, za katero enota nima pravice, POS pokaže opozorilo in ga usmeri v Nastavitve.

Ne poskušajte zaobiti omejitve z zaznamkom, starim naslovom ali drugim zavihkom.

### 3.5 Vloga in navigacija

Superadministrator vidi administrativne poti, ki niso namenjene običajnemu delu lokala.

Administrator in administrator enote imata dostop do nastavitev v okviru svojih pravic.

Uporabnik z vlogo »uporabnik« dela v dodeljenem okviru.

Odsotnost gumba je lahko posledica vloge ali funkcij enote.

Ne pomeni nujno napake.

V primeru dvoma najprej preverite vlogo in aktivno enoto, nato se obrnite na skrbnika.

## 4. Podjetje, enota in blagajna

### 4.1 Podjetje

POS ob prijavi dobi podjetje iz uporabnikove dodelitve.

Podjetje se uporablja tudi za uskladitev poslovnega konteksta med moduli istega izvora.

Uporabnik ne sme sklepati, da je podjetje pravilno zgolj zato, ker uporablja poznano napravo.

Pri delu za dve pravni osebi preverite naziv podjetja pred vsako menjavo okolja.

Če je podjetje napačno, ne ustvarjajte testnega naročila za preverjanje.

Odjavite se in naj skrbnik preveri dodelitev.

### 4.2 Enota

Enota določa, katere mize, profil in funkcije POS uporablja.

Za običajnega uporabnika je enota dodeljena z vlogo.

Za administratorja lahko POS uporabi shranjeno izbiro enote.

Če shranjena izbira ni med dovoljenimi enotami, jo POS odstrani in uporabi prvo dovoljeno enoto.

Zato je po vsaki prijavi administratorja obvezna vidna kontrola enote.

Sprememba enote ponovno registrira napravo za novi kontekst.

### 4.3 Menjava enote pri pooblaščenem uporabniku

1. V navigaciji odprite izbirnik enote.
2. Izberite enoto, v kateri dejansko opravljate delo.
3. Počakajte, da se osvežijo podatki in navigacija.
4. Preverite ime enote v prikazu uporabnika.
5. Preverite aktivno blagajno.
6. Ponovno odprite Mize šele po potrjeni osvežitvi.

Menjava enote ni primerna med nejasnim stanjem plačila ali shranjevanja naročila.

Najprej ugotovite rezultat dejanja v izvorni enoti.

Šele nato preklopite.

### 4.4 Blagajna

Aktivna blagajna se hrani kot lokalna izbira za vloge, ki smejo izbirati.

Pri vlogi »uporabnik« POS vedno uporabi dodeljeno blagajno.

Tak uporabnik lokalne izbire ne more spremeniti.

To preprečuje prodajo na blagajni sodelavca.

Ime blagajne in oznaka poslovnega prostora sta prikazana med podatki uporabnika.

Če blagajna ni dodeljena, POS pokaže opozorilo.

Če poslovni prostor ni dodeljen, POS pokaže ločeno opozorilo.

Opozorila ne preskočite z začetkom prodaje.

### 4.5 Kontrola konteksta pred delom

Preberite prikazano ime enote.

Preberite oznako poslovnega prostora.

Preberite ime blagajne.

Primerjajte jih s fizičnim pultom in oznakami organizacije.

Pri skupnem terminalu preverite tudi osebo, ki je prijavljena.

Če je katera oznaka prazna, ne nadaljujte s prodajnim dejanjem.

Če oznaka ni skladna, pokličite vodjo izmene ali administratorja.

### 4.6 Primer: natakar z eno enoto

Nina je natakarica v enoti »Mestni trg«.

Po prijavi vidi samo svojo dodeljeno enoto.

V stranskem prikazu vidi poslovni prostor in svojo blagajno.

Izbirnik blagajne ni na voljo, ker je blagajna fiksno dodeljena.

Nina ne poskuša odpreti blagajne kolega.

Če ji prikaz manjka, ne prevzame naročil.

### 4.7 Primer: vodja dveh enot

Marko je administrator dveh enot istega podjetja.

Dopoldne ureja meni v enoti »Center«.

Popoldne preverja postavitev miz v enoti »Jezero«.

Pred preklopom zaključi urejanje ali zavrže neveljavne spremembe.

Po preklopu preveri, da so se spremenili profil, navigacija in tloris.

Ne uporablja starega zavihka z mizami kot dokaz, da je že v novi enoti.

### 4.8 Primer: dve podjetji

Administratorka dela za dve ločeni podjetji.

V enem brskalniku ostane lahko nastavitev iz druge poslovne aplikacije istega izvora.

POS ob prijavi uskladi podjetje s trenutno razrešenim POS-uporabnikom.

Kljub temu administratorka preveri naziv podjetja pred urejanjem podatkov.

Za sočasno delo uporablja ločena odobrena brskalniška profila le, če to dovoljuje notranja politika.

Nikoli ne prenaša nastavitev ali računov med podjetjema na podlagi podobnega imena lokala.

## 5. Naprava in obseg miz

### 5.1 Ključ naprave

POS za brskalnik ustvari ključ naprave in ga shrani lokalno.

Ključ ni ime uporabnika.

Ključ ni nadomestilo za prijavo.

Naprava se ob prijavi in znani enoti prijavi pri strežniku.

Ob prijavi pošlje svoj ključ in prepoznano ime naprave.

Ime je lahko na primer iPad, Android naprava, Windows naprava ali Mac naprava.

Skrbnik napravo prepozna po imenu, ključu in enoti.

### 5.2 Podatki naprave

Za prijavljeno napravo so lahko nastavljeni plačilni terminal, tiskalnik in dovoljenje miz.

Naprava pripada eni enoti.

Naprava lahko vsebuje seznam dovoljenih miz.

Tak seznam je omejitev delovne postaje, ne osebna pravica uporabnika.

Če dve tablici stojita v istem lokalu, lahko vidita različen nabor miz.

To je običajno pri ločenih terasah, vrtovih ali strežnih conah.

### 5.3 Obseg miz

Najprej preverite izbrano enoto.

Nato preverite prostor na tlorisu.

Če pričakovane mize ni, ne ustvarjajte nove mize.

Preverite, ali ste na pravi napravi.

Preverite, ali ima naprava omejen seznam dovoljenih miz.

Preverite, ali je miza v drugem prostoru ali enoti.

Šele nato prosite administratorja za spremembo nastavitev naprave.

### 5.4 Prvi zagon na novi napravi

1. Uporabite odobren brskalnik in službeni uporabniški profil.
2. Prijavite se s svojim računom.
3. Počakajte na nalaganje uporabnika in enote.
4. Počakajte na prijavo naprave.
5. Vodji sporočite prepoznano ime naprave, če jo mora poiskati v nastavitvah.
6. Ne predvidevajte, da ima nova naprava nastavljene mize, tiskalnik ali terminal.
7. Preverite prikaz tlorisa brez poslovnega vnosa.
8. Za funkcionalni preizkus uporabite odobren interni postopek, ne dejanske prodaje.

### 5.5 Predpomnjeni podatki naprave

POS lahko zadnje znane podatke naprave lokalno predpomni.

Predpomnjeni podatek pomaga pri prikazu, ne zagotavlja pa trenutne veljavnosti.

Po spremembi enote POS napravo ponovno prijavi.

Če se podatki naprave ne osvežijo, uporabnik ne sme sklepati, da stare omejitve veljajo v novi enoti.

Zabeležite čas, enoto in ime naprave.

Skrbnik naj preveri registracijo in konfiguracijo.

### 5.6 Tiskalnik in terminal

Konfiguracija naprave lahko vsebuje podatke o lokalnem tiskalniku.

Lahko vsebuje nastavitve omrežnega tiskalnika, širine papirja ali tiskalniškega posrednika.

Lahko vsebuje nastavitve plačilnega terminala.

Podprte nastavitve niso dokaz, da je fizična povezava trenutno dosegljiva.

Pred prvo uporabo preverite papir, napajanje in kabelsko oziroma omrežno povezavo po lokalnem postopku.

Ne spreminjajte nastavitev terminala na podlagi poskusa gosta.

### 5.7 Naprava, ki jo uporablja več oseb

Uporabniki se ne izmenjujejo v isti prijavi.

Ob menjavi osebe se prejšnja oseba odjavi.

Nova oseba se prijavi s svojo identiteto.

Naprava lahko ostane ista; uporabniška sled mora biti drugačna.

Če je naprava na javno dostopnem mestu, jo fizično zavarujte pred nepooblaščeno uporabo.

Ob odhodu ne puščajte odprte strani Mize ali Blagajna.

## 6. Omrežje, osvežitev in ponovna povezava

### 6.1 Razlika med zaslonom in strežnikom

Zaslon lahko kaže zadnje znano stanje.

Uspeh poslovnega dejanja se potrdi šele po odgovoru sistema.

Izpad povezave med klikom in odgovorom ustvari negotovost.

V negotovosti uporabnik ne sme sklepati iz videza gumba.

Najprej preveri evidenco, nato se odloči o naslednjem koraku.

### 6.2 Osvežitev strani

Osvežitev ponovno naloži aplikacijo in podatke seje.

Ne shranjuje samodejno vsebine nedokončanega obrazca.

Pred osvežitvijo si zapišite mizo, številko dokumenta in fazo postopka.

Osvežitev je smiselna, ko je zaslon obstal in ni odprtega neoddano urejenega obrazca.

Če je obrazec odprt, najprej presodite, ali ga lahko varno zaprete ali shranite.

Ne osvežujte med aktivnim plačilnim postopkom brez navodila odgovorne osebe.

### 6.3 Vrnitev povezave

Ko se povezava vrne, ne klikajte vseh prejšnjih gumbov zaporedoma.

Počakajte, da se naložijo osnovni podatki.

Preverite, ali je seja še veljavna.

Preverite podjetje, enoto in blagajno.

Odprite ustrezno evidenco ter preverite zadnje dejanje.

Če sta stanje terminala in stanje POS različna, ustavite postopek in uporabite postopek za neusklajeno plačilo.

### 6.4 Prehodna napaka in potrjena odjava

| Dogodek | Kaj POS lahko stori | Kaj stori uporabnik |
|---|---|---|
| začasna omrežna napaka | ohrani odprto aplikacijo | počaka in preveri rezultat |
| odgovor brez potrditve dostopa | poskusi osvežiti žeton | ne ponavlja dejanja |
| potrjena nepooblaščenost | odstrani uporabnika in podatke | znova se prijavi |
| prepovedana POS-vloga | pokaže prepoved dostopa | kontaktira skrbnika |
| napaka strežnika | lahko ohrani sejo | zapiše okoliščine in poskusi pozneje po navodilu |

### 6.5 Ponovni zagon brskalnika

Zapiranje brskalnika ni predaja dela.

Če je naprava skupna, se po ponovnem zagonu prijavite sami.

Če brskalnik ponudi obnovo zavihkov, ne nadaljujte slepo iz starega obrazca.

Najprej preverite sejo in kontekst.

Nato preverite, ali je bil zadnji poslovni korak izveden.

### 6.6 Varni pogoji za ustavitev

Takoj ustavite poslovni vnos, kadar:

- je prijavljen napačen uporabnik;
- podjetje ni razvidno ali je napačno;
- enota ne ustreza fizičnemu lokalu;
- blagajna ali poslovni prostor nista dodeljena;
- zahtevane mize ni in vzrok ni znan;
- plačilni postopek nima jasnega rezultata;
- zaslon po povezovalni napaki kaže nasprotujoče podatke;
- naprava ni prepoznana ali uporablja neznane nastavitve;
- uporabnik ne razume opozorila, ki vpliva na poslovno evidenco.

Ustavitev pomeni, da ne ustvarjate novih naročil, računov ali sprememb nastavitev.

Ustavitev ne pomeni brisanja zavihka, predpomnilnika ali zgodovine brez navodila skrbnika.

## 7. Prvi dan v enoti

### 7.1 Namen uvajanja

Prvi dan je preverjanje dodelitev, ne preizkušanje produkcijske prodaje.

Vodja pripravi ime uporabnika, enoto, blagajno in delovno mesto.

Uporabnik preveri, da prijava pripada njemu.

Skupaj preverita, kaj naprava sme prikazati.

Za vsak manjkajoč podatek se določi odgovorna oseba in rok.

### 7.2 Kontrolni seznam prve prijave

- uporabnik uspešno dokonča prijavo;
- ime uporabnika je pravilno;
- vloga ustreza dogovorjenemu delu;
- podjetje je pravilno;
- enota je pravilna;
- blagajna je dodeljena oziroma pravilno izbrana;
- poslovni prostor je viden;
- naprava je prepoznana;
- tloris prikazuje pričakovani prostor;
- dovoljenje miz ustreza delovni coni;
- navigacija vsebuje potrebne module;
- tiskalnik in terminal sta preverjena po lokalnem postopku.

Kontrolnega seznama ne potrjujte vnaprej.

Vsako točko preverite na dejanskem mestu dela.

### 7.3 Prvi dan natakarja

Natakar najprej pozna razliko med svojim računom in skupno napravo.

Nato poišče prikaz enote, poslovnega prostora in blagajne.

Na zaslonu Mize poišče svojo delovno cono.

Vodja pokaže, kje so druge cone, da natakar odsotnosti mize ne razume kot napako.

Natakar zna opisati, komu sporoči manjkajočo mizo.

Natakar ne nastavlja blagajne, naprave ali pravic.

### 7.4 Prvi dan vodje enote

Vodja preveri uporabniške dodelitve pred začetkom rednega dela.

Preveri, ali imajo običajni uporabniki fiksno blagajno.

Preveri, ali je administratorjeva shranjena enota pravilna.

Preveri naprave po fizičnih lokacijah.

Za vsako napravo evidentira namen, dovoljene mize in priključene naprave.

Ob spremembi postavitve miz posodobi konfiguracijo, ne pa neformalnih navodil osebju.

### 7.5 Prvi dan administratorja

Administrator se seznani z razliko med podjetjem in enoto.

Preizkusi preklop enote samo v dogovorjenem času brez odprtih nedokončanih postopkov.

Po preklopu preveri, da se je prilagodila navigacija profilu enote.

Preveri, da se naprava ponovno prijavi z novo enoto.

Zna razložiti, zakaj navaden uporabnik ne more preklopiti fiksne blagajne.

## 8. Varnost na skupnih delovnih mestih

### 8.1 Pravilo osebne identitete

Vsak poslovni poseg mora biti izveden pod računom osebe, ki ga opravlja.

Hitrost menjave izmene ne upraviči uporabe računa kolega.

Vodja ne sme prositi natakarja, naj ostane prijavljen za naslednjo osebo.

Če se sodelavec ne more prijaviti, se uporabi postopek za dostop, ne izposoja računa.

### 8.2 Fizična zaščita

Tablica ne sme ostati brez nadzora na dostopnem robu pulta.

Računalnik zaklenite ob kratkem odhodu, kadar to zahteva ureditev lokala.

Ob koncu osebnega dela izvedite odjavo.

Neznan kabel, ključek ali naprava ne sodi v POS delovno postajo brez odobritve.

Ne dovolite gostu, da upravlja brskalnik ali prijavni zaslon.

### 8.3 Brskalniški profil

Službeni profil je namenjen delu v POS.

Zasebna e-pošta in zasebni uporabniški računi ne sodijo v isti profil na skupni blagajni.

Ne uporabljajte zasebnega načina kot stalne rešitve za težave prijave.

Brisanje podatkov brskalnika lahko odstrani lokalne izbire naprave in blagajne.

Tak poseg izvede skrbnik ali oseba po njegovem navodilu.

### 8.4 Kaj je dovoljeno sporočiti podpori

Podpori lahko posredujete čas, opis napake, ime enote, ime naprave in posnetek zaslona brez občutljivih podatkov.

Podpori ne posredujte gesla.

Podpori ne posredujte prijavnega žetona.

Podpori ne pošiljajte fotografije osebnih podatkov gosta, kadar za rešitev ni potrebna.

Pred pošiljanjem posnetka preverite, ali vsebuje odprto naročilo ali osebne podatke.

## 9. Odločanje pri pogostih odstopanjih

### 9.1 Mize niso pravilne

| Vprašanje | Če je odgovor da | Če je odgovor ne |
|---|---|---|
| Ali je enota pravilna? | preverite prostor in napravo | preklopite le, če imate pravico |
| Ali je miza v drugem prostoru? | odprite pravi prostor | nadaljujte s preverjanjem |
| Ali naprava dovoljuje to mizo? | preverite aktualnost prikaza | administrator preveri omejitev naprave |
| Ali je miza nova ali preimenovana? | preverite tloris pri vodji | ne ustvarjajte nadomestne mize |
| Ali je stanje po osvežitvi enako? | prijavite težavo | preverite povezavo in sejo |

### 9.2 Blagajna ni dodeljena

Ne izbirajte naključne blagajne.

Preverite, ali ste prijavljeni s pravim računom.

Pri vlogi uporabnik skrbnik preveri dodeljeno blagajno.

Pri upravičeni vlogi preverite lokalno izbrano blagajno.

Če manjka tudi poslovni prostor, ustavite delo in zahtevajte ureditev konfiguracije.

### 9.3 Funkcija ni vidna

Najprej preverite aktivno enoto.

Nato preverite, ali funkcija sodi v profil enote.

Preverite, ali vaša vloga dovoljuje administrativni modul.

Ne zahtevajte samodejno višje vloge.

Skrbniku opišite poslovno potrebo in točno pot, ki je ne vidite.

### 9.4 Zaslon pokaže staro stanje

Preverite povezavo naprave.

Ne ustvarjajte novega vnosa kot nadomestilo za manjkajoč prikaz.

Osvežite le, če ni nevarnosti izgube nedokončanega obrazca.

Po osvežitvi ponovno preverite sejo in kontekst.

Če se stanje razlikuje od pričakovanega, uporabite evidenco modula za preverjanje dejanskega rezultata.

### 9.5 Naprava je v napačni enoti

Ne rešujte težave s prijavo drugega uporabnika.

Preverite, katera enota je aktivna pri prijavljenem uporabniku.

Po dovoljeni menjavi enote počakajte na ponovno prijavo naprave.

Če naprava še vedno kaže staro območje, naj administrator preveri njeno registracijo.

Ne premikajte naprave med lokali brez evidentirane spremembe.

### 9.6 Nejasen rezultat plačila

Ne zahtevajte drugega plačila, dokler ne preverite prvega.

Preverite prikaz terminala.

Preverite stanje dokumenta v POS.

Zapišite znesek, čas in referenco, ki je dovoljena po internem postopku.

Če se podatka ne ujemata, pokličite odgovorno osebo.

Ne zaključujte razlike z navideznim naročilom ali nepojasnjenim popustom.

## 10. Realistični scenariji

### 10.1 Terasa na drugi tablici

Sara stoji na terasi in na tablici ne vidi mize 18.

Ne doda nove mize z imenom »18 terasa«.

Najprej preveri, ali je odprla notranji prostor.

Nato preveri, ali je prijavljena v enoto Terasa in ne v enoto Restavracija.

Vodja potrdi, da je miza 18 dodeljena drugi napravi.

Sara uporabi pravilno napravo oziroma vodja prilagodi dovoljenje miz.

### 10.2 Menjava administratorja med lokacijama

Vodja zjutraj dela v poslovalnici A in popoldne v poslovalnici B.

V poslovalnici B odpre POS, vendar vidi meni iz prejšnje enote.

Ne ureja cenika.

V izbirniku enote izbere B in počaka na osvežitev.

Preveri ime enote, tloris in blagajno.

Šele po tej kontroli nadaljuje z administrativnim delom.

### 10.3 Potek seje med naročilom

Uporabnica po daljšem premoru klikne nadaljevanje dela in prejme zahtevo po prijavi.

Zapomni si številko mize in število postavk, ki jih je videla.

Po prijavi preveri, ali se je naročilo že pojavilo na mizi.

Če je prisotno, ga ne vnese znova.

Če ni prisotno, ga vnese šele po potrditvi, da prejšnje dejanje ni doseglo sistema.

### 10.4 Nova naprava brez tiskalnika

V lokalu zamenjajo računalnik pri pultu.

POS ga prepozna kot novo Windows napravo.

Uporabnik lahko vidi mize, vendar to ne dokazuje pripravljenosti tiskanja.

Vodja preveri registracijo naprave in nastavitve tiskalnika.

Dokler preverjanje ni dokončano, se prodajno mesto uporablja po dogovorjenem rezervnem postopku.

Nastavitev se ne kopira na pamet iz druge naprave.

### 10.5 Prijavljen je prejšnji sodelavec

Ob prevzemu pulta Luka vidi ime sodelavca.

Ne izda niti enega računa.

Sodelavca pozove k odjavi ali izvede odjavo po dogovorjenem postopku.

Luka se prijavi s svojim računom.

Nato preveri dodeljeno blagajno, ker sta lahko dodelitvi oseb različni.

### 10.6 Enota brez kuhinje

Administrator odpre star zaznamek za Kuhinjo.

Aktivna enota ima profil, v katerem kuhinjski modul ni omogočen.

POS opozori, da funkcija v tej enoti ni omogočena.

Administrator ne razglasi izpada sistema.

Preveri profil enote in poslovni razlog za zahtevano funkcijo.

Če je sprememba upravičena, jo evidentira in uredi v nastavitvah po postopku.

### 10.7 Izpad brez jasnega konca

Med delom se zaslon ne odziva, terminal pa je pravkar sprejel kartico.

Uporabnik ne osveži takoj.

Najprej zabeleži stanje terminala in čas.

Po vrnitvi povezave preveri račun v POS.

Če račun obstaja, ga ne ustvarja znova.

Če račun ne obstaja, primer preda odgovorni osebi pred novim zaračunavanjem.

### 10.8 Dve enoti s podobnim imenom

Podjetje ima enoti »Stari trg« in »Stari trg terasa«.

Uporabnik ne preklopi na podlagi prve besede imena.

Prebere celotno ime enote.

Preveri tudi tloris in fizično oznako pulta.

Ob nejasnosti vpraša vodjo, katera enota vodi posamezen prostor.

### 10.9 Počiščeni podatki brskalnika

Po čiščenju brskalnika POS ustvari nov ključ naprave.

Prejšnja konfiguracija je lahko še vezana na stari ključ.

Uporabnik tega ne rešuje z menjavo osebnega računa.

Vodja napravo ponovno identificira in preveri njen obseg miz ter periferno opremo.

Do potrditve se naprava ne uporablja za občutljivo prodajno delo.

### 10.10 Manjka samo poslovni prostor

Natakar vidi enoto in blagajno, poslovni prostor pa je označen kot nedodeljen.

To ni kozmetično opozorilo.

Natakar ustavi delo pred izdajo računa.

Vodja preveri povezavo blagajne s poslovnim prostorom.

Po spremembi se natakar ponovno prijavi ali ponovno naloži podatke po navodilu.

## 11. Matrika odpravljanja težav

| Simptom | Ne storite | Preverite | Eskalacija |
|---|---|---|---|
| prijava ne uspe | ne uporabljajte tujega računa | uporabniško ime, način preverjanja, aktivnost računa | skrbnik uporabnikov |
| POS zavrne po prijavi | ne ustvarjajte lokalnih obvodov | POS-vlogo, podjetje, aktivnost uporabnika | administrator podjetja |
| ni dodeljene blagajne | ne izberite tuje blagajne | prijavljenega uporabnika in njegovo dodelitev | administrator enote |
| ni poslovnega prostora | ne izdajajte računov | nastavitev blagajne | administrator enote |
| manjka miza | ne ustvarite dvojnika | enoto, prostor, omejitev naprave | vodja ali administrator |
| manjka modul | ne spreminjajte povezave v brskalniku | profil enote in vlogo | administrator |
| naprava kaže napačno območje | ne prijavite druge osebe | enoto in prijavo naprave | administrator naprav |
| po osvežitvi ni obrazca | ne ponovite slepo | evidenco in rezultat zadnjega dejanja | vodja izmene |
| terminal in POS se ne ujemata | ne bremenite znova | znesek, čas, stanje računa | odgovorna oseba za plačila |
| povezava ni na voljo | ne zaključujte na pamet | omrežje, napajanje, status seje | tehnična podpora |

Pri eskalaciji navedite:

- kdo je bil prijavljen;
- katera enota je bila aktivna;
- katera blagajna je bila aktivna;
- katera naprava je bila uporabljena;
- kateri zaslon je bil odprt;
- kaj je uporabnik izvedel neposredno pred težavo;
- ali je šlo za naročilo, račun, plačilo ali nastavitev;
- čas dogodka;
- točno besedilo opozorila.

## 12. Usposabljanje izvajalcev

### 12.1 Cilji usposabljanja

Po usposabljanju uporabnik razlikuje identiteto, sejo, podjetje, enoto, blagajno in napravo.

Zna najti prikaz svojega konteksta.

Zna prepoznati stanje, v katerem mora delo ustaviti.

Zna varno ukrepati ob poteku seje in izpadu povezave.

Ne uporablja računa sodelavca.

Zna opisati težavo tako, da jo lahko skrbnik preveri.

### 12.2 Program za novega natakarja

| Vsebina | Način preverjanja | Merilo uspeha |
|---|---|---|
| osebna prijava | samostojna prijava | prijavljen je lastni račun |
| pregled konteksta | pokaže podatke v navigaciji | pravilno prebere enoto, prostor in blagajno |
| mize in naprava | poišče določeno mizo | razlikuje manjkajočo mizo od omejitve naprave |
| varnost skupne naprave | opiše menjavo oseb | vedno navede odjavo in novo prijavo |
| seja | reši simuliran potek seje | po prijavi najprej preveri rezultat |
| pomoč | pripravi prijavo težave | navede potrebne podatke brez skrivnosti |

### 12.3 Program za vodjo izmene

Vodja zna preveriti, ali oseba dela pod lastnim računom.

Zna ugotoviti, ali gre za napačno enoto, blagajno ali napravo.

Zna ustaviti delo pri nejasnem plačilu.

Zna razlikovati konfiguracijsko težavo od prehodne omrežne napake.

Zna pravilno predati primer administratorju.

Ne rešuje pravic z deljenjem prijavnih podatkov.

### 12.4 Program za administratorja

Administrator razume, da je shranjena enota lahko lokalna preferenca.

Pozna razliko med fiksno blagajno uporabnika in izbirno blagajno upravičene vloge.

Pozna ponovni vpis naprave ob spremembi enote.

Zna preveriti profil enote pred spremembo navigacije.

Zna načrtovati spremembo brez odprtih nejasnih transakcij.

Zna dokumentirati fizično razporeditev naprav in njihovih dovoljenih miz.

## 13. Vaje

### 13.1 Vaja: pregled delovnega konteksta

Prijavite se v učnem okolju s svojim učnim računom.

Poiščite ime uporabnika.

Poiščite enoto.

Poiščite poslovni prostor.

Poiščite blagajno.

Povejte, kateri podatek bi preverili še pred odpiranjem miz.

**Odgovor:** preverili bi, ali oznake ustrezajo fizičnemu pultu in ali naprava prikazuje pravo delovno cono.

### 13.2 Vaja: manjkajoča miza

Na tablici ne najdete mize, za katero gost že sedi.

Naštejte prve štiri preverbe.

**Odgovor:** enota, prostor na tlorisu, omejitev miz naprave in morebitno preimenovanje oziroma sprememba tlorisa.

Pojasnite, zakaj ne ustvarite nove mize.

**Odgovor:** nova miza lahko razdvoji evidenco in ne odpravi vzroka omejenega prikaza.

### 13.3 Vaja: prijavljen sodelavec

Prevzemate skupni računalnik in na njem vidite ime druge osebe.

Kaj je prvi korak?

**Odgovor:** ne izvajate nobenega poslovnega dejanja; prejšnja oseba se odjavi, nato se prijavite sami.

Kaj preverite po lastni prijavi?

**Odgovor:** podjetje, enoto, poslovni prostor, blagajno in napravo oziroma delovno cono.

### 13.4 Vaja: potek seje

Med urejanjem zaslon zahteva ponovno prijavo.

Ali takoj ponovno vnesete zadnje postavke?

**Odgovor:** ne.

Kaj zapišete pred prijavo?

**Odgovor:** mizo ali dokument, fazo postopka in vse podatke, potrebne za preverjanje rezultata.

Kaj preverite po prijavi?

**Odgovor:** ali je zadnje dejanje že zabeleženo v ustrezni evidenci.

### 13.5 Vaja: administrator preklopi enoto

Administrator spremeni enoto v izbirniku.

Kateri trije učinki so pričakovani?

**Odgovor:** osvežitev podatkov enote, prilagoditev tlorisa oziroma funkcij ter ponovna prijava naprave v novi enoti.

Zakaj ne nadaljuje iz starega zavihka?

**Odgovor:** stari prikaz lahko pripada prejšnjemu kontekstu in ni dokaz pravilne osvežitve.

### 13.6 Vaja: nejasno kartično plačilo

Terminal pokaže uspeh, POS pa zaradi izpada povezave nima jasnega zaključka.

Kaj ni dovoljeno?

**Odgovor:** istega zneska ne zaračunate znova in ne ustvarite nadomestnega računa brez preverjanja.

Kaj preverite?

**Odgovor:** znesek in čas na terminalu, stanje računa v POS ter postopek odgovorne osebe za plačila.

### 13.7 Vaja: manjka modul Kuhinja

V eni enoti je modul Kuhinja viden, v drugi ne.

Navedite dva možna pravilna razloga.

**Odgovor:** drugačen profil oziroma omogočene funkcije enote ali drugačna uporabniška vloga.

Kateri ukrep ni pravilen?

**Odgovor:** ročno odpiranje stare povezave, da bi se omejitev obšla.

## 14. Preverjanje znanja

### 14.1 Vprašanja

1. Kaj določa, katere mize so na voljo: samo uporabnikova vloga ali tudi naprava?

2. Ali lahko natakar z vlogo uporabnik sam zamenja svojo aktivno blagajno?

3. Kaj naredite, ko je poslovni prostor označen kot nedodeljen?

4. Ali prehodna omrežna napaka sama pomeni odjavo?

5. Kaj preverite po osvežitvi strani?

6. Zakaj se po spremembi enote znova prijavi naprava?

7. Kaj je pravilen odziv na tujo prijavo na skupni napravi?

8. Kaj storite, preden ponovite dejanje po poteku seje?

9. Zakaj se lahko navigacija razlikuje med enotama?

10. Katere podatke posredujete podpori pri manjkajoči mizi?

### 14.2 Ključ odgovorov

1. Na dostop do miz vplivata enota in lahko tudi naprava z dovoljenim seznamom miz.

2. Ne; pri tej vlogi POS uporablja dodeljeno blagajno.

3. Ustavite prodajno delo in zahtevate ureditev povezave blagajne s poslovnim prostorom.

4. Ne; POS jo obravnava kot prehodno težavo, dokler ni dostop potrjeno zavrnjen.

5. Sejo, uporabnika, podjetje, enoto, blagajno in rezultat nedokončanega dejanja.

6. Ker naprava pripada enoti in mora strežnik poznati njen trenutni kontekst.

7. Ne izvajate poslovnega dejanja, odjavite prejšnjo sejo in se prijavite sami.

8. Preverite, ali je bilo prejšnje dejanje že zabeleženo.

9. Ker profil in omogočene funkcije aktivne enote določajo vidne module.

10. Uporabnika, enoto, napravo, prostor, ime oziroma številko mize, čas in opis korakov.

## 15. Zaključna kontrola dostopa

Pred začetkom rednega dela potrdite naslednje trditve.

- Prijavljen sem s svojim računom.
- Vem, katero podjetje uporabljam.
- Izbrana enota ustreza fizični lokaciji.
- Poznam aktivno blagajno in poslovni prostor.
- Naprava ustreza mojemu delovnemu mestu.
- Vidim pričakovani obseg miz oziroma vem, komu sporočim odstopanje.
- Vem, da osvežitev ne potrdi nedokončanega dejanja.
- Vem, da ob nejasnem plačilu ne smem bremeniti znova.
- Vem, da se na skupni napravi ob menjavi osebe odjavim.
- Vem, da postopek za odprtje izmene poiščem v poglavju 02.

Če katere trditve ne morete potrditi, ne začnite poslovnega dela.

Najprej odpravite nejasnost z vodjo izmene ali administratorjem.

## 16. Skrbniška potrditev naprave in omejitev miz

Ta postopek je namenjen administratorju pred prvo uporabo nove ali počiščene
naprave. Vidne mize same po sebi ne dokazujejo, da je naprava pravilno
registrirana ali da sme uporabnik delati v vseh prikazanih prostorih.

### 16.1 Preverjanje naprave

1. Prijavite se v pravilno podjetje in enoto.
2. V nastavitvah poiščite napravo po imenu naprave in njeni enoti.
3. Preverite, ali ima naprava določen tiskalnik, širino papirja, kodno stran in
   plačilni terminal, kadar jih poslovni tok uporablja.
4. Preverite lokalni prehod oziroma tiskalniški most, če je za napravo zahtevan.
5. Preverite, ali je naprava aktivna in ali je bila po spremembi enote ponovno
   registrirana.
6. Shranite spremembo samo, če se fizična oznaka naprave ujema z nastavitvijo.

Če naprava nima dodeljenega tiskalnika ali terminala, ne sklepajte, da bo
stara nastavitev delovala. Najprej izvedite lokalni preskus brez nove prodaje.
Pri znakih č, š, ž in EUR preverite tudi kodno stran oziroma nadomestni zapis.
Ne nameščajte drugega tiskalniškega mostu samo zato, ker prvi ne odgovarja;
zabeležite ime naprave, čas in prikazano napako ter vključite skrbnika.

### 16.2 Dovoljene mize

Administrator lahko napravi določi seznam dovoljenih miz. Prazen seznam ima
poseben pomen: naprava nima omejitve na posamezne mize in lahko vidi vse mize,
ki so dovoljene izbranemu kontekstu. Neprazen seznam omeji delovno postajo na
navedene mize.

Po spremembi:

1. shranite nastavitev naprave;
2. odjavite uporabnika oziroma ponovno naložite POS po navodilu;
3. preverite pričakovano in nepričakovano mizo;
4. preverite, da uporabnik ne vidi starega obsega samo zaradi predpomnjenega
   zaslona.

Če miza manjka, najprej preverite enoto, prostor in seznam dovoljenih miz.
Ne ustvarjajte nadomestne mize in ne spreminjajte osebnih pravic uporabnika,
da bi zaobšli omejitev naprave.

## 17. Hitra menjava natakarja na skupni napravi

Hitra menjava ne zamenja prijave v podjetje. Osnovna seja ostane prijavljena,
poslovni izvajalec pa se na skupnem POS-u potrdi z lastnim POS PIN-om. Uporabi
se samo za aktivnega natakarja z odprto izmeno v trenutni enoti.

### 17.1 Nastavitev POS PIN-a

POS PIN nastavi samo administrator, administrator enote ali
superadministrator pri podatkih aktivnega natakarja.

1. Odprite podatke aktivnega natakarja.
2. Vnesite PIN dolžine **4 do 12 številk**.
3. Shranite nastavitev in natakarju PIN posredujte po varnem internem kanalu.
4. Ne zapisujte PIN-a ob skupni napravi in ga ne uporabljajte za drugo osebo.

Pri napačni dolžini ali neaktivnem natakarju nastavitev ni veljavna. Ponovna
nastavitev PIN-a ponastavi neuspele poskuse in začasno zaklenjeno stanje.

### 17.2 Menjava identitete

1. Na skupni napravi izberite **Izberi natakarja** oziroma
   **Zamenjaj natakarja**.
2. Izberite natakarja s seznama aktivnih izmen.
3. Vnesite njegov osebni POS PIN.
4. Izberite **Odkleni in preklopi**.
5. Preverite prikazano ime oziroma identiteto pred prvim naročilom.

Če natakarja ni na seznamu, najprej preverite, ali ima odprto izmeno v pravi
enoti. Ne izbirajte profila druge osebe samo zato, da odklenete zaslon.
Uspešna menjava ustvari revizijski dogodek; preklic dialoga ne sme ustvariti
poslovnega dejanja.

Po več napačnih PIN-ih se PIN začasno zaklene. Obvestilo **PIN je začasno
zaklenjen** ni razlog za ugibanje nadaljnjih kombinacij. Obvestite administratorja
in uporabite postopek ponastavitve PIN-a. Če se seja ne odklene, preverite tudi,
ali je izmena še odprta; brez odprte izmene menjava ni dovoljena.

POS seja hitre menjave velja največ 16 ur oziroma do zaprtja izmene. Ob menjavi
osebe na skupnem mestu vedno zaklenite oziroma preklopite izvajalca; ne puščajte
odprtega poslovnega konteksta naslednji osebi.