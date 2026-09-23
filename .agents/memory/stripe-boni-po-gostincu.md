---
name: Stripe boni po gostincu
description: Pravilo ločitve plačil spletnih darilnih bonov med gostinci in platformo.
---

Spletne bone je dovoljeno prodajati samo kot neposredna plačila na Stripe račun gostinca, povezan z njegovim podjetjem. Mikrona je lahko platforma Connect, vendar nikoli nadomestni prodajalec bonov. Novo plačilo brez veljavne povezave odpove zaprto; zgodovinska plačila platforme so le zapuščina za obravnavo že opravljenih transakcij, ne možnost za nove seje.

**Why:** Uporabnik je izrecno potrdil, da Mikrona Stripe računa ne bo uporabljala za prodajo bonov; uporabljali ga bodo gostinci. Napačen račun pomeni napačnega prejemnika denarja.

**How to apply:** Pri spremembah checkouta, onboarding toka, podpisanih Connect webhookov ali ponovitvah preveri povezani račun in način delovanja glede na posnetek nakupa; dva različna dogodka za isto plačilo ne smeta izdati dvojnih bonov. Nikoli ne uvedi fallbacka na platformo.