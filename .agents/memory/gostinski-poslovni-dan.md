---
name: Gostinski poslovni dan
description: Domensko pravilo za razvrščanje gostinskega POS prometa po poslovnih dnevih.
---

Gostinski poslovni dan ni koledarski dan. Pred konfigurirano začetno uro enote, privzeto 04:00, dogodek pripada prejšnjemu poslovnemu datumu; ob začetni uri in pozneje pripada tekočemu datumu. Pravilo velja samo za gostinske POS in povezane operativne tokove, ne za splošne ERP dokumentne datume.

**Why:** Gostinski promet se nadaljuje po polnoči. Koledarski filtri so zato razdelili isti delovni dan med zalogo, pripravljeno hrano, poročila in knjiženje.

**How to apply:** Vedno uporabi časovni pas Europe/Ljubljana in konfigurirano začetno uro enote. Prometne meje naj bodo `[od, do)`, da dogodek točno na začetku naslednjega dne ni dvakrat vključen. Simulacijski datum mora ostati podprt.

Isto pravilo velja za poslovni mesec: od prvega dne ob začetni uri enote do prvega dne naslednjega meseca pred to uro. Pri začetku ob 04:00 promet do 03:59:59 naslednjega prvega dne še pripada prejšnjemu mesecu.

**Why:** Uporabnik je izrecno zahteval, da tudi mesečne temeljnice upoštevajo nastavljeno uro, ne zgolj koledarskih datumov.

**How to apply:** Uporabi interval `[prvi dan ob začetni uri, naslednji prvi dan ob začetni uri)` za posamezno enoto in ne omejuj zadnje minute na 03:59:00.

Prehod leta ne prekine gostinskega poslovnega meseca. Pri začetku ob 04:00 sodita promet in poraba 1. januarja pred 04:00 v decembrski POS zbirnik prejšnjega leta.

**Why:** Uporabnik je izrecno navedel novoletno zabavo kot primer, ki mora ostati v decembrskem prometu in porabi.

**How to apply:** Meje decembra izračunaj do 1. januarja naslednjega leta ob uri enote; promet točno ob meji pripada januarju.