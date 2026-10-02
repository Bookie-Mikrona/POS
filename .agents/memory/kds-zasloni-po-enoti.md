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

Embalaža in potrošni material se praviloma ne smeta prikazovati kot samostojni nalogi na KDS. Uporabnik je kot primere navedel posodo za hrano, aluminijasto folijo in škatlo za pico.

**Why:** To niso jedi za pripravo; odsotnost pravila usmerjanja ne pomeni, da jih je treba poslati na privzeto kuhinjsko postajo.

**How to apply:** Pri spremembah usmerjanja loči izključitev iz KDS od manjkajočega pravila. Izključeni artikli ne sodijo niti med nerazporejene artikle niti med samostojne naloge priprave. Izključitev določi uporabnik na artiklu; obstoječih artiklov ne spreminjaj samodejno zgolj po nazivu.

Izključitev je povratna operativna nastavitev, ne brisanje zgodovinskih nalogov ali sprememba prodaje in zaloge.

**Why:** Material za embalažo lahko ostane prodajna in zalogovna postavka, čeprav zanj ni priprave. Brisanje nalogov bi izgubilo revizijsko sled in otežilo ponovni vklop.

**How to apply:** Izključitev ima prednost tudi pred ročnim usmerjanjem in privzeto postajo. Izključeni nalogi ne blokirajo priprave ali Izdaje. Osvežen seznam strežnika je avtoritativen: optimistično stanje ne sme ponovno prikazati naloga, ki ga strežnik izloči.

Lokalna izključitev že obstoječega naloga mora ohraniti njegovo stanje priprave, ne ga pretvoriti v preklic.

**Why:** Lokalni preklic je terminalen; isti idempotentni nalog se po ponovnem vklopu ne začne znova. Izključitev zato ni enaka odstranitvi postavke iz naročila.

**How to apply:** Skrit nalog ob ponovnem vklopu vrni v njegovo prejšnje stanje. V živi vrsti ne kažita izključenih ali terminalnih nalogov; zgodovina mora ostati ločeno dostopna znotraj istega podjetja in enote.

Razpoložljivost pripravljenih jedi v kuhinji mora slediti naboru jedi iz dnevne evidence pripravljene hrane za trenutni poslovni dan, ne celotnemu katalogu pripravljenih in sestavljenih artiklov.

**Why:** Uporabnik zahteva isti operativni nabor kot v dnevni evidenci, ne splošnega pregleda vseh prodajnih kapacitet.

**How to apply:** Uporabi poslovni dan strežnika in dnevno evidenco. Jedi z ničelno razpoložljivostjo ne izloči zgolj zato, ker so že porabljene.

Na zaslonih točilnice in kuhinje naročila ne kažejo samodejnih oznak alergenov ali njihovih sledi. Točilnica tudi ne kaže ponavljajoče oznake postaje ob vsakem artiklu. Podatke o alergenih ohrani; ročne opombe in prehranske omejitve ostanejo vidne.

**Why:** Uporabnik je alergene na točilnici označil kot nepomembne in pozneje izrecno opozoril, da so v kuhinjskem KDS še vedno prikazani. Postaja točilnice je že razvidna iz zaslona.

**How to apply:** To je omejitev prikaza, ne brisanje podatkov. Samodejne oznake alergenov skrij na točilnici in v kuhinjskem KDS; ohrani ročne opombe, prehranske omejitve in operativna stanja priprave.