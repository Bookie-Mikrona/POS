---
name: Git prenosi in tihe izgube
description: Varnostno pravilo za odkrivanje funkcij, ki izginejo med prenosom ali preoblikovanjem Git zgodovine.
---

Po vsakem prenosu, združevanju oddaljene zgodovine ali obnovi glavne veje primerjaj celotno drevo s stanjem tik pred posegom. Ne zanašaj se samo na seznam commitov ali običajen pregled izbrisov.

**Why:** Pri tem projektu so med prenosom iz glavne veje tiho izginile cele POS funkcije, API-poti, izvorne sheme in migracije, ne da bi trenutna zgodovina pokazala jasen commit za posamezne izbrise. Podobna izguba se je zgodila že prej.

**How to apply:** Pred prenosom ohrani namensko referenco na celotno drevo. Po prenosu primerjaj izbrisane poti, spremembe registracij poti, OpenAPI pogodbo, sheme in migracije. Izgubljene dele vračaj selektivno ter jih uskladi z novejšimi spremembami; ne prepisuj celotne veje in ne ponavljaj migracij na slepo.