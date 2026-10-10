# Glavna knjiga — sledljiv inventar davčnih evidenc

**Datum izvoza inventarja:** 10.10.2026
**Število evidentiranih uporabniških postopkov:** 5

Inventar povezuje uporabniško funkcijo z dokazom v uporabniškem vmesniku, strežniški izvedbi in priročniku. Status ne ocenjuje kakovosti kode, ampak pokritost uporabniškega postopka v priročniku.

Oznake so dokumentacijska ocena posameznih zapisov, ne potrdilo o ponovnem funkcionalnem preizkusu vseh postopkov. Datum pregleda je zapisan po vrsticah; izvoz starejšemu zapisu ne pripiše novega datuma. Obseg aktualnega pregleda in njegove omejitve so v `02-davcne-evidence.md`.

## Povzetek pokritosti

| Status | Število |
|---|---:|
| PRAVILNO | 5 |
| DELNO | 0 |
| MANJKA | 0 |
| NAPAČNO | 0 |

## Stanje izvedbe

| Stanje | Število |
|---|---:|
| IMPLEMENTIRANO | 3 |
| NI IMPLEMENTIRANO | 1 |
| NEPOTRJENO | 1 |

## Pomembnost

| Pomembnost | Število |
|---|---:|
| KRITIČNO | 3 |
| VISOKO | 2 |
| SREDNJE | 0 |
| NIZKO | 0 |

## Kritične in visoke dokumentacijske vrzeli

| ID | Področje | Funkcija | Pokritost | Vrzel oziroma popravek |
|---|---|---|---|---|

## Celoten inventar

Celotna dokazila, predpogoji, postopki in reference so v preglednici `Davcne-evidence-sledljiv-inventar.xlsx` ter v strojno berljivih datotekah JSON in CSV.

| ID | Področje | Funkcija | Pokritost | Pomembnost |
|---|---|---|---|---|
| TAX-KIR-001 | davčne evidence | KIR – knjiga izdanih računov | PRAVILNO | KRITIČNO |
| TAX-KPR-001 | davčne evidence | KPR – knjiga prejetih računov | PRAVILNO | KRITIČNO |
| TAX-GL-001 | davčne evidence | Uskladitev KIR/KPR z glavno knjigo | PRAVILNO | VISOKO |
| TAX-XML-001 | davčne evidence | KIR/KPR XML izvoz | PRAVILNO | VISOKO |
| TAX-EDAVKI-001 | davčne evidence | Neposredna elektronska oddaja KIR/KPR v eDavke | PRAVILNO | KRITIČNO |
