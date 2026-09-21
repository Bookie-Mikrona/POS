---
name: drizzle-kit push --force nevarnost
description: drizzle-kit push --force je katastrofal na obstoječi DB z mešanimi migracijami — truncira tabele in droopa constrainte brez opozorila
---

# drizzle-kit push --force — PREPOVEDANO na produkcijskem ali razvojnem DB

## Pravilo
Nikoli ne zaženi `drizzle-kit push --force` na DB-ju, ki ima obstoječe podatke in ročno pisane SQL migracije. Ukaz:
1. TRUNCIRA tabele kadar želi dodati/preimenovati UNIQUE constraint in ugotovi, da ne more narediti tega brez truncatea
2. DROPA VSE constrainte (FK, CHECK, UNIQUE) in jih postopoma dodaja nazaj — če kateri koli korak propade, ostanejo constrainti MANJKAJOČI
3. Avtomatično potrdi VSE podatkovne izgube (vključno z truncate) brez interaktivne potrditve

## Kaj se je zgodilo (avgust 2026)
- Cilj: odpraviti "Migrations failed validation" opozorilo v Replit UI
- `drizzle-kit push --force` je bil zagnan po migration 052 in 053
- Rezultat: `osnovna_sredstva` in `os_amortizacija_obracun` sta bili IZPRAZNJENI
- Večina FK in CHECK constraintov je izginila iz DB

**Why:** DB je imel ročno pisane SQL migracije (001-053) z različnimi poimenovanji constraintov (PG-privzeta _key/_fkey) in Drizzle pričakovanimi (_unique/_fk). Drizzle je zaznal "drift" in z --force odločno "popravil" stanje — vključno s truncate.

## Pravilna rešitev za constraint-name drift

Ne `drizzle-kit push`. Namesto tega:
1. Identificiraj specifičen drift z `drizzle-kit push --verbose` (brez --force!)
2. Napiši SQL migracijo, ki SAMO preimenuje constrainte:
   ```sql
   ALTER TABLE tabela RENAME CONSTRAINT staro_ime TO novo_ime;
   ```
3. Za CHECK constrainte: DROP + ADD znotraj transakcije z IF EXISTS zavarovanji
4. Nikoli ne brisaj backup tabel brez preverjanja, ali jih karkoli kaskadira

## Varno preverjanje schema drift
```bash
# VARNO — samo pokaže razlike, ne aplicira ničesar
cd lib/db && timeout 15 npx drizzle-kit push --verbose 2>&1 | head -100
# Nato ročno napiši migracije za specifične razlike
```

## "Migrations failed validation" v Replit UI
- To opozorilo je posledica constraint-name drifta med DB in Drizzle shemo
- NI nujno kode treba — najprej preveri ali SQL migracije res ne tečejo:
  `psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f migration.sql`
- Če SQL migracije tečejo brez napake → opozorilo je lažno (Drizzle journal manjka)
- Ne zaženi drizzle-kit push da "popravi" ta drift!
