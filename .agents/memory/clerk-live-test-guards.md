---
name: Clerk razvojni integracijski testi
description: Nepričakovane lastnosti SDK-ja pri varovanju dejanskih read-only integracijskih testov.
---

Read-only Clerk integracijski preizkus mora dovoliti oba GET klica za seznam
uporabnikov: seznam in ločeno štetje. Omejitev zgolj na pot seznama prekine tudi
veljaven SDK klic.

**Why:** Pri preverjanju resničnega SDK-ja se je pokazalo, da paginirani rezultat
nastane iz vzporednih zahtev za podatke in število. SDK napako blokirane zahteve
ovije, zato je brez varnih faznih sporočil videti kot napaka pogodbe odgovora.

**How to apply:** Ob nadgradnji SDK-ja preveri njegove dejanske zahtevane poti.
Ne razširi dovoljenja na vse poti ali zapisovalne metode zgolj zato, da test uspe.
SDK uporablja sprotni globalni fetch v testnem runtime-u, zunaj njega pa lahko
zajame fetch ob uvozu; pri takem varovanju zahtevaj testni runtime in izključi
telemetrijo. Iz napak izpisuj le vnaprej določene faze in HTTP status, ne celotne
SDK napake ali odgovora.
