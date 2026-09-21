---
name: POS cmdk Vitest
description: Testno okolje za POS autocomplete komponente, ki uporabljajo cmdk.
---

Pri Vitest/jsdom testih POS autocomplete komponent, ki uporabljajo `cmdk`, dodaj lokalna testna polyfilla za `ResizeObserver` in `HTMLElement.prototype.scrollIntoView`.

**Why:** jsdom privzeto ne nudi teh brskalniških API-jev, `cmdk` pa ju pokliče ob odpiranju oziroma izbiri v seznamu. Brez tega test pade kljub pravilnemu delovanju v brskalniku.

**How to apply:** Polyfilla sta namenjena samo zadevni testni datoteki oziroma skupnemu testnemu setupu; ne dodajaj ju v produkcijsko kodo.