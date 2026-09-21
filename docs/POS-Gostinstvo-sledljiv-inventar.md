# POS Gostinstvo — sledljiv inventar priročnika

**Datum pregleda:** 21.09.2026  
**Število preverjenih uporabniških postopkov:** 67

Inventar povezuje uporabniško funkcijo z dokazom v uporabniškem vmesniku, strežniški izvedbi in priročniku. Status ne ocenjuje kakovosti kode, ampak pokritost uporabniškega postopka v priročniku.

## Povzetek pokritosti

| Status | Število |
|---|---:|
| PRAVILNO | 67 |
| DELNO | 0 |
| MANJKA | 0 |
| NAPAČNO | 0 |

## Stanje izvedbe

| Stanje | Število |
|---|---:|
| IMPLEMENTIRANO | 60 |
| NI IMPLEMENTIRANO | 4 |
| NEPOTRJENO | 3 |

## Pomembnost

| Pomembnost | Število |
|---|---:|
| KRITIČNO | 22 |
| VISOKO | 35 |
| SREDNJE | 9 |
| NIZKO | 1 |

## Kritične in visoke dokumentacijske vrzeli

| ID | Področje | Funkcija | Pokritost | Vrzel oziroma popravek |
|---|---|---|---|---|

## Celoten inventar

Celotna dokazila, predpogoji, postopki in reference so v preglednici `POS-Gostinstvo-sledljiv-inventar.xlsx` ter v strojno berljivih datotekah JSON in CSV.

| ID | Področje | Funkcija | Pokritost | Pomembnost |
|---|---|---|---|---|
| AI-001 | AI | AI svetovalec za POS kontekst | PRAVILNO | SREDNJE |
| QR-001 | Brskanje | Brskanje po javnem meniju, kategorijah, razpoložljivosti, alergenih in podrobnostih o izdelkih | PRAVILNO | SREDNJE |
| POS-001 | Darilni boni | Stranka kupi darilni bon na spletu | PRAVILNO | VISOKO |
| POS-002 | Dnevni iztržek | Izvedba X/Z dnevnega zaključka in uskladitev gotovine | PRAVILNO | KRITIČNO |
| ERP-001 | Dnevniki | Pregled in knjiženje vnosov v dnevnik | PRAVILNO | KRITIČNO |
| ERP-002 | Dnevniki | Ustvarjanje dnevnega POS dnevnika | PRAVILNO | VISOKO |
| ERP-003 | Dnevniki | Ustvarjanje mesečnega POS dnevnika | PRAVILNO | VISOKO |
| QR-002 | Gostujoči AI | Gost vpraša AI pomočnika o meniju | PRAVILNO | NIZKO |
| TEL-001 | Identiteta telefona/stranke | Operater ustvari telefonsko naročilo in identificira stranko po telefonski identiteti | PRAVILNO | VISOKO |
| POS-003 | KDS/bar/pica/dispatch | Oddaja naročila, HOLD/FIRE, usmerjanje na kuhinjo/bar/pico in BUMP | PRAVILNO | KRITIČNO |
| QR-003 | Klic natakarja | Gost pokliče natakarja in vidi stanje zahteve | PRAVILNO | VISOKO |
| NAPT-001 | Napitnine | Napitnina pri gotovini, kartici in mešanem plačilu | PRAVILNO | VISOKO |
| NAP-001 | Naprave/tiskalniki/integracije | Konfiguracija terminalov, tiskalnikov, lokalnega prehoda in integracij | PRAVILNO | VISOKO |
| QR-004 | Naročanje | Oddaja naročila iz javnega menija in spremljanje rezultata | PRAVILNO | KRITIČNO |
| ERP-004 | Nastavitve POS knjiženja | Konfiguracija pravil in urnika knjiženja iz POS v ERP | PRAVILNO | VISOKO |
| PLA-001 | Plačila | Knjiženje, stornacija in revizija sprememb plačil | PRAVILNO | KRITIČNO |
| PLA-002 | Plačila | Stranka plača na spletu preko Stripe | PRAVILNO | KRITIČNO |
| POR-001 | Poročanje | Izvajanje dnevnih, časovnih in mesečnih operativnih poročil | PRAVILNO | VISOKO |
| POR-002 | Poročanje | Pregled realizacije in razčlenitev plačil | PRAVILNO | SREDNJE |
| QR-005 | Povratne informacije | Gost pošlje povratne informacije po naročilu | PRAVILNO | SREDNJE |
| POS-004 | Preslikave kontov/DDV | Preslikava plačilnih kanalov in stopenj DDV na konte ERP | PRAVILNO | KRITIČNO |
| QR-006 | QR meni | Aktivacija javnega QR menija in preverjanje lokacije/prizorišča | PRAVILNO | VISOKO |
| RAC-001 | Računi | Pregled seznama računov ter vidnost računov/plačil | PRAVILNO | VISOKO |
| REV-001 | Revizija/varnost | Avtentikacija sej in hramba dokazov o akterjih/reviziji | PRAVILNO | KRITIČNO |
| REZ-001 | Rezervacije | Stranka naredi spletno rezervacijo | PRAVILNO | VISOKO |
| UPR-001 | Uporabniki/vloge | Upravljanje POS uporabnikov, natakarskih profilov, enot in dovoljenj | PRAVILNO | VISOKO |
| QR-007 | Za s seboj | Gost odda naročilo za s seboj (prevzem) | PRAVILNO | VISOKO |
| QR-008 | Zgodovina naročil | Gost si ogleda prejšnja javna naročila | PRAVILNO | SREDNJE |
| PLA-003 | blagajna | Bon za pico in subvencionirana prehrana | PRAVILNO | VISOKO |
| PLA-004 | blagajna | Gotovina, kartica, bon, negotovinsko in posebni načini plačila | PRAVILNO | KRITIČNO |
| PLA-005 | blagajna | Idempotentni kartični poskus in neznan rezultat | PRAVILNO | KRITIČNO |
| PLA-006 | blagajna | Kartični ponudniki Payten, SumUp in Viva | PRAVILNO | VISOKO |
| PLA-007 | blagajna | Mešano plačilo in delitev postavk | PRAVILNO | KRITIČNO |
| PLA-008 | blagajna | Unovčitev darilnega bona | PRAVILNO | VISOKO |
| DOG-001 | dogodki in prenosi | Dogodki in prenosi zaloge med enotami | PRAVILNO | VISOKO |
| DOST-001 | dostop | Avtentikacija in življenjski cikel seje | PRAVILNO | KRITIČNO |
| DOST-002 | dostop | Izbira podjetja, enote, blagajne in delovnega dne | PRAVILNO | KRITIČNO |
| DOST-003 | dostop | Registracija naprave in obseg naprave/mize | PRAVILNO | VISOKO |
| POS-005 | fiskalno | Omejeni/offline fiskalni tok in kasnejša sinhronizacija | PRAVILNO | KRITIČNO |
| HOD-001 | hodi | Dodeljevanje, zaporedje in proženje hodov naročila | PRAVILNO | VISOKO |
| ID-001 | identiteta | PIN in hitra menjava identitete | PRAVILNO | VISOKO |
| IZM-001 | izmene | Osebno odpiranje/zapiranje izmene in predaja blagajne | PRAVILNO | VISOKO |
| MEN-001 | meni | Alergeni: ročni vnos, dedovanje, potrditev in revizija | PRAVILNO | KRITIČNO |
| MEN-002 | meni | Happy Hour urnik, cena in ročni vklop | PRAVILNO | VISOKO |
| MEN-003 | meni | Slike artiklov, različice in AI pomoč | PRAVILNO | SREDNJE |
| MEN-004 | meni | Upravljanje kategorij in vidnosti artiklov | PRAVILNO | VISOKO |
| MEN-005 | meni | Ustvarjanje prodajnega/nabavnega artikla, cene in DDV | PRAVILNO | KRITIČNO |
| MIZ-001 | mize | Mize in naročanje po tlorisu | PRAVILNO | VISOKO |
| NAB-001 | nabava | OCR uvoz prejemnice in ročni pregled pred potrditvijo | PRAVILNO | KRITIČNO |
| NAB-002 | nabava | Prejemnica: ročni vnos, dokument, dobavitelj in zalogovni učinek | PRAVILNO | KRITIČNO |
| GOT-001 | nadzor gotovine | X poročilo in sprotna uskladitev gotovine | PRAVILNO | SREDNJE |
| GOT-002 | nadzor gotovine | Z poročilo, polog/dvig in storno premika | PRAVILNO | VISOKO |
| NAR-001 | naročila | Ustvarjanje, urejanje in pošiljanje naročila za postrežbo | PRAVILNO | KRITIČNO |
| NAS-001 | nastavitve | POS in gostinske nastavitve, omejene z vlogami | PRAVILNO | VISOKO |
| OSE-001 | osebje | Odmori osebja in računovodstvo delovnega časa | PRAVILNO | VISOKO |
| EMB-001 | povratna embalaža | Povratna embalaža, bilanca in odpis | PRAVILNO | VISOKO |
| RAC-002 | računi | Izdaja računa in FURS fiskalizacija | PRAVILNO | KRITIČNO |
| RAC-003 | računi | Prvi tisk, ponatis in tiskalni mostovi | PRAVILNO | VISOKO |
| RAC-004 | računi | Storno, vračilo postavke in kartično povračilo | PRAVILNO | VISOKO |
| POS-006 | recepture | Normativ/receptura: vnos, sprememba, validacija in revizija | PRAVILNO | KRITIČNO |
| REZ-002 | rezervacije | Ustvarjanje/posodobitev rezervacije mize in sprostitev potekle rezervacije | PRAVILNO | SREDNJE |
| POS-007 | telefonska_dostava | Sprejem telefonskih naročil in obravnava dostave/odnosa | PRAVILNO | VISOKO |
| VHM-001 | večhodni meni | Konfiguracija večhodnega menija in izbira jedi/vina | PRAVILNO | VISOKO |
| ZAL-001 | zaloga | Odpad s krožnikov | PRAVILNO | SREDNJE |
| ZAL-002 | zaloga | Pripravljena/sestavljena hrana in razpoložljivost | PRAVILNO | VISOKO |
| ZAL-003 | zaloga | WAC izračun po prejemu in kontrola nabavne cene | PRAVILNO | KRITIČNO |
| ZAL-004 | zaloga | Začetna zaloga, inventura in kartica zaloge | PRAVILNO | VISOKO |
