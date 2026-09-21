---
name: Status mize in naročila
description: Atomska pravila med odprtimi naročili, zasedbo mize in rezervacijami.
---

Odprtje naročila na mizi ter prehod mize v stanje `zasedena` (vključno s
čiščenjem rezervacije) morata uspeti ali odpovedati skupaj v isti transakciji.
Vsak prehod mize v stanje `prosta` mora biti v samem stavku posodobitve pogojen
z odsotnostjo odprtih naročil na tej mizi in enoti.

**Why:** Ločen zapis ali predhodno preverjanje omogoči, da sočasno odprtje
naročila oziroma vmesna odpoved procesa pusti odprto naročilo na prosti ali
rezervirani mizi.

**How to apply:** Pravilo velja za osebna in QR naročila, zaključevanje in
preklic, izdajo računov, prenose med mizami ter vse administrativne spremembe
statusa mize.