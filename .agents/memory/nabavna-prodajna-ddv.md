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

## Pravilna arhitektura (3 elementi)

1. **Dejanska nabavna stopnja** — živi na postavki prevzema/prejetega računa, ne na artiklu
2. **Pričakovana nabavna stopnja** — izpeljana iz `taxCategory` + `addedSugar` s funkcijo `pricakovanaNabavnaDdv()`:
   - `food`, `food_drink` → 9,5 %
   - `hot/cold_beverage`, brez dodanega sladkorja → 9,5 %
   - `hot/cold_beverage`, z dodanim sladkorjem → 22 %
   - `alcoholic`, `other` → 22 %
3. **Validacija ob prevzemu** — primerjaj dejansko z izpeljano; opozorilo z možnostjo potrditve (ne blokada); potrjeno odstopanje zabeleži z razlogom (pavšalist, samoobdavčitev, mali zavezanec)

## Posledica za kodo

- Polje `davek` na artiklu je **samo shranjeno izpeljano vrednost** (samodejno iz `pricakovanaNabavnaDdv()`), ni ročno vnosno
- **Nikoli ne primerjaj `davek` z `taxCategory`** — razlika je pričakovana in zakonita
- **Nikoli ne prikazuj opozorila** med `davek` in `taxCategory` na artiklu
- Vsaka stran se kontrolira ločeno: nabavna pri prevzemu, prodajna prek razreševalnika pri naročilu

**Why:** Sporočil uporabnik 2026-07-30; arhitektura potrjena z dokumentom o gostinskem DDV sistemu.
