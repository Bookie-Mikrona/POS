# 2. Osnutek implementacije: eDavki

Datum: 2. 10. 2026  
Produkt: Bookie ERP  
Status: načrt prihodnje implementacije, brez oddaje obrazcev ali sprememb davčnih podatkov.

## 1. Cilj in obseg

Vzpostaviti pripravo, kontrolo, izvoz, popravke in sled oddaje davčnih obrazcev.

Prvi osnovni obseg:

1. DDV-O.
2. Evidenci obračunanega DDV in odbitka DDV, KIR/KPR.
3. RP-O — rekapitulacijsko poročilo.
4. PD-O — poročilo o dobavah po 76.a členu ZDDV-1.
5. DDPO — obračun davka od dohodkov pravnih oseb.

RP-O in PD-O sta samostojna obvezna razvojna sklopa tega osnutka, čeprav je obveznost njune oddaje za posamezno podjetje pogojna.

REK-O, obračun plač, DDD-DDD, ustrezni OPSV in posebni režimi imajo ločene razvojne sklope. Evidence ur ali davčna amortizacija jih ne nadomestijo.

## 2. Izhodišče

- Obstaja izračun DDV-O, njegov uporabniški XML izvoz pa ni zaključen.
- Obstajajo generator in kontrole KIR/KPR ter lokalna evidenca izvozov.
- Celovit DDPO, RP-O in PD-O v predhodnem pregledu niso bili najdeni.
- Neposredna avtenticirana oddaja in potrditve sprejema eDavkov niso bile potrjene kot implementirane.

Prva faza podpira uradno ustrezen izvoz in ročni uvoz v eDavke. Neposredna oddaja je ločena poznejša možnost s pooblastili in potrditvami.

## 3. Skupni davčni podatki in profil

Za podjetje se po obdobjih veljavnosti vodijo davčni status, pravna oblika, identifikacija za DDV, način poročanja in mesečna/trimesečna obdobja.

Vsaka vključena transakcija ima:

- izvorni dokument in knjižbo;
- smer nabava/prodaja, partnerja in relevantno DDV identifikacijo;
- vrsto posla, državo in davčno obravnavo;
- datum za davčno obdobje, davčno osnovo, DDV, valuto ter uporabljeni tečaj;
- podjetniško DDV kodo in točno verzijo povezane FURS klasifikacije;
- pri popravku povezavo na originalno transakcijo in poročano obdobje.

Stopnja DDV ali država partnerja sama ne zadostuje za klasifikacijo. EU nabava ni avtomatično RP-O; vsaka obrnjena davčna obveznost ni PD-O.

Manjkajoča ali dvoumna klasifikacija zahteva pregled in lahko blokira izvoz. Program ne izpušča nepopolnih vrstic potiho.

## 4. DDV-O

- Izbor točnega davčnega obdobja.
- Izračun polj po veljavnih pravilih in verziji obrazca.
- Povezava vsakega agregata do dokumentov in davčnih evidenc.
- Pregled obračunanega DDV, odbitka, samoobdavčitev, oprostitev in drugih podprtih vrst poslov.
- Uskladitev z evidencama KIR/KPR ob upoštevanju predpisanih razlik v poročanju in zaokroževanju.
- Delujoč uradni XML izvoz, ki prestane shematsko in vsebinsko kontrolo.
- Običajni obračun in ustrezne vrste popravkov po pravilih eDavkov.

Ko obstaja obveznost RP-O, program upošteva njen vpliv na obdobje in rok DDV-O. Ne ohrani avtomatično trimesečnega režima zgolj zaradi stare nastavitve.

## 5. KIR/KPR

- Predogled, kontrole in izvoz uporabljajo isti izbrani datumski obseg.
- Obvezni podatki in smerne preslikave se preverijo pred izvozom.
- Za ročni uvoz se pripravi ZIP z evidencama v uradno sprejetem formatu ter veljavni strukturi.
- Hranijo se potrjeni posnetek, kontrolne vsote, datoteke, verzija pravil in povezave do izvorov.
- Program omogoči evidentiranje oddaje, opozoril, zavrnitev in popravkov.

Rok je usklajen z DDV-O. Če obstaja RP-O, se upošteva skrajšani rok. Predizpolnjen obračun FURS se obravnava kot zunanji dokument za primerjavo, ne kot avtomatična potrditev pravilnosti programa.

## 6. RP-O — rekapitulacijsko poročilo

### Zavezanost in izbor transakcij

Poročilo zajema relevantne dobave znotraj EU in določene storitve, pri katerih je plačnik DDV prejemnik v drugi članici. Aktualni obrazec lahko zahteva tudi podatke o skladiščenju na odpoklic in posebnih postopkih.

Uvoz, EU nabave in domače dobave se ne vključijo samo zaradi tuje države ali ničelne davčne stopnje.

### Podatki in prikaz

- Koledarski mesec poročanja.
- Država in DDV identifikacija prejemnika.
- Ločene vrste transakcij po aktualnem obrazcu, vključno z blagom, tristranskimi posli in storitvami.
- Davčne osnove v EUR.
- Dokumenti, iz katerih so sestavljeni zneski posameznega prejemnika.
- Ločen prikaz popravkov preteklih obdobij.

Identifikacija se preveri oblikovno in glede na vrsto posla. Morebitno zunanje preverjanje veljavnosti se hrani z datumom in odzivom; nedosegljivost zunanjega vira ni dokaz neveljavnosti.

### Kontrole

- Pravilna smer in klasifikacija posla.
- Obvezna identifikacija prejemnika, pravilne oznake države in ustrezno obdobje.
- Brez podvajanja iste transakcije.
- Uskladitev z relevantnimi polji DDV-O in prodajno davčno evidenco, ne slepo z vsemi EU računi.
- Dobropisi in popravki se obravnavajo po uradnih navodilih; ne spreminjajo potiho že oddanega posnetka.

### Izvoz, popravki in rok

Samostojen predogled, uradni XML po veljavni shemi, potrjen posnetek, zgodovina izvozov, dokazilo oddaje in rezultat.

Poroča se za koledarski mesec relevantnih dobav ali popravkov. Osnovni rok je 20. dan naslednjega meseca; v istem roku se predloži tudi DDV-O, kadar je RP-O obvezen. Posebni premiki rokov se upoštevajo po uradnem koledarju.

Scenariji sprejema: EU blago, relevantna EU storitev, tristranski posel, dobropis/popravek prejšnjega meseca, napačna identifikacija, EU nabava izključena in poseben podprt režim.

## 7. PD-O — poročilo o dobavah po 76.a členu

### Zavezanost in izbor transakcij

Poročilo pripravi dobavitelj, ki opravlja dobave, za katere je prejemnik plačnik DDV po 76.a členu ZDDV-1.

Prejete samoobdavčene nabave, EU posli in običajne domače dobave niso PD-O zgolj zato, ker vsebujejo obrnjeno davčno obveznost ali ničelni obračun davka.

### Podatki in prikaz

- Koledarski mesec poročanja.
- Identifikacija domačega prejemnika in zahtevani podatki aktualnega obrazca.
- Davčna osnova relevantnih dobav.
- Izvorni dokumenti in uporabljena klasifikacija 76.a.
- Ločeni popravki predhodnih obdobij.

### Kontrole

- Posel je dejansko dobava po 76.a, ne samo podobno označen račun.
- Prejemnik in DDV identifikacija izpolnjujeta zahteve relevantnega posla.
- Ni podvajanja transakcij ali zamenjave nabavne/prodajne evidence.
- Zneski so usklajeni z relevantnimi polji DDV-O in evidenco obračunanega DDV.
- Popravki imajo izvorno obdobje ter sled do prvotne oddaje.

### Izvoz, popravki in rok

Samostojen predogled, uradni XML po veljavni shemi, potrjen posnetek, zgodovina in dokazilo oddaje.

Osnovni rok je zadnji delovni dan naslednjega meseca po koledarskem mesecu relevantnih dobav ali popravkov.

Scenariji sprejema: pravilna domača dobava 76.a, delni dobropis, popravek prejšnjega meseca, nepopolna identifikacija in izključitev prejete samoobdavčene nabave.

## 8. DDPO

Samostojen letni davčni obračun mora vključiti:

- izhodišče iz potrjenega računovodskega rezultata;
- povečanja/zmanjšanja davčne osnove po vrstah prilagoditev;
- ločeno obravnavo računovodske in davčne amortizacije;
- davčno nepriznane oziroma delno priznane odhodke in druge relevantne prilagoditve;
- olajšave z dokazili, omejitvami in neporabljenimi prenosi, kjer jih pravila dovoljujejo;
- izgube po letih nastanka, njihovo uporabo in veljavne omejitve;
- pravilno stopnjo za davčno leto, akontacije ter poračun;
- zahtevane priloge in izjavo o izkazih, predloženih AJPES, kadar je uporabljiva;
- XML in sled oddaje ter popravkov.

Davčnih zneskov se ne izpelje samo iz konta brez ustrezne poslovne podlage. Ročni vnosi imajo dokazilo, razlog in potrditev.

Za običajno koledarsko leto se uporabi trimesečni rok po koncu leta; drugačna davčna leta in posebni dogodki imajo svoje roke.

## 9. Drugi ločeni sklopi

- REK-O: vrste dohodkov, individualni podatki, prispevki, dohodnina in dejanski datum izplačila; povezan z dejanskim obračunom dohodka oziroma plač.
- DDD-DDD: ustrezen profil s.p. in način ugotavljanja davčne osnove.
- Ustrezni OPSV: zavarovalni status, osnove, obdobja in predpisani obračuni.
- OSS/IOSS in drugi posebni obrazci: samo ob relevantnem režimu.

Pogojev za ta poročila se ne pripiše vsem podjetjem. REK-O zahteva dodatna varovala za osebne podatke in ločena pooblastila.

## 10. Enoten potek in stanja

Podjetje → obrazec → obdobje → izračun → kontrola → računovodska potrditev → izvoz → oddaja → rezultat.

Ločena stanja:

- osnutek;
- pregledan/potrjen;
- izvožen;
- oddan z dokazilom;
- sprejet, zavrnjen ali potreben pregled odziva.

Potrditev velja za konkreten posnetek podatkov in verzijo pravil. Oddano vsebino se ohrani nespremenljivo; popravek je nova povezana oddaja.

Prenos datoteke ne pomeni oddaje. Ob ročnem uvozu uporabnik priloži potrdilo in identifikator; ob poznejši neposredni povezavi se rezultat pridobi iz uradnega odziva.

## 11. Tehnična zasnova in zaščita

- Skupni verzionirani davčni izračun za DDV-O, KIR/KPR, RP-O in PD-O.
- Ločene preslikave posameznega obrazca in jasne kontrole dovoljenih razlik.
- Verzionirane uradne XML sheme, šifranti, roki in vrste oddaje.
- Decimalni izračuni in pravila zaokroževanja po obrazcu.
- Dosledno omejevanje na izbrano podjetje, vključno z izvozi in večpodjetniškimi uporabniki.
- Revizijska sled izračuna, ročnih sprememb, potrditve in oddaje.
- Varno shranjevanje dokazil; poverilnice in podpisovanje samo v ustreznem varovanem postopku.
- Ob nejasnem rezultatu neposredne oddaje ni slepe ponovitve, ki bi lahko podvojila oddajo.
- Osnutki in nepopolne davčne sledi se ne vključujejo oziroma izpuščajo potiho.

## 12. Faze in merila sprejema

Faza A: skupna davčna sled, DDV-O XML, uvozna embalaža KIR/KPR, potrjeni posnetki in dokazila.

Faza B: RP-O in PD-O, vsak s svojim predogledom, kontrolami, XML, popravki in uskladitvijo.

Faza C: celovit DDPO.

Faza D: pogojni obračuni in po potrebi neposredna oddaja.

Sprejem zahteva preizkušen uvoz v eDavke za vsako podprto shemo; pravilna obdobja in roke; pravilno ločevanje RP-O/PD-O/nabav; sled popravkov in uskladitev z DDV-O; blokado nepopolnih obveznih podatkov; potrditev, vezano na posnetek; odsotnost mešanja podjetij.

## 13. Uradni viri

Preverjeno 2. 10. 2026; pred izvedbo se pridobijo aktualne tehnične sheme in navodila.

- RP-O: https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=rekapitulacijsko_porocilo_podjetja
- PD-O: https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=porocilo_o_dobavah_podjetja
- KIR/KPR: https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=kirkpr
- DDPO: https://www.fu.gov.si/poslovni_dogodki_podjetja/obracun_davka_od_dohodkov_pravnih_oseb
- REK: https://www.fu.gov.si/davki_in_druge_dajatve/podrocja/dohodnina/rek_obrazci
- DDD-DDD: https://www.fu.gov.si/poslovni_dogodki_podjetja/obracun_akontacije_dohodnine_in_dohodnine_od_dohodka_iz_dejavnosti