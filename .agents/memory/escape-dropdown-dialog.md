---
name: Escape v dropdownu znotraj dialoga
description: Konvencija za preprečitev zapiranja Radix Dialog ob Escape + pravilno prikazovanje dropdowna brez overflow clippinga.
---

## Pravilo

Spustni seznam znotraj Radix dialoga mora med odprtostjo obdržati formo odprto ob Escape in ostati geometrijsko vezan na svoj vnos.

**Why:** Radix dialog Escape prestreže pred Reactovim `onKeyDown`, pomičen obrazec ali sprememba velikosti pa lahko sicer pusti seznam nad napačno vrstico.

**How to apply:** Escape ob odprtem seznamu obravnavaj na ravni `DialogContent`. Če je seznam izven pomičnega dela forme, ga ob pomiku in spremembi velikosti ponovno poravnaj z vnosom ali ga varno zapri.

**Why:** Radix capture vs. React bubble timing; `overflow: visible` na flex dialog sesede `flex-1` vsebino.
