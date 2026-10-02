---
name: Prijava Clerk v POS
description: Kazalo povezanih omejitev SDK-ja, prevodov, sej in testiranja prijave POS.
---

Pred spreminjanjem prijave POS preveri ustrezno že dokumentirano omejitev.

**Why:** Inicializacija SDK-ja, preverjanje seje in izbira enote so ločeni deli prijave; popravek enega ne sme prekiniti drugega.

**How to apply:** Odpri samo podtemo, ki ustreza trenutnemu posegu:

- [Host-aware SDK](clerk-host-aware-sdk.md) — združljivost SDK-ja z Replitovim izborom ključa glede na gostitelja.
- [Slovenski prevodi](clerk-lokalizacija.md) — omejitve lokalizacijskih ključev pri uporabljeni različici.
- [Prijavljen POS v testih](clerk-pos-e2e.md) — programska seja potrebuje tudi veljavno vlogo in enoto.
- [Prehodni 401](pos-transient-401.md) — en sam neuspešen zahtevek ni dokaz odjave.
- [Obseg middleware varoval](pos-auth-router-scope.md) — varovala za enoto ne smejo blokirati prijave pred njeno izbiro.
- [SuperAdmin in POS enota](superadmin-pos-context.md) — platformni kontekst ne sme uporabljati nadomestne enote ali zaganjati operativnih POS klicev.