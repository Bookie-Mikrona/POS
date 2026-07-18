# ERP — Dvostavno Knjigovodstvo

Modularen ERP sistem za slovensko dvostavno knjigovodstvo in saldakonte. Del širšega ERP ekosistema, ki vključuje tudi FURS POS Web (ločen projekt). Skupna PostgreSQL baza in skupni Clerk tenant.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — zaženi API strežnik (port iz env)
- `pnpm --filter @workspace/erp-web run dev` — zaženi ERP frontend (port iz env)
- `pnpm run typecheck` — celoten typecheck vseh paketov
- `pnpm run build` — typecheck + build vseh paketov
- `pnpm --filter @workspace/api-spec run codegen` — regeneriraj API hooks in Zod sheme iz OpenAPI specifikacije
- `pnpm --filter @workspace/db run push` — potisni spremembe DB sheme (samo dev)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind v4, shadcn/ui, Wouter (routing), TanStack Query
- API: Express 5 + Clerk Auth middleware
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (Replit-managed, skupni tenant z FURS POS Web)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (iz OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth za vse API kontrakte)
- `lib/db/src/schema/` — Drizzle ORM sheme tabel
- `artifacts/api-server/src/routes/` — Express route handlerji
- `artifacts/erp-web/src/` — React frontend (ERP modul za dvostavno knjigovodstvo)
- `lib/api-client-react/src/generated/` — generirani React Query hooks (NE urejaj ročno)
- `lib/api-zod/src/generated/` — generirane Zod sheme (NE urejaj ročno)

## Architecture decisions

- **Skupna baza**: Isti `DATABASE_URL` kot FURS POS Web — tabele poslovnih partnerjev/podjetij so skupne
- **Skupni Clerk tenant**: Isti Clerk app za oba projekta — isti uporabniki, iste seje
- **Multi-tenant izolacija**: Vsak zapis v bazi ima `company_id` — križ-tenantski dostop ni mogoč
- **Denarne vrednosti**: Vedno NUMERIC/Decimal, nikoli float/double
- **Brisanje knjižb**: Knjiženih knjižb se ne briše — samo storno/korektivne knjižbe
- **Davčna pravila**: Konfigurabilni davčni kodi z veljavnostjo od/do, ne trdo zapisani v kodi
- **Razvojna arhitektura**: Modularni monolit — vsak ERP modul je lasten React artefakt v monorepo-ju

## Product

ERP sistem za slovensko dvostavno knjigovodstvo z moduli:
- Kontni plan (SRS standardni kontni plan)
- Temeljnice in Glavna knjiga
- Kupci, Dobavitelji, Saldakonti
- Izdani in Prejeti računi
- DDV evidence (knjiga IR/PR, DDV-O)
- Poročila (bruto bilanca, konto kartica)

## User preferences

- Komunikacija izključno v slovenščini.

## Gotchas

- Po vsaki spremembi `lib/api-spec/openapi.yaml` VEDNO poženi codegen pred uporabo novih tipov
- `DATABASE_URL` je runtime-managed — ne nastavljaj ročno
- Clerk keys so auto-provisioned — ne nastavljaj ročno
- `pnpm run typecheck:libs` je potreben po vsaki spremembi v `lib/*`
- Za denarne vrednosti: vedno `numeric` tip v Drizzle, ne `real` ali `doublePrecision`

## ERP modul konvencije

Ko dodajaš nov ERP modul:
1. Ustvari nov `react-vite` artefakt: `artifacts/<modul-slug>/`
2. Skupni backend ostane v `artifacts/api-server/`
3. Skupna baza ostaja v `lib/db/`
4. Skupna auth: Clerk tenant je skupen vsem modulom
5. OpenAPI spec razširi v `lib/api-spec/openapi.yaml`, poženi codegen

## Pointers

- Glej `pnpm-workspace` skill za strukturo monorepo-ja
- `attached_assets/debata_razvoj_...pdf` — začetni razvojni načrt in zahteve
