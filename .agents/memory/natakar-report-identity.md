---
name: Identiteta natakarja v poročilih
description: Pravilo za združevanje prometa iste osebe po spremembi imena ali priimka.
---

Poročila morajo promet natakarja združevati po trajnem ID-ju profila, kadar ga je mogoče razrešiti prek izmene. Shranjeno ime na računu je zgodovinski posnetek za dokument in ni identiteta osebe.

**Why:** Sprememba priimka istega natakarja je promet razdelila na dve vrstici, čeprav so bile vse izmene vezane na isti profil.

**How to apply:** V agregatih uporabi `natakari_id` kot ključ in trenutno ime profila kot oznako. Samo pri starih oziroma nepovezanih računih brez trajnega ID-ja uporabi shranjeno ime kot nadomestni ključ.