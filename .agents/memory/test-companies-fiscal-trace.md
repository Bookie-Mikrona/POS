---
name: Testna podjetja in davčna sled
description: Previdnost pri čiščenju testnih najemnikov iz razvojne in objavljene baze.
---

Podjetja, ki jih ustvarijo integracijski testi, ostanejo v razvojni bazi in del teh zapisov se pojavlja tudi v objavljeni bazi. Poimenovanje podjetja kot testnega ni zadosten pogoj za varno brisanje: del teh najemnikov ima tudi POS račune in druge povezane zapise.

**Why:** Pregled baze je pokazal, da je veliko navideznih podjetij dejansko testnih, toda nekatera imajo fiskalne sledi. Množično brisanje po predponi imena bi lahko odstranilo poslovno/revizijsko pomembne podatke.

**How to apply:** Pred vsakim čiščenjem ločeno inventariziraj razvojno in produkcijsko bazo, zaščiti dejanske najemnike, preveri povezane račune in uporabniške vloge ter pridobi izrecno soglasje za destruktiven poseg. Prepreči nadaljnje onesnaževanje testov z izolacijo ali varnim čiščenjem testnih podatkov.