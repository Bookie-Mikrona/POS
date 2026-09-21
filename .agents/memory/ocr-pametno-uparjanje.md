---
name: Pametno OCR uparjanje artiklov
description: Varnostna pravila za hibridno lokalno in AI uparjanje nazivov artiklov iz dobavnic.
---

OCR uparjanje naj najprej kanonizira merske zapise in embalažne okrajšave ter pripravi širši tenant-scoped seznam dovoljenih kandidatov. AI sme nato samo razvrstiti oziroma izbrati ID iz tega seznama. Ročna potrditev brez šifre in GTIN mora trajno shraniti preslikavo po enoti, dobavitelju in kanoničnem nazivu.

**Why:** Prag trigramske podobnosti lahko izloči pravilen artikel pri enakovrednih zapisih, kot sta `0,5 l` in `5 dl`, ali pri OCR-okrajšavah, kot sta `stv` in `stek`. Preslikava, vezana le na postavko dobavnice, se ob izbrisu dokumenta izgubi.

**How to apply:** Modelski ID vedno preveri proti vhodnemu seznamu, AI predloga nikoli ne uporabi za samodejno potrditev, ob timeoutu, omejitvi ali neveljavnem rezultatu pa nadaljuj z determinističnim izidom. Naziv-only preslikave nikoli ne uporabljaj globalno ali med dobavitelji.

En sam aktiven nabavni ali nabavno-prodajni artikel z natančno enakim kanoničnim nazivom v isti enoti je determinističen 100-% samodejni zadetek. Če obstaja več takih artiklov, se noben ne izbere samodejno.

**Why:** AI-predlog za sicer enak naziv ostane namerno ročen, kar pri nespornih enojnih zadetkih po nepotrebnem ustavi uvoz.

**How to apply:** Pred podobnostnim in AI-korakom preveri kanonično enakost naziva ter samodejno potrdi samo enoličen zadetek. Shranjeni kandidati morajo pred API odgovorom vedno postati veljaven seznam, ne glede na predstavitev v podatkovnem gonilniku.

Nabavni in povratno-embalažni artikel mora biti aktiven za zalogo in uparjanje, tudi če ni prodajni artikel.

**Why:** Če ustvarjanje nabavnega artikla uporabi prodajno vidnost kot njegov splošni status, artikel obstaja v šifrantu in ima pravilen naziv, vendar ga uparjanje zavrne kot neaktivnega.

**How to apply:** Pri novem nabavnem ali embalažnem artiklu nastavi `aktiven = true`; uporabnikova izbira aktivnega statusa velja le za nabavno-prodajni artikel. Samodejno uparjanje še naprej uporablja samo aktivne nabavne kandidate.

Običajna OCR-vhodna postavka se primerja samo z aktivnimi nabavnimi in nabavno-prodajnim artikli. Povratna embalaža in samo prodajni oziroma izdajni artikli niso kandidati.

**Why:** Embalažni artikel, kot je prazna steklenica, ima lahko iste znamke in mere kot pijača ter zaradi tehničnega nabavnega statusa napačno prehiti pravi vhodni artikel.

**How to apply:** Omejitev uporabi v vseh poteh uparjanja: GTIN, dobaviteljska šifra, naučen naziv, natančni naziv, podobnostno iskanje, AI dovoljeni kandidati in ročno iskanje.

Če uporabnik na zadnji povezani prejemnici popravi število enot na paket, mora shranjevanje isto vrednost prenesti v aktivno povezavo dobavitelj–artikel.

**Why:** Napačno prvič vneseno pakiranje se sicer ponavlja na vsaki naslednji prejemnici in zahteva vedno nov ročni popravek.

**How to apply:** Posodobitev naj velja le za isto enoto, dobavitelja in artikel ter ne sme dovoliti, da starejši prevzem prepiše povezavo, osveženo z novejšim prevzemom.