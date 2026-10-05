---
name: Samodejni spletni alergeni novih surovin
description: Uporabnikovo pravilo za nove nabavne surovine in meje spletnih dokazov.
---

Ob vsakem dodajanju nove nabavne surovine samodejno poišči alergene na spletu in jih dodaj. Pravilo velja tudi za uvoze in surovine, nastale iz samodejnih normativov, ne le za ročni obrazec.

**Why:** Uporabnik je izrecno zahteval samodejno spletno iskanje pri vsaki novi surovini. Ročno potrjene alergenske deklaracije imajo višjo dokazno vrednost od splošnih spletnih navedb.

**How to apply:** Najdene podatke shrani kot nepreverjene, z dejanskimi spletnimi viri. Loči vsebovane alergene od konkretno deklariranih sledi; generične ali pogojne sledi so le opomba. Ujemaj konkretni izdelek oziroma čisto generično surovino, ne druge znamke. Neuspeh ali prazen rezultat nikoli ne pomenita potrditve brez alergenov. Poznejše ročno urejanje oziroma potrjena deklaracija imata prednost pred zapoznelim spletnim rezultatom. Obstoječega kataloga ne preiskuj množično brez izrecnega naročila.

Množično raziskovanje potrebuje časovno omejevanje zahtev in premor ob HTTP 429, ne le omejitev sočasnosti.

**Why:** Pri preverjanju obstoječega kataloga je tudi omejitev na dva sočasna klica povzročila ponavljajoče se HTTP 429; hitro zavrnjene zahteve lahko izčrpajo ponovitve vrste, če ni skupnega premora.

**How to apply:** Spoštuj Retry-After in omejitve ponudnika. Napake zaradi hitrosti loči od neujemanja izdelka ali praznega alergenskega seznama. Ob nadaljevanju množičnega postopka ne ponavljaj že uspešno obdelanih profilov.

Generičen naziv sestavljenega izdelka ni dokaz, da restavracija uporablja spletno najdeni izdelek istega tipa.

**Why:** Pri preverjanju je model po splošnih nazivih predlagal deklaracijo posameznega trgovca za kebab meso in splošno opozorilo o glutenu za pecilni prašek, brez povezave z dejansko dobavljenim izdelkom.

**How to apply:** Brez znamke, izdelkovne oznake, GTIN ali nabavnega dokazila takšne ugotovitve ohrani kot opozorila z viri, ne kot vsebovane alergene ali konkretno deklarirane sledi, tudi če bi profil ostal nepreverjen.