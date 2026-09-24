---
name: Testna podjetja in davčna sled
description: Previdnost pri čiščenju testnih najemnikov iz razvojne in objavljene baze.
---

Podjetja, ki jih ustvarijo integracijski testi, ostanejo v razvojni bazi in del teh zapisov se pojavlja tudi v objavljeni bazi. Poimenovanje podjetja kot testnega ni zadosten pogoj za varno brisanje: del teh najemnikov ima tudi POS račune in druge povezane zapise.

**Why:** Pregled baze je pokazal, da je veliko navideznih podjetij dejansko testnih, toda nekatera imajo fiskalne sledi. Množično brisanje po predponi imena bi lahko odstranilo poslovno/revizijsko pomembne podatke.

**How to apply:** Pred vsakim čiščenjem ločeno inventariziraj razvojno in produkcijsko bazo, zaščiti dejanske najemnike, preveri povezane račune in uporabniške vloge ter pridobi izrecno soglasje za destruktiven poseg. Prepreči nadaljnje onesnaževanje testov z izolacijo ali varnim čiščenjem testnih podatkov.

Izjemno selektivno čiščenje razvojne baze lahko naleti na krožne FK, `NOT VALID` povezave in neizbrisljive fiskalne revizijske zapise; običajen `DELETE` ni dovolj. Če je odstranitev teh zapisov izrecno potrjena, je sprejemljiva samo izolirana razvojna transakcija s svežo celotno kopijo, izračunano zaprtostjo ciljnih vrstic po FK in preverjanjem, da vsi ohranjeni/skupni zapisi ostanejo bajtno enaki ter da po posegu ni nepovezanih FK vrstic. Začasna izključitev sprožilcev pri brisanju je izjemen razvojni postopek, ne vzorec za produkcijo.

**Why:** Med potrjenim čiščenjem razvojnih testnih najemnikov sta strogi FK vrstni red in zgodovinska zaščita preprečevala običajno brisanje, čeprav je bilo treba odstraniti tudi testne fiskalne sledi.

**How to apply:** Brez izrecne potrditve fiskalnega obsega in uspešnega poskusa z razveljavitvijo ne potrjuj transakcije. Nikoli ne prenašaj te izjeme na produkcijsko bazo.

Offline-fiskalni integracijski testi uporabljajo globalnega delavca in ustvarjajo
navidezno potrjene fiskalne zapise. V skupni razvojni bazi jih ni dovoljeno
zaganjati; zahtevajo dejansko ločeno testno bazo, ne zgolj unikatna testna imena
ali naknadno brisanje.

**Why:** Testni fiskalni računi in njihove zaščitene sledi po koncu testa ostanejo;
ponovitve lahko v kratkem času ponovno napolnijo razvojni seznam podjetij.
Poskus »čiščenja« v testih je nevaren zaradi krožnih povezav, revizijskih
omejitev in globalnega delavca, ki lahko vidi tudi tuje zapise.

**How to apply:** Pred testnimi vpisi preveri identiteto namenske baze in ob
neujemajočem cilju glasno odpovej. Šele v namenski testni bazi lahko globalni
delavec in zaključevanje testnih računov tečeta brez vpliva na dejanske
razvojne najemnike. Pri izjemnem čiščenju skupne baze najprej naredi polno
kopijo, preveri popolno zaprtost vrstic po FK, ponovi poseg z ROLLBACK ter
potrdi, da so vsi ohranjeni zapisi nespremenjeni.