---
name: Obračun ur nočnih izmen
description: Poslovno pravilo za razvrščanje ur izmen čez polnoč in mejo obračunskega obdobja.
---

Izmeno za obračun ur razdeli po lokalnih koledarskih dnevih v časovnem pasu Europe/Ljubljana. Obdobje dobi samo dejanski del izmene znotraj svojih dni; ena razrezana izmena v agregatih še vedno šteje kot ena izmena.

**Why:** Uporabnik je potrdil, da morajo biti ure na meji meseca pripisane mesecu, v katerem so dejansko opravljene. Dejanski pretečeni čas pravilno upošteva krajšo spomladansko in daljšo jesensko noč.

**How to apply:** Uporabi polodprte lokalne intervale `[od, do)`, razreži na lokalnih polnočeh in trajanje meri med UTC trenutki. Dnevne segmente zaokroži za prikaz, agregati pa naj ostanejo vsota prikazanih segmentov.