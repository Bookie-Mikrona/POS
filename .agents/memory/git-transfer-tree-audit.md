---
name: Git prenosi in tihe izgube
description: Varnostno pravilo za odkrivanje funkcij, ki izginejo med prenosom ali preoblikovanjem Git zgodovine.
---

Po vsakem prenosu, združevanju oddaljene zgodovine ali obnovi glavne veje primerjaj celotno drevo s stanjem tik pred posegom. Ne zanašaj se samo na seznam commitov ali običajen pregled izbrisov.

**Why:** Pri tem projektu so med prenosom iz glavne veje tiho izginile cele POS funkcije, API-poti, izvorne sheme in migracije, ne da bi trenutna zgodovina pokazala jasen commit za posamezne izbrise. Podobna izguba se je zgodila že prej.

**How to apply:** Pred prenosom ohrani namensko referenco na celotno drevo. Po prenosu primerjaj izbrisane poti, spremembe registracij poti, OpenAPI pogodbo, sheme in migracije. Izgubljene dele vračaj selektivno ter jih uskladi z novejšimi spremembami; ne prepisuj celotne veje in ne ponavljaj migracij na slepo.

To pravilo velja tudi za samodejno združevanje ob zaključevanju dela: uspešni testi in typecheck pred združitvijo ne preverjajo poznejšega združenega drevesa. Pri več podobnih blokih v isti datoteki uporabi izrazit kontekst posamezne poti.

**Why:** Samodejna združitev sočasnih sprememb iste datoteke je že premaknila veljavne bloke v nepovezane API handlerje, agregacijske in PDF bloke ter pustila nezaključeno kodo zunaj registracije poti. Pri usklajevanju skupne datoteke poročil so bile tudi ponavljajoče se poizvedbe zamenjane z vsebinsko nepovezano poizvedbo, čeprav je bil prvotni lokalni diff omejen na pošiljanje e-pošte ali zgodovino izvozov in je TypeScript prestal.

**How to apply:** Če zaključno preverjanje po sinhronizaciji javi nove napake, primerjaj celoten končni diff z osnovno različico oziroma pravilnim staršem, posebej podobne ponovljene bloke. Obnovi samo nenamerne spremembe in poškodovane bloke ter ponovno preveri končno drevo in sosednje poti.
