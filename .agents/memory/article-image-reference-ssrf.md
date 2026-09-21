---
name: Zunanje slike – SSRF
description: Varnostna pravila za pridobivanje slikovnih referenc s spletnih povezav.
---

Zunanje referenčne slike se ne smejo pridobivati z vzorcem »DNS preveri, nato fetch po imenu«. Povezava mora iti neposredno na enkrat razrešen in preverjen javni IP; TLS SNI in `Host` naj vseeno ostaneta prvotna domena. To velja samostojno za vsak preusmeritveni korak.

**Why:** Ponovno DNS razreševanje ob dejanski povezavi omogoči DNS-rebinding na notranje ali metadata naslove. Neskončni oziroma počasni tokovi in MIME-spoofing pa lahko izčrpajo vire ali neveljavne bajte pošljejo modelu.

**How to apply:** Blokiraj notranje, rezervirane, loopback, link-local, multicast ter dokumentacijske IPv4/IPv6 naslove; za vsak odgovor omeji velikost in absolutni čas branja, zapri zavrnjene/preusmeritvene tokove ter sprejmi le formate s skladno MIME glavo in magic bytes.