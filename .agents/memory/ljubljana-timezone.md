---
name: Ljubljana timezone
description: Pravila za delo z datumi in časi v slovenskem časovnem pasu (CET/CEST) v celotnem projektu.
---

## Pravilo

Slovenija uporablja dva časovna pasova:
- **Zimski čas (CET):** UTC+1 — od zadnje nedelje v oktobru do zadnje nedelje v marcu
- **Poletni čas (CEST):** UTC+2 — od zadnje nedelje v marcu do zadnje nedelje v oktobru

Ni enotnega fiksnega odmika. Kadar koli je potreben lokalni čas, **vedno** upoštevaj `Europe/Ljubljana` (IANA timezone), ne statičnega UTC+1 ali UTC+2.

## Kako shranjujemo datume v POS/ERP

Vsi dokumentni datumi (`inventure.datum`, `prejemnice.datum`, `izdajnice.datum`, itd.) so tipa `TIMESTAMP WITHOUT TIME ZONE` in se shranjujejo kot **UTC wall-clock vrednosti** (npr. `2026-01-03 23:59:59`).

**Why:** Strežnik teče v UTC. node-postgres bere `TIMESTAMP WITHOUT TIME ZONE` in ga vrne kot JS `Date` z UTC interpretacijo. Frontend prikazuje te datume z `timeZone: "UTC"` (`fmtDatumDoc`), kar dá pravilen lokalni datum brez timezone konverzije.

**How to apply:**
- Pri generiranju konca dneva za dokument: `new Date(Date.UTC(y, m-1, d, 23, 59, 59, 0))` — shrani `23:59:59 UTC`
- Pri prikazu datuma dokumenta na frontendu: vedno `timeZone: "UTC"` v `toLocaleDateString` / `Intl.DateTimeFormat`
- Za prikaz **realnih** UTC časovnih žigov (npr. `ustvarjeno TIMESTAMP WITH TIME ZONE`): normalna `toLocaleString("sl-SI")` je OK — brskalnik pravilno konvertira v `Europe/Ljubljana`
- Kadar koli moraš računati "poletni/zimski čas" za `Europe/Ljubljana`: uporabi `Intl.DateTimeFormat` z `timeZone: "Europe/Ljubljana"` — **nikoli** ne hardkodiraj +1 ali +2

## Pasti

- `new Date("2026-01-03")` → UTC polnoč → v LJ browsers prikaže kot `3. 1.` ✓, **ampak** `.toLocaleDateString()` brez `timeZone:"UTC"` na `23:59:59 UTC` pokaže `4. 1.` ✗
- `setHours(23, 59, 59)` nastavi LOKALNE ure (na UTC strežniku = UTC ure) — ne pokriva poletnega časa
- Hardkodirano `UTC+1` pokvari datume od marca do oktobra
