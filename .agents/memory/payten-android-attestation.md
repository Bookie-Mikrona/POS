---
name: Payten Android attestation
description: Varnostna meja za samodejno potrditev Payten JSON-ECR plačila iz spletnega POS-a.
---

Payten JSON-ECR `status` opisuje stanje aplikacije, ne konkretne transakcije, `header.hash` pa je neključan SHA-512 checksum in ni podpis. Brskalniški callback zato nikoli ni zadosten dokaz za izdajo računa.

**Why:** Chrome/PWA ne more avtentično sprejeti Paytenovega Android broadcast rezultata. Samodejna potrditev potrebuje native receiver na povezani POS napravi in neizvozni ECDSA ključ iz Android Keystore.

**How to apply:** Pred launchom trajno rezerviraj immutable card attempt. Native bridge naj uporabi skrivni request ID, ločen naključni response action capability in deterministični ECR ID, preveri originalne JSON-ECR bajte ter podpiše samo allowlistirana polja brez PAN-a ali celotnega odziva. Callback receiver registriraj dinamično samo za trenutni capability; ne uporabljaj statičnega exported receiverja z javnim action imenom. Backend mora podpis vezati na company/enoto/napravo/ključ/attempt, preveriti Approved + EUR + exact cents, globalno rezervirati provider referenco in vsak nejasen izid pustiti UNKNOWN.

Pairing javnega ključa je server-owned konfiguracija. Generični endpointi za napravo ga ne smejo prepisati ali odstraniti, prvi enrollment pa mora biti atomaren.

**Why:** Read-then-write pairing in splošni `nastavitveJson` update omogočata race oziroma obhod nespremenljive povezave naprave.

**How to apply:** Ključ vpiši samo prek namenskega zaklenjenega enrollment toka; rotacija mora biti izrecna in ločena. Recovery po reloadu mora obnoviti celoten plačilni snapshot ter pred izdajo ponovno dokazati isti attempt in isti kartični znesek, da potrjeno kartično plačilo ne postane gotovina.