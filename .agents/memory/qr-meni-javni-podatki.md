---
name: Javni QR meni - kaj gost vidi
description: Pravila za javni odgovor QR menija (opisi, zaloga, kategorije) in enoten zapis zneskov/miz.
---
Javni API gostu ne vrne internih opomb, točnih količin ali praznih kategorij.

**Why:** Opisi artiklov so vsebovali interne normativne oznake v [oglatih oklepajih], gost pa je videl število porcij.

**How to apply:** Opis, ki se začne z »[«, je interna opomba (vrne se null); zaloga je le status na_voljo/se_malo/ni_na_voljo s konstanto praga; kategorija je vidna le, če ima artikel z qr_na_voljo. Zneski v PWA in POS gredo prek skupnega formatterja (vejica, presledek pred €); predpona »Miza« se doda le, če je ime ne vsebuje že.
