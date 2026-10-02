---
name: Pomnilnik preverjanja tipov
description: Obsežna API/ERP preverjanja potrebujejo več kot 1 GiB V8 heap pomnilnika.
---

Za celotno API/ERP preverjanje v tem monorepu je 1 GiB V8 heap premalo; po potrebi za sam preverjevalnik uporabi 2 GiB.

**Why:** Omejen poskus je končal z V8 out-of-memory, medtem ko je preverjanje z 2 GiB končalo in vrnilo običajne TypeScript diagnostike. Čakanje na časovno omejitev ne pomaga ugotoviti napake v kodi.

**How to apply:** Pri počasnem preverjanju najprej preveri porabo pomnilnika. Začasni heap nastavi samo ukazu preverjevalnika, ne povečuj samodejno pomnilnika aplikacij ali spreminjaj njihovih nastavitev.