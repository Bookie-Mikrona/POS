---
name: PDFKit strani in noge poročil
description: Samodejni prelomi pri absolutno postavljenih nogah in preverjanje dejanskih strani PDF.
---

Pri poročilih PDFKit ne zaupaj vnaprej izračunanemu številu strani. Tudi absolutno postavljeno besedilo blizu spodnjega roba lahko med dodajanjem nog na že sestavljene strani sproži samodejen prelom in ustvari prazne strani; široka imena v fiksnih vrsticah lahko preidejo v naslednjo vrstico, če niso omejena po višini.

**Why:** Izvoz bruto bilance s 65 konti je imel devet strani namesto dveh: nekaj strani je vsebovalo samo glavo ali nogo, oznaka strani je bila napačna, daljši naziv pa se je prelil čez sosednjo vrstico. Šele preverjanje dejanskega PDF, ne izračuna po številu vrstic, je pokazalo obe težavi.

**How to apply:** Pri vsakem popravku večstranskih PDF poročil generiraj primer z resničnim obsegom podatkov, preštej dejanske strani in vrstice, preveri oznake strani ter vizualno preglej prvo in zadnjo stran. Besedilo v fiksnih vrsticah omeji na višino vrstice; noge riši brez samodejnega preloma.