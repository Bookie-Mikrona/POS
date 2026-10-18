---
name: CSV in preglednice
description: Omejitve zaščite pred formulami pri ponovnem shranjevanju CSV in pomen dejanskih pisarniških preizkusov.
---

Pri obljubah o varnosti CSV loči prvotno izvoženo datoteko od datoteke, ki jo
je uporabnik ponovno shranil v preglednici. Ne obljubljaj univerzalne zaščite
pri takem povratnem krogu.

**Why:** OWASP opozarja, da Excel ob shranjevanju in ponovnem odpiranju CSV
lahko odstrani apostrofe oziroma zaščitne znake. CSV nima tipiziranih celic;
pravilen uvoz v Calc ali uspešno branje XLSX z ExcelJS ne dokazuje izvajanja
v namiznem Excelu. Vir: https://owasp.org/www-community/attacks/CSV_Injection

**How to apply:** Pri preverjanju navedi program, način uvoza in obseg zagotovila.
Pri resničnem testu uvoza ne izklopi formul in ne vsili vsem celicam besedilnega
tipa, saj s tem zakriješ napako izvoza. Za nadaljnje urejanje finančnih poročil
daj prednost tipiziranemu XLSX. Če namizni Excel ni na voljo, to izrecno povej.
