# POS Gostinstvo — sledljiv inventar računovodskega priročnika

**Datum pregleda:** 21.09.2026  
**Število preverjenih uporabniških postopkov:** 53

Inventar povezuje uporabniško funkcijo z dokazom v uporabniškem vmesniku, strežniški izvedbi in priročniku. Status ne ocenjuje kakovosti kode, ampak pokritost uporabniškega postopka v priročniku.

## Povzetek pokritosti

| Status | Število |
|---|---:|
| PRAVILNO | 53 |
| DELNO | 0 |
| MANJKA | 0 |
| NAPAČNO | 0 |

## Stanje izvedbe

| Stanje | Število |
|---|---:|
| IMPLEMENTIRANO | 48 |
| NI IMPLEMENTIRANO | 1 |
| NEPOTRJENO | 4 |

## Pomembnost

| Pomembnost | Število |
|---|---:|
| KRITIČNO | 21 |
| VISOKO | 28 |
| SREDNJE | 4 |
| NIZKO | 0 |

## Kritične in visoke dokumentacijske vrzeli

| ID | Področje | Funkcija | Pokritost | Vrzel oziroma popravek |
|---|---|---|---|---|

## Celoten inventar

Celotna dokazila, predpogoji, postopki in reference so v preglednici `POS-Gostinstvo-racunovodski-sledljiv-inventar.xlsx` ter v strojno berljivih datotekah JSON in CSV.

| ID | Področje | Funkcija | Pokritost | Pomembnost |
|---|---|---|---|---|
| ACM001 | nastavitev kontnega načrta | Dodajanje, urejanje, hierarhija, tip in veljavnost konta | PRAVILNO | VISOKO |
| ACM002 | kontiranje | Dovoljenje za knjiženje in skupinski konto | PRAVILNO | KRITIČNO |
| ACM003 | kontiranje DDV | Tip konta in vedenje izhodnega oziroma vhodnega DDV | PRAVILNO | KRITIČNO |
| ACM004 | plačilne preslikave | Konti gotovine, TRR, kartic, denarja na poti in drugih plačil | PRAVILNO | VISOKO |
| ACM005 | prihodkovne in DDV-preslikave | Preslikava prihodkov po kategoriji, vrsti artikla in stopnji DDV | PRAVILNO | KRITIČNO |
| ACM006 | zaloge in stroški | Konti zalog, nabave, vhodnega DDV in COGS | PRAVILNO | VISOKO |
| ACM007 | posebne plačilne preslikave | Boni, subvencionirani študentski boni in pogodbene malice | PRAVILNO | VISOKO |
| ACM008 | preslikave napitnin | Obveznost, prihodek, DDV in kartična provizija napitnin | PRAVILNO | VISOKO |
| ACM009 | obvezne dimenzije | Partner, stroškovno mesto in projekt na knjižbeni vrstici | PRAVILNO | KRITIČNO |
| ACM010 | vrstni red preslikav in frekvence | Fallback precedence, pogostost knjiženja in ponovljivost sinhronizacije | PRAVILNO | KRITIČNO |
| CBR-001 | gotovina | Gotovinski promet, polog, dvig in izplačilo | PRAVILNO | VISOKO |
| CBR-002 | gotovina | X-poročilo in sprotna kontrola preštete gotovine | PRAVILNO | SREDNJE |
| CBR-003 | gotovina | Z-poročilo, zaključek dneva in storniranje premika | PRAVILNO | VISOKO |
| CBR-004 | banka | Uvoz bančnega izpiska, dokazilo ter začetno in končno stanje | PRAVILNO | VISOKO |
| CBR-005 | banka | Konti 110x in bančni saldo | PRAVILNO | KRITIČNO |
| CBR-006 | banka | Ujemanje bančnih transakcij s plačili in obveznostmi | PRAVILNO | VISOKO |
| CBR-007 | dobavitelji | Izplačilo dobavitelju | PRAVILNO | VISOKO |
| CBR-008 | poročila | Operativna poročila, X/Z in primerjava z GL | PRAVILNO | KRITIČNO |
| CBR-009 | mesečni zaključek | Mesečna sinhronizacija, kontrolni seznam, razlike in recovery | PRAVILNO | KRITIČNO |
| JL-001 | življenjski cikel | Dnevna, razponska in mesečna sinhronizacija POS v ERP | PRAVILNO | VISOKO |
| JL-002 | življenjski cikel | Osnutek, pregled in status temeljnice | PRAVILNO | VISOKO |
| JL-003 | življenjski cikel | Knjiženje temeljnice in zaklenjeno obdobje | PRAVILNO | KRITIČNO |
| JL-004 | življenjski cikel | Reverz oziroma storno knjižene temeljnice | PRAVILNO | KRITIČNO |
| JL-005 | življenjski cikel | Brisanje osnutkov temeljnic | PRAVILNO | VISOKO |
| JL-006 | sledljivost | Izvorna referenca in idempotentnost ponovljene sinhronizacije | PRAVILNO | KRITIČNO |
| JL-007 | kontrole | Meja podjetja, poslovna enota in dovoljenja | PRAVILNO | KRITIČNO |
| JL-008 | kontrole | Konti, D/K, partnerji in dimenzije | PRAVILNO | VISOKO |
| JL-009 | davki | DDV povezave in partnerji | PRAVILNO | KRITIČNO |
| JL-010 | izmenjava | Izvoz in omejitve uvoza temeljnic | PRAVILNO | VISOKO |
| JL-011 | revizija | Preskočeni razlogi in revizijska sled | PRAVILNO | VISOKO |
| PUR001 | nabava | Račun dobavitelja | PRAVILNO | SREDNJE |
| PUR002 | nabava | Dobavnica brez računa | PRAVILNO | VISOKO |
| PUR003 | nabava | Kombinirana dobavnica in račun | PRAVILNO | SREDNJE |
| PUR004 | nabava | Dobropis in bremepis dobavitelja | PRAVILNO | KRITIČNO |
| PUR005 | DDV | Odbitni DDV in mešane stopnje | PRAVILNO | VISOKO |
| PUR006 | DDV | Neodbitni DDV | PRAVILNO | KRITIČNO |
| PUR007 | nabava | Odvisni stroški nabave | PRAVILNO | VISOKO |
| PUR008 | embalaža | Povratna embalaža, vračilo in odpis | PRAVILNO | VISOKO |
| PUR009 | zaloga | Začetna zaloga | PRAVILNO | VISOKO |
| PUR010 | zaloga | WAC in inventura | PRAVILNO | KRITIČNO |
| PUR011 | zaloga | Odpis surovin oziroma blaga in kalo | PRAVILNO | VISOKO |
| PUR012 | proizvodnja | Pripravljena in sestavljena hrana | PRAVILNO | VISOKO |
| PUR013 | odpad | Odpad s krožnikov | PRAVILNO | SREDNJE |
| PUR014 | prenosi | Prenosi med enotami, skladišči in dogodki | PRAVILNO | VISOKO |
| PUR015 | poraba/COGS | Poraba surovin in COGS | PRAVILNO | KRITIČNO |
| SAL001 | prodaja in plačila | Gotovinska, kartična, mešana in druga plačila | PRAVILNO | VISOKO |
| SAL002 | prodaja in plačila | Delna plačila in odprti zneski | PRAVILNO | KRITIČNO |
| SAL003 | prodaja in plačila | Darilni boni, subvencije študentskih bonov in pogodbene malice | PRAVILNO | VISOKO |
| SAL004 | prodaja in plačila | Politike napitnin, provizije in poravnave | PRAVILNO | VISOKO |
| SAL005 | prodaja in plačila | DDV-posnetki, meniji in prodaja za s seboj | PRAVILNO | KRITIČNO |
| SAL006 | prodaja in plačila | Storno in vračilo | PRAVILNO | KRITIČNO |
| SAL007 | prodaja in plačila | Neznani, offline in neuspešni FURS-izidi | PRAVILNO | KRITIČNO |
| SAL008 | prodaja in plačila | Dnevne in mesečne prodajne temeljnice | PRAVILNO | VISOKO |
