---
name: Ponovni zagon razvojnega okolja
description: Alternativa, kadar ukazna paleta v Replit Project Editorju ni dosegljiva.
---

Če uporabniku v Project Editorju bližnjica Ctrl+K ne odpre ukazne palete, je dokumentirana alternativa ponovni zagon razvojnega okolja iz lupine z `kill 1`. Ukaz prekine povezavo z lupino in razvojne storitve; produkcijske objave ne spreminja. Ne predpostavljaj, da Ctrl+K nikoli ne deluje — šlo je za opažanje v enem uporabniškem okolju.

**Why:** V tem okolju uporabnik ni našel ukaza Restart compute in Ctrl+K ni imel učinka, medtem ko je dokumentirani ukaz iz lupine sprožil pričakovano ponovno povezavo.

**How to apply:** Pred zagonom opozori na začasno prekinitev predogledov. Po ponovni povezavi zaženi samo potrebne upravljane storitve in preveri njihove dnevnike; nepotrebnih storitev ne zaganjaj samodejno.