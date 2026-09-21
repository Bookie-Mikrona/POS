---
name: OpenAPI codegen drift
description: Kako ravnati, ko regeneracija API odjemalca pokaže nepovezane stare spremembe pogodbe.
---

Po spremembi OpenAPI vedno preglej vse generirane hunke in v trenutno nalogo obdrži samo tipe, validacijo ter odjemalca, ki izhajajo iz nameravane spremembe pogodbe.

**Why:** Generator lahko razkrije prej neregeneriran drift v drugih delih velike skupne specifikacije. Če tak diff ostane, ozka naloga nehote spremeni nepovezane javne pogodbe.

**How to apply:** Pred zaključkom primerjaj generated diff z ročnim OpenAPI diffom. Nepovezane hunke vrni na izhodišče ali jih obravnavaj v ločeni namenski nalogi; nato ponovno poženi typecheck.