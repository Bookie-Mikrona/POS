---
name: CTI žeton po enoti
description: Varnostna meja za MacroDroid dohodne klice in upravljanje žetonov v POS.
---

Vsaka poslovna enota ima lasten, preklicljiv CTI žeton. Dohodni klic sme identiteto enote dobiti samo iz žetona v glavi `X-CTI-Token`; podatki v telesu (tudi morebitna enota) niso avtoritativni. Žeton lahko upravlja le administrator trenutno aktivne enote.

**Why:** Skupna skrivnost ali enota iz zahtevka bi enemu MacroDroid toku omogočila ustvarjanje klicev v drugi enoti. Regeneracija mora takoj preklicati prejšnjo poverilnico, da se kompromitiran telefon hitro izolira.

**How to apply:** Pri vseh prihodnjih CTI ponudnikih obdrži enotni žeton-na-enoto, preverjanje s časovno varno primerjavo in izolacijo naročnika/klica na razrešeno enoto. Ne uvajaj nazaj globalne CTI skrivnosti ali `enotaId` kot vhoda za izbiro enote.