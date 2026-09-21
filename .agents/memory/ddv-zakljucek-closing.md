---
name: DDV zaključek — zaključna temeljnica
description: Implementacija zaključne DDV temeljnice (Faza 1 Del B): nastavitve, API ruta, UI gumb + dialog.
---

## Kaj je implementirano

Funkcionalnost "zaključna DDV temeljnica" — zapira salde 160x/260x kontov in neto razliko knjiži na 2699/1699.

## Ključne datoteke

- `lib/db/src/migrations/012-ddv-zakljucek-settings.sql` — tabela ddv_zakljucek_settings
- `lib/db/src/schema/ddv-zakljucek-settings.ts` — Drizzle schema (ddvZakljucekSettingsTable)
- `artifacts/api-server/src/routes/ddvZakljucek.ts` — GET/PUT nastavitve + POST osnutek
- `lib/api-client-react/src/ddv-zakljucek.ts` — React hooks (useGetDdvZakljucekSettings, useUpdateDdvZakljucekSettings, useDdvZakljucekOsnutek)
- `artifacts/erp-web/src/pages/nastavitve.tsx` — nov AccountSelectSimple helper + DDV zaključek kartica (POS tab)
- `artifacts/erp-web/src/pages/ddv-evidence.tsx` — gumb "Pripravi zaključno temeljnico" + predogled dialog
- `artifacts/api-server/src/routes/ddvZakljucek.test.ts` — 5 unit testov

## Logika zapiralnih vrstic

- 26x (izstopni DDV, normalni saldo kredit): `balance = credit − debit` → D balance
- 16x (vstopni DDV, normalni saldo debet): `balance = debit − credit` → K balance
- Neto = sum(26x) − sum(16x): pozitiven → K 2699, negativen → D 1699
- Konto 2699/1699 se samodejno ustvari, če ne obstaja v podjetju

**Why:** Zakonsko pravilna zaključnica DDV; računi se ne mešajo, temeljnica je vedno OSNUTEK.

## API konvencija

- `dryRun: true` → vrne preview brez DB vpisa
- `dryRun: false` → ustvari osnutek temeljnice (reference = `DDV-ZAKLJUCEK:YYYY-MMMM`)
- Duplicate check: `reference` polje na journal_entries
- DDV konti: `LIKE '160%'` za vstopni, `LIKE '260%'` za izstopni (ne '16%'/'26%' — preveč široko)
- Period bounds: enaka logika kot vatLedgerReport.ts periodBounds()
- sourceType ostane `'manual'`; DDV zaključek prepoznaven po `reference` polju

## Nastavitve

Tabela `ddv_zakljucek_settings` (ena vrstica na podjetje):
- `netoObveznostAccountId` → konto 2699
- `netoTerjatevAccountId` → konto 1699
UI: POS Knjiženje tab → nova kartica "DDV zaključek — Neto konti"
