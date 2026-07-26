---
name: DDV zavezanec logika
description: Kako se določi, ali je podjetje zavezanec za DDV — davčna številka vs ID za DDV
---

## Pravilo (nikoli ne spreminjaj)

- `davcnaStevilka` = 8-mestna davčna številka podjetja (ima jo vsako podjetje, brez SI predpone)
- `idZaDdv` = "SI" + davcnaStevilka (samo DDV zavezanci imajo to; nezavezanci imajo prazno polje)

**Iz tega sledi:**
- `jeDdvZavezanec = !!(nastavitve?.idZaDdv)` — neprazno polje = zavezanec
- Nikoli ne izhajaj iz `davcnaStevilka.startsWith("SI")` — to je napačno

**Why:**
Vsako podjetje ima 8-mestno davčno številko. ID za DDV (SI + davčna) je dodeljen samo DDV zavezancem.
Nezavezanec nima ID za DDV — polje je prazno.

**Nastavitve API:**
- `idZaDdv` ključ v key-value tabeli nastavitve
- Shranjeno per-enota (ne FURS_KLJUCI_PO_PODJETJU)
- Privzeta vrednost: "" (prazna = ni zavezanec)
- V Settings.tsx: prikazati skupaj z `davcnaStevilka`

**Logika preračuna cen na prejemnicah:**
- Zavezanec shranjuje NETO cene (brez DDV)
- Nezavezanec shranjuje BRUTO cene (z DDV)
- Toggle "Neto/Bruto" pove, kako so cene na dobavnici
- konvertirajCeno(vnos, davek, vrstaCen, jeDdvZavezanec) → cena, ki se shrani
