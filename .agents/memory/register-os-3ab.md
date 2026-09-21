---
name: Register OS Faza 3a–3b
description: Implementacija registra osnovnih sredstev — šifrant amortizacijskih skupin + register sredstev. Brez amortizacijskega obračuna (ta pride v 3c).
---

## Tabele (migracija 014-osnovna-sredstva.sql)

**os_amortizacijske_skupine** — edini nov šifrant, specifičen za OS:
- koda, naziv, racunovodska_stopnja NUMERIC(6,3), davcna_stopnja NUMERIC(6,3)
- aktivno, opomba, company_id FK companies
- UNIQUE(company_id, koda)
- TODO v kodi: leto-verzioniranje stopenj (ista koda, različna stopnja po letih) — predvidena kasnejša izboljšava

**osnovna_sredstva** — register sredstev:
- inventarna_st + doknjizba tvorita UNIQUE par (company_id, inventarna_st, doknjizba)
- status CHECK: 'v_teku' | 'v_uporabi' | 'odpisano' | 'izloceno'
- neamortizljivi_del_pct CHECK: 0–100
- datum_aktivacije: NULL = investicija v teku; ob vnosu auto-status → v_uporabi

## Načelo skupnih šifrantov (ključno)

OS se VEŽE na obstoječe centralizirane šifrante, NE ustvarja lastnih:
- accounts: account_id, konto_popravka_id, konto_stroska_id → accounts.id
- cost_centers: cost_center_id → cost_centers.id (NI novega STM šifranta)

## API rute (osnovnaSredstva.ts)

- GET/POST/PATCH /companies/:id/os-amortizacijske-skupine
- GET/POST/PATCH/DELETE /companies/:id/osnovna-sredstva
- DELETE = soft delete: status→izloceno, nastavi datumIzpisa

## Izračuni v API

- sedanjaVrednost = nabavnaVrednost − odpisanaVrednost (izračunano v-klicu, ni shranjeno)
- amortizirljivaBaza = nabavnaVrednost × (100 − neamortizljiviDelPct) / 100

## Shell navigacija

Nova sekcija "Osnovna sredstva" (prikazana ko je aktiven `erp` modul):
- Register OS → /osnovna-sredstva
- Amort. skupine → /amortizacijske-skupine

## Ta modul NE vsebuje

- Amortizacijskega obračuna (3c)
- Knjižb v glavno knjigo (3c–3f)
- Uvoza zgodovinskih podatkov (3f)
- Zbirne temeljnice amortizacije (3d)

## TypeScript tipka

useListAccounts() iz generiranega API klienta NE sprejema allowsPosting filter — ta je samo za prikaz na FE, ne za filtriranje.
