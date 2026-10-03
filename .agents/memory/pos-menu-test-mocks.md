---
name: POS test obrazca artiklov
description: Omejitev pri testiranju POS obrazcev in naročil z generiranim API odjemalcem.
---

Namenski testni mock generiranega odjemalca mora vključiti izvoze, ki jih obrazec ali naročilo potrebuje neposredno ali posredno. Samodejen delni mock z uvozom celotnega pravega odjemalca ni zanesljiva hitra rešitev. V ozko usmerjenih testih smeš ločene, nepovezane podtokove nadomestiti na meji komponente, namesto širjenja celotnega odjemalca.

**Why:** Med preverjanjem preprostega pogoja za prikaz polj je stari mock odpovedal že pred zagonom testov zaradi manjkajočih izvozov; poskus uvoza celotnega odjemalca je obstal do časovne omejitve. Tudi regresijski test naročila lahko odpove zaradi novega nepovezanega podtoka, preden sploh preveri ciljno vrstico.

**How to apply:** Pri naslednji spremembi testov obrazca razširi usmerjeni mock in ločeno preveri, da se zbirka testov sploh lahko zažene, še preden nanjo opreš regresijsko potrditev funkcije.

Za brskalniški test celotnega POS obrazca uporabi testno identiteto z dejansko
operativno POS vlogo in popolnim kontekstom enote. Če uporabiš API mocke,
prestrezaj samo namenske podatkovne poti, ne vseh POS zahtev hkrati.

**Why:** Programatična Clerk prijava nove testne identitete ni ustvarila
operativne POS vloge. Nadomestni široki mock je prikazal lupino programa,
vendar brez popolnih zmožnosti enote ni odprl obrazca in je pokvaril še SSE
odziv. Tak zastoj ni dokaz napake obrazca.

**How to apply:** Pred brskalniškim preverjanjem novega dela obrazca potrdi,
da testni uporabnik res doseže urejevalnik. Pri mockih ohrani pravilno
strukturo pravic in zmožnosti ter ne nadomeščaj dogodkovnega toka z JSON.