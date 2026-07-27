---
name: POS dnevne temeljnice
description: Samodejno generiranje ERP knjižnih osnutkov iz POS podatkov — arhitektura, tabela, sync funkcija, hook točke
---

## Kaj je implementirano

Vsak dan se za podjetje samodejno generirajo do 3 osnutki temeljnic:

| Ref | Vsebina | Debet | Kredit |
|-----|---------|-------|--------|
| `POS:PRODAJA:YYYY-MM-DD` | Dnevna prodaja (Z-poročilo) | blagajna po plač. načinu | prihodki + DDV |
| `POS:PREJEMNICA:YYYY-MM-DD` | Prejemnice blaga | zaloge | dobavitelji |
| `POS:PORABA:YYYY-MM-DD` | Poraba blaga (COGS) | stroški blaga | zaloge |

## Ključne datoteke

- Schema: `lib/db/src/schema/pos/pos-booking-settings.ts` + export v `pos/index.ts`
- Sync logika: `artifacts/api-server/src/lib/posSyncBooking.ts`
- API route: `artifacts/api-server/src/routes/posBookingSettings.ts` (registriran v `routes/index.ts`)
- Auto-trigger: `pos/racuni.ts` in `pos/prejemnice.ts` — `setImmediate()` po res.json()
- ERP UI: tab "POS Knjiženje" v `artifacts/erp-web/src/pages/nastavitve.tsx`

## Arhitekturne odločitve

**Idempotentnost**: pred vsako kreacijo se obstoječi osnutek z istim ref pobriše. Potrjene (posted) temeljnice se nikoli ne brišejo.

**"Ostala plačila" konto**: gotovina + kartica morata skupaj = skupaj znesek računa. Razlika (boni, negotovinsko) gre na `otherPaymentAccountId`. Brez tega konta, ko je razlika > 0.005€, se temeljnica ne ustvari (vrne skipped z razlogom).

**datum v Ljubljana času**: za `racuni.datumCas` (timestamptz) se uporablja `AT TIME ZONE 'Europe/Ljubljana'` v SQL. Za hook trigger v TS: `new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(datumCas)`.

**COGS vrednost**: iz `zaloga_gibi` kjer `tip='poraba'`. Vrednost je negativna (kolicina < 0 × cenaKos), vzamemo `ABS(SUM(vrednost))`. Join prek `artikli.enota_id` za filtriranje po podjetju.

**companyId v POS routih**: `(req as any).companyId` — nastavi middleware `requireEnota`.

**Why**: temeljnice so v status `draft` — računovodja ročno pregleda in potrdi. POS trigger je async (setImmediate) da ne blokira odgovora.

## Nastavitve (8 polj)

`revenueAccountId`, `cashAccountId`, `cardAccountId`, `otherPaymentAccountId`, `vatLiabilityAccountId`, `inventoryAccountId`, `payablesAccountId`, `cogsAccountId`
