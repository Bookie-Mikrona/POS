---
name: Privzete konto nastavitve
description: Pravila za varno dopolnjevanje modulskih konto nastavitev ob nastanku podjetja in na ročni zahtevi.
---

Privzete konto nastavitve so vedno **fill-only**: že izbrana, ne-NULL nastavitev
uporabnika ne sme biti prepisana. Samodejno se izvedejo samo ob ustvarjanju novega
podjetja v isti transakciji kot kontni plan; za stare družbe je dopolnitev izrecna,
avtorizirana ročna akcija.

**Why:** računovodske nastavitve so lahko ročno prilagojene. Ponovni seed ali
sočasni retry ne smeta povzročiti tihe spremembe knjiženja ali podvojenih DDV kod.

**How to apply:** ob prihodnjih dodatnih privzetih nastavitvah uporabi izključno
obstoječe konte podjetja, nastavi le prazna polja z atomskim `COALESCE` pristopom
in obdrži transakcijsko serializacijo na ravni podjetja. Ne uvajaj množičnih
samodejnih sprememb za obstoječa podjetja.

Izjema za manjkajoči konto 404 pri strošku drobnega inventarja: obstoječe
podjetje ga sme ustvariti samo z izrecnim dejanjem v nastavitvah, ki obenem
izpolni prazno konto nastavitev. Običajni seed še vedno uporablja le
obstoječe konte in nikoli ne spreminja ročne izbire.

**Why:** stari kontni plan ni vseboval analitike 404, zato samo dopolnitev
praznih nastavitev uporabniku ni omogočila knjiženja nabave drobnega inventarja.

**How to apply:** podobno izjemo uporabi le za izrecno zahtevani namenski
konto, transakcijsko in omejeno na izbrano podjetje; brez množičnega
ustvarjanja kontov za stare družbe.