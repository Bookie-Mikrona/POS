---
name: ERP Foundation
description: Skupna Clerk + PostgreSQL infrastruktura z FURS POS Web; architecture decisions
---

## Infrastruktura

- **Monorepo**: pnpm workspace
- **API**: `artifacts/api-server` — Express + Fastify-pino, TypeScript, esbuild bundle
- **ERP frontend**: `artifacts/erp-web` — React + Vite + Clerk auth
- **DB**: `lib/db` — Drizzle ORM, PostgreSQL
- **Auth**: Clerk (CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY)

## POS Backend rute

**Status: INTEGRIRANE IN BUILDIRANE** (2026-07-19)

- 24 POS rut v `artifacts/api-server/src/routes/pos/`
- POS router registriran v `artifacts/api-server/src/routes/index.ts`
- TypeCheck: 0 napak
- Bundle: ~4.3mb (s POS rutami)

**Why:** Rute so bile prenesene iz starega projekta — imele so napačne importe, manjkajoče tipe, napačne API klice.

**Ključni popravki:**
- `alias` iz drizzle-orm → `aliasedTable` (drizzle v0.45) — POZOR: v `glasovni-sinonimi.ts` je `alias` ime DB polja, ne drizzle funkcija!
- `broadcastTo(napravaId, event, payload)` → `broadcast(event, payload)` (pos-sse nima ciljnega broadcast-a)
- `podjetjeDavcna` kolona ne obstaja v nastavitveTable/shranjeniKupciTable — treba izpustiti iz insertov
- `bcryptjs` — treba namestiti runtime paket (`pnpm add bcryptjs` v api-server), ne samo `@types/bcryptjs`
- `crypto.randomUUID()` — uvoziti `randomUUID` direktno iz `node:crypto`, ne aliasirati modula
- `req.session` — Express nima session brez middleware; rešeno z `(req as any).session`
- `r` iz `poisciNaInetis()` vrne `null` — TypeScript ne more narrowati znotraj `if (false)` — rešeno z `const r: any = ...`

## POS Middleware

- `requireEnota` — `artifacts/api-server/src/middlewares/pos.ts` — preverja POS enoto

## Naslednji koraki

- Ustvari `artifacts/pos-web` — blagajniški POS frontend
