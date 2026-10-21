---
name: Privzeti šifranti nove enote
description: Osnova uvoza privzetih šifrantov je enota Križišče; pravila uvoza in kaj se ne prenese.
---
Osnova in vodilo privzetih šifrantov so artikli enote Križišče (brez drobnega inventarja); Bookie dopolnilni artikli so le tisti, ki jih Križišče nima.

**Why:** uporabnik je izrecno določil Križišče kot vodilo za normative, polizdelke, pripravljene in sestavljene artikle.

**How to apply:** podatki so generirani posnetek (privzeti-sifranti-podatki.ts), ne ročno urejati; ob spremembi Križišča posnetek ponovno ustvari. Uvoz je dopolnilen (po imenu, ločeno prodajni/neprodajni, ker pripravljena osnova in sestavljena jed smeta imeti isto ime), nikoli ne prepiše. Alergeni, modifikatorji in PLU se ne prenesejo. Pica ob uvozu dobi testo (pizza_dough_settings), če ga enota nima. Artikli s ceno 0 v Križišču so izpuščeni.
