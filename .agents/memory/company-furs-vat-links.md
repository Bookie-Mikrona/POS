---
name: Podjetniške in FURS DDV kode
description: Pravilo za ločevanje podjetniškega DDV šifranta od verzioniranega globalnega FURS šifranta.
---

Podjetniška DDV koda se mora vezati na točno verzijo globalne FURS kode prek njenega UUID-ja, ne samo prek besedilne kode. Vrstica temeljnice hrani izvorno podjetniško kodo in ločen globalni FURS ID; obstoječega globalnega pomena ni dovoljeno preusmeriti na podjetniško tabelo.

**Why:** Globalni FURS šifrant je verzioniran po kodi in začetku veljavnosti, zato besedilna koda sama ni trajno unikaten ključ. KIR/KPR uporablja globalno klasifikacijo, podjetniški šifrant pa je uporabniška nastavitev in revizijski izvor.

**How to apply:** Ko odjemalec pošlje podjetniško kodo, naj strežnik preveri lastništvo, zahteva njeno FURS povezavo in sam razreši oziroma preveri globalni ID. Storno in drugi kopirni tokovi morajo ohraniti oba ID-ja.