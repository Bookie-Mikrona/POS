---
name: OS register izvoz + enrichment
description: Implementacija razširjenega registra OS — SRS metapodatki, PDF (landscape A4), XLSX (ExcelJS), shared helper
---

## Kar je implementirano

- `buildEnrichedRegisterData(companyId, params)` — standalone async funkcija v `osnovnaSredstva.ts` (pred route definicijami). Vsebuje celotno query + enrichment logiko za vse 3 endpointe.
- JSON: `/companies/:id/osnovna-sredstva-register` — vrne `enrichedVrstice` (razširjen tip z SRS polji)
- PDF: `GET /companies/:id/os-register/pdf` — landscape A4 (`size: [595.28, 841.89]`, `layout: "landscape"`)
- XLSX: `GET /companies/:id/os-register/xlsx` — ExcelJS, 22 stolpcev, zamrznjena vrstica 4, autoFilter

## EnrichedMedletniVrstica

- Definirana v `osRegisterMedletni.ts` na API serverju (extends `MedletniRegisterVrstica`)
- Na api-client-react strani polja so direktno na `MedletniRegisterVrstica` (optional/nullable)
- Polja: `skupinaKoda, skupinaNaziv, racunovodskaStonja, davcnaStonja, datumNabave, datumAktivacije, accountCode, kontoPopravkaCode, kontoStroskaCode, costCenterCode`

## Kritični detajl — calcMedletniSeštevki

- Funkcija sešteje: `zacNV, zacPV, zacNed, noveNabave, amortObdobja, **oslabiteVObdobja**, izlocitveNV, izlocitvePV, konNV, konPV, konNed`
- **MORA vsebovati `oslabiteVObdobja: "0.00"`** v mock vrsticah — drugače `new Decimal(undefined)` vrže DecimalError!
- `emptyMedletniSeštevki()` vrne `"0.00"` (ne `"0"`) — pri testiranju primerjaj prek `parseFloat()`

## Doba koristnosti (UI + PDF)

- `Math.round(100 / parseFloat(stonja))` za celo število let v UI
- `(100/n).toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 1 })` za PDF

## companiesTable polja

- `naziv` (ne `name`) — naziv podjetja
- `idZaDdv` (ne `taxId`) — DDV identifikacijska številka (format "SI12345678")

**Why:** Polja so v slovenščini po shemi; `name`/`taxId` ne obstajata.

## UI razširjen pogled

- `colCount = 23` v razširjenem pogledu (strnjen = 12)
- SRS metapodatki v vijolični barvi (`text-purple-700`, `bg-purple-50/20`)
- Gumba "PDF" in "Excel" kličeta `buildExportUrl(format)` z obstoječimi filtri (q, leto, skupinaId, status, costCenterId)
- `buildExportUrl` gradi `/api/companies/:id/os-register/:format` (NE `VITE_API_URL` — ta ne obstaja)
- Tabela brez `table-fixed` v razširjenem načinu za pravilno širino; `min-w-[1600px]` z `overflow-x-auto`
