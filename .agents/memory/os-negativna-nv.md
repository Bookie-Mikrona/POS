---
name: OS negativna NV korekcija
description: Uvožene korekcijske doknjižbe (storni dograditev) imajo negativno nabavna_vrednost. Engine mora vrniti amortizacijo = 0, ne negativno vrednost.
---

## Pravilo
Doknjižba z `nabavna_vrednost < 0` je uvožena korekcija (storno dograditve iz starega sistema).
- Nikoli ne amortiziramo negativne osnove.
- `obracunano` je vedno **>= 0** (invarianta).

**Why:** `Decimal.min(negativna_letna, pozitivna_preostalo)` vrne negativno — bug ki ga engine ne sme dopustiti.

## Implementacija (osAmortizacijaEngine.ts)

1. **`calcObracunana`**: guard `if (new Decimal(letnaAmort).lte(0)) return "0.00";` takoj po `stMesecev === 0` check.
2. **`calcAmortizacijaObracun`**: `else if (osnD.lt(0)) { opomba = "negativna_osnova"; }` po `polno_odpisano` check.

Oba sta obramba v globino — `negativna_osnova` branch vrne `obRac = "0.00"`, `calcObracunana` guard pa zaščiti pred morebitnimi drugimi potmi.

## Opomba v DB tipu
`DoknjizbaAmortResult.opomba` vrednosti: `null | "brez_aktivacije" | "polno_odpisano" | "brez_skupine" | "negativna_osnova"`.

## Znane negativne NV v bazi (6dd84bed)
- `0000184` seq=1: NV=−4.365,51, letna=−873,10 → po popravku engine vrne 0.00
- `0001238` seq=1: NV=−709,88, letna=−141,98 → po popravku engine vrne 0.00

## DB popravek
En napačen zapis popravljen direktno:
```sql
UPDATE os_amortizacija_obracun_sredstvo SET obracunano = '0.00' WHERE id = 'f5f748b8...';
```
Po popravku: 0 negativnih zapisov v celotni tabeli.
