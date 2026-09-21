---
name: Gostinski poslovni dan
description: Domensko pravilo za razvrščanje gostinskega POS prometa po poslovnih dnevih.
---

Gostinski poslovni dan ni koledarski dan. Pred konfigurirano začetno uro enote, privzeto 04:00, dogodek pripada prejšnjemu poslovnemu datumu; ob začetni uri in pozneje pripada tekočemu datumu. Pravilo velja samo za gostinske POS in povezane operativne tokove, ne za splošne ERP dokumentne datume.

**Why:** Gostinski promet se nadaljuje po polnoči. Koledarski filtri so zato razdelili isti delovni dan med zalogo, pripravljeno hrano, poročila in knjiženje.

**How to apply:** Vedno uporabi časovni pas Europe/Ljubljana in konfigurirano začetno uro enote. Prometne meje naj bodo `[od, do)`, da dogodek točno na začetku naslednjega dne ni dvakrat vključen. Simulacijski datum mora ostati podprt.