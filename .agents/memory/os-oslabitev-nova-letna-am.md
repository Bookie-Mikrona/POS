---
name: OS oslabitev — nova letna AM (SRS 1.35+)
description: Pravilna logika M1/M2 oslabitve: nova AM = nova_knjižna/preostala_doba, fiksirana v DB.
---

## Pravilna logika (027 migracija)

**Nova letna AM = nova_knjižna_vrednost / preostala_doba** — se FIKSIRA in shrani v DB.

- **nova_knjizna** = skupna_preostalo_end_of_N − oslabitev  
  kjer skupna_preostalo_end_of_N = skupna_osnova − initial_odpisana − Σ(obracunano vseh let ≤ N)  
  (PUT endpoint sam izračuna, ker `odpisanaVrednost` se nikoli ne posodablja za sistemske obračune)
- **M1**: preostala_doba = max(1, round(100/stopnja − (oslabitevLeto − activationYear + 1)))
- **M2**: preostala_doba = user-entered novaDoba (leta)
- **nova_letna_am_rac** = nova_knjizna / preostala_doba → shrani v `oslabitev_nova_letna_am_rac`

## DB spremembe (027)

```sql
ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD COLUMN oslabitev_nova_doba_let     INTEGER,
  ADD COLUMN oslabitev_nova_letna_am_rac NUMERIC(14,2);
```

## Engine logika

- `oslabitevNovaLetnaAmRac > 0` → NADOMESTI standardno stopnja×osnova za RAC
- Porazdelitev proporcionalno po effectivePreostalo per doknjizba
- DAV ostane standardna formula (neodvisna od SRS oslabitve)
- `activationYear` izpeljan iz seq=0 datumAktivacije → dodan v SredstvoAmortResult

## Loading code pravilo

- `oslabitevPrevLeto`: samo iz leta N-1 (cap na effectivePreostalo)
- `oslabitevNovaLetnaAmRac`: iz NAJNOVEJŠEGA leta < N z `oslabitev_nova_letna_am_rac > 0` per sredstvo → velja za VSA naslednja leta

**Why:** `odpisanaVrednost` na `os_doknjizbe` se nikoli ne posodablja avtomatično; motor ne pozna dejansko
nagromadenega sistemskega amortiziranja iz DB. PUT endpoint mora sešteti `obracunano` iz
`os_amortizacija_obracun_sredstvo` za vsa leta ≤ N da dobi dejanski preostali znesek.

## UI (OslabitevCell)

- M2 prikaže "Nova doba (let)" vnos
- Live predogled: `nova_knjizna ≈ sedanjaVrednostPoObracunu − oslabitev`; prikazuje preostala_doba, nova AM, nova stopnja
- Po shranitvi prikaže `savedNovaLetnaAmRac` pod oslabitev zneskom
- Prikaz na odprtem obračunu (prev. leto): `skupnaOslabitev` + `novaLetnaAmPoOslabitvi` (iz engine)
