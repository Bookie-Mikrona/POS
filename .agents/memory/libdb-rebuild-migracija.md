---
name: lib/db rebuild in migracija
description: Kdaj in kako rebuildat lib/db TypeScript deklaracije; drizzle date() tip; tsx za teste; psql za migracije
---

## Pravilo: lib/db rebuild po spremembi sheme

`lib/db` ima `"composite": true` in `"emitDeclarationOnly": true` v tsconfig. Ko se shema
spremeni (nov stolpec, nova tabela), so `.d.ts` datoteke v `lib/db/dist/` zastarele.
Simptom: `tsc --noEmit` na api-server prijavi "Property X does not exist on type" ali
"Module has no exported member Y" — čeprav je koda pravilna.

**Fix:**
```bash
cd lib/db && npx tsc -p tsconfig.json
```
Nato `tsc --noEmit` v api-server prikaže resnične napake (ne slamnate).

**Why:** api-server/tsconfig.json ima `"references": [{ "path": "../../lib/db" }]`. TypeScript
project references berejo `.d.ts` iz `dist/`, ne source neposredno — kljub temu da package.json
exports kažejo na `.ts` vire.

## Drizzle date() tip

Drizzle `date("stolpec")` v pg-core je v TypeScriptu `string` (format `YYYY-MM-DD`), ne `Date`.
Ko vstaviš ali posodobiš, pošlji ISO string:
```typescript
// NAPAČNO:
datumDokumenta: new Date(datumDokumenta)
// PRAVILNO:
datumDokumenta: datumDokumenta ? new Date(datumDokumenta).toISOString().slice(0, 10) : null
```
Drizzle `timestamp()` pa sprejema Date objekte — razlika je med date() in timestamp().

## tsx za teste

tsx je dosegljiv pri:
- `node_modules/.pnpm/node_modules/.bin/tsx` (root, za teste v `tests/`)
- `artifacts/api-server/node_modules/.bin/tsx` (za api-server specifično)

Primer zagona testov (vsi 9 zeleni):
```bash
node_modules/.pnpm/node_modules/.bin/tsx tests/uvoz-prejemnic/01-csv.test.ts
```

## psql za SQL migracije

psql je na voljo prek nixpkgs:
```bash
which psql   # /nix/store/.../bin/psql
psql "$DATABASE_URL" -f lib/db/src/migrations/0009_uvoz_prejemnic.sql
```
Migracija 0009 je idempotentna (IF NOT EXISTS / OR REPLACE).
