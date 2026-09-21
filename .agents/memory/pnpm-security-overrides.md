---
name: PNPM varnostni overrides
description: Pravilna lokacija globalnih dependency overrides v tem monorepu.
---

Globalne varnostne pripone odvisnosti dodajaj v korenski `package.json` pod `pnpm.overrides`, kadar ta razdelek že obstaja. Ne zanašaj se na vzporedni vrhnji `overrides` v `pnpm-workspace.yaml`.

**Why:** PNPM 10 v tem projektu obeh virov ni združil; nove pripone v workspace datoteki niso spremenile tranzitivnih različic, čeprav je namestitev uspela brez napake.

**How to apply:** Po spremembi vedno zaženi namestitev in preveri, da ranljivih različic ni več v `pnpm-lock.yaml`, nato potrdi rezultat še z dependency auditom.