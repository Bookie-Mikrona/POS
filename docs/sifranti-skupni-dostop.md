# Skupni šifranti — company-scope pravila

Skupna šifranta **stroškovna mesta** (`cost_centers`) in **kontni plan**
(`accounts`) sta strogo vezana na podjetje (`company_id`). Vsak modul, ki
shranjuje referenco (FK) na te tabele, mora preveriti, da referencirani zapis
pripada **istemu podjetju** kot dokument, ki referenco shranjuje. Brez te
preverbe lahko uporabnik z dostopom do dveh podjetij (namerno ali po pomoti)
poveže dokument podjetja A s kontom ali SM podjetja B.

## Centralni validator

`artifacts/api-server/src/lib/assertSameCompany.ts` ponuja batch preverbe:

```ts
import { assertCostCenterInCompany, assertAccountInCompany } from "../lib/assertSameCompany";

const [ccErr, accErr] = await Promise.all([
  assertCostCenterInCompany([d.costCenterId], companyId),
  assertAccountInCompany([d.accountId, d.kontoPopravkaId], companyId),
]);
const scopeErr = ccErr ?? accErr;
if (scopeErr) {
  res.status(scopeErr.status).json({ error: scopeErr.error });
  return;
}
```

Lastnosti:

- `null`/`undefined`/prazni stringi so preskočeni — opcijska polja ni treba
  posebej obravnavati.
- En batch `SELECT ... WHERE id IN (...) AND company_id = $1` za vse ID-je.
- Neobstoječ ID in ID tujega podjetja vrneta **isto** napako (400) — namerno,
  da odziv ne razkrije obstoja zapisov drugih podjetij.

## Kje je preverba že vgrajena

| Modul | Ruta | Preverjena polja |
|---|---|---|
| Register OS | `POST /companies/:companyId/osnovna-sredstva` | `costCenterId`, `accountId`, `kontoPopravkaId`, `kontoStroskaId` |
| Register OS | `PATCH /companies/:companyId/osnovna-sredstva/:id` | ista polja — samo tista, ki so v zahtevku |
| Prejemnice | `POST /companies/:companyId/goods-receipts` | `transitAccountId`, `inventoryAccountId` in vsak `line.accountId` (batch prek `accountsTable.companyId`) |
| Temeljnice | `POST /companies/:companyId/journal-entries` | konti in dimenzije prek obstoječih preverb v ruti |

## Pravila za nove module

1. **Vsaka nova ruta**, ki sprejme `costCenterId`, `accountId` ali podobno
   referenco na skupni šifrant, mora poklicati ustrezen `assert*InCompany`
   validator **pred** pisanjem v bazo.
2. Pri `PATCH` rutah preveri **samo polja, prisotna v zahtevku** (`"polje" in d`),
   da odsotno polje ne sproži nepotrebne preverbe.
3. Napako vrni kot `400 { error }` — ne 404, da se ne razkrije obstoj tujih
   zapisov.
4. Za sezname ID-jev (npr. vrstice dokumenta) uporabi **en batch klic** z vsemi
   ID-ji, ne zanke s posameznimi SELECT-i.

## Sorodno

- Dostop do šifrantnih rut (kdo sme brati/pisati) ureja
  `resolveSifrantAccess` (`partnerji`, `stm_or_kontni`) — glej
  `artifacts/api-server/src/lib/resolveSifrantAccess.ts`. Company-scope
  preverba referenc je **ločena** skrb in je ne nadomešča.
