---
name: Clerk POS E2E
description: Varen prijavljen preizkus POS-a in omejitve obnove programske Clerk testne seje pri polni navigaciji ERP.
---

Programska Clerk testna seja potrdi identiteto, vendar POS dostop še vedno zahteva svoj aktiven uporabniški zapis in veljavno enoto. Test naj po prijavi uporabi dejanski Clerk userId, ustvari izolirano POS-vlogo in jo v zaključnem čiščenju odstrani.

**Why:** Brez POS-vloge `/api/pos/auth/me` pravilno vrne 403; odjemalec zato ne odpre zaščitenega POS-a, čeprav je Clerk seja veljavna.

**How to apply:** Pri prijavljenih E2E-testih ustvari unikatno podjetje, enoto in POS-uporabnika za dejanski testni userId. Ne dodajaj razvojnega ali produkcijskega obvoda Clerk preverjanja. Čiščenje mora teči tudi po neuspelem koraku.

Pri programsko vzpostavljeni Clerk testni seji loči navigacijo znotraj aplikacije od polnega ponovnega nalaganja. Izguba testne seje pri `page.goto` sama po sebi ne dokazuje napake obiskane strani.

**Why:** V ERP preizkusu 2026-10-02 sta polni navigaciji na nadzorno ploščo in kartico partnerja izgubili Clerk uporabnika kljub ohranjenim piškotkom ter uspešnim Clerk zahtevam. Ista identiteta je pri navigaciji znotraj aplikacije ohranila sejo tudi čez več osvežitev žetona. Vzrok obnove testne seje ni bil potrjen.

**How to apply:** Pred popravljanjem aplikacijske prijave preveri, ali enako odpove nepovezana zaščitena stran. Za preizkus same funkcionalnosti uporabi navigacijo znotraj aplikacije; za trditev o pravilni obnovi po reloadu je potreben ločen zanesljiv prijavni preizkus. Ne zmanjšuj prijavnih zaščit zaradi omejitve testnega postopka.

Pri večsejnem dokazu sprememb pravic meri promet vsakega brskalniškega konteksta posebej in osnovne števce zajemi šele po stabilizaciji vseh povezav za sprotna obvestila.

**Why:** Pri živem preizkusu so zbirne strežniške napake vsebovale tudi zahteve SuperAdmin zaslona in nepopolne testne priprave. Same niso dokazovale napake oddajanja med podjetji; začetno vzpostavljanje povezave je prav tako lahko videti kot dodatna osvežitev pravic.

**How to apply:** Pred spremembo preveri veljavno izbrano enoto in sprejet tok za vsako sejo. Šele nato meri dodatne zahtevke za pravice, dokumentne navigacije in ponovne povezave. Kontrolno podjetje mora imeti lastne števce, ne sklepa iz skupnega strežniškega dnevnika.