---
name: PostgreSQL backup manifest
description: Pravila za preverjanje združljivosti in varen rollback pri celotnih PostgreSQL kopijah.
---

Manifest varnostne kopije mora podpisati vsebino SQL kopije ter odtis schema-only dumpa. Pred obnovo primerjaj odtis z živo bazo, po uspešnem atomarnem restore-u pa stabilni strukturni manifest in števce; PostgreSQL lahko semantično enak DDL po ponovnem parsiranju tekstovno prepiše.

**Why:** Tudi ob enakih zastavicah dump→restore lahko prerazporedi ekvivalentne caste v CHECK izrazih. Poleg tega `setval(..., false)` pomeni še neuporabljeno sekvenco in se mora primerjati kot `pg_sequences.last_value = NULL`, ne kot začetna številka.

**How to apply:** Pred obnovo preveri podpis, hash, bazo, PostgreSQL major, strukturo in schema-only odtis. Po obnovi preveri strukturo ter sekvence. Round-trip teste poganjaj le v lastnem lokalnem clusterju z fail-fast preverjanjem ciljne baze.