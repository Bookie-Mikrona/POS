---
name: ERP company header
description: Pravilo za tenantno pravilne ERP API klice iz uporabniško ključanega CompanyContexta.
---

ERP poročilo mora svoj API zahtevek nedvoumno vezati na trenutno izbrano ERP podjetje, ne na globalni lokalni fallback.

**Why:** ERP CompanyContext izbiro hrani pod uporabniško ključanim localStorage ključem, medtem ko generični clientov fallback bere zastareli globalni ključ. Brez eksplicitne glave lahko zahtevek ostane brez podjetja ali pade v POS kontekst istega uporabnika.

**How to apply:** Preveri dejanski odhodni zahtevek in scenarije uporabnika brez POS članstva ter uporabnika z vlogami v več podjetjih oziroma hkrati v ERP in POS.