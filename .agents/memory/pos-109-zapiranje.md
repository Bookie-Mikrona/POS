---
name: Zapiranje POS 109
description: Računovodsko pravilo za povezavo POS prejemnic s prejetim računom in zapiranje konta 109.
---

POS dnevna temeljnica mora ob nastanku shraniti nespremenljiv posnetek vsake vključene prejemnice. Prejeti račun sme debetirati konto 109 samo iz izključno pripadajoče potrjene POS temeljnice. Zapre dejanski bruto kredit 109; zalogo/strošek in vhodni DDV knjiži samo za del računa, ki še ni bil priznan s POS prejemnico. Ujemanje in DDV ostanki se preverjajo po stopnjah v centih, tudi kadar je preostanek samo 0,01 DDV brez neto osnove.

**Why:** POS prejemnica že debetira neto zalogo/strošek in vhodni DDV ter kreditira 109 bruto. Neto zaprtje ali ponovni celotni DDV bi pustila odprt 109 in podvojila davčno evidenco.

**How to apply:** Pri spremembah POS sinhronizacije ali zapiranja 109 ohrani sled po prejemnici in avtoritativne podatke iz posted temeljnice. Zaklepi povezane prejemnice v stabilnem vrstnem redu in nato račun; znotraj iste transakcije ponovno preveri povezave, zneske in DDV stopnje. Zastarel ali dvoumen vir se zavrne. VAT ledger računa vsebuje samo neujemajoči ostanek; polno ujemanje ne ustvari novega DDV vpisa.

**Preverjanje:** E2E računovodske listine ustvarjaj prek produkcijskega toka. Če je neposreden DB fixture nujen, mora ohraniti isto identiteto vira ter ločitev neto, DDV in bruto; sicer test meri nemogoče stanje in daje lažen negativni rezultat.