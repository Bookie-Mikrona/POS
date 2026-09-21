---
name: OS modul dostop
description: Osnovna sredstva kot samostojen ERP modul z lastno os_roles tabelo — ločen od accounting_roles
---

# OS modul dostop — arhitekturna pravila

## Pravilo
Modul `osnovna_sredstva` je popolnoma neodvisen od `erp` in `pos`. Dostop se dodeljuje prek `os_roles` tabele, NE prek `accounting_roles`.

**Why:** Naročnik zahteva, da nekdo vodi register OS brez dostopa do knjigovodstva. Dve ločeni tabelni (Opcija B).

**How to apply:**
- Vse OS API rute (`osnovnaSredstva.ts`) kličejo `resolveOsAccess()` — ne `resolveAccess()`
- Branje: katero koli od os_admin/os_user/os_viewer (`canReadOs`)
- Pisanje: samo os_admin/os_user (`canWriteOs`)
- Superadmin dobi auto os_admin prek `isSuperAdmin()` bypass

## Aktivacija modula
- `company_modules`: module = 'osnovna_sredstva' (poleg 'erp', 'pos')
- AVAILABLE_MODULES konstanta v `lib/db/src/schema/company-modules.ts`
- Admin API validacija v `admin.ts` dovoli vse tri
- `resolveOsAccess` preveri module + os_roles; brez `company_modules.osnovna_sredstva` → 403

## GET /companies — OS-only uporabniki
`companies.ts` vrne 3 vrste podjetij:
1. ERP (accounting_roles) → role="owner"|"accountant"|"viewer"
2. POS (pos_uporabniki) → role="pos_admin"|...
3. OS-only (os_roles, brez ERP/POS) → role=os_roles.role

Vsa podjetja dobijo `osRole` polje — `null` če ni OS dostopa.

## Shell navigacija
```typescript
const isErpUser = ["owner","accountant","viewer"].includes(activeCompany?.role ?? "");
const osRole = (activeCompany as ...)?.osRole ?? null;
// ERP nav: isErpUser && activeModules.includes("erp")
// OS nav: osRole && activeModules.includes("osnovna_sredstva")
```
OS-only uporabnik ne vidi ERP nav, ERP uporabnik brez OS vloge ne vidi OS nav.

## Uvoz (osUvoz.ts)
- Ruta: `POST /os/:companyId/uvoz?dryRun=true|false`
- multer memoryStorage, maks 25 MB; SheetJS xlsx paket (že nameščen)
- 3 listi: Amortizacijske_skupine, Stroskovna_mesta, Sredstva (v tem vrstnem redu)
- dryRun=true → samo validacija, brez DB; vrne { skupineCount, stmCount, sredstvaCount, napake[] }
- dryRun=false → transakcija: skupiny → STM → sredstva+doknjizbe(seq=0)
- `parseSloCurrency("21.907,86")` → 21907.86; `parseSloDate("31.12.2022")` → "2022-12-31"
- `resolveAccountId`: 7-mestno → 3-mestno fallback (strip trailing 0000) ali obratno
- `buildSredstvoStatus`: odpisan=DA → "odpisano"; datum_aktivacije → "v_uporabi"; sicer "v_teku"
- racunovodskaStonja/davcnaStonja (ne _stopnja — typo v shemi!); datumNabave je NOT NULL (fallback 1900-01-01)
- UI: gumb "Uvozi" v glavi OS strani → 3-koračni dialog (nalaganje → predogled → rezultat)
- 46 novih testov (skupaj 145/145)

## Admin panel
- Podjetja tab: toggle za "osnovna_sredstva" modul + `OsRolesSection` component
- Users tab: badges prikazujejo "OS" sistem z zelenimi barvami
- API rute: GET/POST/DELETE `/admin/companies/:id/os-roles`
- GET /admin/users vrne os vloge v `companies` seznam z `sistem: "os"`
