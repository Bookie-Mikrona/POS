---
name: OpenAPI format generator
description: Omejitve Orval/Zod generiranja formatov uuid in uri v skupni API specifikaciji.
---

V skupni OpenAPI specifikaciji ne uporabljaj `format: uuid`, `format: uri` ali `format: email`, dokler generirani Zod odjemalec uporablja trenutno Zod 3 različico; taka polja opiši kot `string`.

**Why:** Orval generira `zod.uuid()`, `zod.url()` oziroma `zod.email()`, ki v uporabljeni Zod 3 različici ne obstajajo in zato podrejo skupni library typecheck.

**How to apply:** Pri novih ali spremenjenih UUID/URL/e-poštnih poljih uporabi `type: string` (po potrebi nullable ali s preverjenim `pattern`); varnostno validacijo URL-ja izvedi v zapisovalnem toku. Po spremembi zaženi codegen in typecheck.

Pri celoštevilčnih vhodih ne predpostavljaj, da jih generirani validator tudi zavrne kot decimalke.

**Why:** Trenutni Orval za OpenAPI `type: integer` lahko ustvari samo `zod.coerce.number()` z mejami, brez `.int()`. Pogodba tako sama ne prepreči npr. leta z decimalnim delom.

**How to apply:** Za leta, mesece in druge diskretne vrednosti preveri generirano validacijo ter po potrebi na strežniški meji izrecno zahtevaj `Number.isInteger`; dodaj regresijski primer z decimalnim vhodom.

## Sorodna opozorila

- [Nepovezan drift generiranih datotek](openapi-codegen-drift.md) — po codegenu preveri generated diff; nepovezane stare pogodbene spremembe ne sodijo v trenutno nalogo.