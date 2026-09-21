# POS Gostinstvo — sledljiv inventar priročnika

**Datum pregleda:** 21.09.2026  
**Število preverjenih uporabniških postopkov:** 67

Inventar povezuje uporabniško funkcijo z dokazom v uporabniškem vmesniku, strežniški izvedbi in priročniku. Status ne ocenjuje kakovosti kode, ampak pokritost uporabniškega postopka v priročniku.

## Povzetek pokritosti

| Status | Število |
|---|---:|
| PRAVILNO | 28 |
| DELNO | 33 |
| MANJKA | 3 |
| NAPAČNO | 0 |
| NI IMPLEMENTIRANO | 3 |

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
| POS-001 | Darilni boni | Stranka kupi darilni bon na spletu | NI IMPLEMENTIRANO | Polja/konfiguracija bonov ne dokazujejo spletnega nakupa ali izdaje. |
| POS-002 | Dnevni iztržek | Izvedba X/Z dnevnega zaključka in uskladitev gotovine | MANJKA | Priročnik zahteva ekspliciten postopek X/Z, uskladitev in odklepanje; z iskanimi datotekami ni dokazan noben ustrezen namenski delovni proces v UI. |
| ERP-001 | Dnevniki | Pregled in knjiženje vnosov v dnevnik | DELNO | Končne točke za pregled/knjiženje v zalednem sistemu so evidentirane, vendar ni dokazov o namenski strani za pregled POS dnevnikov ali celovitem postopku popravkov. |
| ERP-002 | Dnevniki | Ustvarjanje dnevnega POS dnevnika | DELNO | Dnevni dnevnik je podprt v zalednem sistemu, vendar v POS UI ni dokazov o jasno prepoznavnem procesu dnevne generacije/ponovnega poskusa za uporabnika. |
| ERP-003 | Dnevniki | Ustvarjanje mesečnega POS dnevnika | DELNO | Načrtovalnik obstaja, vendar zagon/status/nadzor ponovnega poskusa iz priročnika nista v celoti evidentirana kot administratorski delovni proces. |
| TEL-001 | Identiteta telefona/stranke | Operater ustvari telefonsko naročilo in identificira stranko po telefonski identiteti | DELNO | API/testna pokritost je močna, vendar ni bil najden noben dokaz o UI za telefonskega operaterja. |
| NAPT-001 | Napitnine | Napitnina pri gotovini, kartici in mešanem plačilu | DELNO | Osnovni zajem napitnine je opisan, manjkajo pa celotna politika, razdelitev, računovodsko zapiranje in javni QR vidik. |
| NAP-001 | Naprave/tiskalniki/integracije | Konfiguracija terminalov, tiskalnikov, lokalnega prehoda in integracij | DELNO | Obstajajo artefakti nastavitev in integracij, vendar zahtevano preverjanje dodelitve iz priročnika ter končna obnovitev tiskalnika/terminala nista v celoti evidentirana. |
| ERP-004 | Nastavitve POS knjiženja | Konfiguracija pravil in urnika knjiženja iz POS v ERP | DELNO | Priročnik zahteva definirane tipe prenosa/obravnavo statusov in postopek ponovnega poskusa; dokazi v UI/API potrjujejo nastavitve, ne pa tudi celovitega delovnega procesa, vidnega operaterju. |
| PLA-001 | Plačila | Knjiženje, stornacija in revizija sprememb plačil | DELNO | Vedenje zalednega sistema je močno, vendar iskani dokazi v UI ne potrjujejo, da so status/čas stornacije in vse posledice večkratnih plačil vidne računovodskim uporabnikom. |
| PLA-002 | Plačila | Stranka plača na spletu preko Stripe | NI IMPLEMENTIRANO | Ni bil najden noben Stripe SDK, pot, webhook, blagajna ali dokumentiran Stripe postopek. |
| POR-001 | Poročanje | Izvajanje dnevnih, časovnih in mesečnih operativnih poročil | DELNO | Priročnik navaja številne dimenzije operativnih poročil in izvozov; razpoložljivi dokazi UI/API ne potrjujejo vseh variant dnevnih/časovnih/mesečnih poročil. |
| POS-004 | Preslikave kontov/DDV | Preslikava plačilnih kanalov in stopenj DDV na konte ERP | DELNO | Priročnik zahteva eksplicitne preslikave plačilnih kanalov in DDV; vidni POS dokazi ne potrjujejo celovitih urejevalnikov preslikav ali trajne obravnave nerešenih opozoril. |
| REV-001 | Revizija/varnost | Avtentikacija sej in hramba dokazov o akterjih/reviziji | DELNO | Evidentirani so revizijski primitivi in kontekst avtentikacije, vendar ni evidentiran celovit delovni proces pregleda/izvoza revizijske sledi in varnostne administracije, viden uporabniku. |
| REZ-001 | Rezervacije | Stranka naredi spletno rezervacijo | NI IMPLEMENTIRANO | Obstajajo le notranji/testni dokazi za rezervacijo mize; noben javni spletni UI/API tok za rezervacijo ni bil najden. |
| UPR-001 | Uporabniki/vloge | Upravljanje POS uporabnikov, natakarskih profilov, enot in dovoljenj | DELNO | Obstajajo nastavitve, vezane na vloge, in dokazi o uvozu, vendar niso bile najdene vse UI/API komponente za CRUD operacije uporabnikov/vlog in dodeljevanje. |
| QR-007 | Za s seboj | Gost odda naročilo za s seboj (prevzem) | DELNO | UI dokaz prikazuje možnost 'za s seboj', vendar celoten postopek potrditve prevzema/identitete gosta v pregledanem UI ni vzpostavljen. |
| DOG-001 | dogodki in prenosi | Dogodki in prenosi zaloge med enotami | DELNO | Poti dogodkov/prenosov in diagnostika obstajajo, vendar dobavljeni priročnik ponuja usmerjanje glede incidentov in ne celotnega postopka za normalne prenose. |
| DOST-003 | dostop | Registracija naprave in obseg naprave/mize | DELNO | Priročnik zahteva eksplicitne kontrole za prvi zagon/napravo in obseg miz; dokazi uporabniškega vmesnika kažejo registracijo/nastavitve, vendar ne dokazujejo celotnega dokumentiranega poteka potrditve. |
| HOD-001 | hodi | Dodeljevanje, zaporedje in proženje hodov naročila | DELNO | Dokazi kode/testov so močni, vendar navedeni priročnik ne dokumentira celotnega poteka sproščanja hodov za natakarja/KDS. |
| ID-001 | identiteta | PIN in hitra menjava identitete | DELNO | Dokazi dokazujejo konfiguracijo in UI/teste za hitro menjavo, ne pa tudi celotnega dokumentiranega poteka prijave/zaklepanja/revizije s PIN-om. |
| IZM-001 | izmene | Osebno odpiranje/zapiranje izmene in predaja blagajne | DELNO | QuickSwitch prikazuje aktivne izmene, vendar razpoložljivi dokazi ne vzpostavljajo celotnega poteka API-ja za odpiranje/zapiranje/predajo in usklajevanje. |
| NAB-002 | nabava | Prejemnica: ročni vnos, dokument, dobavitelj in zalogovni učinek | DELNO | Implementacija prejemnice je obsežna, vendar je navedeni ročni vir priročnik za incidente/odpravljanje težav in ne celoten postopek za normalen vnos; sledljivost za normalen potek je zato nepopolna. |
| GOT-002 | nadzor gotovine | Z poročilo, polog/dvig in storno premika | DELNO | API in ločen modul pokrivata premike/Z, vendar Checkout sam ni dokaz glavnega uporabniškega zaključka; primerjava kaže razpršen, ne enoten workflow. |
| NAS-001 | nastavitve | POS in gostinske nastavitve, omejene z vlogami | DELNO | Nastavitve so široke in filtrirane po vlogah, vendar priročnik pokriva več kontrol kot neposredno navedeni izseki UI/API; opravite revizijo avtorizacije za vsako nastavitev. |
| OSE-001 | osebje | Odmori osebja in računovodstvo delovnega časa | MANJKA | Ni bilo najdenih nobenih dokazov o namenskem UI ali API-ju za začetek/konec odmora; ne obravnavajte dokazov o predaji blagajne/izmeni kot sledenja odmora. |
| RAC-004 | računi | Storno, vračilo postavke in kartično povračilo | DELNO | Pri pregledu Checkout.tsx ni najden ločen uporabniški storno/vračilo tok; funkcionalnost je vidna predvsem v računskem API/arhivu, zato preveriti, ali vodja lahko izvede celoten postopek iz UI. |
| ZAL-002 | zaloga | Pripravljena/sestavljena hrana in razpoložljivost | DELNO | Testi razpoložljivosti in zalog obstajajo, vendar v dobavljenih referencah UI ni mogoče identificirati celotnega delovnega toka pripravljene hrane za operaterja. |
| ZAL-003 | zaloga | WAC izračun po prejemu in kontrola nabavne cene | DELNO | Izračun/ponovni izračun WAC je dokazan v kodi in vajah priročnika, vendar v UI dokazih POS nismo našli jasnega prikaza/nadzora WAC za uporabnika. |
| ZAL-004 | zaloga | Začetna zaloga, inventura in kartica zaloge | DELNO | UI/API dokazi so prisotni, vendar dobavljeni razdelek priročnika primarno dokumentira ravnanje z incidenti in ne celotnega normalnega poteka inventure. |

## Celoten inventar

Celotna dokazila, predpogoji, postopki in reference so v preglednici `POS-Gostinstvo-sledljiv-inventar.xlsx` ter v strojno berljivih datotekah JSON in CSV.

| ID | Področje | Funkcija | Pokritost | Pomembnost |
|---|---|---|---|---|
| AI-001 | AI | AI svetovalec za POS kontekst | DELNO | SREDNJE |
| QR-001 | Brskanje | Brskanje po javnem meniju, kategorijah, razpoložljivosti, alergenih in podrobnostih o izdelkih | PRAVILNO | SREDNJE |
| POS-001 | Darilni boni | Stranka kupi darilni bon na spletu | NI IMPLEMENTIRANO | VISOKO |
| POS-002 | Dnevni iztržek | Izvedba X/Z dnevnega zaključka in uskladitev gotovine | MANJKA | KRITIČNO |
| ERP-001 | Dnevniki | Pregled in knjiženje vnosov v dnevnik | DELNO | KRITIČNO |
| ERP-002 | Dnevniki | Ustvarjanje dnevnega POS dnevnika | DELNO | VISOKO |
| ERP-003 | Dnevniki | Ustvarjanje mesečnega POS dnevnika | DELNO | VISOKO |
| QR-002 | Gostujoči AI | Gost vpraša AI pomočnika o meniju | DELNO | NIZKO |
| TEL-001 | Identiteta telefona/stranke | Operater ustvari telefonsko naročilo in identificira stranko po telefonski identiteti | DELNO | VISOKO |
| POS-003 | KDS/bar/pica/dispatch | Oddaja naročila, HOLD/FIRE, usmerjanje na kuhinjo/bar/pico in BUMP | PRAVILNO | KRITIČNO |
| QR-003 | Klic natakarja | Gost pokliče natakarja in vidi stanje zahteve | PRAVILNO | VISOKO |
| NAPT-001 | Napitnine | Napitnina pri gotovini, kartici in mešanem plačilu | DELNO | VISOKO |
| NAP-001 | Naprave/tiskalniki/integracije | Konfiguracija terminalov, tiskalnikov, lokalnega prehoda in integracij | DELNO | VISOKO |
| QR-004 | Naročanje | Oddaja naročila iz javnega menija in spremljanje rezultata | PRAVILNO | KRITIČNO |
| ERP-004 | Nastavitve POS knjiženja | Konfiguracija pravil in urnika knjiženja iz POS v ERP | DELNO | VISOKO |
| PLA-001 | Plačila | Knjiženje, stornacija in revizija sprememb plačil | DELNO | KRITIČNO |
| PLA-002 | Plačila | Stranka plača na spletu preko Stripe | NI IMPLEMENTIRANO | KRITIČNO |
| POR-001 | Poročanje | Izvajanje dnevnih, časovnih in mesečnih operativnih poročil | DELNO | VISOKO |
| POR-002 | Poročanje | Pregled realizacije in razčlenitev plačil | DELNO | SREDNJE |
| QR-005 | Povratne informacije | Gost pošlje povratne informacije po naročilu | DELNO | SREDNJE |
| POS-004 | Preslikave kontov/DDV | Preslikava plačilnih kanalov in stopenj DDV na konte ERP | DELNO | KRITIČNO |
| QR-006 | QR meni | Aktivacija javnega QR menija in preverjanje lokacije/prizorišča | PRAVILNO | VISOKO |
| RAC-001 | Računi | Pregled seznama računov ter vidnost računov/plačil | PRAVILNO | VISOKO |
| REV-001 | Revizija/varnost | Avtentikacija sej in hramba dokazov o akterjih/reviziji | DELNO | KRITIČNO |
| REZ-001 | Rezervacije | Stranka naredi spletno rezervacijo | NI IMPLEMENTIRANO | VISOKO |
| UPR-001 | Uporabniki/vloge | Upravljanje POS uporabnikov, natakarskih profilov, enot in dovoljenj | DELNO | VISOKO |
| QR-007 | Za s seboj | Gost odda naročilo za s seboj (prevzem) | DELNO | VISOKO |
| QR-008 | Zgodovina naročil | Gost si ogleda prejšnja javna naročila | MANJKA | SREDNJE |
| PLA-003 | blagajna | Bon za pico in subvencionirana prehrana | PRAVILNO | VISOKO |
| PLA-004 | blagajna | Gotovina, kartica, bon, negotovinsko in posebni načini plačila | PRAVILNO | KRITIČNO |
| PLA-005 | blagajna | Idempotentni kartični poskus in neznan rezultat | PRAVILNO | KRITIČNO |
| PLA-006 | blagajna | Kartični ponudniki Payten, SumUp in Viva | PRAVILNO | VISOKO |
| PLA-007 | blagajna | Mešano plačilo in delitev postavk | PRAVILNO | KRITIČNO |
| PLA-008 | blagajna | Unovčitev darilnega bona | PRAVILNO | VISOKO |
| DOG-001 | dogodki in prenosi | Dogodki in prenosi zaloge med enotami | DELNO | VISOKO |
| DOST-001 | dostop | Avtentikacija in življenjski cikel seje | PRAVILNO | KRITIČNO |
| DOST-002 | dostop | Izbira podjetja, enote, blagajne in delovnega dne | PRAVILNO | KRITIČNO |
| DOST-003 | dostop | Registracija naprave in obseg naprave/mize | DELNO | VISOKO |
| POS-005 | fiskalno | Omejeni/offline fiskalni tok in kasnejša sinhronizacija | PRAVILNO | KRITIČNO |
| HOD-001 | hodi | Dodeljevanje, zaporedje in proženje hodov naročila | DELNO | VISOKO |
| ID-001 | identiteta | PIN in hitra menjava identitete | DELNO | VISOKO |
| IZM-001 | izmene | Osebno odpiranje/zapiranje izmene in predaja blagajne | DELNO | VISOKO |
| MEN-001 | meni | Alergeni: ročni vnos, dedovanje, potrditev in revizija | PRAVILNO | KRITIČNO |
| MEN-002 | meni | Happy Hour urnik, cena in ročni vklop | PRAVILNO | VISOKO |
| MEN-003 | meni | Slike artiklov, različice in AI pomoč | DELNO | SREDNJE |
| MEN-004 | meni | Upravljanje kategorij in vidnosti artiklov | PRAVILNO | VISOKO |
| MEN-005 | meni | Ustvarjanje prodajnega/nabavnega artikla, cene in DDV | PRAVILNO | KRITIČNO |
| MIZ-001 | mize | Mize in naročanje po tlorisu | PRAVILNO | VISOKO |
| NAB-001 | nabava | OCR uvoz prejemnice in ročni pregled pred potrditvijo | PRAVILNO | KRITIČNO |
| NAB-002 | nabava | Prejemnica: ročni vnos, dokument, dobavitelj in zalogovni učinek | DELNO | KRITIČNO |
| GOT-001 | nadzor gotovine | X poročilo in sprotna uskladitev gotovine | DELNO | SREDNJE |
| GOT-002 | nadzor gotovine | Z poročilo, polog/dvig in storno premika | DELNO | VISOKO |
| NAR-001 | naročila | Ustvarjanje, urejanje in pošiljanje naročila za postrežbo | PRAVILNO | KRITIČNO |
| NAS-001 | nastavitve | POS in gostinske nastavitve, omejene z vlogami | DELNO | VISOKO |
| OSE-001 | osebje | Odmori osebja in računovodstvo delovnega časa | MANJKA | VISOKO |
| EMB-001 | povratna embalaža | Povratna embalaža, bilanca in odpis | PRAVILNO | VISOKO |
| RAC-002 | računi | Izdaja računa in FURS fiskalizacija | PRAVILNO | KRITIČNO |
| RAC-003 | računi | Prvi tisk, ponatis in tiskalni mostovi | PRAVILNO | VISOKO |
| RAC-004 | računi | Storno, vračilo postavke in kartično povračilo | DELNO | VISOKO |
| POS-006 | recepture | Normativ/receptura: vnos, sprememba, validacija in revizija | PRAVILNO | KRITIČNO |
| REZ-002 | rezervacije | Ustvarjanje/posodobitev rezervacije mize in sprostitev potekle rezervacije | DELNO | SREDNJE |
| POS-007 | telefonska_dostava | Sprejem telefonskih naročil in obravnava dostave/odnosa | PRAVILNO | VISOKO |
| VHM-001 | večhodni meni | Konfiguracija večhodnega menija in izbira jedi/vina | PRAVILNO | VISOKO |
| ZAL-001 | zaloga | Odpad s krožnikov | DELNO | SREDNJE |
| ZAL-002 | zaloga | Pripravljena/sestavljena hrana in razpoložljivost | DELNO | VISOKO |
| ZAL-003 | zaloga | WAC izračun po prejemu in kontrola nabavne cene | DELNO | KRITIČNO |
| ZAL-004 | zaloga | Začetna zaloga, inventura in kartica zaloge | DELNO | VISOKO |
