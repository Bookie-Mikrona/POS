# Davčne evidence v modulu Glavna knjiga

**Razmejitev dokumentacije:** 10.10.2026.

KIR, KPR, njuna uskladitev z glavno knjigo, davčni XML izvoz in postopek
oddaje v eDavke sodijo v modul **Glavna knjiga**. V aplikaciji odprite
**Glavna knjiga → DDV evidence → KIR/KPR Evidenca**. Pred začetkom
preverite aktivno podjetje in izbrano davčno obdobje.

POS Gostinstvo je eden od virov izdanih in prejetih listin. Davčne evidence
pa obravnavajo davčne vire podjetja, ne le prometa ene POS enote. Izbira
POS enote ne sme nadomestiti izbire podjetja in obdobja v glavni knjigi.
Ta prenos navodil ni nov funkcionalni prevzem; ohranja že opisane omejitve.

## 1. KIR — knjiga izdanih računov

KIR vsebuje pravilno knjižene izdane račune in povezane popravke. Vir mora
biti sledljiv po verigi **izvorni račun → KIR-vrstica → temeljnica**.
Sam zaključek POS računa ali fiskalna potrditev še ne dokazujeta popolne
davčne evidence.

1. V DDV evidencah izberite podjetje, obdobje in izdane račune.
2. Preglejte številko računa, datum izdaje oziroma davčni datum, partnerja,
   DDV-kodo, osnovo, DDV, bruto znesek in status.
3. Storno, vračilo in dobropis povežite z izvirnikom ter preverite nasprotni
   učinek. Ne ustvarjajte navideznega novega računa za popravek evidence.
4. Preverite povezavo davčne vrstice na izvor in računovodsko knjižbo.
5. Manjkajoč ali podvojen vir zadržite za razjasnitev pred izvozom.

Odprta miza, rezervacija, nedokončano naročilo in operativni odpad niso
izdani računi. Operativno poročilo POS samo po sebi ni KIR.

## 2. KPR — knjiga prejetih računov

KPR se navezuje na pravilno knjižene prejete račune. Dobropis in bremepis
sta popravljalna vira s povezavo na izvirnik.

1. Izberite prejete račune za isto podjetje in davčno obdobje.
2. Preverite dobavitelja, številko listine, datum listine, datum prejema,
   davčni datum, DDV-kodo, osnovo, DDV in odbitnost.
3. Povežite **izvorno listino → KPR-vrstico → temeljnico**.
4. Pri popravku preverite povezavo na izvirnik in preprečite dvojni učinek
   v zalogi, obveznosti ali DDV.
5. Manjkajoče podatke oziroma preslikave razjasnite pred davčnim izvozom.

Prejemnica oziroma dobavnica brez računa je lahko zalogovni dokument;
ne predstavljajte je kot popoln KPR-zapis. Če samodejni knjižni učinek
popravka ni potrjen, uporabite odobren računovodski postopek in preverite
nastale knjižbe. Ne domnevajte samodejne podpore za vsako vrsto dokumenta.

## 3. Uskladitev KIR/KPR z glavno knjigo

Rekonciliacija KIR/KPR z DDV-O polji ni isto kot popolna uskladitev z
glavno knjigo. Popolna avtomatska uskladitev vseh virov, registrov in
saldo podatkov glavne knjige ni potrjena.

Računovodja zato dokumentirano primerja:

- število dokumentov in vrstic za isto podjetje in obdobje;
- davčne osnove in DDV po stopnjah;
- manjkajoče, preskočene in podvojene vire;
- storna, dobropise, bremepise in korekcijske verige;
- povezave na knjižene temeljnice in pripadajoče DDV konte.

POS, X/Z, banka in zalogovna poročila so dodatni kontrolni viri, ne
nadomestilo za KIR/KPR. Razliko raziščite po izvorni referenci; ne
prilagajajte seštevkov brez dokazljivega popravka. Dokazilo naj vsebuje
podjetje, obdobje, uporabljene izpise, seštevke, razlike, razlago,
uporabnika ter odobritev.

## 4. KIR/KPR XML izvoz

V modulu Glavna knjiga pripravite izvoz za izbrano podjetje in obdobje.
Prenos XML oziroma arhiva ZIP je priprava davčnih datotek, ne oddaja.

Predoddajna kontrola preverja datum prejema, korekcijske povezave,
KIR/KPR preslikave, neničelne DDV-vrstice brez DDV-kode in knjižene
DDV-vrstice brez aktivne vrstice evidence. Če kontrola vrne dokumente
in razloge napak, izvoz zadržite ter odpravite izvor oziroma preslikavo.
Ne uporabljajte delne datoteke in ne obidite opozorila.

Shranite datoteko, različico sheme, podjetje, obdobje, rezultat,
čas, uporabnika, referenco oziroma odtis datoteke in seznam napak.

## 5. Oddaja v eDavke in dokaz prejema

Neposredna oddaja KIR/KPR iz aplikacije v eDavke trenutno **ni
implementirana**. Podprt izvoz ne pomeni samodejne oddaje.

Preverjeno datoteko oddajte po zunanjem odobrenem postopku eDavki.
Shranite povratnico oziroma zavrnitev, čas, uporabnika in povezavo na
točno oddano datoteko. Uspešno generiranje, prenos ZIP ali stanje
aplikacije niso dokaz, da so eDavki podatke prejeli in sprejeli.

## 6. Kontrolni seznam računovodje

- [ ] Pravilno podjetje in isto davčno obdobje pri vseh primerjavah.
- [ ] Vključeni pravilno knjiženi viri in povezani popravki.
- [ ] Preverjeni datumi, partnerji, kode, osnove, DDV in odbitnost.
- [ ] Dokumentirana uskladitev; avtomatska popolna uskladitev ni domnevana.
- [ ] Izvoz brez nerešenih predoddajnih napak, z ohranjeno sledjo.
- [ ] Dejanska zunanja oddaja ločena od izvoza in dokazana s povratnico.

## 7. Dokazna podlaga in obseg

Pripadajoči postopki so v inventarju `Davcne-evidence-sledljiv-inventar.json`
v mapi tega priročnika. Viri so ERP strani `ddv.tsx`, `ddv-evidence.tsx`
in menijska razvrstitev v `Shell.tsx` ter strežniški moduli `vatLedger.ts`,
`vatLedgerReport.ts`, `vatSubmissions.ts` in `vatXmlGenerator.ts`.
Ohranjen je status nepodprte neposredne oddaje in nepotrjene popolne
avtomatske uskladitve. V tem pregledu ni bila izvedena dejanska davčna oddaja.
