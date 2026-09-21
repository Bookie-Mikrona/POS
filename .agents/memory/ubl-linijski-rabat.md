---
name: UBL InvoiceLine AllowanceCharge
description: parser-eslog.ts ni bral InvoiceLine-level AllowanceCharge; popravek logike POS007 validacije.
---

# UBL InvoiceLine-level AllowanceCharge (EN 16931 BT-136)

## Pravilo

`parser-eslog.ts` bere `Price/AllowanceCharge` (EN 16931 BT-147, pojasni kako je nastala neto cena)
in `InvoiceLine/AllowanceCharge` (EN 16931 BT-136, ločen linijski popust).

**Why:** Dobavitelji pogosto navedejo cenik ceno v `PriceAmount` in ločen popust kot
`InvoiceLine/AllowanceCharge`. To je veljavni EN 16931 zapis, kjer je
`LineExtensionAmount = kolicina × PriceAmount - sum(InvoiceLine/AllowanceCharge)`.
Pred popravkom je parser ignoriral linijski AllowanceCharge → `POS007` blokirna napaka.

## How to apply

- **`Price/AllowanceCharge`** → `rabat1Odst = %`, `rabatVkljucenVCeni = true` (cena JE neto, rabat je le pojasnilo — service ga NE odšteje)
- **`InvoiceLine/AllowanceCharge`** (ko ni Price/AllowanceCharge) → `rabat1Odst = linijskiZnesek/(kolicina×cena)×100`, `rabatVkljucenVCeni = false` (cena je bruto — service ga odšteje)
- Kombinirani primer (oba) je redek in zahteva `rabat2Odst` — trenutno varnostno preskočen

## POS007 validacija

Preverja `min(difBruto, difNeto) > 0.02 EUR`. `difNeto` upošteva `netoPoRabatih` ko `!rabatVkljucenVCeni`.

**Resnost:**
- `razlika < 1.00 EUR AND relativni < 1 %` → `'O'` (zaokrožitvena razlika)
- `razlika >= 1.00 EUR OR relativni >= 1 %` → `'B'` (prava napaka, blokada)

Primer: Olje `1×8.45 = 8.45 ≠ 8.99` → 6 % → `'B'` ✓
