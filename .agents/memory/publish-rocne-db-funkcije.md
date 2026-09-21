---
name: Publish in ročne DB funkcije
description: Omejitev Replit Publish schema validacije pri Drizzle shemah in ročnih PostgreSQL migracijah.
---

Replitov Publish primerja in validira Drizzle schema diff, še preden bi bile v produkciji na voljo ročne SQL migracije. Generirani stolpci, privzete vrednosti ali constrainti v Drizzle shemi zato ne smejo klicati funkcij, ki jih ustvari samo ročna migracija (npr. normalizatorji, zunanji PostgreSQL extensioni).

**Why:** prazna produkcijska baza nima ročno ustvarjenih funkcij ali extensionov. Schema validacija se ustavi že pri `CREATE TABLE`, če generirani izraz kliče tako funkcijo, in Publish pokaže »Failed to validate database migrations«.

**How to apply:** za funkcionalnost, ki potrebuje ročne DB funkcije, uporabi navaden shranjeni stolpec in izračun v aplikaciji ali pa se omeji na vgrajene PostgreSQL funkcije. Pred Publish preveri `explainSchemaDiff()` in se prepričaj, da SQL stavki ne vsebujejo takih funkcijskih odvisnosti.

Tudi constraint z oznako `NOT VALID` v razvojni bazi prepreči Publish, če se v diffu pojavi znotraj `CREATE TABLE`; ta sintaksa v PostgreSQL ni veljavna. Pred Publish preveri `pg_constraint.convalidated` in varno validiraj vsak constraint, za katerega podatki ne vsebujejo kršitev.