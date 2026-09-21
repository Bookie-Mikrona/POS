---
name: Več QR naročil na isti mizi
description: Pravilo za ločena naročila različnih QR naprav in njihov prikaz osebju.
---

Različne QR naprave na isti mizi svojih odprtih naročil ne združujejo samodejno. POS mora zato pri mizi upoštevati vsa odprta naročila, pokazati njihov skupni pregled in osebju omogočiti odpiranje vsakega posameznega naročila.

**Why:** samodejno združevanje bi pomešalo neodvisne goste oziroma naprave, prikaz samo prvega odprtega naročila pa skrije vsa pozneje oddana QR naročila.

**How to apply:** pri prikazu, filtrih in statusu mize nikoli ne uporabi le prvega zadetka za odprto naročilo. Uporabi celoten seznam; ob več zadetkih ponudi jasen izbirnik, podatke pa ohrani ločene. Nova oddaja iste QR naprave se doda njenemu obstoječemu odprtemu naročilu. Vsaka oddaja ima idempotentni ključ in odtis vsebine; ponovitev vrne prvotni rezultat tudi po zaključku naročila, ponovna uporaba ključa z drugačno vsebino pa mora odpovedati.