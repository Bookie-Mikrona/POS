---
name: QR alkohol brez blokade
description: Poslovno pravilo za alkoholne artikle v javnih QR naročilih.
---

QR naročilo z alkoholom se ob oddaji takoj pošlje v običajno pripravo in ne sme
čakati na ločeno POS potrditev. Osebje preveri starost in morebitno opitost ob
postrežbi pri mizi.

**Why:** Uporabnik je izrecno zavrnil predhodni blokirni tok, ker naj priprava
ne čaka na preverjanje, ki se opravi osebno ob dostavi naročila.

**How to apply:** `jeAlkohol` ostane informativni podatek o artiklu, vendar ga
ne uporabljaj za QR usmerjanje, KDS filtre, potrditev osebja ali besedilo o
čakanju v javnem meniju. Zgodovinska polja sledljivosti lahko ostanejo v bazi,
vendar ne smejo blokirati priprave.