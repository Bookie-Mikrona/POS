---
name: Kartično plačilo darilnega bona
description: Trajne varnostne meje za kartično izdajo darilnih bonov.
---

Kartična izdaja darilnega bona mora uporabljati strežniško ustvarjen, namenski payment intent. Klient hrani poslovni ključ, znesek v centih in kanonični attempt ID čez osvežitev strani, dokler izdaja ni dokončno uspešna ali ponudnik dokončno zavrne plačilo. Strežnik pred FURS ponovno preveri istega ponudnika, stanje, valuto in točen znesek; attempt se sme vezati na največ eno izdajo.

**Why:** Plačilo lahko uspe tik pred omrežno ali FURS napako. Izguba ključa ob reloadu bi povzročila novo bremenitev, sprejem klientove provider reference ali neusklajena centna/mejna validacija pa plačilo brez varne izdaje bona.

**How to apply:** Pri vseh novih providerjih za darilne bone uporabi ločen namen attempta, canonical UUID za izdajo, cele cente in enake dovoljene meje pred provider klicem ter pred FURS. `pending`/`unknown` se obnavlja z istim ključem; nikoli z novo bremenitvijo.