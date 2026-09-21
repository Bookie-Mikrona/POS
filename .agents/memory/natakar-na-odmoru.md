---
name: Natakar na odmoru
description: Pravilo razpoložljivosti natakarja pri izdaji POS računa med odprtim odmorom.
---

Natakar z odprtim odmorom ni razpoložljiv operater pri izdaji računa. Če je bil že izbran, se izbira takoj ponastavi na »Brez natakarja«; izdaja računa je blokirana, dokler ni izbran drug razpoložljiv natakar ali se odmor ne zaključi. Po zaključku odmora je natakar znova na voljo.

**Why:** Odprta izmena ne pomeni, da je natakar v tistem trenutku razpoložljiv. Račun, izdan med njegovim odmorom, mu ne sme biti pripisan.

**How to apply:** Vsi sedanji in prihodnji tokovi izdaje računov morajo preveriti tudi odprt odmor, ne le odprte izmene. »Brez natakarja« je prehodno stanje prikaza in nikoli dovoljenje za izdajo računa.