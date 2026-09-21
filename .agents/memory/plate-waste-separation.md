---
name: Ostanki s krožnikov
description: Meje samostojne okoljske evidence in pravilo sledljivih popravkov oddaj.
---

Ostanki s krožnikov so popolnoma ločena interna evidenca odpadkov z oznako 20 01 08. Ne smejo spreminjati artiklov, normativov, naročil, prodaje, zaloge, pripravljene hrane, kala, računovodstva ali temeljnic.

**Why:** Masa vrnjenih ostankov je okoljski podatek po poslovnem dnevu, ne operativna poraba ali računovodski odpis.

**How to apply:** Modul naj uporablja samo poslovno enoto, datum, maso v kilogramih in opisne podatke. Ne dodajaj tujih ključev ali prožilnikov v operativne in računovodske evidence.

Oddaje zbiralcu so nespremenljive. Vsak popravek je nova vrstica, obvezno povezana z izvirno oddajo iste poslovne enote; skupni popravek ne sme zmanjšati neto oddane mase pod nič.

**Why:** Neposredno spreminjanje ali nevezani popravki bi uničili revizijsko sled fizične oddaje.

**How to apply:** Povezavo in tip zapisa preveri tako v API transakciji kot z bazno omejitvijo; izvirno oddajo med preverjanjem zakleni.