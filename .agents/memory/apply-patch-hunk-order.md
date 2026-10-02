---
name: Vrstni red odsekov pri apply_patch
description: Spremembe iste datoteke razvrsti po vrstnem redu v izvorni datoteki.
---

Pri več odsekih sprememb iste datoteke razvrsti odseke od začetka proti koncu datoteke.

**Why:** Tukajšnji apply_patch je zavrnil pravilne kontekste, ko so odseki najprej iskali na koncu in se nato vrnili proti začetku. Enak popravek v izvornem vrstnem redu je uspel.

**How to apply:** Ob nepričakovanem zavračanju znanega konteksta najprej preveri vrstni red odsekov; ne ponavljaj istega neuspešnega popravka ali prepisuj cele datoteke.