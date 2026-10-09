---
name: POS paketi podjetja
description: Pravila za razmerje med paketom podjetja, zmožnostmi enot in neimplementiranimi funkcijami.
---

Paket `Lite | Standard | Extended` je na nivoju podjetja in predstavlja zgornjo mejo. Dejanski dostop je vedno presek paketa in zmožnosti aktivne enote; paket ne nadomesti profilov ali nastavitev enot.

Znižanje paketa z odprtim delom je treba zavrniti; izsilitev je dovoljena samo superadminu po izrecni potrditvi tveganja in z revizijsko sledjo. Povišanje paketa zaradi odprtega dela ne sme biti blokirano.

**Why:** Uporabnik zahteva, da sprememba paketa ne odvzame dostopa do funkcij, potrebnih za zaključek obstoječega dela.

**How to apply:** Blokade izklopa zmožnosti enote in znižanja paketa morajo uporabljati skupna pravila. Pri nedoločenih statusih ne izmišljaj osnutkov; omejitev jasno navedi.

**Why:** Ena aplikacija mora podpirati različne komercialne pakete brez podvojenih različic in brez možnosti, da bi nastavitev enote obšla strežniško paketno omejitev.

**How to apply:** Vsako novo paketno funkcijo dodaj v osrednji katalog, preslikaj vse zasebne in javne poti ter jo preveri na strežniku. Obstoječa POS podjetja pri prvi migraciji dobijo Extended; odsoten zapis vedno pomeni Lite. `self_service` se ne sme vključiti ali oglaševati, dokler nima dejanskega toka.

Pri spremembi paketa morajo odprte POS seje ponovno prebrati `/pos/auth/me`. Realtime obvestilo se sme poslati le povezavam istega podjetja; globalni POS SSE broadcast ni primeren za avtorizacijske podatke.

Pri pravilih z alternativnimi zmožnostmi mora vsaj ena ista zmožnost biti dovoljena na enoti in v paketu. KDS dovoljuje kuhinjo ali točilnico; označevanje postavke naročila kot pripravljene ostaja vezano samo na kuhinjo.

**Why:** Bar in kavarna imata KDS brez kuhinje. Ločena preverjanja »enota ima katerokoli« in »paket ima katerokoli« bi omogočila obvoz, če bi zadovoljila različni zmožnosti.

**How to apply:** Za avtorizacijo in revizijo preslikav uporabljaj celotno pravilo, ne samo prve zmožnosti iz združljivostnega resolverja.