---
name: Operativna poročila – obseg
description: Pravila dostopa in datumskih mej pri združenih POS operativnih poročilih.
---

Združena operativna poročila so podjetniški pregled za administrativne vloge: `admin` vidi vse aktivne poslovne enote podjetja, `admin_enote` pa samo svojo aktivno enoto.

**Why:** Enote istega podjetja imajo lahko različne začetne ure poslovnega dne. En skupni UTC interval bi zato promet nekaterih enot pripisal napačnemu poslovnemu datumu, širši dostop vloge `admin_enote` pa bi kršil izolacijo enote.

**How to apply:** Pri vsaki novi razčlenitvi operativnih poročil najprej določi dovoljene enote po vlogi, nato za vsako enoto posebej izračunaj interval `[od, do)` v `Europe/Ljubljana` iz njenega začetka poslovnega dne in šele nato združi rezultate. Pri mizah vedno vrni tudi prostor; številka mize sama ni dovolj, ker se ponavlja po prostorih.

Pregledi zunanjih operacij morajo strogo ločiti dokončno neuspešen izid od nejasnega izida. `unknown` zahteva ročno preverjanje in ni dovoljenje za samodejno ponovitev.

**Why:** Timeout pri kartičnem ponudniku ali FURS lahko nastopi po dejansko izvedeni operaciji; prikaz kot navadna napaka bi lahko uporabnika napeljal k dvojni bremenitvi ali fiskalizaciji.

Pregled zaključkov blagajn mora uporabljati isti vir blokad kot dejanski Z-zaključek. Manjkajoča uskladitev gotovine je procesna blokada, zabeležena razlika z obveznim razlogom pa ločeno finančno odstopanje.

**Why:** Ločena poročevalska pravila bi lahko dan prikazala kot pripravljen za zaključek, čeprav ga transakcijski Z-postopek pravilno zavrne; odstopanje z razlogom pa je dovoljeno in ni isto kot manjkajoča kontrola.

**How to apply:** Stanje zaključka izpelji iz Z-zapisa, skupnega pomočnika za blokade in trajne uskladitve gotovine; zaklenjen Z ima prednost pred poznejšim operativnim stanjem.

Pri poročilih dostav je zamuda samo neterminalna dostava s pretečenim `predvidenaDostava`. Statusa `dostavljeno` in `preklicano` nista aktivna, vendar ostaneta vidna kot ločeni zgodovinski skupini.

**Why:** Terminalni dostavi po roku ni več mogoče operativno pomagati, njeno skrivanje pa bi izkrivilo pregled uspešnosti in preklicev.

**How to apply:** Aktivne sezname filtriraj po dostavnem statusu, ne po glavnem statusu naročila; čas dostave ali preklica beri iz append-only zgodovine statusov.

Normativno porabo v operativnem poročilu vedno beri iz zgodovinsko knjiženih gibov zaloge tipa `poraba`, ne iz trenutne definicije normativa.

**Why:** Poznejša sprememba recepture ne sme za nazaj spremeniti količine ali vrednosti že izvedene porabe.

**How to apply:** Gibe filtriraj po poslovnem intervalu posamezne enote prek vhodnega artikla; količine in vrednosti seštevaj absolutno, ker so porabe knjižene kot negativni izhodi.

Operativni pregled zalog šteje negativno količino kot kritično, ničelno količino pa ločeno kot prazno; brez nastavljenega minimalnega stanja ne ugibaj praga »nizke zaloge«.

**Why:** Enoten poljuben prag (na primer 5 kosov) je napačen za različne merske enote in porabo; opozorilo mora temeljiti na zanesljivem podatku ali nastavitvi.

**How to apply:** Vrednost inventurnega odstopanja prikaži absolutno, količinsko razliko pa s predznakom; uporabi zgodovinski posnetek razlike in cene na postavki inventure.

Dosegljivost tiskalnika je zanesljivo določljiva samo za agentni tiskalnik z njegovim heartbeat zapisom; vgrajen tiskalnik brez heartbeata označi kot »ni potrditve«, ne kot nedosegljiv.

**Why:** Android mostovi za vgrajene tiskalnike nimajo strežniškega heartbeat kanala, zato odsotnost zapisa ne pomeni okvare.

**How to apply:** Agent je nedosegljiv po 10 minutah brez signala; neuspešne in čakajoče tiskalne naloge štej v izbranem poslovnem intervalu enote in le za konkretno ime tiskalnika.

Promet po načinu plačila mora iz razdeljenih plačil izločiti napitnino iz njenega dejanskega zajemnega kanala; napitnina ostane ločena metrika zaposlenega.

**Why:** Kartični oziroma gotovinski znesek lahko vključuje napitnino, računovodski prodajni promet pa je ne vključuje.

**How to apply:** Pri prodaji artikla uporabi zgodovinski naziv postavke, natakarja združuj po trajnem ID-ju izmene, čas priprave pa meri iz KDS nastanka do bump/ack dogodka.

Odpise v operativnem poročilu beri iz potrjenih zapisnikov kala pripravljene hrane, ne iz vseh ročnih izdajnic.

**Why:** Izdajnica je splošno zalogovno zmanjšanje in lahko pomeni interno porabo ali prenos; potrjen zapisnik kala vsebuje namenski razlog, količino in zgodovinsko vrednost odpisa.