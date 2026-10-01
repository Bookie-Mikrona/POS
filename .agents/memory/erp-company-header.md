---
name: ERP company header
description: Pravilo za tenantno pravilne ERP API klice iz uporabniško ključanega CompanyContexta.
---

ERP poročilo mora svoj API zahtevek nedvoumno vezati na trenutno izbrano ERP podjetje, ne na globalni lokalni fallback.

**Why:** ERP CompanyContext izbiro hrani pod uporabniško ključanim localStorage ključem, medtem ko generični clientov fallback bere zastareli globalni ključ. Brez eksplicitne glave lahko zahtevek ostane brez podjetja ali pade v POS kontekst istega uporabnika.

**How to apply:** Preveri dejanski odhodni zahtevek in scenarije uporabnika brez POS članstva ter uporabnika z vlogami v več podjetjih oziroma hkrati v ERP in POS.

Paket izbranih dokumentov pripada podjetju, izbranemu ob začetku nalaganja. Menjava aktivnega podjetja med prenosom ne preusmeri preostalih datotek; paket se nadaljuje za prvotno podjetje, ki mora biti jasno prikazano v napredku.

**Why:** Ena izbira datotek pomeni eno uporabnikovo odločitev o njihovem podjetju. Branje spremenjenega aktivnega konteksta po vsakem asinhronem koraku bi isti paket brez nove potrditve razdelilo med različne poslovne knjige.

**How to apply:** V paketnih operacijah zajemi ciljno podjetje pred prvim čakanjem in tako veži tudi osvežitev seznamov. Sprememba konteksta ni dovoljenje za preusmeritev tekočega paketa.