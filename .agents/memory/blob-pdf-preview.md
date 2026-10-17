---
name: Varen PDF ogled prek blob URL
description: Chromium v iframe sandbox blokira lastni PDF viewer tudi z allow-scripts in allow-same-origin.
---

Za prikaz preverjenega PDF blob-a ne uporabljaj iframe `sandbox`: Chromium blokira svoj vgrajeni PDF viewer tudi ob dovoljenih skriptah in istem izvoru.

**Why:** Brskalniški preizkus je pri veljavnem enostranskem PDF-ju pokazal blokirano vsebino, medtem ko je isti okvir pravilno prikazal PNG. Dodajanje `allow-scripts allow-same-origin` ni odpravilo blokade.

**How to apply:** Ogled omeji na strežniško preverjene PDF in rastrske MIME tipe, pridobi vsebino prek avtenticiranega klica in preverjenega odtisa ter dodatno preveri MIME blob-a. HTML in SVG ne smeta v ta nesandboxiran prikaz. Blob URL prekliči ob zaprtju ali odstranitvi komponente.
