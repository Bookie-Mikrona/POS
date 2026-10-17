---
name: Ponovno knjiženje amortizacije
description: Poslovno pravilo za popravljanje že ustvarjenih amortizacijskih temeljnic.
---

Obstoječi osnutek ali potrjena temeljnica preprečuje nov vnos za isto obdobje. Ponoven obračun ne sme tiho zamenjati vrstic obstoječega osnutka. Popravek zahteva izrecen izbris osnutka ali storno potrjene temeljnice; zgodovino stornov ohrani.

**Why:** Zahteva za preprečevanje dvojnikov velja tudi za osnutke. Uporabnik mora dobiti možnost odpreti obstoječo temeljnico, ne nevidnega prepisovanja že pregledanih podatkov. Stornirana knjižba pa ne sme trajno onemogočiti popravka.

**How to apply:** Enako pravilo uporabi za letni in mesečni obračun ter njun vzajemni izklop. Aplikacijsko preverjanje in omejitev v bazi morata obravnavati iste aktivne statuse.
