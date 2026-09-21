---
name: Native file picker v Radix dialogu
description: Kako ohraniti Radix dialog odprt ob izbiri datoteke prek skritega inputa.
---

Pri odpiranju sistemskega izbirnika datotek iz skritega `<input type="file">` lahko Radix Dialog začasno zazna interakcijo ali fokus izven dialoga in sproži `onOpenChange(false)`.

**Why:** Uporabnik je pri nalaganju slike artikla izgubil odprto urejevalno okno, čeprav je strežnik sliko uspešno shranil.

**How to apply:** Ob programskem odpiranju file inputa vodi kratkotrajni `ref` za aktivno izbiro. V `onOpenChange`, `onPointerDownOutside` in `onInteractOutside` prepreči zapiranje, dokler izbira ali upload traja; `ref` počisti v `onChange` in dodaj časovni fallback za preklic izbire.