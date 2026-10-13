---
name: PostgreSQL advisory lock in pool
description: Pravilo za varno uporabo sejnih advisory lockov prek pg Pool.
---

Sejni PostgreSQL advisory lock mora od `pg_try_advisory_lock` do
`pg_advisory_unlock` držati isto namensko povezavo iz poola; povezava se vrne v
pool šele po odklepu.

**Why:** Zaklep je vezan na PostgreSQL sejo. Ločena klica prek `db.execute()` lahko
uporabita različni povezavi, zato odklep ne sprosti prvotne seje in prihodnji
zagoni se lahko napačno preskočijo.

**How to apply:** Za dolgotrajne jobe pridobi `pool.connect()`, izvedi oba lock
klica na tem klientu in ga sprosti v `finally`. Alternativa je transakcijski
advisory lock z odprto transakcijo za celotno kritično sekcijo. Dodaj test z
dvema povezavama, ki potrdi blokado in sprostitev.

Preverjanje, ali ekskluzivna operacija (npr. obnova baze) poteka, mora dopuščati
sočasna preverjanja. Uporabi kratki shared lock za preverjanje in exclusive lock
za dejansko operacijo, z ustreznima paroma odklepov.

**Why:** Ekskluzivna preverjanja so med sočasnimi običajnimi POS zahtevami drugo
preverjanje napačno prepoznala kot obnovo baze. Dodelitev artiklov gostu je zato
uspela le delno, čeprav preklic opombe ni ničesar spremenil.

**How to apply:** Pri varovalih pred mutacijami preveri združljivost preverjanj
med seboj, blokiranje med dejansko operacijo in zaprto odpoved ob napaki baze.