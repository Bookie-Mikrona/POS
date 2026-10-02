# 3. Osnutek implementacije: poslovne banke

Datum: 2. 10. 2026  
Produkt: Bookie ERP  
Status: načrt prihodnje implementacije, brez oddaje banki ali sprememb pogodb.

## 1. Cilj in ločitev postopkov

Omogočiti pripravo preverljive dokumentacije za kreditno presojo in pogodbeno spremljanje podjetja.

Ločimo:

1. Finančna poročila za kredit, limit, lizing ali spremljanje pogodbenih zavez.
2. Plačilni promet — paketni bančni XML.
3. Evidenco dejanskega stanja TRR in bančnih izpiskov.

Paketni XML je podrobno opredeljen v predhodnem osnutku kartic in plačil. Ta dokument ga povezuje s pregledom bančnih potreb, ne uvaja drugega vzporednega izvoznika.

Banke in kreditne pogodbe imajo različne zahteve. Program ne predpostavlja univerzalnega bančnega obrazca, enakih kazalnikov ali enotnega XML za dokumentacijo o kreditni presoji.

## 2. Izhodišče v programu

Obstajajo letni in medletni BS/IPI, bruto bilanca, PDF/XLSX izvozi, saldakonti s starostnimi razredi, bančni izpiski in priprava plačil.

Pred uporabo za banko je treba:

- dokončati zanesljiv izračun terjatev in obveznosti na pretekli datum;
- ločiti knjiženo stanje od osnutkov;
- pravilno upoštevati otvoritve in prenesena zapiranja;
- dodati enoten paket, pregled financiranja in pogodbeno prilagodljive analize.

Obstoječih osnovnih poročil ne predstavljamo kot manjkajočih in jih ne izdelujemo znova brez potrebe.

## 3. Profil banke in pogodbe

Za banko oziroma konkretno vlogo/pogodbo se določijo:

- namen paketa in naslovnik;
- referenčni datum ter zahtevana obdobja;
- zahtevane vrste dokumentov in formati;
- pogostost predložitve, roki in odgovorna oseba;
- dogovorjene definicije kazalnikov in pragovi;
- zahtevane izjave, razkritja in priloge.

Profil je verzioniran. Zahteve ene banke niso avtomatično zahteve vseh drugih.

Vprašalniki in izjave se izpolnijo iz dejanskih podatkov ter uporabnikovih potrjenih vnosov. Izjave o premoženju poroka se ne generira z izmišljenimi podatki.

## 4. Osnovni paket finančnih izkazov

- Letna bilanca stanja in izkaz poslovnega izida.
- Medletna BS/IPI za tekoče obdobje.
- Primerjalni podatki predhodnega leta oziroma primerljivega obdobja.
- Bruto bilanca z začetnim stanjem, prometom in končnim stanjem.
- Potrebna pojasnila pomembnih odstopanj in uporabljene računovodske podlage.

Vsa poročila navajajo podjetje, datum, obdobje, valuto, obseg knjiženih podatkov in čas izdelave. Osnutki so samo ločena jasno označena priloga, če jo uporabnik izrecno potrebuje.

## 5. Terjatve in obveznosti

- Odprte postavke na točen referenčni datum.
- Starostna analiza po dogovorjenih razredih in zapadlosti.
- Zbirni promet po partnerjih ter saldo in ločeni odprti ostanki.
- Največji kupci/dobavitelji in koncentracija izpostavljenosti, če jo banka zahteva.
- Ločeno vidni avansi, dobropisi in nepovezana plačila, ne tiho pobotani z računi.
- Povezava vsakega agregata na dokumente, knjižbe in zapiranja.

Račun po referenčnem datumu se ne vključuje. Poznejše plačilo ne zmanjšuje zgodovinskega odprtega zneska. Kasnejše ponovno odpiranje ima svojo časovno sled.

Seštevki se uskladijo z glavno knjigo; razlike zaradi obsega, neporazdeljenih otvoritev, valut ali drugih pravil so pojasnjene, ne odpravljene z umetno knjižbo.

## 6. Pregled kreditov, limitov in lizingov

Za financiranje se po dejanski pogodbi vodijo:

- financer, vrsta financiranja in pogodbeni identifikator;
- valuta, začetni znesek in datum;
- črpanje, odplačila in preostala glavnica na datum;
- obrestni pogoji, relevantni stroški in zapadlosti;
- dogovorjeni odplačilni načrt ter dejanska izvedba;
- zavarovanja in dogovorjene obveznosti;
- kratkoročni/dolgoročni del po zahtevanih pravilih.

Poročilo vsebuje odplačila v izbranem prihodnjem obdobju ter uskladitev s knjiženim dolgom.

Vseh pogodbenih podatkov ni mogoče zanesljivo razbrati samo iz konta. Manjkajoči načrt se dopolni iz pogodbe ali uvoženega potrjenega vira.

## 7. Likvidnost in načrti

Ločena prikaza:

1. Dejanska sredstva po TRR iz bančnih izpiskov in naknadnih evidentiranih transakcij.
2. Napoved prihodnjih prilivov in odlivov.

Napoved lahko vključuje pričakovano izterjavo terjatev, plačila obveznosti, davke, plače, investicije, obroke in druga potrjena pričakovanja.

Predlagana sta kratkoročni tedenski in daljši mesečni pogled; horizont se prilagodi zahtevi banke.

Vsaka predpostavka je vidna in urejiva z razlogom. Scenariji se ne knjižijo v glavno knjigo. Napoved, zgodovinski izkaz denarnih tokov in trenutno bančno stanje niso ista stvar.

Stanje TRR je označeno z datumom zanesljivega vira in morebitno zastarelostjo. Konto 110x ni samodejno živ ali popoln podatek o bančnem kritju.

## 8. Kazalniki in pogodbene zaveze

Primeri pogojnih analiz: likvidnost, kapitaliziranost, zadolženost, EBITDA, razmerje dolga do EBITDA ter sposobnost servisiranja dolga.

Za vsak kazalnik se hranijo:

- dogovorjena formula in verzija;
- izvor števca in imenovalca;
- obdobje, uporabljene prilagoditve in prag;
- dejanski rezultat, status in pojasnilo.

Definicije EBITDA ali DSCR se ne razglasijo za univerzalne. Uporabi se dogovorjena pogodbeno veljavna formula.

Ničelni ali neustrezen imenovalec pomeni neizračunljiv oziroma neprimerljiv rezultat, ne izmišljenega ugodnega kazalnika.

Opozorilo o odstopanju ne pomeni avtomatične pravne ugotovitve kršitve pogodbe; potreben je pregled odgovorne osebe.

## 9. Izdelava bančnega paketa

Postopek:

1. Izbor podjetja, banke/pogodbe, datuma in namena.
2. Nabor potrebnih poročil iz profila.
3. Skupni izračun na usklajen referenčni datum.
4. Pregled kontrol, prilog, razkritij in načrtov.
5. Potrditev odgovorne osebe.
6. Izvoz paketa in evidentiranje predaje.

Predlagani izvozi:

- posamezni PDF/XLSX;
- zbirni PDF z vsebinskim kazalom, če je primeren za banko;
- ZIP z dokumenti in manifestom;
- bančna predloga, kadar konkretna banka zahteva in dopušča njeno izpolnjevanje.

Manifest vsebuje seznam dokumentov, obdobja, verzije in odtise. Paket ostane vezan na podjetje, izbrano ob začetku priprave, tudi če uporabnik med prenosom zamenja aktivno podjetje.

Prenos paketa ne pomeni predaje banki. Hranijo se datum predaje, način, naslovnik in dokazilo oziroma odgovor, kadar je na voljo.

## 10. Povezava s plačilnim prometom

Predhodni osnutek določa:

- vse odprte dobaviteljske obveznosti, tudi iz prejšnjih let;
- polna/delna plačila in izbrani izvorni TRR;
- en XML paket za izbrane naloge;
- preverjen uvozni profil konkretne banke;
- zaščito pred podvojenimi nalogi;
- ločitev priprave/izvoza od dejanske izvedbe;
- povezavo na izpisek in zapiranje samo izvedenega zneska.

Pred prvo uporabo pri banki se preverijo njen sprejeti pain.001 profil, zahtevani sklici, kode in dejanski uvoz. Osnutek ne zahteva neposrednega bančnega API-ja.

## 11. Varnost in kontrole

- Dostop in vsi izvozi so omejeni na aktivno podjetje ter uporabniško vlogo.
- Paket nima nepotrebnih osebnih podatkov zaposlenih ali porokov.
- Priloge imajo nadzorovan dostop.
- Poročila v istem paketu uporabljajo isti potrjeni posnetek in pravilno obdobje.
- Sprememba podatkov ali formul zahteva nov pregled; predanega paketa se ne prepiše.
- Primerjalni podatki se označijo, če niso popolni ali primerljivi.
- Neskladja z glavno knjigo so vidna in preprečijo označitev nepreverjenega paketa kot usklajenega.

## 12. Faze in merila sprejema

Faza A: zanesljivi zgodovinski saldi, starostna analiza in združitev že obstoječih izkazov.

Faza B: profil banke/pogodbe, paket PDF/XLSX/ZIP, razkritja in sled predaje.

Faza C: financiranje, odplačilni načrti in uskladitev dolga.

Faza D: napovedi, scenariji in dogovorjeni pogodbeni kazalniki.

Sprejem zahteva isti referenčni datum v vseh poročilih, pravilno stanje pred poznejšimi plačili, pojasnjena odstopanja, preverjene formule, ločitev napovedi od dejanskih podatkov, nespremenljiv predani paket in preprečeno mešanje podjetij.

Plačilni XML se sprejme po merilih predhodnega osnutka in potrjenem uvozu za konkretno banko.

## 13. Odločitve pred izvedbo

- Prve podprte banke, pogodbe in dejanski obrazci/vprašalniki.
- Potrebna pogostost in roki predložitve.
- Zahtevani starostni razredi in primerjalna obdobja.
- Razpoložljive kreditne/lizinške pogodbe in odplačilni načrti.
- Pogodbene formule, pragovi in horizont načrtovanja.

## 14. Vir in povezava

Uradni primer dokumentacije banke, preverjen 2. 10. 2026: vloga, vprašalnik/razkritja in finančni izkazi preteklega ter tekočega leta; pri osebnem poroštvu tudi ustrezna izjava.

https://www.unicreditbank.si/si/podjetniki-in-mala-podjetja/financiranje/financiranje-nova.html

Predhodni osnutek: `docs/implementation-partner-ledger-and-bank-payments.md`.