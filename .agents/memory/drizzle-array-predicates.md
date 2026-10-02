---
name: Drizzle in seznami ID-jev
description: Za dinamične sezname ID-jev uporabi tipiziran inArray namesto neposredne interpolacije JS polja v ANY.
---

Dinamičen seznam ID-jev v Drizzle SQL izrazi z `inArray`; ne predpostavljaj, da interpolirano JavaScript polje postane PostgreSQL array.

**Why:** Neposredna interpolacija v `ANY` je v tem okolju ustvarila tuple namesto PG polja in veljavno zapiranje/ponovno odpiranje zavrnila. Tipiziran predikat je deloval v dejanskem DB testu.

**How to apply:** Enako pravilo velja za zaklepne poizvedbe. Pri napaki ne odstrani zaklepa ali tenant filtra; popravi konstrukcijo predikata.