---
name: ERP Foundation
description: Arhitekturne odločitve za ERP dvostavno knjigovodstvo — skupna infrastruktura z FURS POS Web
---

# ERP Foundation

## Skupna infrastruktura z FURS POS Web
- **Baza**: Skupna PostgreSQL (`DATABASE_URL` runtime-managed)
- **Auth**: Skupni Clerk tenant (Replit-managed). Keys auto-provisioned.
- FURS POS Web je ločen Replit projekt. Skupna baza zahteva eksplicitni `DATABASE_URL` iz FURS POS Web.

## FURS POS Web shema — ključni podatki
- **Multi-tenant ključ**: `podjetje_davcna` (text) — vsaka tabela v FURS POS Web ima ta stolpec
- **`enote`** tabela: `id`, `podjetje_davcna`, `ime` — vsako podjetje ima enote (poslovne enote)
- **`uporabniki`**: stara auth (username/password_hash) — ni Clerk, ne bo se uporabljala v ERP
- **`shranjeni_kupci`**: poslovni partnerji — relevantno za AR/AP modul
- **`racuni`**: računi s `podjetje_davcna` in `enota_id` — relevantno za DDV

## ERP lastne tabele (lib/db/src/schema/)
- `companies`: naš register podjetij z `podjetje_davcna` (unique) kot vez na FURS POS Web
- `accounting_roles`: `clerk_user_id` + `company_id` + `role` (owner/accountant/viewer)
- `accounts`: kontni plan — `company_id`, `code`, `name`, `type` (enum), `parent_id`, `is_active`
- `accounting_periods`: `company_id`, `name`, `start_date`, `end_date`, `status` (open/locked)
- Denarne vrednosti: vedno `numeric` tip (ne `real`, ne `doublePrecision`)

## Clerk setup
- Auth middleware: `artifacts/api-server/src/middlewares/requireAuth.ts` → nastavi `req.clerkUserId`
- Company middleware: `artifacts/api-server/src/middlewares/requireCompany.ts` → bere `X-Company-Id` header
- Za path-param routes (`:companyId`): NE folositi requireCompany, temveč ročno `resolveAccess()` funkcijo iz path param
- Frontend pošilja `X-Company-Id` header via `lib/api-client-react/src/custom-fetch.ts`
- Active company persistira v `localStorage["erp_active_company"]` via `CompanyContext`

## Codegen gotcha
- Orval zod konfiguracija: `schemas` opcija je bila **odstranjena** iz zod output config
- Nikoli ne dodaj nazaj `schemas: { path: "generated/types", ... }` v zod sekcijo `lib/api-spec/orval.config.ts`
- Orval generira `z.coerce.date()` za `format: date` → vrne `Date` objekt, ne `string`
- Drizzle `date(mode:"string")` zahteva `string` → konvertirati `.toISOString().slice(0, 10)`

**Why:** Zod package ne potrebuje TypeScript interface-ov. `z.coerce.date()` je TanStack Query / Orval vedenje za date format.

## Frontend hook patterns
- `useListAccounts(companyId, params, { query: { enabled: !!companyId } as any })` — `as any` ker TQ v5 zahteva `queryKey` v `UseQueryOptions`
- `useListPeriods(companyId, { query: { enabled: !!companyId } as any })` — enako
- `UpdateAccountBody` NE vsebuje polja `type` — kode se ne da spremeniti, type tudi ne

## Slovenian chart of accounts (SRS)
- Template je v `artifacts/api-server/src/lib/slovenianChartOfAccounts.ts`
- Seed endpoint: POST `/companies/:companyId/accounts/seed` — MORA biti definiran pred `/:id` route
- Seed algoritem: 1) vstavi vse brez parentId, 2) resolvi parentId z batch UPDATE-i
- ~120 računov pokriva razrede 0–8 po SRS standardih

## Multi-tenant pravilo
Vsak DB zapis ima `company_id` (UUID, FK na `companies.id`). Za path-param routes: validiraj `req.params.companyId`, preveri `accounting_roles` tabelo, šele nato dostopaj do podatkov.

## Knjižbe
Knjiženih knjižb se ne briše — samo storno/korektivne knjižbe.

## Davčna pravila
Konfigurabilni davčni kodi z veljavnostjo `valid_from`/`valid_to`, ne trdo zapisani.
