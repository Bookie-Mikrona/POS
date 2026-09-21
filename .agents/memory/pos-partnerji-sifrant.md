---
name: POS partnerji — skupni šifrant
description: Canonical /api/partnerji poti, legacy aliasi, resolver dostop in UUID ID-ji partnerjev
---

# POS partnerji — skupni šifrant

- POS in ERP delita tabelo `counterparties` (company-level, ne enota). `shranjeni_kupci` se ne uporablja več za nove poti.
- Canonical POS poti: `/api/partnerji` (+ `/:id`, `/:id/osvezi`, `/:id/cenik/:artikelId`). Stare `/api/kupec/shranjeni*` poti so backward-compatible aliasi z ISTO logiko in ISTIM resolverjem.
- **Dostop:** vse poti (canonical in legacy) gredo skozi `requirePartnerjiAccess` → `resolveSifrantAccess(..., "partnerji", ...)`. Vse vloge (ERP/OS/POS) smejo pisati partnerje; uporabnik brez vloge v podjetju dobi 403.
- **ID partnerja je UUID string** — ne integer. To velja tudi za `kupecId` na računih in `KupecPoisciRezultat.id` v OpenAPI. Vse številčne primerjave partner ID-jev v POS so bile odstranjene.
- **Why:** en sam šifrant preprečuje razhajanje POS/ERP podatkov; skupni resolver preprečuje, da bi legacy poti obšle pravice.
- **How to apply:** nove partner funkcionalnosti dodajaj samo na canonical `/partnerji` poti; legacy aliasi so zamrznjeni. Frontend imena: `Partnerji`, `Partner`, `PartnerjiSelector`, hooki `useListPartnerji` ipd.
- **OpenAPI past:** `format: uuid` v shemi zlomi Zod codegen (`zod.uuid()` ne obstaja v zod 3.25) — UUID polja pusti kot navaden `type: string`.
- Testi: `artifacts/api-server/src/routes/pos/kupec.partnerji.test.ts` (integracijski, supertest + injiciran POS kontekst).
