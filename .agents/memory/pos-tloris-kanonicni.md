---
name: Kanonični POS tloris
description: Arhitekturna pravila za verzioniran tloris prostorov in združljivost z mizami.
---

Vsak prostor ima en kanoničen, verzioniran dokument tlorisa z geometrijo miz, sten, vrat, prehodov, oznak, območij in dekoracije. Stari položaji na mizi so samo zrcalo za branje; stari API-ji ne smejo več spreminjati geometrije.

**Why:** Dva neodvisna zapisovalna toka sta povzročala razhajanje tlorisa, zastarele verzije in izginjanje miz iz operativnega pogleda.

**How to apply:** Cel dokument shrani atomsko z optimističnim preverjanjem verzije. Kanonični zapis v isti transakciji zrcali položaj, mere, zasuk in obliko mize. Premik mize med prostori zaklene prostora v stabilnem vrstnem redu, nato mizo, ter uskladi oba tlorisa.

Aktivna miza mora vedno imeti element v tlorisu svojega prostora in je v urejevalniku ni dovoljeno izbrisati ali pretvoriti v drug tip elementa.

**Why:** Operativna identiteta mize ni dekorativni element; izpust iz dokumenta bi skril aktivno mizo.

**How to apply:** Strežnik pri shranjevanju dopolni manjkajoče aktivne mize. Polni reset odstrani ročno geometrijo in varno znova razporedi aktivne mize; nad podprto mejo 500 elementov mora odpovedati brez delne spremembe.