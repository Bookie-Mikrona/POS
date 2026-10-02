---
name: OpenAPI format generator
description: Omejitve Orval/Zod generiranja formatov uuid in uri v skupni API specifikaciji.
---

V skupni OpenAPI specifikaciji ne uporabljaj `format: uuid` ali `format: uri`, dokler generirani Zod odjemalec uporablja trenutno Zod 3 različico; taka polja opiši kot `string`.

**Why:** Orval generira `zod.uuid()` oziroma `zod.url()`, ki v uporabljeni Zod 3 različici ne obstajata in zato podreta skupni library typecheck.

**How to apply:** Pri novih ali spremenjenih UUID/URL poljih uporabi samo `type: string` (po potrebi nullable); varnostno validacijo URL-ja izvedi v zapisovalnem toku. Po spremembi zaženi codegen in typecheck.

## Sorodna opozorila

- [Nepovezan drift generiranih datotek](openapi-codegen-drift.md) — po codegenu preveri generated diff; nepovezane stare pogodbene spremembe ne sodijo v trenutno nalogo.