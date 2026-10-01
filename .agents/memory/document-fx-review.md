---
name: Pregled preračuna tuje valute
description: Zakaj potrjeni EUR zneski osnove in DDV niso ponovno izračunljivi iz zaokrožene cene.
---

Potrditev valutnega preračuna zajema ločeno preračunano osnovo in DDV. Te zneske ohrani tudi pri prikazu, knjiženju in spremembah samo konta ali opisa. Osnove in davka ne izpeljuj znova iz zaokrožene EUR cene na enoto. Namenska sprememba cene, količine ali stopnje je nov računovodski popravek.

**Why:** Pri izvorni osnovi 1,07 USD in DDV 0,24 USD ob tečaju 1,1 USD za EUR sta preračunana zneska 0,97 in 0,22 EUR. Ponovni izračun 22 % od 0,97 spremeni DDV na 0,21 in izgubi že pregledan cent.

**How to apply:** Vsak nov porabnik preračunanih računov mora upoštevati shranjene potrjene zneske. Izvirni dokument ostane v izvorni valuti; preračun in uporabljeni tečaj imata svojo revizijsko sled.

Za valutno deljenje uporabljaj natančno decimalno aritmetiko s pravili za polovico stran od nič, ne binarnega deljenja pred `toFixed`.

**Why:** 0,87 / 1,2 je natančno 0,725; binarno deljenje lahko pri dveh decimalkah vrne 0,72 namesto 0,73.

**How to apply:** Zaokroži posamezno osnovo in DDV, skupne EUR zneske seštej iz teh vrstic in uporabniku pokaži razliko glede na neposreden preračun izvornega bruto zneska. Ne prikrivaj razlike s samodejno spremembo davka.

Pred izdajo integracije tečajev preveri en dejanski, neškodljiv javni odgovor ponudnika; testnih CSV primerov ne sestavljaj samo iz predpostavk.

**Why:** Simulirani primeri so prestali strogo preverjanje serije, dejanski ECB odgovor pa je imel drugačno oznako serije. Vsi lokalni testi so zato lahko uspešni, samodejni tečaj pa vseeno odpove.

**How to apply:** Primerjaj strukturo živega odgovora s testnimi podatki. Številska polja preveri po pričakovani decimalni slovnici, ne samo z `Number`, ki sprejme tudi šestnajstiški zapis.

Knjiženje nepravilne nabavne listine v celoti v strošek brez odbitka zaračunanega DDV mora biti izrecna izbira računovodje, ne sklep iz države dobavitelja. Morebitna samoobdavčitev je ločeno vprašanje.

**Why:** Zaračunani neodbitni davek je lahko del stroška, vendar ameriški dobavitelj ali nepopolna listina sama po sebi ne pomeni oprostitve vseh DDV obveznosti.

**How to apply:** Ohrani izvorni razcep listine. Pri potrjenem bruto strošku preračunaj celoten bruto, ne seštevka ločeno zaokroženega neta in DDV. Zahtevaj stroškovni konto, ne dovoli, da poznejša sprememba osnutka neopazno znova ustvari odbitni DDV.

Centna uskladitev izvornega OCR in uskladitev EUR zaokroževanja sta ločeni revizijski dejstvi.

**Why:** Pri večvrstični listini se lahko že izvorni seštevek vrstic razlikuje od glave; dodaten odmik lahko nastane šele pri preračunu vsake vrstice v EUR. Ena sama »tečajna razlika« bi pomešala oba vzroka.

**How to apply:** Obe uskladitvi pokaži v predogledu in shrani s potrditvijo. Izvirnika ne spreminjaj. Velikih OCR odstopanj ne prikrivaj in ne sproščaj preverjanja običajnih računov zaradi tega posebnega načina.

Obvezen pregled knjiženja ne pomeni, da morata partner in obdobje ostati prazna, kadar sta že enolično določljiva.

**Why:** Uporabnik je izrecno pojasnil, da je znani dobavitelj že v šifrantu in da datum listine določa obstoječe obdobje. Ponovna ročna izbira teh podatkov ni zahtevani varnostni ukrep.

**How to apply:** Predizberi obstoječega partnerja brez nasprotujočih si identitetnih dokazov in odprto obdobje, ki pokriva datum listine. Dvoumnost zahteva izbiro uporabnika; predizbira nikoli ne pomeni samodejne potrditve ali knjiženja.