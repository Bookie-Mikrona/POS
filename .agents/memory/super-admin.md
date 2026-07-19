---
name: Super admin sistem
description: Arhitektura super admin plasti — env var, company_modules, admin panel, čakalnica
---

# Super admin sistem

## Pravilo
Super admin = Clerk user ID v env var `SUPER_ADMIN_IDS` (vejičnik-ločeni). Ne DB tabela.

**Why:** Preprosto, brez UI za upravljanje samega super admina. Več adminov: `user_A,user_B`.

**How to apply:** Ko dodajamo novega super admina, dodamo ID v env var in restartamo API server. Ni migracije.

## Modularna kontrola
Tabela `company_modules` (`company_id`, `module: 'erp'|'pos'`, `enabled_by`).
Vsako podjetje ima eksplicitno aktivirane module. Brez zapisa = modul ni aktiven.

## Backend
- `artifacts/api-server/src/middlewares/requireSuperAdmin.ts` — middleware + `isSuperAdmin()` helper
- `artifacts/api-server/src/routes/admin.ts` — router na `/admin/*`
- `artifacts/api-server/src/routes/me.ts` — vrača `isSuperAdmin: boolean` v GET /me odgovoru

## Frontend
- `artifacts/erp-web/src/pages/admin.tsx` — admin panel (podjetja, moduli, uporabniki)
- `App.tsx` — `useIsSuperAdmin()` hook bere `data.isSuperAdmin` iz `/api/me`; `ProtectedRoute` prop `adminOnly`
- `Shell.tsx` — "Administracija" link viden samo super adminu (preveri `isSuperAdmin` iz `/api/me`)
- `company-select.tsx` — čakalnica za uporabnike brez podjetij; super admin vidi gumb za `/admin`

## Lokalni tip razširitev
`ProposedLine` iz generiranega API schema nima `suggestionSource`/`suggestionCount` (task #31).
Cast: `const le = l as ProposedLineExtended` v `dokumenti.tsx`.
