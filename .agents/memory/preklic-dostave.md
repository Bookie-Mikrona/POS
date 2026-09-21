---
name: Zaključek dostave
description: Pravilo za ločitev terminalnega dostavnega statusa od glavnega statusa POS naročila.
---

Preklicana ali dostavljena dostava se ne prikazuje več med aktivnimi telefonskimi naročili, vendar sprememba dostavnega statusa sama ne spremeni glavnega statusa POS naročila.

**Why:** Samodejni preklic glavnega naročila bi lahko brez izrecne odločitve osebja posegel v že pripravljene postavke, ročno obravnavo ali računovodski tok. Dostavni zapis in zgodovina morata ostati ohranjena.

**How to apply:** Operativne poizvedbe in UI naj izločijo dostave s statusom `preklicano` ali `dostavljeno`; morebitno zapiranje ali preklic glavnega naročila naj ostane ločeno, izrecno dejanje. Deaktiviran prej dodeljeni kurir ne sme blokirati preklica, njegova dodelitev pa ostane na naročilu in v zgodovini.