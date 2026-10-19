---
name: ZCS most – razvojna različica brez izdajnih ključev
description: Uporabnik ne bo kupil offline fiskalnih ključev; most za ZCS Z92 se dostavlja kot razvojna (debug) različica.
---

Offline fiskalni ključi (BOOKIE_OFFLINE_AUTHORITY_*) ne obstajajo in jih uporabnik ne namerava kupiti, ker so predragi.

**Why:** Uporabnik je to izrecno zavrnil (stroški); o tem je bilo že govora prej.

**How to apply:** Ne predlagaj izdajne (release) gradnje ZcsPrinterBridge in ne sprašuj po ključih. Most zgradi z `gradle assembleDebug` (isti razvojni podpisni ključ kot prejšnje različice, zato se namesti čez staro). Offline fiskalizacija ostane nevklopljena.
