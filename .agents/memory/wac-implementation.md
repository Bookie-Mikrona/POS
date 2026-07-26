---
name: WAC inventory valuation
description: Drseča tehtana povprečna nabavna cena (WAC) implementacija za POS zaloge
---

## WAC rules (drseča tehtana povprečna cena)
- Inflow (prejemnica, začetna zaloga): new_avg = (old_value + qty * unit_price) / (old_qty + qty)
- Outflow (poraba, inventura, izdajnica, storno): unit_cost = current_avg, avg does NOT change
- If no cost basis (all outflows, no receipts): WAC = NULL, value = 0

## DB schema additions
- `zaloga_gibi`: `cena_kos NUMERIC(14,6)`, `vrednost NUMERIC(14,4)` — cost and value per movement
- `zaloge`: `povprecna_cena NUMERIC(14,6)`, `skupna_vrednost NUMERIC(14,4)` — cached WAC and total value
- `zadnjaCena` alias preserved in API for backward compat (points to povprecnaCena)

**Why:** `zadnjaCena` (last receipt price) is wrong for valuation; WAC is the legally correct method for average-cost inventory.

## recomputeZaloge (pos-zaloge-utils.ts)
- Processes all zaloga_gibi for an article in datumDokumenta ASC, id ASC order
- JOINs to prejemnice_postavke and zacetne_zaloge_postavke to get source unit prices for inflows
- Iterates movements in JS, computing running qty/value, then batch-UPDATEs zaloga_gibi rows
- UPSERTs zaloge with final qty, WAC, and skupna_vrednost

## Backfill
- Existing data was backfilled via direct PostgreSQL DO $$ block (see scripts/recompute-wac.mjs for Node.js version)
- `/zaloge/reconcile` endpoint now triggers full WAC recompute for all articles in the enota

## Kartica view
- Returns `cenaKos`, `vrednost`, `stanjeKolicina`, `stanjeVrednost`, `stanjePovprecnaCena` per gibi row
- Running balance computed in API (not stored) — always accurate

## Important edge case
- Articles with ONLY outflows and no inflows: WAC = NULL, value = 0 (correct — no cost basis)
- Articles with outflows BEFORE first inflow: those specific rows get cena_kos=0
