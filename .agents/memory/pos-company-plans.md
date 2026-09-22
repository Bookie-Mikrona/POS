---
name: POS paketi podjetja
description: Pravila za razmerje med paketom podjetja, zmožnostmi enot in neimplementiranimi funkcijami.
---

Paket `Lite | Standard | Extended` je na nivoju podjetja in predstavlja zgornjo mejo. Dejanski dostop je vedno presek paketa in zmožnosti aktivne enote; paket ne nadomesti profilov ali nastavitev enot.

**Why:** Ena aplikacija mora podpirati različne komercialne pakete brez podvojenih različic in brez možnosti, da bi nastavitev enote obšla strežniško paketno omejitev.

**How to apply:** Vsako novo paketno funkcijo dodaj v osrednji katalog, preslikaj vse zasebne in javne poti ter jo preveri na strežniku. Obstoječa POS podjetja pri prvi migraciji dobijo Extended; odsoten zapis vedno pomeni Lite. `self_service` se ne sme vključiti ali oglaševati, dokler nima dejanskega toka.