---
name: POS test obrazca artiklov
description: Omejitev pri testiranju POS obrazcev in naročil z generiranim API odjemalcem.
---

Namenski testni mock generiranega odjemalca mora vključiti izvoze, ki jih obrazec ali naročilo potrebuje neposredno ali posredno. Samodejen delni mock z uvozom celotnega pravega odjemalca ni zanesljiva hitra rešitev. V ozko usmerjenih testih smeš ločene, nepovezane podtokove nadomestiti na meji komponente, namesto širjenja celotnega odjemalca.

**Why:** Med preverjanjem preprostega pogoja za prikaz polj je stari mock odpovedal že pred zagonom testov zaradi manjkajočih izvozov; poskus uvoza celotnega odjemalca je obstal do časovne omejitve. Tudi regresijski test naročila lahko odpove zaradi novega nepovezanega podtoka, preden sploh preveri ciljno vrstico.

**How to apply:** Pri naslednji spremembi testov obrazca razširi usmerjeni mock in ločeno preveri, da se zbirka testov sploh lahko zažene, še preden nanjo opreš regresijsko potrditev funkcije.