# Mikrona — prehod glavne knjige iz starega programa

**Status: OSNUTEK — ni potrjen za izvedbo.**
**Datum shranitve: 1. oktober 2026.**

Uporabnik želi predlog za zdaj samo shraniti in se k njemu vrniti pozneje.
Ta dokument ne odobrava uvoza, knjiženja, popravkov, brisanja podatkov ali sprememb programa.

## Izhodišče

Vir uporabnikovega predloga:
`attached_assets/Pasted-kaj-zahtevajo-programske-hi-e-v-sloveniji-od-nove-stran_1790812298309.txt`.

Priloga opisuje začetek dela v novi glavni knjigi z začasnimi začetnimi stanji,
medtem ko računovodja preteklo leto zaključuje v starem programu, ter poznejšo
uskladitev otvoritve.

Leto 2027 oziroma prehod 1. januarja 2027 je uporabljeno kot primer iz priloge.
Dejanski datum prehoda mora uporabnik še potrditi.

## Mnenje in priporočena smer

Osnovni predlog je smiseln, vendar sam uvoz bruto bilance in poznejše knjiženje
razlik ne zagotavljata pravilnih odprtih postavk. Potreben je nadzorovan postopek
začasne otvoritve, prenosa analitike in končne uskladitve, ki ohrani vmesna plačila.

Za začetek novega leta ni treba najprej rekonstruirati vseh računov in davčnih
evidenc preteklega leta v novem programu. Potrebujemo preverljivo začetno stanje,
pravilne odprte postavke in jasno razmejitev med GK ter davčnimi evidencami.

## 1. Ločitev zgodovine in tekočega poslovanja

Predlagana razmejitev za primer prehoda v leto 2027:

- **2020–2025:** ohraniti že preneseno zgodovino za pregled in primerjavo;
  ne brisati je in ne uvažati ponovno.
- **2026:** zaključevanje v starem programu. Uvoženi osnutki v novem ERP sami po
  sebi niso dokaz dokončnega stanja.
- **2027:** tekoče poslovanje v novem ERP, z eno nadzorovano otvoritvijo.

To je predlog organizacije prehoda, ne sveža potrditev statusov v podatkovni bazi.

## 2. Podatki za začasno otvoritev

Pridobiti stanje na enotnem presečnem datumu, v tem primeru 31. decembra 2026:

| Podatki | Namen |
| --- | --- |
| Bruto bilanca in potrjena preslikava kontov | Začetna stanja GK |
| Odprte postavke kupcev in dobaviteljev | Zapiranje starih računov z novimi plačili |
| Stanja bank, blagajne in prehodnih kontov | Kontrola denarnih sredstev |
| Register osnovnih sredstev, če se prenaša | Nadaljevanje amortizacije |
| Kontrolni izpisi starega programa | Dokazila za uskladitev |

Otvoritev ni prenos celotnega lanskega prometa razredov 0–9 kot prometa novega
leta. Prenesejo se ustrezna začetna bilančna stanja, ob pravilni obravnavi
stroškov, prihodkov in rezultata preteklega leta.

**Začasna otvoritev ni isto kot neknjižen osnutek.** Po pregledu in potrditvi mora
sodelovati v GK, da imajo poročila novega leta začetna stanja. Oznaka »začasna«
pomeni, da jo bo treba pozneje uskladiti; ne nadomesti statusa knjiženja.

## 3. Odprte postavke in preprečevanje dvojnega knjiženja

Zbirna otvoritev kontov kupcev in dobaviteljev ne nadomesti seznama posameznih
računov po partnerjih.

Vsaka prenesena odprta postavka mora ohraniti:

- izvorno identiteto in partnerja;
- številko računa in izvirne datume;
- valuto, zapadlost in odprti znesek;
- sled do dokazil zapiranj, kjer so na voljo.

Seštevki analitike se morajo uskladiti z GK. Zbirna otvoritev in prenos posameznih
odprtih postavk ne smeta iste terjatve oziroma obveznosti knjižiti dvakrat.

Pri Mikroni je treba upoštevati že prenesene zgodovinske račune in dokazila
zapiranj. Zbirnim otvoritvenim vrsticam ne izmišljamo partnerjev; analitiko
poiščemo v izvirnih postavkah. Mikrona ne uporablja stroškovnih mest, zato jih
ne dodajamo umetno zaradi privzetih nastavitev ciljnega konta.

## 4. Končna uskladitev

Po zaključku starega leta pridobiti končno stanje na **istem presečnem datumu**.
Poznejši datum izdelave izpisa ne sme spremeniti njegovega časovnega preseka.

Primerjava:

**Končno stanje starega leta − potrjeno začasno otvoritveno stanje.**

Končnega starega stanja ne primerjamo s trenutnim saldom novega leta, saj ta že
vsebuje nova plačila in druge knjižbe.

Razlike pregleda in potrdi računovodja. Predlagana obravnava je ločena
korekcijska otvoritvena temeljnica, praviloma z datumom otvoritve in ob ustreznih
kontrolah obdobja. Knjižene prvotne otvoritve ne prepisujemo ali brišemo.

Primer:

- Začasno prenesena obveznost: 800 EUR.
- Januarsko plačilo: 800 EUR.
- Končno začetno stanje po zaključku starega leta: 1.000 EUR.
- Korekcija iste izvorne postavke: +200 EUR.
- Januarsko plačilo ostane povezano; preostanek je 200 EUR.

Ponovni uvoz ne sme ustvariti nove odprte obveznosti 1.000 EUR ali izgubiti
že izvedenega plačila.

Razlike niso nujno majhne. Nepojasnjenih razlik ne uravnotežimo umetno in jih ne
knjižimo samodejno.

## 5. Predlagana programska rešitev

Poseben postopek **»Prehod iz starega programa«**, ki bi omogočal:

1. Izbiro podjetja, datuma prehoda in presečnega datuma vira.
2. Predogled začasnih stanj, kontnih preslikav in odprtih postavk.
3. Kontrole uravnoteženosti, identitete vira in usklajenosti GK z analitiko.
4. Izrecno potrditev začasne otvoritve brez podvajanja obstoječih podatkov.
5. Uvoz končnega posnetka in predogled razlik glede na potrjeno začasno otvoritev.
6. Ohranitev povezav do vseh vmesnih plačil.
7. Potrditev korekcijske temeljnice in revizijsko sled do obeh izvornih posnetkov.
8. Oznako dokončno usklajene otvoritve šele po uspešnih kontrolah.

Pri pregledu kode so bili najdeni uvozi, kontne preslikave, dokazila zgodovinskih
zapiranj in namenska priprava otvoritve. Ni bil najden celovit splošni postopek
»začasna otvoritev → končna uskladitev« z varnim ohranjanjem vmesnih plačil.
Ob nadaljevanju preveriti aktualno kodo in dejansko stanje; ta ugotovitev ni
potrditev produkcijskih podatkov.

## Odprte odločitve za poznejšo obravnavo

- Dejanski datum in leto začetka tekočega poslovanja v novem ERP.
- Kateri dokončni in začasni izpisi bodo na voljo iz starega programa.
- Način uskladitve že prenesenih računov in njihovih zapiranj.
- Obseg prenosa osnovnih sredstev in drugih pomožnih evidenc.
- Ločena obravnava DDV evidenc, zlasti listin preteklega leta, ki pridejo pozneje.
- Potrjevalne pravice in obravnava zaklenjenih obdobij.

**Naslednji korak se izvede šele po novem uporabnikovem navodilu.**