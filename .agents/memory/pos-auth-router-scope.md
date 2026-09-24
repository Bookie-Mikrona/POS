---
name: POS prijavna pot in globalni middleware
description: Usmerjanje POS prijave ne sme biti blokirano z varovali za že izbrano enoto.
---

Preverjanje enote ali podjetja v Expressu ne sme biti montirano na koren glavnega API usmerjevalnika pred potjo za razreševanje POS vloge. Varovalo za podusmerjevalnik mora biti omejeno na njegove URL predpone, ne na celoten preostanek usmerjevalnika.

**Why:** Express izvede `router.use(guard, childRouter)` za vsako naslednjo pot še pred preverjanjem, ali bi podusmerjevalnik sploh ustrezal. V produkciji je tako prijavljena seja dobila 400, ker prijavna pot še nima izbrane enote.

**How to apply:** Ob dodajanju varovanih POS/ERP podusmerjevalnikov preveri prijavno pot na sestavljenem korenskem API usmerjevalniku s simuliranim prijavljenim uporabnikom brez enote; ločeno preveri, da novo dodane poti brez enote ostanejo zaščitene.