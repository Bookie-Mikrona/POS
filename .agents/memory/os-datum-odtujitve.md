---
name: OS datum odtujitve
description: SRS/ZDDPO-2 pravilo za datum odtujitve/prodaje OS — implementacija v engine, register, kronološki pregled, API routes in frontend.
---

## Pravilo (SRS/ZDDPO-2)
Mesec odtujitve se **NE šteje** — simetrično z začetnim pravilom (naslednji_dan/naslednji_mesec).
- Prodaja 15.10.2026 → zadnji mesec AM = september → 9 mesecev (jan–sep).
- `endMonth = izpisMonth - 1` (posebni primer: januar → endMonth=0 → 0 mesecev).

**Why:** Enako kot začetno pravilo — amortizacija se obračuna samo za mesece POLNE uporabe.

## Arhitektura
- **Schema**: `osnovna_sredstva.datum_odtujitve` (date, nullable), `razlog_izlocitve` (text, nullable). Migracija 024.
- **Engine** (`osAmortizacijaEngine.ts`): `SredstvoInput.datumOdtujitve` override per-doknjizba `datumIzpisa`. Glava ima prednost.
- **register** (`osRegisterMedletni.ts`): `RegisterSredstvoInput.datumOdtujitve` → izlocitveNV = skupna NV, izlocitvePV = zacPV + amortObdobja; konNV/konPV/konNed = 0.
- **Kronološki pregled** (`osKronoloskiPregled.ts`): zadnji event "Izločitev — {razlog}" z negativno `spremembaNv` in neodpisana="0.00".
- **resolveStatusSredstvo**: tretji argument `datumOdtujitve` → vrne "izloceno" ko nastavljeno.
- **DELETE (izloči) handler**: tudi nastavi `datumOdtujitve` na glavo (za backward compat).
- **Register handler**: filtrira `dispYear < leto` (disposed before year → not in register).
- **Amortizacija handler**: filtrira `dispYear < leto` iz glaveRows (ne vključi v obračun).

## Stari testi, ki so bili posodobljeni
- `osAmortizacija.test.ts`: 2 testa (april/oktober izpis) → pričakovanje znižano za 1 mesec.
- `osAmortizacijaObracun.test.ts`: 1 test (maj izpis, doMeseca=8): 5→4.
- Skupaj 3 teste posodobljeni, 20+ novih dodanih.

## Frontend
- `OsGlavaFormState`: dodano `datumOdtujitve: string`, `razlogIzlocitve: string`.
- `OsDialog`: polja prikazana samo pri `!isNew` (edit mode).
- Kronološki pregled: izločitev vrstica rdeča ozadje, negativna `spremembaNv` rdeča.

## Velja za status
V trenutnem pogledu nastavljeni datum odtujitve pomeni »izločeno«. V zgodovinskem registru velja samo odtujitev do presečnega datuma poročila; poznejša ne spremeni tedanjega statusa ali stanja. Podrobnosti: [Viri statusa](os-status-source-policy.md).
