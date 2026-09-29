---
name: Imena datotek pri predstavitvi sredstev
description: Omejitev prenosa ustvarjenih datotek v knjižnico.
---

Za pot datoteke, ki jo predstavljamo kot sredstvo, uporabi ASCII znake, četudi vsebina datoteke uporablja Unicode.

**Why:** Prenos CSV z znakom č v imenu datoteke je odpovedal pri pretvorbi poti v ByteString; isto datoteko z ASCII imenom je bilo mogoče predstaviti.

**How to apply:** Slovenske znake obdrži v vsebini in naslovu, ne pa v zadnjem delu poti do datoteke ob predstavitvi.