---
name: Clerk POS E2E
description: Varen način prijavljenega brskalniškega testiranja POS-a brez produkcijskega obvoda avtentikacije.
---

Programska Clerk testna seja potrdi identiteto, vendar POS dostop še vedno zahteva svoj aktiven uporabniški zapis in veljavno enoto. Test naj po prijavi uporabi dejanski Clerk userId, ustvari izolirano POS-vlogo in jo v zaključnem čiščenju odstrani.

**Why:** Brez POS-vloge `/api/pos/auth/me` pravilno vrne 403; odjemalec zato ne odpre zaščitenega POS-a, čeprav je Clerk seja veljavna.

**How to apply:** Pri prijavljenih E2E-testih ustvari unikatno podjetje, enoto in POS-uporabnika za dejanski testni userId. Ne dodajaj razvojnega ali produkcijskega obvoda Clerk preverjanja. Čiščenje mora teči tudi po neuspelem koraku.