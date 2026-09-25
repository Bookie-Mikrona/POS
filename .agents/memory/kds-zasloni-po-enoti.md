---
name: KDS zasloni po enoti
description: Pravilo za konfiguracijo operativnih KDS zaslonov glede na osebje in organizacijo posamezne enote.
---

Najpogostejša privzeta postavitev sta dva zaslona: točilnica in kuhinja. Enota določi, ali sta kuhinja in peka pic združeni na enem zaslonu ali ločeni na zaslon kuhinje in zaslon pic. Izdaja je izbirna možnost, ne obvezen korak.

**Why:** Število zaslonov mora slediti dejanski razpoložljivosti strežnega osebja, kuharjev in picopekov. Obvezna ločena izdaja v običajnih gostinskih obratih pogosto nima posebne osebe ali fizičnega mesta.

**How to apply:** Nastavitve vedno vodi po posamezni enoti. Ponudi profile: točilnica + skupna kuhinja; točilnica + kuhinja + pice; ter enega od teh profilov z izbirno izdajo. Usmerjanje artiklov izpelji iz izbranega profila in dovoljuj ročne izjeme.

Za prodajni artikel je vrsta priprave Pica/Hrana/Pijača ločena od davčne kategorije in od načina priprave hrane (à la carte, pripravljena zaloga, sestavljeno). Samo Hrana odpira izbiro načina priprave; Pica hkrati uporablja obstoječo oznako »je pica«. Ročno mapiranje postaj ima prednost pred samodejno postajo, kadar je nastavljeno.

**Why:** Davčna stopnja ne pove, katera postaja pripravi naročilo; kategorije starih menijev nimajo nujno oznake tipa, pice pa potrebujejo tudi združeno oziroma ločeno kuhinjsko postajo po profilu enote.

**How to apply:** Za stare artikle brez izrecne vrste najprej uporabi oznako pice, nato poslovni naziv/tip kategorije; embalaže ne označuj za jed ali pijačo. Ob novih spremembah ohrani enako prednostno zaporedje tudi v lokalnem/offline usmerjanju.

Ko je Izdaja vključena, postajni `bump` pomeni samo »pripravljeno«, fizična predaja pa je ločen, nespremenljiv dogodek na ravni celotnega naročila. Po predaji se sestava naročila ne sme več spremeniti.

**Why:** Potrditev posamezne postaje ni dokaz, da je gost dejansko prejel celotno naročilo. Enotni dogodek Izdaje mora ostati zanesljiva revizijska sled tudi ob ponovitvah zahtev, osvežitvah in sočasnih spremembah.

**How to apply:** Predaja in vse poti, ki dodajajo, spreminjajo, premikajo ali brišejo postavke, morajo uporabljati isti order-scoped transakcijski lock. Dogodek predaje je append-only; brez Izdaje ostane stari `bump → ack` tok.