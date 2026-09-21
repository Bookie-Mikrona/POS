---
name: Proračunski kontni plan 2024
description: Shranjen uradni kontni plan za proračunske uporabnike ter posebnost njegovega zanesljivega generiranja.
---

Uradni PDF Enotnega kontnega načrta, uporabljen kot vir, je kontni plan za proračunske uporabnike (država, občine in javni zavodi), ne za zasebna podjetja oziroma d.o.o. Ostane shranjen kot ločen, izrecno uvožen plan in se ne sme uporabiti kot privzeti seed za novo podjetje.

Pri razčlenjevanju tega PDF-ja z `pdftotext -layout` se del kod izpiše samostojno, naziv pa je v naslednji vrstici. Razčlenjevalnik mora zato sprejeti tudi vrstico s samo kodo in kasnejši nadaljevalni naziv.

**Why:** Napačna uporaba proračunskega plana bi d.o.o. dodelila neustrezen kontni plan; zahteva, da je ime v isti vrstici kot koda, pa tiho izpusti del uradnega vira.

**How to apply:** Ta plan uporabi samo ob jasni izbiri proračunskega uporabnika. Ob menjavi uradnega PDF-ja ohrani strogo validacijo števila izvornih kod in prilagodi pričakovano število šele po neodvisni preverbi nove uradne priloge.