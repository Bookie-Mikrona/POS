---
name: PostgreSQL backup manifest
description: Pravila za preverjanje združljivosti in varen rollback pri celotnih PostgreSQL kopijah.
---

Manifest varnostne kopije mora podpisati vsebino SQL kopije ter odtis schema-only dumpa. Pred obnovo primerjaj odtis z živo bazo, po uspešnem atomarnem restore-u pa stabilni strukturni manifest in števce; PostgreSQL lahko semantično enak DDL po ponovnem parsiranju tekstovno prepiše.

**Why:** Tudi ob enakih zastavicah dump→restore lahko prerazporedi ekvivalentne caste v CHECK izrazih. Poleg tega `setval(..., false)` pomeni še neuporabljeno sekvenco in se mora primerjati kot `pg_sequences.last_value = NULL`, ne kot začetna številka.

**How to apply:** Pred obnovo preveri podpis, hash, bazo, PostgreSQL major, strukturo in schema-only odtis. Po obnovi preveri strukturo, semantične objekte ter sekvence. Round-trip teste poganjaj le v lastnem lokalnem clusterju z fail-fast preverjanjem ciljne baze.

Za normalizacijo CHECK izrazov uporabi PostgreSQL razčlenjevalnik s ponovno sestavo na začasnem objektu; ne odstranjuj castov, presledkov ali oklepajev z regexi.

**Why:** Navidez kozmetične spremembe lahko spremenijo tipovno semantiko ali besedilni literal. Ponovno parsiranje odpravi znani ekvivalentni prepis castov brez izgube pomena.

**How to apply:** Začasne objekte ustvarjaj na namenski povezavi v transakciji z obveznim rollbackom in stabilnim search_path. Ob starih kopijah brez semantičnega manifesta ne znižuj samodejno varnosti; zahtevaj ločen nadzorovan postopek obnove.