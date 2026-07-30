---
name: Nabavna vs. prodajna DDV stopnja
description: V gostinstvu je razlika med nabavno in prodajno DDV stopnjo sistemska in zakonita — nikoli ne sme sprožiti opozorila.
---

## Pravilo

Nabavna DDV stopnja (polje `davek` / `artTax`) sledi **naravi blaga** (kaj kupiš).  
Prodajna DDV kategorija (polje `taxCategory` / `artTaxCategory`) sledi **načinu prodaje** (kako prodaš).

Razlika med njima je **normalna in zakonita** — odbitek vstopnega DDV ni okrnjen.

## Referenčni primer: Radenska (KN 2201, naravna mineralna voda)

```
artikel.taxCategory  = cold_beverage
artikel.addedSugar   = false   ← ključni podatek
```

| | Stopnja | Razlog |
|---|---|---|
| Nabavna (izpeljana) | 9,5 % | živilo/pijača, Priloga I / 48. člen Pravilnika |
| Prodajna pri mizi | 22 % | strežba pijač |
| Prodajna za s seboj | 9,5 % | cold_beverage brez sladkorja |

Radenska ACE / aromatizirane z dodanim sladkorjem/sladili → `addedSugar=true` → **22 % nabavna** (od 1. 1. 2025).  
Odločilna je deklaracija (prisotnost dodanega sladkorja), ne okus ali barva.

## Ostali primeri

| Artikel | Nabavna | Prodajna pri mizi | Prodajna za s seboj |
|---|---|---|---|
| Radenska (brez sladkorja) | 9,5 % | 22 % | 9,5 % |
| Radenska ACE (sladkor/sladila) | 22 % | 22 % | 22 % |
| Kava, čaj, kakav, mleko | 9,5 % | 22 % | 22 % |
| Embalaža (lonček, karton) | 22 % | Sledi jedi | Sledi jedi |

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

## Invarianta šifranta

**Artikel brez `taxCategory` ne sme obstajati (NOT NULL)** — velja za nabavne in prodajne.
- Nabavni (material): kategorija določa samo nabavno vejo (`pricakovanaNabavnaDdv`)
- Prodajni (blago): kategorija določa obe veji — nabavno in prodajno prek razreševalnika
- Storitev-artikel: prodajna stopnja je vedno 22 %, nabavna velja enako pravilo

Normativ med materialom in izdelkom **ne prenaša davčne logike** — samo količine.

## Primeri nabavnih materialov

| Material | taxCategory | addedSugar | Nabavna stopnja |
|---|---|---|---|
| Moka, meso, zelenjava, olje | food | — | 9,5 % |
| Kava v zrnu, čaj, kakav | hot_beverage | false | 9,5 % |
| Sirupi, sladkani pripravki | hot_beverage/cold_beverage | true | 22 % |
| Vino, rum za kuhinjo | alcoholic | — | 22 % |
| Lončki, kartoni, folije | other | — | 22 % |

Posebnost: instant pripravki 2101–2105 (vključno 3v1) → 9,5 % ne glede na sladkor —
za te potrebuje `purchase_rate_map` ločeno vrstico ali kljukico »instant_pripravek«.
