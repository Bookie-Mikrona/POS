---
name: KIR/KPR izvoz
description: Pravila za obseg obdobja, popolnost davčne sledi in mejo med XML izvozom ter eDavki oddajo.
---

Predogled, predizvozna kontrola in XML morajo uporabljati isti eksplicitno izbrani mesečni ali trimesečni datumski obseg. Izvoz odpove zaprto, če DDV-vrstica nima kode, aktivne evidence ali smerno ustrezne KIR/KPR preslikave.

**Why:** Koda obdobja sama ne razlikuje mesečnega marca od prvega trimesečja, tiho izpuščena preslikava pa lahko ustvari navidezno popoln davčni izvoz.

**How to apply:** Vsaka sprememba KIR/KPR mora skupaj preveriti predogled, strežniško kontrolo in generator. Prenos XML je ločen od potrjene oddaje; neposredne oddaje na eDavke ne predstavljaj kot implementirane brez odziva eDavkov.