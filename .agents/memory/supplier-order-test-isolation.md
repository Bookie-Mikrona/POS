---
name: Izolacija testov naročil dobaviteljem
description: Zanesljivi count in stranični aserti pri integracijskih testih na skupnem tenant fixtureu.
---

Pri integracijskih testih, ki si delijo podjetje in enoto do `afterAll`, omeji pričakovano število zadetkov na unikatno testno številko naročila ali enakovreden identifikator. Filter samo po statusu, dobavitelju ali opombi lahko zajame zapise, ki jih je ustvaril drug test v istem scenariju.

**Why:** Skupni tenant vsebuje legitimne naročilne zapise iz drugih testnih primerov; agregatni testi brez dodatne izolacije postanejo odvisni od vrstnega reda testov.

**How to apply:** Pri preverjanju `total`, zadnje strani ali prazne strani v dobaviteljskih naročilih pošlji unikatni iskalni izraz za testno množico in še vedno preveri, da tuje enote niso vključene.
