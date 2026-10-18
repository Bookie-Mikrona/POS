---
name: Delovni imenik pnpm filtra
description: Relativne izhodne poti pomožnih skriptov ob zagonu iz filtriranega paketa.
---

Pomožni skript, zagnan prek `pnpm --filter ... exec`, naj ne predpostavlja, da je trenutni delovni imenik koren repozitorija.

**Why:** Pri preverjanju PDF je skript ustvaril datoteko z enakim relativnim imenom znotraj paketa namesto v želeni mapi pri korenu; poznejši pregled zato sprva ni našel datoteke.

**How to apply:** Izhodno pot izpelji iz lokacije skripta ali jo podaj kot absolutno pot; pred uporabo ustvarjenega sredstva preveri dejansko pot.

Za ciljni Vitest zagon uporabi `pnpm --filter @workspace/api-server exec vitest run <testne-poti>` brez dodatnega `--` pred potmi.

**Why:** Oblika `pnpm --filter @workspace/api-server test -- <testne-poti>` je v tem okolju z Vitest 4 prezrla ciljni izbor in pognala celoten nabor, tudi teste odvisnosti.

**How to apply:** Če želiš preveriti samo izbrane datoteke, uporabi neposredni `exec`; potrebni migracijski predkorak izvedi posebej.

Po združitvi sprememb lahko deklarirane odvisnosti in lockfile že vsebujejo paket, lokalni `node_modules` pa še ne.

**Why:** Združitev kode ne zagotovi osvežitve nameščenih povezav paketov; napaka »Cannot find module« zato ni nujno manjkajoča deklaracija odvisnosti.

**How to apply:** Pred spremembo različic ali dodajanjem odvisnosti primerjaj deklaracijo, lockfile in nameščeni paket. Če se razlikuje samo namestitev, jo uskladi z obstoječim lockfile brez spreminjanja različic.