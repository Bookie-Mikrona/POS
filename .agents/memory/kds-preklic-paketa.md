---
name: KDS preklic nepredanega paketa
description: Pravilo za varen preklic večhodnega paketa po materializaciji KDS in pred dejansko predajo.
---

KDS materializacija ni isto kot dejanska predaja. Še nepredan paket je dovoljeno odstraniti, vendar KDS dogodkov ni dovoljeno brisati. Nalog se označi kot preklican, doda se append-only dogodek preklica, povezava na izbrisano postavko pa se odveže.

**Why:** KDS dogodki imajo append-only zaščito. Poskus kaskadnega brisanja povzroči napako, neposredno brisanje zgodovine pa bi uničilo audit. Brez skupnega zaklepa lahko sočasni bump ali ack po preklicu ponovno oživi nalog.

**How to apply:** Materializacija, brisanje skupine in vsi KDS prehodi istega naročila morajo uporabljati isti transakcijski zaklep. Po zaklepu vedno ponovno preveri stanje; sproščenih, pripravljenih, prevzetih, predanih ali zaračunanih skupin ne preklicuj.