---
name: Podjetniške in FURS DDV kode
description: Pravilo za ločevanje podjetniškega DDV šifranta od verzioniranega globalnega FURS šifranta.
---

Podjetniška DDV koda se mora vezati na točno verzijo globalne FURS kode prek njenega UUID-ja, ne samo prek besedilne kode. Vrstica temeljnice hrani izvorno podjetniško kodo in ločen globalni FURS ID; obstoječega globalnega pomena ni dovoljeno preusmeriti na podjetniško tabelo.

**Why:** Globalni FURS šifrant je verzioniran po kodi in začetku veljavnosti, zato besedilna koda sama ni trajno unikaten ključ. KIR/KPR uporablja globalno klasifikacijo, podjetniški šifrant pa je uporabniška nastavitev in revizijski izvor.

**How to apply:** Ko odjemalec pošlje podjetniško kodo, naj strežnik preveri lastništvo, zahteva njeno FURS povezavo in sam razreši oziroma preveri globalni ID. Storno in drugi kopirni tokovi morajo ohraniti oba ID-ja.

Enako poimenovano polje DDV nima v vseh dokumentih istega prostora identifikatorjev. OCR predlog uporablja globalno FURS kodo; račun uporablja podjetniško kodo; davčna sled in globalno polje temeljnice uporabljata globalno kodo. Med temi koraki je potrebna izrecna, tenantno preverjena povezava, ne kopiranje ID-ja ali ujemanje samo po stopnji.

**Why:** Kopiranje OCR identifikatorja je povzročilo napako tujega ključa pri ustvarjanju osnutka. Popravek samo tega koraka ni zadoščal: isto zamenjavo je treba preprečiti tudi pri nadaljnjem knjiženju in davčni evidenci.

**How to apply:** Integracijski primeri naj uporabljajo različna ID-ja podjetniške in globalne kode. Manjkajoča ali dvoumna povezava zahteva pregled, ne samodejne izbire druge davčne obravnave. Pri samoobdavčitvi je lahko dobaviteljeva stopnja 0 %, čeprav ima povezana FURS koda stopnjo 22 %; teh dveh pomenov stopnje ne enači.