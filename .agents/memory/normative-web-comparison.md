---
name: Spletna primerjava normativov
description: Varnostna in podatkovna pravila za read-only primerjanje POS normativov z javnimi recepti.
---

Spletni vir je preverjen samo, če URL in naslov izvirata neposredno iz tipiziranega rezultata strežniškega spletnega iskalnika, ne iz prostega besedila modela. Primerjava potrebuje vsaj dva različna dovoljena uredniška ali institucionalna vira.

**Why:** Model lahko izmisli verjeten URL ali zamenja merske osnove; en sam poljuben recept ni zanesljiva primerjava.

**How to apply:** Strežnik sprejme le HTTPS povezave iz omejenega seznama zaupanja vrednih domen in nikoli sam ne odpira uporabniškega ali modelskega URL-ja. Količine deli s številom porcij ter pretvarja samo nedvoumne enote iste dimenzije. Manjkajoče porcije, enote ali nezdružljive mere označi kot neprimerljive. Rezultat je vedno read-only; spremembo normativa lahko izvede le ločen ročno potrjen tok.

Ročno potrjen spletni predlog mora biti vezan na podpisan strežniški dokaz in monotono revizijo celotnega normativa; vsi zapisovalci normativa uporabljajo isti owner zaklep in revizijo.

**Why:** Primerjava samo stare količine in ID-ja vrstice ne zazna ABA spremembe, no-op predlog pa je mogoče ponovno predvajati in ustvarjati lažne audit zapise. Zamenjava celotnega normativa lahko sicer sočasno prepiše potrjeno spremembo.

**How to apply:** Podpiši parent/row/ingredient, revizijo, staro in novo lokalno količino/enoto, preverjeni vir ter čas. Predlog naj kratko poteče in nikoli ne dovoli staro=novo. Ob potrditvi zakleni owner in vse izbrane vrstice, preveri revizijo/vrednosti/enote, nato atomsko spremeni vse vrstice, zapiši append-only audit in revizijo povečaj natanko enkrat. Ena zastarela vrstica zavrne celoten paket.

Kratkotrajni cache spletne primerjave mora biti tenant-scoped, vsebinsko naslovljen z natančnim odtisom celotnega normativa, single-flight za isti ključ ter omejen globalno in po enoti.

**Why:** Sam TTL ne prepreči več sočasnih plačljivih klicev ob istem cache missu, neomejeno število različnih in-flight raziskav pa omogoči stroškovno in pomnilniško preobremenitev. Cache brez enote v ključu lahko razkrije podatke drugega tenanta.

**How to apply:** Ključ naj vključuje enoto, artikel, natančno ciljno ime iz raziskovalnega vprašanja, monotono revizijo ter deterministično urejene identitete, imena, količine in enote vseh vrstic. Zadetek vrne prvotni čas in citate. Neuspeha ne shrani; neuspešna ročna osvežitev ne izbriše dobrega vnosa. Enake sočasne zahteve združi, različne pa omeji globalno in po enoti.

Ročna uporaba podpisanega spletnega predloga zahteva izrecno kanonično pozitivno decimalno `X-Enota-Id` glavo, ki se mora ujemati z enoto, razrešeno v POS avtorizaciji; splošni fallback enote tu ni dovoljen.

**Why:** Različna razčlenitev glave ali tihi fallback lahko potrjen predlog uporabi v drugi enoti, kot jo je uporabnik izrecno izbral.

**How to apply:** Zavrni manjkajočo, query-only, hex, znanstveno ali drugače nekanonično vrednost pred razčlenjevanjem predloga in pred vsako mutacijo ali auditom.