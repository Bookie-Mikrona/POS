---
name: Drsenje zgornjega Vaul predala
description: Pravilo za mobilne sezname v Vaul predalih, ki se odpirajo z vrha.
---

Za zgornji mobilni izbor z notranjim drsnim seznamom na ZCS Z92 ne uporabljaj gestnega Vaul predala. Uporabi fiksno portalno ploščo z izvornim `overflow-y` drsenjem in izrecnim gumbom za zapiranje.

**Why:** Vaul 1.1.2 navpični poteg razume kot vlečenje predala; `handleOnly` oziroma nedismissible način pa na ciljni napravi lahko naredita notranji seznam statičen.

**How to apply:** Portalna plošča naj ima neposredno določeno višino, glava naj bo nespremenljive višine, seznam pa `min-height: 0`, preostalo višino, `overflow-y: scroll`, `touch-action: pan-y` in momentum scrolling.