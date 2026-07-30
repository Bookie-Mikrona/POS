---
name: Nabavna vs. prodajna DDV stopnja
description: V gostinstvu je razlika med nabavno in prodajno DDV stopnjo sistemska in zakonita — nikoli ne sme sprožiti opozorila.
---

## Pravilo

Nabavna DDV stopnja (polje `davek` / `artTax`) sledi **naravi blaga** (kaj kupiš).  
Prodajna DDV kategorija (polje `taxCategory` / `artTaxCategory`) sledi **načinu prodaje** (kako prodaš).

Razlika med njima je **normalna in zakonita** — odbitek vstopnega DDV ni okrnjen.

## Primeri

| Artikel | Nabavna | Prodajna pri mizi | Prodajna za s seboj |
|---|---|---|---|
| Steklenica vode / 100 % soka | 9,5 % | 22 % (cold_beverage) | 9,5 % (cold_beverage, brez sladkorja) |
| Kava, čaj, kakav, mleko | 9,5 % | 22 % (hot_beverage) | 22 % (hot_beverage) |
| Embalaža (lonček, karton) | 22 % | Sledi jedi (9,5 %) | Sledi jedi (9,5 %) |
| Sladka pijača v meniju | 22 % | 9,5 % (del menija) | — |

En artikel ima lahko eno nabavno in dve različni prodajni stopnji (pri mizi / za s seboj).

## Posledica za kodo

- **Nikoli ne primerjaj `davek` z `defaultDavekForCategory(taxCategory)`** — razlika je pričakovana.
- **Nikoli ne auto-sync** nabavne stopnje na osnovi prodajne kategorije.
- **Nikoli ne prikazuj opozorila** »Ne ujema se s kategorijo« na osnovi primerjave med `davek` in `taxCategory`.
- Vsaka stran se kontrolira **ločeno**:
  - Nabavna: `davek` vs. pričakovana stopnja za naravo blaga (preveri pri uvozu ali ročno)
  - Prodajna: `taxCategory` vs. DDV razreševalnik pri naročilu

**Why:** Sporočil uporabnik 2026-07-30 z jasno razlago gostinskega DDV sistema.
