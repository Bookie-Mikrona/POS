---
name: Delovni imenik pnpm filtra
description: Relativne izhodne poti pomožnih skriptov ob zagonu iz filtriranega paketa.
---

Pomožni skript, zagnan prek `pnpm --filter ... exec`, naj ne predpostavlja, da je trenutni delovni imenik koren repozitorija.

**Why:** Pri preverjanju PDF je skript ustvaril datoteko z enakim relativnim imenom znotraj paketa namesto v želeni mapi pri korenu; poznejši pregled zato sprva ni našel datoteke.

**How to apply:** Izhodno pot izpelji iz lokacije skripta ali jo podaj kot absolutno pot; pred uporabo ustvarjenega sredstva preveri dejansko pot.