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