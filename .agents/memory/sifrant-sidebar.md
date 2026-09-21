---
name: Šifranti — dostop med moduli
description: Trajna avtorizacijska pravila za skupne šifrante v ERP, OS in POS.
---

## Pravilo

- Partnerje lahko urejajo vse dodeljene ERP, OS in POS vloge.
- Stroškovna mesta in kontni plan lahko v POS ureja samo vloga `admin`; drugi POS vlogi sta read-only.
- Projekti in oddelki ostanejo za vse POS vloge read-only, tudi za POS `admin`.
- ERP in OS pravila ostanejo neodvisna od POS pravil.
- Superadmin nima implicitnega bypassa; potrebuje izrecno dodeljeno vlogo.
- Hierarhični parent mora vedno pripadati istemu podjetju, celoten ancestry pregled pa mora ostati tenant-scoped.

**Why:** POS admin potrebuje lastno urejanje StM in kontnega plana, ne pa širših računovodskih dimenzij. Ločena pravila preprečujejo nenamerno širjenje pravic med moduli.

**How to apply:** Novo write dovoljenje omeji na točno določen šifrant. Ne uporabljaj skupne kategorije dostopa, če bi s tem POS dobil pravice nad drugimi dimenzijami.

## POS uporabniška izkušnja

Stroškovna mesta in kontni plan sta interni POS strani. Nedovoljena vloga dobi jasno opozorilo, podatkovna poizvedba pa se ne sme sprožiti.