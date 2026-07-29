---
name: Checkpoint skupaj-vidnost-prostor-v1
description: Stanje kode po popravkih otroci/kolicina/prostor/footer julij 2026 — git tag za povratek
---

# Checkpoint: skupaj-vidnost-prostor-v1

**Git tag:** `checkpoint-skupaj-vidnost-prostor-v1`  
**Git commit:** `a9d2b99`  
**Datum:** 2026-07-29

## Kaj je zajeto v tej točki

### Popravki v tej seji
1. **Kaskadni izbris otrok** — `DELETE /narocila/:id/postavke/:postavkaId` zdaj najprej pobriše modifier-otroke, šele nato starša (prepreči osirotele vrstice)
2. **Proporcionalna količina otrok** — ko spreminjaš količino starša, se otrokova količina sorazmerno posodobi (`nova_otrok = round(stara_otrok / stara_starš × nova_starš)`)
3. **Prostor v mobilni glavi** — v zgornji vrstici naročila (mobile) se pred imenom mize prikaže naziv prostora (`Terasa · Miza 1 #42`)
4. **Skupaj + gumb vedno vidna** — layout popravki: `flex-1 min-h-0` na narocilo panelu, `shrink-0` na header in footer, `h-dvh` namesto `h-screen` v App.tsx
5. **Čiščenje osirotenih otrok** — naročilo 85: odstranjeno 8 osirotenih vnosov, skupaj popravljeno 3.50 € → 2.00 €

## Kako se vrniti na to točko

Povej agentovi: **"Vrni se na checkpoint skupaj-vidnost-prostor-v1"** — agent bo uporabil `git checkout checkpoint-skupaj-vidnost-prostor-v1` ali pomagal z rollbackom.

**Why:** Uporabnik je izrecno zahteval poimenovano referenčno točko za kasnejši povratek.
