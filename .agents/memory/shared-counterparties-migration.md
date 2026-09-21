---
name: Skupen šifrant partnerjev — TypeScript migracija
description: Kako popraviti TypeScript tipe po zamenjavi shranjeni_kupci (integer PK) s counterparties (UUID PK).
---

## Stanje po migraciji

DB migracija 029 je uspešna. `counterparties.id` je UUID string. `shranjeni_kupci` je ukinjena.

## Ključna pravila za UUID tipe

- `ShranjenKupec.id`: `string` (UUID) — ne `number`
- `RacunInput.kupecId`: `string | null`
- `KupecPoisciRezultat.id`: `string | null` — `/kupec/poisci` vrne UUID
- Vse `DobaviteljCombobox.value`, `dobaviteljId`, `csvDobaviteljId`, `manjkaIzbraniId`: `string | null`
- `NovDobaviteljKartica.onCreated(id: string, naziv: string)`
- `DobaviteljLookupStanje { tip: "shranjen"; id: string }` — InetisRezultat.id je `string | null`

## dist .d.ts je cache — ročno popravi

`lib/api-client-react/dist/generated/api.d.ts` se **ne regenerira** samodejno ob spremembi src.
Ko posodobiš `src/generated/api.ts`, moraš isti popravek narediti še v `dist/generated/api.d.ts`.
Zlasti: `useUpsertPartnerCenikItem`, `useDeletePartnerCenikItem` — `id: number` → `id: string`.

**Why:** `npx tsc -p tsconfig.json` ne prepiše dist datoteke, ko se TypeScript sam sebi referira prek `skipLibCheck`.
Posodobi dist ročno ali rebuildi prek `tsc --build`.

## @ts-nocheck datoteke

`lib/api-client-react/src/generated/api.ts` in `api.schemas.ts` imajo `@ts-nocheck` — generirani Orval kodi
z nezdružljivimi tipi. Ob naslednji Orval regeneraciji se `@ts-nocheck` izgubi — preveri tipe.

## ModifikatorjePanel / Menu delete hooks

`deleteSkupina.mutate({ id: String(id) as any })` — ker je hook `id: string` ampak klicatelja
ima `id: number` iz starih integer primarnih ključev (ne counterparties). `as any` je namenoma.
