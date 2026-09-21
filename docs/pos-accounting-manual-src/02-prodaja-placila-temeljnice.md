# 02 · Prodaja, plačila in temeljnice

## Namen in pravilo branja tega poglavja

To je računovodsko poglavje novega priročnika za POS Gostinstvo. Opisuje, kaj
nastane v programu **po vnosu in zaključku računa**, kako se dogodek združi v
temeljnico in kako ga računovodja preveri pred knjiženjem ali prenosom.
Postopek je enoten: uporablja se ista izvorna temeljnica z enakimi konti,
stranmi, zneski, partnerji in davčnimi podatki.

Vsi konti s sedmimi mesti v primerih so **ponazoritveni konti**. POS ne
uporablja teh številk kot skritih konstant: v nastavitvah je shranjen ID
izbranega konta, številka in naziv pa sta odvisna od kontnega načrta podjetja.
Pred knjiženjem vedno primerjajte številko in naziv v svojem kontnem načrtu.
Smer (D/K), znesek, DDV-stopnja, partner in izvorna referenca morajo ostati
enaki kot v predogledu temeljnice.

### Zaslon in sled dogodka

1. Odprite **POS → Računi/Naročila**, izberite enoto in delovno izmeno.
2. Vnesite artikle, količino, popust in način plačila.
3. Pred potrditvijo preverite bruto znesek, razrez DDV po stopnjah, kupca
   (če gre za terjatev) in morebitni bon/subvencijo.
4. Zaključite račun. Fiskalni račun je izvorni dokument; temeljnica se ne
   vnaša ročno po občutku.
5. V **POS → Temeljnice** izberite datum in enoto. Pri dnevnem osnutku
   preverite referenco `POS:PRODAJA:YYYY-MM-DD:E<enota>`.
6. Odprite predogled, primerjajte vse D/K vrstice, nato knjižite ali izvozite.

Temeljnica je praviloma zbirna za dan in enoto, ne ena temeljnica za vsak
račun. Vsaka vrstica pa mora biti sledljiva na datum, enoto, DDV-stopnjo,
izvorni račun oziroma skupino računov in, kjer je relevantno, partnerja.

## Privzeti konti, ki jih poraba v tem poglavju uporablja

| Nastavitev v POS | Namen v knjiženju | Primer konta in naziv* |
|---|---|---|
| Konto blagajne (`cashAccountId`) | D plačila z gotovino | 1000000 – Blagajna |
| Konto kartic/POS terminala (`cardAccountId`) | D kartična plačila; pri proviziji K | 1100100 – Terjatve do izdajateljev kartic |
| Konto banke (`bankAccountId`) | K pri poravnavi napitnin na TRR | 1100000 – Transakcijski račun |
| Konto predplačil (`advancePaymentsAccountId`) | D ob unovčitvi in K ob izdaji darilnega bona | 2300000 – Prejeta predplačila |
| Konto bonov za pico (`voucherAccountId`) | D unovčeni bon za pico | 1650100 – Terjatve za bone |
| Konto terjatev za subvencije (`subsidyReceivableAccountId`) | D študentski boni; povezan partner MDDSZ/ŠOS | 1650000 – Druge terjatve do države |
| Konto drugih negotovinskih plačil (`otherPaymentAccountId`) | D Sodexo, TRR brez kupca in druga takojšnja negotovinska plačila | 1100200 – Druga kratkoročna sredstva |
| Konto prehodnih terjatev pogodbenih malic (`contractReceivableTransitAccountId`) | D ob malici na pogodbeni cenik, do A-računa | 1650200 – Prehodne terjatve |
| Konto obveznosti za napitnine (`tipsLiabilityAccountId`) | K napitnina za tuj račun; D ob izplačilu | 2550000 – Obveznosti do zaposlenih |
| Konto prihodkov kategorije | K neto prodaja; izbere se po kategoriji, vrsti artikla in DDV | 7600000 – Prihodki od gostinskih storitev |
| DDV 5 %, 9,5 %, 22 % (`vat5/95/22AccountId`) | K izhodni DDV po stopnji | 2600500/2600950/2602200 – Obveznost za DDV |
| Splošni prihodek (`revenueAccountId`) | Fallback, ko vrstica nima kategorije oziroma postavk | 7600999 – Drugi prihodki od prodaje |
| Prihodki napitnin (`tipsRevenueAccountId`) | K bruto napitnina pri politiki delodajalca | 7600220 – Prihodki od napitnin |
| Strošek kartične provizije napitnin | D strošek, če provizijo nosi delodajalec | 4199000 – Bančne in plačilne provizije |

\* Nazivi so semantični primeri za razlago in jih je treba potrditi v
**Nastavitve → POS → Knjiženje**. Manjkajoči obvezni konto ne sme biti
nadomeščen z naključnim kontom; sinhronizacija dogodek označi kot preskočen z
razlogom.

## Standardna prodaja z gotovino

### Vnos v programu

1. Izberite mizo ali naročilo, dodajte artikel (npr. kosilo 9,5 %).
2. Izberite **Plačilo → Gotovina**, vnesite prejeti znesek in zaključite račun.
3. Preverite, da je račun fiskalno potrjen in ni označen kot storno.
4. Pri dnevnem zaključku sprožite **Temeljnice → Sinhroniziraj dan**.

### Primer

Kosilo je 20,00 EUR bruto pri 9,5 %. Neto je 18,26 EUR, DDV 1,74 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 20,00 | — |
| 7600000 | Prihodki od gostinskih storitev | — | 18,26 |
| 2600950 | Obveznost za DDV 9,5 % | — | 1,74 |
| **Skupaj** |  | **20,00** | **20,00** |

Če je nastavljen drug prihodek po kategoriji, se uporabi ta konto namesto
7600000. Dnevna temeljnica vsebuje seštevek vseh gotovinskih računov in
ločene prihodke/DDV po kategoriji in stopnji.

## Mejni primeri: kava, piškot in prodaja »To Go«

Pri teh primerih računovodja ne sme sklepati o DDV samo iz naziva artikla ali
iz dejstva, da sta dve postavki na istem računu. POS določi stopnjo za vsako
postavko ob prodaji in ta podatek ohrani v zgodovinskem posnetku postavke.

### Prodaja samo kave pri mizi

Kava je nastavljena kot `hot_beverage`. Pri prodaji za uživanje pri mizi se
uporabi 22 % DDV. Primer: kava 3,05 EUR bruto, plačana z gotovino. Neto je
2,50 EUR, DDV 0,55 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 3,05 | — |
| 7600100 | Prihodki od prodaje toplih pijač – 22 % | — | 2,50 |
| 2602200 | Obveznost za DDV 22 % | — | 0,55 |
| **Skupaj** |  | **3,05** | **3,05** |

Kontrolirajte, da kava ni pomotoma knjižena kot hrana po 9,5 %. Nabavna
stopnja kavnih zrn na prejemnici je lahko 9,5 %, vendar to ne spremeni
prodajne stopnje pripravljene kave pri mizi.

### Prodaja kave s piškotom pri mizi

Kava in piškot sta na istem računu, vendar ostaneta dve ločeni dobavi. Kava
3,05 EUR je obdavčena po 22 % (neto 2,50 EUR, DDV 0,55 EUR), piškot 2,19 EUR
pa po 9,5 % (neto 2,00 EUR, DDV 0,19 EUR). Skupni račun je 5,24 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 5,24 | — |
| 7600100 | Prihodki od prodaje toplih pijač – 22 % | — | 2,50 |
| 7600000 | Prihodki od prodaje hrane – 9,5 % | — | 2,00 |
| 2602200 | Obveznost za DDV 22 % | — | 0,55 |
| 2600950 | Obveznost za DDV 9,5 % | — | 0,19 |
| **Skupaj** |  | **5,24** | **5,24** |

Samo skupna prodaja kave in piškota ne pomeni, da je kava postala del menija.
Kava lahko dobi menijsko obravnavo po 9,5 % le, če je bila ob prodaji
izrecno in preverljivo vključena kot upravičena nealkoholna pijača v menijski
artikel. Naknadna sprememba šifranta ne sme spremeniti že izdanega računa.

### Nastavitev artikla za prodajo »To Go«

1. V šifrantu artiklov odprite glavni prodajni artikel, na primer kavo,
   sendvič ali piškot.
2. Omogočite možnost **To Go** samo pri artiklih, ki jih je dovoljeno prodati
   za s seboj.
3. Izberite povezane »To Go« artikle, na primer lonček, pokrov, vrečko ali
   škatlo. Ti artikli se pri podprtih prodajnih tokovih dodajo kot podrejene
   postavke glavnega artikla.
4. Preverite prodajno ceno embalaže. Brezplačna embalaža ima vrednost 0,00,
   plačljiva embalaža pa je vključena v bruto znesek računa.
5. Pri prodaji označite **To Go** na konkretni postavki. Oznaka druge
   postavke na istem naročilu ne spremeni samodejno.

Podrejeni »To Go« artikel podeduje DDV-stopnjo in računovodsko vrsto glavne
postavke. Lonček ob kavi zato sledi kavi, škatla ob hrani pa sledi hrani.
Računovodja naj v predogledu preveri povezavo z glavno postavko; embalaže ne
sme samovoljno preknjižiti na drugo stopnjo.

### »To Go« kava z lončkom — konservativna nastavitev

Privzeta nastavitev za nesladkan topel napitek »To Go« je konservativna:
22 %. Kava 3,05 EUR in lonček 0,61 EUR sta zato oba po 22 %. Skupaj je
3,66 EUR bruto, neto 3,00 EUR in DDV 0,66 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 3,66 | — |
| 7600100 | Prihodki od prodaje toplih pijač in pripadajoče embalaže – 22 % | — | 3,00 |
| 2602200 | Obveznost za DDV 22 % | — | 0,66 |
| **Skupaj** |  | **3,66** | **3,66** |

Če je pri nesladkanem toplem napitku po potrjeni davčni politiki podjetja
izbrana liberalna nastavitev 9,5 %, morata kava in njen podrejeni lonček
uporabiti 9,5 %. Sladkan topel napitek ostane 22 %. Spremembe nastavitve ne
uporabljajte za popravljanje starih računov.

### »To Go« piškot z vrečko

Piškot je hrana in ostane po 9,5 % tudi za s seboj. Piškot 2,19 EUR ter
podrejena vrečka 0,55 EUR sta skupaj 2,74 EUR bruto. Neto je 2,50 EUR, DDV
0,24 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 2,74 | — |
| 7600000 | Prihodki od prodaje hrane in pripadajoče embalaže – 9,5 % | — | 2,50 |
| 2600950 | Obveznost za DDV 9,5 % | — | 0,24 |
| **Skupaj** |  | **2,74** | **2,74** |

### Mešano naročilo: pri mizi in »To Go«

Če gost na istem naročilu zaužije kavo pri mizi in odnese piškot, mora biti
oznaka **To Go** vključena samo na piškotu. Kava ostane 22 %, piškot in
njegova vrečka pa 9,5 %. V dnevni temeljnici pričakujte eno D vrstico
plačila ter ločene K vrstice prihodkov in DDV po obeh stopnjah.

Pred knjiženjem teh primerov preverite:

- da je na postavki shranjena prava oznaka pri mizi oziroma »To Go«;
- da kava in piškot nista brez podlage združena v eno DDV-skupino;
- da je embalaža povezana z glavno postavko in ima njeno stopnjo;
- da seštevek neto osnov in DDV ustreza bruto računu;
- da uporabljeni prihodkovni konto sledi shranjeni kategoriji prodane
  postavke, ne današnji nastavitvi artikla.

## Standardna prodaja s kartico

### Vnos in kontrola

V računu izberite **Plačilo → Kartica**, izvedite avtorizacijo terminala in
počakajte na uspešen rezultat. V POS-u se kartica knjiži na konto
`cardAccountId`, ne neposredno na bančni TRR, ker nakazilo izdajatelja še ni
nujno prejeto.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1100100 | Terjatve do izdajateljev kartic | 50,00 | — |
| 7600000 | Prihodki od gostinskih storitev | — | 45,66 |
| 2600950 | Obveznost za DDV 9,5 % | — | 4,34 |
| **Skupaj** |  | **50,00** | **50,00** |

Provizija banke ni del POS prodajne temeljnice, razen posebej izračunane
provizije napitnine. Ob bančnem izpisku se terjatev do izdajatelja zapre z
bančnim prometom in stroškom po pravilih glavne knjige.

## Mešano plačilo

POS razdeli plačila po dejansko vnesenih zneskih. Primer: račun 100,00 EUR,
60,00 EUR kartica in 40,00 EUR gotovina, vsi artikli 22 % (neto 81,97, DDV
18,03).

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 40,00 | — |
| 1100100 | Terjatve do izdajateljev kartic | 60,00 | — |
| 7600000 | Prihodki od gostinskih storitev | — | 81,97 |
| 2602200 | Obveznost za DDV 22 % | — | 18,03 |
| **Skupaj** |  | **100,00** | **100,00** |

Če se vnos plačil ne sešteje do bruto računa, računa ne zaključite. Razlika
se ne sme prikriti s popustom ali ročnim temeljenjem.

## Darilni boni

### Izdaja bona (predplačilo, brez prihodka in DDV)

V **Račun → Poseben račun → Izdaja darilnega bona** vnesite nominalo, izberite
način plačila in zaključite izdajo. Izdaja je ločena od dnevne prodaje.

Primer: izdan bon 50,00 EUR, plačan z gotovino:

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 50,00 | — |
| 2300000 | Prejeta predplačila – darilni boni | — | 50,00 |

Na tej temeljnici ni prihodka in ni izhodnega DDV. Če je bon plačan s kartico,
je D 1100100; pri drugem negotovinskem načinu je D konto drugih plačil.

### Unovčitev, delno unovčenje in storno

Pri računu 80,00 EUR, od tega 30,00 EUR darilni bon in 50,00 EUR kartica,
izberite **Plačilo → Darilni bon**, vnesite številko bona in znesek ter razliko
poravnajte s kartico. Temeljnica (22 %, neto 65,57, DDV 14,43):

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 2300000 | Prejeta predplačila – darilni boni | 30,00 | — |
| 1100100 | Terjatve do izdajateljev kartic | 50,00 | — |
| 7600000 | Prihodki od prodaje | — | 65,57 |
| 2602200 | Obveznost za DDV 22 % | — | 14,43 |
| **Skupaj** |  | **80,00** | **80,00** |

Delno unovčenje zmanjša saldo konkretnega bona samo za uporabljeni znesek.
Ponovno skeniranje istega gibanja ne sme ustvariti druge D vrstice. Pri
stornu se ustvari nasprotna (negativna vsebinska) temeljnica: prihodek in DDV
se obrneta na D, plačilni konti pa na K. Storno bona se ne obravnava kot nova
izdaja.

## Bon za pico, študentski bon in subvencija

### Bon za pico

V plačilnem oknu izberite **Bon za pico**, vnesite število in nominalo, nato
potrdite račun. Bon za pico je samostojen tok in se nikoli ne združi s
predplačilnim kontom darilnih bonov.

Primer računa 12,00 EUR, celota bon za pico (9,5 %, neto 10,96, DDV 1,04):

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1650100 | Terjatve za bone za pico | 12,00 | — |
| 7600000 | Prihodki od gostinskih storitev | — | 10,96 |
| 2600950 | Obveznost za DDV 9,5 % | — | 1,04 |

### Študentski bon

Izberite **Študentski bon**, preverite partnerja za subvencijo (npr. MDDSZ/ŠOS)
in zaključite račun. Nastavljena morata biti tako konto terjatve kot partner.
Primer subvencije 4,00 EUR pri računu 9,50 EUR (preostanek 5,50 gotovina):

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1650000 | Terjatev do države – subvencije | 4,00 | — |
| 1000000 | Blagajna | 5,50 | — |
| 7600000 | Prihodki od storitev | — | 8,68 |
| 2600950 | Obveznost za DDV 9,5 % | — | 0,82 |
| **Skupaj** |  | **9,50** | **9,50** |

POS ustvari tudi osnutek dokumenta `POS-SSP-YYYY-MM-DD-E<enota>`, povezan z
dnevno temeljnico. Dokument ne sme dodati novega prihodka ali DDV; predstavlja
uskladitev terjatve do partnerja.

Če partner ali konto manjka, se dogodek preskoči z jasnim opozorilom. Ne
knjižite subvencije na gotovino samo zato, da je temeljnica uravnotežena.

## Druga negotovinska plačila in pogodbene malice

Pri **negotovinskem** plačilu brez znanega kupca (npr. Sodexo) vnesite način
plačila in po potrebi številko nosilca. Znesek gre na `otherPaymentAccountId`.
Če je kupec znan in je povezan cenik partnerja, gre za pogodbeno malico in
se uporabi `contractReceivableTransitAccountId`.

Primer 100,00 EUR pogodbenih malic, 9,5 %:

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1650200 | Prehodna terjatev do naročnika malic | 100,00 | — |
| 7600000 | Prihodki od storitev | — | 91,32 |
| 2600950 | Obveznost za DDV 9,5 % | — | 8,68 |

Na mesečnem A-računu se prehodna terjatev zapre po postopku glavne knjige.
Če partner ni identificiran, ne označujte računa kot pogodbenega; uporabi se
drugi negotovinski konto.

## Popust, več DDV-stopenj in zaokrožitve

Popust vnesite na račun ali vrstico **pred zaključkom**. POS knjiži že
zmanjšano bruto osnovo. Popust torej ni dodatna D/K vrstica na ločenem kontu,
temveč zmanjša prihodke in pripadajoči DDV.

Primer: 50,00 EUR po 9,5 % in 30,00 EUR po 22 %, 10 % popust na celoten
račun. Končna bruto vrednost je 72,00 EUR; 41,10 EUR neto po 9,5 %, 22,13 EUR
neto po 22 %, DDV 3,90 EUR oziroma 4,87 EUR.

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1000000 | Blagajna | 72,00 | — |
| 7600000 | Prihodki 9,5 % | — | 41,10 |
| 7600100 | Prihodki 22 % | — | 22,13 |
| 2600950 | Obveznost za DDV 9,5 % | — | 3,90 |
| 2602200 | Obveznost za DDV 22 % | — | 4,87 |
| **Skupaj** |  | **72,00** | **72,00** |

Zaradi zaokroževanja lahko posamezna vrstica odstopa za 0,01 EUR, skupna
temeljnica pa mora biti uravnotežena. Če je račun 100 % popust, preverite
ali je pričakovan izhodni DDV 0,00 in ali je račun ustrezno označen.

## Lastna poraba in reprezentanca

Vnesite račun z načinom **Lastna poraba** ali **Reprezentanca**. Ta računa sta
izločena iz redne dnevne prodaje in se združita v ločeno referenco
`POS:LASTREPR:YYYY-MM-DD`.

Pri reprezentanci z obračunsko vrednostjo 100,00 EUR in stopnjo DDV 22 %
POS uporabi bruto vrednost na odhodku ter jo na kreditni strani razdeli na
neto prihodek 81,97 EUR in izhodni DDV 18,03 EUR:

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 4170000 | Stroški reprezentance | 100,00 | — |
| 7600100 | Prihodki/izravnava reprezentance | — | 81,97 |
| 2602200 | Obveznost za izhodni DDV 22 % | — | 18,03 |
| **Skupaj** |  | **100,00** | **100,00** |

Pri lastni porabi se uporabi nastavitev lastne porabe oziroma ustrezen interni
konto podjetja. Ne knjižite teh računov še enkrat v redno gotovino ali kartice.
Pri postavki z neničelno stopnjo POS vedno ustvari kredit prihodka in izhodnega
DDV iz vrednosti postavk; pred potrditvijo preverite uporabljeno stopnjo.

## Napitnine

### Napitnina za tuj račun

Pri zaključku označite napitnino in prejemnika po internem postopku. Pri
politiki `direct_employee` ali `independent_pool` je napitnina obveznost, ne
prihodek delodajalca. Pri računu 100,00 EUR prodaje in 10,00 EUR napitnine,
plačilo s kartico:

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 1100100 | Terjatve do izdajateljev kartic | 110,00 | — |
| 7600000 | Prihodki od prodaje | — | 91,32 |
| 2600950 | Obveznost za DDV 9,5 % | — | 8,68 |
| 2550000 | Obveznost za napitnine do osebja | — | 10,00 |

Ob izplačilu izberite **Napitnine → Poravnava**, način gotovina ali banka.
Sistem ustvari ločeno temeljnico:

| Konto | Naziv (primer) | D | K |
|---|---|---:|---:|
| 2550000 | Obveznost za napitnine | 10,00 | — |
| 1000000 ali 1100000 | Blagajna ali TRR | — | 10,00 |

Poravnava je idempotentna po referenci `POS:TIP-SETTLEMENT:<allocationId>`.
Ponovljen zahtevek vrne obstoječo temeljnico. Izplačila na plače ali študentski
servis trenutno niso samodejno podprta in ne smejo biti obravnavana kot
gotovinsko izplačilo.

### Napitnina pod nadzorom delodajalca in kartična provizija

Pri politiki `employer_controlled` je napitnina prihodek. Uporabi se
`tipsRevenueAccountId` oziroma nastavljeni prihodkovni fallback in DDV
`tipsVatAccountId`. Če delodajalec nosi kartično provizijo, sta dodatni vrstici
D strošek provizije in K kartični konto.

## Storno, vračilo in FURS-ovi izidi

### Potrjen račun

V **Računi → izberi račun → Storniraj** vnesite razlog in potrdite fiskalni
storno. POS ustvari nov storno dokument, vezan na izvorni račun. Pri potrjenem
FURS stornu se vse prvotne smeri obrnejo: D prihodki/DDV, K plačilni konto.
Če je bil prvotni račun delno plačan z bonom, se obrne tudi isti del konta
predplačil oziroma bona. Vračilo ne sme ustvariti nove prodaje.

### FURS: zavrnjen ali neznan izid

- **confirmed**: storno je zaključeno in ga je mogoče vključiti v knjiženje.
- **rejected/failed**: račun ni bil potrjen pri FURS; sledite sporočilu. Ne
  ustvarjajte ročne storno temeljnice, dokler ni jasno, ali je bil račun
  dejansko sprejet.
- **unknown**: zaradi izgube odgovora je potreben ročni pregled. Samodejna
  ponovna oddaja je blokirana, da ne bi nastal dvojni fiskalni dokument.

Pri neznanem izidu primerjajte EOR, lokalni zapis, dnevnik tiskalnika in
FURS-ov odgovor. Šele po potrditvi dejanskega stanja zaključite storno ali
račun označite za opustitev po internem postopku.

## Dnevna in mesečna izdelava; preprečevanje dvojnikov

1. Dnevno: **Temeljnice → Sinhroniziraj dan → YYYY-MM-DD**. Sistem ustvari
   zbirne osnutke po enoti (prodaja, otvoritvena/KIR po konfiguraciji ter
   lastna poraba/reprezentanca).
2. Mesečno: **Temeljnice → Sinhroniziraj mesec → YYYY-MM** uporabite šele po
   pregledu obdobja. Mesečna prodajna temeljnica prepreči novo dnevno
   podvajanje za isto obdobje.
3. Osnutek se lahko ponovno izdela, dokler ni knjižen. Sistem odstrani samo
   svoj obstoječi osnutek in ga sestavi iz izvornih računov.
4. Potrjene temeljnice se ne brišejo in ne spreminjajo. Popravek je nov
   izvorni dokument, storno ali ročna uskladitev z revizijsko sledjo.

Pri izvozu v drug program prenesite najmanj: datum, številko temeljnice,
referenco POS, konto in naziv, D/K, znesek, DDV-stopnjo in DDV-kodo, partnerja,
stroškovno mesto/enoto ter povezavo na izvorni račun. Pred uvozom preverite
vsoto D = vsota K in da nobena preskočena vrstica ni ostala brez obravnave.

## Robni primeri in kontrolni seznam

| Primer | Kaj mora narediti računovodja |
|---|---|
| Manjka konto blagajne/kartic | Ne knjižite. Odpravite nastavitev in ponovite sinhronizacijo osnutka. |
| Manjka konto prihodkov kategorije | Preverite kategorijo/artikel; fallback uporabite le po potrditvi politike podjetja. |
| Manjka konto DDV | Sinhronizacija se preskoči; ne nadomestite ga s prihodkovnim kontom. |
| Manjka DDV-koda, konto obstaja | Temeljnica lahko nastane, vendar vrstica ne gre v KIR; takoj dopolnite DDV-kodo in uskladite evidenco. |
| Manjka partner subvencije | Študentski bon se ne sme knjižiti kot gotovina; dopolnite partnerja in ponovite. |
| Kartica in gotovina v istem računu | Preverite dve D vrstici in en skupni bruto K promet/DDV razrez. |
| Negotovinsko plačilo brez kupca | Konto drugih plačil; ne ustvarjajte saldakontne terjatve. |
| Negotovinsko plačilo z znanim pogodbenim kupcem | Prehodna terjatev; preverite cenik in partnerja. |
| Ponovljen dnevni zagon | Preverite referenco; sistem ne sme podvojiti obstoječe mesečne ali potrjene temeljnice. |
| Storno računa | Vedno uporabite izvorni račun in FURS status; ročno nasprotno temeljnico uporabite le z revizijsko sledjo. |
| Neznan FURS rezultat | Ustavite avtomatsko ponavljanje in opravite ročno uskladitev. |
| Negativni znesek/storno v zbiru | `pushSignedLine` obrne stran in uporabi absolutno vrednost; kontrolirajte izvorni dokument. |
| Neuravnotežena temeljnica | Ne knjižite. Preglejte preskočene kontne vrstice in razrez DDV. |

Pred potrditvijo vsak dan odkljukajte:

- [ ] število POS računov se ujema s fiskalnim poročilom;
- [ ] gotovina se ujema z blagajno, kartice s poročilom terminala;
- [ ] darilni boni, boni za pico in subvencije so ločeni;
- [ ] pogodbeni računi imajo partnerja in prehodni konto;
- [ ] lastna poraba/reprezentanca nista v redni prodajni temeljnici;
- [ ] izhodni DDV po 5 %, 9,5 % in 22 % se ujema s poročilom;
- [ ] vsota debet = vsota kredit;
- [ ] noben zapis v `skipped` nima neobravnavanega razloga;
- [ ] osnutek ima pravilno obdobje in je obdobje odprto;
- [ ] potrjene temeljnice so prenesene samo enkrat.
