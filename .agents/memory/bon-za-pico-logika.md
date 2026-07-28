---
name: Bon za pico logika
description: Kako se bon za pico (pizza voucher) upošteva pri izračunu skupaj/ddv/osnova in v tiskanju
---

## Pravilo (od julija 2025)

Pice pokrite z bon za pico se **dejansko prodajo po ceni 0** (100% popust na postavki ravni). Skupaj/ddv/osnova na računu so **že neto** zneski — bon za pico NI odbitek na koncu.

**Why:** Pred spremembo je skupaj = bruto (vse pice po polni ceni), bon za pico pa je bil prikazan kot negativna vrstica. To je povzročilo napačen DDV (osnova previsoka) in napačno FURS TaxesPerSeller (pokrite pice so bile obdavčene).

**How to apply:**

### Strežnik (racuni.ts POST /racuni)
- `steviloBonov` iz request → `bonPicaPopustMap`: Map<postavkaId, {reducedAmount, pokriteKol}>
- Pice identificiramo prek `artikliTable.jePica = true` (join na artikelId)
- Razvrstimo od najdražje, dodelimo popust na `reducedAmount = cenaKos * pokriteKol`
- `skupajIzPostavk` = suma(postavka - bonPopust) za vsako postavko
- `ddv` = izračunan iz zmanjšanih vsot
- `skupaj` = skupajIzPostavk (ali 0 za reprezentanco/lastno_porabo)
- DDV konsistentnostni preverjanje se PRESKOČI ko `steviloBonov > 0`
- Za FURS: pokrite pice se pošljejo pri cenaKos=0 (split postavka na placane + pokrite kol)

### Tiskalnik (print routes + buildBonPicaAdjustedPostavke)
- Helper `buildBonPicaAdjustedPostavke()` prilagodi postavke pred escpos tiskanjem
- Pokrite pice: cenaKos=0, skupaj=0, cenaKosOriginalna=original → prikaže "100% popust" vrstico
- Vse tri tiskalne poti (ZCS, HTML, ESC/POS) kličejo ta helper
- ZCS in HTML route-i morajo imeti `artikelId: postavkeTable.artikelId` v selectu

### Recepty (pos-escpos.ts)
- "Bon za pico" vrstica ostane na tiskanici kot INFORMATIVNA (negativni znesek)
- "Ostane za plačilo" se IZRAČUNA SAMO ŠE ZA DARILNI BON (skupaj je že neto!)
  - Staro: `skupaj - bonPicaZn - bonZn`
  - Novo: `skupaj - bonZn` (in samo kadar bonZn > 0)

### Statistike (statistike.ts)
- `netSql` = `SUM(skupaj::numeric)` — NE odštevamo bonPica (skupaj je že neto)
- Per-natakar SQL: `skupaj::numeric` brez `- COALESCE(znesek_bon_pica, 0)`
- `znesekBonPica` ostane shranjen za informativni prikaz (koliko je skupaj vrednost bonov)

### ERP sync (posSyncBooking.ts) — NI SPREMEMB
- Debet: gotovina/kartica (neto) + bonPica (info znesek) → skupaj = full postavke
- Kredit: prihodki iz postavke.skupaj (full cene, nespremenjene v DB) → skupaj = full
- Temeljnica se uravnoteži: (net_payment + bonPica) = prihodki iz postavk ✓

### Backward compatibility
- Stari računi (pred spremembo): skupaj = bruto. Statistike bodo za te pokazale višje vrednosti.
- To je znana enkratna neskladnost. Za nove račune je vse pravilno.
