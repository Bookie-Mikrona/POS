---
name: Bookie Old preslikava glavne knjige
description: Računovodska semantika starega izvoza pri uvozu v novo glavno knjigo.
---

Pri zgodovinskem uvozu Bookie Old je avtoritativen stari kontni plan šifrant vrste **K2**, ne K1 ali K3. Ista številka konta v novem ERP ne zagotavlja istega pomena: stari konto za plačilo z Eurocard ima na primer v novem planu pomen tujega dobavitelja. Prazno polje partnerja zato samo po sebi ni dokaz manjkajočega podatka; preveri pomen starega konta, vrsto temeljnice in naravo otvoritvenih zbirnih vrstic.

**Why:** Uporabnik je potrdil K2 in pojasnil vrste temeljnic: 00 otvoritev, 01 blagajna, 10 bančni izpisek, 30 prejeti računi, 32 obračun DDV, 40 poraba, 60 izdani računi. Sklepanje o manjkajočih partnerjih po pravilih *novih* istošifriranih kontov je dalo napačen alarm.

**How to apply:** Pred uvozom pripravi in potrdi preslikavo po nazivu in poslovnem pomenu K2; šele nato ocenjuj obvezne analitike po ciljnem kontu. Datoteka Zapiranje povezuje števec prve in druge vrstice Glavne knjige ter znesek zapiranja; večina povezav je zapisana v obeh smereh, zato je ne štej kot dve plačili. Ne izgubi izvornih števcev in ne ugibaj manjkajočih vezi.