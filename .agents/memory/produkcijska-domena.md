---
name: Produkcijska domena
description: Kako varno določiti trenutni produkcijski naslov aplikacije.
---

Trenutni primarni produkcijski naslov je `https://Bookie-ERP.replit.app`, vendar ga je treba pred vsako uporabo znova preveriti prek deployment metadata in ne sklepati iz preteklih domen ali razvojnega okolja.

**Why:** Shranjeni zapis je avgusta 2026 napačno navajal `double-entry-ledger.replit.app`, medtem ko je deployments service kot dejanski javni primarni naslov potrdil `Bookie-ERP.replit.app`.

**How to apply:** Za QR kode, CORS, e-pošto, OAuth povratne poti in webhooke vedno pridobi aktualni `primaryUrl`; razvojnih `.replit.dev` domen ali starega spomina ne uporabljaj kot produkcijski vir.
