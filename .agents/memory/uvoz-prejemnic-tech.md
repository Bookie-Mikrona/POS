---
name: Uvoz prejemnic — tech sklad
description: Arhitekturne odločitve in pasti pri integraciji Claudovega uvoz-prejemnic modula v BOOKIE ERP/POS
---

## Naučene lekcije (integracija bookie-uvoz-prejemnic.zip)

### 1. drizzle-orm/node-postgres vrača QueryResult, ne array

BOOKIE uporablja `drizzle-orm/node-postgres` (ne `postgres-js`).  
`db.execute<T>(sql`...`)` vrne `QueryResult<T>`, ne `T[]`.

**Pravilni vzorci:**
```ts
// Destructured array — TREBA dodati .rows
const [prvi] = (await db.execute<T>(sql`...`)).rows;

// Named rows — samo destructuriraj
const { rows: seznam } = await db.execute<T>(sql`...`);

// Brez rezultata (UPDATE/INSERT brez RETURNING) — nič posebnega
await db.execute(sql`...`);
```

**Napaka:** sed/Python skripta, ki avtomatsko dodaja `(await...).rows`, pogosto
pokvarila SQL template literale (multi-line) ali dodala `.rows` tam, kjer ni
treba (bare `await tx.execute`). Popravljati eno-po-eno.

### 2. Claudove predpostavke → BOOKIE zamenjave

| Claude predpostavka | BOOKIE dejanski |
|---|---|
| `partnerji` tabela | `shranjeni_kupci` |
| `podjetje_id` / `podjetjeId` | `enota_id` / `enotaId` |
| `a.naziv` | `a.ime` |
| `a.sifra` | `NULL::text` (ne obstaja) |
| `a.osnovna_enota` | `a.enota_mere` |
| `a.tip IN ('NABAVNI',...)` | `a.nabavni_artikel = TRUE` |
| `bigserial`/`bigint` PKs | `serial`/`integer` |
| `gln` stolpec na partnerjih | ne obstaja |
| `zahtevajPravico(...)` middleware | `requireEnota` (iz `../../middlewares/pos`) |
| `AvtoriziranRequest` | `PosRequest` (iz `../../middlewares/pos`) |
| `from '../../db'` | `from '@workspace/db'` |
| `req.uporabnik.id` | ne obstaja; `req.clerkUserId` je string |
| `req.uporabnik.podjetjeId` | `req.enotaId` |

### 3. Manjkajoči paketi — potrebno instalirati

```bash
pnpm --filter @workspace/api-server add papaparse fast-xml-parser imapflow mailparser zod
pnpm --filter @workspace/api-server add -D @types/papaparse @types/mailparser
```

### 4. Uvoz registracija rut

Route datoteki `uvoz-prejemnic.ts` in `uvoz-profili.ts` morata biti registrirani
v `artifacts/api-server/src/routes/pos/index.ts` z:
```ts
router.use(requireEnota, uvozPrejemniceRouter);
router.use(requireEnota, uvozProfiliRouter);
```

### 5. zajem.ts — IMAP urnik

Datoteka `zajem.ts` je skeduliran IMAP zajem. Ob integraciji:
- `podjetje_id` → `enota_id` povsod
- `db.execute<Predal>` constraint → cast z `as unknown as Predal[]`
- Nullable `enota_id` → `p.enota_id ?? 0` ko se posreduje kot `number`

### 6. Drizzle ORM — esbuild build preveri sintakso

esbuild (za razliko od tsc) se **ustavi ob sintaktičnih napakah** SQL template
literalov. TypeScript type napake ignorira. Vedno zaženemo `node ./build.mjs`
za kontrolo sintakse pred testiranjem.
