---
name: Podvojen API watcher
description: Okoljska past, ko ponovni zagon upravljanega API workflowa pusti star tsx proces na portu 8080.
---

Po ponovnem zagonu API workflowa obvezno preveri, da obstaja eno samo procesno drevo in da novi dnevnik vsebuje uspešen `Server listening`, ne `EADDRINUSE`.

**Why:** upravljani restart je nekoč pustil starega `tsx watch` otroka, ki je še naprej držal port 8080. Workflow je bil prikazan kot zagnan, brskalniški testi pa so zato tekli proti napačnemu procesu.

**How to apply:** po restartu primerjaj procese API strežnika, sveže workflow dnevnike in odziv porta. Če obstaja starejše podvojeno drevo, odstrani le stare procese in nato enkrat ponovno zaženi natančno obstoječi upravljani workflow.