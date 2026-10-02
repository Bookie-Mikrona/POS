---
name: Slovenski finančni formati in Intl
description: Okoljske razlike pri ločilih tisočic in znaku minus v slovenskih finančnih izpisih.
---

Pri preverjanju slovenskih finančnih izpisov ne predpostavljaj, da `Intl` izpiše ASCII minus ali ločilo tisočic pri štirimestnih zneskih.

**Why:** Okolje z aktualnim Node/ICU za `sl-SI` uporablja tudi znak `−` in lahko štirimestno število izpiše brez pike. To sta veljavna lokalizirana prikaza, ne napaki v saldu.

**How to apply:** Pri testih denarnih vrednosti loči pravilnost številskega rezultata od lokalizirane tipografije. Normaliziraj različici minusa in ločila skupin, kadar preverjaš vrednost; pri Excelovih izvozih preveri izvorno numerično celico, ne prikazanega besedila.