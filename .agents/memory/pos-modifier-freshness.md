---
name: Svežina POS modifikatorjev
description: Pravilo za prikaz novih in spremenjenih modifikatorjev v že odprtem naročilu.
---

Spremembo povezave artikla z modifikatorsko skupino obravnavaj kot drugi, odvisni del shranjevanja artikla. Šele ko je povezava zapisana, osveži artikle, ki jih uporablja naročilo. Tudi spremembe same skupine ali njenega modifikatorja zahtevajo osvežitev artiklov, ne samo seznama skupin.

**Why:** Naročilo bere skupine in modifikatorje iz obogatenega seznama artiklov. Če se ta osveži pred dokončanjem povezave ali ostane veljaven po spremembi modifikatorja, se sprememba pokaže šele po ročnem osveževanju strani.

**How to apply:** Ob novih tokovih, ki spreminjajo modifikatorsko vsebino ali povezave, preveri tudi prikaz v naročilu brez ponovnega nalaganja strani; odgovor o uspešnem shranjevanju naj ne prehiti dokončanega povezovanja.