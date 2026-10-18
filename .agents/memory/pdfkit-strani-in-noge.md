---
name: PDFKit strani in noge poročil
description: Samodejni prelomi pri absolutno postavljenih nogah in preverjanje dejanskih strani PDF.
---

Pri poročilih PDFKit ne zaupaj vnaprej izračunanemu številu strani. Tudi absolutno postavljeno besedilo blizu spodnjega roba lahko med dodajanjem nog na že sestavljene strani sproži samodejen prelom in ustvari prazne strani; široka imena v fiksnih vrsticah lahko preidejo v naslednjo vrstico, če niso omejena po višini.

**Why:** Izvoz bruto bilance s 65 konti je imel devet strani namesto dveh: nekaj strani je vsebovalo samo glavo ali nogo, oznaka strani je bila napačna, daljši naziv pa se je prelil čez sosednjo vrstico. Šele preverjanje dejanskega PDF, ne izračuna po številu vrstic, je pokazalo obe težavi.

**How to apply:** Pri vsakem popravku večstranskih PDF poročil generiraj primer z resničnim obsegom podatkov, preštej dejanske strani in vrstice, preveri oznake strani ter vizualno preglej prvo in zadnjo stran. Besedilo v fiksnih vrsticah omeji na višino vrstice; noge riši brez samodejnega preloma.

Pri absolutnih nogah `lineBreak: false` ne zadostuje, če hkrati podaš `width`: eksplicitna širina aktivira PDFKitovo ovijanje in lahko premakne številko strani na novo prazno stran.

**Why:** Dejanski PDF je kljub izključenemu prelomu dobil dodatno stran samo s številko strani; odstranitev širine pri nogi je preprečila samodejno paginacijo.

**How to apply:** V absolutnih nogah ne podajaj `width`; desno poravnavo izračunaj z `widthOfString` in eksplicitnim x, ker sama možnost `align: "right"` brez širine ne poravna besedila. Pri dinamičnih dodatkih noge izriši šele po sestavi vseh strani.

Vrstni red besed v `pdftotext -bbox` ni nujno vizualni vrstni red vrstic, posebej ob različnih velikostih pisave v isti tabeli.

**Why:** Prilagojene velikosti dolgih številskih izpisov lahko spremenijo bralni vrstni red ekstraktorja, čeprav PDF geometrija ostane pravilna.

**How to apply:** Za geometrijske preizkuse razvrsti sidra vrstic po koordinati y in številke preverjaj v celotnem pravokotniku vrstice, ne po enakosti njihove zgornje koordinate z nazivom.