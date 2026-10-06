---
name: Prikaz računovodskih datumov
description: Zahtevana oblika datumov v glavni knjigi in združljivost datumskih vnosov.
---

V računovodskem delu se datumi prikazujejo in vnašajo v obliki dd.mm.yyyy, z vodilnimi ničlami in brez presledkov. Poslovni datumi ostanejo enaki; strežnik še vedno prejema ISO datume.

**Why:** Uporabnik je izrecno opozoril na številne neenotne datume v glavni knjigi. Oblika nativnega datumskega polja je odvisna od brskalnika oziroma operacijskega sistema, zato sama slovenska nastavitev strani ni zagotovilo za zahtevani prikaz.

**How to apply:** Poenoti tudi filtre, podrobnosti, opozorila in naslove obdobij. Loči dokumentni datum od dejanskega časovnega žiga; slednji potrebuje lokalni čas Europe/Ljubljana. Menjava prikaza ne sme spreminjati API pogodbe, dogodkov vnosnega polja ali obstoječih poslovnih validacij.

Skladen, a glede na min/max nedovoljen datum mora ostati na voljo poslovni validaciji, kot pri nativnem datumskem polju. Sintaktično neveljavnega vnosa pa ne sme nadomestiti prejšnji veljavni datum.

**Why:** Če vnos datum zunaj dovoljene meje pretvori v prazno vrednost, obrazec izgubi natančno poslovno opozorilo, denimo da tečaj ne sme veljati po datumu računa.

**How to apply:** Ohraniti je treba ločeno preverjanje koledarske veljavnosti, min/max in poslovnih pravil. Podpri tudi prilepljen ISO datum, vendar ga uporabniku pokaži v zahtevani slovenski obliki.
