---
name: ERP Foundation
description: Arhitekturne odločitve za ERP dvostavno knjigovodstvo — skupna infrastruktura z FURS POS Web
---

# ERP Foundation

## Skupna infrastruktura z FURS POS Web
- **Baza**: Skupna PostgreSQL (`DATABASE_URL` runtime-managed, ne nastavljaj ročno)
- **Auth**: Skupni Clerk tenant (Replit-managed). Keys auto-provisioned.
- FURS POS Web je ločen Replit projekt. Ima svojo DB instanco — skupna baza zahteva eksplicitni `DATABASE_URL` iz FURS POS Web.

## FURS POS Web shema — ključni podatki
- **Multi-tenant ključ**: `podjetje_davcna` (text) — vsaka tabela v FURS POS Web ima ta stolpec
- **`enote`** tabela: `id`, `podjetje_davcna`, `ime` — vsako podjetje ima enote (poslovne enote)
- **`uporabniki`**: stara auth (username/password_hash) — ni Clerk, ne bo se uporabljala v ERP
- **`shranjeni_kupci`**: poslovni partnerji (kupci/dobavitelji) — relevantno za AR/AP modul
- **`racuni`**: računi s `podjetje_davcna` in `enota_id` — relevantno za DDV
- Naš ERP ne sme direktno spremeniti teh tabel (out of scope)

## ERP lastne tabele (lib/db/src/schema/)
- `companies`: naš register podjetij z `podjetje_davcna` (unique) kot vez na FURS POS Web
- `accounting_roles`: `clerk_user_id` + `company_id` + `role` (owner/accountant/viewer)
- `companies` je stand-in — ko bo skupni `DATABASE_URL` nastavljen, se sinhronizira z FURS POS Web `enote`

**Why:** FURS POS Web nima čiste "companies" tabele — podjetja so identificirana z `podjetje_davcna` stringom across all tables.

## Clerk setup
- Proxy middleware: `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- Auth middleware: `artifacts/api-server/src/middlewares/requireAuth.ts` → nastavi `req.clerkUserId`
- Company middleware: `artifacts/api-server/src/middlewares/requireCompany.ts` → bere header `X-Company-Id`, nastavi `req.companyId` + `req.companyRole`
- Frontend pošilja `X-Company-Id` header via posodobljeni `lib/api-client-react/src/custom-fetch.ts`
- Active company persistira v `localStorage["erp_active_company"]` via `CompanyContext`

## Frontend company flow
1. Prijava → Clerk
2. Če `activeCompany` null → redirect na `/company-select`
3. `/company-select`: seznam podjetij + form za ustvarjanje novega
4. Po izbiri → `activeCompany` v context + localStorage → redirect na `/dashboard`
5. CompanySwitcher v sidebar headerju za menjavo podjetja

## Codegen gotcha
- Orval zod konfiguracija: `schemas` opcija je bila **odstranjena** iz zod output config
- Brez tega orval generira TypeScript interface-e v `types/` z istimi imeni kot Zod sheme v `api.ts` → TypeScript TS2308 duplicate export error
- **Nikoli** ne dodajaj nazaj `schemas: { path: "generated/types", ... }` v zod sekcijo `lib/api-spec/orval.config.ts`

**Why:** Zod package ne potrebuje TypeScript interface-ov — te so samo v `api-client-react`.

## Multi-tenant pravilo
Vsak DB zapis bo imel `company_id` (UUID, FK na `companies.id`) — križ-tenantski dostop ni mogoč. `podjetje_davcna` je vez na FURS POS Web.

## Denarne vrednosti
Vedno `numeric` tip v Drizzle (ne `real`, ne `doublePrecision`).

## Knjižbe
Knjiženih knjižb se ne briše — samo storno/korektivne knjižbe.

## Davčna pravila
Konfigurabilni davčni kodi z veljavnostjo `valid_from`/`valid_to`, ne trdo zapisani.
