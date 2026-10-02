---
name: SuperAdmin in operativna POS enota
description: Ločitev platformnega upravljanja od enotnih POS sej brez popuščanja strežniških varoval.
---

SuperAdmin je platformni kontekst, ne operativna POS seja. Manjkajoče enote ne nadomeščaj s privzeto enoto ali izmišljenim podjetjem, da bi odpravil napake njegovih klicev v ozadju. Tudi ostanek stare izbire enote ne spremeni platformne vloge v operativno.

**Why:** Enotni strežnik zahteve brez veljavnega obsega pravilno zavrne. Reševanje platformnih napak z umetno izbiro obsega bi prikrilo napačno odjemalsko življenjsko dobo in lahko povezalo platformno stran s podatki napačnega gostinca.

**How to apply:** Ohraniti je treba dostop do platformnih API-jev, izključiti pa operativne providerje, polling, naprave in POS povezave. Star operativni URL platformnega uporabnika preusmeri znotraj POS predpone na platformni vstop. Običajne POS seje z veljavno enoto ohranijo svoje osvežitve; strežniških meja pravic ne mehčaj.