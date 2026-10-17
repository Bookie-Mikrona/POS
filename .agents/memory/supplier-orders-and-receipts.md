---
name: Naročila dobaviteljem in prevzemi
description: Ločevanje naročil dobaviteljem od fizičnega prejema blaga.
---

Naročilo dobavitelju je samo poslovna obveznost. Samo potrjena prejemnica sme vplivati na zalogo ali knjigovodstvo; osnutki naročil in osnutki prejemnic nimajo teh učinkov.

Količina vrstice prejemnice je že količina zalogovne enote. Faktor pakiranja pretvori količino naročenih paketov v zalogovne enote, pri seštevanju potrjenih prejemnic pa ga ne uporabi znova.

Pri naročilih dobaviteljem cena zadnjega paketa iz potrjenih, povezanih prejemnic temelji na neto ceni na zalogovno enoto, pomnoženi s trenutno velikostjo paketa v preslikavi. Pri ponovnem izračunu upoštevaj najnovejši datum potrjene povezane prejemnice; zgodovinskih cenovnih posnetkov naročila in prejemnice ne spreminjaj. Osnutki ne spreminjajo preslikave.

Naročilo dobavitelju ima ločeno interno opombo in izrecno navodilo dobavitelju. Stara enotna opomba ostane interna in se nikoli samodejno ne natisne; uporabniku mora biti jasno prikazana, za dobavitelja pa jo lahko izrecno prekopira v ločeno polje. Kopija se doda obstoječemu navodilu brez podvajanja in brez spreminjanja izvirnika; če bi presegla omejitev 2.000 znakov, se ne skrajša ali shrani. Navodilo se natisne šele po pregledu in shranjevanju naročila.

Ročni izpis naročila oziroma shranjevanje v PDF je samo prikaz: ne spreminja statusa naročila in ne pošilja e-pošte.

Dolga dobaviteljska navodila se lahko nadaljujejo na naslednji strani. Izpis mora ponoviti glavo tabele, ohraniti vse vrstice in zneske ter razdeliti besedilo brez izreza ali prekrivanja.

**Why:** Uporabnik je izrecno potrdil, da naročilo ni prejem blaga in ne sme samo ustvariti zaloge ali računovodskega učinka. Cena za prihodnje naročilo mora izhajati iz potrjenega dejanskega prejema, ne iz osnutka ali starega cenovnega posnetka.

**Why:** Mešana opomba je že povzročila možnost, da se interna vsebina natisne dobavitelju. Varna privzeta obravnava starega besedila je interna, dokler ga uporabnik izrecno ne označi kot dobaviteljsko navodilo.

**Why:** Prepis obstoječega navodila bi lahko izgubil že vnesene podatke, tiho krajšanje pa bi spremenilo pomen; zato kopiranje varno doda besedilo in zahteva uporabnikov pregled.

**Why:** Brskalniški izpis z dolgim neprelomljivim blokom lahko preseže stran, tudi če navadni prikaz DOM-a deluje pravilno.

**How to apply:** Pri novih POS nabavnih tokovih spremembe zaloge in knjiženja veži na potrditev prejemnice, ne na nastanek ali pošiljanje naročila. Prejemniško količino primerjaj neposredno z naročeno zalogovno količino. Ceno za ponovitev izračunaj samo iz potrjenih povezanih prejemnic in ohrani že shranjene posnetke dokumentov. Ročno oddajo podpri s tiskom/PDF, status pa spreminjaj samo prek ločenega izrecnega dejanja. Internih opomb nikoli ne vključuj v dobaviteljski izpis. Pri spremembah paginacije preveri dejanski brskalniški PDF z več stranmi, ponovljeno glavo tabele in dolgimi navodili.
