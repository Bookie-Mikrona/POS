---
name: Začetni spletni normativ
description: Meja med spletnim predlogom in ustvarjanjem nabavnih surovin za prodajno jed brez normativa.
---

Začetni predlog ne sme sam ustvarjati artiklov. Nove nabavne surovine in normativ se zapišejo šele po izrecni potrditvi v eni transakciji; za vsako novo surovino mora človek potrditi, da ni polizdelek, ter izbrati nabavno davčno kategorijo brez samodejne predizbire.

**Why:** Iz imena v spletnem receptu ni mogoče zanesljivo ugotoviti, ali gre za surovino, pripravljeno sestavino, pijačo ali blago z drugo nabavno stopnjo DDV. Napačna privzeta kategorija bi samodejno ustvarila napačen šifrant.

**How to apply:** Spletni predlog je namenjen prodajnim prehrambnim artiklom in neprodajnim, nenabavnim živilskim polizdelkom tipa à la carte ali pripravljena hrana, vedno samo brez obstoječega normativa. Ne uporabi ga za sestavljeni artikel, katerega normativ povezuje druge kulinarične artikle, ali za zgolj nabavni artikel. Ob potrditvi znova preveri enoto, vlogo in klasifikacijo artikla, ime, revizijo in ujemanje sestavin; ob dvomu zavrni celoten zapis. Preverjen URL spletnega iskalnika potrjuje obstoj vira, ne pa resničnosti modelovega prepisa sestavin, količin ali porcij; to mora ostati jasno označeno kot nepreverjen predlog.

Ujemanje nazivov z enakimi besedami v drugačnem vrstnem redu lahko samodejno poveže enolično surovino; širši ali ožji naziv naj bo le ročni predlog, nikoli samodejna povezava.

**Why:** »Rastlinsko olje« in »olje rastlinsko« sta istovetna po besedah, »kristalni sladkor« in »sladkor« pa lahko označujeta različno blago. Iskanje mora pomagati brez tihega ustvarjanja dvojnikov ali napačnih normativov.

**How to apply:** Pri spremembah predloga in iskalnika ohrani razliko med nedvoumnim preurejenim nazivom in delnim ujemanjem; izbiro slednjega vedno prepusti uporabniku ter upoštevaj skladnost merskih enot.

Enosestavinska alkoholna pijača z eksplicitnim volumnom porcije v imenu potrebuje tudi dejanski spletni rezultat za identiteto izdelka. Odmerek še vedno izračunaj iz naziva, ne iz izdelčne strani; brez preverljivega spletnega rezultata predloga ne ustvarjaj. Večsestavinskih pijač iz naziva ne razčlenjuj.

**Why:** Uporabnik želi, da AI res poišče podlago na spletu, ne da predlog napiše samo iz imena. Spletni recepti za en odmerek kupljene pijače niso pravi dokaz; spletni rezultat lahko potrdi identiteto izdelka, ne pa količine odmerka.

**How to apply:** Vir mora biti tipiziran rezultat spletnega iskalnika, ne izmišljen modelov URL. Poreklo predloga podpiši ločeno od spletnega recepta in jasno povej, kaj vir dejansko potrjuje. Pred potrditvijo znova preveri ime, alkoholno klasifikacijo in razbrano količino; kupljeni artikel in normativ nastaneta šele po ročni klasifikaciji in potrditvi.

Za prodajne jedi dovoli poleg primerjave popolnih receptov tudi ločeno označen približen AI-normativ, če obstaja vsaj en tipiziran zadetek na odobreni receptni domeni. Zadetek potrjuje le obstoj povezave, ne ocene sestavin ali količin; brez zadetka predloga ne podpisuj.

**Why:** Gostinski naziv in velikost porcije pogosto nimata dveh popolnih, med seboj identičnih spletnih receptov. Uporabnik želi uporaben približek, kakršnega AI poda za veliko fižolovo solato, vendar ne lažnih citatov ali avtomatsko knjiženih količin.

**How to apply:** Približek naj ima ločeno poreklo in jasno opozorilo, eno pozitivno številčno količino ter nedvoumno enoto za vsako surovino; razpone in alternative je treba razrešiti pred predlogom. Obstoječa ročna potrditev surovine, davčne kategorije in celotnega normativa ostane obvezna.

Spletni model lahko za isto jed enkrat vrne uporaben JSON, drugič prosti tekst. Enkraten popravljalni poziv za strukturiran približek je sprejemljiv samo z URL-ji, ki so dejansko prišli iz tipiziranih iskalnih rezultatov prvega klica; brez njih vrni jasno napako.

**Why:** V praksi je isti začetni predlog enkrat uspel in drugič padel kot »raziskava ni vrnila strukturiranih podatkov«. Samo sprostitev razčlenjevalnika ne zagotavlja uporabnega izida.

**How to apply:** Popravljalni korak naj uporablja ločen prisilno strukturiran odgovor in ponovno pošlje rezultat skozi ista pravila izvora, surovin in količin. Ne obravnavaj modelovega prostega besedila ali samodejno navedenih URL-jev kot dokaz spletnega zadetka.

Podpisani AI-predlog je izhodišče za pregled, ne nespremenljiv seznam. Gostinec lahko odstrani odvečne sestavine, spremeni količino, poveže že obstoječo surovino ali doda manjkajočo; pri samostojni pijači z volumnom odmerka ta izjema ne velja.

**Why:** »3-Bean Salad« se je napačno prenesla v generično fižolovo solato, medtem ko je obstoječe sončnično olje ostalo nepovezano in sol manjkala. Samo boljši modelov poziv te napake ne more zanesljivo preprečiti.

**How to apply:** Urejene vrstice preveri ob transakcijskem shranjevanju znotraj iste enote, ob zaklepu in reviziji ciljne jedi; obstoječi artikel se izbere izrecno po ID-ju, nove surovine pa potrebujejo ročno davčno klasifikacijo in potrditev. Ne spreminjaj zgodovine spletnega vira v trditev, da ta dokazuje ročne popravke.

Za »Fižolova solata – velika« je uporabnik potrdil konzerviran fižol, ne suhega.

**Why:** Priloženi alternativni normativ računa 4,20 kg suhega fižola s kuhanjem; ta količina ni neposredno uporabna za dejansko nabavo konzerviranega fižola in se celo ne sklada z navedeno maso serije.

**How to apply:** Odcejeno količino v jedi loči od nabavne neto količine konzerve. Pretvorbo v porabo nabavnega artikla naredi šele iz podatka o neto in odcejeni masi konkretnega pakiranja; ne predpostavi izkoristka in ne prepiši suhega fižola.

Uporabnik želi konzerviran fižol za gostinsko zalogo voditi v odcejeni masi. Če dobavitelj proda eno konzervo, naj poslovna sled ohrani to pakiranje in polno nabavno ceno, zaloga pa prejme deklarirano odcejeno količino; normativ porablja isto zalogovno enoto.

**Why:** Slanica se zavrže. Če bi zalogo vodili kot skupno maso vsebine, bi normativ, cena na kilogram in inventura šteli tudi neuporabljeno tekočino.

**How to apply:** Uporabnikovi 800 g neto, 480 g odcejeno in 1,20 € so zgolj primer, ne stalne vrednosti artikla. Pri dejanski prejemnici uporabi podatke konkretnega pakiranja (1 kos → 0,480 kg odcejenega v primeru); nabavno ceno preračunaj na odcejeni kilogram (1,20 € / 0,480 kg = 2,50 €/kg), ne izgubi pa izvorne količine in dokumenta dobavitelja.

Velika porcija fižolove solate je okvirno 250 g; v gostinskem obratu se porcije in priprava ne izvajajo s tehtanjem vsake sestavine na gram.

**Why:** Uporabnik je potrdil 250 g kot velikost porcije, nato izrecno opozoril, da strogo gramiranje in zapletene blokade ne ustrezajo dejanskemu gostinskemu delu. Ne želi biti posrednik med agentom in Claudeom.

**How to apply:** Normativ obravnavaj kot praktičen, okviren recept, ne kot zahtevo po tehtanju vsake porcije. Ne dodajaj stroge blokade shranjevanja zaradi odstopanja od 250 g; očitno protislovje v AI-predlogu razreši sam, po potrebi z neposredno konzultacijo modela, in uporabnika ne uporabljaj kot posrednika. Ne prenesi izmišljenih cen ali nepotrjenih pakiranj v šifrant.

Uporabnik je za to jed potrdil vseh devet sestavin predloga: konzerviran fižol, rdečo čebulo, sončnično olje, vinski kis, sladkor, sol, poper, peteršilj in česen. Količin iz predloga ni posebej potrdil.

**Why:** Začetni AI-odgovor je pokazal le eno sestavino, alternativa pa je imela napačno skupno maso; potrjena sestava še ne pomeni potrjenega tehtanega normativa.

**How to apply:** Vse sestavine lahko nastopijo v preglednem osnutku za 250 g porcijo, a preračunane količine ostanejo jasno označene kot ocenjene. Brez izrecne potrditve ne zapisuj normativa ali novih nabavnih artiklov.