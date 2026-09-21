---
name: OS medletni register
description: Arhitektura dinamičnega medletnega registra OS — podatkovni model, endpoint, hook, UI komponenta.
---

## Pravilo
Medletni register OS = tri sklopi za vsako sredstvo:
- **Začetno stanje (1.1.):** zacNV = Σ NV doknjižb z aktivacijo PRED letom; zacPV = uvozena_odpisana + Σ obracunano iz os_amortizacija_obracun_sredstvo za vsa leta < leto
- **Spremembe:** noveNabave = aktivacija V letu; amortObdobja = shranjeni obračun tega leta; izlocitve = 0 (pripravljeni stolpci)
- **Končno stanje:** konNV = zacNV + noveNabave; konPV = zacPV + amortObdobja; konNed = konNV − konPV

Klasifikacija doknjižbe: po `datumAktivacije`; fallback na `datumNabave` (za v_teku brez aktivacije).

## Datoteke
- Čista logika + tipi: `artifacts/api-server/src/routes/osRegisterMedletni.ts`
- Testi (37): `artifacts/api-server/src/routes/osRegisterMedletni.test.ts`
- API endpoint: `GET /companies/:companyId/osnovna-sredstva-register` v `artifacts/api-server/src/routes/osnovnaSredstva.ts`
- API client hook: `lib/api-client-react/src/os-register-medletni.ts` → `useGetOsRegisterMedletni`
- Frontend: `ListView` v `artifacts/erp-web/src/pages/osnovna-sredstva.tsx` — nadomestilo stari statični seznam

**Why:** Računovodja potrebuje dinamični pregled NV/PV/Ned za katerokoli leto, ne samo kumulativo.

**How to apply:**
- `periodo.predogled = true` → ni shranjenega obračuna za to leto → amortObdobja = 0
- `razpolozljivaLeta` vrača leta s shranjenimi obračuni; UI doda tekoče leto, če ga ni v seznamu
- Po spremembi sredstev (create/izloči): invalidate `["os-register-medletni", companyId]` + `osnovnaSredstvaQueryKey`
- ListView ne vsebuje inline "Uredi" gumba — urejanje se izvede prek kartice (FileText → onOpenKartica)
- API ne fetcha skupinaKoda/Naziv — frontend joinira sam iz `useListOsAmortizacijskeSkupine`
