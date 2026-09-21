---
name: Zgodovinski obračun ur
description: Pravilo za trajno pravilno pripisovanje stroškovnega mesta na POS izmenah.
---

Obračun ur mora za vsako izmeno uporabljati nespremenljivo kodo in naziv stroškovnega mesta, veljavna ob odprtju izmene, ne pa trenutnega šifranta.

**Why:** Stroškovno mesto se lahko preimenuje, deaktivira ali odstrani. Zgolj UUID povezava bi takrat zgodovinske ure preimenovala ali prikazala kot »Brez SM«, kar popači poročila.

**How to apply:** Ob nastanku izmene ustvari nespremenljivo oznako. Zgodovinska poročila naj jo obravnavajo kot ločeno identiteto tudi, kadar ima en šifrant v različnih obdobjih različni oznaki; ob uvedbi pravila dopolni stare zapise. Šifrant, na katerega se izmena sklicuje, se ne hard-delete, ampak deaktivira.