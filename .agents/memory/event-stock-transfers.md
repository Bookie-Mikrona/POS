---
name: Dogodkovni prenosi zaloge
description: Pravila za pripravo začasne enote, vračila in usklajen prikaz količin dogodka.
---

Zgodovina posamezne izhodne vrstice mora vedno izpolniti: poslano = porabljeno + preostalo + vrnjeno. Preostalo je največ poslano minus že zaključeno vračilo; dodatni prejemi istega artikla v začasno enoto ga ne smejo povečati.

**Why:** Trenutna zaloga ciljnega artikla lahko vključuje tudi druge prejeme. Če se prikaže neposredno, zgodovina dogodka pripiše tujo zalogo dogodkovnemu prenosu in poruši sledljivost.

**How to apply:** Pri zgodovini, osnutku vračila in poročilih količine omeji na izvorno vrstico prenosa. Osnutek vračila ni vrnjena količina, dokler dokument ni zaključen.

Dogodkovne tabele dokazujejo pripadnost podjetju prek sestavljenih identitet. Za artikle je prava meja `(artikel, enota)`, podjetje pa se izpelje iz enote; kopirani cilj mora pripadati ciljni enoti, izvor pa izvorni.

**Why:** Sam globalni ID artikla ali uporabnika je veljavna tuja referenca tudi takrat, ko pripada drugemu podjetju ali napačni strani prenosa.

**How to apply:** Pri novih dogodkovnih podzapisih shrani podjetje in izvorno/ciljno enoto ter uporabi sestavljene FK-je do dogodka, uporabnika, prenosa in artikla. Neposredni SQL ne sme obiti iste meje kot API.

Smer prenosa (`outbound`, `return`) in njegov status (`draft`, `completed`, `cancelled`) imata skupna seznama za Drizzle in aplikacijsko logiko ter točna validirana PostgreSQL `CHECK` pogoja.

**Why:** Drizzle `text` enum ne ščiti neposrednega SQL; neznana smer ali status poruši razvrščanje zgodovine, vračil in zaključevanja dogodka.

**How to apply:** Uskladitvena migracija naj ločeno prešteje neznane smeri/statuse, nato natančno primerja normalizirani definiciji ter po preflightu zamenja manjkajočo ali permisivno omejitev.

Prenos zaloge lahko napreduje le `draft → completed` ali `draft → cancelled`; terminalnih statusov ni dovoljeno ponovno odpreti. `completed` zahteva `completed_at`, vsa druga stanja pa ga ne smejo imeti.

**Why:** Ponovno odprtje že izvedenega prenosa ali neusklajen zaključni čas lahko omogoči ponovitev zalogovnih učinkov in spremeni zgodovino za nazaj.

**How to apply:** Prehode centraliziraj v aplikacijski politiki, DB pa jih uveljavi z `BEFORE UPDATE OF status` triggerjem. Ločen `CHECK` naj status in `completed_at` vedno obravnava kot eno stanje.

Po terminalnem statusu glave prenosa ni dovoljeno spreminjati, njegovih vrstic pa ni dovoljeno dodati, spremeniti ali izbrisati. Sprememba vrstice mora zakleniti nadrejeni prenos.

**Why:** Brez zaklepa lahko sočasni zapis vrstice prehiti ali obide zaključek in za nazaj spremeni količinsko oziroma vrednostno zgodovino.

**How to apply:** Outbound tok naj v eni transakciji ustvari `draft`, zapiše vrstice in gibe ter šele nato nastavi `completed`. Pri UPDATE vrstice trigger zaklene staro in novo glavo z `FOR UPDATE`, urejeno po ID.

Terminalne glave ni dovoljeno niti izbrisati; osnutek brez izvedenih učinkov ostane izbrisljiv. Dogodek, podjetje in enote imajo do prenosa `ON DELETE RESTRICT`.

**Why:** Kaskadni izbris glave bi sicer odstranil vse zamrznjene vrstice in celotno dokazljivo zgodovino prenosa.

**How to apply:** Produkcijski trigger naj zavrne `UPDATE OR DELETE` terminalne glave. Testno čiščenje naj trigger onemogoči le v transakciji z ekskluzivnim zaklepom in ga pred commitom ponovno omogoči.

Dogodkovni `zaloga_gibi` potrebujejo namenski FK na prenos poleg generičnega `referenca_id`; tip, smer prenosa in source/target artikel morajo kazati na točno eno vrstico.

**Why:** Generični številčni ID se prekriva med poslovnimi tabelami in sam ne dokazuje, kateri dokument je ustvaril količinski ter vrednostni učinek.

**How to apply:** Gibe ustvari, ko je prenos še `draft`, nato zaključi glavo. Po terminalnem statusu trigger zavrne INSERT/UPDATE/DELETE; WAC naj ne izdaja no-op posodobitev zamrznjenih gibov.

`completed` prenos mora imeti za vsako vrstico točno en out/in par gibov z enakimi artikli, količino, ceno in vrednostjo (s pravilnimi predznaki).

**Why:** Sam FK dokazuje izvor posameznega giba, ne pa popolnosti celotnega količinskega in vrednostnega učinka prenosa.

**How to apply:** Pri zaključku primerjaj pričakovani in dejanski multiset z `EXCEPT ALL`, da zaznaš manjkajoče, dodatne, podvojene in vrednostno različne gibe. Isti test uporabi v migracijskem preflightu.

`cancelled` prenos ne sme imeti nobenega dogodkovnega zalogovnega giba.

**Why:** Preklican dokument z že izvedenim količinskim ali vrednostnim učinkom bi bil terminalen, učinka pa ne bi bilo mogoče več popraviti.

**How to apply:** Preflight naj take zgodovinske zapise samo zazna; prehod v `cancelled` naj preveri `NOT EXISTS` prek namenskega `event_transfer_id`. Ne briši ali popravljaj gibov samodejno.

Migracijski testi, ki simulirajo stare neveljavne prenose, ne smejo globalno odstraniti triggerjev ali FK-jev.

**Why:** Vitest datoteke lahko isto testno bazo uporabljajo vzporedno; drug worker lahko opazi vmesno nezaščiteno stanje in pusti verižne fixture napake.

**How to apply:** Uporabi namensko povezavo, `ACCESS EXCLUSIVE` zaklep, `DISABLE TRIGGER`, savepoint okoli pričakovano neuspešne migracije in končni `ROLLBACK`, ki atomsko obnovi shemo ter fixture.

Dogodkovni gib ne sme biti committan, dokler je njegov prenos še `draft`; začasni gibi znotraj atomske transakcije so dovoljeni.

**Why:** Sicer nedokončan dokument že spremeni zalogo. Takojšnji trigger pa bi onemogočil pravilen API vrstni red, ki gibe ustvari pred statusom `completed`.

**How to apply:** Uporabi constraint trigger `DEFERRABLE INITIALLY DEFERRED`; ob proženju preveri, da ista končna različica giba še obstaja in njen prenos ni `draft`.

Migracija, ki najprej preflighta žive podatke in nato namesti trigger, mora oba koraka opraviti pod istim tabelnim zaklepom.

**Why:** Brez tega lahko sočasni writer committa kršitev po preflightu in pred `CREATE TRIGGER`; obstoječa vrstica novega triggerja ne sproži.

**How to apply:** Združi `ACCESS EXCLUSIVE` zaklep, preflight in DDL v en atomski `DO` stavek, če zunanji migracijski runner ne zagotavlja eksplicitne transakcije.

Diagnostika pokvarjenih dogodkovnih prenosov mora biti read-only in obvezno omejena na podjetje, opcijsko še na enoto.

**Why:** Skrbnik potrebuje konkretne ID-je in pričakovane/dejanske razlike za ročno uskladitev, vendar pregled ne sme sam zaključevati, brisati ali popravljati zaloge.

**How to apply:** Ločeno poročaj missing/extra/mismatch, nepričakovane gibe po statusu ter legacy link/orphan/ambiguity kršitve; popravljalni postopek naj ostane ločena, izrecna operacija.

Revizija zalogovnega giba mora razlikovati neposrednega akterja konkretne vrstice od izvora ali avtorja povezanega dokumenta; izvora dokumenta ne predstavljaj kot avtorja vrstice.

**Why:** Avtor povezanega prenosa ali dokumenta ni nujno oseba, ki je ustvarila konkreten zalogovni učinek. Legacy vrstic brez snapshotov ni dovoljeno prikazati kot dokazljivo podpisane.

**How to apply:** V revizijskem pogledu te tri podatke prikaži ločeno; pri legacy vrstici brez neposrednega podatka izrecno povej, da avtor ni dokazljivo zabeležen.

Celotna vrstica zalogovnega premika je append-only. Popravek dokumenta mora dodati novo izravnalno vrstico, ki enolično kaže na stornirani original; prvotnih količin, cen, časov, referenc ali podpisov ni dovoljeno spreminjati ali brisati.

**Why:** Zaščita samo snapshot polj ni revizijska sled, če je mogoče original izbrisati, zamenjati ali za nazaj prepisati njegov poslovni učinek.

**How to apply:** Edit, delete in ponovni uvoz naj najprej izravnajo samo še neizravnane originale, nato po potrebi dodajo novo verzijo. Fizični DELETE je dovoljen le z izrecno transakcijsko lokalno izjemo za simulacijski reset ali testni cleanup.

Ponovna uskladitev gibov istega dokumenta mora pred izbiro neizravnanih originalov zakleniti glavo dokumenta in v isti transakciji zapisati reversale, replacement gibe ter WAC povzetek.

**Why:** Sočasna uvoza ali rematcha lahko sicer izbereta iste originale; enolični reversal indeks prepreči korupcijo, vendar eden od zahtevkov odpove ali ostane delno izveden.

**How to apply:** Zaklep naj bo v skupnem reconciliation helperju, ne le v posameznih route klicih. Replacement mora ohraniti izvor dokumenta, da ga naslednja uskladitev prepozna.