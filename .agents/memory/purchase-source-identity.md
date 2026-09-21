---
name: Identiteta nabavnih listin
description: Pravila skupne identitete nabavnega vira ter atomarnega ERP ujemanja prejemnice z računom.
---

Skupna identiteta dobaviteljeve listine temelji na podjetju, dobavitelju in normalizirani številki; vrsta (`invoice` ali `delivery_note`) je klasifikacija in ne sme omogočiti drugega zajema istega vira. Hash vsebine je dodatna neodvisna zaščita.

**Why:** Ista e-listina lahko vstopi skozi POS, OCR, ERP račun ali prejemnico in bi brez skupnega vira ustvarila dvojno obveznost. Račun z dobavo je lahko v različnih tokovih različno klasificiran, vendar je še vedno isti dokument.

**How to apply:** Vsak nov nabavni vhod in vsaka sprememba dobavitelja ali normalizirane številke mora atomarno rezervirati skupni vir ter uporabljati business-key in source advisory lock. Povezanih zapisov ne preveži tiho. Legacy zapise varno backfillaj; dvoumne skupine zabeleži in blokiraj do razrešitve. Na že poknjiženi POS prejemnici ujemanje nikoli retroaktivno ne dopolni ali zamenja source ID-ja; če ga nima, način iste listine zavrni in uporabi ločeno povezavo ali računovodsko razrešitev. Osnutek računa sme prevzeti že obstoječi nespremenljivi vir prejemnice pod zaklepom. ERP `match` zahteva enak nenull source ID in je edini lastnik knjiženja računa: pod source in invoice lockom v eni transakciji ustvari GL in KPR; razvezava stornira oba.