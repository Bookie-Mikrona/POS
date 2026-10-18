---
name: Stripe operativna obvestila
description: Razlog za skupno rezervacijo obvestil in meje best-effort dostave.
---

Operativna Stripe obvestila rezerviraj skupno pred poskusom dostave; neuspešna
e-pošta in rezervni kanal ne smeta sprostiti cooldowna ali sprožiti lokalnega
nadomestnega dedupliciranja. Dostava mora ostati ločena od odgovora webhooka.

**Why:** Ob sočasnem Stripe in SMTP izpadu bi ponavljanje na vsako zahtevo ali
proces povzročilo poplavo opozoril. Izbrana je best-effort dostava z možnostjo
izgube ob prekinitvi procesa po rezervaciji; zagotovljena dostava zahteva ločeno
trajno vrsto, ne odstranitve skupne rezervacije.

**How to apply:** Pri dodajanju novih kanalov ohrani isti skupni claim in pošiljaj
le stanje, začetek incidenta in število napak. Brez delujoče skupne shrambe ne
pošiljaj samostojnih opozoril iz vsakega procesa.
