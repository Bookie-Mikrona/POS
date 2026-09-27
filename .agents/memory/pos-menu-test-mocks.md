---
name: POS test obrazca artiklov
description: Omejitev pri testiranju zaslona za urejanje artiklov z generiranim API odjemalcem.
---

Namenski testni mock generiranega odjemalca mora vključiti izvoze, ki jih obrazec potrebuje neposredno ali posredno. Samodejen delni mock z uvozom celotnega pravega odjemalca ni zanesljiva hitra rešitev.

**Why:** Med preverjanjem preprostega pogoja za prikaz polj je stari mock odpovedal že pred zagonom testov zaradi manjkajočih izvozov; poskus uvoza celotnega odjemalca je obstal do časovne omejitve.

**How to apply:** Pri naslednji spremembi testov obrazca razširi usmerjeni mock in ločeno preveri, da se zbirka testov sploh lahko zažene, še preden nanjo opreš regresijsko potrditev funkcije.