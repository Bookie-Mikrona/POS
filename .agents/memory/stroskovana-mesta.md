---
name: Šifrant stroškovnih mest
description: Implementacija CRUD šifranta cost_centers — migracija, API, UI, testi
---

## Migracija
- 030-cost-centers-ext.sql: dodani tip (check direktna|indirektna|projektna), parent_id (FK self ON DELETE SET NULL), odgovorna_oseba
- Obstoječa tabela ohranjena; nova polja nullable

## DB schema (lib/db/src/schema/dimensions.ts)
- tip, parentId (uuid), odgovornaOseba dodani kot nullable polja
- parentId nima FK constraint v drizzle (je v SQL migracij)

## API (/companies/:companyId/cost-centers)
- DELETE ruta: soft-delete, ko SM je v rabi (journal_entry_lines, osnovna_sredstva, podrejeni_sm) → 200 { deaktivirano, razlog }; sicer 204
- PATCH: preverjanje cikla navzgor po drevesu pred shranjevanjem parentId
- Import iz @workspace/db: journalEntryLinesTable, osnovnaSredstvaTable sta dostopna prek export * from schema

## UI (artifacts/erp-web/src/pages/stroskovana-mesta.tsx)
- Pot: /stroskovana-mesta
- Shell navigacija: MapPin ikona, poleg Dimenzij
- Hierarhija: parent dropdown izključi SM-same in potomce (preverjanje na client strani)
- Soft-delete opozorilo v dialog pred odstranitvijo

## Vitest mock vzorec za dimensions.ts
- Obvezno: `vi.mock("drizzle-orm")` z eq/and/or/asc/isNull kot vi.fn()
- Obvezno: `vi.mock("@clerk/express")` z getAuth (NE vi.mock requireAuth direktno)
- buildApp() v beforeEach — ne v modular scope
- updateChain.where() mora vrniti `{ returning: () => Promise.resolve([...]) }` (ne direktno Promise)

**Why:** brez drizzle-orm mock-a, pravi drizzle SQL builders padejo na mock tabelah (string stolpci ≠ ColumnConfig).
