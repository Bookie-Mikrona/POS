---
name: POS kartične reference
description: Pravilo za varno, enkratno uporabo SumUp/Viva terminalskih referenc pred fiskalizacijo.
---

Vsako terminalsko referenco ponudnika je treba **atomsko in globalno** rezervirati pred klicem FURS, ne le preveriti, ali že obstaja na računu. Rezervacijo morajo uporabljati navadni POS računi in izdaje darilnih bonov enako; njen unikatni obseg mora biti identičen obsegu zaščite na računih. Pred klicem ponudnika mora obstajati tudi trajna plačilna namera s stabilnim klientskim ključem.

**Why:** Preverjanje pred FURS brez atomske rezervacije omogoči dvema hkratnima zahtevkoma, da oba fiskalizirata isto plačilo, poznejša DB omejitev pa drugega ustavi šele po fiskalizaciji. Timeout po zunanjem klicu ni dokaz neuspeha; avtomatski retry z novo referenco lahko stranko bremeni dvakrat. Obseg po podjetju je prav tako prešibek, če so ponudnikovi ID-ji globalni.

**How to apply:** Pred ponudnikom rezerviraj stabilen payment-attempt ključ. Retry iste namere sme vrniti le isto referenco oziroma shranjeni rezultat. Nejasen timeout označi kot `unknown` in ga ne pošiljaj znova. Nato zasedi provider+reference pred FURS ter jo po uspešni shranitvi poveži z računom. Gotovinski tokovi ne smejo nositi starih terminalskih referenc.