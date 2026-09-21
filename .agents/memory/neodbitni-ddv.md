---
name: Neodbitni vstopni DDV
description: Faza 2 — infrastruktura, UI in FURS kode za neodbitni/delno odbitni vstopni DDV (reprezentanca, vozila, splošno).
---

## Kaj je implementirano

### Infrastruktura (obstoječe, potrjeno)
- `journal_entry_lines.vat_deduction_percent` — shranjeno na vrstici (0–100)
- `vat_ledger.non_deductible_vat` + `deduction_percent` — izračunano ob potrditvi
- `vatLedger.ts`: deductibleVat = vatAmt × pct/100 → P18/P19/P20; nonDeductibleVat → P17
- P17 pravilno izločen iz odbitka (ne poveča polj 41–43 DDV-O)

### Novo (Faza 2)

**013 migracija** — 4 nove FURS kode (idempotentno):
- `PN95`, `PN5` — nabava brez pravice do odbitka 9,5%/5% (kpr_vat_field=NULL → isNonDeductible=true)
- `UVP95`, `UVP5` — uvoz DDV plačan carini 9,5%/5% (kpr_vat_field nastavljeno → odbitni)

**API ruta** `GET /companies/:companyId/furs-vat-codes`:
- Vrne globalne FURS kode iz `vat_code` tabele (ne company-specifičnih `vat_codes`)
- Ključno polje: `isNonDeductible = direction='IN' AND rate>0 AND kprVatField=null`

**Hook** `useFursVatCodes(companyId, direction?, options?)` v `lib/api-client-react/src/furs-vat-codes.ts`

**UI v temeljnicah** (`artifacts/erp-web/src/pages/temeljnice.tsx`):
- Vsaka vrstica ima zložljivo "DDV (vstopni — neobvezno)" sekcijo
- Polja: DDV koda (FURS select, samo IN), DDV znesek (EUR), Odbitek DDV %
- `handleVatCodeChange`: neodbitna koda → auto-set vatDeductionPercent=0; navadna koda → 100 (če bil 0)
- Tooltip: "Delež vstopnega DDV, ki ga smete odbiti (0 % neodbitno, 50 % reprezentanca, 100 % polno)"
- Auto-izračun vatAmount = amount × rate / 100 (samo ko je vatAmount prazen)

**VRZEL F** — ddv-evidence.tsx: popravljeno P17 label "EU-B 22%" → "neodbitni DDV"

## Ključna pravila

**Why:** PN-kode so po naravi neodbitne (kprVatField=NULL), zato privzetek 100% tiho izgubi DDV v XML. Zdaj sistem to prepreči.

**How to apply:**
- Zaznava neodbitnih kod: `isNonDeductible = direction=IN AND rate>0 AND kprVatField=null` (ne hardcode PN)
- Reprezentanca in vozila: ročni vnos (računovodja odloči o %) — sistem ne vsiljuje 50% ali 0%
- P17 ≠ polji 41–43: deductibleVat + nonDeductibleVat = vatAmount (vedno; zaokr. na cent)
- `journal_entry_lines.vat_code_id` → `vat_code.id` (GLOBALNA tabela), NE `vat_codes` (company-specifična)
- `lib/api-client-react` ima composite TS references → rebuild z `cd lib/api-client-react && npx tsc -p tsconfig.json` po vsaki spremembi
