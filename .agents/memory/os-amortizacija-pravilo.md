---
name: OS amortizacija — pravilo začetka
description: Konfigurabilno pravilo prvega meseca amortizacije (naslednji_dan | naslednji_mesec) — per-company nastavitev v os_amortizacija_nastavitve.
---

## Pravilo začetka amortizacije

Tip: `PraviloZacetkaAmortizacije = "naslednji_dan" | "naslednji_mesec"`

Exportiran iz `osAmortizacijaEngine.ts`.

### naslednji_dan (privzeto)
- prviDan = datum_aktivacije + 1 dan (Date.UTC overflow)
- Akt. 30.10 → prviDan=31.10 → mesec=oktober → 3 mesece
- Akt. 31.10 → prviDan=1.11  → mesec=november → 2 meseca

### naslednji_mesec
- prviMesec = mesec_aktivacije + 1 (ne glede na dan)
- Akt. 30.10 → prviMesec=11 → 2 meseca
- Akt. 31.10 → prviMesec=11 → 2 meseca
- Razlika nastane le, ko aktivacija NI zadnji dan meseca

### DB migracija
Migracija 022 (`022-os-pravilo-zacetka-amortizacije.sql`):
```sql
ALTER TABLE os_amortizacija_nastavitve
  ADD COLUMN pravilo_zacetka_amortizacije TEXT NOT NULL DEFAULT 'naslednji_dan'
  CHECK (...);
```

### Schema
`lib/db/src/schema/os-amortizacija-nastavitve.ts`:
- `praviloZacetkaAmortizacije: text("pravilo_zacetka_amortizacije").notNull().default("naslednji_dan")`

### Engine API
```ts
calcMeseci(datumAktivacije, datumIzpisa, leto, doMeseca?, pravilo?)
calcAmortizacijaObracun(sredstva, leto, doMeseca?, pravilo?)
```
Oba parametra `pravilo` imata default `"naslednji_dan"`.

### Routes
- GET nastavitve / PATCH nastavitve: vrne/sprejme `praviloZacetkaAmortizacije` + `hasGlkModule: boolean`
- POST /knjizenje + POST /obracun: naložita pravilo iz nastavitev → posredujeta engine
- GET /amortizacija: vzporedno naloži obračun + nastavitve (Promise.all) → posreduje engine

### UI
`AmortizacijaKnjizenjDialog.tsx` KontaForm: Select med `naslednji_dan` / `naslednji_mesec`

**Why:** SRS pravilo ni enoznačno — nekatera podjetja amortizirajo od naslednjega dne, druga od naslednjega meseca. Razlika nastane SAMO ko aktivacija ni zadnji dan meseca.

---

## GLK period auto-derive (brez ročne izbire)

Dialog `AmortizacijaKnjizenjDialog.tsx` NE kliče `useListPeriods` / `GET accounting-periods`.
Tok: Konta → Mesec → Predogled → (Izpis PDF/CSV | GLK osnutek)

### hasGlkModule
- GET/PATCH nastavitve vrneta `hasGlkModule: boolean` (preveri `company_modules.module = 'erp'`)
- Frontend: gumb "Ustvari osnutek" se prikaže SAMO ko `hasGlkModule = true`

### findPeriodForBooking
- Backend helper v `osAmortizacijaKnjizenje.ts`
- Najde odprto GLK obdobje, ki pokriva `leto` (ali `leto+mesec`)
- Kliče se SAMO za non-dryRun, PO brezKontov/vrstice preverbi
- dryRun=true: brez GLK klica → deluje za OS-only podjetja

### Error codes (POST /knjizenje non-dryRun)
- `NO_GLK_MODULE` → 403: podjetje nima ERP modula
- `NO_PERIOD_FOR_LETO` → 400: ni odprtega GLK obdobja za leto/mesec

**Why:** OS-only uporabniki so dobivali 403 "Napaka pri nalaganju obdobij" ker je stari korak
klical `GET /accounting-periods` (ERP-only endpoint). Nova arhitektura ločuje OS izpis
(neodvisen) od GLK osnutka (odvisno od ERP modula + samodejno poiščenega obdobja).

---

## Usklajenost izpis ↔ pregled (migracija 023)

### Problem
`GET /izpis` → bere shranjene zneske iz `os_amortizacija_obracun_sredstvo` (fiksen dokument).
`GET /amortizacija` → sproti izračunal z aktualnim pravilom → tiho razhajanje ko se pravilo/podatki spremenijo.

### Rešitev (kirurška)
- `os_amortizacija_obracun` dobil 2 novi polji (023 migracija): `pravilo_zacetka_amortizacije TEXT`, `vhodni_podpis TEXT` (NULL za obstoječe zapise → brez napačnih opozoril).
- `POST /obracun`: ob zagonu izračuna SHA-256 hash vseh doknjižb (sorted po sredstvoId+seq) + pravilo → shrani kot `vhodni_podpis`.
- `GET /amortizacija` (pregled): bere shranjene zneske iz `os_amortizacija_obracun_sredstvo` → prikaže iste zneske kot izpis. Hkrati primerja shranjeni `pravilo+vhodni_podpis` z aktualnim → `zastarel:true` + razlog.
- `GET /izpis`: nespremenjen, bere shranjene zneske.

### Zastarelost pravila
Zastarelost se sproži kadar:
- `savedObracun.praviloZacetkaAmortizacije != null` AND (`pravilo` se razlikuje OR `vhodni_podpis` se razlikuje)
- NULL polja → preskočena primerjava (za obstoječe zapise pred migracijo)

### UI
`amortizacijski-obracun.tsx`: banner `data.zastarel && !data.predogled` → opozorilo z razlogom + navodilo za ponovni zagon.

### Helper
`computeVhodniPodpis(pravilo, doknjizbe[])` v `osAmortizacijaEngine.ts` (exportiran).

**Why:** Oba pogleda (izpis=fiksen dokument, pregled=živi prikaz) morata kazati enake zneske ali pa pregled jasno opozori na potrebo po ponovnem zagonu. Tiho razhajanje je nedopustno.
