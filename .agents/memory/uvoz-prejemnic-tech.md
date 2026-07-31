---
name: Uvoz prejemnic — tehnološki sklad
description: Odločitve o implementacijskem jeziku in orodjih za modul uvoza prejemnic
---

## Tehnološki sklad

Zaledje je **TypeScript + Drizzle ORM + Express** (ne Python).

### Shema
- Nove tabele kot Drizzle `pgTable()` definicije v `lib/db/src/schema/pos/` (npr. `uvoz-prejemnic.ts`)
- Migracija prek `drizzle-kit generate` → SQL datoteka v `lib/db/src/migrations/009-uvoz-prejemnic.sql`

### SQL funkcije (izjema)
- `upari_postavko()`, `potrdi_uparjanje()`, `naziv_norm()`, `gtin_norm()`, `neto_po_rabatih()` ostanejo v SQL (pg_trgm trigram iskanje nima native Drizzle wrapperja)
- Kličejo se z `db.execute(sql\`SELECT...\`)` iz TypeScript

### Parsers
| Parser | Knjižnica |
|--------|-----------|
| CSV | `papaparse` |
| XLSX | `exceljs` ali `xlsx` |
| XML (e-SLOG, UBL, CII) | `fast-xml-parser` |
| Kanonični DTO validacija | Zod schema |

### Ključni FK popravki glede na SQL delta datoteko 08
SQL delta ima ⚠ PREVERI anotacije — dejanska BOOKIE ERP shema:
- Tabela: `prejemnice` (ne `prejemnica`)
- Tabela: `prejemnice_postavke` (ne `prejemnica_postavka`)
- Tabela: `artikli` (ne `artikel`)
- Dobaviteljski FK: `shranjeni_kupci.id` (ne `partner.id`)
- Tenant ključ: `enota_id` (ne `podjetje_id`)
- Tip artikla: boolean `nabavni_artikel = TRUE` (ne `tip IN ('NABAVNI','NABAVNO_PRODAJNI')`)
- Cena na enoto: `cena_kos` (ne `cena_enota`)
- `artikel_id` je NOT NULL v `prejemnice_postavke` → uvoz potrebuje staging čakalno vrsto

**Why:** Potrdil uporabnik pri pregledu dejanskih Drizzle schema datotek julij 2026.
