---
name: GitHub repozitorij
description: URL glavnega GitHub repozitorija za ta projekt (POS + ZCS bridge + vse)
---

# GitHub repozitorij

**URL:** https://github.com/Bookie-Mikrona/POS

**Zakaj:** Uporabnik ga je posredoval večkrat. Vedno kloniraj/pushai na ta naslov.

**Opomba:** ZCS Android printer bridge izvorna koda (Kotlin/Java APK) je prav tako v tem repozitoriju.

## Čistost Git zgodovine

Lokalne Gradle cache mape ne sodijo v repozitorij. Če prvi push vsebuje veliko zgodovino z build cache objekti, pripravi čist posnetek nad trenutnim oddaljenim `main`, polno staro zgodovino pa pred tem ohrani na ločeni varnostni veji.

**Why:** Replitov Git panel lahko zelo velik prvi prenos zavrne s splošnim `PUSH_REJECTED`, čeprav oddaljena veja nima dodatnih commitov.

**How to apply:** Pred prvim večjim pushom preveri velikost Git objektov in največje mape. Izloči samo obnovljive cache mape; izvorne kode, dokumentov in potrebnih distribucijskih datotek ne odstranjuj.
