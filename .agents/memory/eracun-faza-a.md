---
name: Izhodni e-račun Faza A
description: Arhitektura in ključne odločitve za POS izhodni e-račun (e-SLOG 2.0 / UBL 2.1) — generator, migracija, prožilnik, prenos XML.
---

## Implementirano (Faza A)

- Generator: `artifacts/api-server/src/lib/eracun/generator.ts` — xmlbuilder2, Decimal.js, e-SLOG 2.0 CustomizationID
- Migracija: `lib/db/src/migrations/0010_eracun_polja.sql` — 4 nova polja na tabeli racuni
- Prožilnik: v `POST /racuni`, fire-and-forget setImmediate po uspešni FURS fiskalizaciji
- Download endpoint: `GET /racuni/:id/eracun.xml` — vrne XML z Content-Disposition attachment
- UI gumb: `Receipts.tsx` — viden ko eRacunStatus = 'pripravljen'; rdeča oznaka pri 'napaka'
- Krožni test: `tests/eracun-generator/01-generator.test.ts` — 3 scenariji, vsi zeleni
- Script: `pnpm run test:eracun`

## Ključne odločitve

**POS cene so BRUTO (z DDV):** `cenaKos` na postavkah vključuje DDV.
- Generator preračuna: `cenaNeto = cenaBruto / (1 + stopnja/100)`
- `**Why:**` POS je B2C — cene se prikazujejo z DDV, FURS izračuni delajo enako.

**Avtoritativni zneski:** `skupaj`, `ddv`, `osnova` se vzamejo iz shranjenega računa, ne izračunajo sproti.
- Zaokrožitvene razlike med vsoto vrstic in osnovo so korigirane na prvi DDV skupini (do 0.10 EUR).
- `**Why:**` Preprečuje neskladje z že potrjenimi FURS zneski.

**Pogoji za generiranje:** placilnaNacin = 'negotovinsko' + kupecId != null + fursOdgovor.uspeh + kupec.eRacunPrejemnik = true + kupec.davcnaStevilka != null.

**Peppol:** TODO v generator.ts, jasno označeno. Za zdaj vedno gradi e-SLOG 2.0, ne glede na eRacunOmrezje.

## Nova DB polja (tabela racuni)

| Polje | Tip | Opis |
|-------|-----|------|
| e_racun_xml | text | Generiran UBL XML |
| e_racun_status | text CHECK IN ('pripravljen','poslan','napaka') | Status |
| e_racun_datum | timestamptz | Datum generiranja |
| e_racun_napaka | text | Sporočilo napake |

## Faza B (ni implementirana)

Dejansko pošiljanje prek BizBox/ZZI, UJP portala, Peppol access point.
Status 'poslan' je strukturno pripravljen, a se ne nastavi.
