---
name: Upodabljanje POS priročnika v PDF
description: Neujemanje številčenja in omejitve označevanja pri pretvorbi Markdown poglavij.
---

V besedilu POS priročnika se na postopke sklicuj z nazivom, ne le s številko
razdelka. Krepko označenega besedila v oštevilčenih korakih ne prelomi med
dvema vrsticama Markdowna.

**Why:** Generator PDF samodejno preštevilči poglavja neodvisno od številk v
izvornem Markdownu. Vizualni pregled je pokazal tudi dobesedno izpisane
zvezdice, kadar se oznaka za krepki tisk prelomi sredi izraza.

**How to apply:** Ob vsaki novi izdaji preveri dejanski PDF na strani z
novim postopkom, ne le izluščenega besedila ali naslovov v kazalu.

Skupni Markdown renderer uporabljajo tudi računovodski priročniki.
Obvezni paketi in metapodatki naslovov veljajo za POS uporabniški
priročnik; poglavjem Glavne knjige ne pripisuj oznak POS Lite/Standard.

**Why:** Razmejitev davčnih evidenc je pokazala, da je uvedba obveznih POS
metapodatkov onemogočila starejše računovodske izvoze, ki uporabljajo isti
renderer. ERP vsebina ne sme dobiti napačnih paketnih oznak.

**How to apply:** Ob spremembi skupnega rendererja preveri tudi ne-POS
izvoze; izklop paketnega načina naj bo izrecen, POS validacija pa naj
ostane privzeto stroga.