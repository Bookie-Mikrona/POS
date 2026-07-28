---
name: POS nastavitve HTTP caching
description: Cache-Control no-store je obvezen za nastavitve endpoint; ETag/304 blokira auto-fill vrednosti
---

**Pravilo:** `/api/nastavitve` GET handler mora imeti `res.setHeader("Cache-Control", "no-store, max-age=0")` pred `res.json(...)`.

**Why:** Express privzeto generira ETag za vsak JSON odgovor. Brskalnik shrani ETag in pošilja `If-None-Match` na naslednje zahteve. Ko se auto-fill doda naknadno (IBAN, BIC, matična, idZaDdv iz companies tabele), je response body drugačen → nov ETag → 200. Toda: če je bil cached response zakeširan PRED uvedbo auto-filla (stari browser HTTP cache), se stari ETag ujema s starim response-om in strežnik vrne 304 s starimi (praznimi) vrednostmi. Ker nastavitve so per-enota in per-podjetje, HTTP caching prinese več škode kot koristi.

**How to apply:** Vsakič ko se dodaja kakršenkoli auto-fill v nastavitve GET handler, preveri da je `Cache-Control: no-store` header prisoten. Velja za oba GET handler-ja (per-enota in globalni).
