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