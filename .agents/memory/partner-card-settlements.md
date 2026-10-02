---
name: Kartica poslovnega partnerja in zapiranje postavk
description: Uporabnikove zahteve za kartico knjižb, delna zapiranja in zbirni promet po partnerjih po vzoru starega programa.
---

Kartica partnerja mora prikazovati kronološke knjižene postavke z obvezno izbiro enega poslovnega partnerja in enega konta pred nalaganjem ter izbiro obdobja in filtrom samo odprte/vse. Za vsako postavko mora biti viden dokument oziroma več dokumentov, ki jo delno ali popolnoma zapirajo, z zneski posameznih povezav in ostankom.

**Why:** Uporabnik je 2026-10-02 opisal stari program kot funkcionalno referenco: en račun se lahko poravna z več delnimi plačili, eno plačilo pa zapira več računov. Zahteva velja za vse konte, tako kupce kot dobavitelje, in vključuje ročno zapiranje poljubnih postavk ter ponovno odpiranje.

**How to apply:** Kartice ne omeji na seznam računov ali na status »plačan«. Loči knjižbeno postavko od njenih več povezav zapiranja; vključuj tudi ustrezne postavke glavne knjige in ohrani izvorno sled zgodovinskih zapiranj.

Otvoritve niso posamezne postavke kartice za izbiro in zapiranje; njihovo začetno stanje mora ostati ločeno od dokumentnega prometa. Ne odpiraj skupnega nefiltriranega seznama vseh partnerjev in kontov.

**Why:** Uporabnik je 2026-10-02 izrecno zahteval: »pred prikazom je obvezno določiti filter poslovni partner in konto« in opozoril: »v seznamu so tudi postavke z otvoritev, kar je napaka.«

**How to apply:** Ob vhodu pokaži filtre in naloži kartico šele po potrditvi konkretnega partnerja in konta. Za zbirni promet uporabljaj ločeno poročilo, ne neomejene podrobne kartice; izvornih otvoritvenih knjižb zaradi spremembe prikaza ne briši.

Na kartici partnerja mora biti partner iskljiv po delnem nazivu, davčni ali matični številki. Izbira konta je omejena na saldakontne konte.

**Why:** Uporabnik je 2026-10-02 izrecno določil ta način iskanja in obseg kontov.

**How to apply:** Upoštevaj oznake saldakontnih kontov v kontnem planu podjetja, ne zgolj številčnih predpon; iskanje je samo izbor obstoječega partnerja in ne spreminja njegove identitete.

Zaslonska kartica mora imeti kompaktne vrstice: izbrani partner in konto sta prikazana enkrat v glavi, datumi in zneski se ne lomijo, celotni tehnični opisi in reference pa ostanejo dostopni v podrobnostih.

**Why:** Uporabnik je ponovljeno opozoril, da so ozka tabela, ponavljajoči podatki in večvrstični izvorni opisi nepregledni.

**How to apply:** Za kartico uporabi razpoložljivo širino in vodoravni pomik na ožjih zaslonih. Ob spremembi postavitve ohrani izbiro postavk, zapiranja, izvorno sled, začetno stanje in seštevke; podatkov ne odstranjuj zgolj zaradi preglednosti.

Zaslonska kartica partnerja naj prikazuje postavke od najnovejših do najstarejših; smer prikaza ne spreminja kronološkega izračuna tekočih saldov.

**Why:** Uporabnik je 2026-10-02 zahteval: »kronološko obrni prikaz« po prikazu starejših postavk na vrhu.

**How to apply:** Obrni le zaslonski vrstni red; ohrani salde, seštevke, filtre in podatke zapiranj. Te zahteve ne razširi samodejno na potrjeni tiskani izpis.

Za tiskano kartico je referenca uporabnikov potrjeni izpis Bookie Old: partner in konto v glavi, kompaktne knjižbe ter veza, znesek zapiranja in ostanek ob pripadajoči knjižbi.

**Why:** Uporabnik je izrecno zavrnil novi PDF s ponavljajočimi se partnerji, konti in tehničnimi opisi ter označil stari izpis kot ustrezen.

**How to apply:** PDF preverjaj ločeno od spletne tabele. Ohraniti mora izvorne številke in povezave, slovenske zneske in datume, jasen obseg knjiženih let ter označene strani; zapiranja niso dodaten debetni promet.

Izvorno potrjeno zapiranje knjižene bančne vrstice lahko velja tudi proti starejšemu računu zunaj prenesenega obdobja; odsoten novi ID računa ni dokaz, da je bančna vrstica odprta.

**Why:** Zgodovinska bančna plačila zapirajo tudi predhodna leta, ki jih nova glavna knjiga pokriva samo z otvoritvijo. Evidenca vezana samo na prenesene račune zato ni popolna.

**How to apply:** Ohrani preverljivo izvorno GL/ZAP dokazilo, njegov časovni presek in razveljavitve. Ne ustvarjaj manjkajočih knjižb ali plačil; dvojno izvorno in sodobno dokazilo iste povezave ne sme dvakrat zmanjšati ostanka.

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

Uporabnik je za poslane zgodovinske podatke izrecno potrdil: »vsi poslani podatki so popolnoma preverjeno pravilni.«

**Why:** Razlike v novem programu je treba najprej obravnavati kot težave obsega prenosa, preslikave ali izračuna, ne kot dovoljenje za popravljanje izvirnikov.

**How to apply:** Ohrani izvorne listine in finančne zapise. Če manjka izvorna knjižba, ohrani dokazilo zapiranja in opozorilo o manjkajoči povezavi; ne izdeluj nadomestne knjižbe.

Potrjen obseg je pet faz kartice/prometa partnerjev, skupnih odprtih postavk, priprave enega plačilnega paketa ter povezave z dejansko bančno izvedbo.

**Why:** Ločeni osnutki za AJPES, eDavke in bančno dokumentacijo niso del uporabnikove odobritve teh petih faz.

**How to apply:** Teh osnutkov ne vključi samodejno v izvedbo kartic in plačil.