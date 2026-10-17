---
name: Git prenosi in tihe izgube
description: Varnostno pravilo za odkrivanje funkcij, ki izginejo med prenosom ali preoblikovanjem Git zgodovine.
---

Po vsakem prenosu, združevanju oddaljene zgodovine ali obnovi glavne veje primerjaj celotno drevo s stanjem tik pred posegom. Ne zanašaj se samo na seznam commitov ali običajen pregled izbrisov.

**Why:** Pri tem projektu so med prenosom iz glavne veje tiho izginile cele POS funkcije, API-poti, izvorne sheme in migracije, ne da bi trenutna zgodovina pokazala jasen commit za posamezne izbrise. Podobna izguba se je zgodila že prej.

**How to apply:** Pred prenosom ohrani namensko referenco na celotno drevo. Po prenosu primerjaj izbrisane poti, spremembe registracij poti, OpenAPI pogodbo, sheme in migracije. Izgubljene dele vračaj selektivno ter jih uskladi z novejšimi spremembami; ne prepisuj celotne veje in ne ponavljaj migracij na slepo.

To pravilo velja tudi za samodejno združevanje ob zaključevanju dela: uspešni testi in typecheck pred združitvijo ne preverjajo poznejšega združenega drevesa. Pri več podobnih blokih v isti datoteki uporabi izrazit kontekst posamezne poti.

**Why:** Besedilno uspešna združitev ponavljajočih se blokov ni zagotovilo njihove vsebinske pravilnosti; preverjanje mora zajeti tudi končno združeno drevo. To velja za API handlerje, agregacije, PDF in testne bloke: uspešna združitev lahko premakne vsebino v nepovezan blok ali izgubi nov preizkus.

**How to apply:** Če zaključno preverjanje po sinhronizaciji javi nove napake, primerjaj celoten končni diff z osnovno različico oziroma pravilnim staršem, posebej podobne ponovljene bloke. Obnovi samo nenamerne spremembe in poškodovane bloke ter ponovno preveri končno drevo in sosednje poti.

Primerjaj tudi vsebino testnih podatkov, ne le imen in pričakovanj testov.

**Why:** Pri združitvi so bile različne priprave PDF testov zamenjane z isto prazno tabelo, čeprav so pričakovanja še vedno zahtevala več strani in konkretne zneske. Takšna poškodba lahko ostane zunaj skupnega validacijskega nabora.

**How to apply:** Po obnovi podobnih ponovljenih blokov zaženi tudi namenske preizkuse prizadetih poročil in PDF-jev; uspešen skupni ukaz ni dokaz za teste, ki jih ta ne vključuje.

Pri obnovi testne datoteke primerjaj tudi seznam testnih primerov s pravilnim staršem in z nameravanimi novimi preizkusi.

**Why:** Samodejna združitev lahko odstrani cele preizkuse in pusti le njihove deklaracije v drugih blokih. Popravek napak prevajalnika zato še ne zagotovi ohranjene regresijske pokritosti.

**How to apply:** Obnovi manjkajoče stare in nove primere ter zaženi celotno prizadeto testno datoteko, ne le izbora novih testov.

Preverjanje mora zajeti tudi podedovane napake iz novo prevzetega starša, ne le trenutnega diff-a.

**Why:** Uspešno lokalno preverjanje pred združitvijo ne zagotavlja pravilnosti pozneje prevzetega izhodišča; avtomatsko združevanje lahko znova odstrani že preverjen popravek.

**How to apply:** Primerjaj starša z zadnjo pravilno različico prizadetih blokov, popravek preveri tudi v shranjenem drevesu in pred končnim preverjanjem obnovi deklaracije skupnih knjižnic.

Pri ponavljajočih se poškodbah podobnih anonimnih obravnavalnikov poti uporabi ločene, poimenovane funkcije z jasno poslovno vlogo.

**Why:** Pri usklajevanju podobnih poročil so se deklaracije, telesa poti in ponavljajoči se bloki pomešali tudi brez očitnih konfliktnih oznak. Samo popravek sintakse ni zagotovil ohranitve obeh poti.

**How to apply:** Ob lokalnem popravku jasno razloči obravnavalnike in preveri vsako prizadeto pot po uskladitvi; ne prepisuj drugih veljavnih sprememb cele datoteke.

Generirane API sheme po združitvi regeneriraj iz trenutne specifikacije, namesto da ročno združuješ posamezne deklaracije.

**Why:** Ročno združene deklaracije lahko ostanejo nepopolne ali napačno razvrščene; uspešen typecheck ne zagotavlja pravilnega vrstnega reda inicializacije ob uvozu.

**How to apply:** Po regeneraciji preveri tudi dejanski uvoz oziroma zagon API-ja; uspešno preverjanje deklaracij samo po sebi ne odkrije takšne napake v generirani kodi.
