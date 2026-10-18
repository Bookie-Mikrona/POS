---
name: SuperAdmin in operativna POS enota
description: Ločitev platformnega upravljanja od enotnih POS sej brez popuščanja strežniških varoval.
---

SuperAdmin je platformni kontekst, ne operativna POS seja. Manjkajoče enote ne nadomeščaj s privzeto enoto ali izmišljenim podjetjem, da bi odpravil napake njegovih klicev v ozadju. Tudi ostanek stare izbire enote ne spremeni platformne vloge v operativno.

**Why:** Enotni strežnik zahteve brez veljavnega obsega pravilno zavrne. Reševanje platformnih napak z umetno izbiro obsega bi prikrilo napačno odjemalsko življenjsko dobo in lahko povezalo platformno stran s podatki napačnega gostinca.

**How to apply:** Ohraniti je treba dostop do platformnih API-jev, izključiti pa operativne providerje, polling, naprave in POS povezave. Star operativni URL platformnega uporabnika preusmeri znotraj POS predpone na platformni vstop. Običajne POS seje z veljavno enoto ohranijo svoje osvežitve; strežniških meja pravic ne mehčaj.

Pri preverjanju menjave prijav ohrani nematerializiran osnutek outboxa med vsemi fazami istega brskalnika. Izolacije ne dokazuj z brisanjem lokalne shrambe ali z ločenimi profili.

**Why:** Platformna faza mora biti neoperativna tudi ob ostankih običajne POS seje; brisanje osnutkov bi prikrilo uhajanje stanja in lahko izgubilo še neposlane uporabnikove spremembe.

**How to apply:** Uporabi samo razvojne najemnike in browser-only osnutek brez poslovne izvedbe. Preveri, da v platformi ni prikaza ali ponavljanja ukaza, po povratni prijavi iste identitete pa ostane osnutek nespremenjen. Izolacija dveh različnih običajnih POS identitet je ločeno varnostno vprašanje.