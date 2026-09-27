---
name: Slovenska abeceda v seznamih
description: Kdaj razvrščati po slovenski abecedi in kdaj ohraniti ročno določen vrstni red.
---

Abecedna razvrstitev imen v POS in ERP mora uporabljati slovensko primerjavo, ki č postavi med c in d, š med s in t ter ž za z. Odstranjevanje diakritikov za iskanje ni ustrezna osnova za razvrščanje. V Meniju naj vrstni red skupin prodajnih artiklov sledi nastavitvi vrstnega reda kategorij, znotraj skupine pa velja slovenska abeceda; artikli brez veljavne kategorije so na koncu.

**Why:** Privzeti vrstni red baze ali brskalnika lahko šumnike postavi na konec, uporabnik pa je izrecno zahteval slovensko abecedo. Uporabniško nastavljena prioriteta kategorij ni enako kot abecedna razvrstitev imen.

**How to apply:** Pri novih seznamih loči namen primerjave (ime, šifra, datum ali ročna prioriteta). Za imena v brskalniku uporabi slovenski primerjalnik, za SQL ime pa preverjeno slovensko kolacijo; številčnega, časovnega in ročnega vrstnega reda ne spreminjaj. Razpoložljivost ICU kolacije preveri v vsakem okolju pred objavo.