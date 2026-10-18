---
name: Naročila dobaviteljem in prevzemi
description: Ločevanje naročil dobaviteljem od fizičnega prejema blaga.
---

Naročilo dobavitelju je samo poslovna obveznost. Samo potrjena prejemnica sme vplivati na zalogo ali knjigovodstvo; osnutki naročil in osnutki prejemnic nimajo teh učinkov.

Količina vrstice prejemnice je že količina zalogovne enote. Faktor pakiranja pretvori količino naročenih paketov v zalogovne enote, pri seštevanju potrjenih prejemnic pa ga ne uporabi znova.

Ob potrditvi povezane prejemnice zakleni naročilo in v isti transakciji primerjaj naročeno količino v zalogovnih enotah z vsoto že potrjenih prejemov in trenutne prejemnice. Osnutki ne štejejo kot prevzeta količina; če potrjeni seštevek preseže naročilo, zavrni celotno potrditev pred gibanjem zaloge.

**Why:** Dva uporabnika lahko pripravita osnutka na podlagi istega preostanka; preverjanje brez zaklepa ali pred potrditveno transakcijo bi ob sočasnih potrditvah omogočilo presežek zaloge.

**How to apply:** Za količinsko mejo uporabi zalogovno količino in isti red zaklepanja kot potrditveni tok. Ponovno izračunaj preostanek po pridobitvi zaklepa; napaka mora razveljaviti tudi vsa gibanja zaloge in posodobitve statusa.

Pri naročilih dobaviteljem cena zadnjega paketa iz potrjenih, povezanih prejemnic temelji na neto ceni na zalogovno enoto, pomnoženi s trenutno velikostjo paketa v preslikavi. Pri ponovnem izračunu upoštevaj najnovejši datum potrjene povezane prejemnice; zgodovinskih cenovnih posnetkov naročila in prejemnice ne spreminjaj. Osnutki ne spreminjajo preslikave.

Ročno vnesena prejemnica ni cenovni dokaz, dokler uporabnik izrecno ne poveže njene vrstice z ustrezno vrstico naročila. Ob povezavi ponovno preveri enoto, dobavitelja, artikel in preostalo količino pod zaklepanjem naročila; potrjena prejemnica začne vplivati na cenovno zgodovino šele po shranjeni povezavi.

**Why:** Samodejno vključevanje vseh ročnih vnosov bi lahko v zgodovino dobaviteljskih cen dodalo napačen nakup.

**How to apply:** Ročne prejemnice pusti nepovezane privzeto. Povezavo omogoči kot jasno uporabniško dejanje; preverjanje ponovi ob shranitvi in ne spreminjaj zaloge ali računovodstva.

Številke prejemnic se lahko ponovijo med različnimi podjetji in niso globalni identifikatorji. **Why:** Podjetja lahko uporabljajo ločene sekvence, zato tuja in lokalna prejemnica lahko nosita isto prikazano številko. **How to apply:** Pri preverjanju izolacije med podjetji primerjaj ID-je prejemnic in najemniško omejene zapise, ne pa globalne odsotnosti prikazane številke.

Pred potrditvijo povezane prejemnice primerjaj shranjeni faktor naročilne vrstice s trenutnim faktorjem dobaviteljske povezave. Ob razliki naj bo prvi poskus brez sprememb, uporabnik pa mora potrditi točno pregledani par faktorjev; ob ponovitvi primerjavo ponovno preberi in zakleni, da zastarelo soglasje ne potrdi nove spremembe. Potrditev nikoli ne prepiše posnetkov naročila ali prejemnice.

Razlika med shranjeno osnovno enoto naročila in trenutno osnovno enoto artikla je blokada, ne opozorilo za uporabniško potrditev. Potrditev je dovoljena šele, ko se enoti ujemata; shranjeni posnetki se ne prilagodijo samodejno.

**Why:** Pregled spremembe faktorja ne more potrditi, da količina pomeni isto zalogovno enoto, zato bi potrditev ob različni osnovni enoti lahko napačno povečala zalogo.

**How to apply:** Preveri osnovno enoto pod zaklepanjem skupaj s primerjavo pakiranja. Ob neskladju zavrni celotno potrditev pred gibanjem zaloge ali knjiženjem; popravek mora biti izrecen in izveden na osnutku ali z uskladitvijo artikla.

Naročilo dobavitelju ima ločeno interno opombo in izrecno navodilo dobavitelju. Stara enotna opomba ostane interna in se nikoli samodejno ne natisne; uporabniku mora biti jasno prikazana, za dobavitelja pa jo lahko izrecno prekopira v ločeno polje. Kopija se doda obstoječemu navodilu brez podvajanja in brez spreminjanja izvirnika; če bi presegla omejitev 2.000 znakov, se ne skrajša ali shrani. Navodilo se natisne šele po pregledu in shranjevanju naročila.

Ročni izpis naročila oziroma shranjevanje v PDF je samo prikaz: ne spreminja statusa naročila in ne pošilja e-pošte.

Dolga dobaviteljska navodila se lahko nadaljujejo na naslednji strani. Izpis mora ponoviti glavo tabele, ohraniti vse vrstice in zneske ter razdeliti besedilo brez izreza ali prekrivanja.

**Why:** Uporabnik je izrecno potrdil, da naročilo ni prejem blaga in ne sme samo ustvariti zaloge ali računovodskega učinka. Cena za prihodnje naročilo mora izhajati iz potrjenega dejanskega prejema, ne iz osnutka ali starega cenovnega posnetka.

**Why:** Mešana opomba je že povzročila možnost, da se interna vsebina natisne dobavitelju. Varna privzeta obravnava starega besedila je interna, dokler ga uporabnik izrecno ne označi kot dobaviteljsko navodilo; pred tiskom opozori, če opomba obstaja, dobaviteljsko navodilo pa je prazno.

**Why:** Prepis obstoječega navodila bi lahko izgubil že vnesene podatke, tiho krajšanje pa bi spremenilo pomen; zato kopiranje varno doda besedilo in zahteva uporabnikov pregled.

**Why:** Brskalniški izpis z dolgim neprelomljivim blokom lahko preseže stran, tudi če navadni prikaz DOM-a deluje pravilno.

**Why:** Dobaviteljevo pakiranje se lahko spremeni med nastankom naročila in potrditvijo prevzema. Uporabnik mora pregledati novo vrednost, vendar je ne smemo tiho zapisati nazaj v zgodovinski dokument; soglasje k eni vrednosti tudi ne sme odobriti poznejše spremembe.

**How to apply:** Pri novih POS nabavnih tokovih spremembe zaloge in knjiženja veži na potrditev prejemnice, ne na nastanek ali pošiljanje naročila. Prejemniško količino primerjaj neposredno z naročeno zalogovno količino. Pred potrditvijo primerjaj faktor naročila s trenutno preslikavo pod zaklepanjem; ob neskladju ne zapiši nobenih učinkov, prikaži oba faktorja, nato ob izrecnem ponovnem poskusu preveri, da uporabnik potrjuje še vedno enake vrednosti. Ceno za ponovitev izračunaj samo iz potrjenih povezanih prejemnic in ohrani že shranjene posnetke dokumentov. Ročno oddajo podpri s tiskom/PDF, status pa spreminjaj samo prek ločenega izrecnega dejanja. Internih opomb nikoli ne vključuj v dobaviteljski izpis; kadar ob interni opombi ni navodila, opozori pred tiskom in urejanje ponudi le za osnutek. Pri spremembah paginacije preveri dejanski brskalniški PDF z več stranmi, ponovljeno glavo tabele in dolgimi navodili.

Za integracijske teste, ki delijo podjetje in enoto, glej tudi [supplier-order-test-isolation.md](supplier-order-test-isolation.md): omeji aggregate count in strančne aserte na enoličen testni identifikator, da so neodvisni od drugih testov.
