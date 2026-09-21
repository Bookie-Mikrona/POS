---
name: FURS offline retry
description: Uradno pravilo za naknadno pošiljanje lokalno izdanih računov po prekinitvi povezave.
---

FURS ne ponuja statusne poizvedbe po MessageID, ZOI, EOR ali številki računa. Po nejasnem izidu prenosa se starega zahtevka ali XML-ja ne pošilja ponovno: vsak nov prenos je ločen append-only poskus z novim enkratnim MessageID, novim request ID-jem in novim XMLDSig.

Pravno jedro računa, številka, čas izdaje in ZOI ostanejo nespremenljivi. Pozni EOR se sprejme neodvisno od poteklega lease-a; isti EOR je idempotenten, različna EOR za isti račun pa zahtevata ročni pregled.

**Why:** FURS tehnična dokumentacija zahteva nov MessageID pri ponovnem pošiljanju zaradi napake in ne določa statusnega endpointa. Ponovna uporaba istega transportnega ovoja ali izmišljena statusna pot bi bila neskladna.

**How to apply:** Lokalna naprava zapečati in podpiše samo pravno jedro. Strežnik pred vsakim FURS I/O atomsko rezervira nov transportni poskus ter poslovne učinke finalizira največ enkrat.