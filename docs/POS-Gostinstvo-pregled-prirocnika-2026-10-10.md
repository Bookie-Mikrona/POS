# POS Gostinstvo — pregled uporabniškega priročnika

**Datum:** 10.10.2026  
**Izdaja priročnika:** 8.12  
**Okolje dela:** razvojno; brez sprememb poslovnih podatkov ali produkcije.

## Kaj je bilo pregledano

- Besedilo vseh 12 poglavij, vključno s kratkimi navodili, podrobnimi
  postopki, izjemami in kontrolnimi primeri.
- Dokazne reference vseh 85 predhodnih inventarnih zapisov; preverjen je
  obstoj poti, ne pravilnost vsake navedene stare številke vrstice.
- Spremembe uporabniško pomembnih POS datotek od predhodnega pregleda
  05.10.2026 in ciljna primerjava popravljenih navodil z dejansko kodo.
- Izbrani vmesniki in strežniške politike za odmore, blagajniške premike,
  funkcije enot, uvoz predlog, začetne zaloge, e-pošto in Viva Android.

To ni nov funkcionalni preizkus vseh 85 postopkov. Za pet obstoječih
zapisov in štiri nove je datum ciljnega pregleda 10.10.2026;
ostalih 80 obdrži predhodni datum 05.10.2026. Besedilni pregled celotnega
priročnika in ponovni preizkus vsakega postopka sta različna obsega.

## Pregled vseh poglavij

| Poglavje | Obseg pregleda | Rezultat |
|---|---|---|
| 01 Dostop in priprava | Kontekst podjetja, enote, naprave, prijave; navodila ob napakah | Besedilni pregled; pravila funkcij so dopolnjena v 09. |
| 02 Začetek izmene | Osebna izmena, prevzem blagajne, začetni denar, predaja | Besedilni pregled; odmor in skupna blagajna ločena v 08. |
| 03 Mize in naročila | Rezervacije, odprta naročila, različne naprave, postavke, premiki | Besedilni pregled; različni postopki združitve in premika niso izenačeni. |
| 04 Meni in normativi | Artikel, nabavna/prodajna vloga, normativ, alergeni, uvoz | Popravljen neposredni uvoz celega kataloga v dejanski selektivni postopek. |
| 05 KDS, QR in telefon | Stanja priprave, HOLD/FIRE, razpoložljivost, QR oddaja, telefon | Besedilni pregled; QR-naročanje ni izpeljano iz dostopa do javne strani. |
| 06 Plačila in računi | Nejasno kartično plačilo, FURS, tisk, boni, gotovinski postopki | Dodana omejitev prodaje in unovčenja bonov; ohranjena obnovitev istega poskusa. |
| 07 Zaloge in nabava | Začetne zaloge, prejemnice, OCR, inventura, priprava, odpad, dogodki | Dopolnjena izbira Material/Drobni inventar ter količinska evidenca brez cen. |
| 08 Konec izmene in ERP | Odmori, gotovina, X/Z, predaja, temeljnice | Odstranjeni napačna trditev o odsotnem odmoru in primer prenosa v sef kot ponujenega premika. |
| 09 Nastavitve in varnost | Paketi, funkcije, vloge, enote, naprave, dostava e-pošte | Dodani konkretni postopki odvisnosti, izklopa, začasnosti, SMTP identitete in Android mostu. |
| 10 Hitri postopki | Zaporedja za blagajnika, kuhinjo, vodjo in skrbnika | Besedilni pregled; poklicna odgovornost ni izenačena z API vlogo. |
| 11 Izredni primeri | Nedostava, nejasno plačilo, fiskalizacija, manjkajoč tisk, OCR | Besedilni pregled; ohranjene prepovedi dvojne prodaje ali bremenitve zaradi napake. |
| 12 Slovar in kontrola | Povezave med povzetki in dejanskimi postopki | Popravljen drugi opis starega uvoza; dodan jasen obseg te izdaje. |

## Potrjene vrzeli in popravki

| Najdba | Popravek | Dokaz izvedbe |
|---|---|---|
| Kratek opis pravi, da gumb za odmor ni potrjen; podrobni opis pa ga zahteva. | Plačan/Neplačan odmor, Zaključi odmor, en odprt odmor, blokada zaprtja izmene, sledljiv popravek. | `Izmene.tsx`, `ObracunUr.tsx`, API `izmene.ts` |
| Tipični gotovinski premik navaja odvzem v sef, čeprav ponujene vrste tega ne predstavljajo. | Ločitev bančnega dviga, sefa in vračila računa tudi v kratkem uvodu. | `BlagajniskiPremiki.tsx`, API `blagajniski-premiki.ts` |
| Uvoz drobnega inventarja opisuje stari dialog za celoten katalog. | Nastavitve, prazen začetni izbor, artikli/skupine, Uvozi označene, potrditev enote in rezultat. | `Settings.tsx`, `Menu.tsx`, API `artikli.ts` |
| Splošni vnos začetnih zalog ne pove, da drobni inventar nima cenovnih stolpcev. | Izbira obsega pred artikli; Material s ceno, Drobni inventar samo količinsko. | `Zaloge.tsx`, API `zacetne-zaloge.ts` |
| Navodila ne pojasnijo novih konkretnih odvisnosti in razlogov zavrnitve izklopa. | Dostava→Telefon, Rezervacije→Mize, Večhodni→Kuhinja; pravilen zaključek blokirajočih postopkov. | `unit-capability-policy.ts`, `unitCapabilityBlockers.ts`, API `enote.ts` |
| Profil oziroma naziv premične enote lahko vodi v napačno sklepanje o začasnosti. | Prva enota stalna, food truck privzeto stalen, začasna dodatna enota z obdobjem in matično enoto. | `unitProfiles.ts`, `Settings.tsx`, API `enote.ts` |
| Bralec lahko predpostavi, da so boni in vsi meniji na voljo v vsaki enoti. | Ločene funkcije QR/javne strani/dnevnih menijev ter omejitev prodaje in unovčenja bonov. | `unitProfiles.ts`, `Checkout.tsx`, `Settings.tsx` |
| Preskus SMTP ni isto kot preverjena identiteta poslovnega pošiljatelja. | Preverjanje podjetja, prejemnika, vidnega imena, tehničnega naslova in naslova za odgovor. | `company-email-sender.ts`, `email-sender.ts`, `pos-email.ts` |
| Android plačilni opis ne vključuje dovolj konkretne namestitve mostu. | Prenos iz nastavitev, namestitev na isti napravi, varna obravnava stare namestitve, Demo način in isti plačilni poskus. | `Settings.tsx`, API `terminal.ts` |
| Enoten datum izvoza ustvarja vtis, da je vsak inventarni zapis ponovno preverjen. | Ločena datum izvoza in datum pregleda po vrsticah; evidenca se razširi na 89 zapisov. | Generator sledljivega inventarja |

## Kaj ostaja zunaj tega preverjanja

- Ponovni preskus vseh 89 inventarnih postopkov v prijavljeni seji in po vseh vlogah.
- Fizični terminali, tiskalniki, Android namestitev ter dejanska bančna bremenitev.
- Novi dejanski FURS prenosi, eDavki oddaje, bizBox dostava in zunanja SMTP dostava.
- Pravilnost vsake stare vrstične reference: datoteke obstajajo, vrstice se z
  razvojem premikajo. Prisotnost reference ni dokaz pravilnega postopka.

Za takšne zaključke bi potrebovali ločen funkcionalni prevzem z dejanskimi
rezultati. Ta izdaja zato ne razglaša vseh postopkov za ponovno
funkcionalno certificirane.
