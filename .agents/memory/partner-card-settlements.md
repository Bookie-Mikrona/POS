---
name: Kartica poslovnega partnerja in zapiranje postavk
description: Uporabnikove zahteve za kartico knjižb, delna zapiranja in zbirni promet po partnerjih po vzoru starega programa.
---

Kartica partnerja mora prikazovati kronološke knjižene postavke z izbiro partnerja, konta in obdobja ter filtrom samo odprte/vse. Za vsako postavko mora biti viden dokument oziroma več dokumentov, ki jo delno ali popolnoma zapirajo, z zneski posameznih povezav in ostankom.

**Why:** Uporabnik je 2026-10-02 opisal stari program kot funkcionalno referenco: en račun se lahko poravna z več delnimi plačili, eno plačilo pa zapira več računov. Zahteva velja za vse konte, tako kupce kot dobavitelje, in vključuje ročno zapiranje poljubnih postavk ter ponovno odpiranje.

**How to apply:** Kartice ne omeji na seznam računov ali na status »plačan«. Loči knjižbeno postavko od njenih več povezav zapiranja; vključuj tudi ustrezne postavke glavne knjige in ohrani izvorno sled zgodovinskih zapiranj.

Ponovno odpiranje postavke obravnavaj ločeno od razveljavitve plačila oziroma storna knjižbe.

**Why:** Popravek povezave med obstoječimi knjižbami ne pomeni, da denarna transakcija ni nastala. Storno celotnega plačila bi spreminjal glavno knjigo namesto zgolj napačnega zapiranja.

**How to apply:** Spremembe zapiranj naj ohranijo revizijsko in časovno sled, da je mogoče pravilno rekonstruirati stanje na pretekli datum.

Zbirni »Izpis skupnega prometa po partnerjih« je ločeno poročilo od podrobne kartice. Za izbrano obdobje prikazuje skupine po kontih in vrstice partnerjev s šifro, nazivom, krajem, debetom, kreditom, saldom obdobja in ostankom odprtih postavk; vključuje seštevke po kontu in celotnem izpisu.

**Why:** Uporabnik je 2026-10-02 priložil referenčni izpis iz starega programa in izrecno ločil saldo v obdobju od odprtih postavk. Referenca kaže tudi ničelni saldo ob nenulskem ostanku in pozitivni ostanek ob negativnem saldu.

**How to apply:** Saldo obdobja računaj kot debet minus kredit, ostanek pa iz dejanske sledi odprtih/zaprtih postavk. Ostanka ne nadomesti s saldom ali njegovo absolutno vrednostjo; časovni obseg in predznakovno pravilo ostanka pred implementacijo posebej razjasni, saj ju sam izpis ne dokazuje v celoti.

Izvoz oziroma tisk podrobne kartice partnerja s tekočim saldom, referencami dokumentov zapiranja, posameznimi zneski zapiranja in ostanki je obvezna funkcionalnost, ne zgolj izbirni zaslonski pregled.

**Why:** Uporabnik je 2026-10-02 priložil dva celovita stara izpisa in izrecno povedal: »Takšen izpis bi bil nujen.«

**How to apply:** Predloge izpisov obravnavaj kot zahteve za dokumentacijsko sled. Primerjava s starim izpisom mora ločiti celotno zgodovino od potrjenega obsega uvoza ter knjižene temeljnice od osnutkov; razlike ne odpravljaj s samodejnim knjiženjem ali izmišljenimi izravnavami.

Pri preverjanju stare kartice preveri vsoto dejansko izvlečenih postavk proti natisnjenim seštevkom, preden presojaš uspešnost prenosa.

**Why:** Stari PDF-ji imajo rotirane besedilne koordinate, nadaljevalne strani drugačno višino glave in večvrstična zapiranja. Zgolj navidezno uspešno branje besedila lahko izpusti prvo postavko strani ali pripiše končni seštevek zadnji postavki; zgodovinski izpisi lahko vsebujejo tudi centno razliko med saldom in odprtimi ostanki.

**How to apply:** Vizualno preveri stolpce, strani in končne vsote. Centne razlike najprej razišči v izvorni zgodovini; ne spreminjaj odprtih zneskov zato, da bi se prisilno ujemali s tekočim saldom.