---
name: Stripe boni po gostincu
description: Pravilo ločitve plačil spletnih darilnih bonov med gostinci in platformo.
---

Spletne bone je dovoljeno prodajati samo kot neposredna plačila na Stripe račun gostinca, povezan z njegovim podjetjem. Mikrona je lahko platforma Connect, vendar nikoli nadomestni prodajalec bonov. Novo plačilo brez veljavne povezave odpove zaprto; zgodovinska plačila platforme so le zapuščina za obravnavo že opravljenih transakcij, ne možnost za nove seje.

**Why:** Uporabnik je izrecno potrdil, da Mikrona Stripe računa ne bo uporabljala za prodajo bonov; uporabljali ga bodo gostinci. Napačen račun pomeni napačnega prejemnika denarja.

**How to apply:** Pri spremembah checkouta, onboarding toka, podpisanih Connect webhookov ali ponovitvah preveri povezani račun in način delovanja glede na posnetek nakupa; dva različna dogodka za isto plačilo ne smeta izdati dvojnih bonov. Nikoli ne uvedi fallbacka na platformo.

Replitova povezava Stripe je lahko označena kot zdrava, a omogoča le posredovane klice in aplikaciji ne vrne surovega `secret_key`. Za Stripe SDK Connect zato platforma potrebuje lasten API ključ, ločen po testnem in živem načinu; to platforme ne spremeni v prodajalca bonov.

**Why:** Aktivna povezava je pri preverjanju vrnila prazno polje za skrivni ključ, čeprav je bil Connect OAuth client ID in podpis webhooka že varno nastavljen. Samo ti dve vrednosti ne zadoščata za klice Stripe API.

**How to apply:** Pred poskusom onboardinga preveri dostop do platformnega Stripe API brez razkritja ključa; pri produkciji nikoli ne uporabi testnega platformnega ključa in ne predpostavljaj, da zdrava oznaka integracije pomeni razpoložljiv surov ključ.