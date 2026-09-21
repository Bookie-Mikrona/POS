---
name: Povratna embalaža
description: Pravila za fizično zalogo, dobaviteljski saldo in zgodovinsko kavcijsko vrednost povratne embalaže.
---

Povratna embalaža je nabavni artikel, katerega fizično količino še naprej določajo običajni zalogovni gibi. Saldo po dobavitelju vodi ločena append-only evidenca; prejemnica ga poveča, vračilo dobavitelju pa ga zmanjša in hkrati ustvari običajen negativen zalogovni gib.

**Why:** Skupna fizična zaloga ne pove, kateremu dobavitelju je embalažo mogoče vrniti. Spreminjanje trenutne kavcijske cene tudi ne sme spreminjati vrednosti zgodovinskih prejemov in vračil.

**How to apply:** Vsak promet shrani dobavitelja in snapshot kavcijske vrednosti. Urejanje ali brisanje izvora se popravi z nasprotnim prometom, ne z brisanjem zgodovine. Vračilo mora biti transakcijsko zaklenjeno in ne sme preseči salda za isti artikel in dobavitelja.

Vrstica povratne embalaže z vrednostjo 0 in neničelno količino je fizični promet: pri uvozu se mora ohraniti, evidentirati v zalogi in v ločenem embalažnem prometu, vendar brez knjiženja na 3107000/220. Znak količine določi smer (plus = prejem, minus = vračilo).

**Why:** Prejem in vračilo embalaže se lahko na dobaviteljevem dokumentu denarno izničita, fizični promet in sledljivost po dobavitelju pa še vedno obstajata.

**How to apply:** Ne odmetavaj embalažne vrstice zaradi cene ali vrednosti 0. Računovodski tok 3107000/220 se uporabi samo ob neničelni denarni vrednosti; ponovna uskladitev zapis popravi z nasprotnim append-only prometom.

Kavcijska postavka prevzemnice se knjiži ločeno: neto vrednost v breme namenske analitike zaloge povratne embalaže 3107000, dejanski vhodni DDV po podatkih konkretne vrstice in bruto obveznost v dobro nastavljive analitike 220. Fizično vračilo dobavitelju ustvari osnutek DR 220 / CR 3107000 brez DDV.

**Why:** Dobavitelji kavcijo na dokumentih obravnavajo različno, zato DDV ne sme biti prisilno nastavljen na nič. Fizično vračilo samo po sebi ni dobropis in ne sme samodejno ustvariti davčnega storna.

**How to apply:** Konto 3107000 »Povratna embalaža« je del privzetega kontnega plana novih podjetij in privzeta POS sistemska nastavitev; uporabiti je dovoljeno konfigurirani aktivni konto 3107000 ter aktivni analitični konto obveznosti razreda 220. Vsako vračilo ima enoličen operacijski ključ in neposredno povezavo na ustvarjeno temeljnico, zato ponovitev iste zahteve ne spremeni zaloge ali glavne knjige še enkrat.

Dobropis dobavitelja za že fizično vrnjeno embalažo je dokaz poravnave obstoječega vračila, ne nov fizični ali računovodski dogodek. Delne povezave so dovoljene, popravki pa ohranijo prejšnjo revizijsko sled.

**Why:** Ponovna sprememba zaloge ali glavne knjige ob prejemu dobropisa bi podvojila učinek istega vračila.

**How to apply:** Povezava mora ohraniti identiteto podjetja, enote, dobavitelja in artikla ter ne sme preseči še neporavnane količine nobene strani. Kandidat je samo dejansko fizično vračilo z lastno temeljnico, ne avtomatski storno urejanja dokumenta. Dobropis, ki je bil kadarkoli povezan, zaradi trajne revizijske sledi ostane nespremenljiv in ga ni dovoljeno izbrisati; razveljavitev popravi samo učinek povezave.

Pri mešanem dobropisu se običajne vrstice lahko knjižijo pred ali po povezovanju embalaže. To je dovoljeno samo, če nespremenljiv vir knjiženja izrecno potrjuje, da je predogled izločil vse embalažne vrstice; zgodovinski viri brez takega dokaza ostanejo blokirani.

Pri ustvarjanju neznane OCR vrstice mora biti povratno embalažo mogoče označiti neposredno v istem obrazcu, brez prekinitve uparjanja. Tak artikel je vedno nabavni material v kosih, brez prodaje in z dovoljeno depozitno vrednostjo 0.

**Why:** Zahteva, da uporabnik zapusti OCR uvoz in posebej obišče šifrant embalaže, prekine prevzem in ga lahko pusti nedokončanega.

**How to apply:** Možnost »Povratna embalaža« mora biti tretja neposredno vidna izbira v istem seznamu tipa artikla, ne ločeno ali skrito stikalo. Po izbiri pokaže vrsto, depozit in zaklenjen DDV 0 % (brez običajnih DDV kategorij) ter ob ustvarjanju takoj vrne oziroma poveže novo oznako z isto OCR vrstico.

OCR obrazec mora za samodejno določeno osnovno enoto uporabiti vrednost, ki obstaja v svojem seznamu enot (`kom`), ne splošnega zapisa `kos`.

**Why:** Izbor z vrednostjo, ki ni med možnostmi istega obrazca, je uporabniku videti kot neizbrana enota in prepreči shranjevanje.

**How to apply:** Kadar obrazec sam nastavi poslovno obvezno vrednost, jo vedno vzemi iz lastnega dovoljenega nabora možnosti.

Pri prikazu prejemnice so vhodni artikli vedno pred povratno embalažo. Znotraj obeh skupin ostane izvorno zaporedje vrstic z dobavnice.

**Why:** Mešanje embalaže med vhodnimi artikli oteži primerjavo prejemnice z dobavnico in odkrije napake šele pozneje.

**How to apply:** Razvrstitev uporabi ob branju oziroma prikazu prejemnice kot stabilno delitev na ne-embalažo in embalažo; ne spreminjaj izvornih vrstic, njihovih količin ali poslovnih učinkov.

Če dobavnica na isti embalažni vrstici ločeno izkazuje prejeto in vrnjeno količino, mora OCR ohraniti oba bruto fizična dogodka: prejem kot pozitivno in vračilo kot negativno vrstico. Ne sme vzeti samo prejema ali shraniti zgolj neto razlike.

**Why:** Enak prejem in vračilo imata neto saldo 0, vendar sta oba dogodka potrebna za pravilno zalogo, saldo po dobavitelju in revizijsko sled.

**How to apply:** Ločena stolpca razširi v dva prometa istega artikla. Denarna vrednost 0 ne sme odstraniti nobenega od njiju; znak količine določi prejem ali vračilo.

OCR-vrstica embalaže ne potrebuje dobaviteljeve šifre, če ima naziv in lasten fizični podatek (prejeto, vrnjeno, GTIN ali ceno). Prazno pomožno vrstico odstrani samo, kadar nima nobenega takega podatka.

**Why:** Nekateri dobavitelji, med njimi Davidov hram, v tabeli dostave in vračila embalaže sploh ne tiskajo šifre. Zahteva po šifri zato po uspešnem OCR-ju tiho izbriše vse embalažne vrstice.

**How to apply:** Filter veljavnosti naj zahteva identiteto (naziv ali šifra) in vsaj en lasten podatek vrstice; dobaviteljeva šifra sama nikoli ni obvezna.

Artikel povratne embalaže, ustvarjen med uparjanjem OCR-dokumenta, mora biti takoj na voljo tudi preostalim vrsticam istega odprtega dokumenta.

**Why:** Za isti artikel sta na dobavnici pogosto zaporedni vrstici prejema in vračila. Seznam artiklov in predhodno izračunani kandidati sicer ostanejo iz časa pred ustvarjanjem, zato vračilo novega artikla ne more najti.

**How to apply:** Po uspešnem ustvarjanju dodaj artikel v lokalni iskalni seznam, osveži skupni seznam artiklov ter ponovno izračunaj in preberi neuparjene vrstice trenutne prejemnice.

Razbita ali uničena povratna embalaža je ločen dogodek, ne vračilo dobavitelju. Zmanjšati mora fizično zalogo in dobaviteljski količinski saldo, knjižiti D strošek odpisa / K zalogo embalaže, ne sme pa zmanjšati obveznosti do dobavitelja.

**Why:** Navidezno vračilo bi napačno ustvarilo D 220, čeprav dobavitelj embalaže ni prejel in depozita ni priznal. Sam inventurni manjko pa pusti dobaviteljski saldo napačno odprt.

**How to apply:** Namenski append-only dogodek uničenja v eni transakciji shrani razlog, dobavitelja, količino in zgodovinsko kavcijsko vrednost ter zmanjša oba salda. Pri pozitivni vrednosti pripravi D strošek / K 3107000 brez DDV in brez 220; pri 0,00 EUR ne ustvari temeljnice. Vračila in odpisi istega artikla uporabljajo isti zaklep, operacijski ključ pa varno podpira ponovitev zahteve.