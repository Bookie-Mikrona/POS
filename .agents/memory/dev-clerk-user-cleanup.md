---
name: Brisanje razvojnih prijav
description: Varno ločevanje prijavnih računov Clerk od uporabniških vlog in poslovne zgodovine v razvojni bazi.
---

Uporabniških računov, izbranih po e-poštnem naslovu, ni mogoče določiti zgolj iz
razvojnega PostgreSQL: e-poštne naslove hrani Clerk, lokalne vloge pa ID uporabnika
Clerk. Razvojni in produkcijski Clerk obravnavaj kot ločena vira. Pri potrjenem
odstranjevanju razvojnih računov po e-pošti najprej razreši točne ID-je v razvojnem
Clerku, nato odstrani njihove lokalne vloge in po potrebi razveži opcijsko povezavo
z zaposlenim; poslovne in revizijske zgodovine ne briši zgolj zato, ker je bil
odstranjen prijavni račun.

**Why:** Brisanje po e-pošti samo v PostgreSQL bi prijavne račune pustilo aktivne,
brisanje zaposlenih ali revizijskih zapisov pa bi izgubilo zgodovino poslovanja.

**How to apply:** Pred posegom preveri razvojno okolje, preglej prizadete vloge,
zaščiti ostale račune in naredi kopijo razvojne baze. Po posegu ločeno preveri
prijavne račune Clerk in preostale lokalne povezave.