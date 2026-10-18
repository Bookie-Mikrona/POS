---
name: Manual SQL integrity migrations
description: How manual PostgreSQL constraints stay aligned in development and API tests.
---

Ročne SQL migracije, ki določajo integritetne omejitve zunaj Drizzle sheme, se ne smejo obravnavati kot samodejno uporabljene samo zato, ker datoteka obstaja v `lib/db/src/migrations`.

**Why:** Drizzle schema push ne zagotovi uporabe teh zgodovinskih SQL datotek. Brez izrecnega, varnega testnega migracijskega koraka lahko razvojna/testna baza zaostane za aplikacijsko logiko in omogoči ali zavrne napačne podatke.

**How to apply:** Za takšno omejitev dodaj ponovljivo varno migracijo (idempotentni `DROP CONSTRAINT IF EXISTS` + pravilen `ADD CONSTRAINT` kjer je to ustrezno), jo uporabi nad razvojno bazo pred preverjanjem in jo vključuj v API testni predkorak. Migracija mora delovati v transakcijskem runnerju in v `psql` autocommit načinu; začasnih tabel ne uporabljaj z `ON COMMIT DROP`, razen če je transakcija zagotovljena, ampak jih eksplicitno odstrani. Ne dodajaj DDL ob zagonu produkcijske aplikacije; produkcijsko shemo uredi Publish diff po usklajeni razvojni bazi.

Omejitve, dodane kot `NOT VALID`, morajo po preverjanju podatkov dobiti tudi idempotentni `VALIDATE CONSTRAINT`.

**Why:** Replitov Publish diff lahko `pg_get_constraintdef` iz nevalidirane razvojne omejitve, ki že vsebuje `NOT VALID`, napačno ponovno ovije in izdela sintaktično neveljaven stavek z odvečnim zaklepajem.

**How to apply:** Pred objavo preveri kršitve z read-only poizvedbo, validiraj samo čiste omejitve v razvojni bazi in ponovno izračunaj development→production diff; v njem ne sme ostati oblika `NOT VALID);`.

Zgodovinska migracija v ponovno izvajanem post-merge nizu mora sprejeti tudi vrednosti, ki jih istemu constraintu dodajo poznejše migracije.

**Why:** Ob ponovnem izvajanju nad trenutno bazo lahko starejši vmesni `ADD CONSTRAINT` sicer zavrne že veljavne novejše vrstice, zato runner pade, preden doseže poznejšo razširitev constrainta.

**How to apply:** Pri replayanih enumskih `CHECK` omejitvah uporabi naprej združljiv nabor trenutno dovoljenih vrednosti ali drugače zagotovi, da nobena vmesna migracija začasno ne zoži končne sheme.

Stara unikatna omejitev brez velikostnega ključa se pri ponovnem zagonu preskoči, ko je bila dodana poznejša kolona, ki omogoča velikostne različice.

**Why:** Testni predkorak ponovno izvede tudi stare migracije; prvotna omejitev (en artikel na enoto) lahko po uvedbi velikostnih različic zavrne pravilne podvojene povezave.

**How to apply:** Zgodovinsko omejitev pogojno dodaj samo, če novejša velikostna kolona še ne obstaja; poznejša migracija nato poskrbi za ustrezne delne unikatne indekse.

Vsaka migracija v klasificiranem testnem obdobju potrebuje usklajeno klasifikacijsko glavo in vpis v testni manifest; vse operacije morajo prenesti ponovni zagon nad že posodobljeno bazo.

**Why:** Samo glava brez manifesta ustavi validacijo, ne-idempotentni `CREATE TYPE` pa ustavi replay. Legacy backfill je posebej nevaren, ker ob ponovitvi ne sme spreminjati novih poslovnih zapisov.

**How to apply:** Klasifikacijo v SQL in manifestu ohrani enako ter navedi odvisnost od prejšnje migracije. Enum ustvari z varno obravnavo `duplicate_object`; stolpec dodaj pogojno, začetni backfill pa izvedi samo v isti veji, ko stolpec še ni obstajal.

Testni bootstrap ne sme ponovno nastavljati obstoječih poslovnih POS izbir ali obveznosti skupin modifikatorjev. Potrebno shemo loči od takega poslovnega backfilla.

**Why:** Uporabnik je izrecno dovolil odpravo migracijske ovire samo brez spreminjanja obstoječih POS nastavitev. Idempotentnost SQL ni dovolj: ponovljivi UPDATE lahko še vedno prepiše poznejšo uporabnikovo odločitev.

**How to apply:** Poslovni backfill izključi iz testnega runnerja z izrecnim razlogom; manjkajoče stolpce zagotovi z ločeno registrirano schema-only migracijo. Ne oslabi validacije migracijskega inventarja.

Migracije z `CREATE INDEX CONCURRENTLY` naj vsebujejo samo en SQL stavek in se izvajajo v autocommit načinu.

**Why:** PostgreSQL več stavkov v enem odjemalčevem klicu obravnava kot implicitno transakcijo, tudi brez izrecnega `BEGIN`; sočasna gradnja indeksa v njej ni dovoljena. Začasne tabele te omejitve ne preverijo, ker se njihovi indeksi ne gradijo sočasno.

**How to apply:** Več sočasnih gradenj razdeli v ločene migracije in preveri izvajanje tudi na običajni razvojni tabeli, ne samo na začasni testni kopiji. Po prekinjeni gradnji preveri veljavnost: `IF NOT EXISTS` ne obnovi neveljavnega indeksa.