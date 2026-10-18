---
name: Odzivnost velikih izvozov poročil
description: Pri merjenju velikih izvozov vključuj React prehode stanja in dejanske klike, ne le časa izdelave datoteke.
---

Odzivnost izvoza meri od klika do končanega prenosa, tudi med prikazom napredka in napake; hkrati preveri dejansko interakcijo z obstoječo stranjo.

**Why:** Pri analitičnem poročilu je tudi po premiku Excel serializacije v ločeno nit sprememba stanja gumba povzročila večsekundno blokado zaradi ponovnega izrisa velike tabele. Samo merjenje delovne niti tega ne odkrije.

**How to apply:** Pri prihodnjih večjih izvozih uporabi brskalniški heartbeat in uporabniški klik. Preveri tudi strošek React ponovnega izrisa in ne predpostavljaj, da ločena nit sama zagotovi odzivnost.
