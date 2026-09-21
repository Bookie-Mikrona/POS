---
name: POS izbira podjetja
description: Pravilo za varno in predvidljivo razreševanje POS članstva pri uporabnikih z več podjetji.
---

POS middleware ne sme izbrati prve aktivne vloge uporabnika, kadar jih je več. Če je prisoten `X-Company-Id`, ga mora uporabiti in preveriti, da zanj obstaja aktivna POS vloga. Brez glave se lahko samodejno razreši samo natanko ena aktivna POS vloga; sicer mora zahteva dobiti jasno napako za izbiro podjetja.

**Why:** Naključni vrstni red baze lahko uporabniku z več podjetji pripne napačen tenant in s tem povzroči dostop ali knjiženje v napačnem podjetju.

**How to apply:** Enako pravilo uporabi za operativne enotne poti, company-scope upravljanje ter POS fallback v računovodskih poteh. Globalni superadmin ostane izjema za dostop do enote.

**POS odjemalec:** Po uspešni POS prijavi mora klient v skupnem localStorage uskladiti aktivno podjetje z razrešenim POS podjetjem, še preden naloži podatke.

**Why:** ERP in POS uporabljata isti origin. Zastarela ERP izbira lahko pošlje napačen `X-Company-Id`, middleware pa upravičeno zavrne zahtevek za sicer veljavnega POS uporabnika.

**How to apply:** Pri menjavi ali obnovi POS seje prepiši oziroma odstrani skupno izbiro podjetja; neposredni POS `fetch` klici naj pošljejo tudi trenutno enoto.