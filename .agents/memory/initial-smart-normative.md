---
name: Začetni spletni normativ
description: Meja med spletnim predlogom in ustvarjanjem nabavnih surovin za prodajno jed brez normativa.
---

Začetni predlog ne sme sam ustvarjati artiklov. Nove nabavne surovine in normativ se zapišejo šele po izrecni potrditvi v eni transakciji; za vsako novo surovino mora človek potrditi, da ni polizdelek, ter izbrati nabavno davčno kategorijo brez samodejne predizbire.

**Why:** Iz imena v spletnem receptu ni mogoče zanesljivo ugotoviti, ali gre za surovino, pripravljeno sestavino, pijačo ali blago z drugo nabavno stopnjo DDV. Napačna privzeta kategorija bi samodejno ustvarila napačen šifrant.

**How to apply:** Spletni predlog omeji na prodajne prehrambne artikle brez normativa, brez sestave iz drugih artiklov ali polizdelkov. Ob potrditvi znova preveri enoto, stanje artikla, ime jedi, revizijo in ujemanje sestavin; ob dvomu zavrni celoten zapis. Preverjen URL spletnega iskalnika potrjuje obstoj vira, ne pa resničnosti modelovega prepisa sestavin, količin ali porcij; to mora ostati jasno označeno kot nepreverjen predlog.

Enosestavinska alkoholna pijača z eksplicitnim volumnom porcije v imenu potrebuje tudi dejanski spletni rezultat za identiteto izdelka. Odmerek še vedno izračunaj iz naziva, ne iz izdelčne strani; brez preverljivega spletnega rezultata predloga ne ustvarjaj. Večsestavinskih pijač iz naziva ne razčlenjuj.

**Why:** Uporabnik želi, da AI res poišče podlago na spletu, ne da predlog napiše samo iz imena. Spletni recepti za en odmerek kupljene pijače niso pravi dokaz; spletni rezultat lahko potrdi identiteto izdelka, ne pa količine odmerka.

**How to apply:** Vir mora biti tipiziran rezultat spletnega iskalnika, ne izmišljen modelov URL. Poreklo predloga podpiši ločeno od spletnega recepta in jasno povej, kaj vir dejansko potrjuje. Pred potrditvijo znova preveri ime, alkoholno klasifikacijo in razbrano količino; kupljeni artikel in normativ nastaneta šele po ročni klasifikaciji in potrditvi.

Za prodajne jedi dovoli poleg primerjave popolnih receptov tudi ločeno označen približen AI-normativ, če obstaja vsaj en tipiziran zadetek na odobreni receptni domeni. Zadetek potrjuje le obstoj povezave, ne ocene sestavin ali količin; brez zadetka predloga ne podpisuj.

**Why:** Gostinski naziv in velikost porcije pogosto nimata dveh popolnih, med seboj identičnih spletnih receptov. Uporabnik želi uporaben približek, kakršnega AI poda za veliko fižolovo solato, vendar ne lažnih citatov ali avtomatsko knjiženih količin.

**How to apply:** Približek naj ima ločeno poreklo in jasno opozorilo, eno pozitivno številčno količino ter nedvoumno enoto za vsako surovino; razpone in alternative je treba razrešiti pred predlogom. Obstoječa ročna potrditev surovine, davčne kategorije in celotnega normativa ostane obvezna.

Spletni model lahko za isto jed enkrat vrne uporaben JSON, drugič prosti tekst. Enkraten popravljalni poziv za strukturiran približek je sprejemljiv samo z URL-ji, ki so dejansko prišli iz tipiziranih iskalnih rezultatov prvega klica; brez njih vrni jasno napako.

**Why:** V praksi je isti začetni predlog enkrat uspel in drugič padel kot »raziskava ni vrnila strukturiranih podatkov«. Samo sprostitev razčlenjevalnika ne zagotavlja uporabnega izida.

**How to apply:** Popravljalni korak naj uporablja ločen prisilno strukturiran odgovor in ponovno pošlje rezultat skozi ista pravila izvora, surovin in količin. Ne obravnavaj modelovega prostega besedila ali samodejno navedenih URL-jev kot dokaz spletnega zadetka.