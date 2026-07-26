---
name: DDV zavezanec logika
description: Kako se določi, ali je podjetje zavezanec za DDV — companiesTable.zavezanecDdv
---

## Pravilo (nikoli ne spreminjaj)

- `davcnaStevilka` = 8-mestna davčna številka podjetja (ima jo vsako podjetje, brez SI predpone)
- `idZaDdv` = "SI" + davcnaStevilka — samo DDV zavezanci imajo to; nezavezanci imajo prazno polje
- `companiesTable.zavezanecDdv` = boolean zastavica, ki direktno pove, ali je podjetje DDV zavezanec

**Iz tega sledi:**
- `jeDdvZavezanec` se bere iz `user.jeDdvZavezanec` (prek `useAuth()`)
- `user.jeDdvZavezanec` pride iz `auth.ts` → `companiesTable.zavezanecDdv ?? false`
- Nikoli ne izhajaj iz `idZaDdv.startsWith("SI")` ali `davcnaStevilka.startsWith("SI")` — to je napačno
- Poslovni partnerji (šifrant) imajo svojo `shranjeni-kupci.zavezanecDdv` zastavico — ločena stvar

**Why:**
Vsako podjetje ima 8-mestno davčno številko (brez SI). ID za DDV (SI + davčna) je dodeljen samo DDV
zavezancem, toda zanesljiva zastavica je `companiesTable.zavezanecDdv` — direktni boolean.
Ob vsaki spremembi auth profila se `user.jeDdvZavezanec` osvezi avtomatično.

**Implementacija v Zaloge.tsx:**
```ts
const { user } = useAuth();
const jeDdvZavezanec = user?.jeDdvZavezanec ?? false;
```

**Logika preračuna cen na prejemnicah:**
- Zavezanec shranjuje NETO cene (brez DDV)
- Nezavezanec shranjuje BRUTO cene (z DDV)
- Toggle "Neto/Bruto" pove, kako so cene na dobavnici
- `konvertirajCeno(vnos, davek, vrstaCen, jeDdvZavezanec)` → cena, ki se shrani
- readonly polje ob vnosnem polju prikazuje preračunano ceno v realnem času
